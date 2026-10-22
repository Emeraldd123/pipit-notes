import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Flame, Heart, Loader2, Trophy, X, Zap } from "lucide-react";
import { RichText } from "@/components/blocks";
import { playSfx } from "@/lib/sound";
import { previewIntervals, GRADE_LABELS, type Grade } from "@/lib/srs";
import {
  addXp, checkTyped, currentStreak, exerciseCards, lessonXp, shuffle, xpToday,
  type Card, type Exercise, type LessonStats, type Outcome, type Progress,
} from "@/lib/study-core";
import { Button } from "@/components/ui";

// ---- how each exercise reports back to the runner -----------------------------------------------------------------------
export type Report = { ready: boolean; correct?: boolean; shown?: string; auto?: boolean; grade?: Grade; mistakes?: string[] };
type ViewProps<E extends Exercise> = { ex: E; cards: Map<string, Card>; locked: boolean; report: (r: Report) => void };

const optBase = "w-full rounded-2xl border-2 px-4 py-3.5 text-left text-base transition-colors";
const optState = (selected: boolean, locked: boolean, right?: boolean, chosenWrong?: boolean) =>
  locked
    ? right ? "border-positive bg-positive/10" : chosenWrong ? "border-negative bg-negative/10" : "border-border opacity-60"
    : selected ? "border-primary bg-primary/10" : "border-border hover:bg-surface-secondary";

