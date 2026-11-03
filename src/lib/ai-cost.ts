// Cost control for AI calls: prices, which model/effort each feature should use, estimates shown before
// expensive actions, and a local usage ledger. Pure + unit-tested.
//
// Why effort matters: current models think by default and thinking tokens are billed (and counted against
// max_tokens) as output. Simple jobs — reading handwriting, a one-line explanation — gain nothing from it.

export type Usage = { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
export type Effort = "low" | "medium" | "high";

/** USD per million tokens [input, output] — Anthropic's published rates (Haiku 5.5 for prompts up to 100K). */
const PRICES: [RegExp, [number, number]][] = [
  [/^claude-haiku-5/, [0.1, 0.5]],
  [/^claude-haiku-4/, [1, 5]],
  [/^claude-sonnet-5/, [2, 10]],
  [/^claude-sonnet-4/, [3, 15]],
  [/^claude-opus-5-5/, [4, 20]],
  [/^claude-opus/, [5, 25]],
  [/^claude-(?:fable|mythos)/, [10, 50]],
];
export const priceFor = (model: string): [number, number] => PRICES.find(([re]) => re.test(model))?.[1] ?? [2, 10];

export function costUsd(model: string, u: Usage): number {
  const [pin, pout] = priceFor(model);
  const fresh = u.input_tokens ?? 0, read = u.cache_read_input_tokens ?? 0, write = u.cache_creation_input_tokens ?? 0;
  return (fresh * pin + read * pin * 0.1 + write * pin * 1.25 + (u.output_tokens ?? 0) * pout) / 1e6;
}

// --- which model / how hard to think, per feature --------------------------------------------------------------
/** Jobs that are plain reading or short text answers: fine on the cheaper model. */
export const ROUTINE_FEATURES = new Set(["transcribe", "explain.followup", "map.link", "ask", "test"]);
/** Jobs that run by themselves while you write: always on the cheaper model, whatever the economy setting. */
export const ALWAYS_CHEAP = new Set(["mathcheck"]);

const BASE_EFFORT: Record<string, Effort> = {
  transcribe: "low", math: "low", working: "low", text: "low", graph: "low", chem: "low", test: "low",
  "cards.region": "low", "cards.text": "low", mathcheck: "low", "explain.followup": "low", "map.link": "low", "map.expand": "low", ask: "low",
  cards: "medium", explain: "medium", review: "medium", exam: "medium", "exam.mark": "medium", map: "medium", practice: "medium",
};

/** Models that accept `output_config.effort` (older ones reject it with a 400). */
export const supportsEffort = (model: string) => /^claude-(?:sonnet-5|haiku-5|opus-5|opus-4-[5-8]|sonnet-4-6|fable|mythos)/.test(model);

export function effortFor(feature: string, careful: boolean, model: string): Effort | undefined {
  if (!supportsEffort(model)) return undefined;
  const base = BASE_EFFORT[feature] ?? "low";
  return careful ? (base === "low" ? "medium" : "high") : base;
}

/** Thinking shares the max_tokens budget, so give it room (or long answers get cut off mid-JSON). */
export function maxTokensFor(base: number, effort: Effort | undefined): number {
  return base + (effort === "high" ? 6000 : effort === "medium" ? 3000 : effort === "low" ? 600 : 0);
}

export function modelFor(feature: string, s: { model: string; economy: boolean; economyModel: string }): string {
  return ALWAYS_CHEAP.has(feature) || (s.economy && ROUTINE_FEATURES.has(feature)) ? s.economyModel : s.model;
}

// --- estimates (rough: for "≈ $0.05" hints before an action) -------------------------------------------------------------
const PROFILE: Record<string, [number, number]> = {   // [input tokens, output tokens] per unit, before thinking
  transcribe: [2600, 700], math: [1500, 150], working: [1800, 500], text: [1500, 400], graph: [1500, 100], chem: [1500, 300],
  explain: [1800, 900], "explain.followup": [2000, 400], review: [3000, 900], cards: [6500, 3000], "cards.region": [1800, 900], "cards.text": [1500, 700], mathcheck: [1200, 250],
  map: [6500, 2000], "map.expand": [2000, 700], "map.link": [1500, 250], exam: [6500, 9000], "exam.mark": [2500, 700], ask: [3000, 500], practice: [6500, 2500],
};
const THINK_FACTOR: Record<Effort, number> = { low: 1.15, medium: 1.6, high: 2.2 };

export function estimateUsd(feature: string, units: number, s: { model: string; economy: boolean; economyModel: string; careful: boolean }): number {
  const model = modelFor(feature, s);
  const [i, o] = PROFILE[feature] ?? [2000, 500];
  const eff = effortFor(feature, s.careful, model);
  const out = o * (eff ? THINK_FACTOR[eff] : 1);
  return costUsd(model, { input_tokens: i * units, output_tokens: out * units });
}

export function formatUsd(v: number): string {
  if (v < 0.005) return "< 1¢";
  if (v < 0.1) return `≈ ${Math.round(v * 100)}¢`;
  return `≈ $${v.toFixed(2)}`;
}

// --- usage ledger (local, per month) ----------------------------------------------------------------------------------------------
export type LedgerRow = { calls: number; input: number; output: number; cached: number; usd: number };
export type Ledger = Record<string, Record<string, LedgerRow>>;   // "YYYY-MM" -> feature -> totals

export const monthKey = (t = Date.now()) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };

export function record(ledger: Ledger, feature: string, model: string, u: Usage, t = Date.now()): Ledger {
  const m = monthKey(t);
  const row = ledger[m]?.[feature] ?? { calls: 0, input: 0, output: 0, cached: 0, usd: 0 };
  const next: LedgerRow = {
    calls: row.calls + 1, input: row.input + (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0), output: row.output + (u.output_tokens ?? 0),
    cached: row.cached + (u.cache_read_input_tokens ?? 0), usd: row.usd + costUsd(model, u),
  };
  // keep the last 6 months only
  const months = Object.keys({ ...ledger, [m]: 1 }).sort().slice(-6);
  const out: Ledger = {};
  for (const k of months) out[k] = k === m ? { ...(ledger[k] ?? {}), [feature]: next } : ledger[k];
  return out;
}

export const monthTotal = (ledger: Ledger, m = monthKey()) => Object.values(ledger[m] ?? {}).reduce((s, r) => s + r.usd, 0);
export const monthByFeature = (ledger: Ledger, m = monthKey()) => Object.entries(ledger[m] ?? {}).map(([feature, r]) => ({ feature, ...r })).sort((a, b) => b.usd - a.usd);

export const FEATURE_LABEL: Record<string, string> = {
  transcribe: "Reading handwriting for search", math: "Recognising maths", working: "Checking working", text: "Handwriting to text", graph: "Graph it", chem: "Chemistry check",
  explain: "Explain", "explain.followup": "Explain follow-ups", review: "Review for mistakes", cards: "Flashcards from notes", "cards.region": "Flashcards from a lasso",
  "cards.text": "Flashcards from text", map: "Concept maps", "map.expand": "Expanding concepts", "map.link": "Explaining links", exam: "Writing exams", "exam.mark": "Marking exams",
  ask: "Ask your notes", practice: "Practice questions", test: "Connection tests", mathcheck: "Math check as you write",
};
