// Tuning loop for the exam writer. Writes papers for the five sample units, has the strict judge review them,
// measures VARIETY (each new paper against the earlier papers for the same notes, plus type mix and coverage
// inside a paper), then asks the model to rewrite a short block of general "house rules" and tries again.
// It keeps the best rules, checks them on three held-out units it never tuned on, and writes everything to a
// review page. Nothing reaches the app until you approve it (npm run tune:apply).
//
//   npm run tune:exam                                   (asks for your key; spends at most $10)
//   npm run tune:exam -- --budget 4 --rounds 3
//   npm run tune:exam -- --feedback data/exam-tune/<run>/review.json   (start from your reviewed rules and notes)
//   node tools/exam-tune.mjs --dry                       (plan and worst-case cost, no key needed)
//
// Budget: every call is checked against its WORST case before it is sent (tools/exam-lab.mjs), and the loop keeps
// enough in reserve for the held-out check, so the total can't pass the cap. Output: data/exam-tune/<run>/ (gitignored).
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { writeTuned } from "./exam-tuned-file.mjs";
import { exec } from "node:child_process";
import { buildExamPrompt, EXAM_MAX_TOKENS } from "../src/lib/exam-prompt.ts";
import { effortFor } from "../src/lib/ai-cost.ts";
import { parseModelJson } from "../src/lib/json-repair.ts";
import { chooseStyleExamples } from "../src/lib/past-exams.ts";
import { TUNED_RULES } from "../src/lib/exam-tuned.ts";
import { BudgetError, excerptsOf, judgeExam, makeApi, questionText, writeExam } from "./exam-lab.mjs";
import { FIXTURES, HOLDOUT } from "./exam-fixtures.mjs";
import { combineVariety, distinctiveWords, generalTexts, leaks, paperScore, varietyScore } from "./exam-variety.mjs";
import { parseQuestionText } from "./question-html.mjs";
import { buildReview } from "./tune-review-build.mjs";

const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : dflt; };
const DRY = process.argv.includes("--dry");
const MOCK = process.argv.includes("--mock");   // a fake API: tries the whole loop and review page for free
const KEY = MOCK ? "mock" : process.env.ANTHROPIC_API_KEY?.trim();
if (!KEY && !DRY) { console.error("Set ANTHROPIC_API_KEY (your own key), or run with --dry or --mock."); process.exit(1); }
const BUDGET = Math.min(10, Number(arg("budget", "10")));   // never more than $10, whatever is passed
const MAX_ROUNDS = Number(arg("rounds", "8"));
const MODEL = arg("model", "claude-sonnet-5-5");
const QUESTIONS = 8;
const WINDOW = 2;   // a new paper is compared with the papers from the previous two rounds for the same notes
const BUILTIN = JSON.parse(readFileSync("public/ocw/exams.json", "utf8")).exams;
const feedback = arg("feedback", "") ? JSON.parse(readFileSync(arg("feedback"), "utf8")) : null;

const api = makeApi({ key: KEY, model: MODEL, budget: BUDGET, log: console.log, ...(MOCK ? { fetchImpl: (await import("./exam-mock.mjs")).mockFetch } : {}) });
const RUN = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19) + (MOCK ? "-mock" : "");
const OUT = `data/exam-tune/${RUN}`;
const base = buildExamPrompt({ excerpts: [], questions: QUESTIONS, difficulty: "same", style: "", figures: true, cases: true, extraRules: "" }).system;
const distinct = distinctiveWords([...FIXTURES, ...HOLDOUT], generalTexts(BUILTIN));
const pastFor = (f) => chooseStyleExamples(f.pages, [], BUILTIN);

// --- worst-case cost of a round, so the loop never starts one it can't finish --------------------------------------
function worstPaper(f, rules) {
  const past = pastFor(f);
  const { system, content } = buildExamPrompt({ excerpts: excerptsOf(f), questions: QUESTIONS, difficulty: "same", style: f.style, figures: true, cases: true, pastExams: past, extraRules: rules });
  const write = api.worstCase(MODEL, system, content, EXAM_MAX_TOKENS, effortFor("exam", false, MODEL));
  const judge = api.worstCase(MODEL, "x".repeat(4000), [{ text: "x".repeat(content.reduce((n, c) => n + (c.text?.length ?? 0), 0) + 14000) }], 4000, "low");
  return write + judge;
}
const IMPROVE_WORST = api.worstCase(MODEL, "x".repeat(3000), [{ text: "x".repeat(base.length + 14000) }], 2500, "medium");
const roundWorst = (rules) => FIXTURES.reduce((n, f) => n + worstPaper(f, rules), 0);
const holdoutWorst = (a, b) => HOLDOUT.reduce((n, f) => n + worstPaper(f, a) + worstPaper(f, b), 0);

