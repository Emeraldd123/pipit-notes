import test from "node:test";
import assert from "node:assert/strict";
import { SYMBOLS, cellOf, categoryOf } from "../src/lib/periodic.ts";

test("118 elements with well-known anchors", () => {
  assert.equal(SYMBOLS.length, 118);
  assert.equal(new Set(SYMBOLS).size, 118);
  const z = (s) => SYMBOLS.indexOf(s) + 1;
  assert.deepEqual([z("H"), z("C"), z("Fe"), z("Ag"), z("Au"), z("U"), z("Og")], [1, 6, 26, 47, 79, 92, 118]);
});
test("every element has its own cell; groups line up", () => {
  const seen = new Set();
  for (let n = 1; n <= 118; n++) { const c = cellOf(n); const k = `${c.col},${c.row}`; assert.ok(!seen.has(k), `clash at ${n} ${k}`); seen.add(k); assert.ok(c.col >= 1 && c.col <= 18 && c.row >= 1 && c.row <= 10); }
  const z = (s) => SYMBOLS.indexOf(s) + 1;
  assert.equal(cellOf(z("Na")).col, 1); assert.equal(cellOf(z("K")).col, 1); assert.equal(cellOf(z("Cl")).col, 17);
  assert.equal(cellOf(z("Ne")).col, 18); assert.equal(cellOf(z("Fe")).col, 8); assert.equal(cellOf(z("Pb")).col, 14);
  assert.equal(cellOf(z("Og")).col, 18); assert.equal(cellOf(z("Og")).row, 7);
  assert.equal(cellOf(z("La")).row, 9); assert.equal(cellOf(z("Lu")).row, 6);
});
test("categories", () => {
  const z = (s) => SYMBOLS.indexOf(s) + 1;
  assert.equal(categoryOf(z("Na")), "alkali"); assert.equal(categoryOf(z("Cl")), "halogen"); assert.equal(categoryOf(z("Ar")), "noble");
  assert.equal(categoryOf(z("Fe")), "transition"); assert.equal(categoryOf(z("Si")), "metalloid"); assert.equal(categoryOf(z("Ce")), "lanthanide");
  assert.equal(categoryOf(z("O")), "nonmetal"); assert.equal(categoryOf(z("Al")), "post");
});
