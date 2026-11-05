// Automatic checks on exam diagrams (pure; tests/diagram-checks.test.mjs). They catch the mechanical faults a reader
// would notice at once: icons that don't exist, things outside the frame, icons piled on each other or too small to
// see, letters the question mentions that the diagram doesn't show, and labels that give the answer away.
import { iconName } from "../src/lib/figure-core.ts";

const diagramsOf = (q) => [q.figure, ...q.parts.map((p) => p.figure)].filter((f) => f?.type === "diagram");

function box(e) {
  switch (e.t) {
    case "icon": case "rect": return { x: e.x, y: e.y, w: e.w, h: e.h };
    case "line": return { x: Math.min(e.x1, e.x2), y: Math.min(e.y1, e.y2), w: Math.abs(e.x2 - e.x1), h: Math.abs(e.y2 - e.y1) };
    case "circle": case "arc": return { x: e.cx - e.r, y: e.cy - e.r, w: 2 * e.r, h: 2 * e.r };
    case "poly": { const xs = e.points.map((p) => p[0]), ys = e.points.map((p) => p[1]); return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }; }
    case "text": case "point": return { x: e.x, y: e.y, w: 0, h: 0 };
    default: return null;
  }
}
/** share of the smaller box covered by the other */
function covered(a, b) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? (w * h) / Math.max(1, Math.min(a.w * a.h, b.w * b.h)) : 0;
}

const labelsOf = (f) => f.elements.flatMap((e) => [e.label, e.t === "text" ? e.text : undefined]).filter(Boolean).map(String);
// "structure X", "region Y", "the arrow labelled P", "at A"…: single capital letters the question points at
const REF = /\b(?:structure|region|label(?:led)?|part|area|organ|organelle|cell|point|arrow|line|position|compartment|molecule|box|layer|site|location|tube|flask|vessel|chamber|side|stage|step|solution|beaker)\s+([A-HJ-Z])\b/g;

/** Checks for one question's diagrams. */
export function checkQuestion(q) {
  const out = { diagrams: 0, icons: [], flags: [] };
  for (const f of diagramsOf(q)) {
    out.diagrams++;
    const icons = f.elements.filter((e) => e.t === "icon");
    out.icons.push(...icons.map((e) => e.name));
    for (const e of f.elements) {
      const b = box(e);
      if (b && (b.x < -4 || b.y < -4 || b.x + b.w > f.width + 4 || b.y + b.h > f.height + 4)) out.flags.push(`${e.t}${e.name ? ` "${e.name}"` : e.label ? ` "${e.label}"` : ""} goes outside the frame`);
    }
    for (const e of icons) if (e.w < 28 || e.h < 28) out.flags.push(`icon "${e.name}" is too small to see (${Math.round(e.w)}×${Math.round(e.h)})`);
    for (let i = 0; i < icons.length; i++) for (let j = i + 1; j < icons.length; j++) if (covered(icons[i], icons[j]) > 0.5) out.flags.push(`icons "${icons[i].name}" and "${icons[j].name}" are drawn on top of each other`);
    const labels = labelsOf(f);
    const letters = new Set(labels.flatMap((l) => l.match(/\b[A-Z]\b/g) ?? []));
    const text = [q.stem, ...q.parts.map((p) => p.prompt)].join(" ");
    const refs = new Set([...text.matchAll(REF)].map((m) => m[1]));
    for (const r of refs) if (!letters.has(r)) out.flags.push(`the question mentions "${r}" but the diagram has no label ${r}`);
    // a part that asks to name/identify something whose answer is already written on the diagram
    for (const p of q.parts) {
      if (!/\b(name|identify|which (structure|organelle|organ|cell|part))\b/i.test(p.prompt)) continue;
      const ans = String(p.answer).toLowerCase();
      const give = labels.filter((l) => l.length >= 4 && ans.includes(l.toLowerCase()));
      if (give.length) out.flags.push(`part ${p.label || "-"} asks to name something the diagram already labels ("${give[0]}")`);
      // …or describes in a key ("X: folded inner membrane") or in the stem ("X is the stack of discs")
      for (const letter of new Set([...p.prompt.matchAll(/\b([A-HJ-Z])\b/g)].map((m) => m[1]))) {
        if (labels.some((l) => new RegExp(`^${letter}\\s*[:=–-]\\s*\\S{3,}`).test(l))) out.flags.push(`the diagram describes ${letter} in a key, but part ${p.label || "-"} asks the student to name it`);
        if (new RegExp(`\\b${letter} is (the|a|an)\\b`).test(q.stem)) out.flags.push(`the stem describes ${letter}, but part ${p.label || "-"} asks the student to name it`);
      }
    }
    // numbers the question says the diagram shows
    if (/\b(shown|given|marked|measured)\b[^.]*\b(diagram|figure)\b|\b(diagram|figure)\b[^.]*\b(distances?|readings?|values?|in mm|in cm)\b/i.test(text) && !labels.some((l) => /\d/.test(l))) {
      out.flags.push("the question says values are shown in the diagram, but the diagram has no numbers");
    }
    // arrows used to point at letters, and text sitting on lines
    const letterTexts = f.elements.filter((e) => e.t === "text" && /^[A-Z]$/.test(e.text.trim()));
    for (const e of f.elements) if (e.t === "line" && e.arrow && letterTexts.some((t) => Math.hypot(t.x - e.x2, t.y - e.y2) < 26)) out.flags.push(`an arrow points at the letter "${letterTexts.find((t) => Math.hypot(t.x - e.x2, t.y - e.y2) < 26).text}" instead of at the structure`);
    for (const t of f.elements.filter((e) => e.t === "text" && e.text.trim().length > 1)) {
      const b = textBox(t);
      const hit = f.elements.find((e) => e !== t && crossesOutline(e, b));
      if (hit) out.flags.push(`text "${t.text.slice(0, 20)}" sits on a ${hit.t === "line" ? "line" : `${hit.t} outline`}`);
    }
    for (const e of f.elements) if (e.t === "label" && e.unknownPart) out.flags.push(`label "${e.text}" points at a part this icon doesn't have`);
  }
  return out;
}

