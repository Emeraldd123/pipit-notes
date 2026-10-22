// A small, SAFE math-expression compiler for graphing (no eval / Function). Accepts
// what people actually type or paste: 2x+3, x^2, 3sin(x), x(x+1), sin 2x, 1/2x, x²+π,
// and LaTeX like \frac{x^{2}}{2}+\sin(x) (what the handwriting reader produces).
// Pure — unit-tested.

export class MathParseError extends Error {
  pos: number;
  constructor(message: string, pos = 0) { super(message); this.pos = pos; this.name = "MathParseError"; }
}

export type Env = { x: number; y: number };
type Node = (e: Env) => number;

const FUNCS1: Record<string, (a: number) => number> = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan,
  cot: (a) => 1 / Math.tan(a), sec: (a) => 1 / Math.cos(a), csc: (a) => 1 / Math.sin(a),
  asin: Math.asin, acos: Math.acos, atan: Math.atan, arcsin: Math.asin, arccos: Math.acos, arctan: Math.atan,
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
  exp: Math.exp, ln: Math.log, log: Math.log10, log10: Math.log10, log2: Math.log2,
  sqrt: Math.sqrt, cbrt: Math.cbrt, abs: Math.abs, floor: Math.floor, ceil: Math.ceil, round: Math.round, sign: Math.sign,
};
const FUNCS2: Record<string, (a: number, b: number) => number> = { min: Math.min, max: Math.max, pow: (a, b) => realPow(a, b), atan2: Math.atan2, mod: (a, b) => ((a % b) + b) % b };
const CONSTS: Record<string, number> = { pi: Math.PI, e: Math.E, tau: Math.PI * 2 };
const VARS = new Set(["x", "y"]);

/** a^b, taking the real root for negative bases with odd-denominator exponents (x^(1/3) at -8 = -2). */
export function realPow(a: number, b: number): number {
  if (a >= 0 || Number.isInteger(b) || !Number.isFinite(b)) return Math.pow(a, b);
  for (const q of [3, 5, 7, 9]) {
    const pq = b * q;
    if (Math.abs(pq - Math.round(pq)) < 1e-9) {
      const p = Math.round(pq);
      const r = Math.pow(Math.abs(a), b) * (Math.abs(p) % 2 === 1 ? -1 : 1);
      return Number(r.toPrecision(12));
    }
  }
  return NaN;
}

/** Normalise typed/pasted text (unicode, LaTeX) into the plain syntax the parser reads. */
export function normalize(src: string): string {
  let s = src
    .replace(/\\left|\\right|\\,|\\;|\\!|\\ /g, "")
    .replace(/\\cdot|\\times/g, "*")
    .replace(/\\div/g, "/")
    .replace(/\\(sin|cos|tan|cot|sec|csc|arcsin|arccos|arctan|sinh|cosh|tanh|ln|log|exp|sqrt|pi|tau)\b/g, "$1")
    .replace(/[−–]/g, "-")
    .replace(/[×·⋅]/g, "*")
    .replace(/÷/g, "/")
    .replace(/π/g, "pi")
    .replace(/√/g, "sqrt")
    .replace(/²/g, "^2")
    .replace(/³/g, "^3")
    .replace(/\*\*/g, "^");
  // \frac{a}{b} -> ((a)/(b)); resolve innermost first so nesting works
  // Innermost brace groups first (^{2}, _{..}), repeatedly, so \frac{x^{2}}{2} flattens.
  for (let guard = 0; guard < 12 && /[{}]/.test(s); guard++) {
    const before = s;
    s = s
      .replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, "(($1)/($2))")
      .replace(/\^\s*\{([^{}]*)\}/g, "^($1)")
      .replace(/_\{[^{}]*\}/g, "");
    // Plain groups only once no \frac is waiting on its braces.
    if (s === before && !/\\frac/.test(s)) s = s.replace(/\{([^{}]*)\}/g, "($1)");
    if (s === before) break;
  }
  return s.replace(/\s+/g, " ").trim();
}

type Tok = { t: "num"; v: number; pos: number } | { t: "id"; v: string; pos: number } | { t: "op"; v: string; pos: number } | { t: "lp" | "rp" | "comma" | "eof"; pos: number };

