import { useEffect, useMemo, useRef, useState } from "react";
import { Minus, Plus, RotateCcw } from "lucide-react";
import { DEFAULT_VIEW, DEFAULT_VIEW3D, GRAPH_COLORS, drawGraph2D, drawSurface, is3D, parseRows, type View2D, type View3D } from "@/lib/graph-render";

const HEIGHT = 300;

/** Plots the expression rows of a graph block. Drag pans (2D) / rotates (3D); pinch or +/- zooms. */
export function GraphCanvas({ text, width, interactive, onEdit }: { text: string; width: number; interactive: boolean; onEdit?: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const rows = useMemo(() => parseRows(text), [text]);
  const three = is3D(rows);
  const [v2, setV2] = useState<View2D>(DEFAULT_VIEW);
  const [v3, setV3] = useState<View3D>(DEFAULT_VIEW3D);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<number | null>(null);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = Math.round(width * dpr); c.height = Math.round(HEIGHT * dpr);
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const dark = window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
    if (three) drawSurface(ctx, width, HEIGHT, rows, v3, dark); else drawGraph2D(ctx, width, HEIGHT, rows, v2, dark);
  }, [rows, three, v2, v3, width]);

  const zoom = (f: number) => (three ? setV3((v) => ({ ...v, range: Math.min(50, Math.max(1, v.range / f)) })) : setV2((v) => ({ ...v, scale: Math.min(4000, Math.max(2, v.scale * f)) })));
  const reset = () => { setV2(DEFAULT_VIEW); setV3(DEFAULT_VIEW3D); };

  const onDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    pinch.current = null;
  };
  const onMove = (e: React.PointerEvent) => {
    const p = pointers.current.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch.current) zoom(d / pinch.current);
      pinch.current = d;
      return;
    }
    if (three) setV3((v) => ({ ...v, yaw: v.yaw - dx * 0.01, pitch: Math.min(1.5, Math.max(-0.2, v.pitch + dy * 0.01)) }));
    else setV2((v) => ({ ...v, cx: v.cx - dx / v.scale, cy: v.cy + dy / v.scale }));
  };
  const onUp = (e: React.PointerEvent) => { pointers.current.delete(e.pointerId); pinch.current = null; };

  const errors = rows.filter((r) => r.error);
  return (
    <div>
      <div className="relative" style={{ height: HEIGHT }}>
        <canvas ref={ref} style={{ width, height: HEIGHT, touchAction: "none", pointerEvents: interactive ? "auto" : "none" }}
          onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
          onWheel={(e) => zoom(e.deltaY < 0 ? 1.15 : 1 / 1.15)} onDoubleClick={reset} />
        <div className="absolute right-2 top-2 flex gap-1" style={{ pointerEvents: "auto" }}>
          {[[Plus, () => zoom(1.4), "Zoom in"], [Minus, () => zoom(1 / 1.4), "Zoom out"], [RotateCcw, reset, "Reset view"]].map(([I, fn, t], k) => {
            const Icon = I as typeof Plus;
            return <button key={k} title={t as string} onClick={fn as () => void} className="rounded-md border border-border bg-surface/90 p-1.5 text-foreground-muted"><Icon size={14} /></button>;
          })}
        </div>
      </div>
      {rows.length > 0 && (
        <div className="flex cursor-text flex-wrap gap-x-4 gap-y-1 border-t border-border/70 px-4 py-2" style={{ fontSize: 15, pointerEvents: "auto" }} onClick={onEdit} title="Tap to edit the equations">
          {rows.map((r, i) => (
            <span key={i} className={r.error ? "text-negative" : "text-foreground-muted"}>
              <span style={{ color: r.error ? undefined : GRAPH_COLORS[i % GRAPH_COLORS.length] }}>●</span> {r.src}{r.error ? ` — ${r.error}` : ""}
            </span>
          ))}
        </div>
      )}
      {errors.length === 0 && rows.length === 0 && <div className="px-4 pb-3 text-foreground-muted" style={{ fontSize: 15 }}>One equation per line: y = x^2 + 3x, x^2 + y^2 = 25, z = sin(x) cos(y)</div>}
    </div>
  );
}
