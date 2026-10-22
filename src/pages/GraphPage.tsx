import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft, ArrowLeftRight, BookmarkPlus, Brain, Download, Eye, GitBranch, Layers, ListOrdered, Loader2, Palette, Plus, Search, Sparkles, Trash2, Wand2, Waypoints, X,
} from "lucide-react";
import { go } from "@/router";
import { ConceptMapView, EDGE_COLOR, type Sel } from "@/components/concept-map";
import { RecallMode } from "@/components/recall-mode";
import { RichText } from "@/components/blocks";
import { Button, Card, Modal, Toast } from "@/components/ui";
import { getPageTexts, listNotebooks, listNotes } from "@/lib/db";
import { buildGraph, type GraphNode } from "@/lib/related";
import {
  KIND_LABEL, EDGE_KINDS, cardsForNode, inferKind, cardsFromMap, layoutRadial, nodeStats, outline, studyOrder,
  type ConceptMap, type EdgeKind, type MapCard, type MapEdge, type MapNode, type NodeStats,
} from "@/lib/map-core";
import { deleteMap, listCards, listMaps, listMistakes, putCards, putMap } from "@/lib/study-db";
import { expandConcept, explainConnection, generateConceptMap, type Connection } from "@/lib/ai-map";
import { AiError } from "@/lib/ai";
import { corpusExcerpts, excerptsFor } from "@/lib/search";
import { cardsFromText } from "@/lib/ai-study";
import { dedupeCards, makeCard, type Card as StudyCard } from "@/lib/study-core";
import { scopeNoteIds, toCards } from "@/lib/study-actions";
import { aiReady, useSettings } from "@/lib/settings";
import { triggerDownload, safeName } from "@/lib/export";
import { count, logError } from "@/lib/telemetry";
import { newId } from "@/lib/ids";
import { timeAgo } from "@/lib/format";
import type { MistakeRec } from "@/lib/db";
import type { NoteMeta, NotebookRec, PageTextRec } from "@/types";

type Tab = "maps" | "links";

