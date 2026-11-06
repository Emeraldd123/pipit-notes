// Gemini (Google) as a second provider: paid from Google credits (the Gemini Pro subscription's monthly API credit),
// tried after the laptop and before Claude for the jobs it's allowed to do. This file turns a request into Gemini's
// native generateContent format and reads the reply. Pure; tests/gemini.test.mjs.
import type { Content } from "./local-ai-core.ts";

export const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";
export const GEMINI_DEFAULT_MODEL = "gemini-3.1-flash-lite";

/** USD per million tokens [input, output incl. thinking]: Google's published paid-tier prices (Nov 2026). */
const PRICES: [RegExp, [number, number]][] = [
  [/^gemini-2\.5-flash-lite/, [0.1, 0.4]],
  [/^gemini-3\.1-flash-lite/, [0.25, 1.5]],
  [/^gemini-3\.5-flash-lite/, [0.3, 2.5]],
  [/^gemini-2\.5-flash/, [0.3, 2.5]],
  [/^gemini-3-flash/, [0.5, 3]],
  [/^gemini-3\.[6-9]-flash/, [0.75, 3.75]],
  [/^gemini-3\.1-pro/, [2, 12]],
  [/^gemini-4-argon/, [2, 10]],
];
export const geminiPrice = (model: string): [number, number] => PRICES.find(([re]) => re.test(model))?.[1] ?? [0.75, 3.75];
export const geminiCostUsd = (model: string, input: number, output: number) => { const [i, o] = geminiPrice(model); return (input * i + output * o) / 1e6; };

/** Keep thinking short: these are reading and short-answer jobs. 2.5 models switch it off; 3.x models take a level. */
export function thinkingFor(model: string): Record<string, unknown> | undefined {
  if (/^gemini-2\.5/.test(model)) return { thinkingBudget: 0 };
  if (/^gemini-3/.test(model)) return { thinkingLevel: "low" };
  return undefined;
}

export function geminiBody(model: string, system: string | undefined, user: Content[] | string, maxTokens: number, thinking = true) {
  const parts = typeof user === "string" ? [{ text: user }] : user.map((b) =>
    b.type === "text" ? { text: b.text } : { inline_data: { mime_type: b.source.media_type, data: b.source.data } });
  const think = thinking ? thinkingFor(model) : undefined;
  return {
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    contents: [{ role: "user", parts }],
    generationConfig: { maxOutputTokens: maxTokens, temperature: 0.2, ...(think ? { thinkingConfig: think } : {}) },
  };
}

type GeminiReply = { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[]; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number }; promptFeedback?: { blockReason?: string } };

/** The answer text (thought parts dropped), whether it was cut off or blocked, and billed tokens. */
export function readGeminiReply(data: GeminiReply) {
  const c = data?.candidates?.[0];
  const text = (c?.content?.parts ?? []).filter((p) => !p.thought && typeof p.text === "string").map((p) => p.text).join("");
  const u = data?.usageMetadata ?? {};
  return {
    text,
    finish: c?.finishReason === "MAX_TOKENS" ? "length" : c?.finishReason === "STOP" || !c?.finishReason ? "stop" : "blocked",
    blocked: !!data?.promptFeedback?.blockReason || (!!c?.finishReason && !["STOP", "MAX_TOKENS"].includes(c.finishReason)),
    input: u.promptTokenCount ?? 0,
    output: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0),
  };
}
