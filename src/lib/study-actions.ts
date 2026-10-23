// Glue between notes, the AI helpers and the study database: building card decks from
// notes, gathering page pictures for exams, turning mistakes into cards.
import { getPageTexts, listNotes, type MistakeRec } from "./db";
import { corpusExcerpts } from "./search";
import { renderNotePages } from "./export";
import { loadExportNote } from "./note-io";
import { cardsFromImage, cardsFromText, generateCards, type RawCard } from "./ai-study";
import { listCards, putCards } from "./study-db";
import { dedupeCards, makeCard, type Card } from "./study-core";
import { newId } from "./ids";
import type { Exam } from "./exam-core";
import type { Figure } from "./figure-core";
import type { Excerpt } from "./ai";
import { count } from "./telemetry";
import { hashString } from "./ai-cache";
import { getMeta, setMeta } from "./db";

const CARDS_SRC = "cards:src";

/** "all", "nb:<id>" or "note:<id>" → note ids (null = everything). */
export async function scopeNoteIds(scope: string): Promise<string[] | null> {
  if (scope === "all") return null;
  const notes = await listNotes();
  if (scope.startsWith("nb:")) return notes.filter((n) => n.notebookId === scope.slice(3)).map((n) => n.id);
  return [scope.slice(5)];
}

export async function toCards(raws: RawCard[], ctx: { notebookId: string | null; noteId?: string; page?: number; source: Card["source"]; excerpts?: Excerpt[] }): Promise<Card[]> {
  const notes = await listNotes();
  const nbOf = new Map(notes.map((n) => [n.id, n.notebookId]));
  const now = Date.now();
  return raws.map((r, i) => {
    const ex = r.src ? ctx.excerpts?.find((e) => e.n === r.src) : undefined;
    const noteId = ex?.noteId ?? ctx.noteId;
    return {
      ...makeCard({ front: r.front, back: r.back }, now + i),
      id: newId(), kind: r.kind, steps: r.steps, topic: r.topic, hint: r.hint, source: ctx.source, distractors: r.wrong,
      noteId, page: ex?.page ?? ctx.page, notebookId: (noteId ? nbOf.get(noteId) : undefined) ?? ctx.notebookId,
    } as Card;
  });
}

/** Read a scope of notes and add new flashcards. Returns how many were added. */
/**
 * Pages are only sent to the AI if cards haven't already been made from their CURRENT text — re-running "make
 * cards" on the same notes would otherwise pay again for pages that can only produce duplicates.
 */
export async function makeCardsFromNotes(scope: string, want: number, includeDone = false): Promise<{ added: number; sources: number; skipped: number }> {
  const ids = await scopeNoteIds(scope);
  const pool = await corpusExcerpts(ids, 400_000);
  if (!pool.length) return { added: 0, sources: 0, skipped: 0 };
  const done = (await getMeta<Record<string, string>>(CARDS_SRC)) ?? {};
  const keyOf = (e: Excerpt) => `${e.noteId}:${e.page}`;
  const fresh = includeDone ? pool : pool.filter((e) => done[keyOf(e)] !== hashString(e.text));
  const skipped = pool.length - fresh.length;
  if (!fresh.length) return { added: 0, sources: 0, skipped };
  // fit the request budget, renumbering so the model's source numbers match what we send
  const excerpts: Excerpt[] = [];
  let used = 0;
  for (const e of fresh) { if (used + e.text.length > 22000) break; used += e.text.length; excerpts.push({ ...e, n: excerpts.length + 1 }); }
  count("study.cards.generate");
  const raws = await generateCards(excerpts, want);
  const cards = dedupeCards(await toCards(raws, { notebookId: null, source: "ai", excerpts }), await listCards());
  await putCards(cards);
  for (const e of excerpts) done[keyOf(e)] = hashString(e.text);
  await setMeta(CARDS_SRC, done);
  return { added: cards.length, sources: excerpts.length, skipped };
}

