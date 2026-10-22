import test from "node:test";
import assert from "node:assert/strict";
import { escapeLatexBackslashes, salvageTruncated, parseModelJson } from "../src/lib/json-repair.ts";

test("single-backslash LaTeX inside JSON strings is repaired, including the look-alikes", () => {
  const raw = String.raw`{"a":"$\Delta x$ and $\frac{1}{2}$ and $3 \times 10^2$ and $\theta$ and $\sqrt{x}$ and $\left(x\right)$"}`;
  const v = parseModelJson(raw);
  assert.equal(v.a, String.raw`$\Delta x$ and $\frac{1}{2}$ and $3 \times 10^2$ and $\theta$ and $\sqrt{x}$ and $\left(x\right)$`);
});

test("properly escaped JSON is left alone, and real escapes still work", () => {
  const ok = String.raw`{"a":"line1\nline2","b":"quote \" here","c":"\\frac","d":"\u00e9","e":"tab\there"}`;
  const v = parseModelJson(ok);
  assert.equal(v.a, "line1\nline2");
  assert.equal(v.b, 'quote " here');
  assert.equal(v.c, "\\frac");
  assert.equal(v.d, "é");
  assert.equal(v.e, "tab\there");
  assert.equal(escapeLatexBackslashes(ok), ok);
});

test("fences and chatter around the JSON are ignored", () => {
  assert.deepEqual(parseModelJson('Sure! Here you go:\n```json\n{"x":[1,2]}\n```\nHope that helps'), { x: [1, 2] });
  assert.deepEqual(parseModelJson("[1,2,3]"), [1, 2, 3]);
});

test("a reply cut off mid-way keeps everything before the cut", () => {
  const cut = '{"title":"T","sections":[{"title":"A","questions":[{"stem":"one","parts":[{"prompt":"p1"}]},{"stem":"two","parts":[{"prompt":"p2"}]},{"stem":"thr';
  const v = parseModelJson(cut);
  assert.equal(v.sections[0].questions.length, 2);
  assert.equal(v.sections[0].questions[1].stem, "two");
  assert.equal(salvageTruncated("nothing here"), null);
});

test("hopeless replies fail with a clear reason", () => {
  assert.throws(() => parseModelJson("no json at all"), /structured data/);
  assert.throws(() => parseModelJson('{"a": nope}'), (e) => e.name === "JsonReplyError" && e.truncated === false);
  assert.throws(() => parseModelJson('{"a": "unterminated'), (e) => e.truncated === true);
});
