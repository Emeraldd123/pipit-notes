// Local-first persistence. Everything lives in IndexedDB on the device — no
// server, no sync, nothing to go down. Saves are local transactions (instant and
// can't fail from the network). See lib/backup.ts for the durability story.
import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type {
  BlockRec, ImageRec, LogEntry, NoteMeta, NotePaper, NotebookRec, PageTextRec, StrokeInput, StrokeRec, VersionRec,
} from "@/types";
import { newId } from "./ids";
import { pageOfY, remapItems, type PageMapping } from "./page-ops.ts";

interface Schema extends DBSchema {
  notebooks: { key: string; value: NotebookRec };
  notes: { key: string; value: NoteMeta; indexes: { notebookId: string; updatedAt: number } };
  strokes: { key: string; value: StrokeRec; indexes: { noteId: string } };
  images: { key: string; value: ImageRec; indexes: { noteId: string } };
  blocks: { key: string; value: BlockRec; indexes: { noteId: string } };
  versions: { key: string; value: VersionRec; indexes: { noteId: string } };
  pageText: { key: string; value: PageTextRec; indexes: { noteId: string } };
  meta: { key: string; value: unknown };
  diag: { key: number; value: LogEntry };
}

const DB_NAME = "pipit-notes";
const DB_VERSION = 2;
const VERSION_KEEP = 6;
const VERSION_THROTTLE_MS = 10 * 60_000;

// The DB layer can't import the logger (the logger stores into this DB), so it
// reports lifecycle problems through an injectable hook that main.tsx wires up.
type DbEvent = { level: "info" | "warn" | "error"; msg: string; data?: Record<string, unknown> };
let onDbEvent: (e: DbEvent) => void = () => {};
export function setDbEventHandler(fn: (e: DbEvent) => void): void { onDbEvent = fn; }

let dbp: Promise<IDBPDatabase<Schema>> | null = null;
export function db(): Promise<IDBPDatabase<Schema>> {
  if (!dbp) {
    dbp = openDB<Schema>(DB_NAME, DB_VERSION, {
      upgrade(d, oldVersion) {
        // Each step is guarded by the version it was introduced in, so upgrading an
        // existing database never tries to re-create a store that's already there.
        if (oldVersion < 1) {
          d.createObjectStore("notebooks", { keyPath: "id" });
          const notes = d.createObjectStore("notes", { keyPath: "id" });
          notes.createIndex("notebookId", "notebookId");
          notes.createIndex("updatedAt", "updatedAt");
          d.createObjectStore("strokes", { keyPath: "id" }).createIndex("noteId", "noteId");
          d.createObjectStore("images", { keyPath: "id" }).createIndex("noteId", "noteId");
          d.createObjectStore("blocks", { keyPath: "id" }).createIndex("noteId", "noteId");
          d.createObjectStore("versions", { keyPath: "id" }).createIndex("noteId", "noteId");
          d.createObjectStore("pageText", { keyPath: "key" }).createIndex("noteId", "noteId");
          d.createObjectStore("meta");
        }
        if (oldVersion < 2) {
          d.createObjectStore("diag", { keyPath: "id", autoIncrement: true });
        }
      },
      blocked() { onDbEvent({ level: "warn", msg: "database upgrade blocked by another open tab" }); },
      blocking() { onDbEvent({ level: "warn", msg: "this tab is blocking a database upgrade in another tab" }); },
      terminated() { onDbEvent({ level: "error", msg: "database connection was terminated by the browser" }); dbp = null; },
    }).catch((e) => {
      dbp = null; // allow a later retry
      onDbEvent({ level: "error", msg: "database failed to open", data: { err: String((e as Error)?.message ?? e), name: (e as Error)?.name } });
      throw e;
    });
  }
  return dbp;
}

// --- meta (settings, last-backup time, …) ----------------------------------
export async function getMeta<T>(key: string): Promise<T | undefined> {
  return (await (await db()).get("meta", key)) as T | undefined;
}
export async function setMeta(key: string, value: unknown): Promise<void> {
  await (await db()).put("meta", value, key);
}

