// (Re)builds a tuning run's review page from its saved data, with every question drawn the way the app shows it.
// No key, no cost. The tuning loop calls this itself; run it by hand to refresh an older run's page:
//   npm run tune:review -- data/exam-tune/<run>
import { readFileSync, writeFileSync } from "node:fs";
import { exec } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseQuestionText, questionHtml } from "./question-html.mjs";

export function buildReview(dir) {
  const run = JSON.parse(readFileSync(`${dir}/run.json`, "utf8"));
  const papers = [...run.rounds.flatMap((r) => r.papers), ...(run.holdout?.papersBefore ?? []), ...(run.holdout?.papersAfter ?? [])];
  for (const p of papers) for (const q of p.questions ?? []) {
    try { q.html = questionHtml(q.full ?? parseQuestionText(q.text)); }
    catch (e) { q.html = `<p class="bad small">Couldn't draw this question (${String(e.message).slice(0, 80)}); the text version is below.</p>`; }
  }
  const tpl = readFileSync("tools/tune-review.html", "utf8");
  writeFileSync(`${dir}/review.html`, tpl.replace("/*__RUN__*/null", JSON.stringify(run).replace(/</g, "\\u003c")));
  return `${dir}/review.html`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2]?.replace(/[\\/]+$/, "").replace(/[\\/]review\.html$/, "");
  if (!dir) { console.error("Usage: npm run tune:review -- data/exam-tune/<run>"); process.exit(1); }
  const out = buildReview(dir);
  console.log(`Rebuilt ${out}`);
  if (!process.argv.includes("--no-open")) exec(process.platform === "win32" ? `start "" "${out}"` : `open "${out}"`);
}
