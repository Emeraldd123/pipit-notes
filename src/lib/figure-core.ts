// Exam figures: validation + geometry. A figure is described as plain JSON (by the AI or by
// hand) and drawn locally as SVG — so graphs are exact, charts are crisp, and nothing needs
// to be fetched. Pure + unit-tested: everything here returns data, not DOM.
import { parseEquation } from "./mathexpr.ts";

export type FigurePoint = { x: number; y: number; label?: string };
export type GraphFigure = {
  type: "graph"; title?: string; xLabel?: string; yLabel?: string;
  x: [number, number]; y?: [number, number];
  curves: { expr: string; label?: string; dashed?: boolean; domain?: [number, number] }[];
  points?: FigurePoint[];
  vlines?: { x: number; label?: string }[];
  hlines?: { y: number; label?: string }[];
  shade?: { expr: string; expr2?: string; from: number; to: number };
  caption?: string;
};
export type ChartFigure = {
  type: "chart"; kind: "bar" | "line" | "scatter" | "pie"; title?: string; xLabel?: string; yLabel?: string;
  categories?: string[];
  series: { name: string; values?: number[]; points?: { x: number; y: number }[] }[];
  caption?: string;
};
export type TableFigure = { type: "table"; headers: string[]; rows: (string | number)[][]; caption?: string };
export type DiagramEl =
  | { t: "line"; x1: number; y1: number; x2: number; y2: number; label?: string; dashed?: boolean; arrow?: boolean }
  | { t: "circle"; cx: number; cy: number; r: number; fill?: string; label?: string }
  | { t: "rect"; x: number; y: number; w: number; h: number; label?: string; fill?: string }
  | { t: "poly"; points: [number, number][]; fill?: string; label?: string }
  | { t: "text"; x: number; y: number; text: string; size?: number; anchor?: "start" | "middle" | "end" }
  | { t: "point"; x: number; y: number; label?: string }
  | { t: "arc"; cx: number; cy: number; r: number; from: number; to: number; label?: string };
export type DiagramFigure = { type: "diagram"; width: number; height: number; elements: DiagramEl[]; caption?: string };
/** A picture cut out of one of the student's own pages (the exam builder fills in `src`). */
export type CropFigure = { type: "crop"; image: number; bbox: [number, number, number, number]; src?: string; caption?: string };
export type Figure = GraphFigure | ChartFigure | TableFigure | DiagramFigure | CropFigure;

export type Prim =
  | { t: "path"; d: string; stroke?: string; fill?: string; w?: number; dash?: boolean; op?: number; clip?: boolean }
  | { t: "text"; x: number; y: number; s: string; size?: number; anchor?: "start" | "middle" | "end"; rotate?: number; fill?: string; bold?: boolean }
  | { t: "circle"; cx: number; cy: number; r: number; fill?: string; stroke?: string };
export type Drawing = { w: number; h: number; prims: Prim[]; clip?: { x: number; y: number; w: number; h: number } };

export const PALETTE = ["#2563eb", "#dc2626", "#16a34a", "#9333ea", "#ea580c", "#0891b2"];
export const INK = "#111827", GRID = "#e5e7eb";

// --- validation --------------------------------------------------------------------------------------------------
const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const str = (v: unknown, max = 120) => (typeof v === "string" ? v.trim().slice(0, max) : undefined) || undefined;
const range = (v: unknown): [number, number] | undefined => (Array.isArray(v) && v.length === 2 && fin(v[0]) && fin(v[1]) && v[0] < v[1] ? [v[0], v[1]] : undefined);

/** Accept "y = x^2", "f(x) = x^2" or "x^2"; return the right-hand side if it graphs as y = f(x). */
export function explicitExpr(src: unknown): string | null {
  if (typeof src !== "string" || !src.trim()) return null;
  try {
    if (src.includes("=") && !/^\s*(?:y|[a-z]\s*\(\s*x\s*\))\s*=[^=]+$/i.test(src)) return null;   // only y = f(x) forms
    const rhs = src.includes("=") ? src.split("=").slice(1).join("=") : src;
    const eq = parseEquation(`y = ${rhs}`);
    return eq.kind === "explicit" ? rhs.trim() : null;
  } catch { return null; }
}

