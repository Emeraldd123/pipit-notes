import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle, ArrowLeft, ArrowLeftRight, ArrowUpRight, Check, CheckCheck, Circle, Code2, Copy, Download, Eraser, FilePlus2, FileText,
  Compass, Grid3x3, Hand, Layers as LayersIcon, Share2, Highlighter, History, Layers, Ruler, Waves, Lightbulb, LineChart, ListChecks, ImagePlus, Lasso, Loader2, Maximize2, Minus, MoreHorizontal, MousePointer2, Paintbrush, Pen,
  Pencil, Printer, Redo2, Columns2, FileCode2, FlaskConical, Network, Shapes, TextCursorInput, Wand2, Scissors, ScanText, Sigma, Square, Trash, Trash2, Type, Undo2, ZoomIn, ZoomOut, Sparkles,
} from "lucide-react";
import { NoteCanvas, type CanvasImage, type NoteCanvasHandle, type Stroke, type Tool } from "@/components/note-canvas";
import { BlocksLayer, BLOCK_DEFAULTS, Latex } from "@/components/blocks";
import { DrawingAids, type Cam, type ProtractorState } from "@/components/drawing-aids";
import type { Segment } from "@/lib/guides";
import { PX_PER_CM } from "@/lib/guides";
import { findBoxes, boxToDoc } from "@/lib/search-core";
import { PAGE_H, PAGE_W, PAGE_GAP } from "@/lib/page";
import { TEMPLATES, renderTemplate, type TemplateId } from "@/lib/templates";
import { PresetsButton } from "@/components/presets";
import { shareOrDownload, useShareFlow } from "@/components/backup-flow";
import { PagesPanel } from "@/components/pages-panel";
import { ExplainPanel, HighlightLayer, ReviewBar, ReviewSetup, type ExplainState, type Highlight, type ReviewState } from "@/components/understanding";
import { Button, IconButton, Modal, Toast } from "@/components/ui";
import type { BlockKind, BlockRec, NoteMeta, NotePaper } from "@/types";
import {
  addImage, dataUrlToBlob, deleteBlock, deleteImage, deleteNote, getPageTexts, listNotes, listVersions, loadNote, maybeSnapshot, patchNote, putBlock,
  restoreVersion, restructurePages, snapshotDue, syncStrokes, updateImage, type LoadedNote,
} from "@/lib/db";
import { computeDelta, strokeSig } from "@/lib/delta";
import { newId } from "@/lib/ids";
import { saveThumb } from "@/lib/thumbs";
import { buildNotePdf, safeName, triggerDownload } from "@/lib/export";
import { loadExportNote } from "@/lib/note-io";
import { runPython } from "@/lib/py";
import { AiError, askAboutRegion, explainRegion, readChemistry, readGraphable, readWorking, recognizeMath, reviewPage, transcribeRegion, type ReadEquation, type WorkingLine } from "@/lib/ai";
import { checkEquation, formatEquation, molarMass, type BalanceReport } from "@/lib/chem";
import { verifyWorking, type StepResult } from "@/lib/stepcheck";
import { indexNote } from "@/lib/search";
import { deleteMapping, duplicateMapping, insertBlankMapping, moveMapping, type PageMapping } from "@/lib/page-ops";
import { addMistakes, putCards } from "@/lib/study-db";
import { cardFromMistake, makeCardsFromExplanation, makeCardsFromRegion } from "@/lib/study-actions";
import { plainMath } from "@/lib/plain-math";
import { mergeReview, summarize, type Issue } from "@/lib/review-core";
import { buildLatexDocument } from "@/lib/latex";
import { buildPageSvg } from "@/lib/svg";
import { relatedTo } from "@/lib/related";
import { aiReady, getSettings, updateSettings, useSettings } from "@/lib/settings";
import { timeAgo } from "@/lib/format";
import { clearDirty, markDirty } from "@/lib/health";
import { count, error as logErrorEntry, logError, recordInputSample, timer, track, warn } from "@/lib/telemetry";
import { go } from "@/router";

const COLORS = ["#111827", "#2563eb", "#dc2626", "#16a34a", "#d97706", "#7c3aed", "#0891b2", "#db2777"];
const HIGHLIGHTER_COLORS = ["#fde047", "#fca5a5", "#86efac", "#93c5fd", "#f0abfc", "#fdba74"];
const WIDTHS = [2, 4, 7, 12];
const PAPERS: { id: NotePaper; label: string }[] = [
  { id: "blank", label: "Blank" }, { id: "ruled", label: "Ruled" }, { id: "grid", label: "Grid" }, { id: "dotted", label: "Dotted" }, { id: "cornell", label: "Cornell" },
];

const TOOL_NAMES: Partial<Record<Tool, string>> = { pen: "pen", pencil: "pencil", highlighter: "highlighter", marker: "marker", line: "line", rect: "rectangle", ellipse: "ellipse", arrow: "arrow", lasso: "lasso", image: "select", snip: "snip", explain: "explain", text: "text", hand: "pan" };

type ToolDef = { id: Tool; label: string; icon: React.ReactNode };
const WRITE: ToolDef[] = [
  { id: "pen", label: "Pen", icon: <Pen size={17} /> },
  { id: "pencil", label: "Pencil", icon: <Pencil size={17} /> },
  { id: "highlighter", label: "Highlighter", icon: <Highlighter size={17} /> },
  { id: "marker", label: "Marker", icon: <Pen size={17} strokeWidth={3.5} /> },
];
const SHAPES: ToolDef[] = [
  { id: "line", label: "Line (Shift = snap)", icon: <Minus size={17} /> },
  { id: "rect", label: "Rectangle", icon: <Square size={17} /> },
  { id: "ellipse", label: "Ellipse", icon: <Circle size={17} /> },
  { id: "arrow", label: "Arrow (Shift = snap)", icon: <ArrowUpRight size={17} /> },
];
const SELECT: ToolDef[] = [
  { id: "lasso", label: "Lasso select ink", icon: <Lasso size={17} /> },
  { id: "image", label: "Select / move image", icon: <MousePointer2 size={17} /> },
  { id: "snip", label: "Snip a region onto a new page", icon: <Scissors size={17} /> },
  { id: "explain", label: "Explain: circle anything to understand it (and see where you went wrong)", icon: <Lightbulb size={17} /> },
  { id: "hand", label: "Pan", icon: <Hand size={17} /> },
];

async function compressImage(file: File, maxDim = 1800, quality = 0.85): Promise<{ data: string; w: number; h: number }> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const el = new Image(); el.onload = () => res(el); el.onerror = rej; el.src = url; });
    const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * scale), h = Math.round(img.naturalHeight * scale);
    const c = document.createElement("canvas"); c.width = w; c.height = h; c.getContext("2d")!.drawImage(img, 0, 0, w, h);
    return { data: c.toDataURL(/png/i.test(file.type) && scale === 1 ? "image/png" : "image/jpeg", quality), w, h };
  } finally { URL.revokeObjectURL(url); }
}

function printImages(urls: string[]) {
  if (!urls.length) return;
  const iframe = document.createElement("iframe");
  iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
  document.body.appendChild(iframe);
  const doc = iframe.contentWindow!.document;
  doc.open();
  const imgs = urls.map((u, i) => `<img src="${u}" style="display:block;width:100%;height:auto;${i < urls.length - 1 ? "page-break-after:always;" : ""}">`).join("");
  doc.write(
    `<style>@page{margin:0}html,body{margin:0;padding:0}img{display:block;width:100%}</style>${imgs}` +
      `<script>(function(){var imgs=document.images,left=imgs.length;if(!left){window.print();return;}` +
      `function done(){if(--left<=0){window.focus();setTimeout(function(){window.print();},60);}}` +
      `for(var i=0;i<imgs.length;i++){if(imgs[i].complete)done();else{imgs[i].onload=done;imgs[i].onerror=done;}}})();<\/script>`
  );
  doc.close();
  setTimeout(() => iframe.remove(), 60000);
}

export function EditorPage({ id, page, hl, splitWith }: { id: string; page?: number; hl?: string; splitWith?: string }) {
  const [loaded, setLoaded] = useState<LoadedNote | null | undefined>(undefined);
  const [rk, setRk] = useState(0); // bumped after page operations to reload the note from disk
  useEffect(() => {
    let alive = true;
    setLoaded(undefined);
    const stop = timer("open.ms");
    void loadNote(id)
      .then((n) => {
        const ms = stop();
        if (n) {
          count("note.open");
          void patchNote(id, { openedAt: Date.now() }, false);
          if (ms > 2500) warn("open", "slow note open", { ms: Math.round(ms), strokes: n.strokes.length, images: n.images.length, pages: n.meta.pageCount });
        } else warn("open", "note not found", {});
        if (alive) setLoaded(n);
      })
      .catch((e) => { logError("open", e); if (alive) setLoaded(null); });
    return () => { alive = false; };
  }, [id, rk]);
  // Image object URLs live exactly as long as the loaded note. (Revoking them in
  // the editor's own cleanup broke images under React StrictMode's mount/unmount/
  // mount: the simulated unmount revoked URLs the real mount then tried to load.)
  useEffect(() => () => { loaded?.images.forEach((i) => URL.revokeObjectURL(i.data)); }, [loaded]);
  if (loaded === undefined) return <div className="flex h-full items-center justify-center text-sm text-foreground-muted"><Loader2 size={16} className="mr-2 animate-spin" /> Opening…</div>;
  if (loaded === null) return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-sm">
      <p>That note doesn&apos;t exist on this device.</p>
      <Button onClick={() => go({ name: "library", notebook: null, q: "" })}>Back to notes</Button>
    </div>
  );
  return <Editor key={`${id}:${rk}`} note={loaded} startPage={page} hl={hl} splitWith={splitWith} onReload={() => setRk((k) => k + 1)} />;
}

