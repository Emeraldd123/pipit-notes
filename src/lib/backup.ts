// Backup / restore. Local-first means the device is the source of truth, so the
// way data leaves the device has to be easy and obvious: a single .zip you can
// drop in iCloud Drive (via the share sheet) and import on any other device.
import { zip, unzipSync } from "fflate";
import { db, getMeta, setMeta } from "./db";
import { bundleFiles, readBundle, type Bundle, type BundleNote } from "./bundle-format";

const LAST_BACKUP_KEY = "lastBackupAt";
const BACKUP_NAG_MS = 7 * 24 * 60 * 60 * 1000;

export async function lastBackupAt(): Promise<number | null> {
  return (await getMeta<number>(LAST_BACKUP_KEY)) ?? null;
}
/** True if there's data worth backing up and no backup in the last week. */
export async function backupIsOverdue(): Promise<boolean> {
  const d = await db();
  if ((await d.count("notes")) === 0) return false;
  const last = await lastBackupAt();
  return !last || Date.now() - last > BACKUP_NAG_MS;
}

export async function collectBundle(noteIds?: string[]): Promise<Bundle> {
  const d = await db();
  const notebooks = await d.getAll("notebooks");
  let metas = await d.getAll("notes");
  if (noteIds) metas = metas.filter((m) => noteIds.includes(m.id));
  const notes: BundleNote[] = [];
  for (const meta of metas) {
    const [strokes, blocks, pageText, images] = await Promise.all([
      d.getAllFromIndex("strokes", "noteId", meta.id),
      d.getAllFromIndex("blocks", "noteId", meta.id),
      d.getAllFromIndex("pageText", "noteId", meta.id),
      d.getAllFromIndex("images", "noteId", meta.id),
    ]);
    strokes.sort((a, b) => a.ord - b.ord);
    notes.push({
      meta,
      strokes: strokes.map((s) => ({ id: s.id, tool: s.tool, color: s.color, width: s.width, points: s.points })),
      blocks,
      pageText,
      images: await Promise.all(
        images.map(async (i) => ({ id: i.id, x: i.x, y: i.y, width: i.width, height: i.height, rotation: i.rotation, zIndex: i.zIndex, mime: i.blob.type || "image/jpeg", bytes: new Uint8Array(await i.blob.arrayBuffer()) }))
      ),
    });
  }
  return { notebooks, notes };
}

export async function buildBackupZip(noteIds?: string[]): Promise<Uint8Array> {
  const files = bundleFiles(await collectBundle(noteIds));
  // JSON compresses well; images are already compressed, so store them as-is.
  const opts: Record<string, [Uint8Array, { level: 0 | 1 }]> = {};
  for (const [name, bytes] of Object.entries(files)) opts[name] = [bytes, { level: name.startsWith("images/") ? 0 : 1 }];
  return new Promise((resolve, reject) => zip(opts, (err, data) => (err ? reject(err) : resolve(data))));
}

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Save the backup: the iOS share sheet (→ Files / iCloud Drive) when available, else a download. */
export async function backupNow(): Promise<{ ok: boolean; how: "shared" | "downloaded" | "cancelled"; bytes: number }> {
  const bytes = await buildBackupZip();
  const name = `pipit-notes-${stamp()}.pipitnotes.zip`;
  const blob = new Blob([bytes.slice()], { type: "application/zip" });
  const file = new File([blob], name, { type: "application/zip" });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: "Pipit Notes backup" });
      await setMeta(LAST_BACKUP_KEY, Date.now());
      return { ok: true, how: "shared", bytes: bytes.length };
    } catch (e) {
      if ((e as DOMException)?.name === "AbortError") return { ok: false, how: "cancelled", bytes: bytes.length };
      // fall through to a plain download
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  await setMeta(LAST_BACKUP_KEY, Date.now());
  return { ok: true, how: "downloaded", bytes: bytes.length };
}

export type ImportReport = { notebooks: number; imported: number; skipped: number; replaced: number; errors: string[] };

/** Merge one or more backup zips into the local library. Newer-wins per note. */
export async function importBackups(files: File[], onProgress?: (msg: string) => void): Promise<ImportReport> {
  const report: ImportReport = { notebooks: 0, imported: 0, skipped: 0, replaced: 0, errors: [] };
  const d = await db();
  for (const f of files) {
    try {
      onProgress?.(`Reading ${f.name}…`);
      const raw = new Uint8Array(await f.arrayBuffer());
      const bundle = readBundle(unzipSync(raw));
      for (const nb of bundle.notebooks) {
        if (!(await d.get("notebooks", nb.id))) { await d.put("notebooks", nb); report.notebooks++; }
      }
      let i = 0;
      for (const n of bundle.notes) {
        i++;
        onProgress?.(`${f.name}: note ${i}/${bundle.notes.length} — ${n.meta.title}`);
        const existing = await d.get("notes", n.meta.id);
        if (existing && existing.updatedAt >= n.meta.updatedAt) { report.skipped++; continue; }
        if (existing) report.replaced++;
        const tx = d.transaction(["notes", "strokes", "images", "blocks", "pageText"], "readwrite");
        for (const store of ["strokes", "images", "blocks", "pageText"] as const) {
          for (const k of await tx.objectStore(store).index("noteId").getAllKeys(n.meta.id)) await tx.objectStore(store).delete(k as string);
        }
        const base = Date.now();
        n.strokes.forEach((s, idx) => tx.objectStore("strokes").put({ ...s, noteId: n.meta.id, ord: base + idx / 1000 }));
        for (const im of n.images) {
          tx.objectStore("images").put({
            id: im.id, noteId: n.meta.id, blob: new Blob([im.bytes.slice()], { type: im.mime }),
            x: im.x, y: im.y, width: im.width, height: im.height, rotation: im.rotation, zIndex: im.zIndex, createdAt: Date.now(),
          });
        }
        for (const b of n.blocks) tx.objectStore("blocks").put({ ...b, noteId: n.meta.id });
        for (const p of n.pageText) tx.objectStore("pageText").put({ ...p, noteId: n.meta.id });
        tx.objectStore("notes").put({ ...n.meta, strokeCount: n.strokes.length, imageCount: n.images.length });
        await tx.done;
        report.imported++;
      }
    } catch (e) {
      report.errors.push(`${f.name}: ${(e as Error).message}`);
    }
  }
  return report;
}
