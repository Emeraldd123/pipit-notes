// Laptop-first AI: which jobs may run on a model on your own computer, how a request is turned into the
// OpenAI-style chat format that Ollama, llama.cpp's llama-server and LM Studio all accept, and whether a reply is
// good enough to use (or should be thrown away and sent to Claude instead). Pure; tests/local-ai.test.mjs.
import { parseModelJson } from "./json-repair.ts";

export type LocalScope = "light" | "most";

/** Reading and short answers: a 4–9B local model does these about as well as Claude's cheapest model. */
export const LOCAL_LIGHT = new Set([
  "transcribe", "text", "math", "graph", "working", "chem", "mathcheck",
  "ask", "explain.followup", "map.link", "cards.text", "cards.region", "practice",
]);
/** Bigger jobs a local model can do, less reliably: only when the user picks "most". */
export const LOCAL_MOST = new Set(["explain", "cards", "map", "map.expand", "review", "latex"]);
/** Never local: exams and their marking were tuned on Claude, and the key test must reach Anthropic. */
export const NEVER_LOCAL = new Set(["exam", "exam.mark", "exam.verify", "test"]);

/** Features whose reply is parsed as JSON: a local reply that doesn't parse goes to Claude instead. */
export const JSON_FEATURES = new Set([
  "working", "chem", "mathcheck", "practice", "explain", "review", "latex",
  "cards", "cards.text", "cards.region", "map", "map.expand", "map.link",
]);

export function localAllowed(feature: string, scope: LocalScope): boolean {
  if (NEVER_LOCAL.has(feature)) return false;
  return LOCAL_LIGHT.has(feature) || (scope === "most" && LOCAL_MOST.has(feature));
}

/** "laptop.tail1234.ts.net:11434/" or ".../v1" → "https://laptop.tail1234.ts.net:11434" (no trailing slash or /v1). */
export function normalizeBase(url: string): string {
  let u = url.trim();
  if (!u) return "";
  if (!/^https?:\/\//i.test(u)) u = (/^(localhost|127\.|\[::1\])/i.test(u) ? "http://" : "https://") + u;
  return u.replace(/\/+$/, "").replace(/\/v1$/i, "").replace(/\/+$/, "");
}

/** An http:// laptop address can't be reached from the https app (the browser blocks it), except localhost. */
export function blockedByHttps(base: string, pageProtocol: string): boolean {
  return pageProtocol === "https:" && /^http:\/\//i.test(base) && !/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(base);
}

type TextBlock = { type: "text"; text: string };
type ImageBlock = { type: "image"; source: { type: "base64"; media_type: string; data: string } };
export type Content = TextBlock | ImageBlock;
type OaiPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

/** Anthropic-style system + user content → OpenAI-style chat messages. */
export function toChatMessages(system: string | undefined, user: Content[] | string) {
  const content: OaiPart[] | string = typeof user === "string" ? user : user.map((b) =>
    b.type === "text" ? { type: "text", text: b.text } : { type: "image_url", image_url: { url: `data:${b.source.media_type};base64,${b.source.data}` } });
  return [...(system ? [{ role: "system", content: system }] : []), { role: "user", content }];
}

export const hasImage = (user: Content[] | string) => typeof user !== "string" && user.some((b) => b.type === "image");

/** Drop a thinking model's <think>…</think> preamble (Qwen, DeepSeek-R1 distills) so only the answer is left. */
export function cleanReply(raw: string): string {
  return raw.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/^[\s\S]*?<\/think>/i, "").trim();
}

/** Is this local reply usable? If not, the job goes to Claude. */
export function replyUsable(feature: string, reply: string, finish?: string): boolean {
  if (finish === "length") return false;   // cut off: a half answer is worse than paying for a whole one
  if (JSON_FEATURES.has(feature)) {
    try { parseModelJson(reply); return true; } catch { return false; }
  }
  // a blank page legitimately transcribes to nothing; everything else must say something
  return feature === "transcribe" || reply.trim().length > 0;
}

/** Pick a model from what the server has: the user's choice if present, else the first vision-looking one, else the first. */
export function pickModel(available: string[], wanted: string): string | null {
  if (wanted && available.includes(wanted)) return wanted;
  if (wanted && !available.length) return wanted;   // server didn't list models (some don't): trust the setting
  const vision = available.find((m) => /vl|vision|gemma-?[34]|qwen3\.5|pixtral|llava|minicpm-v|ocr/i.test(m) && !/embed/i.test(m));
  return vision ?? available.find((m) => !/embed|rerank|whisper|tts/i.test(m)) ?? null;
}

// --- speed: a laptop running on its CPU can take ~50 s to read one picture. That's fine for jobs that run in the
// background (search indexing), not for ones you're waiting on (math check). Each job has a budget; once the laptop's
// measured speed is over it, that job goes straight to Claude, so you never wait twice.
/** How long you'd reasonably wait for each job, in ms. Unlisted jobs: 120 s. */
export const LATENCY_BUDGET: Record<string, number> = {
  mathcheck: 12_000, math: 20_000, graph: 20_000, text: 30_000, chem: 30_000, working: 40_000,
  "explain.followup": 45_000, "map.link": 45_000, ask: 60_000, "cards.region": 90_000, "cards.text": 90_000,
  transcribe: 240_000, practice: 240_000, cards: 300_000, map: 300_000, latex: 300_000,
};
export const budgetFor = (feature: string) => LATENCY_BUDGET[feature] ?? 120_000;

export type Speed = { image?: number; text?: number };   // typical ms per job, for jobs with and without a picture
/** Running estimate (EWMA, recent jobs count most). */
export function updateSpeed(s: Speed, withImage: boolean, ms: number): Speed {
  const k = withImage ? "image" : "text";
  const prev = s[k];
  return { ...s, [k]: Math.round(prev == null ? ms : prev * 0.6 + ms * 0.4) };
}
/** Should this job try the laptop, given how fast it has been? Unknown speed: try (that's how it's measured). */
export function fastEnough(feature: string, withImage: boolean, s: Speed): boolean {
  const typical = withImage ? s.image : s.text;
  return typical == null || typical <= budgetFor(feature);
}
/** Give up on the laptop after this long (a bit past the budget), so a slow laptop costs at most one wait. */
export const localTimeout = (feature: string) => Math.round(budgetFor(feature) * 1.25);
