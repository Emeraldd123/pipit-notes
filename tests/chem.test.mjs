import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFormula, molarMass, checkEquation, balanceCoefficients, formatEquation } from "../src/lib/chem.ts";

const cnt = (f) => Object.fromEntries([...parseFormula(f).counts].sort());
const eq = (l, r) => ({ reactants: l.map(([coef, formula]) => ({ coef, formula })), products: r.map(([coef, formula]) => ({ coef, formula })) });

test("formula parsing: groups, hydrates, charges", () => {
  assert.deepEqual(cnt("H2O"), { H: 2, O: 1 });
  assert.deepEqual(cnt("Ca(OH)2"), { Ca: 1, H: 2, O: 2 });
  assert.deepEqual(cnt("(NH4)2SO4"), { H: 8, N: 2, O: 4, S: 1 });
  assert.deepEqual(cnt("Ba(OH)2·8H2O"), { Ba: 1, H: 18, O: 10 });
  assert.deepEqual(cnt("CuSO4·5H2O"), { Cu: 1, H: 10, O: 9, S: 1 });
  assert.deepEqual(cnt("Al2(SO4)3"), { Al: 2, O: 12, S: 3 });
  assert.equal(parseFormula("Fe^3+").charge, 3);
  assert.equal(parseFormula("SO4^2-").charge, -2);
  assert.equal(parseFormula("Cl^-").charge, -1);
  assert.deepEqual(cnt("SO4^2-"), { O: 4, S: 1 });
  assert.throws(() => parseFormula("Xx2"), /unknown element/);
  assert.throws(() => parseFormula("Ca(OH"), /closing bracket/);
});
test("molar masses", () => {
  assert.ok(Math.abs(molarMass("H2O") - 18.015) < 0.01);
  assert.ok(Math.abs(molarMass("CaCO3") - 100.086) < 0.01);
  assert.ok(Math.abs(molarMass("C6H12O6") - 180.156) < 0.01);
});
test("balance check flags unbalanced equations and shows per-element counts", () => {
  const r = checkEquation(eq([[1, "H2"], [1, "O2"]], [[1, "H2O"]]));
  assert.equal(r.balanced, false);
  assert.deepEqual(r.elements, [{ el: "H", left: 2, right: 2, ok: true }, { el: "O", left: 2, right: 1, ok: false }]);
  assert.deepEqual(r.suggested, [2, 1, 2]);
  assert.equal(checkEquation(eq([[2, "H2"], [1, "O2"]], [[2, "H2O"]])).balanced, true);
});
test("finds smallest whole-number coefficients", () => {
  assert.deepEqual(balanceCoefficients(eq([[1, "C3H8"], [1, "O2"]], [[1, "CO2"], [1, "H2O"]])), [1, 5, 3, 4]);
  assert.deepEqual(balanceCoefficients(eq([[1, "KMnO4"], [1, "HCl"]], [[1, "KCl"], [1, "MnCl2"], [1, "Cl2"], [1, "H2O"]])), [2, 16, 2, 2, 5, 8]);
  assert.deepEqual(balanceCoefficients(eq([[1, "Fe"], [1, "O2"]], [[1, "Fe2O3"]])), [4, 3, 2]);
  assert.deepEqual(balanceCoefficients(eq([[1, "Al"], [1, "HCl"]], [[1, "AlCl3"], [1, "H2"]])), [2, 6, 2, 3]);
});
test("charge is balanced too (ionic equations)", () => {
  const ionic = eq([[1, "Fe^3+"], [1, "Sn^2+"]], [[1, "Fe^2+"], [1, "Sn^4+"]]);
  assert.equal(checkEquation(ionic).balanced, false);
  assert.deepEqual(balanceCoefficients(ionic), [2, 1, 2, 1]);
  const ok = eq([[2, "Fe^3+"], [1, "Sn^2+"]], [[2, "Fe^2+"], [1, "Sn^4+"]]);
  assert.equal(checkEquation(ok).balanced, true);
  // atoms balance but charge doesn't
  const bad = checkEquation(eq([[1, "Ag^+"], [1, "Cl^-"]], [[1, "AgCl^+"]]));
  assert.equal(bad.charge.ok, false);
});
test("ambiguous or impossible equations give no suggestion", () => {
  assert.equal(balanceCoefficients(eq([[1, "H2"]], [[1, "O2"]])), null);
  assert.equal(balanceCoefficients(eq([[1, "H2"], [1, "O2"]], [[1, "H2O"], [1, "H2O2"]])), null); // two independent solutions
  assert.equal(checkEquation(eq([[1, "Zz"]], [[1, "H2"]])).errors.length > 0, true);
});
test("formatting", () => {
  const e = eq([[1, "H2"], [1, "O2"]], [[1, "H2O"]]);
  assert.equal(formatEquation(e), "H2 + O2 → H2O");
  assert.equal(formatEquation(e, [2, 1, 2]), "2 H2 + O2 → 2 H2O");
});
