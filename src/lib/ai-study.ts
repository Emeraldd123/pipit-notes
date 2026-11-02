// AI prompts for studying: flashcards, realistic exams (with figures) and marking.
// The model writes structured JSON; everything it returns is validated locally
// (exam-core / figure-core) before it is shown or marked.
import { AiError, claude, extractJson, imageBlock, text, type Content, type Excerpt } from "./ai";
import { normalizeExam, needsAi, type Exam, type Part, type PartAnswer, type PartMark, type Question } from "./exam-core";
import type { CardKind } from "./study-core";
import { buildExamPrompt, DISTRACTOR_RULES, EXAM_MAX_TOKENS, type ExamSpec } from "./exam-prompt.ts";
export { CASE_RULES, DISTRACTOR_RULES, type ExamSpec } from "./exam-prompt.ts";

// --- flashcards -------------------------------------------------------------------------------------------------------
export type RawCard = { kind: CardKind; front: string; back: string; steps?: string[]; topic?: string; hint?: string; src?: number; wrong?: string[] };

const CARDS_SYSTEM =
  "You turn a student's own notes into high-quality flashcards for spaced repetition. Return STRICT JSON only: " +
  '{"cards":[{"kind":"basic|cloze|steps","front":"...","back":"...","wrong":["near miss","partly right","weak"],"steps":["..."],"topic":"...","hint":"...","src":1}]}. ' +
  "Rules: ONE idea per card; fronts are clear questions or prompts that make sense alone; backs are short (under ~15 words) so they can be typed or chosen from options. " +
  'Cover definitions, key facts, formulas ("What is the formula for…?"), cause/effect, and worked-problem TYPES (e.g. "How do you find the vertex of a parabola?"). ' +
  'Use kind "cloze" for fill-in-the-blank: front is a sentence with ____ where the answer goes, back is just the missing term. ' +
  'Use kind "steps" for ordered procedures of 3–7 steps: front asks for the order, "steps" lists them correctly, back is a one-line summary. ' +
  '"topic" is a short unit name (1–3 words) and MUST be reused consistently for related cards. "src" is the excerpt number the card came from. ' +
  "Every card must be ANSWERABLE on a tablet keyboard: the back must be plain words or a plain number (optionally with a unit), never something that needs special symbols " +
  "(²  √  ∆  ≥  →  subscripts, ratios like S²:V²). If the idea is a formula, ratio or expression, do NOT ask the student to type it — ask about its MEANING instead " +
  '(e.g. "What happens to the SA:V ratio as a cell gets bigger?" → "It decreases"), or ask for a value ("Surface area of a 2 cm cube?" → "24 cm²" is fine only as plain text like "24 cm2"). ' +
  "Each card needs ONE unambiguous answer that the notes actually give; skip questions that are open-ended, need a diagram, or that you could not mark as right or wrong. " +
  "Inside JSON strings write every LaTeX backslash DOUBLED (\\\\frac, \\\\Delta) so the JSON stays valid. Use LaTeX in $...$ for maths and chemistry in the displayed text only. " +
  "Never invent facts that are not supported by the notes; skip anything unclear. " +
  'For every "basic" and "cloze" card also write "wrong": exactly 3 wrong answers in this order — near miss, partly right, weak — used for multiple choice and true/false. ' +
  DISTRACTOR_RULES;

const cleanWrong = (w: unknown, back: string): string[] | undefined => {
  if (!Array.isArray(w)) return undefined;
  const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const seen = new Set([key(back)]);
  const out = w.filter((x): x is string => typeof x === "string").map((x) => x.trim().slice(0, 200))
    .filter((x) => x && !/\b(all|none) of the above\b/i.test(x) && !seen.has(key(x)) && (seen.add(key(x)), true)).slice(0, 3);
  return out.length ? out : undefined;
};

function toRawCards(raw: string): RawCard[] {
  const j = extractJson<{ cards?: RawCard[] }>(raw);
  const clean = (v: unknown, max = 400) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  return (Array.isArray(j.cards) ? j.cards : []).flatMap((c): RawCard[] => {
    const kind: CardKind = c?.kind === "cloze" || c?.kind === "steps" ? c.kind : "basic";
    const front = clean(c?.front), back = clean(c?.back, 300);
    const steps = Array.isArray(c?.steps) ? c.steps.map((s) => clean(s, 160)).filter(Boolean).slice(0, 8) : undefined;
    if (!front || (!back && kind !== "steps")) return [];
    if (kind === "steps" && (steps?.length ?? 0) < 3) return [];
    const wrong = kind === "steps" ? undefined : cleanWrong(c?.wrong, back);
    if (kind === "cloze" && !front.includes("__")) return [{ kind: "basic", front, back, wrong, topic: clean(c?.topic, 40) || undefined, hint: clean(c?.hint, 160) || undefined, src: typeof c?.src === "number" ? c.src : undefined }];
    return [{ kind, front, back: back || steps!.join(" → "), wrong, steps: kind === "steps" ? steps : undefined, topic: clean(c?.topic, 40) || undefined, hint: clean(c?.hint, 160) || undefined, src: typeof c?.src === "number" ? c.src : undefined }];
  });
}

export async function generateCards(excerpts: Excerpt[], want: number): Promise<RawCard[]> {
  const ctx = excerpts.map((e) => `[${e.n}] ${e.noteTitle} — page ${e.page + 1}\n${e.text}`).join("\n\n");
  const raw = await claude({
    feature: "cards", maxTokens: 6000, system: CARDS_SYSTEM,
    user: `Notes:\n\n${ctx}\n\nWrite about ${want} flashcards covering the most important material. Mix card kinds sensibly.`,
  });
  return toRawCards(raw);
}

