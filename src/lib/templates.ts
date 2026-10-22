// Drop-in page templates, drawn on an offscreen canvas and inserted as an image you can
// write on top of: coordinate axes, number line, unit circle, periodic table, tables.
import { CATEGORY_COLORS, SYMBOLS, categoryOf, cellOf } from "./periodic.ts";

export type TemplateId = "axes" | "numberline" | "unitcircle" | "periodic" | "table" | "formula";
export const TEMPLATES: { id: TemplateId; name: string; blurb: string }[] = [
  { id: "axes", name: "Coordinate axes", blurb: "x–y grid with labelled axes" },
  { id: "numberline", name: "Number line", blurb: "−10 to 10 with ticks" },
  { id: "unitcircle", name: "Unit circle", blurb: "angles with (cos, sin)" },
  { id: "periodic", name: "Periodic table", blurb: "colour-coded by family" },
  { id: "table", name: "Blank table", blurb: "4 × 6 grid to fill in" },
  { id: "formula", name: "Formula sheet", blurb: "6 labelled boxes" },
];

const W = 1600;
const INK = "#1f2937", FAINT = "#d1d5db";

/** First-quadrant exact values; other quadrants flip signs. */
const UNIT = [
  { deg: 0, rad: "0", cos: "1", sin: "0" }, { deg: 30, rad: "π/6", cos: "√3/2", sin: "1/2" }, { deg: 45, rad: "π/4", cos: "√2/2", sin: "√2/2" },
  { deg: 60, rad: "π/3", cos: "1/2", sin: "√3/2" }, { deg: 90, rad: "π/2", cos: "0", sin: "1" },
];
export function unitCirclePoints(): { deg: number; rad: string; x: string; y: string }[] {
  const out: { deg: number; rad: string; x: string; y: string }[] = [];
  const neg = (s: string) => (s === "0" ? "0" : "−" + s);
  const radOf = (deg: number) => {
    const g = (a: number, b: number): number => (b ? g(b, a % b) : a);
    const k = g(deg, 180);
    const n = deg / k, d = 180 / k;
    if (deg === 0) return "0";
    return `${n === 1 ? "" : n}π${d === 1 ? "" : "/" + d}`;
  };
  for (let deg = 0; deg < 360; deg += 15) {
    if (deg % 30 !== 0 && deg % 45 !== 0) continue;
    const ref = deg <= 90 ? deg : deg <= 180 ? 180 - deg : deg <= 270 ? deg - 180 : 360 - deg;
    const u = UNIT.find((q) => q.deg === ref)!;
    const x = deg > 90 && deg < 270 ? neg(u.cos) : u.cos;
    const y = deg > 180 ? neg(u.sin) : u.sin;
    out.push({ deg, rad: radOf(deg), x, y });
  }
  return out;
}

function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = INK; ctx.fillStyle = INK; ctx.lineCap = "round";
  return { c, ctx };
}
const done = (c: HTMLCanvasElement) => ({ dataUrl: c.toDataURL("image/png"), w: c.width, h: c.height });

function axes() {
  const H = 1400, { c, ctx } = canvas(W, H);
  const cx = W / 2, cy = H / 2, u = 70;
  ctx.lineWidth = 1; ctx.strokeStyle = FAINT;
  for (let x = cx % u; x < W; x += u) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = cy % u; y < H; y += u) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  ctx.strokeStyle = INK; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(W, cy); ctx.moveTo(cx, 0); ctx.lineTo(cx, H); ctx.stroke();
  ctx.font = "26px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "top";
  for (let i = -10; i <= 10; i++) if (i) { ctx.fillText(String(i), cx + i * u, cy + 8); }
  ctx.textAlign = "right"; ctx.textBaseline = "middle";
  for (let i = -9; i <= 9; i++) if (i) ctx.fillText(String(i), cx - 10, cy - i * u);
  ctx.font = "bold 34px sans-serif"; ctx.textAlign = "left"; ctx.fillText("x", W - 34, cy - 24); ctx.textAlign = "center"; ctx.fillText("y", cx + 26, 24);
  ctx.strokeStyle = INK; ctx.lineWidth = 4; ctx.strokeRect(2, 2, W - 4, H - 4);
  return done(c);
}

function numberline() {
  const H = 260, { c, ctx } = canvas(W, H);
  const y = 130, x0 = 70, x1 = W - 70, step = (x1 - x0) / 20;
  ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(30, y); ctx.lineTo(W - 30, y); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(W - 30, y); ctx.lineTo(W - 50, y - 12); ctx.moveTo(W - 30, y); ctx.lineTo(W - 50, y + 12); ctx.moveTo(30, y); ctx.lineTo(50, y - 12); ctx.moveTo(30, y); ctx.lineTo(50, y + 12); ctx.stroke();
  ctx.font = "30px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "top";
  for (let i = -10; i <= 10; i++) {
    const x = x0 + (i + 10) * step;
    ctx.lineWidth = i === 0 ? 4 : 2.5; ctx.beginPath(); ctx.moveTo(x, y - (i % 5 === 0 ? 24 : 16)); ctx.lineTo(x, y + (i % 5 === 0 ? 24 : 16)); ctx.stroke();
    ctx.fillText(i < 0 ? "−" + -i : String(i), x, y + 34);
  }
  return done(c);
}

