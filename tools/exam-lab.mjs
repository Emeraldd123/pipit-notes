// Shared by tools/exam-eval.mjs and tools/exam-tune.mjs: API calls with a spending cap, writing an exam with EXACTLY
// the app's prompt and validation, and the strict judge. The key comes from the environment and is only sent to
// api.anthropic.com.
import { costUsd, effortFor, maxTokensFor, priceFor } from "../src/lib/ai-cost.ts";
import { parseModelJson } from "../src/lib/json-repair.ts";
import { buildExamPrompt, EXAM_MAX_TOKENS } from "../src/lib/exam-prompt.ts";
import { normalizeExam, lintMcq, allParts } from "../src/lib/exam-core.ts";
import { checkSolvable } from "../src/lib/coverage.ts";

export class BudgetError extends Error {}

/**
 * An API client that never spends past `budget` dollars: before each call it adds the WORST case (all input at
 * ~3 characters per token, the full output allowance) to what has been spent, and refuses the call if that could
 * go over. Spending is then counted from the real token usage the API reports.
 */
export function makeApi({ key, model, budget = Infinity, log = () => {}, fetchImpl = fetch }) {
  const ledger = { spent: 0, calls: 0, reserved: 0 };
  const worstCase = (m, system, content, maxTokens, effort) => {
    const chars = system.length + content.reduce((n, c) => n + (c.text?.length ?? 0), 0);
    const [pin, pout] = priceFor(m);
    return (Math.ceil(chars / 3) * pin + maxTokensFor(maxTokens, effort) * pout) / 1e6;
  };
  async function once(m, system, content, maxTokens, effort) {
    const user = content.map((c) => (c.type === "text" ? { type: "text", text: c.text } : null)).filter(Boolean);
    const res = await fetchImpl("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: m, max_tokens: maxTokensFor(maxTokens, effort), ...(effort ? { output_config: { effort } } : {}), system, messages: [{ role: "user", content: user }] }),
    });
    const data = await res.json();
    if (data?.usage) { ledger.spent += costUsd(m, data.usage); ledger.calls++; }   // billed even when the reply is an error-free failure
    if (!res.ok) throw new Error(`${res.status}: ${data?.error?.message ?? JSON.stringify(data).slice(0, 300)}`);
    const text = (data.content ?? []).filter((b) => b.type === "text").map((b) => b.text).join("");
    return { text, usage: data.usage, stop: data.stop_reason };
  }
  /** one dropped connection or overloaded reply shouldn't lose a whole subject: retry a couple of times */
  async function call(system, content, maxTokens, effort, m = model) {
    const worst = worstCase(m, system, content, maxTokens, effort);
    // calls run in parallel: count the worst case of the ones still in flight too
    if (ledger.spent + ledger.reserved + worst > budget) throw new BudgetError(`stopping: this call could cost up to $${worst.toFixed(2)} and $${(ledger.spent + ledger.reserved).toFixed(2)} of $${budget.toFixed(2)} is spent or committed`);
    ledger.reserved += worst;
    try { return await withRetries(m, system, content, maxTokens, effort); } finally { ledger.reserved -= worst; }
  }
  async function withRetries(m, system, content, maxTokens, effort) {
    for (let attempt = 1; ; attempt++) {
      try { return await once(m, system, content, maxTokens, effort); }
      catch (e) {
        const retryable = /fetch failed|ECONNRESET|ETIMEDOUT|^(429|500|502|503|529):/i.test(String(e.message ?? e));
        if (!retryable || attempt >= 3 || ledger.spent + ledger.reserved > budget) throw e;
        log(`  retrying after: ${String(e.message ?? e).slice(0, 80)}`);
        await new Promise((r) => setTimeout(r, 4000 * attempt));
      }
    }
  }
  return { call, ledger, worstCase, model };
}

export const JUDGE_SYSTEM = `You are a strict, experienced examiner reviewing exam questions written by someone else for a student, given the student's notes.
For each question, judge it as a REAL exam question would be judged by a harsh head of department. Score 0-2 on each:
- realistic: would plausibly appear on a real exam at this level (0 = contrived/quiz-like, 2 = could be lifted from a past paper)
- applied: tests applying a principle from the notes to a situation the notes don't cover, rather than recall (case questions only; others: null)
- self_contained: every new fact and value needed is in the question or its FIGURE (figures are given as JSON: tables, plotted functions, chart data), nothing outside the notes is secretly required
- one_answer: exactly one defensible answer; the model answer and scheme are correct
- accurate: every real-world claim (agents, cases, findings, numbers) is true and well established; nothing invented
- distractors: for multiple choice, the wrong options are realistic mistakes (near miss, partly right, weak) and none is arguably right (non-MCQ: null)
Then "fix": one sentence on the single most important improvement, or "" if none. Be honest; most questions should NOT get perfect scores.
Return STRICT JSON only: {"items":[{"id":"q1","realistic":2,"applied":1,"self_contained":2,"one_answer":2,"accurate":2,"distractors":null,"fix":"..."}]}`;

