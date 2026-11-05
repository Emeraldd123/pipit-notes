// The bundled Bioicons set (public/bioicons/icons.json, built by tools/bioicons-build.mjs): icons the exam writer
// places in diagrams. Loaded once, cached by the service worker, so it works offline.
import { useEffect, useState } from "react";

export type Bioicon = { name: string; src: string; licence: string; author: string };

let cache: Promise<Map<string, Bioicon>> | null = null;
export function loadBioicons(): Promise<Map<string, Bioicon>> {
  cache ??= fetch(`${import.meta.env.BASE_URL}bioicons/icons.json`)
    .then((r) => (r.ok ? r.json() : { icons: [] }))
    .then((j: { icons?: Bioicon[] }) => new Map((j.icons ?? []).map((i) => [i.name, i])))
    .catch(() => { cache = null; return new Map(); });
  return cache;
}

/** The icon set, once loaded (empty until then). */
export function useBioicons(): Map<string, Bioicon> {
  const [icons, setIcons] = useState<Map<string, Bioicon>>(new Map());
  useEffect(() => { let alive = true; void loadBioicons().then((m) => { if (alive) setIcons(m); }); return () => { alive = false; }; }, []);
  return icons;
}

const LICENCE: Record<string, string> = { "cc-0": "CC0", "cc-by-3.0": "CC BY 3.0", "cc-by-4.0": "CC BY 4.0", mit: "MIT", bsd: "BSD" };

/** The credit line for the icons a drawing uses (CC BY icons must name their authors). */
export function iconCredit(names: string[], icons: Map<string, Bioicon>): string {
  const used = [...new Set(names)].map((n) => icons.get(n)).filter((i): i is Bioicon => !!i);
  if (!used.length) return "";
  const by = new Map<string, Set<string>>();
  for (const i of used) { const l = LICENCE[i.licence] ?? i.licence; (by.get(l) ?? by.set(l, new Set()).get(l)!).add(i.author); }
  return `Icons: Bioicons — ${[...by].map(([l, a]) => `${[...a].join(", ")} (${l})`).join("; ")}`;
}
