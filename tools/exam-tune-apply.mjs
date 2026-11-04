// Puts the rules from a saved tuning review (tools/tune-review.html → "Save my review") into the app:
// rewrites src/lib/exam-tuned.ts, which every exam prompt includes. No API key, no cost.
//   npm run tune:apply -- path/to/review-<run>.json
//   npm run tune:apply -- --clear        (back to no tuned rules)
import { readFileSync, writeFileSync } from "node:fs";
import { buildExamPrompt } from "../src/lib/exam-prompt.ts";
import { FIXTURES, HOLDOUT } from "./exam-fixtures.mjs";
import { distinctiveWords, leaks } from "./exam-variety.mjs";

const FILE = "src/lib/exam-tuned.ts";
const write = (rules, meta) => writeFileSync(FILE, `// Extra exam-writing rules found by the tuning loop (tools/exam-tune.mjs) and added to every exam prompt.
// Written by tools/exam-tune-apply.mjs from a review you approved. Empty means "no tuned rules yet".
export const TUNED_RULES = ${JSON.stringify(rules)};

/** What the tuning run measured (for the record; not sent to the model). */
export const TUNED_META: { date: string; trainScore: number; holdoutBefore: number; holdoutAfter: number; spentUsd: number } | null = ${meta ? JSON.stringify(meta) : "null"};
`);

if (process.argv.includes("--clear")) { write("", null); console.log(`Cleared the tuned rules in ${FILE}.`); process.exit(0); }
const path = process.argv.slice(2).find((a) => !a.startsWith("--"));
if (!path) { console.error("Usage: npm run tune:apply -- path/to/review-<run>.json   (or --clear)"); process.exit(1); }
const review = JSON.parse(readFileSync(path, "utf8"));
if (review.kind !== "pipit-exam-tune-review") { console.error("That isn't a saved tuning review."); process.exit(1); }
if (review.decision !== "apply" && !process.argv.includes("--force")) {
  console.error(`This review's decision is "${review.decision}", not "apply". Change it on the review page, or pass --force.`); process.exit(1);
}
const rules = String(review.rules ?? "").trim();
if (rules.length > 2500) { console.error(`The rules are ${rules.length} characters; keep them under 2500 so they don't crowd the prompt.`); process.exit(1); }
const base = buildExamPrompt({ excerpts: [], questions: 8, difficulty: "same", style: "", figures: true, cases: true, extraRules: "" }).system;
const leaked = leaks(rules, distinctiveWords([...FIXTURES, ...HOLDOUT]), base);
if (leaked.length >= 3) console.warn(`Warning: the rules mention topic words from the sample notes (${leaked.join(", ")}). They should be general for any subject.`);
const s = review.scores ?? {};
write(rules, { date: review.savedAt?.slice(0, 10) ?? new Date().toISOString().slice(0, 10), trainScore: +(s.best ?? 0).toFixed(3), holdoutBefore: +(s.holdoutBefore ?? 0).toFixed(3), holdoutAfter: +(s.holdoutAfter ?? 0).toFixed(3), spentUsd: +(s.spent ?? 0).toFixed(2) });
console.log(`Applied ${rules.split("\n").filter(Boolean).length} rules to ${FILE}${review.rulesEdited ? " (your edited version)" : ""}.`);
console.log("Next: npm run check, then deploy (drag dist onto bensnotes) so the app uses them.");
