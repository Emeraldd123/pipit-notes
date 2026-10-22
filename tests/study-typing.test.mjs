import test from "node:test";
import assert from "node:assert/strict";
import { isTypable, checkTyped, buildLesson, mulberry32, exerciseCards } from "../src/lib/study-core.ts";
import { newSrs, schedule } from "../src/lib/srs.ts";

const NOW = new Date("2026-03-10T12:00:00").getTime();
let n = 0;
const card = (front, back, extra = {}) => ({ id: `t${++n}`, front, back, kind: "basic", notebookId: null, source: "ai", createdAt: NOW + n, updatedAt: NOW, ...newSrs(NOW), ...extra });

test("answers that need symbols a tablet keyboard lacks are never typed", () => {
  for (const bad of ["S²:V²", "√(2)", "ΔH < 0", "$x^2$", "x^2", "H₂O", "\\frac{1}{2}", "a_b", "résumé", "→ product"]) assert.equal(isTypable(bad), false, bad);
  for (const ok of ["Mitochondria", "24 cm2", "decreases", "F = ma", "100", "0.5", "It decreases"]) assert.equal(isTypable(ok), true, ok);
  assert.equal(isTypable("a very long answer that goes on and on and on and on"), false);
  assert.equal(isTypable(""), false);
});

test("a SA:V style card is shown as a choice or a reveal, even for a well-known card", () => {
  const known = { ...schedule(schedule(schedule(schedule(newSrs(NOW), 3, NOW), 3, NOW), 3, NOW), 3, NOW) };   // high crowns → would normally be typed
  const deck = [
    card("What is the SA:V ratio of a cube of side s?", "S²:V²", known),
    card("What happens to SA:V as a cell grows?", "It decreases"),
    card("Why do large cells need transport systems?", "Diffusion is too slow"),
    card("Which organelle makes ATP?", "Mitochondria"),
    card("Which organelle makes proteins?", "Ribosome"),
  ];
  for (let seed = 1; seed < 30; seed++) {
    const lesson = buildLesson(deck, { size: 5, rng: mulberry32(seed), now: NOW });
    for (const e of lesson) {
      if (!exerciseCards(e).includes(deck[0].id)) continue;
      assert.ok(e.kind === "mcq" || e.kind === "flip" || e.kind === "tf" || e.kind === "match", `seed ${seed}: got ${e.kind}`);
    }
  }
});

test("an untypable cloze blank becomes multiple choice (or a reveal), never a typing box", () => {
  const cl = card("The SA:V ratio of a cube is ____", "6/s", { kind: "cloze" });
  const cu = card("The ratio is written ____", "S²:V²", { kind: "cloze" });
  const others = [card("a", "alpha"), card("b", "beta"), card("c", "gamma")];
  const lesson = buildLesson([cu, cl, ...others], { size: 5, rng: mulberry32(4), now: NOW });
  const forCu = lesson.find((e) => exerciseCards(e).includes(cu.id) && e.kind !== "match");
  assert.ok(forCu && forCu.kind !== "cloze" && forCu.kind !== "typed");
  const forCl = lesson.find((e) => exerciseCards(e).includes(cl.id) && e.kind !== "match");
  assert.equal(forCl.kind, "cloze");                                          // "6/s" is plain ASCII, fine to type
  const alone = buildLesson([cu], { size: 1, now: NOW });
  assert.equal(alone[0].kind, "flip");
});

test("if someone does type a symbol-heavy answer, plain-letter spellings still count", () => {
  assert.ok(checkTyped("s^2:v^2", "S²:V²").ok);
  assert.ok(checkTyped("s2:v2", "S²:V²").ok);
  assert.ok(checkTyped("S squared : V squared", "S²:V²").ok);
  assert.ok(checkTyped("x*y", "x×y").ok);
  assert.ok(checkTyped("sqrt 2", "√2").ok);
  assert.ok(checkTyped("pi r2", "πr²").ok);
  assert.equal(checkTyped("s3:v3", "S²:V²").ok, false);
});
