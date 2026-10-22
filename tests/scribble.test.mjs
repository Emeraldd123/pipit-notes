import test from "node:test";
import assert from "node:assert/strict";
import { isScribble, strokesUnder, reversals } from "../src/lib/scribble.ts";

const zig = (n, w = 160, h = 60) => Array.from({ length: n * 6 + 1 }, (_, i) => {
  const seg = Math.floor(i / 6), t = (i % 6) / 6;
  const x0 = seg % 2 ? w : 0, x1 = seg % 2 ? 0 : w;
  return { x: 100 + x0 + (x1 - x0) * t, y: 100 + (seg / n) * h + (i % 2) };
});
const line = Array.from({ length: 40 }, (_, i) => ({ x: i * 6, y: 50 + Math.sin(i / 5) * 3 }));
const circle = Array.from({ length: 60 }, (_, i) => ({ x: 100 + 40 * Math.cos((i / 60) * 6.28), y: 100 + 40 * Math.sin((i / 60) * 6.28) }));

test("a back-and-forth zigzag is a scribble", () => {
  assert.ok(reversals(zig(7)) >= 5);
  assert.equal(isScribble(zig(7)), true);
});
test("ordinary writing and shapes are not", () => {
  assert.equal(isScribble(line), false);
  assert.equal(isScribble(circle), false);
  assert.equal(isScribble(zig(2)), false);                    // a 'w'-ish squiggle is left alone
  assert.equal(isScribble(line.slice(0, 5)), false);
});
test("only ink that sits under the scribble is picked", () => {
  const scrib = zig(7);
  const under = { points: [{ x: 120, y: 120 }, { x: 180, y: 125 }, { x: 240, y: 130 }] };
  const away = { points: [{ x: 900, y: 900 }, { x: 950, y: 910 }] };
  const longer = { points: [{ x: 0, y: 120 }, { x: 600, y: 125 }] };   // a long underline only partly covered survives
  assert.deepEqual(strokesUnder(scrib, [under, away, longer]), [0]);
});
