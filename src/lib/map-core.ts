// Concept maps: model, validation of AI proposals, layout, weak-spot stats, study order,
// recall scoring, outline export, and flashcards from links. Pure + unit-tested.
import { checkTyped, normalizeAnswer } from "./study-core.ts";
import { crownOf } from "./srs.ts";

export type EdgeKind = "part" | "cause" | "contrast" | "example" | "prereq" | "other";
export const EDGE_KINDS: EdgeKind[] = ["part", "cause", "contrast", "example", "prereq", "other"];
export const KIND_LABEL: Record<EdgeKind, string> = { part: "part of", cause: "causes", contrast: "contrasts", example: "example of", prereq: "needed for", other: "related" };

export type MapNode = { id: string; label: string; note?: string; x: number; y: number; refs?: { noteId: string; page: number }[]; topic?: string };
export type MapEdge = { id: string; from: string; to: string; label: string; kind: EdgeKind };
export type ConceptMap = { id: string; title: string; scope: string; nodes: MapNode[]; edges: MapEdge[]; createdAt: number; updatedAt: number };

export const MAX_NODES = 44;
const MAX_EDGES = 90;

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "");

/** Guess an edge type from its wording (the AI is asked for one, this is the fallback). */
export function inferKind(label: string): EdgeKind {
  const l = label.toLowerCase();
  if (/\b(part of|consists|contains|includes|made of|component)\b/.test(l)) return "part";
  if (/\b(cause|causes|leads? to|produces?|results? in|drives?|triggers?)\b/.test(l)) return "cause";
  if (/\b(vs|versus|unlike|contrast|opposite|differs?)\b/.test(l)) return "contrast";
  if (/\b(example|e\.g\.|such as|instance|type of|kind of|is a)\b/.test(l)) return "example";
  if (/\b(requires?|needs?|depends?|prerequisite|before|builds? on|needed for|used (in|for))\b/.test(l)) return "prereq";
  return "other";
}

export type SrcRef = { n: number; noteId?: string; page: number };

/** Validate the model's JSON into a map (positions are laid out separately). */
export function normalizeMap(raw: unknown, srcs: SrcRef[], id: string, scope: string, now = Date.now()): ConceptMap | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const rawNodes = Array.isArray(r.nodes) ? (r.nodes as Record<string, unknown>[]) : [];
  const byKey = new Map<string, string>();          // raw id or normalized label -> our id
  const seenLabel = new Set<string>();
  const nodes: MapNode[] = [];
  for (const n of rawNodes) {
    if (nodes.length >= MAX_NODES) break;
    const label = str(n?.label, 48);
    const key = normalizeAnswer(label);
    if (!label || seenLabel.has(key)) { if (label) byKey.set(String(n?.id ?? label), byKey.get(key) ?? ""); continue; }
    seenLabel.add(key);
    const nid = `n${nodes.length + 1}`;
    const src = typeof n?.src === "number" ? srcs.find((s) => s.n === n.src) : undefined;
    nodes.push({ id: nid, label, note: str(n?.note, 200) || undefined, x: 0, y: 0, topic: str(n?.topic, 40) || undefined, refs: src?.noteId ? [{ noteId: src.noteId, page: src.page }] : undefined });
    byKey.set(String(n?.id ?? label), nid); byKey.set(key, nid);
  }
  if (nodes.length < 2) return null;
  const ids = new Set(nodes.map((n) => n.id));
  const edges: MapEdge[] = [];
  const seenEdge = new Set<string>();
  for (const e of Array.isArray(r.edges) ? (r.edges as Record<string, unknown>[]) : []) {
    if (edges.length >= MAX_EDGES) break;
    const from = byKey.get(String(e?.from)) ?? byKey.get(normalizeAnswer(String(e?.from ?? "")));
    const to = byKey.get(String(e?.to)) ?? byKey.get(normalizeAnswer(String(e?.to ?? "")));
    if (!from || !to || from === to || !ids.has(from) || !ids.has(to)) continue;
    const key = `${from}>${to}`;
    if (seenEdge.has(key) || seenEdge.has(`${to}>${from}`)) continue;
    seenEdge.add(key);
    const label = str(e?.label, 36) || "relates to";
    const kind = EDGE_KINDS.includes(e?.kind as EdgeKind) ? (e.kind as EdgeKind) : inferKind(label);
    edges.push({ id: `e${edges.length + 1}`, from, to, label, kind });
  }
  const laid = layoutRadial(nodes, edges);
  return { id, title: str(r.title, 60) || "Concept map", scope, nodes: laid, edges, createdAt: now, updatedAt: now };
}

