import { useEffect, useRef } from "react";
import { Eraser, Undo2 } from "lucide-react";

type Pt = { x: number; y: number; p: number };

/** A small scratch pad for handwritten exam answers (pen, finger or mouse). Reports a PNG data URL. */
export function InkPad({ value, onChange, height = 220, lined = true }: { value?: string; onChange: (png: string | undefined) => void; height?: number; lined?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<Pt[][]>([]);
  const cur = useRef<Pt[] | null>(null);
  const size = useRef({ w: 0, h: height });

  const paint = () => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext("2d")!;
    const { w, h } = size.current;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    const dpr = c.width / (w || 1);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, w, h);
    if (lined) { ctx.strokeStyle = "#e5e7eb"; ctx.lineWidth = 1; for (let y = 32; y < h; y += 32) { ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(w, y + 0.5); ctx.stroke(); } }
    ctx.strokeStyle = "#111827"; ctx.lineCap = "round"; ctx.lineJoin = "round";
    for (const s of [...strokes.current, ...(cur.current ? [cur.current] : [])]) {
      if (s.length === 1) { ctx.beginPath(); ctx.arc(s[0].x, s[0].y, 1.4, 0, 7); ctx.fillStyle = "#111827"; ctx.fill(); continue; }
      ctx.lineWidth = 2.4; ctx.beginPath(); ctx.moveTo(s[0].x, s[0].y);
      for (let i = 1; i < s.length - 1; i++) ctx.quadraticCurveTo(s[i].x, s[i].y, (s[i].x + s[i + 1].x) / 2, (s[i].y + s[i + 1].y) / 2);
      ctx.lineTo(s[s.length - 1].x, s[s.length - 1].y); ctx.stroke();
    }
  };

  useEffect(() => {
    const c = ref.current!;
    const fit = () => {
      const w = c.parentElement!.clientWidth, dpr = Math.min(window.devicePixelRatio || 1, 2);
      size.current = { w, h: height };
      c.width = Math.round(w * dpr); c.height = Math.round(height * dpr);
      c.style.width = `${w}px`; c.style.height = `${height}px`;
      paint();
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(c.parentElement!);
    return () => ro.disconnect();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [height]);

  const pt = (e: React.PointerEvent): Pt => {
    const r = ref.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, p: e.pressure || 0.5 };
  };
  const emit = () => onChange(strokes.current.length ? ref.current!.toDataURL("image/png") : undefined);

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-white">
      <canvas ref={ref} style={{ touchAction: "none", display: "block" }}
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); cur.current = [pt(e)]; paint(); }}
        onPointerMove={(e) => {
          if (!cur.current) return;
          const evs = (e.nativeEvent.getCoalescedEvents?.() as PointerEvent[] | undefined) ?? [];
          const r = ref.current!.getBoundingClientRect();
          for (const ev of evs.length ? evs : [e.nativeEvent]) cur.current.push({ x: ev.clientX - r.left, y: ev.clientY - r.top, p: ev.pressure || 0.5 });
          paint();
        }}
        onPointerUp={() => { if (cur.current) { strokes.current.push(cur.current); cur.current = null; paint(); emit(); } }}
        onPointerCancel={() => { cur.current = null; paint(); }} />
      <div className="flex items-center justify-between border-t border-border bg-surface px-2 py-1 text-xs text-foreground-muted">
        <span>{value ? "Handwriting will be read when you submit" : "Write your answer here"}</span>
        <span className="flex gap-1">
          <button onClick={() => { strokes.current.pop(); paint(); emit(); }} className="rounded-md p-1.5 hover:bg-surface-secondary" title="Undo"><Undo2 size={14} /></button>
          <button onClick={() => { strokes.current = []; paint(); emit(); }} className="rounded-md p-1.5 hover:bg-surface-secondary" title="Clear"><Eraser size={14} /></button>
        </span>
      </div>
    </div>
  );
}
