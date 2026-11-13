// Which AI jobs may go to the cheaper provider (Gemini) before Claude, and whether a reply from it is good enough
// to use (or should be thrown away and the job sent on to Claude). Pure; tests/ai-route.test.mjs.
import { parseModelJson } from "./json-repair.ts";

export type RouteScope = "light" | "most";

type TextBlock = { type: "text"; text: string };
type ImageBlock = { type: "image"; source: { type: "base64"; media_type: string; data: string } };
export type Content = TextBlock | ImageBlock;

/** Reading and short answers: a small fast model does these about as well as Claude's cheapest model. */
export const ROUTE_LIGHT = new Set([
  "transcribe", "text", "math", "graph", "working", "chem", "mathcheck",
  "ask", "explain.followup", "map.link", "cards.text", "cards.region", "practice",
]);
/** Bigger jobs it can do, less reliably: only when the user picks "most". */
export const ROUTE_MOST = new Set(["explain", "cards", "map", "map.expand", "review", "latex"]);
/** Kept on Claude whenever there is a Claude key: exams and their marking were tuned on Claude. */
export const CLAUDE_FIRST = new Set(["exam", "exam.mark", "exam.verify"]);
/** Never rerouted: the key test must reach Anthropic. */
const NEVER = new Set(["test"]);

/** Features whose reply is parsed as JSON: a reply that doesn't parse goes to Claude instead. */
export const JSON_FEATURES = new Set([
  "working", "chem", "mathcheck", "practice", "explain", "review", "latex",
  "cards", "cards.text", "cards.region", "map", "map.expand", "map.link",
  "exam", "exam.mark", "exam.verify",
]);

export function routeAllowed(feature: string, scope: RouteScope): boolean {
  if (NEVER.has(feature) || CLAUDE_FIRST.has(feature)) return false;
  return ROUTE_LIGHT.has(feature) || (scope === "most" && ROUTE_MOST.has(feature));
}

/** Is this reply usable? If not, the job goes on to Claude. */
export function replyUsable(feature: string, reply: string, finish?: string): boolean {
  if (finish === "length") return false;   // cut off: a half answer is worse than paying for a whole one
  if (JSON_FEATURES.has(feature)) {
    try { parseModelJson(reply); return true; } catch { return false; }
  }
  // a blank page legitimately transcribes to nothing; everything else must say something
  return feature === "transcribe" || reply.trim().length > 0;
}
