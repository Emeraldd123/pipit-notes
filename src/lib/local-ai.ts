// Talks to a model on your own laptop (Ollama, llama-server or LM Studio, all OpenAI-compatible). Every AI job that
// is allowed to run locally (local-ai-core.ts) asks here first; if the laptop isn't reachable, is too slow, errors,
// or gives a reply that doesn't parse, the caller sends the job to Claude as before. Nothing about note content is
// logged: only counts, timings and the reason for a fallback.
import { getSettings, type Settings } from "./settings";
import { count, track, warn } from "./telemetry";
import { blockedByHttps, cleanReply, hasImage, localAllowed, normalizeBase, pickModel, replyUsable, toChatMessages, type Content } from "./local-ai-core.ts";
import { recordUsage } from "./ai-ledger";


export type Probe = { ok: boolean; at: number; models: string[]; reason?: string; ms?: number };
let last: { base: string; probe: Probe } | null = null;
let probing: Promise<Probe> | null = null;
const FRESH_OK = 60_000, FRESH_DOWN = 30_000, PROBE_MS = 1500;

export const localConfigured = (s: Settings = getSettings()) => s.localEnabled && !!normalizeBase(s.localUrl);

/** Is the laptop reachable right now? Cached (a minute when up, 30 s when down) so it costs nothing per job. */
export async function probeLocal(force = false): Promise<Probe> {
  const s = getSettings();
  const base = normalizeBase(s.localUrl);
  if (!base) return { ok: false, at: Date.now(), models: [], reason: "no address set" };
  if (blockedByHttps(base, location.protocol)) return { ok: false, at: Date.now(), models: [], reason: "the address must start with https:// (use Tailscale Serve, see the guide)" };
  if (!force && last?.base === base && Date.now() - last.probe.at < (last.probe.ok ? FRESH_OK : FRESH_DOWN)) return last.probe;
  if (probing && !force) return probing;
  probing = (async () => {
    const t0 = performance.now();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), force ? 5000 : PROBE_MS);
    let probe: Probe;
    try {
      const res = await fetch(`${base}/v1/models`, { signal: ctrl.signal });
      if (!res.ok) probe = { ok: false, at: Date.now(), models: [], reason: `the server answered ${res.status}` };
      else {
        const j = await res.json().catch(() => ({}));
        const models = Array.isArray(j?.data) ? j.data.map((m: { id?: string }) => String(m.id ?? "")).filter(Boolean) : [];
        probe = { ok: true, at: Date.now(), models, ms: Math.round(performance.now() - t0) };
      }
    } catch {
      probe = { ok: false, at: Date.now(), models: [], reason: ctrl.signal.aborted ? "no answer (laptop asleep, off, or not on Tailscale?)" : "couldn't connect (address, CORS or certificate?)" };
    } finally { clearTimeout(timer); }
    last = { base, probe };
    count(probe.ok ? "ai.local.up" : "ai.local.down");
    return probe;
  })().finally(() => { probing = null; });
  return probing;
}

/** Forget the cached probe (after a failed call, or when the address changes). */
export const markLocalDown = () => { if (last) last.probe = { ...last.probe, ok: false, at: Date.now() }; };

export class LocalSkip extends Error {}

/**
 * Try the job on the laptop. Resolves with the reply, or throws LocalSkip (with a content-free reason) when the
 * caller should use Claude instead.
 */