export function normalizeFigure(raw: unknown): Figure | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const caption = str(r.caption, 160);
  switch (r.type) {
    case "graph": {
      const x = range(r.x);
      if (!x) return null;
      const curves = (Array.isArray(r.curves) ? r.curves : []).slice(0, 5).flatMap((c: Record<string, unknown>) => {
        const expr = explicitExpr(c?.expr);
        return expr ? [{ expr, label: str(c.label, 40), dashed: c.dashed === true, domain: range(c.domain) }] : [];
      });
      const points = (Array.isArray(r.points) ? r.points : []).slice(0, 12).filter((p: FigurePoint) => fin(p?.x) && fin(p?.y)).map((p: FigurePoint) => ({ x: p.x, y: p.y, label: str(p.label, 24) }));
      const vlines = (Array.isArray(r.vlines) ? r.vlines : []).slice(0, 4).filter((v: { x: number }) => fin(v?.x)).map((v: { x: number; label?: string }) => ({ x: v.x, label: str(v.label, 24) }));
      const hlines = (Array.isArray(r.hlines) ? r.hlines : []).slice(0, 4).filter((v: { y: number }) => fin(v?.y)).map((v: { y: number; label?: string }) => ({ y: v.y, label: str(v.label, 24) }));
      let shade: GraphFigure["shade"];
      const s = r.shade as Record<string, unknown> | undefined;
      if (s && explicitExpr(s.expr) && fin(s.from) && fin(s.to) && s.from < s.to) shade = { expr: explicitExpr(s.expr)!, expr2: s.expr2 ? explicitExpr(s.expr2) ?? undefined : undefined, from: s.from, to: s.to };
      if (!curves.length && !points.length && !vlines.length) return null;
      return { type: "graph", title: str(r.title), xLabel: str(r.xLabel, 40), yLabel: str(r.yLabel, 40), x, y: range(r.y), curves, points, vlines, hlines, shade, caption };
    }
    case "chart": {
      const kind = ["bar", "line", "scatter", "pie"].includes(r.kind as string) ? (r.kind as ChartFigure["kind"]) : "bar";
      const series = (Array.isArray(r.series) ? r.series : []).slice(0, 4).flatMap((s: Record<string, unknown>) => {
        const values = Array.isArray(s?.values) ? (s.values as unknown[]).filter(fin).slice(0, 14) : undefined;
        const points = Array.isArray(s?.points) ? (s.points as FigurePoint[]).filter((p) => fin(p?.x) && fin(p?.y)).slice(0, 40).map((p) => ({ x: p.x, y: p.y })) : undefined;
        return (values?.length || points?.length) ? [{ name: str(s.name, 30) ?? "", values: values?.length ? values : undefined, points: points?.length ? points : undefined }] : [];
      });
      if (!series.length) return null;
      const categories = Array.isArray(r.categories) ? (r.categories as unknown[]).slice(0, 14).map((c) => String(c).slice(0, 18)) : undefined;
      return { type: "chart", kind, title: str(r.title), xLabel: str(r.xLabel, 40), yLabel: str(r.yLabel, 40), categories, series, caption };
    }
    case "table": {
      const headers = (Array.isArray(r.headers) ? r.headers : []).slice(0, 8).map((h: unknown) => String(h).slice(0, 30));
      const rows = (Array.isArray(r.rows) ? r.rows : []).slice(0, 14).map((row: unknown) => (Array.isArray(row) ? row.slice(0, 8).map((c) => (typeof c === "number" ? c : String(c).slice(0, 40))) : [])).filter((row: unknown[]) => row.length);
      if (!rows.length) return null;
      return { type: "table", headers, rows, caption };
    }
    case "diagram": {
      const width = fin(r.width) ? Math.min(800, Math.max(120, r.width)) : 400;
      const height = fin(r.height) ? Math.min(600, Math.max(100, r.height)) : 300;
      const els: DiagramEl[] = [];
      for (const e of (Array.isArray(r.elements) ? r.elements : []).slice(0, 80) as Record<string, unknown>[]) {
        const n = (k: string) => e[k] as number;
        switch (e?.t) {
          case "line": if ([n("x1"), n("y1"), n("x2"), n("y2")].every(fin)) els.push({ t: "line", x1: n("x1"), y1: n("y1"), x2: n("x2"), y2: n("y2"), label: str(e.label, 24), dashed: e.dashed === true, arrow: e.arrow === true }); break;
          case "circle": if ([n("cx"), n("cy"), n("r")].every(fin) && n("r") > 0) els.push({ t: "circle", cx: n("cx"), cy: n("cy"), r: n("r"), fill: str(e.fill, 20), label: str(e.label, 24) }); break;
          case "rect": if ([n("x"), n("y"), n("w"), n("h")].every(fin)) els.push({ t: "rect", x: n("x"), y: n("y"), w: n("w"), h: n("h"), fill: str(e.fill, 20), label: str(e.label, 24) }); break;
          case "poly": if (Array.isArray(e.points) && e.points.length >= 3 && (e.points as unknown[][]).every((p) => Array.isArray(p) && fin(p[0]) && fin(p[1]))) els.push({ t: "poly", points: (e.points as [number, number][]).slice(0, 12).map((p) => [p[0], p[1]] as [number, number]), fill: str(e.fill, 20), label: str(e.label, 24) }); break;
          case "text": if (fin(e.x) && fin(e.y) && str(e.text, 60)) els.push({ t: "text", x: n("x"), y: n("y"), text: str(e.text, 60)!, size: fin(e.size) ? Math.min(32, Math.max(8, e.size)) : undefined, anchor: ["start", "middle", "end"].includes(e.anchor as string) ? (e.anchor as "start") : undefined }); break;
          case "point": if (fin(e.x) && fin(e.y)) els.push({ t: "point", x: n("x"), y: n("y"), label: str(e.label, 24) }); break;
          case "arc": if ([n("cx"), n("cy"), n("r"), n("from"), n("to")].every(fin) && n("r") > 0) els.push({ t: "arc", cx: n("cx"), cy: n("cy"), r: n("r"), from: n("from"), to: n("to"), label: str(e.label, 24) }); break;
        }
      }
      return els.length ? { type: "diagram", width, height, elements: els, caption } : null;
    }
    case "crop": {
      const bb = r.bbox;
      if (!fin(r.image) || !Array.isArray(bb) || bb.length !== 4 || !bb.every(fin)) return null;
      const [x, y, w, h] = bb as number[];
      if (w <= 0.03 || h <= 0.03 || x < 0 || y < 0 || x + w > 1.001 || y + h > 1.001) return null;
      return { type: "crop", image: Math.round(r.image), bbox: [x, y, w, h], src: typeof r.src === "string" ? r.src : undefined, caption };
    }
    default: return null;
  }
}

