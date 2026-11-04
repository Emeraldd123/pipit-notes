// Variety checks for the tuning loop: is a paper varied inside itself, and is it NEW compared with the papers
// written earlier for the same notes? (A writer that found five great questions and repeats them would score well
// on quality and badly here.) Pure: unit-tested in tests/exam-variety.test.mjs.
import { tokens } from "../src/lib/related.ts";

/** The words of a question: stem, part prompts and options (what makes it the question it is). */
export const questionWords = (q) => new Set(tokens([q.stem, ...q.parts.map((p) => `${p.prompt} ${(p.options ?? []).join(" ")}`)].join(" ")));

export function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let n = 0;
  for (const w of a) if (b.has(w)) n++;
  return n / (a.size + b.size - n);
}

/** Two questions this similar are the same question with the numbers changed (or the same scenario reused). */
export const REPEAT = 0.45;

/**
 * How new each question is against earlier papers for the same notes: 1 = nothing like it before, 0 = a copy.
 * Returns the average, the repeats (with the earlier question they repeat), and the worst offenders.
 */
export function novelty(questions, earlier) {
  if (!earlier.length) return { novelty: 1, repeats: [] };
  const prior = earlier.map((q) => ({ q, w: questionWords(q) }));
  const repeats = [];
  let sum = 0;
  for (const q of questions) {
    const w = questionWords(q);
    let best = 0, match = null;
    for (const p of prior) { const s = jaccard(w, p.w); if (s > best) { best = s; match = p.q; } }
    sum += 1 - best;
    if (best >= REPEAT) repeats.push({ stem: q.stem.slice(0, 120), earlier: match.stem.slice(0, 120), sim: +best.toFixed(2) });
  }
  return { novelty: questions.length ? sum / questions.length : 1, repeats };
}

/** Near-duplicates INSIDE one paper. */
export function internalRepeats(questions) {
  const ws = questions.map(questionWords);
  let n = 0;
  for (let i = 0; i < ws.length; i++) for (let j = i + 1; j < ws.length; j++) if (jaccard(ws[i], ws[j]) >= REPEAT) n++;
  return n;
}

/** Spread of part types (mcq, numeric, short, working, tf) as normalised entropy: 0 = all one type, 1 = even mix. */
export function typeMix(questions) {
  const counts = new Map();
  for (const q of questions) for (const p of q.parts) counts.set(p.type, (counts.get(p.type) ?? 0) + 1);
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  if (counts.size < 2 || !total) return 0;
  const h = -[...counts.values()].reduce((s, c) => s + (c / total) * Math.log(c / total), 0);
  return h / Math.log(Math.min(5, total));
}

/** Share of the note pages that some question rests on (basis.notes), so a paper doesn't live in one corner. */
export function coverage(questions, pages) {
  const used = new Set(questions.flatMap((q) => q.basis?.notes ?? []));
  return pages ? Math.min(1, [...used].filter((n) => n >= 1 && n <= pages).length / pages) : 0;
}

/** One variety score in 0..1 and its parts. */
export function varietyScore(questions, earlier, pages) {
  const nov = novelty(questions, earlier);
  const mix = typeMix(questions);
  const cov = coverage(questions, pages);
  const dup = internalRepeats(questions);
  const noDup = Math.max(0, 1 - dup / Math.max(1, questions.length / 2));
  return { score: (nov.novelty * 2 + mix + cov + noDup) / 5, novelty: nov.novelty, repeats: nov.repeats, typeMix: mix, coverage: cov, internalRepeats: dup };
}

/**
 * One paper's score in 0..1: the judge's quality (and format match when a past exam was given), with penalties for
 * copying a past exam, letter answer keys, references to missing figures and short papers; blended 70/30 with variety.
 */
export function paperScore({ avg, paper }, stats, variety, target = 8) {
  const crit = [avg.realistic, avg.applied, avg.selfContained, avg.oneAnswer, avg.accurate, avg.distractors, paper?.style_match].filter((x) => typeof x === "number");
  let quality = crit.length ? crit.reduce((a, b) => a + b, 0) / crit.length / 2 : 0;
  if (paper?.copied) quality -= 0.25;
  quality -= 0.03 * ((stats.keyLetters ?? 0) + (stats.noFigure ?? 0));
  if ((stats.questions ?? 0) < target * 0.6) quality -= 0.1;
  quality = Math.max(0, quality);
  return { quality, variety: variety.score, total: 0.7 * quality + 0.3 * variety.score };
}

/** Words of the sample notes that only one subject uses: tuned rules mentioning several of them are topic-specific. */
// `general` (optional): texts from several subjects (e.g. the built-in exams, one string per subject). A word that shows
// up in two or more of them is ordinary vocabulary ("standard", "larger", "conditions"), not a topic.
export function distinctiveWords(fixtures, general = []) {
  const per = fixtures.map((f) => new Set(tokens(f.pages.join(" ")).filter((w) => w.length > 4)));
  const gen = general.map((t) => new Set(tokens(t)));
  const common = (w) => gen.filter((s) => s.has(w)).length >= 2;
  const out = new Set();
  per.forEach((s, i) => { for (const w of s) if (per.every((o, j) => j === i || !o.has(w)) && !common(w)) out.add(w); });
  return out;
}

/** The built-in exams pooled per subject: the `general` vocabulary for distinctiveWords. */
export const generalTexts = (exams) => [...new Set(exams.map((e) => e.subject))].map((s) => exams.filter((e) => e.subject === s).map((e) => [...e.pages, ...(e.solutionPages ?? [])].join("\n")).join("\n"));
export function leaks(rules, distinct, base) {
  const baseWords = new Set(tokens(base));
  return [...new Set(tokens(rules))].filter((w) => distinct.has(w) && !baseWords.has(w));
}
