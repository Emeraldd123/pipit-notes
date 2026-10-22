import type { ReactNode } from "react";

export function Wordmark({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const cls = size === "lg" ? "text-3xl" : size === "sm" ? "text-lg" : "text-2xl";
  return (
    <span className={`${cls} font-semibold leading-none tracking-tight`}>
      Pipit <span className="serif-i text-primary" style={{ fontSize: "1.12em" }}>Notes</span>
    </span>
  );
}

export function Button({
  children, onClick, variant = "secondary", disabled, title, className = "", type = "button",
}: {
  children: ReactNode; onClick?: () => void; variant?: "primary" | "secondary" | "ghost" | "danger";
  disabled?: boolean; title?: string; className?: string; type?: "button" | "submit";
}) {
  const base = "inline-flex items-center justify-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-medium transition-colors disabled:opacity-50";
  const v =
    variant === "primary" ? "bg-primary text-white hover:bg-primary-hover"
    : variant === "danger" ? "bg-negative/10 text-negative hover:bg-negative/20"
    : variant === "ghost" ? "text-foreground-muted hover:bg-surface-secondary"
    : "border border-border bg-surface hover:bg-surface-secondary";
  return <button type={type} title={title} disabled={disabled} onClick={onClick} className={`${base} ${v} ${className}`}>{children}</button>;
}

export function IconButton({
  children, onClick, title, active, danger, disabled, className = "",
}: { children: ReactNode; onClick?: () => void; title: string; active?: boolean; danger?: boolean; disabled?: boolean; className?: string }) {
  return (
    <button
      title={title} aria-label={title} onClick={onClick} disabled={disabled}
      className={`flex h-9 w-9 items-center justify-center rounded-lg transition-colors disabled:opacity-30 ${
        active ? "bg-primary text-white" : danger ? "text-negative hover:bg-negative/10" : "text-foreground-muted hover:bg-surface-secondary"
      } ${className}`}
    >
      {children}
    </button>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-border bg-surface shadow-[0_1px_2px_rgba(0,0,0,0.03)] ${className}`}>{children}</div>;
}

export function Modal({ title, onClose, children, wide }: { title: ReactNode; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-3 backdrop-blur-[2px] sm:items-center" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className={`max-h-[88vh] w-full overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl ${wide ? "max-w-3xl" : "max-w-md"} flex flex-col`}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <h2 className="text-base font-semibold">{title}</h2>
          <button onClick={onClose} className="rounded-md px-2 py-1 text-sm text-foreground-muted hover:bg-surface-secondary">Close</button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-5">{children}</div>
      </div>
    </div>
  );
}

export function Toast({ msg }: { msg: string | null }) {
  if (!msg) return null;
  return (
    <div className="safe-b pointer-events-none fixed bottom-5 left-1/2 z-[60] max-w-[90vw] -translate-x-1/2 rounded-xl bg-foreground px-4 py-2.5 text-sm text-background shadow-xl">
      {msg}
    </div>
  );
}
