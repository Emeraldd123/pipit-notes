// Persistent usage ledger (local only): what each AI feature has cost this month.
import { getMeta, setMeta } from "./db";
import { monthKey, monthTotal, record, type Ledger, type Usage } from "./ai-cost";

const KEY = "ai:ledger";
let cache: Ledger | null = null;
let chain: Promise<unknown> = Promise.resolve();
const listeners = new Set<() => void>();

export async function loadLedger(): Promise<Ledger> {
  if (!cache) cache = (await getMeta<Ledger>(KEY)) ?? {};
  return cache;
}
export async function recordUsage(feature: string, model: string, u: Usage): Promise<void> {
  // serialised so two calls finishing together can't overwrite each other's totals
  chain = chain.then(async () => {
    try {
      cache = record(await loadLedger(), feature, model, u);
      await setMeta(KEY, cache);
      listeners.forEach((l) => l());
    } catch { /* the ledger is advisory — never let it break an AI call */ }
  });
  await chain;
}
export async function spentThisMonth(): Promise<number> {
  return monthTotal(await loadLedger(), monthKey());
}
export async function resetLedger(): Promise<void> {
  cache = {};
  await setMeta(KEY, cache);
  listeners.forEach((l) => l());
}
export function onLedgerChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
