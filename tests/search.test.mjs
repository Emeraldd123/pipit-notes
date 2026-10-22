import { test } from "node:test";
import assert from "node:assert/strict";
import { scorePage, snippetFor, pageFingerprints } from "../src/lib/search-core.ts";
import { PAGE_H, PAGE_GAP } from "../src/lib/page.ts";

test("math-tolerant phrase matching", () => {
  assert.ok(scorePage("sin(x^2)", "d/dx $\sin(x^2)$ = $\cos(x^2) \cdot 2x$") > 0);
  assert.ok(scorePage("cos(x^2)", "d/dx $\sin(x^2)$ = $\cos(x^2) \cdot 2x$") > 0);
  assert.equal(scorePage("mitochondria", "the nucleus and ribosomes"), 0);
});
test("ranking prefers pages with more / closer matches", () => {
  const a = scorePage("hess law enthalpy", "Hess's law: enthalpy change is path independent. Hess's law again, enthalpy.");
  const b = scorePage("hess law enthalpy", "Today we covered gases and a bit of enthalpy.");
  assert.ok(a > b && b > 0);
});
test("empty query scores nothing", () => { assert.equal(scorePage("  ", "anything"), 0); });
test("snippet centres on the match", () => {
  const text = "x".repeat(300) + " the Krebs cycle produces NADH " + "y".repeat(300);
  const s = snippetFor("krebs cycle", text);
  assert.ok(s.includes("Krebs cycle") && s.startsWith("…") && s.endsWith("…"));
});
test("page fingerprints change only for the edited page", () => {
  const mk = (y, x = 0) => ({ tool: "pen", color: "#000", width: 3, points: [{ x, y }, { x: x + 5, y: y + 5 }] });
  const p2 = PAGE_H + PAGE_GAP;
  const base = { strokes: [mk(100), mk(p2 + 100)], images: [] };
  const edited = { strokes: [mk(100), mk(p2 + 100), mk(p2 + 200)], images: [] };
  const a = pageFingerprints(base, 2), b = pageFingerprints(edited, 2);
  assert.equal(a[0].hash, b[0].hash);
  assert.notEqual(a[1].hash, b[1].hash);
  assert.deepEqual([a[0].strokes, a[1].strokes, b[1].strokes], [1, 1, 2]);
});

import { findBoxes, boxToDoc } from "../src/lib/search-core.ts";
test("locating a hit on a PDF page", () => {
  const boxes = [
    { s: "Newton's second law", x: 0.1, y: 0.1, w: 0.3, h: 0.02 },
    { s: "F = ma", x: 0.1, y: 0.2, w: 0.1, h: 0.02 },
    { s: "momentum", x: 0.5, y: 0.5, w: 0.1, h: 0.02 },
  ];
  assert.equal(findBoxes("second law", boxes).length, 1);
  assert.equal(findBoxes("f = ma", boxes)[0].y, 0.2);
  assert.equal(findBoxes("momentum forces", boxes)[0].s, "momentum");   // falls back to individual words
  assert.deepEqual(findBoxes("zzz", boxes), []);
  assert.deepEqual(findBoxes("", boxes), []);
  const d = boxToDoc(boxes[1], { x: 100, y: 1000, width: 1000, height: 1400 });
  assert.equal(d.x, 100 + 100 - 3);
  assert.equal(d.y, 1000 + 280 - 2);
});
