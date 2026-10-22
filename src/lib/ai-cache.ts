// Remember AI answers for identical inputs, so re-running "Explain" on the same circle or "Review" on an
// unchanged page costs nothing. Local only; 30-day expiry; at most 60 entries.
import { getMeta, setMeta, db } from "./db";

const TTL = 30 * 86_400_000;
const MAX = 60;
const INDEX = "aic:index";

/** Small, fast, non-cryptographic hash of a (possibly multi-megabyte) string. */
export function hashString(s: string): string {
  let h1 = 0x811c9dc5, h2 = 0x1b873593;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
    h2 = Math.imul(h2 + c, 2246822519) >>> 0;
  }
  return `${h1.toString(36)}${h2.toString(36)}${s.length.toString(36)}`;
}

export async function cachedAi<T>(feature: string, input: string, compute: () => Promise<T>, force = false): Promise<{ value: T; cached: boolean }> {
  const key = `aic:${feature}:${hashString(input)}`;
  if (!force) try {
    const hit = await getMeta<{ t: number; v: T }>(key);
    if (hit && Date.now() - hit.t < TTL) return { value: hit.v, cached: true };
  } catch { /* a broken cache must never block the real call */ }
  const value = await compute();
  try {
    await setMeta(key, { t: Date.now(), v: value });
    const idx = ((await getMeta<string[]>(INDEX)) ?? []).filter((k) => k !== key);
    idx.push(key);
    const drop = idx.splice(0, Math.max(0, idx.length - MAX));
    if (drop.length) { const d = await db(); for (const k of drop) await d.delete("meta", k); }
    await setMeta(INDEX, idx);
  } catch { /* ignore */ }
  return { value, cached: false };
}
