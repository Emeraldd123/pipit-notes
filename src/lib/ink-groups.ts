// Grouping ink without any AI: which highlighter strokes make up one highlight, which strokes make up one written
// line, and whether a line looks like a finished equation (it has an "=" or a reaction arrow with writing on both
// sides). Pure geometry on stroke points, so it runs on every pen-up and is unit-tested in node.
import type { StrokeInput } from "../types.ts";

export type Box = { x: number; y: number; w: number; h: number };
type S = Pick<StrokeInput, "tool" | "color" | "width" | "points"> & { id?: string };

/** Bounding box of a stroke's points (centre line, no pen width). */
export function pointsBox(s: S): Box {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of s.points) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** How wide the highlighter actually paints (note-canvas toolStyle: width × 4). */
export const highlighterReach = (s: S) => (s.width * 4) / 2;

export function union(a: Box, b: Box): Box {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}
export const pad = (b: Box, d: number): Box => ({ x: b.x - d, y: b.y - d, w: b.w + 2 * d, h: b.h + 2 * d });

function distToSeg(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) {
  const dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}
function nearStroke(p: { x: number; y: number }, s: S, r: number) {
  const pts = s.points;
  if (pts.length === 1) return Math.hypot(pts[0].x - p.x, pts[0].y - p.y) <= r;
  for (let i = 1; i < pts.length; i++) if (distToSeg(p, pts[i - 1], pts[i]) <= r) return true;
  return false;
}

/** The painted area of a highlighter stroke. */
const hlBox = (s: S) => pad(pointsBox(s), highlighterReach(s));

/**
 * The highlight under a tap: the highlighter stroke you touched plus every same-colour highlighter stroke that
 * continues it — the next line of a multi-line highlight, or a second swipe across the same words.
 */
export function highlightGroupAt(strokes: S[], p: { x: number; y: number }, slop = 6): { idx: number[]; box: Box } | null {
  let hit = -1;
  for (let i = strokes.length - 1; i >= 0; i--) {
    const s = strokes[i];
    if (s.tool === "highlighter" && nearStroke(p, s, highlighterReach(s) + slop)) { hit = i; break; }
  }
  return hit < 0 ? null : highlightGroup(strokes, hit);
}

/** Grow a highlight from stroke `seed` (see highlightGroupAt). */
export function highlightGroup(strokes: S[], seed: number): { idx: number[]; box: Box } {
  const s0 = strokes[seed];
  const lineH = highlighterReach(s0) * 2;
  const members = new Set([seed]);
  let box = hlBox(s0);
  for (let grew = true; grew;) {
    grew = false;
    strokes.forEach((s, i) => {
      if (members.has(i) || s.tool !== "highlighter" || s.color !== s0.color) return;
      const b = hlBox(s);
      // touching or overlapping, allowing about one line of gap between highlighted lines
      const gapY = Math.max(0, Math.max(b.y, box.y) - Math.min(b.y + b.h, box.y + box.h));
      const gapX = Math.max(0, Math.max(b.x, box.x) - Math.min(b.x + b.w, box.x + box.w));
      if (gapY <= lineH * 0.9 && gapX <= lineH * 1.5) { members.add(i); box = union(box, b); grew = true; }
    });
  }
  return { idx: [...members].sort((a, b) => a - b), box };
}

// --- written lines & finished equations --------------------------------------------------------------------------

const writing = (s: S) => s.tool !== "highlighter" && s.points.length > 0;
const median = (v: number[]) => { const a = [...v].sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : 0; };
const cy = (b: Box) => b.y + b.h / 2;

/**
 * The strokes written on the same line as stroke `seed`: neighbours whose middle sits inside the line's band,
 * chained left and right across normal gaps between symbols and words.
 */
