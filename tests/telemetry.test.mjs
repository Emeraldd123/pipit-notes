import { test } from "node:test";
import assert from "node:assert/strict";
import { scrub, scrubString, describeError, addSample, summarizeMetric, percentile, InputAggregator, summarizeReport } from "../src/lib/telemetry-core.ts";

test("scrub drops content-bearing keys, however deeply nested", () => {
  const out = scrub({ ok: 1, title: "My secret diary", text: "hello", nested: { apiKey: "sk-ant-abcdef123456", code: "print(1)", n: 5, deeper: { prompt: "x", fine: "y" } }, name: "Bio" });
  assert.deepEqual(out, { ok: 1, nested: { n: 5, deeper: { fine: "y" } } });
});
test("scrub redacts API keys, bearer tokens and base64 blobs found inside ordinary strings", () => {
  const s = scrubString("failed with key sk-ant-api03-ABCDEFGHIJ and Bearer abcdefghijklmnop and data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk");
  assert.ok(!s.includes("ABCDEFGHIJ") && !s.includes("abcdefghijklmnop") && !s.includes("iVBORw0KGgo"));
  assert.match(s, /\[redacted\]/);
});
test("scrub bounds size: long strings, long arrays, deep objects, non-finite numbers", () => {
  assert.ok(scrubString("x".repeat(5000)).length <= 301);
  assert.equal(scrub(new Array(100).fill(1)).length, 20);
  assert.equal(scrub({ a: { b: { c: { d: 1 } } } }).a.b.c, "[deep]");
  assert.equal(scrub(NaN), null);
  assert.equal(scrub(() => 1), undefined);
});
test("errors are described without leaking keys and keep a code location", () => {
  const e = new Error("request failed for sk-ant-supersecretvalue");
  e.stack = "Error: boom\n    at fetchIt (http://localhost:5173/src/lib/ai.ts:42:11)\n    at x (http://localhost/node_modules/.vite/deps/react.js:1:1)";
  const d = describeError(e);
  assert.ok(!d.message.includes("supersecretvalue"));
  assert.match(d.where, /src\/lib\/ai\.ts:42/);
  assert.equal(describeError("just a string").message, "just a string");
});
test("metric aggregation keeps count, extremes, and a bounded recent window", () => {
  let m;
  for (let i = 1; i <= 500; i++) m = addSample(m, i);
  const s = summarizeMetric(m);
  assert.equal(s.n, 500);
  assert.equal(s.max, 500);
  assert.equal(s.min, 1);
  assert.equal(m.recent.length, 200);
  assert.ok(s.p95 > 480);
  assert.equal(addSample(undefined, NaN).n, 0);
  assert.equal(percentile([], 0.9), 0);
});

test("input aggregator summarises a window of pen moves", () => {
  const agg = new InputAggregator(100);
  let out = null;
  for (let i = 0; i < 100; i++) out = agg.add({ phase: "move", dt: i % 20 === 0 ? 90 : 16.7, coalesced: 1, pressure: 0.12, handlerMs: 0.1, ptr: "pen" }) ?? out;
  assert.ok(out, "window completes at 100 moves");
  assert.equal(out.moves, 100);
  assert.ok(out.hz > 40 && out.hz < 70);
  assert.ok(out.gaps64Pct > 3 && out.gaps64Pct < 7); // 5 of 100 are 90ms
  assert.equal(out.pressureDistinct, 1);
  assert.equal(out.pointer, "pen");
  assert.equal(agg.add({ phase: "down", dt: 0, coalesced: 1, pressure: 0.5, handlerMs: 0, ptr: "pen" }), null); // only moves count
});

const baseReport = (over = {}) => ({
  format: "pipit-notes-diagnostics", version: 1, generatedAt: Date.now(), app: { version: "0.1.0", build: "t", commit: "abc" }, session: "s1",
  env: { ua: "iPad", dpr: 2, standalone: true }, storage: { persisted: true, usage: 5e7, quota: 5e9 },
  counts: { notes: 3, strokes: 100 }, settings: {}, health: [], metrics: {}, errorsByArea: {}, recent: [], lastBackupAt: null, firstSeenAt: null, ...over,
});
const metric = (vals) => summarizeMetric(vals.reduce((m, v) => addSample(m, v), undefined));

test("a healthy report summarises as ok", () => {
  const r = summarizeReport(baseReport({ health: [{ id: "idb", label: "Storage", status: "ok", detail: "fine" }], metrics: { "save.ms": metric([5, 8, 6]) } }));
  assert.equal(r.severity, "ok");
  assert.deepEqual(r.findings, []);
});
test("slow saves, input stalls and errors are called out", () => {
  const r = summarizeReport(baseReport({
    metrics: { "save.ms": metric(Array(50).fill(900)), "input.gaps64Pct": metric([6, 8, 9]), "input.hz": metric([30, 32]), "input.pressureDistinct": metric([1, 1]) },
    errorsByArea: { save: 3 },
    recent: [{ t: Date.now(), session: "s1", level: "error", area: "save", msg: "QuotaExceededError" }, { t: Date.now(), session: "s1", level: "error", area: "save", msg: "QuotaExceededError" }],
  }));
  assert.equal(r.severity, "warn");
  const text = r.findings.join("\n");
  assert.match(text, /Local saves are slow/);
  assert.match(text, />64 ms/);
  assert.match(text, /only ~3\d Hz/);
  assert.match(text, /flat pressure/);
  assert.match(text, /save×3/);
  assert.match(r.lines.join("\n"), /error ×2 .*save: QuotaExceededError/);
});
test("a bad health check makes the report severity bad", () => {
  const r = summarizeReport(baseReport({ health: [{ id: "evict", label: "Storage cleared", status: "bad", detail: "notes disappeared" }] }));
  assert.equal(r.severity, "bad");
  assert.match(r.findings[0], /✗ Storage cleared/);
});

import { redactNames } from "../src/lib/telemetry-core.ts";
test("known note titles and notebook names are redacted everywhere in a report", () => {
  const out = redactNames({ recent: [{ msg: "failed saving Bio Unit 2 (page 3)", data: { note: "bio unit 2", n: 5, deep: { x: ["Chem 0710 notes"] } } }], other: "fine" }, ["Bio Unit 2", "Chem 0710 notes", "ab"]);
  const text = JSON.stringify(out);
  assert.ok(!/bio unit 2/i.test(text) && !text.includes("Chem 0710"));
  assert.match(text, /\[name\]/);
  assert.equal(out.recent[0].data.n, 5);
  assert.equal(out.other, "fine");
  assert.equal(redactNames("untouched", []), "untouched");
  assert.equal(redactNames("a (b) c", ["(b)"]), "a [name] c"); // regex metacharacters are escaped
});
