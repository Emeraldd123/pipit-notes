// LaTeX export, structured. The AI reads a page into ELEMENTS (headings, paragraphs, aligned working, tables,
// chemical equations, boxed definitions, figures with a bounding box and, when it could read a diagram completely,
// a redraw spec). Everything here turns those into LaTeX with fixed templates, so the AI never writes LaTeX
// structure itself and the document compiles. Pure (no DOM): unit-tested in node.

export type Frac = [number, number, number, number];

export type Redraw =
  | { kind: "plot"; xlabel: string; ylabel: string; xmin: number; xmax: number; ymin?: number; ymax?: number;
      curves: { expr?: string; points?: [number, number][]; label: string }[]; marks: { x: number; y: number; label: string }[] }
  | { kind: "chart"; type: "bar" | "line" | "pie"; categories: string[]; series: { name: string; values: number[] }[]; xlabel: string; ylabel: string }
  | { kind: "flow"; layout: "down" | "right" | "cycle"; nodes: { id: string; label: string }[]; edges: { from: string; to: string; label: string }[] }
  | { kind: "circuit"; parts: { type: string; label: string }[] };

export type El =
  | { t: "heading"; level: 1 | 2 | 3; text: string; y: number }
  | { t: "para"; text: string; y: number }
  | { t: "list"; ordered: boolean; items: string[]; y: number }
  | { t: "math"; lines: string[]; y: number }
  | { t: "chem"; lines: string[]; y: number }
  | { t: "table"; header: string[]; rows: string[][]; caption: string; y: number }
  | { t: "box"; title: string; text: string; y: number }
  | { t: "margin"; text: string; y: number }
  | { t: "figure"; id: string; bbox: Frac; caption: string; kind: string; redraw: Redraw | null; y: number }
  | { t: "raw"; latex: string; y: number }
  | { t: "code"; text: string; y: number };

export type LatexPage = { page: number; elements: El[] };
export type FigureChoice = "redraw" | "image";

// --- the page-reading prompt ---------------------------------------------------------------------------------------

export function latexSystem(inkOnly: boolean): string {
  return [
    "You convert ONE page of a student's notes (an image: handwriting, maybe over a printed PDF page) into structured content for a LaTeX document.",
    'Return STRICT JSON only: {"elements":[...]} in reading order. Every element has "y": the top of the element as a fraction of the page height (0 to 1).',
    "Element types:",
    '- {"t":"heading","level":1|2|3,"text":"..."} for titles and underlined or boxed headings (level 1 = page title).',
    '- {"t":"para","text":"..."} for ordinary sentences. Join lines of one paragraph.',
    '- {"t":"list","ordered":true|false,"items":["..."]} for bullets, dashes or numbered points (problem parts (a), (b) are an ordered list).',
    '- {"t":"math","lines":["..."]} for displayed equations and multi-line working: one LaTeX line per step, no $, with & before the relation so steps line up (e.g. "2x + 3 &= 7", "&= 4"). Matrices as \\begin{bmatrix}…\\end{bmatrix}, vectors as \\vec{v}.',
    '- {"t":"chem","lines":["2H2 + O2 -> 2H2O"]} for chemical equations in mhchem syntax without the \\ce{} wrapper (states as (aq), charges as Fe^3+, equilibrium as <=>).',
    '- {"t":"table","header":["..."],"rows":[["..."]],"caption":""} for any table or grid of values. Put units in the header ("Time (s)").',
    '- {"t":"box","title":"Definition|Key result|Note|…","text":"..."} for boxed, starred or clearly marked definitions and key results.',
    '- {"t":"margin","text":"..."} for side notes and margin notes (including the cue column of Cornell notes).',
    '- {"t":"figure","bbox":[x,y,w,h],"caption":"short description","kind":"drawing|plot|chart|flow|circuit|structure|photo","redraw":{…}|null} for any diagram, graph, sketch or picture. bbox is a tight box around the whole figure INCLUDING its labels, as fractions of the image from the top-left.',
    "Text fields: inline maths in $...$; chemical formulas in sentences as \\ce{H2O}; **bold** for underlined or emphasised words; ==text== for highlighted words.",
    "Transcribe exactly what is written: do NOT correct mistakes, summarise, or add content. Leave out crossed-out writing. Words inside a figure belong to the figure, not to the text.",
    'Redraw a figure ONLY when you can read it completely; otherwise "redraw": null (always null for free-hand drawings of cells, organisms, apparatus or anatomy, for molecule structures, and for photos):',
    ' plot: {"kind":"plot","xlabel":"","ylabel":"","xmin":-5,"xmax":5,"ymin":null,"ymax":null,"curves":[{"expr":"x^2 - 1","label":""}],"marks":[{"x":1,"y":0,"label":"root"}]} (expr uses x, explicit *, ^, sin cos tan exp ln sqrt abs pi; or "points":[[x,y],…] for plotted data)',
    ' chart: {"kind":"chart","type":"bar|line|pie","categories":["A","B"],"series":[{"name":"","values":[3,5]}],"xlabel":"","ylabel":""}',
    ' flow: {"kind":"flow","layout":"down|right|cycle","nodes":[{"id":"a","label":"Glucose"}],"edges":[{"from":"a","to":"b","label":""}]} for flowcharts, pathways, cycles and box-and-arrow diagrams',
    ' circuit: {"kind":"circuit","parts":[{"type":"battery|resistor|variable resistor|capacitor|lamp|switch|ammeter|diode|led|inductor|fuse","label":"10 Ω"}]} for a SINGLE series loop only, parts in order round the loop',
    inkOnly
      ? "There may be a printed page underneath: IGNORE all printed text and printed figures. Include only what the student wrote or drew."
      : "Include printed text and printed figures as well as the handwriting.",
    'A blank page returns {"elements":[]}.',
  ].join("\n");
}

