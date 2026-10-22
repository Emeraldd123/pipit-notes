import { useEffect, useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { go } from "@/router";
import { getPageTexts, listNotebooks, listNotes } from "@/lib/db";
import { buildGraph, type GraphNode } from "@/lib/related";
import type { NoteMeta, NotebookRec, PageTextRec } from "@/types";
import { Button, Card } from "@/components/ui";

export function GraphPage() {
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

  return (
    <div className="paper-bg safe-t min-h-full">
      <div className="mx-auto max-w-5xl px-5 py-6 md:py-10">
        <button onClick={() => go({ name: "library", notebook: null, q: "" })} className="mb-6 flex items-center gap-1.5 text-sm text-foreground-muted hover:text-foreground"><ArrowLeft size={15} /> All notes</button>
        <h1 className="serif text-4xl tracking-tight">A second brain <span className="serif-i text-primary">that builds itself</span></h1>
        <p className="mt-1 text-sm text-foreground-muted">Notes link up by what they talk about. Tap a note to see how it connects. The more handwriting you&apos;ve “read” (Search → Read my handwriting), the richer the map.</p>

        {!graph ? <p className="py-16 text-center text-sm text-foreground-muted">Loading…</p> : graph.nodes.length < 2 ? (
          <Card className="mt-8 px-6 py-10 text-center text-sm text-foreground-muted">Add a few more notes and they&apos;ll start linking up.</Card>
        ) : (
          <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_280px]">
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
        )}
      </div>
    </div>
  );
}
