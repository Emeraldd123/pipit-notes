import test from "node:test";
import assert from "node:assert/strict";
import { blockedByHttps, cleanReply, localAllowed, normalizeBase, pickModel, replyUsable, toChatMessages } from "../src/lib/local-ai-core.ts";

test("which jobs may run on the laptop", () => {
  for (const f of ["transcribe", "math", "working", "mathcheck", "ask", "explain.followup"]) assert.ok(localAllowed(f, "light"), f);
  assert.ok(!localAllowed("explain", "light") && localAllowed("explain", "most"));
  for (const f of ["exam", "exam.mark", "exam.verify", "test"]) assert.ok(!localAllowed(f, "most"), `${f} always goes to Claude`);
  assert.ok(!localAllowed("something-new", "most"), "unknown jobs stay on Claude");
});

test("addresses are tidied, and plain http is caught before the browser blocks it", () => {
  assert.equal(normalizeBase("zenbook.tail1234.ts.net/"), "https://zenbook.tail1234.ts.net");
  assert.equal(normalizeBase("https://zenbook.tail1234.ts.net/v1/"), "https://zenbook.tail1234.ts.net");
  assert.equal(normalizeBase("localhost:11434"), "http://localhost:11434");
  assert.equal(normalizeBase("  "), "");
  assert.ok(blockedByHttps("http://192.168.1.20:11434", "https:"));
  assert.ok(!blockedByHttps("http://localhost:11434", "https:"));
  assert.ok(!blockedByHttps("http://192.168.1.20:11434", "http:"));
  assert.ok(!blockedByHttps("https://zenbook.tail1234.ts.net", "https:"));
});

test("requests become OpenAI-style chat messages with the image as a data URL", () => {
  const m = toChatMessages("sys", [{ type: "image", source: { type: "base64", media_type: "image/png", data: "AAA" } }, { type: "text", text: "Read it." }]);
  assert.deepEqual(m, [
    { role: "system", content: "sys" },
    { role: "user", content: [{ type: "image_url", image_url: { url: "data:image/png;base64,AAA" } }, { type: "text", text: "Read it." }] },
  ]);
  assert.deepEqual(toChatMessages(undefined, "hi"), [{ role: "user", content: "hi" }]);
});

test("a bad local reply is thrown away so the job goes to Claude", () => {
  assert.equal(cleanReply("<think>hmm, x squared</think>\nx^2"), "x^2");
  assert.equal(cleanReply("reasoning without an opening tag</think> x^2"), "x^2");
  assert.ok(replyUsable("working", '{"lines":[]}'));
  assert.ok(!replyUsable("working", "Sure! Here are the lines: x = 2"));
  assert.ok(!replyUsable("math", "x^2 +", "length"), "cut off");
  assert.ok(!replyUsable("math", "  "));
  assert.ok(replyUsable("transcribe", ""), "a blank page reads as nothing");
});

test("a model is picked from what the laptop has", () => {
  assert.equal(pickModel(["nomic-embed-text", "phi4-mini", "qwen3-vl:8b"], ""), "qwen3-vl:8b");
  assert.equal(pickModel(["phi4-mini", "gemma4:e4b"], "phi4-mini"), "phi4-mini");
  assert.equal(pickModel(["phi4-mini"], "missing"), "phi4-mini");
  assert.equal(pickModel([], "qwen3-vl:8b"), "qwen3-vl:8b");
  assert.equal(pickModel(["nomic-embed-text"], ""), null);
});