// --- layout ---------------------------------------------------------------------------------------------------------------
const degree = (nodes: MapNode[], edges: MapEdge[]) => {
  const d = new Map(nodes.map((n) => [n.id, 0]));
  for (const e of edges) { d.set(e.from, (d.get(e.from) ?? 0) + 1); d.set(e.to, (d.get(e.to) ?? 0) + 1); }
  return d;
};

/** Radial tree layout per connected component; components are placed side by side. Deterministic. */
export function layoutRadial(nodes: MapNode[], edges: MapEdge[], ring = 235): MapNode[] {
  const deg = degree(nodes, edges);
  const adj = new Map(nodes.map((n) => [n.id, [] as string[]]));
  for (const e of edges) { adj.get(e.from)?.push(e.to); adj.get(e.to)?.push(e.from); }
  const pos = new Map<string, { x: number; y: number }>();
  const seen = new Set<string>();
  const order = [...nodes].sort((a, b) => (deg.get(b.id)! - deg.get(a.id)!) || a.label.localeCompare(b.label));
  let offsetX = 0;
  let first = true;
  for (const rootNode of order) {
    if (seen.has(rootNode.id)) continue;
    // BFS tree
    const parent = new Map<string, string | null>([[rootNode.id, null]]);
    const children = new Map<string, string[]>();
    const level = new Map<string, number>([[rootNode.id, 0]]);
    const queue = [rootNode.id]; seen.add(rootNode.id);
    while (queue.length) {
      const cur = queue.shift()!;
      for (const nb of [...adj.get(cur)!].sort((a, b) => (deg.get(b)! - deg.get(a)!) || a.localeCompare(b))) {
        if (seen.has(nb)) continue;
        seen.add(nb); parent.set(nb, cur); level.set(nb, level.get(cur)! + 1);
        children.set(cur, [...(children.get(cur) ?? []), nb]); queue.push(nb);
      }
    }
    const leaves = (id: string): number => { const c = children.get(id); return c?.length ? c.reduce((s, k) => s + leaves(k), 0) : 1; };
    const place = (id: string, a0: number, a1: number) => {
      const lv = level.get(id)!;
      const mid = (a0 + a1) / 2;
      pos.set(id, lv === 0 ? { x: 0, y: 0 } : { x: Math.cos(mid) * lv * ring, y: Math.sin(mid) * lv * ring });
      const kids = children.get(id) ?? [];
      const total = kids.reduce((s, k) => s + leaves(k), 0) || 1;
      let a = a0;
      for (const k of kids) { const w = ((a1 - a0) * leaves(k)) / total; place(k, a, a + w); a += w; }
    };
    place(rootNode.id, -Math.PI / 2, (3 * Math.PI) / 2);
    const comp = [...level.keys()];
    const minX = Math.min(...comp.map((id) => pos.get(id)!.x));
    const maxX = Math.max(...comp.map((id) => pos.get(id)!.x));
    const shift = first ? 0 : offsetX - minX;      // the main component stays centred on the origin
    for (const id of comp) { const p = pos.get(id)!; pos.set(id, { x: p.x + shift, y: p.y }); }
    offsetX = maxX + shift + ring * 1.2;
    first = false;
  }
  const out = nodes.map((n) => ({ ...n, x: Math.round(pos.get(n.id)?.x ?? 0), y: Math.round(pos.get(n.id)?.y ?? 0) }));
  return separate(out);
}

