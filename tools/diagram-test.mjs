// Do exam diagrams use the Bioicons well? Writes a short exam (the app's real prompt, figures on) for each realistic
// scenario in tools/diagram-scenarios.mjs, runs the automatic diagram checks (tools/diagram-checks.mjs), and makes a
// page with every diagram drawn the way the app draws it, its question, and any flags. Hard spending cap.
//
//   npm run eval:diagrams                  (12 scenarios, 4 questions each; about $1, at most $1.50)
//   npm run eval:diagrams -- --only etc,photo --questions 3
//   node tools/diagram-test.mjs --mock     (free rehearsal)
// Output: data/diagram-test/<run>/index.html (opens when done).
import { mkdirSync, writeFileSync } from "node:fs";
import { exec } from "node:child_process";
import { parseModelJson } from "../src/lib/json-repair.ts";
import { BudgetError, makeApi, questionText, writeExam } from "./exam-lab.mjs";
import { checkQuestion, strayLabels, unknownIcons } from "./diagram-checks.mjs";
import { questionHtml } from "./question-html.mjs";
import { SCENARIOS } from "./diagram-scenarios.mjs";

const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : dflt; };
const MOCK = process.argv.includes("--mock");
const KEY = MOCK ? "mock" : process.env.ANTHROPIC_API_KEY?.trim();
if (!KEY) { console.error("Set ANTHROPIC_API_KEY (your own key), or run with --mock."); process.exit(1); }
const BUDGET = Math.min(5, Number(arg("budget", "1.5")));
const QUESTIONS = Number(arg("questions", "4"));
const only = arg("only", "")?.split(",").filter(Boolean);
const scenarios = SCENARIOS.filter((s) => !only?.length || only.includes(s.id));
const api = makeApi({ key: KEY, model: arg("model", "claude-sonnet-5-5"), budget: BUDGET, log: console.log, ...(MOCK ? { fetchImpl: (await import("./exam-mock.mjs")).mockFetch } : {}) });
const STAMP = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19) + (MOCK ? "-mock" : "");
const OUT = `data/diagram-test/${STAMP}`;
mkdirSync(OUT, { recursive: true });

async function run(s) {
  let w;
  try { w = await writeExam(api, s, { questions: QUESTIONS }); }
  catch (e) { if (e.raw) writeFileSync(`${OUT}/${s.id}-raw-FAILED.txt`, e.raw); throw e; }   // keep the reply so a failure can be read
  writeFileSync(`${OUT}/${s.id}-raw.txt`, w.raw);
  let raw = null;
  try { raw = parseModelJson(w.raw); } catch { /* the app's own reading already succeeded */ }
  const qs = w.qs.map((q) => ({ q, c: checkQuestion(q) }));
  return { s, qs, unknown: raw ? unknownIcons(raw) : [], stray: raw ? strayLabels(raw) : [], diagrams: qs.reduce((n, x) => n + x.c.diagrams, 0) };
}

console.log(`Diagram test: ${scenarios.length} scenarios × ${QUESTIONS} questions, budget $${BUDGET}.`);
const results = [];
try {
  // pilot: the first scenario alone, so a broken setup costs one exam
  const first = await run(scenarios[0]);
  results.push(first);
  console.log(`  ${first.s.id}: ${first.diagrams} diagram${first.diagrams === 1 ? "" : "s"}, icons ${[...new Set(first.qs.flatMap((x) => x.c.icons))].join(", ") || "none"} · $${api.ledger.spent.toFixed(2)}`);
  if (!first.qs.length) throw new Error("pilot: the first exam had no questions; stopping to save money");
  for (let i = 1; i < scenarios.length; i += 4) {
    const batch = await Promise.allSettled(scenarios.slice(i, i + 4).map(run));
    for (const [k, b] of batch.entries()) {
      if (b.status === "rejected") { console.log(`  ${scenarios[i + k].id}: ERROR ${b.reason?.message ?? b.reason}`); if (b.reason instanceof BudgetError) throw b.reason; continue; }
      results.push(b.value);
      const r = b.value;
      console.log(`  ${r.s.id}: ${r.diagrams} diagram${r.diagrams === 1 ? "" : "s"}, icons ${[...new Set(r.qs.flatMap((x) => x.c.icons))].join(", ") || "none"}${r.unknown.length ? `, unknown: ${r.unknown.join(", ")}` : ""}, flags ${r.qs.reduce((n, x) => n + x.c.flags.length, 0)} · $${api.ledger.spent.toFixed(2)}`);
    }
  }
} catch (e) { console.log(e instanceof BudgetError ? `Stopped at the spending cap: ${e.message}` : `Stopped: ${e.message}`); }

