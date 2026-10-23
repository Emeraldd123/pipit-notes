// Exam model: validation of AI-generated papers, deterministic marking of objective parts,
// and result aggregation. Pure + unit-tested.
import { normalizeFigure, type Figure } from "./figure-core.ts";
import { parseNumber } from "./study-core.ts";

export type PartType = "mcq" | "numeric" | "short" | "working" | "tf";
export type Part = {
  id: string;
  label: string;                    // "a", "b"… ("" for single-part questions)
  prompt: string;
  type: PartType;
  marks: number;
  options?: string[];               // mcq
  /** mcq: why each option is right / which mistake leads to it (same order as options) */
  why?: string[];
  correct?: number;                 // mcq: index; tf: 0 = true, 1 = false
  answer: string;                   // model answer (shown after marking)
  numeric?: { value: number; tol: number; unit?: string };
  scheme: string[];                 // marking points
  figure?: Figure;                  // a part can have its own figure
};
export type Question = { id: string; topic?: string; stem: string; figure?: Figure; parts: Part[]; marks: number; basis?: Basis };
/**
 * Where a question came from. Notes-only questions have no textbook. A textbook question carries the
 * note excerpts the student needs to solve it; "stretch" = it may go a little beyond the notes.
 */
export type Basis = { notes: number[]; textbook?: number; stretch?: boolean; source?: string };
export type Section = { title: string; instructions?: string; questions: Question[] };
export type Exam = {
  id: string; title: string; subject?: string; durationMin: number; instructions?: string;
  sections: Section[]; totalMarks: number; createdAt: number;
  /** questions the student reported as broken (question id -> reason); they don't count toward the score */
  reported?: Record<string, ReportReason>;
};

export type ReportReason = "unanswerable" | "figure" | "wrong-answer" | "not-covered" | "other";
export const REPORT_REASONS: { id: ReportReason; label: string }[] = [
  { id: "unanswerable", label: "Can't be answered / information missing" },
  { id: "figure", label: "The graph, table or diagram doesn't match" },
  { id: "wrong-answer", label: "The answer or marking is wrong" },
  { id: "not-covered", label: "Not in my notes / not my course" },
  { id: "other", label: "Something else" },
];

/** Mark a question as reported (or clear it with reason = null). Returns a new exam. */
export function reportQuestion(exam: Exam, questionId: string, reason: ReportReason | null): Exam {
  const reported = { ...(exam.reported ?? {}) };
  if (reason) reported[questionId] = reason; else delete reported[questionId];
  return { ...exam, reported };
}

const s = (v: unknown, max = 1500): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const marks = (v: unknown, dflt = 1) => (isNum(v) ? Math.max(1, Math.min(20, Math.round(v))) : dflt);

function normalizePart(raw: unknown, i: number, qid: string, single: boolean): Part | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const prompt = s(r.prompt) || s(r.question);
  if (!prompt && !single) return null;               // a lettered part needs its own wording
  let type = (["mcq", "numeric", "short", "working", "tf"] as const).find((t) => t === r.type) ?? "short";
  let options: string[] | undefined;
  let correct: number | undefined;
  let numeric: Part["numeric"];
  if (type === "mcq") {
    options = Array.isArray(r.options) ? (r.options as unknown[]).map((o) => s(o, 300)).filter(Boolean).slice(0, 6) : [];
    correct = isNum(r.correct) ? Math.round(r.correct) : -1;
    if (options.length < 2 || correct < 0 || correct >= options.length || new Set(options.map((o) => o.toLowerCase())).size !== options.length) { type = "short"; options = undefined; correct = undefined; }
  } else if (type === "tf") {
    correct = r.correct === true || r.correct === 0 || r.correct === "true" ? 0 : r.correct === false || r.correct === 1 || r.correct === "false" ? 1 : -1;
    if (correct < 0) { type = "short"; correct = undefined; }
  } else if (type === "numeric") {
    const nv = r.numeric as Record<string, unknown> | undefined;
    const value = isNum(nv?.value) ? nv!.value : parseNumber(s(nv?.value ?? r.answer, 60));
    if (value === null || value === undefined || !Number.isFinite(value)) type = "short";
    else numeric = { value, tol: isNum(nv?.tol) && nv!.tol > 0 && nv!.tol < 0.5 ? nv!.tol : 0.02, unit: s(nv?.unit, 20) || undefined };
  }
  const figure = !single && r.figure ? normalizeFigure(r.figure) ?? undefined : undefined;   // a single-part question keeps its figure on the question
  const scheme = (Array.isArray(r.scheme) ? (r.scheme as unknown[]) : []).map((x) => s(x, 300)).filter(Boolean).slice(0, 8);
  return {
    id: `${qid}.${i}`, label: single ? "" : s(r.label, 4) || String.fromCharCode(97 + i), prompt: prompt || (single ? "" : "Answer the question above."),
    type, marks: marks(r.marks, type === "working" ? 3 : 1), options, correct,
    answer: s(r.answer, 1200) || (options && correct !== undefined && type === "mcq" ? options[correct] : ""),
    numeric, scheme, figure,
    why: type === "mcq" && Array.isArray(r.why) && (r.why as unknown[]).length === options!.length ? (r.why as unknown[]).map((w) => s(w, 300)) : undefined,
  };
}