/** Nudge apart any nodes whose boxes would overlap (labels are wide). */
export function separate(nodes: MapNode[], minDx = 160, minDy = 50): MapNode[] {
  const out = nodes.map((n) => ({ ...n }));
  for (let pass = 0; pass < 40; pass++) {
    let moved = false;
    for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length; j++) {
      const dx = out[j].x - out[i].x, dy = out[j].y - out[i].y;
      if (Math.abs(dx) < minDx && Math.abs(dy) < minDy) {
        const push = (minDy - Math.abs(dy)) / 2 + 2;
        const dir = dy === 0 ? (i % 2 ? 1 : -1) : Math.sign(dy);
        out[i].y -= dir * push; out[j].y += dir * push; moved = true;
      }
    }
    if (!moved) break;
  }
  return out.map((n) => ({ ...n, x: Math.round(n.x), y: Math.round(n.y) }));
}

// --- weak spots ----------------------------------------------------------------------------------------------------------------
export type NodeStats = { cards: number; due: number; mastery: number | null; mistakes: number };
type CardLike = { front: string; back: string; topic?: string; reps: number; interval: number; due: number };
type MistakeLike = { problem: string; read: string; fix: string; resolved?: boolean };

/** The flashcards that are about a concept (by topic name, or by mentioning it). */
export function cardsForNode<T extends { front: string; back: string; topic?: string }>(label: string, cards: T[]): T[] {
  const key = normalizeAnswer(label);
  if (key.length < 3) return [];
  return cards.filter((c) => normalizeAnswer(c.topic ?? "") === key || normalizeAnswer(`${c.front} ${c.back}`).includes(key));
}

export function nodeStats(node: Pick<MapNode, "label">, cards: CardLike[], mistakes: MistakeLike[], now = Date.now()): NodeStats {
  const key = normalizeAnswer(node.label);
  if (key.length < 3) return { cards: 0, due: 0, mastery: null, mistakes: 0 };
  const mine = cardsForNode(node.label, cards);
  const bad = mistakes.filter((m) => !m.resolved && normalizeAnswer(`${m.problem} ${m.read} ${m.fix}`).includes(key));
  const mastery = mine.length ? mine.reduce((s, c) => s + crownOf(c as never) / 5, 0) / mine.length : null;
  return { cards: mine.length, due: mine.filter((c) => c.reps > 0 && c.due <= now).length, mastery, mistakes: bad.length };
}

/** Grey = no cards yet; red → amber → green by mastery. */
export function masteryColor(s: NodeStats | undefined): string {
  if (!s || s.mastery === null) return "#9ca3af";
  return `hsl(${Math.round(s.mastery * 120)} 62% 46%)`;
}

// --- reading order / outline -----------------------------------------------------------------------------------------------------
/** A sensible order to learn the concepts: prerequisites and wholes before what depends on them. */
export function studyOrder(map: Pick<ConceptMap, "nodes" | "edges">): MapNode[] {
  const deg = degree(map.nodes, map.edges);
  const indeg = new Map(map.nodes.map((n) => [n.id, 0]));
  const out = new Map(map.nodes.map((n) => [n.id, [] as string[]]));
  for (const e of map.edges) if (e.kind === "prereq" || e.kind === "part" || e.kind === "cause") { out.get(e.from)!.push(e.to); indeg.set(e.to, indeg.get(e.to)! + 1); }
  const byId = new Map(map.nodes.map((n) => [n.id, n]));
  const rank = (a: string, b: string) => (deg.get(b)! - deg.get(a)!) || byId.get(a)!.label.localeCompare(byId.get(b)!.label);
  const ready = map.nodes.filter((n) => indeg.get(n.id) === 0).map((n) => n.id).sort(rank);
  const done: string[] = [];
  const placed = new Set<string>();
  while (ready.length) {
    const id = ready.shift()!;
    done.push(id); placed.add(id);
    for (const to of out.get(id)!) { indeg.set(to, indeg.get(to)! - 1); if (indeg.get(to) === 0) ready.push(to); }
    ready.sort(rank);
  }
  for (const n of [...map.nodes].sort((a, b) => rank(a.id, b.id))) if (!placed.has(n.id)) done.push(n.id); // cycles: append the rest
  return done.map((id) => byId.get(id)!);
}

