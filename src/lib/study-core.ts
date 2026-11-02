// Study engine: cards, answer checking, lesson building, XP/streaks. Pure + unit-tested.
import { crownOf, isDue, isNew, mastery, newSrs, schedule, type Grade, type SrsState } from "./srs.ts";

export type CardKind = "basic" | "cloze" | "steps";
export type CardSource = "ai" | "manual" | "mistake" | "explain" | "lasso";
export type Card = SrsState & {
  id: string;
  front: string;
  back: string;
  kind: CardKind;
  /** for cloze: the sentence with ____ where the answer goes (front); for steps: the ordered steps */
  steps?: string[];
  topic?: string;
  hint?: string;
  notebookId: string | null;
  noteId?: string;
  page?: number;
  source: CardSource;
  createdAt: number;
  updatedAt: number;
  suspended?: boolean;
  /** wrong answers written for THIS card, each one a realistic mistake (near miss first), same form as the answer */
  distractors?: string[];
};

// --- RNG (seedable so lessons are testable) ----------------------------------------------------------------
export type Rng = () => number;
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function shuffle<T>(xs: T[], rng: Rng = Math.random): T[] {
  const a = xs.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// --- answer checking --------------------------------------------------------------------------------------------
/** Lower-case, strip LaTeX/markup/punctuation noise so "$\frac{1}{2}$", "1/2" and " 1 / 2 " compare equal. */
export function normalizeAnswer(s: string): string {
  return s
    .toLowerCase()
    .replace(/[−–—]/g, "-")
    // symbols a tablet keyboard doesn't have must still be answerable in plain letters and digits
    .replace(/²/g, "^2").replace(/³/g, "^3").replace(/\bsquared\b/g, "^2").replace(/\bcubed\b/g, "^3")
    .replace(/[×·]/g, "*").replace(/→/g, "->").replace(/≥/g, ">=").replace(/≤/g, "<=").replace(/√/g, "sqrt").replace(/π/g, "pi")
    .replace(/\\(?:left|right|,|;|!|text|mathrm|cdot|times)/g, (m) => (m === "\\cdot" || m === "\\times" ? "*" : ""))
    .replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, "($1)/($2)")
    .replace(/[$\\{}]/g, "")
    .replace(/[;:!?'"`´’“”]+/g, " ")
    .replace(/[.,]+(?!\d)|(?<!\d)[.,]+/g, " ") // keep decimal points / thousands commas inside numbers
    .replace(/\s+/g, " ")
    .trim();
}
const squash = (s: string) => normalizeAnswer(s).replace(/[\s()*^]/g, "");

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  // optimal string alignment: insert / delete / substitute / swap two neighbours (a very common typo) each cost 1
  let prev2: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) cur[j] = Math.min(cur[j], prev2[j - 2] + 1);
    }
    prev2 = prev;
    prev = cur;
  }
  return prev[b.length];
}

/** Parse "3.5", "-2", "1/2", "1.2e3", "3.0 × 10^2" into a number, or null. */
export function parseNumber(s: string): number | null {
  const t = normalizeAnswer(s).replace(/\s/g, "").replace(/x10\^?(-?\d+)/, "e$1").replace(/\*10\^?(-?\d+)/, "e$1");
  const f = /^(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)$/.exec(t);
  if (f) return Number(f[2]) === 0 ? null : Number(f[1]) / Number(f[2]);
  if (/^-?\d*\.?\d+(?:e-?\d+)?$/.test(t)) return Number(t);
  return null;
}

export type Verdict = { ok: boolean; close: boolean };
export function checkTyped(input: string, answer: string, alts: string[] = []): Verdict {
  const cands = [answer, ...alts];
  const x = input.trim();
  if (!x) return { ok: false, close: false };
  const nx = parseNumber(x);
  for (const c of cands) {
    const nc = parseNumber(c);
    if (nx !== null && nc !== null) {
      if (Math.abs(nx - nc) <= Math.max(1e-9, Math.abs(nc) * 1e-3)) return { ok: true, close: false };
      continue;
    }
    if (normalizeAnswer(x) === normalizeAnswer(c) || squash(x) === squash(c)) return { ok: true, close: false };
  }
  for (const c of cands) {
    const a = squash(x), b = squash(c);
    if (a.length >= 6 && b.length >= 6 && levenshtein(a, b) / Math.max(a.length, b.length) <= 0.15) return { ok: true, close: true };
  }
  return { ok: false, close: false };
}

