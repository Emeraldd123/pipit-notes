// Exam-writer evaluation: writes real exams from sample notes in several subjects with EXACTLY the app's prompt,
// runs the app's own validation, then has a strict examiner review every case-study question.
//
//   ANTHROPIC_API_KEY=sk-ant-... node tools/exam-eval.mjs            (5 subjects, 1 exam each)
//   node --env-file=.env.local tools/exam-eval.mjs --runs 2 --only bio,econ --no-judge
//
// Options: --dry (check prompts only), --runs N (exams per subject), --only a,b, --model ID, --no-judge, --questions N.
// The key is read from the environment and only sent to api.anthropic.com. Reports go to data/exam-eval/ (gitignored).
// Each exam costs roughly what one in the app does (~$0.10–0.20 on the default model); the judge adds a few cents.
import { mkdirSync, writeFileSync } from "node:fs";
import { buildExamPrompt, EXAM_MAX_TOKENS } from "../src/lib/exam-prompt.ts";
import { effortFor, maxTokensFor } from "../src/lib/ai-cost.ts";
import { parseModelJson } from "../src/lib/json-repair.ts";
import { normalizeExam, lintMcq, allParts } from "../src/lib/exam-core.ts";
import { checkSolvable } from "../src/lib/coverage.ts";
import { FIXTURES } from "./exam-fixtures.mjs";

const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : dflt; };
const KEY = process.env.ANTHROPIC_API_KEY?.trim();
const DRY = process.argv.includes("--dry");   // build the prompts and stop (no API calls, no key needed)
if (!KEY && !DRY) { console.error("Set ANTHROPIC_API_KEY (your own key) to run the evaluation."); process.exit(1); }
const MODEL = arg("model", "claude-sonnet-5-5");
const RUNS = Number(arg("runs", "1"));
const QUESTIONS = Number(arg("questions", "8"));
const JUDGE = !process.argv.includes("--no-judge");
const only = arg("only", "")?.split(",").filter(Boolean);
const subjects = FIXTURES.filter((f) => !only?.length || only.includes(f.id));