/** Indented markdown outline starting from the best-connected concept. */
export function outline(map: Pick<ConceptMap, "title" | "nodes" | "edges">): string {
  const deg = degree(map.nodes, map.edges);
  const byId = new Map(map.nodes.map((n) => [n.id, n]));
  const adj = new Map(map.nodes.map((n) => [n.id, [] as { to: string; label: string }[]]));
  for (const e of map.edges) { adj.get(e.from)!.push({ to: e.to, label: e.label }); adj.get(e.to)!.push({ to: e.from, label: e.label }); }
  const seen = new Set<string>();
  const lines: string[] = [`# ${map.title}`, ""];
  const walk = (id: string, depth: number, via?: string) => {
    seen.add(id);
    const n = byId.get(id)!;
    lines.push(`${"  ".repeat(depth)}- ${via ? `*${via}* → ` : ""}**${n.label}**${n.note ? ` — ${n.note}` : ""}`);
    for (const nb of [...adj.get(id)!].sort((a, b) => (deg.get(b.to)! - deg.get(a.to)!) || byId.get(a.to)!.label.localeCompare(byId.get(b.to)!.label))) if (!seen.has(nb.to)) walk(nb.to, depth + 1, nb.label);
  };
  for (const n of [...map.nodes].sort((a, b) => (deg.get(b.id)! - deg.get(a.id)!) || a.label.localeCompare(b.label))) if (!seen.has(n.id)) { if (lines.length > 2) lines.push(""); walk(n.id, 0); }
  return lines.join("\n");
}

// --- recall ("draw it from memory") -------------------------------------------------------------------------------------------
export type RecallScore = { found: string[]; missing: string[]; extras: string[]; percent: number };

/** Match what the student wrote down against the map's concepts. */
export function scoreRecall(nodes: Pick<MapNode, "id" | "label">[], typed: string[]): RecallScore {
  const items = typed.map((t) => t.trim()).filter(Boolean);
  const found = new Set<string>();
  const used = new Set<number>();
  const toks = (x: string) => normalizeAnswer(x).split(" ").filter((w) => w.length > 2);
  items.forEach((t, i) => {
    const nt = normalizeAnswer(t), tt = new Set(toks(t));
    let best: { id: string; score: number; len: number } | null = null;
    for (const n of nodes) {
      if (found.has(n.id)) continue;
      const nl = normalizeAnswer(n.label), lt = toks(n.label);
      let score = 0;
      if (nt === nl) score = 4;
      else if (checkTyped(t, n.label).ok) score = 3;
      else if (nt.length >= 4 && (nl.includes(nt) || nt.includes(nl)) && Math.min(nt.length, nl.length) / Math.max(nt.length, nl.length) > 0.5) score = 2;
      else if (lt.length && lt.every((w) => tt.has(w))) score = 1;   // every word of the concept appears ("gibbs free energy" contains "gibbs energy")
      if (score && (!best || score > best.score || (score === best.score && nl.length > best.len))) best = { id: n.id, score, len: nl.length };
    }
    if (best) { found.add(best.id); used.add(i); }
  });
  return {
    found: [...found], missing: nodes.filter((n) => !found.has(n.id)).map((n) => n.id),
    extras: items.filter((_, i) => !used.has(i)), percent: nodes.length ? Math.round((found.size / nodes.length) * 100) : 0,
  };
}

