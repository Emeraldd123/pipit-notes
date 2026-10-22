// Library thumbnails: a small JPEG of each note's first page, cached in IndexedDB.
// The editor refreshes its own thumbnail as you write; the library only generates
// MISSING ones (one at a time, in the background) so opening it stays fast even
// with huge notes.
import { getMeta, loadNote, setMeta } from "./db";
import { renderThumbnail } from "./export";
import { warn } from "./telemetry";

type ThumbRec = { blob: Blob; at: number };
const key = (id: string) => `thumb:${id}`;

export async function saveThumb(noteId: string, blob: Blob): Promise<void> {
  await setMeta(key(noteId), { blob, at: Date.now() } satisfies ThumbRec);
}

export async function getThumbBlob(noteId: string): Promise<Blob | null> {
  const rec = await getMeta<ThumbRec>(key(noteId));
  return rec ? rec.blob : null;
}

// Serialise generation so a library of 50 notes doesn't decode 50 notes at once.
let chain: Promise<unknown> = Promise.resolve();
const inflight = new Map<string, Promise<Blob | null>>();

/** The thumbnail blob (generated in the background if missing). Callers make their own object URL. */
export function ensureThumb(noteId: string): Promise<Blob | null> {
  const running = inflight.get(noteId);
  if (running) return running;
  const p = (chain = chain.then(async () => {
    try {
      const existing = await getThumbBlob(noteId);
      if (existing) return existing;
      const loaded = await loadNote(noteId);
      if (!loaded) return null;
      const blob = await renderThumbnail({
        title: loaded.meta.title,
        paper: loaded.meta.paper,
        pageCount: 1,
        strokes: loaded.strokes,
        images: loaded.images,
      });
      loaded.images.forEach((i) => URL.revokeObjectURL(i.data));
      if (!blob) return null;
      await saveThumb(noteId, blob);
      return blob;
    } catch (e) {
      warn("thumb", "thumbnail generation failed", { err: String((e as Error)?.message ?? e).slice(0, 120) });
      return null;
    } finally {
      inflight.delete(noteId);
    }
  })) as Promise<Blob | null>;
  inflight.set(noteId, p);
  return p;
}
