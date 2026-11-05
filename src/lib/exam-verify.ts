// A second examiner checks a written paper before you see it: it works every part from the stem and figure alone and
// compares its result with the model answer, the marking scheme and the keyed option. Small mistakes are FIXED
// (a wrong answer, key, scheme line or one value in a prompt); broken parts are DROPPED. Most of what the strict judge
// marks down is of this kind (answers that don't follow from the data, figures that don't show what the question
// says), and it is far easier to catch after writing than to prevent with more instructions. Pure: unit-tested.
import type { Exam, Part, Question } from "./exam-core.ts";
import type { Excerpt } from "./ai.ts";

export const VERIFY_SYSTEM = `You are the second examiner checking an exam paper before it is printed. For EVERY part, work it out yourself using only the question stem, its figure and the student's notes, then compare your result with the model answer, the marking scheme and, for multiple choice, the keyed option (marked *).
Figures are given as JSON and are drawn exactly from it: a graph shows precisely the curves "expr" (functions of x) over the given ranges; a chart shows exactly its values; a table exactly its cells. Read values from the JSON, not from what the question claims the figure shows.
Check each part:
- the model answer follows from the given data (arithmetic, units, rounding, values read from the figure);
- the figure actually shows what the question says (labels, values, which curve, axes);
- every value the answer needs is given in the stem, the part or the figure;
- multiple choice: exactly one option is right, and it is the keyed one;
- the marking scheme matches the answer;
- it can be answered from what the notes teach (applying a principle to a described new situation is fine).
Report only parts with a real problem. For each one:
- "fix" when a small correction makes it right: give ONLY the fields that change, among "prompt" (e.g. one corrected value), "answer", "scheme", "correct" (option index from 0, in the order shown), "options" (same number of options), "numeric" ({"value":…,"tol":…,"unit":"…"});
- "drop" when it can't be repaired with a small change (wrong figure, contradictory data, two defensible answers, needs knowledge not given).
Be strict but fair: an answer that is right but phrased differently is fine; don't rewrite parts that are correct. Use LaTeX in $…$ like the paper does, with every backslash doubled in JSON.
Return STRICT JSON only: {"checks":[{"q":"q3","part":"b","verdict":"fix","problem":"one sentence","fix":{"answer":"…","scheme":["…"]}}]}  ({"checks":[]} if every part is right).`;

const partKey = (p: Part) => p.label || "-";

/** The paper as the second examiner sees it: notes, then every question with its figure, parts, key and scheme. */
export function verifyUserText(exam: Exam, excerpts: Excerpt[]): string {
  const fig = (f: unknown) => (f ? `\n   FIGURE: ${JSON.stringify(f).slice(0, 2500)}` : "");
  const qs = exam.sections.flatMap((s) => s.questions).map((q) => [
    `${q.id}: ${q.stem}${fig(q.figure)}`,
    ...q.parts.map((p) => `  (${partKey(p)}) [${p.type}, ${p.marks} marks] ${p.prompt}${fig(p.figure)}` +
      (p.options ? `\n   options: ${p.options.map((o, i) => `${i === p.correct ? "*" : ""}[${i}] ${o}`).join(" | ")}` : "") +
      `\n   model answer: ${p.answer}${p.numeric ? ` (numeric ${p.numeric.value}${p.numeric.unit ? ` ${p.numeric.unit}` : ""} ±${Math.round(p.numeric.tol * 100)}%)` : ""}` +
      (p.scheme.length ? `\n   scheme: ${p.scheme.join(" / ")}` : "")),
  ].join("\n"));
  return `Student's notes:\n\n${excerpts.map((e) => `[${e.n}] ${e.text}`).join("\n\n")}\n\nPaper to check:\n\n${qs.join("\n\n")}`;
}

export type Check = { q: string; part: string; verdict: "fix" | "drop"; problem: string; fix?: Partial<Pick<Part, "prompt" | "answer" | "scheme" | "correct" | "options" | "numeric">> };
export type VerifyResult = { exam: Exam; fixed: number; dropped: number; checks: Check[] };

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

