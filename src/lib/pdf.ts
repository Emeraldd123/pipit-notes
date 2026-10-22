// Render a PDF into page images (to write on top of) and pull out each page's
// own text layer (free searchable text — no OCR needed for typed PDFs).
// pdf.js is dynamically imported so its weight only loads when a PDF is imported.

import { count, info, logError, timer, track } from "./telemetry";

const TARGET_W = 1860; // 1.5× the canvas page width: stays crisp when zoomed
const MAX_PAGES = 300;

export type RenderedPdfPage = { blob: Blob; w: number; h: number; text: string };

export async function renderPdf(file: File, onProgress?: (done: number, total: number) => void): Promise<RenderedPdfPage[]> {
  const done = timer("pdf.import.ms");
  count("pdf.import");
  try {
    const pages = await renderPdfInner(file, onProgress);
    const ms = done();
    track("pdf.pages", pages.length);
    const textless = pages.filter((p) => !p.text).length;
    if (textless) track("pdf.textlessPages", textless);
    info("pdf", "imported", { pages: pages.length, textless, bytes: file.size, ms: Math.round(ms) });
    return pages;
  } catch (e) {
    logError("pdf", e, { bytes: file.size });
    throw e;
  }
}

async function renderPdfInner(file: File, onProgress?: (done: number, total: number) => void): Promise<RenderedPdfPage[]> {
  const pdfjs = await import("pdfjs-dist");
  const worker = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = worker;

  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const total = Math.min(doc.numPages, MAX_PAGES);
  const out: RenderedPdfPage[] = [];
  for (let i = 1; i <= total; i++) {
    const page = await doc.getPage(i);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: TARGET_W / base.width });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    let text = "";
    try {
      const tc = await page.getTextContent();
      text = tc.items.map((it) => ("str" in it ? it.str : "")).join(" ").replace(/\s+/g, " ").trim();
    } catch {
      /* image-only page: no text layer */
    }
    const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("encode failed"))), "image/jpeg", 0.85));
    out.push({ blob, w: canvas.width, h: canvas.height, text });
    page.cleanup();
    onProgress?.(i, total);
  }
  await doc.destroy();
  return out;
}
