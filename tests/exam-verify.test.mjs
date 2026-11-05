import test from "node:test";
import assert from "node:assert/strict";
import { applyChecks, normalizeChecks, verifyUserText } from "../src/lib/exam-verify.ts";

const exam = () => ({
  id: "e", title: "T", durationMin: 30, totalMarks: 7, createdAt: 0,
  sections: [{ title: "A", questions: [
    { id: "q1", stem: "A table of values.", marks: 4, figure: { type: "table", headers: ["x"], rows: [[2]] }, parts: [
      { id: "q1a", label: "a", type: "numeric", marks: 2, prompt: "Double x.", answer: "5", numeric: { value: 5, tol: 0.02 }, scheme: ["2 × 2 = 5"] },
      { id: "q1b", label: "b", type: "mcq", marks: 2, prompt: "Which?", options: ["one", "two", "three", "four"], correct: 0, why: ["r", "s", "p", "w"], answer: "one", scheme: ["one"] },
    ] },
    { id: "q2", stem: "Broken.", marks: 3, parts: [{ id: "q2", label: "", type: "short", marks: 3, prompt: "Explain.", answer: "x", scheme: ["x"] }] },
  ] }],
});

test("the checker sees the figure JSON, the keyed option and the scheme", () => {
  const t = verifyUserText(exam(), [{ n: 1, noteTitle: "N", page: 0, text: "notes" }]);
  assert.match(t, /FIGURE: \{"type":"table"/);
  assert.match(t, /\*\[0\] one \| \[1\] two/);
  assert.match(t, /model answer: 5 \(numeric 5 ±2%\)/);
  assert.match(t, /\(-\) \[short, 3 marks\]/);
});

test("fixes are applied, broken parts dropped, empty questions removed, marks recounted", () => {
  const checks = normalizeChecks({ checks: [
    { q: "q1", part: "a", verdict: "fix", problem: "2 × 2 is 4", fix: { answer: "4", scheme: ["2 × 2 = 4"], numeric: { value: 4, tol: 0.02 } } },
    { q: "q1", part: "b", verdict: "fix", problem: "key", fix: { correct: 2 } },
    { q: "q2", part: "-", verdict: "drop", problem: "contradictory" },
    { q: "nope", verdict: "maybe" },
  ] });
  assert.equal(checks.length, 3);
  const r = applyChecks(exam(), checks);
  assert.equal(r.fixed, 2);
  assert.equal(r.dropped, 1);
  const [q1] = r.exam.sections[0].questions;
  assert.equal(r.exam.sections[0].questions.length, 1);
  assert.equal(q1.parts[0].answer, "4");
  assert.equal(q1.parts[0].numeric.value, 4);
  assert.equal(q1.parts[1].correct, 2);
  assert.equal(q1.parts[1].why, undefined);   // the old reasons no longer match the key
  assert.equal(r.exam.totalMarks, 4);
});

test("a check on a one-part question applies whatever part label the checker used", () => {
  const r = applyChecks(exam(), normalizeChecks({ checks: [{ q: "Q2", part: "a", verdict: "fix", problem: "x", fix: { answer: "better" } }] }));
  assert.equal(r.fixed, 1);
  assert.equal(r.exam.sections[0].questions[1].parts[0].answer, "better");
  const r2 = applyChecks(exam(), normalizeChecks({ checks: [{ q: "q1", part: "(b)", verdict: "fix", problem: "x", fix: { correct: 1 } }] }));
  assert.equal(r2.exam.sections[0].questions[0].parts[1].correct, 1);
});

test("checks are read however the checker words them", () => {
  const c = normalizeChecks({ checks: [
    { q: "Q1", part: "(A)", verdict: "Fixed", problem: "p", fix: { answer: "4" } },
    { question: "Question 2", verdict: "Remove", reason: "broken" },
    { q: "q1(b)", verdict: "correct", problem: "key", fix: { correct: 1 } },
    { q: "q1", verdict: "ok" },
  ] });
  assert.deepEqual(c.map((x) => [x.q, x.part, x.verdict]), [["q1", "a", "fix"], ["q2", "-", "drop"], ["q1", "b", "fix"]]);
  assert.equal(c[1].problem, "broken");
});

test("a fix that can't be applied safely drops the part instead", () => {
  const r = applyChecks(exam(), normalizeChecks({ checks: [{ q: "q1", part: "b", verdict: "fix", problem: "x", fix: { correct: 9 } }] }));
  assert.equal(r.dropped, 1);
  assert.equal(r.exam.sections[0].questions[0].parts.length, 1);
  assert.deepEqual(applyChecks(exam(), []).exam.sections, exam().sections);
});
