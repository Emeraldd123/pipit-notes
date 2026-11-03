// Math check as you write: the prompt and the reply handling (no browser imports, so it is unit-tested in node).
// The cheap model reads the line you just finished (plus a line or two above it for context) and says whether it is
// right. A flagged algebra step is then re-checked by SymPy and a flagged reaction by the local balancer, and a
// flag either of them disproves is dropped: being told a correct line is wrong is worse than a missed slip.
import type { Box } from "./ink-groups.ts";

export const MATHCHECK_SYSTEM =
  "You check a student's handwritten working as they write it. The image shows a few lines; the BOTTOM line was just finished. " +
  'First decide what the bottom line is: "math" (an equation or calculation step), "chem" (a chemical equation or calculation) or "other" (words, a heading, a diagram, unfinished work). ' +
  "For math or chem, check ONLY the bottom line: is it correct on its own (arithmetic, algebra, signs, units, a balanced reaction), and does it follow from the line(s) directly above when they are part of the same working? " +
  "Be conservative. Flag only mistakes you are sure about. Never flag unusual but valid notation, a skipped but correct step, rounding at sensible precision, messy handwriting, or work that is clearly unfinished. " +
  "For each mistake give a tight box around the wrong part of the bottom line as FRACTIONS of the image [x, y, width, height] from the top-left, a note of at most 12 words, and the correct version. " +
  'Also transcribe for an independent check: "prev" and "line" as SymPy strings (** for powers, explicit *, exactly one "=" for an equation; "" if not algebra), ' +
  'and for a chemical equation "reaction" with reactants and products as {"coef":n,"formula":"H2O"} (plain formulas, charges like Fe^3+, no state symbols). ' +
  "Return STRICT JSON only: " +
  '{"kind":"math"|"chem"|"other","ok":true|false,"issues":[{"bbox":[0.1,0.6,0.3,0.3],"note":"...","fix":"..."}],"prev":"","line":"","reaction":null}.';

export const MATHCHECK_USER = "Check the bottom line.";

export type MathIssue = { box: Box; note: string; fix: string };
export type Reaction = { reactants: { coef: number; formula: string }[]; products: { coef: number; formula: string }[] };
export type MathCheck = { kind: "math" | "chem" | "other"; ok: boolean; issues: MathIssue[]; prev: string; line: string; reaction: Reaction | null };

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const frac = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : NaN; };

function species(v: unknown) {
  return (Array.isArray(v) ? v : []).map((x) => ({ coef: Number(x?.coef) || 1, formula: str(x?.formula) })).filter((x) => x.formula);
}

/**
 * Turn the model's reply into marks in DOCUMENT coordinates. `crop` is the document rect the image was taken from,
 * `line` the bottom line's rect: a box that misses the bottom line (or is missing) falls back to the whole line.
 */
export function normalizeMathCheck(raw: unknown, crop: Box, line: Box): MathCheck {
  const j = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const kind = j.kind === "math" || j.kind === "chem" ? j.kind : "other";
  const issues: MathIssue[] = [];
  if (kind !== "other") {
    for (const it of Array.isArray(j.issues) ? j.issues : []) {
      const note = str(it?.note);
      if (!note) continue;
      let box = line;
      const b = Array.isArray(it?.bbox) ? it.bbox.map(frac) : [];
      if (b.length === 4 && b.every((n: number) => !Number.isNaN(n)) && b[2] > 0 && b[3] > 0) {
        const d = { x: crop.x + b[0] * crop.w, y: crop.y + b[1] * crop.h, w: b[2] * crop.w, h: b[3] * crop.h };
        // keep it on the line that was just written (the model sometimes boxes the line above)
        const top = Math.max(d.y, line.y - 8), bottom = Math.min(d.y + d.h, line.y + line.h + 8);
        if (bottom - top > 4) box = { x: Math.max(line.x - 8, d.x), y: top, w: Math.min(line.x + line.w + 8, d.x + d.w) - Math.max(line.x - 8, d.x), h: bottom - top };
        if (box.w <= 4) box = line;
      }
      issues.push({ box, note: note.slice(0, 120), fix: str(it?.fix).slice(0, 200) });
    }
  }
  const r = j.reaction as Record<string, unknown> | null | undefined;
  const reaction = r && typeof r === "object" ? { reactants: species(r.reactants), products: species(r.products) } : null;
  return {
    kind, ok: kind === "other" || issues.length === 0, issues: issues.slice(0, 3), prev: str(j.prev), line: str(j.line),
    reaction: reaction && reaction.reactants.length && reaction.products.length ? reaction : null,
  };
}

/** SymPy line spec for stepcheck.verifyWorking. */
export function workingLine(s: string): { latex: string; sympy: string; kind: "expr" | "eq" | "text" } {
  const eqs = (s.match(/=/g) ?? []).length;
  return { latex: s, sympy: s, kind: !s ? "text" : eqs === 1 ? "eq" : eqs === 0 ? "expr" : "text" };
}