function tokenize(s: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === " ") { i++; continue; }
    if (/[0-9.]/.test(c)) {
      const m = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(s.slice(i));
      if (!m) throw new MathParseError(`unexpected "${c}"`, i);
      // don't swallow the constant e as an exponent marker when it's "2e" or "2e^x": only treat as sci notation if digits follow
      let text = m[0];
      if (m[2] && !/\d$/.test(m[2])) text = m[1];
      out.push({ t: "num", v: Number(text), pos: i });
      i += text.length;
      continue;
    }
    if (/[A-Za-z]/.test(c)) {
      const m = /^[A-Za-z]+/.exec(s.slice(i))!;
      out.push({ t: "id", v: m[0].toLowerCase(), pos: i });
      i += m[0].length;
      continue;
    }
    if ("+-*/^".includes(c)) { out.push({ t: "op", v: c, pos: i }); i++; continue; }
    if (c === "(" || c === "[") { out.push({ t: "lp", pos: i }); i++; continue; }
    if (c === ")" || c === "]") { out.push({ t: "rp", pos: i }); i++; continue; }
    if (c === ",") { out.push({ t: "comma", pos: i }); i++; continue; }
    throw new MathParseError(`unexpected "${c}"`, i);
  }
  out.push({ t: "eof", pos: s.length });
  return out;
}

class Parser {
  private p = 0;
  readonly vars = new Set<string>();
  private toks: Tok[];
  constructor(toks: Tok[]) { this.toks = toks; }

  private peek(): Tok { return this.toks[this.p]; }
  private next(): Tok { return this.toks[this.p++]; }
  private isOp(v: string) { const t = this.peek(); return t.t === "op" && t.v === v; }

  parseAll(): Node {
    if (this.peek().t === "eof") throw new MathParseError("empty expression", 0);
    const n = this.expr();
    const t = this.peek();
    if (t.t !== "eof") throw new MathParseError(t.t === "rp" ? "unmatched )" : "unexpected input", t.pos);
    return n;
  }

  private expr(): Node {
    let left = this.term();
    for (;;) {
      if (this.isOp("+")) { this.next(); const r = this.term(); const l = left; left = (e) => l(e) + r(e); }
      else if (this.isOp("-")) { this.next(); const r = this.term(); const l = left; left = (e) => l(e) - r(e); }
      else return left;
    }
  }

  /** true if the next token can START a factor (so juxtaposition means multiplication) */
  private startsAtom(): boolean {
    const t = this.peek();
    return t.t === "num" || t.t === "lp" || t.t === "id";
  }

  private term(): Node {
    let left = this.unary();
    for (;;) {
      if (this.isOp("*")) { this.next(); const r = this.unary(); const l = left; left = (e) => l(e) * r(e); }
      else if (this.isOp("/")) { this.next(); const r = this.unary(); const l = left; left = (e) => l(e) / r(e); }
      else if (this.startsAtom()) { const r = this.power(); const l = left; left = (e) => l(e) * r(e); } // implicit multiplication
      else return left;
    }
  }

  private unary(): Node {
    if (this.isOp("-")) { this.next(); const n = this.unary(); return (e) => -n(e); }
    if (this.isOp("+")) { this.next(); return this.unary(); }
    return this.power();
  }

  private power(): Node {
    const base = this.atom();
    if (this.isOp("^")) {
      this.next();
      const exp = this.unary(); // right-associative, allows x^-2 and 2^3^2
      return (e) => realPow(base(e), exp(e));
    }
    return base;
  }

  /** argument of a function written without parentheses: sin x, sin 2x (stops before another function name) */
  private bareArg(): Node {
    let n = this.power();
    for (;;) {
      const t = this.peek();
      const isFunc = t.t === "id" && (t.v in FUNCS1 || t.v in FUNCS2);
      if ((t.t === "num" || t.t === "lp" || (t.t === "id" && !isFunc))) { const r = this.power(); const l = n; n = (e) => l(e) * r(e); }
      else return n;
    }
  }

  private args(): Node[] {
    const out: Node[] = [this.expr()];
    while (this.peek().t === "comma") { this.next(); out.push(this.expr()); }
    return out;
  }