export function lineOf(strokes: S[], seed: number): { idx: number[]; box: Box; lineH: number } {
  const boxes = strokes.map(pointsBox);
  const members = new Set([seed]);
  const charH = () => Math.max(24, median([...members].map((i) => boxes[i].h).filter((h) => h > 6)) || 32);
  for (let grew = true; grew;) {
    grew = false;
    const h = charH();
    const mid = median([...members].map((i) => cy(boxes[i])));
    const xs = [...members].map((i) => boxes[i]);
    const x0 = Math.min(...xs.map((b) => b.x)), x1 = Math.max(...xs.map((b) => b.x + b.w));
    strokes.forEach((s, i) => {
      if (members.has(i) || !writing(s)) return;
      const b = boxes[i];
      const gap = Math.max(0, Math.max(b.x, x0) - Math.min(b.x + b.w, x1));
      if (Math.abs(cy(b) - mid) <= h * 0.75 && gap <= h * 3) { members.add(i); grew = true; }
    });
  }
  const idx = [...members].sort((a, b) => a - b);
  const box = idx.map((i) => boxes[i]).reduce(union);
  return { idx, box, lineH: charH() };
}

/** A short, nearly flat stroke — one bar of "=", a minus sign, or an arrow's shaft. */
const dash = (b: Box) => b.w >= 10 && b.h <= Math.max(6, b.w * 0.35);

export type Relation = { kind: "equals" | "arrow"; box: Box };

/** The "=" (two stacked dashes) or reaction arrow (a long flat stroke) in a line, if there is one with writing on both sides. */
export function relationIn(strokes: S[], idx: number[], lineH: number): Relation | null {
  const boxes = idx.map((i) => pointsBox(strokes[i]));
  const sides = (r: Box) => {
    const left = boxes.some((b) => b !== r && b.x + b.w < r.x + 2 && b.w + b.h > 4);
    const right = boxes.some((b) => b !== r && b.x > r.x + r.w - 2 && b.w + b.h > 4);
    return left && right;
  };
  for (let a = 0; a < boxes.length; a++) {
    for (let b = a + 1; b < boxes.length; b++) {
      const A = boxes[a], B = boxes[b];
      if (!dash(A) || !dash(B)) continue;
      const overlap = Math.min(A.x + A.w, B.x + B.w) - Math.max(A.x, B.x);
      const dy = Math.abs(cy(A) - cy(B));
      const w = Math.max(A.w, B.w);
      if (overlap >= Math.min(A.w, B.w) * 0.5 && Math.abs(A.w - B.w) <= w * 0.6 && dy >= 3 && dy <= Math.max(w * 0.9, lineH * 0.6)) {
        const box = union(A, B);
        if (sides(box)) return { kind: "equals", box };
      }
    }
  }
  for (const r of boxes) {
    if (r.w >= Math.max(40, lineH * 1.4) && r.h <= r.w * 0.45 && sides(r)) return { kind: "arrow", box: r };
  }
  return null;
}

/** Order-independent fingerprint of a set of strokes (by id when they have one). */
export function signature(strokes: S[], idx: number[]): string {
  return idx.map((i) => strokes[i].id ?? `${strokes[i].points[0]?.x},${strokes[i].points[0]?.y},${strokes[i].points.length}`).sort().join("|");
}

/** Up to `max` written lines directly above `line` (same column, close by) — the working it should follow from. */
export function linesAbove(strokes: S[], line: { idx: number[]; box: Box; lineH: number }, max = 2): Box | null {
  const taken = new Set(line.idx);
  let top = line.box.y, out: Box | null = null;
  for (let n = 0; n < max; n++) {
    let best = -1, bestY = -Infinity;
    strokes.forEach((s, i) => {
      if (taken.has(i) || !writing(s)) return;
      const b = pointsBox(s);
      const bottom = b.y + b.h;
      const xOverlap = Math.min(b.x + b.w, line.box.x + line.box.w + line.lineH * 4) - Math.max(b.x, line.box.x - line.lineH * 4);
      if (bottom <= top + line.lineH * 0.3 && top - bottom <= line.lineH * 2.2 && xOverlap > 0 && bottom > bestY) { best = i; bestY = bottom; }
    });
    if (best < 0) break;
    const above = lineOf(strokes, best);
    above.idx.forEach((i) => taken.add(i));
    out = out ? union(out, above.box) : above.box;
    top = above.box.y;
  }
  return out;
}
