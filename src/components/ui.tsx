import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export function Wordmark({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const cls = size === "lg" ? "text-3xl" : size === "sm" ? "text-lg" : "text-2xl";
  return (
    <span className={`${cls} font-semibold leading-none tracking-tight`}>
      Pipit <span className="serif-i text-primary" style={{ fontSize: "1.12em" }}>Notes</span>
    </span>
  );
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

/** The look of <Button>, for the few places that need it on another element (a menu trigger). */
export function buttonClass(variant: ButtonVariant = "secondary") {
  const base = "inline-flex items-center justify-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-medium disabled:opacity-50 [@media(pointer:coarse)]:min-h-11";
  const v =
    variant === "primary" ? "bg-primary text-white hover:bg-primary-hover"
    : variant === "danger" ? "bg-negative/10 text-negative hover:bg-negative/20"
    : variant === "ghost" ? "text-foreground-muted hover:bg-surface-secondary"
    : "border border-border bg-surface hover:bg-surface-secondary";
  return `${base} ${v}`;
}

export function Button({
  children, onClick, variant = "secondary", disabled, title, className = "", type = "button", ariaLabel, ref,
}: {
  children: ReactNode; onClick?: () => void; variant?: ButtonVariant;
  disabled?: boolean; title?: string; className?: string; type?: "button" | "submit"; ariaLabel?: string; ref?: React.Ref<HTMLButtonElement>;
}) {
  return <button ref={ref} type={type} title={title} aria-label={ariaLabel} disabled={disabled} onClick={onClick} className={`${buttonClass(variant)} ${className}`}>{children}</button>;
}

/**
 * Press and hold (finger or Pencil) on an icon-only control to see its name, without activating it.
 * A mouse already gets the native `title` tooltip, so this only listens to touch and pen.
 */
export function useHoldLabel(label: string) {
  const [at, setAt] = useState<{ x: number; y: number; place: "right" | "left" | "below" } | null>(null);
  const timer = useRef(0);
  const hide = useRef(0);
  const held = useRef(false);
  useEffect(() => () => { clearTimeout(timer.current); clearTimeout(hide.current); }, []);
  const end = () => {
    clearTimeout(timer.current);
    if (held.current) { clearTimeout(hide.current); hide.current = window.setTimeout(() => setAt(null), 700); }
  };
  const handlers = {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      if (e.pointerType === "mouse") return;
      held.current = false;
      const el = e.currentTarget;
      clearTimeout(timer.current); clearTimeout(hide.current);
      timer.current = window.setTimeout(() => {
        held.current = true;
        const r = el.getBoundingClientRect();
        if (r.top < 72) setAt({ x: Math.min(Math.max(r.left + r.width / 2, 70), window.innerWidth - 70), y: r.bottom + 8, place: "below" });
        else if (r.left + r.width / 2 < window.innerWidth / 2) setAt({ x: r.right + 10, y: r.top + r.height / 2, place: "right" });
        else setAt({ x: r.left - 10, y: r.top + r.height / 2, place: "left" });
      }, 450);
    },
    onPointerUp: end, onPointerLeave: end, onPointerCancel: end,
    onContextMenu: (e: React.MouseEvent) => { if (held.current) e.preventDefault(); },
  };
  /** true when the press that just ended was a hold: the caller skips its click */
  const wasHeld = () => { const h = held.current; held.current = false; return h; };
  const bubble = at && createPortal(
    <span role="tooltip" className="anim-fade pointer-events-none fixed z-[70] max-w-[15rem] rounded-lg bg-foreground px-2.5 py-1.5 text-xs font-medium text-background shadow-lg"
      style={{ left: at.x, top: at.y, transform: at.place === "below" ? "translateX(-50%)" : at.place === "right" ? "translateY(-50%)" : "translate(-100%, -50%)" }}>{label}</span>,
    document.body,
  );
  return { handlers, wasHeld, bubble };
}

export function IconButton({
  children, onClick, title, active, danger, disabled, className = "",
}: { children: ReactNode; onClick?: () => void; title: string; active?: boolean; danger?: boolean; disabled?: boolean; className?: string }) {
  const hold = useHoldLabel(title);
  return (
    <>
      <button
        type="button" title={title} aria-label={title} aria-pressed={active} disabled={disabled}
        onClick={() => { if (!hold.wasHeld()) onClick?.(); }} {...hold.handlers}
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg disabled:opacity-30 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11 ${
          active ? "bg-primary text-white" : danger ? "text-negative hover:bg-negative/10" : "text-foreground-muted hover:bg-surface-secondary"
        } ${className}`}
      >
        {children}
      </button>
      {hold.bubble}
    </>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-border bg-surface shadow-[0_1px_2px_rgba(0,0,0,0.03)] ${className}`}>{children}</div>;
}

export function Modal({ title, onClose, children, wide }: { title: ReactNode; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") close.current(); };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, []);
  return (
    <div className="anim-fade fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-[2px] sm:items-center" onClick={onClose}>
      <div
        role="dialog" aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className={`anim-rise max-h-[88dvh] w-full overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl ${wide ? "max-w-3xl" : "max-w-md"} flex flex-col`}
      >
        <div className="flex items-center justify-between gap-3 border-b border-border py-2 pl-5 pr-2.5">
          <h2 className="min-w-0 py-1.5 text-base font-semibold [overflow-wrap:anywhere]">{title}</h2>
          <button type="button" onClick={onClose} className="shrink-0 rounded-lg px-2.5 py-1.5 text-sm text-foreground-muted hover:bg-surface-secondary [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:px-3.5">Close</button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto overscroll-contain p-5">{children}</div>
      </div>
    </div>
  );
}

export type DropItem = { icon?: ReactNode; label: string; hint?: string; onClick: () => void; danger?: boolean; active?: boolean; divider?: boolean };

/**
 * A button that opens a short list of labelled actions. The panel is portalled and `fixed`, so a scrolling or
 * clipping parent can't cut it off; it opens upward when the button sits low on the screen and grows from the button.
 */
export function DropMenu({ children, items, label, title, triggerClass = buttonClass(), width = 264, align = "right", disabled }: {
  children: ReactNode; items: DropItem[]; label: string; title?: string; triggerClass?: string; width?: number; align?: "left" | "right"; disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number; maxH: number; origin: string } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!open) { setPos(null); return; }
    const r = btn.current!.getBoundingClientRect();
    const w = Math.min(width, window.innerWidth - 16);
    const left = Math.min(Math.max(8, align === "right" ? r.right - w : r.left), window.innerWidth - w - 8);
    const ox = align === "right" ? "right" : "left";
    if (r.bottom > window.innerHeight * 0.6) setPos({ left, bottom: window.innerHeight - r.top + 6, maxH: r.top - 14, origin: `bottom ${ox}` });
    else setPos({ left, top: r.bottom + 6, maxH: window.innerHeight - r.bottom - 14, origin: `top ${ox}` });
    const inside = (t: EventTarget | null) => !!panel.current?.contains(t as Node) || !!btn.current?.contains(t as Node);
    const away = (e: Event) => { if (!inside(e.target)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); btn.current?.focus(); } };
    const shut = () => setOpen(false);
    // the panel is fixed, so if the page scrolls the button out from under it, close rather than float detached
    const moved = (e: Event) => {
      if (inside(e.target) || !btn.current) return;
      const n = btn.current.getBoundingClientRect();
      if (Math.abs(n.top - r.top) > 4 || Math.abs(n.left - r.left) > 4) setOpen(false);
    };
    document.addEventListener("pointerdown", away, true);
    document.addEventListener("scroll", moved, true);
    document.addEventListener("keydown", esc);
    window.addEventListener("resize", shut);
    return () => {
      document.removeEventListener("pointerdown", away, true);
      document.removeEventListener("scroll", moved, true);
      document.removeEventListener("keydown", esc);
      window.removeEventListener("resize", shut);
    };
  }, [open, width, align]);
  return (
    <>
      <button ref={btn} type="button" title={title} aria-label={label} aria-haspopup="menu" aria-expanded={open} disabled={disabled} onClick={() => setOpen((v) => !v)} className={triggerClass}>{children}</button>
      {open && pos && createPortal(
        <div ref={panel} role="menu" aria-label={label} className="anim-pop fixed z-[60] overflow-auto overscroll-contain rounded-2xl border border-border bg-surface p-1.5 text-foreground shadow-2xl"
          style={{ left: pos.left, top: pos.top, bottom: pos.bottom, width: Math.min(width, window.innerWidth - 16), maxHeight: pos.maxH, transformOrigin: pos.origin }}>
          {items.map((it, i) => (
            <div key={i}>
              {it.divider && <div className="mx-1 my-1 h-px bg-border" />}
              <button type="button" role="menuitem" onClick={() => { setOpen(false); it.onClick(); }}
                className={`flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left text-sm hover:bg-surface-secondary [@media(pointer:coarse)]:min-h-11 ${it.danger ? "text-negative" : it.active ? "bg-primary/10 text-primary" : ""}`}>
                {it.icon && <span className={`flex h-7 w-7 shrink-0 items-center justify-center ${it.danger ? "text-negative" : it.active ? "text-primary" : "text-foreground-muted"}`}>{it.icon}</span>}
                <span className="min-w-0"><span className="block font-medium">{it.label}</span>{it.hint && <span className="block text-xs font-normal text-foreground-muted">{it.hint}</span>}</span>
              </button>
            </div>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}

export function Toast({ msg, action }: { msg: string | null; action?: { label: string; onClick: () => void } | null }) {
  if (!msg) return null;
  return (
    <div role="status" aria-live="polite" className={`anim-rise fixed bottom-[calc(1.25rem+env(safe-area-inset-bottom,0px))] left-1/2 z-[60] flex w-max max-w-[min(90vw,34rem)] -translate-x-1/2 items-center gap-3 rounded-xl bg-foreground px-4 py-2.5 text-sm text-background shadow-xl ${action ? "" : "pointer-events-none"}`}>
      <span className="min-w-0 [overflow-wrap:anywhere]">{msg}</span>
      {action && <button type="button" onClick={action.onClick} className="shrink-0 rounded-md px-2 py-1 font-semibold underline decoration-dotted underline-offset-2 [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:px-3">{action.label}</button>}
    </div>
  );
}