export const JUDGE_STYLE = `
A PAST EXAM from the same course is also given. Judge the whole paper against it and add a top-level "paper" object:
"paper":{"style_match":0-2,"copied":true|false,"style_fix":"..."}
- style_match: 2 = it would pass as another exam from that course (same shape, points scheme, numbering, kinds of task, voice, length and difficulty of parts); 1 = recognisably similar but generic in places; 0 = a generic exam that ignores the past exam's format.
- copied: true if ANY question reuses a past-exam question, scenario, dataset or wording (format reuse is fine; content reuse is not).
- style_fix: the single most important change to match the format better, or "".`;

// the judge must SEE the figures (tables, plotted functions, chart data) or it can't tell whether a question is answerable
const figText = (f) => (f ? `\n     FIGURE: ${JSON.stringify({ ...f, src: undefined }).slice(0, 1500)}` : "");
const REFS_FIGURE = /\b(below|as shown|shown in|the (graph|table|chart|diagram|data|figure|readings|results))\b/i;
export const refsMissingFigure = (q) => [q.stem, ...q.parts.map((p) => p.prompt)].some((t) => REFS_FIGURE.test(t)) && !q.figure && !q.parts.some((p) => p.figure);
export const letterKey = (p) => p.type === "mcq" && /^\s*(option\s*)?[A-F]\b\.?\s*$/i.test(p.answer);

export function questionText(q) {
  return [`${q.id}${q.basis?.kind === "case" ? " [CASE]" : ""}${q.basis?.principle ? ` (principle: ${q.basis.principle})` : ""}: ${q.stem}${figText(q.figure)}`,
    ...q.parts.map((p) => `  (${p.label || "-"}) [${p.type}, ${p.marks}m] ${p.prompt}${figText(p.figure)}${p.options ? `\n     options: ${p.options.map((o, i) => `${i === p.correct ? "*" : ""}${o}`).join(" | ")}` : ""}\n     answer: ${p.answer}${p.scheme.length ? `\n     scheme: ${p.scheme.join(" / ")}` : ""}`)].join("\n");
}

export const excerptsOf = (f) => f.pages.map((text, i) => ({ n: i + 1, noteTitle: f.title, page: i, text }));

/** Write one exam for fixture `f` with the app's prompt and validation. */
export async function writeExam(api, f, { past = [], extraRules, questions = 8 } = {}) {
  const excerpts = excerptsOf(f);
  const { system, content } = buildExamPrompt({ excerpts, questions, difficulty: "same", style: f.style, figures: true, cases: true, pastExams: past, extraRules });
  const r = await api.call(system, content, EXAM_MAX_TOKENS, effortFor("exam", false, api.model));
  const exam = normalizeExam(parseModelJson(r.text));
  if (!exam) throw new Error(`unreadable exam (stop: ${r.stop})`);
  const c = checkSolvable(exam, excerpts, []);
  const qs = c.exam.sections.flatMap((s) => s.questions);
  const parts = allParts(c.exam).map((x) => x.p);
  const mcqs = parts.filter((p) => p.type === "mcq");
  return {
    excerpts, exam: c.exam, qs, check: c, stop: r.stop, usage: r.usage,
    stats: {
      questions: qs.length, cases: qs.filter((q) => q.basis?.kind === "case").length, dropped: c.dropped, stretch: c.stretch,
      withFigure: qs.filter((q) => q.figure || q.parts.some((p) => p.figure)).length, noFigure: qs.filter(refsMissingFigure).length,
      mcqs: mcqs.length, lint: mcqs.flatMap((p) => lintMcq(p)).length, keyLetters: parts.filter(letterKey).length,
    },
  };
}

/** The strict judge on one written exam. Averages are 0..2 (null when nothing applies). */
export async function judgeExam(api, { excerpts, past = [], exam, qs }) {
  const pastText = past.length ? `\n\nPAST EXAM the paper was asked to copy the FORMAT of (not the questions):\n${past.map((e) => `[${e.title}]\n${e.text}`).join("\n\n")}` : "";
  const paperMeta = `Paper: ${exam.title} · ${exam.durationMin ?? "?"} min · instructions: ${exam.instructions ?? ""} · sections: ${exam.sections.map((s) => `${s.title} (${s.questions.reduce((n, q) => n + q.parts.reduce((m, p) => m + p.marks, 0), 0)} marks)`).join("; ")}`;
  const j = await api.call(JUDGE_SYSTEM + (past.length ? JUDGE_STYLE : ""), [{ type: "text", text: `Student's notes:\n${excerpts.map((e) => `[${e.n}] ${e.text}`).join("\n\n")}${pastText}\n\n${paperMeta}\n\nQuestions:\n${qs.map(questionText).join("\n\n")}` }], 4000, "low");
  const judged = parseModelJson(j.text) ?? {};
  const items = Array.isArray(judged.items) ? judged.items : [];
  const cases = new Set(qs.filter((q) => q.basis?.kind === "case").map((q) => q.id));
  const avg = (k, pick = () => true) => { const v = items.filter(pick).map((x) => x[k]).filter((x) => typeof x === "number"); return v.length ? +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(2) : null; };
  return {
    items, paper: past.length ? judged.paper ?? null : null,
    avg: {
      realistic: avg("realistic"), applied: avg("applied", (x) => cases.has(x.id)), selfContained: avg("self_contained"),
      oneAnswer: avg("one_answer"), accurate: avg("accurate"), distractors: avg("distractors"),
    },
  };
}