/** Is a typed link description close to the real one? ok / partial (shares a key word) / miss. */
export function linkAnswer(input: string, edge: Pick<MapEdge, "label" | "kind">): "ok" | "partial" | "miss" {
  if (!input.trim()) return "miss";
  if (checkTyped(input, edge.label).ok) return "ok";
  const stem = (s: string) => normalizeAnswer(s).split(" ").filter((w) => w.length > 3).map((w) => w.slice(0, 5));
  const a = new Set(stem(input));
  if (stem(edge.label).some((w) => a.has(w)) || inferKind(input) === edge.kind && edge.kind !== "other") return "partial";
  return "miss";
}

// --- flashcards from the map ---------------------------------------------------------------------------------------------------------
export type MapCard = { front: string; back: string; topic: string };
export function cardsFromMap(map: Pick<ConceptMap, "title" | "nodes" | "edges">): MapCard[] {
  const byId = new Map(map.nodes.map((n) => [n.id, n]));
  const out: MapCard[] = [];
  for (const n of map.nodes) if (n.note) out.push({ front: `What is ${n.label}?`, back: n.note, topic: n.topic || map.title });
  for (const e of map.edges) {
    const a = byId.get(e.from), b = byId.get(e.to);
    if (!a || !b) continue;
    out.push({ front: `How are ${a.label} and ${b.label} related?`, back: `${a.label} ${e.label} ${b.label}`, topic: a.topic || map.title });
  }
  return out;
}

// --- growing a map ---------------------------------------------------------------------------------------------------------------------
/** Points for `count` new nodes fanned out beyond `anchor` (away from the map's centre). */
export function placeAround(anchor: { x: number; y: number }, centre: { x: number; y: number }, count: number, radius = 210): { x: number; y: number }[] {
  const base = Math.atan2(anchor.y - centre.y, anchor.x - centre.x);
  const spread = Math.min(Math.PI * 1.2, 0.55 * Math.max(1, count - 1));
  return Array.from({ length: count }, (_, i) => {
    const a = count === 1 ? base : base - spread / 2 + (spread * i) / (count - 1);
    return { x: Math.round(anchor.x + Math.cos(a) * radius), y: Math.round(anchor.y + Math.sin(a) * radius) };
  });
}

let counter = 0;
const freshId = (prefix: string, taken: Set<string>) => { let id: string; do { id = `${prefix}${Date.now().toString(36)}${(counter++).toString(36)}`; } while (taken.has(id)); return id; };

