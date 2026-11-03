import test from "node:test";
import assert from "node:assert/strict";
import { highlightGroupAt, lineOf, relationIn, linesAbove, signature } from "../src/lib/ink-groups.ts";

const line = (x0, x1, y, tool = "pen", color = "#000", width = 4) => ({ tool, color, width, points: [{ x: x0, y }, { x: (x0 + x1) / 2, y: y + 1 }, { x: x1, y }] });
// a glyph-sized scribble inside a box
const glyph = (x, y, w = 24, h = 32) => ({ tool: "pen", color: "#000", width: 4, points: [{ x, y }, { x: x + w, y: y + h / 2 }, { x, y: y + h }] });

test("tapping a highlight picks up every line of it, but not other highlights", () => {
  const hl = (x0, x1, y, color = "#fde047") => line(x0, x1, y, "highlighter", color, 7);
  const strokes = [hl(100, 600, 200), hl(100, 400, 236), glyph(120, 190), hl(100, 500, 600), hl(100, 500, 236 + 30, "#93c5fd")];
  const g = highlightGroupAt(strokes, { x: 300, y: 238 });
  assert.deepEqual(g.idx, [0, 1]);
  assert.ok(g.box.y < 200 && g.box.y + g.box.h > 236);
  assert.equal(highlightGroupAt(strokes, { x: 300, y: 400 }), null);   // empty paper
  assert.equal(highlightGroupAt(strokes, { x: 140, y: 205 })?.idx.includes(2), false); // the pen glyph is never part of a highlight
});

test("a written line chains its symbols and stops at the next line", () => {
  // "2x + 3 = 7" on one line, "2x = 4" below
  const top = [glyph(100, 100), glyph(130, 100), glyph(170, 110, 20, 14), glyph(200, 100), line(240, 270, 110), line(240, 270, 122), glyph(290, 100)];
  const below = [glyph(100, 180), glyph(130, 180), line(170, 200, 190), line(170, 200, 202), glyph(220, 180)];
  const strokes = [...top, ...below];
  const l1 = lineOf(strokes, 6);
  assert.deepEqual(l1.idx, [0, 1, 2, 3, 4, 5, 6]);
  const l2 = lineOf(strokes, 11);
  assert.deepEqual(l2.idx, [7, 8, 9, 10, 11]);
  assert.equal(relationIn(strokes, l1.idx, l1.lineH)?.kind, "equals");
  assert.equal(relationIn(strokes, l2.idx, l2.lineH)?.kind, "equals");
  const ctx = linesAbove(strokes, l2);
  assert.ok(ctx && ctx.y <= 100 && ctx.y + ctx.h <= 140);
  assert.notEqual(signature(strokes, l1.idx), signature(strokes, l2.idx));
});

test("an equation isn't finished until there is something after the equals sign", () => {
  const strokes = [glyph(100, 100), glyph(130, 100), line(180, 210, 110), line(180, 210, 122)];
  const l = lineOf(strokes, 0);
  assert.equal(relationIn(strokes, l.idx, l.lineH), null);
  strokes.push(glyph(230, 100));
  const l2 = lineOf(strokes, 0);
  assert.equal(relationIn(strokes, l2.idx, l2.lineH)?.kind, "equals");
});

test("a reaction arrow counts; a lone minus sign doesn't", () => {
  const rxn = [glyph(100, 100), glyph(130, 100), line(170, 260, 116), glyph(280, 100), glyph(310, 100)];
  const l = lineOf(rxn, 0);
  assert.equal(relationIn(rxn, l.idx, l.lineH)?.kind, "arrow");
  const minus = [glyph(100, 100), line(140, 160, 116), glyph(180, 100)];
  const m = lineOf(minus, 0);
  assert.equal(relationIn(minus, m.idx, m.lineH), null);
});
