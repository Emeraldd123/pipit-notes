// Client-side notebook export: render each note's pages to images, wrap each
// note in its own PDF, and bundle the notebook's PDFs into a ZIP for download.
//
// jsPDF (image->PDF) and fflate (zip) are dynamically imported so they only load
// when someone actually exports — they stay out of the notes bundle otherwise.
//
// NOTE: the paint primitives below MIRROR components/notes/note-canvas.tsx
// (toolStyle / catmullSeg / tracePath / page + stroke painting). Keep them in
// sync if the on-screen rendering changes, so exports look like the canvas.

export type NotePaper = "blank" | "ruled" | "grid" | "dotted";
export type ExportPoint = { x: number; y: number; p?: number };
export type ExportStroke = { tool: string; color: string; width: number; points: ExportPoint[] };
export type ExportImage = { id?: string; data: string; x: number; y: number; width: number; height: number; rotation: number; zIndex: number };
export type ExportNote = { title: string; paper: NotePaper; pageCount: number; strokes: ExportStroke[]; images: ExportImage[] };

const PAGE_W = 1240;
const PAGE_H = 1754;
const PAGE_GAP = 36;
const GRID = 40;
const EXPORT_MAX_DIM = 4000;
const pageTop = (i: number) => i * (PAGE_H + PAGE_GAP);

function toolStyle(tool: string, width: number, pressure: number): { lineWidth: number; alpha: number } {
  switch (tool) {
    case "pen": return { lineWidth: width, alpha: 1 };
    case "pencil": return { lineWidth: width * (0.4 + 0.6 * pressure), alpha: 0.9 };
    case "highlighter": return { lineWidth: width * 4, alpha: 0.4 };
    case "marker": return { lineWidth: width * 2.2, alpha: 1 };
    default: return { lineWidth: width, alpha: 1 };
  }
}
const mid = (a: ExportPoint, b: ExportPoint) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
function catmullSeg(ctx: CanvasRenderingContext2D, p0: ExportPoint, p1: ExportPoint, p2: ExportPoint, p3: ExportPoint) {
  ctx.bezierCurveTo(p1.x + (p2.x - p0.x) / 6, p1.y + (p2.y - p0.y) / 6, p2.x - (p3.x - p1.x) / 6, p2.y - (p3.y - p1.y) / 6, p2.x, p2.y);
}
function tracePath(ctx: CanvasRenderingContext2D, pts: ExportPoint[]) {
  const n = pts.length;
  ctx.moveTo(pts[0].x, pts[0].y);
  if (n === 2) { ctx.lineTo(pts[1].x, pts[1].y); return; }
  for (let i = 1; i <= n - 2; i++) { const m = mid(pts[i], pts[i + 1]); ctx.quadraticCurveTo(pts[i].x, pts[i].y, m.x, m.y); }
  ctx.lineTo(pts[n - 1].x, pts[n - 1].y);
}