type SaveState = "saved" | "saving" | "error";

// Which editor pane last received input — so keyboard shortcuts only act on the
// pane you're using when two notes are open side by side.
let activeEditor: string | null = null;

function Editor({ note, startPage, hl, splitWith, onReload }: { note: LoadedNote; startPage?: number; hl?: string; splitWith?: string; onReload: () => void }) {
  const noteId = note.meta.id;
  const settings = useSettings();
  const ai = aiReady(settings);

  const canvasRef = useRef<NoteCanvasHandle>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const blocksInner = useRef<HTMLDivElement>(null);
  const camRef = useRef({ scale: 1, camX: 0, camY: 0 });
  const scaleRef = useRef(1);

  const [pageCount, setPageCount] = useState(note.meta.pageCount);
  const [tool, setTool] = useState<Tool>("pen");
  const [color, setColor] = useState(COLORS[0]);
  const [hlColor, setHlColor] = useState(HIGHLIGHTER_COLORS[0]);
  const inkColor = tool === "highlighter" ? hlColor : color;
  const [width, setWidth] = useState(WIDTHS[1]);
  const [paper, setPaper] = useState<NotePaper>(note.meta.paper);
  const [title, setTitle] = useState(note.meta.title);
  const [history, setHistory] = useState({ canUndo: false, canRedo: false });
  const [zoom, setZoom] = useState(1);
  const [currentPage, setCurrentPage] = useState(0);
  const [hasSel, setHasSel] = useState(false);
  const [menu, setMenu] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [versions, setVersions] = useState<{ id: string; createdAt: number; strokeCount: number }[] | null>(null);
  const [blocks, setBlocks] = useState<BlockRec[]>(note.blocks);
  const [running, setRunning] = useState<string | null>(null);
  const [check, setCheck] = useState<{ lines: WorkingLine[]; results: StepResult[] } | null>(null);
  const [picking, setPicking] = useState<NoteMeta[] | null>(null);
  const [chem, setChem] = useState<{ eq: ReadEquation; report: BalanceReport }[] | null>(null);
  const [ruler, setRuler] = useState<Segment | null>(null);
  const [protractor, setProtractor] = useState<ProtractorState | null>(null);
  const [aidsCam, setAidsCam] = useState<Cam>({ scale: 1, camX: 0, camY: 0 });
  const aidsOn = !!(ruler || protractor);
  const aidsOnRef = useRef(false);
  aidsOnRef.current = aidsOn;
  const aidsFrame = useRef(0);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  // search hit on a PDF page: highlight where the text is
  const [findRects, setFindRects] = useState<Highlight[]>([]);
  const [findTerm, setFindTerm] = useState(hl ?? "");
  useEffect(() => {
    setFindTerm(hl ?? "");
    if (!hl || startPage == null) { setFindRects([]); return; }
    let alive = true;
    void getPageTexts(noteId).then((texts) => {
      const rec = texts.find((t) => t.page === startPage && t.source === "pdf" && t.boxes?.length);
      const img = note.images.find((i) => i.width >= PAGE_W * 0.5 && Math.floor((i.y + i.height / 2) / (PAGE_H + PAGE_GAP)) === startPage);
      if (!alive || !rec?.boxes || !img) return;
      const rects = findBoxes(hl, rec.boxes).map((b, k): Highlight => ({ id: `f${k}`, ...boxToDoc(b, img), tone: "find" }));
      if (rects.length) { setFindRects(rects); count("search.hitHighlighted"); }
    });
    return () => { alive = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hl, startPage]);
  const [pagesOpen, setPagesOpen] = useState(false);
  const [pagesRev, setPagesRev] = useState(0);
  const [explain, setExplain] = useState<ExplainState | null>(null);
  const explainRegionImg = useRef<string | null>(null);
  const [explainRect, setExplainRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [review, setReview] = useState<ReviewState | null>(null);
  const [reviewSetup, setReviewSetup] = useState(false);
  const highlightsInner = useRef<HTMLDivElement>(null);
  const [related, setRelated] = useState<{ note: { id: string; title: string }; weight: number; shared: string[] }[] | null>(null);

  // page scrubber
  const [scrub, setScrub] = useState<number | null>(null);
  const [scrubPreview, setScrubPreview] = useState<string | null>(null);
  const scrubX = useRef(0);
  const scrubPage = useRef(0);

  // Unexpected failures are logged; expected AI errors (bad key, offline) were already logged where they happen.
  const failed = (area: string, e: unknown, fallback: string) => {
    if (!(e instanceof AiError)) logError(area, e);
    flash(e instanceof AiError ? e.message : `${fallback}: ${(e as Error).message}`);
  };
  const flash = useCallback((m: string) => { setToast(m); setTimeout(() => setToast((t) => (t === m ? null : t)), 3400); }, []);

  // --- persistence: local, incremental, instant -----------------------------------
  const lastSaved = useRef<Map<string, string>>(new Map(note.strokes.map((s) => [s.id, strokeSig(s)])));
  const pending = useRef<Stroke[] | null>(null);
  const saving = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const thumbTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushRef = useRef<() => Promise<void>>(async () => {});

  const scheduleThumb = useCallback(() => {
    if (thumbTimer.current) clearTimeout(thumbTimer.current);
    thumbTimer.current = setTimeout(async () => {
      try {
        const url = canvasRef.current?.previewPage(0, 360);
        if (url) await saveThumb(noteId, await dataUrlToBlob(url));
      } catch { /* thumbnails are best-effort */ }
    }, 4000);
  }, [noteId]);

  const flush = useCallback(async () => {
    if (saving.current) return;
    const current = pending.current ?? canvasRef.current?.getStrokes();
    if (!current) return;
    const snapshot = current.slice();
    const { upserts, deletes, next } = computeDelta(snapshot, lastSaved.current);
    pending.current = null;
    if (!upserts.length && !deletes.length) { setSaveState("saved"); clearDirty(); return; }
    saving.current = true;
    setSaveState("saving");
    let failed = false;
    const stopSave = timer("save.ms");
    try {
      await syncStrokes(noteId, upserts.map((s) => ({ id: s.id!, tool: s.tool, color: s.color, width: s.width, points: s.points })), deletes, snapshot.length);
      const saveMs = stopSave();
      if (saveMs > 1000) warn("save", "slow save", { ms: Math.round(saveMs), up: upserts.length, del: deletes.length, strokes: snapshot.length });
      lastSaved.current = next;
      if (!pending.current) clearDirty(); // nothing newer waiting: this write covers everything
      setSaveState("saved");
      if (await snapshotDue(noteId)) await maybeSnapshot(noteId, snapshot);
      scheduleThumb();
    } catch (e) {
      failed = true;
      logError("save", e, { up: upserts.length, del: deletes.length, strokes: snapshot.length });
      if ((e as DOMException)?.name === "QuotaExceededError") {
        logErrorEntry("storage", "storage quota exceeded while saving", {});
        flash("This device is out of storage — back up your notes and free some space. Your latest ink is still on screen.");
      }
      pending.current = snapshot;
      setSaveState("error");
      setTimeout(() => void flushRef.current(), 2500);
    } finally {
      saving.current = false;
      if (!failed && pending.current) saveTimer.current = setTimeout(() => void flushRef.current(), 60);
    }
  }, [noteId, scheduleThumb]);
  useEffect(() => { flushRef.current = flush; }, [flush]);

  const onCommit = useCallback((strokes: Stroke[]) => {
    pending.current = strokes;
    markDirty(noteId); // cleared once the write lands — if the app dies first, the next launch notices
    setSaveState("saving");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void flushRef.current(), 350);
  }, [noteId]);

  useEffect(() => {
    const onHide = () => { if (document.visibilityState === "hidden" || document.visibilityState === undefined) void flushRef.current(); };
    const onPageHide = () => void flushRef.current();
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onPageHide);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      void flushRef.current(); // leaving the note: write whatever is pending
      // Opt-in: keep search fresh by reading the pages you changed.
      const st = getSettings();
      if (st.autoIndex && aiReady(st)) void flushRef.current().then(() => indexNote(noteId)).catch(() => undefined);
    };
  }, [noteId]);

  // open at a specific page (from a search result)
  useEffect(() => {
    if (startPage == null) return;
    const t = setTimeout(() => canvasRef.current?.goToPage(startPage), 350);
    return () => clearTimeout(t);
  }, [startPage]);

  // lock page scroll — it's a full-screen canvas
  useEffect(() => {
    const h = document.documentElement.style.overflow, b = document.body.style.overflow;
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    return () => { document.documentElement.style.overflow = h; document.body.style.overflow = b; };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (activeEditor !== null && activeEditor !== noteId) return;
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT") return;
      const mod = e.metaKey || e.ctrlKey;
      if (!mod && !e.altKey && e.key.toLowerCase() === "e") { e.preventDefault(); swapEraser(); return; }
      if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); if (e.shiftKey) canvasRef.current?.redo(); else canvasRef.current?.undo(); }
      else if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); canvasRef.current?.redo(); }
      else if ((e.key === "Delete" || e.key === "Backspace") && canvasRef.current?.hasSelection()) { e.preventDefault(); canvasRef.current?.deleteSelection(); }
      else if (mod && e.key.toLowerCase() === "d" && canvasRef.current?.hasSelection()) { e.preventDefault(); canvasRef.current?.duplicateSelection(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [noteId]);

  useEffect(() => { count(`tool.${tool}`); }, [tool]);

  // Quick eraser <-> last-used-tool swap (the on-screen version of Pencil double-tap, which
  // Safari can't see). `lastTool` is whatever you were drawing with before the eraser.
  const lastTool = useRef<Tool>("pen");
  useEffect(() => { if (tool !== "eraser" && tool !== "block") lastTool.current = tool; }, [tool]);
  const swapEraser = useCallback(() => {
    setTool((t) => (t === "eraser" ? lastTool.current : "eraser"));
    count("tool.swapEraser");
  }, []);

  // --- camera → blocks overlay (direct DOM, no React state per frame) ------------------
  const onCameraChange = useCallback((c: { scale: number; camX: number; camY: number }) => {
    camRef.current = c;
    scaleRef.current = c.scale;
    const el = blocksInner.current;
    const t = `scale(${c.scale}) translate(${-c.camX}px, ${-c.camY}px)`;
    if (el) el.style.transform = t;
    if (highlightsInner.current) highlightsInner.current.style.transform = t;
    if (aidsOnRef.current && !aidsFrame.current) aidsFrame.current = requestAnimationFrame(() => { aidsFrame.current = 0; setAidsCam({ ...camRef.current }); });
  }, []);

  // --- blocks -------------------------------------------------------------------------------
  const blockTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const onBlockChange = useCallback((b: BlockRec) => {
    setBlocks((prev) => prev.map((x) => (x.id === b.id ? b : x)));
    const t = blockTimers.current.get(b.id);
    if (t) clearTimeout(t);
    blockTimers.current.set(b.id, setTimeout(() => { void putBlock(b); blockTimers.current.delete(b.id); }, 400));
  }, []);
  const onBlockDelete = useCallback((bid: string) => {
    setBlocks((prev) => prev.filter((x) => x.id !== bid));
    const t = blockTimers.current.get(bid);
    if (t) clearTimeout(t);
    void deleteBlock(bid);
  }, []);

  function viewportCenter() {
    const el = stageRef.current;
    const { scale, camX, camY } = camRef.current;
    const w = (el?.clientWidth ?? 800) / scale, h = (el?.clientHeight ?? 600) / scale;
    return { x: camX + w / 2, y: camY + h / 2 };
  }
  const addBlock = useCallback((kind: BlockKind, at?: { x: number; y: number }, text = "") => {
    const d = BLOCK_DEFAULTS[kind];
    const c = at ?? (() => { const v = viewportCenter(); return { x: v.x - d.width / 2, y: v.y - d.height / 2 }; })();
    const b: BlockRec = { id: newId(), noteId, kind, x: Math.max(0, c.x), y: Math.max(0, c.y), width: d.width, height: d.height, text, lang: kind === "code" ? "python" : undefined, createdAt: Date.now() };
    setBlocks((prev) => [...prev, b]);
    void putBlock(b);
    return b;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId]);

  const onRunBlock = useCallback(async (b: BlockRec) => {
    setRunning(b.id);
    try {
      const r = await runPython(b.text, (m) => setBusy(m));
      const next: BlockRec = { ...b, output: [r.text, r.error].filter(Boolean).join(r.text && r.error ? "\n" : ""), images: r.images };
      setBlocks((prev) => prev.map((x) => (x.id === b.id ? { ...x, output: next.output, images: next.images } : x)));
      void putBlock({ ...(blocksRef.current.find((x) => x.id === b.id) ?? b), output: next.output, images: next.images });
    } catch (e) {
      logError("python", e, { stage: "run-block" });
      flash("Couldn't start Python: " + (e as Error).message + " (it needs a connection the first time).");
    } finally {
      setRunning(null);
      setBusy(null);
    }
  }, [flash]);
  const blocksRef = useRef(blocks);
  useEffect(() => { blocksRef.current = blocks; }, [blocks]);

  // --- page ops -------------------------------------------------------------------------------
  const setPages = useCallback((n: number) => { setPageCount(n); void patchNote(noteId, { pageCount: n }); }, [noteId]);
  const addPage = () => setPages(pageCount + 1);
  function deleteCurrentPage() {
    if (pageCount <= 1) return flash("A note needs at least one page.");
    if (!confirm(`Delete page ${currentPage + 1}? Anything on it is removed (undo brings ink back).`)) return;
    canvasRef.current?.deletePageContent(currentPage);
    const n = pageCount - 1;
    setPages(n);
    setCurrentPage((p) => Math.min(p, n - 1));
  }
  function onSnipRegion(dataUrl: string, w: number, h: number) {
    const n = pageCount + 1;
    setPages(n);
    canvasRef.current?.insertImage(dataUrl, w, h, n - 1);
    setTool("image");
    flash("Snipped to a new page — write below it.");
  }

  // scrubber
  function previewScrub(p: number) { setScrub(p); try { setScrubPreview(canvasRef.current?.previewPage(p) ?? null); } catch { setScrubPreview(null); } }
  const onScrubDown = (e: React.PointerEvent) => {
    if (pageCount <= 1) return;
    e.preventDefault();
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* */ }
    scrubX.current = e.clientX; scrubPage.current = currentPage; previewScrub(currentPage);
  };
  const onScrubMove = (e: React.PointerEvent) => {
    if (scrub === null) return;
    const t = Math.max(0, Math.min(pageCount - 1, scrubPage.current + Math.round((e.clientX - scrubX.current) / 22)));
    if (t !== scrub) previewScrub(t);
  };
  const onScrubUp = (e: React.PointerEvent) => {
    if (scrub === null) return;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* */ }
    const t = scrub; setScrub(null); setScrubPreview(null); canvasRef.current?.goToPage(t);
  };

  // --- images ---------------------------------------------------------------------------------------
  const persistImageAdd = useCallback(async (img: { data: string; x: number; y: number; width: number; height: number }) => {
    return addImage(noteId, await dataUrlToBlob(img.data), { x: img.x, y: img.y, width: img.width, height: img.height });
  }, [noteId]);
  async function onPickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; e.target.value = ""; if (!file) return;
    const { data, w, h } = await compressImage(file);
    canvasRef.current?.insertImage(data, w, h);
    setTool("image");
  }

  // --- title / paper -------------------------------------------------------------------------------
  const commitTitle = () => { const t = title.trim(); if (!t) return setTitle(note.meta.title); void patchNote(noteId, { title: t }); };
  const changePaper = (p: NotePaper) => { setPaper(p); void patchNote(noteId, { paper: p }); };

  // --- export ----------------------------------------------------------------------------------------
  // Share the note as a read-only PDF (share sheet → AirDrop / Messages / Files). Two steps so Safari allows the share.
  const sharePdf = useShareFlow({
    build: async () => {
      count("share.pdf");
      await flush();
      const l = await loadExportNote(noteId);
      if (!l) throw new Error("note not found");
      try { return new File([(await buildNotePdf(l.note)).slice()], `${safeName(title, "Note")}.pdf`, { type: "application/pdf" }); } finally { l.release(); }
    },
    save: (f) => shareOrDownload(f, title),
    title: "PDF ready to share",
    hint: "Tap Save, then pick AirDrop, Messages, Mail or Save to Files. They get a read-only PDF.",
    doneShared: "Shared.",
    doneDownloaded: "PDF downloaded.",
    failed: "Couldn't build the PDF",
  }, (m) => flash(m));
  useEffect(() => { if (sharePdf.building) setBusy("Building PDF…"); else setBusy((b) => (b === "Building PDF…" ? null : b)); }, [sharePdf.building]);
  async function exportPdf() {
    setMenu(false); setBusy("Building PDF…");
    count("export.pdf");
    const stop = timer("export.pdf.ms");
    try {
      await flush();
      const l = await loadExportNote(noteId);
      if (!l) return;
      const bytes = await buildNotePdf(l.note);
      l.release();
      triggerDownload(new Blob([bytes.slice()], { type: "application/pdf" }), `${safeName(title, "Note")}.pdf`);
      stop();
    } catch (e) { failed("export", e, "PDF export failed"); } finally { setBusy(null); }
  }
  function exportPng() {
    setMenu(false);
    count("export.png");
    const url = canvasRef.current?.exportPng();
    if (url) { const a = document.createElement("a"); a.href = url; a.download = `${safeName(title, "Note")}.png`; document.body.appendChild(a); a.click(); a.remove(); }
  }
  function doPrint() { setMenu(false); count("export.print"); printImages(canvasRef.current?.exportPages() ?? []); }
  async function openHistory() { setMenu(false); setVersions(await listVersions(noteId)); }
  async function onRestore(vid: string) {
    if (!confirm("Restore this version? Your current ink is saved as a version first, so you can come back.")) return;
    await flush();
    await restoreVersion(vid);
    location.reload();
  }
  async function onDeleteNote() {
    setMenu(false);
    if (!confirm(`Delete "${title}"? This can't be undone — back up first if unsure.`)) return;
    await deleteNote(noteId);
    go({ name: "library", notebook: null, q: "" });
  }

  async function blobUrlToDataUrl(url: string): Promise<string> {
    const blob = await (await fetch(url)).blob();
    return new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.onerror = rej; fr.readAsDataURL(blob); });
  }
  async function exportSvg() {
    setMenu(false); setBusy("Building SVG…");
    count("export.svg");
    try {
      await flush();
      const l = await loadExportNote(noteId);
      if (!l) return;
      const imgs = await Promise.all(l.note.images.map(async (i) => ({ dataUrl: await blobUrlToDataUrl(i.data), x: i.x, y: i.y, width: i.width, height: i.height, rotation: i.rotation, zIndex: i.zIndex })));
      const svg = buildPageSvg(currentPage, l.note.strokes, imgs);
      l.release();
      triggerDownload(new Blob([svg], { type: "image/svg+xml" }), `${safeName(title, "Note")}-page-${currentPage + 1}.svg`);
    } catch (e) { failed("export", e, "SVG export failed"); } finally { setBusy(null); }
  }
  async function exportLatex() {
    setMenu(false);
    if (!ai) return flash("LaTeX export reads your handwriting with AI — turn it on in Settings first.");
    setBusy("Reading your handwriting…");
    try {
      await flush();
      await indexNote(noteId, (p) => setBusy(`Reading page ${p.page + 1}/${p.total}…`));
      const texts = await getPageTexts(noteId);
      const pages = Array.from({ length: pageCount }, (_, i) => {
        const ink = texts.find((t) => t.page === i && t.source === "ink")?.text;
        const pdf = texts.find((t) => t.page === i && t.source === "pdf")?.text;
        return { page: i, text: ink || pdf || "" };
      });
      triggerDownload(new Blob([buildLatexDocument(title, pages)], { type: "application/x-tex" }), `${safeName(title, "Note")}.tex`);
      flash("LaTeX exported — compile with pdflatex or paste into Overleaf.");
    } catch (e) { failed("ai", e, "LaTeX export failed"); } finally { setBusy(null); }
  }
  async function showRelated() {
    setMenu(false);
    const [all, texts] = await Promise.all([listNotes(), getPageTexts()]);
    const rel = relatedTo(noteId, all.map((n) => ({ id: n.id, title: n.title, notebookId: n.notebookId, pages: n.pageCount })), texts.map((t) => ({ noteId: t.noteId, text: t.text })), 8, 0.05);
    setRelated(rel.map((r) => ({ note: { id: r.note.id, title: r.note.title }, weight: r.weight, shared: r.shared })));
  }

  // --- AI: read this note for search --------------------------------------------------------------
  async function indexThisNote() {
    setMenu(false);
    if (!ai) return flash("Turn on AI in Settings (and add your API key) to index handwriting for search.");
    setBusy("Reading your handwriting…");
    try {
      await flush();
      const r = await indexNote(noteId, (p) => setBusy(`Reading page ${p.page + 1}/${p.total}…`));
      flash(r.read ? `Indexed ${r.read} page${r.read === 1 ? "" : "s"} for search.` : "Search is already up to date for this note.");
    } catch (e) { failed("ai", e, "Indexing failed"); } finally { setBusy(null); }
  }

  // --- AI: recognise maths / check working on the selection ----------------------------------
  async function recognizeSelection() {
    if (!ai) return flash("Turn on AI in Settings to recognise handwriting.");
    const sel = canvasRef.current?.selectionImage();
    if (!sel) return flash("Select some handwriting with the lasso first.");
    setBusy("Reading maths…");
    try {
      const latex = await recognizeMath(sel.dataUrl);
      addBlock("math", { x: sel.bbox.x, y: sel.bbox.y + sel.bbox.h + 28 }, latex);
      flash("Recognised — edit the LaTeX if anything's off.");
    } catch (e) { failed("ai", e, "Couldn't recognise that"); } finally { setBusy(null); }
  }
  async function convertSelectionToText() {
    if (!ai) return flash("Turn on AI in Settings to convert handwriting.");
    const sel = canvasRef.current?.selectionImage();
    if (!sel) return flash("Select some handwriting with the lasso first.");
    setBusy("Reading handwriting…");
    try {
      const t = await transcribeRegion(sel.dataUrl);
      if (!t) return flash("I couldn't read any text there.");
      addBlock("text", { x: sel.bbox.x, y: sel.bbox.y + sel.bbox.h + 28 }, t);
      flash("Added as a text block below your handwriting.");
    } catch (e) { failed("ai", e, "Couldn't convert that"); } finally { setBusy(null); }
  }
  async function checkChemistry() {
    if (!ai) return flash("Turn on AI in Settings to read equations.");
    const sel = canvasRef.current?.selectionImage();
    if (!sel) return flash("Lasso the equation(s) you want checked.");
    setBusy("Reading the equation…");
    try {
      const eqs = await readChemistry(sel.dataUrl);
      if (!eqs.length) return flash("I couldn't find a chemical equation in that selection.");
      const checked = eqs.map((eq) => ({ eq, report: checkEquation(eq) }));
      track("chem.equations", checked.length);
      track("chem.formulaErrors", checked.reduce((a, c) => a + c.report.errors.length, 0));
      setChem(checked);
    } catch (e) { failed("ai", e, "Couldn't check that"); } finally { setBusy(null); }
  }
  async function checkSelection() {
    if (!ai) return flash("Turn on AI in Settings to check working.");
    const sel = canvasRef.current?.selectionImage();
    if (!sel) return flash("Lasso the lines of working you want checked.");
    setBusy("Reading your working…");
    try {
      const lines = await readWorking(sel.dataUrl);
      if (lines.filter((l) => l.kind !== "text").length < 2) { flash("I need at least two lines of working to check."); return; }
      setBusy("Verifying each step (SymPy)…");
      const results = await verifyWorking(lines, (m) => setBusy(m));
      setCheck({ lines, results });
    } catch (e) { failed("ai", e, "Couldn't check that"); } finally { setBusy(null); }
  }

  // --- page operations: reorder / duplicate / insert / delete from the pages panel ---------------
  async function applyPageOp(mapping: PageMapping, doneMsg: string) {
    setBusy("Updating pages…");
    try {
      for (let i = 0; i < 30 && (pending.current || saving.current); i++) { await flushRef.current(); await new Promise((r) => setTimeout(r, 60)); }
      await flushRef.current();
      for (const [bid, t] of blockTimers.current) { clearTimeout(t); const b = blocks.find((x) => x.id === bid); if (b) await putBlock(b); }
      blockTimers.current.clear();
      await restructurePages(noteId, mapping);
      count("pages.op");
      onReload();
      sessionStorage.setItem("pipit.pagesToast", doneMsg);
    } catch (e) { failed("pages", e, "Couldn't change the pages"); setBusy(null); }
  }
  useEffect(() => {
    const m = sessionStorage.getItem("pipit.pagesToast");
    if (m) { sessionStorage.removeItem("pipit.pagesToast"); flash(m); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- study hooks: flashcards, pinned explanations ------------------------------------------------------------------
  const pageOfRect = (y: number) => Math.max(0, Math.min(pageCount - 1, Math.floor(y / (PAGE_H + PAGE_GAP))));
  async function cardsFromSelection() {
    if (!ai) return flash("Turn on AI in Settings to make flashcards.");
    const sel = canvasRef.current?.selectionImage();
    if (!sel) return flash("Select some handwriting with the lasso first.");
    setBusy("Writing flashcards…");
    try {
      const n = await makeCardsFromRegion(sel.dataUrl, { notebookId: note.meta.notebookId, noteId, page: pageOfRect(sel.bbox.y) });
      flash(n ? `Added ${n} flashcard${n === 1 ? "" : "s"} — find them in Study.` : "No new flashcards from that (you may already have them).");
    } catch (e) { failed("ai", e, "Couldn't make flashcards"); } finally { setBusy(null); }
  }
  function pinExplanation() {
    const d = explain?.data;
    if (!d || !explainRect) return;
    const lines = [d.concept.toUpperCase(), plainMath(d.explanation)];
    if (d.shortfalls.length) lines.push("", "Where I went wrong:", ...d.shortfalls.map((s) => `• ${plainMath(s.what)}${s.fix ? ` → ${plainMath(s.fix)}` : ""}`));
    for (const t of explain!.turns) lines.push("", `${t.role === "user" ? "Q: " : "A: "}${plainMath(t.content)}`);
    addBlock("text", { x: Math.max(20, explainRect.x), y: explainRect.y + explainRect.h + 24 }, lines.join("\n"));
    count("explain.pinned");
    flash("Pinned below what you circled — edit or move it like any text block.");
  }
  async function explanationToCards() {
    const d = explain?.data;
    if (!d || !explainRect) return;
    if (!ai) return flash("Turn on AI in Settings to make flashcards.");
    setBusy("Writing flashcards…");
    try {
      const body = [d.explanation, ...d.shortfalls.map((s) => `${s.what} ${s.fix}`)].join("\n");
      const n = await makeCardsFromExplanation(d.concept, body, { notebookId: note.meta.notebookId, noteId, page: pageOfRect(explainRect.y) });
      flash(n ? `Added ${n} flashcard${n === 1 ? "" : "s"} — find them in Study.` : "You already have cards like these.");
    } catch (e) { failed("ai", e, "Couldn't make flashcards"); } finally { setBusy(null); }
  }
  async function issueToCard(i: Issue) {
    try {
      await putCards([cardFromMistake({ read: i.read, problem: i.problem, fix: i.fix, why: i.why, noteId, page: i.page, kind: i.kind }, note.meta.notebookId)]);
      count("review.card");
      flash("Flashcard added to Study.");
    } catch (e) { failed("study", e, "Couldn't add the flashcard"); }
  }

  // --- graph it: read handwritten equations, drop a graph block beside them ---------------------
  async function graphSelection() {
    if (!ai) return flash("Turn on AI in Settings to read handwritten equations.");
    const sel = canvasRef.current?.selectionImage();
    if (!sel) return flash("Lasso the equation(s) you want graphed.");
    setBusy("Reading the equation…");
    try {
      const eqs = await readGraphable(sel.dataUrl);
      if (!eqs.length) return flash("I couldn't find an equation to graph there.");
      count("graph.fromInk");
      addBlock("graph", { x: sel.bbox.x, y: sel.bbox.y + sel.bbox.h + 28 }, eqs.join("\n"));
      flash("Graphed — edit the equations in the block if I misread anything.");
    } catch (e) { failed("ai", e, "Couldn't graph that"); } finally { setBusy(null); }
  }

  // --- explain: circle a concept -> explanation + where understanding fell short + follow-ups ----
  async function explainRegionNow(dataUrl: string, bbox: { x: number; y: number; w: number; h: number }) {
    if (!ai) return flash("Turn on AI in Settings (and add your API key) to use Explain.");
    explainRegionImg.current = dataUrl;
    setExplainRect(bbox);
    setReview(null);
    setExplain({ status: "loading", turns: [], asking: false });
    try {
      const data = await explainRegion(dataUrl);
      setExplain((s) => (s && explainRegionImg.current === dataUrl ? { ...s, status: "done", data } : s));
    } catch (e) {
      if (!(e instanceof AiError)) logError("ai", e);
      setExplain((s) => (s && explainRegionImg.current === dataUrl ? { ...s, status: "error", error: e instanceof AiError ? e.message : "Couldn't explain that — try circling again." } : s));
    }
  }
  function explainSelection() {
    const sel = canvasRef.current?.selectionImage();
    if (!sel) return flash("Select some handwriting with the lasso first.");
    void explainRegionNow(sel.dataUrl, sel.bbox);
  }
  async function askFollowUp(q: string) {
    const img = explainRegionImg.current;
    if (!img || !explain?.data) return;
    const base = [{ role: "assistant" as const, content: `${explain.data.concept}: ${explain.data.explanation}` }, ...explain.turns];
    setExplain((s) => (s ? { ...s, asking: true, turns: [...s.turns, { role: "user", content: q }] } : s));
    try {
      const a = await askAboutRegion(img, base, q);
      setExplain((s) => (s ? { ...s, asking: false, turns: [...s.turns, { role: "assistant", content: a }] } : s));
    } catch (e) {
      setExplain((s) => (s ? { ...s, asking: false, turns: [...s.turns, { role: "assistant", content: e instanceof AiError ? e.message : "Sorry — that didn't work. Try again." }] } : s));
    }
  }
  const closeExplain = () => { setExplain(null); setExplainRect(null); explainRegionImg.current = null; };

  // --- review: find every mistake on chosen pages, then step through them top to bottom -----------
  async function runReview(pages: number[]) {
    setReviewSetup(false);
    if (!ai) return flash("Turn on AI in Settings (and add your API key) to review for mistakes.");
    closeExplain();
    await flush();
    const results: { page: number; issues: Issue[] }[] = [];
    const failedPages: number[] = [];
    let fatal: unknown = null;
    count("review.run");
    for (let k = 0; k < pages.length; k++) {
      const p = pages[k];
      setBusy(`Reviewing page ${p + 1} (${k + 1}/${pages.length})…`);
      try {
        const img = canvasRef.current?.previewPage(p, 1500);
        if (!img) throw new Error("page image unavailable");
        results.push({ page: p, issues: await reviewPage(img, p) });
      } catch (e) {
        failedPages.push(p);
        if (e instanceof AiError && /key|offline|Rate limited/i.test(e.message)) { fatal = e; break; }
        if (!(e instanceof AiError)) logError("review", e);
      }
    }
    setBusy(null);
    if (fatal && !results.length) return failed("ai", fatal, "Couldn't review");
    const issues = mergeReview(results);
    count(issues.length ? "review.found" : "review.clean");
    if (!issues.length) {
      flash(failedPages.length ? `Couldn't review page${failedPages.length === 1 ? "" : "s"} ${failedPages.map((x) => x + 1).join(", ")} — try again.` : `No mistakes found on ${pages.length} page${pages.length === 1 ? "" : "s"}.`);
      return;
    }
    flash(`${summarize(issues)} — saved to your mistake log`);
    void addMistakes(issues.map((x) => ({ noteId, page: x.page, kind: x.kind, read: x.read, problem: x.problem, why: x.why, fix: x.fix }))).catch((e) => logError("study", e));
    setReview({ issues, i: 0, fixed: new Set(), failedPages });
    setTool("hand");
  }
  const goIssue = (i: number) => setReview((r) => (r ? { ...r, i: Math.max(0, Math.min(r.issues.length - 1, i)) } : r));
  const issueId = review?.issues[review.i]?.id;
  useEffect(() => {
    const it = review?.issues.find((x) => x.id === issueId);
    if (it) canvasRef.current?.focusRect(it.rect, { bottomInset: Math.round(window.innerHeight * 0.4) });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issueId]);
  const dismissIssue = (id: string) => setReview((r) => {
    if (!r) return r;
    const issues = r.issues.filter((x) => x.id !== id);
    return { ...r, issues, i: Math.min(r.i, Math.max(0, issues.length - 1)) };
  });
  const toggleFixed = (id: string) => setReview((r) => {
    if (!r) return r;
    const fixed = new Set(r.fixed);
    if (fixed.has(id)) fixed.delete(id); else fixed.add(id);
    return { ...r, fixed };
  });
  const highlights: Highlight[] = [
    ...(review ? review.issues.map((x, n): Highlight => ({ id: x.id, ...x.rect, tone: n === review.i ? "active" : "issue", label: n === review.i ? String(n + 1) : undefined })).filter((h) => !review.fixed.has(h.id) || h.tone === "active") : []),
    ...findRects,
    ...(explainRect && explain ? [{ id: "explain", ...explainRect, tone: "explain" as const }] : []),
  ];

  function insertTemplate(id: TemplateId) {
    setTemplatesOpen(false);
    try {
      const r = renderTemplate(id);
      canvasRef.current?.insertImage(r.dataUrl, r.w, r.h, currentPage);
      setTool("image");
      count(`template.${id}`);
      flash("Inserted — drag to move, or start writing on it.");
    } catch (e) { failed("template", e, "Couldn't insert that template"); }
  }

  // --- ruler & protractor ----------------------------------------------------------------------
  function toggleRuler() {
    if (ruler) return setRuler(null);
    const c = viewportCenter();
    const len = PX_PER_CM * 14;
    setAidsCam({ ...camRef.current });
    setRuler({ a: { x: c.x - len / 2, y: c.y }, b: { x: c.x + len / 2, y: c.y } });
    count("aid.ruler");
  }
  function toggleProtractor() {
    if (protractor) return setProtractor(null);
    const c = viewportCenter();
    setAidsCam({ ...camRef.current });
    setProtractor({ cx: c.x, cy: c.y + 120, rot: 0 });
    count("aid.protractor");
  }

  // --- pen presets & recent colours ---------------------------------------------------------
  const PEN_TOOLS = ["pencil", "pen", "highlighter", "marker"] as const;
  function savePreset() {
    if (!(PEN_TOOLS as readonly string[]).includes(tool)) return flash("Pick a pen, pencil, marker or highlighter first.");
    updateSettings({ presets: [...settings.presets, { tool: tool as (typeof PEN_TOOLS)[number], color: inkColor, width }].slice(0, 8) });
    count("pen.presetSaved");
  }
  function applyPreset(p: (typeof settings.presets)[number]) {
    setTool(p.tool);
    if (p.tool === "highlighter") setHlColor(p.color); else setColor(p.color);
    setWidth(p.width);
    count("pen.presetUsed");
  }
  function rememberColor(c: string) {
    if (COLORS.includes(c) || HIGHLIGHTER_COLORS.includes(c)) return;
    updateSettings({ recentColors: [c, ...settings.recentColors.filter((x) => x !== c)].slice(0, 5) });
  }

  const activeTool: Tool = tool;
  const blockMode = tool === "block";
  const blocksTakeTouch = blockMode || tool === "text";
  const rail = (defs: ToolDef[]) => (
    <div className="flex gap-1 md:flex-col">
      {defs.map((t) => <IconButton key={t.id} title={t.label} active={tool === t.id} onClick={() => setTool(t.id)}>{t.icon}</IconButton>)}
    </div>
  );
  const Sep = () => <div className="mx-1 h-6 w-px shrink-0 bg-border md:mx-0 md:my-1 md:h-px md:w-6" />;

  return (
    <div className="safe-t flex h-full flex-col overflow-hidden bg-background" onPointerDownCapture={() => { activeEditor = noteId; }}>
      <header className="flex shrink-0 items-center gap-2 border-b border-border bg-surface px-3 py-2">
        <IconButton title="Back to notes" onClick={() => { void flush().then(() => go({ name: "library", notebook: note.meta.notebookId, q: "" })); }}><ArrowLeft size={18} /></IconButton>
        <input value={title} onChange={(e) => setTitle(e.target.value)} onBlur={commitTitle}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          className="min-w-0 flex-1 select-text rounded-lg bg-transparent px-2 py-1 text-sm font-medium outline-none focus:bg-surface-secondary" aria-label="Note title"
          style={{ WebkitUserSelect: "text", userSelect: "text" }} />
        <select value={paper} onChange={(e) => changePaper(e.target.value as NotePaper)} className="rounded-lg border border-border bg-background px-2 py-1 text-xs" title="Paper style">
          {PAPERS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
        <button
          onClick={swapEraser}
          title={tool === "eraser" ? "Back to your last tool (E)" : "Eraser — tap again to go back to this tool (E)"}
          aria-pressed={tool === "eraser"}
          className={`flex h-9 shrink-0 items-center gap-1.5 rounded-xl border px-3 text-sm font-medium transition-colors ${tool === "eraser" ? "border-primary bg-primary text-white" : "border-border bg-background text-foreground hover:bg-surface-secondary"}`}
        >
          {tool === "eraser" ? <ArrowLeftRight size={16} /> : <Eraser size={16} />}
          <span>{tool === "eraser" ? `Back to ${TOOL_NAMES[lastTool.current] ?? "pen"}` : "Erase"}</span>
        </button>
        <SavePill state={saveState} />
        <div className="relative">
          <IconButton title="More" onClick={() => setMenu((o) => !o)}><MoreHorizontal size={18} /></IconButton>
          {menu && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setMenu(false)} />
              <div className="absolute right-0 z-40 mt-1 w-64 rounded-xl border border-border bg-surface p-1 text-sm shadow-xl">
                <MenuItem icon={<ScanText size={15} />} label="Read handwriting for search" onClick={indexThisNote} />
                <MenuItem icon={<History size={15} />} label="Version history" onClick={openHistory} />
                <MenuItem icon={<Network size={15} />} label="Related notes" onClick={showRelated} />
                <MenuItem icon={<Grid3x3 size={15} />} label="Insert a template (axes, unit circle, periodic table…)" onClick={() => { setMenu(false); setTemplatesOpen(true); }} />
                <MenuItem icon={<ListChecks size={15} />} label="Review for mistakes…" onClick={() => { setMenu(false); setReviewSetup(true); }} />
                {splitWith ? (
                  <MenuItem icon={<Columns2 size={15} />} label="Close split (keep this note)" onClick={() => go({ name: "note", id: noteId })} />
                ) : (
                  <MenuItem icon={<Columns2 size={15} />} label="Open another note beside this" onClick={async () => { setMenu(false); setPicking((await listNotes()).filter((n) => n.id !== noteId)); }} />
                )}
                <div className="my-1 h-px bg-border" />
                <MenuItem icon={<Share2 size={15} />} label="Share as PDF…" onClick={() => { setMenu(false); sharePdf.start(); }} />
                <MenuItem icon={<FileText size={15} />} label="Export as PDF" onClick={exportPdf} />
                <MenuItem icon={<Download size={15} />} label="Export as PNG" onClick={exportPng} />
                <MenuItem icon={<Shapes size={15} />} label="Export this page as SVG" onClick={exportSvg} />
                <MenuItem icon={<FileCode2 size={15} />} label="Export as LaTeX (reads handwriting)" onClick={exportLatex} />
                <MenuItem icon={<Printer size={15} />} label="Print" onClick={doPrint} />
                <div className="my-1 h-px bg-border" />
                <MenuItem icon={<Trash2 size={15} />} label="Delete note" danger onClick={onDeleteNote} />
              </div>
            </>
          )}
        </div>
      </header>

      {hasSel && (
        <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border bg-primary/5 px-3 py-1.5 text-xs">
          <span className="mr-1 font-medium text-foreground-muted">Selection</span>
          <SelBtn onClick={() => canvasRef.current?.recolorSelection(color)}><Paintbrush size={13} /> Recolor</SelBtn>
          <SelBtn onClick={() => canvasRef.current?.duplicateSelection()}><Copy size={13} /> Duplicate</SelBtn>
          <SelBtn onClick={convertSelectionToText} accent><TextCursorInput size={13} /> To text</SelBtn>
          <SelBtn onClick={recognizeSelection} accent><Sigma size={13} /> Recognise maths</SelBtn>
          <SelBtn onClick={checkSelection} accent><CheckCheck size={13} /> Check working</SelBtn>
          <SelBtn onClick={cardsFromSelection} accent><LayersIcon size={13} /> Flashcards</SelBtn>
          <SelBtn onClick={explainSelection} accent><Lightbulb size={13} /> Explain</SelBtn>
          <SelBtn onClick={graphSelection} accent><LineChart size={13} /> Graph it</SelBtn>
          <SelBtn onClick={checkChemistry} accent><FlaskConical size={13} /> Check equation</SelBtn>
          <SelBtn onClick={() => canvasRef.current?.deleteSelection()} danger><Trash2 size={13} /> Delete</SelBtn>
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <div className="flex shrink-0 items-center gap-1.5 overflow-x-auto border-b border-border bg-surface px-2 py-2 md:min-h-0 md:w-[60px] md:flex-col md:items-center md:gap-1.5 md:overflow-y-auto md:overflow-x-visible md:border-b-0 md:border-r md:px-1.5 md:py-3">
          {rail(WRITE)}
          <IconButton title="Eraser" active={tool === "eraser"} onClick={() => setTool("eraser")}><Eraser size={17} /></IconButton>
          <Sep />
          {rail(SHAPES)}
          <IconButton title={settings.shapeSnap ? "Hold-to-snap shapes: ON (hold the pen still after drawing a line, circle or box)" : "Hold-to-snap shapes: off"} active={settings.shapeSnap} onClick={() => updateSettings({ shapeSnap: !settings.shapeSnap })}><Wand2 size={17} /></IconButton>
          <IconButton title={settings.scribbleErase ? "Scribble to erase: ON (scribble back and forth over ink to delete it)" : "Scribble to erase: off"} active={settings.scribbleErase} onClick={() => updateSettings({ scribbleErase: !settings.scribbleErase })}><Waves size={17} /></IconButton>
          <IconButton title={ruler ? "Hide ruler" : "Ruler — draw straight lines along its edge"} active={!!ruler} onClick={toggleRuler}><Ruler size={17} /></IconButton>
          <IconButton title={protractor ? "Hide protractor" : "Protractor"} active={!!protractor} onClick={toggleProtractor}><Compass size={17} /></IconButton>
          <Sep />
          {rail(SELECT)}
          <Sep />
          <div className="flex gap-1 md:flex-col">
            <IconButton title="Add a Python block (tap with the Blocks tool to place one)" onClick={() => addBlock("code")}><Code2 size={17} /></IconButton>
            <IconButton title="Text tool — tap anywhere on the page and type" active={tool === "text"} onClick={() => setTool(tool === "text" ? "pen" : "text")}><Type size={17} /></IconButton>
            <IconButton title="Add a maths (LaTeX) block" onClick={() => addBlock("math")}><Sigma size={17} /></IconButton>
            <IconButton title="Add a graph block (type y = x^2, x^2 + y^2 = 25, z = sin(x)cos(y)…)" onClick={() => { count("graph.add"); addBlock("graph", undefined, "y = x^2"); }}><LineChart size={17} /></IconButton>
            <IconButton title="Edit blocks (blocks take touch)" active={blockMode} onClick={() => setTool(blockMode ? "pen" : "block")}><Sparkles size={17} /></IconButton>
            <IconButton title="Insert image" onClick={() => fileRef.current?.click()}><ImagePlus size={17} /></IconButton>
          </div>
          <Sep />
          <div className="flex items-center gap-1.5 md:flex-col">
            {WIDTHS.map((w) => (
              <button key={w} onClick={() => setWidth(w)} title={`Width ${w}`}
                className={`flex h-8 w-8 items-center justify-center rounded-lg ${width === w ? "bg-surface-secondary ring-1 ring-primary" : "hover:bg-surface-secondary"}`}>
                <span className="rounded-full bg-foreground" style={{ width: Math.min(w, 16), height: Math.min(w, 16) }} />
              </button>
            ))}
          </div>
          <Sep />
          <PresetsButton presets={settings.presets} onApply={applyPreset} onSave={savePreset} onDelete={(i) => updateSettings({ presets: settings.presets.filter((_, k) => k !== i) })} />
          <div className="flex items-center gap-1.5 md:grid md:grid-cols-2 md:gap-1.5">
            {(tool === "highlighter" ? HIGHLIGHTER_COLORS : COLORS).map((c) => (
              <button key={c} title={c} onClick={() => (tool === "highlighter" ? setHlColor(c) : setColor(c))}
                className={`h-6 w-6 rounded-full ${inkColor === c ? "ring-2 ring-primary ring-offset-2 ring-offset-surface" : ""}`} style={{ backgroundColor: c }} />
            ))}
            {settings.recentColors.map((c) => (
              <button key={c} title={`Recent ${c}`} onClick={() => (tool === "highlighter" ? setHlColor(c) : setColor(c))}
                className={`h-6 w-6 rounded-full ring-1 ring-border ${inkColor === c ? "ring-2 ring-primary ring-offset-2 ring-offset-surface" : ""}`} style={{ backgroundColor: c }} />
            ))}
            <label className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-full ring-1 ring-border" title="Custom colour" style={{ background: "conic-gradient(red, yellow, lime, aqua, blue, magenta, red)" }}>
              <input type="color" value={inkColor} onChange={(e) => { const v = e.target.value; (tool === "highlighter" ? setHlColor : setColor)(v); rememberColor(v); }} className="sr-only" />
            </label>
          </div>
          <Sep />
          <div className="flex gap-1 md:flex-col">
            <IconButton title="Undo" disabled={!history.canUndo} onClick={() => canvasRef.current?.undo()}><Undo2 size={17} /></IconButton>
            <IconButton title="Redo" disabled={!history.canRedo} onClick={() => canvasRef.current?.redo()}><Redo2 size={17} /></IconButton>
          </div>
          <Sep />
          <div className="flex items-center gap-1 md:flex-col">
            <IconButton title="Zoom out" onClick={() => canvasRef.current?.zoomOut()}><ZoomOut size={17} /></IconButton>
            <button title="Reset zoom" onClick={() => canvasRef.current?.zoomReset()} className="w-10 rounded-md py-0.5 text-center text-[11px] font-medium text-foreground-muted hover:bg-surface-secondary">{Math.round(zoom * 100)}%</button>
            <IconButton title="Zoom in" onClick={() => canvasRef.current?.zoomIn()}><ZoomIn size={17} /></IconButton>
            <IconButton title="Fit to page" onClick={() => canvasRef.current?.zoomReset()}><Maximize2 size={17} /></IconButton>
          </div>
        </div>

        <div ref={stageRef} className="relative min-h-0 flex-1">
          <NoteCanvas
            ref={canvasRef}
            noteId={noteId}
            pageCount={pageCount}
            initialStrokes={note.strokes}
            initialImages={note.images as CanvasImage[]}
            paper={paper}
            tool={activeTool}
            color={inkColor}
            width={width}
            onCommit={onCommit}
            onHistoryChange={setHistory}
            onViewChange={setZoom}
            onCameraChange={onCameraChange}
            onTapDoc={(p) => { if (tool === "text") addBlock("text", { x: p.x, y: p.y - 10 }); else { addBlock("code", { x: p.x, y: p.y }); setTool("pen"); } }}
            shapeSnap={settings.shapeSnap}
            scribbleErase={settings.scribbleErase}
            guide={ruler}
            onInputSample={settings.diagnostics ? recordInputSample : undefined}
            onPageChange={(p) => setCurrentPage(p)}
            onSelectionChange={setHasSel}
            onSnipRegion={onSnipRegion}
            onExplainRegion={explainRegionNow}
            onImageAdd={persistImageAdd}
            onImageUpdate={(id, patch) => void updateImage(id, patch)}
            onImageDelete={(id) => void deleteImage(id)}
          />
          <BlocksLayer blocks={blocks} innerRef={blocksInner} interactive={blocksTakeTouch} scaleRef={scaleRef} running={running} onChange={onBlockChange} onDelete={onBlockDelete} onRun={onRunBlock} />
          <HighlightLayer rects={highlights} innerRef={highlightsInner} camRef={camRef} />
          {findRects.length > 0 && (
            <button onClick={() => { setFindRects([]); setFindTerm(""); }} className="absolute left-1/2 top-3 z-20 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-border bg-surface/95 px-3 py-1 text-xs shadow-md backdrop-blur" title="Clear highlights">
              Matches for “{findTerm}” <span className="text-foreground-muted">✕</span>
            </button>
          )}
          {aidsOn && (
            <DrawingAids cam={aidsCam} ruler={ruler} protractor={protractor} onRuler={setRuler} onProtractor={setProtractor}
              onCloseRuler={() => setRuler(null)} onCloseProtractor={() => setProtractor(null)} />
          )}
          {pagesOpen && (
            <PagesPanel count={pageCount} current={currentPage} rev={pagesRev}
              render={(p) => canvasRef.current?.previewPage(p, 150) ?? null}
              onJump={(p) => canvasRef.current?.goToPage(p)}
              onMove={(f, t) => applyPageOp(moveMapping(pageCount, f, t), `Moved page ${f + 1} to ${t + 1}.`)}
              onDuplicate={(p) => applyPageOp(duplicateMapping(pageCount, p), `Duplicated page ${p + 1}.`)}
              onInsertAfter={(p) => applyPageOp(insertBlankMapping(pageCount, p), `Added a blank page after ${p + 1}.`)}
              onDelete={(p) => { if (confirm(`Delete page ${p + 1}? Its writing goes with it (version history can bring it back).`)) void applyPageOp(deleteMapping(pageCount, p), `Deleted page ${p + 1}.`); }}
              onClose={() => setPagesOpen(false)} />
          )}
          {explain && <ExplainPanel state={explain} onAsk={askFollowUp} onClose={closeExplain} onPin={pinExplanation} onCards={explanationToCards} />}
          {review && <ReviewBar review={review} onGo={goIssue} onToggleFixed={toggleFixed} onDismiss={dismissIssue} onClose={() => setReview(null)} onCard={issueToCard} />}

          {scrub !== null && (
            <div className="absolute bottom-16 left-1/2 z-20 flex -translate-x-1/2 flex-col items-center gap-1.5 rounded-xl border border-border bg-surface/95 p-2 shadow-xl backdrop-blur">
              <div className="h-44 w-[124px] overflow-hidden rounded-md border border-border bg-white">
                {scrubPreview && <img src={scrubPreview} alt="" className="h-full w-full object-contain" draggable={false} />}
              </div>
              <span className="text-xs font-semibold">Page {scrub + 1} / {pageCount}</span>
              <span className="text-[10px] text-foreground-muted">release to jump</span>
            </div>
          )}
          <div className={`safe-b absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1 rounded-full border border-border bg-surface/95 py-1 pl-3 pr-1.5 text-xs font-medium shadow-md backdrop-blur ${explain || review ? "hidden" : ""}`}>
            <span onPointerDown={onScrubDown} onPointerMove={onScrubMove} onPointerUp={onScrubUp} onPointerCancel={onScrubUp}
              title={pageCount > 1 ? "Hold and drag to jump to a page" : undefined} style={{ touchAction: "none" }}
              className={`select-none rounded-full px-1 py-0.5 text-foreground-muted ${pageCount > 1 ? "cursor-ew-resize hover:bg-surface-secondary" : ""} ${scrub !== null ? "bg-surface-secondary text-foreground" : ""}`}>
              Page {Math.min(currentPage + 1, pageCount)} / {pageCount}
            </span>
            <button onClick={() => { setPagesOpen((v) => !v); setPagesRev((r) => r + 1); }} title="Page thumbnails — reorder, duplicate, insert" className={`ml-1 flex items-center rounded-full p-1.5 hover:bg-surface-secondary ${pagesOpen ? "bg-primary/10 text-primary" : "text-foreground-muted"}`}><Layers size={14} /></button>
            <button onClick={deleteCurrentPage} title="Delete this page" disabled={pageCount <= 1} className="ml-1 flex items-center rounded-full p-1.5 text-foreground-muted hover:bg-negative/10 hover:text-negative disabled:opacity-30"><Trash size={14} /></button>
            <button onClick={addPage} title="Add a page to the end" className="flex items-center gap-1 rounded-full bg-primary px-2.5 py-1 text-white hover:bg-primary-hover"><FilePlus2 size={13} /> Add page</button>
          </div>

          {busy && (
            <div className="absolute left-1/2 top-3 z-30 flex -translate-x-1/2 items-center gap-2 rounded-full border border-border bg-surface px-4 py-2 text-xs shadow-lg">
              <Loader2 size={13} className="animate-spin text-primary" /> {busy}
            </div>
          )}
        </div>
      </div>

      <input ref={fileRef} type="file" accept="image/*" hidden onChange={onPickImage} />

      {versions && (
        <Modal title="Version history" onClose={() => setVersions(null)}>
          {versions.length === 0 ? <p className="text-sm text-foreground-muted">No snapshots yet — one is saved automatically about every 10 minutes while you write.</p> : (
            <ul className="space-y-2">
              {versions.map((v) => (
                <li key={v.id} className="flex items-center justify-between rounded-xl border border-border px-4 py-2.5">
                  <div><p className="text-sm font-medium">{new Date(v.createdAt).toLocaleString()}</p><p className="text-xs text-foreground-muted">{v.strokeCount} strokes · {timeAgo(v.createdAt)}</p></div>
                  <Button onClick={() => onRestore(v.id)}>Restore</Button>
                </li>
              ))}
            </ul>
          )}
        </Modal>
      )}

      {picking && (
        <Modal title="Open beside this note" onClose={() => setPicking(null)}>
          {picking.length === 0 ? <p className="text-sm text-foreground-muted">No other notes yet.</p> : (
            <ul className="space-y-1.5">
              {picking.map((n) => (
                <li key={n.id}>
                  <button onClick={() => go({ name: "split", a: noteId, b: n.id })} className="flex w-full items-center justify-between rounded-xl border border-border px-4 py-2.5 text-left text-sm hover:border-primary/60">
                    <span className="truncate font-medium">{n.title}</span><span className="ml-3 shrink-0 text-xs text-foreground-muted">{n.pageCount} p · {timeAgo(n.updatedAt)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Modal>
      )}
      {related && (
        <Modal title="Related notes" onClose={() => setRelated(null)}>
          {related.length === 0 ? <p className="text-sm text-foreground-muted">Nothing similar yet. Related notes show up as you add more notes and “read” your handwriting (Search → Read my handwriting).</p> : (
            <ul className="space-y-1.5">
              {related.map((r) => (
                <li key={r.note.id}>
                  <button onClick={() => go({ name: "split", a: noteId, b: r.note.id })} className="w-full rounded-xl border border-border px-4 py-2.5 text-left hover:border-primary/60">
                    <span className="block truncate text-sm font-medium">{r.note.title}</span>
                    <span className="block truncate text-xs text-foreground-muted">{r.shared.join(", ")} · open beside this note</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Modal>
      )}
      {templatesOpen && (
        <Modal title="Insert a template" onClose={() => setTemplatesOpen(false)}>
          <p className="mb-3 text-sm text-foreground-muted">Placed on the current page as a picture you can write on top of (move or resize it with the select tool).</p>
          <div className="grid grid-cols-2 gap-2.5">
            {TEMPLATES.map((t) => (
              <button key={t.id} onClick={() => insertTemplate(t.id)} className="rounded-xl border border-border px-3 py-3 text-left hover:bg-surface-secondary">
                <p className="text-sm font-medium">{t.name}</p>
                <p className="text-xs text-foreground-muted">{t.blurb}</p>
              </button>
            ))}
          </div>
        </Modal>
      )}
      {sharePdf.modal}
      {reviewSetup && <ReviewSetup pageCount={pageCount} currentPage={currentPage} thumb={(p) => { try { return canvasRef.current?.previewPage(p, 180) ?? null; } catch { return null; } }} onStart={runReview} onClose={() => setReviewSetup(false)} />}
      {chem && <ChemModal items={chem} onClose={() => setChem(null)} />}
      {check && <CheckModal check={check} onClose={() => setCheck(null)} />}
      <Toast msg={toast} />
    </div>
  );
}

function SavePill({ state }: { state: SaveState }) {
  const m = state === "saved" ? { i: <Check size={13} />, t: "Saved", c: "text-positive" }
    : state === "saving" ? { i: <Loader2 size={13} className="animate-spin" />, t: "Saving", c: "text-foreground-muted" }
    : { i: <AlertTriangle size={13} />, t: "Retrying", c: "text-negative" };
  return <span title="Saved on this device" className={`flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium ${m.c}`}>{m.i}{m.t}</span>;
}
function MenuItem({ icon, label, onClick, danger }: { icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button onClick={onClick} className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left hover:bg-surface-secondary ${danger ? "text-negative" : ""}`}>
      <span className={danger ? "text-negative" : "text-foreground-muted"}>{icon}</span>{label}
    </button>
  );
}
function SelBtn({ children, onClick, accent, danger }: { children: React.ReactNode; onClick: () => void; accent?: boolean; danger?: boolean }) {
  return (
    <button onClick={onClick} className={`flex items-center gap-1 rounded-lg px-2.5 py-1.5 ${accent ? "bg-primary/10 font-medium text-primary hover:bg-primary/20" : danger ? "text-negative hover:bg-negative/10" : "hover:bg-surface-secondary"}`}>{children}</button>
  );
}

function CheckModal({ check, onClose }: { check: { lines: WorkingLine[]; results: StepResult[] }; onClose: () => void }) {
  const firstBad = check.results.find((r) => r.status === "error");
  const checked = check.results.filter((r) => r.status === "ok" || r.status === "ok-extra" || r.status === "error").length;
  return (
    <Modal title={<span className="flex items-center gap-2"><CheckCheck size={16} className="text-primary" /> Working check</span>} onClose={onClose} wide>
      <div className={`mb-4 rounded-xl border px-4 py-3 text-sm ${firstBad ? "border-negative/40 bg-negative/10" : "border-positive/40 bg-positive/10"}`}>
        {firstBad ? <><strong>Step {firstBad.i + 1} doesn&apos;t follow from step {(firstBad.from ?? firstBad.i - 1) + 1}.</strong> {firstBad.note}</> : checked ? <strong>Every step I could verify follows from the one before.</strong> : <strong>I couldn&apos;t verify these steps automatically.</strong>}
        <p className="mt-1 text-xs text-foreground-muted">Each line was read from your handwriting, then compared symbolically (SymPy, on this device) with the line above it.</p>
      </div>
      <ol className="space-y-2">
        {check.lines.map((l, i) => {
          const r = check.results.find((x) => x.i === i);
          const st = r?.status ?? "skip";
          const bad = st === "error";
          return (
            <li key={i} className={`flex items-start gap-3 rounded-xl border px-3 py-2.5 ${bad ? "border-negative/50 bg-negative/5" : "border-border"}`}>
              <span className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white"
                style={{ background: bad ? "var(--negative)" : st === "ok" || st === "ok-extra" ? "var(--positive)" : "var(--foreground-muted)" }}>
                {bad ? "✗" : st === "ok" || st === "ok-extra" ? "✓" : i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="overflow-x-auto"><Latex source={l.latex} /></div>
                <p className="text-xs text-foreground-muted">
                  {st === "start" ? "Starting line" : st === "ok" ? "Follows from the previous line" : st === "ok-extra" ? "Follows (but may add extra solutions)" : st === "error" ? "Does not follow from the previous line" : st === "unparsed" ? "Couldn't be read as maths" : st === "skip" ? "Text — not checked" : "Not checked automatically"}
                </p>
                {r?.note && <p className="mt-1 text-xs">{r.note.includes("\\") ? <Latex source={r.note.replace(/^[^\\]*/, "")} display={false} /> : r.note}</p>}
                {bad && r?.diff ? <p className="mt-1 text-xs text-negative">Difference between the lines: <Latex source={r.diff} display={false} /></p> : null}
              </div>
            </li>
          );
        })}
      </ol>
    </Modal>
  );
}

function ChemModal({ items, onClose }: { items: { eq: ReadEquation; report: BalanceReport }[]; onClose: () => void }) {
  return (
    <Modal title={<span className="flex items-center gap-2"><FlaskConical size={16} className="text-primary" /> Equation check</span>} onClose={onClose} wide>
      <div className="space-y-4">
        {items.map(({ eq, report }, i) => {
          const sugg = report.suggested ? formatEquation(eq, report.suggested) : null;
          const all = [...eq.reactants, ...eq.products];
          return (
            <div key={i} className={`rounded-xl border px-4 py-3 ${report.errors.length ? "border-border" : report.balanced ? "border-positive/50 bg-positive/5" : "border-negative/50 bg-negative/5"}`}>
              <p className="font-mono text-[15px]">{formatEquation(eq)}</p>
              <p className="mt-1 text-sm font-medium">
                {report.errors.length ? "Couldn't read every formula" : report.balanced ? "✓ Balanced — atoms and charge match on both sides." : "✗ Not balanced."}
              </p>
              {report.errors.length > 0 && <p className="mt-1 text-xs text-negative">{report.errors.join(" · ")} — fix the formula and try again.</p>}
              {!report.errors.length && (
                <table className="mt-2 text-sm">
                  <thead><tr className="text-left text-xs text-foreground-muted"><th className="pr-6 font-medium">Atom</th><th className="pr-6 font-medium">Left</th><th className="pr-6 font-medium">Right</th><th /></tr></thead>
                  <tbody>
                    {report.elements.map((e) => (
                      <tr key={e.el} className={e.ok ? "" : "font-semibold text-negative"}><td className="pr-6">{e.el}</td><td className="pr-6">{e.left}</td><td className="pr-6">{e.right}</td><td>{e.ok ? "✓" : "✗"}</td></tr>
                    ))}
                    {(report.charge.left !== 0 || report.charge.right !== 0) && (
                      <tr className={report.charge.ok ? "" : "font-semibold text-negative"}><td className="pr-6">charge</td><td className="pr-6">{report.charge.left}</td><td className="pr-6">{report.charge.right}</td><td>{report.charge.ok ? "✓" : "✗"}</td></tr>
                    )}
                  </tbody>
                </table>
              )}
              {!report.balanced && sugg && <p className="mt-3 rounded-lg bg-surface-secondary px-3 py-2 text-sm">Balanced: <span className="font-mono font-semibold">{sugg}</span></p>}
              {!report.balanced && !sugg && !report.errors.length && <p className="mt-3 text-xs text-foreground-muted">No single set of whole-number coefficients balances this as written — check the species.</p>}
              {!report.errors.length && (
                <p className="mt-3 text-xs text-foreground-muted">Molar masses (g/mol): {all.map((sp) => { try { return `${sp.formula} ${molarMass(sp.formula).toFixed(2)}`; } catch { return sp.formula; } }).join(" · ")}</p>
              )}
            </div>
          );
        })}
      </div>
    </Modal>
  );
}
