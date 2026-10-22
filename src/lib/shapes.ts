// Hold-to-snap shape recognition. Given the points of a freehand stroke, decide
// whether it was clearly meant to be a straight line, a polygon (triangle/rectangle…)
// or an ellipse — and if so return the clean version. Deliberately CONSERVATIVE:
// anything ambiguous (a letter, a digit, a squiggle) returns null and is left alone.
// Pure + unit-tested.

export type P = { x: number; y: number; p?: number };
export type Snap = { kind: "line" | "polygon" | "rectangle" | "ellipse"; points: P[] };

const dist = (a: P, b: P) => Math.hypot(a.x - b.x, a.y - b.y);

function perpDist(p: P, a: P, b: P): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l = Math.hypot(dx, dy);
  if (l < 1e-9) return dist(p, a);
  return Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / l;
}

/** Ramer–Douglas–Peucker polyline simplification. */
export function rdp(pts: P[], eps: number): P[] {
  if (pts.length < 3) return pts.slice();
  let max = 0, idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = perpDist(pts[i], pts[0], pts[pts.length - 1]);
    if (d > max) { max = d; idx = i; }
  }
  if (max <= eps) return [pts[0], pts[pts.length - 1]];
  return [...rdp(pts.slice(0, idx + 1), eps).slice(0, -1), ...rdp(pts.slice(idx), eps)];
}

function bbox(pts: P[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY, diag: Math.hypot(maxX - minX, maxY - minY) };
}

const pathLength = (pts: P[]) => { let l = 0; for (let i = 1; i < pts.length; i++) l += dist(pts[i - 1], pts[i]); return l; };

export function ellipsePoints(cx: number, cy: number, a: number, b: number, n = 72): P[] {
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = (i / n) * Math.PI * 2;
    return { x: cx + Math.cos(t) * a, y: cy + Math.sin(t) * b, p: 0.5 };
  });
}

export const MIN_POINTS = 8;
export const MIN_SIZE = 36; // doc px — tiny marks are never snapped

export function classifyStroke(input: P[]): Snap | null {
  if (input.length < MIN_POINTS) return null;
  const pts = input;
  const box = bbox(pts);
  const L = pathLength(pts);
  const first = pts[0], last = pts[pts.length - 1];
  const chord = dist(first, last);
  if (box.diag < MIN_SIZE) return null;

  // 1) straight line: barely deviates from the chord and isn't doubled back
  if (chord > MIN_SIZE && L / chord < 1.13) {
    let maxDev = 0;
    for (const p of pts) maxDev = Math.max(maxDev, perpDist(p, first, last));
    if (maxDev < 0.07 * chord) return { kind: "line", points: [{ ...first, p: 0.5 }, { ...last, p: 0.5 }] };
  }

  // 2) closed shapes: the stroke must come back near where it started
  const closed = chord < 0.22 * Math.max(L / 3.14, box.diag) && L > 2.2 * box.diag * 0.9 && box.w > MIN_SIZE && box.h > MIN_SIZE * 0.6;
  if (!closed) return null;

  // polygon candidates via simplification
  const ring = [...pts, pts[0]];
  const simp = rdp(ring, 0.055 * box.diag);
  const verts = simp.slice(0, -1);
  // merge a duplicated start/end vertex
  if (verts.length > 1 && dist(verts[0], verts[verts.length - 1]) < 0.12 * box.diag) verts.pop();

  if (verts.length === 4) {
    // axis-aligned rectangle if every vertex sits near a bbox corner
    const corners: P[] = [{ x: box.minX, y: box.minY }, { x: box.maxX, y: box.minY }, { x: box.maxX, y: box.maxY }, { x: box.minX, y: box.maxY }];
    const near = corners.every((c) => verts.some((v) => dist(v, c) < 0.2 * box.diag));
    if (near) return { kind: "rectangle", points: [...corners, corners[0]].map((c) => ({ ...c, p: 0.5 })) };
  }
  if (verts.length >= 3 && verts.length <= 5) {
    // every polygon edge must be reasonably long, otherwise it's just a rough blob
    const edgesOk = verts.every((v, i) => dist(v, verts[(i + 1) % verts.length]) > 0.18 * box.diag);
    if (edgesOk) return { kind: "polygon", points: [...verts, verts[0]].map((v) => ({ x: v.x, y: v.y, p: 0.5 })) };
  }

  // ellipse: points hug the bbox-fitted ellipse
  if (box.w > MIN_SIZE && box.h > MIN_SIZE) {
    const cx = (box.minX + box.maxX) / 2, cy = (box.minY + box.maxY) / 2, a = box.w / 2, b = box.h / 2;
    let dev = 0;
    for (const p of pts) dev += Math.abs(Math.sqrt(((p.x - cx) / a) ** 2 + ((p.y - cy) / b) ** 2) - 1);
    dev /= pts.length;
    if (dev < 0.13) return { kind: "ellipse", points: ellipsePoints(cx, cy, a, b) };
  }
  return null;
}
