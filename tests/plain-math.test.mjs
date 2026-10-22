import test from "node:test";
import assert from "node:assert/strict";
import { plainMath } from "../src/lib/plain-math.ts";

test("LaTeX becomes readable text", () => {
  assert.equal(plainMath("A square root has **two** values: $\\pm\\sqrt{a}$."), "A square root has two values: ±√(a).");
  assert.equal(plainMath("$x^2 + y^{10} = 1$"), "x² + y¹⁰ = 1");
  assert.equal(plainMath("$\\frac{1}{2}mv^2$"), "(1)/(2)mv²");
  assert.equal(plainMath("$\\frac{x^{2}}{2}$"), "(x²)/(2)");
  assert.equal(plainMath("H_2O and CO_{2}"), "H₂O and CO₂");
  assert.equal(plainMath("$\\Delta x \\approx 3 \\times 10^{-3}$"), "Δx ≈ 3 × 10⁻³");
  assert.equal(plainMath("plain text stays"), "plain text stays");
});
