// Past exams (e.g. MIT OpenCourseWare) as FORMAT examples for the exam writer. Picking which one to show is done
// on the device (word overlap with the notes, no AI): the closest exam for the course, trimmed to whole pages
// within a budget, with OCW boilerplate removed. The writer copies its format, never its questions.
import { tokens } from "./related.ts";

export type PastExam = { id: string; title: string; pages: string[] };
export type StyleExample = { id: string; title: string; text: string };

const BOILERPLATE = /ocw\.mit\.edu|opencourseware|terms of use|for information about citing these materials|creative commons|massachusetts institute of technology/i;

/** One exam's text, cleaned: boilerplate lines dropped, whole pages kept until the budget runs out. */
export function examText(pages: string[], maxChars: number): string {
  const clean = pages.map((p) => p.split("\n").filter((l) => !BOILERPLATE.test(l)).join("\n").trim()).filter(Boolean);
  let out = "";
  for (const [i, p] of clean.entries()) {
    const piece = `${i ? "\n\n--- page break ---\n\n" : ""}${p}`;
    if (out.length + piece.length > maxChars) {
      if (!out) out = p.slice(0, maxChars);   // one long page: keep its start
      break;
    }
    out += piece;
  }
  return out;
}

function vec(text: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of tokens(text)) m.set(t, (m.get(t) ?? 0) + 1);
  return m;
}
function cosine(a: Map<string, number>, b: Map<string, number>, idf: (t: string) => number): number {
  let dot = 0, na = 0, nb = 0;
  for (const [t, v] of a) { const w = v * idf(t); na += w * w; const u = b.get(t); if (u) dot += w * u * idf(t); }
  for (const [t, v] of b) { const w = v * idf(t); nb += w * w; }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/**
 * The past exam(s) to show the writer for these notes. `chosen` forces one exam; otherwise the closest by topic,
 * plus a second if the first is short. Returns [] when there are no past exams.
 */
export function pickPastExams(notes: string[], exams: PastExam[], maxChars = 9000, chosen?: string): StyleExample[] {
  const usable = exams.filter((e) => e.pages.some((p) => p.trim().length > 40));
  if (!usable.length) return [];
  const forced = chosen ? usable.find((e) => e.id === chosen) : undefined;
  if (chosen && forced) return [{ id: forced.id, title: forced.title, text: examText(forced.pages, maxChars) }];
  const docs = usable.map((e) => vec(e.pages.join("\n")));
  const df = new Map<string, number>();
  for (const d of docs) for (const t of d.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  const idf = (t: string) => Math.log(1 + (docs.length + 1) / ((df.get(t) ?? 0) + 1));
  const q = vec(notes.join("\n"));
  const ranked = usable.map((e, i) => ({ e, s: cosine(q, docs[i], idf) })).sort((a, b) => b.s - a.s);
  const out: StyleExample[] = [];
  let left = maxChars;
  for (const { e } of ranked.slice(0, 2)) {
    if (left < 1500) break;
    const text = examText(e.pages, left);
    out.push({ id: e.id, title: e.title, text });
    left -= text.length;
    if (left < maxChars * 0.4) break;   // the first one already fills most of the budget
  }
  return out;
}
