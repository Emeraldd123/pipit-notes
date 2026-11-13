import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Copy, FilePlus2, Trash2, X } from "lucide-react";

/** Renders a page preview only once it scrolls into view (long PDFs have hundreds of pages). */
function Thumb({ page, render, rev }: { page: number; render: (p: number) => string | null; rev: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [seen, setSeen] = useState(false);
  const renderRef = useRef(render);
  renderRef.current = render;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((e) => { if (e[0]?.isIntersecting) { setSeen(true); io.disconnect(); } }, { rootMargin: "200px" });
    io.observe(el);
    const fallback = setTimeout(() => { if (page < 8) setSeen(true); }, 300); // first few always render, even if the observer is throttled
    return () => { io.disconnect(); clearTimeout(fallback); };
  }, [page]);
  useEffect(() => {
    if (!seen) return;
    const id = setTimeout(() => { try { setSrc(renderRef.current(page)); } catch { setSrc(null); } }, 0);
    return () => clearTimeout(id);
  }, [seen, page, rev]);
  return (
    <div ref={ref} className="aspect-[1240/1754] w-full overflow-hidden rounded-md border border-border bg-white">
      {src && <img src={src} alt="" className="h-full w-full object-cover" draggable={false} />}
    </div>
  );
}

export function PagesPanel({ count, current, render, rev, onJump, onMove, onDuplicate, onInsertAfter, onDelete, onClose }: {
  count: number; current: number; render: (p: number) => string | null; rev: number;
  onJump: (p: number) => void; onMove: (from: number, to: number) => void; onDuplicate: (p: number) => void;
  onInsertAfter: (p: number) => void; onDelete: (p: number) => void; onClose: () => void;
}) {
  const activeRef = useRef<HTMLDivElement>(null);
  useEffect(() => { activeRef.current?.scrollIntoView({ block: "nearest" }); }, [current]);
  const btn = "rounded-md p-1 text-foreground-muted hover:bg-surface-secondary disabled:opacity-30 [@media(pointer:coarse)]:p-2.5";
  return (
    <aside className="absolute bottom-0 right-0 top-0 z-30 flex w-44 flex-col [@media(pointer:coarse)]:w-60 border-l border-border bg-surface/95 shadow-xl backdrop-blur">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-xs font-semibold">Pages · {count}</span>
        <button onClick={onClose} className="tap rounded-md p-1 text-foreground-muted hover:bg-surface-secondary" title="Close" aria-label="Close page thumbnails"><X size={14} /></button>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-auto overscroll-contain p-2.5">
        {Array.from({ length: count }, (_, p) => (
          <div key={p} ref={p === current ? activeRef : undefined}>
            <button onClick={() => onJump(p)} className={`block w-full rounded-lg p-0.5 ${p === current ? "ring-2 ring-primary" : ""}`} title={`Go to page ${p + 1}`}>
              <Thumb page={p} render={render} rev={rev} />
            </button>
            <div className="mt-1 flex items-center justify-between">
              <span className="text-[11px] text-foreground-muted">{p + 1}</span>
              <span className="flex">
                <button className={btn} disabled={p === 0} onClick={() => onMove(p, p - 1)} title="Move up" aria-label={`Move up: page ${p + 1}`}><ArrowUp size={13} /></button>
                <button className={btn} disabled={p === count - 1} onClick={() => onMove(p, p + 1)} title="Move down" aria-label={`Move down: page ${p + 1}`}><ArrowDown size={13} /></button>
                <button className={btn} onClick={() => onDuplicate(p)} title="Duplicate this page" aria-label={`Duplicate this page: page ${p + 1}`}><Copy size={13} /></button>
                <button className={btn} onClick={() => onInsertAfter(p)} title="Insert a blank page after" aria-label={`Insert a blank page after: page ${p + 1}`}><FilePlus2 size={13} /></button>
                <button className={`${btn} hover:text-negative`} disabled={count <= 1} onClick={() => onDelete(p)} title="Delete this page" aria-label={`Delete this page: page ${p + 1}`}><Trash2 size={13} /></button>
              </span>
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}
