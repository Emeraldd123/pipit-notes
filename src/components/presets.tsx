import { Bookmark, Plus, X } from "lucide-react";
import { RailPopover } from "@/components/rail-menu";
import type { Preset } from "@/lib/settings";

/** Saved pen setups (tool + colour + width) — tap one to switch to it instantly. */
export function PresetsButton({ presets, side, onApply, onSave, onDelete }: {
  presets: Preset[]; side: "left" | "right"; onApply: (p: Preset) => void; onSave: () => void; onDelete: (i: number) => void;
}) {
  return (
    <RailPopover icon={<Bookmark size={17} />} title="Pen presets" side={side} width={230}>
      {(close) => (
        <div className="p-1 text-sm">
          <p className="px-1.5 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-foreground-muted">Pen presets — tap one to use it</p>
          {presets.length === 0 && <p className="px-1.5 pb-2 text-xs text-foreground-muted">None yet. Set up a pen the way you like it, then save it.</p>}
          <div className="space-y-1">
            {presets.map((p, i) => (
              <div key={i} className="flex items-center gap-1">
                <button onClick={() => { onApply(p); close(); }} className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-surface-secondary">
                  <span className="rounded-full" style={{ background: p.color, width: Math.max(8, Math.min(p.width * 1.6, 18)), height: Math.max(8, Math.min(p.width * 1.6, 18)) }} />
                  <span className="truncate capitalize">{p.tool} · {p.width}</span>
                </button>
                <button onClick={() => onDelete(i)} className="rounded-md p-2 text-foreground-muted hover:text-negative" title="Remove"><X size={14} /></button>
              </div>
            ))}
          </div>
          <button onClick={onSave} disabled={presets.length >= 8} className="mt-2 flex w-full items-center justify-center gap-1 rounded-lg border border-border px-2 py-2 hover:bg-surface-secondary disabled:opacity-40"><Plus size={14} /> Save current pen</button>
        </div>
      )}
    </RailPopover>
  );
}