async function call(system, content, maxTokens, effort) {
  const user = content.map((c) => (c.type === "text" ? { type: "text", text: c.text } : null)).filter(Boolean);
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokensFor(maxTokens, effort), ...(effort ? { output_config: { effort } } : {}), system, messages: [{ role: "user", content: user }] }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${res.status}: ${data?.error?.message ?? JSON.stringify(data).slice(0, 300)}`);
  const text = (data.content ?? []).filter((b) => b.type === "text").map((b) => b.text).join("");
  return { text, usage: data.usage, stop: data.stop_reason };
}

const JUDGE_SYSTEM = `You are a strict, experienced examiner reviewing exam questions written by someone else for a student, given the student's notes.
For each question, judge it as a REAL exam question would be judged by a harsh head of department. Score 0-2 on each:
- realistic: would plausibly appear on a real exam at this level (0 = contrived/quiz-like, 2 = could be lifted from a past paper)
- applied: tests applying a principle from the notes to a situation the notes don't cover, rather than recall (case questions only; others: null)
- self_contained: every new fact and value needed is in the question or its FIGURE (figures are given as JSON: tables, plotted functions, chart data), nothing outside the notes is secretly required
- one_answer: exactly one defensible answer; the model answer and scheme are correct
- accurate: every real-world claim (agents, cases, findings, numbers) is true and well established; nothing invented
- distractors: for multiple choice, the wrong options are realistic mistakes (near miss, partly right, weak) and none is arguably right (non-MCQ: null)
Then "fix": one sentence on the single most important improvement, or "" if none. Be honest; most questions should NOT get perfect scores.
Return STRICT JSON only: {"items":[{"id":"q1","realistic":2,"applied":1,"self_contained":2,"one_answer":2,"accurate":2,"distractors":null,"fix":"..."}]}`;

// the judge must SEE the figures (tables, plotted functions, chart data) or it can't tell whether a question is answerable
const figText = (f) => (f ? `\n     FIGURE: ${JSON.stringify({ ...f, src: undefined }).slice(0, 1500)}` : "");
const REFS_FIGURE = /\b(below|as shown|shown in|the (graph|table|chart|diagram|data|figure|readings|results))\b/i;
const refsMissingFigure = (q) => [q.stem, ...q.parts.map((p) => p.prompt)].some((t) => REFS_FIGURE.test(t)) && !q.figure && !q.parts.some((p) => p.figure);
const letterKey = (p) => p.type === "mcq" && /^\s*(option\s*)?[A-F]\b\.?\s*$/i.test(p.answer);

function questionText(q) {
  return [`${q.id}${q.basis?.kind === "case" ? " [CASE]" : ""}${q.basis?.principle ? ` (principle: ${q.basis.principle})` : ""}: ${q.stem}${figText(q.figure)}`,
    ...q.parts.map((p) => `  (${p.label || "-"}) [${p.type}, ${p.marks}m] ${p.prompt}${figText(p.figure)}${p.options ? `\n     options: ${p.options.map((o, i) => `${i === p.correct ? "*" : ""}${o}`).join(" | ")}` : ""}\n     answer: ${p.answer}${p.scheme.length ? `\n     scheme: ${p.scheme.join(" / ")}` : ""}`)].join("\n");
}

const results = [];
const lines = [`# Exam-writer evaluation — ${new Date().toISOString()}`, `model ${MODEL} · ${QUESTIONS} questions · judge ${JUDGE ? "on" : "off"}`, ""];
for (const f of subjects) {
  for (let r = 0; r < RUNS; r++) {
    const excerpts = f.pages.map((text, i) => ({ n: i + 1, noteTitle: f.title, page: i, text }));
    const { system, content } = buildExamPrompt({ excerpts, questions: QUESTIONS, difficulty: "same", style: f.style, figures: true, cases: true });
    if (DRY) { console.log(`${f.id}: system ${system.length} chars, user ${content.map((c) => c.text ?? "").join("").length} chars, case rules ${system.includes("CASE-STUDY") ? "on" : "OFF"}`); continue; }
    const t0 = Date.now();
    let row = { subject: f.id, run: r + 1 };
    try {
      const { text, usage, stop } = await call(system, content, EXAM_MAX_TOKENS, effortFor("exam", false, MODEL));
      const exam = normalizeExam(parseModelJson(text));
      if (!exam) throw new Error(`unreadable exam (stop: ${stop})`);
      const c = checkSolvable(exam, excerpts, []);
      const qs = c.exam.sections.flatMap((s) => s.questions);
      const parts = allParts(c.exam).map((x) => x.p);
      const mcqs = parts.filter((p) => p.type === "mcq");
      const lint = mcqs.flatMap((p) => lintMcq(p));
      const cases = qs.filter((q) => q.basis?.kind === "case");
      row = {
        ...row, questions: qs.length, cases: cases.length, caseShare: +(cases.length / Math.max(1, qs.length)).toFixed(2),
        dropped: c.dropped, stretch: c.stretch, withFigure: qs.filter((q) => q.figure || q.parts.some((p) => p.figure)).length,
        mcqs: mcqs.length, mcqWhy: mcqs.filter((p) => p.why).length, lint: lint.length,
        keyLetters: parts.filter(letterKey).length, noFigure: qs.filter(refsMissingFigure).length, stop, seconds: Math.round((Date.now() - t0) / 1000),
        inTok: usage?.input_tokens, outTok: usage?.output_tokens,
      };
      lines.push(`## ${f.title} — run ${r + 1}`, "", "```", ...qs.map(questionText), "```", "");
      if (JUDGE) {
        const j = await call(JUDGE_SYSTEM, [{ type: "text", text: `Student's notes:\n${excerpts.map((e) => `[${e.n}] ${e.text}`).join("\n\n")}\n\nQuestions:\n${qs.map(questionText).join("\n\n")}` }], 4000, "low");
        const items = parseModelJson(j.text)?.items ?? [];
        const avg = (k, pick = () => true) => { const v = items.filter(pick).map((x) => x[k]).filter((x) => typeof x === "number"); return v.length ? +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(2) : null; };
        const isCase = (x) => cases.some((q) => q.id === x.id);
        Object.assign(row, {
          realistic: avg("realistic"), applied: avg("applied", isCase), selfContained: avg("self_contained", isCase),
          oneAnswer: avg("one_answer"), accurate: avg("accurate"), distractors: avg("distractors"),
        });
        lines.push("Judge:", ...items.map((x) => `- ${x.id}: realistic ${x.realistic} · applied ${x.applied ?? "-"} · self-contained ${x.self_contained} · one answer ${x.one_answer} · accurate ${x.accurate} · distractors ${x.distractors ?? "-"}${x.fix ? ` — ${x.fix}` : ""}`), "");
      }
    } catch (e) { row.error = String(e.message ?? e); lines.push(`## ${f.title} — run ${r + 1}`, "", `ERROR: ${row.error}`, ""); }
    results.push(row);
    console.log(JSON.stringify(row));
  }
}

const keys = ["subject", "run", "questions", "cases", "caseShare", "dropped", "stretch", "withFigure", "noFigure", "mcqs", "keyLetters", "lint", "realistic", "applied", "selfContained", "oneAnswer", "accurate", "distractors", "error"];
lines.splice(3, 0, "| " + keys.join(" | ") + " |", "|" + keys.map(() => "---").join("|") + "|", ...results.map((r) => "| " + keys.map((k) => r[k] ?? "").join(" | ") + " |"), "");
if (DRY) process.exit(0);
mkdirSync("data/exam-eval", { recursive: true });
const out = `data/exam-eval/${new Date().toISOString().replace(/[:.]/g, "-")}.md`;
writeFileSync(out, lines.join("\n"));
console.log(`\nReport: ${out}`);
