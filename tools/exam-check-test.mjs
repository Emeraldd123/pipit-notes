// Can the answer-checker catch errors at all? A cheap, direct test before spending more on full experiments:
// questions from a saved tuning run where the strict judge named a CORRECTNESS problem (wrong answer or key,
// inconsistent numbers, two defensible answers), mixed with questions the judge rated perfect, are given to the
// checker exactly as the app sends them. It reports how many known errors each checker model catches and how many
// good questions it wrongly flags. Hard spending cap (default $1.50).
//
//   npm run eval:check                    (Sonnet, as in the app, and Opus as a stronger second examiner)
//   npm run eval:check -- --models claude-sonnet-5-5 --n 8
//   node tools/exam-check-test.mjs --mock (free rehearsal)
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { parseModelJson } from "../src/lib/json-repair.ts";
import { findCheck, normalizeChecks, verifyUserText, VERIFY_SYSTEM } from "../src/lib/exam-verify.ts";
import { effortFor } from "../src/lib/ai-cost.ts";
import { BudgetError, makeApi } from "./exam-lab.mjs";
import { FIXTURES, HOLDOUT } from "./exam-fixtures.mjs";

const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : dflt; };
const MOCK = process.argv.includes("--mock");
const KEY = MOCK ? "mock" : process.env.ANTHROPIC_API_KEY?.trim();
if (!KEY) { console.error("Set ANTHROPIC_API_KEY (your own key), or run with --mock."); process.exit(1); }
const BUDGET = Math.min(3, Number(arg("budget", "1.5")));
const N = Number(arg("n", "12"));   // known-bad questions, and as many known-good
const MODELS = arg("models", "claude-sonnet-5-5,claude-opus-5-5").split(",").filter(Boolean);
const fetchImpl = MOCK ? (await import("./exam-mock.mjs")).mockFetch : undefined;
const spend = { total: 0 };

// --- the questions: from the newest saved tuning run that kept whole questions ------------------------------------
const runs = readdirSync("data/exam-tune").filter((d) => !d.endsWith("-mock")).sort().reverse();
const CORRECTNESS = /inconsist|doesn.t match|does not match|should be|wrong|incorrect|arguabl|two (defensible )?answers|also (correct|right|defensible)|miscalc|arithmetic|not equal|mislabel|contradict|actually (gives|is)|ambiguous/i;
let pool = [];
for (const d of runs) {
  try {
    const r = JSON.parse(readFileSync(`data/exam-tune/${d}/run.json`, "utf8"));
    pool = r.rounds.flatMap((x) => x.papers).filter((p) => !p.error).flatMap((p) => p.questions.filter((q) => q.full && q.judge).map((q) => ({ ...q, subject: p.subject })));
    if (pool.length) { console.log(`Questions from ${d} (${pool.length} with judge reviews).`); break; }
  } catch { /* no data in this one */ }
}
if (!pool.length) { console.error("No saved tuning run with whole questions found in data/exam-tune."); process.exit(1); }
const score = (j) => ["realistic", "self_contained", "one_answer", "accurate"].map((k) => j[k]);
const bad = pool.filter((q) => ((q.judge.one_answer ?? 2) <= 1 || (q.judge.accurate ?? 2) <= 1) && CORRECTNESS.test(q.judge.fix ?? "") && !/which is fine|is acceptable|is correct/i.test(q.judge.fix ?? ""));
const good = pool.filter((q) => score(q.judge).every((v) => v === 2) && (q.judge.distractors ?? 2) === 2);
// spread across subjects, deterministic
const spread = (list, n) => { const by = {}; for (const q of list) (by[q.subject] ??= []).push(q); const out = []; for (let i = 0; out.length < n && i < 50; i++) for (const s of Object.keys(by)) if (by[s][i] && out.length < n) out.push(by[s][i]); return out; };
const picked = [...spread(bad, N).map((q) => ({ ...q, truth: "bad" })), ...spread(good, N).map((q) => ({ ...q, truth: "good" }))];
console.log(`Testing ${picked.filter((q) => q.truth === "bad").length} questions with a known correctness error and ${picked.filter((q) => q.truth === "good").length} rated perfect, on: ${MODELS.join(", ")}.`);

