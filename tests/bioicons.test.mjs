import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeFigure, drawFigure, iconName } from "../src/lib/figure-core.ts";
import { BIOICON_NAMES } from "../src/lib/bioicon-names.ts";
import { buildExamPrompt } from "../src/lib/exam-prompt.ts";
import { figureHtml } from "../tools/question-html.mjs";

test("the bundled icon set matches the names the writer is given, and every icon has a credit", () => {
  const { icons } = JSON.parse(readFileSync("public/bioicons/icons.json", "utf8"));
  assert.deepEqual(icons.map((i) => i.name), BIOICON_NAMES);
  for (const i of icons) {
    assert.match(i.src, /^data:image\/svg\+xml;base64,/);
    assert.ok(i.author && /^(cc-0|cc-by-3\.0|cc-by-4\.0|mit|bsd)$/.test(i.licence), i.name);
    const svg = Buffer.from(i.src.split(",")[1], "base64").toString();
    assert.doesNotMatch(svg, /<script|\son\w+\s*=|href\s*=\s*["'](?!#)/i, `${i.name} must be inert`);
  }
  assert.ok(BIOICON_NAMES.includes("mitochondrion") && BIOICON_NAMES.includes("ion channel"));
});

test("icon names are matched forgivingly; unknown icons become labelled boxes", () => {
  assert.equal(iconName("Mitochondria"), "mitochondrion");
  assert.equal(iconName("test tubes"), "test tube");
  assert.equal(iconName("phospholipid"), "phospholipid");
  assert.equal(iconName("atp synthase"), null);
  const f = normalizeFigure({ type: "diagram", width: 400, height: 260, elements: [
    { t: "icon", name: "phospholipid", x: 20, y: 100, w: 360, h: 60 },
    { t: "icon", name: "Mitochondria", x: 20, y: 10, w: 80, h: 60, label: "X" },
    { t: "icon", name: "atp synthase", x: 300, y: 90, w: 60, h: 80 },
    { t: "icon", name: "beaker", x: 0, y: 0, w: -5, h: 10 },
  ] });
  assert.deepEqual(f.elements.map((e) => [e.t, e.name ?? e.label]), [["icon", "phospholipid"], ["icon", "mitochondrion"], ["rect", "atp synthase"]]);
  const d = drawFigure(f);
  assert.deepEqual(d.prims.filter((p) => p.t === "image").map((p) => p.name), ["phospholipid", "mitochondrion"]);
  assert.ok(d.prims.some((p) => p.t === "text" && p.s === "X"));
});

test("the writer is told which icons exist; the review page draws them with credit", () => {
  const { system } = buildExamPrompt({ excerpts: [], questions: 8, difficulty: "same", style: "", figures: true });
  assert.match(system, /"t":"icon","name":"mitochondrion"/);
  assert.match(system, /Parts you can point at: mitochondrion \(outer membrane, cristae, matrix, intermembrane space\)/);
  assert.match(system, /Icons that come whole[^:]*: .*phospholipid/);
  assert.match(system, /"t":"label","text":"X","x":30,"y":40,"to":"mitochondrion\.cristae"/);
  const html = figureHtml({ type: "diagram", width: 300, height: 200, elements: [{ t: "icon", name: "mitochondrion", x: 10, y: 10, w: 100, h: 80, label: "X" }] });
  assert.match(html, /<image href="data:image\/svg\+xml;base64,/);
  assert.match(html, /Icons: Bioicons — /);
});
