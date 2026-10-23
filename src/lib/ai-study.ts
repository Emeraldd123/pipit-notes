// AI prompts for studying: flashcards, realistic exams (with figures) and marking.
// The model writes structured JSON; everything it returns is validated locally
// (exam-core / figure-core) before it is shown or marked.
import { AiError, claude, extractJson, imageBlock, text, type Content, type Excerpt } from "./ai";
import { normalizeExam, needsAi, type Exam, type Part, type PartAnswer, type PartMark, type Question } from "./exam-core";
import type { CardKind } from "./study-core";

// How a real teacher builds wrong options (item-writing guidance: distractors come from students' typical errors).
// Used for flashcards and exam multiple choice.
export const DISTRACTOR_RULES =
  "Wrong options must be written the way a strict teacher writes them, from REAL student mistakes, never filler: " +
  "(1) a NEAR MISS — what a student who studied gets with one small slip in concept or application (sign error, forgot to convert units, swapped two related terms, applied the right rule to the wrong quantity, off by a factor of 2, confused cause and effect); " +
  "(2) a PARTLY RIGHT option — right idea, wrong detail; " +
  "(3) a WEAK option — plausible to someone who didn't study, but clearly wrong to anyone who did. " +
  "Every option is the same kind of thing as the answer (a value with the same units, a term of the same category, a statement of the same length and grammar), so none can be eliminated without knowing the material. " +
  "No 'all of the above' / 'none of the above', no joke options, no absolutes ('always', 'never') used only in the wrong options, and the correct option must not be the longest or most detailed one. " +
  "Each wrong option must be unambiguously wrong — if it could be argued right, rewrite it.";

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

// --- exam generation ----------------------------------------------------------------------------------------------------
export type ExamSpec = {
  excerpts: Excerpt[];
  questions: number;                 // target number of numbered questions
  difficulty: "easier" | "same" | "harder";
  style: string;                     // e.g. "AP Physics", "university midterm", "IB Chemistry"
  figures: boolean;                  // lean heavily on graphs/diagrams/data
  images?: { label: string; dataUrl: string }[]; // page images the model may crop figures from
};

const FIGURE_DOC = `
FIGURES (drawn by the app from your JSON — they must be CORRECT and must match the question):
- Graph of functions: {"type":"graph","title":"...","xLabel":"t (s)","yLabel":"v (m/s)","x":[0,10],"y":[0,40],"curves":[{"expr":"3x^2 + 2x","label":"v(t)"}],"points":[{"x":2,"y":16,"label":"P"}],"vlines":[{"x":4,"label":"t = 4"}],"hlines":[{"y":10}],"shade":{"expr":"3x^2","from":1,"to":3}}
  "expr" is a function of x ONLY (use ^ * / sin cos tan sqrt ln exp abs pi). Straight lines, parabolas, exponentials, trig etc. all work. "y" is optional. For a data graph of measured points use "points" with no curve, or a curve through them.
- Chart: {"type":"chart","kind":"bar|line|scatter|pie","title":"...","xLabel":"...","yLabel":"...","categories":["Mon","Tue"],"series":[{"name":"Group A","values":[3,5]}]} (scatter uses "points":[{"x":1,"y":2}] instead of "values")
- Data table: {"type":"table","headers":["Trial","Time (s)"],"rows":[[1,2.31],[2,2.28]]}
- Diagram on a width×height canvas (y grows DOWNWARD): {"type":"diagram","width":400,"height":260,"elements":[{"t":"line","x1":20,"y1":200,"x2":380,"y2":200,"label":"ground"},{"t":"rect","x":150,"y":150,"w":60,"h":50,"label":"m"},{"t":"line","x1":180,"y1":150,"x2":180,"y2":80,"arrow":true,"label":"N"},{"t":"circle","cx":100,"cy":100,"r":30},{"t":"poly","points":[[20,200],[120,200],[20,120]]},{"t":"point","x":60,"y":60,"label":"A"},{"t":"arc","cx":20,"cy":200,"r":30,"from":0,"to":37,"label":"θ"},{"t":"text","x":200,"y":30,"text":"label"}]}
  Use diagrams for geometry (triangles with side labels, circles with chords), free-body diagrams (arrows), ramps and pulleys, circuits (lines/rects/circles), ray diagrams, cell/organ sketches, energy-level or reaction-coordinate sketches. Keep labels short.
- Pictures from the student's own pages (only if images are attached): {"type":"crop","image":2,"bbox":[0.1,0.25,0.8,0.4]} where image is the attached image number and bbox is [x,y,width,height] as fractions of that image. Crop only a clear diagram, graph or figure — never plain text.
A question or an individual part may carry a "figure". Put the figure on the question when all parts use it.`;

