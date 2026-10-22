// Page operations (reorder / duplicate / insert / delete) as pure data transforms.
// A "mapping" lists, for each page of the NEW note, which OLD page it comes from
// (or -1 for a fresh blank page). Items (strokes, images, blocks…) belong to a page by
// their vertical position and are shifted when their page moves.
import { PAGE_GAP, PAGE_H, pageTop } from "./page.ts";

export type PageMapping = number[];

export const identityMapping = (count: number): PageMapping => Array.from({ length: count }, (_, i) => i);

export function moveMapping(count: number, from: number, to: number): PageMapping {
  const m = identityMapping(count);
  if (from < 0 || from >= count) return m;
  to = Math.max(0, Math.min(count - 1, to));
  const [x] = m.splice(from, 1);
  m.splice(to, 0, x);
  return m;
}
export function duplicateMapping(count: number, page: number): PageMapping {
  const m = identityMapping(count);
  if (page >= 0 && page < count) m.splice(page + 1, 0, page);
  return m;
}
/** A blank page inserted after `page` (use -1 to insert at the very start). */
export function insertBlankMapping(count: number, afterPage: number): PageMapping {
  const m = identityMapping(count);
  m.splice(Math.max(0, Math.min(count, afterPage + 1)), 0, -1);
  return m;
}
export function deleteMapping(count: number, page: number): PageMapping {
  const m = identityMapping(count).filter((p) => p !== page);
  return m.length ? m : [-1];
}

/** Which page a vertical position belongs to (gaps and overshoot go to the nearest page). */
export function pageOfY(y: number, count: number): number {
  return Math.max(0, Math.min(count - 1, Math.floor(y / (PAGE_H + PAGE_GAP))));
}

/** For each old page, the new indices it appears at (usually one; two for a duplicate; none if deleted). */
export function targetsByOldPage(mapping: PageMapping): Map<number, number[]> {
  const t = new Map<number, number[]>();
  mapping.forEach((old, n) => { if (old >= 0) t.set(old, [...(t.get(old) ?? []), n]); });
  return t;
}

export type Remapped<T> = { item: T; isClone: boolean };

/**
 * Re-home items for a new page order. `pageOf` says which old page an item is on; `shift`
 * returns a copy moved down by dy document pixels. The first copy keeps its identity
 * (isClone=false); further copies (page duplicated) are clones the caller must give new ids.
 */
export function remapItems<T>(items: T[], oldCount: number, mapping: PageMapping, pageOf: (t: T) => number, shift: (t: T, dy: number) => T): Remapped<T>[] {
  const targets = targetsByOldPage(mapping);
  const out: Remapped<T>[] = [];
  for (const it of items) {
    const old = Math.max(0, Math.min(oldCount - 1, pageOf(it)));
    const list = targets.get(old);
    if (!list) continue; // its page was deleted
    list.forEach((n, k) => out.push({ item: shift(it, pageTop(n) - pageTop(old)), isClone: k > 0 }));
  }
  return out;
}
