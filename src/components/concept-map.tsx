import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { branchIndex, masteryColor, type ConceptMap, type EdgeKind, type MapNode, type NodeStats } from "@/lib/map-core";

export type Sel = { type: "node" | "edge"; id: string } | null;
const BRANCH = ["#2563eb", "#16a34a", "#d97706", "#9333ea", "#db2777", "#0891b2", "#dc2626", "#65a30d"];
export const EDGE_COLOR: Record<EdgeKind, string> = { part: "#6b7280", cause: "#dc2626", contrast: "#ea580c", example: "#0891b2", prereq: "#2563eb", other: "#9ca3af" };
const H = 40;
const nodeW = (n: MapNode) => Math.max(96, Math.round(n.label.length * 8.4 + 30));

type VB = { x: number; y: number; w: number; h: number };

function fitBox(nodes: MapNode[], aspect: number): VB {
  if (!nodes.length) return { x: -300, y: -200, w: 600, h: 400 };
  const xs0 = Math.min(...nodes.map((n) => n.x - nodeW(n) / 2)), xs1 = Math.max(...nodes.map((n) => n.x + nodeW(n) / 2));
  const ys0 = Math.min(...nodes.map((n) => n.y - H / 2)), ys1 = Math.max(...nodes.map((n) => n.y + H / 2));
  let w = xs1 - xs0 + 120, h = ys1 - ys0 + 100;
  if (w / h < aspect) w = h * aspect; else h = w / aspect;
  return { x: (xs0 + xs1) / 2 - w / 2, y: (ys0 + ys1) / 2 - h / 2, w, h };
}

/** Where the line from a box's centre toward (tx, ty) leaves the box. */
function edgePoint(n: MapNode, tx: number, ty: number) {
  const dx = tx - n.x, dy = ty - n.y;
  if (!dx && !dy) return { x: n.x, y: n.y };
  const t = Math.min(dx ? nodeW(n) / 2 / Math.abs(dx) : Infinity, dy ? H / 2 / Math.abs(dy) : Infinity);
  return { x: n.x + dx * t, y: n.y + dy * t };
}