// --- one paper: write, judge, score -----------------------------------------------------------------------------
async function paper(f, rules, earlier) {
  const past = pastFor(f);
  const w = await writeExam(api, f, { past, extraRules: rules, questions: QUESTIONS });
  const j = await judgeExam(api, { excerpts: w.excerpts, past, exam: w.exam, qs: w.qs });
  const v = varietyScore(w.qs, earlier, f.pages.length);
  const s = paperScore(j, w.stats, v, QUESTIONS);
  return { subject: f.id, title: f.title, past: past.map((e) => e.title), exam: w.exam, qs: w.qs, stats: w.stats, judge: { avg: j.avg, items: j.items, paper: j.paper }, varietyDetail: v, quality: s.quality, variety: s.variety, total: s.total };
}

async function round(fixtures, rules, history) {
  const settled = await Promise.allSettled(fixtures.map((f) => paper(f, rules, (history[f.id] ?? []).slice(-WINDOW).flat())));
  const papers = settled.map((r, i) => (r.status === "fulfilled" ? r.value : { subject: fixtures[i].id, error: String(r.reason?.message ?? r.reason), budget: r.reason instanceof BudgetError }));
  const ok = papers.filter((p) => !p.error);
  const mean = (k) => (ok.length ? ok.reduce((n, p) => n + p[k], 0) / ok.length : 0);
  return { papers, score: mean("total"), quality: mean("quality"), variety: mean("variety"), complete: ok.length === fixtures.length };
}

// --- the improver ------------------------------------------------------------------------------------------------
const IMPROVER = `You improve the HOUSE RULES appended to an exam-writing prompt (the BASE PROMPT is shown). The goal is papers that a strict head of department rates as realistic, correct, self-contained, with strong multiple-choice distractors and the real past exam's format, AND that are VARIED: each new paper for the same notes must use different scenarios, data, cases and question types from earlier papers, spread across all of the notes, and never fall back on a few favourite questions.
Rules must be GENERAL (they must work for any subject: biology, history, languages, maths…), short imperative lines starting with "- ", at most 12 rules and 1500 characters in total. Don't repeat or contradict the base prompt; fix what the evidence shows is going wrong. Never name a specific topic, case, substance, experiment, formula or example.
Human reviewer notes, when present, outrank the automatic judge.
Reply in exactly this format, nothing else:
<rules>
- first rule
- second rule
</rules>
<changes>what you changed and why, in two sentences</changes>`;

/** The rewriter's reply -> rule lines and a summary. Tagged blocks (no JSON to break); JSON or a bare list also work. */
function parseRewrite(text) {
  const tag = (t) => new RegExp(`<${t}>([\\s\\S]*?)(?:</${t}>|$)`, "i").exec(text)?.[1]?.trim();
  let rules = tag("rules"), changes = tag("changes") ?? "";
  if (rules == null) {
    try { const j = parseModelJson(text); rules = Array.isArray(j.rules) ? j.rules.map((r) => `- ${String(r).replace(/^\s*-\s*/, "")}`).join("\n") : String(j.rules ?? ""); changes = String(j.changes ?? ""); }
    catch { rules = text.split("\n").filter((l) => /^\s*[-•*]\s+/.test(l)).join("\n"); }
  }
  const lines = String(rules).split("\n").map((l) => l.trim()).filter((l) => l && !/^<\/?\w+>$/.test(l)).map((l) => (/^[-•*]\s/.test(l) ? `- ${l.replace(/^[-•*]\s+/, "")}` : `- ${l}`));
  return { lines, changes };
}

