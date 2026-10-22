import { useMemo, useState } from "react";
import { BookmarkPlus, Check, ChevronRight, Eye, Loader2, PenLine, Type, X } from "lucide-react";
import { Button, Modal } from "@/components/ui";
import { InkPad } from "@/components/ink-pad";
import { RichText } from "@/components/blocks";
import { transcribeRegion } from "@/lib/ai";
import { cardsFromMap, linkAnswer, scoreRecall, type ConceptMap, type MapCard } from "@/lib/map-core";
import { shuffle } from "@/lib/study-core";
import { KIND_LABEL } from "@/lib/map-core";

type Stage = "write" | "reveal" | "links" | "done";

/**
 * "Draw it from memory": the map is hidden. Write down every concept you remember, see what you
 * missed, then recall how pairs of concepts connect. Retrieval practice on the map itself.
 */
export function RecallMode({ map, ai, onClose, onCards }: { map: ConceptMap; ai: boolean; onClose: () => void; onCards: (c: MapCard[]) => void }) {
  const [stage, setStage] = useState<Stage>("write");
  const [typed, setTyped] = useState("");
  const [ink, setInk] = useState<string | undefined>();
  const [mode, setMode] = useState<"type" | "ink">("type");
  const [reading, setReading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [linkIdx, setLinkIdx] = useState(0);
  const [answer, setAnswer] = useState("");
  const [checked, setChecked] = useState<null | "ok" | "partial" | "miss">(null);
  const [linkResults, setLinkResults] = useState<("ok" | "partial" | "miss")[]>([]);

  const items = typed.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
  const score = useMemo(() => scoreRecall(map.nodes, items), [map.nodes, typed]); // eslint-disable-line react-hooks/exhaustive-deps
  const byId = useMemo(() => new Map(map.nodes.map((n) => [n.id, n])), [map.nodes]);
  const quizEdges = useMemo(() => shuffle(map.edges).slice(0, 8), [map.edges]);
  const edge = quizEdges[linkIdx];

  async function readInk() {
    if (!ink) return;
    setReading(true); setErr(null);
    try {
      const t = await transcribeRegion(ink);
      setTyped((cur) => (cur ? cur + "\n" : "") + t.replace(/^[-•*\d.)\s]+/gm, ""));
      setMode("type");
    } catch (e) { setErr((e as Error).message); } finally { setReading(false); }
  }

  const finishLinks = (res: typeof linkResults) => { setLinkResults(res); setStage("done"); };
  const next = () => {
    const res = [...linkResults, checked ?? "miss"];
    setAnswer(""); setChecked(null);
    if (linkIdx + 1 >= quizEdges.length) finishLinks(res); else { setLinkResults(res); setLinkIdx(linkIdx + 1); }
  };

  const missedNodes = new Set(score.missing);
  const missedCards = (): MapCard[] => {
    const all = cardsFromMap(map);
    const missedLabels = score.missing.map((id) => byId.get(id)!.label);
    const missedEdges = quizEdges.filter((_, i) => linkResults[i] !== "ok");
    const edgeFronts = new Set(missedEdges.map((e) => `How are ${byId.get(e.from)!.label} and ${byId.get(e.to)!.label} related?`));
    return all.filter((c) => missedLabels.some((l) => c.front === `What is ${l}?`) || edgeFronts.has(c.front));
  };
  const linkScore = linkResults.reduce((s, r) => s + (r === "ok" ? 1 : r === "partial" ? 0.5 : 0), 0);

  return (
    <Modal wide title={<span className="flex items-center gap-2"><Eye size={16} className="text-primary" /> Draw it from memory — {map.title}</span>} onClose={onClose}>
      {stage === "write" && (
        <div className="space-y-3">
          <p className="text-sm text-foreground-muted">The map is hidden. Write down every <b>concept</b> you can remember from <b>{map.title}</b> — one per line. Don&apos;t peek at your notes; trying to recall is what makes it stick. ({map.nodes.length} concepts on the map.)</p>
          <div className="flex gap-1.5 text-xs">
            <button onClick={() => setMode("type")} className={`flex items-center gap-1 rounded-lg px-2.5 py-1 ${mode === "type" ? "bg-primary text-white" : "bg-surface-secondary text-foreground-muted"}`}><Type size={12} /> Type</button>
            <button onClick={() => setMode("ink")} className={`flex items-center gap-1 rounded-lg px-2.5 py-1 ${mode === "ink" ? "bg-primary text-white" : "bg-surface-secondary text-foreground-muted"}`}><PenLine size={12} /> Handwrite</button>
          </div>
          {mode === "type"
            ? <textarea autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} rows={9} placeholder={"Enthalpy\nHess's law\n…"} className="w-full resize-y rounded-xl border-2 border-border bg-background px-3 py-2.5 text-base outline-none focus:border-primary" />
            : (
              <div className="space-y-2">
                <InkPad value={ink} onChange={setInk} height={260} />
                <Button onClick={readInk} disabled={!ink || reading || !ai}>{reading ? <Loader2 size={14} className="animate-spin" /> : <Type size={14} />} {ai ? "Turn my handwriting into the list" : "AI is off — type instead"}</Button>
              </div>
            )}
          {err && <p className="text-sm text-negative">{err}</p>}
          <div className="flex items-center justify-between">
            <span className="text-xs text-foreground-muted">{items.length} written so far</span>
            <Button variant="primary" disabled={items.length === 0} onClick={() => setStage("reveal")}>I&apos;m done <ChevronRight size={14} /></Button>
          </div>
        </div>
      )}

      {stage === "reveal" && (
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <div className="flex h-20 w-20 shrink-0 flex-col items-center justify-center rounded-full border-4 border-primary/30"><span className="text-xl font-bold">{score.percent}%</span></div>
            <p className="text-sm">You remembered <b>{score.found.length}</b> of <b>{map.nodes.length}</b> concepts.{score.percent >= 80 ? " Excellent recall!" : score.percent >= 50 ? " A decent start — look at what you missed." : " Plenty to review — that's what this is for."}</p>
          </div>
          <Group title="Remembered" tone="ok" labels={score.found.map((id) => byId.get(id)!.label)} />
          <Group title="Missed" tone="miss" labels={score.missing.map((id) => byId.get(id)!.label)} hint={(l) => map.nodes.find((n) => n.label === l)?.note} />
          {score.extras.length > 0 && <Group title="Not on the map" tone="extra" labels={score.extras} />}
          <div className="flex justify-between">
            <Button onClick={() => setStage("done")}>Skip the links</Button>
            <Button variant="primary" disabled={!quizEdges.length} onClick={() => setStage("links")}>Now recall the links <ChevronRight size={14} /></Button>
          </div>
        </div>
      )}

      {stage === "links" && edge && (
        <div className="space-y-4">
          <p className="text-xs text-foreground-muted">Link {linkIdx + 1} of {quizEdges.length}</p>
          <p className="text-lg font-semibold">How is <span className="text-primary">{byId.get(edge.from)?.label}</span> connected to <span className="text-primary">{byId.get(edge.to)?.label}</span>?</p>
          <input autoFocus value={answer} disabled={!!checked} onChange={(e) => setAnswer(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !checked) setChecked(linkAnswer(answer, edge)); }}
            placeholder="e.g. causes, is part of, requires…" className="w-full rounded-xl border-2 border-border bg-background px-3 py-2.5 text-base outline-none focus:border-primary" />
          {checked && (
            <div className={`rounded-xl border px-4 py-3 text-sm ${checked === "ok" ? "border-positive/40 bg-positive/10" : checked === "partial" ? "border-amber-500/40 bg-amber-500/10" : "border-negative/40 bg-negative/10"}`}>
              <p className="font-semibold">{checked === "ok" ? "Yes!" : checked === "partial" ? "Close" : "Not quite"}</p>
              <p className="mt-0.5">{byId.get(edge.from)?.label} — <b>{edge.label}</b> → {byId.get(edge.to)?.label} <span className="text-foreground-muted">({KIND_LABEL[edge.kind]})</span></p>
            </div>
          )}
          <div className="flex justify-end gap-2">
            {!checked ? <>
              <Button onClick={() => setChecked("miss")}>Show me</Button>
              <Button variant="primary" disabled={!answer.trim()} onClick={() => setChecked(linkAnswer(answer, edge))}>Check</Button>
            </> : <Button variant="primary" onClick={next}>{linkIdx + 1 >= quizEdges.length ? "Finish" : "Next"} <ChevronRight size={14} /></Button>}
          </div>
        </div>
      )}

      {stage === "done" && (
        <div className="space-y-4 text-center">
          <Check size={40} className="mx-auto text-positive" />
          <h3 className="text-xl font-bold">Recall finished</h3>
          <p className="text-sm">Concepts: <b>{score.percent}%</b> ({score.found.length}/{map.nodes.length}){linkResults.length > 0 && <> · Links: <b>{linkScore}/{quizEdges.length}</b></>}</p>
          {missedNodes.size > 0 && <p className="text-sm text-foreground-muted">Missed: {score.missing.map((id) => byId.get(id)!.label).join(", ")}</p>}
          <div className="flex flex-wrap justify-center gap-2">
            {missedCards().length > 0 && <Button variant="primary" onClick={() => { onCards(missedCards()); onClose(); }}><BookmarkPlus size={14} /> Make {missedCards().length} flashcards for what I missed</Button>}
            <Button onClick={onClose}>Back to the map</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function Group({ title, labels, tone, hint }: { title: string; labels: string[]; tone: "ok" | "miss" | "extra"; hint?: (l: string) => string | undefined }) {
  if (!labels.length) return null;
  const cls = tone === "ok" ? "border-positive/40 bg-positive/10" : tone === "miss" ? "border-negative/40 bg-negative/10" : "border-border bg-surface-secondary";
  return (
    <div>
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-foreground-muted">{title} · {labels.length}</p>
      <div className="flex flex-wrap gap-1.5">
        {labels.map((l) => <span key={l} title={hint?.(l)} className={`rounded-full border px-2.5 py-1 text-sm ${cls}`}>{tone === "miss" ? <X size={11} className="mr-1 inline text-negative" /> : null}<RichText text={l} /></span>)}
      </div>
    </div>
  );
}
