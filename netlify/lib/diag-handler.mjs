// Receives content-free diagnostics reports from the app and lets the owner read them
// back. Pure logic over a tiny store interface, so it's unit-tested without Netlify.
//
//   POST  /.netlify/functions/diag                  store a report (called by the app)
//   GET   /.netlify/functions/diag?token=…&limit=20  read recent reports (owner only)
//
// Reading requires the DIAG_READ_TOKEN environment variable (set it in the Netlify UI).
// Writing needs no secret (the app has none), so every report is validated, size-capped
// and re-scrubbed here, old reports are pruned, and writes are rate-limited per sender
// and overall so nobody can flood the store or push the real reports out of it.
import { createHash } from "node:crypto";
import { scrubString } from "../../src/lib/telemetry-core.ts";

export const MAX_BODY = 200_000;
export const MAX_STORED = 400;
/** Rate limits, counted in fixed windows. The app itself sends a handful of reports a day. */
export const RATE_WINDOW_MS = 10 * 60_000;
export const MAX_POSTS_PER_SENDER = 10;   // per window, per IP address
export const MAX_POSTS_TOTAL = 120;       // per window, everyone together
export const MAX_BAD_READS_PER_SENDER = 20; // wrong-token GETs per window, per IP address
const RATE_KEY = "rate/state.json";
const FORMAT = "pipit-notes-diagnostics";
const ALLOWED = ["format", "version", "generatedAt", "app", "session", "trigger", "env", "storage", "counts", "settings", "health", "metrics", "errorsByArea", "recent", "lastBackupAt", "firstSeenAt"];

const CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-allow-headers": "content-type, authorization" };
const json = (status, body) => ({ status, headers: { ...CORS, "content-type": "application/json" }, body: JSON.stringify(body) });
const empty = (status) => ({ status, headers: { ...CORS }, body: "" });

/** Whitelist + cap + scrub anything a client sends. Never trust the body. */
export function sanitize(value, depth = 0) {
  if (value == null) return value;
  if (typeof value === "string") return scrubString(value);
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;
  if (depth >= 6) return null;
  if (Array.isArray(value)) return value.slice(0, 200).map((v) => sanitize(v, depth + 1));
  if (typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value).slice(0, 60)) {
      if (/^(api.?key|token|authorization|secret|password)$/i.test(k)) continue;
      out[k.slice(0, 60)] = sanitize(v, depth + 1);
    }
    return out;
  }
  return null;
}

export function validate(report) {
  if (!report || typeof report !== "object" || Array.isArray(report)) return "report must be an object";
  if (report.format !== FORMAT) return "unrecognised report format";
  if (report.version !== 1) return "unsupported report version";
  if (typeof report.session !== "string" || !report.session) return "missing session";
  if (typeof report.generatedAt !== "number") return "missing generatedAt";
  if (report.recent != null && !Array.isArray(report.recent)) return "recent must be an array";
  return null;
}

