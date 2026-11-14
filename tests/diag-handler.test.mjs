import { test } from "node:test";
import assert from "node:assert/strict";
import { handleDiag, sanitize, validate, MAX_BODY, MAX_STORED, RATE_WINDOW_MS, MAX_POSTS_PER_SENDER, MAX_POSTS_TOTAL, MAX_BAD_READS_PER_SENDER } from "../netlify/lib/diag-handler.mjs";

// in-memory store with the @netlify/blobs Store shape
const memStore = () => {
  const m = new Map();
  return {
    m,
    async set(k, v) { m.set(k, v); },
    async get(k) { return m.get(k) ?? null; },
    async list({ prefix = "" } = {}) { return { blobs: [...m.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })) }; },
    async delete(k) { m.delete(k); },
  };
};
const req = (method, { url = "https://x.test/.netlify/functions/diag", body = "", headers = {} } = {}) => ({
  method, url, header: (n) => headers[n.toLowerCase()] ?? null, text: async () => body,
});
const report = (over = {}) => ({ format: "pipit-notes-diagnostics", version: 1, generatedAt: Date.now(), session: "abc123", app: { version: "0.1.0" }, env: { ua: "iPad" }, counts: { notes: 3 }, metrics: {}, errorsByArea: {}, recent: [], health: [], ...over });
const ENV = { DIAG_READ_TOKEN: "s3cret-token-value" };
// the stored reports only (the store also holds the rate-limit counters under rate/)
const reportsIn = (store) => [...store.m.entries()].filter(([k]) => k.startsWith("reports/"));
const from = (ip, extra = {}) => ({ "x-nf-client-connection-ip": ip, ...extra });

test("stores a valid report and returns 204", async () => {
  const store = memStore();
  const r = await handleDiag(req("POST", { body: JSON.stringify(report()) }), store, ENV, 1_700_000_000_000);
  assert.equal(r.status, 204);
  assert.equal(reportsIn(store).length, 1);
  const [key, value] = reportsIn(store)[0];
  assert.match(key, /^reports\/2023-11-14\/\d{14}-abc123\.json$/);
  assert.equal(JSON.parse(value).receivedAt, 1_700_000_000_000);
});

test("rejects bad input: wrong method, oversize, bad JSON, wrong format/version, missing session", async () => {
  const store = memStore();
  assert.equal((await handleDiag(req("PUT"), store, ENV)).status, 405);
  assert.equal((await handleDiag(req("POST", { body: "x".repeat(MAX_BODY + 1) }), store, ENV)).status, 413);
  assert.equal((await handleDiag(req("POST", { body: "{nope" }), store, ENV)).status, 400);
  assert.equal((await handleDiag(req("POST", { body: JSON.stringify(report({ format: "other" })) }), store, ENV)).status, 400);
  assert.equal((await handleDiag(req("POST", { body: JSON.stringify(report({ version: 2 })) }), store, ENV)).status, 400);
  assert.equal((await handleDiag(req("POST", { body: JSON.stringify(report({ session: "" })) }), store, ENV)).status, 400);
  assert.equal((await handleDiag(req("POST", { body: JSON.stringify(report({ recent: "no" })) }), store, ENV)).status, 400);
  assert.equal(reportsIn(store).length, 0);
  assert.equal(validate(null), "report must be an object");
});

test("sanitises on the way in: unknown fields dropped, secrets redacted, sizes capped", async () => {
  const store = memStore();
  const evil = report({
    evilField: "should be dropped",
    settings: { apiKey: "sk-ant-api03-ABCDEFGHIJKLMNOP", model: "claude-sonnet-5", token: "t" },
    // 150 entries of ~450 chars each: under the body limit, but each message is over the string cap
    recent: Array.from({ length: 150 }, (_, i) => ({ t: i, level: "error", area: "x", msg: "leaked sk-ant-api03-ZZZZZZZZZZZZ " + "y".repeat(420) })),
  });
  assert.equal((await handleDiag(req("POST", { body: JSON.stringify(evil) }), store, ENV)).status, 204);
  const stored = JSON.parse(reportsIn(store)[0][1]);
  assert.equal(stored.evilField, undefined);
  assert.equal(stored.settings.apiKey, undefined);
  assert.equal(stored.settings.token, undefined);
  assert.equal(stored.settings.model, "claude-sonnet-5");
  assert.ok(!JSON.stringify(stored).includes("ZZZZZZZZZZZZ"));
  assert.ok(stored.recent[0].msg.length <= 301);
  // arrays are capped even when the body is small
  const many = report({ recent: Array.from({ length: 500 }, (_, i) => ({ t: i, level: "info", area: "a", msg: "m" })) });
  const store2 = memStore();
  await handleDiag(req("POST", { body: JSON.stringify(many) }), store2, ENV);
  assert.equal(JSON.parse(reportsIn(store2)[0][1]).recent.length, 200);
  assert.equal(sanitize({ a: { b: { c: { d: { e: { f: { g: 1 } } } } } } }).a.b.c.d.e.f, null); // depth-capped
});