// --- geometry ---------------------------------------------------------------------------------------------------------
export function niceStep(span: number, target = 6): number {
  const raw = span / target;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
}
const num = (v: number) => (Math.abs(v) < 1e-9 ? "0" : String(Number(v.toPrecision(6))));
const f2 = (v: number) => (Math.round(v * 100) / 100).toString();

const evalExpr = (expr: string) => {
  const eq = parseEquation(`y = ${expr}`);
  return eq.kind === "explicit" ? (x: number) => eq.f({ x, y: 0 }) : () => NaN;
};

/** Range for y when the figure doesn't give one: robust to asymptotes. */
export function autoYRange(fig: GraphFigure): [number, number] {
  const vals: number[] = [];
  for (const c of fig.curves) {
    const f = evalExpr(c.expr);
    const [a, b] = c.domain ?? fig.x;
    for (let i = 0; i <= 200; i++) { const v = f(a + ((b - a) * i) / 200); if (Number.isFinite(v)) vals.push(v); }
  }
  for (const p of fig.points ?? []) vals.push(p.y);
  if (!vals.length) return [-1, 1];
  vals.sort((p, q) => p - q);
  let lo = vals[Math.floor(vals.length * 0.03)], hi = vals[Math.ceil(vals.length * 0.97) - 1];
  if (hi - lo < 1e-6) { lo -= 1; hi += 1; }
  const span = hi - lo, pad = span * 0.1;
  const zeroLo = lo > 0 && lo < span * 0.5, zeroHi = hi < 0 && -hi < span * 0.5;   // keep the axis when the curve starts near zero
  return [zeroLo ? 0 : lo - pad, zeroHi ? 0 : hi + pad];
}