// --- distractors ---------------------------------------------------------------------------------------------------
/** Plausible wrong options: other cards' answers, preferring the same topic and a similar length. */
// A realistic wrong option has to be the same KIND of thing as the answer (a value for a value, a formula for a
// formula), or it can be ruled out without knowing anything. Best of all is a specific mistake a student makes.
export type AnswerShape = "number" | "formula" | "short" | "long";
const NUM_RE = /^\s*([-+−]?\d+(?:\.\d+)?)(?:\s*(?:×|x|\*)\s*10\s*\^?\s*\{?([-−]?\d+)\}?)?\s*([^\d=^]{0,14})$/;

export function answerShape(s: string): AnswerShape {
  const t = s.trim();
  if (NUM_RE.test(t)) return "number";
  if (/[=^×÷*+]|\\frac|\$/.test(t) || /^[A-Za-z]{1,3}\s*[/:]\s*[A-Za-z]{1,3}$/.test(t)) return "formula";
  return wordCount(t) <= 4 ? "short" : "long";
}

/** Count significant figures as written ("18.02" → 4, "0.0821" → 3, "2" → 1). */
export function sigFigs(raw: string): number {
  const t = raw.replace(/^[-+−]/, "");
  if (t.includes(".")) return Math.max(1, t.replace(".", "").replace(/^0+/, "").length);
  return Math.max(1, t.replace(/^0+/, "").replace(/0+$/, "").length);
}
function fmtSig(v: number, sig: number, integerAnswer: boolean): string {
  if (integerAnswer && Number.isInteger(v)) return String(v);
  const s = Number(v.toPrecision(Math.max(1, sig)));
  return String(s);
}

/**
 * Wrong numbers that come from real slips, in the same precision and unit as the answer:
 * a sign error or a missed factor of 2 (very close), a power-of-ten / unit-conversion slip (close),
 * and an inverted calculation (clearly wrong to anyone who checks the size of the answer).
 */
export function numericNearMisses(answer: string, rng: Rng = Math.random): string[] {
  const m = NUM_RE.exec(answer.trim());
  if (!m) return [];
  const raw = m[1].replace("−", "-"), unit = (m[3] ?? "").trim();
  const v = Number(raw), sig = sigFigs(raw), integerAnswer = !raw.includes(".");
  const unitPart = unit ? (/^[%°′″]/.test(unit) ? unit : ` ${unit}`) : "";
  if (m[2] !== undefined) {   // scientific notation: slips are in the exponent
    const e = Number(m[2].replace("−", "-"));
    const sci = (ex: number) => `${m[1]} × 10^${ex}${unitPart}`;
    return [sci(e - 1), sci(e + 1), sci(-e)].filter((x) => normalizeAnswer(x) !== normalizeAnswer(answer));
  }
  const near = v < 0 ? -v : rng() < 0.5 ? v * 2 : v / 2;
  const close = rng() < 0.5 ? v * 10 : v / 10;
  const far = v !== 0 ? 1 / v : 100;
  const out: string[] = [];
  for (const x of [near, close, far]) {
    const str = `${fmtSig(x, sig, integerAnswer)}${unitPart}`;
    if (Number.isFinite(x) && normalizeAnswer(str) !== normalizeAnswer(answer) && !out.includes(str)) out.push(str);
  }
  return out;
}

const unitOf = (s: string) => (NUM_RE.exec(s.trim())?.[3] ?? "").trim().toLowerCase();

/**
 * Wrong options for a card: its own written mistakes first, then believable number slips. Answers to OTHER
 * cards are only used for numbers with the same unit — a word or formula borrowed from a different question can
 * be ruled out without knowing anything, which makes the question pointless. With fewer than two realistic wrong
 * options a card is practised another way (typed, or shown and self-graded) instead.
 */
