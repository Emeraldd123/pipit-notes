// Writes src/lib/exam-tuned.ts (the tuned house rules every exam prompt includes). Used by tune:apply and tune:auto.
import { writeFileSync } from "node:fs";

export const TUNED_FILE = "src/lib/exam-tuned.ts";

export function writeTuned(rules, meta) {
  writeFileSync(TUNED_FILE, `// Extra exam-writing rules found by the tuning loop (tools/exam-tune.mjs) and added to every exam prompt.
// Written by the tuning tools (tune:apply after a review, or tune:auto when the rules beat the old ones). Empty = none yet.
export const TUNED_RULES = ${JSON.stringify(rules)};

/** What the tuning run measured (for the record; not sent to the model). */
export const TUNED_META: { date: string; trainScore: number; holdoutBefore: number; holdoutAfter: number; spentUsd: number } | null = ${meta ? JSON.stringify(meta) : "null"};
`);
}