const EXAM_SYSTEM = `You are an experienced examiner writing a REALISTIC exam paper for a student, in the style of official past papers (AP, IB, A-level, university midterms), based on the notes provided.
Make it feel like a real paper, not a quiz:
- Mostly structured, multi-part questions with a shared stem: (a) recall/define, (b) calculate or read a value, (c) explain or apply, (d) combine two ideas. Marks per part reflect effort (1–6).
- Use data and visuals wherever the subject allows: tables of experimental results, graphs to read or interpret, diagrams to label or calculate from, charts to compare. Questions must REQUIRE the figure ("Using the graph…", "From the table…") — never put a figure in just for decoration.
- Include a short multiple-choice section (4 options, exactly one correct) with some figure-based items, a short-answer/structured section, and 1–2 extended or applied questions that combine several ideas from different parts of the notes.
- Numbers must be consistent: every answer you give must be derivable from the stem and figure. Double-check arithmetic and read values off the plotted functions exactly.
- Stay within what the notes cover (you may apply it to new scenarios). Use LaTeX in $...$ for maths and chemistry, and in the JSON write every LaTeX backslash DOUBLED (\\\\Delta, \\\\frac) so the JSON stays valid.
- Be economical: keep stems tight and each model answer and marking-scheme point to a line, so the WHOLE exam fits comfortably in one reply (never stop mid-way).
- Multiple choice and true/false must feel like a real, strict paper. ${DISTRACTOR_RULES} For a 4-option item: one correct, one near miss, one partly right, one weak. For numeric options, every wrong value must come from a specific error (name it in "why"). True/false statements that are false must be near misses, not obviously silly. Give every mcq part "why": one short reason per option in the same order (why it is right, or exactly which mistake leads to it).
- Each part has: "type" ("mcq" | "numeric" | "short" | "working" | "tf"), "marks", "prompt", the model "answer", and a marking "scheme" (an array of the points that earn marks). mcq parts add "options" and "correct" (index from 0). numeric parts add "numeric":{"value":12.5,"tol":0.02,"unit":"m/s"} — tol is relative (0.02 = 2%). "working" = show-your-working or extended response. A one-part question may put these fields on the question itself.
${FIGURE_DOC}
Return STRICT JSON only:
{"title":"...","subject":"...","durationMin":60,"instructions":"...","sections":[{"title":"Section A — Multiple choice","instructions":"...","questions":[{"topic":"short topic name","stem":"...","figure":{...},"parts":[{"label":"a","type":"numeric","marks":2,"prompt":"...","answer":"...","numeric":{...},"scheme":["..."]}]}]}]}`;

export async function generateExam(spec: ExamSpec): Promise<Exam> {
  const ctx = spec.excerpts.map((e) => `[${e.n}] ${e.noteTitle} — page ${e.page + 1}\n${e.text}`).join("\n\n");
  const content: Content[] = [];
  for (const im of spec.images ?? []) { content.push(text(`Image ${im.label}:`), imageBlock(im.dataUrl)); }
  content.push(text(
    `Student's notes:\n\n${ctx}\n\nWrite an exam of about ${spec.questions} numbered questions in the style of: ${spec.style || "a typical course exam for this material"}. ` +
    `Difficulty: ${spec.difficulty === "harder" ? "harder than the notes' own examples" : spec.difficulty === "easier" ? "gentler than a real exam — good for a first attempt" : "like a real exam on this material"}. ` +
    (spec.figures ? "Lean heavily on figures, data and applied scenarios — at least half the questions should need one. " : "Include figures where they genuinely help. ") +
    (spec.images?.length ? "You may crop figures from the attached page images where one is clearly relevant. " : "")
  ));
  const raw = await claude({ feature: "exam", maxTokens: 16000, system: EXAM_SYSTEM, user: content });
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