export function drawGraph(f: GraphFigure, W = 520, H = 360): Drawing {
  const L = 52, R = 18, T = f.title ? 34 : 14, B = f.xLabel ? 50 : 36;
  const pw = W - L - R, ph = H - T - B;
  const [x0, x1] = f.x, [y0, y1] = f.y ?? autoYRange(f);
  const sx = (x: number) => L + ((x - x0) / (x1 - x0)) * pw;
  const sy = (y: number) => T + ph - ((y - y0) / (y1 - y0)) * ph;
  const prims: Prim[] = [];
  if (f.title) prims.push({ t: "text", x: W / 2, y: 20, s: f.title, size: 15, anchor: "middle", bold: true });
  const xs = niceStep(x1 - x0), ys = niceStep(y1 - y0);
  for (let g = Math.ceil(x0 / xs) * xs; g <= x1 + 1e-9; g += xs) prims.push({ t: "path", d: `M${f2(sx(g))} ${T}V${T + ph}`, stroke: GRID, w: 1 });
  for (let g = Math.ceil(y0 / ys) * ys; g <= y1 + 1e-9; g += ys) prims.push({ t: "path", d: `M${L} ${f2(sy(g))}H${L + pw}`, stroke: GRID, w: 1 });
  const ax = Math.min(Math.max(sx(0), L), L + pw), ay = Math.min(Math.max(sy(0), T), T + ph);
  prims.push({ t: "path", d: `M${L} ${f2(ay)}H${L + pw}M${f2(ax)} ${T}V${T + ph}`, stroke: INK, w: 1.6 });
  prims.push({ t: "path", d: `M${L} ${T}H${L + pw}V${T + ph}H${L}Z`, stroke: INK, w: 1, op: 0.35 });
  for (let g = Math.ceil(x0 / xs) * xs; g <= x1 + 1e-9; g += xs) if (Math.abs(g) > xs / 2 || ax <= L + 1) prims.push({ t: "text", x: sx(g), y: T + ph + 15, s: num(g), size: 11, anchor: "middle" });
  for (let g = Math.ceil(y0 / ys) * ys; g <= y1 + 1e-9; g += ys) if (Math.abs(g) > ys / 2 || ay >= T + ph - 1) prims.push({ t: "text", x: L - 6, y: sy(g) + 4, s: num(g), size: 11, anchor: "end" });
  if (f.xLabel) prims.push({ t: "text", x: L + pw / 2, y: H - 8, s: f.xLabel, size: 13, anchor: "middle" });
  if (f.yLabel) prims.push({ t: "text", x: 14, y: T + ph / 2, s: f.yLabel, size: 13, anchor: "middle", rotate: -90 });

  const curvePath = (expr: string, a: number, b: number) => {
    const fn = evalExpr(expr);
    let d = "", pen = false, lastY = NaN;
    const N = 320;
    for (let i = 0; i <= N; i++) {
      const x = a + ((b - a) * i) / N, y = fn(x);
      if (!Number.isFinite(y)) { pen = false; continue; }
      const py = sy(y);
      if (pen && Math.abs(py - lastY) > ph * 1.2) pen = false;            // asymptote jump
      d += `${pen ? "L" : "M"}${f2(sx(x))} ${f2(Math.max(-5 * H, Math.min(6 * H, py)))}`;
      pen = true; lastY = py;
    }
    return d;
  };
  if (f.shade) {
    const fn1 = evalExpr(f.shade.expr), fn2 = f.shade.expr2 ? evalExpr(f.shade.expr2) : () => 0;
    const N = 80, top: string[] = [], bot: string[] = [];
    for (let i = 0; i <= N; i++) {
      const x = f.shade.from + ((f.shade.to - f.shade.from) * i) / N;
      const a = fn1(x), b = fn2(x);
      if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
      top.push(`${f2(sx(x))} ${f2(sy(a))}`); bot.unshift(`${f2(sx(x))} ${f2(sy(b))}`);
    }
    if (top.length > 1) prims.push({ t: "path", d: `M${top.join("L")}L${bot.join("L")}Z`, fill: PALETTE[0], op: 0.22, clip: true });
  }
  for (const v of f.vlines ?? []) {
    prims.push({ t: "path", d: `M${f2(sx(v.x))} ${T}V${T + ph}`, stroke: "#6b7280", w: 1.4, dash: true });
    if (v.label) prims.push({ t: "text", x: sx(v.x) + 4, y: T + 12, s: v.label, size: 11 });
  }
  for (const h of f.hlines ?? []) {
    prims.push({ t: "path", d: `M${L} ${f2(sy(h.y))}H${L + pw}`, stroke: "#6b7280", w: 1.4, dash: true });
    if (h.label) prims.push({ t: "text", x: L + pw - 4, y: sy(h.y) - 5, s: h.label, size: 11, anchor: "end" });
  }
  f.curves.forEach((c, i) => {
    const [a, b] = c.domain ?? [x0, x1];
    prims.push({ t: "path", d: curvePath(c.expr, a, b), stroke: PALETTE[i % PALETTE.length], w: 2.6, dash: c.dashed, clip: true });
  });
  // curve labels (legend) top-left of the plot
  f.curves.forEach((c, i) => { if (c.label) prims.push({ t: "text", x: L + 10, y: T + 16 + i * 16, s: c.label, size: 12, fill: PALETTE[i % PALETTE.length], bold: true }); });
  for (const p of f.points ?? []) {
    prims.push({ t: "circle", cx: sx(p.x), cy: sy(p.y), r: 4.5, fill: INK });
    if (p.label) prims.push({ t: "text", x: sx(p.x) + 8, y: sy(p.y) - 8, s: p.label, size: 12, bold: true });
  }
  return { w: W, h: H, prims, clip: { x: L, y: T, w: pw, h: ph } };
}