// --- notebooks ---------------------------------------------------------------
const NOTEBOOK_COLORS = ["#3d5244", "#2563eb", "#b45309", "#7c3aed", "#be185d", "#0f766e", "#b91c1c"];
export async function listNotebooks(): Promise<NotebookRec[]> {
  return (await (await db()).getAll("notebooks")).sort((a, b) => a.createdAt - b.createdAt);
}
export async function createNotebook(name: string): Promise<NotebookRec> {
  const existing = await listNotebooks();
  const rec: NotebookRec = { id: newId(), name: name.trim() || "Notebook", color: NOTEBOOK_COLORS[existing.length % NOTEBOOK_COLORS.length], createdAt: Date.now() };
  await (await db()).put("notebooks", rec);
  return rec;
}
export async function renameNotebook(id: string, name: string): Promise<void> {
  const d = await db();
  const nb = await d.get("notebooks", id);
  if (nb && name.trim()) await d.put("notebooks", { ...nb, name: name.trim() });
}
export async function deleteNotebook(id: string): Promise<void> {
  const d = await db();
  const tx = d.transaction(["notebooks", "notes"], "readwrite");
  const notes = await tx.objectStore("notes").index("notebookId").getAll(id);
  for (const n of notes) await tx.objectStore("notes").put({ ...n, notebookId: null });
  await tx.objectStore("notebooks").delete(id);
  await tx.done;
}

// --- notes ---------------------------------------------------------------------
export async function listNotes(): Promise<NoteMeta[]> {
  const all = await (await db()).getAll("notes");
  return all.sort((a, b) => Number(b.isPinned) - Number(a.isPinned) || b.updatedAt - a.updatedAt);
}
export async function getNoteMeta(id: string): Promise<NoteMeta | undefined> {
  return (await db()).get("notes", id);
}
export async function createNote(opts?: { title?: string; notebookId?: string | null; paper?: NotePaper; pageCount?: number }): Promise<NoteMeta> {
  const now = Date.now();
  const meta: NoteMeta = {
    id: newId(), title: (opts?.title ?? "").trim() || "Untitled note", notebookId: opts?.notebookId ?? null,
    paper: opts?.paper ?? "ruled", pageCount: Math.max(1, opts?.pageCount ?? 1), tags: [], isPinned: false,
    createdAt: now, updatedAt: now, strokeCount: 0, imageCount: 0,
  };
  await (await db()).put("notes", meta);
  return meta;
}
export async function patchNote(id: string, patch: Partial<NoteMeta>, touch = true): Promise<void> {
  const d = await db();
  const n = await d.get("notes", id);
  if (!n) return;
  await d.put("notes", { ...n, ...patch, updatedAt: touch ? Date.now() : n.updatedAt });
}
export async function deleteNote(id: string): Promise<void> {
  const d = await db();
  const tx = d.transaction(["notes", "strokes", "images", "blocks", "versions", "pageText"], "readwrite");
  for (const store of ["strokes", "images", "blocks", "versions", "pageText"] as const) {
    const keys = await tx.objectStore(store).index("noteId").getAllKeys(id);
    for (const k of keys) await tx.objectStore(store).delete(k as string);
  }
  await tx.objectStore("notes").delete(id);
  await tx.done;
  await d.delete("meta", `vidx:${id}`);
  await d.delete("meta", `thumb:${id}`);
}

// --- strokes ---------------------------------------------------------------------
export type StrokeUpsert = StrokeInput & { id: string };

export async function loadStrokes(noteId: string): Promise<(StrokeInput & { id: string })[]> {
  const rows = await (await db()).getAllFromIndex("strokes", "noteId", noteId);
  rows.sort((a, b) => a.ord - b.ord);
  return rows.map((r) => ({ id: r.id, tool: r.tool, color: r.color, width: r.width, points: r.points }));
}

// Apply only what changed: upsert new/edited strokes, delete removed ones — one
// transaction, so a crash mid-save can't leave a half-written note.
export async function syncStrokes(noteId: string, upserts: StrokeUpsert[], deletes: string[], totalStrokes: number): Promise<void> {
  const d = await db();
  const tx = d.transaction(["strokes", "notes"], "readwrite");
  const store = tx.objectStore("strokes");
  const base = Date.now();
  let i = 0;
  for (const s of upserts) {
    const prev = await store.get(s.id);
    const ord = prev && prev.noteId === noteId ? prev.ord : base + i++ / 1000;
    await store.put({ id: s.id, noteId, ord, tool: s.tool, color: s.color, width: s.width, points: s.points });
  }
  for (const id of deletes) {
    const prev = await store.get(id);
    if (prev && prev.noteId === noteId) await store.delete(id);
  }
  const n = await tx.objectStore("notes").get(noteId);
  if (n) await tx.objectStore("notes").put({ ...n, updatedAt: Date.now(), strokeCount: totalStrokes });
  await tx.done;
}

