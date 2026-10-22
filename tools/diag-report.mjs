// Analyse Pipit Notes diagnostics reports.
//
//   node tools/diag-report.mjs report.json [more.json …]
//   node tools/diag-report.mjs --url https://YOUR-SITE/.netlify/functions/diag --token TOKEN [--limit 20] [--hours 48]
//
// Prints, per report, the device, health, errors, flagged problems and metrics — then
// a rollup across all of them so recurring problems stand out.
import { readFileSync } from "node:fs";
import { summarizeReport } from "../src/lib/telemetry-core.ts";

const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const files = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--")));

let reports = [];
if (opt("--url")) {
  const url = new URL(opt("--url"));
  url.searchParams.set("limit", opt("--limit", "20"));
  const hours = Number(opt("--hours", 0));
  if (hours) url.searchParams.set("since", String(Date.now() - hours * 3600_000));
  const res = await fetch(url, { headers: { authorization: `Bearer ${opt("--token", process.env.DIAG_READ_TOKEN ?? "")}` } });
  if (!res.ok) { console.error(`Fetch failed: ${res.status} ${await res.text()}`); process.exit(1); }
  reports = (await res.json()).reports;
} else if (files.length) {
  for (const f of files) {
    const j = JSON.parse(readFileSync(f, "utf8"));
    reports.push(...(Array.isArray(j.reports) ? j.reports : [j]));
  }
} else {
  console.error("Usage: node tools/diag-report.mjs <report.json…>  |  --url <endpoint> --token <token> [--limit N] [--hours H]");
  process.exit(1);
}
if (!reports.length) { console.log("No reports."); process.exit(0); }

const rank = { bad: 2, warn: 1, ok: 0 };
const rollup = { bySeverity: { ok: 0, warn: 0, bad: 0 }, errors: new Map(), findings: new Map(), devices: new Set() };

for (const r of reports.sort((a, b) => (a.generatedAt ?? 0) - (b.generatedAt ?? 0))) {
  const s = summarizeReport(r);
  console.log("\n" + "═".repeat(78));
  console.log(`[${s.severity.toUpperCase()}]  ${s.lines[0]}`);
  for (const l of s.lines.slice(1)) console.log(l);
  if (s.findings.length) { console.log("Findings:"); for (const f of s.findings) console.log("  " + f); }
  else console.log("Findings: none");
  rollup.bySeverity[s.severity]++;
  rollup.devices.add(String(r.env?.ua ?? "?").slice(0, 60));
  for (const f of s.findings) rollup.findings.set(f, (rollup.findings.get(f) ?? 0) + 1);
  for (const e of (r.recent ?? []).filter((x) => x.level === "error")) {
    const k = `${e.area}: ${e.msg}`;
    rollup.errors.set(k, (rollup.errors.get(k) ?? 0) + 1);
  }
}

console.log("\n" + "█".repeat(78));
console.log(`ROLLUP — ${reports.length} report(s) · ok ${rollup.bySeverity.ok} · warn ${rollup.bySeverity.warn} · bad ${rollup.bySeverity.bad} · ${rollup.devices.size} device(s)`);
const top = (m, n = 8) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
if (rollup.errors.size) { console.log("Most frequent errors:"); for (const [k, n] of top(rollup.errors)) console.log(`  ×${n}  ${k}`); }
if (rollup.findings.size) { console.log("Most frequent findings:"); for (const [k, n] of top(rollup.findings)) console.log(`  ×${n}  ${k}`); }
process.exit(rollup.bySeverity.bad ? 2 : 0);