/** Cards from a circled region of handwriting / a PDF slide (the model reads the image). */
export async function cardsFromImage(region: string): Promise<RawCard[]> {
  const raw = await claude({
    feature: "cards.region", maxTokens: 2500, system: CARDS_SYSTEM,
    user: [imageBlock(region), text("These are the student's notes. Write 2–6 flashcards from what is shown.")],
  });
  return toRawCards(raw);
}

export async function cardsFromText(title: string, body: string, want = 4): Promise<RawCard[]> {
  const raw = await claude({
    feature: "cards.text", maxTokens: 2500, system: CARDS_SYSTEM,
    user: `Notes:\n\n[1] ${title}\n${body.slice(0, 6000)}\n\nWrite ${want} flashcards from this.`,
  });
  return toRawCards(raw);
}

/** Wrong options for cards made before cards carried them. Returns one list per input card (empty = couldn't). */
export async function writeWrongOptions(cards: { front: string; back: string }[]): Promise<string[][]> {
  const list = cards.map((c, i) => `${i + 1}. Q: ${c.front}\n   A: ${c.back}`).join("\n");
  const raw = await claude({
    feature: "cards", maxTokens: 4000,
    system: 'You write the wrong options for a student\'s flashcards so they work as realistic multiple-choice questions. Return STRICT JSON only: {"items":[{"n":1,"wrong":["near miss","partly right","weak"]}]}. ' +
      "Exactly 3 wrong answers per card in that order. Inside JSON strings write every LaTeX backslash DOUBLED. " + DISTRACTOR_RULES,
    user: `Cards:\n${list}`,
  });
  const j = extractJson<{ items?: { n?: number; wrong?: unknown }[] }>(raw);
  const out: string[][] = cards.map(() => []);
  for (const it of Array.isArray(j.items) ? j.items : []) {
    const i = typeof it?.n === "number" ? it.n - 1 : -1;
    if (i >= 0 && i < cards.length) out[i] = cleanWrong(it.wrong, cards[i].back) ?? [];
  }
  return out;
}

// --- exam generation ----------------------------------------------------------------------------------------------------
export async function generateExam(spec: ExamSpec): Promise<Exam> {
  const { system, content } = buildExamPrompt(spec);
  const user: Content[] = content.map((c) => (c.type === "image" ? imageBlock(c.dataUrl) : text(c.text)));
  const raw = await claude({ feature: "exam", maxTokens: EXAM_MAX_TOKENS, system, user });
  const exam = normalizeExam(extractJson<unknown>(raw));
  if (!exam) throw new AiError("The model's exam couldn't be read. Try again (a smaller exam often helps).");
  return exam;
}

// --- marking ----------------------------------------------------------------------------------------------------------------
export type MarkItem = { q: Question; p: Part; a: PartAnswer | undefined };

const MARK_SYSTEM =
  "You are a fair, consistent examiner marking a student's answers. For each item you get the question, the model answer, the marking scheme and the maximum marks, then the student's answer " +
  "(typed text and/or a handwritten image). Award whole marks, following the scheme point by point; accept equivalent wording, correct alternative methods and correct working that ends in a wrong number " +
  "(award method marks). Don't award marks for things the student didn't write. If handwriting is unreadable, say so and award 0 for that part. " +
  'Return STRICT JSON only: {"marks":[{"id":"q1.0","marks":2,"feedback":"one or two sentences speaking to the student","missed":["scheme point they missed"]}]}. ' +
  "Feedback must say what earned or lost marks. Use LaTeX in $...$ for maths.";

/** Mark the free-text / working parts. Objective parts are marked locally (exam-core.markObjective). */
export async function markWithAi(items: MarkItem[]): Promise<PartMark[]> {
  const todo = items.filter((i) => needsAi(i.p));
  const out: PartMark[] = [];
  for (let k = 0; k < todo.length; k += 5) {
    const chunk = todo.slice(k, k + 5);
    const content: Content[] = [];
    for (const { q, p, a } of chunk) {
      const typed = a?.text?.trim();
      content.push(text(
        `ITEM ${p.id} (max ${p.marks} mark${p.marks === 1 ? "" : "s"})\nContext: ${q.stem}\nQuestion${p.label ? ` (${p.label})` : ""}: ${p.prompt || "(see context)"}\n` +
        `Model answer: ${p.answer}\nMarking scheme: ${p.scheme.length ? p.scheme.map((s, i) => `${i + 1}. ${s}`).join(" | ") : "(use the model answer)"}\n` +
        `Student's typed answer: ${typed ? typed : "(none)"}${a?.ink ? "\nStudent's handwritten answer is the next image:" : ""}`
      ));
      if (a?.ink) content.push(imageBlock(a.ink));
    }
    let parsed: { marks?: { id: string; marks: number; feedback?: string; missed?: string[] }[] } = {};
    try {
      parsed = extractJson(await claude({ feature: "exam.mark", maxTokens: 2500, system: MARK_SYSTEM, user: content }));
    } catch (e) {
      if (e instanceof AiError && /key|offline|Rate/i.test(e.message)) throw e;
    }
    for (const { p, a } of chunk) {
      const m = parsed.marks?.find((x) => x.id === p.id);
      const blank = !a?.text?.trim() && !a?.ink;
      out.push({
        partId: p.id, max: p.marks, auto: false,
        marks: blank ? 0 : m && Number.isFinite(m.marks) ? Math.max(0, Math.min(p.marks, Math.round(m.marks))) : 0,
        feedback: blank ? "No answer given." : m?.feedback?.slice(0, 400) || "I couldn't mark this one — compare with the model answer.",
        missed: m?.missed?.slice(0, 5),
      });
    }
  }
  return out;
}