export function GraphPage({ mapId }: { mapId?: string }) {
  const [tab, setTab] = useState<Tab>("maps");
  return (
    <div className="paper-bg safe-t min-h-full">
      <div className="mx-auto max-w-6xl px-4 py-5 md:px-6 md:py-8">
        <button onClick={() => go({ name: "library", notebook: null, q: "" })} className="mb-4 flex items-center gap-1.5 text-sm text-foreground-muted hover:text-foreground"><ArrowLeft size={15} /> All notes</button>
        {!mapId && (
          <>
            <h1 className="serif text-4xl tracking-tight">Map <span className="serif-i text-primary">what you know</span></h1>
            <p className="mt-1 max-w-2xl text-sm text-foreground-muted">Building and recalling a map is what makes it work — so you shape it, label the links, test yourself from memory, and see where you&apos;re weak.</p>
            <div className="mt-4 inline-flex rounded-xl border border-border bg-surface p-1 text-sm">
              {([["maps", "Concept maps", <Brain key="a" size={14} />], ["links", "Note links", <Waypoints key="b" size={14} />]] as const).map(([id, label, icon]) => (
                <button key={id} onClick={() => setTab(id)} className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 font-medium ${tab === id ? "bg-primary text-white" : "text-foreground-muted hover:bg-surface-secondary"}`}>{icon}{label}</button>
              ))}
            </div>
          </>
        )}
        <div className="mt-5">{tab === "links" && !mapId ? <NoteLinks /> : <ConceptMaps mapId={mapId} />}</div>
      </div>
    </div>
  );
}

// ======================================================================================================================================
// Concept maps
// ======================================================================================================================================
function ConceptMaps({ mapId }: { mapId?: string }) {
  const settings = useSettings();
  const ai = aiReady(settings);
  const [maps, setMaps] = useState<ConceptMap[] | null>(null);
  const [cards, setCards] = useState<StudyCard[]>([]);
  const [mistakes, setMistakes] = useState<MistakeRec[]>([]);
  const [notes, setNotes] = useState<NoteMeta[]>([]);
  const [notebooks, setNotebooks] = useState<NotebookRec[]>([]);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const flash = useCallback((m: string) => { setToast(m); setTimeout(() => setToast((t) => (t === m ? null : t)), 3600); }, []);

  const reload = useCallback(async () => {
    const [m, c, mi, n, nb] = await Promise.all([listMaps(), listCards(), listMistakes(), listNotes(), listNotebooks()]);
    setMaps(m); setCards(c); setMistakes(mi); setNotes(n); setNotebooks(nb);
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  const current = mapId ? maps?.find((m) => m.id === mapId) : undefined;
  if (maps === null) return <p className="py-16 text-center text-sm text-foreground-muted">Loading…</p>;

  if (mapId) {
    if (!current) return <Card className="px-6 py-10 text-center text-sm">That map doesn&apos;t exist. <button className="text-primary underline" onClick={() => go({ name: "graph" })}>Back to your maps</button></Card>;
    return <MapEditor key={current.id} initial={current} cards={cards} mistakes={mistakes} ai={ai} flash={flash} onCards={reload} onDeleted={() => { go({ name: "graph" }); void reload(); }} toast={toast} />;
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <p className="text-sm text-foreground-muted">{maps.length} map{maps.length === 1 ? "" : "s"}</p>
        <Button variant="primary" onClick={() => setCreating(true)}><Plus size={15} /> New concept map</Button>
      </div>
      {maps.length === 0 ? (
        <Card className="mt-4 px-6 py-12 text-center">
          <Brain size={40} className="mx-auto text-primary" />
          <h2 className="serif mt-3 text-3xl">Your notes, <span className="serif-i text-primary">as ideas</span></h2>
          <p className="mx-auto mt-2 max-w-lg text-sm text-foreground-muted">I&apos;ll propose a map of the key concepts in a notebook or note, with labelled links like <i>causes</i> and <i>is part of</i>. You edit it, then test yourself from memory, colour it by what you actually know, and turn the links into flashcards.</p>
          <Button variant="primary" className="mt-6" onClick={() => setCreating(true)}><Sparkles size={15} /> Make my first map</Button>
        </Card>
      ) : (
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {maps.map((m) => {
            const st = m.nodes.map((n) => nodeStats(n, cards, mistakes).mastery).filter((x): x is number => x !== null);
            const know = st.length ? Math.round((st.reduce((a, b) => a + b, 0) / st.length) * 100) : null;
            return (
              <button key={m.id} onClick={() => go({ name: "graph", map: m.id })} className="rounded-2xl border border-border bg-surface p-4 text-left transition-colors hover:border-primary/60">
                <MiniMap map={m} />
                <p className="mt-2 truncate font-semibold">{m.title}</p>
                <p className="text-xs text-foreground-muted">{m.nodes.length} concepts · {m.edges.length} links · {timeAgo(m.updatedAt)}{know !== null ? ` · ${know}% known` : ""}</p>
              </button>
            );
          })}
        </div>
      )}
      {creating && <NewMapModal ai={ai} notes={notes} notebooks={notebooks} setBusy={setBusy} onClose={() => setCreating(false)}
        onDone={async (m) => { setCreating(false); await putMap(m); count("map.create"); await reload(); go({ name: "graph", map: m.id }); }} />}
      {busy && <div className="fixed inset-x-0 bottom-6 z-50 flex justify-center"><div className="flex items-center gap-2 rounded-full border border-border bg-surface px-4 py-2 text-sm shadow-xl"><Loader2 size={14} className="animate-spin" /> {busy}</div></div>}
      <Toast msg={toast} />
    </div>
  );
}

function MiniMap({ map }: { map: ConceptMap }) {
  const xs = map.nodes.map((n) => n.x), ys = map.nodes.map((n) => n.y);
  const x0 = Math.min(...xs) - 60, x1 = Math.max(...xs) + 60, y0 = Math.min(...ys) - 40, y1 = Math.max(...ys) + 40;
  const by = new Map(map.nodes.map((n) => [n.id, n]));
  return (
    <svg viewBox={`${x0} ${y0} ${x1 - x0} ${y1 - y0}`} className="h-28 w-full rounded-lg bg-surface-secondary/60">
      {map.edges.map((e) => { const a = by.get(e.from), b = by.get(e.to); return a && b ? <line key={e.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--foreground-muted)" strokeOpacity={0.4} strokeWidth={Math.max(2, (x1 - x0) / 160)} /> : null; })}
      {map.nodes.map((n) => <circle key={n.id} cx={n.x} cy={n.y} r={Math.max(7, (x1 - x0) / 55)} fill="var(--primary)" />)}
    </svg>
  );
}

function NewMapModal({ ai, notes, notebooks, onClose, onDone, setBusy }: {
  ai: boolean; notes: NoteMeta[]; notebooks: NotebookRec[]; onClose: () => void; onDone: (m: ConceptMap) => void; setBusy: (m: string | null) => void;
}) {
  const [scope, setScope] = useState("all");
  const [focus, setFocus] = useState("");
  const [size, setSize] = useState(18);
  const [err, setErr] = useState<string | null>(null);
  const sel = "mt-1 block w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground";
  const run = async (blank: boolean) => {
    setErr(null);
    if (blank) {
      const now = Date.now();
      return onDone({ id: newId(), title: focus.trim() || "My concept map", scope, nodes: [{ id: "n1", label: focus.trim() || "Main idea", x: 0, y: 0 }], edges: [], createdAt: now, updatedAt: now });
    }
    setBusy("Reading your notes and sketching a map…");
    try {
      const ids = await scopeNoteIds(scope);
      const ex = await corpusExcerpts(ids, 20000);
      if (!ex.length) { setErr("There's no readable text in that scope yet. Use “Read my handwriting” on the Search page, or import typed PDFs."); return; }
      count("map.generate");
      onDone(await generateConceptMap(ex, { focus, size, scope }));
    } catch (e) { setErr(e instanceof AiError ? e.message : "Something went wrong: " + (e as Error).message); logError("map", e); } finally { setBusy(null); }
  };
  return (
    <Modal title="New concept map" onClose={onClose}>
      <div className="space-y-4">
        <label className="block text-xs text-foreground-muted">Based on
          <select value={scope} onChange={(e) => setScope(e.target.value)} className={sel}>
            <option value="all">All my notes</option>
            {notebooks.length > 0 && <optgroup label="Notebooks">{notebooks.map((n) => <option key={n.id} value={`nb:${n.id}`}>{n.name}</option>)}</optgroup>}
            <optgroup label="Notes">{notes.map((n) => <option key={n.id} value={`note:${n.id}`}>{n.title}</option>)}</optgroup>
          </select>
        </label>
        <label className="block text-xs text-foreground-muted">Focus (optional)
          <input value={focus} onChange={(e) => setFocus(e.target.value)} placeholder="e.g. thermodynamics, the French Revolution" className={sel} />
        </label>
        <label className="block text-xs text-foreground-muted">Roughly how many concepts
          <select value={size} onChange={(e) => setSize(Number(e.target.value))} className={sel}>{[10, 14, 18, 24, 32].map((n) => <option key={n}>{n}</option>)}</select>
        </label>
        {err && <p className="text-sm text-negative">{err}</p>}
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" disabled={!ai} onClick={() => void run(false)}><Sparkles size={14} /> {ai ? "Propose a map" : "AI is off"}</Button>
          <Button onClick={() => void run(true)}>Start blank</Button>
        </div>
        <p className="text-xs text-foreground-muted">The AI only proposes — everything is editable. Starting blank gives you a single central idea to grow from.</p>
      </div>
    </Modal>
  );
}

// ======================================================================================================================================
// The editor
// ======================================================================================================================================
function MapEditor({ initial, cards, mistakes, ai, flash, onCards, onDeleted, toast }: {
  initial: ConceptMap; cards: StudyCard[]; mistakes: MistakeRec[]; ai: boolean; flash: (m: string) => void; onCards: () => void; onDeleted: () => void; toast: string | null;
}) {
  const [map, setMap] = useState(initial);
  const [sel, setSel] = useState<Sel>(null);
  const [colorMode, setColorMode] = useState<"branch" | "mastery">("branch");
  const [query, setQuery] = useState("");
  const [connectFrom, setConnectFrom] = useState<string | null>(null);
  const [pending, setPending] = useState<{ a: string; b: string } | null>(null);
  const [fit, setFit] = useState(0);
  const [recall, setRecall] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [showOrder, setShowOrder] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const update = useCallback((m: ConceptMap) => {
    setMap(m);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { void putMap(m).catch((e) => logError("map", e)); }, 500);
  }, []);
  useEffect(() => () => { if (saveTimer.current) { clearTimeout(saveTimer.current); } }, []);
  // make sure the last edit is written even if the page is left within the debounce window
  const latest = useRef(map); latest.current = map;
  useEffect(() => () => { void putMap(latest.current); }, []);

  const stats = useMemo(() => new Map<string, NodeStats>(map.nodes.map((n) => [n.id, nodeStats(n, cards, mistakes)])), [map.nodes, cards, mistakes]);
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? new Set(map.nodes.filter((n) => n.label.toLowerCase().includes(q) || (n.note ?? "").toLowerCase().includes(q)).map((n) => n.id)) : null;
  }, [query, map.nodes]);
  const byId = useMemo(() => new Map(map.nodes.map((n) => [n.id, n])), [map.nodes]);
  const order = useMemo(() => studyOrder(map), [map]);

  const node = sel?.type === "node" ? byId.get(sel.id) : undefined;
  const edge = sel?.type === "edge" ? map.edges.find((e) => e.id === sel.id) : undefined;

  const patchNode = (id: string, p: Partial<MapNode>) => update({ ...map, nodes: map.nodes.map((n) => (n.id === id ? { ...n, ...p } : n)) });
  const patchEdge = (id: string, p: Partial<MapEdge>) => update({ ...map, edges: map.edges.map((e) => (e.id === id ? { ...e, ...p } : e)) });

  function addNode() {
    const anchor = node ?? [...map.nodes].sort((a, b) => b.x - a.x)[0];
    const id = `n${Date.now().toString(36)}`;
    const nn: MapNode = { id, label: "New concept", x: (anchor?.x ?? 0) + 200, y: (anchor?.y ?? 0) + (Math.random() * 120 - 60) };
    const edges = anchor ? [...map.edges, { id: `e${id}`, from: anchor.id, to: id, label: "relates to", kind: "other" as EdgeKind }] : map.edges;
    update({ ...map, nodes: [...map.nodes, nn], edges });
    setSel({ type: "node", id });
    count("map.addNode");
  }
  function deleteNode(id: string) {
    update({ ...map, nodes: map.nodes.filter((n) => n.id !== id), edges: map.edges.filter((e) => e.from !== id && e.to !== id) });
    setSel(null);
  }
  function onPick(id: string) {
    if (!connectFrom) return;
    if (id === connectFrom) { setConnectFrom(null); return; }
    setPending({ a: connectFrom, b: id }); setConnectFrom(null);
  }

  // ---- study / cards -------------------------------------------------------------------------------------------------------------
  async function saveCards(raws: MapCard[], source: StudyCard["source"] = "manual") {
    const now = Date.now();
    const fresh = dedupeCards(raws.map((c, i) => ({ ...makeCard({ front: c.front, back: c.back }, now + i), id: newId(), topic: c.topic, source, notebookId: null }) as StudyCard), cards);
    await putCards(fresh);
    onCards();
    flash(fresh.length ? `Added ${fresh.length} flashcard${fresh.length === 1 ? "" : "s"} — find them in Study.` : "You already have those cards.");
    count("map.cards");
  }
  async function makeNodeCards(n: MapNode) {
    if (!ai) return flash("Turn on AI in Settings to make flashcards.");
    setBusy(`Writing cards for ${n.label}…`);
    try {
      const ex = await excerptsFor(`${n.label} ${n.note ?? ""}`, 4);
      const raws = await cardsFromText(n.label, [n.note ?? "", ...ex.map((e) => e.text)].join("\n\n"), 4);
      const fresh = dedupeCards(await toCards(raws.map((r) => ({ ...r, topic: r.topic ?? n.label })), { notebookId: null, source: "ai", excerpts: ex }), cards);
      await putCards(fresh); onCards();
      flash(fresh.length ? `Added ${fresh.length} cards for ${n.label}.` : "No new cards for that.");
    } catch (e) { flash(e instanceof AiError ? e.message : `Couldn't make cards: ${(e as Error).message}`); } finally { setBusy(null); }
  }
  function studyNode(n: MapNode) {
    const mine = cardsForNode(n.label, cards);
    if (!mine.length) return flash("No flashcards for this yet — use “Make cards”.");
    try { sessionStorage.setItem("pipit.studyFocus", JSON.stringify({ ids: mine.map((c) => c.id), title: n.label })); } catch { /* */ }
    count("map.study");
    go({ name: "study" });
  }

  // ---- AI --------------------------------------------------------------------------------------------------------------------------
  async function expand(n: MapNode) {
    if (!ai) return flash("Turn on AI in Settings to expand concepts.");
    setBusy(`Looking for what connects to ${n.label}…`);
    try {
      const ex = await excerptsFor(`${n.label} ${n.note ?? ""}`, 6);
      const r = await expandConcept(map, n.id, ex);
      update(r.map);
      flash(`Added ${r.addedNodes} concept${r.addedNodes === 1 ? "" : "s"} and ${r.addedEdges} link${r.addedEdges === 1 ? "" : "s"}.`);
      count("map.expand");
    } catch (e) { flash(e instanceof AiError ? e.message : `Couldn't expand: ${(e as Error).message}`); } finally { setBusy(null); }
  }

  function exportPng() {
    const svg = svgRef.current;
    if (!svg) return;
    const clone = svg.cloneNode(true) as SVGSVGElement;
    const box = fitFor(map.nodes);
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("viewBox", `${box.x} ${box.y} ${box.w} ${box.h}`);
    clone.setAttribute("width", String(Math.round(box.w * 1.5))); clone.setAttribute("height", String(Math.round(box.h * 1.5)));
    let xml = new XMLSerializer().serializeToString(clone);
    const cs = getComputedStyle(document.documentElement);
    for (const v of ["surface", "border", "foreground", "primary", "foreground-muted", "background"]) xml = xml.split(`var(--${v})`).join(cs.getPropertyValue(`--${v}`).trim() || "#888");
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = img.width * 2; c.height = img.height * 2;
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(img, 0, 0, c.width, c.height);
      c.toBlob((b) => b && triggerDownload(b, `${safeName(map.title, "Concept map")}.png`));
    };
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(xml);
    count("map.exportPng");
  }
  function exportOutline() {
    triggerDownload(new Blob([outline(map)], { type: "text/markdown" }), `${safeName(map.title, "Concept map")}.md`);
    count("map.exportOutline");
  }

  const totalDue = [...stats.values()].reduce((s, x) => s + x.due, 0);
  const weak = [...map.nodes].map((n) => ({ n, s: stats.get(n.id)! })).filter((x) => x.s.mistakes > 0 || (x.s.mastery !== null && x.s.mastery < 0.4)).sort((a, b) => b.s.mistakes - a.s.mistakes || (a.s.mastery ?? 0) - (b.s.mastery ?? 0)).slice(0, 5);
  const uncovered = map.nodes.filter((n) => stats.get(n.id)!.cards === 0).length;

  const tb = "flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm hover:bg-surface-secondary disabled:opacity-40";
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button onClick={() => go({ name: "graph" })} className={tb}><ArrowLeft size={14} /> Maps</button>
        <input value={map.title} onChange={(e) => update({ ...map, title: e.target.value })} className="min-w-0 flex-1 bg-transparent text-xl font-semibold outline-none" aria-label="Map title" />
        <div className="relative"><Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-foreground-muted" /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a concept" className="w-40 rounded-lg border border-border bg-surface py-1.5 pl-7 pr-2 text-sm outline-none focus:border-primary" /></div>
      </div>
      <div className="mb-3 flex flex-wrap gap-1.5">
        <button onClick={addNode} className={tb}><Plus size={14} /> Concept</button>
        <button onClick={() => setConnectFrom(connectFrom ? null : node?.id ?? "")} className={`${tb} ${connectFrom !== null ? "!border-primary !bg-primary/10 text-primary" : ""}`} title="Tap one concept, then another, to link them"><GitBranch size={14} /> {connectFrom !== null ? (connectFrom ? "Tap the second concept" : "Tap the first concept") : "Link"}</button>
        <button onClick={() => { update({ ...map, nodes: layoutRadial(map.nodes, map.edges), updatedAt: Date.now() }); setFit((f) => f + 1); }} className={tb} title="Tidy the layout"><Wand2 size={14} /> Tidy</button>
        <button onClick={() => setColorMode(colorMode === "branch" ? "mastery" : "branch")} className={`${tb} ${colorMode === "mastery" ? "!border-primary !bg-primary/10 text-primary" : ""}`} title="Colour concepts by how well you know them"><Palette size={14} /> {colorMode === "mastery" ? "Showing what I know" : "Colour by knowledge"}</button>
        <button onClick={() => setRecall(true)} disabled={map.nodes.length < 3} className={tb}><Eye size={14} /> Test me from memory</button>
        <button onClick={() => setShowOrder((v) => !v)} className={`${tb} ${showOrder ? "!border-primary !bg-primary/10 text-primary" : ""}`}><ListOrdered size={14} /> Study order</button>
        <button onClick={() => void saveCards(cardsFromMap(map), "manual")} disabled={!map.edges.length && !map.nodes.some((n) => n.note)} className={tb} title="One card per link, plus definitions"><Layers size={14} /> Cards from map</button>
        <button onClick={exportPng} className={tb}><Download size={14} /> PNG</button>
        <button onClick={exportOutline} className={tb}><Download size={14} /> Outline</button>
        <button onClick={() => { if (confirm(`Delete "${map.title}"?`)) void deleteMap(map.id).then(onDeleted); }} className={`${tb} text-negative`}><Trash2 size={14} /></button>
      </div>

      {colorMode === "mastery" && (
        <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-border bg-surface px-3 py-2 text-xs text-foreground-muted">
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: "#9ca3af" }} /> no cards yet ({uncovered})</span>
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-16 rounded-full" style={{ background: "linear-gradient(90deg,hsl(0 62% 46%),hsl(60 62% 46%),hsl(120 62% 46%))" }} /> new → well known</span>
          <span><b className="text-negative">!</b> unresolved mistakes</span><span>red badge = cards due ({totalDue})</span>
          {weak.length > 0 && <span className="ml-auto text-foreground">Weakest: {weak.map((w) => w.n.label).join(", ")}</span>}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
        <div className="h-[62vh] min-h-[380px]"><ConceptMapView map={map} onChange={update} selected={sel} onSelect={(s) => { setSel(s); }} stats={stats} colorMode={colorMode} matches={matches} connectFrom={connectFrom === "" ? null : connectFrom}
          onPick={onPick} fitSignal={fit} svgRef={svgRef} /></div>

        <div className="space-y-3">
          {connectFrom === "" && <Card className="px-4 py-3 text-sm">Tap the concept the link starts from…</Card>}
          {node && <NodePanel key={node.id} node={node} stats={stats.get(node.id)!} notes={[]} ai={ai} map={map}
            onChange={(p) => patchNode(node.id, p)} onDelete={() => deleteNode(node.id)} onStudy={() => studyNode(node)} onMakeCards={() => void makeNodeCards(node)} onExpand={() => void expand(node)}
            onLink={() => setConnectFrom(node.id)} />}
          {edge && <EdgePanel key={edge.id} edge={edge} a={byId.get(edge.from)!} b={byId.get(edge.to)!} ai={ai} onChange={(p) => patchEdge(edge.id, p)}
            onDelete={() => { update({ ...map, edges: map.edges.filter((e) => e.id !== edge.id) }); setSel(null); }} setBusy={setBusy} flash={flash} />}
          {!node && !edge && (
            <Card className="px-4 py-3.5 text-sm">
              <p className="font-semibold">{map.nodes.length} concepts · {map.edges.length} links</p>
              <p className="mt-1 text-xs text-foreground-muted">Tap a concept or a link to edit it. Drag concepts to arrange them; drag the background to pan; pinch to zoom.</p>
              <div className="mt-3 space-y-1 text-xs">
                {EDGE_KINDS.map((k) => <p key={k} className="flex items-center gap-2"><span className="inline-block h-0.5 w-6" style={{ background: EDGE_COLOR[k], borderTop: k === "contrast" ? "2px dashed " + EDGE_COLOR[k] : undefined }} /> {KIND_LABEL[k]}</p>)}
              </div>
            </Card>
          )}
          {showOrder && (
            <Card className="px-4 py-3.5">
              <p className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">Suggested study order</p>
              <ol className="mt-2 space-y-1 text-sm">
                {order.map((n, i) => <li key={n.id}><button onClick={() => setSel({ type: "node", id: n.id })} className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left hover:bg-surface-secondary"><span className="w-5 text-right text-xs text-foreground-muted">{i + 1}</span><span className="truncate">{n.label}</span></button></li>)}
              </ol>
              <p className="mt-2 text-[11px] text-foreground-muted">Prerequisites, wholes and causes come before what depends on them.</p>
            </Card>
          )}
        </div>
      </div>

      {pending && <LinkModal a={byId.get(pending.a)!} b={byId.get(pending.b)!} ai={ai} onClose={() => setPending(null)} setBusy={setBusy}
        onAdd={(label, kind) => { const id = `e${Date.now().toString(36)}`; update({ ...map, edges: [...map.edges.filter((e) => !((e.from === pending.a && e.to === pending.b) || (e.from === pending.b && e.to === pending.a))), { id, from: pending.a, to: pending.b, label, kind }] }); setPending(null); setSel({ type: "edge", id }); count("map.link"); }} />}
      {recall && <RecallMode map={map} ai={ai} onClose={() => setRecall(false)} onCards={(c) => void saveCards(c, "manual")} />}
      {busy && <div className="fixed inset-x-0 bottom-6 z-50 flex justify-center"><div className="flex items-center gap-2 rounded-full border border-border bg-surface px-4 py-2 text-sm shadow-xl"><Loader2 size={14} className="animate-spin" /> {busy}</div></div>}
      <Toast msg={toast} />
    </div>
  );
}

function fitFor(nodes: MapNode[]) {
  const w = (n: MapNode) => Math.max(96, n.label.length * 8.4 + 30);
  const x0 = Math.min(...nodes.map((n) => n.x - w(n) / 2)) - 50, x1 = Math.max(...nodes.map((n) => n.x + w(n) / 2)) + 50;
  const y0 = Math.min(...nodes.map((n) => n.y - 20)) - 50, y1 = Math.max(...nodes.map((n) => n.y + 20)) + 50;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

function NodePanel({ node, stats, ai, map, onChange, onDelete, onStudy, onMakeCards, onExpand, onLink }: {
  node: MapNode; stats: NodeStats; notes: NoteMeta[]; ai: boolean; map: ConceptMap; onChange: (p: Partial<MapNode>) => void; onDelete: () => void;
  onStudy: () => void; onMakeCards: () => void; onExpand: () => void; onLink: () => void;
}) {
  const field = "mt-1 block w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-primary";
  const links = map.edges.filter((e) => e.from === node.id || e.to === node.id).length;
  return (
    <Card className="space-y-3 px-4 py-3.5">
      <label className="block text-xs text-foreground-muted">Concept<input value={node.label} onChange={(e) => onChange({ label: e.target.value })} className={`${field} font-semibold`} /></label>
      <label className="block text-xs text-foreground-muted">In my words<textarea value={node.note ?? ""} onChange={(e) => onChange({ note: e.target.value })} rows={3} placeholder="A one-line definition you'd be happy to be tested on" className={`${field} resize-none`} /></label>
      <div className="flex flex-wrap gap-1.5 text-xs text-foreground-muted">
        <span className="rounded-full bg-surface-secondary px-2 py-0.5">{links} link{links === 1 ? "" : "s"}</span>
        <span className="rounded-full bg-surface-secondary px-2 py-0.5">{stats.cards} card{stats.cards === 1 ? "" : "s"}</span>
        {stats.mastery !== null && <span className="rounded-full bg-surface-secondary px-2 py-0.5">{Math.round(stats.mastery * 100)}% known</span>}
        {stats.due > 0 && <span className="rounded-full bg-negative/10 px-2 py-0.5 text-negative">{stats.due} due</span>}
        {stats.mistakes > 0 && <span className="rounded-full bg-negative/10 px-2 py-0.5 text-negative">{stats.mistakes} mistake{stats.mistakes === 1 ? "" : "s"}</span>}
      </div>
      {node.refs?.length ? (
        <div>
          <p className="text-xs text-foreground-muted">In my notes</p>
          <div className="mt-1 flex flex-wrap gap-1.5">{node.refs.map((r, i) => <button key={i} onClick={() => go({ name: "note", id: r.noteId, page: r.page, hl: node.label })} className="rounded-full border border-border px-2.5 py-0.5 text-xs text-primary hover:bg-surface-secondary">page {r.page + 1} ↗</button>)}</div>
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-1.5">
        {stats.cards > 0 ? <Button variant="primary" onClick={onStudy}>Study this</Button> : <Button variant="primary" onClick={onMakeCards} disabled={!ai}><BookmarkPlus size={14} /> Make cards</Button>}
        <Button onClick={onExpand} disabled={!ai}><Sparkles size={14} /> Expand</Button>
        <Button onClick={onLink}><GitBranch size={14} /> Link to…</Button>
        <Button variant="danger" onClick={onDelete}><Trash2 size={14} /> Delete</Button>
      </div>
      {stats.cards > 0 && <button onClick={onMakeCards} disabled={!ai} className="text-xs text-primary hover:underline disabled:opacity-40">Make more cards for this</button>}
    </Card>
  );
}

function EdgePanel({ edge, a, b, ai, onChange, onDelete, setBusy, flash }: {
  edge: MapEdge; a: MapNode; b: MapNode; ai: boolean; onChange: (p: Partial<MapEdge>) => void; onDelete: () => void; setBusy: (m: string | null) => void; flash: (m: string) => void;
}) {
  const [why, setWhy] = useState<Connection | null>(null);
  async function explain() {
    setBusy("Thinking about how they connect…");
    try { setWhy(await explainConnection(a.label, b.label, await excerptsFor(`${a.label} ${b.label}`, 5))); count("map.explainLink"); }
    catch (e) { flash(e instanceof AiError ? e.message : `Couldn't explain: ${(e as Error).message}`); } finally { setBusy(null); }
  }
  const field = "mt-1 block w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-primary";
  return (
    <Card className="space-y-3 px-4 py-3.5">
      <p className="text-sm"><b>{a.label}</b> <span style={{ color: EDGE_COLOR[edge.kind] }}>— {edge.label} →</span> <b>{b.label}</b></p>
      <label className="block text-xs text-foreground-muted">Link wording<input value={edge.label} onChange={(e) => onChange({ label: e.target.value })} className={field} /></label>
      <label className="block text-xs text-foreground-muted">Kind of link
        <select value={edge.kind} onChange={(e) => onChange({ kind: e.target.value as EdgeKind })} className={field}>{EDGE_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select>
      </label>
      {why && (
        <div className="rounded-xl bg-surface-secondary px-3 py-2.5 text-sm">
          <RichText text={why.explanation} />
          {why.question && <p className="mt-2 text-foreground-muted"><b>Test yourself:</b> <RichText text={why.question} /></p>}
          {(why.label !== edge.label || why.kind !== edge.kind) && <button onClick={() => onChange({ label: why.label, kind: why.kind })} className="mt-2 text-xs text-primary hover:underline">Use “{why.label}” as the link wording</button>}
        </div>
      )}
      <div className="grid grid-cols-2 gap-1.5">
        <Button onClick={() => void explain()} disabled={!ai}><Sparkles size={14} /> Explain</Button>
        <Button onClick={() => onChange({ from: edge.to, to: edge.from })}><ArrowLeftRight size={14} /> Reverse</Button>
        <Button variant="danger" className="col-span-2" onClick={onDelete}><Trash2 size={14} /> Delete link</Button>
      </div>
    </Card>
  );
}

function LinkModal({ a, b, ai, onClose, onAdd, setBusy }: { a: MapNode; b: MapNode; ai: boolean; onClose: () => void; onAdd: (label: string, kind: EdgeKind) => void; setBusy: (m: string | null) => void }) {
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState<EdgeKind>("other");
  const [why, setWhy] = useState<Connection | null>(null);
  const [err, setErr] = useState<string | null>(null);
  async function ask() {
    setBusy("Thinking about how they connect…"); setErr(null);
    try { const c = await explainConnection(a.label, b.label, await excerptsFor(`${a.label} ${b.label}`, 5)); setWhy(c); setLabel(c.label); setKind(c.kind); count("map.explainLink"); }
    catch (e) { setErr(e instanceof AiError ? e.message : (e as Error).message); } finally { setBusy(null); }
  }
  const field = "mt-1 block w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary";
  return (
    <Modal title="Link two concepts" onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm"><b>{a.label}</b> → <b>{b.label}</b></p>
        <p className="text-xs text-foreground-muted">Say how they&apos;re connected in a few words — writing it yourself is the part that helps you learn. Or ask the AI.</p>
        <label className="block text-xs text-foreground-muted">How are they related?<input autoFocus value={label} onChange={(e) => { setLabel(e.target.value); }} placeholder="e.g. causes, is part of, requires" className={field} /></label>
        <label className="block text-xs text-foreground-muted">Kind<select value={kind} onChange={(e) => setKind(e.target.value as EdgeKind)} className={field}>{EDGE_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select></label>
        {why && <div className="rounded-xl bg-surface-secondary px-3 py-2.5 text-sm"><RichText text={why.explanation} />{why.question && <p className="mt-2 text-foreground-muted"><b>Test yourself:</b> <RichText text={why.question} /></p>}</div>}
        {err && <p className="text-sm text-negative">{err}</p>}
        <div className="flex gap-2">
          <Button variant="primary" disabled={!label.trim()} onClick={() => onAdd(label.trim(), kind === "other" ? inferKind(label) : kind)}>Add link</Button>
          <Button onClick={() => void ask()} disabled={!ai}><Sparkles size={14} /> Ask AI how they connect</Button>
          <Button variant="ghost" onClick={onClose}><X size={14} /></Button>
        </div>
      </div>
    </Modal>
  );
}

// ======================================================================================================================================
// The original "notes that sound alike" view
// ======================================================================================================================================
function NoteLinks() {
  const [notes, setNotes] = useState<NoteMeta[] | null>(null);
  const [notebooks, setNotebooks] = useState<NotebookRec[]>([]);
  const [texts, setTexts] = useState<PageTextRec[]>([]);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([listNotes(), listNotebooks(), getPageTexts()]).then(([n, nb, t]) => { setNotes(n); setNotebooks(nb); setTexts(t); });
  }, []);

  const graph = useMemo(() => {
    if (!notes) return null;
    return buildGraph(
      notes.filter((n) => n.strokeCount > 0 || n.imageCount > 0).map((n) => ({ id: n.id, title: n.title, notebookId: n.notebookId, pages: n.pageCount })),
      texts.map((t) => ({ noteId: t.noteId, text: t.text }))
    );
  }, [notes, texts]);

  const colorOf = (nb: string | null) => notebooks.find((b) => b.id === nb)?.color ?? "#8a948d";
  const sel = graph?.nodes.find((n) => n.id === selected) ?? null;
  const linked = useMemo(() => {
    if (!graph || !selected) return new Set<string>();
    const s = new Set<string>([selected]);
    for (const e of graph.edges) { if (e.a === selected) s.add(e.b); if (e.b === selected) s.add(e.a); }
    return s;
  }, [graph, selected]);
  const selEdges = graph?.edges.filter((e) => e.a === selected || e.b === selected) ?? [];

  if (!graph) return <p className="py-16 text-center text-sm text-foreground-muted">Loading…</p>;
  if (graph.nodes.length < 2) return <Card className="px-6 py-10 text-center text-sm text-foreground-muted">Add a few more notes and they&apos;ll start linking up.</Card>;
  return (
    <div>
      <p className="mb-3 text-sm text-foreground-muted">Notes that talk about the same things, linked automatically (no AI). Handy for spotting overlap between notes; for learning, use a concept map.</p>
      <div className="grid gap-5 lg:grid-cols-[1fr_280px]">
        <Card className="overflow-hidden">
          <svg viewBox="0 0 1000 1000" className="aspect-square w-full touch-manipulation" onClick={() => setSelected(null)}>
            {graph.edges.map((e) => {
              const a = graph.nodes.find((n) => n.id === e.a)!, b = graph.nodes.find((n) => n.id === e.b)!;
              const on = !selected || (linked.has(e.a) && linked.has(e.b) && (e.a === selected || e.b === selected));
              return <line key={e.a + e.b} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--foreground-muted)" strokeOpacity={on ? 0.25 + e.weight : 0.06} strokeWidth={1 + e.weight * 5} strokeDasharray={e.weight < 0.2 ? "6 6" : undefined} />;
            })}
            {graph.nodes.map((n: GraphNode) => {
              const r = 9 + Math.min(16, n.pages * 1.1);
              const dim = selected && !linked.has(n.id);
              return (
                <g key={n.id} transform={`translate(${n.x},${n.y})`} opacity={dim ? 0.25 : 1} style={{ cursor: "pointer" }} onClick={(ev) => { ev.stopPropagation(); setSelected(n.id === selected ? null : n.id); }}>
                  <circle r={r + 6} fill="transparent" />
                  <circle r={r} fill={colorOf(n.notebookId)} stroke={n.id === selected ? "var(--foreground)" : "var(--surface)"} strokeWidth={n.id === selected ? 4 : 3} />
                  <text y={r + 22} textAnchor="middle" fontSize="22" fill="var(--foreground)" style={{ paintOrder: "stroke", stroke: "var(--background)", strokeWidth: 5 }}>{n.title.length > 22 ? n.title.slice(0, 21) + "…" : n.title}</text>
                </g>
              );
            })}
          </svg>
        </Card>
        <div className="space-y-3">
          <Card className="px-4 py-3.5">
            {sel ? (
              <>
                <p className="text-sm font-semibold">{sel.title}</p>
                <p className="mt-0.5 text-xs text-foreground-muted">{sel.pages} page{sel.pages === 1 ? "" : "s"}{sel.terms.length ? ` · ${sel.terms.join(", ")}` : ""}</p>
                <Button variant="primary" className="mt-3 w-full" onClick={() => go({ name: "note", id: sel.id })}>Open note</Button>
                <p className="mb-1.5 mt-4 text-[11px] font-semibold uppercase tracking-wider text-foreground-muted">Connected to</p>
                {selEdges.length === 0 ? <p className="text-xs text-foreground-muted">Nothing similar yet.</p> : (
                  <ul className="space-y-2">
                    {selEdges.sort((x, y) => y.weight - x.weight).map((e) => {
                      const other = graph.nodes.find((n) => n.id === (e.a === sel.id ? e.b : e.a))!;
                      return (
                        <li key={e.a + e.b}>
                          <button onClick={() => setSelected(other.id)} className="w-full rounded-lg px-2 py-1.5 text-left hover:bg-surface-secondary">
                            <span className="block truncate text-sm font-medium">{other.title}</span>
                            <span className="block truncate text-xs text-foreground-muted">{e.shared.join(", ")}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </>
            ) : <p className="text-sm text-foreground-muted">Tap a note on the map.</p>}
          </Card>
          <div className="flex flex-wrap gap-x-3 gap-y-1 px-1 text-xs text-foreground-muted">
            {notebooks.map((b) => <span key={b.id} className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: b.color }} />{b.name}</span>)}
          </div>
        </div>
      </div>
    </div>
  );
}