export function ConceptMapView({
  map, onChange, selected, onSelect, stats, colorMode, matches, connectFrom, onPick, fitSignal, svgRef, hidden,
}: {
  map: ConceptMap; onChange: (m: ConceptMap) => void; selected: Sel; onSelect: (s: Sel) => void;
  stats: Map<string, NodeStats>; colorMode: "branch" | "mastery"; matches: Set<string> | null; connectFrom: string | null;
  onPick: (nodeId: string) => void; fitSignal: number; svgRef: React.RefObject<SVGSVGElement | null>; hidden?: Set<string>;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [vb, setVb] = useState<VB>(() => fitBox(map.nodes, 1.5));
  const branch = useMemo(() => branchIndex(map), [map]);
  const byId = useMemo(() => new Map(map.nodes.map((n) => [n.id, n])), [map.nodes]);
  const mapRef = useRef(map); mapRef.current = map;
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<null | { kind: "pan"; sx: number; sy: number; vb: VB } | { kind: "node"; id: string; moved: boolean; sx: number; sy: number; ox: number; oy: number } | { kind: "pinch"; dist: number; vb: VB }>(null);

  const refit = useCallback(() => {
    const r = wrap.current?.getBoundingClientRect();
    setVb(fitBox(mapRef.current.nodes, r && r.height ? r.width / r.height : 1.5));
  }, []);
  useEffect(() => { refit(); }, [fitSignal, refit]);

  const toSvg = (cx: number, cy: number) => {
    const svg = svgRef.current!;
    const pt = svg.createSVGPoint(); pt.x = cx; pt.y = cy;
    return pt.matrixTransform(svg.getScreenCTM()!.inverse());
  };
  const zoom = (f: number, cx: number, cy: number) => setVb((v) => {
    const p = toSvg(cx, cy);
    const nw = Math.min(8000, Math.max(160, v.w * f)), k = nw / v.w;
    return { x: p.x - (p.x - v.x) * k, y: p.y - (p.y - v.y) * k, w: nw, h: v.h * k };
  });

  const onDown = (e: React.PointerEvent) => {
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      gesture.current = { kind: "pinch", dist: Math.hypot(a.x - b.x, a.y - b.y), vb };
      return;
    }
    const nodeEl = (e.target as Element).closest("[data-node]") as HTMLElement | null;
    if (nodeEl) {
      const n = byId.get(nodeEl.dataset.node!)!;
      const p = toSvg(e.clientX, e.clientY);
      gesture.current = { kind: "node", id: n.id, moved: false, sx: e.clientX, sy: e.clientY, ox: n.x - p.x, oy: n.y - p.y };
    } else gesture.current = { kind: "pan", sx: e.clientX, sy: e.clientY, vb };
  };
  const onMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (!g) return;
    if (g.kind === "pinch" && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (g.dist > 0 && d > 0) { zoom(g.dist / d, (a.x + b.x) / 2, (a.y + b.y) / 2); g.dist = d; }
      return;
    }
    if (g.kind === "pan") {
      const r = svgRef.current!.getBoundingClientRect();
      const k = g.vb.w / r.width;
      setVb({ ...g.vb, x: g.vb.x - (e.clientX - g.sx) * k, y: g.vb.y - (e.clientY - g.sy) * k });
    } else if (g.kind === "node") {
      if (!g.moved && Math.hypot(e.clientX - g.sx, e.clientY - g.sy) < 5) return;
      g.moved = true;
      const p = toSvg(e.clientX, e.clientY);
      const m = mapRef.current;
      onChange({ ...m, nodes: m.nodes.map((n) => (n.id === g.id ? { ...n, x: Math.round(p.x + g.ox), y: Math.round(p.y + g.oy) } : n)) });
    }
  };
  const onUp = (e: React.PointerEvent) => {
    const g = gesture.current;
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 0) gesture.current = null;
    if (!g) return;
    if (g.kind === "node" && !g.moved) { if (connectFrom) onPick(g.id); else onSelect({ type: "node", id: g.id }); }
    else if (g.kind === "pan" && Math.hypot(e.clientX - g.sx, e.clientY - g.sy) < 4) {
      const edgeEl = (e.target as Element).closest("[data-edge]") as HTMLElement | null;
      onSelect(edgeEl ? { type: "edge", id: edgeEl.dataset.edge! } : null);
    }
  };

  const fill = (n: MapNode) => {
    if (colorMode === "mastery") return masteryColor(stats.get(n.id));
    const b = branch.get(n.id) ?? -1;
    return b < 0 ? "#1f2937" : BRANCH[b % BRANCH.length];
  };

  return (
    <div ref={wrap} className="relative h-full w-full touch-none select-none overflow-hidden rounded-2xl border border-border bg-surface"
      onWheel={(e) => { e.preventDefault(); zoom(e.deltaY > 0 ? 1.12 : 1 / 1.12, e.clientX, e.clientY); }}>
      <svg ref={svgRef} viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} className="h-full w-full" style={{ touchAction: "none" }}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} fontFamily="ui-sans-serif, system-ui, sans-serif">
        <defs>
          {(Object.keys(EDGE_COLOR) as EdgeKind[]).map((k) => (
            <marker key={k} id={`arr-${k}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill={EDGE_COLOR[k]} /></marker>
          ))}
        </defs>
        {map.edges.map((e) => {
          const a = byId.get(e.from), b = byId.get(e.to);
          if (!a || !b || hidden?.has(a.id) || hidden?.has(b.id)) return null;
          const p1 = edgePoint(a, b.x, b.y), p2 = edgePoint(b, a.x, a.y);
          const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
          const sel = selected?.type === "edge" && selected.id === e.id;
          const dim = matches && !(matches.has(a.id) || matches.has(b.id));
          const w = Math.max(40, e.label.length * 6.6 + 12);
          return (
            <g key={e.id} data-edge={e.id} opacity={dim ? 0.2 : 1} style={{ cursor: "pointer" }}>
              <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke="transparent" strokeWidth={16} />
              <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke={EDGE_COLOR[e.kind]} strokeWidth={sel ? 3.5 : 2} strokeDasharray={e.kind === "contrast" ? "7 5" : undefined} markerEnd={`url(#arr-${e.kind})`} />
              <rect x={mx - w / 2} y={my - 9} width={w} height={18} rx={9} fill="var(--surface)" stroke={sel ? EDGE_COLOR[e.kind] : "var(--border)"} />
              <text x={mx} y={my + 4} textAnchor="middle" fontSize={11.5} fill="var(--foreground)">{e.label}</text>
            </g>
          );
        })}
        {map.nodes.map((n) => {
          if (hidden?.has(n.id)) return null;
          const w = nodeW(n), st = stats.get(n.id);
          const sel = selected?.type === "node" && selected.id === n.id;
          const dim = matches && !matches.has(n.id);
          return (
            <g key={n.id} data-node={n.id} transform={`translate(${n.x},${n.y})`} opacity={dim ? 0.22 : 1} style={{ cursor: "grab" }}>
              <title>{n.note ?? n.label}</title>
              {connectFrom === n.id && <rect x={-w / 2 - 5} y={-H / 2 - 5} width={w + 10} height={H + 10} rx={H / 2 + 5} fill="none" stroke="var(--primary)" strokeWidth={3} strokeDasharray="6 4" />}
              <rect x={-w / 2} y={-H / 2} width={w} height={H} rx={H / 2} fill={fill(n)} stroke={sel ? "var(--foreground)" : colorMode === "mastery" && st && st.mistakes > 0 ? "#dc2626" : "var(--surface)"} strokeWidth={sel ? 4 : st && st.mistakes > 0 && colorMode === "mastery" ? 4 : 2.5} />
              <text y={5} textAnchor="middle" fontSize={14} fontWeight={600} fill="#fff" style={{ pointerEvents: "none" }}>{n.label}</text>
              {colorMode === "mastery" && st && st.due > 0 && <g transform={`translate(${w / 2 - 6},${-H / 2 + 2})`}><circle r={10} fill="#dc2626" stroke="var(--surface)" strokeWidth={2} /><text y={4} textAnchor="middle" fontSize={11} fontWeight={700} fill="#fff">{st.due}</text></g>}
              {colorMode === "mastery" && st && st.mistakes > 0 && <g transform={`translate(${-w / 2 + 6},${-H / 2 + 2})`}><circle r={10} fill="#fff" stroke="#dc2626" strokeWidth={2} /><text y={4} textAnchor="middle" fontSize={12} fontWeight={800} fill="#dc2626">!</text></g>}
            </g>
          );
        })}
      </svg>
      <div className="absolute bottom-3 right-3 flex flex-col gap-1.5">
        {[["+", 1 / 1.3], ["−", 1.3]].map(([l, f]) => (
          <button key={l as string} onClick={() => { const r = wrap.current!.getBoundingClientRect(); zoom(f as number, r.left + r.width / 2, r.top + r.height / 2); }} className="h-9 w-9 rounded-lg border border-border bg-surface text-lg shadow">{l as string}</button>
        ))}
        <button onClick={refit} className="h-9 w-9 rounded-lg border border-border bg-surface text-xs shadow" title="Fit to screen">Fit</button>
      </div>
    </div>
  );
}
