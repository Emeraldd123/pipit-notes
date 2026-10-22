// Chemistry helpers: formula parsing, equation balance checking (atoms AND charge),
// finding the smallest whole-number balancing coefficients, and molar masses.
// Pure and deterministic — the AI only READS the equation off the page; whether it
// balances is decided here.

export const ATOMIC_MASS: Record<string, number> = {
  H: 1.008, He: 4.0026, Li: 6.94, Be: 9.0122, B: 10.81, C: 12.011, N: 14.007, O: 15.999, F: 18.998, Ne: 20.18,
  Na: 22.99, Mg: 24.305, Al: 26.982, Si: 28.085, P: 30.974, S: 32.06, Cl: 35.45, Ar: 39.948, K: 39.098, Ca: 40.078,
  Sc: 44.956, Ti: 47.867, V: 50.942, Cr: 51.996, Mn: 54.938, Fe: 55.845, Co: 58.933, Ni: 58.693, Cu: 63.546, Zn: 65.38,
  Ga: 69.723, Ge: 72.63, As: 74.922, Se: 78.971, Br: 79.904, Kr: 83.798, Rb: 85.468, Sr: 87.62, Y: 88.906, Zr: 91.224,
  Nb: 92.906, Mo: 95.95, Ru: 101.07, Rh: 102.91, Pd: 106.42, Ag: 107.87, Cd: 112.41, In: 114.82, Sn: 118.71, Sb: 121.76,
  Te: 127.6, I: 126.9, Xe: 131.29, Cs: 132.91, Ba: 137.33, La: 138.91, Ce: 140.12, W: 183.84, Pt: 195.08, Au: 196.97,
  Hg: 200.59, Tl: 204.38, Pb: 207.2, Bi: 208.98, Ra: 226, U: 238.03,
};

export type Counts = Map<string, number>;
export type Parsed = { counts: Counts; charge: number };

export class FormulaError extends Error {}

