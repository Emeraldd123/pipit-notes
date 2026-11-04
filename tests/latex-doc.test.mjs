import test from "node:test";
import assert from "node:assert/strict";
import { normalizeLatexPage, buildLatexDoc, rich, mathToLatex, tableToLatex, pgfExpr, redrawToLatex, flowLayers, graphBlockRedraw, latexSystem } from "../src/lib/latex-doc.ts";

const balanced = (s) => {
  const envs = [...s.matchAll(/\\(begin|end)\{([^}]+)\}/g)];
  const stack = [];
  for (const [, kind, name] of envs) {
    if (kind === "begin") stack.push(name);
    else if (stack.pop() !== name) return false;
  }
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\") { i++; continue; }
    depth += s[i] === "{" ? 1 : s[i] === "}" ? -1 : 0;
    if (depth < 0) return false;
  }
  return stack.length === 0 && depth === 0;
};

test("text: specials escaped, maths and \\ce kept, bold/highlight converted, symbols made printable", () => {
  assert.equal(rich("50% of R_1 & $x_1^2$"), "50\\% of R\\_1 \\& $x_1^2$");
  assert.equal(rich("**Osmosis** moves \\ce{H2O} -> fast"), "\\textbf{Osmosis} moves \\ce{H2O} $\\rightarrow$ fast");
  assert.equal(rich("==key idea=="), "\\hl{key idea}");
  assert.equal(rich("10 Ω at 25°C"), "10 $\\Omega$ at 25$^\\circ$C");
  assert.equal(rich("\\ce{A -> B}"), "\\ce{A -> B}");   // mhchem arrows are left alone
});

test("working lines up at the relation", () => {
  assert.equal(mathToLatex(["E = mc^2"]), "\\[\nE = mc^2\n\\]");
  assert.equal(mathToLatex(["2x + 3 = 7", "2x = 4", "x = 2"]), "\\begin{align*}\n2x + 3 &= 7 \\\\\n2x &= 4 \\\\\nx &= 2\n\\end{align*}");
  assert.match(mathToLatex(["f(x) &= x^2", "&= 4"]), /f\(x\) &= x\^2 \\\\\n&= 4/);
});

test("tables: booktabs, bold header, numeric columns right-aligned, ragged rows padded", () => {
  const t = tableToLatex({ header: ["Time (s)", "Distance (m)"], rows: [["0", "0.0"], ["1", "4.9"], ["2"]], caption: "Falling ball" });
  assert.match(t, /\\begin\{tabular\}\{rr\}/);
  assert.match(t, /\\textbf\{Time \(s\)\} & \\textbf\{Distance \(m\)\} \\\\/);
  assert.match(t, /2 &  \\\\/);
  assert.ok(balanced(t));
});

test("function expressions are converted for pgfplots, or refused", () => {
  assert.equal(pgfExpr("y = 3x^2 - 2x + 1"), "3*x^2-2*x+1");
  assert.equal(pgfExpr("e^(-x)"), "exp(-x)");
  assert.equal(pgfExpr("2sin(x)"), "2*sin(x)");
  assert.equal(pgfExpr("|x|"), "abs(x)");
  assert.equal(pgfExpr("x^2 + y^2 = 25"), null);
  assert.equal(pgfExpr("\\input{evil}"), null);
  assert.equal(pgfExpr("foo(x)"), null);
});

test("a model reply becomes elements; malformed parts are dropped, figures get ids", () => {
  const p = normalizeLatexPage({ elements: [
    { t: "heading", level: 1, text: "Kinematics", y: 0.02 },
    { t: "math", lines: ["$v = u + at$"], y: 0.2 },
    { t: "figure", bbox: [0.1, 0.4, 0.5, 0.3], caption: "v–t graph", kind: "plot", y: 0.4, redraw: { kind: "plot", xlabel: "t (s)", ylabel: "v (m/s)", xmin: 0, xmax: 10, curves: [{ expr: "2*x + 1" }] } },
    { t: "figure", bbox: [0.1, 0.8, 0.4, 0.1], kind: "drawing", redraw: { kind: "plot", curves: [{ expr: "rm -rf" }] } },
    { t: "figure", bbox: "nope" },
    { t: "mystery", text: "?" },
    { t: "para", text: "" },
  ] }, 0);
  assert.deepEqual(p.elements.map((e) => e.t), ["heading", "math", "figure", "figure"]);
  assert.equal(p.elements[1].lines[0], "v = u + at");
  assert.equal(p.elements[2].id, "p1-f1");
  assert.equal(p.elements[2].redraw.kind, "plot");
  assert.equal(p.elements[3].redraw, null);           // unreadable spec: keep the drawing instead
  assert.deepEqual(normalizeLatexPage(null, 3).elements, []);
});

