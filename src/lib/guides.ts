// Geometry for drawing aids (ruler edge snapping). Pure + unit-tested.
export type Pt = { x: number; y: number };
export type Segment = { a: Pt; b: Pt };

/** px per cm at the page's 150 dpi (PAGE_W 1240 ≈ A4 width). */
export const PX_PER_CM = 150 / 2.54;

export function closestOnSegment(p: Pt, g: Segment): { pt: Pt; t: number; dist: number } {
  const dx = g.b.x - g.a.x, dy = g.b.y - g.a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 < 1e-9 ? 0 : ((p.x - g.a.x) * dx + (p.y - g.a.y) * dy) / l2;
  const c = Math.max(0, Math.min(1, t));
  const pt = { x: g.a.x + dx * c, y: g.a.y + dy * c };
  return { pt, t, dist: Math.hypot(p.x - pt.x, p.y - pt.y) };
}

/** Is `p` close enough to the ruler edge (within tol, and not far past either end) to start a guided stroke? */
export function nearGuide(p: Pt, g: Segment, tol: number): boolean {
  const c = closestOnSegment(p, g);
  return c.dist <= tol;
}

/** Project a point onto the (infinite) ruler line, clamped to the segment (+ a small overhang). */
export function projectOnGuide(p: Pt, g: Segment, overhang = 0): Pt {
  const dx = g.b.x - g.a.x, dy = g.b.y - g.a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return { ...g.a };
  const ux = dx / len, uy = dy / len;
  let s = (p.x - g.a.x) * ux + (p.y - g.a.y) * uy;
  s = Math.max(-overhang, Math.min(len + overhang, s));
  return { x: g.a.x + ux * s, y: g.a.y + uy * s };
}

export const lengthCm = (g: Segment) => Math.hypot(g.b.x - g.a.x, g.b.y - g.a.y) / PX_PER_CM;
