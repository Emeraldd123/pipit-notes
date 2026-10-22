// Turn model output with LaTeX ($\frac{a}{b}$, x^2, \sqrt…) into readable plain text, for places that
// show raw text (e.g. a text block pinned onto a page). Pure + unit-tested.
const SUP: Record<string, string> = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", "-": "⁻", "+": "⁺", n: "ⁿ" };
const SUB: Record<string, string> = { "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉" };
const GREEK: Record<string, string> = { alpha: "α", beta: "β", gamma: "γ", delta: "δ", Delta: "Δ", theta: "θ", lambda: "λ", mu: "μ", pi: "π", sigma: "σ", omega: "ω", Omega: "Ω", phi: "φ", rho: "ρ", epsilon: "ε", tau: "τ" };

export function plainMath(src: string): string {
  let s = src.replace(/\$\$?/g, "");
  // exponents / subscripts first, so nested fractions have flat braces by the time they are read
  s = s
    .replace(/\^\{([^{}]+)\}/g, (_m, t: string) => (t.split("").every((c) => SUP[c]) ? t.split("").map((c) => SUP[c]).join("") : `^(${t})`))
    .replace(/_\{([^{}]+)\}/g, (_m, t: string) => (t.split("").every((c) => SUB[c]) ? t.split("").map((c) => SUB[c]).join("") : `_(${t})`));
  for (let i = 0; i < 6 && /\\frac/.test(s); i++) s = s.replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, (_m, a, b) => `(${a})/(${b})`);
  s = s
    .replace(/\\sqrt\s*\{([^{}]*)\}/g, "√($1)")
    .replace(/\\(pm|mp)/g, (_m, k) => (k === "pm" ? "±" : "∓"))
    .replace(/\\(cdot|times)/g, (_m, k) => (k === "cdot" ? "·" : "×"))
    .replace(/\\(le|leq)\b/g, "≤").replace(/\\(ge|geq)\b/g, "≥").replace(/\\neq?\b/g, "≠").replace(/\\approx\b/g, "≈")
    .replace(/\\(?:rightarrow|to)\b/g, "→").replace(/\\infty\b/g, "∞").replace(/\\degree|\\circ/g, "°")
    .replace(/\\(alpha|beta|gamma|delta|Delta|theta|lambda|mu|pi|sigma|omega|Omega|phi|rho|epsilon|tau)\b ?/g, (_m, g) => GREEK[g])
    .replace(/\\(?:left|right|,|;|!|text|mathrm)/g, "")
    .replace(/\^([0-9n])/g, (_m, c) => SUP[c])
    .replace(/_([0-9])/g, (_m, c) => SUB[c])
    .replace(/[{}]/g, "")
    .replace(/\\\\/g, "\n")
    .replace(/\*\*([^*]+)\*\*/g, "$1");
  return s.replace(/[ \t]+/g, " ").trim();
}
