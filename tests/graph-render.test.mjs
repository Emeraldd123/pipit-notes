import test from "node:test";
import assert from "node:assert/strict";
import { parseRows, is3D, niceStep } from "../src/lib/graph-render.ts";

test("rows parse into curve kinds, with per-row errors instead of throwing", () => {
  const rows = parseRows("y = x^2 + 3x\nx^2 + y^2 = 25\nx = y^2\nsin(\n\nz = sin(x) cos(y)");
  assert.deepEqual(rows.map((r) => r.eq?.kind ?? "error"), ["explicit", "implicit", "inverse", "error", "surface"]);
  assert.ok(rows[3].error);                 // the broken row is reported, the others still plot
  assert.equal(is3D(rows), true);
  assert.equal(is3D(parseRows("y = x")), false);
});

test("a circle's implicit function is zero on the circle and signed either side", () => {
  const [r] = parseRows("x^2 + y^2 = 25");
  const f = r.eq.f;
  assert.equal(f({ x: 3, y: 4 }), 0);
  assert.ok(f({ x: 0, y: 0 }) < 0);
  assert.ok(f({ x: 6, y: 0 }) > 0);
});

test("handwriting-style LaTeX graphs too", () => {
  const [r] = parseRows(String.raw`y = \frac{x^{2}}{2} - 3`);
  assert.equal(r.eq.kind, "explicit");
  assert.equal(r.eq.f({ x: 4, y: 0 }), 5);
});

test("axis ticks land on 1/2/5 steps", () => {
  assert.equal(niceStep(20, 8), 2);
  assert.equal(niceStep(10, 10), 1);
  assert.equal(niceStep(0.5, 5), 0.1);
  assert.equal(niceStep(1000, 10), 100);
});
