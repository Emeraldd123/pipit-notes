// Turn transcribed notes (plain text with $math$) into a compilable LaTeX document.
// Pure — no DOM — so it's unit-tested.

const SPECIAL: Record<string, string> = {
  "\\": "\\textbackslash{}", "&": "\\&", "%": "\\%", "#": "\\#", "_": "\\_", "{": "\\{", "}": "\\}",
  "~": "\\textasciitilde{}", "^": "\\textasciicircum{}", "$": "\\$",
};
const escapeText = (s: string) => s.replace(/[\\&%#_{}~^$]/g, (c) => SPECIAL[c]);

/** Escape one line, leaving $inline$ and $$display$$ maths untouched. */
export function escapeLine(line: string): string {
  const parts = line.split(/(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$)/g);
  return parts
    .map((p, i) => {
      const isMath = i % 2 === 1;
      return isMath ? p : escapeText(p).replace(/->/g, "$\\rightarrow$").replace(/<-/g, "$\\leftarrow$");
    })
    .join("");
}

const BULLET = /^\s*(?:[-•*–]|\d+[.)])\s+/;

/** Plain transcription -> LaTeX body (paragraphs and itemize lists). */
export function textToLatex(text: string): string {
  const lines = text.replace(/\[ink\]\s*/g, "").split("\n").map((l) => l.trimEnd());
  const out: string[] = [];
  let inList = false;
  const closeList = () => { if (inList) { out.push("\\end{itemize}", ""); inList = false; } };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { closeList(); if (out.length && out[out.length - 1] !== "") out.push(""); continue; }
    if (BULLET.test(raw)) {
      if (!inList) { out.push("\\begin{itemize}"); inList = true; }
      out.push("  \\item " + escapeLine(line.replace(BULLET, "")));
    } else {
      closeList();
      out.push(escapeLine(line) + " ");
    }
  }
  closeList();
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function buildLatexDocument(title: string, pages: { page: number; text: string }[]): string {
  const body = pages
    .filter((p) => p.text.trim())
    .map((p, i) => `${i ? "\\newpage\n" : ""}% --- page ${p.page + 1} ---\n${textToLatex(p.text)}`)
    .join("\n\n");
  return [
    "\\documentclass[11pt]{article}",
    "\\usepackage[utf8]{inputenc}",
    "\\usepackage{amsmath,amssymb}",
    "\\usepackage[margin=1in]{geometry}",
    `\\title{${escapeText(title)}}`,
    "\\date{}",
    "\\begin{document}",
    "\\maketitle",
    "",
    body || "% (no readable text yet — use “Read handwriting for search” first)",
    "",
    "\\end{document}",
    "",
  ].join("\n");
}
