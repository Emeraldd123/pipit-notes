// Exam-writer evaluation: writes real exams from sample notes in several subjects with EXACTLY the app's prompt,
// runs the app's own validation, then has a strict examiner review every question.
//
//   npm run eval:exam                       (asks for your key in a window; 5 subjects, 1 exam each)
//   ANTHROPIC_API_KEY=sk-ant-... node tools/exam-eval.mjs --runs 2 --only bio,econ --no-judge
//
// Options: --dry (check prompts only), --runs N (exams per subject), --only a,b, --model ID, --no-judge, --questions N,
//   --builtin: copy the format of the built-in MIT exam the app would pick for each subject.
//   --style exam.pdf|exam.txt[,more]: a real past exam (e.g. MIT OCW) whose FORMAT the paper should copy. The judge then also
//   scores how well the paper matches it and whether anything was copied. Keep such files in data/ (gitignored; OCW is CC BY-NC-SA).
//   --budget N: stop before spending more than $N (default 5).
// Reports go to data/exam-eval/ (gitignored). Each exam costs roughly what one in the app does; the judge adds a few cents.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { chooseStyleExamples, pickPastExams } from "../src/lib/past-exams.ts";
import { buildExamPrompt } from "../src/lib/exam-prompt.ts";
import { BudgetError, excerptsOf, judgeExam, makeApi, questionText, writeExam } from "./exam-lab.mjs";
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
const api = makeApi({ key: KEY, model: MODEL, budget: Number(arg("budget", "5")), log: console.log });

// past exams to match (read locally; PDFs through the same text extraction idea as the app: text layer, line by line)
async function pdfPages(path) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(path)), useSystemFonts: true }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const tc = await (await doc.getPage(i)).getTextContent();
    pages.push(tc.items.map((it) => it.str + (it.hasEOL ? "\n" : " ")).join("").replace(/[ \t]+\n/g, "\n").trim());
  }
  return pages;
}
const STYLE_FILES = arg("style", "")?.split(",").filter(Boolean) ?? [];
const PAST = [];
// --builtin: the app's built-in MIT exams, chosen per subject exactly as the app does
const BUILTIN = process.argv.includes("--builtin") ? JSON.parse(readFileSync("public/ocw/exams.json", "utf8")).exams : [];
for (const f of STYLE_FILES) PAST.push({ id: f, title: basename(f).replace(/\.(pdf|txt)$/i, ""), pages: /\.pdf$/i.test(f) ? await pdfPages(f) : readFileSync(f, "utf8").split(/\f|\n-{3,} ?page break ?-{3,}\n/i) });

const results = [];
const lines = [`# Exam-writer evaluation — ${new Date().toISOString()}`, `model ${MODEL} · ${QUESTIONS} questions · judge ${JUDGE ? "on" : "off"}`, ""];
outer: for (const f of subjects) {
  for (let r = 0; r < RUNS; r++) {
    const past = PAST.length ? pickPastExams(f.pages, PAST, 9000) : BUILTIN.length ? chooseStyleExamples(f.pages, [], BUILTIN) : [];
    if (DRY) {
      const { system, content } = buildExamPrompt({ excerpts: excerptsOf(f), questions: QUESTIONS, difficulty: "same", style: f.style, figures: true, cases: true, pastExams: past });
      console.log(`${f.id}: system ${system.length} chars, user ${content.map((c) => c.text ?? "").join("").length} chars, case rules ${system.includes("CASE-STUDY") ? "on" : "OFF"}, past exams ${past.map((e) => `${e.title} (${e.text.length} chars)`).join(", ") || "none"}`);
      continue;
    }
    const t0 = Date.now();
    let row = { subject: f.id, run: r + 1 };
    try {
      const w = await writeExam(api, f, { past, questions: QUESTIONS });
      row = { ...row, ...w.stats, caseShare: +(w.stats.cases / Math.max(1, w.stats.questions)).toFixed(2), stop: w.stop, seconds: Math.round((Date.now() - t0) / 1000), inTok: w.usage?.input_tokens, outTok: w.usage?.output_tokens };
      lines.push(`## ${f.title} — run ${r + 1}`, "", "```", ...w.qs.map(questionText), "```", "");
      if (JUDGE) {
        const j = await judgeExam(api, { excerpts: w.excerpts, past, exam: w.exam, qs: w.qs });
        Object.assign(row, j.avg);
        if (j.paper) {
          Object.assign(row, { styleMatch: j.paper.style_match, copied: j.paper.copied ? "YES" : "no" });
          lines.push(`Format match vs ${past.map((e) => e.title).join(", ")}: ${j.paper.style_match}/2${j.paper.copied ? " · COPIED a past question" : ""}${j.paper.style_fix ? ` — ${j.paper.style_fix}` : ""}`, "");
        }
        lines.push("Judge:", ...j.items.map((x) => `- ${x.id}: realistic ${x.realistic} · applied ${x.applied ?? "-"} · self-contained ${x.self_contained} · one answer ${x.one_answer} · accurate ${x.accurate} · distractors ${x.distractors ?? "-"}${x.fix ? ` — ${x.fix}` : ""}`), "");
      }
    } catch (e) {
      row.error = String(e.message ?? e);
      lines.push(`## ${f.title} — run ${r + 1}`, "", `ERROR: ${row.error}`, "");
      if (e instanceof BudgetError) { results.push(row); console.log(row.error); break outer; }
    }
    results.push(row);
    console.log(JSON.stringify(row));
  }
}

const keys = ["subject", "run", "questions", "cases", "caseShare", "dropped", "stretch", "withFigure", "noFigure", "mcqs", "keyLetters", "lint", "realistic", "applied", "selfContained", "oneAnswer", "accurate", "distractors", ...(PAST.length || BUILTIN.length ? ["styleMatch", "copied"] : []), "error"];
lines.splice(3, 0, `spent $${api.ledger.spent.toFixed(2)} over ${api.ledger.calls} calls`, "", "| " + keys.join(" | ") + " |", "|" + keys.map(() => "---").join("|") + "|", ...results.map((r) => "| " + keys.map((k) => r[k] ?? "").join(" | ") + " |"), "");
if (DRY) process.exit(0);
mkdirSync("data/exam-eval", { recursive: true });
const out = `data/exam-eval/${new Date().toISOString().replace(/[:.]/g, "-")}.md`;
writeFileSync(out, lines.join("\n"));
console.log(`\nSpent $${api.ledger.spent.toFixed(2)}. Report: ${out}`);
