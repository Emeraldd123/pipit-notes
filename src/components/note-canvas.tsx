
// This component is an intentionally imperative canvas engine: strokes,
// images, selection, and the camera live in refs and are mutated in place for
// 60fps drawing without per-point React re-renders. The React-state-oriented
// immutability / manual-memoization lints don't apply to this internal mutable
// model, which is hand-optimized and verified by behaviour.
/* eslint-disable react-hooks/immutability */

import { useCallback, useEffect, useImperativeHandle, useRef } from "react";
import type { NoteTool, NotePaper, StrokeInput } from "@/types";
import { newStrokeId } from "@/lib/ids";
import { PAGE_W, PAGE_H, PAGE_GAP, pageTop } from "@/lib/page";
import { classifyStroke } from "@/lib/shapes";

export type Tool = NoteTool | "eraser" | "line" | "rect" | "ellipse" | "arrow" | "hand" | "lasso" | "image" | "snip" | "block";
// `id` is a stable per-stroke identity used for incremental (delta) saves. New
// strokes get one on commit; strokes loaded from the DB carry their row id.
export type Stroke = StrokeInput & { id?: string };
export type Point = { x: number; y: number; p?: number };

// One input-pipeline telemetry sample (diagnostics recorder). Kept small.
export type InputSample = {
  phase: "down" | "move" | "up";
  t: number; // high-res event timeStamp (ms)
  ptr: string; // pointerType
  coalesced: number; // sub-events in this move (1 = no coalescing → likely dropping)
  pressure: number;
  dt: number; // ms since previous move in this stroke
  handlerMs: number; // time spent in the move handler (main-thread cost)
  x: number; // doc coords (for reconstructing the actual stroke / speed)
  y: number;
  n: number; // points buffered so far in the current stroke
};
export type CanvasImage = { id?: string; data: string; x: number; y: number; width: number; height: number; rotation: number; zIndex: number };

export { PAGE_W, PAGE_H, PAGE_GAP, pageTop };

const MIN_SCALE = 0.15;
const MAX_SCALE = 6;
const ZOOM_STEP = 1.2;
const MARGIN = 16; // screen-px gap around the page at fit
const EXPORT_MAX_DIM = 4000; // cap flattened-PNG size (OCR/export) on tall docs
const HISTORY_LIMIT = 100;
const HISTORY_PERSIST = 20;
const HISTORY_MAX_BYTES = 2_000_000;
const HANDLE_HIT_PX = 16;
const GRID = 40;
const PALM_WINDOW_MS = 700;
const PALM_CONTACT = 45;

const SHAPE_TOOLS: Tool[] = ["line", "rect", "ellipse", "arrow"];
const isShape = (t: Tool) => SHAPE_TOOLS.includes(t);

export type NoteCanvasHandle = {
  getStrokes: () => Stroke[];
  /** Replace the whole stroke set and repaint (used to restore recovered work). */
  loadStrokes: (next: Stroke[]) => void;
  /** Current camera (for the input-probe lab to map doc<->client coords). */
  viewInfo: () => { scale: number; camX: number; camY: number };
  undo: () => void;
  redo: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  zoomReset: () => void;
  insertImage: (data: string, naturalW: number, naturalH: number, pageIdx?: number) => void;
  deleteSelection: () => void;
  recolorSelection: (color: string) => void;
  duplicateSelection: () => void;
  hasSelection: () => boolean;
  /** Flattened PNG of the WHOLE document (all pages) as a data URL. */
  exportPng: () => string;
  /** One PNG data URL per page, each PAGE_W×PAGE_H — for paginated PDF/print. */
  exportPages: () => string[];
  /** Scroll the view so page `pageIdx` is at the top (keeps current zoom). */
  goToPage: (pageIdx: number) => void;
  /** A small PNG thumbnail of one page — for the page scrubber preview. */
  previewPage: (pageIdx: number, maxW?: number) => string;
  /** The selected strokes rendered ink-only on white (for recognition / checking), plus their document bbox. */
  selectionImage: (maxDim?: number) => { dataUrl: string; w: number; h: number; bbox: { x: number; y: number; w: number; h: number } } | null;
  /** Document-space bounding box of the current stroke selection, or null. */
  selectionBBox: () => { x: number; y: number; w: number; h: number } | null;
  /** Remove page `pageIdx`: delete its strokes/images and shift the rest up.
   * (The caller decrements pageCount.) */
  deletePageContent: (pageIdx: number) => void;
};

type Selection = { kind: "strokes"; idx: number[] } | { kind: "image"; i: number } | null;
type Corner = "nw" | "ne" | "sw" | "se";
const ROT_HANDLE_OFF = 26;

function toolStyle(tool: NoteTool, width: number, pressure: number): { lineWidth: number; alpha: number } {
  switch (tool) {
    case "pen":
      return { lineWidth: width, alpha: 1 };
    case "pencil":
      return { lineWidth: width * (0.4 + 0.6 * pressure), alpha: 0.9 };
    case "highlighter":
      return { lineWidth: width * 4, alpha: 0.4 };
    case "marker":
      return { lineWidth: width * 2.2, alpha: 1 };
    default:
      return { lineWidth: width, alpha: 1 };
  }
}

const mid = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

// One Catmull-Rom segment p1->p2 (with neighbours p0,p3) as a cubic bezier that
// passes THROUGH the sampled points p1 and p2. Unlike the midpoint scheme this
// doesn't cut corners, so at the ~50Hz Safari gives us a fast "3"/"4" keeps its
// shape. The segment depends only on p0..p3, so it's final once p3 exists —
// letting the live and committed renders draw identical geometry (no reshape on
// lift). Caller sets styles and has begun the path at p1.
function catmullSeg(ctx: CanvasRenderingContext2D, p0: Point, p1: Point, p2: Point, p3: Point) {
  ctx.bezierCurveTo(
    p1.x + (p2.x - p0.x) / 6,
    p1.y + (p2.y - p0.y) / 6,
    p2.x - (p3.x - p1.x) / 6,
    p2.y - (p3.y - p1.y) / 6,
    p2.x,
    p2.y
  );
}

// Round captured points before they're stored/saved. Sub-pixel float precision
// (x/y to 0.1 doc-px, pressure to 0.01) is invisible on screen but roughly
// halves the JSON we ship in each Server Action save — which matters because a
// note saves its *entire* stroke set every time, and an oversized body used to
// be rejected outright (silent data loss on long notes).
const packPts = (pts: Point[]): Point[] =>
  pts.map((p) => ({
    x: Math.round(p.x * 10) / 10,
    y: Math.round(p.y * 10) / 10,
    p: p.p === undefined ? undefined : Math.round(p.p * 100) / 100,
  }));

// Trace a smoothed (quadratic-midpoint) path through `pts` into the current
// sub-path. Caller sets style and calls stroke(). Used to lay a translucent
// stroke (highlighter) down in ONE pass so overlapping caps don't stack up
// into dark beads.
function tracePath(ctx: CanvasRenderingContext2D, pts: Point[]) {
  const n = pts.length;
  ctx.moveTo(pts[0].x, pts[0].y);
  if (n === 2) {
    ctx.lineTo(pts[1].x, pts[1].y);
    return;
  }
  for (let i = 1; i <= n - 2; i++) {
    const m = mid(pts[i], pts[i + 1]);
    ctx.quadraticCurveTo(pts[i].x, pts[i].y, m.x, m.y);
  }
  ctx.lineTo(pts[n - 1].x, pts[n - 1].y);
}

