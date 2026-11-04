// AI features, called straight from the device to the Anthropic API with the key
// stored in Settings. Nothing is sent unless AI is switched on AND the user takes
// an action that needs it (read a page, ask a question, check working, …).
import { aiReady, getSettings } from "./settings";
import { count, error as logErr, track, warn } from "./telemetry";
import { JsonReplyError, parseModelJson } from "./json-repair.ts";
import { effortFor, maxTokensFor, modelFor, type Effort } from "./ai-cost.ts";
import { recordUsage, spentThisMonth } from "./ai-ledger";
import { cachedAi, hashString } from "./ai-cache";
import { normalizeIssues, type Issue } from "./review-core.ts";
import { MATHCHECK_SYSTEM, MATHCHECK_USER } from "./mathcheck-core.ts";
import { latexSystem, normalizeLatexPage, type LatexPage } from "./latex-doc.ts";

export class AiError extends Error {}

type TextBlock = { type: "text"; text: string };
type ImageBlock = { type: "image"; source: { type: "base64"; media_type: string; data: string } };
export type Content = TextBlock | ImageBlock;

export function imageBlock(dataUrl: string): ImageBlock {
  const m = /^data:([^;]+);base64,(.*)$/.exec(dataUrl);
  if (!m) throw new AiError("Bad image data");
  return { type: "image", source: { type: "base64", media_type: m[1], data: m[2] } };
}
export const text = (t: string): TextBlock => ({ type: "text", text: t });

const RETRY_STATUS = new Set([429, 500, 502, 503, 529]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const usd = (v: number) => `$${v.toFixed(2)}`;

async function claudeOnce(opts: {
  system?: string;
  user: Content[] | string;
  maxTokens?: number;
  model?: string;
  signal?: AbortSignal;
  /** which feature is calling — decides the model, thinking effort and cost labelling (never content) */
  feature?: string;
  effort?: Effort;
  timeoutMs?: number;
}): Promise<string> {
  const s = getSettings();
  if (!aiReady(s)) throw new AiError("AI features are off. Turn them on and add an API key in Settings.");
  const feature = opts.feature ?? "other";
  if (s.monthlyBudgetUsd > 0) {
    const spent = await spentThisMonth();
    if (spent >= s.monthlyBudgetUsd) throw new AiError(`You've reached your monthly AI budget (${usd(spent)} of ${usd(s.monthlyBudgetUsd)}). Raise it in Settings → AI features to keep going.`);
  }
  let model = opts.model ?? modelFor(feature, s);
  let effort = opts.effort ?? effortFor(feature, s.careful, model);
  const t0 = performance.now();
  count(`ai.${feature}`);
  const timeoutMs = opts.timeoutMs ?? (feature === "exam" ? 300_000 : 120_000);
  let res: Response | null = null;
  let networkRetried = false;
  for (let attempt = 0; attempt < 4; attempt++) {
    const ctrl = new AbortController();
    const onAbort = () => ctrl.abort();
    opts.signal?.addEventListener("abort", onAbort);
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        signal: ctrl.signal,
        headers: {
          "content-type": "application/json",
          "x-api-key": s.apiKey.trim(),
          "anthropic-version": "2023-06-01",
          // Required for calls made directly from a browser (this is a single-user,
          // on-device app using its owner's own key).
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
          model,
          max_tokens: maxTokensFor(opts.maxTokens ?? 2000, effort),   // thinking shares this budget
          ...(effort ? { output_config: { effort } } : {}),
          ...(opts.system ? { system: opts.system } : {}),
          messages: [{ role: "user", content: opts.user }],
        }),
      });
    } catch (e) {
      if (opts.signal?.aborted) throw new AiError("Cancelled.");
      if (ctrl.signal.aborted) {
        logErr("ai", "request timed out", { feature, model, ms: Math.round(performance.now() - t0) });
        throw new AiError("The AI took too long to answer. Try again — a smaller selection is quicker.");
      }
      // network failure / offline / blocked — nothing was billed, so one quiet retry is free
      if (!networkRetried && navigator.onLine !== false) { networkRetried = true; await sleep(800); continue; }
      logErr("ai", "request could not be sent", { feature, err: String((e as Error)?.message ?? e).slice(0, 120), online: navigator.onLine });
      throw new AiError(navigator.onLine === false ? "You're offline — AI features need a connection." : "Couldn't reach the AI service. Check your connection and try again.");
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
    }
    if (res.ok) break;
    // Rejections that are about OUR request shape are fixed once and retried (a 400/404 is never billed)
    if (res.status === 400 || res.status === 404) {
      let detail = "";
      try { detail = (await res.clone().json())?.error?.message ?? ""; } catch { /* ignore */ }
      if (effort && /effort|output_config/i.test(detail)) { effort = undefined; continue; }
      if (model !== s.model && res.status === 404) { model = s.model; effort = opts.effort ?? effortFor(feature, s.careful, model); continue; }   // cheaper model not available on this key
    }
    if (RETRY_STATUS.has(res.status) && attempt < 3) {
      const ra = Number(res.headers.get("retry-after"));
      await sleep(Number.isFinite(ra) && ra > 0 ? Math.min(ra, 20) * 1000 : 1500 * 2 ** attempt);
      continue;
    }
    break;
  }
  if (!res) throw new AiError("Couldn't reach the AI service.");
  const ms = performance.now() - t0;
  if (!res.ok) {
    let detail = "";
    try {
      detail = (await res.json())?.error?.message ?? "";
    } catch {
      /* ignore */
    }
    logErr("ai", `request failed (${res.status})`, { feature, status: res.status, model, ms: Math.round(ms), detail: detail.slice(0, 160) });
    if (res.status === 401) throw new AiError("The API key was rejected. Check it in Settings.");
    if (res.status === 429) throw new AiError("Rate limited — wait a moment and try again.");
    if (res.status === 529 || res.status >= 500) throw new AiError("The AI service is busy right now. Try again in a minute.");
    throw new AiError(`AI request failed (${res.status}) ${detail}`.trim());
  }
  const data = await res.json();
  track("ai.ms", ms);
  track(`ai.${feature}.ms`, ms);
  if (data?.usage) {
    track("ai.inputTokens", data.usage.input_tokens ?? 0); track("ai.outputTokens", data.usage.output_tokens ?? 0);
    void recordUsage(feature, model, data.usage);
  }
  if (data?.stop_reason === "max_tokens") warn("ai", "reply was cut off at the token limit", { feature, maxTokens: opts.maxTokens ?? 2000, model });
  return (data.content ?? []).filter((b: { type: string }) => b.type === "text").map((b: { text: string }) => b.text).join("");
}

