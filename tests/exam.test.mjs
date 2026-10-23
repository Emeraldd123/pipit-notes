import test from "node:test";
import assert from "node:assert/strict";
import { normalizeFigure, drawFigure, drawGraph, autoYRange, explicitExpr, niceStep, drawChart } from "../src/lib/figure-core.ts";
import { normalizeExam, markObjective, extractNumber, buildResult, band, allParts, needsAi } from "../src/lib/exam-core.ts";

// --- figures -------------------------------------------------------------------------------------------------
test("graph figures accept sensible specs and drop bad curves", () => {
  const f = normalizeFigure({
    type: "graph", x: [-3, 5], title: "Projectile", xLabel: "t (s)", yLabel: "h (m)",
    curves: [{ expr: "y = -5x^2 + 20x", label: "h(t)" }, { expr: "alert(1)" }, { expr: "x^2 + y^2 = 4" }, { expr: "2x + 1" }],
    points: [{ x: 2, y: 20, label: "max" }, { x: "a", y: 1 }],
  });
  assert.ok(f);
  assert.deepEqual(f.curves.map((c) => c.expr), ["-5x^2 + 20x", "2x + 1"]);   // unsafe / implicit curves dropped
  assert.equal(f.points.length, 1);
  assert.equal(normalizeFigure({ type: "graph", x: [5, 1], curves: [{ expr: "x" }] }), null);   // reversed range
  assert.equal(normalizeFigure({ type: "graph", x: [0, 1], curves: [{ expr: "nonsense(" }] }), null);
  assert.equal(normalizeFigure(null), null);
  assert.equal(normalizeFigure({ type: "mystery" }), null);
});

test("graph geometry is finite, labelled and breaks at asymptotes", () => {
  const f = normalizeFigure({ type: "graph", x: [-4, 4], curves: [{ expr: "1/x" }, { expr: "x^2 - 4" }], vlines: [{ x: 0, label: "x = 0" }], shade: { expr: "x^2 - 4", from: 2, to: 4 } });
  const d = drawGraph(f);
  const paths = d.prims.filter((p) => p.t === "path");
  assert.ok(paths.length > 8);
  for (const p of paths) assert.ok(!/NaN|Infinity/.test(p.d), p.d.slice(0, 60));
  const hyper = paths.find((p) => p.stroke === "#2563eb" && p.w === 2.6);
  assert.ok((hyper.d.match(/M/g) ?? []).length >= 2);                          // the pen lifts across x = 0
  assert.ok(d.prims.some((p) => p.t === "text" && p.s === "x = 0"));
  assert.ok(d.prims.some((p) => p.t === "path" && p.fill && p.op === 0.22));   // shaded region
  assert.ok(d.clip.w > 100);
});

test("automatic y range ignores asymptote spikes and keeps zero near the axis", () => {
  const [lo, hi] = autoYRange({ type: "graph", x: [-4, 4], curves: [{ expr: "1/x" }] });
  assert.ok(hi - lo < 60, `${lo}..${hi}`);
  const [lo2] = autoYRange({ type: "graph", x: [0, 5], curves: [{ expr: "x^2 + 1" }] });
  assert.equal(lo2, 0);
  assert.equal(explicitExpr("f(x) = 3x"), "3x");
  assert.equal(explicitExpr("x^2 + y^2 = 1"), null);
  assert.equal(niceStep(10, 5), 2);
});

test("charts: bars, lines, scatter, pie", () => {
  for (const kind of ["bar", "line", "scatter", "pie"]) {
    const spec = kind === "scatter"
      ? { type: "chart", kind, series: [{ name: "a", points: [{ x: 1, y: 2 }, { x: 3, y: 5 }, { x: 4, y: 4 }] }] }
      : { type: "chart", kind, categories: ["A", "B", "C"], series: [{ name: "n", values: [3, 7, 5] }] };
    const f = normalizeFigure(spec);
    assert.ok(f, kind);
    const d = drawFigure(f);
    assert.ok(d.prims.length > 3, kind);
    for (const p of d.prims) if (p.t === "path") assert.ok(!/NaN|Infinity/.test(p.d), `${kind}: ${p.d.slice(0, 50)}`);
  }
  assert.equal(normalizeFigure({ type: "chart", kind: "bar", series: [] }), null);
  const pie = drawChart(normalizeFigure({ type: "chart", kind: "pie", categories: ["x", "y"], series: [{ name: "s", values: [1, 3] }] }));
  assert.ok(pie.prims.some((p) => p.t === "text" && p.s === "75%"));
});

