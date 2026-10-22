// Canvas rendering for graph blocks: 2D curves (explicit, inverse, implicit via marching
// squares) and 3D surfaces (painter's algorithm). Pure drawing — no DOM besides the context.
import { MathParseError, parseEquation, expressionRows, type Equation } from "./mathexpr.ts";

export type View2D = { cx: number; cy: number; scale: number };   // scale = pixels per unit
export const DEFAULT_VIEW: View2D = { cx: 0, cy: 0, scale: 40 };
export type View3D = { yaw: number; pitch: number; range: number };
export const DEFAULT_VIEW3D: View3D = { yaw: 0.8, pitch: 0.6, range: 5 };

export const GRAPH_COLORS = ["#2563eb", "#dc2626", "#16a34a", "#9333ea", "#ea580c", "#0891b2"];

export type ParsedRow = { src: string; eq?: Equation; error?: string };

export function parseRows(text: string): ParsedRow[] {
  return expressionRows(text).map((src) => {
    try { return { src, eq: parseEquation(src) }; }
    catch (e) { return { src, error: e instanceof MathParseError ? e.message : "could not read this" }; }
  });
}

export const is3D = (rows: ParsedRow[]) => rows.some((r) => r.eq?.kind === "surface");

/** A tick step of 1/2/5 × 10^n giving roughly `target` ticks across `span`. */
export function niceStep(span: number, target = 8): number {
  const raw = span / target;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
}

const fmt = (v: number) => (Math.abs(v) < 1e-9 ? "0" : Number(v.toPrecision(6)).toString());

export function drawGraph2D(ctx: CanvasRenderingContext2D, w: number, h: number, rows: ParsedRow[], v: View2D, dark = false) {
  const fg = dark ? "#e5e7eb" : "#111827", grid = dark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.08)", axis = dark ? "rgba(255,255,255,0.55)" : "rgba(0,0,0,0.55)";
  ctx.clearRect(0, 0, w, h);
  const sx = (x: number) => w / 2 + (x - v.cx) * v.scale;
  const sy = (y: number) => h / 2 - (y - v.cy) * v.scale;
  const x0 = v.cx - w / 2 / v.scale, x1 = v.cx + w / 2 / v.scale;
  const y0 = v.cy - h / 2 / v.scale, y1 = v.cy + h / 2 / v.scale;

  // grid + labels
  const step = niceStep(Math.max(x1 - x0, 1e-9), Math.max(4, w / 90));
  ctx.lineWidth = 1; ctx.font = "12px ui-sans-serif, system-ui"; ctx.fillStyle = fg;
  ctx.strokeStyle = grid;
  ctx.beginPath();
  for (let gx = Math.ceil(x0 / step) * step; gx <= x1; gx += step) { const px = Math.round(sx(gx)) + 0.5; ctx.moveTo(px, 0); ctx.lineTo(px, h); }
  for (let gy = Math.ceil(y0 / step) * step; gy <= y1; gy += step) { const py = Math.round(sy(gy)) + 0.5; ctx.moveTo(0, py); ctx.lineTo(w, py); }
  ctx.stroke();
  ctx.strokeStyle = axis; ctx.lineWidth = 1.5;
  const ax = Math.min(Math.max(sx(0), 0), w), ay = Math.min(Math.max(sy(0), 0), h);
  ctx.beginPath(); ctx.moveTo(ax, 0); ctx.lineTo(ax, h); ctx.moveTo(0, ay); ctx.lineTo(w, ay); ctx.stroke();
  ctx.fillStyle = axis;
  ctx.textAlign = "center"; ctx.textBaseline = "top";
  for (let gx = Math.ceil(x0 / step) * step; gx <= x1; gx += step) if (Math.abs(gx) > step / 2) ctx.fillText(fmt(gx), sx(gx), Math.min(Math.max(ay + 3, 2), h - 14));
  ctx.textAlign = "right"; ctx.textBaseline = "middle";
  for (let gy = Math.ceil(y0 / step) * step; gy <= y1; gy += step) if (Math.abs(gy) > step / 2) ctx.fillText(fmt(gy), Math.min(Math.max(ax - 4, 24), w - 2), sy(gy));

  ctx.lineWidth = 2.5; ctx.lineJoin = "round"; ctx.lineCap = "round";
  rows.forEach((r, i) => {
    if (!r.eq) return;
    ctx.strokeStyle = GRAPH_COLORS[i % GRAPH_COLORS.length];
    const eq = r.eq;
    if (eq.kind === "explicit") plotParam(ctx, w, (px) => { const x = x0 + (px / w) * (x1 - x0); return [x, eq.f({ x, y: 0 })]; }, sx, sy, h, v.scale);
    else if (eq.kind === "inverse") plotParam(ctx, h, (py) => { const y = y1 - (py / h) * (y1 - y0); return [eq.f({ x: 0, y }), y]; }, sx, sy, h, v.scale);
    else if (eq.kind === "implicit") marching(ctx, w, h, (px, py) => eq.f({ x: x0 + (px / w) * (x1 - x0), y: y1 - (py / h) * (y1 - y0) }));
  });
}

