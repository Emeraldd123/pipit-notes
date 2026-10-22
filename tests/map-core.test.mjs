import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeMap, inferKind, layoutRadial, separate, nodeStats, masteryColor, studyOrder, outline, scoreRecall, linkAnswer, cardsFromMap,
} from "../src/lib/map-core.ts";
import { newSrs, schedule } from "../src/lib/srs.ts";

const RAW = {
  title: "Thermodynamics",
  nodes: [
    { id: "a", label: "Enthalpy", note: "Heat content at constant pressure", src: 1 },
    { id: "b", label: "Hess's law", note: "Total enthalpy change is path independent", src: 2 },
    { id: "c", label: "Entropy" },
    { id: "d", label: "Gibbs energy", topic: "Spontaneity" },
    { id: "e", label: "enthalpy" },                         // duplicate by label
    { id: "f", label: "" },                                 // blank
  ],
  edges: [
    { from: "a", to: "b", label: "is used in", kind: "prereq" },
    { from: "c", to: "d", label: "contributes to" },
    { from: "a", to: "d", label: "contributes to", kind: "part" },
    { from: "e", to: "d", label: "duplicate node merges" },
    { from: "b", to: "zzz", label: "dangling" },
    { from: "a", to: "a", label: "self" },
    { from: "d", to: "a", label: "reverse of an existing edge" },
  ],
};
const SRC = [{ n: 1, noteId: "note1", page: 0 }, { n: 2, noteId: "note2", page: 3 }];

test("a proposed map is validated: duplicates merged, bad edges dropped, sources attached", () => {
  const m = normalizeMap(RAW, SRC, "m1", "all", 1000);
  assert.ok(m);
  assert.equal(m.nodes.length, 4);
  assert.deepEqual(m.nodes[0].refs, [{ noteId: "note1", page: 0 }]);
  assert.equal(m.nodes[3].topic, "Spontaneity");
  const pairs = m.edges.map((e) => `${e.from}>${e.to}`);
  assert.ok(pairs.includes("n1>n2") && pairs.includes("n3>n4") && pairs.includes("n1>n4"));
  assert.ok(pairs.includes("n1>n4") && !pairs.includes("n4>n1"));              // reverse duplicate dropped
  assert.ok(!m.edges.some((e) => e.from === e.to));
  assert.ok(m.edges.every((e) => ["part", "cause", "contrast", "example", "prereq", "other"].includes(e.kind)));
  assert.ok(m.edges.find((e) => e.from === "n1" && e.to === "n2").kind === "prereq");
  assert.equal(normalizeMap({ nodes: [{ label: "x" }] }, [], "m", "all"), null);   // too small to be a map
  assert.equal(normalizeMap("nope", [], "m", "all"), null);
});

test("edge kinds are guessed from the wording", () => {
  assert.equal(inferKind("is part of"), "part");
  assert.equal(inferKind("leads to"), "cause");
  assert.equal(inferKind("unlike"), "contrast");
  assert.equal(inferKind("such as"), "example");
  assert.equal(inferKind("requires"), "prereq");
  assert.equal(inferKind("whatever"), "other");
});

test("layout puts the best-connected concept at the centre and keeps nodes apart", () => {
  const m = normalizeMap(RAW, SRC, "m1", "all");
  const hub = m.nodes.find((n) => n.label === "Gibbs energy") ?? m.nodes[0];
  assert.ok(m.nodes.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y)));
  const deg = (id) => m.edges.filter((e) => e.from === id || e.to === id).length;
  const best = [...m.nodes].sort((a, b) => deg(b.id) - deg(a.id))[0];
  assert.deepEqual([best.x, best.y], [0, 0]);
  for (let i = 0; i < m.nodes.length; i++) for (let j = i + 1; j < m.nodes.length; j++) {
    const a = m.nodes[i], b = m.nodes[j];
    assert.ok(Math.abs(a.x - b.x) >= 150 || Math.abs(a.y - b.y) >= 46, `${a.label}/${b.label} overlap`);
  }
  void hub;
});

