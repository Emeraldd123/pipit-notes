// Persistence for the study side: flashcards, mistake log, saved exams, XP/streak.
import { db, getMeta, setMeta, type ExamAttempt, type ExamRec, type MistakeRec } from "./db";
import { newProgress, type Card, type Progress } from "./study-core";
import type { Exam } from "./exam-core";
import type { ConceptMap } from "./map-core";
import { newId } from "./ids";

// --- cards -----------------------------------------------------------------------------------------------------
export async function listCards(): Promise<Card[]> {
  return (await (await db()).getAll("cards")).sort((a, b) => a.createdAt - b.createdAt);
}
export async function putCards(cards: Card[]): Promise<void> {
  if (!cards.length) return;
  const d = await db();
  const tx = d.transaction("cards", "readwrite");
  for (const c of cards) tx.store.put(c);
  await tx.done;
}
export async function deleteCard(id: string): Promise<void> {
  await (await db()).delete("cards", id);
}

// --- mistakes ----------------------------------------------------------------------------------------------------
export async function listMistakes(): Promise<MistakeRec[]> {
  return (await (await db()).getAll("mistakes")).sort((a, b) => b.createdAt - a.createdAt);
}
export async function addMistakes(items: Omit<MistakeRec, "id" | "createdAt">[]): Promise<MistakeRec[]> {
  const d = await db();
  const existing = await d.getAll("mistakes");
  const key = (m: { noteId: string; page: number; problem: string }) => `${m.noteId}|${m.page}|${m.problem.toLowerCase().slice(0, 80)}`;
  const seen = new Set(existing.map(key));
  const out: MistakeRec[] = [];
  const tx = d.transaction("mistakes", "readwrite");
  for (const it of items) {
    if (seen.has(key(it))) continue;           // reviewing the same page twice shouldn't pile up duplicates
    seen.add(key(it));
    const rec: MistakeRec = { ...it, id: newId(), createdAt: Date.now() };
    tx.store.put(rec);
    out.push(rec);
  }
  await tx.done;
  return out;
}
export async function patchMistake(id: string, patch: Partial<MistakeRec>): Promise<void> {
  const d = await db();
  const m = await d.get("mistakes", id);
  if (m) await d.put("mistakes", { ...m, ...patch });
}
export async function deleteMistake(id: string): Promise<void> {
  await (await db()).delete("mistakes", id);
}

// --- exams ---------------------------------------------------------------------------------------------------------
export async function listExams(): Promise<ExamRec[]> {
  return (await (await db()).getAll("exams")).sort((a, b) => b.updatedAt - a.updatedAt);
}
export async function saveExam(exam: Exam): Promise<ExamRec> {
  const d = await db();
  const rec: ExamRec = (await d.get("exams", exam.id)) ?? { id: exam.id, exam, attempts: [], createdAt: Date.now(), updatedAt: Date.now() };
  await d.put("exams", rec);
  return rec;
}
export async function addAttempt(examId: string, attempt: ExamAttempt): Promise<void> {
  const d = await db();
  const rec = await d.get("exams", examId);
  if (!rec) return;
  await d.put("exams", { ...rec, attempts: [attempt, ...rec.attempts].slice(0, 8), updatedAt: Date.now() });
}
/** Save changes to an exam itself (e.g. questions reported as broken), keeping its attempts. */
export async function updateExamDef(exam: Exam): Promise<void> {
  const d = await db();
  const rec = await d.get("exams", exam.id);
  if (rec) await d.put("exams", { ...rec, exam, updatedAt: Date.now() });
}
/** Re-score the most recent attempt (after a question was reported on the results screen). */
export async function rescoreLatestAttempt(examId: string, result: ExamAttempt["result"]): Promise<void> {
  const d = await db();
  const rec = await d.get("exams", examId);
  if (rec?.attempts.length) await d.put("exams", { ...rec, attempts: [{ ...rec.attempts[0], result }, ...rec.attempts.slice(1)] });
}
export async function deleteExam(id: string): Promise<void> {
  await (await db()).delete("exams", id);
}

// --- progress (XP, streak, goal, settings) ---------------------------------------------------------------------------
export async function getProgress(): Promise<Progress> {
  return { ...newProgress(), ...((await getMeta<Progress>("study:progress")) ?? {}) };
}
export async function putProgress(p: Progress): Promise<void> {
  await setMeta("study:progress", p);
}

// --- concept maps -----------------------------------------------------------------------------------------------------
export type ResetWhat = { cards: boolean; exams: boolean; mistakes: boolean; progress: boolean; maps: boolean };
/**
 * Clear study data on this device (notes are never touched). Clearing cards also forgets which pages cards
 * were already made from, so "Make flashcards" reads those pages again.
 */
export async function resetStudyData(what: ResetWhat): Promise<void> {
  const d = await db();
  const stores = (["cards", "exams", "mistakes", "maps"] as const).filter((s) => what[s]);
  const names: ("cards" | "exams" | "mistakes" | "maps" | "meta")[] = [...stores, "meta"];
  const tx = d.transaction(names, "readwrite");
  for (const s of stores) await tx.objectStore(s).clear();
  if (what.cards) await tx.objectStore("meta").delete("cards:src");
  if (what.progress) await tx.objectStore("meta").delete("study:progress");
  await tx.done;
}

export async function listMaps(): Promise<ConceptMap[]> {
  return (await (await db()).getAll("maps")).sort((a, b) => b.updatedAt - a.updatedAt);
}
export async function putMap(m: ConceptMap): Promise<void> {
  await (await db()).put("maps", { ...m, updatedAt: Date.now() });
}
export async function deleteMap(id: string): Promise<void> {
  await (await db()).delete("maps", id);
}