function unitcircle() {
  const S = 1300, { c, ctx } = canvas(S, S);
  const cx = S / 2, cy = S / 2, R = 400;
  ctx.lineWidth = 1.5; ctx.strokeStyle = FAINT;
  ctx.beginPath(); ctx.moveTo(40, cy); ctx.lineTo(S - 40, cy); ctx.moveTo(cx, 40); ctx.lineTo(cx, S - 40); ctx.stroke();
  ctx.strokeStyle = INK; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
  ctx.font = "26px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  for (const p of unitCirclePoints()) {
    const a = (-p.deg * Math.PI) / 180;
    const px = cx + R * Math.cos(a), py = cy + R * Math.sin(a);
    ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(px, py, 7, 0, Math.PI * 2); ctx.fill();
    const lx = cx + (R + 95) * Math.cos(a), ly = cy + (R + 95) * Math.sin(a);
    ctx.font = "bold 26px sans-serif"; ctx.fillText(`${p.deg}° · ${p.rad}`, lx, ly - 15);
    ctx.font = "24px sans-serif"; ctx.fillText(`(${p.x}, ${p.y})`, lx, ly + 15);
  }
  return done(c);
}

function periodic() {
  const cell = 86, gap = 4, padX = 20, padY = 20;
  const Wd = 18 * cell + padX * 2, Hd = 10.4 * cell + padY * 2;
  const { c, ctx } = canvas(Wd, Math.round(Hd));
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  for (let z = 1; z <= 118; z++) {
    const { col, row } = cellOf(z);
    const x = padX + (col - 1) * cell, y = padY + (row - 1) * cell + (row >= 9 ? cell * 0.4 : 0);
    ctx.fillStyle = CATEGORY_COLORS[categoryOf(z)]; ctx.fillRect(x + gap / 2, y + gap / 2, cell - gap, cell - gap);
    ctx.strokeStyle = "#6b7280"; ctx.lineWidth = 1.5; ctx.strokeRect(x + gap / 2, y + gap / 2, cell - gap, cell - gap);
    ctx.fillStyle = INK; ctx.font = "bold 30px sans-serif"; ctx.fillText(SYMBOLS[z - 1], x + cell / 2, y + cell / 2 + 6);
    ctx.font = "15px sans-serif"; ctx.textAlign = "left"; ctx.fillText(String(z), x + 9, y + 15); ctx.textAlign = "center";
  }
  return done(c);
}

function table() {
  const rows = 6, cols = 4, rh = 150, H = rows * rh + 6, { c, ctx } = canvas(W, H);
  ctx.lineWidth = 3;
  for (let r = 0; r <= rows; r++) { ctx.beginPath(); ctx.moveTo(3, 3 + r * rh); ctx.lineTo(W - 3, 3 + r * rh); ctx.stroke(); }
  for (let k = 0; k <= cols; k++) { const x = 3 + ((W - 6) / cols) * k; ctx.beginPath(); ctx.moveTo(x, 3); ctx.lineTo(x, 3 + rows * rh); ctx.stroke(); }
  ctx.fillStyle = "rgba(37,99,235,0.1)"; ctx.fillRect(4, 4, W - 8, rh - 2);
  return done(c);
}

function formula() {
  const H = 1500, { c, ctx } = canvas(W, H);
  const cols = 2, rows = 3, gw = (W - 40 - 30 * (cols - 1)) / cols, gh = (H - 40 - 30 * (rows - 1)) / rows;
  ctx.font = "bold 30px sans-serif"; ctx.textAlign = "left"; ctx.textBaseline = "top";
  for (let r = 0; r < rows; r++) for (let k = 0; k < cols; k++) {
    const x = 20 + k * (gw + 30), y = 20 + r * (gh + 30);
    ctx.lineWidth = 3; ctx.strokeStyle = INK; ctx.beginPath(); ctx.roundRect(x, y, gw, gh, 18); ctx.stroke();
    ctx.fillStyle = "rgba(37,99,235,0.12)"; ctx.beginPath(); ctx.roundRect(x, y, gw, 64, [18, 18, 0, 0]); ctx.fill();
    ctx.fillStyle = INK; ctx.fillText(`Topic ${r * cols + k + 1}`, x + 20, y + 16);
  }
  return done(c);
}

export function renderTemplate(id: TemplateId): { dataUrl: string; w: number; h: number } {
  switch (id) {
    case "axes": return axes();
    case "numberline": return numberline();
    case "unitcircle": return unitcircle();
    case "periodic": return periodic();
    case "table": return table();
    case "formula": return formula();
  }
}
