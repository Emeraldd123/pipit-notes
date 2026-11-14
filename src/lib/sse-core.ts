// Reading a streamed Anthropic reply (server-sent events). Long jobs (an exam, a deck of flashcards) are streamed so
// the app can show progress and notice within seconds when the connection has died, instead of waiting minutes for
// one big reply. Pure; tests/sse.test.mjs.

/** Feed raw text chunks in (they can split anywhere); get whole `data:` payloads out. */
export function sseSplitter() {
  let buf = "";
  return (chunk: string): string[] => {
    buf += chunk;
    const out: string[] = [];
    for (;;) {
      const m = /\r?\n\r?\n/.exec(buf);
      if (!m) break;
      const block = buf.slice(0, m.index);
      buf = buf.slice(m.index + m[0].length);
      const data = block.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).replace(/^ /, "")).join("\n");
      if (data) out.push(data);
    }
    return out;
  };
}

export type StreamState = {
  text: string;
  stop: string | null;
  usage: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } | null;
  done: boolean;
  /** an error the service reported mid-stream (overloaded, etc.) */
  error: { type: string; message: string } | null;
};
export const newStreamState = (): StreamState => ({ text: "", stop: null, usage: null, done: false, error: null });

/** Apply one event payload. Returns true when the visible text grew. Thinking and ping events are ignored. */
export function applyEvent(st: StreamState, payload: string): boolean {
  let ev: any;   // eslint-disable-line @typescript-eslint/no-explicit-any
  try { ev = JSON.parse(payload); } catch { return false; }
  switch (ev?.type) {
    case "message_start": st.usage = { ...(ev.message?.usage ?? {}) }; return false;
    case "content_block_delta":
      if (ev.delta?.type === "text_delta" && typeof ev.delta.text === "string") { st.text += ev.delta.text; return true; }
      return false;
    case "message_delta":
      if (ev.delta?.stop_reason) st.stop = ev.delta.stop_reason;
      if (ev.usage) st.usage = { ...(st.usage ?? {}), ...ev.usage };
      return false;
    case "message_stop": st.done = true; return false;
    case "error": st.error = { type: String(ev.error?.type ?? "error"), message: String(ev.error?.message ?? "") }; return false;
    default: return false;
  }
}

export type GeminiStreamState = { text: string; finish: "stop" | "length" | "blocked" | null; blocked: boolean; input: number; output: number };
export const newGeminiState = (): GeminiStreamState => ({ text: "", finish: null, blocked: false, input: 0, output: 0 });

/**
 * Apply one Gemini stream chunk (a partial GenerateContentResponse). Text parts are appended (thought parts are not
 * shown); usage is cumulative, so the latest wins; the last chunk carries the finish reason. Returns true when the
 * visible text grew.
 */
export function applyGeminiEvent(st: GeminiStreamState, payload: string): boolean {
  let ev: any;   // eslint-disable-line @typescript-eslint/no-explicit-any
  try { ev = JSON.parse(payload); } catch { return false; }
  if (ev?.promptFeedback?.blockReason) { st.blocked = true; st.finish = "blocked"; }
  const c = ev?.candidates?.[0];
  let grew = false;
  for (const p of c?.content?.parts ?? []) if (!p?.thought && typeof p?.text === "string" && p.text) { st.text += p.text; grew = true; }
  if (c?.finishReason) {
    st.finish = c.finishReason === "STOP" ? "stop" : c.finishReason === "MAX_TOKENS" ? "length" : "blocked";
    if (st.finish === "blocked") st.blocked = true;
  }
  const u = ev?.usageMetadata;
  if (u) { st.input = u.promptTokenCount ?? st.input; st.output = (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0) || st.output; }
  return grew;
}

/** How many questions an exam being written has started so far (each has exactly one "stem"). */
export const questionsSoFar = (partial: string) => (partial.match(/"stem"\s*:/g) ?? []).length;
/** How many of some JSON item have started, by its key (flashcards: "front"). */
export const itemsSoFar = (partial: string, key: string) => (partial.match(new RegExp(`"${key}"\\s*:`, "g")) ?? []).length;
