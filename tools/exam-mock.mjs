// A fake Anthropic API for trying the tuning loop end to end without a key or any cost (node tools/exam-tune.mjs --mock).
// Replies have the right SHAPE (an exam, a judge's review, new rules) with made-up content and realistic token usage.
let n = 0;
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const words = ["rate", "graph", "sample", "change", "model", "system", "force", "price", "cell", "energy", "data", "ratio", "test", "level", "curve", "value", "shift", "effect"];
const sentence = (k) => Array.from({ length: k }, () => pick(words)).join(" ");

function exam() {
  const qs = Array.from({ length: 8 }, (_, i) => ({
    topic: pick(words), basis: { notes: [1 + (i % 3)], textbook: null, solvable: "yes", scenario: pick(["a car battery and headlight", "a kettle element", "yeast in bread dough", "a phone charger", "a hospital oxygen tank", "a sprinter's muscle", "a solar panel on a roof", "a bike dynamo"]) + (Math.random() < 0.5 ? "" : ` ${n}`), ...(i % 3 === 0 ? { kind: "case", principle: sentence(5) } : {}) },
    stem: `Mock question ${++n}: ${sentence(14)}.`,
    ...(i === 0 ? { figure: { type: "diagram", width: 420, height: 240, elements: [
      { t: "icon", name: "mitochondrion", x: 20, y: 30, w: 140, h: 90, label: "X" }, { t: "icon", name: "chloroplast", x: 200, y: 30, w: 120, h: 90, label: "Y" },
      { t: "line", x1: 160, y1: 75, x2: 200, y2: 75, arrow: true } ] } } : {}),
    parts: i % 2
      ? [{ label: "a", type: "mcq", marks: 1, prompt: `Which ${sentence(4)}?`, options: ["one", "two", "three", "four"], correct: 0, answer: "one, because it follows", why: ["right", "slip", "partly", "weak"], scheme: ["one"] }]
      : [{ label: "a", type: pick(["short", "numeric", "working"]), marks: 3, prompt: `Explain ${sentence(6)}.`, answer: sentence(8), scheme: [sentence(4), sentence(4), sentence(4)], numeric: { value: 2, tol: 0.05, unit: "m" } }],
  }));
  return { title: "Mock exam", subject: "mock", durationMin: 60, instructions: "Answer all questions.", sections: [{ title: "Section A", questions: qs }] };
}

export async function mockFetch(_url, init) {
  const body = JSON.parse(init.body);
  const sys = body.system ?? "";
  const user = body.messages[0].content.map((c) => c.text ?? "").join("");
  let text;
  if (sys.startsWith("You are an experienced examiner")) text = JSON.stringify(exam());
  else if (sys.startsWith("You are a strict, experienced examiner")) {
    const ids = [...user.matchAll(/^(q\d+)/gm)].map((m) => m[1]);
    const s = () => pick([1, 2, 2, 2]);
    text = JSON.stringify({ items: ids.map((id) => ({ id, realistic: s(), applied: null, self_contained: s(), one_answer: s(), accurate: s(), distractors: s(), fix: pick(["", "State the units.", "The data in the stem doesn't match the answer."]) })), ...(sys.includes("PAST EXAM") ? { paper: { style_match: s(), copied: false, style_fix: "Use the course's point values." } } : {}) });
  } else if (sys.startsWith("You are the second examiner")) {
    const ids = [...user.matchAll(/^(q\d+):/gm)].map((m) => m[1]);
    text = JSON.stringify({ checks: [
      ...(ids[0] ? [{ q: ids[0], part: "a", verdict: "fix", problem: "Mock: the answer doesn't follow from the data.", fix: { answer: "corrected answer", scheme: ["corrected point"] } }] : []),
      ...(ids[3] && Math.random() < 0.5 ? [{ q: ids[3], part: "a", verdict: "drop", problem: "Mock: two defensible answers." }] : []),
    ] });
  } else if (sys.startsWith("You are a strict head of department")) {
    const ids = [...user.matchAll(/^(c\d+) \((FIX|DROP)\)/gm)];
    text = JSON.stringify({ changes: ids.map(([, id, kind]) => (kind === "DROP" ? { id, broken: Math.random() < 0.7 } : { id, better: pick(["1", "2", "same"]), v1_correct: Math.random() < 0.6, v2_correct: Math.random() < 0.8 })) });
  } else text = `Here are the new rules.\n<rules>\n- Mock rule ${++n}: vary the kind of task across the paper.\n- Give every value the answer needs in the stem.\n</rules>\n<changes>Mock (tagged reply): varied the tasks.</changes>`;
  await new Promise((r) => setTimeout(r, 20));
  return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text }], stop_reason: "end_turn", usage: { input_tokens: Math.round((sys.length + user.length) / 3.6), output_tokens: Math.round(text.length / 3.5) + 2500 } }) };
}
