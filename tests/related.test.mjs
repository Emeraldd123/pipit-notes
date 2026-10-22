import { test } from "node:test";
import assert from "node:assert/strict";
import { buildGraph, relatedTo, tokens } from "../src/lib/related.ts";

const notes = [
  { id: "gas", title: "Gases", notebookId: "chem", pages: 9 },
  { id: "thermo", title: "Thermochemistry", notebookId: "chem", pages: 9 },
  { id: "bio", title: "Cell biology", notebookId: "bio", pages: 11 },
  { id: "neuro", title: "Neuro", notebookId: "bio", pages: 2 },
];
const texts = [
  { noteId: "gas", text: "ideal gas law pressure volume temperature moles; gas pressure and volume relationship, enthalpy of gas expansion" },
  { noteId: "thermo", text: "enthalpy heat capacity calorimetry; enthalpy change and heat of reaction, pressure volume work of a gas" },
  { noteId: "bio", text: "cell membrane organelles mitochondria ribosomes nucleus; cells are the smallest unit of life" },
  { noteId: "neuro", text: "neurons synapse membrane potential action potential; cell membrane ion channels" },
];

test("stop words and short tokens are dropped", () => {
  assert.deepEqual(tokens("The cat and an ox of 12 in H2O"), ["cat", "h2o"]);
});
test("chemistry notes link to each other, not to biology", () => {
  const rel = relatedTo("gas", notes, texts, 3);
  assert.equal(rel[0].note.id, "thermo");
  assert.ok(rel[0].shared.length > 0);
});
test("biology notes link through shared terms (cell membrane)", () => {
  const rel = relatedTo("neuro", notes, texts, 3);
  assert.equal(rel[0].note.id, "bio");
});
test("graph has edges, symmetric keys, and in-bounds layout", () => {
  const g = buildGraph(notes, texts);
  assert.ok(g.edges.length >= 2);
  const keys = new Set(g.edges.map((e) => e.a + "|" + e.b));
  assert.equal(keys.size, g.edges.length); // no duplicate edge in both directions
  for (const n of g.nodes) assert.ok(n.x >= 0 && n.x <= 1000 && n.y >= 0 && n.y <= 1000 && Number.isFinite(n.x));
});
test("handles empty / single-note libraries", () => {
  assert.deepEqual(buildGraph([], []).nodes, []);
  assert.equal(buildGraph([notes[0]], [texts[0]]).edges.length, 0);
});
