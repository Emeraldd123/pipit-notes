import test from "node:test";
import assert from "node:assert/strict";
import { novelty, internalRepeats, typeMix, coverage, varietyScore, distinctiveWords, leaks } from "../tools/exam-variety.mjs";
import { FIXTURES } from "../tools/exam-fixtures.mjs";

const q = (stem, type = "short", notes = [1], prompt = "Explain.") => ({ stem, basis: { notes }, parts: [{ type, prompt }] });

test("the same question with new numbers counts as a repeat; a different question doesn't", () => {
  const earlier = [q("A block of mass 2 kg slides down a frictionless incline of angle 30 degrees. Find its acceleration along the incline.")];
  const same = q("A block of mass 5 kg slides down a frictionless incline of angle 40 degrees. Find its acceleration along the incline.");
  const fresh = q("Two carts collide on a track and stick together. Using conservation of momentum, find their common velocity.");
  assert.equal(novelty([same], earlier).repeats.length, 1);
  assert.equal(novelty([fresh], earlier).repeats.length, 0);
  assert.ok(novelty([fresh], earlier).novelty > novelty([same], earlier).novelty);
  assert.equal(novelty([same], []).novelty, 1);
});

test("variety inside a paper: type mix, coverage of the notes, internal repeats", () => {
  assert.equal(typeMix([q("a", "mcq"), q("b", "mcq")]), 0);
  assert.ok(typeMix([q("a", "mcq"), q("b", "numeric"), q("c", "working"), q("d", "short")]) > 0.8);
  assert.equal(coverage([q("a", "short", [1]), q("b", "short", [3])], 3), 2 / 3);
  const twins = [q("Explain why the proton gradient collapses when the membrane leaks protons."), q("Explain why the proton gradient collapses when the membrane leaks protons quickly.")];
  assert.equal(internalRepeats(twins), 1);
  const v = varietyScore([q("a", "mcq", [1]), q("b", "numeric", [2])], [], 2);
  assert.ok(v.score > 0.7 && v.score <= 1);
});

test("a paper's score rewards quality and variety, and punishes copying and short papers", async () => {
  const { paperScore } = await import("../tools/exam-variety.mjs");
  const great = { avg: { realistic: 2, applied: 2, selfContained: 2, oneAnswer: 2, accurate: 2, distractors: 2 }, paper: { style_match: 2, copied: false } };
  const s = paperScore(great, { questions: 8 }, { score: 1 });
  assert.equal(+s.total.toFixed(3), 1);
  assert.ok(paperScore({ ...great, paper: { style_match: 2, copied: true } }, { questions: 8 }, { score: 1 }).total < 0.85);
  assert.ok(paperScore(great, { questions: 3 }, { score: 1 }).total < s.total);
  assert.ok(paperScore(great, { questions: 8 }, { score: 0.2 }).total < 0.8);   // the same great questions again score less
});

test("rules that name the sample notes' topics are caught", async () => {
  const { buildExamPrompt } = await import("../src/lib/exam-prompt.ts");
  const base = buildExamPrompt({ excerpts: [], questions: 8, difficulty: "same", style: "", figures: true, cases: true }).system;
  const d = distinctiveWords(FIXTURES);
  assert.ok(leaks("Ask about pyruvate and the Krebs cycle and phosphofructokinase.", d, base).length >= 3);
  assert.ok(leaks("Vary the kind of task across the paper; give every value the answer needs, and mix short and long parts.", d, base).length < 3);
  // the words that wrongly stopped the first real run: ordinary vocabulary, one per rule line, must pass the line check
  const { generalTexts } = await import("../tools/exam-variety.mjs");
  const { HOLDOUT } = await import("../tools/exam-fixtures.mjs");
  const { readFileSync } = await import("node:fs");
  const d2 = distinctiveWords([...FIXTURES, ...HOLDOUT], generalTexts(JSON.parse(readFileSync("public/ocw/exams.json", "utf8")).exams));
  for (const line of ["- State the conditions a method needs before using it.", "- Treat each part as standalone where the past exam does.", "- Say whose data a figure shows; give larger samples where it matters.", "- Follow the course's rules for significant figures and square units."])
    assert.ok(leaks(line, d2, base).length < 2, line);
  assert.ok(leaks("- Ask about pyruvate and the Krebs cycle.", d2, base).length >= 2);
});
