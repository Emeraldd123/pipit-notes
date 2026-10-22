// Full-text search over your own notes.
//  - Typed PDF pages contribute their text layer for free at import time.
//  - Handwritten pages are read once by the model ("indexing") and the text is
//    cached locally; only pages whose ink changed are re-read.
//  - Searching is pure local string matching: instant, offline, private.
import { getPageTexts, listNotes, loadNote, putPageText } from "./db";
import { renderNotePages } from "./export";
import { pageTop } from "./page";
import { pageFingerprints, scorePage, snippetFor } from "./search-core";
import { transcribePage, type Excerpt } from "./ai";
import { count, logError, timer } from "./telemetry";
import type { NoteMeta, PageTextRec } from "@/types";

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
      const stop = timer("index.page.ms");
      const text = (await transcribePage(img.dataUrl)).trim();
      stop();
      count("index.page");
      await putPageText({ key: `${noteId}:${i}:ink`, noteId, page: i, source: "ink", text, hash: fps[i].hash, updatedAt: Date.now() });
      read++;
    }
    return { read, skipped };
  } catch (e) {
    logError("index", e, { pages: meta.pageCount });
    throw e;
  } finally {
    loaded.images.forEach((i) => URL.revokeObjectURL(i.data));
  }
}

// --- querying ---------------------------------------------------------------------

export type Hit = { noteId: string; noteTitle: string; notebookId: string | null; page: number; source: "ink" | "pdf" | "title"; score: number; snippet: string; text: string };

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
  return hits.slice(0, k).map((h, i) => ({ n: i + 1, noteTitle: h.noteTitle, page: h.page, text: h.text.slice(0, 3500), noteId: h.noteId }));
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
    out.push({ n: out.length + 1, noteTitle: title.get(t.noteId) ?? "Note", page: t.page, text: t.text, noteId: t.noteId });
  }
  return out;
}

export { pageTop, pageFingerprints, scorePage, snippetFor };
