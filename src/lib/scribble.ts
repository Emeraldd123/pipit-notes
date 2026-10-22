// "Scribble to erase": a rapid back-and-forth scribble over existing ink deletes that ink
// (like Apple's Scribble). Conservative on purpose — it needs a clear zigzag AND real ink
// underneath, and it's opt-in. Pure + unit-tested.
import { rdp, type P } from "./shapes.ts";

const dist = (a: P, b: P) => Math.hypot(a.x - b.x, a.y - b.y);

function bbox(pts: P[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY, diag: Math.hypot(maxX - minX, maxY - minY) };
}

/** Number of sharp reversals (> ~110° turns) in the simplified path. */
export function reversals(pts: P[]): number {
  const b = bbox(pts);
  const s = rdp(pts, Math.max(2, b.diag * 0.04));
  let n = 0;
  for (let i = 1; i < s.length - 1; i++) {
    const a1 = Math.atan2(s[i].y - s[i - 1].y, s[i].x - s[i - 1].x);
    const a2 = Math.atan2(s[i + 1].y - s[i].y, s[i + 1].x - s[i].x);
    let d = Math.abs(a2 - a1);
    if (d > Math.PI) d = 2 * Math.PI - d;
    if (d > (110 * Math.PI) / 180) n++;
  }
  return n;
}

export function isScribble(pts: P[]): boolean {
  if (pts.length < 12) return false;
  const b = bbox(pts);
  if (b.diag < 30 || b.diag > 700) return false;
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += dist(pts[i - 1], pts[i]);
  if (len / b.diag < 4.5) return false; // a zigzag covers far more ground than its bounding box
  return reversals(pts) >= 5;
}

/** Indices of strokes that sit (almost) entirely under the scribble's bounding box. */
export function strokesUnder(scribble: P[], strokes: { points: P[] }[]): number[] {
  const b = bbox(scribble);
  const pad = Math.max(8, b.diag * 0.04);
  const out: number[] = [];
  strokes.forEach((s, i) => {
    if (!s.points.length) return;
    const inside = s.points.filter((p) => p.x >= b.minX - pad && p.x <= b.maxX + pad && p.y >= b.minY - pad && p.y <= b.maxY + pad).length;
    if (inside / s.points.length >= 0.8) out.push(i);
  });
  return out;
}