test("tables, diagrams and crops validate", () => {
  assert.ok(normalizeFigure({ type: "table", headers: ["t", "v"], rows: [[0, 1], [1, 4]] }));
  assert.equal(normalizeFigure({ type: "table", rows: [] }), null);
  const dg = normalizeFigure({ type: "diagram", width: 300, height: 200, elements: [
    { t: "line", x1: 10, y1: 10, x2: 200, y2: 10, arrow: true, label: "F" }, { t: "circle", cx: 100, cy: 100, r: 30 },
    { t: "poly", points: [[0, 0], [50, 0], [0, 40]] }, { t: "arc", cx: 0, cy: 40, r: 20, from: 0, to: 53, label: "θ" },
    { t: "bogus" }, { t: "circle", cx: 1, cy: 1, r: -4 }, { t: "text", x: 5, y: 5, text: "hi" },
  ] });
  assert.equal(dg.elements.length, 5);
  const d = drawFigure(dg);
  assert.ok(d.prims.length >= 8);
  assert.ok(normalizeFigure({ type: "crop", image: 1, bbox: [0.1, 0.2, 0.5, 0.4] }));
  assert.equal(normalizeFigure({ type: "crop", image: 1, bbox: [0.1, 0.2, 1.5, 0.4] }), null);
  assert.equal(normalizeFigure({ type: "crop", image: 1, bbox: [0.1, 0.2, 0.01, 0.4] }), null);
});

// --- exam ----------------------------------------------------------------------------------------------------------
const rawExam = () => ({
  title: "Mechanics test", durationMin: 5,
  sections: [
    { title: "Section A", questions: [
      { topic: "Kinematics", stem: "A ball is thrown upward. Use the graph.", figure: { type: "graph", x: [0, 4], curves: [{ expr: "20x - 5x^2" }] },
        parts: [
          { label: "a", prompt: "State the maximum height.", type: "numeric", marks: 2, numeric: { value: 20, tol: 0.02, unit: "m" }, answer: "20 m" },
          { label: "b", prompt: "Why does it slow down?", type: "short", marks: 2, answer: "Gravity acts downward", scheme: ["gravity", "decelerates"] },
        ] },
      { topic: "Forces", stem: "Which is a vector?", type: "mcq", options: ["Mass", "Speed", "Velocity"], correct: 2, marks: 1, answer: "Velocity" },
      { stem: "Broken MCQ", type: "mcq", options: ["only one"], correct: 5, marks: 1 },
      { stem: "", parts: [] },
    ] },
    { title: "Empty", questions: [] },
  ],
});

test("an exam is validated, repaired and totalled", () => {
  const e = normalizeExam(rawExam(), 1000, "e1");
  assert.ok(e);
  assert.equal(e.sections.length, 1);                                  // the empty section is gone
  assert.equal(e.sections[0].questions.length, 3);                     // the blank question is dropped
  const [q1, q2, q3] = e.sections[0].questions;
  assert.equal(q1.marks, 4);
  assert.equal(q1.figure.type, "graph");
  assert.deepEqual(q1.parts.map((p) => p.label), ["a", "b"]);
  assert.equal(q2.parts[0].type, "mcq");
  assert.equal(q2.parts[0].label, "");
  assert.equal(q3.parts[0].type, "short");                              // a broken MCQ is downgraded, not discarded
  assert.equal(e.totalMarks, 6);
  assert.ok(e.durationMin >= 10);                                       // never absurdly short
  assert.equal(normalizeExam({ sections: [] }), null);
  assert.equal(normalizeExam("nope"), null);
  assert.equal(allParts(e).length, 4);
  assert.equal(allParts(e).filter(({ p }) => needsAi(p)).length, 2);
});

