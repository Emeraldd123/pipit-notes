// The ink controls in the tool rail: one button showing the current colour and width, opening a panel with every
// width, colour and saved pen; beside it, the last few colours you used, one tap each. Replaces the four width dots
// and the colour grid that made the rail taller than an iPad screen.
import { Bookmark, Plus, X } from "lucide-react";
import { RailPopover } from "@/components/rail-menu";
import type { Preset } from "@/lib/settings";

export type InkPickerProps = {
  color: string; width: number; widths: number[]; widthNames: Record<number, string>;
  palette: string[]; colorNames: Record<string, string>; recentCustom: string[]; lastUsed: string[];
  highlighter: boolean; side: "left" | "right";
  onColor: (c: string, custom?: boolean) => void; onWidth: (w: number) => void;
  presets: Preset[]; onApplyPreset: (p: Preset) => void; onSavePreset: () => void; onDeletePreset: (i: number) => void;
};

const dot = (c: string, w: number) => <span className="rounded-full ring-1 ring-black/10" style={{ background: c, width: Math.max(8, Math.min(w * 1.6, 20)), height: Math.max(8, Math.min(w * 1.6, 20)) }} />;
const swatch = "h-8 w-8 shrink-0 rounded-full [@media(pointer:coarse)]:h-9 [@media(pointer:coarse)]:w-9";
const ring = "ring-2 ring-primary ring-offset-2 ring-offset-surface";
const head = "px-1.5 pb-1.5 pt-1 text-[11px] font-semibold uppercase tracking-wider text-foreground-muted";

export function InkPicker(p: InkPickerProps) {
  const name = (c: string) => p.colorNames[c] ?? `Colour ${c}`;
  return (
    <div className="flex shrink-0 items-center gap-1.5 md:grid md:grid-cols-2 md:gap-1" role="group" aria-label={p.highlighter ? "Highlighter" : "Ink"}>
      <RailPopover side={p.side} width={252} title={`${p.highlighter ? "Highlighter" : "Ink"}: ${name(p.color)}, ${p.widthNames[p.width] ?? p.width} line. Tap for all colours, widths and saved pens`}
        icon={<span className="flex h-7 w-7 items-center justify-center rounded-full bg-background ring-1 ring-border">{dot(p.color, p.width)}</span>}>
        {(close) => (
          <div className="p-1 text-sm">
            <p className={head}>Width</p>
            <div className="flex gap-1.5 px-1" role="group" aria-label="Width">
              {p.widths.map((w) => (
                <button key={w} onClick={() => p.onWidth(w)} aria-pressed={p.width === w} aria-label={`${p.widthNames[w]} line`} title={`${p.widthNames[w]} line`}
                  className={`tap flex h-10 flex-1 items-center justify-center rounded-lg ${p.width === w ? "bg-surface-secondary ring-1 ring-primary" : "hover:bg-surface-secondary"}`}>
                  <span className="rounded-full bg-foreground" style={{ width: Math.min(w, 16), height: Math.min(w, 16) }} />
                </button>
              ))}
            </div>
            <p className={`${head} mt-2`}>Colour</p>
            <div className="grid grid-cols-5 gap-2 px-1.5" role="group" aria-label="Colour">
              {[...p.palette, ...p.recentCustom].map((c) => (
                <button key={c} onClick={() => { p.onColor(c); close(); }} aria-pressed={p.color === c} aria-label={name(c)} title={name(c)}
                  className={`${swatch} ${p.color === c ? ring : ""}`} style={{ backgroundColor: c }} />
              ))}
              <label className={`${swatch} flex cursor-pointer items-center justify-center ring-1 ring-border`} title="Custom colour" style={{ background: "conic-gradient(red, yellow, lime, aqua, blue, magenta, red)" }}>
                <input type="color" value={p.color} onChange={(e) => p.onColor(e.target.value, true)} className="sr-only" aria-label="Custom colour" />
              </label>
            </div>
            <p className={`${head} mt-3 flex items-center gap-1`}><Bookmark size={11} /> Saved pens</p>
            {p.presets.length === 0 && <p className="px-1.5 pb-1 text-xs text-foreground-muted">None yet. Set up a pen the way you like it, then save it.</p>}
            <div className="space-y-0.5">
              {p.presets.map((pr, i) => (
                <div key={i} className="flex items-center gap-1">
                  <button onClick={() => { p.onApplyPreset(pr); close(); }} className="tap flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-surface-secondary">
                    {dot(pr.color, pr.width)}<span className="truncate capitalize">{pr.tool} · {p.widthNames[pr.width] ?? pr.width}</span>
                  </button>
                  <button onClick={() => p.onDeletePreset(i)} className="tap rounded-md p-2 text-foreground-muted hover:text-negative" title="Remove saved pen" aria-label="Remove saved pen"><X size={14} /></button>
                </div>
              ))}
            </div>
            <button onClick={p.onSavePreset} disabled={p.presets.length >= 8} className="tap mt-1.5 flex w-full items-center justify-center gap-1 rounded-lg border border-border px-2 py-2 hover:bg-surface-secondary disabled:opacity-40"><Plus size={14} /> Save this pen</button>
          </div>
        )}
      </RailPopover>
      {p.lastUsed.map((c) => (
        <button key={c} onClick={() => p.onColor(c)} aria-pressed={p.color === c} aria-label={name(c)} title={name(c)}
          className={`mx-auto h-7 w-7 shrink-0 rounded-full [@media(pointer:coarse)]:h-9 [@media(pointer:coarse)]:w-9 ${p.color === c ? ring : "ring-1 ring-border"}`} style={{ backgroundColor: c }} />
      ))}
    </div>
  );
}

/** The last `n` colours used, most recent first, topped up from the palette so a newcomer sees black, blue, red. */
export function lastColours(history: string[], palette: string[], n = 3): string[] {
  const out: string[] = [];
  for (const c of [...history, ...palette]) if (!out.includes(c)) { out.push(c); if (out.length === n) break; }
  return out;
}
