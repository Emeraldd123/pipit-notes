import { useEffect, useMemo, useRef, useState } from "react";
import katex from "katex";
import { Check, Code2, LineChart, Loader2, Pencil, Play, Sigma, Trash2, Type } from "lucide-react";
import { GraphCanvas } from "./graph-canvas";
import type { BlockRec } from "@/types";

export function Latex({ source, display = true, className = "" }: { source: string; display?: boolean; className?: string }) {
  const html = useMemo(() => {
    try {
      return katex.renderToString(source || "\\;", { displayMode: display, throwOnError: false, output: "html" });
    } catch {
      return null;
    }
  }, [source, display]);
  if (html === null) return <code className={className}>{source}</code>;
  return <span className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}

/** Plain text with $inline$ and $$display$$ maths rendered via KaTeX. */
export function RichText({ text, className = "" }: { text: string; className?: string }) {
  const parts = useMemo(() => text.split(/(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$)/g), [text]);
  return (
    <span className={`whitespace-pre-wrap ${className}`}>
      {parts.map((p, i) =>
        p.startsWith("$$") && p.endsWith("$$") && p.length > 4 ? <Latex key={i} source={p.slice(2, -2)} display />
        : p.startsWith("$") && p.endsWith("$") && p.length > 2 ? <Latex key={i} source={p.slice(1, -1)} display={false} />
        : <span key={i}>{p}</span>
      )}
    </span>
  );
}

export const BLOCK_DEFAULTS: Record<BlockRec["kind"], { width: number; height: number }> = {
  code: { width: 620, height: 220 },
  text: { width: 520, height: 120 },
  math: { width: 520, height: 110 },
  graph: { width: 560, height: 380 },
};

/**
 * Overlay of blocks positioned in DOCUMENT coordinates. The parent applies the
 * camera transform straight to `innerRef` (no React state per frame). Blocks never
 * eat pen input — only their header controls (and, in block mode, their text areas)
 * take pointer events.
 */
export function BlocksLayer({
  blocks, innerRef, interactive, scaleRef, running, onChange, onDelete, onRun,
}: {
  blocks: BlockRec[];
  innerRef: React.RefObject<HTMLDivElement | null>;
  interactive: boolean;
  scaleRef: React.RefObject<number>;
  running: string | null;
  onChange: (b: BlockRec) => void;
  onDelete: (id: string) => void;
  onRun: (b: BlockRec) => void;
}) {
  return (
    <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
      <div ref={innerRef} className="absolute left-0 top-0" style={{ transformOrigin: "0 0" }}>
        {blocks.map((b) => (
          <BlockView key={b.id} b={b} interactive={interactive} scaleRef={scaleRef} running={running === b.id} onChange={onChange} onDelete={onDelete} onRun={onRun} />
        ))}
      </div>
    </div>
  );
}

