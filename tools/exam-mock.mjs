// A fake Anthropic API for trying the tuning loop end to end without a key or any cost (node tools/exam-tune.mjs --mock).
// Replies have the right SHAPE (an exam, a judge's review, new rules) with made-up content and realistic token usage.
let n = 0;
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const words = ["rate", "graph", "sample", "change", "model", "system", "force", "price", "cell", "energy", "data", "ratio", "test", "level", "curve", "value", "shift", "effect"];
const sentence = (k) => Array.from({ length: k }, () => pick(words)).join(" ");

function exam() {
  const qs = Array.from({ length: 8 }, (_, i) => ({
    topic: pick(words), basis: { notes: [1 + (i % 3)], textbook: null, solvable: "yes", ...(i % 3 === 0 ? { kind: "case", principle: sentence(5) } : {}) },
    stem: `Mock question ${++n}: ${sentence(14)}.`,
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
  } else text = JSON.stringify({ rules: `- Mock rule ${++n}: vary the kind of task across the paper.\n- Give every value the answer needs in the stem.`, changes: "Mock: varied the tasks." });
  await new Promise((r) => setTimeout(r, 20));
  return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text }], stop_reason: "end_turn", usage: { input_tokens: Math.round((sys.length + user.length) / 3.6), output_tokens: Math.round(text.length / 3.5) + 2500 } }) };
}