export function normalizeChecks(raw: unknown): Check[] {
  const list = Array.isArray((raw as { checks?: unknown })?.checks) ? (raw as { checks: unknown[] }).checks : [];
  return list.flatMap((c): Check[] => {
    const o = (c ?? {}) as Record<string, unknown>;
    // forgiving about wording: "Fix", "fixed", "correct", "remove"… and "q3(b)", "3b", "Question 3" all happen
    const v = str(o.verdict).toLowerCase();
    const verdict = /^(drop|remove|delete|discard|cut)/.test(v) ? "drop" : /^(fix|correct|amend|repair|change|edit)/.test(v) ? "fix" : null;
    const qm = /(\d+)\s*\(?([a-z]{1,2}|[ivx]+)?\)?/i.exec(str(o.q) || str(o.question));
    if (!verdict || !qm) return [];
    const part = (str(o.part).replace(/[()\s]/g, "").replace(/^q?\d+/i, "") || qm[2] || "-").toLowerCase();
    return [{ q: `q${qm[1]}`, part, verdict, problem: str(o.problem) || str(o.reason), fix: o.fix && typeof o.fix === "object" ? (o.fix as Check["fix"]) : undefined }];
  });
}

function applyFix(p: Part, fix: NonNullable<Check["fix"]>): Part | null {
  const next: Part = { ...p };
  if (str(fix.prompt)) next.prompt = str(fix.prompt);
  if (str(fix.answer)) next.answer = str(fix.answer);
  if (Array.isArray(fix.scheme) && fix.scheme.every((s) => typeof s === "string") && fix.scheme.length) next.scheme = fix.scheme.map((s) => s.trim()).filter(Boolean);
  if (Array.isArray(fix.options) && p.options && fix.options.length === p.options.length && fix.options.every((s) => typeof s === "string")) {
    next.options = fix.options.map((s) => s.trim());
    next.why = undefined;   // the reasons belonged to the old options
  }
  if (typeof fix.correct === "number" && next.options) {
    if (!Number.isInteger(fix.correct) || fix.correct < 0 || fix.correct >= next.options.length) return null;
    if (fix.correct !== p.correct) next.why = undefined;
    next.correct = fix.correct;
  }
  const n = fix.numeric as Part["numeric"] | undefined;
  if (n && typeof n.value === "number" && Number.isFinite(n.value)) next.numeric = { value: n.value, tol: typeof n.tol === "number" && n.tol > 0 && n.tol < 1 ? n.tol : p.numeric?.tol ?? 0.02, unit: typeof n.unit === "string" ? n.unit : p.numeric?.unit };
  return next;
}

/** The check for one part. A one-part question has no label, so any check on that question is about its only part. */
export function findCheck(checks: Check[], q: Question, key: string): Check | undefined {
  const mine = checks.filter((c) => c.q.toLowerCase() === q.id.toLowerCase());
  return q.parts.length === 1 ? mine[0] : mine.find((c) => c.part.replace(/[()\s]/g, "").toLowerCase() === key.toLowerCase());
}

/** Apply the second examiner's checks: fix what it fixed, drop what it dropped, tidy empty questions and sections. */
export function applyChecks(exam: Exam, checks: Check[]): VerifyResult {
  let fixed = 0, dropped = 0;
  const find = (q: Question, key: string) => findCheck(checks, q, key);
  const sections = exam.sections.map((s) => ({
    ...s,
    questions: s.questions.map((q): Question | null => {
      const parts = q.parts.flatMap((p): Part[] => {
        const c = find(q, partKey(p));
        if (!c) return [p];
        if (c.verdict === "drop" || !c.fix) { dropped++; return []; }
        const next = applyFix(p, c.fix);
        if (!next) { dropped++; return []; }
        fixed++;
        return [next];
      });
      return parts.length ? { ...q, parts, marks: parts.reduce((a, p) => a + p.marks, 0) } : null;
    }).filter((q): q is Question => !!q),
  })).filter((s) => s.questions.length);
  const totalMarks = sections.reduce((a, s) => a + s.questions.reduce((b, q) => b + q.marks, 0), 0);
  return { exam: { ...exam, sections, totalMarks }, fixed, dropped, checks };
}