/** Deterministic shuffle seed from a string (so the same exam always shows the same order). */
function seedOf(id: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619) >>> 0;
  return () => { h = (h + 0x6d2b79f5) >>> 0; let t = h; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
/**
 * Re-order multiple-choice options locally. Models place the right answer in biased positions (rarely last),
 * which an alert student can exploit; the reasons travel with their options. "All/none of the above" stays last.
 */
export function shuffleOptions(p: Part, seed: string): Part {
  if (p.type !== "mcq" || !p.options || p.correct === undefined) return p;
  const rng = seedOf(seed);
  const idx = p.options.map((_, i) => i);
  const pinned = idx.filter((i) => /\b(all|none|both) of (the )?(above|these)\b/i.test(p.options![i]));
  const free = idx.filter((i) => !pinned.includes(i));
  for (let i = free.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [free[i], free[j]] = [free[j], free[i]]; }
  const order = [...free, ...pinned];
  return { ...p, options: order.map((i) => p.options![i]), why: p.why ? order.map((i) => p.why![i]) : undefined, correct: order.indexOf(p.correct) };
}

export type McqLint = "correct-longest" | "absolute-only-in-wrong" | "all-of-the-above" | "duplicate";
/** Cues that let a student pick the answer without knowing the material (classic item-writing flaws). */
export function lintMcq(p: Part): McqLint[] {
  if (p.type !== "mcq" || !p.options || p.correct === undefined) return [];
  const out: McqLint[] = [];
  const o = p.options, c = p.correct;
  const others = o.filter((_, i) => i !== c);
  if (others.length && o[c].length > 1.5 * Math.max(...others.map((x) => x.length)) && o[c].length > 25) out.push("correct-longest");
  const abs = /\b(always|never|only|all|none|every|must)\b/i;
  if (!abs.test(o[c]) && others.filter((x) => abs.test(x)).length >= 2) out.push("absolute-only-in-wrong");
  if (o.some((x) => /\b(all|none) of the above\b/i.test(x))) out.push("all-of-the-above");
  if (new Set(o.map((x) => x.trim().toLowerCase())).size !== o.length) out.push("duplicate");
  return out;
}

/** {"notes":[2,5],"textbook":"T3","solvable":"yes|stretch|no"} → Basis; null = unsolvable (drop); undefined = none given. */
function normalizeBasis(v: unknown): Basis | null | undefined {
  if (!v || typeof v !== "object") return undefined;
  const r = v as Record<string, unknown>;
  if (r.solvable === "no" || r.solvable === false) return null;
  const notes = (Array.isArray(r.notes) ? r.notes : []).map((n) => (typeof n === "string" ? parseInt(n.replace(/\D/g, ""), 10) : n)).filter((n): n is number => isNum(n) && n > 0).slice(0, 8);
  const t = typeof r.textbook === "string" ? parseInt(r.textbook.replace(/\D/g, ""), 10) : r.textbook;
  return { notes, textbook: isNum(t) && t > 0 ? t : undefined, stretch: r.solvable === "stretch" || undefined };
}

export function normalizeExam(raw: unknown, now = Date.now(), id = `exam-${now}`): Exam | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const sections: Section[] = [];
  let qn = 0;
  for (const rs of Array.isArray(r.sections) ? (r.sections as Record<string, unknown>[]) : []) {
    const questions: Question[] = [];
    for (const rq of Array.isArray(rs?.questions) ? (rs.questions as Record<string, unknown>[]) : []) {
      const basis = normalizeBasis(rq?.basis);
      if (basis === null) continue;                    // the writer itself judged it unsolvable from the notes
      const stem = s(rq?.stem) || s(rq?.question);
      const rawParts = Array.isArray(rq?.parts) && (rq.parts as unknown[]).length ? (rq.parts as unknown[]) : [rq];
      if (!stem && !rawParts.some((p) => p && typeof p === "object" && (s((p as Record<string, unknown>).prompt) || s((p as Record<string, unknown>).question)))) continue;
      const qid = `q${++qn}`;
      const single = rawParts.length === 1;
      const parts = rawParts.map((p, i) => normalizePart(p, i, qid, single)).filter((p): p is Part => !!p).map((p) => shuffleOptions(p, `${id}:${p.id}`));
      if (!parts.length || (!stem && !parts[0].prompt)) { qn--; continue; }
      // a lone part's figure is lifted to the question so it is shown once, above the answer box
      const lone = single && rawParts[0] !== rq ? (rawParts[0] as Record<string, unknown> | null)?.figure : undefined;
      const figure: Figure | undefined = (rq?.figure ? normalizeFigure(rq.figure) : null) ?? (lone ? normalizeFigure(lone) : null) ?? undefined;
      questions.push({ id: qid, topic: s(rq?.topic, 40) || undefined, stem: stem || parts[0].prompt, figure, parts, marks: parts.reduce((a, p) => a + p.marks, 0), basis });
      if (single && stem && parts[0].prompt === stem) parts[0].prompt = "";
    }
    if (questions.length) sections.push({ title: s(rs?.title, 60) || `Section ${String.fromCharCode(65 + sections.length)}`, instructions: s(rs?.instructions, 300) || undefined, questions });
  }
  if (!sections.length) return null;
  const totalMarks = sections.reduce((a, sec) => a + sec.questions.reduce((b, q) => b + q.marks, 0), 0);
  const dur = isNum(r.durationMin) ? Math.round(r.durationMin) : Math.ceil(totalMarks * 1.3);
  return {
    id, title: s(r.title, 80) || "Practice exam", subject: s(r.subject, 60) || undefined, instructions: s(r.instructions, 400) || undefined,
    durationMin: Math.max(10, Math.min(240, dur)), sections, totalMarks, createdAt: now,
  };
}