function evidence(r, rules, best, lastTried) {
  const ok = r.papers.filter((p) => !p.error);
  const crit = ["realistic", "applied", "selfContained", "oneAnswer", "accurate", "distractors"].map((k) => {
    const v = ok.map((p) => p.judge.avg[k]).filter((x) => typeof x === "number");
    return `${k} ${v.length ? (v.reduce((a, b) => a + b, 0) / v.length).toFixed(2) : "-"}`;
  }).join(", ");
  const items = ok.flatMap((p) => p.judge.items.map((it) => ({ p, it, s: ["realistic", "self_contained", "one_answer", "accurate"].reduce((n, k) => n + (typeof it[k] === "number" ? it[k] : 2), 0) + (it.distractors ?? 2) })));
  const worst = items.sort((a, b) => a.s - b.s).slice(0, 10).map(({ p, it }) => {
    const q = p.qs.find((x) => x.id === it.id);
    return `- [${p.subject}] ${q ? q.stem.slice(0, 160) : it.id} -> judge: ${it.fix || "(no note)"}`;
  });
  const repeats = ok.flatMap((p) => p.varietyDetail.repeats.slice(0, 3).map((x) => `- [${p.subject}] NEW "${x.stem}" ~ EARLIER "${x.earlier}" (similarity ${x.sim})`));
  const per = ok.map((p) => `${p.subject}: total ${p.total.toFixed(3)} (quality ${p.quality.toFixed(2)}, variety ${p.variety.toFixed(2)}: novelty ${p.varietyDetail.novelty.toFixed(2)}, type mix ${p.varietyDetail.typeMix.toFixed(2)}, notes covered ${p.varietyDetail.coverage.toFixed(2)})${p.judge.paper?.style_fix ? `; format: ${p.judge.paper.style_fix}` : ""}`);
  const human = feedback ? [
    "HUMAN REVIEWER NOTES (most important):",
    ...(feedback.overall ? [`- overall: ${feedback.overall}`] : []),
    ...(feedback.questions ?? []).filter((q) => q.verdict !== "good" || q.comment).slice(0, 20).map((q) => `- ${q.verdict ?? ""}${q.comment ? `: ${q.comment}` : ""} | question: ${String(q.stem ?? "").slice(0, 140)}`),
  ] : [];
  return [
    `BASE PROMPT:\n${base}`,
    `\nCURRENT BEST RULES (round score ${best.score.toFixed(3)}):\n${best.rules || "(none)"}`,
    lastTried && lastTried.rules !== best.rules ? `\nLAST TRIED RULES (score ${lastTried.score.toFixed(3)}, NOT better, try a different change):\n${lastTried.rules}` : "",
    `\nRULES USED THIS ROUND:\n${rules || "(none)"}`,
    `\nTHIS ROUND: mean score ${r.score.toFixed(3)} (quality ${r.quality.toFixed(3)}, variety ${r.variety.toFixed(3)}). Judge averages (0-2): ${crit}.`,
    ...per,
    "\nWEAKEST QUESTIONS:", ...worst,
    repeats.length ? "\nREPEATS OF EARLIER PAPERS (variety problem):" : "", ...repeats,
    ...human,
  ].filter(Boolean).join("\n");
}

async function improve(r, rules, best, lastTried) {
  let note = "";
  for (let tries = 0; tries < 3; tries++) {
    const j = await api.call(IMPROVER, [{ type: "text", text: evidence(r, rules, best, lastTried) + note }], 2500, "medium");
    const { lines, changes } = parseRewrite(j.text);
    const out = { changes };
    if (!lines.length) { console.log(`  the rewriter's reply had no rules; asking again (${j.text.slice(0, 80).replace(/\s+/g, " ")}…)`); note = "\n\nYour last reply had no rules in the <rules> block. Use the exact reply format."; continue; }
    note = "\n\nYour previous answer named specific topics from the notes. Rewrite the rules so they are general.";
    // a rule that names two or more topic words from the sample notes is about those topics, not exams in general
    const topical = lines.filter((l) => leaks(l, distinct, base).length >= 2);
    if (topical.length >= 3) { console.log(`  rejected: ${topical.length} rules name specific topics (${topical.map((l) => leaks(l, distinct, base).slice(0, 2).join("+")).join(", ")})`); continue; }
    for (const l of topical) console.log(`  dropped a topic-specific rule: ${l.slice(0, 90)}`);
    const next = lines.filter((l) => !topical.includes(l)).join("\n").slice(0, 1800);
    return { rules: next, changes: String(out.changes ?? "") + (topical.length ? ` (${topical.length} topic-specific rule${topical.length === 1 ? "" : "s"} dropped)` : "") };
  }
  return null;
}

