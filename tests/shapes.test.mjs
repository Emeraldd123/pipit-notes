import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyStroke, rdp } from "../src/lib/shapes.ts";

// deterministic pseudo-noise
let seed = 7;
const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed / 2147483647) * 2 - 1; };
const noisy = (pts, amp = 2) => pts.map((p) => ({ x: p.x + rnd() * amp, y: p.y + rnd() * amp, p: 0.5 }));
const lerp = (a, b, n) => Array.from({ length: n + 1 }, (_, i) => ({ x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n }));
const poly = (vs, per = 12) => vs.flatMap((v, i) => lerp(v, vs[(i + 1) % vs.length], per).slice(0, -1)).concat([vs[0]]);
// an OPEN polyline through the vertices (does not return to the start)
const open = (vs, per = 12) => vs.slice(0, -1).flatMap((v, i) => lerp(v, vs[i + 1], per).slice(0, -1)).concat([vs[vs.length - 1]]);
const circle = (cx, cy, r, n = 60, startAng = 0) => Array.from({ length: n + 1 }, (_, i) => ({ x: cx + Math.cos(startAng + (i / n) * Math.PI * 2) * r, y: cy + Math.sin(startAng + (i / n) * Math.PI * 2) * r }));

test("a wobbly straight line snaps to a 2-point line", () => {
  const s = classifyStroke(noisy(lerp({ x: 100, y: 100 }, { x: 420, y: 160 }, 40), 3));
  assert.equal(s.kind, "line");
  assert.equal(s.points.length, 2);
  assert.ok(Math.abs(s.points[1].x - 420) < 6);
});
test("a rough circle snaps to an ellipse", () => {
  const s = classifyStroke(noisy(circle(300, 300, 90), 4));
  assert.equal(s.kind, "ellipse");
  assert.ok(s.points.length > 40);
});
test("a rough oval (wider than tall) stays an ellipse", () => {
  const pts = circle(300, 300, 100).map((p) => ({ x: 300 + (p.x - 300) * 1.8, y: p.y }));
  assert.equal(classifyStroke(noisy(pts, 3)).kind, "ellipse");
});
test("a rough rectangle snaps to a clean rectangle", () => {
  const s = classifyStroke(noisy(poly([{ x: 100, y: 100 }, { x: 400, y: 100 }, { x: 400, y: 260 }, { x: 100, y: 260 }], 16), 3));
  assert.equal(s.kind, "rectangle");
  assert.equal(s.points.length, 5);
});
test("a rough triangle snaps to a polygon with 3 corners", () => {
  const s = classifyStroke(noisy(poly([{ x: 100, y: 300 }, { x: 300, y: 80 }, { x: 460, y: 320 }], 18), 3));
  assert.equal(s.kind, "polygon");
  assert.equal(s.points.length, 4); // 3 vertices + closing point
});

// ---- things that must NOT be touched: handwriting -----------------------------------
test("a digit 3 is left alone", () => {
  const top = Array.from({ length: 20 }, (_, i) => { const t = (i / 19) * Math.PI * 1.5 - Math.PI * 0.75; return { x: 100 + Math.cos(t) * 40, y: 100 + Math.sin(t) * 38 }; });
  const bot = Array.from({ length: 20 }, (_, i) => { const t = (i / 19) * Math.PI * 1.5 - Math.PI * 0.75; return { x: 100 + Math.cos(t) * 46, y: 190 + Math.sin(t) * 44 }; });
  assert.equal(classifyStroke(noisy([...top, ...bot], 1)), null);
});
test("an open C / S curve is left alone", () => {
  const c = Array.from({ length: 40 }, (_, i) => { const t = (i / 39) * Math.PI * 1.6 + 0.4; return { x: 200 + Math.cos(t) * 60, y: 200 + Math.sin(t) * 60 }; });
  assert.equal(classifyStroke(c), null);
  const s = Array.from({ length: 40 }, (_, i) => ({ x: 100 + i * 4, y: 200 + Math.sin(i / 4) * 40 }));
  assert.equal(classifyStroke(s), null);
});
test("an L / V / zigzag is left alone", () => {
  assert.equal(classifyStroke(open([{ x: 100, y: 100 }, { x: 100, y: 300 }, { x: 260, y: 300 }], 14)), null);
  assert.equal(classifyStroke(open([{ x: 100, y: 100 }, { x: 160, y: 260 }, { x: 220, y: 100 }], 14)), null);
  assert.equal(classifyStroke(open([{ x: 100, y: 100 }, { x: 160, y: 200 }, { x: 220, y: 100 }, { x: 280, y: 200 }, { x: 340, y: 100 }], 10)), null);
});
test("a tiny dot or short scribble is never snapped", () => {
  assert.equal(classifyStroke(noisy(circle(50, 50, 6, 20), 1)), null);
  assert.equal(classifyStroke([{ x: 0, y: 0 }, { x: 5, y: 5 }]), null);
});
test("rdp keeps corners and drops collinear points", () => {
  const out = rdp(open([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }], 10), 2);
  assert.equal(out.length, 3);
});
