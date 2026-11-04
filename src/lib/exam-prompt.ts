// The exam writer's instructions, kept free of browser code so the evaluation tool (tools/exam-eval.mjs)
// sends exactly what the app sends.
import type { Excerpt } from "./ai.ts";
import { TUNED_RULES } from "./exam-tuned.ts";

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

export type ExamSpec = {
  excerpts: Excerpt[];
  questions: number;                 // target number of numbered questions
  difficulty: "easier" | "same" | "harder";
  style: string;                     // e.g. "AP Physics", "university midterm", "IB Chemistry"
  figures: boolean;                  // lean heavily on graphs/diagrams/data
  images?: { label: string; dataUrl: string }[]; // page images the model may crop figures from
  textbook?: Excerpt[];              // reference pages (numbered T1, T2…) the writer may adapt problems from
  cases?: boolean;                   // include case-study / applied-research questions (CASE_RULES)
  pastExams?: { title: string; text: string }[]; // real past exams from the course (e.g. MIT OCW), labelled E1, E2…: FORMAT only (STYLE_RULES)
  extraRules?: string;               // replaces the tuned house rules (the tuning loop uses this to try new ones)
};

// Matching a real course's exams: copy how the paper is built, never what it asks.
export const STYLE_RULES = `PAST EXAMS (labelled [E1], [E2]…) are real exams from this course. They are a FORMAT reference only: write a NEW paper on the student's notes that would look at home next to them.
Match, as closely as the notes allow:
- the overall shape: how many problems, sections or none, the total points and how points are split between problems and parts, the time allowed, and the cover instructions (what is allowed, how to show work);
- numbering and layout: "Problem 1", "1.", "(a)", "(i)"…, and whether parts build on each other or stand alone;
- the KIND of task: derivations, "show that…", estimations, proofs, numerical calculations with given constants, sketches, short conceptual explanations, multiple choice — in roughly the same proportions;
- the voice and wording: how setups are described, how much is given, whether constants and formulas are provided, how answers are requested ("in terms of…", "to two significant figures", "justify your answer");
- the difficulty and length of a typical part.
Never copy a past exam's questions, scenarios, data, figures or wording: every question must be new, and must test what the STUDENT'S NOTES teach (the past exam may cover topics the notes don't; skip those). If the past exam uses points, give each part's marks on the same scale. If it includes solutions, write your model answers and marking schemes in the same manner. Ignore page headers, footers and copyright lines. Where these rules conflict with the multiple-choice or section guidance above, follow the past exam's format instead (e.g. no multiple-choice section if the past exams have none).`;

// How real examiners test transfer: a principle from the course, applied to a situation the student hasn't seen.
// Subject-neutral on purpose: the model picks cases that fit the notes' subject.
export const CASE_RULES = `CASE-STUDY QUESTIONS (applied reasoning — the way strong real exams test understanding, not memory):
1. Start from a PRINCIPLE the notes clearly teach (a mechanism, law, model, rule, method, or relationship). Then choose a REAL, well-established situation where that principle decides the outcome but which the notes do not discuss: a classic experiment or study, a real-world application or failure, a perturbation of a system (block, remove, add, double, reverse or speed up one step), an anomaly or exception, an engineering/clinical/economic/historical/environmental case, or a real-looking dataset.
2. The stem GIVES every new fact the student needs (what the agent/policy/defect/change does, the setup, the data) but NOT its consequence. The student must DERIVE the consequence from the principle. Knowing the case by name must give no advantage; not knowing it must cost nothing. Briefly define any term the notes don't use, and never hint at the answer in the setup (no "…which stops the gradient" when the gradient is what is asked about).
3. Ask what an examiner asks about a case: predict the effect (including knock-on effects one or two steps away, and which quantities rise, fall or stay the same), explain an observation, interpret data or a graph, evaluate a claim, identify a control or a flaw in a method, or say which result would support or refute a hypothesis.
4. A case question must need at least one reasoning step BEYOND restating the principle: a knock-on effect, a calculation with the case's data, a comparison, or a conclusion about the case. "Name the rule that applies" alone is not a case question. Prefer the non-obvious-but-well-known consequence, the thing a good teacher would put on a test precisely because the notes leave it for the student to work out. Avoid trivia, open research questions, and anything experts still dispute: there must be ONE defensible answer.
5. Be truthful about the real world. Only use cases, agents and findings that are well established. Never invent a named study, author, date or statistic; if you need numbers you are not sure of, present them as "a student's results" or "a hypothetical dataset" and keep them physically/biologically/economically realistic.
6. Scaffold multi-part case questions the way real papers do: an early part has the student identify or state the relevant principle, then apply it to the case, then extend it (a knock-on effect, a calculation from the data, an evaluation, or a second change). Single-part and multiple-choice cases are fine too.
7. Vary the KIND of case across the paper (e.g. one perturbation, one dataset or experiment to interpret, one real-world application or claim to evaluate). Never make every case "what happens if X is blocked/removed".
8. For multiple-choice cases, the wrong options are the results of plausible WRONG REASONING: stopping one step short, getting the direction of a knock-on effect backwards, applying a related but wrong principle, or confusing what changes with what stays the same.
9. The model answer and marking scheme reason FROM the principle step by step (the chain of cause and effect), so a student who missed it can see how it follows from what they learned.
Mark each such question with "basis": {"notes":[excerpt numbers that teach the principle],"textbook":null,"solvable":"yes","kind":"case","principle":"the idea from the notes it applies, in under 15 words"}. A case question without a principle from the notes must not be written.`;

