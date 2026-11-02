import test from "node:test";
import assert from "node:assert/strict";
import { numericNearMisses, answerShape, sigFigs, mulberry32 } from "../src/lib/study-core.ts";
import { normalizeExam, shuffleOptions, lintMcq, markObjective, allParts } from "../src/lib/exam-core.ts";

test("answer shapes", () => {
  assert.equal(answerShape("2 mol"), "number");
  assert.equal(answerShape("18.02"), "number");
  assert.equal(answerShape("6.022 × 10^23"), "number");
  assert.equal(answerShape("-285.8 kJ"), "number");
  assert.equal(answerShape("PV = nRT"), "formula");
  assert.equal(answerShape("SA:V"), "formula");
  assert.equal(answerShape("Kelvin"), "short");
  assert.equal(answerShape("Total enthalpy change is independent of path"), "long");
});

test("significant figures as written", () => {
  assert.equal(sigFigs("18.02"), 4);
  assert.equal(sigFigs("0.0821"), 3);
  assert.equal(sigFigs("2"), 1);
  assert.equal(sigFigs("-4.50"), 3);
});

test("number slips keep the unit and precision and are never the answer", () => {
  for (let s = 1; s < 20; s++) {
    const rng = mulberry32(s);
    const a = numericNearMisses("2 mol", rng);
    assert.equal(a.length, 3);
    assert.ok(a.every((x) => x.endsWith(" mol") && x !== "2 mol"));
    const b = numericNearMisses("18.02", mulberry32(s));
    assert.ok(b.every((x) => /^\d+(\.\d+)?$/.test(x) && x !== "18.02"));
    assert.ok(b.every((x) => x.replace(".", "").replace(/^0+/, "").length <= 4));   // no 12.18033-style false precision
  }
  assert.deepEqual(numericNearMisses("6.022 × 10^23"), ["6.022 × 10^22", "6.022 × 10^24", "6.022 × 10^-23"]);
  assert.equal(numericNearMisses("-285.8 kJ", mulberry32(1))[0], "285.8 kJ");     // a negative answer's near miss is the sign error
  assert.ok(numericNearMisses("50%", mulberry32(2)).every((x) => x.endsWith("%") && !x.includes(" %")));
  assert.deepEqual(numericNearMisses("Kelvin"), []);
});

const mcqExam = (options, correct, why) => normalizeExam({ sections: [{ questions: [{ stem: "Q?", type: "mcq", options, correct, why, marks: 1, answer: options[correct] }] }] }, 1, "seed-exam");

test("options are shuffled locally, deterministically, with reasons kept beside their option", () => {
  const e = mcqExam(["right", "near miss", "partly", "weak"], 0, ["because", "sign error", "wrong detail", "unrelated"]);
  const p = allParts(e)[0].p;
  assert.equal(p.options[p.correct], "right");
  assert.equal(p.why[p.options.indexOf("near miss")], "sign error");
  assert.deepEqual(allParts(mcqExam(["right", "near miss", "partly", "weak"], 0, ["because", "sign error", "wrong detail", "unrelated"]))[0].p.options, p.options);  // same exam, same order
  // across many questions the right answer lands in every position, including the last
  const positions = new Set();
  for (let i = 0; i < 40; i++) positions.add(shuffleOptions({ ...p, options: ["a", "b", "c", "d"], why: undefined, correct: 0 }, `q${i}`).correct);
  assert.deepEqual([...positions].sort(), [0, 1, 2, 3]);
  // "none of the above" stays last
  const n = shuffleOptions({ ...p, options: ["x", "y", "z", "None of the above"], correct: 3, why: undefined }, "k");
  assert.equal(n.options[3], "None of the above");
  assert.equal(n.correct, 3);
});

test("picking a wrong option explains the mistake behind it", () => {
  const e = mcqExam(["2 mol", "0.5 mol", "4 mol", "20 mol"], 0, ["n = m ÷ M", "divided M by m (upside down)", "multiplied instead of divided", "a factor of ten slip"]);
  const p = allParts(e)[0].p;
  const wrong = p.options.indexOf("0.5 mol");
  assert.match(markObjective(p, { choice: wrong }).feedback, /upside down/);
  assert.equal(markObjective(p, { choice: p.correct }).feedback, "Correct.");
});

test("lint catches classic giveaways; duplicate options can't become a question", () => {
  const base = { id: "x", label: "", prompt: "", type: "mcq", marks: 1, answer: "", scheme: [] };
  assert.deepEqual(lintMcq({ ...base, options: ["It increases because the kinetic energy of the particles rises with temperature", "It falls", "No change", "It doubles"], correct: 0 }), ["correct-longest"]);
  assert.deepEqual(lintMcq({ ...base, options: ["Sometimes", "Always true", "Never true", "It must be"], correct: 0 }), ["absolute-only-in-wrong"]);
  assert.deepEqual(lintMcq({ ...base, options: ["A", "B", "All of the above", "C"], correct: 2 }), ["all-of-the-above"]);
  assert.deepEqual(lintMcq({ ...base, options: ["Small", "Tall", "Ball", "Wall"], correct: 0 }), []);      // "small" isn't the absolute "all"
  const dup = mcqExam(["same", "Same", "other", "x"], 0);
  assert.notEqual(allParts(dup)[0].p.type, "mcq");
});

test("answer keys written as letters survive the option shuffle", async () => {
  const { mcqKey } = await import("../src/lib/exam-core.ts");
  const right = "Q falls below K, so the equilibrium shifts right; K is unchanged";
  assert.equal(mcqKey("A", ["Option A"], right).answer, right);
  assert.deepEqual(mcqKey("A", ["Option A", "Correct option B (2 marks)"], right).scheme, []);
  assert.equal(mcqKey("Option C", [], right).answer, right);
  assert.equal(mcqKey("B. 1 − 0.95^20 ≈ 0.64.", [], right).answer, `${right} — 1 − 0.95^20 ≈ 0.64.`);
  assert.equal(mcqKey("Larger, because the cold filament has lower resistance", [], right).answer, "Larger, because the cold filament has lower resistance");
  assert.deepEqual(mcqKey("", ["K depends only on T"], right), { answer: right, scheme: ["K depends only on T"] });
  // end to end: the model keyed "A", the shuffle moved it, the shown answer is still the right option
  const e = normalizeExam({ sections: [{ questions: [{ stem: "Q?", type: "mcq", options: ["right one", "near", "partly", "weak"], correct: 0, answer: "A", scheme: ["Option A"] }] }] }, 1, "k");
  const p = allParts(e)[0].p;
  assert.equal(p.answer, "right one");
  assert.equal(p.options[p.correct], "right one");
});