function paintStroke(ctx: CanvasRenderingContext2D, s: ExportStroke) {
  const pts = s.points;
  if (pts.length === 0) return;
  ctx.save();
  ctx.strokeStyle = s.color;
  ctx.fillStyle = s.color;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (s.tool === "highlighter") {
    const { lineWidth, alpha } = toolStyle(s.tool, s.width, 0.5);
    ctx.globalCompositeOperation = "multiply";
    ctx.globalAlpha = alpha;
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    if (pts.length === 1) { ctx.arc(pts[0].x, pts[0].y, Math.max(lineWidth, 0.75) / 2, 0, Math.PI * 2); ctx.fill(); }
    else { tracePath(ctx, pts); ctx.stroke(); }
    ctx.restore();
    return;
  }
  if (pts.length === 1) {
    const { lineWidth, alpha } = toolStyle(s.tool, s.width, pts[0].p ?? 0.5);
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.arc(pts[0].x, pts[0].y, Math.max(lineWidth, 0.75) / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }
  const n = pts.length;
  for (let k = 0; k < n - 1; k++) {
    const p0 = pts[k - 1] ?? pts[k];
    const p1 = pts[k];
    const p2 = pts[k + 1];
    const p3 = pts[k + 2] ?? pts[k + 1];
    const { lineWidth, alpha } = toolStyle(s.tool, s.width, ((p1.p ?? 0.5) + (p2.p ?? 0.5)) / 2);
    ctx.globalAlpha = alpha;
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    catmullSeg(ctx, p0, p1, p2, p3);
    ctx.stroke();
  }
  ctx.restore();
}

function paintPaper(ctx: CanvasRenderingContext2D, top: number, paper: NotePaper) {
  if (paper === "blank") return;
  const bottom = top + PAGE_H;
  ctx.save();
  ctx.strokeStyle = "rgba(60,64,90,0.13)";
  ctx.fillStyle = "rgba(60,64,90,0.18)";
  ctx.lineWidth = 1;
  if (paper === "ruled") {
    for (let y = top + GRID * 2; y < bottom; y += GRID) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(PAGE_W, y); ctx.stroke(); }
  } else if (paper === "grid") {
    for (let x = GRID; x < PAGE_W; x += GRID) { ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke(); }
    for (let y = top + GRID; y < bottom; y += GRID) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(PAGE_W, y); ctx.stroke(); }
  } else {
    for (let x = GRID; x < PAGE_W; x += GRID) for (let y = top + GRID; y < bottom; y += GRID) { ctx.beginPath(); ctx.arc(x, y, 1.6, 0, Math.PI * 2); ctx.fill(); }
  }
  ctx.restore();
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error("image load failed"));
    im.src = src;
  });
}

// Render every page of a note to a JPEG data URL (for embedding in a PDF).
export type RenderOpts = {
  /** render only these page indexes (default: all) */
  pages?: number[];
  mime?: "image/jpeg" | "image/png";
  quality?: number;
  /** pixels per document unit (default 2, capped so the image stays within EXPORT_MAX_DIM) */
  scale?: number;
};
export async function renderNotePages(note: ExportNote, opts: RenderOpts = {}): Promise<{ dataUrl: string; w: number; h: number }[]> {
  const els = new Map<string, HTMLImageElement>();
  await Promise.all(
    note.images.map(async (img) => {
      try { els.set(img.id ?? img.data, await loadImage(img.data)); } catch { /* skip broken image */ }
    })
  );
  const es = Math.min(opts.scale ?? 2, EXPORT_MAX_DIM / Math.max(PAGE_W, PAGE_H));
  const w = Math.max(1, Math.round(PAGE_W * es));
  const h = Math.max(1, Math.round(PAGE_H * es));
  const imagesByZ = [...note.images].sort((a, b) => a.zIndex - b.zIndex);
  const pages: { dataUrl: string; w: number; h: number }[] = [];
  const wanted = opts.pages ?? Array.from({ length: Math.max(1, note.pageCount) }, (_, k) => k);
  for (const i of wanted) {
    const top = pageTop(i);
    const bot = top + PAGE_H;
    const out = document.createElement("canvas");
    out.width = w;
    out.height = h;
    const ctx = out.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    ctx.setTransform(es, 0, 0, es, 0, -top * es);
    ctx.beginPath();
    ctx.rect(0, top, PAGE_W, PAGE_H);
    ctx.clip();
    // page sheet + border + paper
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, top, PAGE_W, PAGE_H);
    ctx.strokeStyle = "rgba(0,0,0,0.08)";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(0, top, PAGE_W, PAGE_H);
    paintPaper(ctx, top, note.paper);
    // images intersecting this page
    for (const img of imagesByZ) {
      if (img.y + img.height < top || img.y > bot) continue;
      const el = els.get(img.id ?? img.data);
      if (!el) continue;
      ctx.save();
      if (img.rotation) {
        ctx.translate(img.x + img.width / 2, img.y + img.height / 2);
        ctx.rotate((img.rotation * Math.PI) / 180);
        ctx.drawImage(el, -img.width / 2, -img.height / 2, img.width, img.height);
      } else {
        ctx.drawImage(el, img.x, img.y, img.width, img.height);
      }
      ctx.restore();
    }
    // strokes intersecting this page
    for (const s of note.strokes) {
      let mn = Infinity, mx = -Infinity;
      for (const p of s.points) { if (p.y < mn) mn = p.y; if (p.y > mx) mx = p.y; }
      if (mx < top || mn > bot) continue;
      paintStroke(ctx, s);
    }
    pages.push({ dataUrl: out.toDataURL(opts.mime ?? "image/jpeg", opts.quality ?? 0.85), w, h });
  }
  return pages;
}

