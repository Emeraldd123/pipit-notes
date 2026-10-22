import { useEffect, useMemo, useRef, useState } from "react";
import { BookmarkPlus, ChevronLeft, ChevronRight, Clock, Flag, Loader2, Minus, PenLine, Pause, Play, Plus, Type, X } from "lucide-react";
import { RichText } from "@/components/blocks";
import { FigureView } from "@/components/figure";
import { InkPad } from "@/components/ink-pad";
import { Button } from "@/components/ui";
import { allParts, buildResult, type Exam, type ExamResult, type Part, type PartAnswer, type PartMark, type Question } from "@/lib/exam-core";

const fmtClock = (s: number) => `${Math.floor(Math.abs(s) / 60)}:${String(Math.abs(s) % 60).padStart(2, "0")}`;

// ---- taking the exam ----------------------------------------------------------------------------------------------------------
export function ExamRunner({ exam, onSubmit, onExit }: {
  exam: Exam; onSubmit: (answers: Record<string, PartAnswer>, seconds: number) => void; onExit: () => void;
}) {
  const flat = useMemo(() => exam.sections.flatMap((s, si) => s.questions.map((q, qi) => ({ q, section: s, first: qi === 0, si }))), [exam]);
  const [qi, setQi] = useState(0);
  const [answers, setAnswers] = useState<Record<string, PartAnswer>>({});
  const [flags, setFlags] = useState<Set<string>>(new Set());
  const [paused, setPaused] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [mode, setMode] = useState<Record<string, "type" | "ink">>({});
  const mainRef = useRef<HTMLDivElement>(null);
  const limit = exam.durationMin * 60;
  const remaining = limit - elapsed;

  useEffect(() => {
    if (paused) return;
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, [paused]);
  useEffect(() => { mainRef.current?.scrollTo({ top: 0 }); }, [qi]);

  const cur = flat[qi];
  const set = (pid: string, patch: Partial<PartAnswer>) => setAnswers((a) => ({ ...a, [pid]: { ...a[pid], ...patch } }));
  const answered = (q: Question) => q.parts.some((p) => { const a = answers[p.id]; return a && (a.choice !== undefined || a.text?.trim() || a.ink); });
  const unanswered = flat.filter((f) => !answered(f.q)).length;

  const submit = () => {
    if (unanswered > 0 && !confirm(`${unanswered} question${unanswered === 1 ? " is" : "s are"} unanswered. Submit anyway?`)) return;
    onSubmit(answers, elapsed);
  };

  return (
    <div className="flex h-full min-h-screen flex-col bg-background">
      <header className="flex shrink-0 items-center gap-3 border-b border-border bg-surface px-4 py-2.5">
        <button onClick={() => { if (confirm("Leave the exam? Your answers will be lost.")) onExit(); }} className="rounded-lg p-1.5 text-foreground-muted hover:bg-surface-secondary" title="Leave"><X size={20} /></button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{exam.title}</p>
          <p className="text-xs text-foreground-muted">{exam.totalMarks} marks · {exam.durationMin} min</p>
        </div>
        <button onClick={() => setPaused((p) => !p)} className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-semibold tabular-nums ${remaining < 300 ? "bg-negative/10 text-negative" : "bg-surface-secondary"}`} title={paused ? "Resume" : "Pause"}>
          <Clock size={14} /> {remaining < 0 ? "+" : ""}{fmtClock(remaining)} {paused ? <Play size={12} /> : <Pause size={12} />}
        </button>
        <Button variant="primary" onClick={submit}>Submit</Button>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* question navigator */}
        <nav className="hidden w-44 shrink-0 overflow-auto border-r border-border bg-surface/60 p-3 md:block">
          {exam.sections.map((s, si) => (
            <div key={si} className="mb-4">
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-foreground-muted">{s.title}</p>
              <div className="grid grid-cols-4 gap-1.5">
                {flat.map((f, k) => f.si === si && (
                  <button key={f.q.id} onClick={() => setQi(k)} className={`relative h-9 rounded-lg border text-sm font-medium ${k === qi ? "border-primary bg-primary text-white" : answered(f.q) ? "border-positive/50 bg-positive/10" : "border-border hover:bg-surface-secondary"}`}>
                    {k + 1}{flags.has(f.q.id) && <Flag size={9} className="absolute right-0.5 top-0.5 text-amber-500" fill="currentColor" />}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <main ref={mainRef} className="min-w-0 flex-1 overflow-auto">
          {paused ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-10 text-center">
              <Pause size={40} className="text-foreground-muted" />
              <p className="text-lg font-semibold">Paused</p>
              <Button variant="primary" onClick={() => setPaused(false)}><Play size={14} /> Resume</Button>
            </div>
          ) : (
            <div className="mx-auto w-full max-w-3xl px-4 py-6 md:px-8">
              {cur.first && (
                <div className="mb-5 rounded-xl border border-border bg-surface px-4 py-3">
                  <h2 className="text-base font-bold">{cur.section.title}</h2>
                  {(cur.section.instructions || (qi === 0 && exam.instructions)) && <p className="mt-1 text-sm text-foreground-muted"><RichText text={cur.section.instructions || exam.instructions || ""} /></p>}
                </div>
              )}
              <QuestionView n={qi + 1} q={cur.q} answers={answers} onAnswer={set} mode={mode} onMode={(pid, m) => setMode((x) => ({ ...x, [pid]: m }))} />
              <div className="mt-6 flex items-center justify-between">
                <Button onClick={() => setQi(Math.max(0, qi - 1))} disabled={qi === 0}><ChevronLeft size={15} /> Previous</Button>
                <button onClick={() => setFlags((f) => { const n = new Set(f); if (n.has(cur.q.id)) n.delete(cur.q.id); else n.add(cur.q.id); return n; })}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm ${flags.has(cur.q.id) ? "bg-amber-500/15 text-amber-600" : "text-foreground-muted hover:bg-surface-secondary"}`}><Flag size={14} /> {flags.has(cur.q.id) ? "Flagged" : "Flag"}</button>
                {qi < flat.length - 1 ? <Button variant="primary" onClick={() => setQi(qi + 1)}>Next <ChevronRight size={15} /></Button> : <Button variant="primary" onClick={submit}>Finish</Button>}
              </div>
              <div className="mt-6 flex flex-wrap gap-1.5 md:hidden">
                {flat.map((f, k) => <button key={f.q.id} onClick={() => setQi(k)} className={`h-8 w-8 rounded-lg border text-xs ${k === qi ? "border-primary bg-primary text-white" : answered(f.q) ? "border-positive/50 bg-positive/10" : "border-border"}`}>{k + 1}</button>)}
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function QuestionView({ n, q, answers, onAnswer, mode, onMode }: {
  n: number; q: Question; answers: Record<string, PartAnswer>; onAnswer: (pid: string, patch: Partial<PartAnswer>) => void;
  mode: Record<string, "type" | "ink">; onMode: (pid: string, m: "type" | "ink") => void;
}) {
  return (
    <article className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="text-lg font-bold">Question {n}</h3>
        <span className="text-sm font-semibold text-foreground-muted">[{q.marks} mark{q.marks === 1 ? "" : "s"}]</span>
      </div>
      {q.topic && <p className="mb-2 text-xs uppercase tracking-wider text-foreground-muted">{q.topic}</p>}
      <div className="text-[17px] leading-relaxed"><RichText text={q.stem} /></div>
      {q.figure && <FigureView figure={q.figure} className="mt-4" />}
      <div className="mt-5 space-y-6">
        {q.parts.map((p) => <PartInput key={p.id} p={p} a={answers[p.id]} onAnswer={(patch) => onAnswer(p.id, patch)} mode={mode[p.id] ?? "type"} onMode={(m) => onMode(p.id, m)} />)}
      </div>
    </article>
  );
}

export function PartInput({ p, a, onAnswer, mode, onMode }: { p: Part; a: PartAnswer | undefined; onAnswer: (patch: Partial<PartAnswer>) => void; mode: "type" | "ink"; onMode: (m: "type" | "ink") => void }) {
  return (
    <div>
      <div className="flex items-start gap-3">
        {p.label && <span className="mt-0.5 w-6 shrink-0 text-base font-bold">({p.label})</span>}
        <div className="min-w-0 flex-1">
          {p.prompt && <div className="text-base leading-relaxed"><RichText text={p.prompt} /></div>}
          {p.figure && <FigureView figure={p.figure} className="my-3" />}
          <div className="mt-2.5">
            {p.type === "mcq" && (
              <div className="space-y-2">
                {p.options!.map((o, i) => (
                  <button key={i} onClick={() => onAnswer({ choice: i })} className={`flex w-full items-start gap-3 rounded-xl border-2 px-3.5 py-2.5 text-left ${a?.choice === i ? "border-primary bg-primary/10" : "border-border hover:bg-surface-secondary"}`}>
                    <span className="w-5 shrink-0 font-semibold text-foreground-muted">{String.fromCharCode(65 + i)}</span><span><RichText text={o} /></span>
                  </button>
                ))}
              </div>
            )}
            {p.type === "tf" && (
              <div className="flex gap-2">
                {["True", "False"].map((l, i) => <button key={l} onClick={() => onAnswer({ choice: i })} className={`rounded-xl border-2 px-6 py-2 font-semibold ${a?.choice === i ? "border-primary bg-primary/10" : "border-border hover:bg-surface-secondary"}`}>{l}</button>)}
              </div>
            )}
            {p.type === "numeric" && (
              <div className="flex items-center gap-2">
                <input value={a?.text ?? ""} onChange={(e) => onAnswer({ text: e.target.value })} inputMode="decimal" placeholder="Answer" autoCapitalize="off" autoCorrect="off"
                  className="w-48 rounded-xl border-2 border-border bg-background px-3 py-2 text-base outline-none focus:border-primary" />
                {p.numeric?.unit && <span className="text-sm text-foreground-muted">{p.numeric.unit}</span>}
              </div>
            )}
            {(p.type === "short" || p.type === "working") && (
              <div className="space-y-2">
                <div className="flex gap-1.5 text-xs">
                  <button onClick={() => onMode("type")} className={`flex items-center gap-1 rounded-lg px-2.5 py-1 ${mode === "type" ? "bg-primary text-white" : "bg-surface-secondary text-foreground-muted"}`}><Type size={12} /> Type</button>
                  <button onClick={() => onMode("ink")} className={`flex items-center gap-1 rounded-lg px-2.5 py-1 ${mode === "ink" ? "bg-primary text-white" : "bg-surface-secondary text-foreground-muted"}`}><PenLine size={12} /> Handwrite</button>
                </div>
                {mode === "type"
                  ? <textarea value={a?.text ?? ""} onChange={(e) => onAnswer({ text: e.target.value })} rows={p.type === "working" ? 6 : 3} placeholder={p.type === "working" ? "Show your working and give your answer…" : "Write your answer…"}
                      className="w-full resize-y rounded-xl border-2 border-border bg-background px-3 py-2.5 text-base outline-none focus:border-primary" />
                  : <InkPad value={a?.ink} onChange={(png) => onAnswer({ ink: png })} height={p.type === "working" ? 320 : 180} />}
              </div>
            )}
          </div>
        </div>
        <span className="shrink-0 pt-0.5 text-xs font-semibold text-foreground-muted">[{p.marks}]</span>
      </div>
    </div>
  );
}

// ---- results -----------------------------------------------------------------------------------------------------------------------
export function MarkingScreen({ message }: { message: string }) {
  return <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background text-center"><Loader2 size={32} className="animate-spin text-primary" /><p className="text-lg font-semibold">Marking your paper…</p><p className="text-sm text-foreground-muted">{message}</p></div>;
}

export function ExamResults({ exam, answers, marks, seconds, onMarks, onRetake, onClose, onCards }: {
  exam: Exam; answers: Record<string, PartAnswer>; marks: PartMark[]; seconds: number;
  onMarks: (m: PartMark[]) => void; onRetake: () => void; onClose: () => void; onCards: (items: { q: Question; p: Part }[]) => void;
}) {
  const result: ExamResult = useMemo(() => buildResult(exam, marks), [exam, marks]);
  const [onlyLost, setOnlyLost] = useState(false);
  const byId = new Map(result.marks.map((m) => [m.partId, m]));
  const adjust = (pid: string, d: number) => onMarks(result.marks.map((m) => (m.partId === pid ? { ...m, marks: Math.max(0, Math.min(m.max, m.marks + d)), feedback: m.feedback } : m)));
  const lost = allParts(exam).filter(({ p }) => (byId.get(p.id)?.marks ?? 0) < p.marks);
  const ring = 2 * Math.PI * 44;
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-surface px-4 py-2.5">
        <button onClick={onClose} className="flex items-center gap-1 text-sm text-foreground-muted hover:text-foreground"><ChevronLeft size={16} /> Back</button>
        <p className="text-sm font-semibold">{exam.title} — results</p>
        <Button onClick={onRetake}>Retake</Button>
      </header>
      <div className="mx-auto max-w-3xl px-4 py-6 md:px-8">
        <div className="flex flex-wrap items-center gap-6 rounded-2xl border border-border bg-surface p-5">
          <div className="relative h-28 w-28 shrink-0">
            <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90"><circle cx="50" cy="50" r="44" fill="none" strokeWidth="9" className="stroke-surface-secondary" /><circle cx="50" cy="50" r="44" fill="none" strokeWidth="9" strokeLinecap="round" className={result.percent >= 60 ? "stroke-positive" : result.percent >= 40 ? "stroke-amber-500" : "stroke-negative"} strokeDasharray={`${(result.percent / 100) * ring} ${ring}`} /></svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center"><span className="text-2xl font-bold">{result.percent}%</span><span className="text-xs text-foreground-muted">{result.band}</span></div>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-2xl font-bold">{result.got} / {result.max} marks</p>
            <p className="text-sm text-foreground-muted">Took {Math.round(seconds / 60)} min of {exam.durationMin}</p>
            <div className="mt-3 space-y-1.5">
              {result.byTopic.map((t) => (
                <div key={t.topic} className="flex items-center gap-2 text-xs">
                  <span className="w-28 shrink-0 truncate text-foreground-muted">{t.topic}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-secondary"><div className={`h-full rounded-full ${t.got / t.max >= 0.7 ? "bg-positive" : t.got / t.max >= 0.4 ? "bg-amber-500" : "bg-negative"}`} style={{ width: `${(t.got / t.max) * 100}%` }} /></div>
                  <span className="w-10 text-right tabular-nums">{t.got}/{t.max}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={onlyLost} onChange={(e) => setOnlyLost(e.target.checked)} /> Only show where I lost marks</label>
          {lost.length > 0 && <Button onClick={() => onCards(lost)}><BookmarkPlus size={14} /> Make flashcards from {lost.length} missed part{lost.length === 1 ? "" : "s"}</Button>}
        </div>

        <div className="mt-4 space-y-5">
          {exam.sections.flatMap((sec) => sec.questions).map((q, n) => {
            const parts = onlyLost ? q.parts.filter((p) => (byId.get(p.id)?.marks ?? 0) < p.marks) : q.parts;
            if (!parts.length) return null;
            return (
              <article key={q.id} className="rounded-2xl border border-border bg-surface p-5">
                <div className="mb-2 flex items-baseline justify-between"><h3 className="font-bold">Question {n + 1}{q.topic ? <span className="ml-2 text-xs font-normal uppercase tracking-wider text-foreground-muted">{q.topic}</span> : null}</h3></div>
                <div className="leading-relaxed"><RichText text={q.stem} /></div>
                {q.figure && <FigureView figure={q.figure} className="mt-3" />}
                <div className="mt-4 space-y-4">
                  {parts.map((p) => {
                    const m = byId.get(p.id)!, a = answers[p.id];
                    const full = m.marks >= p.marks;
                    return (
                      <div key={p.id} className={`rounded-xl border px-4 py-3 ${full ? "border-positive/40 bg-positive/5" : m.marks > 0 ? "border-amber-500/40 bg-amber-500/5" : "border-negative/40 bg-negative/5"}`}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 text-sm">{p.label && <b className="mr-1.5">({p.label})</b>}{p.prompt ? <RichText text={p.prompt} /> : <span className="text-foreground-muted">Answer</span>}</div>
                          <div className="flex shrink-0 items-center gap-1 text-sm font-bold">
                            {!m.auto && <button onClick={() => adjust(p.id, -1)} className="rounded-md p-0.5 text-foreground-muted hover:bg-surface-secondary" title="Lower this mark"><Minus size={14} /></button>}
                            <span className="tabular-nums">{m.marks}/{p.marks}</span>
                            {!m.auto && <button onClick={() => adjust(p.id, 1)} className="rounded-md p-0.5 text-foreground-muted hover:bg-surface-secondary" title="Raise this mark"><Plus size={14} /></button>}
                          </div>
                        </div>
                        {p.figure && <FigureView figure={p.figure} className="my-2" />}
                        <div className="mt-2 text-sm">
                          <p className="text-foreground-muted">Your answer: {a?.choice !== undefined ? <b className="text-foreground">{p.type === "tf" ? (a.choice === 0 ? "True" : "False") : `${String.fromCharCode(65 + a.choice)}. ${p.options?.[a.choice] ?? ""}`}</b> : a?.text?.trim() ? <span className="text-foreground"><RichText text={a.text} /></span> : a?.ink ? "(handwritten)" : <i>no answer</i>}</p>
                          {a?.ink && <img src={a.ink} alt="Your handwritten answer" className="mt-1.5 max-h-48 rounded-lg border border-border bg-white" />}
                        </div>
                        <p className="mt-2 text-sm"><RichText text={m.feedback} /></p>
                        {!full && (
                          <div className="mt-2 rounded-lg bg-surface-secondary px-3 py-2 text-sm">
                            <p className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">Model answer</p>
                            <RichText text={p.answer || "—"} />
                            {(m.missed?.length || p.scheme.length > 0) && <ul className="mt-1 list-disc pl-5 text-foreground-muted">{(m.missed?.length ? m.missed : p.scheme).map((s, k) => <li key={k}><RichText text={s} /></li>)}</ul>}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </div>
  );
}
