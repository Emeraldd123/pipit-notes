// Tiny hash router. Hash routes work on any static host (and offline from the
// service worker) with no server rewrite rules.
import { useEffect, useState } from "react";

export type Route =
  | { name: "library"; notebook: string | null; q: string }
  | { name: "note"; id: string; page?: number }
  | { name: "split"; a: string; b: string }
  | { name: "graph" }
  | { name: "search" }
  | { name: "settings" }
  | { name: "study"; view?: string };

export function parseHash(hash: string): Route {
  const h = hash.replace(/^#\/?/, "");
  const [path, query = ""] = h.split("?");
  const parts = path.split("/").filter(Boolean);
  const sp = new URLSearchParams(query);
  if (parts[0] === "n" && parts[1]) {
    const pg = sp.get("p");
    return { name: "note", id: decodeURIComponent(parts[1]), page: pg != null && /^\d+$/.test(pg) ? Number(pg) : undefined };
  }
  if (parts[0] === "split" && parts[1] && parts[2]) return { name: "split", a: decodeURIComponent(parts[1]), b: decodeURIComponent(parts[2]) };
  if (parts[0] === "graph") return { name: "graph" };
  if (parts[0] === "search") return { name: "search" };
  if (parts[0] === "settings") return { name: "settings" };
  if (parts[0] === "study") return { name: "study", view: parts[1] ? decodeURIComponent(parts[1]) : undefined };
  return { name: "library", notebook: sp.get("nb"), q: sp.get("q") ?? "" };
}

export function href(r: Route): string {
  switch (r.name) {
    case "note": return `#/n/${encodeURIComponent(r.id)}${r.page != null ? `?p=${r.page}` : ""}`;
    case "split": return `#/split/${encodeURIComponent(r.a)}/${encodeURIComponent(r.b)}`;
    case "graph": return "#/graph";
    case "search": return "#/search";
    case "settings": return "#/settings";
    case "study": return `#/study${r.view ? `/${encodeURIComponent(r.view)}` : ""}`;
    case "library": {
      const sp = new URLSearchParams();
      if (r.notebook) sp.set("nb", r.notebook);
      if (r.q) sp.set("q", r.q);
      const qs = sp.toString();
      return `#/${qs ? `?${qs}` : ""}`;
    }
  }
}

export function go(r: Route) {
  location.hash = href(r);
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(location.hash));
  useEffect(() => {
    const on = () => setRoute(parseHash(location.hash));
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}