/** Parse e.g. "Ca(OH)2", "Ba(OH)2·8H2O", "(NH4)2SO4", "Fe^3+", "SO4^2-". */
export function parseFormula(input: string): Parsed {
  let s = input.trim().replace(/\s+/g, "").replace(/[₀-₉]/g, (c) => String(c.charCodeAt(0) - 0x2080)).replace(/[−–]/g, "-");
  if (!s) throw new FormulaError("empty formula");
  let charge = 0;
  // Charges are written explicitly: Fe^3+, SO4^2-, Cl^-, NH4^+
  const explicit = /\^\(?(\d*)([+-])\)?$/.exec(s);
  if (explicit) {
    charge = (explicit[1] ? Number(explicit[1]) : 1) * (explicit[2] === "+" ? 1 : -1);
    s = s.slice(0, explicit.index);
  }
  const counts: Counts = new Map();
  // hydrates / adducts: split on · . * (but not a decimal inside a number)
  const parts = s.split(/[·*•]|\.(?=\d*[A-Z(])/);
  for (const part of parts) {
    let mult = 1;
    let body = part;
    const lead = /^(\d+)(?=[A-Z(])/.exec(body);
    if (lead && parts.length > 1) { mult = Number(lead[1]); body = body.slice(lead[0].length); }
    const c = parseGroup(body);
    for (const [el, n] of c) counts.set(el, (counts.get(el) ?? 0) + n * mult);
  }
  return { counts, charge };
}

function parseGroup(str: string): Counts {
  let i = 0;
  function group(close: string | null): Counts {
    const out: Counts = new Map();
    while (i < str.length) {
      const ch = str[i];
      if (ch === ")" || ch === "]") {
        if (close === null) throw new FormulaError(`unexpected ${ch}`);
        break;
      }
      let sub: Counts;
      if (ch === "(" || ch === "[") {
        i++;
        sub = group(ch === "(" ? ")" : "]");
        if (i >= str.length) throw new FormulaError("missing closing bracket");
        i++; // consume the closer
      } else if (/[A-Z]/.test(ch)) {
        let el = ch;
        i++;
        if (i < str.length && /[a-z]/.test(str[i])) { el += str[i]; i++; }
        if (!(el in ATOMIC_MASS)) throw new FormulaError(`unknown element "${el}"`);
        sub = new Map([[el, 1]]);
      } else {
        throw new FormulaError(`unexpected "${ch}"`);
      }
      let num = "";
      while (i < str.length && /\d/.test(str[i])) { num += str[i]; i++; }
      const k = num ? Number(num) : 1;
      for (const [el, n] of sub) out.set(el, (out.get(el) ?? 0) + n * k);
    }
    return out;
  }
  const r = group(null);
  if (i < str.length) throw new FormulaError(`unexpected "${str[i]}"`);
  return r;
}

export function molarMass(formula: string): number {
  const { counts } = parseFormula(formula);
  let m = 0;
  for (const [el, n] of counts) m += ATOMIC_MASS[el] * n;
  return m;
}

export type Species = { coef: number; formula: string };
export type Equation = { reactants: Species[]; products: Species[] };

export type BalanceReport = {
  balanced: boolean;
  elements: { el: string; left: number; right: number; ok: boolean }[];
  charge: { left: number; right: number; ok: boolean };
  /** correct smallest whole-number coefficients (reactants then products), or null if none exist / not unique */
  suggested: number[] | null;
  errors: string[];
};

export function checkEquation(eq: Equation): BalanceReport {
  const errors: string[] = [];
  const side = (list: Species[]) => {
    const counts: Counts = new Map();
    let charge = 0;
    for (const sp of list) {
      try {
        const p = parseFormula(sp.formula);
        for (const [el, n] of p.counts) counts.set(el, (counts.get(el) ?? 0) + n * sp.coef);
        charge += p.charge * sp.coef;
      } catch (e) {
        errors.push(`${sp.formula}: ${(e as Error).message}`);
      }
    }
    return { counts, charge };
  };
  const L = side(eq.reactants), R = side(eq.products);
  const els = [...new Set([...L.counts.keys(), ...R.counts.keys()])].sort();
  const elements = els.map((el) => {
    const left = L.counts.get(el) ?? 0, right = R.counts.get(el) ?? 0;
    return { el, left, right, ok: left === right };
  });
  const charge = { left: L.charge, right: R.charge, ok: L.charge === R.charge };
  const suggested = errors.length ? null : balanceCoefficients(eq);
  return { balanced: !errors.length && elements.every((e) => e.ok) && charge.ok, elements, charge, suggested, errors };
}

// --- exact rational arithmetic (BigInt) for the nullspace ----------------------
type Q = { n: bigint; d: bigint };
const gcd = (a: bigint, b: bigint): bigint => { a = a < 0n ? -a : a; b = b < 0n ? -b : b; while (b) [a, b] = [b, a % b]; return a || 1n; };
const q = (n: bigint, d = 1n): Q => { if (d < 0n) { n = -n; d = -d; } const g = gcd(n, d); return { n: n / g, d: d / g }; };
const sub = (a: Q, b: Q) => q(a.n * b.d - b.n * a.d, a.d * b.d);
const mul = (a: Q, b: Q) => q(a.n * b.n, a.d * b.d);
const div = (a: Q, b: Q) => q(a.n * b.d, a.d * b.n);

/** Smallest positive whole-number coefficients that balance atoms and charge, or null. */
export function balanceCoefficients(eq: Equation): number[] | null {
  const species = [...eq.reactants, ...eq.products];
  const nR = eq.reactants.length;
  const parsed: Parsed[] = [];
  try { for (const sp of species) parsed.push(parseFormula(sp.formula)); } catch { return null; }
  const els = [...new Set(parsed.flatMap((p) => [...p.counts.keys()]))].sort();
  const rows: Q[][] = els.map((el) => parsed.map((p, j) => q(BigInt((p.counts.get(el) ?? 0) * (j < nR ? 1 : -1)))));
  if (parsed.some((p) => p.charge !== 0)) rows.push(parsed.map((p, j) => q(BigInt(p.charge * (j < nR ? 1 : -1)))));
  const cols = species.length;
  // RREF
  const pivotCol: number[] = [];
  let r = 0;
  for (let c = 0; c < cols && r < rows.length; c++) {
    let p = r;
    while (p < rows.length && rows[p][c].n === 0n) p++;
    if (p === rows.length) continue;
    [rows[r], rows[p]] = [rows[p], rows[r]];
    const pv = rows[r][c];
    rows[r] = rows[r].map((x) => div(x, pv));
    for (let k = 0; k < rows.length; k++) {
      if (k !== r && rows[k][c].n !== 0n) { const f = rows[k][c]; rows[k] = rows[k].map((x, j) => sub(x, mul(f, rows[r][j]))); }
    }
    pivotCol.push(c);
    r++;
  }
  const free = Array.from({ length: cols }, (_, c) => c).filter((c) => !pivotCol.includes(c));
  if (free.length !== 1) return null; // none, or several independent ways to balance
  const f = free[0];
  const sol: Q[] = new Array(cols).fill(q(0n));
  sol[f] = q(1n);
  pivotCol.forEach((c, i) => { sol[c] = q(-rows[i][f].n, rows[i][f].d); });
  let lcm = 1n;
  for (const x of sol) lcm = (lcm * x.d) / gcd(lcm, x.d);
  let ints = sol.map((x) => (x.n * lcm) / x.d);
  if (ints.every((v) => v <= 0n)) ints = ints.map((v) => -v);
  if (ints.some((v) => v <= 0n)) return null;
  const g = ints.reduce((a, b) => gcd(a, b));
  return ints.map((v) => Number(v / g));
}

export function formatEquation(eq: Equation, coefs?: number[]): string {
  const all = [...eq.reactants, ...eq.products];
  const c = (i: number) => (coefs ? coefs[i] : all[i].coef);
  const term = (sp: Species, i: number) => `${c(i) === 1 ? "" : c(i) + " "}${sp.formula}`;
  const left = eq.reactants.map((sp, i) => term(sp, i)).join(" + ");
  const right = eq.products.map((sp, i) => term(sp, eq.reactants.length + i)).join(" + ");
  return `${left} → ${right}`;
}