function Prompt({ children, label }: { children: string; label?: string }) {
  return (
    <div className="mb-5">
      {label && <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-foreground-muted">{label}</p>}
      <div className="text-xl font-semibold leading-snug"><RichText text={children} /></div>
    </div>
  );
}

function McqView({ ex, locked, report }: ViewProps<Extract<Exercise, { kind: "mcq" }>>) {
  const [sel, setSel] = useState<number | null>(null);
  useEffect(() => { setSel(null); }, [ex]);
  const pick = (i: number) => { if (locked) return; setSel(i); report({ ready: true, correct: i === ex.answer, shown: ex.options[ex.answer] }); };
  useEffect(() => {
    const h = (e: KeyboardEvent) => { const n = Number(e.key); if (n >= 1 && n <= ex.options.length && !(e.target instanceof HTMLInputElement)) pick(n - 1); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ex, locked]);
  return (
    <div>
      <Prompt label="Choose the answer">{ex.prompt}</Prompt>
      <div className="space-y-2.5">
        {ex.options.map((o, i) => (
          <button key={i} onClick={() => pick(i)} className={`${optBase} ${optState(sel === i, locked, i === ex.answer, sel === i && i !== ex.answer)}`}>
            <span className="mr-3 inline-flex h-6 w-6 items-center justify-center rounded-md border border-border text-xs text-foreground-muted">{i + 1}</span><RichText text={o} />
          </button>
        ))}
      </div>
    </div>
  );
}

function TypedView({ ex, locked, report }: ViewProps<Extract<Exercise, { kind: "typed" | "cloze" }>>) {
  const [v, setV] = useState("");
  useEffect(() => { setV(""); }, [ex]);
  const change = (t: string) => { setV(t); const ok = checkTyped(t, ex.answer, ex.alts); report({ ready: t.trim().length > 0, correct: ok.ok, shown: ex.answer }); };
  return (
    <div>
      <Prompt label={ex.kind === "cloze" ? "Fill in the blank" : "Type the answer"}>{ex.prompt}</Prompt>
      <input autoFocus value={v} disabled={locked} onChange={(e) => change(e.target.value)} autoCapitalize="off" autoCorrect="off" spellCheck={false}
        placeholder="Type your answer" className="w-full rounded-2xl border-2 border-border bg-surface px-4 py-3.5 text-lg outline-none focus:border-primary disabled:opacity-70" />
      {ex.hint && !locked && <p className="mt-3 text-sm text-foreground-muted">Hint: <RichText text={ex.hint} /></p>}
    </div>
  );
}

function TfView({ ex, locked, report }: ViewProps<Extract<Exercise, { kind: "tf" }>>) {
  const [sel, setSel] = useState<boolean | null>(null);
  useEffect(() => { setSel(null); }, [ex]);
  const pick = (v: boolean) => { if (locked) return; setSel(v); report({ ready: true, correct: v === ex.truth, shown: ex.truth ? "True" : `False — it's ${ex.correct}` }); };
  return (
    <div>
      <Prompt label="True or false?">{ex.prompt}</Prompt>
      <div className="mb-5 rounded-2xl border border-border bg-surface-secondary px-4 py-3 text-lg"><RichText text={ex.statement} /></div>
      <div className="grid grid-cols-2 gap-3">
        {[true, false].map((v) => (
          <button key={String(v)} onClick={() => pick(v)} className={`${optBase} text-center font-semibold ${optState(sel === v, locked, v === ex.truth, sel === v && v !== ex.truth)}`}>{v ? "True" : "False"}</button>
        ))}
      </div>
    </div>
  );
}

function OrderView({ ex, locked, report }: ViewProps<Extract<Exercise, { kind: "order" }>>) {
  const bank = useMemo(() => shuffle(ex.steps.map((s, i) => ({ s, i }))), [ex]);
  const [placed, setPlaced] = useState<number[]>([]);
  useEffect(() => { setPlaced([]); }, [ex]);
  const update = (next: number[]) => {
    setPlaced(next);
    const done = next.length === ex.steps.length;
    report({ ready: done, correct: done && next.every((n, k) => n === k), shown: ex.steps.map((s, i) => `${i + 1}. ${s}`).join("  ") });
  };
  return (
    <div>
      <Prompt label="Put the steps in order">{ex.prompt}</Prompt>
      <div className="mb-4 min-h-[3.5rem] space-y-2 rounded-2xl border-2 border-dashed border-border p-2.5">
        {placed.length === 0 && <p className="px-1 py-2 text-sm text-foreground-muted">Tap the steps below in the right order</p>}
        {placed.map((n, k) => (
          <button key={n} disabled={locked} onClick={() => update(placed.filter((x) => x !== n))} className={`${optBase} py-2.5 ${locked ? (n === k ? "border-positive bg-positive/10" : "border-negative bg-negative/10") : "border-primary bg-primary/10"}`}>
            <span className="mr-2 text-foreground-muted">{k + 1}.</span><RichText text={ex.steps[n]} />
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {bank.filter((b) => !placed.includes(b.i)).map((b) => (
          <button key={b.i} disabled={locked} onClick={() => update([...placed, b.i])} className="rounded-xl border-2 border-border bg-surface px-3.5 py-2 text-sm hover:bg-surface-secondary"><RichText text={b.s} /></button>
        ))}
      </div>
    </div>
  );
}

function MatchView({ ex, cards, report }: ViewProps<Extract<Exercise, { kind: "match" }>>) {
  const rights = useMemo(() => shuffle(ex.pairs.map((p, i) => ({ r: p.right, i }))), [ex]);
  const [left, setLeft] = useState<number | null>(null);
  const [done, setDone] = useState<Set<number>>(new Set());
  const [bad, setBad] = useState<{ l: number; r: number } | null>(null);
  const mistakes = useRef<Set<string>>(new Set());
  useEffect(() => { setLeft(null); setDone(new Set()); mistakes.current = new Set(); }, [ex]);
  const tapRight = (ri: number) => {
    if (left === null || done.has(ri)) return;
    if (ri === left) {
      const next = new Set(done).add(ri);
      setDone(next); setLeft(null);
      if (next.size === ex.pairs.length) report({ ready: true, correct: mistakes.current.size === 0, auto: true, mistakes: [...mistakes.current], shown: "" });
    } else {
      mistakes.current.add(ex.cardIds[left]);
      setBad({ l: left, r: ri });
      setTimeout(() => setBad(null), 450);
      setLeft(null);
      void cards;
    }
  };
  return (
    <div>
      <Prompt label="Match the pairs">Tap a term, then its match</Prompt>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2.5">
          {ex.pairs.map((p, i) => (
            <button key={i} disabled={done.has(i)} onClick={() => setLeft(i)}
              className={`${optBase} py-3 text-sm ${done.has(i) ? "border-positive/40 bg-positive/10 opacity-60" : left === i ? "border-primary bg-primary/10" : bad?.l === i ? "border-negative bg-negative/10" : "border-border hover:bg-surface-secondary"}`}><RichText text={p.left} /></button>
          ))}
        </div>
        <div className="space-y-2.5">
          {rights.map((r) => (
            <button key={r.i} disabled={done.has(r.i)} onClick={() => tapRight(r.i)}
              className={`${optBase} py-3 text-sm ${done.has(r.i) ? "border-positive/40 bg-positive/10 opacity-60" : bad?.r === r.i ? "border-negative bg-negative/10" : "border-border hover:bg-surface-secondary"}`}><RichText text={r.r} /></button>
          ))}
        </div>
      </div>
    </div>
  );
}

function FlipView({ ex, cards, report }: ViewProps<Extract<Exercise, { kind: "flip" }>>) {
  const [shown, setShown] = useState(false);
  useEffect(() => { setShown(false); }, [ex]);
  const card = cards.get(ex.cardId);
  const labels = useMemo(() => (card ? previewIntervals(card) : ["", "", "", ""]), [card]);
  return (
    <div>
      <Prompt label="Do you remember?">{ex.front}</Prompt>
      {!shown ? (
        <Button variant="secondary" className="w-full !py-3.5 !text-base" onClick={() => setShown(true)}>Show answer</Button>
      ) : (
        <>
          <div className="mb-5 rounded-2xl border-2 border-primary/40 bg-primary/5 px-4 py-4 text-lg"><RichText text={ex.back} /></div>
          <p className="mb-2 text-center text-xs text-foreground-muted">How well did you know it?</p>
          <div className="grid grid-cols-4 gap-2">
            {GRADE_LABELS.map((l, g) => (
              <button key={l} onClick={() => report({ ready: true, correct: g >= 2, auto: true, grade: g as Grade, shown: ex.back })}
                className={`rounded-xl border-2 px-2 py-3 text-sm font-semibold ${g === 0 ? "border-negative/50 text-negative" : g === 1 ? "border-amber-500/50 text-amber-600" : g === 2 ? "border-primary/50 text-primary" : "border-positive/50 text-positive"} hover:bg-surface-secondary`}>
                {l}<span className="mt-0.5 block text-[11px] font-normal text-foreground-muted">{labels[g]}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function ExerciseView(p: ViewProps<Exercise>) {
  const { ex } = p;
  switch (ex.kind) {
    case "mcq": return <McqView {...p} ex={ex} />;
    case "typed": case "cloze": return <TypedView {...p} ex={ex} />;
    case "tf": return <TfView {...p} ex={ex} />;
    case "order": return <OrderView {...p} ex={ex} />;
    case "match": return <MatchView {...p} ex={ex} />;
    case "flip": return <FlipView {...p} ex={ex} />;
  }
}

// ---- the runner -----------------------------------------------------------------------------------------------------------------
type QItem = { ex: Exercise; retry: boolean };
export type LessonResult = { outcomes: Outcome[]; stats: LessonStats; xp: number; seconds: number };

const CONFETTI = ["🎉", "✨", "⭐", "🎊", "💫"];

export function LessonRunner({ title, cards, exercises, progress, quiz, onFinish, onExit }: {
  title: string; cards: Card[]; exercises: Exercise[]; progress: Progress; quiz?: boolean;
  onFinish: (r: LessonResult) => void; onExit: () => void;
}) {
  const cardMap = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards]);
  const startProgress = useRef(progress).current; // the summary shows before/after, so it must not see the already-saved update
  const [queue, setQueue] = useState<QItem[]>(() => exercises.map((ex) => ({ ex, retry: false })));
  const [i, setI] = useState(0);
  const [rep, setRep] = useState<Report>({ ready: false });
  const [checked, setChecked] = useState(false);
  const [heartsLeft, setHeartsLeft] = useState(5);
  const [heartsOn, setHeartsOn] = useState(!quiz && progress.hearts);
  const [combo, setCombo] = useState(0);
  const [maxCombo, setMaxCombo] = useState(0);
  const [firstTry, setFirstTry] = useState(0);
  const [finished, setFinished] = useState<LessonResult | null>(null);
  const [outOfHearts, setOutOfHearts] = useState(false);
  const outcomes = useRef<Outcome[]>([]);
  const st = useRef({ firstTry: 0, maxCombo: 0, combo: 0, hearts: 5 }); // mirrors the state above so finishing is never a render behind
  const started = useRef(Date.now());
  const total = exercises.length;
  const cur = queue[i];
  const done = i;

  const finish = useCallback((completed: boolean) => {
    const stats: LessonStats = { total, correctFirstTry: st.current.firstTry, maxCombo: st.current.maxCombo, heartsLeft: st.current.hearts, completed };
    const r: LessonResult = { outcomes: outcomes.current, stats, xp: lessonXp(stats), seconds: Math.round((Date.now() - started.current) / 1000) };
    setFinished(r);
    playSfx("done", progress.sound);
    onFinish(r);
  }, [total, onFinish, progress.sound]);

  const advance = useCallback(() => {
    setChecked(false); setRep({ ready: false });
    if (i + 1 >= queue.length) finish(true); else setI(i + 1);
  }, [i, queue.length, finish]);

  const grade = useCallback((r: Report) => {
    const ex = cur.ex;
    const correct = !!r.correct;
    if (!cur.retry) {
      if (ex.kind === "match") {
        const bad = new Set(r.mistakes ?? []);
        for (const id of ex.cardIds) outcomes.current.push({ cardId: id, firstTry: !bad.has(id) });
      } else if (ex.kind === "flip") {
        outcomes.current.push({ cardId: ex.cardId, firstTry: correct, grade: r.grade });
      } else outcomes.current.push({ cardId: ex.cardId, firstTry: correct });
      if (correct) { st.current.firstTry++; setFirstTry(st.current.firstTry); }
    }
    if (correct) {
      st.current.combo++;
      st.current.maxCombo = Math.max(st.current.maxCombo, st.current.combo);
      setCombo(st.current.combo); setMaxCombo(st.current.maxCombo);
      playSfx("correct", progress.sound);
    } else {
      st.current.combo = 0; setCombo(0);
      playSfx("wrong", progress.sound);
      if (!cur.retry && !quiz) setQueue((q) => [...q, { ex, retry: true }]);        // missed ones come round again, Duolingo-style
      if (heartsOn) {
        st.current.hearts = Math.max(0, st.current.hearts - 1);
        setHeartsLeft(st.current.hearts);
        if (st.current.hearts <= 0) setOutOfHearts(true);
      }
    }
    // a self-graded flashcard that went well just moves on (no banner needed)
    if (ex.kind === "flip" && correct) {
      setChecked(false); setRep({ ready: false });
      if (i + 1 >= queue.length) finish(true); else setI(i + 1);
      return;
    }
    setRep({ ...r, correct });
    setChecked(true);
  }, [cur, heartsOn, progress.sound, i, queue.length, finish, quiz]);

  const check = useCallback(() => { if (rep.ready && !checked) grade(rep); }, [rep, checked, grade]);

  // views that decide for themselves (match / self-graded flip) report with auto=true
  const onReport = useCallback((r: Report) => {
    if (r.auto) grade(r); else setRep(r);
  }, [grade]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || finished || outOfHearts) return;
      if (checked) advance(); else check();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [checked, advance, check, finished, outOfHearts]);

  if (finished) return <Summary title={title} result={finished} progress={startProgress} quiz={quiz} onDone={onExit} />;
  if (!cur) return <div className="flex h-full items-center justify-center"><Loader2 className="animate-spin" /></div>;

  const isAutoKind = cur.ex.kind === "match" || cur.ex.kind === "flip";
  const wrong = checked && !rep.correct;
  const showBanner = checked && !(cur.ex.kind === "flip" && !wrong);

  return (
    <div className="flex h-full min-h-screen flex-col bg-background">
      <header className="mx-auto flex w-full max-w-2xl items-center gap-3 px-4 py-4">
        <button onClick={() => { if (done === 0 || confirm("Quit this lesson? Your progress in it will be lost.")) onExit(); }} className="rounded-lg p-1.5 text-foreground-muted hover:bg-surface-secondary" title="Quit"><X size={22} /></button>
        <div className="h-3.5 flex-1 overflow-hidden rounded-full bg-surface-secondary">
          <div className="h-full rounded-full bg-positive transition-all duration-500" style={{ width: `${Math.min(100, (done / Math.max(1, total)) * 100)}%` }} />
        </div>
        {heartsOn && <span className="flex items-center gap-1 text-sm font-semibold text-negative"><Heart size={18} fill="currentColor" /> {heartsLeft}</span>}
      </header>

      <main className="mx-auto w-full max-w-xl flex-1 px-5 pb-40 pt-4">
        {cur.retry && <p className="mb-3 inline-block rounded-full bg-amber-500/15 px-3 py-1 text-xs font-medium text-amber-600">Let&apos;s try that one again</p>}
        {combo >= 3 && !checked && <p className="mb-3 flex items-center gap-1 text-sm font-semibold text-amber-600"><Zap size={14} /> {combo} in a row!</p>}
        <ExerciseView key={`${i}-${queue.length}`} ex={cur.ex} cards={cardMap} locked={checked} report={onReport} />
      </main>

      <footer className={`fixed inset-x-0 bottom-0 border-t transition-colors ${showBanner ? (wrong ? "border-negative/40 bg-negative/10" : "border-positive/40 bg-positive/10") : "border-border bg-surface"}`}>
        <div className="mx-auto flex w-full max-w-xl items-center justify-between gap-4 px-5 py-4">
          {showBanner ? (
            <div className="min-w-0">
              <p className={`flex items-center gap-1.5 text-lg font-bold ${wrong ? "text-negative" : "text-positive"}`}>
                {wrong ? <X size={20} /> : <Check size={20} />} {wrong ? "Not quite" : ["Correct!", "Nice!", "Great!", "Perfect!"][Math.min(3, Math.floor(combo / 2))]}
              </p>
              {wrong && rep.shown && <p className="mt-0.5 text-sm"><span className="text-foreground-muted">Answer: </span><RichText text={rep.shown} /></p>}
              {!wrong && cur.ex.kind !== "match" && checkCloseNote(cur.ex, rep)}
            </div>
          ) : <span className="text-sm text-foreground-muted">{isAutoKind ? "" : "Pick or type your answer"}</span>}
          {!isAutoKind || showBanner ? (
            <Button variant="primary" className={`!px-8 !py-3 !text-base ${wrong ? "!bg-negative" : showBanner ? "!bg-positive" : ""}`} disabled={!checked && !rep.ready} onClick={() => (checked ? advance() : check())}>
              {checked ? "Continue" : "Check"}
            </Button>
          ) : null}
        </div>
      </footer>

      {outOfHearts && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-surface p-6 text-center shadow-2xl">
            <Heart size={44} className="mx-auto text-negative" />
            <h2 className="mt-3 text-xl font-bold">Out of hearts</h2>
            <p className="mt-1 text-sm text-foreground-muted">Keep going in practice mode — no hearts, same questions — or end here and review later.</p>
            <div className="mt-5 flex flex-col gap-2">
              <Button variant="primary" onClick={() => { setOutOfHearts(false); setHeartsOn(false); }}>Keep practising</Button>
              <Button onClick={() => { setOutOfHearts(false); finish(false); }}>End lesson</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function checkCloseNote(ex: Exercise, rep: Report) {
  if ((ex.kind === "typed" || ex.kind === "cloze") && rep.shown) return <p className="mt-0.5 text-sm text-foreground-muted">Answer: <RichText text={rep.shown} /></p>;
  return null;
}

function Summary({ title, result, progress, quiz, onDone }: { title: string; result: LessonResult; progress: Progress; quiz?: boolean; onDone: () => void }) {
  const after = useMemo(() => addXp(progress, result.xp), [progress, result.xp]);
  const acc = result.stats.total ? Math.round((result.stats.correctFirstTry / result.stats.total) * 100) : 0;
  const goalPct = Math.min(100, Math.round((xpToday(after) / after.goal) * 100));
  const bits = useMemo(() => Array.from({ length: 26 }, (_, k) => ({ e: CONFETTI[k % CONFETTI.length], left: Math.round((k * 37) % 100), delay: (k % 9) * 0.18, dur: 2.4 + (k % 5) * 0.4 })), []);
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-background px-5 text-center">
      <style>{`@keyframes fall{0%{transform:translateY(-10vh) rotate(0);opacity:1}100%{transform:translateY(110vh) rotate(540deg);opacity:.9}}`}</style>
      {result.stats.completed && bits.map((b, k) => <span key={k} className="pointer-events-none absolute top-0 text-2xl" style={{ left: `${b.left}%`, animation: `fall ${b.dur}s ${b.delay}s ease-in forwards` }}>{b.e}</span>)}
      <Trophy size={64} className={result.stats.completed ? "text-amber-500" : "text-foreground-muted"} />
      <h1 className="mt-4 text-3xl font-bold">{quiz ? `Quiz: ${result.stats.correctFirstTry} / ${result.stats.total}` : result.stats.completed ? (acc >= 90 ? "Flawless!" : acc >= 70 ? "Lesson complete!" : "Done — nice effort!") : "Lesson ended"}</h1>
      <p className="mt-1 text-sm text-foreground-muted">{title}</p>
      <div className="mt-8 grid w-full max-w-sm grid-cols-3 gap-3">
        <Stat icon={<Zap size={18} className="text-amber-500" />} label="XP" value={`+${result.xp}`} />
        <Stat icon={<Check size={18} className="text-positive" />} label="Accuracy" value={`${acc}%`} />
        <Stat icon={<Flame size={18} className="text-orange-500" />} label="Day streak" value={String(currentStreak(after))} />
      </div>
      <div className="mt-6 w-full max-w-sm">
        <div className="mb-1 flex justify-between text-xs text-foreground-muted"><span>Daily goal</span><span>{xpToday(after)} / {after.goal} XP</span></div>
        <div className="h-3 overflow-hidden rounded-full bg-surface-secondary"><div className="h-full rounded-full bg-amber-500 transition-all duration-1000" style={{ width: `${goalPct}%` }} /></div>
        {goalPct >= 100 && xpToday(progress) < progress.goal && <p className="mt-2 text-sm font-semibold text-amber-600">Daily goal reached! 🎯</p>}
      </div>
      <Button variant="primary" className="mt-10 !px-10 !py-3 !text-base" onClick={onDone}>Continue</Button>
    </div>
  );
}
function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border bg-surface px-2 py-3">
      <div className="flex items-center justify-center gap-1 text-xl font-bold">{icon}{value}</div>
      <p className="mt-0.5 text-[11px] uppercase tracking-wider text-foreground-muted">{label}</p>
    </div>
  );
}

export { exerciseCards };