/** Merge AI-proposed new concepts/links around `anchorId` into a map. Existing concepts are reused, not duplicated. */
export function applyAdditions(map: ConceptMap, anchorId: string, raw: unknown, srcs: SrcRef[] = []): { map: ConceptMap; addedNodes: number; addedEdges: number } {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const anchor = map.nodes.find((n) => n.id === anchorId);
  if (!anchor) return { map, addedNodes: 0, addedEdges: 0 };
  const taken = new Set([...map.nodes.map((n) => n.id), ...map.edges.map((e) => e.id)]);
  const byLabel = new Map(map.nodes.map((n) => [normalizeAnswer(n.label), n.id]));
  const nodes = [...map.nodes];
  const fresh: MapNode[] = [];
  const ref = new Map<string, string>([["@anchor", anchorId]]);
  for (const n of Array.isArray(r.nodes) ? (r.nodes as Record<string, unknown>[]) : []) {
    if (nodes.length + fresh.length >= MAX_NODES + 12) break;
    const label = str(n?.label, 48);
    if (!label) continue;
    const key = normalizeAnswer(label);
    const existing = byLabel.get(key);
    if (existing) { ref.set(String(n?.id ?? label), existing); continue; }
    const id = freshId("n", taken); taken.add(id);
    const src = typeof n?.src === "number" ? srcs.find((s) => s.n === n.src) : undefined;
    const node: MapNode = { id, label, note: str(n?.note, 200) || undefined, x: 0, y: 0, topic: str(n?.topic, 40) || undefined, refs: src?.noteId ? [{ noteId: src.noteId, page: src.page }] : undefined };
    fresh.push(node); byLabel.set(key, id); ref.set(String(n?.id ?? label), id); ref.set(key, id);
  }
  const centre = nodes.length ? { x: nodes.reduce((s, n) => s + n.x, 0) / nodes.length, y: nodes.reduce((s, n) => s + n.y, 0) / nodes.length } : { x: 0, y: 0 };
  placeAround(anchor, centre, fresh.length).forEach((p, i) => { fresh[i].x = p.x; fresh[i].y = p.y; });
  const all = separate([...nodes, ...fresh]);
  const ids = new Set(all.map((n) => n.id));
  const edges = [...map.edges];
  const seen = new Set(edges.flatMap((e) => [`${e.from}>${e.to}`, `${e.to}>${e.from}`]));
  let addedEdges = 0;
  const look = (v: unknown) => {
    const s = String(v ?? "");
    return s === "@anchor" || s === anchorId ? anchorId : ref.get(s) ?? ref.get(normalizeAnswer(s)) ?? byLabel.get(normalizeAnswer(s)) ?? (ids.has(s) ? s : undefined);
  };
  for (const e of Array.isArray(r.edges) ? (r.edges as Record<string, unknown>[]) : []) {
    const from = look(e?.from), to = look(e?.to);
    if (!from || !to || from === to || !ids.has(from) || !ids.has(to) || seen.has(`${from}>${to}`) || seen.has(`${to}>${from}`)) continue;
    seen.add(`${from}>${to}`);
    const label = str(e?.label, 36) || "relates to";
    const eid = freshId("e", taken); taken.add(eid);
    edges.push({ id: eid, from, to, label, kind: EDGE_KINDS.includes(e?.kind as EdgeKind) ? (e.kind as EdgeKind) : inferKind(label) });
    addedEdges++;
  }
  // a new concept with no link at all is attached to the anchor so it isn't left floating
  const linked = new Set(edges.flatMap((e) => [e.from, e.to]));
  for (const n of fresh) if (!linked.has(n.id)) { const eid = freshId("e", taken); taken.add(eid); edges.push({ id: eid, from: anchorId, to: n.id, label: "relates to", kind: "other" }); addedEdges++; }
  return { map: { ...map, nodes: all, edges, updatedAt: Date.now() }, addedNodes: fresh.length, addedEdges };
}

/** Which branch (child of the hub) each concept belongs to: -1 = the hub itself, 0.. = branch number. Used to colour-code. */
export function branchIndex(map: Pick<ConceptMap, "nodes" | "edges">): Map<string, number> {
  const out = new Map<string, number>();
  if (!map.nodes.length) return out;
  const deg = degree(map.nodes as MapNode[], map.edges as MapEdge[]);
  const adj = new Map(map.nodes.map((n) => [n.id, [] as string[]]));
  for (const e of map.edges) { adj.get(e.from)?.push(e.to); adj.get(e.to)?.push(e.from); }
  const order = [...map.nodes].sort((a, b) => (deg.get(b.id)! - deg.get(a.id)!) || a.label.localeCompare(b.label));
  let branch = 0;
  for (const root of order) {
    if (out.has(root.id)) continue;
    out.set(root.id, -1);
    for (const first of [...adj.get(root.id)!].sort((a, b) => (deg.get(b)! - deg.get(a)!) || a.localeCompare(b))) {
      if (out.has(first)) continue;
      const b = branch++;
      const q = [first]; out.set(first, b);
      while (q.length) { const c = q.shift()!; for (const nb of adj.get(c)!) if (!out.has(nb)) { out.set(nb, b); q.push(nb); } }
    }
  }
  return out;
}
