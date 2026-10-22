import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft, BookOpenCheck, BookmarkPlus, Brain, Crown, Flame, GraduationCap, Layers, Loader2, Pencil, Play, Plus, Settings2, Sparkles, Star, Target, Trash2, Zap, ClipboardList, AlertTriangle, Check, Snowflake,
} from "lucide-react";
import { go } from "@/router";
import { RichText } from "@/components/blocks";
import { Button, Card as UiCard, Modal, Toast } from "@/components/ui";
import { LessonRunner, type LessonResult } from "@/components/lesson";
import { ExamResults, ExamRunner, MarkingScreen } from "@/components/exam-runner";
import { listNotebooks, listNotes, type ExamRec, type MistakeRec } from "@/lib/db";
import {
  addAttempt, deleteCard, deleteExam, deleteMistake, getProgress, listCards, listExams, listMistakes, patchMistake, putCards, putProgress, saveExam,
} from "@/lib/study-db";
import {
  addXp, applyOutcomes, buildLesson, currentStreak, lastDays, makeCard, topicStats, xpToday, type Card, type Progress, type Exercise, shuffle,
} from "@/lib/study-core";
import { crownOf, isDue, isNew } from "@/lib/srs";
import { allParts, buildResult, type Exam, type Part, type PartAnswer, type PartMark, type Question } from "@/lib/exam-core";
import { generateExam, markWithAi } from "@/lib/ai-study";
import { AiError } from "@/lib/ai";
import { aiReady, getSettings, useSettings } from "@/lib/settings";
import { estimateUsd, formatUsd } from "@/lib/ai-cost";
import { corpusExcerpts } from "@/lib/search";
import { cardFromMistake, gatherPageImages, makeCardsFromNotes, resolveCrops, scopeNoteIds } from "@/lib/study-actions";
import { markObjective } from "@/lib/exam-core";
import { count, logError } from "@/lib/telemetry";
import { newId } from "@/lib/ids";
import { timeAgo } from "@/lib/format";
import type { NoteMeta, NotebookRec } from "@/types";

type Tab = "path" | "cards" | "tests" | "mistakes";
type Session =
  | { kind: "lesson"; title: string; exercises: Exercise[]; quiz?: boolean }
  | { kind: "exam"; exam: Exam; rec: ExamRec }
  | { kind: "marking"; message: string }
  | { kind: "results"; exam: Exam; recId: string; answers: Record<string, PartAnswer>; marks: PartMark[]; seconds: number };

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: "path", label: "Learn", icon: <GraduationCap size={15} /> },
  { id: "cards", label: "Cards", icon: <Layers size={15} /> },
  { id: "tests", label: "Quizzes & exams", icon: <ClipboardList size={15} /> },
  { id: "mistakes", label: "Mistakes", icon: <AlertTriangle size={15} /> },
];