test("objective marking", () => {
  const e = normalizeExam(rawExam(), 1000, "e1");
  const parts = allParts(e).map((x) => x.p);
  const num = parts[0], mcq = parts[2];
  assert.equal(markObjective(num, { text: "20 m" }).marks, 2);
  assert.equal(markObjective(num, { text: "about 20.2 metres" }).marks, 2);
  assert.equal(markObjective(num, { text: "25 m" }).marks, 0);
  assert.equal(markObjective(num, { text: "-20" }).marks, 0);
  assert.match(markObjective(num, { text: "-20" }).feedback, /sign/);
  assert.equal(markObjective(num, { text: "" }).marks, 0);
  assert.equal(markObjective(mcq, { choice: mcq.correct }).marks, 1);       // options are shuffled, so use the stored index
  assert.equal(markObjective(mcq, { choice: (mcq.correct + 1) % mcq.options.length }).marks, 0);
  assert.equal(mcq.options[mcq.correct], "Velocity");
  assert.equal(markObjective(mcq, undefined).marks, 0);
  assert.equal(markObjective(parts[1], { text: "x" }), null);            // free text goes to the AI
  assert.equal(extractNumber("9.8 m/s²"), 9.8);
  assert.equal(extractNumber("3 x 10^2 J"), 300);
  assert.equal(extractNumber("−4.5"), -4.5);
  assert.equal(extractNumber("1/4"), 0.25);
  assert.equal(extractNumber("none"), null);
  assert.equal(extractNumber("1,250 kg"), 1250);
});

test("results roll up by section and topic, clamp AI marks, and band", () => {
  const e = normalizeExam(rawExam(), 1000, "e1");
  const ps = allParts(e).map((x) => x.p);
  const r = buildResult(e, [
    { partId: ps[0].id, marks: 2, max: 2, auto: true, feedback: "ok" },
    { partId: ps[1].id, marks: 99, max: 2, auto: false, feedback: "ai over-marked" },     // clamped to the part's marks
    { partId: ps[2].id, marks: 0, max: 1, auto: true, feedback: "no" },
  ]);
  assert.equal(r.max, 6);
  assert.equal(r.got, 4);
  assert.equal(r.percent, 67);
  assert.equal(r.band, "C");
  assert.deepEqual(r.byTopic.find((t) => t.topic === "Kinematics"), { topic: "Kinematics", got: 4, max: 4 });
  assert.equal(r.byTopic.find((t) => t.topic === "Forces").got, 0);
  assert.equal(r.marks.find((m) => m.partId === ps[3].id).feedback, "Not marked.");      // unmarked parts are zero, not crashes
  assert.deepEqual([95, 82, 71, 65, 55, 45, 10].map(band), ["A*", "A", "B", "C", "D", "E", "U"]);
});

test("a lone part's figure is shown once, on the question", () => {
  const e = normalizeExam({ sections: [{ questions: [
    { stem: "Read the table.", parts: [{ prompt: "Which is largest?", type: "short", marks: 1, answer: "B", figure: { type: "table", rows: [[1, 2]] } }] },
    { stem: "Use the graph.", figure: { type: "graph", x: [0, 1], curves: [{ expr: "x" }] }, type: "short", marks: 1, answer: "1" },
  ] }] });
  const [a, b] = e.sections[0].questions;
  assert.equal(a.figure.type, "table");
  assert.equal(a.parts[0].figure, undefined);
  assert.equal(b.figure.type, "graph");
  assert.equal(b.parts[0].figure, undefined);
  assert.equal(b.parts[0].prompt, "");
});

import { reportQuestion } from "../src/lib/exam-core.ts";
test("a reported question leaves the score (both marks and total), and can be un-reported", () => {
  const e = normalizeExam(rawExam(), 1000, "e1");
  const ps = allParts(e).map((x) => x.p);
  const marks = [
    { partId: ps[0].id, marks: 2, max: 2, auto: true, feedback: "" },
    { partId: ps[1].id, marks: 0, max: 2, auto: false, feedback: "" },
    { partId: ps[2].id, marks: 1, max: 1, auto: true, feedback: "" },
  ];
  const before = buildResult(e, marks);
  assert.equal(before.max, 6);
  const q1 = e.sections[0].questions[0].id;
  const reported = reportQuestion(e, q1, "figure");
  const after = buildResult(reported, marks);
  assert.equal(after.max, 2);                                   // q1 (4 marks) left out
  assert.equal(after.got, 1);
  assert.deepEqual(after.excluded, [q1]);
  assert.ok(!after.byTopic.some((t) => t.topic === "Kinematics"));
  assert.equal(after.marks.length, before.marks.length);        // feedback for it is still shown
  assert.equal(buildResult(reportQuestion(reported, q1, null), marks).max, 6);
  assert.equal(e.reported, undefined);                          // the original is untouched
});
