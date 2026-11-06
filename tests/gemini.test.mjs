import test from "node:test";
import assert from "node:assert/strict";
import { geminiBody, geminiCostUsd, readGeminiReply, thinkingFor } from "../src/lib/gemini-core.ts";

test("requests become Gemini's format, with the picture inline and thinking kept short", () => {
  const b = geminiBody("gemini-3.1-flash-lite", "sys", [{ type: "image", source: { type: "base64", media_type: "image/png", data: "AAA" } }, { type: "text", text: "Read it." }], 600);
  assert.deepEqual(b.systemInstruction, { parts: [{ text: "sys" }] });
  assert.deepEqual(b.contents, [{ role: "user", parts: [{ inline_data: { mime_type: "image/png", data: "AAA" } }, { text: "Read it." }] }]);
  assert.equal(b.generationConfig.maxOutputTokens, 600);
  assert.deepEqual(b.generationConfig.thinkingConfig, { thinkingLevel: "low" });
  assert.deepEqual(thinkingFor("gemini-2.5-flash-lite"), { thinkingBudget: 0 });
  assert.equal(geminiBody("gemini-3.1-flash-lite", undefined, "hi", 100, false).generationConfig.thinkingConfig, undefined, "retry without thinking");
  assert.equal(geminiBody("x", undefined, "hi", 100).systemInstruction, undefined);
});

test("replies: thought parts dropped, cut-off and blocked replies recognised, tokens counted", () => {
  const ok = readGeminiReply({ candidates: [{ content: { parts: [{ text: "hmm", thought: true }, { text: "x^2" }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 10, thoughtsTokenCount: 40 } });
  assert.deepEqual(ok, { text: "x^2", finish: "stop", blocked: false, input: 1000, output: 50 });
  assert.equal(readGeminiReply({ candidates: [{ content: { parts: [{ text: "x^" }] }, finishReason: "MAX_TOKENS" }] }).finish, "length");
  assert.ok(readGeminiReply({ candidates: [{ finishReason: "SAFETY" }] }).blocked);
  assert.ok(readGeminiReply({ promptFeedback: { blockReason: "OTHER" } }).blocked);
  assert.equal(readGeminiReply(null).text, "");
});

test("spend is estimated from Google's prices", () => {
  assert.equal(geminiCostUsd("gemini-3.1-flash-lite", 1_000_000, 0), 0.25);
  assert.equal(geminiCostUsd("gemini-2.5-flash-lite", 0, 1_000_000), 0.4);
  // a typical maths read: ~1,500 tokens in, ~100 out → well under a tenth of a cent
  assert.ok(geminiCostUsd("gemini-3.1-flash-lite", 1500, 100) < 0.001);
});