test("every redraw kind produces well-formed LaTeX", () => {
  const plot = redrawToLatex({ kind: "plot", xlabel: "$x$", ylabel: "$y$", xmin: -3, xmax: 3, curves: [{ expr: "x^2", label: "$x^2$" }, { points: [[0, 1], [1, 2]], label: "" }], marks: [{ x: 0, y: 0, label: "origin" }] });
  assert.match(plot, /axis lines=middle/);
  assert.match(plot, /\\addplot\[thick, blue\] \{x\^2\};/);
  const bar = redrawToLatex({ kind: "chart", type: "bar", categories: ["A & B", "C"], series: [{ name: "2024", values: [3, 5] }], xlabel: "", ylabel: "Count" });
  assert.match(bar, /ybar/);
  assert.match(bar, /A \\& B/);
  const pie = redrawToLatex({ kind: "chart", type: "pie", categories: ["Yes", "No"], series: [{ name: "", values: [60, 40] }], xlabel: "", ylabel: "" });
  assert.match(pie, /\\pie\[radius=2\.4, text=legend\]\{60\/Yes, 40\/No\}/);
  const flow = redrawToLatex({ kind: "flow", layout: "down", nodes: [{ id: "g", label: "Glucose" }, { id: "p", label: "Pyruvate" }, { id: "a", label: "Acetyl-CoA" }], edges: [{ from: "g", to: "p", label: "glycolysis" }, { from: "p", to: "a", label: "" }] });
  assert.match(flow, /\\node\[box\] \(n0\) at \(0,0\) \{Glucose\};/);
  assert.match(flow, /\(n1\) at \(0,-1\.9\)/);
  const cycle = redrawToLatex({ kind: "flow", layout: "cycle", nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }, { id: "c", label: "C" }], edges: [{ from: "a", to: "b", label: "" }, { from: "b", to: "c", label: "" }, { from: "c", to: "a", label: "" }] });
  assert.match(cycle, /bend left/);
  const circuit = redrawToLatex({ kind: "circuit", parts: [{ type: "battery", label: "6 V" }, { type: "resistor", label: "10 Ω" }, { type: "lamp", label: "" }] });
  assert.match(circuit, /to\[battery1, l=6 V\]/);
  assert.match(circuit, /to\[R, l=10 \$\\Omega\$\]/);
  for (const s of [plot, bar, pie, flow, cycle, circuit]) assert.ok(balanced(s), s);
});

test("flow layers survive cycles", () => {
  const l = flowLayers([{ id: "a" }, { id: "b" }, { id: "c" }], [{ from: "a", to: "b" }, { from: "b", to: "c" }, { from: "c", to: "a" }]);
  assert.deepEqual([...l.values()], [0, 1, 2]);
});

test("graph blocks typed in the app become plots", () => {
  assert.equal(graphBlockRedraw("y = x^2\ny = 2x + 1").curves.length, 2);
  assert.equal(graphBlockRedraw("x^2 + y^2 = 25"), null);
});

test("the whole document: packages only when needed, figures redrawn or as images, original kept in a comment", () => {
  const pages = [normalizeLatexPage({ elements: [
    { t: "heading", text: "Circuits", y: 0 },
    { t: "box", title: "Definition", text: "Ohm's law: $V = IR$", y: 0.1 },
    { t: "chem", lines: ["2H2 + O2 -> 2H2O"], y: 0.3 },
    { t: "figure", bbox: [0.1, 0.5, 0.5, 0.3], caption: "Series circuit", kind: "circuit", y: 0.5, redraw: { kind: "circuit", parts: [{ type: "battery", label: "" }, { type: "resistor", label: "R" }] } },
    { t: "figure", bbox: [0.1, 0.85, 0.3, 0.1], caption: "A cell", kind: "drawing", y: 0.85, redraw: null },
  ] }, 0), { page: 1, elements: [] }];
  const doc = buildLatexDoc("Physics & Chem", pages);
  assert.ok(balanced(doc));
  assert.match(doc, /\\usepackage\{circuitikz\}/);
  assert.match(doc, /\\usepackage\{tcolorbox\}/);
  assert.doesNotMatch(doc, /pgfplots|pgf-pie/);
  assert.match(doc, /\\ce\{2H2 \+ O2 -> 2H2O\}/);
  assert.match(doc, /% \\includegraphics\[width=0\.525\\linewidth\]\{figures\/p1-f1\.png\}/);
  assert.match(doc, /\\includegraphics\[width=0\.315\\linewidth\]\{figures\/p1-f2\.png\}/);
  assert.match(doc, /\\title\{Physics \\& Chem\}/);
  const asImages = buildLatexDoc("x", pages, () => "image");
  assert.doesNotMatch(asImages, /circuitikz/);
  assert.match(asImages, /^\\includegraphics\[width=0\.525\\linewidth\]\{figures\/p1-f1\.png\}$/m);
});

test("the prompt switches on printed text", () => {
  assert.match(latexSystem(true), /IGNORE all printed text/);
  assert.match(latexSystem(false), /Include printed text/);
});

test("typed blocks join the page: maths verbatim, graphs as plots (with pgfplots loaded)", async () => {
  const { blockToElement } = await import("../src/lib/latex-doc.ts");
  assert.equal(blockToElement({ kind: "math", text: String.raw`\int_0^1 x\,dx` }, 0.5).latex, String.raw`\[` + "\n" + String.raw`\int_0^1 x\,dx` + "\n" + String.raw`\]`);
  assert.equal(blockToElement({ kind: "text", text: "  " }, 0), null);
  const g = blockToElement({ kind: "graph", text: "y = sin(x)" }, 0.2);
  const doc = buildLatexDoc("t", [{ page: 0, elements: [g] }]);
  assert.match(doc, /\\usepackage\{pgfplots\}/);
  assert.match(doc, /\\addplot\[thick, blue\] \{sin\(x\)\};/);
  assert.ok(balanced(doc));
});
