// Case memory: what real-world situations recent exams used, so the next exam on the same notes uses different
// ones. Without it every exam is written from scratch and the writer keeps returning to its favourite examples (in
// testing: a car battery in 9 of 10 physics papers, yeast in 9 of 10 biology papers). The writer tags each
// question's scenario; the app keeps the recent ones per scope and tells the writer to avoid them; a local check
// counts any that slip through. Pure: unit-tested.
import type { Exam } from "./exam-core.ts";
import { tokens } from "./related.ts";

export type CaseRec = { scenario: string; at: number };
export const CASE_MEMORY = 60;   // scenarios kept per scope
export const AVOID_LIST = 40;    // the most recent ones passed to the writer

export const caseKey = (scope: string) => `exam:cases:${scope}`;

/** The scenario of every question in an exam that has one. */
export function scenariosOf(exam: Exam): string[] {
  return exam.sections.flatMap((s) => s.questions).map((q) => q.basis?.scenario?.trim() ?? "").filter(Boolean);
}

/** Add an exam's scenarios to the memory (newest first, no duplicates, capped). */
export function remember(prev: CaseRec[], exam: Exam, now = Date.now()): CaseRec[] {
  const fresh = scenariosOf(exam).map((scenario) => ({ scenario, at: now }));
  const seen = new Set<string>();
  return [...fresh, ...prev].filter((c) => { const k = c.scenario.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, CASE_MEMORY);
}

export const avoidList = (mem: CaseRec[]) => mem.slice(0, AVOID_LIST).map((c) => c.scenario);

const words = (s: string) => new Set(tokens(s));
function overlap(a: Set<string>, b: Set<string>) {
  if (!a.size || !b.size) return 0;
  let n = 0;
  for (const w of a) if (b.has(w)) n++;
  return n / Math.min(a.size, b.size);   // "car battery" vs "a car battery running a headlight" = the same case
}

/** Scenarios in this exam that repeat one in memory (most of the smaller label's words are shared). */
export function repeats(exam: Exam, mem: CaseRec[], threshold = 0.6): { scenario: string; earlier: string }[] {
  const prior = mem.map((c) => ({ c, w: words(c.scenario) }));
  return scenariosOf(exam).flatMap((s) => {
    const w = words(s);
    const hit = prior.find((p) => overlap(w, p.w) >= threshold);
    return hit ? [{ scenario: s, earlier: hit.c.scenario }] : [];
  });
}