export function pickDistractors(card: Card, pool: Card[], n = 3, rng: Rng = Math.random): string[] {
  const correct = normalizeAnswer(card.back);
  const seen = new Set([correct]);
  const out: string[] = [];
  const add = (x: string) => { const k = normalizeAnswer(x); if (x.trim() && !seen.has(k)) { seen.add(k); out.push(x); } };
  for (const d of card.distractors ?? []) if (out.length < n) add(d);
  if (answerShape(card.back) !== "number") return out;
  for (const d of numericNearMisses(card.back, rng)) if (out.length < n) add(d);
  if (out.length < n) {
    const u = unitOf(card.back);
    const same = pool.filter((c) => c.id !== card.id && answerShape(c.back) === "number" && unitOf(c.back) === u && (c.topic ?? "") === (card.topic ?? ""));
    for (const c of shuffle(same, rng)) { if (out.length >= n) break; add(c.back); }
  }
  return out;
}

// --- exercises --------------------------------------------------------------------------------------------------------
export type Exercise =
  | { kind: "mcq"; cardId: string; prompt: string; options: string[]; answer: number }
  | { kind: "typed"; cardId: string; prompt: string; answer: string; alts: string[]; hint?: string }
  | { kind: "cloze"; cardId: string; prompt: string; answer: string; alts: string[]; hint?: string }
  | { kind: "tf"; cardId: string; prompt: string; statement: string; truth: boolean; correct: string }
  | { kind: "match"; cardIds: string[]; pairs: { left: string; right: string }[] }
  | { kind: "order"; cardId: string; prompt: string; steps: string[] }
  | { kind: "flip"; cardId: string; front: string; back: string };

export const exerciseCards = (e: Exercise): string[] => (e.kind === "match" ? e.cardIds : [e.cardId]);

const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
/** Short, plain answers only: nothing that needs symbols a tablet keyboard lacks (², √, ∆, subscripts, LaTeX, "^"). */
export const isTypable = (s: string) => s.length > 0 && s.length <= 40 && wordCount(s) <= 6 && /^[\x20-\x7e]*$/.test(s) && !/[\\$_{}^]/.test(s);
const typable = (c: Card) => isTypable(c.back);

function exerciseFor(card: Card, pool: Card[], rng: Rng, forceKind?: Exercise["kind"]): Exercise {
  const crowns = crownOf(card);
  const flip: Exercise = { kind: "flip", cardId: card.id, front: card.front, back: card.back };
  if (card.kind === "steps" && (card.steps?.length ?? 0) >= 3) return { kind: "order", cardId: card.id, prompt: card.front, steps: card.steps! };
  const distractors = pickDistractors(card, pool, 3, rng);
  // three good options beat four with an obvious filler (item-writing research), so 3-option questions are fine
  const canMcq = distractors.length >= 2 && card.back.length <= 120;
  if (card.kind === "cloze") {
    if (typable(card)) return { kind: "cloze", cardId: card.id, prompt: card.front, answer: card.back, alts: [], hint: card.hint };
    // the blank can't be typed on a tablet → choose from options instead (or just reveal it)
    if (canMcq) { const options = shuffle([card.back, ...distractors], rng); return { kind: "mcq", cardId: card.id, prompt: card.front, options, answer: options.indexOf(card.back) }; }
    return flip;
  }
  // a false statement must be a believable mistake, never an answer to a different question
  const falseStatement = card.distractors?.[0] ?? (answerShape(card.back) === "number" ? numericNearMisses(card.back, rng)[0] : undefined);
  const canTf = !!falseStatement && card.back.length <= 120;
  const kinds: Exercise["kind"][] =
    crowns === 0 ? [canMcq ? "mcq" : "flip", canTf ? "tf" : "flip", "flip"]
    : crowns <= 2 ? [typable(card) ? "typed" : canMcq ? "mcq" : "flip", canMcq ? "mcq" : "flip", "flip"]
    : [typable(card) ? "typed" : "flip", "flip", canMcq ? "mcq" : "flip"];
  const kind = forceKind ?? kinds[Math.floor(rng() * 2)];
  if (kind === "mcq" && canMcq) {
    const options = shuffle([card.back, ...distractors], rng);
    return { kind: "mcq", cardId: card.id, prompt: card.front, options, answer: options.indexOf(card.back) };
  }
  if (kind === "typed" && typable(card)) return { kind: "typed", cardId: card.id, prompt: card.front, answer: card.back, alts: [], hint: card.hint };
  if (kind === "tf" && canTf) {
    const truth = rng() < 0.5;
    return { kind: "tf", cardId: card.id, prompt: card.front, statement: truth ? card.back : falseStatement!, truth, correct: card.back };
  }
  return flip;
}

