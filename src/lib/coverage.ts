// Textbooks as a question bank, kept honest: only textbook pages that match what the student's notes
// cover are offered to the exam writer, and every textbook-based question must be solvable from the
// notes — the model names the note excerpts it relies on, and a local vocabulary check backs that up.
// Pure + unit-tested (no AI, no DB).
import { tokens } from "./related.ts";
import type { Exam, Question } from "./exam-core.ts";

export type Page = { n: number; noteTitle: string; page: number; text: string; noteId?: string };

const tf = (s: string) => {
  const m = new Map<string, number>();
  for (const t of tokens(s)) m.set(t, (m.get(t) ?? 0) + 1);
  return m;
};

/**
 * The textbook pages closest to the student's notes (TF-IDF cosine against all the notes together),
 * best first, within a character budget. Pages that barely overlap the notes are never offered:
 * they would only produce questions the student can't answer from what they've learned.
 */
export function pickTextbookPages(notes: string[], pages: Page[], maxChars = 12000, min = 0.06): Page[] {
  if (!notes.length || !pages.length) return [];
  const docs = [tf(notes.join(" ")), ...pages.map((p) => tf(p.text))];
  const df = new Map<string, number>();
  for (const d of docs) for (const t of d.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  const vec = (d: Map<string, number>) => {
    const v = new Map<string, number>();
    for (const [t, c] of d) v.set(t, (1 + Math.log(c)) * (Math.log((1 + docs.length) / (1 + df.get(t)!)) + 1));
    return v;
  };
  const len = (v: Map<string, number>) => Math.sqrt([...v.values()].reduce((a, b) => a + b * b, 0)) || 1;
  const nv = vec(docs[0]), nn = len(nv);
  const scored = pages.map((p, i) => {
    const v = vec(docs[i + 1]);
    let dot = 0;
    for (const [t, w] of v) dot += w * (nv.get(t) ?? 0);
    return { p, sim: dot / (len(v) * nn) };
  }).filter((x) => x.sim >= min && x.p.text.trim().length > 80).sort((a, b) => b.sim - a.sim);
  const out: Page[] = [];
  let used = 0;
  for (const { p } of scored) {
    if (used + p.text.length > maxChars) continue;
    used += p.text.length;
    out.push(p);
  }
  return out;
}

// Where a textbook problem or worked example starts: "Example 5.3", "Problem 12", "Exercise 4-2", "Sample Problem", or a numbered line "12. …"
const PROBLEM_START = /(?:^|\n|(?<=[.?!:]\s))(?=(?:(?:Sample\s+|Practice\s+)?(?:Example|Problem|Exercise|Question|Practice|Check\s*Point)s?\s*\d+(?:[.\-–]\d+)*\b|\d{1,3}[.)]\s+[A-Z]))/;

/**
 * Cut textbook pages into self-contained problem-sized pieces, on the device and for free, so the AI is
 * sent individual problems and worked examples instead of whole pages. Pages with no recognisable
 * problems become paragraph-sized windows. Every piece is at most `max` characters.
 */
export function textbookChunks(pages: Page[], max = 900): Page[] {
  const out: Page[] = [];
  for (const p of pages) {
    const parts = p.text.split(PROBLEM_START).map((x) => x.trim()).filter((x) => x.length > 60);
    const pieces = parts.length > 1 ? parts : (p.text.match(new RegExp(`[\\s\\S]{1,${max}}(?=\\s|$)`, "g")) ?? []).map((x) => x.trim());
    for (const t of pieces) if (t.length > 60) out.push({ ...p, text: t.length > max ? t.slice(0, max).replace(/\s\S*$/, "") + " …" : t });
  }
  return out.map((p, i) => ({ ...p, n: i + 1 }));
}

/** Share (0–1) of a question's distinct content words that appear somewhere in the student's notes. */
export function noteCoverage(q: Question, notes: string[]): number {
  const vocab = new Set(tokens(notes.join(" ")));
  const words = new Set(tokens([q.stem, ...q.parts.map((p) => `${p.prompt} ${p.answer}`)].join(" ")));
  if (!words.size) return 1;
  let hit = 0;
  for (const w of words) if ([w, w.replace(/s$/, ""), w.replace(/es$/, ""), w + "s", w + "es"].some((x) => vocab.has(x))) hit++;
  return hit / words.size;
}

export type SolvableCheck = { exam: Exam; dropped: number; stretch: number; fromTextbook: number };

/**
 * Enforce "the student could solve this from their notes" on textbook-based questions:
 *  - the model must cite at least one real note excerpt it relies on, and must not have judged it unsolvable
 *    (those are dropped — normalizeExam already removes "solvable":"no");
 *  - if too little of the question's vocabulary appears in the notes, it stays but is labelled a stretch.
 * Questions written straight from the notes are left alone.
 */
export function checkSolvable(exam: Exam, notes: { n: number; text: string }[], textbook: Page[], minCoverage = 0.55): SolvableCheck {
  const noteNums = new Set(notes.map((e) => e.n));
  const noteTexts = notes.map((e) => e.text);
  let dropped = 0, stretch = 0, fromTextbook = 0;
  const sections = exam.sections.map((sec) => ({
    ...sec,
    questions: sec.questions.flatMap((q): Question[] => {
      const b = q.basis;
      if (!b || b.textbook === undefined) return [q];
      const page = textbook[b.textbook - 1];
      const cited = b.notes.filter((n) => noteNums.has(n));
      if (!page || !cited.length) { dropped++; return []; }
      fromTextbook++;
      const weak = b.stretch || noteCoverage(q, noteTexts) < minCoverage;
      if (weak) stretch++;
      return [{ ...q, basis: { ...b, notes: cited, stretch: weak || undefined, source: `${page.noteTitle}, p. ${page.page + 1}` } }];
    }),
  })).filter((sec) => sec.questions.length);
  const totalMarks = sections.reduce((a, sec) => a + sec.questions.reduce((m, q) => m + q.marks, 0), 0);
  return { exam: { ...exam, sections, totalMarks }, dropped, stretch, fromTextbook };
}