// One note -> a PDF (A4 portrait, one page image per sheet).
async function noteToPdf(note: ExportNote): Promise<Uint8Array> {
  const { jsPDF } = await import("jspdf");
  const pages = await renderNotePages(note);
  const doc = new jsPDF({ unit: "pt", format: "a4", orientation: "portrait", compress: true });
  const pw = doc.internal.pageSize.getWidth();
  const ph = doc.internal.pageSize.getHeight();
  pages.forEach((pg, i) => {
    if (i > 0) doc.addPage("a4", "portrait");
    doc.addImage(pg.dataUrl, "JPEG", 0, 0, pw, ph, undefined, "FAST");
  });
  return new Uint8Array(doc.output("arraybuffer"));
}

export function safeName(name: string, fallback: string): string {
  const cleaned = (name || "").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  return cleaned || fallback;
}

// Render a notebook's notes into per-note PDFs and zip them (bytes only).
export async function buildNotebookZip(
  notes: { id: string; note: ExportNote }[],
  onProgress?: (done: number, total: number) => void
): Promise<Uint8Array> {
  const { zip } = await import("fflate");
  const files: Record<string, Uint8Array> = {};
  const used = new Set<string>();
  for (let i = 0; i < notes.length; i++) {
    const { note } = notes[i];
    const base = safeName(note.title, `Note ${i + 1}`);
    let name = `${base}.pdf`;
    let n = 2;
    while (used.has(name.toLowerCase())) name = `${base} (${n++}).pdf`;
    used.add(name.toLowerCase());
    files[name] = await noteToPdf(note);
    onProgress?.(i + 1, notes.length);
  }
  return new Promise((resolve, reject) => {
    zip(files, { level: 0 }, (err, data) => (err ? reject(err) : resolve(data)));
  });
}

// Build the notebook ZIP and download it.
export async function downloadNotebookZip(
  notebookName: string,
  notes: { id: string; note: ExportNote }[],
  onProgress?: (done: number, total: number) => void
): Promise<void> {
  const zipped = await buildNotebookZip(notes, onProgress);
  const folder = safeName(notebookName, "Notebook");
  // Copy into a fresh ArrayBuffer-backed view so Blob gets a clean buffer.
  const blob = new Blob([zipped.slice()], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${folder}.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// --- single-note helpers --------------------------------------------------------

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
export { triggerDownload };

// Build one note's PDF bytes (exported so Share/Files flows can reuse it).
export async function buildNotePdf(note: ExportNote): Promise<Uint8Array> {
  return noteToPdf(note);
}

export async function downloadNotePdf(note: ExportNote): Promise<void> {
  const bytes = await noteToPdf(note);
  triggerDownload(new Blob([bytes.slice()], { type: "application/pdf" }), `${safeName(note.title, "Note")}.pdf`);
}

// A small JPEG of page 0 for the library grid.
export async function renderThumbnail(note: ExportNote, width = 360): Promise<Blob | null> {
  const one = { ...note, pageCount: 1 };
  const pages = await renderNotePages(one);
  const src = pages[0];
  if (!src) return null;
  const img = await loadImage(src.dataUrl);
  const scale = width / img.naturalWidth;
  const c = document.createElement("canvas");
  c.width = width;
  c.height = Math.round(img.naturalHeight * scale);
  c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
  return new Promise((res) => c.toBlob((b) => res(b), "image/jpeg", 0.8));
}
