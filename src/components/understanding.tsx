import { useEffect, useRef, useState } from "react";
import { BookmarkPlus, ChevronLeft, ChevronRight, Check, Layers, ListChecks, Loader2, Pin, Send, X } from "lucide-react";
import { Button, Modal } from "@/components/ui";
import { RichText } from "@/components/blocks";
import type { Explanation } from "@/lib/ai";
import type { Issue } from "@/lib/review-core";

// --- highlight overlay (document coordinates, follows the camera like the blocks layer) ---------------

export type Highlight = { id: string; x: number; y: number; w: number; h: number; tone: "issue" | "active" | "explain" | "find"; label?: string };

export function HighlightLayer({ rects, innerRef, camRef }: {
  rects: Highlight[]; innerRef: React.RefObject<HTMLDivElement | null>;
  camRef: React.RefObject<{ scale: number; camX: number; camY: number }>;
}) {
  // the camera callback only fires on movement — paint the current camera when rects change too
  useEffect(() => {
    const el = innerRef.current, c = camRef.current;
    if (el && c) el.style.transform = `scale(${c.scale}) translate(${-c.camX}px, ${-c.camY}px)`;
  }, [rects, innerRef, camRef]);
  return (
    <div className="pointer-events-none absolute inset-0 z-[11] overflow-hidden">
      <div ref={innerRef} className="absolute left-0 top-0" style={{ transformOrigin: "0 0" }}>
        {rects.map((r) => {
          const color = r.tone === "explain" ? "37 99 235" : r.tone === "find" ? "234 179 8" : "220 38 38";
          const active = r.tone === "active" || r.tone === "explain" || r.tone === "find";
          return (
            <div key={r.id} className="absolute rounded-md" style={{
              left: r.x, top: r.y, width: r.w, height: r.h,
              background: `rgb(${color} / ${r.tone === "find" ? 0.38 : active ? 0.14 : 0.07})`,
              outline: `${active ? 4 : 2}px ${active ? "solid" : "dashed"} rgb(${color} / ${active ? 0.9 : 0.5})`,
              outlineOffset: 2,
            }}>
              {r.label && <span className="absolute -top-8 left-0 rounded-md px-2 py-0.5 text-white" style={{ background: `rgb(${color})`, fontSize: 18 }}>{r.label}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// --- explain panel ------------------------------------------------------------------------------------------------

export type ExplainState = {
  status: "loading" | "done" | "error";
  data?: Explanation;
  error?: string;
  turns: { role: "user" | "assistant"; content: string }[];
  asking: boolean;
};

export function ExplainPanel({ state, onAsk, onClose, onPin, onCards, onRetry }: { state: ExplainState; onAsk: (q: string) => void; onClose: () => void; onPin: () => void; onCards: () => void; onRetry: () => void }) {
  const [q, setQ] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "nearest" }); }, [state.turns.length, state.asking, state.status]);
  const send = (text: string) => { const t = text.trim(); if (!t || state.asking) return; onAsk(t); setQ(""); };
  const d = state.data;
  return (
    <div className="absolute inset-x-0 bottom-0 z-30 flex max-h-[58%] justify-center px-3 pb-3">
      <div className="flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">{d ? d.concept : "Explaining…"}</h3>
          {d && <button onClick={onPin} className="mr-1 flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-primary hover:bg-primary/10" title="Keep this explanation on the page next to your writing"><Pin size={13} /> Pin to note</button>}
          {d && <button onClick={onCards} className="mr-2 flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-primary hover:bg-primary/10" title="Turn this into flashcards"><Layers size={13} /> Flashcards</button>}
          <button onClick={onClose} className="rounded-md p-1 text-foreground-muted hover:bg-surface-secondary" title="Close"><X size={16} /></button>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-auto px-4 py-3 text-sm leading-relaxed">
          {state.status === "loading" && <p className="flex items-center gap-2 text-foreground-muted"><Loader2 size={14} className="animate-spin" /> Reading what you circled…</p>}
          {state.status === "error" && <p className="text-negative">{state.error}</p>}
          {d && (
            <>
              <RichText text={d.explanation} />
              <div className={`rounded-xl border px-3 py-2.5 ${d.shortfalls.length ? "border-negative/40 bg-negative/5" : "border-positive/40 bg-positive/10"}`}>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-foreground-muted">Where your understanding fell short</p>
                {d.shortfalls.length === 0 ? <p>Nothing I can fault — what you wrote matches the idea.</p> : (
                  <ul className="space-y-2.5">
                    {d.shortfalls.map((s, i) => (
                      <li key={i}>
                        <p className="font-medium"><RichText text={s.what} /></p>
                        {s.why && <p className="text-foreground-muted"><RichText text={s.why} /></p>}
                        {s.fix && <p className="mt-0.5"><span className="font-medium text-positive">Instead: </span><RichText text={s.fix} /></p>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
          {d && state.turns.length === 0 && (
            <button onClick={onRetry} className="text-xs text-foreground-muted underline decoration-dotted hover:text-foreground">Not right? Ask again, more carefully</button>
          )}
          {state.turns.map((t, i) => (
            <div key={i} className={t.role === "user" ? "rounded-xl bg-primary/10 px-3 py-2 text-primary" : ""}><RichText text={t.content} /></div>
          ))}
          {state.asking && <p className="flex items-center gap-2 text-foreground-muted"><Loader2 size={14} className="animate-spin" /> Thinking…</p>}
          <div ref={endRef} />
        </div>
        {d && (
          <div className="border-t border-border px-3 py-2">
            {d.followups.length > 0 && state.turns.length === 0 && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {d.followups.map((f, i) => <button key={i} onClick={() => send(f)} className="rounded-full border border-border px-2.5 py-1 text-xs hover:bg-surface-secondary">{f}</button>)}
              </div>
            )}
            <form onSubmit={(e) => { e.preventDefault(); send(q); }} className="flex items-center gap-2">
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask a follow-up…" className="min-w-0 flex-1 rounded-lg border border-border bg-transparent px-3 py-2 text-sm outline-none focus:border-primary" />
              <button type="submit" disabled={!q.trim() || state.asking} className="rounded-lg bg-primary p-2 text-white disabled:opacity-40" title="Send"><Send size={15} /></button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}

// --- review: page picker ------------------------------------------------------------------------------------------

export function ReviewSetup({ pageCount, currentPage, thumb, inkPages, costHint, onStart, onClose }: {
  pageCount: number; currentPage: number; thumb: (p: number) => string | null;
  /** which pages have any writing — blank or printed-only pages are skipped (nothing of yours to check, and no cost) */
  inkPages: boolean[]; costHint: (pages: number) => string;
  onStart: (pages: number[]) => void; onClose: () => void;
}) {
  const [sel, setSel] = useState<Set<number>>(() => new Set(inkPages[currentPage] ? [currentPage] : []));
  const toggle = (p: number) => setSel((s) => { const n = new Set(s); if (n.has(p)) n.delete(p); else n.add(p); return n; });
  const all = Array.from({ length: pageCount }, (_, i) => i);
  const written = all.filter((p) => inkPages[p]);
  return (
    <Modal title="Review for mistakes" onClose={onClose} wide>
      <p className="mb-3 text-sm text-foreground-muted">Pick the pages to check. I&apos;ll find every mistake and walk you through them from top to bottom. Only pages you&apos;ve written on can be reviewed, and a page that hasn&apos;t changed since the last review costs nothing.</p>
      <div className="mb-3 flex flex-wrap gap-2">
        <Button onClick={() => setSel(new Set(written))}>Whole note ({written.length} written)</Button>
        <Button disabled={!inkPages[currentPage]} onClick={() => setSel(new Set([currentPage]))}>This page</Button>
        <Button variant="ghost" onClick={() => setSel(new Set())}>Clear</Button>
      </div>
      <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 md:grid-cols-5">
        {all.map((p) => {
          const on = sel.has(p), src = thumb(p);
          return (
            <button key={p} disabled={!inkPages[p]} onClick={() => toggle(p)} title={inkPages[p] ? undefined : "Nothing written on this page"} className={`relative overflow-hidden rounded-lg border-2 bg-white text-left ${on ? "border-primary" : "border-border"} ${inkPages[p] ? "" : "opacity-35"}`}>
              {src ? <img src={src} alt="" className="block aspect-[1240/1754] w-full object-cover" draggable={false} /> : <div className="aspect-[1240/1754] w-full" />}
              <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 text-[11px] text-white">{p + 1}</span>
              {on && <span className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-white"><Check size={12} /></span>}
            </button>
          );
        })}
      </div>
      <div className="mt-4 flex items-center justify-between">
        <span className="text-sm text-foreground-muted">{sel.size} page{sel.size === 1 ? "" : "s"} selected · {costHint(sel.size)}</span>
        <Button variant="primary" disabled={sel.size === 0} onClick={() => onStart([...sel].sort((a, b) => a - b))}><ListChecks size={15} /> Find mistakes</Button>
      </div>
    </Modal>
  );
}

// --- review: stepper ----------------------------------------------------------------------------------------------

export type ReviewState = { issues: Issue[]; i: number; fixed: Set<string>; failedPages: number[] };

export function ReviewBar({ review, onGo, onToggleFixed, onDismiss, onClose, onCard }: {
  review: ReviewState; onGo: (i: number) => void; onToggleFixed: (id: string) => void; onDismiss: (id: string) => void; onClose: () => void; onCard: (i: Issue) => void;
}) {
  const [list, setList] = useState(false);
  const { issues, i } = review;
  const it = issues[i];
  if (!it) {
    return (
      <div className="absolute inset-x-0 bottom-0 z-30 flex justify-center px-3 pb-3">
        <div className="flex w-full max-w-xl items-center justify-between gap-3 rounded-2xl border border-border bg-surface px-4 py-3 shadow-2xl">
          <span className="text-sm">All reviewed — nothing left to check. 🎉</span>
          <Button onClick={onClose}>Done</Button>
        </div>
      </div>
    );
  }
  const fixed = review.fixed.has(it.id);
  const remaining = issues.filter((x) => !review.fixed.has(x.id)).length;
  return (
    <div className="absolute inset-x-0 bottom-0 z-30 flex justify-center px-3 pb-3">
      <div className="flex max-h-[52vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <button onClick={() => onGo(i - 1)} disabled={i === 0} className="rounded-md p-1.5 text-foreground-muted hover:bg-surface-secondary disabled:opacity-30" title="Previous mistake"><ChevronLeft size={18} /></button>
          <button onClick={() => setList((v) => !v)} className="flex-1 text-left text-sm font-semibold" title="Show all">
            Mistake {i + 1} of {issues.length} <span className="font-normal text-foreground-muted">· page {it.page + 1} · {it.kind.replace("-", " ")}{it.confidence === "medium" ? " · not sure" : ""} · {remaining} left</span>
          </button>
          <button onClick={() => onGo(i + 1)} disabled={i >= issues.length - 1} className="rounded-md p-1.5 text-foreground-muted hover:bg-surface-secondary disabled:opacity-30" title="Next mistake"><ChevronRight size={18} /></button>
          <button onClick={onClose} className="rounded-md p-1.5 text-foreground-muted hover:bg-surface-secondary" title="Close review"><X size={16} /></button>
        </div>
        {list ? (
          <ol className="min-h-0 flex-1 divide-y divide-border overflow-auto text-sm">
            {issues.map((x, n) => (
              <li key={x.id}>
                <button onClick={() => { onGo(n); setList(false); }} className={`flex w-full items-start gap-2 px-4 py-2 text-left hover:bg-surface-secondary ${n === i ? "bg-primary/5" : ""}`}>
                  <span className="w-12 shrink-0 text-xs text-foreground-muted">p{x.page + 1}</span>
                  <span className={`min-w-0 flex-1 ${review.fixed.has(x.id) ? "text-foreground-muted line-through" : ""}`}><RichText text={x.problem} /></span>
                </button>
              </li>
            ))}
          </ol>
        ) : (
          <div className="min-h-0 flex-1 space-y-2 overflow-auto px-4 py-3 text-sm leading-relaxed">
            {it.read && <p className="text-xs text-foreground-muted">I read: <RichText text={it.read} /></p>}
            <p className={`font-medium ${fixed ? "text-foreground-muted line-through" : ""}`}><RichText text={it.problem} /></p>
            {it.why && <p className="text-foreground-muted"><RichText text={it.why} /></p>}
            {it.fix && <p><span className="font-medium text-positive">Should be: </span><RichText text={it.fix} /></p>}
          </div>
        )}
        {!list && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-2">
            <div className="flex gap-1.5">
              <Button onClick={() => onToggleFixed(it.id)}><Check size={14} /> {fixed ? "Unmark" : "Mark fixed"}</Button>
              <Button variant="ghost" onClick={() => onCard(it)} title="Add a flashcard so you remember this one"><BookmarkPlus size={14} /> Flashcard</Button>
              <Button variant="ghost" onClick={() => onDismiss(it.id)} title="Remove this one if I got it wrong">Not a mistake</Button>
            </div>
            <Button variant="primary" onClick={() => (i < issues.length - 1 ? onGo(i + 1) : onClose())}>{i < issues.length - 1 ? "Next" : "Finish"} <ChevronRight size={14} /></Button>
          </div>
        )}
        {review.failedPages.length > 0 && <p className="border-t border-border px-4 py-1.5 text-xs text-negative">Couldn&apos;t review page{review.failedPages.length === 1 ? "" : "s"} {review.failedPages.map((p) => p + 1).join(", ")} — try again.</p>}
      </div>
    </div>
  );
}
