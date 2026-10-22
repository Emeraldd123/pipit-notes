import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, BookOpenCheck, FileText, Loader2, MessageSquareText, ScanText, Search, Sparkles } from "lucide-react";
import { go } from "@/router";
import { corpusExcerpts, excerptsFor, indexNote, searchNotes, type Hit } from "@/lib/search";
import { askNotes, AiError, practiceQuestions, type Excerpt, type PracticeQuestion } from "@/lib/ai";
import { getPageTexts, listNotebooks, listNotes } from "@/lib/db";
import { aiReady, useSettings } from "@/lib/settings";
import type { NoteMeta, NotebookRec } from "@/types";
import { Button, Card, Wordmark } from "@/components/ui";
import { RichText } from "@/components/blocks";

type Mode = "search" | "ask" | "practice";

export function SearchPage() {
  const settings = useSettings();
  const ai = aiReady(settings);
  const [mode, setMode] = useState<Mode>("search");
  const [notes, setNotes] = useState<NoteMeta[]>([]);
  const [notebooks, setNotebooks] = useState<NotebookRec[]>([]);
  const [indexedPages, setIndexedPages] = useState(0);

  useEffect(() => {
    void Promise.all([listNotes(), listNotebooks(), getPageTexts()]).then(([n, nb, t]) => { setNotes(n); setNotebooks(nb); setIndexedPages(t.length); });
  }, []);

  return (
    <div className="paper-bg safe-t min-h-full">
      <div className="mx-auto max-w-3xl px-5 py-6 md:py-10">
        <button onClick={() => go({ name: "library", notebook: null, q: "" })} className="mb-6 flex items-center gap-1.5 text-sm text-foreground-muted hover:text-foreground">
          <ArrowLeft size={15} /> All notes
        </button>
        <h1 className="serif text-4xl tracking-tight">Search <span className="serif-i text-primary">&amp; ask</span></h1>
        <p className="mt-1 text-sm text-foreground-muted">{indexedPages} page{indexedPages === 1 ? "" : "s"} of text across {notes.length} note{notes.length === 1 ? "" : "s"} — searched on this device.</p>

        <div className="mt-6 inline-flex rounded-xl border border-border bg-surface p-1 text-sm">
          {([["search", "Search", <Search key="s" size={14} />], ["ask", "Ask", <MessageSquareText key="a" size={14} />], ["practice", "Practice exam", <BookOpenCheck key="p" size={14} />]] as const).map(([id, label, icon]) => (
            <button key={id} onClick={() => setMode(id)} className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 font-medium ${mode === id ? "bg-primary text-white" : "text-foreground-muted hover:bg-surface-secondary"}`}>{icon}{label}</button>
          ))}
        </div>

        <div className="mt-5">
          {mode === "search" && <SearchTab notes={notes} onIndexed={(n) => setIndexedPages(n)} ai={ai} />}
          {mode === "ask" && <AskTab ai={ai} />}
          {mode === "practice" && <PracticeTab ai={ai} notes={notes} notebooks={notebooks} />}
        </div>
        <div className="mt-10 flex justify-center opacity-60"><Wordmark size="sm" /></div>
      </div>
    </div>
  );
}

function NeedAi() {
  return (
    <Card className="px-5 py-4 text-sm">
      <p><strong>AI is off.</strong> This feature reads your notes with an AI model. Add your API key and switch it on in <button className="font-medium text-primary underline" onClick={() => go({ name: "settings" })}>Settings</button> — nothing is sent until you do.</p>
    </Card>
  );
}

function Highlight({ text, query }: { text: string; query: string }) {
  const toks = useMemo(() => Array.from(new Set([query.trim(), ...(query.toLowerCase().match(/[a-z0-9]+/g) ?? [])])).filter((t) => t.length > 1).sort((a, b) => b.length - a.length), [query]);
  if (!toks.length) return <>{text}</>;
  const re = new RegExp(`(${toks.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "ig");
  return <>{text.split(re).map((p, i) => (i % 2 ? <mark key={i} className="rounded bg-amber-300/50 px-0.5 text-inherit">{p}</mark> : <span key={i}>{p}</span>))}</>;
}

function SearchTab({ notes, onIndexed, ai }: { notes: NoteMeta[]; onIndexed: (n: number) => void; ai: boolean }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [indexing, setIndexing] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    const t = setTimeout(() => { void searchNotes(q).then(setHits); }, 120);
    return () => clearTimeout(t);
  }, [q]);

  async function indexAll() {
    abort.current = new AbortController();
    setMsg(null);
    let read = 0;
    try {
      for (let i = 0; i < notes.length; i++) {
        if (abort.current.signal.aborted) break;
        const n = notes[i];
        setIndexing(`${n.title} (${i + 1}/${notes.length})`);
        const r = await indexNote(n.id, (p) => setIndexing(`${n.title} · page ${p.page + 1}/${p.total} (note ${i + 1}/${notes.length})`), { signal: abort.current.signal });
        read += r.read;
      }
      setMsg(`Done — read ${read} page${read === 1 ? "" : "s"}.`);
    } catch (e) {
      setMsg(e instanceof AiError ? e.message : "Indexing stopped: " + (e as Error).message);
    } finally {
      setIndexing(null);
      onIndexed((await getPageTexts()).length);
      void searchNotes(q).then(setHits);
    }
  }

  return (
    <div>
      <div className="relative">
        <Search size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-foreground-muted" />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your notes — try “sin(x^2)”, “enthalpy”, “mitosis”…"
          className="w-full rounded-2xl border border-border bg-surface py-3.5 pl-11 pr-4 text-base outline-none focus:border-primary" />
      </div>

      <div className="mt-4 space-y-2.5">
        {q.trim() && hits.length === 0 && <p className="py-8 text-center text-sm text-foreground-muted">No matches. Handwriting is only searchable once it&apos;s been read — use “Read my handwriting” below.</p>}
        {hits.map((h, i) => (
          <button key={`${h.noteId}-${h.page}-${h.source}-${i}`} onClick={() => go({ name: "note", id: h.noteId, page: h.page, hl: q.trim() || undefined })}
            className="block w-full rounded-2xl border border-border bg-surface px-4 py-3 text-left transition-colors hover:border-primary/60">
            <div className="flex items-center gap-2 text-xs text-foreground-muted">
              <FileText size={12} /> <span className="font-medium text-foreground">{h.noteTitle}</span>
              {h.source !== "title" && <span>· page {h.page + 1}</span>}
              <span className="ml-auto rounded-full bg-surface-secondary px-2 py-0.5">{h.source === "ink" ? "handwriting" : h.source === "pdf" ? "pdf text" : "title"}</span>
            </div>
            {h.source !== "title" && <p className="mt-1.5 text-sm leading-relaxed"><Highlight text={h.snippet} query={q} /></p>}
          </button>
        ))}
      </div>

      <Card className="mt-8 flex flex-wrap items-center justify-between gap-3 px-4 py-3.5">
        <div className="text-sm">
          <p className="flex items-center gap-1.5 font-medium"><ScanText size={15} className="text-primary" /> Read my handwriting</p>
          <p className="text-xs text-foreground-muted">Makes handwritten pages searchable. Only pages that changed since last time are read.</p>
          {indexing && <p className="mt-1 flex items-center gap-1.5 text-xs"><Loader2 size={12} className="animate-spin" /> {indexing}</p>}
          {msg && <p className="mt-1 text-xs">{msg}</p>}
        </div>
        {indexing ? <Button onClick={() => abort.current?.abort()}>Stop</Button> : <Button variant="primary" disabled={!ai || !notes.length} onClick={indexAll}><Sparkles size={14} /> {ai ? "Read all notes" : "AI is off"}</Button>}
      </Card>
    </div>
  );
}

function Sources({ items }: { items: Excerpt[] }) {
  const notes = items;
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {notes.map((e) => (
        <span key={e.n} className="rounded-full border border-border bg-surface px-2.5 py-1 text-xs text-foreground-muted">[{e.n}] {e.noteTitle} · p{e.page + 1}</span>
      ))}
    </div>
  );
}

function AskTab({ ai }: { ai: boolean }) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<{ text: string; src: Excerpt[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function ask() {
    if (!q.trim()) return;
    setBusy(true); setErr(null); setAnswer(null);
    try {
      const src = await excerptsFor(q, 6);
      if (!src.length) { setErr("I couldn't find anything relevant in your indexed notes. Try “Read my handwriting” on the Search tab first."); return; }
      setAnswer({ text: await askNotes(q, src), src });
    } catch (e) { setErr(e instanceof AiError ? e.message : "Something went wrong: " + (e as Error).message); } finally { setBusy(false); }
  }

  if (!ai) return <NeedAi />;
  return (
    <div>
      <textarea value={q} onChange={(e) => setQ(e.target.value)} rows={3} placeholder="Ask across all your notes — “Where did we do Hess's law?”, “Summarise the Krebs cycle”…"
        className="w-full resize-none rounded-2xl border border-border bg-surface px-4 py-3 text-base outline-none focus:border-primary" />
      <div className="mt-3"><Button variant="primary" onClick={ask} disabled={busy || !q.trim()}>{busy ? <Loader2 size={14} className="animate-spin" /> : <MessageSquareText size={14} />} Ask</Button></div>
      {err && <p className="mt-4 text-sm text-negative">{err}</p>}
      {answer && (
        <Card className="mt-5 px-5 py-4">
          <div className="text-[15px] leading-relaxed"><RichText text={answer.text} /></div>
          <Sources items={answer.src} />
        </Card>
      )}
    </div>
  );
}

function PracticeTab({ ai, notes, notebooks }: { ai: boolean; notes: NoteMeta[]; notebooks: NotebookRec[] }) {
  const [scope, setScope] = useState("all");
  const [count, setCount] = useState(8);
  const [difficulty, setDifficulty] = useState<"same" | "harder">("same");
  const [busy, setBusy] = useState(false);
  const [qs, setQs] = useState<PracticeQuestion[] | null>(null);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [err, setErr] = useState<string | null>(null);

  async function generate() {
    setBusy(true); setErr(null); setQs(null); setOpen(new Set());
    try {
      const ids = scope === "all" ? null : scope.startsWith("nb:") ? notes.filter((n) => n.notebookId === scope.slice(3)).map((n) => n.id) : [scope.slice(5)];
      const ex = await corpusExcerpts(ids);
      if (!ex.length) { setErr("There's no readable text in that scope yet. Use “Read my handwriting” on the Search tab, or import typed PDFs."); return; }
      setQs(await practiceQuestions(ex, count, difficulty));
    } catch (e) { setErr(e instanceof AiError ? e.message : "Something went wrong: " + (e as Error).message); } finally { setBusy(false); }
  }

  if (!ai) return <NeedAi />;
  return (
    <div>
      <Card className="flex flex-wrap items-end gap-4 px-4 py-4">
        <label className="text-xs text-foreground-muted">Questions from
          <select value={scope} onChange={(e) => setScope(e.target.value)} className="mt-1 block max-w-[16rem] rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground">
            <option value="all">All my notes</option>
            {notebooks.length > 0 && <optgroup label="Notebooks">{notebooks.map((n) => <option key={n.id} value={`nb:${n.id}`}>{n.name}</option>)}</optgroup>}
            <optgroup label="Notes">{notes.map((n) => <option key={n.id} value={`note:${n.id}`}>{n.title}</option>)}</optgroup>
          </select>
        </label>
        <label className="text-xs text-foreground-muted">How many
          <select value={count} onChange={(e) => setCount(Number(e.target.value))} className="mt-1 block rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground">{[5, 8, 12, 20].map((n) => <option key={n}>{n}</option>)}</select>
        </label>
        <label className="text-xs text-foreground-muted">Difficulty
          <select value={difficulty} onChange={(e) => setDifficulty(e.target.value as "same" | "harder")} className="mt-1 block rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground">
            <option value="same">Like my examples</option><option value="harder">Harder than my examples</option>
          </select>
        </label>
        <Button variant="primary" onClick={generate} disabled={busy}>{busy ? <Loader2 size={14} className="animate-spin" /> : <BookOpenCheck size={14} />} Generate exam</Button>
      </Card>
      {err && <p className="mt-4 text-sm text-negative">{err}</p>}
      {qs && (
        <ol className="mt-5 space-y-3">
          {qs.map((q, i) => (
            <li key={i}>
              <Card className="px-5 py-4">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-foreground-muted">Question {i + 1}{q.topic ? ` · ${q.topic}` : ""}</p>
                <div className="mt-1.5 text-[15px] leading-relaxed"><RichText text={q.q} /></div>
                {open.has(i) ? (
                  <div className="mt-3 rounded-xl bg-surface-secondary px-4 py-3 text-sm">
                    <p className="font-medium">Answer</p>
                    <div className="mt-1 leading-relaxed"><RichText text={q.answer} /></div>
                    {q.steps?.length ? <ol className="mt-2 list-decimal space-y-1 pl-5 text-foreground-muted">{q.steps.map((s, j) => <li key={j}><RichText text={s} /></li>)}</ol> : null}
                  </div>
                ) : <button onClick={() => setOpen(new Set(open).add(i))} className="mt-3 text-sm font-medium text-primary">Show answer</button>}
              </Card>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