// --- normalising the reply ---------------------------------------------------------------------------------------

const str = (v: unknown) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");
const num = (v: unknown): number | undefined => { const n = typeof v === "string" ? Number(v) : v; return typeof n === "number" && Number.isFinite(n) ? n : undefined; };
const fracY = (v: unknown) => Math.max(0, Math.min(1, num(v) ?? 0));
const strs = (v: unknown) => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);

function normalizeRedraw(r: unknown): Redraw | null {
  if (!r || typeof r !== "object") return null;
  const o = r as Record<string, unknown>;
  if (o.kind === "plot") {
    const curves = (Array.isArray(o.curves) ? o.curves : []).map((c) => {
      const expr = pgfExpr(str(c?.expr));
      const points = (Array.isArray(c?.points) ? c.points : []).map((p: unknown) => (Array.isArray(p) ? [num(p[0]), num(p[1])] : [])).filter((p: (number | undefined)[]): p is [number, number] => p.length === 2 && p.every((x) => x !== undefined));
      return { expr: expr ?? undefined, points: points.length ? points : undefined, label: str(c?.label) };
    }).filter((c) => c.expr || c.points);
    if (!curves.length) return null;
    const xs = curves.flatMap((c) => (c.points as [number, number][] | undefined)?.map((p) => p[0]) ?? []);
    let xmin = num(o.xmin) ?? (xs.length ? Math.min(...xs) : -5), xmax = num(o.xmax) ?? (xs.length ? Math.max(...xs) : 5);
    if (!(xmax > xmin)) { xmin = -5; xmax = 5; }
    const ymin = num(o.ymin), ymax = num(o.ymax);
    const marks = (Array.isArray(o.marks) ? o.marks : []).map((m) => ({ x: num(m?.x), y: num(m?.y), label: str(m?.label) })).filter((m): m is { x: number; y: number; label: string } => m.x !== undefined && m.y !== undefined);
    return { kind: "plot", xlabel: str(o.xlabel), ylabel: str(o.ylabel), xmin, xmax, ymin: ymin !== undefined && ymax !== undefined && ymax > ymin ? ymin : undefined, ymax: ymin !== undefined && ymax !== undefined && ymax > ymin ? ymax : undefined, curves, marks };
  }
  if (o.kind === "chart") {
    const categories = strs(o.categories);
    const series = (Array.isArray(o.series) ? o.series : []).map((s) => ({ name: str(s?.name), values: (Array.isArray(s?.values) ? s.values : []).map(num) }))
      .filter((s) => s.values.length === categories.length && s.values.every((v: number | undefined) => v !== undefined)) as { name: string; values: number[] }[];
    if (!categories.length || !series.length) return null;
    const type = o.type === "line" || o.type === "pie" ? o.type : "bar";
    return { kind: "chart", type, categories, series: type === "pie" ? series.slice(0, 1) : series, xlabel: str(o.xlabel), ylabel: str(o.ylabel) };
  }
  if (o.kind === "flow") {
    const nodes = (Array.isArray(o.nodes) ? o.nodes : []).map((n) => ({ id: str(n?.id), label: str(n?.label) })).filter((n) => n.id && n.label);
    const ids = new Set(nodes.map((n) => n.id));
    const edges = (Array.isArray(o.edges) ? o.edges : []).map((e) => ({ from: str(e?.from), to: str(e?.to), label: str(e?.label) })).filter((e) => ids.has(e.from) && ids.has(e.to) && e.from !== e.to);
    if (nodes.length < 2 || new Set(nodes.map((n) => n.id)).size !== nodes.length) return null;
    return { kind: "flow", layout: o.layout === "right" || o.layout === "cycle" ? o.layout : "down", nodes, edges };
  }
  if (o.kind === "circuit") {
    const parts = (Array.isArray(o.parts) ? o.parts : []).map((p) => ({ type: str(p?.type).toLowerCase(), label: str(p?.label) }));
    if (parts.length < 2 || !parts.every((p) => CIRCUIT[p.type])) return null;
    return { kind: "circuit", parts };
  }
  return null;
}

