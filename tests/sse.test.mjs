import test from "node:test";
import assert from "node:assert/strict";
import { applyEvent, itemsSoFar, newStreamState, questionsSoFar, sseSplitter } from "../src/lib/sse-core.ts";

const ev = (type, body) => `event: ${type}\ndata: ${JSON.stringify({ type, ...body })}\n\n`;
const STREAM =
  ev("message_start", { message: { usage: { input_tokens: 900, output_tokens: 1 } } }) +
  ev("content_block_start", { index: 0, content_block: { type: "thinking" } }) +
  ev("content_block_delta", { index: 0, delta: { type: "thinking_delta", thinking: "hmm" } }) +
  ev("ping", {}) +
  ev("content_block_delta", { index: 1, delta: { type: "text_delta", text: '{"sections":[{"questions":[{"stem":"Q1 ' } }) +
  ev("content_block_delta", { index: 1, delta: { type: "text_delta", text: 'é"},{"stem" : "Q2"}]}]}' } }) +
  ev("message_delta", { delta: { stop_reason: "end_turn" }, usage: { output_tokens: 321 } }) +
  ev("message_stop", {});

test("a stream cut into arbitrary pieces gives the same text, usage and stop reason", () => {
  for (const size of [1, 7, 64, 100000]) {
    const split = sseSplitter(), st = newStreamState();
    let grew = 0;
    for (let i = 0; i < STREAM.length; i += size) for (const p of split(STREAM.slice(i, i + size))) if (applyEvent(st, p)) grew++;
    assert.equal(st.text, '{"sections":[{"questions":[{"stem":"Q1 é"},{"stem" : "Q2"}]}]}', `chunk size ${size}`);
    assert.deepEqual(st.usage, { input_tokens: 900, output_tokens: 321 });
    assert.equal(st.stop, "end_turn");
    assert.ok(st.done && !st.error && grew === 2);
    assert.equal(questionsSoFar(st.text), 2);
  }
});

test("CRLF streams, service errors and junk are handled", () => {
  const split = sseSplitter(), st = newStreamState();
  for (const p of split(ev("content_block_delta", { delta: { type: "text_delta", text: "ok" } }).replace(/\n/g, "\r\n"))) applyEvent(st, p);
  assert.equal(st.text, "ok");
  for (const p of split("data: not json\n\n" + ev("error", { error: { type: "overloaded_error", message: "Overloaded" } }))) applyEvent(st, p);
  assert.deepEqual(st.error, { type: "overloaded_error", message: "Overloaded" });
  assert.ok(!st.done);
});

test("progress counts", () => {
  assert.equal(questionsSoFar('{"stem":"a","parts":[{"prompt":"the stem of a plant"}]},{"stem'), 1);
  assert.equal(itemsSoFar('{"cards":[{"front":"a","back":"b"},{"front":"c"', "front"), 2);
});
