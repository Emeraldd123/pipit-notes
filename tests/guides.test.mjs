import test from "node:test";
import assert from "node:assert/strict";
import { closestOnSegment, nearGuide, projectOnGuide, lengthCm, PX_PER_CM } from "../src/lib/guides.ts";

const g = { a: { x: 0, y: 0 }, b: { x: 100, y: 0 } };
test("closest point and distance", () => {
  const c = closestOnSegment({ x: 40, y: 12 }, g);
  assert.deepEqual(c.pt, { x: 40, y: 0 });
  assert.equal(c.dist, 12);
  assert.equal(closestOnSegment({ x: 150, y: 0 }, g).dist, 50);   // beyond the end is measured to the end
});
test("starting a stroke near the edge locks to it; far away does not", () => {
  assert.equal(nearGuide({ x: 50, y: 20 }, g, 30), true);
  assert.equal(nearGuide({ x: 50, y: 60 }, g, 30), false);
});
test("projection keeps points on the edge, within the ruler (plus overhang)", () => {
  assert.deepEqual(projectOnGuide({ x: 30, y: 25 }, g), { x: 30, y: 0 });
  assert.deepEqual(projectOnGuide({ x: 300, y: 25 }, g), { x: 100, y: 0 });
  assert.deepEqual(projectOnGuide({ x: -9, y: 5 }, g, 4), { x: -4, y: 0 });
  const diag = { a: { x: 0, y: 0 }, b: { x: 100, y: 100 } };
  const p = projectOnGuide({ x: 60, y: 40 }, diag);
  assert.ok(Math.abs(p.x - 50) < 1e-9 && Math.abs(p.y - 50) < 1e-9);
});
test("length in cm", () => {
  assert.ok(Math.abs(lengthCm({ a: { x: 0, y: 0 }, b: { x: PX_PER_CM * 10, y: 0 } }) - 10) < 1e-9);
});