function BlockView({
  b, interactive, scaleRef, running, onChange, onDelete, onRun,
}: {
  b: BlockRec; interactive: boolean; scaleRef: React.RefObject<number>; running: boolean;
  onChange: (b: BlockRec) => void; onDelete: (id: string) => void; onRun: (b: BlockRec) => void;
}) {
  const [editing, setEditing] = useState((b.kind !== "math" && b.kind !== "graph") || !b.text || (b.kind === "graph" && Date.now() - b.createdAt < 5000));
  const drag = useRef<{ sx: number; sy: number; x: number; y: number } | null>(null);
  const size = useRef<{ sx: number; sy: number; w: number; h: number } | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const bRef = useRef(b);
  useEffect(() => { bRef.current = b; }, [b]);

  // Grow the text area to fit its content so blocks never scroll internally.
  useEffect(() => {
    const ta = taRef.current;
    if (ta) { ta.style.height = "0px"; ta.style.height = `${ta.scrollHeight}px`; }
  }, [b.text, editing, b.width]);

  const Icon = b.kind === "code" ? Code2 : b.kind === "math" ? Sigma : b.kind === "graph" ? LineChart : Type;
  const label = b.kind === "code" ? "Python" : b.kind === "math" ? "Math" : b.kind === "graph" ? "Graph" : "Text";
  const border = b.kind === "text" ? "border-transparent hover:border-border" : "border-border";

  const onDragDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { sx: e.clientX, sy: e.clientY, x: b.x, y: b.y };
  };
  const onDragMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const s = scaleRef.current || 1;
    onChange({ ...bRef.current, x: drag.current.x + (e.clientX - drag.current.sx) / s, y: drag.current.y + (e.clientY - drag.current.sy) / s });
  };
  const onDragUp = (e: React.PointerEvent) => {
    drag.current = null;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* */ }
  };
  const onSizeDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    size.current = { sx: e.clientX, sy: e.clientY, w: b.width, h: b.height };
  };
  const onSizeMove = (e: React.PointerEvent) => {
    if (!size.current) return;
    const s = scaleRef.current || 1;
    onChange({ ...bRef.current, width: Math.max(220, size.current.w + (e.clientX - size.current.sx) / s) });
  };
  const onSizeUp = (e: React.PointerEvent) => {
    size.current = null;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* */ }
  };

  const fontPx = b.kind === "code" || b.kind === "graph" ? 22 : 26;
  const pe = interactive ? "auto" : "none";

  return (
    <div
      className={`absolute rounded-xl border bg-surface/95 shadow-md backdrop-blur-[1px] ${border}`}
      style={{ left: b.x, top: b.y, width: b.width, pointerEvents: "none", fontSize: fontPx }}
    >
      {/* header: always tappable so Run / move / delete work with any tool */}
      <div className="flex items-center gap-2 rounded-t-xl border-b border-border/70 bg-surface-secondary/80 px-3" style={{ height: 44, pointerEvents: "auto", touchAction: "none" }}>
        <span onPointerDown={onDragDown} onPointerMove={onDragMove} onPointerUp={onDragUp} onPointerCancel={onDragUp}
          className="flex flex-1 cursor-grab items-center gap-2 text-foreground-muted" style={{ fontSize: 16, touchAction: "none" }} title="Drag to move">
          <Icon size={16} /> {label}
        </span>
        {b.kind === "code" && (
          <button onClick={() => onRun(b)} disabled={running}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1 text-white disabled:opacity-60" style={{ fontSize: 15 }}>
            {running ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />} Run
          </button>
        )}
        {(b.kind === "math" || b.kind === "graph") && (
          <button onClick={() => setEditing((v) => !v)} className="flex items-center gap-1 rounded-lg px-2 py-1 text-foreground-muted hover:bg-surface-secondary" style={{ fontSize: 15 }}>
            {editing ? <Check size={14} /> : <Pencil size={14} />} {editing ? "Done" : "Edit"}
          </button>
        )}
        <button onClick={() => onDelete(b.id)} className="rounded-lg p-1.5 text-foreground-muted hover:text-negative" title="Delete block"><Trash2 size={15} /></button>
      </div>

      <div style={{ pointerEvents: pe }}>
        {b.kind === "graph" && !editing ? null : b.kind === "math" && !editing ? (
          <div className="overflow-x-auto px-4 py-3" onDoubleClick={() => setEditing(true)}><Latex source={b.text} /></div>
        ) : (
          <textarea
            ref={taRef}
            value={b.text}
            onChange={(e) => onChange({ ...b, text: e.target.value })}
            spellCheck={b.kind === "text"}
            autoCapitalize="off"
            autoCorrect="off"
            placeholder={b.kind === "graph" ? "y = x^2 + 3x   (one equation per line)" : b.kind === "code" ? "# python — sympy, numpy, matplotlib available" : b.kind === "math" ? "LaTeX, e.g. \\frac{dy}{dx} = 2x + 3" : "Type here…"}
            className={`block w-full resize-none bg-transparent px-4 py-3 outline-none ${b.kind === "code" || b.kind === "graph" ? "font-mono" : ""}`}
            style={{ minHeight: 64, fontSize: fontPx, lineHeight: 1.45, userSelect: "text", WebkitUserSelect: "text", pointerEvents: b.kind === "graph" ? "auto" : pe, fontFamily: b.kind === "code" ? "ui-monospace, SFMono-Regular, Menlo, monospace" : undefined }}
          />
        )}
        {b.kind === "graph" && <GraphCanvas text={b.text} width={b.width} interactive={interactive} onEdit={() => setEditing(true)} />}
        {b.kind === "math" && editing && b.text && (
          <div className="overflow-x-auto border-t border-border/70 px-4 py-2 text-foreground-muted" style={{ fontSize: 22 }}><Latex source={b.text} /></div>
        )}
        {b.kind === "code" && (b.output || b.images?.length) ? (
          <div className="border-t border-border/70 bg-surface-secondary/60 px-4 py-3">
            {b.output ? <pre className="m-0 whitespace-pre-wrap break-words font-mono text-foreground" style={{ fontSize: 20 }}>{b.output}</pre> : null}
            {b.images?.map((src, i) => <img key={i} src={src} alt="plot" className="mt-2 max-w-full rounded-md bg-white" />)}
          </div>
        ) : null}
      </div>

      {/* width handle */}
      <div onPointerDown={onSizeDown} onPointerMove={onSizeMove} onPointerUp={onSizeUp} onPointerCancel={onSizeUp}
        className="absolute -bottom-3 -right-3 h-8 w-8 cursor-nwse-resize rounded-full border border-border bg-surface shadow" style={{ pointerEvents: "auto", touchAction: "none" }} title="Drag to resize" />
    </div>
  );
}
