import { useRef } from "react";
import { Move, RotateCw, X } from "lucide-react";
import { PX_PER_CM, lengthCm, type Segment } from "@/lib/guides";

export type Cam = { scale: number; camX: number; camY: number };
export type ProtractorState = { cx: number; cy: number; rot: number }; // rot in radians; 0 = flat edge along +x, arc above

/**
 * Ruler + protractor, drawn in SCREEN space (so handles stay finger-sized at any zoom) and
 * positioned from document coordinates + the camera. Only the handles take touch — the body
 * is click-through, so the pen can draw right up against the ruler edge.
 */
export function DrawingAids({ cam, ruler, protractor, onRuler, onProtractor, onCloseRuler, onCloseProtractor }: {
  cam: Cam; ruler: Segment | null; protractor: ProtractorState | null;
  onRuler: (r: Segment) => void; onProtractor: (p: ProtractorState) => void; onCloseRuler: () => void; onCloseProtractor: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const toScreen = (x: number, y: number) => ({ x: (x - cam.camX) * cam.scale, y: (y - cam.camY) * cam.scale });
  const toDoc = (cx: number, cy: number) => {
    const r = root.current!.getBoundingClientRect();
    return { x: cam.camX + (cx - r.left) / cam.scale, y: cam.camY + (cy - r.top) / cam.scale };
  };
  // generic drag helper: calls move(docPoint) while the pointer is down
  const drag = (move: (p: { x: number; y: number }) => void) => (e: React.PointerEvent) => {
    e.stopPropagation(); e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const mv = (ev: PointerEvent) => move(toDoc(ev.clientX, ev.clientY));
    const up = () => { el.removeEventListener("pointermove", mv); el.removeEventListener("pointerup", up); el.removeEventListener("pointercancel", up); };
    el.addEventListener("pointermove", mv); el.addEventListener("pointerup", up); el.addEventListener("pointercancel", up);
  };
  const handle = "pointer-events-auto absolute flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-primary bg-surface/95 text-primary shadow-lg";

  return (
    <div ref={root} className="pointer-events-none absolute inset-0 z-[12] overflow-hidden">
      {ruler && <RulerView cam={cam} g={ruler} toScreen={toScreen} drag={drag} onChange={onRuler} onClose={onCloseRuler} handle={handle} />}
      {protractor && <ProtractorView cam={cam} p={protractor} toScreen={toScreen} drag={drag} onChange={onProtractor} onClose={onCloseProtractor} handle={handle} />}
    </div>
  );
}

type ViewProps<T> = {
  cam: Cam; toScreen: (x: number, y: number) => { x: number; y: number };
  drag: (move: (p: { x: number; y: number }) => void) => (e: React.PointerEvent) => void; handle: string; onClose: () => void; onChange: (v: T) => void;
};

function RulerView({ cam, g, toScreen, drag, onChange, onClose, handle }: ViewProps<Segment> & { g: Segment }) {
  const a = toScreen(g.a.x, g.a.y), b = toScreen(g.b.x, g.b.y);
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  // the body hangs on the "down" side of the edge
  const [nx, ny] = ux >= 0 ? [-uy, ux] : [uy, -ux];
  const bodyH = Math.max(56, 2.4 * PX_PER_CM * cam.scale);
  const mm = (PX_PER_CM / 10) * cam.scale;
  const ticks: React.ReactNode[] = [];
  const total = Math.floor(lengthCm(g) * 10);
  const step = mm >= 4 ? 1 : mm >= 1.6 ? 5 : 10;
  for (let i = 0; i <= total; i += step) {
    const major = i % 10 === 0, mid = i % 5 === 0;
    const tl = major ? 0.34 : mid ? 0.24 : 0.14;
    const px = a.x + ux * i * mm, py = a.y + uy * i * mm;
    ticks.push(<line key={i} x1={px} y1={py} x2={px + nx * bodyH * tl} y2={py + ny * bodyH * tl} stroke="currentColor" strokeWidth={major ? 1.4 : 1} />);
    if (major && i > 0 && mm * 10 > 26) {
      ticks.push(<text key={`t${i}`} x={px + nx * bodyH * 0.55} y={py + ny * bodyH * 0.55} fontSize={13} textAnchor="middle" dominantBaseline="middle" fill="currentColor">{i / 10}</text>);
    }
  }
  const poly = `${a.x},${a.y} ${b.x},${b.y} ${b.x + nx * bodyH},${b.y + ny * bodyH} ${a.x + nx * bodyH},${a.y + ny * bodyH}`;
  const mid = { x: (a.x + b.x) / 2 + nx * bodyH * 0.72, y: (a.y + b.y) / 2 + ny * bodyH * 0.72 };
  return (
    <>
      <svg className="pointer-events-none absolute inset-0 h-full w-full text-foreground">
        <polygon points={poly} fill="rgba(250,204,21,0.28)" stroke="currentColor" strokeOpacity={0.55} strokeWidth={1.5} />
        {ticks}
      </svg>
      <div className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded bg-black/70 px-1.5 py-0.5 text-[11px] text-white" style={{ left: (a.x + b.x) / 2 + nx * bodyH * 0.9, top: (a.y + b.y) / 2 + ny * bodyH * 0.9 }}>{lengthCm(g).toFixed(1)} cm</div>
      <div className={handle} style={{ left: a.x, top: a.y, touchAction: "none" }} title="Drag to move this end" onPointerDown={drag((p) => onChange({ a: p, b: g.b }))}><RotateCw size={16} /></div>
      <div className={handle} style={{ left: b.x, top: b.y, touchAction: "none" }} title="Drag to move this end" onPointerDown={drag((p) => onChange({ a: g.a, b: p }))}><RotateCw size={16} /></div>
      <div className={handle} style={{ left: mid.x, top: mid.y, touchAction: "none" }} title="Drag to move the ruler"
        onPointerDown={dragBy(cam.scale, (dxd, dyd) => onChange({ a: { x: g.a.x + dxd, y: g.a.y + dyd }, b: { x: g.b.x + dxd, y: g.b.y + dyd } }))}><Move size={16} /></div>
      <button className="pointer-events-auto absolute -translate-x-1/2 rounded-full border border-border bg-surface p-1 text-foreground-muted shadow" style={{ left: b.x + ux * 28, top: b.y + uy * 28 - 14 }} onClick={onClose} title="Hide ruler"><X size={13} /></button>
    </>
  );
}

/** Drag helper that reports the pointer's movement since pointer-down, in document units. */
function dragBy(scale: number, apply: (dx: number, dy: number) => void) {
  return (e: React.PointerEvent) => {
    e.stopPropagation(); e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const sx = e.clientX, sy = e.clientY;
    const mv = (ev: PointerEvent) => apply((ev.clientX - sx) / scale, (ev.clientY - sy) / scale);
    const up = () => { el.removeEventListener("pointermove", mv); el.removeEventListener("pointerup", up); el.removeEventListener("pointercancel", up); };
    el.addEventListener("pointermove", mv); el.addEventListener("pointerup", up); el.addEventListener("pointercancel", up);
  };
}

function ProtractorView({ cam, p, toScreen, drag, onChange, onClose, handle }: ViewProps<ProtractorState> & { p: ProtractorState }) {
  const c = toScreen(p.cx, p.cy);
  const R = 5.2 * PX_PER_CM * cam.scale; // radius ≈ 5.2 cm
  const pt = (deg: number, r: number) => {
    const ang = p.rot - (deg * Math.PI) / 180; // 0° along the base to the right, increasing counter-clockwise
    return { x: c.x + Math.cos(ang) * r, y: c.y + Math.sin(ang) * r };
  };
  const els: React.ReactNode[] = [];
  for (let d = 0; d <= 180; d += 1) {
    const major = d % 10 === 0, mid = d % 5 === 0;
    const l = major ? 0.14 : mid ? 0.1 : 0.06;
    const s = pt(d, R), e = pt(d, R * (1 - l));
    els.push(<line key={d} x1={s.x} y1={s.y} x2={e.x} y2={e.y} stroke="currentColor" strokeWidth={major ? 1.3 : 0.8} />);
    if (major && R > 90) {
      const t = pt(d, R * 0.78);
      els.push(<text key={`t${d}`} x={t.x} y={t.y} fontSize={Math.max(10, Math.min(15, R / 14))} textAnchor="middle" dominantBaseline="middle" fill="currentColor">{d}</text>);
    }
  }
  const a0 = pt(0, R), a1 = pt(180, R);
  const top = pt(90, R + 34);
  return (
    <>
      <svg className="pointer-events-none absolute inset-0 h-full w-full text-foreground">
        <path d={`M ${a0.x} ${a0.y} A ${R} ${R} 0 0 0 ${a1.x} ${a1.y} Z`} fill="rgba(56,189,248,0.2)" stroke="currentColor" strokeOpacity={0.55} strokeWidth={1.5} />
        {els}
        <circle cx={c.x} cy={c.y} r={4} fill="currentColor" />
      </svg>
      <div className={handle} style={{ left: c.x, top: c.y, touchAction: "none" }} title="Drag to move the protractor"
        onPointerDown={dragBy(cam.scale, (dxd, dyd) => onChange({ ...p, cx: p.cx + dxd, cy: p.cy + dyd }))}><Move size={16} /></div>
      <div className={handle} style={{ left: top.x, top: top.y, touchAction: "none" }} title="Drag to rotate"
        onPointerDown={drag((q) => onChange({ ...p, rot: Math.atan2(q.y - p.cy, q.x - p.cx) + Math.PI / 2 }))}><RotateCw size={16} /></div>
      <button className="pointer-events-auto absolute -translate-x-1/2 rounded-full border border-border bg-surface p-1 text-foreground-muted shadow" style={{ left: c.x + 26, top: c.y + 26 }} onClick={onClose} title="Hide protractor"><X size={13} /></button>
    </>
  );
}
