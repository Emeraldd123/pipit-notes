import test from "node:test";
import assert from "node:assert/strict";
import { checkQuestion, unknownIcons } from "../tools/diagram-checks.mjs";
import { normalizeExam } from "../src/lib/exam-core.ts";

const examWith = (figure, prompt, answer, stem = "The diagram shows a cell.") =>
  normalizeExam({ sections: [{ questions: [{ stem, figure, parts: [{ label: "a", type: "short", marks: 2, prompt, answer, scheme: [answer] }] }] }] }, 1, "e");
const q = (e) => e.sections[0].questions[0];

test("a clean diagram passes; mechanical faults are each caught", () => {
  const clean = q(examWith({ type: "diagram", width: 400, height: 300, elements: [
    { t: "icon", name: "mitochondrion", x: 20, y: 20, w: 120, h: 80, label: "X" }, { t: "icon", name: "nucleus", x: 200, y: 20, w: 120, h: 100, label: "Y" },
  ] }, "Name structure X.", "mitochondrion"));
  const c = checkQuestion(clean);
  assert.deepEqual(c.flags, []);
  assert.deepEqual(c.icons, ["mitochondrion", "nucleus"]);

  const bad = q(examWith({ type: "diagram", width: 400, height: 300, elements: [
    { t: "icon", name: "mitochondrion", x: 20, y: 20, w: 120, h: 80, label: "mitochondrion" },
    { t: "icon", name: "nucleus", x: 40, y: 30, w: 100, h: 70 },
    { t: "icon", name: "ribosome", x: 350, y: 250, w: 20, h: 90 },
  ] }, "Name the organelle at the arrow, and identify structure Z.", "the mitochondrion"));
  const f = checkQuestion(bad).flags.join(" | ");
  assert.match(f, /"ribosome" goes outside the frame/);
  assert.match(f, /"ribosome" is too small/);
  assert.match(f, /"mitochondrion" and "nucleus" are drawn on top of each other/);
  assert.match(f, /mentions "Z" but the diagram has no label Z/);
  assert.match(f, /already labels \("mitochondrion"\)/);
});

test("icon names the app doesn't have are reported from the raw reply", () => {
  assert.deepEqual(unknownIcons({ sections: [{ questions: [{ figure: { elements: [{ t: "icon", name: "Chloroplast" }, { t: "icon", name: "Mitochondria" }] } }] }] }), ["Chloroplast"]);
});
