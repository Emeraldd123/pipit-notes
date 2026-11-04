import test from "node:test";
import assert from "node:assert/strict";
import { pickPastExams, examText } from "../src/lib/past-exams.ts";
import { buildExamPrompt } from "../src/lib/exam-prompt.ts";

const mech = { id: "m", title: "8.01 Exam 2", pages: ["Problem 1 (25 points) A block of mass m slides down a frictionless incline of angle theta. (a) Draw a free body diagram. (b) Find the acceleration.", "Problem 2 (25 points) Momentum and energy in a collision between two carts.\nMIT OpenCourseWare https://ocw.mit.edu\nFor information about citing these materials or our Terms of Use, visit: https://ocw.mit.edu/terms."] };
const bio = { id: "b", title: "7.012 Quiz 1", pages: ["Question 1 (12 points) Glycolysis and the electron transport chain. (a) Where is ATP synthase located? (b) What happens to the proton gradient if…"] };
const notes = ["Newton's second law F = ma. A block on an incline: the component of gravity along the slope is mg sin theta. Free body diagrams show every force.", "Conservation of momentum in collisions; kinetic energy."];

test("the past exam closest to the notes is chosen, and boilerplate is removed", () => {
  const [first, ...rest] = pickPastExams(notes, [bio, mech], 9000);
  assert.equal(first.id, "m");
  assert.match(first.text, /Problem 1 \(25 points\)/);
  assert.match(first.text, /--- page break ---/);
  assert.doesNotMatch(first.text, /ocw\.mit\.edu|Terms of Use/);
  assert.ok(rest.length <= 1);
});

test("a chosen exam wins over the closest one; nothing to choose gives nothing", () => {
  assert.equal(pickPastExams(notes, [bio, mech], 9000, "b")[0].id, "b");
  assert.deepEqual(pickPastExams(notes, [], 9000), []);
});

test("long exams are cut at page boundaries within the budget", () => {
  const pages = Array.from({ length: 10 }, (_, i) => `Problem ${i + 1} `.padEnd(1000, "x"));
  const t = examText(pages, 3500);
  assert.ok(t.length <= 3500);
  assert.match(t, /Problem 3/);
  assert.doesNotMatch(t, /Problem 4/);
  assert.equal(examText(["y".repeat(5000)], 1000).length, 1000);
});

test("the prompt shows past exams as a format reference and switches on the style rules", () => {
  const excerpts = [{ n: 1, noteTitle: "Mechanics", page: 0, text: notes[0] }];
  const { system, content } = buildExamPrompt({ excerpts, questions: 8, difficulty: "same", style: "", figures: false, pastExams: [{ title: "8.01 Exam 2", text: "Problem 1 (25 points) …" }] });
  const user = content.map((c) => c.text ?? "").join("");
  assert.match(system, /PAST EXAMS \(labelled \[E1\]/);
  assert.match(system, /Never copy a past exam's questions/);
  assert.match(user, /\[E1\] 8\.01 Exam 2/);
  assert.match(user, /in the style of: the past exams \[E1\]/);
  const plain = buildExamPrompt({ excerpts, questions: 8, difficulty: "same", style: "AP Physics", figures: false });
  assert.doesNotMatch(plain.system, /PAST EXAMS/);
  assert.match(plain.content.map((c) => c.text ?? "").join(""), /in the style of: AP Physics/);
});

test("built-in exams: matched by subject, never forced on notes from another subject", async () => {
  const { chooseStyleExamples, detectSubject } = await import("../src/lib/past-exams.ts");
  const { readFileSync } = await import("node:fs");
  const builtin = JSON.parse(readFileSync("public/ocw/exams.json", "utf8")).exams;
  const { FIXTURES } = await import("../tools/exam-fixtures.mjs");
  const want = { bio: "Biology", chem: "Chemistry", phys: "Physics", econ: "Economics", stats: "Statistics" };
  for (const f of FIXTURES) assert.equal(detectSubject(f.pages, builtin), want[f.id], f.id);
  assert.equal(detectSubject(["The French Revolution began in 1789 with the storming of the Bastille; Robespierre and the Terror."], builtin), null);
  assert.deepEqual(chooseStyleExamples(["Los verbos irregulares en el pretérito."], [], builtin), []);
  const [ex] = chooseStyleExamples(FIXTURES.find((f) => f.id === "stats").pages, [], builtin);
  assert.match(ex.title, /^MIT 18\.05/);
  assert.match(ex.credit, /CC BY-NC-SA 4\.0/);
  assert.match(ex.text, /SOLUTIONS/);
  assert.ok(ex.text.length <= 9000);
  // your own past exams come first; a pick from the built-in list is honoured
  const mine = [{ id: "u1", title: "My midterm", pages: ["Question 1 (10 marks) Hypothesis testing and p-values for a sample mean."] }];
  assert.equal(chooseStyleExamples(["anything"], mine, builtin)[0].id, "u1");
  assert.equal(chooseStyleExamples(["anything"], mine, builtin, { chosen: builtin[0].id })[0].id, builtin[0].id);
});
