import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * A button in the tool rail that opens a labelled panel next to it. The panel is positioned with `fixed`
 * coordinates so the rail's own scrolling can't clip it, and it opens toward the middle of the screen
 * whichever side the rail is on.
 */
export function RailPopover({ icon, title, active, side, children, width = 240 }: {
  icon: ReactNode; title: string; active?: boolean; side: "left" | "right";
  children: (close: () => void) => ReactNode; width?: number;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number; maxH: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const r = btn.current!.getBoundingClientRect();
    const horizontal = r.width > 0 && window.innerWidth < 768;           // phone-style top rail: open below
    const left = horizontal ? Math.min(Math.max(8, r.left), window.innerWidth - width - 8)
      : side === "left" ? r.right + 8 : r.left - width - 8;
    if (horizontal) setPos({ left, top: r.bottom + 6, maxH: window.innerHeight - r.bottom - 18 });
    // buttons in the lower half open UPWARD (anchored to the button's bottom) so the panel always fits on screen
    else if (r.top > window.innerHeight * 0.45) setPos({ left, bottom: Math.max(8, window.innerHeight - r.bottom), maxH: r.bottom - 12 });
    else setPos({ left, top: Math.max(8, r.top), maxH: window.innerHeight - r.top - 12 });
    const away = (e: PointerEvent) => { if (!panel.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", away, true);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", away, true); document.removeEventListener("keydown", esc); };
  }, [open, side, width]);

  return (
    <div>
      <button ref={btn} title={title} aria-label={title} aria-expanded={open} onClick={() => setOpen((v) => !v)}
        className={`flex h-9 w-9 items-center justify-center rounded-lg transition-colors [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11 ${active || open ? "bg-primary text-white" : "text-foreground-muted hover:bg-surface-secondary"}`}>
        {icon}
      </button>
      {open && pos && (
        <div ref={panel} className="fixed z-[60] overflow-auto rounded-2xl border border-border bg-surface p-1.5 shadow-2xl" style={{ left: pos.left, top: pos.top, bottom: pos.bottom, width, maxHeight: pos.maxH }}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export type MenuItem = { icon: ReactNode; label: string; hint?: string; active?: boolean; onClick: () => void; group?: string };

/** A labelled list of actions — recognition instead of recall (no guessing what an icon does). */
export function RailMenu({ icon, title, items, active, side }: { icon: ReactNode; title: string; items: MenuItem[]; active?: boolean; side: "left" | "right" }) {
  return (
    <RailPopover icon={icon} title={title} active={active} side={side}>
      {(close) => {
        let last: string | undefined;
        return (
          <div>
            <p className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wider text-foreground-muted">{title}</p>
            {items.map((it, i) => {
              const head = it.group && it.group !== last ? <p key={`g${i}`} className="px-2.5 pb-0.5 pt-2 text-[11px] font-semibold uppercase tracking-wider text-foreground-muted">{it.group}</p> : null;
              last = it.group ?? last;
              return (
                <div key={i}>
                  {head}
                  <button onClick={() => { it.onClick(); close(); }} className={`flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left text-sm hover:bg-surface-secondary [@media(pointer:coarse)]:py-3 ${it.active ? "bg-primary/10 text-primary" : ""}`}>
                    <span className={`flex h-7 w-7 shrink-0 items-center justify-center ${it.active ? "text-primary" : "text-foreground-muted"}`}>{it.icon}</span>
                    <span className="min-w-0"><span className="block font-medium">{it.label}</span>{it.hint && <span className="block text-xs text-foreground-muted">{it.hint}</span>}</span>
                  </button>
                </div>
              );
            })}
          </div>
        );
      }}
    </RailPopover>
  );
}
