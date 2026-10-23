import test from "node:test";
import assert from "node:assert/strict";
import { pickTextbookPages, noteCoverage, checkSolvable } from "../src/lib/coverage.ts";
import { normalizeExam } from "../src/lib/exam-core.ts";

const notes = [
  { n: 1, text: "Ideal gas law PV = nRT. Pressure volume temperature moles. R = 0.0821 L atm per mol K. Convert Celsius to Kelvin." },
  { n: 2, text: "Boyle's law: at constant temperature pressure and volume are inversely proportional. Charles's law: volume proportional to temperature." },
];
const book = [
  { n: 1, noteTitle: "Chem Textbook", page: 211, text: "Example 5.3. A sample of gas occupies 2.0 L at 1.0 atm. At constant temperature the pressure is raised to 2.0 atm. Find the new volume using Boyle's law, pressure times volume constant." },
  { n: 2, noteTitle: "Chem Textbook", page: 640, text: "Nuclear chemistry. Alpha decay, beta decay, gamma emission, half-life of radioactive isotopes, binding energy and mass defect in the nucleus." },
  { n: 3, noteTitle: "Chem Textbook", page: 212, text: "Problems. Gas in a rigid container at 300 K and 1.5 atm is heated. Using the ideal gas law find the pressure at 450 K. Moles and volume constant." },
];

test("only textbook pages that match the notes are offered, best first", () => {
  const picked = pickTextbookPages(notes.map((e) => e.text), book);
  assert.deepEqual(picked.map((p) => p.page).sort(), [211, 212]);
  assert.ok(!picked.some((p) => p.page === 640), "nuclear chemistry isn't in the notes");
  assert.deepEqual(pickTextbookPages([], book), []);
});

const exam = (questions) => normalizeExam({ sections: [{ title: "A", questions }] }, 1, "e");

test("the writer's own 'not solvable' verdict removes a question", () => {
  const e = exam([
    { stem: "Half-life of C-14?", type: "short", answer: "5730 years", basis: { notes: [], textbook: "T2", solvable: "no" } },
    { stem: "State Boyle's law.", type: "short", answer: "At constant temperature, pressure is inversely proportional to volume", basis: { notes: [2], textbook: null, solvable: "yes" } },
  ]);
  assert.equal(e.sections[0].questions.length, 1);
  assert.deepEqual(e.sections[0].questions[0].basis, { notes: [2], textbook: undefined, stretch: undefined });
});

test("textbook questions must cite real notes; thin vocabulary overlap becomes a stretch", () => {
  const e = exam([
    { stem: "A gas occupies 2.0 L at 1.0 atm. At constant temperature the pressure rises to 2.0 atm. Find the new volume.", type: "short", answer: "1.0 L by Boyle's law", marks: 2, basis: { notes: [2], textbook: "T1", solvable: "yes" } },
    { stem: "A gas at 300 K and 1.5 atm is heated to 450 K. Find the pressure.", type: "short", answer: "2.25 atm", marks: 2, basis: { notes: [9], textbook: "T2", solvable: "yes" } },     // cites a note that doesn't exist
    { stem: "Explain the mass defect and binding energy of a helium nucleus.", type: "short", answer: "Mass defect converts to binding energy via E = mc^2", marks: 3, basis: { notes: [1], textbook: "T1", solvable: "yes" } },
    { stem: "State Charles's law.", type: "short", answer: "Volume is proportional to temperature", marks: 1 },
  ]);
  const picked = pickTextbookPages(notes.map((x) => x.text), book);
  const c = checkSolvable(e, notes, picked);
  const qs = c.exam.sections[0].questions;
  assert.equal(c.dropped, 1);
  assert.equal(qs.length, 3);
  assert.equal(c.exam.totalMarks, 6);
  assert.equal(qs[0].basis.stretch, undefined);
  assert.match(qs[0].basis.source, /Chem Textbook, p\. 21[23]/);
  assert.equal(qs[1].basis.stretch, true, "binding energy isn't in the notes");
  assert.equal(qs[2].basis, undefined, "notes-only questions are untouched");
  assert.equal(c.stretch, 1);
});

test("coverage counts plurals as the same word", () => {
  const q = exam([{ stem: "How many moles of gases?", type: "short", answer: "two" }]).sections[0].questions[0];
  assert.ok(noteCoverage(q, ["mole gas two how many"]) === 1);
});

test("textbook pages are cut into single problems locally, so only those are sent", async () => {
  const { textbookChunks } = await import("../src/lib/coverage.ts");
  const page = { n: 1, noteTitle: "Book", page: 4, text: "Gases expand when heated, as the kinetic theory explains in detail for every sample. Example 5.1 A gas occupies 2.0 L at 1.0 atm; find the volume at 2.0 atm if temperature is constant. Example 5.2 Find the pressure of 1.0 mol of gas in 22.4 L at 273 K using the ideal gas law. Problems 1. Calculate the moles in 36 g of water using the molar mass. 2. Convert 25 degrees Celsius to Kelvin and explain why gas laws need it." };
  const c = textbookChunks([page]);
  assert.ok(c.length >= 4, `got ${c.length}`);
  assert.ok(c.some((x) => x.text.startsWith("Example 5.2")));
  assert.ok(c.some((x) => x.text.startsWith("2. Convert")));
  assert.ok(c.every((x) => x.page === 4 && x.text.length <= 902));
  const long = textbookChunks([{ ...page, text: "word ".repeat(1000) }]);
  assert.ok(long.length >= 5 && long.every((x) => x.text.length <= 902));
});
