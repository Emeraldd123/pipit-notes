import test from "node:test";
import assert from "node:assert/strict";
import { remember, avoidList, repeats, scenariosOf, CASE_MEMORY } from "../src/lib/case-memory.ts";
import { normalizeExam } from "../src/lib/exam-core.ts";
import { buildExamPrompt } from "../src/lib/exam-prompt.ts";

const exam = (...scenarios) => normalizeExam({ sections: [{ questions: scenarios.map((sc, i) => ({ stem: `Q${i}`, basis: { notes: [1], scenario: sc }, type: "short", marks: 2, answer: "a", scheme: ["a"] })) }] }, 1, "e");

test("the writer's scenario tag survives the app's validation", () => {
  assert.deepEqual(scenariosOf(exam("a car battery and headlight", "", "yeast in bread dough")), ["a car battery and headlight", "yeast in bread dough"]);
});

test("memory keeps the newest scenarios first, without duplicates, capped", () => {
  let mem = remember([], exam("car battery", "yeast dough"), 1);
  mem = remember(mem, exam("Car battery", "a kettle element"), 2);
  assert.deepEqual(mem.map((c) => c.scenario), ["Car battery", "a kettle element", "yeast dough"]);
  for (let i = 0; i < 30; i++) mem = remember(mem, exam(`case ${i} a`, `case ${i} b`, `case ${i} c`), 10 + i);
  assert.equal(mem.length, CASE_MEMORY);
  assert.equal(avoidList(mem)[0], "case 29 a");
});

test("a reworded version of an earlier scenario counts as a repeat; a new one doesn't", () => {
  const mem = remember([], exam("a car battery running a headlight", "yeast fermenting in sealed bread dough"), 1);
  const r = repeats(exam("car battery with headlights", "a hospital oxygen tank", "bread dough yeast"), mem);
  assert.deepEqual(r.map((x) => x.scenario), ["car battery with headlights", "bread dough yeast"]);
  assert.deepEqual(repeats(exam("a phone charger"), []), []);
});

test("the prompt asks for scenario tags and passes the cases to avoid", () => {
  const spec = { excerpts: [{ n: 1, noteTitle: "N", page: 0, text: "notes" }], questions: 8, difficulty: "same", style: "", figures: true };
  const withMem = buildExamPrompt({ ...spec, avoidCases: ["a car battery running a headlight"] });
  assert.match(withMem.system, /"basis\.scenario"/);
  assert.match(withMem.content.map((c) => c.text ?? "").join(""), /already used these scenarios\. Use DIFFERENT ones.*"a car battery running a headlight"/);
  assert.doesNotMatch(buildExamPrompt(spec).content.map((c) => c.text ?? "").join(""), /already used these scenarios/);
});
