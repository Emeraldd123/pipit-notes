// Gemini as the middle step: laptop → Gemini → Claude. Used only when a Gemini key is set, only for the jobs its
// scope allows (the same lists as the laptop; exams stay on Claude), and only while this month's estimated Gemini
// spend is under the cap (your Google credit). A reply that doesn't parse, is cut off or blocked goes on to Claude.
// Logged content-free: counts, timings, and the reason for a fallback.
import { getSettings, type Settings } from "./settings";
import { count, track, warn } from "./telemetry";
import { localAllowed, replyUsable, type Content } from "./local-ai-core.ts";
import { GEMINI_BASE, GEMINI_DEFAULT_MODEL, geminiBody, geminiCostUsd, readGeminiReply } from "./gemini-core.ts";
import { getMeta, setMeta } from "./db";
import { monthKey } from "./ai-cost";

export class GeminiSkip extends Error {}

export const geminiReady = (s: Settings = getSettings()) => s.geminiKey.trim().length > 20;
const modelOf = (s: Settings) => s.geminiModel.trim() || GEMINI_DEFAULT_MODEL;

// --- this month's Gemini spend (its own tally: it's paid from Google credit, not your Anthropic budget) ---------
type Tally = Record<string, { calls: number; usd: number }>;   // "YYYY-MM" -> totals
const KEY = "ai:gemini-tally";
let tally: Tally | null = null;
const listeners = new Set<() => void>();
async function loadTally(): Promise<Tally> { if (!tally) tally = (await getMeta<Tally>(KEY).catch(() => undefined)) ?? {}; return tally; }
export async function geminiSpent(): Promise<{ calls: number; usd: number }> { return (await loadTally())[monthKey()] ?? { calls: 0, usd: 0 }; }
async function addSpend(usd: number) {
  const t = await loadTally(), m = monthKey(), row = t[m] ?? { calls: 0, usd: 0 };
  tally = { [m]: { calls: row.calls + 1, usd: row.usd + usd } };   // only this month is kept
  await setMeta(KEY, tally).catch(() => undefined);
  listeners.forEach((l) => l());
}
export function onGeminiSpend(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }

/** One request to Gemini. Throws GeminiSkip with a reason when the caller should move on to Claude. */
async function call(s: Settings, opts: { system?: string; user: Content[] | string; maxTokens: number; signal?: AbortSignal; timeoutMs: number }) {
  const model = modelOf(s);
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  opts.signal?.addEventListener("abort", onAbort);
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs);
  try {
    let thinking = true;
    for (let attempt = 0; attempt < 2; attempt++) {
      let res: Response;
      try {
        res = await fetch(`${GEMINI_BASE}/models/${encodeURIComponent(model)}:generateContent`, {
          method: "POST", signal: ctrl.signal,
          headers: { "content-type": "application/json", "x-goog-api-key": s.geminiKey.trim() },
          body: JSON.stringify(geminiBody(model, opts.system, opts.user, opts.maxTokens, thinking)),
        });
      } catch {
        if (opts.signal?.aborted) throw new GeminiSkip("cancelled");
        throw new GeminiSkip(ctrl.signal.aborted ? "timeout" : "network");
      }
      if (res.ok) return { model, data: await res.json().catch(() => null) };
      let detail = "";
      try { detail = (await res.json())?.error?.message ?? ""; } catch { /* ignore */ }
      // a model that doesn't take our thinking setting: once more without it (a rejected request isn't billed)
      if (res.status === 400 && thinking && /think/i.test(detail)) { thinking = false; continue; }
      throw new GeminiSkip(res.status === 400 && /api key/i.test(detail) ? "bad-key" : res.status === 403 ? "forbidden" : res.status === 404 ? "no-model" : res.status === 429 ? "rate-limited" : `http-${res.status}`);
    }
    throw new GeminiSkip("rejected");
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onAbort);
  }
}

export async function tryGemini(opts: { feature: string; system?: string; user: Content[] | string; maxTokens?: number; signal?: AbortSignal }): Promise<string> {
  const s = getSettings();
  if (!geminiReady(s) || !localAllowed(opts.feature, s.geminiScope)) throw new GeminiSkip("not a gemini job");
  if (s.geminiBudgetUsd > 0 && (await geminiSpent()).usd >= s.geminiBudgetUsd) { count("ai.gemini.fallback.cap"); throw new GeminiSkip("over the cap"); }
  const t0 = performance.now();
  const why = (reason: string) => { count(`ai.gemini.fallback.${reason}`); warn("ai", "gemini skipped", { feature: opts.feature, reason, ms: Math.round(performance.now() - t0) }); return new GeminiSkip(reason); };
  let r;
  try { r = await call(s, { system: opts.system, user: opts.user, maxTokens: Math.max(256, opts.maxTokens ?? 2000), signal: opts.signal, timeoutMs: 90_000 }); }
  catch (e) { if (e instanceof GeminiSkip && e.message !== "cancelled") throw why(e.message); throw e; }
  const reply = readGeminiReply(r.data);
  // billed even when we then throw the reply away, so count it before checking
  void addSpend(geminiCostUsd(r.model, reply.input, reply.output));
  if (reply.blocked) throw why("blocked");
  if (!replyUsable(opts.feature, reply.text.trim(), reply.finish)) throw why(reply.finish === "length" ? "cut-off" : "bad-reply");
  const ms = performance.now() - t0;
  count(`ai.gemini.${opts.feature}`);
  track("ai.gemini.ms", ms);
  return reply.text.trim();
}

/** Settings → Test: does the key work, and with which model? A two-word reply: a tiny fraction of a cent. */
export async function testGemini(): Promise<{ ok: boolean; model: string; ms?: number; reason?: string }> {
  const s = getSettings();
  const t0 = performance.now();
  try {
    const r = await call(s, { user: "Reply with the single word: ok", maxTokens: 64, timeoutMs: 30_000 });
    const reply = readGeminiReply(r.data);
    void addSpend(geminiCostUsd(r.model, reply.input, reply.output));
    return { ok: !!reply.text.trim(), model: r.model, ms: Math.round(performance.now() - t0), reason: reply.text.trim() ? undefined : "an empty reply" };
  } catch (e) {
    const m = (e as Error).message;
    return { ok: false, model: modelOf(s), reason: m === "bad-key" || m === "forbidden" ? "the key was rejected" : m === "no-model" ? "that model name doesn't exist" : m === "network" ? "couldn't reach Google (offline, or blocked by the browser)" : m };
  }
}
