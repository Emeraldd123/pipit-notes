import { test } from "node:test";
import assert from "node:assert/strict";
import { computeDelta, strokeSig } from "../src/lib/delta.ts";

const mk = (id, color = "#000", n = 3, x0 = 0) => ({ id, tool: "pen", color, width: 3, points: Array.from({ length: n }, (_, i) => ({ x: x0 + i, y: i })) });
const sigs = (arr) => new Map(arr.map((s) => [s.id, strokeSig(s)]));

test("incremental save diffs", () => {
  const saved = sigs([mk("a"), mk("b")]);
  let d = computeDelta([mk("a"), mk("b"), mk("c")], saved);
  assert.deepEqual([d.upserts.map((s) => s.id), d.deletes], [["c"], []]);
  d = computeDelta([mk("a"), mk("b")], saved);
  assert.deepEqual([d.upserts.length, d.deletes.length], [0, 0]);
  d = computeDelta([mk("a", "#f00"), mk("b")], saved);
  assert.deepEqual(d.upserts.map((s) => s.id), ["a"]);
  d = computeDelta([mk("a", "#000", 3, 50), mk("b")], saved);
  assert.deepEqual(d.upserts.map((s) => s.id), ["a"]);
  d = computeDelta([mk("a")], saved);
  assert.deepEqual([d.upserts.length, d.deletes], [0, ["b"]]);
});
test("adopting the new baseline makes the next diff empty; undo re-adds", () => {
  const saved = sigs([mk("a"), mk("b")]);
  const erased = computeDelta([mk("a")], saved);
  const undone = computeDelta([mk("a"), mk("b")], erased.next);
  assert.deepEqual([undone.upserts.map((s) => s.id), undone.deletes], [["b"], []]);
  const again = computeDelta([mk("a"), mk("b")], undone.next);
  assert.deepEqual([again.upserts.length, again.deletes.length], [0, 0]);
});
test("a stroke with no id is given one", () => {
  const s = { tool: "pen", color: "#000", width: 3, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] };
  const d = computeDelta([s], new Map());
  assert.ok(s.id && d.upserts[0].id === s.id);
});
