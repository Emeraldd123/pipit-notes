// Symbolic step verification. The AI only READS the handwriting (see ai.ts
// readWorking); whether each line actually follows from the one above is decided
// by SymPy running locally in WebAssembly — so a flagged mistake is mathematically
// verified, not a model's opinion.
import { evalPyJson, type Status } from "./py";
import type { WorkingLine } from "./ai";
import { count, track, warn } from "./telemetry";

export type StepStatus = "start" | "ok" | "ok-extra" | "error" | "unchecked" | "unparsed" | "skip";
export type StepResult = {
  i: number;
  from?: number;
  status: StepStatus;
  /** LaTeX of what's left over when the two lines are subtracted (for errors) */
  diff?: string;
  /** short human explanation */
  note?: string;
};

const VERIFY = String.raw`
import json
from sympy import *
from sympy.parsing.sympy_parser import parse_expr, standard_transformations, implicit_multiplication_application, convert_xor

_T = standard_transformations + (implicit_multiplication_application, convert_xor)

def _parse(s):
    return parse_expr(s.strip(), transformations=_T, evaluate=True)

def _val(line):
    s = line["sympy"]
    if line["kind"] == "eq":
        l, r = s.split("=", 1)
        return ("eq", _parse(l), _parse(r))
    return ("expr", _parse(s), None)

def _is_zero(e):
    try:
        return simplify(e) == 0
    except Exception:
        return False

def _equiv_expr(a, b):
    d = a - b
    if _is_zero(d):
        return True, None
    try:
        if a.equals(b):
            return True, None
    except Exception:
        pass
    try:
        return False, simplify(d)
    except Exception:
        return False, d

def _solset(f, v):
    try:
        return set(simplify(x) for x in solve(f, v))
    except Exception:
        return None

def _step_eq(l1, r1, l2, r2):
    f1, f2 = l1 - r1, l2 - r2
    syms = sorted(f1.free_symbols | f2.free_symbols, key=str)
    if len(syms) == 1:
        v = syms[0]
        s1, s2 = _solset(f1, v), _solset(f2, v)
        if s1 is not None and s2 is not None:
            if s1 == s2:
                return "ok", None
            if s1 <= s2:
                return "ok-extra", "This step can introduce extra solutions: " + latex(FiniteSet(*(s2 - s1)))
            lost = s1 - s2
            return "error", "Solutions " + latex(FiniteSet(*lost)) + " of the previous line don't satisfy this one."
    if _is_zero(f1 - f2):
        return "ok", None
    if f2 != 0:
        try:
            k = simplify(f1 / f2)
            if not k.free_symbols and k != 0:
                return "ok", None
        except Exception:
            pass
    # Same equation after moving terms across? compare as polynomials-in-symbols
    try:
        if _is_zero(expand(f1) - expand(f2)) or _is_zero(expand(f1) + expand(f2)):
            return "ok", None
    except Exception:
        pass
    return "unchecked", None

lines = json.loads(_pn_lines)
vals = []
for line in lines:
    try:
        if line.get("kind") == "text" or not str(line.get("sympy", "")).strip():
            vals.append(None)
        else:
            vals.append(_val(line))
    except Exception:
        vals.append("ERR")

res = []
prev = None
for i, v in enumerate(vals):
    if v is None:
        res.append({"i": i, "status": "skip"})
        continue
    if v == "ERR":
        res.append({"i": i, "status": "unparsed"})
        continue
    if prev is None:
        res.append({"i": i, "status": "start"})
        prev = (i, v)
        continue
    pi, pv = prev
    entry = {"i": i, "from": pi}
    try:
        if pv[0] == "expr" and v[0] == "expr":
            ok, d = _equiv_expr(pv[1], v[1])
            if ok:
                entry["status"] = "ok"
            else:
                entry["status"] = "error"
                entry["diff"] = latex(d) if d is not None else ""
                entry["note"] = "These two lines are not equal."
        elif pv[0] == "eq" and v[0] == "eq":
            st, note = _step_eq(pv[1], pv[2], v[1], v[2])
            entry["status"] = st
            if note:
                entry["note"] = note
            if st == "error":
                entry["diff"] = ""
        else:
            entry["status"] = "unchecked"
    except Exception as ex:
        entry["status"] = "unchecked"
        entry["note"] = str(ex)[:120]
    res.append(entry)
    prev = (i, v)

json.dumps(res)
`;

export async function verifyWorking(lines: WorkingLine[], onStatus?: Status): Promise<StepResult[]> {
  count("stepcheck.run");
  const results = await evalPyJson<StepResult[]>(VERIFY, { _pn_lines: JSON.stringify(lines) }, ["sympy"], onStatus);
  // How often can we actually verify what the AI read? A high "unparsed" rate means the
  // reader's SymPy output is unreliable (a quality signal, not a crash).
  const maths = results.filter((r) => r.status !== "skip");
  const unparsed = maths.filter((r) => r.status === "unparsed").length;
  const unchecked = maths.filter((r) => r.status === "unchecked").length;
  track("stepcheck.lines", maths.length);
  track("stepcheck.unparsed", unparsed);
  track("stepcheck.unchecked", unchecked);
  if (maths.length && (unparsed + unchecked) / maths.length > 0.5) warn("stepcheck", "most lines could not be verified automatically", { lines: maths.length, unparsed, unchecked });
  return results;
}

/** Index of the first line that is verifiably wrong, or -1. */
export function firstError(results: StepResult[]): number {
  return results.findIndex((r) => r.status === "error");
}