// --- resuming an earlier run: its rounds (papers, judge reviews, scores) are reused, not paid for again -------------
// --auto: no review step; good rules go straight into the app and it is rebuilt. --resume latest: the newest real run.
const AUTO = process.argv.includes("--auto");
function latestRun() {
  try {
    return readdirSync("data/exam-tune").filter((d) => !d.endsWith("-mock")).sort().reverse().map((d) => `data/exam-tune/${d}`)
      .find((d) => { try { readFileSync(`${d}/run.json`); return true; } catch { return false; } }) ?? "";
  } catch { return ""; }
}
const resumeArg = arg("resume", "") === "latest" ? latestRun() : arg("resume", "");
const resumeDir = resumeArg?.replace(/[\\/]+$/, "").replace(/[\\/]review\.html$/, "");
const resumed = resumeDir ? JSON.parse(readFileSync(`${resumeDir}/run.json`, "utf8")) : null;
function revive(p) {
  if (p.error) return p;
  const qs = p.questions.map((q) => {
    const full = q.full ?? parseQuestionText(q.text);
    return { ...full, id: q.id, basis: { kind: q.kind, principle: q.principle, notes: full.notes ?? [] } };
  });
  return { ...p, qs, revived: true, exam: { title: p.examTitle, durationMin: p.durationMin },
    judge: { avg: p.judgeAvg, paper: p.judgePaper, items: p.questions.map((q) => q.judge).filter(Boolean) } };
}

// --- the loop ----------------------------------------------------------------------------------------------------
const startRules = (resumed?.startRules ?? feedback?.rules ?? TUNED_RULES).trim();
console.log(`Tuning loop: budget $${BUDGET}, up to ${MAX_ROUNDS} rounds of ${FIXTURES.length} papers, held-out check on ${HOLDOUT.map((f) => f.id).join(", ")}.`);
console.log(`Worst case: ~$${roundWorst(startRules).toFixed(2)} per round + $${IMPROVE_WORST.toFixed(2)} to rewrite the rules; held-out check ~$${holdoutWorst(startRules, startRules).toFixed(2)}. Real costs are usually well under half of this.`);
if (DRY) process.exit(0);
const minimum = roundWorst(startRules) + IMPROVE_WORST + holdoutWorst(startRules, startRules);
if (minimum > BUDGET) { console.error(`A budget of $${BUDGET} can't cover even one round plus the held-out check (worst case $${minimum.toFixed(2)}). Use --budget ${Math.ceil(minimum)} or more.`); process.exit(1); }