  private atom(): Node {
    const t = this.next();
    switch (t.t) {
      case "num": { const v = t.v; return () => v; }
      case "lp": {
        const n = this.expr();
        const c = this.next();
        if (c.t !== "rp") throw new MathParseError("missing )", c.pos);
        return n;
      }
      case "id": return this.identifier(t.v, t.pos);
      case "op": throw new MathParseError(t.v === "-" || t.v === "+" ? "unexpected sign" : `unexpected "${t.v}"`, t.pos);
      case "rp": throw new MathParseError("unexpected )", t.pos);
      case "comma": throw new MathParseError("unexpected ,", t.pos);
      case "eof": throw new MathParseError("expression ends too early", t.pos);
    }
  }

  private identifier(name: string, pos: number): Node {
    if (name in FUNCS1) {
      const f = FUNCS1[name];
      if (this.peek().t === "lp") {
        this.next();
        const a = this.expr();
        const c = this.next();
        if (c.t !== "rp") throw new MathParseError("missing )", c.pos);
        return (e) => f(a(e));
      }
      const a = this.bareArg();
      return (e) => f(a(e));
    }
    if (name in FUNCS2) {
      const f = FUNCS2[name];
      if (this.peek().t !== "lp") throw new MathParseError(`${name} needs (a, b)`, pos);
      this.next();
      const a = this.args();
      const c = this.next();
      if (c.t !== "rp") throw new MathParseError("missing )", c.pos);
      if (a.length !== 2) throw new MathParseError(`${name} takes two arguments`, pos);
      return (e) => f(a[0](e), a[1](e));
    }
    if (name in CONSTS) { const v = CONSTS[name]; return () => v; }
    if (VARS.has(name)) { this.vars.add(name); return name === "x" ? (e) => e.x : (e) => e.y; }
    // a run of letters that isn't a known name: treat as a product of single-letter variables (xy -> x*y)
    if (name.length > 1) {
      const parts: Node[] = [];
      for (const ch of name) {
        let part: Node;
        if (ch in CONSTS) { const v = CONSTS[ch]; part = () => v; }
        else if (VARS.has(ch)) { this.vars.add(ch); part = ch === "x" ? (e) => e.x : (e) => e.y; }
        else throw new MathParseError(`unknown name "${name}"`, pos);
        parts.push(part);
      }
      return (e) => parts.reduce((acc, p) => acc * p(e), 1);
    }
    throw new MathParseError(`unknown variable "${name}" (only x and y can be graphed)`, pos);
  }
}

export type Compiled = { fn: Node; vars: ("x" | "y")[] };

export function compile(src: string): Compiled {
  const p = new Parser(tokenize(normalize(src)));
  const fn = p.parseAll();
  return { fn, vars: [...p.vars].sort() as ("x" | "y")[] };
}

// --- equations -------------------------------------------------------------------------------------

export type Equation =
  | { kind: "explicit"; f: Node }                     // y = f(x)
  | { kind: "inverse"; f: Node }                      // x = f(y)
  | { kind: "surface"; f: Node }                      // z = f(x, y)
  | { kind: "implicit"; f: Node };                    // F(x, y) = 0

export function parseEquation(src: string): Equation {
  const s = normalize(src);
  const parts = s.split("=");
  if (parts.length > 2) throw new MathParseError("only one = is allowed", 0);
  if (parts.length === 1) {
    const c = compile(s);
    if (c.vars.includes("y")) return { kind: "surface", f: c.fn };
    return { kind: "explicit", f: c.fn };
  }
  const [lhs, rhs] = [parts[0].trim(), parts[1].trim()];
  const L = lhs.replace(/\s/g, "").toLowerCase();
  if (/^[a-z]\(x\)$/.test(L) || L === "y") {
    const c = compile(rhs);
    if (!c.vars.includes("y")) return { kind: "explicit", f: c.fn };
    // y appears on both sides: treat as implicit
    const a = compile(lhs).fn, b = c.fn;
    return { kind: "implicit", f: (e) => a(e) - b(e) };
  }
  if (L === "z") return { kind: "surface", f: compile(rhs).fn };
  if (L === "x") {
    const c = compile(rhs);
    if (!c.vars.includes("x")) return { kind: "inverse", f: c.fn };
  }
  const a = compile(lhs).fn, b = compile(rhs).fn;
  return { kind: "implicit", f: (e) => a(e) - b(e) };
}

/** Split a graph block's text into expression rows (blank lines ignored). */
export const expressionRows = (text: string): string[] => text.split("\n").map((l) => l.trim()).filter(Boolean);