function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function pointInPolygon(p: Point, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x,
      yi = poly[i].y,
      xj = poly[j].x,
      yj = poly[j].y;
    if (yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function strokeBBox(strokes: Stroke[], idx: number[]) {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const i of idx)
    for (const pt of strokes[i].points) {
      minX = Math.min(minX, pt.x);
      minY = Math.min(minY, pt.y);
      maxX = Math.max(maxX, pt.x);
      maxY = Math.max(maxY, pt.y);
    }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function strokeYRange(s: Stroke): [number, number] {
  let min = Infinity,
    max = -Infinity;
  for (const p of s.points) {
    if (p.y < min) min = p.y;
    if (p.y > max) max = p.y;
  }
  return [min, max];
}

function maybeSnap(a: Point, b: Point, snap: boolean): Point {
  if (!snap) return b;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return b;
  const step = Math.PI / 4;
  const angle = Math.round(Math.atan2(dy, dx) / step) * step;
  return { x: a.x + Math.cos(angle) * len, y: a.y + Math.sin(angle) * len, p: 0.6 };
}

function buildShape(tool: Tool, a: Point, b: Point, width: number, snap: boolean): Point[] {
  const P = (x: number, y: number): Point => ({ x, y, p: 0.6 });
  if (tool === "line") return [P(a.x, a.y), { ...maybeSnap(a, b, snap), p: 0.6 }];
  if (tool === "arrow") {
    const end = maybeSnap(a, b, snap);
    const ang = Math.atan2(end.y - a.y, end.x - a.x);
    const head = Math.max(width * 4, 22);
    const wing = Math.PI / 7;
    return [
      P(a.x, a.y),
      P(end.x, end.y),
      P(end.x - head * Math.cos(ang - wing), end.y - head * Math.sin(ang - wing)),
      P(end.x, end.y),
      P(end.x - head * Math.cos(ang + wing), end.y - head * Math.sin(ang + wing)),
    ];
  }
  if (tool === "rect") return [P(a.x, a.y), P(b.x, a.y), P(b.x, b.y), P(a.x, b.y), P(a.x, a.y)];
  const cx = (a.x + b.x) / 2,
    cy = (a.y + b.y) / 2,
    rx = Math.abs(b.x - a.x) / 2,
    ry = Math.abs(b.y - a.y) / 2;
  const pts: Point[] = [];
  for (let i = 0; i <= 48; i++) {
    const t = (i / 48) * Math.PI * 2;
    pts.push(P(cx + rx * Math.cos(t), cy + ry * Math.sin(t)));
  }
  return pts;
}

export function NoteCanvas({
  ref,
  noteId,
  pageCount,
  initialStrokes,
  initialImages,
  paper,
  tool,
  color,
  width,
  onCommit,
  onHistoryChange,
  onViewChange,
  onCameraChange,
  onTapDoc,
  shapeSnap,
  onPageChange,
  onSelectionChange,
  onSnipRegion,
  onImageAdd,
  onImageUpdate,
  onImageDelete,
  onInputSample,
}: {
  ref?: React.Ref<NoteCanvasHandle>;
  noteId: string;
  pageCount: number;
  initialStrokes: Stroke[];
  initialImages: CanvasImage[];
  paper: NotePaper;
  tool: Tool;
  color: string;
  width: number;
  onCommit: (strokes: Stroke[]) => void;
  onHistoryChange?: (s: { canUndo: boolean; canRedo: boolean }) => void;
  onViewChange?: (scale: number) => void;
  /** Fires on every camera change (pan/zoom/resize) — for overlays that follow the page. Keep it cheap (no React state). */
  onCameraChange?: (cam: { scale: number; camX: number; camY: number }) => void;
  /** A tap with the `block` tool, in document coordinates. */
  onTapDoc?: (pt: { x: number; y: number }) => void;
  /** Hold the pen still at the end of a stroke to snap a clear line / polygon / ellipse. Off by default. */
  shapeSnap?: boolean;
  onPageChange?: (page: number, count: number) => void;
  onSelectionChange?: (has: boolean) => void;
  /** A `snip` lasso finished: a PNG of the lassoed region + its doc size. */
  onSnipRegion?: (dataUrl: string, wDoc: number, hDoc: number) => void;
  onImageAdd?: (img: { data: string; x: number; y: number; width: number; height: number }) => Promise<string | undefined>;
  onImageUpdate?: (id: string, patch: { x?: number; y?: number; width?: number; height?: number; rotation?: number }) => void;
  onImageDelete?: (id: string) => void;
  /** Opt-in diagnostics: fired per pen event with cheap input telemetry. Only
   * pass it while the "test" recorder is on — capture adds a little overhead. */
  onInputSample?: (s: InputSample) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const strokesRef = useRef<Stroke[]>(initialStrokes.map((s) => ({ ...s, points: s.points.map((p) => ({ ...p })) })));
  const imagesRef = useRef<CanvasImage[]>(initialImages.map((i) => ({ ...i })));
  const imgEls = useRef<Map<string, HTMLImageElement>>(new Map());

  const drawingRef = useRef<Point[] | null>(null);
  // How many smoothed segments of the in-progress stroke are already painted, so
  // each move draws only the newly-finalised segment (no re-smoothing on lift).
  const segDrawnRef = useRef(0);
  const lastMoveTsRef = useRef(0); // for diagnostics inter-event timing
  const diagRef = useRef(onInputSample);
  const cameraCbRef = useRef(onCameraChange);
  const tapCbRef = useRef(onTapDoc);
  const tapRef = useRef<{ x: number; y: number } | null>(null);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const snappedRef = useRef(false);
  const shapeSnapRef = useRef(!!shapeSnap);
  useEffect(() => { shapeSnapRef.current = !!shapeSnap; }, [shapeSnap]);
  useEffect(() => { cameraCbRef.current = onCameraChange; tapCbRef.current = onTapDoc; }, [onCameraChange, onTapDoc]);
  useEffect(() => { diagRef.current = onInputSample; }, [onInputSample]);
  // Cached viewport rect — reading getBoundingClientRect() per input point forces
  // a layout reflow and stalls high-rate pen input (dropped points). Refreshed at
  // pointer-down and on resize; page scroll is locked so it can't drift mid-stroke.
  const rectRef = useRef<DOMRect | null>(null);
  const shapeStartRef = useRef<Point | null>(null);
  const erasingRef = useRef(false);
  const lassoRef = useRef<Point[] | null>(null);
  const selRef = useRef<Selection>(null);
  const dragRef = useRef<{ mode: "move" | "resize" | "rotate"; corner?: Corner; last: Point } | null>(null);
  const penDownRef = useRef(0);
  const lastPenAtRef = useRef(0);

  const paperRef = useRef(paper);
  const pageCountRef = useRef(pageCount);
  const dprRef = useRef(1);

  // Camera: (camX, camY) is the DOCUMENT coordinate shown at the viewport's
  // top-left; `scale` is zoom. Applied inside the 2D context, so the canvas
  // backing store stays viewport-sized (bounded memory) no matter how many
  // pages the document has.
  const viewRef = useRef({ scale: 1, camX: 0, camY: 0 });
  const panRef = useRef<{ sx: number; sy: number; camX: number; camY: number } | null>(null);
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<{ dist: number; docX: number; docY: number; scale: number } | null>(null);

  const undoStack = useRef<Stroke[][]>([]);
  const redoStack = useRef<Stroke[][]>([]);
  const lastPageRef = useRef(-1);

  const settings = useRef({ tool, color, width });

  const docHeight = () => pageCountRef.current * PAGE_H + (pageCountRef.current - 1) * PAGE_GAP;
  const pxPerDoc = () => 1 / viewRef.current.scale; // doc units per screen px (handle/dash sizing)

  // --- history --------------------------------------------------------------
  // Shallow array snapshot — shares the (immutable) committed stroke objects, so
  // taking undo history is O(strokes), not O(all points). This is what made pen-
  // down laggy on big notes (a deep copy of the whole note ran on every stroke
  // start). Safe because committed strokes are never mutated in place: drawing
  // appends new objects, and drag/recolor below are copy-on-write.
  const snapshot = () => strokesRef.current.slice();
  const cloneStroke = (s: Stroke): Stroke => ({ ...s, points: s.points.map((p) => ({ ...p })) });
  const historyKey = `pipit-notes-hist:${noteId}`;
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const persistHistory = useCallback(() => {
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(() => {
      try {
        const undo = undoStack.current.slice(-HISTORY_PERSIST);
        const redo = redoStack.current.slice(-HISTORY_PERSIST);
        // Snapshots share stroke objects, but JSON.stringify re-serialises each in
        // full — so on a big note this could stringify many MB only to blow the cap
        // and be discarded (a main-thread stall mid-writing). Estimate cheaply from
        // the point count and bail BEFORE the expensive serialise.
        let pts = 0;
        for (const snap of undo) for (const s of snap) pts += s.points.length;
        for (const snap of redo) for (const s of snap) pts += s.points.length;
        if (pts * 24 > HISTORY_MAX_BYTES) { localStorage.removeItem(historyKey); return; }
        const payload = JSON.stringify({ undo, redo });
        if (payload.length > HISTORY_MAX_BYTES) localStorage.removeItem(historyKey);
        else localStorage.setItem(historyKey, payload);
      } catch {
        /* quota / unavailable */
      }
    }, 600);
  }, [historyKey]);
  const emitHistory = useCallback(() => {
    onHistoryChange?.({ canUndo: undoStack.current.length > 0, canRedo: redoStack.current.length > 0 });
    persistHistory();
  }, [onHistoryChange, persistHistory]);
  const pushHistory = useCallback(() => {
    undoStack.current.push(snapshot());
    if (undoStack.current.length > HISTORY_LIMIT) undoStack.current.shift();
    redoStack.current = [];
    emitHistory();
  }, [emitHistory]);

  // --- drawing primitives ---------------------------------------------------
  const drawStroke = useCallback((ctx: CanvasRenderingContext2D, stroke: Stroke) => {
    const pts = stroke.points;
    if (pts.length === 0) return;
    ctx.save();
    ctx.strokeStyle = stroke.color;
    ctx.fillStyle = stroke.color;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    // Highlighter: one translucent pass under `multiply` so the ink tints the
    // page (and text stays readable) instead of stacking into dark beads.
    if (stroke.tool === "highlighter") {
      const { lineWidth, alpha } = toolStyle(stroke.tool, stroke.width, 0.5);
      ctx.globalCompositeOperation = "multiply";
      ctx.globalAlpha = alpha;
      ctx.lineWidth = lineWidth;
      ctx.beginPath();
      if (pts.length === 1) {
        ctx.arc(pts[0].x, pts[0].y, Math.max(lineWidth, 0.75) / 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        tracePath(ctx, pts);
        ctx.stroke();
      }
      ctx.restore();
      return;
    }
    if (pts.length === 1) {
      const { lineWidth, alpha } = toolStyle(stroke.tool, stroke.width, pts[0].p ?? 0.5);
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(pts[0].x, pts[0].y, Math.max(lineWidth, 0.75) / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return;
    }
    const n = pts.length;
    // Catmull-Rom through every sampled point (endpoints clamped). One bezier per
    // segment so per-point pressure still drives width. Same math as the live path.
    for (let k = 0; k < n - 1; k++) {
      const p0 = pts[k - 1] ?? pts[k];
      const p1 = pts[k];
      const p2 = pts[k + 1];
      const p3 = pts[k + 2] ?? pts[k + 1];
      const { lineWidth, alpha } = toolStyle(stroke.tool, stroke.width, ((p1.p ?? 0.5) + (p2.p ?? 0.5)) / 2);
      ctx.globalAlpha = alpha;
      ctx.lineWidth = lineWidth;
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      catmullSeg(ctx, p0, p1, p2, p3);
      ctx.stroke();
    }
    ctx.restore();
  }, []);

  const drawPaper = useCallback((ctx: CanvasRenderingContext2D, top: number) => {
    const p = paperRef.current;
    if (p === "blank") return;
    const bottom = top + PAGE_H;
    ctx.save();
    ctx.strokeStyle = "rgba(60,64,90,0.13)";
    ctx.fillStyle = "rgba(60,64,90,0.18)";
    ctx.lineWidth = 1;
    if (p === "ruled") {
      for (let y = top + GRID * 2; y < bottom; y += GRID) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(PAGE_W, y);
        ctx.stroke();
      }
    } else if (p === "cornell") {
      // Cornell layout: header, a cue column on the left, notes area, and a summary strip.
      const cue = 330, headY = top + GRID * 2.5, sumY = bottom - GRID * 5.5;
      for (let y = headY + GRID; y < sumY; y += GRID) {
        ctx.beginPath();
        ctx.moveTo(cue, y);
        ctx.lineTo(PAGE_W, y);
        ctx.stroke();
      }
      ctx.strokeStyle = "rgba(60,64,90,0.34)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, headY); ctx.lineTo(PAGE_W, headY);
      ctx.moveTo(cue, headY); ctx.lineTo(cue, sumY);
      ctx.moveTo(0, sumY); ctx.lineTo(PAGE_W, sumY);
      ctx.stroke();
      ctx.font = "22px sans-serif";
      ctx.fillStyle = "rgba(60,64,90,0.38)";
      ctx.fillText("Cues", 24, headY + 34);
      ctx.fillText("Notes", cue + 24, headY + 34);
      ctx.fillText("Summary", 24, sumY + 34);
    } else if (p === "grid") {
      for (let x = GRID; x < PAGE_W; x += GRID) {
        ctx.beginPath();
        ctx.moveTo(x, top);
        ctx.lineTo(x, bottom);
        ctx.stroke();
      }
      for (let y = top + GRID; y < bottom; y += GRID) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(PAGE_W, y);
        ctx.stroke();
      }
    } else {
      for (let x = GRID; x < PAGE_W; x += GRID)
        for (let y = top + GRID; y < bottom; y += GRID) {
          ctx.beginPath();
          ctx.arc(x, y, 1.6, 0, Math.PI * 2);
          ctx.fill();
        }
    }
    ctx.restore();
  }, []);

  const drawImage = useCallback((ctx: CanvasRenderingContext2D, img: CanvasImage) => {
    const el = imgEls.current.get(img.id ?? img.data);
    if (!el || !el.complete || el.naturalWidth === 0) return;
    ctx.save();
    if (img.rotation) {
      ctx.translate(img.x + img.width / 2, img.y + img.height / 2);
      ctx.rotate((img.rotation * Math.PI) / 180);
      ctx.drawImage(el, -img.width / 2, -img.height / 2, img.width, img.height);
    } else {
      ctx.drawImage(el, img.x, img.y, img.width, img.height);
    }
    ctx.restore();
  }, []);

  // Paint pages (white sheet + border + paper), images, then ink — in document
  // coordinates. Shared by the on-screen camera render (with a cull window) and
  // the flattened PNG export (cull = null). Does NOT paint selection/lasso/UI.
  const paintContent = useCallback(
    (ctx: CanvasRenderingContext2D, cull: { top: number; bot: number } | null) => {
      for (let i = 0; i < pageCountRef.current; i++) {
        const top = pageTop(i);
        if (cull && (top + PAGE_H < cull.top || top > cull.bot)) continue;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, top, PAGE_W, PAGE_H);
        ctx.strokeStyle = "rgba(0,0,0,0.08)";
        ctx.lineWidth = 1.5;
        ctx.strokeRect(0, top, PAGE_W, PAGE_H);
        drawPaper(ctx, top);
      }
      for (const img of [...imagesRef.current].sort((a, b) => a.zIndex - b.zIndex)) {
        if (cull && (img.y + img.height < cull.top || img.y > cull.bot)) continue;
        drawImage(ctx, img);
      }
      for (const s of strokesRef.current) {
        if (cull) {
          const [mn, mx] = strokeYRange(s);
          if (mx < cull.top || mn > cull.bot) continue;
        }
        drawStroke(ctx, s);
      }
    },
    [drawPaper, drawImage, drawStroke]
  );

  const drawSelection = useCallback(
    (ctx: CanvasRenderingContext2D) => {
      const sel = selRef.current;
      if (!sel) return;
      const isImg = sel.kind === "image";
      const b = isImg
        ? { x: imagesRef.current[sel.i].x, y: imagesRef.current[sel.i].y, w: imagesRef.current[sel.i].width, h: imagesRef.current[sel.i].height }
        : strokeBBox(strokesRef.current, sel.idx);
      if (!Number.isFinite(b.w)) return;
      const s = pxPerDoc();
      const pad = 6 * s;
      const hs = 6 * s;
      ctx.save();
      if (isImg && imagesRef.current[sel.i].rotation) {
        ctx.translate(b.x + b.w / 2, b.y + b.h / 2);
        ctx.rotate((imagesRef.current[sel.i].rotation * Math.PI) / 180);
        ctx.translate(-(b.x + b.w / 2), -(b.y + b.h / 2));
      }
      ctx.strokeStyle = "#2563eb";
      ctx.fillStyle = "#2563eb";
      ctx.lineWidth = 1.5 * s;
      ctx.setLineDash([6 * s, 4 * s]);
      ctx.strokeRect(b.x - pad, b.y - pad, b.w + pad * 2, b.h + pad * 2);
      ctx.setLineDash([]);
      const corners: [number, number][] = isImg
        ? [[b.x + b.w + pad, b.y + b.h + pad]]
        : [
            [b.x - pad, b.y - pad],
            [b.x + b.w + pad, b.y - pad],
            [b.x - pad, b.y + b.h + pad],
            [b.x + b.w + pad, b.y + b.h + pad],
          ];
      for (const [cx, cy] of corners) ctx.fillRect(cx - hs, cy - hs, hs * 2, hs * 2);
      if (isImg) {
        const rx = b.x + b.w / 2;
        const ry = b.y - pad - ROT_HANDLE_OFF * s;
        ctx.beginPath();
        ctx.moveTo(rx, b.y - pad);
        ctx.lineTo(rx, ry);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(rx, ry, hs, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    },
    // pxPerDoc reads refs; safe to omit
    []
  );

  const applyCamera = (ctx: CanvasRenderingContext2D) => {
    const v = viewRef.current;
    const d = dprRef.current;
    ctx.setTransform(v.scale * d, 0, 0, v.scale * d, -v.camX * v.scale * d, -v.camY * v.scale * d);
  };

  const redraw = useCallback(
    (preview?: Stroke) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const v = viewRef.current;
      const d = dprRef.current;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height); // transparent → grey viewport shows in gaps
      applyCamera(ctx);
      const viewDocH = canvas.height / d / v.scale;
      const cull = { top: v.camY - 4, bot: v.camY + viewDocH + 4 };
      paintContent(ctx, cull);
      // Report the page nearest the viewport centre (for the page indicator).
      const centreY = v.camY + viewDocH / 2;
      const cur = Math.max(0, Math.min(pageCountRef.current - 1, Math.round(centreY / (PAGE_H + PAGE_GAP))));
      if (cur !== lastPageRef.current) {
        lastPageRef.current = cur;
        onPageChange?.(cur, pageCountRef.current);
      }
      cameraCbRef.current?.({ scale: v.scale, camX: v.camX, camY: v.camY });
      if (preview) drawStroke(ctx, preview);
      if (lassoRef.current && lassoRef.current.length > 1) {
        const s = pxPerDoc();
        ctx.save();
        ctx.strokeStyle = "#2563eb";
        ctx.lineWidth = 1.5 * s;
        ctx.setLineDash([5 * s, 4 * s]);
        ctx.beginPath();
        ctx.moveTo(lassoRef.current[0].x, lassoRef.current[0].y);
        for (const p of lassoRef.current) ctx.lineTo(p.x, p.y);
        ctx.stroke();
        ctx.restore();
      }
      drawSelection(ctx);
    },
    [paintContent, drawStroke, drawSelection, onPageChange]
  );

  // --- camera math ----------------------------------------------------------
  const clampView = () => {
    const vp = viewportRef.current;
    const v = viewRef.current;
    if (!vp) return;
    const vw = vp.clientWidth;
    const vh = vp.clientHeight;
    const viewDocW = vw / v.scale;
    const viewDocH = vh / v.scale;
    const margin = MARGIN / v.scale;
    const maxCamY = Math.max(-margin, docHeight() - viewDocH + margin);
    v.camY = Math.min(Math.max(v.camY, -margin), maxCamY);
    if (PAGE_W <= viewDocW) {
      v.camX = (PAGE_W - viewDocW) / 2; // page narrower than viewport → centre
    } else {
      v.camX = Math.min(Math.max(v.camX, -margin), PAGE_W - viewDocW + margin);
    }
  };

  const fitView = () => {
    const vp = viewportRef.current;
    const v = viewRef.current;
    if (!vp) return;
    const vw = vp.clientWidth;
    v.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, (vw - 2 * MARGIN) / PAGE_W));
    v.camY = -MARGIN / v.scale;
    v.camX = (PAGE_W - vw / v.scale) / 2;
    clampView();
  };

  const setScaleAround = useCallback(
    (nextScale: number, screenX: number, screenY: number) => {
      const v = viewRef.current;
      const s = Math.min(MAX_SCALE, Math.max(MIN_SCALE, nextScale));
      const docX = v.camX + screenX / v.scale;
      const docY = v.camY + screenY / v.scale;
      v.scale = s;
      v.camX = docX - screenX / s;
      v.camY = docY - screenY / s;
      clampView();
      redraw();
      onViewChange?.(s);
    },
    // clampView reads only refs (stable); intentionally excluded
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [redraw, onViewChange]
  );

  // --- effects --------------------------------------------------------------
  useEffect(() => {
    settings.current = { tool, color, width };
    if (tool !== "lasso" && tool !== "image" && selRef.current) {
      selRef.current = null;
      onSelectionChange?.(false);
      redraw();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool, color, width]);

  useEffect(() => {
    paperRef.current = paper;
    redraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paper]);

  // Page count changed: grow/shrink the document. On an append, scroll to the
  // new last page so the user sees it.
  useEffect(() => {
    const prev = pageCountRef.current;
    pageCountRef.current = pageCount;
    clampView();
    if (pageCount > prev) {
      viewRef.current.camY = pageTop(pageCount - 1) - MARGIN / viewRef.current.scale;
      clampView();
    }
    redraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageCount]);

  // Restore persisted undo/redo once on mount.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(historyKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { undo?: Stroke[][]; redo?: Stroke[][] };
      if (Array.isArray(parsed.undo)) undoStack.current = parsed.undo;
      if (Array.isArray(parsed.redo)) redoStack.current = parsed.redo;
      onHistoryChange?.({ canUndo: undoStack.current.length > 0, canRedo: redoStack.current.length > 0 });
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Preload images.
  useEffect(() => {
    for (const img of imagesRef.current) {
      const key = img.id ?? img.data;
      if (imgEls.current.has(key)) continue;
      const el = new Image();
      el.onload = () => redraw();
      el.src = img.data;
      imgEls.current.set(key, el);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Size the (viewport-sized) backing store; fit on mount, re-clamp on resize.
  useEffect(() => {
    const canvas = canvasRef.current;
    const viewport = viewportRef.current;
    if (!canvas || !viewport) return;
    const setup = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      dprRef.current = dpr;
      canvas.width = Math.max(1, Math.round(viewport.clientWidth * dpr));
      canvas.height = Math.max(1, Math.round(viewport.clientHeight * dpr));
    };
    setup();
    fitView();
    redraw();
    onViewChange?.(viewRef.current.scale); // report the real fit scale for the % readout
    const ro = new ResizeObserver(() => {
      setup();
      clampView();
      redraw();
    });
    ro.observe(viewport);
    return () => ro.disconnect();
    // Run ONCE on mount. `redraw` reads live refs, so a stale closure is fine —
    // and depending on it would re-run this effect (resetting the camera via
    // fitView) on every re-render, which froze scrolling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // iOS Safari: a fast-moving palm starts a drag text-selection through the
  // touch layer (pops Copy/Share). Non-passive touchmove/gesture preventDefault
  // kills it; pointer events (drawing, pan/zoom) still fire.
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const stop = (e: Event) => e.preventDefault();
    const opts: AddEventListenerOptions = { passive: false };
    // Also swallow `wheel`: the camera consumes the scroll (React onWheel), and
    // preventing the native default stops the browser from scrolling / rubber-
    // band-overscrolling the page behind the app (the "black area" on laptops).
    const events = ["touchmove", "wheel", "gesturestart", "gesturechange", "gestureend"];
    for (const ev of events) vp.addEventListener(ev, stop, opts);
    return () => {
      for (const ev of events) vp.removeEventListener(ev, stop, opts);
    };
  }, []);

  // --- coordinate mapping ---------------------------------------------------
  // Refresh the cached rect (call at the start of an input gesture / on resize).
  function refreshRect() {
    if (viewportRef.current) rectRef.current = viewportRef.current.getBoundingClientRect();
  }
  function rect(): DOMRect {
    return rectRef.current ?? (rectRef.current = viewportRef.current!.getBoundingClientRect());
  }
  function eventToPoint(clientX: number, clientY: number, pressure: number, pointerType: string): Point {
    const r = rect();
    const v = viewRef.current;
    const p = pointerType === "pen" ? (pressure > 0 ? pressure : 0.5) : pressure > 0 && pressure !== 0.5 ? pressure : 0.5;
    return { x: v.camX + (clientX - r.left) / v.scale, y: v.camY + (clientY - r.top) / v.scale, p };
  }
  function vpPoint(clientX: number, clientY: number) {
    const r = rect();
    return { x: clientX - r.left, y: clientY - r.top };
  }

  // --- selection ops --------------------------------------------------------
  const clearSelection = useCallback(() => {
    if (selRef.current) {
      selRef.current = null;
      onSelectionChange?.(false);
      redraw();
    }
  }, [onSelectionChange, redraw]);

  const doDelete = useCallback(() => {
    const sel = selRef.current;
    if (!sel) return;
    if (sel.kind === "image") {
      const img = imagesRef.current[sel.i];
      imagesRef.current.splice(sel.i, 1);
      if (img.id) onImageDelete?.(img.id);
    } else {
      pushHistory();
      const set = new Set(sel.idx);
      strokesRef.current = strokesRef.current.filter((_, i) => !set.has(i));
      onCommit(strokesRef.current);
    }
    selRef.current = null;
    onSelectionChange?.(false);
    redraw();
  }, [onCommit, onImageDelete, onSelectionChange, pushHistory, redraw]);

  const doRecolor = useCallback(
    (col: string) => {
      const sel = selRef.current;
      if (!sel || sel.kind !== "strokes") return;
      pushHistory();
      // Copy-on-write so the shared object in the history snapshot keeps its old colour.
      for (const i of sel.idx) strokesRef.current[i] = { ...strokesRef.current[i], color: col };
      onCommit(strokesRef.current);
      redraw();
    },
    [onCommit, pushHistory, redraw]
  );

  const doDuplicate = useCallback(() => {
    const sel = selRef.current;
    if (!sel || sel.kind !== "strokes") return;
    pushHistory();
    const copies = sel.idx.map((i) => ({
      ...strokesRef.current[i],
      id: newStrokeId(), // a duplicate is a NEW stroke — never share the source's id
      points: strokesRef.current[i].points.map((p) => ({ ...p, x: p.x + 24, y: p.y + 24 })),
    }));
    const base = strokesRef.current.length;
    strokesRef.current.push(...copies);
    selRef.current = { kind: "strokes", idx: copies.map((_, k) => base + k) };
    onCommit(strokesRef.current);
    redraw();
  }, [onCommit, pushHistory, redraw]);

  useImperativeHandle(
    ref,
    () => ({
      getStrokes: () => strokesRef.current,
      // Replace the whole stroke set and repaint — used to restore a queued
      // offline edit that was never persisted, so the recovered work is what's
      // on screen (and what a subsequent draw builds on) instead of a stale DB copy.
      loadStrokes: (next: Stroke[]) => {
        strokesRef.current = next;
        clearSelection();
        redraw();
        emitHistory();
      },
      viewInfo: () => ({ ...viewRef.current }),
      undo: () => {
        if (!undoStack.current.length) return;
        redoStack.current.push(snapshot());
        strokesRef.current = undoStack.current.pop()!;
        clearSelection();
        redraw();
        emitHistory();
        onCommit(strokesRef.current);
      },
      redo: () => {
        if (!redoStack.current.length) return;
        undoStack.current.push(snapshot());
        strokesRef.current = redoStack.current.pop()!;
        clearSelection();
        redraw();
        emitHistory();
        onCommit(strokesRef.current);
      },
      zoomIn: () => {
        const vp = viewportRef.current!;
        setScaleAround(viewRef.current.scale * ZOOM_STEP, vp.clientWidth / 2, vp.clientHeight / 2);
      },
      zoomOut: () => {
        const vp = viewportRef.current!;
        setScaleAround(viewRef.current.scale / ZOOM_STEP, vp.clientWidth / 2, vp.clientHeight / 2);
      },
      zoomReset: () => {
        fitView();
        redraw();
        onViewChange?.(viewRef.current.scale);
      },
      insertImage: (data, nw, nh, pageIdx) => {
        // Default to whichever page is currently centred in the view.
        const v = viewRef.current;
        const vp = viewportRef.current!;
        const centreDocY = v.camY + vp.clientHeight / 2 / v.scale;
        const idx = pageIdx ?? Math.max(0, Math.min(pageCountRef.current - 1, Math.round(centreDocY / (PAGE_H + PAGE_GAP))));
        const top = pageTop(idx);
        // Snips/large images fit to most of the page width and sit near the top,
        // leaving room to write below; small inserts stay compact and centred.
        const targetW = Math.min(PAGE_W * (pageIdx != null ? 0.86 : 0.55), nw);
        const targetH = (nh / nw) * targetW;
        const placedTop = pageIdx != null ? top + 60 : top + (PAGE_H - targetH) / 3;
        const img: CanvasImage = { data, x: (PAGE_W - targetW) / 2, y: placedTop, width: targetW, height: targetH, rotation: 0, zIndex: imagesRef.current.length };
        imagesRef.current.push(img);
        const el = new Image();
        el.onload = () => redraw();
        el.src = data;
        imgEls.current.set(data, el);
        selRef.current = { kind: "image", i: imagesRef.current.length - 1 };
        onSelectionChange?.(true);
        redraw();
        onImageAdd?.({ data, x: img.x, y: img.y, width: img.width, height: img.height }).then((id) => {
          if (id) {
            img.id = id;
            imgEls.current.set(id, el);
          }
        });
      },
      deleteSelection: doDelete,
      recolorSelection: doRecolor,
      duplicateSelection: doDuplicate,
      hasSelection: () => selRef.current !== null,
      deletePageContent: (pageIdx) => {
        // Remove strokes/images that belong to page `pageIdx` and shift
        // everything below it up by one page (so the deleted sheet closes up).
        const span = PAGE_H + PAGE_GAP;
        const y0 = pageTop(pageIdx);
        const y1 = y0 + span;
        pushHistory();
        strokesRef.current = strokesRef.current.flatMap((s) => {
          const [mn, mx] = strokeYRange(s);
          const cy = (mn + mx) / 2;
          if (cy >= y0 && cy < y1) return []; // on this page → drop
          // below → shift up via a NEW object (copy-on-write keeps history intact)
          if (cy >= y1) return [{ ...s, points: s.points.map((p) => ({ ...p, y: p.y - span })) }];
          return [s]; // unchanged → share
        });
        // Images: delete on-page ones, shift below ones.
        for (let i = imagesRef.current.length - 1; i >= 0; i--) {
          const im = imagesRef.current[i];
          const cy = im.y + im.height / 2;
          if (cy >= y0 && cy < y1) {
            if (im.id) onImageDelete?.(im.id);
            imagesRef.current.splice(i, 1);
          } else if (cy >= y1) {
            im.y -= span;
            if (im.id) onImageUpdate?.(im.id, { x: im.x, y: im.y, width: im.width, height: im.height, rotation: im.rotation });
          }
        }
        selRef.current = null;
        onSelectionChange?.(false);
        redraw();
        onCommit(strokesRef.current);
      },
      exportPng: () => {
        // Flatten the WHOLE document (all pages) to one PNG, capped so a tall
        // multi-page note stays within canvas size limits.
        const dh = docHeight();
        const es = Math.min(1, EXPORT_MAX_DIM / Math.max(PAGE_W, dh));
        const out = document.createElement("canvas");
        out.width = Math.max(1, Math.round(PAGE_W * es));
        out.height = Math.max(1, Math.round(dh * es));
        const octx = out.getContext("2d")!;
        octx.fillStyle = "#ffffff";
        octx.fillRect(0, 0, out.width, out.height);
        octx.setTransform(es, 0, 0, es, 0, 0);
        paintContent(octx, null);
        return out.toDataURL("image/png");
      },
      goToPage: (pageIdx) => {
        const i = Math.max(0, Math.min(pageCountRef.current - 1, Math.round(pageIdx)));
        viewRef.current.camY = pageTop(i) - MARGIN / viewRef.current.scale;
        clampView();
        redraw();
      },
      selectionBBox: () => {
        const sel = selRef.current;
        if (!sel || sel.kind !== "strokes") return null;
        const b = strokeBBox(strokesRef.current, sel.idx);
        return Number.isFinite(b.w) ? b : null;
      },
      selectionImage: (maxDim = 1400) => {
        const sel = selRef.current;
        if (!sel || sel.kind !== "strokes") return null;
        const b = strokeBBox(strokesRef.current, sel.idx);
        if (!Number.isFinite(b.w) || b.w < 2 || b.h < 2) return null;
        const pad = 24;
        const bw = b.w + pad * 2;
        const bh = b.h + pad * 2;
        const es = Math.min(2, maxDim / Math.max(bw, bh));
        const out = document.createElement("canvas");
        out.width = Math.max(1, Math.round(bw * es));
        out.height = Math.max(1, Math.round(bh * es));
        const octx = out.getContext("2d")!;
        octx.fillStyle = "#ffffff";
        octx.fillRect(0, 0, out.width, out.height);
        octx.setTransform(es, 0, 0, es, (-b.x + pad) * es, (-b.y + pad) * es);
        for (const i of sel.idx) drawStroke(octx, { ...strokesRef.current[i], color: "#000000" });
        return { dataUrl: out.toDataURL("image/png"), w: out.width, h: out.height, bbox: b };
      },
      previewPage: (pageIdx, maxW = 240) => {
        const i = Math.max(0, Math.min(pageCountRef.current - 1, Math.round(pageIdx)));
        const top = pageTop(i);
        const es = maxW / PAGE_W;
        const w = Math.max(1, Math.round(PAGE_W * es));
        const h = Math.max(1, Math.round(PAGE_H * es));
        const out = document.createElement("canvas");
        out.width = w;
        out.height = h;
        const octx = out.getContext("2d")!;
        octx.fillStyle = "#ffffff";
        octx.fillRect(0, 0, w, h);
        octx.setTransform(es, 0, 0, es, 0, -top * es);
        octx.beginPath();
        octx.rect(0, top, PAGE_W, PAGE_H);
        octx.clip();
        paintContent(octx, { top: top - 2, bot: top + PAGE_H + 2 });
        return out.toDataURL("image/png");
      },
      exportPages: () => {
        // One image per page (each PAGE_W×PAGE_H at up to 2×), clipped to the page
        // rect — so PDF/print gets one sheet per page instead of the whole note
        // squished onto a single page.
        const es = Math.min(2, EXPORT_MAX_DIM / Math.max(PAGE_W, PAGE_H));
        const w = Math.max(1, Math.round(PAGE_W * es));
        const h = Math.max(1, Math.round(PAGE_H * es));
        const pages: string[] = [];
        for (let i = 0; i < pageCountRef.current; i++) {
          const top = pageTop(i);
          const out = document.createElement("canvas");
          out.width = w;
          out.height = h;
          const octx = out.getContext("2d")!;
          octx.fillStyle = "#ffffff";
          octx.fillRect(0, 0, w, h);
          octx.setTransform(es, 0, 0, es, 0, -top * es); // map page i to the origin
          octx.beginPath();
          octx.rect(0, top, PAGE_W, PAGE_H);
          octx.clip();
          paintContent(octx, { top: top - 2, bot: top + PAGE_H + 2 });
          pages.push(out.toDataURL("image/png"));
        }
        return pages;
      },
    }),
    // fitView reads only refs (stable); intentionally excluded
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [redraw, emitHistory, onCommit, setScaleAround, clearSelection, doDelete, doRecolor, doDuplicate, onImageAdd, onSelectionChange, onViewChange, paintContent]
  );

  // Snapshot the lassoed region (paper + background PDF page + ink) to a PNG,
  // clipped to the polygon. Used by the `snip` tool to lift a piece of a page
  // (e.g. a homework question) onto a fresh page.
  function snapshotRegion(poly: Point[]): { dataUrl: string; w: number; h: number } | null {
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const p of poly) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    const w = maxX - minX;
    const h = maxY - minY;
    if (w < 8 || h < 8) return null;
    const es = Math.min(2, EXPORT_MAX_DIM / Math.max(w, h)); // render at up to 2× for crisp text
    const out = document.createElement("canvas");
    out.width = Math.max(1, Math.round(w * es));
    out.height = Math.max(1, Math.round(h * es));
    const octx = out.getContext("2d")!;
    octx.fillStyle = "#ffffff";
    octx.fillRect(0, 0, out.width, out.height);
    octx.setTransform(es, 0, 0, es, -minX * es, -minY * es);
    octx.beginPath();
    octx.moveTo(poly[0].x, poly[0].y);
    for (const p of poly) octx.lineTo(p.x, p.y);
    octx.closePath();
    octx.clip();
    paintContent(octx, { top: minY - 4, bot: maxY + 4 });
    return { dataUrl: out.toDataURL("image/png"), w, h };
  }

  function eraseAt(p: Point) {
    const r = Math.max(settings.current.width * 3, 14);
    const before = strokesRef.current.length;
    strokesRef.current = strokesRef.current.filter((s) => {
      if (s.points.length === 1) return Math.hypot(s.points[0].x - p.x, s.points[0].y - p.y) > r;
      for (let i = 1; i < s.points.length; i++) if (distToSegment(p, s.points[i - 1], s.points[i]) <= r) return false;
      return true;
    });
    if (strokesRef.current.length !== before) redraw();
  }

  function selBBox() {
    const sel = selRef.current;
    if (!sel) return null;
    return sel.kind === "image"
      ? { x: imagesRef.current[sel.i].x, y: imagesRef.current[sel.i].y, w: imagesRef.current[sel.i].width, h: imagesRef.current[sel.i].height }
      : strokeBBox(strokesRef.current, sel.idx);
  }
  function toLocal(p: Point, im: CanvasImage): Point {
    if (!im.rotation) return p;
    const cx = im.x + im.width / 2;
    const cy = im.y + im.height / 2;
    const r = (-im.rotation * Math.PI) / 180;
    const dx = p.x - cx;
    const dy = p.y - cy;
    return { x: cx + dx * Math.cos(r) - dy * Math.sin(r), y: cy + dx * Math.sin(r) + dy * Math.cos(r) };
  }
  function handleAt(p: Point): { mode: "resize" | "rotate" | "move"; corner?: Corner } | null {
    const sel = selRef.current;
    const b = selBBox();
    if (!sel || !b) return null;
    const s = pxPerDoc();
    const pad = 6 * s;
    const tol = HANDLE_HIT_PX * s;
    const isImg = sel.kind === "image";
    const lp = isImg ? toLocal(p, imagesRef.current[sel.i]) : p;
    if (isImg) {
      const rx = b.x + b.w / 2;
      const ry = b.y - pad - ROT_HANDLE_OFF * s;
      if (Math.hypot(lp.x - rx, lp.y - ry) <= tol) return { mode: "rotate" };
      if (Math.hypot(lp.x - (b.x + b.w + pad), lp.y - (b.y + b.h + pad)) <= tol) return { mode: "resize", corner: "se" };
    } else {
      const corners: [Corner, number, number][] = [
        ["nw", b.x - pad, b.y - pad],
        ["ne", b.x + b.w + pad, b.y - pad],
        ["sw", b.x - pad, b.y + b.h + pad],
        ["se", b.x + b.w + pad, b.y + b.h + pad],
      ];
      for (const [c, hx, hy] of corners) if (Math.hypot(lp.x - hx, lp.y - hy) <= tol) return { mode: "resize", corner: c };
    }
    if (lp.x >= b.x && lp.x <= b.x + b.w && lp.y >= b.y && lp.y <= b.y + b.h) return { mode: "move" };
    return null;
  }
  function imageAt(p: Point): number {
    for (let i = imagesRef.current.length - 1; i >= 0; i--) {
      const im = imagesRef.current[i];
      if (im.zIndex < 0) continue; // locked background (PDF page / template)
      if (p.x >= im.x && p.x <= im.x + im.width && p.y >= im.y && p.y <= im.y + im.height) return i;
    }
    return -1;
  }
  function translateSelection(dx: number, dy: number) {
    const sel = selRef.current;
    if (!sel) return;
    if (sel.kind === "image") {
      const im = imagesRef.current[sel.i];
      im.x += dx;
      im.y += dy;
    } else {
      for (const i of sel.idx) for (const pt of strokesRef.current[i].points) {
        pt.x += dx;
        pt.y += dy;
      }
    }
  }
  function resizeSelection(p: Point, corner: Corner) {
    const sel = selRef.current;
    if (!sel) return;
    if (sel.kind === "image") {
      const im = imagesRef.current[sel.i];
      const lp = toLocal(p, im);
      const ratio = im.height / im.width;
      im.width = Math.max(16, lp.x - im.x);
      im.height = im.width * ratio;
    } else {
      const b = strokeBBox(strokesRef.current, sel.idx);
      const ax = corner === "nw" || corner === "sw" ? b.x + b.w : b.x;
      const ay = corner === "nw" || corner === "ne" ? b.y + b.h : b.y;
      const sx = Math.abs((p.x - ax) / (b.w || 1));
      const sy = Math.abs((p.y - ay) / (b.h || 1));
      const s = Math.max(0.05, Math.min(sx, sy));
      for (const i of sel.idx) for (const pt of strokesRef.current[i].points) {
        pt.x = ax + (pt.x - ax) * s;
        pt.y = ay + (pt.y - ay) * s;
      }
    }
  }
  function rotateSelection(p: Point) {
    const sel = selRef.current;
    if (!sel || sel.kind !== "image") return;
    const im = imagesRef.current[sel.i];
    const cx = im.x + im.width / 2;
    const cy = im.y + im.height / 2;
    im.rotation = (Math.atan2(p.y - cy, p.x - cx) * 180) / Math.PI + 90;
  }

  // --- touch navigation -----------------------------------------------------
  function startPinch() {
    const [a, b] = [...touches.current.values()];
    const v = viewRef.current;
    const midX = (a.x + b.x) / 2;
    const midY = (a.y + b.y) / 2;
    pinchRef.current = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, docX: v.camX + midX / v.scale, docY: v.camY + midY / v.scale, scale: v.scale };
  }
  function touchMove(e: React.PointerEvent) {
    const t = touches.current;
    if (!t.has(e.pointerId)) return;
    const prev = t.get(e.pointerId)!;
    const cur = vpPoint(e.clientX, e.clientY);
    t.set(e.pointerId, cur);
    const v = viewRef.current;
    if (t.size === 1) {
      v.camX -= (cur.x - prev.x) / v.scale;
      v.camY -= (cur.y - prev.y) / v.scale;
      clampView();
      redraw();
    } else if (t.size === 2 && pinchRef.current) {
      const [a, b] = [...t.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const midX = (a.x + b.x) / 2;
      const midY = (a.y + b.y) / 2;
      const ps = pinchRef.current;
      const nextScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, (ps.scale * dist) / ps.dist));
      v.scale = nextScale;
      v.camX = ps.docX - midX / nextScale;
      v.camY = ps.docY - midY / nextScale;
      clampView();
      redraw();
      onViewChange?.(nextScale);
    }
  }

  // --- pointer routing ------------------------------------------------------
  function onPointerDown(e: React.PointerEvent) {
    refreshRect(); // one layout read per gesture; input points then read the cache
    if (e.pointerType === "touch") {
      e.preventDefault();
      // Palm-reject only while the pen is actually in play: any touch during an
      // active stroke, or a palm-sized contact just after one. When the pen is
      // idle, every touch is a deliberate finger gesture (scroll / pinch) and must
      // be honoured — some iPads (e.g. the 2022 10th-gen) report a normal
      // fingertip's contact geometry as larger than PALM_CONTACT, which was
      // rejecting one-finger scroll entirely.
      const penDown = penDownRef.current > 0;
      const penRecent = Date.now() - lastPenAtRef.current < PALM_WINDOW_MS;
      const bigContact = (e.width || 0) > PALM_CONTACT || (e.height || 0) > PALM_CONTACT;
      if (penDown || (penRecent && bigContact)) return;
      touches.current.set(e.pointerId, vpPoint(e.clientX, e.clientY));
      if (touches.current.size === 2) startPinch();
      return;
    }
    if (e.button !== 0 && e.pointerType === "mouse") return;
    e.preventDefault();
    if (e.pointerType === "pen") {
      penDownRef.current++;
      lastPenAtRef.current = Date.now();
      touches.current.clear();
      pinchRef.current = null;
    }
    const t = settings.current.tool;
    try {
      canvasRef.current?.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic */
    }
    if (t === "hand") {
      panRef.current = { sx: e.clientX, sy: e.clientY, camX: viewRef.current.camX, camY: viewRef.current.camY };
      return;
    }
    const pt = eventToPoint(e.clientX, e.clientY, e.pressure, e.pointerType);

    if (t === "block") {
      tapRef.current = { x: pt.x, y: pt.y };
      return;
    }
    if (t === "snip") {
      selRef.current = null;
      onSelectionChange?.(false);
      lassoRef.current = [pt];
      return;
    }
    if (t === "lasso" || t === "image") {
      const h = selRef.current ? handleAt(pt) : null;
      if (h) {
        const sel = selRef.current!;
        if (sel.kind === "strokes") {
          pushHistory();
          // Clone the strokes we're about to drag/resize so the shared objects in
          // the history snapshot stay intact while we mutate points in place.
          for (const i of sel.idx) strokesRef.current[i] = cloneStroke(strokesRef.current[i]);
        }
        dragRef.current = { mode: h.mode, corner: h.corner, last: pt };
        return;
      }
      if (t === "image") {
        const i = imageAt(pt);
        selRef.current = i >= 0 ? { kind: "image", i } : null;
        onSelectionChange?.(selRef.current !== null);
        if (i >= 0) dragRef.current = { mode: "move", last: pt };
        redraw();
        return;
      }
      selRef.current = null;
      onSelectionChange?.(false);
      lassoRef.current = [pt];
      return;
    }
    if (t === "eraser") {
      pushHistory();
      erasingRef.current = true;
      eraseAt(pt);
      return;
    }
    if (isShape(t)) {
      shapeStartRef.current = pt;
      return;
    }
    drawingRef.current = [pt];
    snappedRef.current = false;
    if (holdTimerRef.current) { clearTimeout(holdTimerRef.current); holdTimerRef.current = null; }
    segDrawnRef.current = 0;
    lastMoveTsRef.current = e.timeStamp;
    diagRef.current?.({ phase: "down", t: e.timeStamp, ptr: e.pointerType, coalesced: 1, pressure: e.pressure, dt: 0, handlerMs: 0, x: pt.x, y: pt.y, n: 1 });
  }

  function onPointerMove(e: React.PointerEvent) {
    if (e.pointerType === "touch") {
      if (touches.current.has(e.pointerId)) {
        e.preventDefault();
        touchMove(e);
      }
      return;
    }
    if (e.pointerType === "pen") lastPenAtRef.current = Date.now();
    if (panRef.current) {
      const v = viewRef.current;
      v.camX = panRef.current.camX - (e.clientX - panRef.current.sx) / v.scale;
      v.camY = panRef.current.camY - (e.clientY - panRef.current.sy) / v.scale;
      clampView();
      redraw();
      return;
    }
    const pt = () => eventToPoint(e.clientX, e.clientY, e.pressure, e.pointerType);
    if (dragRef.current) {
      const p = pt();
      const d = dragRef.current;
      if (d.mode === "move") {
        translateSelection(p.x - d.last.x, p.y - d.last.y);
        d.last = p;
      } else if (d.mode === "rotate") {
        rotateSelection(p);
      } else {
        resizeSelection(p, d.corner ?? "se");
      }
      redraw();
      return;
    }
    if (lassoRef.current) {
      lassoRef.current.push(pt());
      redraw();
      return;
    }
    if (shapeStartRef.current) {
      const cur = pt();
      const s = settings.current;
      redraw({ tool: "pen", color: s.color, width: s.width, points: buildShape(s.tool, shapeStartRef.current, cur, s.width, e.shiftKey) });
      return;
    }
    if (erasingRef.current) {
      const events = typeof e.nativeEvent.getCoalescedEvents === "function" ? e.nativeEvent.getCoalescedEvents() : [];
      const raw = events.length > 0 ? events : [e.nativeEvent];
      for (const r of raw) eraseAt(eventToPoint(r.clientX, r.clientY, r.pressure ?? 0.5, e.pointerType));
      return;
    }
    if (!drawingRef.current) return;
    e.preventDefault();
    if (snappedRef.current) return; // shape already snapped — hold it until the pen lifts
    const events = typeof e.nativeEvent.getCoalescedEvents === "function" ? e.nativeEvent.getCoalescedEvents() : [];
    const raw = events.length > 0 ? events : [e.nativeEvent];
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const s = settings.current;
    // Highlighter is translucent: drawing it incrementally would stack overlaps
    // into dark beads, so repaint committed content and lay the whole in-progress
    // stroke down in a single `multiply` pass each frame.
    if (s.tool === "highlighter") {
      for (const r of raw) {
        drawingRef.current!.push(eventToPoint(r.clientX, r.clientY, r.pressure ?? 0.5, e.pointerType));
      }
      redraw();
      const buf = drawingRef.current!;
      if (buf.length >= 1) {
        applyCamera(ctx);
        ctx.save();
        ctx.strokeStyle = s.color;
        ctx.fillStyle = s.color;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        const { lineWidth, alpha } = toolStyle("highlighter", s.width, 0.5);
        ctx.globalCompositeOperation = "multiply";
        ctx.globalAlpha = alpha;
        ctx.lineWidth = lineWidth;
        ctx.beginPath();
        if (buf.length === 1) {
          ctx.arc(buf[0].x, buf[0].y, Math.max(lineWidth, 0.75) / 2, 0, Math.PI * 2);
          ctx.fill();
        } else {
          tracePath(ctx, buf);
          ctx.stroke();
        }
        ctx.restore();
      }
      return;
    }
    const h0 = diagRef.current ? performance.now() : 0;
    const buf = drawingRef.current!;
    for (const r of raw) buf.push(eventToPoint(r.clientX, r.clientY, r.pressure ?? 0.5, e.pointerType));
    applyCamera(ctx);
    ctx.strokeStyle = s.color;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    // Paint only Catmull-Rom segments that are now FINAL — segment k (buf[k]→
    // buf[k+1]) needs buf[k+2] to exist and then never changes. Identical geometry
    // to the committed render, so the stroke doesn't reshape when the pen lifts.
    // segDrawnRef holds the next segment index still to draw.
    const L = buf.length;
    for (let k = segDrawnRef.current; k <= L - 3; k++) {
      const p1 = buf[k];
      const p2 = buf[k + 1];
      const { lineWidth, alpha } = toolStyle(s.tool as NoteTool, s.width, ((p1.p ?? 0.5) + (p2.p ?? 0.5)) / 2);
      ctx.globalAlpha = alpha;
      ctx.lineWidth = lineWidth;
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      catmullSeg(ctx, buf[k - 1] ?? p1, p1, p2, buf[k + 2]);
      ctx.stroke();
    }
    if (L - 2 > segDrawnRef.current) segDrawnRef.current = L - 2;
    // Hold-to-snap: if the pen rests ~half a second, replace a clearly-geometric
    // stroke (line / polygon / ellipse) with its clean version. Ambiguous strokes
    // (handwriting) are never touched — see lib/shapes.ts.
    if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
    if (shapeSnapRef.current) {
      holdTimerRef.current = setTimeout(() => {
        holdTimerRef.current = null;
        const cur = drawingRef.current;
        if (!cur || snappedRef.current) return;
        const snap = classifyStroke(cur);
        if (!snap) return;
        snappedRef.current = true;
        drawingRef.current = snap.points.map((q) => ({ x: q.x, y: q.y, p: 0.5 }));
        segDrawnRef.current = drawingRef.current.length;
        const st = settings.current;
        redraw({ tool: st.tool as NoteTool, color: st.color, width: st.width, points: drawingRef.current });
      }, 520);
    }
    if (diagRef.current) {
      const last = buf[buf.length - 1];
      diagRef.current({
        phase: "move",
        t: e.timeStamp,
        ptr: e.pointerType,
        coalesced: raw.length,
        pressure: e.pressure,
        dt: e.timeStamp - lastMoveTsRef.current,
        handlerMs: performance.now() - h0,
        x: last.x,
        y: last.y,
        n: buf.length,
      });
      lastMoveTsRef.current = e.timeStamp;
    }
  }

  function onPointerUp(e: React.PointerEvent) {
    if (e.pointerType === "touch") {
      touches.current.delete(e.pointerId);
      if (touches.current.size < 2) pinchRef.current = null;
      return;
    }
    if (e.pointerType === "pen") {
      penDownRef.current = Math.max(0, penDownRef.current - 1);
      lastPenAtRef.current = Date.now();
    }
    if (diagRef.current && drawingRef.current) {
      const b = drawingRef.current;
      diagRef.current({ phase: "up", t: e.timeStamp, ptr: e.pointerType, coalesced: 1, pressure: e.pressure, dt: e.timeStamp - lastMoveTsRef.current, handlerMs: 0, x: b[b.length - 1]?.x ?? 0, y: b[b.length - 1]?.y ?? 0, n: b.length });
    }
    try {
      canvasRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    if (tapRef.current) {
      const tp = tapRef.current;
      tapRef.current = null;
      tapCbRef.current?.(tp);
      return;
    }
    if (panRef.current) {
      panRef.current = null;
      return;
    }
    if (dragRef.current) {
      const sel = selRef.current;
      dragRef.current = null;
      if (sel?.kind === "image") {
        const im = imagesRef.current[sel.i];
        if (im.id) onImageUpdate?.(im.id, { x: im.x, y: im.y, width: im.width, height: im.height, rotation: im.rotation });
      } else if (sel?.kind === "strokes") {
        onCommit(strokesRef.current);
      }
      return;
    }
    if (lassoRef.current) {
      const poly = lassoRef.current;
      lassoRef.current = null;
      if (settings.current.tool === "snip") {
        if (poly.length >= 3) {
          const snap = snapshotRegion(poly);
          if (snap) onSnipRegion?.(snap.dataUrl, snap.w, snap.h);
        }
        redraw();
        return;
      }
      if (poly.length >= 3) {
        const idx: number[] = [];
        strokesRef.current.forEach((s, i) => {
          const inside = s.points.filter((p) => pointInPolygon(p, poly)).length;
          if (inside >= Math.max(1, s.points.length * 0.5)) idx.push(i);
        });
        selRef.current = idx.length ? { kind: "strokes", idx } : null;
        onSelectionChange?.(idx.length > 0);
      }
      redraw();
      return;
    }
    const s = settings.current;
    if (shapeStartRef.current) {
      const cur = eventToPoint(e.clientX, e.clientY, e.pressure, e.pointerType);
      const start = shapeStartRef.current;
      shapeStartRef.current = null;
      if (Math.hypot(cur.x - start.x, cur.y - start.y) < 3) {
        redraw();
        return;
      }
      pushHistory();
      strokesRef.current.push({ id: newStrokeId(), tool: "pen", color: s.color, width: s.width, points: packPts(buildShape(s.tool, start, cur, s.width, e.shiftKey)) });
      redraw();
      onCommit(strokesRef.current);
      return;
    }
    if (erasingRef.current) {
      erasingRef.current = false;
      onCommit(strokesRef.current);
      return;
    }
    if (holdTimerRef.current) { clearTimeout(holdTimerRef.current); holdTimerRef.current = null; }
    const buf = drawingRef.current;
    drawingRef.current = null;
    if (!buf) return;
    pushHistory();
    strokesRef.current.push({ id: newStrokeId(), tool: s.tool as NoteTool, color: s.color, width: s.width, points: packPts(buf) });
    // Pen-up used to repaint the whole visible page (~10ms on a big note — a stall
    // right before the next stroke starts). The live render already painted every
    // finalised segment with the exact geometry the committed render uses, so only
    // the last segment(s) are missing: paint just those. Dots and the translucent
    // highlighter still take the full repaint.
    if (buf.length >= 3 && s.tool !== "highlighter") {
      const cv = canvasRef.current;
      const cx = cv?.getContext("2d");
      if (cx) {
        applyCamera(cx);
        cx.strokeStyle = s.color;
        cx.lineCap = "round";
        cx.lineJoin = "round";
        for (let k = segDrawnRef.current; k <= buf.length - 2; k++) {
          const p1 = buf[k];
          const p2 = buf[k + 1];
          const { lineWidth, alpha } = toolStyle(s.tool as NoteTool, s.width, ((p1.p ?? 0.5) + (p2.p ?? 0.5)) / 2);
          cx.globalAlpha = alpha;
          cx.lineWidth = lineWidth;
          cx.beginPath();
          cx.moveTo(p1.x, p1.y);
          catmullSeg(cx, buf[k - 1] ?? p1, p1, p2, buf[k + 2] ?? p2);
          cx.stroke();
        }
        cx.globalAlpha = 1;
      } else redraw();
    } else {
      redraw();
    }
    onCommit(strokesRef.current);
  }

  function onWheel(e: React.WheelEvent) {
    const vp = vpPoint(e.clientX, e.clientY);
    if (e.ctrlKey || e.metaKey) {
      setScaleAround(viewRef.current.scale * Math.exp(-e.deltaY * 0.002), vp.x, vp.y);
    } else {
      const v = viewRef.current;
      v.camX += e.deltaX / v.scale;
      v.camY += e.deltaY / v.scale;
      clampView();
      redraw();
    }
  }

  const cursor = tool === "hand" ? "grab" : tool === "eraser" ? "cell" : tool === "lasso" || tool === "image" ? "default" : "crosshair";

  return (
    <div
      ref={viewportRef}
      onWheel={onWheel}
      onContextMenu={(e) => e.preventDefault()}
      className="relative h-full w-full touch-none select-none overflow-hidden overscroll-none bg-surface-secondary"
      style={{ WebkitUserSelect: "none", WebkitTouchCallout: "none", WebkitTapHighlightColor: "transparent", overscrollBehavior: "none" }}
    >
      <canvas
        ref={canvasRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className="absolute inset-0 h-full w-full select-none"
        style={{ touchAction: "none", cursor, WebkitUserSelect: "none", WebkitTouchCallout: "none" }}
      />
    </div>
  );
}