export type LessonOpts = { size?: number; rng?: Rng; now?: number; topic?: string | null; dueOnly?: boolean; maxNew?: number };

/** Choose which cards to practise: overdue first, then a few new ones, then the weakest of the rest. */
export function selectCards(cards: Card[], o: LessonOpts = {}): Card[] {
  const now = o.now ?? Date.now(), size = o.size ?? 8, maxNew = o.maxNew ?? 4;
  let pool = cards.filter((c) => !c.suspended && (o.topic == null || c.topic === o.topic));
  const due = pool.filter((c) => isDue(c, now)).sort((a, b) => a.due - b.due);
  const fresh = pool.filter((c) => isNew(c));
  const rest = pool.filter((c) => !isDue(c, now) && !isNew(c)).sort((a, b) => mastery(a) - mastery(b));
  const picked: Card[] = [...due.slice(0, size)];
  if (!o.dueOnly) {
    picked.push(...fresh.slice(0, Math.min(maxNew, size - picked.length)));
    picked.push(...rest.slice(0, size - picked.length));
    if (picked.length < size) picked.push(...fresh.slice(maxNew, maxNew + size - picked.length));
  }
  return picked.slice(0, size);
}

/** A lesson: a mixed set of short exercises (Duolingo-style). Includes a matching round when there are enough cards. */
export function buildLesson(cards: Card[], o: LessonOpts = {}): Exercise[] {
  const rng = o.rng ?? Math.random;
  const chosen = selectCards(cards, o);
  if (!chosen.length) return [];
  const pool = cards.filter((c) => !c.suspended);
  const out: Exercise[] = [];
  let rest = chosen.slice();
  const basics = rest.filter((c) => c.kind === "basic" && c.back.length <= 60 && c.front.length <= 90);
  if (basics.length >= 5) {
    const m = shuffle(basics, rng).slice(0, 5);
    out.push({ kind: "match", cardIds: m.map((c) => c.id), pairs: m.map((c) => ({ left: c.front, right: c.back })) });
    // matched cards still get one individual exercise later, so keep them in `rest`
  }
  rest = shuffle(rest, rng);
  for (const c of rest) out.push(exerciseFor(c, pool, rng));
  // match round goes in the middle, not up front
  const mIdx = out.findIndex((e) => e.kind === "match");
  if (mIdx === 0 && out.length > 3) { const [m] = out.splice(0, 1); out.splice(Math.floor(out.length / 2), 0, m); }
  return out;
}

// --- running a lesson ------------------------------------------------------------------------------------------------
export type Outcome = { cardId: string; firstTry: boolean; grade?: Grade };

/** Grade for a card after a lesson: explicit self-grade wins; otherwise right-first-time = Good, else Again. */
export function gradeFor(o: Outcome[]): Grade {
  const flip = o.find((x) => x.grade !== undefined);
  if (flip) return flip.grade!;
  return o.every((x) => x.firstTry) ? 2 : 0;
}

export function applyOutcomes(cards: Card[], outcomes: Outcome[], now = Date.now()): Card[] {
  const by = new Map<string, Outcome[]>();
  for (const o of outcomes) by.set(o.cardId, [...(by.get(o.cardId) ?? []), o]);
  return cards.filter((c) => by.has(c.id)).map((c) => ({ ...c, ...schedule(c, gradeFor(by.get(c.id)!), now), updatedAt: now }));
}

// --- XP, streaks, daily goal ----------------------------------------------------------------------------------------
export type Progress = {
  xp: number;
  streak: number;
  best: number;
  lastDay: string | null;
  days: Record<string, number>; // YYYY-MM-DD -> XP earned
  goal: number;
  sound: boolean;
  hearts: boolean;
  /** Streak freezes held (max 2): a missed day uses one instead of breaking the streak. One is earned every 7 days of streak. */
  freezes: number;
  /** days covered by a freeze, for the "your streak was saved" note */
  frozen?: string[];
  /** what each study section is focused on (see Focus) */
  focus?: Partial<Record<FocusSection, Focus>>;
};
export const MAX_FREEZES = 2;
export const newProgress = (): Progress => ({ xp: 0, streak: 0, best: 0, lastDay: null, days: {}, goal: 30, sound: true, hearts: true, freezes: 1 });

