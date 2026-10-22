// The on-disk backup/transfer format: a zip with a manifest, a library index, and
// one folder per note (note.json + its image files). Pure (no DOM / IndexedDB), so
// the browser app AND the Node migration tool share exactly the same code.
import { strToU8, strFromU8 } from "fflate";
import type { BlockRec, NoteMeta, NotebookRec, PageTextRec, StrokeInput } from "../types.ts";

export const BUNDLE_FORMAT = "pipit-notes-bundle";
export const BUNDLE_VERSION = 1;

export type BundleImage = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  zIndex: number;
  mime: string;
  bytes: Uint8Array;
};
export type BundleNote = {
  meta: NoteMeta;
  strokes: (StrokeInput & { id: string })[];
  blocks: BlockRec[];
  pageText: PageTextRec[];
  images: BundleImage[];
};
export type Bundle = { notebooks: NotebookRec[]; notes: BundleNote[] };

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };
const MIME: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" };

const json = (v: unknown) => strToU8(JSON.stringify(v));

export function bundleFiles(bundle: Bundle): Record<string, Uint8Array> {
  const files: Record<string, Uint8Array> = {};
  let strokes = 0;
  let images = 0;
  for (const n of bundle.notes) {
    strokes += n.strokes.length;
    images += n.images.length;
    const dir = `notes/${n.meta.id}`;
    files[`${dir}/note.json`] = json({
      meta: n.meta,
      strokes: n.strokes,
      blocks: n.blocks,
      pageText: n.pageText,
      images: n.images.map(({ bytes: _b, ...rest }) => ({ ...rest, file: `${n.meta.id}/${rest.id}.${EXT[rest.mime] ?? "bin"}` })),
    });
    for (const im of n.images) files[`images/${n.meta.id}/${im.id}.${EXT[im.mime] ?? "bin"}`] = im.bytes;
  }
  files["library.json"] = json({ notebooks: bundle.notebooks });
  files["manifest.json"] = json({
    format: BUNDLE_FORMAT, version: BUNDLE_VERSION, exportedAt: Date.now(),
    notebooks: bundle.notebooks.length, notes: bundle.notes.length, strokes, images,
  });
  return files;
}

export function readBundle(files: Record<string, Uint8Array>): Bundle {
  const manifestBytes = files["manifest.json"];
  if (!manifestBytes) throw new Error("Not a Pipit Notes backup (no manifest).");
  const manifest = JSON.parse(strFromU8(manifestBytes));
  if (manifest.format !== BUNDLE_FORMAT) throw new Error("Not a Pipit Notes backup.");
  if (manifest.version > BUNDLE_VERSION) throw new Error("This backup is from a newer version of Pipit Notes — update the app first.");
  const lib = files["library.json"] ? JSON.parse(strFromU8(files["library.json"])) : { notebooks: [] };
  const notes: BundleNote[] = [];
  for (const path of Object.keys(files)) {
    const m = /^notes\/([^/]+)\/note\.json$/.exec(path);
    if (!m) continue;
    const raw = JSON.parse(strFromU8(files[path]));
    const images: BundleImage[] = [];
    for (const im of raw.images ?? []) {
      const bytes = files[`images/${im.file}`];
      if (!bytes) continue; // missing file — skip that image rather than fail the note
      const ext = String(im.file).split(".").pop() ?? "";
      images.push({ id: im.id, x: im.x, y: im.y, width: im.width, height: im.height, rotation: im.rotation ?? 0, zIndex: im.zIndex ?? 0, mime: im.mime ?? MIME[ext] ?? "image/jpeg", bytes });
    }
    notes.push({ meta: raw.meta, strokes: raw.strokes ?? [], blocks: raw.blocks ?? [], pageText: raw.pageText ?? [], images });
  }
  return { notebooks: lib.notebooks ?? [], notes };
}
