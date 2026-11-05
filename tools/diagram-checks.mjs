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
    }
  }
  return out;
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
