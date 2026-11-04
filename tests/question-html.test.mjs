import test from "node:test";
import assert from "node:assert/strict";
import { parseQuestionText, questionHtml, figureHtml } from "../tools/question-html.mjs";
import { questionText } from "../tools/exam-lab.mjs";

const q = {
  id: "q1", basis: { kind: "case", principle: "NADH yields more ATP than FADH2" },
  stem: "The table shows the reduced coenzymes made at each stage.",
  figure: { type: "table", headers: ["Stage", "NADH"], rows: [["Glycolysis", 2], ["Krebs cycle", 6]] },
  parts: [
    { label: "a", type: "mcq", marks: 2, prompt: "Total NADH per glucose?", options: ["12", "8", "10", "6"], correct: 2, answer: "10 — 2 + 2 + 6", scheme: ["Adds all three stages"] },
    { label: "b", type: "numeric", marks: 3, prompt: "Total ATP at $2.5$ per NADH?", answer: "25", scheme: ["10 × 2.5", "= 25"], figure: { type: "graph", x: [0, 5], curves: [{ expr: "2x" }] } },
  ],
};

test("a question survives the judge's text form: stem, figures, parts, options, answer, scheme", () => {
  const back = parseQuestionText(questionText(q));
  assert.equal(back.stem, q.stem);
  assert.equal(back.kind, "case");
  assert.equal(back.principle, q.basis.principle);
  assert.deepEqual(back.figure, q.figure);
  assert.equal(back.parts.length, 2);
  assert.deepEqual(back.parts[0].options, q.parts[0].options);
  assert.equal(back.parts[0].correct, 2);
  assert.equal(back.parts[1].marks, 3);
  assert.deepEqual(back.parts[1].scheme, q.parts[1].scheme);
  assert.equal(back.parts[1].figure.type, "graph");
});

test("figures are drawn: tables as tables, graphs as SVG; text is escaped, maths kept for KaTeX", () => {
  const html = questionHtml({ ...q, stem: "Is 2 < 3 & <b>bold</b>?" });
  assert.match(html, /<table class="ftable">/);
  assert.match(html, /<svg viewBox=/);
  assert.match(html, /class="right"><span class="letter">C<\/span>/);
  assert.match(html, /Is 2 &lt; 3 &amp; &lt;b&gt;bold&lt;\/b&gt;\?/);
  assert.match(html, /\$2\.5\$/);
  assert.match(figureHtml({ type: "nonsense" }), /couldn't be drawn/);
  assert.equal(figureHtml(null), "");
});
