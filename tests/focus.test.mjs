import test from "node:test";
import assert from "node:assert/strict";
import { ALL_FOCUS, buildFlashcards, cleanFocus, describeFocus, dropTopic, focusCards, inFocus, makeCard, mulberry32, topicsIn } from "../src/lib/study-core.ts";

let id = 0;
const card = (topic, nb, extra = {}) => ({ ...makeCard({ front: `Q${id}`, back: `A${id}`, topic, notebookId: nb }, 1000 + id), id: `c${id++}`, ...extra });
const deck = [card("Gases", "chem"), card("Gases", "chem"), card("Stoichiometry", "chem"), card("Thermo", "chem"), card("Cells", "bio"), card(undefined, null)];

test("a focus picks a notebook and topics; empty topics = every topic in it", () => {
  assert.equal(focusCards(deck, ALL_FOCUS).length, 6);
  assert.equal(focusCards(deck, { nb: "chem", topics: [], skip: [] }).length, 4);
  assert.deepEqual(focusCards(deck, { nb: "chem", topics: ["Gases"], skip: [] }).map((c) => c.topic), ["Gases", "Gases"]);
  assert.equal(focusCards(deck, { nb: "none", topics: [], skip: [] }).length, 1);
  assert.ok(inFocus(deck[5], { nb: "all", topics: ["General"], skip: [] }), "untopiced cards count as General");
  assert.deepEqual(topicsIn(deck, "chem"), ["Gases", "Stoichiometry", "Thermo"]);
});

test("off topic: a hand-picked list loses the unit; 'all topics' skips it (new units still come in)", () => {
  const picked = dropTopic({ nb: "chem", topics: ["Gases", "Thermo"], skip: [] }, "Thermo");
  assert.deepEqual(picked, { nb: "chem", topics: ["Gases"], skip: [] });
  const all = dropTopic({ nb: "chem", topics: [], skip: [] }, "Thermo");
  assert.deepEqual(all.skip, ["Thermo"]);
  assert.ok(!focusCards(deck, all).some((c) => c.topic === "Thermo"));
  assert.equal(focusCards([...deck, card("Kinetics", "chem")], all).filter((c) => c.topic === "Kinetics").length, 1);
  assert.deepEqual(dropTopic(all, "Thermo").skip, ["Thermo"], "no duplicates");
});

test("a focus never silently matches nothing after cards are deleted", () => {
  assert.deepEqual(cleanFocus({ nb: "chem", topics: ["Gone"], skip: ["Also gone", "Gases"] }, deck), { nb: "chem", topics: [], skip: ["Gases"] });
  assert.deepEqual(cleanFocus(undefined, deck), ALL_FOCUS);
});

test("describe and flashcards", () => {
  assert.equal(describeFocus({ nb: "chem", topics: ["Gases"], skip: [] }, () => "Chem 0710"), "Chem 0710 · Gases");
  assert.equal(describeFocus({ nb: "all", topics: [], skip: ["Thermo"] }, () => undefined), "All notebooks · all topics (skipping Thermo)");
  const ex = buildFlashcards(deck, { size: 4, rng: mulberry32(1) });
  assert.equal(ex.length, 4);
  assert.ok(ex.every((e) => e.kind === "flip"));
  assert.equal(buildFlashcards([card("X", null, { suspended: true })]).length, 0);
});
