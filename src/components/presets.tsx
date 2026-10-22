import { useState } from "react";
import { Bookmark, Plus, X } from "lucide-react";
import type { Preset } from "@/lib/settings";

/** Saved pen setups (tool + colour + width) — tap one to switch to it instantly. */
export function PresetsButton({ presets, onApply, onSave, onDelete }: {
  presets: Preset[]; onApply: (p: Preset) => void; onSave: () => void; onDelete: (i: number) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button title="Pen presets" aria-label="Pen presets" onClick={() => setOpen((v) => !v)}
        className={`flex h-9 w-9 items-center justify-center rounded-lg ${open ? "bg-primary text-white" : "text-foreground-muted hover:bg-surface-secondary"}`}><Bookmark size={17} /></button>
      {open && (
        <div className="absolute left-0 top-full z-40 mt-1 w-56 rounded-xl border border-border bg-surface p-2 text-sm shadow-xl md:left-full md:top-0 md:ml-2 md:mt-0">
          <p className="px-1 pb-1.5 text-xs text-foreground-muted">Tap a preset to use it</p>
          {presets.length === 0 && <p className="px-1 pb-2 text-xs text-foreground-muted">None yet. Set up a pen the way you like it, then save it.</p>}
          <div className="space-y-1">
            {presets.map((p, i) => (
              <div key={i} className="flex items-center gap-1">
                <button onClick={() => { onApply(p); setOpen(false); }} className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-surface-secondary">
                  <span className="rounded-full" style={{ background: p.color, width: Math.max(8, Math.min(p.width * 1.6, 18)), height: Math.max(8, Math.min(p.width * 1.6, 18)) }} />
                  <span className="truncate capitalize">{p.tool} · {p.width}</span>
                </button>
                <button onClick={() => onDelete(i)} className="rounded-md p-1 text-foreground-muted hover:text-negative" title="Remove"><X size={13} /></button>
              </div>
            ))}
          </div>
          <button onClick={onSave} disabled={presets.length >= 8} className="mt-2 flex w-full items-center justify-center gap-1 rounded-lg border border-border px-2 py-1.5 hover:bg-surface-secondary disabled:opacity-40"><Plus size={14} /> Save current pen</button>
        </div>
      )}
    </div>
  );
}
