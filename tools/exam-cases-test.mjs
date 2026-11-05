// Does case memory stop exams from reusing the same real-world cases? Writes several papers in a row on the same
// notes WITH memory (exactly as the app does: each paper is told the scenarios of the earlier ones), then counts how
// often the usual cases come back, against the same count over runs of papers written WITHOUT memory in the last
// saved tuning run (already paid for). Counting, not judging: no judge noise.
//
//   npm run eval:cases                         (physics and biology, 4 papers each; at most $2.50)
//   npm run eval:cases -- --subjects phys,bio,chem --papers 4 --budget 4
//   node tools/exam-cases-test.mjs --mock      (free rehearsal)
// A pilot comes first: if the first paper doesn't tag its scenarios, it stops there (about 20 cents).
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { chooseStyleExamples } from "../src/lib/past-exams.ts";
import { avoidList, remember, repeats, scenariosOf } from "../src/lib/case-memory.ts";
import { BudgetError, makeApi, writeExam } from "./exam-lab.mjs";
import { FIXTURES } from "./exam-fixtures.mjs";

const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : dflt; };
const MOCK = process.argv.includes("--mock");
const KEY = MOCK ? "mock" : process.env.ANTHROPIC_API_KEY?.trim();
if (!KEY) { console.error("Set ANTHROPIC_API_KEY (your own key), or run with --mock."); process.exit(1); }
const BUDGET = Math.min(10, Number(arg("budget", "2.5")));
const PAPERS = Number(arg("papers", "4"));
const SUBJECTS = arg("subjects", "phys,bio").split(",").map((id) => FIXTURES.find((f) => f.id === id)).filter(Boolean);
const api = makeApi({ key: KEY, model: arg("model", "claude-sonnet-5-5"), budget: BUDGET, log: console.log, ...(MOCK ? { fetchImpl: (await import("./exam-mock.mjs")).mockFetch } : {}) });
const BUILTIN = JSON.parse(readFileSync("public/ocw/exams.json", "utf8")).exams;

// the cases that kept coming back without memory (counted in the last tuning run)
const USUAL = {
  phys: /car battery|battery|headlight|filament|heater|extension (cord|lead)|kettle|toaster|jump.?start/gi,
  bio: /yeast|muscle|cyanide|sprint|dinitrophenol|\bdnp\b|oligomycin|marathon|brown fat|thermogenin/gi,
  chem: /\bhi\b|hydrogen iodide|ammonia|haber|n2o4|no2|lime|caco3|carbonat/gi,
  econ: /\btax|ceiling|floor|rent|coffee|subsid|minimum wage|concert/gi,
  stats: /20 tests|blood pressure|\bdrug|vitamin|website|a\/b/gi,
};
const textOf = (q) => `${q.stem} ${q.parts.map((p) => p.prompt).join(" ")}`.toLowerCase();
const casesIn = (qs, re) => new Set(qs.flatMap((q) => textOf(q).match(re) ?? []).map((w) => w.replace(/s$/, "")));
/** for a run of papers: how many papers each usual case shows up in, and the worst one */
function reuse(paperQs, re) {
  const count = {};
  for (const qs of paperQs) for (const c of casesIn(qs, re)) count[c] = (count[c] ?? 0) + 1;
  const top = Object.entries(count).sort((a, b) => b[1] - a[1]);
  return { appearances: top.reduce((n, [, k]) => n + k, 0), worst: top[0] ?? ["-", 0], top: top.slice(0, 5) };
}

// --- before: windows of PAPERS consecutive papers from the last saved run (no memory) ------------------------------
const before = {};
const saved = readdirSync("data/exam-tune").filter((d) => !d.endsWith("-mock")).sort().reverse();
for (const d of saved) {
  try {
    const r = JSON.parse(readFileSync(`data/exam-tune/${d}/run.json`, "utf8"));
    for (const f of SUBJECTS) {
      const papers = r.rounds.flatMap((x) => x.papers).filter((p) => p.subject === f.id && !p.error && p.questions?.[0]?.full).map((p) => p.questions.map((q) => q.full));
      if (papers.length < PAPERS || before[f.id]) continue;
      const windows = [];
      for (let i = 0; i + PAPERS <= papers.length; i++) windows.push(reuse(papers.slice(i, i + PAPERS), USUAL[f.id]));
      const avg = (k) => windows.reduce((n, w) => n + (k === "worst" ? w.worst[1] : w[k]), 0) / windows.length;
      before[f.id] = { appearances: avg("appearances"), worst: avg("worst"), windows: windows.length, from: d };
    }
  } catch { /* not a usable run */ }
}

// --- after: write PAPERS papers in a row per subject, with memory ------------------------------------------------
console.log(`Case memory test: ${SUBJECTS.map((f) => f.id).join(", ")}, ${PAPERS} papers each, budget $${BUDGET}.`);
const after = {};
const lines = [`# Case memory test — ${new Date().toISOString()}`, ""];
try {
  for (const [si, f] of SUBJECTS.entries()) {
    let memory = [];
    const papers = [];
    let reusedTotal = 0;
    for (let k = 1; k <= PAPERS; k++) {
      const w = await writeExam(api, f, { past: chooseStyleExamples(f.pages, [], BUILTIN), avoidCases: avoidList(memory) });
      const tags = scenariosOf(w.exam);
      const reused = repeats(w.exam, memory);
      reusedTotal += reused.length;
      papers.push(w.qs);
      console.log(`  ${f.id} paper ${k}: ${w.qs.length} questions, ${tags.length} scenarios tagged${reused.length ? `, ${reused.length} reused (${reused.map((r) => r.scenario).join("; ")})` : ""} · spent $${api.ledger.spent.toFixed(2)}`);
      lines.push(`- ${f.id} paper ${k}: ${tags.map((t) => `"${t}"`).join(", ") || "(no scenarios tagged)"}`);
      if (si === 0 && k === 1 && tags.length < w.qs.length / 2) {
        throw new Error(`pilot: the first paper tagged only ${tags.length} of ${w.qs.length} scenarios, so memory can't work yet. Stopped here to save money.`);
      }
      memory = remember(memory, w.exam, k);
    }
    after[f.id] = { ...reuse(papers, USUAL[f.id]), reusedTotal };
  }
} catch (e) { console.log(e instanceof BudgetError ? `Stopped at the spending cap: ${e.message}` : `Stopped: ${e.message}`); lines.push("", `Stopped: ${e.message}`); }

const summary = SUBJECTS.filter((f) => after[f.id]).map((f) => {
  const a = after[f.id], b = before[f.id];
  return `${f.id}: usual cases appear ${a.appearances} times in ${PAPERS} papers with memory` +
    (b ? ` vs ${b.appearances.toFixed(1)} without (average of ${b.windows} runs of ${PAPERS} papers)` : " (no saved run to compare with)") +
    ` · most reused: "${a.worst[0]}" in ${a.worst[1]} of ${PAPERS} papers${b ? ` (without memory, the most reused case was in ${b.worst.toFixed(1)})` : ""}` +
    ` · scenarios the local check still found repeated: ${a.reusedTotal}`;
});
lines.splice(2, 0, ...summary.map((s) => `- ${s}`), "", `spent $${api.ledger.spent.toFixed(2)}`, "", "## Scenarios per paper", "");
mkdirSync("data/exam-cases", { recursive: true });
const out = `data/exam-cases/${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}${MOCK ? "-mock" : ""}.md`;
writeFileSync(out, lines.join("\n"));
console.log(`\n${summary.join("\n")}\n\nSpent $${api.ledger.spent.toFixed(2)}. Report: ${out}`);