export function StudyPage({ view }: { view?: string }) {
  const settings = useSettings();
  const ai = aiReady(settings);
  const tab: Tab = (TABS.find((t) => t.id === view)?.id ?? "path") as Tab;
  const [cards, setCards] = useState<Card[]>([]);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [notes, setNotes] = useState<NoteMeta[]>([]);
  const [notebooks, setNotebooks] = useState<NotebookRec[]>([]);
  const [mistakes, setMistakes] = useState<MistakeRec[]>([]);
  const [exams, setExams] = useState<ExamRec[]>([]);
  const [nb, setNb] = useState<string>("all");
  const [session, setSession] = useState<Session | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [modal, setModal] = useState<null | "generate" | "card" | "quiz" | "exam" | "settings">(null);
  const [editing, setEditing] = useState<Card | null>(null);

  const flash = useCallback((m: string) => { setToast(m); setTimeout(() => setToast((t) => (t === m ? null : t)), 3600); }, []);
  const reload = useCallback(async () => {
    const [c, p, n, b, m, e] = await Promise.all([listCards(), getProgress(), listNotes(), listNotebooks(), listMistakes(), listExams()]);
    setCards(c); setProgress(p); setNotes(n); setNotebooks(b); setMistakes(m); setExams(e);
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  // coming from a concept map: "Study this" on a node starts a lesson on that concept's cards
  useEffect(() => {
    if (!progress || !cards.length) return;
    let raw: string | null = null;
    try { raw = sessionStorage.getItem("pipit.studyFocus"); sessionStorage.removeItem("pipit.studyFocus"); } catch { /* */ }
    if (!raw) return;
    try {
      const f = JSON.parse(raw) as { ids: string[]; title: string };
      const pool = cards.filter((c) => f.ids.includes(c.id));
      if (pool.length) startLesson({ title: f.title, pool, size: Math.min(10, Math.max(4, pool.length)) });
    } catch { /* ignore a malformed hand-off */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress, cards.length]);

  const scoped = useMemo(() => (nb === "all" ? cards : cards.filter((c) => c.notebookId === (nb === "none" ? null : nb))), [cards, nb]);
  const now = Date.now();
  const dueCount = scoped.filter((c) => !c.suspended && isDue(c, now)).length;
  const topics = useMemo(() => topicStats(scoped, now), [scoped, now]);

  // --- sessions ----------------------------------------------------------------------------------------------------
  function startLesson(o: { topic?: string; dueOnly?: boolean; title: string; size?: number; quiz?: boolean; nb?: string; pool?: Card[] }) {
    const nbSel = o.nb ?? nb;
    const pool = o.pool ?? (nbSel === "all" ? cards : cards.filter((c) => c.notebookId === (nbSel === "none" ? null : nbSel)));
    const ex = buildLesson(pool, { topic: o.topic, dueOnly: o.dueOnly, size: o.size ?? 8, maxNew: o.quiz ? 99 : 4, now: Date.now() });
    if (!ex.length) return flash(o.dueOnly ? "Nothing is due right now — nice work!" : "No cards to study yet — make some first.");
    count(o.quiz ? "study.quiz.start" : "study.lesson.start");
    setSession({ kind: "lesson", title: o.title, exercises: ex, quiz: o.quiz });
  }

  async function onLessonFinish(r: LessonResult) {
    if (!progress) return;
    try {
      // use what is in the database NOW: a card removed or edited during the lesson must not be overwritten by a stale copy
      const updated = applyOutcomes(await listCards(), r.outcomes, Date.now());
      await putCards(updated);
      const np = r.stats.total ? addXp(progress, r.xp) : progress;
      await putProgress(np);
      count("study.lesson.done");
      await reload();
    } catch (e) { logError("study", e); }
  }

  async function startPractice() {
    // "My mistakes" become cards on demand, then are practised like any other lesson
    const open = mistakes.filter((m) => !m.resolved && !m.cardId);
    const nbOf = new Map(notes.map((n) => [n.id, n.notebookId]));
    const fresh = open.slice(0, 20).map((m) => ({ m, c: cardFromMistake(m, nbOf.get(m.noteId) ?? null) }));
    if (fresh.length) {
      await putCards(fresh.map((x) => x.c));
      for (const { m, c } of fresh) await patchMistake(m.id, { cardId: c.id });
    }
    const mine = [...cards.filter((c) => c.source === "mistake"), ...fresh.map((x) => x.c)];
    await reload();
    startLesson({ title: "My mistakes", pool: mine.length >= 2 ? mine : undefined });
  }

  // --- exams ----------------------------------------------------------------------------------------------------------
  async function runExam(exam: Exam, rec: ExamRec) { setSession({ kind: "exam", exam, rec }); }

  async function submitExam(exam: Exam, recId: string, answers: Record<string, PartAnswer>, seconds: number) {
    setSession({ kind: "marking", message: "Checking multiple-choice and numeric answers…" });
    count("study.exam.submit");
    try {
      const parts = allParts(exam);
      const marks: PartMark[] = [];
      const aiItems = [];
      for (const { q, p } of parts) {
        const m = markObjective(p, answers[p.id]);
        if (m) marks.push(m); else aiItems.push({ q, p, a: answers[p.id] });
      }
      // an unanswered part is 0 marks — no reason to pay for an AI call to find that out
      const blank = (a: PartAnswer | undefined) => !a?.text?.trim() && !a?.ink;
      for (const { p, a } of aiItems.filter((x) => blank(x.a))) marks.push({ partId: p.id, max: p.marks, marks: 0, auto: false, feedback: "No answer given." });
      const toMark = aiItems.filter((x) => !blank(x.a));
      if (toMark.length) {
        const selfMark = (why: string) => { for (const { p } of toMark) marks.push({ partId: p.id, max: p.marks, marks: 0, auto: false, feedback: `${why} Compare with the model answer and set your own mark with + / −.` }); };
        if (ai) {
          setSession({ kind: "marking", message: `Marking ${toMark.length} written answer${toMark.length === 1 ? "" : "s"}… (handwriting is read here)` });
          try { marks.push(...(await markWithAi(toMark))); }
          catch (e) {
            // never lose a finished exam to a network or key problem: fall back to marking those parts yourself
            logError("study", e);
            flash(e instanceof AiError ? e.message : "AI marking failed.");
            selfMark("AI marking wasn't available.");
          }
        } else selfMark("AI marking is off.");
      }
      const result = buildResult(exam, marks);
      const slim = Object.fromEntries(Object.entries(answers).map(([k, v]) => [k, { text: v.text, choice: v.choice }]));
      await addAttempt(recId, { id: newId(), at: Date.now(), seconds, answers: slim, result });
      // XP for sitting an exam
      if (progress) { const np = addXp(progress, 20 + Math.round(result.percent / 5)); await putProgress(np); }
      await reload();
      setSession({ kind: "results", exam, recId, answers, marks: result.marks, seconds });
    } catch (e) {
      logError("study", e);
      flash(e instanceof AiError ? e.message : `Marking failed: ${(e as Error).message}`);
      setSession(null);
    }
  }

  async function examToCards(exam: Exam, items: { q: Question; p: Part }[]) {
    const fresh = items.map(({ q, p }) => ({
      ...makeCard({ front: (p.prompt ? `${q.stem}\n\n${p.prompt}` : q.stem).slice(0, 380), back: p.answer || p.options?.[p.correct ?? 0] || "—" }),
      id: newId(), source: "mistake" as const, topic: q.topic ?? exam.title, notebookId: null,
    })) as Card[];
    await putCards(fresh);
    await reload();
    flash(`Added ${fresh.length} card${fresh.length === 1 ? "" : "s"} — find them under Learn.`);
  }

  // --- session overlays ----------------------------------------------------------------------------------------------------
  if (progress && session?.kind === "lesson") {
    return <LessonRunner title={session.title} cards={cards} exercises={session.exercises} progress={progress} quiz={session.quiz} onFinish={(r) => void onLessonFinish(r)} onExit={() => setSession(null)}
      onFlagCard={(id) => { const c = cards.find((x) => x.id === id); if (c) { void putCards([{ ...c, suspended: true, updatedAt: Date.now() }]); count("study.card.flagged"); } }} />;
  }
  if (session?.kind === "exam") return <ExamRunner exam={session.exam} onSubmit={(a, s) => void submitExam(session.exam, session.rec.id, a, s)} onExit={() => setSession(null)} />;
  if (session?.kind === "marking") return <MarkingScreen message={session.message} />;
  if (session?.kind === "results") {
    return (
      <ExamResults exam={session.exam} answers={session.answers} marks={session.marks} seconds={session.seconds}
        onMarks={(m) => setSession({ ...session, marks: m })}
        onRetake={() => { const rec = exams.find((e) => e.id === session.recId); if (rec) void runExam(session.exam, rec); }}
        onClose={() => setSession(null)} onCards={(items) => void examToCards(session.exam, items)} />
    );
  }

  const streak = progress ? currentStreak(progress) : 0;
  const goalXp = progress ? xpToday(progress) : 0;
  const goalPct = progress ? Math.min(100, Math.round((goalXp / progress.goal) * 100)) : 0;

  return (
    <div className="paper-bg safe-t min-h-full pb-24">
      <div className="mx-auto max-w-3xl px-4 py-5 md:px-6 md:py-8">
        <button onClick={() => go({ name: "library", notebook: null, q: "" })} className="mb-4 flex items-center gap-1.5 text-sm text-foreground-muted hover:text-foreground"><ArrowLeft size={15} /> All notes</button>

        {/* header: streak, daily goal */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h1 className="serif text-4xl tracking-tight">Study <span className="serif-i text-primary">time</span></h1>
          <div className="flex items-center gap-3">
            <span className={`flex items-center gap-1 rounded-full border px-3 py-1.5 text-sm font-bold ${streak ? "border-orange-500/40 bg-orange-500/10 text-orange-600" : "border-border text-foreground-muted"}`} title="Day streak"><Flame size={16} fill={streak ? "currentColor" : "none"} /> {streak}</span>
            <span className="flex items-center gap-1 rounded-full border border-sky-500/40 bg-sky-500/10 px-2.5 py-1.5 text-sm font-bold text-sky-600" title="Streak freezes: if you miss a day, one is used instead of ending your streak. You earn one for every 7 days in a row (you can hold 2).">
              <Snowflake size={15} /> {progress?.freezes ?? 0}
            </span>
            <GoalRing pct={goalPct} label={`${goalXp}/${progress?.goal ?? 30}`} />
            <button onClick={() => setModal("settings")} className="rounded-lg p-2 text-foreground-muted hover:bg-surface-secondary" title="Study settings"><Settings2 size={17} /></button>
          </div>
        </div>

        <div className="mt-5 flex gap-1 overflow-x-auto rounded-2xl border border-border bg-surface p-1 text-sm">
          {TABS.map((t) => (
            <button key={t.id} onClick={() => go({ name: "study", view: t.id === "path" ? undefined : t.id })}
              className={`flex shrink-0 items-center gap-1.5 rounded-xl px-3.5 py-2 font-medium ${tab === t.id ? "bg-primary text-white" : "text-foreground-muted hover:bg-surface-secondary"}`}>{t.icon}{t.label}</button>
          ))}
        </div>

        <div className="mt-5">
          {tab === "path" && progress && (
            <PathView cards={scoped} topics={topics} dueCount={dueCount} nb={nb} notebooks={notebooks} onNb={setNb} progress={progress}
              onLesson={startLesson} onGenerate={() => setModal("generate")} onCard={() => { setEditing(null); setModal("card"); }} />
          )}
          {tab === "cards" && <CardsView cards={cards} notebooks={notebooks} onAdd={() => { setEditing(null); setModal("card"); }} onEdit={(c) => { setEditing(c); setModal("card"); }}
            onDelete={async (c) => { await deleteCard(c.id); await reload(); }} onSuspend={async (c) => { await putCards([{ ...c, suspended: !c.suspended, updatedAt: Date.now() }]); await reload(); }} onGenerate={() => setModal("generate")} />}
          {tab === "tests" && <TestsView exams={exams} ai={ai} cardCount={cards.length} onQuiz={() => setModal("quiz")} onExam={() => setModal("exam")}
            onOpen={(rec) => void runExam(rec.exam, rec)} onDelete={async (rec) => { if (confirm(`Delete "${rec.exam.title}"?`)) { await deleteExam(rec.id); await reload(); } }} />}
          {tab === "mistakes" && <MistakesView mistakes={mistakes} notes={notes} onOpen={(m) => go({ name: "note", id: m.noteId, page: m.page })}
            onResolve={async (m) => { await patchMistake(m.id, { resolved: !m.resolved }); await reload(); }} onDelete={async (m) => { await deleteMistake(m.id); await reload(); }} onPractice={() => void startPractice()} />}
        </div>
      </div>

      {busy && <div className="fixed inset-x-0 bottom-6 z-50 flex justify-center"><div className="flex items-center gap-2 rounded-full border border-border bg-surface px-4 py-2 text-sm shadow-xl"><Loader2 size={14} className="animate-spin" /> {busy}</div></div>}

      {modal === "generate" && <GenerateModal ai={ai} notes={notes} notebooks={notebooks} onClose={() => setModal(null)} setBusy={setBusy}
        onDone={async (m) => { setModal(null); await reload(); flash(m); }} />}
      {modal === "card" && <CardModal card={editing} notebooks={notebooks} onClose={() => setModal(null)} onSave={async (c) => { await putCards([c]); setModal(null); await reload(); flash(editing ? "Card updated." : "Card added."); }} />}
      {modal === "quiz" && <QuizModal cards={cards} notebooks={notebooks} onClose={() => setModal(null)} onStart={(o) => { setModal(null); startLesson({ title: o.title, size: o.size, quiz: true, nb: o.nb }); }} />}
      {modal === "exam" && <ExamModal ai={ai} notes={notes} notebooks={notebooks} onClose={() => setModal(null)} setBusy={setBusy}
        onReady={async (exam) => { setModal(null); const rec = await saveExam(exam); await reload(); void runExam(exam, rec); }} flash={flash} />}
      {modal === "settings" && progress && <StudySettings progress={progress} onClose={() => setModal(null)} onChange={async (p) => { setProgress(p); await putProgress(p); }} />}
      <Toast msg={toast} />
    </div>
  );
}

// ---- header bits --------------------------------------------------------------------------------------------------------------------------
function GoalRing({ pct, label }: { pct: number; label: string }) {
  const r = 15, c = 2 * Math.PI * r;
  return (
    <div className="relative h-10 w-10" title={`Daily goal ${label} XP`}>
      <svg viewBox="0 0 40 40" className="h-full w-full -rotate-90"><circle cx="20" cy="20" r={r} fill="none" strokeWidth="4" className="stroke-surface-secondary" /><circle cx="20" cy="20" r={r} fill="none" strokeWidth="4" strokeLinecap="round" className={pct >= 100 ? "stroke-positive" : "stroke-amber-500"} strokeDasharray={`${(pct / 100) * c} ${c}`} /></svg>
      <Target size={14} className="absolute inset-0 m-auto text-foreground-muted" />
    </div>
  );
}

// ---- Learn (the skill path) ---------------------------------------------------------------------------------------------------------------
const WIGGLE = [0, 46, 74, 46, 0, -46, -74, -46];

function PathView({ cards, topics, dueCount, nb, notebooks, onNb, progress, onLesson, onGenerate, onCard }: {
  cards: Card[]; topics: ReturnType<typeof topicStats>; dueCount: number; nb: string; notebooks: NotebookRec[]; onNb: (v: string) => void; progress: Progress;
  onLesson: (o: { topic?: string; dueOnly?: boolean; title: string; size?: number }) => void; onGenerate: () => void; onCard: () => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const days = lastDays(progress, 7);
  const maxXp = Math.max(20, ...days.map((d) => d.xp));
  if (!cards.length) {
    return (
      <UiCard className="px-6 py-10 text-center">
        <Brain size={40} className="mx-auto text-primary" />
        <h2 className="serif mt-3 text-3xl">Turn your notes into <span className="serif-i text-primary">a course</span></h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-foreground-muted">I&apos;ll read your notes and make flashcards, then build short Duolingo-style lessons from them — matching, multiple choice, fill-in-the-blank, ordering and more — with streaks, XP and spaced repetition so it sticks.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Button variant="primary" onClick={onGenerate}><Sparkles size={15} /> Make flashcards from my notes</Button>
          <Button onClick={onCard}><Plus size={15} /> Add a card myself</Button>
        </div>
      </UiCard>
    );
  }
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        {notebooks.length > 0 && (
          <select value={nb} onChange={(e) => onNb(e.target.value)} className="rounded-xl border border-border bg-surface px-3 py-2 text-sm">
            <option value="all">All notebooks</option>
            {notebooks.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
            <option value="none">Unfiled</option>
          </select>
        )}
        <span className="text-sm text-foreground-muted">{cards.length} card{cards.length === 1 ? "" : "s"}</span>
        <div className="ml-auto flex gap-2">
          <Button onClick={onGenerate}><Sparkles size={14} /> More cards</Button>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <button disabled={!dueCount} onClick={() => onLesson({ dueOnly: true, title: "Review", size: 10 })}
          className={`flex items-center gap-3 rounded-2xl border-2 px-4 py-4 text-left ${dueCount ? "border-primary bg-primary/10 hover:bg-primary/15" : "border-border opacity-60"}`}>
          <Zap size={26} className="text-primary" />
          <span><span className="block text-base font-bold">{dueCount ? `Review ${Math.min(dueCount, 10)} due` : "All caught up"}</span><span className="text-xs text-foreground-muted">{dueCount ? `${dueCount} card${dueCount === 1 ? "" : "s"} ready to review` : "Nothing due — come back later"}</span></span>
        </button>
        <button onClick={() => onLesson({ title: "Mixed practice" })} className="flex items-center gap-3 rounded-2xl border-2 border-border px-4 py-4 text-left hover:bg-surface-secondary">
          <Play size={26} className="text-positive" />
          <span><span className="block text-base font-bold">Start a lesson</span><span className="text-xs text-foreground-muted">8 quick exercises, new + weak cards</span></span>
        </button>
      </div>

      {/* skill path */}
      <div className="mx-auto mt-8 flex max-w-sm flex-col items-center">
        {topics.map((t, k) => {
          const x = WIGGLE[k % WIGGLE.length];
          const full = t.crowns >= 5, started = t.fresh < t.cards.length;
          const r = 36, c = 2 * Math.PI * r;
          return (
            <div key={t.topic} className="relative flex w-full flex-col items-center" style={{ transform: `translateX(${x}px)`, marginBottom: 22 }}>
              <button onClick={() => setOpen(open === t.topic ? null : t.topic)} className="relative h-[88px] w-[88px]" title={t.topic}>
                <svg viewBox="0 0 88 88" className="absolute inset-0 -rotate-90"><circle cx="44" cy="44" r={r} fill="none" strokeWidth="7" className="stroke-surface-secondary" /><circle cx="44" cy="44" r={r} fill="none" strokeWidth="7" strokeLinecap="round" className={full ? "stroke-amber-500" : "stroke-positive"} strokeDasharray={`${t.mastery * c} ${c}`} /></svg>
                <span className={`absolute inset-[11px] flex items-center justify-center rounded-full shadow-md ${full ? "bg-amber-500 text-white" : started ? "bg-positive text-white" : "bg-primary text-white"}`}>
                  {full ? <Crown size={28} /> : started ? <Star size={28} fill="currentColor" /> : <Play size={26} fill="currentColor" />}
                </span>
                {t.due > 0 && <span className="absolute -right-1 -top-1 flex h-6 min-w-6 items-center justify-center rounded-full bg-negative px-1 text-xs font-bold text-white">{t.due}</span>}
              </button>
              <p className="mt-1.5 max-w-[11rem] truncate text-center text-sm font-semibold">{t.topic}</p>
              <p className="flex items-center gap-0.5 text-[11px] text-foreground-muted">{Array.from({ length: 5 }, (_, i) => <Crown key={i} size={10} className={i < t.crowns ? "text-amber-500" : "opacity-30"} fill={i < t.crowns ? "currentColor" : "none"} />)}<span className="ml-1">{t.cards.length} cards</span></p>
              {open === t.topic && (
                <div className="mt-2 w-60 rounded-2xl border border-border bg-surface p-3 text-center shadow-xl">
                  <p className="text-xs text-foreground-muted">{t.fresh} new · {t.due} due · {t.cards.length - t.fresh - t.due} learning</p>
                  <div className="mt-2 flex flex-col gap-1.5">
                    <Button variant="primary" onClick={() => onLesson({ topic: t.topic, title: t.topic })}><Play size={14} /> Start</Button>
                    {t.due > 0 && <Button onClick={() => onLesson({ topic: t.topic, dueOnly: true, title: `${t.topic} — review` })}>Review {t.due} due</Button>}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* week at a glance */}
      <UiCard className="mt-8 px-5 py-4">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-foreground-muted">This week</p>
        <div className="flex h-24 items-end justify-between gap-2">
          {days.map((d, i) => (
            <div key={d.day} className="flex flex-1 flex-col items-center gap-1">
              <div className={`w-full rounded-md ${d.xp >= progress.goal ? "bg-positive" : d.xp ? "bg-amber-500" : "bg-surface-secondary"}`} style={{ height: `${Math.max(6, (d.xp / maxXp) * 72)}px` }} title={`${d.xp} XP`} />
              <span className={`text-[10px] ${i === 6 ? "font-bold" : "text-foreground-muted"}`}>{["S", "M", "T", "W", "T", "F", "S"][new Date(d.day + "T12:00:00").getDay()]}</span>
            </div>
          ))}
        </div>
        <p className="mt-2 text-xs text-foreground-muted">{progress.xp} XP total · best streak {progress.best} day{progress.best === 1 ? "" : "s"}</p>
      </UiCard>
    </div>
  );
}

// ---- Cards -----------------------------------------------------------------------------------------------------------------------------
function CardsView({ cards, notebooks, onAdd, onEdit, onDelete, onSuspend, onGenerate }: {
  cards: Card[]; notebooks: NotebookRec[]; onAdd: () => void; onEdit: (c: Card) => void; onDelete: (c: Card) => void; onSuspend: (c: Card) => void; onGenerate: () => void;
}) {
  const [q, setQ] = useState("");
  const f = q.trim().toLowerCase();
  const list = cards.filter((c) => !f || c.front.toLowerCase().includes(f) || c.back.toLowerCase().includes(f) || (c.topic ?? "").toLowerCase().includes(f));
  const groups = new Map<string, Card[]>();
  for (const c of list) groups.set(c.topic?.trim() || "General", [...(groups.get(c.topic?.trim() || "General") ?? []), c]);
  const nbName = (id: string | null) => notebooks.find((n) => n.id === id)?.name;
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${cards.length} cards`} className="min-w-0 flex-1 rounded-xl border border-border bg-surface px-3.5 py-2 text-sm outline-none focus:border-primary" />
        <Button onClick={onGenerate}><Sparkles size={14} /> From notes</Button>
        <Button variant="primary" onClick={onAdd}><Plus size={14} /> New card</Button>
      </div>
      {cards.length === 0 && <p className="py-12 text-center text-sm text-foreground-muted">No cards yet. Generate them from your notes or add one by hand.</p>}
      <div className="mt-4 space-y-5">
        {[...groups.entries()].map(([topic, cs]) => (
          <section key={topic}>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-foreground-muted">{topic} · {cs.length}</h3>
            <div className="space-y-2">
              {cs.map((c) => (
                <UiCard key={c.id} className={`px-4 py-3 ${c.suspended ? "opacity-50" : ""}`}>
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1 text-sm">
                      <div className="font-medium"><RichText text={c.front} /></div>
                      <div className="mt-1 text-foreground-muted"><RichText text={c.kind === "steps" && c.steps ? c.steps.map((s, i) => `${i + 1}. ${s}`).join("  ") : c.back} /></div>
                      <p className="mt-1.5 flex flex-wrap items-center gap-x-2 text-[11px] text-foreground-muted">
                        <span className="rounded-full bg-surface-secondary px-1.5">{c.kind}</span>
                        {nbName(c.notebookId) && <span>{nbName(c.notebookId)}</span>}
                        <span>{isNew(c) ? "new" : isDue(c) ? "due now" : `next ${timeAgo(c.due).replace(" ago", "")}`}</span>
                        <span className="flex">{Array.from({ length: 5 }, (_, i) => <Crown key={i} size={10} className={i < crownOf(c) ? "text-amber-500" : "opacity-25"} fill={i < crownOf(c) ? "currentColor" : "none"} />)}</span>
                        {c.noteId && c.page !== undefined && <button className="text-primary hover:underline" onClick={() => go({ name: "note", id: c.noteId!, page: c.page })}>in my notes ↗</button>}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-0.5">
                      <button onClick={() => onEdit(c)} className="rounded-md p-1.5 text-foreground-muted hover:bg-surface-secondary" title="Edit"><Pencil size={14} /></button>
                      <button onClick={() => onSuspend(c)} className="rounded-md p-1.5 text-foreground-muted hover:bg-surface-secondary" title={c.suspended ? "Resume" : "Pause (skip in lessons)"}><Check size={14} /></button>
                      <button onClick={() => { if (confirm("Delete this card?")) onDelete(c); }} className="rounded-md p-1.5 text-foreground-muted hover:text-negative" title="Delete"><Trash2 size={14} /></button>
                    </div>
                  </div>
                </UiCard>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

// ---- Quizzes & exams ---------------------------------------------------------------------------------------------------------------------
function TestsView({ exams, ai, cardCount, onQuiz, onExam, onOpen, onDelete }: {
  exams: ExamRec[]; ai: boolean; cardCount: number; onQuiz: () => void; onExam: () => void; onOpen: (r: ExamRec) => void; onDelete: (r: ExamRec) => void;
}) {
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <button onClick={onQuiz} disabled={!cardCount} className="rounded-2xl border-2 border-border p-5 text-left hover:bg-surface-secondary disabled:opacity-50">
          <BookOpenCheck size={26} className="text-positive" />
          <p className="mt-2 text-lg font-bold">Quick quiz</p>
          <p className="text-sm text-foreground-muted">A set of questions from your flashcards — multiple choice, typing, true/false, matching. Scored at the end, no hearts.</p>
        </button>
        <button onClick={onExam} className="rounded-2xl border-2 border-primary/50 bg-primary/5 p-5 text-left hover:bg-primary/10">
          <ClipboardList size={26} className="text-primary" />
          <p className="mt-2 text-lg font-bold">Practice exam {ai ? "" : "(needs AI)"}</p>
          <p className="text-sm text-foreground-muted">A realistic paper written from your notes: multi-part questions with graphs, data tables, diagrams and pictures. Timed, marked, with the model answer.</p>
        </button>
      </div>
      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-foreground-muted">Saved exams</h3>
        {exams.length === 0 && <p className="text-sm text-foreground-muted">No exams yet. Generate one — it&apos;s saved here so you can retake it.</p>}
        <div className="space-y-2">
          {exams.map((r) => {
            const best = r.attempts.length ? Math.max(...r.attempts.map((a) => a.result.percent)) : null;
            return (
              <UiCard key={r.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{r.exam.title}</p>
                  <p className="text-xs text-foreground-muted">{r.exam.totalMarks} marks · {r.exam.durationMin} min · {r.exam.sections.reduce((a, s) => a + s.questions.length, 0)} questions · {timeAgo(r.createdAt)}{best !== null ? ` · best ${best}%` : ""}</p>
                </div>
                <Button variant="primary" onClick={() => onOpen(r)}>{r.attempts.length ? "Retake" : "Start"}</Button>
                <button onClick={() => onDelete(r)} className="rounded-md p-1.5 text-foreground-muted hover:text-negative" title="Delete"><Trash2 size={15} /></button>
              </UiCard>
            );
          })}
        </div>
      </section>
    </div>
  );
}

// ---- Mistakes ----------------------------------------------------------------------------------------------------------------------------
function MistakesView({ mistakes, notes, onOpen, onResolve, onDelete, onPractice }: {
  mistakes: MistakeRec[]; notes: NoteMeta[]; onOpen: (m: MistakeRec) => void; onResolve: (m: MistakeRec) => void; onDelete: (m: MistakeRec) => void; onPractice: () => void;
}) {
  const title = (id: string) => notes.find((n) => n.id === id)?.title ?? "Deleted note";
  const open = mistakes.filter((m) => !m.resolved);
  const byKind = new Map<string, number>();
  for (const m of open) byKind.set(m.kind, (byKind.get(m.kind) ?? 0) + 1);
  const kinds = [...byKind.entries()].sort((a, b) => b[1] - a[1]);
  if (!mistakes.length) {
    return <UiCard className="px-6 py-10 text-center"><AlertTriangle size={34} className="mx-auto text-amber-500" /><h2 className="mt-3 text-xl font-bold">No mistakes logged yet</h2><p className="mx-auto mt-1 max-w-sm text-sm text-foreground-muted">Open a note, choose ⋯ → Review for mistakes. Everything it finds is saved here so you can see which kinds of error you repeat.</p></UiCard>;
  }
  return (
    <div className="space-y-4">
      <UiCard className="px-5 py-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">Your patterns</p>
        <div className="mt-2 space-y-1.5">
          {kinds.map(([k, n]) => (
            <div key={k} className="flex items-center gap-2 text-sm"><span className="w-24 capitalize text-foreground-muted">{k.replace("-", " ")}</span><div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-secondary"><div className="h-full rounded-full bg-negative/70" style={{ width: `${(n / open.length) * 100}%` }} /></div><span className="w-6 text-right tabular-nums">{n}</span></div>
          ))}
          {!kinds.length && <p className="text-sm text-positive">Everything resolved — great job.</p>}
        </div>
        {open.some((m) => !m.cardId) && <Button className="mt-3" variant="primary" onClick={onPractice}><BookmarkPlus size={14} /> Turn {open.filter((m) => !m.cardId).length} into practice cards</Button>}
      </UiCard>
      <div className="space-y-2.5">
        {mistakes.map((m) => (
          <UiCard key={m.id} className={`px-4 py-3 ${m.resolved ? "opacity-55" : ""}`}>
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1 text-sm">
                <p className="text-[11px] uppercase tracking-wider text-foreground-muted">{title(m.noteId)} · page {m.page + 1} · {m.kind.replace("-", " ")}</p>
                {m.read && <p className="mt-1 text-foreground-muted">You wrote: <RichText text={m.read} /></p>}
                <p className={`mt-1 font-medium ${m.resolved ? "line-through" : ""}`}><RichText text={m.problem} /></p>
                {m.fix && <p className="mt-0.5"><span className="font-medium text-positive">Instead: </span><RichText text={m.fix} /></p>}
              </div>
              <div className="flex shrink-0 gap-0.5">
                <button onClick={() => onOpen(m)} className="rounded-md px-1.5 py-1 text-xs text-primary hover:bg-surface-secondary">Open</button>
                <button onClick={() => onResolve(m)} className="rounded-md p-1.5 text-foreground-muted hover:bg-surface-secondary" title={m.resolved ? "Mark unresolved" : "Mark fixed"}><Check size={14} /></button>
                <button onClick={() => onDelete(m)} className="rounded-md p-1.5 text-foreground-muted hover:text-negative" title="Remove"><Trash2 size={14} /></button>
              </div>
            </div>
          </UiCard>
        ))}
      </div>
    </div>
  );
}

// ---- modals ------------------------------------------------------------------------------------------------------------------------------
function ScopeSelect({ value, onChange, notes, notebooks }: { value: string; onChange: (v: string) => void; notes: NoteMeta[]; notebooks: NotebookRec[] }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="mt-1 block w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground">
      <option value="all">All my notes</option>
      {notebooks.length > 0 && <optgroup label="Notebooks">{notebooks.map((n) => <option key={n.id} value={`nb:${n.id}`}>{n.name}</option>)}</optgroup>}
      <optgroup label="Notes">{notes.map((n) => <option key={n.id} value={`note:${n.id}`}>{n.title}</option>)}</optgroup>
    </select>
  );
}
const Field = ({ label, children }: { label: string; children: React.ReactNode }) => <label className="block text-xs text-foreground-muted">{label}{children}</label>;

function GenerateModal({ ai, notes, notebooks, onClose, onDone, setBusy }: {
  ai: boolean; notes: NoteMeta[]; notebooks: NotebookRec[]; onClose: () => void; onDone: (msg: string) => void; setBusy: (m: string | null) => void;
}) {
  const [scope, setScope] = useState("all");
  const [want, setWant] = useState(20);
  const [again, setAgain] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const run = async () => {
    setErr(null); setBusy("Reading your notes and writing cards…");
    try {
      const r = await makeCardsFromNotes(scope, want, again);
      if (!r.sources && r.skipped) { setErr(`You've already made cards from all ${r.skipped} page${r.skipped === 1 ? "" : "s"} here, and none have changed. Tick “Include pages I've already used” to make more anyway.`); return; }
      if (!r.sources) { setErr("There's no readable text in that scope yet. Use “Read my handwriting” on the Search page, or import typed PDFs."); return; }
      onDone(r.added ? `Added ${r.added} new card${r.added === 1 ? "" : "s"} from ${r.sources} page${r.sources === 1 ? "" : "s"}.` : "No new cards — you already have these.");
    } catch (e) { setErr(e instanceof AiError ? e.message : "Something went wrong: " + (e as Error).message); } finally { setBusy(null); }
  };
  return (
    <Modal title="Make flashcards from your notes" onClose={onClose}>
      {!ai ? <p className="text-sm">AI is off. Add your API key and switch it on in <button className="font-medium text-primary underline" onClick={() => go({ name: "settings" })}>Settings</button>.</p> : (
        <div className="space-y-4">
          <Field label="Read from"><ScopeSelect value={scope} onChange={setScope} notes={notes} notebooks={notebooks} /></Field>
          <Field label="About how many cards">
            <select value={want} onChange={(e) => setWant(Number(e.target.value))} className="mt-1 block w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground">{[10, 20, 30, 40].map((n) => <option key={n}>{n}</option>)}</select>
          </Field>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={again} onChange={(e) => setAgain(e.target.checked)} /><span>Include pages I&apos;ve already used <span className="text-foreground-muted">(otherwise only new or changed pages are read, which saves money)</span></span></label>
          <p className="text-xs text-foreground-muted">Uses your handwriting-search text and PDF text. Cards are checked against what you already have so you won&apos;t get duplicates. Typical cost {formatUsd(estimateUsd("cards", 1, getSettings()))}.</p>
          {err && <p className="text-sm text-negative">{err}</p>}
          <Button variant="primary" onClick={run}><Sparkles size={14} /> Make cards</Button>
        </div>
      )}
    </Modal>
  );
}

function CardModal({ card, notebooks, onClose, onSave }: { card: Card | null; notebooks: NotebookRec[]; onClose: () => void; onSave: (c: Card) => void }) {
  const [front, setFront] = useState(card?.front ?? "");
  const [back, setBack] = useState(card?.back ?? "");
  const [topic, setTopic] = useState(card?.topic ?? "");
  const [nbId, setNbId] = useState<string>(card?.notebookId ?? "");
  const save = () => {
    if (!front.trim() || !back.trim()) return;
    const base = card ?? ({ ...makeCard({ front, back }), id: newId() } as Card);
    onSave({ ...base, front: front.trim(), back: back.trim(), topic: topic.trim() || undefined, notebookId: nbId || null, updatedAt: Date.now() });
  };
  const area = "mt-1 block w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary";
  return (
    <Modal title={card ? "Edit card" : "New card"} onClose={onClose}>
      <div className="space-y-3">
        <Field label="Front (question) — maths in $…$"><textarea value={front} onChange={(e) => setFront(e.target.value)} rows={2} className={area} autoFocus /></Field>
        <Field label="Back (answer)"><textarea value={back} onChange={(e) => setBack(e.target.value)} rows={2} className={area} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Topic"><input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. Cell biology" className={area} /></Field>
          <Field label="Notebook"><select value={nbId} onChange={(e) => setNbId(e.target.value)} className={area}><option value="">Unfiled</option>{notebooks.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}</select></Field>
        </div>
        <Button variant="primary" onClick={save} disabled={!front.trim() || !back.trim()}>Save card</Button>
      </div>
    </Modal>
  );
}

function QuizModal({ cards, notebooks, onClose, onStart }: { cards: Card[]; notebooks: NotebookRec[]; onClose: () => void; onStart: (o: { nb: string; size: number; title: string }) => void }) {
  const [nb, setNb] = useState("all");
  const [size, setSize] = useState(10);
  const n = nb === "all" ? cards.length : cards.filter((c) => c.notebookId === (nb === "none" ? null : nb)).length;
  return (
    <Modal title="Quick quiz" onClose={onClose}>
      <div className="space-y-4">
        <Field label="Questions from"><select value={nb} onChange={(e) => setNb(e.target.value)} className="mt-1 block w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground"><option value="all">All cards</option>{notebooks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}<option value="none">Unfiled</option></select></Field>
        <Field label="How many"><select value={size} onChange={(e) => setSize(Number(e.target.value))} className="mt-1 block w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground">{[5, 10, 15, 20].map((s) => <option key={s}>{s}</option>)}</select></Field>
        <p className="text-xs text-foreground-muted">{n} card{n === 1 ? "" : "s"} available. A quiz doesn&apos;t use hearts or retries — you get your score at the end.</p>
        <Button variant="primary" disabled={!n} onClick={() => onStart({ nb, size: Math.min(size, 20), title: "Quick quiz" })}><Play size={14} /> Start quiz</Button>
      </div>
    </Modal>
  );
}

const STYLES = ["", "AP exam", "IB", "A-level", "University midterm", "University final", "High-school unit test"];

function ExamModal({ ai, notes, notebooks, onClose, onReady, setBusy, flash }: {
  ai: boolean; notes: NoteMeta[]; notebooks: NotebookRec[]; onClose: () => void; onReady: (e: Exam) => void; setBusy: (m: string | null) => void; flash: (m: string) => void;
}) {
  const [scope, setScope] = useState("all");
  const [questions, setQuestions] = useState(8);
  const [difficulty, setDifficulty] = useState<"easier" | "same" | "harder">("same");
  const [style, setStyle] = useState("");
  const [figures, setFigures] = useState(true);
  const [pictures, setPictures] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const run = async () => {
    setErr(null); setBusy("Writing your exam — this takes a minute for a full paper…");
    try {
      const ids = await scopeNoteIds(scope);
      const excerpts = await corpusExcerpts(ids, 20000);
      if (!excerpts.length) { setErr("There's no readable text in that scope yet. Use “Read my handwriting” on the Search page, or import typed PDFs."); return; }
      const images = pictures ? await gatherPageImages(scope) : [];
      count("study.exam.generate");
      let exam = await generateExam({ excerpts, questions, difficulty, style, figures, images });
      if (images.length) exam = await resolveCrops(exam, images);
      onReady(exam);
    } catch (e) { setErr(e instanceof AiError ? e.message : "Something went wrong: " + (e as Error).message); logError("exam", e); } finally { setBusy(null); }
    void flash;
  };
  const sel = "mt-1 block w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground";
  return (
    <Modal title="Practice exam" onClose={onClose}>
      {!ai ? <p className="text-sm">Exam writing needs AI. Add your API key and switch it on in <button className="font-medium text-primary underline" onClick={() => go({ name: "settings" })}>Settings</button>.</p> : (
        <div className="space-y-4">
          <Field label="Based on"><ScopeSelect value={scope} onChange={setScope} notes={notes} notebooks={notebooks} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Questions"><select value={questions} onChange={(e) => setQuestions(Number(e.target.value))} className={sel}>{[5, 8, 12, 16].map((n) => <option key={n}>{n}</option>)}</select></Field>
            <Field label="Difficulty"><select value={difficulty} onChange={(e) => setDifficulty(e.target.value as typeof difficulty)} className={sel}><option value="easier">Gentler</option><option value="same">Like a real exam</option><option value="harder">Harder</option></select></Field>
          </div>
          <Field label="Style (optional)">
            <input list="exam-styles" value={style} onChange={(e) => setStyle(e.target.value)} placeholder="e.g. AP Physics 1, university chemistry midterm" className={sel} />
            <datalist id="exam-styles">{STYLES.filter(Boolean).map((s) => <option key={s} value={s} />)}</datalist>
          </Field>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={figures} onChange={(e) => setFigures(e.target.checked)} /><span><b>Lots of figures</b> — graphs, data tables, charts and diagrams to read and calculate from</span></label>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={pictures} onChange={(e) => setPictures(e.target.checked)} /><span><b>Use pictures from my notes</b> — slides and diagrams from your PDFs can appear in questions <span className="text-foreground-muted">(sends a few page images; costs more)</span></span></label>
          <p className="text-xs text-foreground-muted">Typical cost {formatUsd(estimateUsd("exam", questions / 8, getSettings()) + (pictures ? estimateUsd("review", 4, getSettings()) : 0))} to write, plus about {formatUsd(estimateUsd("exam.mark", 2, getSettings()))} to mark the written answers.</p>
          {err && <p className="text-sm text-negative">{err}</p>}
          <Button variant="primary" onClick={run}><Sparkles size={14} /> Write my exam</Button>
        </div>
      )}
    </Modal>
  );
}

function StudySettings({ progress, onClose, onChange }: { progress: Progress; onClose: () => void; onChange: (p: Progress) => void }) {
  return (
    <Modal title="Study settings" onClose={onClose}>
      <div className="space-y-4 text-sm">
        <Field label="Daily goal (XP)">
          <select value={progress.goal} onChange={(e) => onChange({ ...progress, goal: Number(e.target.value) })} className="mt-1 block w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground">
            {[10, 20, 30, 50, 80].map((g) => <option key={g} value={g}>{g} XP — {g === 10 ? "easy" : g === 20 ? "casual" : g === 30 ? "regular" : g === 50 ? "serious" : "intense"}</option>)}
          </select>
        </Field>
        <label className="flex items-center gap-2"><input type="checkbox" checked={progress.sound} onChange={(e) => onChange({ ...progress, sound: e.target.checked })} /> Sound effects</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={progress.hearts} onChange={(e) => onChange({ ...progress, hearts: e.target.checked })} /> Hearts in lessons (5 mistakes ends the lesson — turn off to practise freely)</label>
        <p className="text-xs text-foreground-muted">Lesson XP: 5 per exercise you get right first time, plus combo and finishing bonuses.</p>
      </div>
    </Modal>
  );
}

export { shuffle };