// --- images ----------------------------------------------------------------------
export async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  return (await fetch(dataUrl)).blob();
}
export async function addImage(
  noteId: string,
  blob: Blob,
  g: { x: number; y: number; width: number; height: number; zIndex?: number; rotation?: number }
): Promise<string> {
  const d = await db();
  const rec: ImageRec = {
    id: newId(), noteId, blob, x: g.x, y: g.y, width: g.width, height: g.height,
    rotation: g.rotation ?? 0, zIndex: g.zIndex ?? 0, createdAt: Date.now(),
  };
  const tx = d.transaction(["images", "notes"], "readwrite");
  await tx.objectStore("images").put(rec);
  const n = await tx.objectStore("notes").get(noteId);
  if (n) await tx.objectStore("notes").put({ ...n, updatedAt: Date.now(), imageCount: n.imageCount + 1 });
  await tx.done;
  return rec.id;
}
export async function updateImage(id: string, patch: Partial<Pick<ImageRec, "x" | "y" | "width" | "height" | "rotation" | "zIndex">>): Promise<void> {
  const d = await db();
  const r = await d.get("images", id);
  if (r) await d.put("images", { ...r, ...patch });
}
export async function deleteImage(id: string): Promise<void> {
  const d = await db();
  const r = await d.get("images", id);
  if (!r) return;
  const tx = d.transaction(["images", "notes"], "readwrite");
  await tx.objectStore("images").delete(id);
  const n = await tx.objectStore("notes").get(r.noteId);
  if (n) await tx.objectStore("notes").put({ ...n, imageCount: Math.max(0, n.imageCount - 1) });
  await tx.done;
}

// --- blocks (code / text / math) -----------------------------------------------
export async function loadBlocks(noteId: string): Promise<BlockRec[]> {
  return (await (await db()).getAllFromIndex("blocks", "noteId", noteId)).sort((a, b) => a.createdAt - b.createdAt);
}
export async function putBlock(b: BlockRec): Promise<void> {
  const d = await db();
  await d.put("blocks", b);
  await patchNote(b.noteId, {});
}
export async function deleteBlock(id: string): Promise<void> {
  const d = await db();
  const b = await d.get("blocks", id);
  await d.delete("blocks", id);
  if (b) await patchNote(b.noteId, {});
}

// --- a whole note, ready for the editor -------------------------------------------
export type LoadedNote = {
  meta: NoteMeta;
  strokes: (StrokeInput & { id: string })[];
  images: { id: string; data: string; x: number; y: number; width: number; height: number; rotation: number; zIndex: number }[];
  blocks: BlockRec[];
};
export async function loadNote(id: string): Promise<LoadedNote | null> {
  const d = await db();
  const meta = await d.get("notes", id);
  if (!meta) return null;
  const [strokes, imgs, blocks] = await Promise.all([loadStrokes(id), d.getAllFromIndex("images", "noteId", id), loadBlocks(id)]);
  return {
    meta,
    strokes,
    // Object URLs: the canvas loads images from `data`, and blobs stay out of JS memory.
    images: imgs.map((i) => ({
      id: i.id, data: URL.createObjectURL(i.blob), x: i.x, y: i.y, width: i.width, height: i.height, rotation: i.rotation, zIndex: i.zIndex,
    })),
    blocks,
  };
}

// --- version history --------------------------------------------------------------
// A tiny index lives in `meta` so the (frequent) "is a snapshot due?" check never
// loads the heavy snapshot records themselves.
type VersionIdx = { id: string; createdAt: number; strokeCount: number }[];
const vidxKey = (noteId: string) => `vidx:${noteId}`;
async function versionIndex(noteId: string): Promise<VersionIdx> {
  return (await getMeta<VersionIdx>(vidxKey(noteId))) ?? [];
}

export async function snapshotDue(noteId: string): Promise<boolean> {
  const idx = await versionIndex(noteId);
  return !idx[0] || Date.now() - idx[0].createdAt >= VERSION_THROTTLE_MS;
}
export async function maybeSnapshot(noteId: string, strokes: StrokeInput[], force = false): Promise<void> {
  if (strokes.length === 0) return;
  const idx = await versionIndex(noteId);
  if (!force && idx[0] && Date.now() - idx[0].createdAt < VERSION_THROTTLE_MS) return;
  const d = await db();
  const id = newId();
  await d.put("versions", {
    id, noteId, createdAt: Date.now(), strokeCount: strokes.length,
    strokes: strokes.map((s) => ({ tool: s.tool, color: s.color, width: s.width, points: s.points })),
  });
  const next: VersionIdx = [{ id, createdAt: Date.now(), strokeCount: strokes.length }, ...idx];
  for (const old of next.slice(VERSION_KEEP)) await d.delete("versions", old.id);
  await setMeta(vidxKey(noteId), next.slice(0, VERSION_KEEP));
}
export async function listVersions(noteId: string): Promise<VersionIdx> {
  return versionIndex(noteId);
}
export async function restoreVersion(versionId: string): Promise<void> {
  const d = await db();
  const v = await d.get("versions", versionId);
  if (!v) return;
  // Keep the current state recoverable before overwriting it.
  await maybeSnapshot(v.noteId, await loadStrokes(v.noteId), true);
  const tx = d.transaction(["strokes", "notes"], "readwrite");
  const store = tx.objectStore("strokes");
  for (const k of await store.index("noteId").getAllKeys(v.noteId)) await store.delete(k);
  const base = Date.now();
  let i = 0;
  for (const s of v.strokes) await store.put({ id: newId(), noteId: v.noteId, ord: base + i++ / 1000, ...s });
  const n = await tx.objectStore("notes").get(v.noteId);
  if (n) await tx.objectStore("notes").put({ ...n, updatedAt: Date.now(), strokeCount: v.strokes.length });
  await tx.done;
}

