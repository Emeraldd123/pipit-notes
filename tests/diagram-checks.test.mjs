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

test("the three faults from the first real run are caught (mitochondrion key, chloroplast arrows, gel without distances)", () => {
  // a key that describes what the question asks the student to name; text running off the frame is pulled back in
  const mito = q(examWith({ type: "diagram", width: 420, height: 240, elements: [
    { t: "icon", name: "mitochondrion", x: 20, y: 20, w: 200, h: 200 },
    { t: "text", x: 260, y: 60, text: "X: folded inner membrane", size: 16 }, { t: "text", x: 260, y: 110, text: "Z: innermost compartment", size: 16 },
  ] }, "Name structure X and compartment Z.", "X: cristae; Z: matrix", "The diagram shows a mitochondrion. Regions are labelled X, Y, and Z."));
  assert.match(checkQuestion(mito).flags.join(" | "), /describes X in a key/);
  const texts = mito.figure.elements.filter((e) => e.t === "text");
  assert.ok(texts.every((t) => t.x + t.text.length * 16 * 0.56 <= 420 - 3), "text is moved back inside the frame");

  // arrows pointing at the letters, and a stem that says what X is
  const chloro = q(examWith({ type: "diagram", width: 400, height: 240, elements: [
    { t: "circle", cx: 200, cy: 120, r: 100 }, { t: "rect", x: 150, y: 90, w: 60, h: 14 },
    { t: "line", x1: 180, y1: 90, x2: 110, y2: 40, arrow: true }, { t: "text", x: 104, y: 34, text: "X" },
    { t: "line", x1: 250, y1: 160, x2: 310, y2: 200, arrow: true }, { t: "text", x: 316, y: 206, text: "Y" },
  ] }, "Name X and Y.", "X: granum; Y: stroma", "The diagram shows a chloroplast. X is the stack of membrane-bound discs; Y is the fluid surrounding them."));
  const cf = checkQuestion(chloro).flags.join(" | ");
  assert.match(cf, /stem describes X/);
  assert.match(cf, /arrow points at the letter "X"/);

  // "distances shown in the diagram" with no numbers, and a label sitting on the gel's edge
  const gel = q(examWith({ type: "diagram", width: 400, height: 240, elements: [
    { t: "rect", x: 100, y: 40, w: 260, h: 180 }, { t: "text", x: 150, y: 44, text: "well", size: 16 },
    { t: "line", x1: 130, y1: 80, x2: 160, y2: 80 }, { t: "text", x: 170, y: 76, text: "P" },
  ] }, "Which band is the 200 bp fragment?", "P", "After the run, fragments have moved to positions shown in the diagram (distances from the wells in mm)."));
  const gf = checkQuestion(gel).flags.join(" | ");
  assert.match(gf, /values are shown in the diagram, but the diagram has no numbers/);
  assert.match(gf, /text "well" sits on a rect outline/);
});

test("from the second run: a part that describes what it asks for, and a note too long for the frame", () => {
  const potato = q(examWith({ type: "diagram", width: 400, height: 240, elements: [
    { t: "rect", x: 100, y: 40, w: 200, h: 150 }, { t: "label", text: "X", x: 40, y: 40, tx: 100, ty: 60 },
    { t: "text", x: 260, y: 230, text: "Scale: A zone radius 14 mm, B zone radius 6 mm, colonies inside B", size: 14 },
  ] }, "Structure X is the thick outer layer. Name X and state its role.", "cell wall", "The diagram shows a potato cell in distilled water."));
  assert.match(checkQuestion(potato).flags.join(" | "), /part . describes X in the same breath/);
  const note = potato.figure.elements.find((e) => e.t === "text");
  assert.ok(note.x + note.text.length * note.size * 0.56 <= 400 + 1 && note.size < 14, "a long note is shrunk to fit");
});

test("labels point at icon parts; unknown parts and labels for missing icons are reported", async () => {
  const { strayLabels } = await import("../tools/diagram-checks.mjs");
  const e = examWith({ type: "diagram", width: 420, height: 240, elements: [
    { t: "icon", name: "mitochondrion", x: 120, y: 20, w: 200, h: 200 },
    { t: "label", text: "X", x: 40, y: 40, to: "mitochondrion.cristae" }, { t: "label", text: "Y", x: 380, y: 60, to: "mitochondrion.ribosomes" },
    { t: "label", text: "Z", x: 40, y: 200, to: "chloroplast.stroma" },
  ] }, "Name X.", "cristae");
  const els = q(e).figure.elements;
  const x = els.find((el) => el.t === "label" && el.text === "X");
  assert.ok(x.tx > 120 && x.tx < 320 && x.ty > 20 && x.ty < 220 && x.part === "cristae");
  assert.match(checkQuestion(q(e)).flags.join(" | "), /label "Y" points at a part this icon doesn't have/);
  assert.ok(els.some((el) => el.t === "text" && el.text === "Z"), "a label for a missing icon still shows its letter");
  assert.deepEqual(strayLabels({ sections: [{ questions: [{ figure: { type: "diagram", elements: [{ t: "icon", name: "nucleus" }, { t: "label", to: "chloroplast.stroma" }] } }] }] }), ["chloroplast.stroma"]);
});

test("icon names the app doesn't have are reported from the raw reply", () => {
  assert.deepEqual(unknownIcons({ sections: [{ questions: [{ figure: { elements: [{ t: "icon", name: "Chloroplast" }, { t: "icon", name: "Mitochondria" }] } }] }] }), ["Chloroplast"]);
});