// small papers, one subject each, the order mixed so errors aren't bunched
const notesOf = (s) => [...FIXTURES, ...HOLDOUT].find((f) => f.id === s);
const papers = [];
for (const s of [...new Set(picked.map((q) => q.subject))]) {
  const qs = picked.filter((q) => q.subject === s).sort((a, b) => (a.id + a.truth).localeCompare(b.id + b.truth));
  for (let i = 0; i < qs.length; i += 6) papers.push({ subject: s, qs: qs.slice(i, i + 6) });
}

async function check(model, paper) {
  const api = makeApi({ key: KEY, model, budget: BUDGET - spend.total, fetchImpl });
  const questions = paper.qs.map((q, i) => ({ ...q.full, id: `q${i + 1}`, parts: q.full.parts.map((p, k) => ({ ...p, id: `q${i + 1}.${k}`, scheme: p.scheme ?? [] })) }));
  const exam = { sections: [{ title: "", questions }] };
  const f = notesOf(paper.subject);
  const excerpts = f.pages.map((text, i) => ({ n: i + 1, noteTitle: f.title, page: i, text }));
  try {
    const r = await api.call(VERIFY_SYSTEM, [{ type: "text", text: verifyUserText(exam, excerpts) }], 8000, effortFor("exam.verify", false, model));
    spend.total += api.ledger.spent;
    let checks = [];
    try { checks = normalizeChecks(parseModelJson(r.text)); } catch { return { error: `unreadable reply (stop ${r.stop})`, raw: r.text }; }
    return { raw: r.text, results: questions.map((q, i) => ({ q: paper.qs[i], flagged: q.parts.map((p) => findCheck(checks, q, p.label || "-")).filter(Boolean) })) };
  } catch (e) { spend.total += api.ledger.spent; if (e instanceof BudgetError) throw e; return { error: e.message }; }
}

const report = [`# Can the checker catch known errors? — ${new Date().toISOString()}`, ""];
const summary = [];
mkdirSync("data/exam-check", { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19) + (MOCK ? "-mock" : "");
try {
  for (const model of MODELS) {
    const rows = [];
    for (const paper of papers) {
      const r = await check(model, paper);
      if (r.raw) writeFileSync(`data/exam-check/${stamp}-${model}-${paper.subject}-${papers.indexOf(paper)}.txt`, r.raw);
      if (r.error) { console.log(`  ${model} · ${paper.subject}: ERROR ${r.error}`); continue; }
      rows.push(...r.results);
    }
    const caught = rows.filter((x) => x.q.truth === "bad" && x.flagged.length).length, nBad = rows.filter((x) => x.q.truth === "bad").length;
    const falseFlags = rows.filter((x) => x.q.truth === "good" && x.flagged.length).length, nGood = rows.filter((x) => x.q.truth === "good").length;
    const line = `${model}: caught ${caught} of ${nBad} known errors · flagged ${falseFlags} of ${nGood} good questions`;
    summary.push(line);
    console.log(`  ${line} (spent so far $${spend.total.toFixed(2)})`);
    report.push(`## ${model}`, "", line, "");
    for (const x of rows) report.push(`- **${x.q.truth === "bad" ? "KNOWN ERROR" : "rated perfect"}** [${x.q.subject}] ${x.q.full.stem.slice(0, 110)}…`,
      ...(x.q.truth === "bad" ? [`  - judge: ${x.q.judge.fix}`] : []),
      `  - checker: ${x.flagged.length ? x.flagged.map((c) => `${c.verdict}: ${c.problem}`).join(" · ") : "no problem found"}`);
    report.push("");
  }
} catch (e) { if (e instanceof BudgetError) console.log(`Stopped at the spending cap: ${e.message}`); else throw e; }
report.splice(2, 0, ...summary, "", `spent $${spend.total.toFixed(2)}`, "");
const out = `data/exam-check/${stamp}.md`;
writeFileSync(out, report.join("\n"));
console.log(`\nSpent $${spend.total.toFixed(2)}. Report (every question with the judge's and the checker's verdict): ${out}`);