export const allParts = (e: Exam): { q: Question; p: Part; section: Section }[] =>
  e.sections.flatMap((sec) => sec.questions.flatMap((q) => q.parts.map((p) => ({ q, p, section: sec }))));

// --- answers & marking ---------------------------------------------------------------------------------------------------
export type PartAnswer = { text?: string; choice?: number; ink?: string };
export type PartMark = { partId: string; marks: number; max: number; feedback: string; auto: boolean; missed?: string[] };

/** The first number in a free-text answer ("9.8 m/s²", "≈ 12.5 J", "3 x 10^2"). */
export function extractNumber(text: string): number | null {
  const t = text.replace(/[−–]/g, "-").replace(/,(?=\d{3}\b)/g, "");
  const sci = /(-?\d*\.?\d+)\s*(?:x|×|\*)\s*10\s*\^?\s*\{?(-?\d+)\}?/i.exec(t);
  if (sci) return Number(sci[1]) * Math.pow(10, Number(sci[2]));
  const m = /(-?\d*\.?\d+(?:e-?\d+)?)/i.exec(t);
  if (m && /\d/.test(m[1])) {
    const frac = /(-?\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/.exec(t);
    if (frac && Number(frac[2]) !== 0) return Number(frac[1]) / Number(frac[2]);
    return Number(m[1]);
  }
  return null;
}

/** Deterministic marking for multiple-choice, true/false and numeric parts. Null = needs AI. */
export function markObjective(p: Part, a: PartAnswer | undefined): PartMark | null {
  if (p.type === "mcq" || p.type === "tf") {
    const right = a?.choice === p.correct;
    const label = p.type === "tf" ? (p.correct === 0 ? "True" : "False") : p.options?.[p.correct ?? 0] ?? p.answer;
    // say WHY the chosen option is wrong (the mistake it represents), not just what the answer is
    const why = a?.choice !== undefined && p.type === "mcq" ? p.why?.[a.choice] : undefined;
    return { partId: p.id, marks: right ? p.marks : 0, max: p.marks, auto: true, feedback: a?.choice === undefined ? `No answer. Correct: ${label}` : right ? "Correct." : `Not quite — the answer is ${label}.${why ? ` Your choice: ${why}` : ""}` };
  }
  if (p.type === "numeric" && p.numeric) {
    const got = a?.text ? extractNumber(a.text) : null;
    if (got === null) return { partId: p.id, marks: 0, max: p.marks, auto: true, feedback: `No numeric answer given. Expected ${p.answer || p.numeric.value}${p.numeric.unit ? " " + p.numeric.unit : ""}.` };
    const { value, tol } = p.numeric;
    const ok = Math.abs(got - value) <= Math.max(1e-9, Math.abs(value) * tol);
    const sign = !ok && Math.abs(Math.abs(got) - Math.abs(value)) <= Math.abs(value) * tol;
    const unitHint = p.numeric.unit && a?.text && !a.text.toLowerCase().includes(p.numeric.unit.toLowerCase().replace(/[^a-z]/g, "").slice(0, 3)) ? ` (remember the unit: ${p.numeric.unit})` : "";
    return {
      partId: p.id, marks: ok ? p.marks : 0, max: p.marks, auto: true,
      feedback: ok ? `Correct${unitHint}.` : sign ? `Right size, wrong sign — expected ${value}.` : `Expected ${p.answer || value}${p.numeric.unit ? " " + p.numeric.unit : ""}; you gave ${got}.`,
    };
  }
  return null;
}

/** Parts that need a person (or the AI) to mark: free text and working. */
export const needsAi = (p: Part) => markObjective(p, undefined) === null;

export const clampMark = (m: number, max: number) => Math.max(0, Math.min(max, Math.round(m)));

// --- results -------------------------------------------------------------------------------------------------------------------
export type TopicResult = { topic: string; got: number; max: number };
export type ExamResult = {
  marks: PartMark[]; got: number; max: number; percent: number; band: string;
  byTopic: TopicResult[]; bySection: { title: string; got: number; max: number }[];
  /** reported questions left out of the score */
  excluded: string[];
};
export function band(percent: number): string {
  return percent >= 90 ? "A*" : percent >= 80 ? "A" : percent >= 70 ? "B" : percent >= 60 ? "C" : percent >= 50 ? "D" : percent >= 40 ? "E" : "U";
}
export function buildResult(exam: Exam, marksIn: PartMark[]): ExamResult {
  const by = new Map(marksIn.map((m) => [m.partId, m]));
  const marksOut: PartMark[] = [];
  const topics = new Map<string, TopicResult>();
  const secs: { title: string; got: number; max: number }[] = exam.sections.map((x) => ({ title: x.title, got: 0, max: 0 }));
  let got = 0, max = 0;
  const excluded = Object.keys(exam.reported ?? {});
  exam.sections.forEach((sec, si) => sec.questions.forEach((q) => q.parts.forEach((p) => {
    const m = by.get(p.id) ?? { partId: p.id, marks: 0, max: p.marks, auto: false, feedback: "Not marked." };
    const g = clampMark(m.marks, p.marks);
    marksOut.push({ ...m, marks: g, max: p.marks });
    if (exam.reported?.[q.id]) return;   // a broken question shouldn't cost (or earn) marks
    got += g; max += p.marks;
    secs[si].got += g; secs[si].max += p.marks;
    const t = q.topic ?? "General";
    const cur = topics.get(t) ?? { topic: t, got: 0, max: 0 };
    cur.got += g; cur.max += p.marks;
    topics.set(t, cur);
  })));
  const percent = max ? Math.round((got / max) * 100) : 0;
  return { marks: marksOut, got, max, percent, band: band(percent), byTopic: [...topics.values()].filter((t) => t.max > 0), bySection: secs, excluded };
}