test("reading needs the token: 503 when unset, 401 when wrong, 200 when right", async () => {
  const store = memStore();
  await handleDiag(req("POST", { body: JSON.stringify(report()) }), store, ENV);
  assert.equal((await handleDiag(req("GET"), store, {})).status, 503);
  assert.equal((await handleDiag(req("GET"), store, ENV)).status, 401);
  assert.equal((await handleDiag(req("GET", { url: "https://x/f", headers: { authorization: "Bearer wrong-token-value!" } }), store, ENV)).status, 401);
  assert.equal((await handleDiag(req("GET", { url: "https://x/f", headers: { authorization: "Bearer short" } }), store, ENV)).status, 401);
  const ok = await handleDiag(req("GET", { url: "https://x/f", headers: { authorization: "Bearer s3cret-token-value" } }), store, ENV);
  assert.equal(ok.status, 200);
  assert.equal(JSON.parse(ok.body).count, 1);
  const bearer = await handleDiag(req("GET", { headers: { authorization: "Bearer s3cret-token-value" } }), store, ENV);
  assert.equal(bearer.status, 200);
});

test("reads newest first, honours limit and since", async () => {
  const store = memStore();
  for (let i = 1; i <= 5; i++) await handleDiag(req("POST", { body: JSON.stringify(report({ session: "s" + i })) }), store, ENV, i * 1000);
  const get = async (qs) => JSON.parse((await handleDiag(req("GET", { url: "https://x/f?" + qs.replace(/^&/, ""), headers: { authorization: "Bearer s3cret-token-value" } }), store, ENV)).body);
  const all = await get("");
  assert.deepEqual(all.reports.map((r) => r.session), ["s5", "s4", "s3", "s2", "s1"]);
  assert.equal((await get("&limit=2")).count, 2);
  assert.deepEqual((await get("&since=3000")).reports.map((r) => r.session), ["s5", "s4", "s3"]);
});

test("old reports are pruned beyond the cap", async () => {
  const store = memStore();
  for (let i = 0; i < MAX_STORED + 7; i++) store.m.set(`reports/2020-01-01/${String(i).padStart(14, "0")}-old.json`, "{}");
  await handleDiag(req("POST", { body: JSON.stringify(report()) }), store, ENV, Date.now());
  assert.equal(reportsIn(store).length, MAX_STORED);
  assert.ok([...store.m.keys()].some((k) => k.includes("abc123"))); // the new one survives
  assert.ok(!store.m.has(`reports/2020-01-01/${String(0).padStart(14, "0")}-old.json`)); // the oldest went
});

test("CORS preflight", async () => {
  const r = await handleDiag(req("OPTIONS"), memStore(), ENV);
  assert.equal(r.status, 204);
  assert.equal(r.headers["access-control-allow-origin"], "*");
});

test("writes are rate-limited per sender, and the limit resets with the window", async () => {
  const store = memStore();
  const t0 = 50 * RATE_WINDOW_MS + 1000;
  const post = (ip, now) => handleDiag(req("POST", { body: JSON.stringify(report()), headers: from(ip) }), store, ENV, now);
  for (let i = 0; i < MAX_POSTS_PER_SENDER; i++) assert.equal((await post("203.0.113.5", t0 + i)).status, 204);
  const over = await post("203.0.113.5", t0 + 500);
  assert.equal(over.status, 429);
  assert.ok(Number(over.headers["retry-after"]) > 0 && Number(over.headers["retry-after"]) <= RATE_WINDOW_MS / 1000);
  assert.equal(reportsIn(store).length, MAX_POSTS_PER_SENDER); // the refused one was not stored
  assert.equal((await post("203.0.113.6", t0 + 600)).status, 204); // someone else is unaffected
  assert.equal((await post("203.0.113.5", t0 + RATE_WINDOW_MS)).status, 204); // next window: allowed again
});

