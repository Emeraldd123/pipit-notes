// Math check as you write. After each pen-up the strokes you just added are grouped into their written line; once a
// line looks like a finished equation (an "=" or reaction arrow with writing after it) and you either move on to
// another line or pause, a picture of that line (plus the line or two above it) goes to the cheap model. Mistakes
// come back as red boxes on the line. Old work is never checked: only lines you write while the mode is on.
import { useCallback, useEffect, useRef, useState } from "react";
import type { Stroke } from "./note-canvas";
import type { MathMark } from "./understanding";
import { lineOf, linesAbove, pad, relationIn, signature, union, type Box } from "@/lib/ink-groups";
import { normalizeMathCheck, workingLine, type MathCheck } from "@/lib/mathcheck-core";
import { AiError, checkMathLine } from "@/lib/ai";
import { checkEquation } from "@/lib/chem";
import { verifyWorking } from "@/lib/stepcheck";
import { PAGE_GAP, PAGE_H, PAGE_W } from "@/lib/page";
import { count, logError } from "@/lib/telemetry";

const IDLE_MS = 3500;
const OK_TICK_MS = 1600;
const BALANCE = /balanc|atoms?\b|coefficient|charge/i;

function clampToPage(r: Box, line: Box): Box {
  const top = Math.floor((line.y + line.h / 2) / (PAGE_H + PAGE_GAP)) * (PAGE_H + PAGE_GAP);
  const x0 = Math.max(0, r.x), y0 = Math.max(top, r.y);
  const x1 = Math.min(PAGE_W, r.x + r.w), y1 = Math.min(top + PAGE_H, r.y + r.h);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Second opinions that cost nothing: SymPy for an algebra step, the local balancer for a reaction. */
async function doubleCheck(c: MathCheck, line: Box): Promise<MathCheck> {
  if (c.ok) return c;
  let issues = c.issues;
  if (c.kind === "chem" && c.reaction) {
    const rep = checkEquation(c.reaction);
    if (!rep.errors.length && rep.balanced) issues = issues.filter((i) => !BALANCE.test(`${i.note} ${i.fix}`));
    else if (!rep.errors.length && !issues.some((i) => BALANCE.test(i.note))) issues = [...issues, { box: line, note: "Not balanced", fix: "" }];
  }
  if (c.kind === "math" && c.prev && c.line && issues.length) {
    const a = workingLine(c.prev), b = workingLine(c.line);
    if (a.kind !== "text" && a.kind === b.kind) {
      try {
        const res = await verifyWorking([a, b]);
        if (res[1]?.status === "ok") issues = [];   // the step is mathematically sound: the model misjudged it
      } catch { /* no SymPy (offline, first load failed): keep the model's verdict */ }
    }
  }
  if (issues.length < c.issues.length) count("mathcheck.overruled");
  return { ...c, issues, ok: issues.length === 0 };
}

export function useMathCheck({ enabled, getStrokes, regionImage, onFail }: {
  enabled: boolean;
  getStrokes: () => Stroke[];
  regionImage: (r: Box) => string | null;
  /** a problem that stops checking (bad key, budget reached, offline) */
  onFail: (message: string) => void;
}) {
  const [marks, setMarks] = useState<MathMark[]>([]);
  const [checking, setChecking] = useState(false);
  const marksRef = useRef<MathMark[]>([]);
  const lineIdsOf = useRef(new Map<string, Set<string>>());   // mark id -> stroke ids of the line it is on
  const seen = useRef(new Set<string>());
  const pending = useRef(new Set<string>());                  // new stroke ids whose line may need a check
  const done = useRef(new Set<string>());                     // line signatures already checked
  const queue = useRef<string[]>([]);
  const busy = useRef(false);
  const stopped = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const live = useRef({ enabled, getStrokes, regionImage, onFail });
  live.current = { enabled, getStrokes, regionImage, onFail };

  const put = useCallback((next: MathMark[]) => { marksRef.current = next; setMarks(next); }, []);

  useEffect(() => {
    // turning it on starts from what is already on the page: only new writing is checked
    seen.current = new Set(getStrokes().map((s) => s.id).filter((x): x is string => !!x));
    pending.current.clear();
    queue.current = [];
    stopped.current = false;
    if (!enabled) { put([]); lineIdsOf.current.clear(); }
    return () => { if (timer.current) clearTimeout(timer.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  const pump = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      while (queue.current.length && live.current.enabled && !stopped.current) {
        const seed = queue.current.shift()!;
        const strokes = live.current.getStrokes();
        const at = strokes.findIndex((s) => s.id === seed);
        if (at < 0) continue;
        const line = lineOf(strokes, at);
        const sig = signature(strokes, line.idx);
        if (done.current.has(sig) || !relationIn(strokes, line.idx, line.lineH)) continue;
        done.current.add(sig);
        const above = linesAbove(strokes, line);
        const crop = clampToPage(pad(above ? union(above, line.box) : line.box, 16), line.box);
        const img = crop.w > 8 && crop.h > 8 ? live.current.regionImage(crop) : null;
        if (!img) continue;
        setChecking(true);
        count("mathcheck.run");
        try {
          const c = await doubleCheck(normalizeMathCheck(await checkMathLine(img), crop, line.box), line.box);
          const ids = new Set(line.idx.map((i) => strokes[i].id).filter((x): x is string => !!x));
          // a newer version of this line replaces the marks on the old one
          let next = marksRef.current.filter((m) => { const l = lineIdsOf.current.get(m.id); return !l || ![...l].some((x) => ids.has(x)); });
          if (c.kind === "other") { put(next); continue; }
          const added: MathMark[] = c.ok
            ? [{ id: `ok:${sig}`, box: line.box, tone: "ok" }]
            : c.issues.map((x, k) => ({ id: `mc:${sig}:${k}`, box: x.box, tone: "issue" as const, note: x.note, fix: x.fix }));
          for (const m of added) lineIdsOf.current.set(m.id, ids);
          next = [...next, ...added];
          put(next);
          count(c.ok ? "mathcheck.ok" : "mathcheck.flagged");
          if (c.ok) setTimeout(() => put(marksRef.current.filter((m) => m.id !== `ok:${sig}`)), OK_TICK_MS);
        } catch (e) {
          done.current.delete(sig);
          if (e instanceof AiError && /key|budget|offline|turn them on/i.test(e.message)) { stopped.current = true; live.current.onFail(e.message); }
          else if (!(e instanceof AiError)) logError("mathcheck", e);
          count("mathcheck.failed");
        } finally { setChecking(false); }
      }
    } finally { busy.current = false; }
  }, [put]);

  const enqueue = useCallback((ids: string[]) => {
    for (const id of ids) if (!queue.current.includes(id)) queue.current.push(id);
    void pump();
  }, [pump]);

  /** Call with the full stroke list after every change (from the canvas's onCommit). */
  const onStrokes = useCallback((strokes: Stroke[]) => {
    if (!live.current.enabled) return;
    const ids = new Set(strokes.map((s) => s.id).filter((x): x is string => !!x));
    // erased part of a checked line: its marks go, and what's left of the line is looked at again
    if (marksRef.current.some((m) => [...(lineIdsOf.current.get(m.id) ?? new Set<string>())].some((x) => !ids.has(x)))) {
      put(marksRef.current.filter((m) => {
        const l = lineIdsOf.current.get(m.id);
        if (!l || [...l].every((x) => ids.has(x))) return true;
        const survivor = [...l].find((x) => ids.has(x));
        if (survivor) pending.current.add(survivor);
        lineIdsOf.current.delete(m.id);
        return false;
      }));
    }
    const fresh = strokes.filter((s) => s.id && !seen.current.has(s.id) && s.tool !== "highlighter");
    if (fresh.length) {
      for (const s of fresh) seen.current.add(s.id!);
      // started writing somewhere else: the line you left is finished, so check it now
      const cur = lineOf(strokes, strokes.lastIndexOf(fresh[fresh.length - 1]));
      const curIds = new Set(cur.idx.map((i) => strokes[i].id));
      const left = [...pending.current].filter((id) => !curIds.has(id));
      for (const id of left) pending.current.delete(id);
      for (const s of fresh) pending.current.add(s.id!);
      if (left.length) enqueue(left);
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { const p = [...pending.current]; pending.current.clear(); enqueue(p); }, IDLE_MS);
  }, [enqueue, put]);

  const dismiss = useCallback((id: string) => { count("mathcheck.dismissed"); lineIdsOf.current.delete(id); put(marksRef.current.filter((m) => m.id !== id)); }, [put]);

  return { marks, checking, onStrokes, dismiss };
}