export function drawChart(f: ChartFigure, W = 520, H = 340): Drawing {
  const prims: Prim[] = [];
  const title = f.title;
  if (title) prims.push({ t: "text", x: W / 2, y: 20, s: title, size: 15, anchor: "middle", bold: true });
  if (f.kind === "pie") {
    const vals = (f.series[0].values ?? []).map((v) => Math.max(0, v));
    const total = vals.reduce((a, b) => a + b, 0) || 1;
    const cx = W * 0.36, cy = H / 2 + 8, R = Math.min(W * 0.3, H * 0.38);
    let a = -Math.PI / 2;
    vals.forEach((v, i) => {
      const da = (v / total) * Math.PI * 2, b = a + da;
      const large = da > Math.PI ? 1 : 0;
      const p = (ang: number) => `${f2(cx + R * Math.cos(ang))} ${f2(cy + R * Math.sin(ang))}`;
      prims.push({ t: "path", d: vals.length === 1 ? `M${cx - R} ${cy}a${R} ${R} 0 1 0 ${2 * R} 0a${R} ${R} 0 1 0 ${-2 * R} 0Z` : `M${cx} ${cy}L${p(a)}A${R} ${R} 0 ${large} 1 ${p(b)}Z`, fill: PALETTE[i % PALETTE.length], stroke: "#fff", w: 2, op: 0.9 });
      const mid = (a + b) / 2;
      prims.push({ t: "text", x: cx + R * 0.62 * Math.cos(mid), y: cy + R * 0.62 * Math.sin(mid) + 4, s: `${Math.round((v / total) * 100)}%`, size: 12, anchor: "middle", fill: "#fff", bold: true });
      prims.push({ t: "path", d: `M${W * 0.7} ${f2(60 + i * 22)}h14v14h-14Z`, fill: PALETTE[i % PALETTE.length] });
      prims.push({ t: "text", x: W * 0.7 + 22, y: 72 + i * 22, s: f.categories?.[i] ?? `Item ${i + 1}`, size: 12 });
      a = b;
    });
    return { w: W, h: H, prims };
  }
  const L = 54, R = 16, T = title ? 36 : 16, B = 56;
  const pw = W - L - R, ph = H - T - B;
  const all = f.series.flatMap((s) => (f.kind === "scatter" ? (s.points ?? []).map((p) => p.y) : s.values ?? (s.points ?? []).map((p) => p.y)));
  const ymaxRaw = Math.max(...all, 1e-9), yminRaw = f.kind === "bar" ? Math.min(0, ...all) : Math.min(...all, 0);
  const ys = niceStep(ymaxRaw - yminRaw);
  const ymax = Math.ceil(ymaxRaw / ys) * ys, ymin = Math.floor(yminRaw / ys) * ys;
  const sy = (v: number) => T + ph - ((v - ymin) / (ymax - ymin || 1)) * ph;
  for (let g = ymin; g <= ymax + 1e-9; g += ys) {
    prims.push({ t: "path", d: `M${L} ${f2(sy(g))}H${L + pw}`, stroke: GRID, w: 1 });
    prims.push({ t: "text", x: L - 6, y: sy(g) + 4, s: num(g), size: 11, anchor: "end" });
  }
  prims.push({ t: "path", d: `M${L} ${T}V${T + ph}H${L + pw}`, stroke: INK, w: 1.6 });
  if (f.xLabel) prims.push({ t: "text", x: L + pw / 2, y: H - 8, s: f.xLabel, size: 13, anchor: "middle" });
  if (f.yLabel) prims.push({ t: "text", x: 14, y: T + ph / 2, s: f.yLabel, size: 13, anchor: "middle", rotate: -90 });
  if (f.kind === "scatter") {
    const pts = f.series.flatMap((s) => s.points ?? []);
    const xs = pts.map((p) => p.x), xmin = Math.min(...xs), xmax = Math.max(...xs);
    const xstep = niceStep(xmax - xmin || 1), x0 = Math.floor(xmin / xstep) * xstep, x1 = Math.ceil(xmax / xstep) * xstep;
    const sx = (v: number) => L + ((v - x0) / (x1 - x0 || 1)) * pw;
    for (let g = x0; g <= x1 + 1e-9; g += xstep) prims.push({ t: "text", x: sx(g), y: T + ph + 16, s: num(g), size: 11, anchor: "middle" });
    f.series.forEach((s, i) => (s.points ?? []).forEach((p) => prims.push({ t: "circle", cx: sx(p.x), cy: sy(p.y), r: 4, fill: PALETTE[i % PALETTE.length] })));
  } else {
    const n = Math.max(...f.series.map((s) => s.values?.length ?? 0), 1);
    const slot = pw / n;
    for (let k = 0; k < n; k++) prims.push({ t: "text", x: L + slot * (k + 0.5), y: T + ph + 16, s: f.categories?.[k] ?? String(k + 1), size: 11, anchor: "middle" });
    if (f.kind === "bar") {
      const bw = (slot * 0.7) / f.series.length;
      f.series.forEach((s, i) => (s.values ?? []).forEach((v, k) => {
        const x = L + slot * k + slot * 0.15 + i * bw, y = sy(Math.max(v, 0)), h = Math.abs(sy(v) - sy(0));
        prims.push({ t: "path", d: `M${f2(x)} ${f2(Math.min(sy(v), sy(0)))}h${f2(bw)}v${f2(h || 1)}h${f2(-bw)}Z`, fill: PALETTE[i % PALETTE.length], op: 0.9 });
        void y;
      }));
    } else {
      f.series.forEach((s, i) => {
        const d = (s.values ?? []).map((v, k) => `${k ? "L" : "M"}${f2(L + slot * (k + 0.5))} ${f2(sy(v))}`).join("");
        prims.push({ t: "path", d, stroke: PALETTE[i % PALETTE.length], w: 2.6 });
        (s.values ?? []).forEach((v, k) => prims.push({ t: "circle", cx: L + slot * (k + 0.5), cy: sy(v), r: 3.5, fill: PALETTE[i % PALETTE.length] }));
      });
    }
  }
  if (f.series.length > 1 || (f.series[0].name && f.kind !== "pie")) {
    f.series.forEach((s, i) => { if (s.name) prims.push({ t: "text", x: L + 10, y: T + 14 + i * 16, s: `■ ${s.name}`, size: 12, fill: PALETTE[i % PALETTE.length], bold: true }); });
  }
  return { w: W, h: H, prims };
}

