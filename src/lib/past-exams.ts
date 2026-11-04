// Past exams (e.g. MIT OpenCourseWare) as FORMAT examples for the exam writer. Picking which one to show is done
// on the device (word overlap with the notes, no AI): the closest exam for the course, trimmed to whole pages
// within a budget, with OCW boilerplate removed. The writer copies its format, never its questions.
import { tokens } from "./related.ts";

export type PastExam = {
  id: string; title: string; pages: string[];
  /** the matching solutions file, when there is one: shows the writer how answers and marks are written */
  solutionPages?: string[];
  /** built-in exams only */
  subject?: string; credit?: string; source?: string;
};
export type StyleExample = { id: string; title: string; text: string; credit?: string; source?: string };

const BOILERPLATE = /ocw\.mit\.edu|opencourseware|terms of use|for information about citing these materials|creative commons|massachusetts institute of technology/i;

function wholePages(pages: string[], maxChars: number): string {
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

/** One exam's text, cleaned: boilerplate lines dropped, whole pages kept until the budget runs out; with its solutions after. */
export function examText(pages: string[], maxChars: number, solutionPages?: string[]): string {
  if (!solutionPages?.length) return wholePages(pages, maxChars);
  const exam = wholePages(pages, Math.round(maxChars * 0.62));
  const sol = wholePages(solutionPages, maxChars - exam.length - 40);
  return sol ? `${exam}\n\n=== SOLUTIONS (how answers and marks are written) ===\n\n${sol}` : exam;
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

// Words that mark a subject even when the notes' topic isn't in any built-in exam (circuits vs a mechanics paper).
const SUBJECT_WORDS: Record<string, string[]> = {
  Biology: ["cell", "protein", "gene", "dna", "rna", "enzyme", "membrane", "mitochondria", "atp", "glucose", "respiration", "photosynthesis", "allele", "mutation", "organism", "species", "evolution", "receptor", "nucleus", "chromosome", "ribosome", "transcription", "translation", "metabolism", "tissue", "hormone", "neuron", "bacteria", "virus", "glycolysis", "krebs", "pyruvate", "mitosis", "meiosis"],
  Chemistry: ["mol", "molar", "molarity", "equilibrium", "reaction", "acid", "base", "ph", "bond", "electron", "orbital", "enthalpy", "entropy", "gibbs", "oxidation", "reduction", "titration", "solution", "concentration", "kc", "kp", "le", "chatelier", "ion", "ionic", "covalent", "atom", "isotope", "stoichiometry", "redox", "catalyst"],
  Physics: ["force", "velocity", "acceleration", "momentum", "energy", "work", "power", "mass", "newton", "friction", "gravity", "torque", "circuit", "current", "voltage", "resistance", "resistor", "ohm", "charge", "field", "wave", "frequency", "kinematics", "projectile", "spring", "oscillation", "joule", "watt", "volt", "ampere", "capacitor", "magnetic"],
  Economics: ["supply", "demand", "price", "market", "elasticity", "equilibrium", "consumer", "producer", "surplus", "cost", "marginal", "revenue", "profit", "tax", "subsidy", "monopoly", "oligopoly", "utility", "budget", "income", "goods", "firm", "quantity", "welfare", "externality", "inflation", "gdp"],
  Statistics: ["probability", "random", "variable", "distribution", "mean", "variance", "deviation", "normal", "binomial", "hypothesis", "null", "test", "significance", "sample", "population", "confidence", "interval", "regression", "correlation", "estimate", "likelihood", "bayes", "prior", "posterior", "expected", "pdf", "cdf", "statistic"],
};

/**
 * How strongly the notes look like each subject, highest first: word overlap with all of that subject's exams pooled
 * together, plus the share of the notes' words that are typical of the subject. Used to keep built-in exams to
 * the right subject (and to none at all for notes in a subject we have no exams for).
 */
export function subjectScores(notes: string[], exams: { subject: string; text: string }[]): [string, number][] {
  const subjects = [...new Set(exams.map((e) => e.subject))];
  const pooled = subjects.map((s) => vec(exams.filter((e) => e.subject === s).map((e) => e.text).join("\n")));
  const df = new Map<string, number>();
  for (const d of pooled) for (const t of d.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  const idf = (t: string) => Math.log(1 + (pooled.length + 1) / ((df.get(t) ?? 0) + 1));
  const words = tokens(notes.join("\n"));
  const q = vec(notes.join("\n"));
  return subjects.map((s, i): [string, number] => {
    const lex = new Set(SUBJECT_WORDS[s] ?? []);
    const share = words.length ? words.filter((w) => lex.has(w)).length / words.length : 0;
    return [s, cosine(q, pooled[i], idf) + share];
  }).sort((a, b) => b[1] - a[1]);
}

/**
 * The past exam(s) to show the writer for these notes. `chosen` forces one exam; otherwise the closest by topic,
 * plus a second if the first is short. Returns [] when there are no past exams.
 */
export function pickPastExams(notes: string[], exams: PastExam[], maxChars = 9000, chosen?: string): StyleExample[] {
  const usable = exams.filter((e) => e.pages.some((p) => p.trim().length > 40));
  if (!usable.length) return [];
  const example = (e: PastExam, budget: number): StyleExample => ({ id: e.id, title: e.title, text: examText(e.pages, budget, e.solutionPages), credit: e.credit, source: e.source });
  const forced = chosen ? usable.find((e) => e.id === chosen) : undefined;
  if (chosen && forced) return [example(forced, maxChars)];
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
    const ex = example(e, left);
    out.push(ex);
    left -= ex.text.length;
    if (left < maxChars * 0.4) break;   // the first one already fills most of the budget
  }
  return out;
}

/** Below this (or without a clear lead over the next subject) the notes aren't in any built-in exam's subject. */
export const SUBJECT_MIN = 0.12;

/**
 * Which exam(s) to copy the format of: the one you picked; otherwise your own past exams (they're your course);
 * otherwise the closest built-in exam in the notes' subject, or none if the notes aren't in a subject we have.
 */
export function chooseStyleExamples(notes: string[], mine: PastExam[], builtin: PastExam[], opts: { chosen?: string; maxChars?: number } = {}): StyleExample[] {
  const maxChars = opts.maxChars ?? 9000;
  if (opts.chosen) return pickPastExams(notes, [...mine, ...builtin], maxChars, opts.chosen);
  if (mine.length) return pickPastExams(notes, mine, maxChars);
  const subject = detectSubject(notes, builtin);
  return subject ? pickPastExams(notes, builtin.filter((e) => e.subject === subject), maxChars).slice(0, 1) : [];
}

export function detectSubject(notes: string[], builtin: PastExam[]): string | null {
  const scores = subjectScores(notes, builtin.map((e) => ({ subject: e.subject ?? "", text: e.pages.join("\n") })));
  const [top, next] = scores;
  return top && top[1] >= SUBJECT_MIN && top[1] >= (next?.[1] ?? 0) * 1.5 ? top[0] : null;
}