/** Who is calling, as a short hash: the address itself is never stored. */
function senderOf(req) {
  const ip = (req.header("x-nf-client-connection-ip") || req.header("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
  return createHash("sha256").update(ip).digest("hex").slice(0, 16);
}

/** The counters for the current window: { w, total, posts: {sender: n}, bad: {sender: n} }. Best-effort (not atomic). */
async function readRate(store, now) {
  const w = Math.floor(now / RATE_WINDOW_MS);
  try {
    const s = JSON.parse((await store.get(RATE_KEY)) || "null");
    if (s && s.w === w && typeof s.total === "number" && s.posts && typeof s.posts === "object" && s.bad && typeof s.bad === "object") return s;
  } catch { /* unreadable counters start again */ }
  return { w, total: 0, posts: {}, bad: {} };
}
const writeRate = async (store, state) => { try { await store.set(RATE_KEY, JSON.stringify(state)); } catch { /* limits are best-effort */ } };
const tooMany = (now) => {
  const retry = Math.max(1, Math.ceil(((Math.floor(now / RATE_WINDOW_MS) + 1) * RATE_WINDOW_MS - now) / 1000));
  return { status: 429, headers: { ...CORS, "content-type": "application/json", "retry-after": String(retry) }, body: JSON.stringify({ error: "too many requests" }) };
};

function tokenOk(supplied, expected) {
  if (!expected || !supplied || supplied.length !== expected.length) return false;
  let diff = 0; // constant-time compare
  for (let i = 0; i < expected.length; i++) diff |= supplied.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

/**
 * @param req   { method, url, header(name), text() }
 * @param store { set(key, value), get(key), list({prefix}), delete(key) }  (the @netlify/blobs Store shape)
 * @param env   { DIAG_READ_TOKEN? }
 */
export async function handleDiag(req, store, env, now = Date.now()) {
  if (req.method === "OPTIONS") return empty(204);

  if (req.method === "POST") {
    // refuse early, before reading anything, when the sender (or everyone together) is over the limit
    const sender = senderOf(req);
    const rate = await readRate(store, now);
    if (rate.total >= MAX_POSTS_TOTAL || (rate.posts[sender] ?? 0) >= MAX_POSTS_PER_SENDER) return tooMany(now);
    if (Number(req.header("content-length")) > MAX_BODY * 4) return json(413, { error: "report too large" }); // a UTF-8 character is at most 4 bytes
    // every attempt counts, valid or not, so junk cannot be thrown at the parser for free
    rate.total += 1; rate.posts[sender] = (rate.posts[sender] ?? 0) + 1;
    await writeRate(store, rate);

    const raw = await req.text();
    if (raw.length > MAX_BODY) return json(413, { error: "report too large" });
    let report;
    try { report = JSON.parse(raw); } catch { return json(400, { error: "invalid JSON" }); }
    const problem = validate(report);
    if (problem) return json(400, { error: problem });

    const clean = {};
    for (const k of ALLOWED) if (k in report) clean[k] = sanitize(report[k]);
    clean.receivedAt = now;
    const day = new Date(now).toISOString().slice(0, 10);
    const sess = String(clean.session).replace(/[^a-z0-9]/gi, "").slice(0, 12) || "unknown";
    const key = `reports/${day}/${String(now).padStart(14, "0")}-${sess}.json`;
    await store.set(key, JSON.stringify(clean));

    // prune: keep the newest MAX_STORED
    const { blobs } = await store.list({ prefix: "reports/" });
    if (blobs.length > MAX_STORED) {
      const old = blobs.map((b) => b.key).sort().slice(0, blobs.length - MAX_STORED);
      for (const k of old) await store.delete(k);
    }
    return empty(204);
  }

  if (req.method === "GET") {
    const url = new URL(req.url, "http://localhost");
    const auth = req.header("authorization") ?? "";
    const supplied = url.searchParams.get("token") ?? (auth.startsWith("Bearer ") ? auth.slice(7) : "");
    if (!env.DIAG_READ_TOKEN) return json(503, { error: "reading is disabled: set DIAG_READ_TOKEN in the site's environment variables" });
    // Stop token guessing: after too many wrong tokens a sender is refused for the rest of the
    // window, and that refusal comes before the token is looked at, so it reveals nothing.
    const sender = senderOf(req);
    const rate = await readRate(store, now);
    if ((rate.bad[sender] ?? 0) >= MAX_BAD_READS_PER_SENDER) return tooMany(now);
    if (!tokenOk(supplied, env.DIAG_READ_TOKEN)) {
      if (Object.keys(rate.bad).length < 500 || sender in rate.bad) { rate.bad[sender] = (rate.bad[sender] ?? 0) + 1; await writeRate(store, rate); }
      return json(401, { error: "unauthorized" });
    }

    const limit = Math.max(1, Math.min(100, Number(url.searchParams.get("limit")) || 20));
    const since = Number(url.searchParams.get("since")) || 0;
    const { blobs } = await store.list({ prefix: "reports/" });
    const keys = blobs.map((b) => b.key).sort().reverse();
    const out = [];
    for (const k of keys) {
      if (out.length >= limit) break;
      const text = await store.get(k);
      if (!text) continue;
      try {
        const r = JSON.parse(text);
        if ((r.receivedAt ?? 0) >= since) out.push(r);
      } catch { /* skip a corrupt entry */ }
    }
    return json(200, { count: out.length, reports: out });
  }

  return json(405, { error: "method not allowed" });
}