const TEXTBOOK_RULES = `TEXTBOOK PAGES (labelled [T1], [T2]…) are reference material, NOT the student's notes. You may adapt problems, data and worked examples from them — real textbook questions make the paper more authentic — but ONLY when the student could solve the question using what their own notes cover.
Before using a textbook problem, check: does every concept, formula, definition and method the solution needs appear in the student's notes? If the notes don't teach it, don't use it, and never ask about textbook material the notes never mention.
Every question carries "basis": {"notes":[the note excerpt numbers whose content is needed to solve it],"textbook":"T2" or null,"solvable":"yes" | "stretch" | "no"} — "stretch" = solvable from the notes but needs a step the notes only hint at; never write a "no" question.`;

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
- Don't copy the notes' own worked examples: change the numbers, the situation or what is asked. Keep pure recall to short 1–2 mark parts, ideally inside a context, and make most marks come from using the idea.
- Numbers must be consistent: every answer you give must be derivable from the stem and figure. Double-check arithmetic and read values off the plotted functions exactly.
- Never refer to a table, graph, diagram or data ("below", "as shown", "the table", "the graph") unless that figure is attached to the same question or part, and put EVERY value an answer depends on in the stem or the figure. Describe a circuit or setup fully in words if it has no diagram.
- When a calculation has competing conventions (simple vs midpoint percentage change, g = 9.8 or 10, significant figures, one- or two-sided, rounding), say which one to use.
- Test only the principles, methods and facts the notes teach — but you may apply them to situations, data and examples the notes never mention (that is what real exams do). Never require knowledge the notes don't give or the question doesn't supply. Use LaTeX in $...$ for maths and chemistry, and in the JSON write every LaTeX backslash DOUBLED (\\\\Delta, \\\\frac) so the JSON stays valid.
- Before you finish, check every causal claim in your answers ("because", "so", "this causes"): it must be the actual mechanism, not a plausible-sounding one. If unsure, ask about something else.
- Be economical: keep stems tight and each model answer and marking-scheme point to a line, so the WHOLE exam fits comfortably in one reply (never stop mid-way).
- Multiple choice and true/false must feel like a real, strict paper. ${DISTRACTOR_RULES} For a 4-option item: one correct, one near miss, one partly right, one weak. For numeric options, compute every wrong value by actually making one specific student error (forgetting a term, using the wrong formula, a unit slip, the inverse, stopping a step early) and name it in "why" — never round numbers chosen for being nearby. True/false statements that are false must be near misses, not obviously silly. Give every mcq part "why": one short reason per option in the same order (why it is right, or exactly which mistake leads to it).
- Each part has: "type" ("mcq" | "numeric" | "short" | "working" | "tf"), "marks", "prompt", the model "answer", and a marking "scheme" (an array of the points that earn marks: one point per mark, each specific enough that two examiners would agree). mcq parts add "options" and "correct" (index from 0); for mcq the "answer" is the correct option's TEXT plus a short reason, never a letter (the app re-orders options), and the scheme never says "option A". numeric parts add "numeric":{"value":12.5,"tol":0.02,"unit":"m/s"} — tol is relative (0.02 = 2%). "working" = show-your-working or extended response. A one-part question may put these fields on the question itself.
${FIGURE_DOC}
Return STRICT JSON only:
{"title":"...","subject":"...","durationMin":60,"instructions":"...","sections":[{"title":"Section A — Multiple choice","instructions":"...","questions":[{"topic":"short topic name","basis":{"notes":[1,3],"textbook":null,"solvable":"yes"},"stem":"...","figure":{...},"parts":[{"label":"a","type":"numeric","marks":2,"prompt":"...","answer":"...","numeric":{...},"scheme":["..."]}]}]}]}`;


export const EXAM_MAX_TOKENS = 16000;
export type PromptBlock = { type: "text"; text: string } | { type: "image"; dataUrl: string };

/** The exact system prompt and user content the app sends to write an exam (shared with tools/exam-eval.mjs). */
export function buildExamPrompt(spec: ExamSpec): { system: string; content: PromptBlock[] } {
  const ctx = spec.excerpts.map((e) => `[${e.n}] ${e.noteTitle} — page ${e.page + 1}\n${e.text}`).join("\n\n");
  const past = spec.pastExams?.length ? `\n\nPast exams from this course (FORMAT reference only, see PAST EXAMS rules):\n\n${spec.pastExams.map((e, i) => `[E${i + 1}] ${e.title}\n${e.text}`).join("\n\n")}` : "";
  const book = spec.textbook?.length ? `\n\nTextbook pages (reference only):\n\n${spec.textbook.map((e, i) => `[T${i + 1}] ${e.noteTitle} — page ${e.page + 1}\n${e.text}`).join("\n\n")}` : "";
  const content: PromptBlock[] = [];
  for (const im of spec.images ?? []) content.push({ type: "text", text: `Image ${im.label}:` }, { type: "image", dataUrl: im.dataUrl });
  content.push({ type: "text", text:
    `Student's notes:\n\n${ctx}${book}${past}\n\nWrite an exam of about ${spec.questions} numbered questions${past ? " (or fewer, longer multi-part problems if that is how the past exams are built)" : ""} in the style of: ${past ? "the past exams [E1]" + (spec.pastExams!.length > 1 ? "–[E" + spec.pastExams!.length + "]" : "") + (spec.style ? ` (${spec.style})` : "") : spec.style || "a typical course exam for this material"}. ` +
    `Difficulty: ${spec.difficulty === "harder" ? "harder than the notes' own examples" : spec.difficulty === "easier" ? "gentler than a real exam — good for a first attempt" : "like a real exam on this material"}. ` +
    (spec.figures ? "Lean heavily on figures, data and applied scenarios — at least half the questions should need one. " : "Include figures where they genuinely help. ") +
    (spec.images?.length ? "You may crop figures from the attached page images where one is clearly relevant. " : "") +
    (spec.cases ? `Make exactly ${Math.max(1, Math.round(spec.questions / 3))} of the ${spec.questions} questions CASE-STUDY questions (including most extended ones and at least one multiple choice), following the CASE-STUDY rules and using cases that fit this subject; the rest test the notes directly. ` : "") +
    (book ? "Take or adapt roughly a third of the questions from the textbook pages, following the TEXTBOOK PAGES rules. " : ""),
  });
  const house = (spec.extraRules ?? TUNED_RULES).trim();
  const system = [EXAM_SYSTEM, spec.cases ? CASE_RULES : "", book ? TEXTBOOK_RULES : "", past ? STYLE_RULES : "",
    house ? `HOUSE RULES (learned from strict reviews of earlier papers; follow them too):\n${house}` : ""].filter(Boolean).join("\n");
  return { system, content };
}
