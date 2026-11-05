// Does "Double-check answers" help? For each sample paper: write it with the app's prompt, run the app's checker on
// it, then have the strict judge look ONLY at what the checker changed, side by side and in random order: was each
// fix an improvement, was each dropped part really broken? Because both versions are the same paper, the only
// difference is the check itself, so a few dozen samples give a clear answer (unlike scoring whole papers).
//
//   npm run eval:ab                      (asks for your key; 8 subjects × 2 papers; at most $5)
//   npm run eval:ab -- --reps 3 --budget 8
//   node tools/exam-ab.mjs --mock        (free dry run against a fake API)
// Report: data/exam-ab/<run>.md (gitignored).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parseModelJson } from "../src/lib/json-repair.ts";
import { chooseStyleExamples } from "../src/lib/past-exams.ts";
import { applyChecks, findCheck, normalizeChecks, verifyUserText, VERIFY_SYSTEM } from "../src/lib/exam-verify.ts";
import { effortFor } from "../src/lib/ai-cost.ts";
import { BudgetError, makeApi, writeExam } from "./exam-lab.mjs";
import { FIXTURES, HOLDOUT } from "./exam-fixtures.mjs";

const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : dflt; };
const MOCK = process.argv.includes("--mock");
const KEY = MOCK ? "mock" : process.env.ANTHROPIC_API_KEY?.trim();
if (!KEY) { console.error("Set ANTHROPIC_API_KEY (your own key), or run with --mock."); process.exit(1); }
const BUDGET = Math.min(10, Number(arg("budget", "5")));
const REPS = Number(arg("reps", "2"));
const MODEL = arg("model", "claude-sonnet-5-5");
const api = makeApi({ key: KEY, model: MODEL, budget: BUDGET, log: console.log, ...(MOCK ? { fetchImpl: (await import("./exam-mock.mjs")).mockFetch } : {}) });
const BUILTIN = JSON.parse(readFileSync("public/ocw/exams.json", "utf8")).exams;
const SUBJECTS = [...FIXTURES, ...HOLDOUT];
const STAMP = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19) + (MOCK ? "-mock" : "");
const RAW = `data/exam-ab/${STAMP}-raw`;
mkdirSync(RAW, { recursive: true });

const JUDGE = `You are a strict head of department. A second examiner checked an exam paper and changed some parts. Judge each change independently: work the part out yourself from the stem, figure and notes first.
For a FIX you see the part's two versions, "1" and "2", in random order. Say which is better as an exam part ("1", "2" or "same"), and whether each version is correct (the answer follows from the given data, exactly one keyed option is right, the scheme matches).
For a DROP you see the removed part. Say whether it really was broken (wrong answer or key, data that doesn't support the answer, two defensible answers, needs knowledge not given) or whether a good part was lost.
Return STRICT JSON only: {"changes":[{"id":"c1","better":"1"|"2"|"same","v1_correct":true,"v2_correct":false},{"id":"c2","broken":true}]}`;

const fig = (f) => (f ? `\n   FIGURE: ${JSON.stringify(f).slice(0, 2500)}` : "");
const partText = (p) => `[${p.type}, ${p.marks} marks] ${p.prompt}${fig(p.figure)}${p.options ? `\n   options: ${p.options.map((o, i) => `${i === p.correct ? "*" : ""}[${i}] ${o}`).join(" | ")}` : ""}\n   answer: ${p.answer}\n   scheme: ${p.scheme.join(" / ")}`;

