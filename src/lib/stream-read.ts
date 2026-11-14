// Reading a streamed AI reply (server-sent events) from either provider, with one shared watch for a dead
// connection: no bytes for a minute, or the app coming back from the background to a request that has gone quiet.
// iPadOS pauses web apps in the background and the request often dies with no error, so without this watch a long
// job (an exam) would spin until a five-minute timeout.
import { sseSplitter } from "./sse-core.ts";

const STALL_MS = 60_000;

export class StreamStopped extends Error {
  constructor(public why: "cancelled" | "dropped") { super(why); }
}

/**
 * Feed every `data:` payload to `onPayload` until the body ends or `onPayload` says it is finished.
 * `onPayload` returns { grew } when the visible text grew (to report progress) and { finished } at the end of a
 * message. Throws StreamStopped("cancelled") if the caller aborted, StreamStopped("dropped") if the connection died.
 */
export async function pumpSse(res: Response, opts: {
  abort: () => void;
  signal?: AbortSignal;
  onPayload: (payload: string) => { grew?: boolean; finished?: boolean };
  onProgress?: () => void;
}): Promise<void> {
  if (!res.body) throw new StreamStopped("dropped");
  const reader = res.body.getReader(), dec = new TextDecoder(), split = sseSplitter();
  let last = Date.now(), stalled = false, finished = false;
  const stop = () => { opts.abort(); void reader.cancel().catch(() => undefined); };
  const stall = () => { stalled = true; stop(); };
  const tick = setInterval(() => { if (Date.now() - last > STALL_MS) stall(); }, 2000);
  const onVisible = () => { if (document.visibilityState === "visible") setTimeout(() => { if (!finished && Date.now() - last > 20_000) stall(); }, 4000); };
  document.addEventListener("visibilitychange", onVisible);
  opts.signal?.addEventListener("abort", stop);
  try {
    for (;;) {
      let r: ReadableStreamReadResult<Uint8Array>;
      try { r = await reader.read(); } catch { throw new StreamStopped(opts.signal?.aborted ? "cancelled" : "dropped"); }
      if (opts.signal?.aborted) throw new StreamStopped("cancelled");
      if (stalled) throw new StreamStopped("dropped");
      if (r.done) return;
      last = Date.now();
      let grew = false;
      for (const p of split(dec.decode(r.value, { stream: true }))) {
        const o = opts.onPayload(p);
        if (o.grew) grew = true;
        if (o.finished) finished = true;
      }
      if (grew) { try { opts.onProgress?.(); } catch { /* a progress display must never break the request */ } }
      if (finished) return;
    }
  } finally {
    clearInterval(tick);
    document.removeEventListener("visibilitychange", onVisible);
    opts.signal?.removeEventListener("abort", stop);
  }
}