mkdirSync(OUT, { recursive: true });
const history = {};   // subject -> [questions of each earlier round]
const rounds = [];
let best = { rules: startRules, score: -1, round: 0 };
let lastTried = null;
let rules = startRules;
let stopReason = `reached ${MAX_ROUNDS} rounds`;
let firstRound = 1;
if (resumed) {
  for (const r of resumed.rounds) {
    const papers = r.papers.map(revive);
    for (const p of papers) if (!p.error) (history[p.subject] ??= []).push(p.qs);
    rounds.push({ ...r, papers });
  }
  best = { ...resumed.best };
  const last = rounds[rounds.length - 1];
  if (last && last.n !== best.round) lastTried = { rules: last.rules, score: last.score };
  firstRound = rounds.length + 1;
  console.log(`\nResuming ${resumeDir}: ${rounds.length} round${rounds.length === 1 ? "" : "s"} reused (they cost $${resumed.spent.toFixed(2)} then, nothing now). Best so far: round ${best.round}, ${best.score.toFixed(3)}.`);
  // the next rules come from the last round's evidence (and your review, if given)
  try {
    const next = await improve(last, last.rules, best, lastTried);
    if (!next) { console.error("The rewriter gave no usable rules; nothing more to try."); process.exit(1); }
    last.nextChanges = next.changes;
    console.log(`  next rules: ${next.changes}`);
    rules = next.rules;
  } catch (e) { console.error(`Couldn't write the next rules: ${e.message}`); process.exit(1); }
}
for (let n = firstRound; n < firstRound + MAX_ROUNDS; n++) {
  const need = roundWorst(rules) + IMPROVE_WORST + holdoutWorst(startRules, rules.length > best.rules.length ? rules : best.rules);
  if (api.ledger.spent + need > BUDGET) { stopReason = `budget: another round could cost up to $${need.toFixed(2)} with the held-out check, and $${api.ledger.spent.toFixed(2)} is spent`; break; }
  console.log(`\nRound ${n}${n === 1 ? " (starting rules)" : ""} · spent so far $${api.ledger.spent.toFixed(2)}`);
  const r = await round(FIXTURES, rules, history);
  for (const p of r.papers) if (!p.error) (history[p.subject] ??= []).push(p.qs);
  // round 1 had nothing earlier to be compared with, so it got full marks for novelty; once round 2 exists, score
  // round 1 against it (the same comparison every later round gets), or no later round could ever beat it
  if (n === 2 && rounds[0]) {
    const r1 = rounds[0];
    for (const p of r1.papers) {
      if (p.error) continue;
      const f = FIXTURES.find((x) => x.id === p.subject);
      let v = varietyScore(p.qs, history[p.subject]?.[1] ?? [], f.pages.length);
      if (p.revived) {   // older saves don't record which notes each question used: keep that paper's measured spread
        const d = { ...v, typeMix: p.varietyDetail.typeMix, coverage: p.varietyDetail.coverage, internalRepeats: p.varietyDetail.internalRepeats };
        v = { ...d, score: combineVariety(d, p.qs.length) };
      }
      Object.assign(p, { varietyDetail: v }, paperScore(p.judge, p.stats, v, QUESTIONS));
    }
    const ok = r1.papers.filter((p) => !p.error);
    const mean = (k) => ok.reduce((s, p) => s + p[k], 0) / Math.max(1, ok.length);
    Object.assign(r1, { score: mean("total"), quality: mean("quality"), variety: mean("variety") });
    if (best.round === 1) best.score = r1.score;
    console.log(`  (round 1 re-scored against round 2 for novelty: ${r1.score.toFixed(3)})`);
  }
  for (const p of r.papers) console.log(p.error ? `  ${p.subject}: ERROR ${p.error}` : `  ${p.subject}: ${p.total.toFixed(3)} (quality ${p.quality.toFixed(2)}, variety ${p.variety.toFixed(2)}, repeats ${p.varietyDetail.repeats.length})`);
  const accepted = r.complete && r.score > best.score + 0.01;
  rounds.push({ n, rules, score: r.score, quality: r.quality, variety: r.variety, complete: r.complete, accepted, papers: r.papers, spentAfter: api.ledger.spent });
  console.log(`  round score ${r.score.toFixed(3)}${accepted ? " · best so far" : ` · not better than round ${best.round} (${best.score.toFixed(3)})`}`);
  if (accepted) best = { rules, score: r.score, round: n };
  else lastTried = { rules, score: r.score };
  if (r.papers.some((p) => p.budget)) { stopReason = "budget reached mid-round"; break; }
  if (n === firstRound + MAX_ROUNDS - 1) break;
  try {
    const next = await improve(r, rules, best, lastTried);
    if (!next) { stopReason = "the rewriter gave no usable rules"; break; }
    rounds[rounds.length - 1].nextChanges = next.changes;
    console.log(`  next rules: ${next.changes}`);
    rules = next.rules;
  } catch (e) { stopReason = e instanceof BudgetError ? "budget" : `rewriter failed: ${e.message}`; break; }
}

// --- held-out check: starting rules vs best rules on units never used for tuning ----------------------------------
console.log(`\nHeld-out check (${HOLDOUT.map((f) => f.id).join(", ")}) · spent so far $${api.ledger.spent.toFixed(2)}`);
let holdout = null;
try {
  // the starting rules' held-out score from the run being resumed is still valid: reuse it
  const before = resumed?.holdout && resumed.startRules === startRules
    ? { score: resumed.holdout.before, papers: resumed.holdout.papersBefore.map(revive) }
    : await round(HOLDOUT, startRules, {});
  if (resumed?.holdout && resumed.startRules === startRules) console.log(`  starting rules: ${before.score.toFixed(3)} (reused from the earlier run)`);
  const after = best.rules === startRules ? before : await round(HOLDOUT, best.rules, {});
  holdout = { before: before.score, after: after.score, papersBefore: before.papers, papersAfter: after.papers };
  console.log(`  starting rules ${before.score.toFixed(3)} → best rules ${after.score.toFixed(3)}`);
} catch (e) { console.log(`  held-out check stopped: ${e.message}`); }