test("junk counts against the limit too, and is refused without being parsed once over it", async () => {
  const store = memStore();
  const t0 = 60 * RATE_WINDOW_MS;
  let parsed = 0;
  const junk = () => ({ ...req("POST", { headers: from("198.51.100.9") }), text: async () => { parsed++; return "{nope"; } });
  for (let i = 0; i < MAX_POSTS_PER_SENDER; i++) assert.equal((await handleDiag(junk(), store, ENV, t0)).status, 400);
  assert.equal((await handleDiag(junk(), store, ENV, t0)).status, 429);
  assert.equal(parsed, MAX_POSTS_PER_SENDER); // the body of the refused request was never read
});

test("writes are rate-limited overall, however many senders there are", async () => {
  const store = memStore();
  const t0 = 70 * RATE_WINDOW_MS;
  for (let i = 0; i < MAX_POSTS_TOTAL; i++) assert.equal((await handleDiag(req("POST", { body: JSON.stringify(report()), headers: from("10.0." + (i >> 8) + "." + (i & 255)) }), store, ENV, t0 + i)).status, 204);
  assert.equal((await handleDiag(req("POST", { body: JSON.stringify(report()), headers: from("192.0.2.77") }), store, ENV, t0 + 999)).status, 429);
  assert.equal(reportsIn(store).length, MAX_POSTS_TOTAL);
});

test("no address is stored, only a hash of it", async () => {
  const store = memStore();
  await handleDiag(req("POST", { body: JSON.stringify(report()), headers: from("203.0.113.200") }), store, ENV);
  assert.ok(![...store.m.entries()].some(([k, v]) => k.includes("203.0.113.200") || String(v).includes("203.0.113.200")));
});

test("an oversize report is refused from its declared length, before the body is read", async () => {
  const store = memStore();
  let read = false;
  const r = await handleDiag({ ...req("POST", { headers: { "content-length": String(MAX_BODY * 4 + 1) } }), text: async () => { read = true; return ""; } }, store, ENV);
  assert.equal(r.status, 413);
  assert.equal(read, false);
});

test("wrong tokens are rate-limited, and a locked-out sender learns nothing even with the right token", async () => {
  const store = memStore();
  const t0 = 80 * RATE_WINDOW_MS;
  const get = (token, ip, now = t0) => handleDiag(req("GET", { url: "https://x/f", headers: { ...from(ip), authorization: "Bearer " + token } }), store, ENV, now);
  for (let i = 0; i < MAX_BAD_READS_PER_SENDER; i++) assert.equal((await get("wrong-token-value!", "203.0.113.9")).status, 401);
  assert.equal((await get("wrong-token-value!", "203.0.113.9")).status, 429);
  assert.equal((await get("s3cret-token-value", "203.0.113.9")).status, 429); // no oracle while locked out
  assert.equal((await get("s3cret-token-value", "203.0.113.10")).status, 200); // the owner elsewhere is fine
  assert.equal((await get("s3cret-token-value", "203.0.113.9", t0 + RATE_WINDOW_MS)).status, 200); // and the lock-out ends
});

test("a GET with no token at all never returns reports", async () => {
  const store = memStore();
  await handleDiag(req("POST", { body: JSON.stringify(report()) }), store, ENV);
  for (const r of [await handleDiag(req("GET"), store, ENV), await handleDiag(req("GET", { url: "https://x/f", headers: { authorization: "Bearer " } }), store, ENV), await handleDiag(req("GET", { headers: { authorization: "Bearer " } }), store, ENV), await handleDiag(req("GET"), store, { DIAG_READ_TOKEN: "" })]) {
    assert.ok(r.status === 401 || r.status === 503);
    assert.ok(!r.body.includes("abc123"));
  }
});

test("broken rate counters in the store do not take the endpoint down", async () => {
  const store = memStore();
  store.m.set("rate/state.json", "{not json");
  assert.equal((await handleDiag(req("POST", { body: JSON.stringify(report()) }), store, ENV)).status, 204);
  store.m.set("rate/state.json", JSON.stringify({ w: "x", total: "many" }));
  assert.equal((await handleDiag(req("POST", { body: JSON.stringify(report()) }), store, ENV)).status, 204);
});
