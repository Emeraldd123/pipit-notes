import { test } from "node:test";
import assert from "node:assert/strict";
import { escapeLine, textToLatex, buildLatexDocument } from "../src/lib/latex.ts";
import { buildPageSvg, strokePath } from "../src/lib/svg.ts";
import { PAGE_H, PAGE_GAP } from "../src/lib/page.ts";

test("latex: specials are escaped but maths is untouched", () => {
  assert.equal(escapeLine("50% of H_2O & more"), "50\\% of H\\_2O \\& more");
  assert.equal(escapeLine("rate = $k[A]^2$ in 100% yield"), "rate = $k[A]^2$ in 100\\% yield");
  assert.equal(escapeLine("A -> B"), "A $\\rightarrow$ B");
  assert.equal(escapeLine("$$\\frac{dy}{dx}=2x$$"), "$$\\frac{dy}{dx}=2x$$");
});
test("latex: bullets become itemize, blank lines become paragraphs, [ink] markers dropped", () => {
  const out = textToLatex("[ink] Cell theory\n- cells are small\n- all cells come from cells\n\nNext paragraph");
  assert.match(out, /\\begin\{itemize\}\n  \\item cells are small\n  \\item all cells come from cells\n\\end\{itemize\}/);
  assert.ok(!out.includes("[ink]"));
  assert.match(out, /Next paragraph/);
});
test("latex: document is well-formed", () => {
  const doc = buildLatexDocument("Chem & Bio_1", [{ page: 0, text: "hello $x^2$" }, { page: 1, text: "" }, { page: 2, text: "bye" }]);
  assert.match(doc, /^\\documentclass/);
  assert.match(doc, /\\title\{Chem \\& Bio\\_1\}/);
  assert.match(doc, /\\end\{document\}\n$/);
  assert.equal((doc.match(/\\newpage/g) ?? []).length, 1); // 2 non-empty pages
  assert.ok(buildLatexDocument("x", []).includes("no readable text yet"));
});

test("svg: path is smooth and offset to the page", () => {
  const d = strokePath([{ x: 10, y: 100 }, { x: 20, y: 110 }, { x: 30, y: 100 }], 100);
  assert.match(d, /^M10 0C/);
  assert.equal((d.match(/C/g) ?? []).length, 2);
});
test("svg: only strokes/images on the requested page are included", () => {
  const p2 = PAGE_H + PAGE_GAP;
  const s = (y) => ({ tool: "pen", color: "#111", width: 3, points: [{ x: 5, y }, { x: 9, y: y + 4 }] });
  const hl = { tool: "highlighter", color: "#fde047", width: 4, points: [{ x: 1, y: 50 }, { x: 80, y: 50 }] };
  const img = (y) => ({ dataUrl: "data:image/png;base64,AAA", x: 0, y, width: 100, height: 100, rotation: 0, zIndex: 0 });
  const page0 = buildPageSvg(0, [s(100), s(p2 + 100), hl], [img(10), img(p2 + 10)]);
  assert.equal((page0.match(/<path/g) ?? []).length, 2);
  assert.equal((page0.match(/<image/g) ?? []).length, 1);
  assert.match(page0, /mix-blend-mode:multiply/);
  const page1 = buildPageSvg(1, [s(100), s(p2 + 100)], [img(10), img(p2 + 10)]);
  assert.equal((page1.match(/<path/g) ?? []).length, 1);
  assert.match(page1, /viewBox="0 0 1240 1754"/);
});