const improved = best.rules !== startRules && holdout && holdout.after >= holdout.before - 0.01 && best.score > (rounds[0]?.score ?? 0) + 0.02;
const run = {
  run: RUN, model: MODEL, budget: BUDGET, spent: api.ledger.spent, calls: api.ledger.calls, stopReason,
  ...(resumed ? { resumedFrom: resumed.run, previousSpent: +(resumed.spent + (resumed.previousSpent ?? 0)).toFixed(4) } : {}),
  startRules, best, recommendation: improved ? "apply" : best.rules === startRules ? "keep" : "review",
  rounds: rounds.map((r) => ({ ...r, papers: r.papers.map(slim) })), holdout: holdout && { before: holdout.before, after: holdout.after, papersBefore: holdout.papersBefore.map(slim), papersAfter: holdout.papersAfter.map(slim) },
};
function slim(p) {
  if (p.error) return p;
  if (p.revived) { const { qs, judge, revived, exam, ...saved } = p; void qs; void judge; void revived; void exam; return saved; }   // already in saved form
  return { subject: p.subject, title: p.title, past: p.past, total: p.total, quality: p.quality, variety: p.variety, varietyDetail: p.varietyDetail, stats: p.stats,
    examTitle: p.exam.title, durationMin: p.exam.durationMin, judgePaper: p.judge.paper, judgeAvg: p.judge.avg,
    questions: p.qs.map((q) => ({ id: q.id, stem: q.stem, kind: q.basis?.kind, principle: q.basis?.principle, figure: !!(q.figure || q.parts.some((x) => x.figure)), text: questionText(q),
      // the whole question, so the review page can draw it the way the app does
      full: { id: q.id, kind: q.basis?.kind, principle: q.basis?.principle, notes: q.basis?.notes ?? [], stem: q.stem, figure: q.figure ?? null,
        parts: q.parts.map((x) => ({ label: x.label, type: x.type, marks: x.marks, prompt: x.prompt, figure: x.figure ?? null, options: x.options, correct: x.correct, why: x.why, answer: x.answer, scheme: x.scheme, numeric: x.numeric })) },
      judge: p.judge.items.find((it) => it.id === q.id) ?? null })) };
}

writeFileSync(`${OUT}/run.json`, JSON.stringify(run, null, 1));
buildReview(OUT);
console.log(`\nDone: spent $${api.ledger.spent.toFixed(2)} of $${BUDGET} (${api.ledger.calls} calls). Stopped: ${stopReason}.`);
console.log(`Best: round ${best.round}, score ${best.score.toFixed(3)} (round 1: ${(rounds[0]?.score ?? 0).toFixed(3)}). Recommendation: ${run.recommendation}.`);
if (AUTO) {
  // hands-off: only rules that beat the starting ones on the tuned AND the held-out units go into the app
  if (run.recommendation === "apply" && !MOCK) {
    writeTuned(best.rules, { date: new Date().toISOString().slice(0, 10), trainScore: +best.score.toFixed(3), holdoutBefore: +holdout.before.toFixed(3), holdoutAfter: +holdout.after.toFixed(3), spentUsd: +(api.ledger.spent + (run.previousSpent ?? 0)).toFixed(2) });
    console.log(`\nAuto: the new rules beat the old ones (held-out ${holdout.before.toFixed(3)} → ${holdout.after.toFixed(3)}), so they're now in src/lib/exam-tuned.ts. Rebuilding the app…`);
    try { execSync("npm run check", { stdio: "inherit" }); console.log("\nDone. Drag the dist folder onto bensnotes to put the new rules on your iPad."); }
    catch { console.log("\nThe rebuild failed; the rules are saved, run npm run check to see why."); }
  } else console.log(`\nAuto: ${MOCK ? "mock run, nothing applied" : "the new rules didn't clearly beat the old ones, so the app keeps its current rules"}. Details: ${OUT}/review.html`);
}
console.log(`Review it: ${OUT}/review.html${process.argv.includes("--no-open") || AUTO ? "" : "  (opening it now)"}`);
if (!process.argv.includes("--no-open") && !AUTO) exec(process.platform === "win32" ? `start "" "${OUT}/review.html"` : `open "${OUT}/review.html"`);