export async function tryLocal(opts: { feature: string; system?: string; user: Content[] | string; maxTokens?: number; signal?: AbortSignal; timeoutMs?: number }): Promise<string> {
  const s = getSettings();
  if (!localConfigured(s) || !localAllowed(opts.feature, s.localScope)) throw new LocalSkip("not a local job");
  const probe = await probeLocal();
  if (!probe.ok) throw new LocalSkip("unreachable");
  const model = pickModel(probe.models, s.localModel.trim());
  if (!model) throw new LocalSkip("no model on the laptop");
  const base = normalizeBase(s.localUrl);
  const t0 = performance.now();
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  opts.signal?.addEventListener("abort", onAbort);
  // a local model is slower than the API; long jobs get longer, but a stuck laptop must not hold you up for ages
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? (opts.feature === "mathcheck" ? 30_000 : 150_000));
  const why = (reason: string) => { count(`ai.local.fallback.${reason}`); warn("ai", "laptop model skipped", { feature: opts.feature, reason, ms: Math.round(performance.now() - t0) }); return new LocalSkip(reason); };
  try {
    let res: Response;
    try {
      res = await fetch(`${base}/v1/chat/completions`, {
        method: "POST", signal: ctrl.signal, headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model, messages: toChatMessages(opts.system, opts.user), stream: false, temperature: 0.2,
          max_tokens: Math.max(256, opts.maxTokens ?? 2000),
          // Qwen-style models: answer straight away (llama-server reads this; Ollama ignores it, and its <think> is stripped below)
          chat_template_kwargs: { enable_thinking: false },
        }),
      });
    } catch {
      if (opts.signal?.aborted) throw new LocalSkip("cancelled");
      markLocalDown();
      throw why(ctrl.signal.aborted ? "timeout" : "network");
    }
    if (!res.ok) {
      // 400 with an image usually means the chosen model can't see pictures
      throw why(res.status === 400 && hasImage(opts.user) ? "no-vision" : `http-${res.status}`);
    }
    const data = await res.json().catch(() => null);
    const choice = data?.choices?.[0];
    const reply = cleanReply(String(choice?.message?.content ?? ""));
    if (!replyUsable(opts.feature, reply, choice?.finish_reason)) throw why(choice?.finish_reason === "length" ? "cut-off" : "bad-reply");
    const ms = performance.now() - t0;
    count(`ai.local.${opts.feature}`);
    track("ai.local.ms", ms);
    track(`ai.local.${opts.feature}.ms`, ms);
    if (data?.usage) void recordUsage(opts.feature, `local:${model}`, { input_tokens: data.usage.prompt_tokens ?? 0, output_tokens: data.usage.completion_tokens ?? 0 });
    return reply;
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onAbort);
  }
}

export type LocalTest = { ok: boolean; reason?: string; models: string[]; model?: string; ms?: number; reads?: string; vision?: boolean };

/**
 * Settings → Test: is the laptop reachable, which model will be used, and can it read a picture? The picture is a
 * small drawing of a sum, so the answer shows whether it read it right.
 */
export async function testLocal(picture: string): Promise<LocalTest> {
  const probe = await probeLocal(true);
  if (!probe.ok) return { ok: false, reason: probe.reason, models: [] };
  const s = getSettings();
  const model = pickModel(probe.models, s.localModel.trim());
  if (!model) return { ok: false, reason: "the server has no chat model; pull one (see the guide)", models: probe.models };
  const t0 = performance.now();
  try {
    const res = await fetch(`${normalizeBase(s.localUrl)}/v1/chat/completions`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, stream: false, max_tokens: 300, temperature: 0, chat_template_kwargs: { enable_thinking: false },
        messages: toChatMessages(undefined, [{ type: "image", source: { type: "base64", media_type: "image/png", data: picture.split(",")[1] } }, { type: "text", text: "What sum is written in this picture? Reply with just the sum." }]) }),
    });
    const ms = Math.round(performance.now() - t0);
    if (!res.ok) return { ok: true, models: probe.models, model, ms, vision: false, reason: res.status === 400 ? "this model can't read images; pick a vision model" : `the server answered ${res.status}` };
    const data = await res.json().catch(() => null);
    return { ok: true, models: probe.models, model, ms, vision: true, reads: cleanReply(String(data?.choices?.[0]?.message?.content ?? "")).slice(0, 60) };
  } catch {
    return { ok: false, models: probe.models, model, reason: "the model didn't answer" };
  }
}
