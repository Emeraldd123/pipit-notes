// Shows a tuning-run question the way the app shows it: the stem, its figure DRAWN (tables, graphs, charts and
// diagrams through the app's own drawing code), each part with its marks, multiple-choice options with the right
// one marked and the reason for each, the model answer and the marking scheme. Maths stays as $…$ for KaTeX.
// Also reads questions back out of the judge's plain-text form, for runs saved before questions were stored whole.
import { drawFigure, normalizeFigure } from "../src/lib/figure-core.ts";
import { parseModelJson } from "../src/lib/json-repair.ts";
import { readFileSync } from "node:fs";

// the bundled Bioicons, for icons placed in diagrams
let ICONS = new Map();
try { ICONS = new Map(JSON.parse(readFileSync("public/bioicons/icons.json", "utf8")).icons.map((i) => [i.name, i])); } catch { /* no icon set built */ }
const LIC = { "cc-0": "CC0", "cc-by-3.0": "CC BY 3.0", "cc-by-4.0": "CC BY 4.0", mit: "MIT", bsd: "BSD" };

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const LETTERS = "ABCDEFGH";

export function figureHtml(raw) {
  if (!raw) return "";
  const f = normalizeFigure(raw);
  if (!f) return `<div class="fig bad small">This figure couldn't be drawn (the app would leave it out).</div>`;
  const cap = f.caption ? `<figcaption>${esc(f.caption)}</figcaption>` : "";
  if (f.type === "table") {
    return `<figure class="fig"><table class="ftable">${f.headers.length ? `<thead><tr>${f.headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead>` : ""}<tbody>${f.rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>${cap}</figure>`;
  }
  if (f.type === "crop") return `<figure class="fig small muted">A picture cropped from your notes would appear here.${cap}</figure>`;
  const d = drawFigure(f);
  if (!d) return `<div class="fig bad small">This figure couldn't be drawn.</div>`;
  const id = `c${Math.random().toString(36).slice(2, 8)}`;
  const prims = d.prims.map((p) => {
    if (p.t === "path") return `<path d="${esc(p.d)}" stroke="${p.stroke ?? "none"}" fill="${p.fill ?? "none"}" stroke-width="${p.w ?? 1}"${p.dash ? ' stroke-dasharray="6 5"' : ""}${p.op != null ? ` opacity="${p.op}"` : ""} stroke-linejoin="round" stroke-linecap="round"${p.clip && d.clip ? ` clip-path="url(#${id})"` : ""}/>`;
    if (p.t === "image") { const ic = ICONS.get(p.name); return ic ? `<image href="${ic.src}" x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" preserveAspectRatio="xMidYMid meet"/>` : `<rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" fill="#f3f4f6" stroke="#d1d5db"/>`; }
    if (p.t === "circle") return `<circle cx="${p.cx}" cy="${p.cy}" r="${p.r}" fill="${p.fill ?? "none"}"${p.stroke ? ` stroke="${p.stroke}"` : ""}/>`;
    return `<text x="${p.x}" y="${p.y}" font-size="${p.size ?? 12}" text-anchor="${p.anchor ?? "start"}" fill="${p.fill ?? "#111827"}"${p.bold ? ' font-weight="700"' : ""}${p.rotate ? ` transform="rotate(${p.rotate} ${p.x} ${p.y})"` : ""}>${esc(p.s)}</text>`;
  }).join("");
  const clip = d.clip ? `<clipPath id="${id}"><rect x="${d.clip.x}" y="${d.clip.y}" width="${d.clip.w}" height="${d.clip.h}"/></clipPath>` : "";
  const used = [...new Set(d.prims.filter((p) => p.t === "image").map((p) => p.name))].map((n) => ICONS.get(n)).filter(Boolean);
  const credit = used.length ? `<figcaption class="small muted">Icons: Bioicons — ${[...new Set(used.map((i) => `${i.author} (${LIC[i.licence] ?? i.licence})`))].join(", ")}</figcaption>` : "";
  return `<figure class="fig"><svg viewBox="0 0 ${d.w} ${d.h}" font-family="ui-sans-serif, system-ui, sans-serif">${clip}${prims}</svg>${cap}${credit}</figure>`;
}

/** A question (the app's structure: stem, figure, parts) as the student and the marker would see it. */
export function questionHtml(q) {
  const parts = q.parts.map((p) => {
    const opts = p.options?.length ? `<ol class="opts">${p.options.map((o, i) => `<li class="${i === p.correct ? "right" : ""}"><span class="letter">${LETTERS[i]}</span><span>${esc(o)}${p.why?.[i] ? `<span class="why">${i === p.correct ? "Why it's right: " : "Mistake behind it: "}${esc(p.why[i])}</span>` : ""}</span>${i === p.correct ? '<span class="tick">✓</span>' : ""}</li>`).join("")}</ol>` : "";
    const num = p.numeric ? ` <span class="muted small">(accepts ${esc(p.numeric.value)}${p.numeric.unit ? ` ${esc(p.numeric.unit)}` : ""} ± ${Math.round((p.numeric.tol ?? 0) * 100)}%)</span>` : "";
    return `<div class="part">
      <div class="phead"><b>${p.label ? `(${esc(p.label)})` : ""}</b> <span class="muted small">${esc(TYPE[p.type] ?? p.type)} · ${p.marks} mark${p.marks === 1 ? "" : "s"}</span></div>
      <div class="prompt">${esc(p.prompt)}</div>
      ${figureHtml(p.figure)}${opts}
      <details class="key"><summary>Model answer and marking scheme</summary>
        <div><b>Answer:</b> ${esc(p.answer)}${num}</div>
        ${p.scheme?.length ? `<ul>${p.scheme.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>` : ""}
      </details>
    </div>`;
  }).join("");
  const tags = [q.kind === "case" ? `<span class="chip">case study${q.principle ? `: ${esc(q.principle)}` : ""}</span>` : ""].join("");
  return `<div class="qview">${tags ? `<div>${tags}</div>` : ""}<div class="stem">${esc(q.stem)}</div>${figureHtml(q.figure)}${parts}</div>`;
}
const TYPE = { mcq: "multiple choice", numeric: "numerical answer", short: "short answer", working: "show your working", tf: "true / false" };

/** Read a question back out of the judge's text form (tools/exam-lab.mjs questionText). */
export function parseQuestionText(text) {
  const lines = String(text).split("\n");
  const head = /^(q\d+)( \[CASE\])?(?: \(principle: (.*?)\))?: (.*)$/.exec(lines[0] ?? "");
  const q = { id: head?.[1] ?? "q", kind: head?.[2] ? "case" : undefined, principle: head?.[3], stem: head?.[4] ?? lines[0] ?? "", figure: null, parts: [] };
  let field = { obj: q, key: "stem" };
  const fig = (s) => { try { return parseModelJson(s); } catch { return { broken: true }; } };   // tolerant: the text form cuts long figures off
  for (const line of lines.slice(1)) {
    let m;
    if ((m = /^ {2}\(([^)]*)\) \[(\w+), (\d+)m\] ?(.*)$/.exec(line))) {
      const p = { label: m[1] === "-" ? "" : m[1], type: m[2], marks: Number(m[3]), prompt: m[4], answer: "", scheme: [] };
      q.parts.push(p); field = { obj: p, key: "prompt" };
    } else if ((m = /^ {5}FIGURE: (.*)$/.exec(line))) (field.obj === q ? q : field.obj).figure = fig(m[1]);
    else if ((m = /^ {5}options: (.*)$/.exec(line)) && q.parts.length) {
      const p = q.parts[q.parts.length - 1];
      p.options = m[1].split(" | ").map((o) => o.replace(/^\*/, ""));
      p.correct = m[1].split(" | ").findIndex((o) => o.startsWith("*"));
      field = { obj: p, key: "options" };
    } else if ((m = /^ {5}answer: (.*)$/.exec(line)) && q.parts.length) { q.parts[q.parts.length - 1].answer = m[1]; field = { obj: q.parts[q.parts.length - 1], key: "answer" }; }
    else if ((m = /^ {5}scheme: (.*)$/.exec(line)) && q.parts.length) { q.parts[q.parts.length - 1].scheme = m[1].split(" / "); field = { obj: q.parts[q.parts.length - 1], key: "scheme" }; }
    else if (field.key === "stem" || field.key === "prompt" || field.key === "answer") field.obj[field.key] += `\n${line}`;
  }
  return q;
}
