// Pure helpers for incremental stroke saves. A stroke is anything with a stable
// `id` plus the mutable fields a save must persist. Writes to IndexedDB are cheap,
// but a note can hold ~10k strokes, so we still only write what changed.
import { newId } from "./ids.ts";

export type DeltaStroke = {
  id?: string;
  tool: string;
  color: string;
  width: number;
  points: { x: number; y: number; p?: number }[];
};

// Cheap signature of a stroke's mutable content — changes when it's recoloured,
// resized, or moved (all points shift, so the endpoints move).
export function strokeSig(s: DeltaStroke): string {
  const p = s.points;
  const a = p[0];
  const b = p[p.length - 1];
  return `${s.tool}|${s.color}|${s.width}|${p.length}|${a ? Math.round(a.x) + "," + Math.round(a.y) : ""}|${b ? Math.round(b.x) + "," + Math.round(b.y) : ""}`;
}

export type Delta<S> = { upserts: S[]; deletes: string[]; next: Map<string, string> };

export function computeDelta<S extends DeltaStroke>(current: S[], lastSaved: Map<string, string>): Delta<S> {
  const next = new Map<string, string>();
  const upserts: S[] = [];
  const seen = new Set<string>();
  for (const s of current) {
    const id = s.id ?? newId();
    if (!s.id) s.id = id;
    seen.add(id);
    const sig = strokeSig(s);
    next.set(id, sig);
    if (lastSaved.get(id) !== sig) upserts.push(s);
  }
  const deletes: string[] = [];
  for (const id of lastSaved.keys()) if (!seen.has(id)) deletes.push(id);
  return { upserts, deletes, next };
}