/** Sample a curve one pixel at a time, lifting the pen over NaN gaps and asymptote jumps. */
function plotParam(ctx: CanvasRenderingContext2D, n: number, at: (i: number) => [number, number], sx: (x: number) => number, sy: (y: number) => number, h: number, _scale: number) {
  ctx.beginPath();
  let pen = false, last: [number, number] | null = null;
  for (let i = 0; i <= n; i += 1) {
    const [x, y] = at(i);
    if (!Number.isFinite(x) || !Number.isFinite(y)) { pen = false; last = null; continue; }
    const px = sx(x), py = sy(y);
    if (Math.abs(py) > 1e6 || Math.abs(px) > 1e6) { pen = false; last = null; continue; }
    // a vertical jump bigger than ~2 screen heights between neighbours is an asymptote, not a line
    if (last && (Math.abs(py - last[1]) > h * 2 || Math.abs(px - last[0]) > h * 2)) pen = false;
    if (pen) ctx.lineTo(px, py); else ctx.moveTo(px, py);
    pen = true; last = [px, py];
  }
  ctx.stroke();
}

/** Marching squares on a coarse pixel grid: draws F(x,y)=0 (circles, ellipses, anything implicit). */
function marching(ctx: CanvasRenderingContext2D, w: number, h: number, F: (px: number, py: number) => number) {
  const cell = 4, nx = Math.ceil(w / cell), ny = Math.ceil(h / cell);
  const vals = new Float64Array((nx + 1) * (ny + 1));
  for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) vals[j * (nx + 1) + i] = F(i * cell, j * cell);
  const lerp = (a: number, b: number) => (a === b ? 0.5 : a / (a - b));
  ctx.beginPath();
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const a = vals[j * (nx + 1) + i], b = vals[j * (nx + 1) + i + 1], c = vals[(j + 1) * (nx + 1) + i + 1], d = vals[(j + 1) * (nx + 1) + i];
      if (!(Number.isFinite(a) && Number.isFinite(b) && Number.isFinite(c) && Number.isFinite(d))) continue;
      const code = (a > 0 ? 8 : 0) | (b > 0 ? 4 : 0) | (c > 0 ? 2 : 0) | (d > 0 ? 1 : 0);
      if (code === 0 || code === 15) continue;
      const X = i * cell, Y = j * cell;
      const top: [number, number] = [X + lerp(a, b) * cell, Y];
      const right: [number, number] = [X + cell, Y + lerp(b, c) * cell];
      const bottom: [number, number] = [X + lerp(d, c) * cell, Y + cell];
      const left: [number, number] = [X, Y + lerp(a, d) * cell];
      const seg = (p: [number, number], q: [number, number]) => { ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); };
      switch (code) {
        case 1: case 14: seg(left, bottom); break;
        case 2: case 13: seg(bottom, right); break;
        case 3: case 12: seg(left, right); break;
        case 4: case 11: seg(top, right); break;
        case 5: seg(left, top); seg(bottom, right); break;
        case 6: case 9: seg(top, bottom); break;
        case 7: case 8: seg(left, top); break;
        case 10: seg(top, right); seg(left, bottom); break;
      }
    }
  }
  ctx.stroke();
}

// --- 3D ---------------------------------------------------------------------------------------------