/** The model's reply for one page -> clean elements (anything malformed is dropped, not guessed at). */
export function normalizeLatexPage(raw: unknown, page: number): LatexPage {
  const list = Array.isArray((raw as { elements?: unknown })?.elements) ? (raw as { elements: unknown[] }).elements : [];
  const out: El[] = [];
  let fig = 0;
  for (const e of list) {
    if (!e || typeof e !== "object") continue;
    const o = e as Record<string, unknown>;
    const y = fracY(o.y);
    switch (o.t) {
      case "heading": { const text = str(o.text); if (text) out.push({ t: "heading", level: o.level === 2 || o.level === 3 ? o.level : 1, text, y }); break; }
      case "para": { const text = str(o.text); if (text) out.push({ t: "para", text, y }); break; }
      case "list": { const items = strs(o.items); if (items.length) out.push({ t: "list", ordered: o.ordered === true, items, y }); break; }
      case "math": { const lines = strs(o.lines).map((l) => l.replace(/^\$+|\$+$/g, "").trim()).filter(Boolean); if (lines.length) out.push({ t: "math", lines, y }); break; }
      case "chem": { const lines = strs(o.lines).map((l) => l.replace(/^\\ce\{([\s\S]*)\}$/, "$1")); if (lines.length) out.push({ t: "chem", lines, y }); break; }
      case "table": {
        const header = strs(o.header);
        const rows = (Array.isArray(o.rows) ? o.rows : []).map((r) => (Array.isArray(r) ? r.map(str) : [])).filter((r) => r.some(Boolean));
        if (rows.length || header.length) out.push({ t: "table", header, rows, caption: str(o.caption), y });
        break;
      }
      case "box": { const text = str(o.text); if (text) out.push({ t: "box", title: str(o.title), text, y }); break; }
      case "margin": { const text = str(o.text); if (text) out.push({ t: "margin", text, y }); break; }
      case "figure": {
        const b = Array.isArray(o.bbox) ? o.bbox.map(num) : [];
        if (b.length !== 4 || b.some((v) => v === undefined)) break;
        const [x0, y0, w, h] = b as number[];
        const bx = Math.max(0, Math.min(1, x0)), by = Math.max(0, Math.min(1, y0));
        const bbox: Frac = [bx, by, Math.min(1 - bx, Math.max(0, w)), Math.min(1 - by, Math.max(0, h))];
        if (bbox[2] < 0.02 || bbox[3] < 0.01) break;
        fig++;
        out.push({ t: "figure", id: `p${page + 1}-f${fig}`, bbox, caption: str(o.caption), kind: str(o.kind) || "drawing", redraw: normalizeRedraw(o.redraw), y: num(o.y) !== undefined ? y : bbox[1] });
        break;
      }
    }
  }
  return { page, elements: out };
}

// --- text ------------------------------------------------------------------------------------------------------------