// --- page text (for search) ---------------------------------------------------------
export async function getPageTexts(noteId?: string): Promise<PageTextRec[]> {
  const d = await db();
  return noteId ? d.getAllFromIndex("pageText", "noteId", noteId) : d.getAll("pageText");
}
export async function putPageText(r: PageTextRec): Promise<void> {
  await (await db()).put("pageText", r);
}

// --- storage durability ----------------------------------------------------------------
export async function requestPersistentStorage(): Promise<{ persisted: boolean; usage?: number; quota?: number }> {
  try {
    const s = navigator.storage;
    if (!s) return { persisted: false };
    const persisted = (await s.persisted?.()) || (await s.persist?.()) || false;
    const est = await s.estimate?.();
    return { persisted, usage: est?.usage, quota: est?.quota };
  } catch {
    return { persisted: false };
  }
}

// --- page operations -----------------------------------------------------------------
/**
 * Re-order / duplicate / insert / delete pages. `mapping[n]` is the OLD page shown at new
 * position n (-1 = blank). Strokes, images, blocks and page text move with their page.
 * A version snapshot is taken first, so any page operation can be undone from history.
 */
export async function restructurePages(noteId: string, mapping: PageMapping): Promise<void> {
  const d = await db();
  const meta = await d.get("notes", noteId);
  if (!meta) return;
  await maybeSnapshot(noteId, await loadStrokes(noteId), true);
  const oldCount = meta.pageCount;
  const tx = d.transaction(["notes", "strokes", "images", "blocks", "pageText"], "readwrite");

  const strokes = await tx.objectStore("strokes").index("noteId").getAll(noteId);
  const sStore = tx.objectStore("strokes");
  for (const s of strokes) await sStore.delete(s.id);
  const outStrokes = remapItems(strokes, oldCount, mapping, (s) => pageOfY(s.points[0]?.y ?? 0, oldCount), (s, dy) => ({ ...s, points: s.points.map((p) => ({ ...p, y: p.y + dy })) }));
  for (const { item, isClone } of outStrokes) await sStore.put({ ...item, id: isClone ? newId() : item.id, ord: item.ord + (isClone ? 0.0005 : 0) });

  const images = await tx.objectStore("images").index("noteId").getAll(noteId);
  const iStore = tx.objectStore("images");
  for (const im of images) await iStore.delete(im.id);
  const outImages = remapItems(images, oldCount, mapping, (im) => pageOfY(im.y + im.height / 2, oldCount), (im, dy) => ({ ...im, y: im.y + dy }));
  for (const { item, isClone } of outImages) await iStore.put({ ...item, id: isClone ? newId() : item.id });

  const blocks = await tx.objectStore("blocks").index("noteId").getAll(noteId);
  const bStore = tx.objectStore("blocks");
  for (const b of blocks) await bStore.delete(b.id);
  const outBlocks = remapItems(blocks, oldCount, mapping, (b) => pageOfY(b.y + 20, oldCount), (b, dy) => ({ ...b, y: b.y + dy }));
  for (const { item, isClone } of outBlocks) await bStore.put({ ...item, id: isClone ? newId() : item.id });

  const texts = await tx.objectStore("pageText").index("noteId").getAll(noteId);
  const tStore = tx.objectStore("pageText");
  for (const t of texts) await tStore.delete(t.key);
  for (let n = 0; n < mapping.length; n++) {
    for (const t of texts.filter((x) => x.page === mapping[n])) await tStore.put({ ...t, page: n, key: `${noteId}:${n}:${t.source}` });
  }

  await tx.objectStore("notes").put({
    ...meta, pageCount: Math.max(1, mapping.length), updatedAt: Date.now(),
    strokeCount: outStrokes.length, imageCount: outImages.length,
  });
  await tx.done;
  await d.delete("meta", `thumb:${noteId}`);
}
