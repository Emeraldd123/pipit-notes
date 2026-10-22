// Reading JSON out of a model reply, forgivingly. Models often (a) write LaTeX inside JSON strings with
// single backslashes ("\Delta", "\frac") which is invalid JSON — or, worse, valid-but-wrong ("\frac" parses as
// a form-feed + "rac"), and (b) get cut off mid-reply on long outputs like exams. Pure + unit-tested.

// LaTeX commands starting with a letter that JSON also treats as an escape (\b \f \n \r \t).
const LATEX_ESCAPE_LOOKALIKES =
  /^(?:frac|dfrac|tfrac|times|theta|beta|right|rightarrow|tau|text|textbf|textit|tan|tanh|tilde|to|nu|neq|ne|nabla|neg|binom|bar|begin|bf|rho|rm|bigl|bigr|boldsymbol|bullet|because|not|notin|ni|noindent|nolimits)(?![a-zA-Z])/;

/** Double every backslash that isn't a genuine JSON escape (so LaTeX survives), including "\frac"-style look-alikes. */
export function escapeLatexBackslashes(raw: string): string {
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (c !== "\\") { out += c; continue; }
    const n = raw[i + 1];
    if (n === undefined) { out += "\\\\"; continue; }
    if (n === '"' || n === "\\" || n === "/") { out += c + n; i++; continue; }
    if (n === "u" && /^[0-9a-fA-F]{4}$/.test(raw.slice(i + 2, i + 6))) { out += raw.slice(i, i + 6); i += 5; continue; }
    if ("bfnrt".includes(n)) {
      if (LATEX_ESCAPE_LOOKALIKES.test(raw.slice(i + 1))) { out += "\\\\"; continue; }   // \frac, \times … are LaTeX
      out += c + n; i++; continue;                                                          // a real \n, \t …
    }
    out += "\\\\";                                                                          // \Delta, \sqrt, \( …
  }
  return out;
}

/** Close a truncated JSON document after its last complete element, so everything before the cut-off survives. */
export function salvageTruncated(s: string): string | null {
  const stack: string[] = [];
  let inStr = false, esc = false, best = -1, bestStack: string[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === "{" || c === "[") stack.push(c);
    else if (c === "}" || c === "]") { stack.pop(); if (stack.length >= 1) { best = i + 1; bestStack = [...stack]; } }
  }
  if (best < 0) return null;
  return s.slice(0, best) + bestStack.reverse().map((o) => (o === "{" ? "}" : "]")).join("");
}

export class JsonReplyError extends Error {
  truncated: boolean;
  constructor(message: string, truncated: boolean) { super(message); this.name = "JsonReplyError"; this.truncated = truncated; }
}

/** Pull the first JSON object/array out of a reply (tolerates ``` fences, chatter, LaTeX backslashes, truncation). */
export function parseModelJson<T>(raw: string): T {
  const start = raw.search(/[{[]/);
  if (start < 0) throw new JsonReplyError("The model didn't return structured data.", false);
  const open = raw[start], close = open === "{" ? "}" : "]";
  const end = raw.lastIndexOf(close);
  const whole = escapeLatexBackslashes(raw.slice(start));
  const slice = end > start ? escapeLatexBackslashes(raw.slice(start, end + 1)) : whole;
  try { return JSON.parse(slice) as T; } catch { /* try harder below */ }
  const fixed = salvageTruncated(whole);
  if (fixed) { try { return JSON.parse(fixed) as T; } catch { /* fall through */ } }
  const truncated = end <= start || !/[}\]]\s*(```)?\s*$/.test(raw.trim());
  throw new JsonReplyError(truncated ? "The model's reply was cut off." : "Couldn't parse the model's reply.", truncated);
}