const SPECIAL: Record<string, string> = {
  "\\": "\\textbackslash{}", "&": "\\&", "%": "\\%", "#": "\\#", "_": "\\_", "{": "\\{", "}": "\\}",
  "~": "\\textasciitilde{}", "^": "\\textasciicircum{}", "$": "\\$",
};
// symbols people write that pdflatex can't print as plain text
const UNICODE: Record<string, string> = {
  "Ω": "$\\Omega$", "µ": "$\\mu$", "μ": "$\\mu$", "°": "$^\\circ$", "→": "$\\rightarrow$", "←": "$\\leftarrow$", "⇌": "$\\rightleftharpoons$",
  "±": "$\\pm$", "×": "$\\times$", "÷": "$\\div$", "≤": "$\\leq$", "≥": "$\\geq$", "≈": "$\\approx$", "≠": "$\\neq$", "∞": "$\\infty$",
  "Δ": "$\\Delta$", "δ": "$\\delta$", "α": "$\\alpha$", "β": "$\\beta$", "γ": "$\\gamma$", "θ": "$\\theta$", "λ": "$\\lambda$", "π": "$\\pi$",
  "σ": "$\\sigma$", "ρ": "$\\rho$", "ε": "$\\varepsilon$", "∑": "$\\sum$", "√": "$\\surd$", "²": "$^2$", "³": "$^3$", "·": "$\\cdot$", "−": "-",
  "•": "", "…": "\\ldots{}", "“": "``", "”": "''", "‘": "`", "’": "'", "–": "--", "—": "---",
};
const escapeText = (s: string) => s.replace(/[\\&%#_{}~^$]/g, (c) => SPECIAL[c]).replace(/[ΩµμΩ°→←⇌±×÷≤≥≈≠∞Δδαβγθλπσρε∑√²³·−•…“”‘’–—]/g, (c) => UNICODE[c] ?? c);

// math ($…$ / $$…$$), \ce{…} (one level of nested braces) and \textbf{…}-style commands pass through untouched
const VERBATIM = /(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$|\\ce\{(?:[^{}]|\{[^{}]*\})*\})/g;

/** A line of model text -> LaTeX: plain text escaped; maths and \ce{} kept; **bold** and ==highlight== converted. */
export function rich(s: string): string {
  const parts = s.split(VERBATIM);
  const out = parts.map((p, i) => (i % 2 === 1 ? p : escapeText(p.replace(/->/g, "→").replace(/<-/g, "←")))).join("");
  return out
    .replace(/\*\*(.+?)\*\*/g, "\\textbf{$1}")
    .replace(/==(.+?)==/g, (_, t: string) => (t.includes("$") || t.includes("\\ce") ? `\\textbf{${t}}` : `\\hl{${t}}`));
}

const RELATION = /(\\leq|\\geq|\\neq|\\approx|\\Rightarrow|\\implies|\\to|\\equiv|<=|>=|=|<|>)/;

/** Steps of working -> an aligned display (lined up at the first relation of each line). */
export function mathToLatex(lines: string[]): string {
  if (lines.length === 1 && !lines[0].includes("&")) return `\\[\n${lines[0]}\n\\]`;
  const aligned = lines.map((l) => {
    if (l.includes("&") || l.includes("\\begin")) return l;
    const m = RELATION.exec(l);
    return m ? `${l.slice(0, m.index)}&${l.slice(m.index)}` : `&${l}`;
  });
  return `\\begin{align*}\n${aligned.join(" \\\\\n")}\n\\end{align*}`;
}

const NUMERIC = /^[-+−]?\s*\$?[\d.,]+(\s*(×|\\times)\s*10\^?\{?[-−]?\d+\}?)?\$?\s*%?$/;

export function tableToLatex(el: { header: string[]; rows: string[][]; caption: string }): string {
  const cols = Math.max(el.header.length, ...el.rows.map((r) => r.length), 1);
  const pad = (r: string[]) => [...r, ...Array(cols - r.length).fill("")];
  const spec = Array.from({ length: cols }, (_, c) => (el.rows.length && el.rows.every((r) => !r[c] || NUMERIC.test(r[c])) ? "r" : "l")).join("");
  const row = (r: string[]) => pad(r).map(rich).join(" & ") + " \\\\";
  return [
    "\\begin{table}[H]", "\\centering",
    ...(el.caption ? [`\\caption{${rich(el.caption)}}`] : []),
    `\\begin{tabular}{${spec}}`, "\\toprule",
    ...(el.header.length ? [pad(el.header).map((h) => `\\textbf{${rich(h)}}`).join(" & ") + " \\\\", "\\midrule"] : []),
    ...el.rows.map(row),
    "\\bottomrule", "\\end{tabular}", "\\end{table}",
  ].join("\n");
}

// --- redraws ---------------------------------------------------------------------------------------------------------

const FUNCS = new Set(["sin", "cos", "tan", "exp", "ln", "sqrt", "abs", "pi", "x", "log10", "asin", "acos", "atan", "sinh", "cosh", "tanh"]);

/** A typed function of x -> pgfplots syntax, or null if it contains anything we can't vouch for. */
export function pgfExpr(input: string): string | null {
  let s = input.trim().replace(/^\s*(y|f\s*\(\s*x\s*\))\s*=\s*/i, "").replace(/\*\*/g, "^").replace(/−/g, "-").replace(/π/g, "pi").replace(/\s+/g, "");
  if (!s || s.includes("=")) return null;
  s = s.replace(/\|([^|]+)\|/g, "abs($1)").replace(/\blog\(/g, "log10(");
  s = s.replace(/\be\^\(([^()]*)\)/g, "exp($1)").replace(/\be\^(-?[\w.]+)/g, "exp($1)").replace(/\be\b/g, "exp(1)");
  s = s.replace(/(\d)([a-z(])/gi, "$1*$2").replace(/\)(\(|[a-z\d])/gi, ")*$1").replace(/\bx\(/g, "x*(").replace(/\bx(\d)/g, "x*$1");
  if (!/^[0-9a-z+\-*/^().,]+$/i.test(s)) return null;
  for (const w of s.match(/[a-z]+\d*/gi) ?? []) if (!FUNCS.has(w.toLowerCase())) return null;
  let depth = 0;
  for (const c of s) { depth += c === "(" ? 1 : c === ")" ? -1 : 0; if (depth < 0) return null; }
  return depth === 0 ? s : null;
}

const COLORS = ["blue", "red", "green!50!black", "orange", "violet", "teal"];
const fmt = (n: number) => String(Math.round(n * 1000) / 1000);

function plotToLatex(r: Extract<Redraw, { kind: "plot" }>): string {
  const crossesX = r.xmin < 0 && r.xmax > 0, crossesY = r.ymin === undefined || (r.ymin < 0 && (r.ymax ?? 1) > 0);
  const opts = [
    "width=0.7\\linewidth", "height=0.45\\linewidth", `axis lines=${crossesX && crossesY ? "middle" : "left"}`,
    `xmin=${fmt(r.xmin)}`, `xmax=${fmt(r.xmax)}`, ...(r.ymin !== undefined && r.ymax !== undefined ? [`ymin=${fmt(r.ymin)}`, `ymax=${fmt(r.ymax)}`] : []),
    `domain=${fmt(r.xmin)}:${fmt(r.xmax)}`, "samples=200", "trig format plots=rad", "restrict y to domain=-1e3:1e3",
    ...(r.xlabel ? [`xlabel={${rich(r.xlabel)}}`] : []), ...(r.ylabel ? [`ylabel={${rich(r.ylabel)}}`] : []),
    ...(r.curves.some((c) => c.label) ? ["legend pos=outer north east"] : []),
  ];
  const plots = r.curves.flatMap((c, i) => {
    const col = COLORS[i % COLORS.length];
    const line = c.expr ? `\\addplot[thick, ${col}] {${c.expr}};` : `\\addplot[${col}, mark=*, ${c.points!.length > 12 ? "only marks" : "thick"}] coordinates {${c.points!.map(([x, y]) => `(${fmt(x)},${fmt(y)})`).join(" ")}};`;
    return c.label ? [line, `\\addlegendentry{${rich(c.label)}}`] : [line];
  });
  const marks = r.marks.map((m) => `\\node[circle, fill, inner sep=1.5pt, label={[font=\\small]above right:${rich(m.label)}}] at (axis cs:${fmt(m.x)},${fmt(m.y)}) {};`);
  return ["\\begin{tikzpicture}", `\\begin{axis}[${opts.join(", ")}]`, ...plots, ...marks, "\\end{axis}", "\\end{tikzpicture}"].join("\n");
}

function chartToLatex(r: Extract<Redraw, { kind: "chart" }>): string {
  if (r.type === "pie") return `\\begin{tikzpicture}\n\\pie[radius=2.4, text=legend]{${r.series[0].values.map((v, i) => `${fmt(v)}/${rich(r.categories[i]).replace(/[,/]/g, " ")}`).join(", ")}}\n\\end{tikzpicture}`;
  const coords = r.categories.map((c, i) => `c${i}`);
  const opts = [
    "width=0.75\\linewidth", "height=0.45\\linewidth", ...(r.type === "bar" ? ["ybar", "bar width=12pt", "ymin=0", "enlarge x limits=0.15"] : []),
    `symbolic x coords={${coords.join(",")}}`, "xtick=data", `xticklabels={${r.categories.map((c) => `{${rich(c)}}`).join(",")}}`,
    ...(r.xlabel ? [`xlabel={${rich(r.xlabel)}}`] : []), ...(r.ylabel ? [`ylabel={${rich(r.ylabel)}}`] : []),
    ...(r.series.length > 1 || r.series[0].name ? ["legend pos=outer north east"] : []),
  ];
  const plots = r.series.flatMap((s, i) => {
    const line = `\\addplot[${r.type === "bar" ? `fill=${COLORS[i % COLORS.length]}!60, draw=${COLORS[i % COLORS.length]}` : `thick, mark=*, ${COLORS[i % COLORS.length]}`}] coordinates {${s.values.map((v, k) => `(${coords[k]},${fmt(v)})`).join(" ")}};`;
    return s.name ? [line, `\\addlegendentry{${rich(s.name)}}`] : [line];
  });
  return ["\\begin{tikzpicture}", `\\begin{axis}[${opts.join(", ")}]`, ...plots, "\\end{axis}", "\\end{tikzpicture}"].join("\n");
}

/** Layers for a box-and-arrow diagram: each node one layer below the furthest node pointing to it (cycles broken). */
export function flowLayers(nodes: { id: string }[], edges: { from: string; to: string }[]): Map<string, number> {
  const layer = new Map(nodes.map((n) => [n.id, 0]));
  const back = new Set<string>();
  const state = new Map<string, 1 | 2>();
  const visit = (id: string) => {   // find edges that close a cycle so they don't push layers forever
    state.set(id, 1);
    for (const e of edges.filter((x) => x.from === id)) {
      if (state.get(e.to) === 1) back.add(`${e.from}>${e.to}`);
      else if (!state.has(e.to)) visit(e.to);
    }
    state.set(id, 2);
  };
  for (const n of nodes) if (!state.has(n.id)) visit(n.id);
  const fwd = edges.filter((e) => !back.has(`${e.from}>${e.to}`));
  for (let k = 0; k < nodes.length; k++) for (const e of fwd) layer.set(e.to, Math.max(layer.get(e.to)!, layer.get(e.from)! + 1));
  return layer;
}

function flowToLatex(r: Extract<Redraw, { kind: "flow" }>): string {
  const id = new Map(r.nodes.map((n, i) => [n.id, `n${i}`]));
  const pos = new Map<string, [number, number]>();
  if (r.layout === "cycle") {
    const rad = Math.max(2.4, r.nodes.length * 0.62);
    r.nodes.forEach((n, i) => { const a = Math.PI / 2 - (2 * Math.PI * i) / r.nodes.length; pos.set(n.id, [rad * Math.cos(a), rad * Math.sin(a)]); });
  } else {
    const layers = flowLayers(r.nodes, r.edges);
    const byLayer = new Map<number, string[]>();
    for (const n of r.nodes) { const l = layers.get(n.id)!; byLayer.set(l, [...(byLayer.get(l) ?? []), n.id]); }
    for (const [l, ids] of byLayer) ids.forEach((nid, k) => {
      const across = (k - (ids.length - 1) / 2) * 3.4, along = -l * 1.9;
      pos.set(nid, r.layout === "down" ? [across, along] : [-along * 1.9, -across * 0.6]);
    });
  }
  const nodes = r.nodes.map((n) => { const [x, y] = pos.get(n.id)!; return `\\node[box] (${id.get(n.id)}) at (${fmt(x)},${fmt(y)}) {${rich(n.label)}};`; });
  const edges = r.edges.map((e) => `\\draw[-{Stealth[length=2.5mm]}, thick${r.layout === "cycle" ? ", bend left=12" : ""}] (${id.get(e.from)}) to${e.label ? ` node[midway, fill=white, font=\\scriptsize, inner sep=1pt] {${rich(e.label)}}` : ""} (${id.get(e.to)});`);
  return ["\\begin{tikzpicture}[box/.style={draw, rounded corners, align=center, text width=2.6cm, font=\\small, inner sep=4pt, fill=gray!5}]", ...nodes, ...edges, "\\end{tikzpicture}"].join("\n");
}

const CIRCUIT: Record<string, string> = {
  battery: "battery1", cell: "battery1", resistor: "R", "variable resistor": "vR", capacitor: "C", lamp: "lamp", bulb: "lamp",
  switch: "nos", ammeter: "ammeter", diode: "D", led: "leD", inductor: "L", fuse: "fuse",
};

function circuitToLatex(r: Extract<Redraw, { kind: "circuit" }>): string {
  // a rectangle traced clockwise from the bottom-left corner, with the parts spread along its sides in order
  const W = 6, H = 3.6, corners: [number, number][] = [[0, 0], [0, H], [W, H], [W, 0], [0, 0]];
  const n = r.parts.length;
  const per = [0, 0, 0, 0];
  for (let i = 0; i < n; i++) per[[1, 3, 0, 2][i % 4]]++;   // top, bottom, left, right, …
  const segs: string[] = [];
  let k = 0;
  for (let side = 0; side < 4; side++) {
    const [ax, ay] = corners[side], [bx, by] = corners[side + 1];
    const m = per[side];
    if (!m) { segs.push(`to[short] (${fmt(bx)},${fmt(by)})`); continue; }
    for (let j = 1; j <= m; j++) {
      const p = r.parts[k++];
      const t = j / (m + 1), cx = ax + (bx - ax) * t, cy = ay + (by - ay) * t;
      const half = 0.55 * Math.sign(bx - ax || by - ay);
      const [sx, sy] = bx !== ax ? [cx - half, cy] : [cx, cy - half];
      const [ex, ey] = bx !== ax ? [cx + half, cy] : [cx, cy + half];
      const label = p.label ? `, l=${p.label.includes("$") ? p.label : rich(p.label)}` : "";
      segs.push(`to[short] (${fmt(sx)},${fmt(sy)}) to[${CIRCUIT[p.type]}${label}] (${fmt(ex)},${fmt(ey)})`);
    }
    segs.push(`to[short] (${fmt(bx)},${fmt(by)})`);
  }
  return ["\\begin{circuitikz}", `\\draw (0,0) ${segs.join("\n  ")};`, "\\end{circuitikz}"].join("\n");
}

export function redrawToLatex(r: Redraw): string {
  return r.kind === "plot" ? plotToLatex(r) : r.kind === "chart" ? chartToLatex(r) : r.kind === "flow" ? flowToLatex(r) : circuitToLatex(r);
}

/** Graph blocks typed in the app ("y = x^2" per line) -> a plot redraw, if every line is a function of x. */
export function graphBlockRedraw(text: string): Redraw | null {
  const exprs = text.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => (/^\s*(y|f\s*\(\s*x\s*\))\s*=/i.test(l) ? pgfExpr(l) : null));
  if (!exprs.length || exprs.some((e) => !e)) return null;
  return { kind: "plot", xlabel: "$x$", ylabel: "$y$", xmin: -5, xmax: 5, curves: exprs.map((e, i) => ({ expr: e!, label: exprs.length > 1 ? `$${text.split("\n").filter((l) => l.trim())[i].trim()}$` : "" })), marks: [] };
}

/** A block typed in the app (maths, text, code, graph) -> an element at height `y` on its page. */
export function blockToElement(b: { kind: string; text: string }, y: number): El | null {
  const t = b.text.trim();
  if (!t) return null;
  if (b.kind === "math") return { t: "raw", latex: t.includes("\\begin{") ? t : `\\[\n${t}\n\\]`, y };
  if (b.kind === "text") return { t: "para", text: t, y };
  if (b.kind === "code") return { t: "code", text: b.text.replace(/\s+$/, ""), y };
  if (b.kind === "graph") {
    const r = graphBlockRedraw(t);
    return r ? { t: "raw", latex: ["\\begin{figure}[H]", "\\centering", redrawToLatex(r), "\\end{figure}"].join("\n"), y } : null;
  }
  return null;
}

// --- the document -------------------------------------------------------------------------------------------------

export const figurePath = (id: string) => `figures/${id}.png`;

function elementToLatex(el: El, choice: (id: string) => FigureChoice): string {
  switch (el.t) {
    case "heading": return `\\${el.level === 1 ? "section" : el.level === 2 ? "subsection" : "subsubsection"}*{${rich(el.text)}}`;
    case "para": return rich(el.text);
    case "list": return [`\\begin{${el.ordered ? "enumerate" : "itemize"}}`, ...el.items.map((i) => `  \\item ${rich(i)}`), `\\end{${el.ordered ? "enumerate" : "itemize"}}`].join("\n");
    case "math": return mathToLatex(el.lines);
    case "chem": return ["\\begin{center}", el.lines.map((l) => `\\ce{${l}}`).join(" \\\\\n"), "\\end{center}"].join("\n");
    case "table": return tableToLatex(el);
    case "box": return [`\\begin{tcolorbox}[colback=blue!3, colframe=blue!45!black${el.title ? `, title={${rich(el.title)}}` : ""}]`, rich(el.text), "\\end{tcolorbox}"].join("\n");
    case "margin": return `\\marginpar{\\footnotesize ${rich(el.text)}}`;
    case "raw": return el.latex;
    case "code": return ["\\begin{verbatim}", el.text.replace(/\\end\{verbatim\}/g, "\\end {verbatim}"), "\\end{verbatim}"].join("\n");
    case "figure": {
      const width = Math.max(0.3, Math.min(0.9, el.bbox[2] * 1.05));
      const img = `\\includegraphics[width=${fmt(width)}\\linewidth]{${figurePath(el.id)}}`;
      const redrawn = el.redraw && choice(el.id) === "redraw";
      const body = redrawn ? [redrawToLatex(el.redraw!), `% Your original drawing (swap it in by removing the % and deleting the drawing above):`, `% ${img}`] : [img];
      return ["\\begin{figure}[H]", "\\centering", ...body, ...(el.caption ? [`\\caption{${rich(el.caption)}}`] : []), "\\end{figure}"].join("\n");
    }
  }
}

function packagesFor(pages: LatexPage[], choice: (id: string) => FigureChoice): string[] {
  const els = pages.flatMap((p) => p.elements);
  const redraws = els.flatMap((e) => (e.t === "figure" && e.redraw && choice(e.id) === "redraw" ? [e.redraw] : []));
  const raw = els.flatMap((e) => (e.t === "raw" ? [e.latex] : [])).join("\n");
  if (/\\begin\{axis\}/.test(raw)) redraws.push({ kind: "plot", xlabel: "", ylabel: "", xmin: 0, xmax: 1, curves: [], marks: [] });   // a graph block's plot
  return [
    "\\usepackage[utf8]{inputenc}", "\\usepackage[T1]{fontenc}", "\\usepackage{amsmath,amssymb}", "\\usepackage[margin=1in]{geometry}",
    "\\usepackage{graphicx}", "\\usepackage{float}", "\\usepackage{booktabs}", "\\usepackage[version=4]{mhchem}", "\\usepackage{xcolor}", "\\usepackage{soul}",
    ...(els.some((e) => e.t === "box") ? ["\\usepackage{tcolorbox}"] : []),
    ...(redraws.length ? ["\\usepackage{tikz}", "\\usetikzlibrary{arrows.meta}"] : []),
    ...(redraws.some((r) => r.kind === "plot" || (r.kind === "chart" && r.type !== "pie")) ? ["\\usepackage{pgfplots}", "\\pgfplotsset{compat=1.18}"] : []),
    ...(redraws.some((r) => r.kind === "chart" && r.type === "pie") ? ["\\usepackage{pgf-pie}"] : []),
    ...(redraws.some((r) => r.kind === "circuit") ? ["\\usepackage{circuitikz}"] : []),
  ];
}

export function buildLatexDoc(title: string, pages: LatexPage[], choice: (id: string) => FigureChoice = () => "redraw"): string {
  const body = pages
    .filter((p) => p.elements.length)
    .map((p, i) => [`${i ? "\\newpage\n" : ""}% --- page ${p.page + 1} ---`, ...[...p.elements].sort((a, b) => a.y - b.y).map((e) => elementToLatex(e, choice))].join("\n\n"))
    .join("\n\n");
  return [
    "\\documentclass[11pt]{article}",
    ...packagesFor(pages, choice),
    "\\setlength{\\parindent}{0pt}", "\\setlength{\\parskip}{6pt}",
    `\\title{${rich(title)}}`, "\\date{}",
    "\\begin{document}", "\\maketitle", "",
    body || "% (nothing readable on these pages)",
    "", "\\end{document}", "",
  ].join("\n");
}