export function drawSurface(ctx: CanvasRenderingContext2D, w: number, h: number, rows: ParsedRow[], v: View3D, dark = false) {
  ctx.clearRect(0, 0, w, h);
  const surf = rows.find((r) => r.eq?.kind === "surface")?.eq;
  if (!surf || surf.kind !== "surface") return;
  const N = 34, R = v.range;
  const zs: number[][] = [];
  const flat: number[] = [];
  for (let j = 0; j <= N; j++) {
    const row: number[] = [];
    for (let i = 0; i <= N; i++) {
      const z = surf.f({ x: -R + (2 * R * i) / N, y: -R + (2 * R * j) / N });
      row.push(z);
      if (Number.isFinite(z)) flat.push(z);
    }
    zs.push(row);
  }
  if (!flat.length) return;
  flat.sort((a, b) => a - b);
  let zmin = flat[Math.floor(flat.length * 0.02)], zmax = flat[Math.ceil(flat.length * 0.98) - 1];
  if (zmax - zmin < 1e-9) { zmin -= 1; zmax += 1; }
  const zScale = (2 * R) / (zmax - zmin);   // squash z into a cube the size of x/y
  const cy = Math.cos(v.yaw), sy = Math.sin(v.yaw), cp = Math.cos(v.pitch), sp = Math.sin(v.pitch);
  const unit = Math.min(w, h) / (R * 3.4);
  const proj = (x: number, y: number, z: number) => {
    const zz = (z - (zmin + zmax) / 2) * zScale;
    const rx = x * cy - y * sy, ry = x * sy + y * cy;
    return { px: w / 2 + rx * unit, py: h / 2 - (zz * cp - ry * sp) * unit, depth: ry * cp + zz * sp };
  };
  type Quad = { pts: { px: number; py: number }[]; depth: number; t: number };
  const quads: Quad[] = [];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const zz = [zs[j][i], zs[j][i + 1], zs[j + 1][i + 1], zs[j + 1][i]];
    if (zz.some((z) => !Number.isFinite(z) || z < zmin - (zmax - zmin) || z > zmax + (zmax - zmin))) continue;
    const xs = [i, i + 1, i + 1, i], ys = [j, j, j + 1, j + 1];
    const pts = zz.map((z, k) => proj(-R + (2 * R * xs[k]) / N, -R + (2 * R * ys[k]) / N, z));
    quads.push({ pts, depth: pts.reduce((s, p) => s + p.depth, 0) / 4, t: (zz.reduce((s, z) => s + z, 0) / 4 - zmin) / (zmax - zmin) });
  }
  quads.sort((a, b) => b.depth - a.depth);   // far first
  ctx.lineJoin = "round";
  for (const q of quads) {
    const t = Math.min(1, Math.max(0, q.t));
    ctx.fillStyle = `hsl(${220 - t * 200} 70% ${dark ? 45 : 55}%)`;
    ctx.strokeStyle = dark ? "rgba(0,0,0,0.35)" : "rgba(255,255,255,0.55)";
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    q.pts.forEach((p, k) => (k ? ctx.lineTo(p.px, p.py) : ctx.moveTo(p.px, p.py)));
    ctx.closePath(); ctx.fill(); ctx.stroke();
  }
  // floor axes
  ctx.strokeStyle = dark ? "rgba(255,255,255,0.5)" : "rgba(0,0,0,0.5)"; ctx.lineWidth = 1.5; ctx.fillStyle = ctx.strokeStyle;
  ctx.font = "13px ui-sans-serif, system-ui";
  const zf = zmin;
  for (const [a, b, label] of [[[-R, 0, zf], [R, 0, zf], "x"], [[0, -R, zf], [0, R, zf], "y"]] as const) {
    const p = proj(a[0], a[1], a[2]), q = proj(b[0], b[1], b[2]);
    ctx.beginPath(); ctx.moveTo(p.px, p.py); ctx.lineTo(q.px, q.py); ctx.stroke();
    ctx.fillText(label, q.px + 4, q.py - 4);
  }
  ctx.fillText(`z ∈ [${fmt(zmin)}, ${fmt(zmax)}]`, 8, h - 8);
}
