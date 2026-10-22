import test from "node:test";
import assert from "node:assert/strict";
import { parseModelJson } from "../src/lib/json-repair.ts";
import { normalizeExam } from "../src/lib/exam-core.ts";

// A reply shaped like what models really produce: prose + fence + single-backslash LaTeX that is NOT valid JSON.
const REPLY = String.raw`Here is your exam:
~~~json
{"title":"Cell biology","durationMin":40,"sections":[{"title":"Section A","questions":[
 {"topic":"Transport","stem":"A cell of side $s$ has surface-area-to-volume ratio $\frac{6}{s}$. Use the table.",
  "figure":{"type":"table","headers":["s (cm)","SA:V"],"rows":[[1,6],[2,3],[3,2]]},
  "parts":[{"label":"a","type":"numeric","marks":2,"prompt":"What is SA:V when $s = 2$ cm?","numeric":{"value":3,"tol":0.02},"answer":"$\frac{6}{2} = 3$","scheme":["$\frac{6}{s}$ used"]},
           {"label":"b","type":"short","marks":2,"prompt":"Explain why $\Delta$ SA:V matters to diffusion.","answer":"Smaller ratio means slower exchange","scheme":["ratio falls","diffusion slower"]}]},
 {"topic":"Transport","stem":"Second question that gets cut o`.replace(/~~~/g, "```");

test("an exam reply with LaTeX backslashes and a cut-off tail still becomes a usable exam", () => {
  const exam = normalizeExam(parseModelJson(REPLY));
  assert.ok(exam, "exam should be readable");
  assert.equal(exam.sections[0].questions.length, 1);                            // the truncated second question is dropped, not fatal
  const q = exam.sections[0].questions[0];
  assert.ok(q.stem.includes(String.raw`\frac{6}{s}`));                          // LaTeX survived intact (not form-feed + "rac")
  assert.ok(q.parts[1].prompt.includes(String.raw`$\Delta$`));
  assert.equal(q.figure.type, "table");
  assert.equal(q.parts[0].numeric.value, 3);
  assert.equal(exam.totalMarks, 4);
});
