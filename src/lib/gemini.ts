// Gemini before Claude. Used only when a Gemini key is set, only for the jobs its
// scope allows (ai-route-core.ts: with a Claude key, exams stay on Claude; with none, Gemini does everything), and only while this month's estimated Gemini
// spend is under the cap (your Google credit). A reply that doesn't parse, is cut off or blocked goes on to Claude.
// Logged content-free: counts, timings, and the reason for a fallback.
import { getSettings, type Settings } from "./settings";
import { count, track, warn } from "./telemetry";
import { NEEDS_STRONG, replyUsable, routeAllowed, type Content } from "./ai-route-core.ts";
import { GEMINI_BASE, GEMINI_DEFAULT_MODEL, GEMINI_STRONG_MODEL, geminiBody, geminiCostUsd, readGeminiReply } from "./gemini-core.ts";
import { hasKey } from "./settings";
import { getMeta, setMeta } from "./db";
import { applyGeminiEvent, newGeminiState } from "./sse-core.ts";
import { pumpSse, StreamStopped } from "./stream-read.ts";
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
let chain: Promise<unknown> = Promise.resolve();
/** Serialised, so two calls finishing together can't overwrite each other's totals. */
function addSpend(usd: number): Promise<void> {
  const next = chain.then(async () => {
    const t = await loadTally(), m = monthKey(), row = t[m] ?? { calls: 0, usd: 0 };
    tally = { [m]: { calls: row.calls + 1, usd: row.usd + usd } };   // only this month is kept
    await setMeta(KEY, tally).catch(() => undefined);
    listeners.forEach((l) => l());
  });
  chain = next.catch(() => undefined);
  return next;
}
export function onGeminiSpend(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }

/** One request to Gemini. Throws GeminiSkip with a reason when the caller should move on to Claude. */
type Reply = ReturnType<typeof readGeminiReply>;
/**
 * One request to Gemini. Long jobs (strong) are streamed, so progress can be shown and a dead connection is noticed
 * in seconds; the timeout then only covers the wait for the reply to start.
 */
async function call(s: Settings, opts: { system?: string; user: Content[] | string; maxTokens: number; signal?: AbortSignal; timeoutMs: number; strong?: boolean; onProgress?: (text: string) => void }): Promise<{ model: string; reply: Reply }> {
  // big jobs get the stronger model and its own default thinking; small ones the cheap model with thinking kept low
  const model = opts.strong ? GEMINI_STRONG_MODEL : modelOf(s);
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  opts.signal?.addEventListener("abort", onAbort);
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs);
  const stream = !!opts.strong || !!opts.onProgress;
  try {
    let thinking = !opts.strong;
    for (let attempt = 0; attempt < 2; attempt++) {
      let res: Response;
      try {
        res = await fetch(`${GEMINI_BASE}/models/${encodeURIComponent(model)}:${stream ? "streamGenerateContent?alt=sse" : "generateContent"}`, {
          method: "POST", signal: ctrl.signal,
          headers: { "content-type": "application/json", "x-goog-api-key": s.geminiKey.trim() },
          body: JSON.stringify(geminiBody(model, opts.system, opts.user, opts.maxTokens, thinking)),
        });
      } catch {
        if (opts.signal?.aborted) throw new GeminiSkip("cancelled");
        throw new GeminiSkip(ctrl.signal.aborted ? "timeout" : "network");
      }
      if (res.ok && !stream) return { model, reply: readGeminiReply(await res.json().catch(() => null)) };
      if (res.ok) {
        clearTimeout(timer);   // started: from here the stall watch decides
        const st = newGeminiState();
        try {
          await pumpSse(res, { abort: () => ctrl.abort(), signal: opts.signal, onPayload: (p) => ({ grew: applyGeminiEvent(st, p) }), onProgress: opts.onProgress && (() => opts.onProgress!(st.text)) });
        } catch (e) {
          if (st.input || st.output) void addSpend(geminiCostUsd(model, st.input, st.output));
          throw new GeminiSkip(e instanceof StreamStopped && e.why === "cancelled" ? "cancelled" : "dropped");
        }
        // a stream that ends without a finish reason was cut off by the network, not finished
        if (!st.finish) { void addSpend(geminiCostUsd(model, st.input, st.output)); throw new GeminiSkip("dropped"); }
        return { model, reply: { text: st.text, finish: st.finish, blocked: st.blocked, input: st.input, output: st.output } };
      }
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

export async function tryGemini(opts: { feature: string; system?: string; user: Content[] | string; maxTokens?: number; signal?: AbortSignal; onProgress?: (text: string) => void }): Promise<string> {
  const s = getSettings();
  const only = !hasKey(s);   // no Claude key: Gemini does everything
  if (!geminiReady(s) || !routeAllowed(opts.feature, s.geminiScope, !only)) throw new GeminiSkip("not a gemini job");
  const strong = NEEDS_STRONG.has(opts.feature);
  if (s.geminiBudgetUsd > 0 && (await geminiSpent()).usd >= s.geminiBudgetUsd) { count("ai.gemini.fallback.cap"); throw new GeminiSkip("over the cap"); }
  const t0 = performance.now();
  const why = (reason: string) => { count(`ai.gemini.fallback.${reason}`); warn("ai", "gemini skipped", { feature: opts.feature, reason, ms: Math.round(performance.now() - t0) }); return new GeminiSkip(reason); };
  let r;
  try { r = await call(s, { system: opts.system, user: opts.user, maxTokens: Math.max(256, opts.maxTokens ?? 2000) + (strong ? 8000 : 0) /* thinking shares the limit */, signal: opts.signal, timeoutMs: strong ? 120_000 : 90_000, strong, onProgress: opts.onProgress }); }
  catch (e) { if (e instanceof GeminiSkip && e.message !== "cancelled") throw why(e.message); throw e; }
  const reply = r.reply;
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
    const reply = r.reply;
    void addSpend(geminiCostUsd(r.model, reply.input, reply.output));
    return { ok: !!reply.text.trim(), model: r.model, ms: Math.round(performance.now() - t0), reason: reply.text.trim() ? undefined : "an empty reply" };
  } catch (e) {
    const m = (e as Error).message;
    return { ok: false, model: modelOf(s), reason: m === "bad-key" || m === "forbidden" ? "the key was rejected" : m === "no-model" ? "that model name doesn't exist" : m === "network" ? "couldn't reach Google (offline, or blocked by the browser)" : m };
  }
}
