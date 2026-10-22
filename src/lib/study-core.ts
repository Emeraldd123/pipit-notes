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
    .replace(/\\(?:left|right|,|;|!|text|mathrm|cdot|times)/g, (m) => (m === "\\cdot" || m === "\\times" ? "*" : ""))
    .replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, "($1)/($2)")
    .replace(/[$\\{}]/g, "")
    .replace(/[;:!?'"`´’“”]+/g, " ")
    .replace(/[.,]+(?!\d)|(?<!\d)[.,]+/g, " ") // keep decimal points / thousands commas inside numbers
    .replace(/\s+/g, " ")
    .trim();
}
const squash = (s: string) => normalizeAnswer(s).replace(/[\s()*]/g, "");

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
export function pickDistractors(card: Card, pool: Card[], n = 3, rng: Rng = Math.random): string[] {
  const correct = normalizeAnswer(card.back);
  const seen = new Set([correct]);
  const cands = pool.filter((c) => c.id !== card.id && c.kind !== "steps" && c.back.trim()).filter((c) => {
    const k = normalizeAnswer(c.back);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const scored = cands.map((c) => ({
    c,
    s: (c.topic && c.topic === card.topic ? 0 : 1) + Math.abs(c.back.length - card.back.length) / Math.max(20, card.back.length) + rng() * 0.8,
  })).sort((a, b) => a.s - b.s);
  return scored.slice(0, n).map((x) => x.c.back);
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
const typable = (c: Card) => c.back.length <= 40 && wordCount(c.back) <= 6;

function exerciseFor(card: Card, pool: Card[], rng: Rng, forceKind?: Exercise["kind"]): Exercise {
  const crowns = crownOf(card);
  const flip: Exercise = { kind: "flip", cardId: card.id, front: card.front, back: card.back };
  if (card.kind === "steps" && (card.steps?.length ?? 0) >= 3) return { kind: "order", cardId: card.id, prompt: card.front, steps: card.steps! };
  if (card.kind === "cloze") return { kind: "cloze", cardId: card.id, prompt: card.front, answer: card.back, alts: [], hint: card.hint };
  const distractors = pickDistractors(card, pool, 3, rng);
  const canMcq = distractors.length >= 3 && card.back.length <= 120;
  const canTf = pool.filter((c) => c.id !== card.id && c.kind === "basic").length >= 1 && card.back.length <= 120;
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
    const other = distractors[0] ?? pool.find((c) => c.id !== card.id && c.kind === "basic")?.back;
    if (other) {
      const truth = rng() < 0.5;
      return { kind: "tf", cardId: card.id, prompt: card.front, statement: truth ? card.back : other, truth, correct: card.back };
    }
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
};
export const newProgress = (): Progress => ({ xp: 0, streak: 0, best: 0, lastDay: null, days: {}, goal: 50, sound: true, hearts: true });

export function dayKey(t: number): string {
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
const dayDiff = (a: string, b: string) => Math.round((new Date(b + "T12:00:00").getTime() - new Date(a + "T12:00:00").getTime()) / 86_400_000);

/** The streak as it should be DISPLAYED now (a missed day silently breaks it). */
export function currentStreak(p: Progress, now = Date.now()): number {
  if (!p.lastDay) return 0;
  return dayDiff(p.lastDay, dayKey(now)) <= 1 ? p.streak : 0;
}

export function addXp(p: Progress, xp: number, now = Date.now()): Progress {
  const today = dayKey(now);
  let streak = p.streak;
  if (p.lastDay !== today) {
    streak = p.lastDay && dayDiff(p.lastDay, today) === 1 ? p.streak + 1 : 1;
  }
  const days = { ...p.days, [today]: (p.days[today] ?? 0) + xp };
  return { ...p, xp: p.xp + xp, streak, best: Math.max(p.best, streak), lastDay: today, days };
}

export type LessonStats = { total: number; correctFirstTry: number; maxCombo: number; heartsLeft?: number; completed: boolean };
export function lessonXp(s: LessonStats): number {
  const base = s.correctFirstTry * 10;
  const combo = Math.max(0, s.maxCombo - 2) * 2;
  const accuracy = s.total ? s.correctFirstTry / s.total : 0;
  const bonus = s.completed ? (accuracy >= 0.9 ? 15 : accuracy >= 0.7 ? 8 : 3) : 0;
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
