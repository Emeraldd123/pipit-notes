import { test } from "node:test";
import assert from "node:assert/strict";
import { handleDiag, sanitize, validate, MAX_BODY, MAX_STORED } from "../netlify/lib/diag-handler.mjs";

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

test("stores a valid report and returns 204", async () => {
  const store = memStore();
  const r = await handleDiag(req("POST", { body: JSON.stringify(report()) }), store, ENV, 1_700_000_000_000);
  assert.equal(r.status, 204);
  assert.equal(store.m.size, 1);
  const [key, value] = [...store.m.entries()][0];
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
  assert.equal(store.m.size, 0);
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
  const stored = JSON.parse([...store.m.values()][0]);
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
  assert.equal(JSON.parse([...store2.m.values()][0]).recent.length, 200);
  assert.equal(sanitize({ a: { b: { c: { d: { e: { f: { g: 1 } } } } } } }).a.b.c.d.e.f, null); // depth-capped
});

test("reading needs the token: 503 when unset, 401 when wrong, 200 when right", async () => {
  const store = memStore();
  await handleDiag(req("POST", { body: JSON.stringify(report()) }), store, ENV);
  assert.equal((await handleDiag(req("GET"), store, {})).status, 503);
  assert.equal((await handleDiag(req("GET"), store, ENV)).status, 401);
  assert.equal((await handleDiag(req("GET", { url: "https://x/f?token=wrong-token-value!" }), store, ENV)).status, 401);
  assert.equal((await handleDiag(req("GET", { url: "https://x/f?token=short" }), store, ENV)).status, 401);
  const ok = await handleDiag(req("GET", { url: "https://x/f?token=s3cret-token-value" }), store, ENV);
  assert.equal(ok.status, 200);
  assert.equal(JSON.parse(ok.body).count, 1);
  const bearer = await handleDiag(req("GET", { headers: { authorization: "Bearer s3cret-token-value" } }), store, ENV);
  assert.equal(bearer.status, 200);
});

test("reads newest first, honours limit and since", async () => {
  const store = memStore();
  for (let i = 1; i <= 5; i++) await handleDiag(req("POST", { body: JSON.stringify(report({ session: "s" + i })) }), store, ENV, i * 1000);
  const get = async (qs) => JSON.parse((await handleDiag(req("GET", { url: "https://x/f?token=s3cret-token-value" + qs }), store, ENV)).body);
  const all = await get("");
  assert.deepEqual(all.reports.map((r) => r.session), ["s5", "s4", "s3", "s2", "s1"]);
  assert.equal((await get("&limit=2")).count, 2);
  assert.deepEqual((await get("&since=3000")).reports.map((r) => r.session), ["s5", "s4", "s3"]);
});

test("old reports are pruned beyond the cap", async () => {
  const store = memStore();
  for (let i = 0; i < MAX_STORED + 7; i++) store.m.set(`reports/2020-01-01/${String(i).padStart(14, "0")}-old.json`, "{}");
  await handleDiag(req("POST", { body: JSON.stringify(report()) }), store, ENV, Date.now());
  assert.equal(store.m.size, MAX_STORED);
  assert.ok([...store.m.keys()].some((k) => k.includes("abc123"))); // the new one survives
  assert.ok(!store.m.has(`reports/2020-01-01/${String(0).padStart(14, "0")}-old.json`)); // the oldest went
});

test("CORS preflight", async () => {
  const r = await handleDiag(req("OPTIONS"), memStore(), ENV);
  assert.equal(r.status, 204);
  assert.equal(r.headers["access-control-allow-origin"], "*");
});
