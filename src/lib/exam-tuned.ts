// Extra exam-writing rules found by the tuning loop (tools/exam-tune.mjs) and added to every exam prompt.
// Written by tools/exam-tune-apply.mjs from a review you approved. Empty means "no tuned rules yet".
export const TUNED_RULES = "";

/** What the tuning run measured (for the record; not sent to the model). */
export const TUNED_META: { date: string; trainScore: number; holdoutBefore: number; holdoutAfter: number; spentUsd: number } | null = null;
