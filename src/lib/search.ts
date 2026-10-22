// Full-text search over your own notes.
//  - Typed PDF pages contribute their text layer for free at import time.
//  - Handwritten pages are read once by the model ("indexing") and the text is
//    cached locally; only pages whose ink changed are re-read.
//  - Searching is pure local string matching: instant, offline, private.
import { getPageTexts, listNotes, loadNote, putPageText } from "./db";
import { renderNotePages } from "./export";
import { strokeSig } from "./delta";
import { PAGE_H, PAGE_GAP, pageTop } from "./page";
import { transcribePage, type Excerpt } from "./ai";
import type { NoteMeta, PageTextRec } from "@/types";

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

export type IndexProgress = { page: number; total: number; note: string };

/** Read the handwriting on a note's changed pages and cache the text. */
export async function indexNote(
  noteId: string,
  onProgress?: (p: IndexProgress) => void,
  opts: { force?: boolean; signal?: AbortSignal } = {}
): Promise<{ read: number; skipped: number }> {
  const loaded = await loadNote(noteId);
  if (!loaded) return { read: 0, skipped: 0 };
  const { meta } = loaded;
  try {
    const fps = pageFingerprints(loaded, meta.pageCount);
    const existing = new Map((await getPageTexts(noteId)).filter((p) => p.source === "ink").map((p) => [p.page, p]));
    let read = 0;
    let skipped = 0;
    for (let i = 0; i < meta.pageCount; i++) {
      if (opts.signal?.aborted) break;
      onProgress?.({ page: i, total: meta.pageCount, note: meta.title });
      if (fps[i].strokes === 0) { skipped++; continue; } // no handwriting on this page
      const prev = existing.get(i);
      if (prev && prev.hash === fps[i].hash && !opts.force) { skipped++; continue; }
      const [img] = await renderNotePages(
        { title: meta.title, paper: meta.paper, pageCount: meta.pageCount, strokes: loaded.strokes, images: loaded.images },
        { pages: [i], mime: "image/jpeg", quality: 0.8, scale: 1.4 }
      );
      const text = (await transcribePage(img.dataUrl)).trim();
      await putPageText({ key: `${noteId}:${i}:ink`, noteId, page: i, source: "ink", text, hash: fps[i].hash, updatedAt: Date.now() });
      read++;
    }
    return { read, skipped };
  } finally {
    loaded.images.forEach((i) => URL.revokeObjectURL(i.data));
  }
}

// --- querying ---------------------------------------------------------------------

export type Hit = { noteId: string; noteTitle: string; notebookId: string | null; page: number; source: "ink" | "pdf" | "title"; score: number; snippet: string; text: string };

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

export async function searchNotes(query: string, limit = 40): Promise<Hit[]> {
  const q = query.trim();
  if (!q) return [];
  const [notes, texts] = await Promise.all([listNotes(), getPageTexts()]);
  const byId = new Map<string, NoteMeta>(notes.map((n) => [n.id, n]));
  const hits: Hit[] = [];
  for (const n of notes) {
    const s = scorePage(q, n.title) * 1.5;
    if (s > 0) hits.push({ noteId: n.id, noteTitle: n.title, notebookId: n.notebookId, page: 0, source: "title", score: s, snippet: n.title, text: n.title });
  }
  for (const t of texts as PageTextRec[]) {
    const n = byId.get(t.noteId);
    if (!n || !t.text) continue;
    const s = scorePage(q, t.text);
    if (s > 0) hits.push({ noteId: n.id, noteTitle: n.title, notebookId: n.notebookId, page: t.page, source: t.source, score: s, snippet: snippetFor(q, t.text), text: t.text });
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, limit);
}

/** Best-matching pages, shaped as numbered excerpts for the model. */
export async function excerptsFor(question: string, k = 6): Promise<Excerpt[]> {
  const hits = (await searchNotes(question, 30)).filter((h) => h.source !== "title");
  return hits.slice(0, k).map((h, i) => ({ n: i + 1, noteTitle: h.noteTitle, page: h.page, text: h.text.slice(0, 3500) }));
}

/** Pages of the given notes (or all notes) as excerpts, capped by total size — for practice exams. */
export async function corpusExcerpts(noteIds: string[] | null, maxChars = 26000): Promise<Excerpt[]> {
  const [notes, texts] = await Promise.all([listNotes(), getPageTexts()]);
  const allowed = new Set(noteIds ?? notes.map((n) => n.id));
  const title = new Map(notes.map((n) => [n.id, n.title]));
  const out: Excerpt[] = [];
  let used = 0;
  for (const t of (texts as PageTextRec[]).filter((x) => allowed.has(x.noteId) && x.text.trim().length > 40).sort((a, b) => a.noteId.localeCompare(b.noteId) || a.page - b.page)) {
    if (used + t.text.length > maxChars) break;
    used += t.text.length;
    out.push({ n: out.length + 1, noteTitle: title.get(t.noteId) ?? "Note", page: t.page, text: t.text });
  }
  return out;
}

export { pageTop };