// --- the page ---------------------------------------------------------------------------------------------------------
const esc = (t) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const allQs = results.flatMap((r) => r.qs);
const withDiagram = allQs.filter((x) => x.c.diagrams);
const withIcons = withDiagram.filter((x) => x.c.icons.length);
const flagged = withDiagram.filter((x) => x.c.flags.length);
const summary = [
  `${results.length} scenarios · ${allQs.length} questions · ${withDiagram.length} with a diagram · ${withIcons.length} of those use icons · ${flagged.length} flagged · spent $${api.ledger.spent.toFixed(2)}`,
  `Unknown icon names tried: ${[...new Set(results.flatMap((r) => r.unknown))].join(", ") || "none"} · labels pointing at icons not in the diagram: ${[...new Set(results.flatMap((r) => r.stray))].join(", ") || "none"}`,
];
const section = (r) => {
  const used = [...new Set(r.qs.flatMap((x) => x.c.icons))];
  const diag = r.qs.filter((x) => x.c.diagrams);
  return `<section><h2>${esc(r.s.title)}</h2>
    <p class="muted">${diag.length} of ${r.qs.length} questions have a diagram · icons used: ${esc(used.join(", ") || "none")} · a good diagram might use: ${esc(r.s.expect.join(", ") || "(none available: tests the fallback)")}${r.unknown.length ? ` · <b class="bad">unknown icons tried: ${esc(r.unknown.join(", "))}</b>` : ""}</p>
    ${diag.map((x) => `<div class="paper">${x.c.flags.length ? `<ul class="flags">${x.c.flags.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>` : `<p class="ok">✓ no automatic flags</p>`}${questionHtml({ ...x.q, kind: x.q.basis?.kind, principle: x.q.basis?.principle })}
      <details><summary>Text form</summary><pre>${esc(questionText(x.q))}</pre></details></div>`).join("") || `<p class="muted">No diagrams in this exam.</p>`}
  </section>`;
};
writeFileSync(`${OUT}/index.html`, `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Diagram test</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css">
<script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js"></script>
<script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/contrib/auto-render.min.js" onload="renderMathInElement(document.body,{delimiters:[{left:'$',right:'$',display:false}],throwOnError:false})"></script>
<style>body{font:15px/1.5 system-ui,sans-serif;max-width:900px;margin:0 auto;padding:20px 16px;background:#f7f7f5;color:#1c1c1a}h1{font-size:22px}h2{font-size:17px;margin-top:28px}
.muted{color:#6b6b66;font-size:13px}.small{font-size:12px}.paper{background:#fff;border:1px solid #e3e2dd;border-radius:12px;padding:14px 16px;margin:10px 0}
.flags{background:#fff4e5;border-radius:8px;padding:8px 8px 8px 26px;margin:0 0 8px;color:#8a4b00;font-size:13px}.ok{color:#2f7d32;font-size:13px;margin:0 0 6px}.bad{color:#b3261e}
.qview .stem{white-space:pre-wrap}.fig{margin:10px auto;max-width:560px;text-align:center}.fig svg{width:100%;height:auto}.fig figcaption{font-size:12px;color:#6b6b66}
.ftable{border-collapse:collapse;margin:0 auto}.ftable th,.ftable td{border:1px solid #a3a3a3;padding:4px 10px}.part{border-top:1px dashed #dcdcd6;padding-top:8px;margin-top:8px}.prompt{white-space:pre-wrap}
.opts{list-style:none;padding:0;display:grid;gap:4px}.opts li{display:flex;gap:8px;border:1px solid #e3e2dd;border-radius:8px;padding:6px 8px}.opts li.right{border-color:#2f7d32;background:#f1f8f1}.why{display:block;font-size:12px;color:#6b6b66}.tick{margin-left:auto;color:#2f7d32}
.chip{display:inline-block;background:#eef3ef;color:#2f6f4f;border-radius:999px;padding:1px 8px;font-size:12px}pre{white-space:pre-wrap;font-size:12px;background:#f7f7f5;padding:8px;border-radius:8px}details summary{cursor:pointer;color:#6b6b66;font-size:13px}</style></head>
<body><h1>Diagram test</h1>${summary.map((l) => `<p>${esc(l)}</p>`).join("")}${results.map(section).join("")}</body></html>`);
console.log(`\n${summary.join("\n")}\n\nPage: ${OUT}/index.html`);
if (!process.argv.includes("--no-open")) exec(process.platform === "win32" ? `start "" "${OUT}/index.html"` : `open "${OUT}/index.html"`);
