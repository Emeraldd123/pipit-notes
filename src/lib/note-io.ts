// Glue between the DB and the export/render layer.
import { loadNote } from "./db";
import type { ExportNote } from "./export";

/** Load a note in the shape the exporter/renderer wants. Call `release()` when done
 *  (revokes the image object URLs). */
export async function loadExportNote(id: string): Promise<{ note: ExportNote; release: () => void } | null> {
  const n = await loadNote(id);
  if (!n) return null;
  return {
    note: { title: n.meta.title, paper: n.meta.paper, pageCount: n.meta.pageCount, strokes: n.strokes, images: n.images },
    release: () => n.images.forEach((i) => URL.revokeObjectURL(i.data)),
  };
}