export async function makeCardsFromRegion(dataUrl: string, ctx: { notebookId: string | null; noteId: string; page: number }): Promise<number> {
  count("study.cards.region");
  const fresh = dedupeCards(await toCards(await cardsFromImage(dataUrl), { ...ctx, source: "lasso" }), await listCards());
  await putCards(fresh);
  return fresh.length;
}

export async function makeCardsFromExplanation(title: string, body: string, ctx: { notebookId: string | null; noteId: string; page: number }): Promise<number> {
  count("study.cards.explain");
  const fresh = dedupeCards(await toCards(await cardsFromText(title, body), { ...ctx, source: "explain" }), await listCards());
  await putCards(fresh);
  return fresh.length;
}

/** A "spot the error" card for a mistake (no AI needed). */
export function cardFromMistake(m: Pick<MistakeRec, "read" | "problem" | "fix" | "why" | "noteId" | "page" | "kind">, notebookId: string | null): Card {
  const front = m.read ? `Spot the mistake: ${m.read.startsWith("$") ? m.read : m.read}` : `Mistake to avoid (${m.kind})`;
  const back = [m.problem, m.fix ? `Instead: ${m.fix}` : ""].filter(Boolean).join(" ");
  return { ...makeCard({ front, back }), id: newId(), source: "mistake", noteId: m.noteId, page: m.page, notebookId, topic: "My mistakes" } as Card;
}

// --- exam pictures -------------------------------------------------------------------------------------------------------------
/** A few page pictures (slides, diagrams) the exam writer can crop figures from. */
export async function gatherPageImages(scope: string, max = 5): Promise<{ label: string; dataUrl: string }[]> {
  const ids = await scopeNoteIds(scope);
  const [notes, texts] = await Promise.all([listNotes(), getPageTexts()]);
  const withPics = notes.filter((n) => n.imageCount > 0 && (ids === null || ids.includes(n.id)));
  const out: { label: string; dataUrl: string }[] = [];
  for (const n of withPics) {
    if (out.length >= max) break;
    // prefer pages with little text (likely diagrams), spread across the document
    const pages = texts.filter((t) => t.noteId === n.id && t.source === "pdf").sort((a, b) => a.text.length - b.text.length).slice(0, 2).map((t) => t.page);
    const chosen = pages.length ? pages : [0];
    const l = await loadExportNote(n.id);
    if (!l) continue;
    try {
      const imgs = await renderNotePages(l.note, { pages: chosen.slice(0, max - out.length), mime: "image/jpeg", quality: 0.78, scale: 0.9 });
      imgs.forEach((im, k) => out.push({ label: `${out.length + 1} (${n.title}, page ${chosen[k] + 1})`, dataUrl: im.dataUrl }));
    } finally { l.release(); }
  }
  return out;
}

function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error("image")); im.src = src; });
}

/** Cut the crop figures out of the page pictures; figures whose picture is missing are dropped. */
export async function resolveCrops(exam: Exam, images: { label: string; dataUrl: string }[]): Promise<Exam> {
  const cut = async (f: Figure | undefined): Promise<Figure | undefined> => {
    if (!f || f.type !== "crop") return f;
    const src = images[f.image - 1];
    if (!src) return undefined;
    try {
      const im = await loadImg(src.dataUrl);
      const [x, y, w, h] = f.bbox;
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(im.naturalWidth * w)); c.height = Math.max(1, Math.round(im.naturalHeight * h));
      c.getContext("2d")!.drawImage(im, im.naturalWidth * x, im.naturalHeight * y, c.width, c.height, 0, 0, c.width, c.height);
      return { ...f, src: c.toDataURL("image/jpeg", 0.85) };
    } catch { return undefined; }
  };
  const sections = [];
  for (const s of exam.sections) {
    const questions = [];
    for (const q of s.questions) questions.push({ ...q, figure: await cut(q.figure), parts: await Promise.all(q.parts.map(async (p) => ({ ...p, figure: await cut(p.figure) }))) });
    sections.push({ ...s, questions });
  }
  return { ...exam, sections };
}