test("separate pulls stacked nodes apart; disconnected pieces get their own space", () => {
  const stacked = separate([{ id: "1", label: "a", x: 0, y: 0 }, { id: "2", label: "b", x: 5, y: 3 }, { id: "3", label: "c", x: 2, y: 1 }]);
  for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) assert.ok(Math.abs(stacked[i].y - stacked[j].y) >= 40 || Math.abs(stacked[i].x - stacked[j].x) >= 150);
  const two = layoutRadial([
    { id: "a", label: "A", x: 0, y: 0 }, { id: "b", label: "B", x: 0, y: 0 }, { id: "c", label: "C", x: 0, y: 0 }, { id: "d", label: "D", x: 0, y: 0 },
  ], [{ id: "1", from: "a", to: "b", label: "x", kind: "other" }, { id: "2", from: "c", to: "d", label: "x", kind: "other" }]);
  const xs = (ids) => ids.map((id) => two.find((n) => n.id === id).x);
  assert.ok(Math.min(...xs(["c", "d"])) > Math.max(...xs(["a", "b"])) || Math.min(...xs(["a", "b"])) > Math.max(...xs(["c", "d"])));
});

test("weak spots: cards and mistakes mapped onto concepts", () => {
  const good = { front: "What is enthalpy?", back: "Heat content", topic: "Thermo", ...schedule(schedule(newSrs(0), 3, 0), 3, 0) };
  const fresh = { front: "Define entropy", back: "Disorder", topic: "Thermo", ...newSrs(0) };
  const m = [{ problem: "Forgot the sign of enthalpy change", read: "", fix: "", resolved: false }, { problem: "enthalpy again", read: "", fix: "", resolved: true }];
  const e = nodeStats({ label: "Enthalpy" }, [good, fresh], m, 1e12);
  assert.equal(e.cards, 1);
  assert.ok(e.mastery > 0.3);
  assert.equal(e.mistakes, 1);                                                // resolved mistakes don't count
  assert.equal(nodeStats({ label: "Entropy" }, [good, fresh], m).mastery, 0);
  assert.equal(nodeStats({ label: "Quasar" }, [good, fresh], m).mastery, null);
  assert.equal(masteryColor(undefined), "#9ca3af");
  assert.equal(masteryColor({ cards: 1, due: 0, mastery: 0, mistakes: 0 }), "hsl(0 62% 46%)");
  assert.equal(masteryColor({ cards: 1, due: 0, mastery: 1, mistakes: 0 }), "hsl(120 62% 46%)");
});

test("study order respects prerequisites and survives cycles", () => {
  const map = {
    nodes: ["A", "B", "C", "D"].map((l, i) => ({ id: l, label: l, x: i, y: 0 })),
    edges: [{ id: "1", from: "C", to: "B", label: "needed for", kind: "prereq" }, { id: "2", from: "B", to: "A", label: "needed for", kind: "prereq" }, { id: "3", from: "A", to: "D", label: "relates", kind: "other" }],
  };
  const order = studyOrder(map).map((n) => n.id);
  assert.ok(order.indexOf("C") < order.indexOf("B") && order.indexOf("B") < order.indexOf("A"));
  assert.equal(order.length, 4);
  const cyc = studyOrder({ nodes: map.nodes, edges: [...map.edges, { id: "4", from: "A", to: "C", label: "x", kind: "prereq" }] });
  assert.equal(cyc.length, 4);
});

