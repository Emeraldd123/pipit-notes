import { test } from "node:test";
import assert from "node:assert/strict";
import { compile, parseEquation, normalize, realPow, MathParseError, expressionRows } from "../src/lib/mathexpr.ts";

const ev = (src, x = 0, y = 0) => compile(src).fn({ x, y });
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);

test("arithmetic and precedence", () => {
  assert.equal(ev("2x+3", 4), 11);
  assert.equal(ev("x^2", 5), 25);
  assert.equal(ev("-x^2", 3), -9);           // -(x^2), not (-x)^2
  assert.equal(ev("(-x)^2", 3), 9);
  assert.equal(ev("2^3^2"), 512);            // right-associative
  assert.equal(ev("10-4-3"), 3);             // left-associative
  assert.equal(ev("8/2/2"), 2);
  assert.equal(ev("x^-2", 2), 0.25);
  assert.equal(ev("2^-x", 3), 0.125);
  assert.equal(ev("1e3 + 2.5"), 1002.5);
});
test("implicit multiplication the way people write it", () => {
  assert.equal(ev("2x", 5), 10);
  assert.equal(ev("2(x+1)", 3), 8);
  assert.equal(ev("x(x+1)", 3), 12);
  assert.equal(ev("(x+1)(x-1)", 4), 15);
  assert.equal(ev("xy", 2, 3), 6);
  assert.equal(ev("3xy^2", 1, 2), 12);
  assert.equal(ev("2pi") / Math.PI, 2);
  close(ev("1/2x", 4), 2); // (1/2)*x
});
test("functions, with and without parentheses", () => {
  close(ev("sin(pi/2)"), 1);
  close(ev("3sin(x)", Math.PI / 6), 1.5);
  close(ev("sin x^2", 2), Math.sin(4));      // sin(x^2)
  close(ev("sin 2x", Math.PI / 4), 1);       // sin(2x)
  close(ev("sin 2x cos x", 0.5), Math.sin(1) * Math.cos(0.5)); // stops before the next function
  close(ev("e^x", 1), Math.E);
  close(ev("ln(e)"), 1);
  close(ev("log(1000)"), 3);
  assert.equal(ev("abs(-3)"), 3);
  assert.equal(ev("max(2, x)", 5), 5);
  close(ev("sqrt(16)+cbrt(27)"), 7);
});
test("domain edges give NaN / Infinity, not exceptions", () => {
  assert.ok(Number.isNaN(ev("sqrt(x)", -1)));
  assert.ok(Number.isNaN(ev("ln(x)", -1)));
  assert.equal(ev("1/x", 0), Infinity);
  assert.equal(realPow(-8, 1 / 3), -2);      // real cube root of a negative
  assert.equal(realPow(-8, 2 / 3), 4);
  assert.ok(Number.isNaN(realPow(-8, 0.5)));
  assert.equal(ev("x^(1/3)", -27), -3);
});
test("unicode and LaTeX input", () => {
  close(ev("x² + π", 3), 9 + Math.PI);
  assert.equal(ev("2 × 3 − 1"), 5);
  assert.equal(ev(String.raw`\frac{x^{2}}{2}+\sin(0)`, 4), 8);
  assert.equal(ev(String.raw`\frac{1}{\frac{1}{2}}`), 2);   // nested fractions
  assert.equal(ev(String.raw`x^{2}`, 3), 9);
  assert.equal(ev(String.raw`3 \cdot x`, 5), 15);
  close(ev(String.raw`\sqrt{x}+\sqrt{4}`, 9), 5);
  close(ev(String.raw`\sin(x)\cos(x)`, 0.3), Math.sin(0.3) * Math.cos(0.3));
  assert.equal(normalize(String.raw`x\left(x+1\right)`), "x(x+1)");
});
test("bad input raises a clear MathParseError (never executes anything)", () => {
  for (const bad of ["2+", "(", "sin(", "1 +* 2", "x ** ", "", "   ", "a+1", "foo(2)", "max(1)", "2 $ 3", "alert(1)", "constructor", "x.y"]) {
    assert.throws(() => compile(bad), MathParseError, bad);
  }
  assert.throws(() => compile("(x+1))"), /unmatched/);
  assert.throws(() => compile("x_1"), MathParseError);
  assert.throws(() => compile("a = b = c") && parseEquation("a = b = c"), MathParseError);
});
test("equation kinds", () => {
  assert.equal(parseEquation("y = x^2 + 3x").kind, "explicit");
  assert.equal(parseEquation("x^2").kind, "explicit");
  assert.equal(parseEquation("f(x) = sin(x)").kind, "explicit");
  assert.equal(parseEquation("z = x^2 + y^2").kind, "surface");
  assert.equal(parseEquation("x^2 + y^2").kind, "surface");
  assert.equal(parseEquation("x = y^2").kind, "inverse");
  const circle = parseEquation("x^2 + y^2 = 4");
  assert.equal(circle.kind, "implicit");
  close(circle.f({ x: 2, y: 0 }), 0);          // on the circle
  assert.ok(circle.f({ x: 0, y: 0 }) < 0);     // inside
  assert.ok(circle.f({ x: 3, y: 0 }) > 0);     // outside
  assert.equal(parseEquation("y = x + y").kind, "implicit");
});
test("expression rows ignore blanks", () => {
  assert.deepEqual(expressionRows("y = x\n\n  y = x^2  \n"), ["y = x", "y = x^2"]);
});
