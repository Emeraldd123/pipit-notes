// "Second brain": link notes that talk about the same things. Pure TF-IDF cosine
// similarity over each note's text — no AI, no network, fully local.

export type RelNote = { id: string; title: string; notebookId: string | null; pages: number };
export type RelText = { noteId: string; text: string };
export type GraphNode = RelNote & { terms: string[]; x: number; y: number };
export type GraphEdge = { a: string; b: string; weight: number; shared: string[] };

const STOP = new Set(
  ("the a an and or of to in on for with is are was were be been it its this that these those as at by from into than then so if not no " +
    "we you i they he she them our your their what which who how when where why can will would should could may might do does did " +
    "has have had also but about over under using use used one two three note notes page pages untitled").split(" ")
);

export function tokens(s: string): string[] {
  return (s.toLowerCase().match(/[a-z][a-z0-9]{2,}/g) ?? []).filter((w) => !STOP.has(w));
}

type Vec = Map<string, number>;

function vectorize(docs: string[]): Vec[] {
  const tf = docs.map((d) => {
    const m = new Map<string, number>();
    for (const t of tokens(d)) m.set(t, (m.get(t) ?? 0) + 1);
    return m;
  });
  const df = new Map<string, number>();
  for (const m of tf) for (const t of m.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  const n = docs.length;
  return tf.map((m) => {
    const v: Vec = new Map();
    for (const [t, c] of m) {
      const idf = Math.log((1 + n) / (1 + (df.get(t) ?? 0))) + 1;
      v.set(t, (1 + Math.log(c)) * idf);
    }
    return v;
  });
}

const norm = (v: Vec) => Math.sqrt([...v.values()].reduce((a, b) => a + b * b, 0)) || 1;

function cosine(a: Vec, b: Vec, na: number, nb: number): { sim: number; shared: string[] } {
  let dot = 0;
  const contrib: [string, number][] = [];
  const [small, big] = a.size < b.size ? [a, b] : [b, a];
  for (const [t, w] of small) {
    const o = big.get(t);
    if (o) { dot += w * o; contrib.push([t, w * o]); }
  }
  contrib.sort((x, y) => y[1] - x[1]);
  return { sim: dot / (na * nb), shared: contrib.slice(0, 4).map((c) => c[0]) };
}

export function similarities(notes: RelNote[], texts: RelText[]): { vecs: Vec[]; norms: number[]; sim: (i: number, j: number) => { sim: number; shared: string[] } } {
  const byNote = new Map<string, string[]>();
  for (const t of texts) {
    if (!byNote.has(t.noteId)) byNote.set(t.noteId, []);
    byNote.get(t.noteId)!.push(t.text);
  }
  // titles count triple so a note about "Gases" links to other gas notes even with little text
  const docs = notes.map((n) => `${(n.title + " ").repeat(3)} ${(byNote.get(n.id) ?? []).join(" ")}`);
  const vecs = vectorize(docs);
  const norms = vecs.map(norm);
  return { vecs, norms, sim: (i, j) => cosine(vecs[i], vecs[j], norms[i], norms[j]) };
}

/** Top related notes for one note. */
export function relatedTo(noteId: string, notes: RelNote[], texts: RelText[], k = 6, min = 0.08): { note: RelNote; weight: number; shared: string[] }[] {
  const i = notes.findIndex((n) => n.id === noteId);
  if (i < 0) return [];
  const S = similarities(notes, texts);
  const out: { note: RelNote; weight: number; shared: string[] }[] = [];
  for (let j = 0; j < notes.length; j++) {
    if (j === i) continue;
    const { sim, shared } = S.sim(i, j);
    if (sim >= min) out.push({ note: notes[j], weight: sim, shared });
  }
  return out.sort((a, b) => b.weight - a.weight).slice(0, k);
}

/** Build the knowledge graph: each note links to its few closest neighbours. */
export function buildGraph(notes: RelNote[], texts: RelText[], opts: { perNode?: number; min?: number } = {}): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const perNode = opts.perNode ?? 3;
  const min = opts.min ?? 0.1;
  const S = similarities(notes, texts);
  const edgeMap = new Map<string, GraphEdge>();
  for (let i = 0; i < notes.length; i++) {
    const cand: { j: number; sim: number; shared: string[] }[] = [];
    for (let j = 0; j < notes.length; j++) {
      if (j === i) continue;
      const { sim, shared } = S.sim(i, j);
      if (sim >= min) cand.push({ j, sim, shared });
    }
    cand.sort((a, b) => b.sim - a.sim);
    for (const c of cand.slice(0, perNode)) {
      const [a, b] = [notes[i].id, notes[c.j].id].sort();
      const key = `${a}|${b}`;
      if (!edgeMap.has(key)) edgeMap.set(key, { a, b, weight: c.sim, shared: c.shared });
    }
  }
  const edges = [...edgeMap.values()];
  const nodes: GraphNode[] = notes.map((n, i) => {
    const top = [...S.vecs[i].entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map((e) => e[0]);
    return { ...n, terms: top, x: 0, y: 0 };
  });
  layout(nodes, edges);
  return { nodes, edges };
}

/** Small force-directed layout (Fruchterman–Reingold), deterministic. Mutates node x/y into [0,1000]. */
export function layout(nodes: GraphNode[], edges: GraphEdge[], iterations = 260): void {
  const n = nodes.length;
  if (!n) return;
  nodes.forEach((nd, i) => {
    const a = (i / n) * Math.PI * 2;
    nd.x = 500 + Math.cos(a) * 300;
    nd.y = 500 + Math.sin(a) * 300;
  });
  const idx = new Map(nodes.map((nd, i) => [nd.id, i]));
  const k = Math.sqrt((1000 * 1000) / n) * 1.0;
  let temp = 120;
  for (let it = 0; it < iterations; it++) {
    const dx = new Array(n).fill(0), dy = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let vx = nodes[i].x - nodes[j].x, vy = nodes[i].y - nodes[j].y;
        let d = Math.hypot(vx, vy);
        if (d < 0.01) { vx = (i - j) * 0.01; vy = 0.01; d = 0.02; }
        const f = (k * k) / d;
        dx[i] += (vx / d) * f; dy[i] += (vy / d) * f;
        dx[j] -= (vx / d) * f; dy[j] -= (vy / d) * f;
      }
    }
    for (const e of edges) {
      const i = idx.get(e.a)!, j = idx.get(e.b)!;
      const vx = nodes[i].x - nodes[j].x, vy = nodes[i].y - nodes[j].y;
      const d = Math.hypot(vx, vy) || 0.01;
      const f = ((d * d) / k) * (0.15 + e.weight * 0.5);
      dx[i] -= (vx / d) * f; dy[i] -= (vy / d) * f;
      dx[j] += (vx / d) * f; dy[j] += (vy / d) * f;
    }
    for (let i = 0; i < n; i++) {
      dx[i] += (500 - nodes[i].x) * 0.02; dy[i] += (500 - nodes[i].y) * 0.02; // gravity
      const d = Math.hypot(dx[i], dy[i]) || 1;
      const step = Math.min(d, temp);
      nodes[i].x += (dx[i] / d) * step;
      nodes[i].y += (dy[i] / d) * step;
    }
    temp *= 0.985;
  }
  // fit into the viewBox with room for labels
  const xs = nodes.map((p) => p.x), ys = nodes.map((p) => p.y);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  for (const p of nodes) {
    p.x = 130 + ((p.x - minX) / (maxX - minX || 1)) * 740;
    p.y = 90 + ((p.y - minY) / (maxY - minY || 1)) * 780;
  }
  // collision pass in FINAL coordinates: never let two dots (and labels) overlap
  const minD = 110;
  for (let pass = 0; pass < 80; pass++) {
    let moved = false;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let vx = nodes[i].x - nodes[j].x, vy = nodes[i].y - nodes[j].y;
        let d = Math.hypot(vx, vy);
        if (d >= minD) continue;
        if (d < 0.01) { vx = 1; vy = 0.5; d = Math.hypot(vx, vy); }
        const push = (minD - d) / 2 + 0.5;
        nodes[i].x += (vx / d) * push; nodes[i].y += (vy / d) * push;
        nodes[j].x -= (vx / d) * push; nodes[j].y -= (vy / d) * push;
        moved = true;
      }
    }
    for (const p of nodes) { p.x = Math.min(920, Math.max(80, p.x)); p.y = Math.min(900, Math.max(70, p.y)); }
    if (!moved) break;
  }
}