test("outline export is a readable indented list", () => {
  const m = normalizeMap(RAW, SRC, "m1", "all");
  const md = outline(m);
  assert.match(md, /^# Thermodynamics/);
  assert.match(md, /\*\*Enthalpy\*\* — Heat content/);
  assert.equal((md.match(/\*\*/g) ?? []).length / 2, 4);                        // every concept appears exactly once
});

test("recall: typed concepts are matched forgivingly; misses and extras are reported", () => {
  const nodes = [{ id: "1", label: "Enthalpy" }, { id: "2", label: "Hess's law" }, { id: "3", label: "Gibbs energy" }, { id: "4", label: "Entropy" }];
  const r = scoreRecall(nodes, ["enthalpy", "hesss law", "gibbs free energy", "photosynthesis", ""]);
  assert.deepEqual(r.found.sort(), ["1", "2", "3"]);
  assert.deepEqual(r.missing, ["4"]);
  assert.deepEqual(r.extras, ["photosynthesis"]);
  assert.equal(r.percent, 75);
  assert.equal(scoreRecall(nodes, []).percent, 0);
  assert.equal(scoreRecall([], ["x"]).percent, 0);
});

test("recall of a link: exact, partial and miss", () => {
  const e = { label: "contributes to", kind: "part" };
  assert.equal(linkAnswer("contributes to", e), "ok");
  assert.equal(linkAnswer("it contributes", e), "partial");
  assert.equal(linkAnswer("has nothing to do with", e), "miss");
  assert.equal(linkAnswer("", e), "miss");
  assert.equal(linkAnswer("is part of", e), "partial");                          // same kind of relationship, different words
});

test("flashcards from the map: definitions and links", () => {
  const m = normalizeMap(RAW, SRC, "m1", "all");
  const cards = cardsFromMap(m);
  assert.ok(cards.some((c) => c.front === "What is Enthalpy?" && c.back.includes("Heat content")));
  assert.ok(cards.some((c) => c.front === "How are Entropy and Gibbs energy related?" && c.back === "Entropy contributes to Gibbs energy"));
  assert.equal(cards.length, 2 + m.edges.length);                                // 2 notes + one per link
});

import { applyAdditions, placeAround } from "../src/lib/map-core.ts";
test("expanding a concept adds new ones around it, reuses existing ones, and never leaves a node floating", () => {
  const base = normalizeMap(RAW, SRC, "m1", "all");
  const anchor = base.nodes.find((n) => n.label === "Entropy");
  const out = applyAdditions(base, anchor.id, {
    nodes: [{ id: "x1", label: "Second law", note: "Entropy of an isolated system never decreases" }, { id: "x2", label: "Microstates" }, { id: "x3", label: "enthalpy" }, { label: "" }],
    edges: [{ from: "@anchor", to: "x1", label: "is stated by", kind: "example" }, { from: "x1", to: "x3", label: "contrasts with", kind: "contrast" }, { from: "x1", to: "nowhere", label: "bad" }],
  });
  assert.equal(out.addedNodes, 2);                                       // "enthalpy" already exists
  assert.equal(out.map.nodes.length, base.nodes.length + 2);
  const second = out.map.nodes.find((n) => n.label === "Second law");
  assert.ok(second && Number.isFinite(second.x));
  assert.ok(out.map.edges.some((e) => e.from === anchor.id && e.to === second.id));
  assert.ok(out.map.edges.some((e) => e.from === second.id && out.map.nodes.find((n) => n.id === e.to).label === "Enthalpy"));   // linked to the EXISTING node
  const micro = out.map.nodes.find((n) => n.label === "Microstates");
  assert.ok(out.map.edges.some((e) => e.to === micro.id || e.from === micro.id));                                                    // attached to the anchor automatically
  assert.equal(new Set(out.map.nodes.map((n) => n.id)).size, out.map.nodes.length);
  assert.equal(applyAdditions(base, "missing", { nodes: [{ label: "x" }] }).addedNodes, 0);
  assert.equal(applyAdditions(base, anchor.id, null).addedNodes, 0);
  const spots = placeAround({ x: 400, y: 0 }, { x: 0, y: 0 }, 3);
  assert.ok(spots.every((p) => p.x > 400));                                // fanned out away from the centre
});

import { branchIndex } from "../src/lib/map-core.ts";
test("branches: the hub is -1 and each side of it gets its own colour index", () => {
  const nodes = ["H", "A1", "A2", "B1", "C1"].map((l) => ({ id: l, label: l, x: 0, y: 0 }));
  const edges = [["H", "A1"], ["A1", "A2"], ["H", "B1"], ["H", "C1"]].map(([f, t], i) => ({ id: String(i), from: f, to: t, label: "x", kind: "other" }));
  const b = branchIndex({ nodes, edges });
  assert.equal(b.get("H"), -1);
  assert.equal(b.get("A1"), b.get("A2"));
  assert.notEqual(b.get("A1"), b.get("B1"));
  assert.equal(b.size, 5);
});
