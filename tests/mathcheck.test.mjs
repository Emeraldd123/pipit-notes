import test from "node:test";
import assert from "node:assert/strict";
import { normalizeMathCheck, workingLine } from "../src/lib/mathcheck-core.ts";

const crop = { x: 100, y: 100, w: 400, h: 200 };
const line = { x: 116, y: 220, w: 300, h: 60 };

test("a flagged mistake lands on the line just written, in document coordinates", () => {
  const c = normalizeMathCheck({ kind: "math", ok: false, issues: [{ bbox: [0.5, 0.6, 0.2, 0.3], note: "3 × 4 is 12", fix: "x = 12" }], prev: "x/4 = 3", line: "x = 7" }, crop, line);
  assert.equal(c.ok, false);
  assert.deepEqual(c.issues[0].box, { x: 300, y: 220, w: 80, h: 60 });
  assert.equal(c.prev, "x/4 = 3");
});

test("a box on the line above (or none at all) falls back to the whole line", () => {
  const c = normalizeMathCheck({ kind: "math", issues: [{ bbox: [0.1, 0.0, 0.5, 0.2], note: "wrong" }, { note: "also" }] }, crop, line);
  assert.deepEqual(c.issues.map((i) => i.box), [line, line]);
});

test("words and unfinished work are never marked; replies are cleaned up", () => {
  assert.equal(normalizeMathCheck({ kind: "other", issues: [{ note: "x" }] }, crop, line).ok, true);
  assert.equal(normalizeMathCheck(null, crop, line).kind, "other");
  const chem = normalizeMathCheck({ kind: "chem", issues: [], reaction: { reactants: [{ coef: 2, formula: "H2" }, { formula: "O2" }], products: [{ coef: 2, formula: "H2O" }] } }, crop, line);
  assert.equal(chem.ok, true);
  assert.equal(chem.reaction.reactants[1].coef, 1);
  assert.deepEqual(workingLine("2*x + 3 = 7").kind, "eq");
  assert.deepEqual(workingLine("").kind, "text");
});