export function drawDiagram(f: DiagramFigure): Drawing {
  const prims: Prim[] = [];
  const rad = (d: number) => (d * Math.PI) / 180;
  for (const e of f.elements) {
    switch (e.t) {
      case "line": {
        prims.push({ t: "path", d: `M${e.x1} ${e.y1}L${e.x2} ${e.y2}`, stroke: INK, w: 2, dash: e.dashed });
        if (e.arrow) {
          const a = Math.atan2(e.y2 - e.y1, e.x2 - e.x1), s = 10;
          prims.push({ t: "path", d: `M${f2(e.x2)} ${f2(e.y2)}L${f2(e.x2 - s * Math.cos(a - 0.4))} ${f2(e.y2 - s * Math.sin(a - 0.4))}L${f2(e.x2 - s * Math.cos(a + 0.4))} ${f2(e.y2 - s * Math.sin(a + 0.4))}Z`, fill: INK });
        }
        if (e.label) prims.push({ t: "text", x: (e.x1 + e.x2) / 2 + 6, y: (e.y1 + e.y2) / 2 - 6, s: e.label, size: 14 });
        break;
      }
      case "circle":
        prims.push({ t: "path", d: `M${e.cx - e.r} ${e.cy}a${e.r} ${e.r} 0 1 0 ${2 * e.r} 0a${e.r} ${e.r} 0 1 0 ${-2 * e.r} 0Z`, stroke: INK, w: 2, fill: e.fill });
        if (e.label) prims.push({ t: "text", x: e.cx, y: e.cy + 5, s: e.label, size: 14, anchor: "middle" });
        break;
      case "rect":
        prims.push({ t: "path", d: `M${e.x} ${e.y}h${e.w}v${e.h}h${-e.w}Z`, stroke: INK, w: 2, fill: e.fill });
        if (e.label) prims.push({ t: "text", x: e.x + e.w / 2, y: e.y + e.h / 2 + 5, s: e.label, size: 14, anchor: "middle" });
        break;
      case "poly": {
        prims.push({ t: "path", d: `M${e.points.map((p) => `${p[0]} ${p[1]}`).join("L")}Z`, stroke: INK, w: 2, fill: e.fill });
        if (e.label) {
          const cx = e.points.reduce((s, p) => s + p[0], 0) / e.points.length, cy = e.points.reduce((s, p) => s + p[1], 0) / e.points.length;
          prims.push({ t: "text", x: cx, y: cy + 5, s: e.label, size: 14, anchor: "middle" });
        }
        break;
      }
      case "text": prims.push({ t: "text", x: e.x, y: e.y, s: e.text, size: e.size ?? 14, anchor: e.anchor }); break;
      case "point":
        prims.push({ t: "circle", cx: e.x, cy: e.y, r: 4, fill: INK });
        if (e.label) prims.push({ t: "text", x: e.x + 8, y: e.y - 8, s: e.label, size: 14, bold: true });
        break;
      case "arc": {
        // angles in degrees, measured counter-clockwise from +x on screen (y points down)
        const a0 = rad(e.from), a1 = rad(e.to);
        const p = (a: number) => `${f2(e.cx + e.r * Math.cos(-a))} ${f2(e.cy + e.r * Math.sin(-a))}`;
        const sweep = ((e.to - e.from + 360) % 360) > 180 ? 1 : 0;
        prims.push({ t: "path", d: `M${p(a0)}A${e.r} ${e.r} 0 ${sweep} 0 ${p(a1)}`, stroke: INK, w: 1.6 });
        if (e.label) { const m = (a0 + a1) / 2; prims.push({ t: "text", x: e.cx + (e.r + 14) * Math.cos(-m), y: e.cy + (e.r + 14) * Math.sin(-m) + 4, s: e.label, size: 13, anchor: "middle" }); }
        break;
      }
    }
  }
  return { w: f.width, h: f.height, prims };
}

export function drawFigure(f: Figure): Drawing | null {
  switch (f.type) {
    case "graph": return drawGraph(f);
    case "chart": return drawChart(f);
    case "diagram": return drawDiagram(f);
    default: return null;
  }
}
