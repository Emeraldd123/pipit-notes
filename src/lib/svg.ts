// SVG export of one page: strokes become smooth vector paths (the same Catmull-Rom
// curve the canvas draws), images are embedded. Pure — the caller supplies images
// as data URLs — so it's unit-tested.
import { PAGE_H, PAGE_W, pageTop } from "./page.ts";

export type SvgStroke = { tool: string; color: string; width: number; points: { x: number; y: number; p?: number }[] };
export type SvgImage = { dataUrl: string; x: number; y: number; width: number; height: number; rotation: number; zIndex: number };

const r1 = (n: number) => Math.round(n * 10) / 10;

export function strokePath(pts: { x: number; y: number }[], dy: number): string {
  if (!pts.length) return "";
  const P = (i: number) => pts[Math.max(0, Math.min(pts.length - 1, i))];
  let d = `M${r1(pts[0].x)} ${r1(pts[0].y - dy)}`;
  if (pts.length === 1) return d + `h0.01`;
  for (let k = 0; k < pts.length - 1; k++) {
    const p0 = P(k - 1), p1 = P(k), p2 = P(k + 1), p3 = P(k + 2);
    const c1x = p1.x + (p2.x - p0.x) / 6, c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6, c2y = p2.y - (p3.y - p1.y) / 6;
    d += `C${r1(c1x)} ${r1(c1y - dy)} ${r1(c2x)} ${r1(c2y - dy)} ${r1(p2.x)} ${r1(p2.y - dy)}`;
  }
  return d;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

function widthFor(s: SvgStroke): { w: number; opacity: number; blend: boolean } {
  switch (s.tool) {
    case "highlighter": return { w: s.width * 4, opacity: 0.4, blend: true };
    case "marker": return { w: s.width * 2.2, opacity: 1, blend: false };
    case "pencil": return { w: s.width * 0.7, opacity: 0.9, blend: false };
    default: return { w: s.width, opacity: 1, blend: false };
  }
}

export function buildPageSvg(pageIdx: number, strokes: SvgStroke[], images: SvgImage[]): string {
  const top = pageTop(pageIdx);
  const bot = top + PAGE_H;
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${PAGE_W} ${PAGE_H}" width="${PAGE_W}" height="${PAGE_H}">`,
    `<rect width="${PAGE_W}" height="${PAGE_H}" fill="#fff"/>`,
  ];
  for (const im of [...images].sort((a, b) => a.zIndex - b.zIndex)) {
    if (im.y + im.height < top || im.y > bot) continue;
    const tf = im.rotation ? ` transform="rotate(${im.rotation} ${r1(im.x + im.width / 2)} ${r1(im.y + im.height / 2 - top)})"` : "";
    parts.push(`<image href="${esc(im.dataUrl)}" x="${r1(im.x)}" y="${r1(im.y - top)}" width="${r1(im.width)}" height="${r1(im.height)}"${tf}/>`);
  }
  for (const s of strokes) {
    if (!s.points.length) continue;
    const ys = s.points.map((p) => p.y);
    if (Math.max(...ys) < top || Math.min(...ys) > bot) continue;
    const { w, opacity, blend } = widthFor(s);
    parts.push(
      `<path d="${strokePath(s.points, top)}" fill="none" stroke="${esc(s.color)}" stroke-width="${r1(w)}" stroke-linecap="round" stroke-linejoin="round"` +
        `${opacity < 1 ? ` stroke-opacity="${opacity}"` : ""}${blend ? ' style="mix-blend-mode:multiply"' : ""}/>`
    );
  }
  parts.push("</svg>");
  return parts.join("\n");
}