const inflight = new Map<string, Promise<string>>();
/**
 * Every AI call goes through here. An identical request that is already running (a double tap on "Write my exam",
 * two quick taps on Explain) shares the one in flight instead of being sent — and billed — twice.
 */
export function claude(opts: Parameters<typeof claudeOnce>[0]): Promise<string> {
  const key = hashString(`${opts.feature ?? ""}|${opts.model ?? ""}|${opts.system ?? ""}|${typeof opts.user === "string" ? opts.user : JSON.stringify(opts.user)}`);
  const running = inflight.get(key);
  if (running) { count("ai.dedup"); return running; }
  const p = claudeOnce(opts).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

/** Pull the first JSON object/array out of a model reply (tolerates fences, chatter, LaTeX backslashes, cut-off replies). */
export function extractJson<T>(raw: string): T {
  try {
    return parseModelJson<T>(raw);
  } catch (e) {
    if (e instanceof JsonReplyError && e.truncated) {
      warn("ai", "reply could not be parsed (cut off)", { chars: raw.length });
      throw new AiError("The model's reply was cut off before it finished. Try again with fewer questions or a smaller scope.");
    }
    warn("ai", "reply could not be parsed", { chars: raw.length });
    throw new AiError((e as Error).message || "Couldn't parse the model's reply.");
  }
}

// --- feature prompts -------------------------------------------------------------

export async function transcribePage(pageImage: string): Promise<string> {
  return claude({
    feature: "transcribe",
    maxTokens: 2500,
    system:
      "You transcribe a student's handwritten notes from an image. Output the text only, preserving line breaks and structure " +
      "(headings, lists, tables as plain text). Write mathematics as LaTeX inside $...$ and chemical formulas/equations as written " +
      "(e.g. H2O, 2H2 + O2 -> 2H2O). If a printed PDF page is underneath, transcribe both the printed text and the handwriting, " +
      "marking handwriting with [ink] at the start of those lines. Do not add commentary. If the page is blank, output nothing.",
    user: [imageBlock(pageImage), text("Transcribe this page.")],
  });
}

export async function recognizeMath(region: string): Promise<string> {
  const raw = await claude({
    feature: "math",
    maxTokens: 600,
    system: "You convert handwritten mathematics in an image to LaTeX. Reply with ONLY the LaTeX source — no $ delimiters, no code fences, no explanation.",
    user: [imageBlock(region), text("Convert to LaTeX.")],
  });
  return raw.replace(/^```(?:latex)?\s*|\s*```$/g, "").replace(/^\$+|\$+$/g, "").trim();
}

export type WorkingLine = { latex: string; sympy: string; kind: "expr" | "eq" | "text" };

export async function readWorking(region: string): Promise<WorkingLine[]> {
  const raw = await claude({
    feature: "working",
    maxTokens: 2500,
    system:
      "You read handwritten maths working from an image, one step per line top to bottom, and return STRICT JSON only: " +
      '{"lines":[{"latex":"...","sympy":"...","kind":"expr"|"eq"|"text"}]}. ' +
      '"latex" is the line as LaTeX. "sympy" is a string SymPy can parse: use ** for powers, explicit * for multiplication, ' +
      "sin(x) style functions, sqrt(), pi, E, and write calculus as evaluable calls (diff(f, x), integrate(f, x), limit(f, x, a)). " +
      'For an equation use kind "eq" and write it as lhs = rhs with exactly one "=". For an expression use kind "expr". ' +
      'If a line starts with "=" it continues the previous expression: emit it as its own expr line equal to the previous one\'s value. ' +
      'Use kind "text" (with empty sympy) for words, labels or anything that is not maths. Transcribe exactly what is written, ' +
      "including any mistakes — do NOT correct the working.",
    user: [imageBlock(region), text("Read the working.")],
  });
  const parsed = extractJson<{ lines: WorkingLine[] }>(raw);
  return (parsed.lines ?? []).map((l) => ({ latex: l.latex ?? "", sympy: l.sympy ?? "", kind: l.kind ?? "text" }));
}

export type Excerpt = { n: number; noteTitle: string; page: number; text: string; noteId?: string };

export async function askNotes(question: string, excerpts: Excerpt[]): Promise<string> {
  const ctx = excerpts.map((e) => `[${e.n}] ${e.noteTitle} — page ${e.page + 1}\n${e.text}`).join("\n\n");
  return claude({
    feature: "ask",
    maxTokens: 1500,
    system:
      "You answer a student's question using ONLY their own note excerpts below. Cite sources inline like [1] or [2][3]. " +
      "If the excerpts don't contain the answer, say what's missing instead of guessing. Be concise and use LaTeX in $...$ for maths.",
    user: `Note excerpts:\n\n${ctx}\n\nQuestion: ${question}`,
  });
}

export type PracticeQuestion = { q: string; answer: string; steps?: string[]; topic?: string };

export async function practiceQuestions(excerpts: Excerpt[], count: number, difficulty: "same" | "harder"): Promise<PracticeQuestion[]> {
  const ctx = excerpts.map((e) => `[${e.n}] ${e.noteTitle} — page ${e.page + 1}\n${e.text}`).join("\n\n");
  const raw = await claude({
    feature: "practice",
    maxTokens: 4000,
    system:
      "You write practice exam questions from a student's own notes. Return STRICT JSON only: " +
      '{"questions":[{"q":"...","answer":"...","steps":["..."],"topic":"..."}]}. ' +
      "Questions must test material that appears in the notes (concepts AND worked-problem types), in past-paper style, varied in format " +
      "(short answer, calculation, explain-why). Include a worked answer with steps for calculations. Use LaTeX in $...$ for maths.",
    user: `Notes:\n\n${ctx}\n\nWrite ${count} questions. Difficulty: ${difficulty === "harder" ? "noticeably harder than the examples in the notes" : "similar to the examples in the notes"}.`,
  });
  return extractJson<{ questions: PracticeQuestion[] }>(raw).questions ?? [];
}

export type ReadEquation = { reactants: { coef: number; formula: string }[]; products: { coef: number; formula: string }[] };

/** Read chemical equations off a handwritten region. Only transcribes — balancing is checked locally (chem.ts). */
export async function readChemistry(region: string): Promise<ReadEquation[]> {
  const raw = await claude({
    feature: "chem",
    maxTokens: 2000,
    system:
      "You read handwritten chemical equations from an image and return STRICT JSON only: " +
      '{"equations":[{"reactants":[{"coef":1,"formula":"H2"}],"products":[{"coef":1,"formula":"H2O"}]}]}. ' +
      'Write formulas in plain text with no subscripts characters: H2O, Ca(OH)2, Ba(OH)2·8H2O. Write ion charges with a caret: Fe^3+, SO4^2-, Cl^-. ' +
      'Omit state symbols like (aq), (s), (l), (g) and any text above/below the arrow (catalysts, heat). "coef" is the number written in front of the species (1 if none). ' +
      "Transcribe EXACTLY what is written, including coefficients that are wrong — do NOT balance or correct anything. One object per equation.",
    user: [imageBlock(region), text("Read the chemical equations.")],
  });
  const parsed = extractJson<{ equations: ReadEquation[] }>(raw);
  return (parsed.equations ?? []).filter((e) => e.reactants?.length && e.products?.length).map((e) => ({
    reactants: e.reactants.map((r) => ({ coef: Number(r.coef) || 1, formula: String(r.formula) })),
    products: e.products.map((r) => ({ coef: Number(r.coef) || 1, formula: String(r.formula) })),
  }));
}

/** Transcribe a lassoed region of handwriting to plain text (maths as $LaTeX$). */
export async function transcribeRegion(region: string): Promise<string> {
  const raw = await claude({
    feature: "text",
    maxTokens: 1500,
    system:
      "You transcribe handwriting from an image. Output the text only, preserving line breaks. Write mathematics as LaTeX inside $...$ and chemical formulas as written. " +
      "No commentary, no code fences.",
    user: [imageBlock(region), text("Transcribe this.")],
  });
  return raw.replace(/^```\w*\s*|\s*```$/g, "").trim();
}

/** Read handwritten equations to graph, one per line, in plain typed syntax (y = x^2 + 3x). */
export async function readGraphable(region: string): Promise<string[]> {
  const raw = await claude({
    feature: "graph",
    maxTokens: 600,
    system:
      "You read handwritten equations or functions to be graphed. Reply with ONLY the equations, one per line, in plain typed syntax: " +
      "use ^ for powers, * for multiplication, sin(x), sqrt(x), pi, e, abs(x). Use only the variables x and y (and z for a surface z = f(x, y)). " +
      "Examples: y = x^2 + 3x   |   x^2 + y^2 = 25   |   z = sin(x)*cos(y). Transcribe exactly what is written; no commentary, no code fences, no $.",
    user: [imageBlock(region), text("Which equations should be graphed?")],
  });
  return raw.replace(/```\w*/g, "").split("\n").map((l) => l.replace(/^[\s\-*\d.)]+(?=[a-zA-Z(])/, "").trim()).filter(Boolean).slice(0, 6);
}

/**
 * LaTeX export: read one page into structured elements (see latex-doc.ts), on the main model at full page size.
 * An unchanged page is never read (or paid for) twice.
 */
export async function readPageForLatex(pageImage: string, page: number, inkOnly: boolean): Promise<LatexPage> {
  const { value } = await cachedAi(inkOnly ? "latex.ink" : "latex", pageImage, async () => extractJson<unknown>(await claude({
    feature: "latex", maxTokens: 6000, system: latexSystem(inkOnly), user: [imageBlock(pageImage), text("Convert this page.")],
  })));
  return normalizeLatexPage(value, page);
}

/** Math check as you write: the cheap model reads the line just finished (see mathcheck-core.ts). */
export async function checkMathLine(region: string): Promise<unknown> {
  // the same picture (an unchanged line) is never checked — or paid for — twice
  return (await cachedAi("mathcheck", region, async () => extractJson<unknown>(await claude({
    feature: "mathcheck", maxTokens: 700, timeoutMs: 45_000, system: MATHCHECK_SYSTEM, user: [imageBlock(region), text(MATHCHECK_USER)],
  })))).value;
}

export type Shortfall = { what: string; why: string; fix: string };
export type Explanation = { concept: string; explanation: string; shortfalls: Shortfall[]; followups: string[] };

const EXPLAIN_SYSTEM =
  "You are a patient tutor. The image is a region a student circled or highlighted in their own notes (handwriting, possibly over a printed PDF page such as a research paper). " +
  "Work out the concept it shows and explain it clearly for someone learning it: lead with the core idea in plain words, then the mechanism or a short worked example. " +
  "Then judge the student's OWN writing: list every place their understanding fell short — wrong steps, misconceptions, missing conditions, sloppy notation — " +
  "each with what is wrong, why, and the correct version. Only list real problems you are confident about; if the writing is correct, return an empty list. " +
  "Use LaTeX in $...$ for maths. Return STRICT JSON only: " +
  '{"concept":"short name","explanation":"markdown-lite text","shortfalls":[{"what":"...","why":"...","fix":"..."}],"followups":["a natural next question","another"]}.';

export async function explainRegion(region: string, opts: { fresh?: boolean } = {}): Promise<Explanation> {
  // circling the same thing again is free: the answer for an identical picture is remembered.
  // "Not right? Ask again" (fresh) skips the remembered answer and thinks harder; the new answer replaces it.
  return (await cachedAi("explain", region, () => explainRegionFresh(region, opts.fresh ? "high" : undefined), opts.fresh)).value;
}
async function explainRegionFresh(region: string, effort?: Effort): Promise<Explanation> {
  const raw = await claude({ feature: "explain", maxTokens: 2200, effort, system: EXPLAIN_SYSTEM, user: [imageBlock(region), text(effort === "high" ? "Explain this, and tell me where my understanding fell short. A previous explanation of this was judged wrong or unhelpful — read the image very carefully." : "Explain this, and tell me where my understanding fell short.")] });
  const j = extractJson<Partial<Explanation>>(raw);
  const s = (v: unknown) => (typeof v === "string" ? v : "");
  return {
    concept: s(j.concept) || "This region",
    explanation: s(j.explanation),
    shortfalls: (Array.isArray(j.shortfalls) ? j.shortfalls : []).map((x) => ({ what: s(x?.what), why: s(x?.why), fix: s(x?.fix) })).filter((x) => x.what),
    followups: (Array.isArray(j.followups) ? j.followups : []).map(s).filter(Boolean).slice(0, 4),
  };
}

/** Continue the conversation about a circled region. `turns` holds earlier Q&A as plain text. */
export async function askAboutRegion(region: string, turns: { role: "user" | "assistant"; content: string }[], question: string): Promise<string> {
  const transcript = turns.map((t) => `${t.role === "user" ? "Student" : "Tutor"}: ${t.content}`).join("\n\n");
  return claude({
    feature: "explain.followup",
    maxTokens: 1200,
    system: "You are a patient tutor answering follow-up questions about a region of the student's notes (image attached). Be concise; use LaTeX in $...$ for maths. Plain text, no JSON.",
    user: [imageBlock(region), text((transcript ? transcript + "\n\n" : "") +`Student: ${question}`)],
  });
}

const REVIEW_SYSTEM =
  "You are a careful marker reviewing ONE page of a student's handwritten notes (maybe over a printed PDF page). Find genuine mistakes in the student's own work: " +
  "arithmetic slips, algebra errors, sign errors, wrong formulas or concepts, unit errors, steps that don't follow from the previous line, wrong facts. " +
  "Do not flag neatness, style, or printed text. Check each line against the one before it. Be conservative: report only errors you are confident about " +
  '(use "confidence":"medium" when unsure). For each, give a tight bounding box around the offending line/term as FRACTIONS of the image: [x, y, width, height], each 0..1 from the top-left. ' +
  "Return STRICT JSON only: " +
  '{"issues":[{"bbox":[0.1,0.2,0.5,0.04],"read":"what you read there","problem":"what is wrong","why":"the principle / why","fix":"the correct version","kind":"arithmetic|algebra|sign|concept|units|missing-step|notation|other","confidence":"high|medium"}]}. ' +
  'Use LaTeX in $...$ for maths. If the page has no mistakes (or is blank) return {"issues":[]}.';

export async function reviewPage(pageImage: string, page: number): Promise<Issue[]> {
  // an unchanged page (same picture) is never reviewed — or paid for — twice. The raw findings are cached, not the
  // page-specific rectangles, so the answer stays right even if pages have been reordered since.
  const { value } = await cachedAi("review", pageImage, async () => {
    const raw = await claude({ feature: "review", maxTokens: 3000, system: REVIEW_SYSTEM, user: [imageBlock(pageImage), text("Review this page.")] });
    return extractJson<{ issues?: unknown }>(raw).issues ?? [];
  });
  return normalizeIssues(value, page);
}
