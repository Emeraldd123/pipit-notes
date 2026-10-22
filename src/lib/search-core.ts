// Pure search helpers (no DOM / IndexedDB) so they can be unit-tested in Node.
import { strokeSig } from "./delta.ts";
import { PAGE_H, PAGE_GAP } from "./page.ts";

type PageContent = { strokes: { id?: string; tool: string; color: string; width: number; points: { x: number; y: number }[] }[]; images: { id?: string; x: number; y: number; width: number; height: number }[] };

const pageOfY = (y: number) => Math.max(0, Math.floor(y / (PAGE_H + PAGE_GAP)));

function fnv(h: number, s: string): number {
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

/** A fingerprint of each page's ink (so unchanged pages are never re-read), and its stroke counts. */
export function pageFingerprints(note: PageContent, pageCount: number): { hash: string; strokes: number }[] {
  const h = new Array<number>(pageCount).fill(2166136261);
  const n = new Array<number>(pageCount).fill(0);
  for (const s of note.strokes) {
    if (!s.points.length) continue;
    const cy = (s.points[0].y + s.points[s.points.length - 1].y) / 2;
    const pg = Math.min(pageCount - 1, pageOfY(cy));
    n[pg]++;
    h[pg] = fnv(h[pg], strokeSig(s));
  }
  return h.map((x, i) => ({ hash: x.toString(36), strokes: n[i] }));
}


const squash = (s: string) => s.toLowerCase().replace(/[\\${}\s]+/g, "");
const words = (s: string) => (s.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => w.length > 1 || /\d/.test(w));

export function scorePage(query: string, text: string): number {
  const q = query.trim();
  if (!q) return 0;
  const hay = text.toLowerCase();
  const tokens = words(q);
  let score = 0;
  // exact phrase / expression (math-tolerant: ignores $, \, braces, spaces)
  const sq = squash(q);
  if (sq.length >= 2 && squash(text).includes(sq)) score += 6 + Math.min(6, sq.length / 4);
  if (hay.includes(q.toLowerCase())) score += 4;
  let matched = 0;
  for (const t of tokens) {
    let idx = hay.indexOf(t);
    let c = 0;
    while (idx !== -1 && c < 6) { c++; idx = hay.indexOf(t, idx + t.length); }
    if (c) { matched++; score += 1 + Math.log2(1 + c); }
  }
  if (tokens.length > 1) score += (matched / tokens.length) * 3;
  if (tokens.length && matched === 0 && score < 6) return 0;
  return score;
}

export function snippetFor(query: string, text: string, radius = 90): string {
  const hay = text.toLowerCase();
  const toks = [query.trim().toLowerCase(), ...words(query)].filter(Boolean);
  let at = -1;
  for (const t of toks) { at = hay.indexOf(t); if (at >= 0) break; }
  if (at < 0) return text.slice(0, radius * 2).replace(/\s+/g, " ");
  const a = Math.max(0, at - radius);
  const b = Math.min(text.length, at + radius);
  return (a > 0 ? "…" : "") + text.slice(a, b).replace(/\s+/g, " ") + (b < text.length ? "…" : "");
}