export function dayKey(t: number): string {
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
const dayDiff = (a: string, b: string) => Math.round((new Date(b + "T12:00:00").getTime() - new Date(a + "T12:00:00").getTime()) / 86_400_000);

/** The streak as it should be DISPLAYED now (a missed day silently breaks it). */
export function currentStreak(p: Progress, now = Date.now()): number {
  if (!p.lastDay) return 0;
  const gap = dayDiff(p.lastDay, dayKey(now));
  if (gap <= 1) return p.streak;
  return gap - 1 <= (p.freezes ?? 0) ? p.streak : 0;   // missed days a freeze will cover don't break it
}

export function addXp(p: Progress, xp: number, now = Date.now()): Progress {
  const today = dayKey(now);
  let streak = p.streak;
  let freezes = p.freezes ?? 0;
  let frozen = p.frozen ?? [];
  if (p.lastDay !== today) {
    const gap = p.lastDay ? dayDiff(p.lastDay, today) : Infinity;
    const missed = gap - 1;
    if (gap === 1) streak = p.streak + 1;
    else if (p.lastDay && p.streak > 0 && missed <= freezes) {
      // Duolingo-style streak freeze: the missed days are covered, the streak carries on
      freezes -= missed;
      frozen = [...frozen, ...Array.from({ length: missed }, (_, i) => dayKey(now - (missed - i) * 86_400_000))].slice(-14);
      streak = p.streak + 1;
    } else streak = 1;
    if (streak > 0 && streak % 7 === 0 && freezes < MAX_FREEZES) freezes++;
  }
  const days = { ...p.days, [today]: (p.days[today] ?? 0) + xp };
  return { ...p, xp: p.xp + xp, streak, best: Math.max(p.best, streak), lastDay: today, days, freezes, frozen };
}

export type LessonStats = { total: number; correctFirstTry: number; maxCombo: number; heartsLeft?: number; completed: boolean };
export function lessonXp(s: LessonStats): number {
  const base = s.correctFirstTry * 5;
  const combo = Math.max(0, s.maxCombo - 2);
  const accuracy = s.total ? s.correctFirstTry / s.total : 0;
  const bonus = s.completed ? (accuracy >= 0.9 ? 10 : accuracy >= 0.7 ? 5 : 2) : 0;
  return base + combo + bonus;
}

export const xpToday = (p: Progress, now = Date.now()) => p.days[dayKey(now)] ?? 0;
export function lastDays(p: Progress, n = 7, now = Date.now()): { day: string; xp: number }[] {
  return Array.from({ length: n }, (_, i) => {
    const d = dayKey(now - (n - 1 - i) * 86_400_000);
    return { day: d, xp: p.days[d] ?? 0 };
  });
}

// --- topics ("skill path") ----------------------------------------------------------------------------------------------
export type TopicStat = { topic: string; cards: Card[]; due: number; fresh: number; mastery: number; crowns: number };
export function topicStats(cards: Card[], now = Date.now()): TopicStat[] {
  const order: string[] = [];
  const by = new Map<string, Card[]>();
  for (const c of cards.filter((x) => !x.suspended).sort((a, b) => a.createdAt - b.createdAt)) {
    const t = c.topic?.trim() || "General";
    if (!by.has(t)) { by.set(t, []); order.push(t); }
    by.get(t)!.push(c);
  }
  return order.map((topic) => {
    const cs = by.get(topic)!;
    const m = cs.reduce((s, c) => s + mastery(c), 0) / cs.length;
    return { topic, cards: cs, due: cs.filter((c) => isDue(c, now)).length, fresh: cs.filter(isNew).length, mastery: m, crowns: Math.round(m * 5) };
  });
}

export function makeCard(partial: Pick<Card, "front" | "back"> & Partial<Card>, now = Date.now()): Omit<Card, "id"> & { id?: string } {
  return {
    kind: "basic", notebookId: null, source: "manual", createdAt: now, updatedAt: now, ...newSrs(now), ...partial,
  };
}

/** Skip near-duplicates when adding generated cards. */
export function dedupeCards<T extends { front: string }>(incoming: T[], existing: { front: string }[]): T[] {
  const seen = new Set(existing.map((c) => normalizeAnswer(c.front)));
  return incoming.filter((c) => { const k = normalizeAnswer(c.front); if (!k || seen.has(k)) return false; seen.add(k); return true; });
}

// --- focus: what each study section is about ---------------------------------------------------------------------------
/**
 * Each section (Learn, Flashcards, Quizzes) has its own focus so they never mix: a notebook ("all", "none" = unfiled,
 * or an id), optionally a hand-picked list of topics (units), and topics ruled out as off-topic. An empty `topics`
 * means every topic in the notebook, so new units are included automatically unless skipped.
 */
export type Focus = { nb: string; topics: string[]; skip: string[] };
export type FocusSection = "learn" | "cards" | "quiz";
export const ALL_FOCUS: Focus = { nb: "all", topics: [], skip: [] };
export const topicOf = (c: Pick<Card, "topic">) => c.topic?.trim() || "General";

export function inNotebook(c: Card, nb: string): boolean {
  return nb === "all" || c.notebookId === (nb === "none" ? null : nb);
}
export function inFocus(c: Card, f: Focus): boolean {
  if (!inNotebook(c, f.nb)) return false;
  const t = topicOf(c);
  return (!f.topics.length || f.topics.includes(t)) && !f.skip.includes(t);
}
export const focusCards = (cards: Card[], f: Focus) => cards.filter((c) => inFocus(c, f));

/** Topics available in a notebook, in the order they were first studied (same order as the skill path). */
export function topicsIn(cards: Card[], nb: string): string[] {
  const seen: string[] = [];
  for (const c of cards.filter((x) => inNotebook(x, nb)).sort((a, b) => a.createdAt - b.createdAt)) { const t = topicOf(c); if (!seen.includes(t)) seen.push(t); }
  return seen;
}

/** "That's a different unit": take a topic out of the focus (a hand-picked list loses it; "all topics" skips it). */
export function dropTopic(f: Focus, topic: string): Focus {
  if (f.topics.length) return { ...f, topics: f.topics.filter((t) => t !== topic) };
  return { ...f, skip: f.skip.includes(topic) ? f.skip : [...f.skip, topic] };
}

/** Topics/skips that no longer exist (cards deleted, notebook changed) are dropped so a focus can't silently match nothing. */
export function cleanFocus(f: Focus | undefined, cards: Card[]): Focus {
  if (!f) return ALL_FOCUS;
  const have = new Set(topicsIn(cards, f.nb));
  return { nb: f.nb, topics: f.topics.filter((t) => have.has(t)), skip: f.skip.filter((t) => have.has(t)) };
}

export function describeFocus(f: Focus, nbName: (id: string) => string | undefined): string {
  const where = f.nb === "all" ? "All notebooks" : f.nb === "none" ? "Unfiled" : nbName(f.nb) ?? "Notebook";
  const what = f.topics.length ? (f.topics.length <= 3 ? f.topics.join(", ") : `${f.topics.length} topics`) : "all topics";
  return `${where} · ${what}${f.skip.length ? ` (skipping ${f.skip.length <= 2 ? f.skip.join(", ") : f.skip.length})` : ""}`;
}

/** Classic flashcards: flip and self-grade. Due cards first, then new ones, then the weakest; shuffled. */
export function buildFlashcards(cards: Card[], o: { size?: number; now?: number; rng?: Rng } = {}): Exercise[] {
  const chosen = selectCards(cards, { size: o.size ?? 20, now: o.now, maxNew: o.size ?? 20 });
  return shuffle(chosen, o.rng ?? Math.random).map((c): Exercise => ({ kind: "flip", cardId: c.id, front: c.front, back: c.kind === "steps" && c.steps ? c.steps.map((s, i) => `${i + 1}. ${s}`).join("\n") : c.back }));
}