async function sample(f, rep) {
  const past = chooseStyleExamples(f.pages, [], BUILTIN);
  const w = await writeExam(api, f, { past }).catch((e) => { throw new Error(`writing the exam: ${e.message}`); });
  const v = await api.call(VERIFY_SYSTEM, [{ type: "text", text: verifyUserText(w.exam, w.excerpts) }], 8000, effortFor("exam.verify", false, MODEL));
  // keep every raw reply, so a surprising result can be looked at instead of guessed at
  writeFileSync(`${RAW}/${f.id}-${rep}-checker.txt`, `stop: ${v.stop} · output tokens: ${v.usage?.output_tokens}\n\n${v.text}`);
  let checks = [], flagged = 0;
  try {
    const raw = parseModelJson(v.text);
    flagged = Array.isArray(raw?.checks) ? raw.checks.length : 0;
    checks = normalizeChecks(raw);
  } catch { return { subject: f.id, rep, error: `checker reply unreadable (stop: ${v.stop}, ${v.usage?.output_tokens} output tokens)` }; }
  const r = applyChecks(w.exam, checks);
  const before = w.exam.sections.flatMap((s) => s.questions);
  const after = new Map(r.exam.sections.flatMap((s) => s.questions).map((q) => [q.id, q]));
  // pair up every changed part
  const changes = [];
  for (const q of before) for (const p of q.parts) {
    const c = findCheck(checks, q, p.label || "-");
    if (!c) continue;
    const np = after.get(q.id)?.parts.find((x) => x.id === p.id);
    const flip = Math.random() < 0.5;
    changes.push(np ? { kind: "fix", q, p, np, flip, problem: c.problem } : { kind: "drop", q, p, problem: c.problem });
  }
  const parts = before.reduce((n, q) => n + q.parts.length, 0);
  if (!changes.length) return { subject: f.id, rep, parts, flagged, changes: [] };
  const text = changes.map((c, i) => {
    const head = `c${i + 1} (${c.kind.toUpperCase()}) question ${c.q.id}: ${c.q.stem}${fig(c.q.figure)}`;
    if (c.kind === "drop") return `${head}\n  removed part: ${partText(c.p)}`;
    const [one, two] = c.flip ? [c.np, c.p] : [c.p, c.np];
    return `${head}\n  version 1: ${partText(one)}\n  version 2: ${partText(two)}`;
  }).join("\n\n");
  const j = await api.call(JUDGE, [{ type: "text", text: `Student's notes:\n${w.excerpts.map((e) => `[${e.n}] ${e.text}`).join("\n\n")}\n\nChanges to judge:\n\n${text}` }], 3000, "low");
  const verdicts = parseModelJson(j.text)?.changes ?? [];
  return {
    subject: f.id, rep, parts, flagged,
    changes: changes.map((c, i) => {
      const d = verdicts.find((x) => x.id === `c${i + 1}`) ?? {};
      if (c.kind === "drop") return { kind: "drop", problem: c.problem, broken: d.broken === true, stem: c.q.stem.slice(0, 100) };
      const better = d.better === "same" ? "same" : (d.better === "1") === c.flip ? "fixed" : d.better ? "original" : "?";
      const origOk = c.flip ? d.v2_correct : d.v1_correct, newOk = c.flip ? d.v1_correct : d.v2_correct;
      return { kind: "fix", problem: c.problem, better, origCorrect: origOk === true, newCorrect: newOk === true, stem: c.q.stem.slice(0, 100) };
    }),
  };
}

console.log(`Double-check A/B: ${SUBJECTS.length} subjects × ${REPS} papers, budget $${BUDGET}.`);
const results = [];
outer: for (let rep = 1; rep <= REPS; rep++) {
  const settled = await Promise.allSettled(SUBJECTS.map((f) => sample(f, rep)));
  for (const [i, s] of settled.entries()) {
    const r = s.status === "fulfilled" ? s.value : { subject: SUBJECTS[i].id, rep, error: String(s.reason?.message ?? s.reason) };
    results.push(r);
    console.log(r.error ? `  ${r.subject} #${rep}: ERROR ${r.error}` : `  ${r.subject} #${rep}: checker flagged ${r.flagged}, ${r.changes.length} applied, of ${r.parts} parts`);
    if (s.status === "rejected" && s.reason instanceof BudgetError) break outer;
  }
}

const ok = results.filter((r) => !r.error);
const all = ok.flatMap((r) => r.changes);
const fixes = all.filter((c) => c.kind === "fix"), drops = all.filter((c) => c.kind === "drop");
const parts = ok.reduce((n, r) => n + r.parts, 0);
const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : "–");
const brokenBefore = fixes.filter((c) => !c.origCorrect).length + drops.filter((c) => c.broken).length;
const brokenAfter = fixes.filter((c) => !c.newCorrect).length;
const lost = drops.filter((c) => !c.broken).length;
const lines = [
  `# Double-check A/B — ${new Date().toISOString()}`, "",
  `model ${MODEL} · ${ok.length} papers · ${parts} parts · spent $${api.ledger.spent.toFixed(2)}`, "",
  `- Papers the checker changed: ${ok.filter((r) => r.changes.length).length} of ${ok.length}`,
  `- Fixes: ${fixes.length} — judged better ${pct(fixes.filter((c) => c.better === "fixed").length, fixes.length)}, worse ${pct(fixes.filter((c) => c.better === "original").length, fixes.length)}, no different ${pct(fixes.filter((c) => c.better === "same").length, fixes.length)}`,
  `- Drops: ${drops.length} — really broken ${pct(drops.filter((c) => c.broken).length, drops.length)}`,
  `- Broken parts reaching the student: **${brokenBefore} without the check → ${brokenAfter} with it** (of the ${parts} parts; plus ${lost} good part${lost === 1 ? "" : "s"} removed by mistake)`,
  "", "## Every change", "",
  ...all.map((c) => `- [${c.kind}] ${c.stem}… — checker: ${c.problem}${c.kind === "fix" ? ` → judge: ${c.better === "fixed" ? "better" : c.better === "original" ? "WORSE" : c.better}${c.origCorrect ? "" : " (original was wrong)"}${c.newCorrect ? "" : " (fixed version still wrong)"}` : ` → judge: ${c.broken ? "rightly removed" : "GOOD PART LOST"}`}`),
];
mkdirSync("data/exam-ab", { recursive: true });
const out = `data/exam-ab/${STAMP}.md`;
writeFileSync(out, lines.join("\n"));
console.log(`\n${lines.slice(2, 8).join("\n")}\n\nReport: ${out}`);