function textBox(t) {
  const size = t.size ?? 14, w = t.text.length * size * 0.56, h = size;
  const x = (t.anchor ?? "start") === "start" ? t.x : t.anchor === "end" ? t.x - w : t.x - w / 2;
  return { x, y: t.y - h * 0.8, w, h };
}
const segHitsBox = (x1, y1, x2, y2, b) => {
  // sample the segment: cheap, and plenty for "does this line run through the text"
  for (let k = 0; k <= 20; k++) { const x = x1 + ((x2 - x1) * k) / 20, y = y1 + ((y2 - y1) * k) / 20; if (x > b.x + 1 && x < b.x + b.w - 1 && y > b.y + 1 && y < b.y + b.h - 1) return true; }
  return false;
};
function crossesOutline(e, b) {
  if (e.t === "line") return segHitsBox(e.x1, e.y1, e.x2, e.y2, b);
  if (e.t === "rect") return [[e.x, e.y, e.x + e.w, e.y], [e.x + e.w, e.y, e.x + e.w, e.y + e.h], [e.x, e.y + e.h, e.x + e.w, e.y + e.h], [e.x, e.y, e.x, e.y + e.h]].some(([a, c, d, g]) => segHitsBox(a, c, d, g, b));
  if (e.t === "circle") {
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2, d = Math.hypot(cx - e.cx, cy - e.cy);
    return Math.abs(d - e.r) < b.h / 2 && b.w < 2 * e.r;
  }
  return false;
}

/** Labels in the raw reply that point at an icon the diagram doesn't contain (they show as a bare letter). */
export function strayLabels(rawExam) {
  const found = [];
  const walk = (v) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") {
      if (v.type === "diagram" && Array.isArray(v.elements)) {
        const icons = new Set(v.elements.filter((e) => e?.t === "icon").map((e) => iconName(e.name)));
        for (const e of v.elements) if (e?.t === "label" && typeof e.to === "string" && !icons.has(iconName(e.to.split(/[.:/>]|→/)[0]))) found.push(e.to);
      }
      Object.values(v).forEach(walk);
    }
  };
  walk(rawExam);
  return found;
}

/** Icon names the writer used that the app doesn't have (from the raw reply, before they became plain boxes). */
export function unknownIcons(rawExam) {
  const found = [];
  const walk = (v) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") { if (v.t === "icon" && typeof v.name === "string" && !iconName(v.name)) found.push(v.name); Object.values(v).forEach(walk); }
  };
  walk(rawExam);
  return found;
}
