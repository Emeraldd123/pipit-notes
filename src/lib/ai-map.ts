// AI helpers for concept maps. The model proposes; the student edits. Everything it returns is
// validated by map-core before it touches the map.
import { AiError, claude, extractJson, text, type Excerpt } from "./ai";
import { applyAdditions, normalizeMap, type ConceptMap, type EdgeKind, type SrcRef } from "./map-core";
import { newId } from "./ids";

const srcOf = (ex: Excerpt[]): SrcRef[] => ex.map((e) => ({ n: e.n, noteId: e.noteId, page: e.page }));
const ctxOf = (ex: Excerpt[]) => ex.map((e) => `[${e.n}] ${e.noteTitle} — page ${e.page + 1}\n${e.text}`).join("\n\n");

const MAP_SYSTEM =
  "You help a student build a CONCEPT MAP from their own notes. Return STRICT JSON only: " +
  '{"title":"short map title","nodes":[{"id":"a","label":"Enthalpy","note":"one-line definition in the student\'s notes","topic":"unit name","src":1}],' +
  '"edges":[{"from":"a","to":"b","label":"is used in","kind":"part|cause|contrast|example|prereq|other"}]}. ' +
  "Rules: nodes are CONCEPTS (ideas, laws, terms, processes, quantities) — never note titles or page numbers; 1–4 words each. " +
  "Every link has a short verb-phrase label (\"causes\", \"is part of\", \"requires\", \"contrasts with\", \"is an example of\") so the map reads as sentences: A — label → B. " +
  'kind: "prereq" when A must be understood before B; "part" when B is a component of A; "cause" for cause/effect; "contrast" for opposites or common confusions; "example" for instances. ' +
  "Make it a connected web with one or two central ideas and cross-links between branches (the cross-links are the valuable part). " +
  "\"note\" is under 20 words and must be supported by the notes. \"topic\" is a short unit name reused for related concepts. \"src\" is the excerpt number. Use LaTeX in $...$ only if essential.";

export async function generateConceptMap(excerpts: Excerpt[], opts: { focus?: string; size: number; scope: string }): Promise<ConceptMap> {
  const raw = await claude({
    feature: "map", maxTokens: 6000, system: MAP_SYSTEM,
    user: [text(`Notes:\n\n${ctxOf(excerpts)}\n\nBuild a concept map of about ${opts.size} concepts${opts.focus?.trim() ? `, focused on: ${opts.focus.trim()}` : ""}.`)],
  });
  const map = normalizeMap(extractJson<unknown>(raw), srcOf(excerpts), newId(), opts.scope);
  if (!map) throw new AiError("The model's map couldn't be read. Try again, or narrow the scope.");
  return map;
}

const EXPAND_SYSTEM =
  "You extend a student's concept map around ONE concept using their notes. Return STRICT JSON only: " +
  '{"nodes":[{"id":"x1","label":"...","note":"under 20 words","topic":"...","src":1}],"edges":[{"from":"@anchor","to":"x1","label":"verb phrase","kind":"part|cause|contrast|example|prereq|other"}]}. ' +
  'Propose 3–6 NEW concepts that the notes connect to the given concept, plus links using the id "@anchor" for the given concept, new ids for new concepts, and existing concept LABELS (exactly as listed) when a new concept also links to something already on the map. ' +
  "Only use what the notes support. Concepts are 1–4 words; links have short verb-phrase labels.";

export async function expandConcept(map: ConceptMap, anchorId: string, excerpts: Excerpt[]): Promise<{ map: ConceptMap; addedNodes: number; addedEdges: number }> {
  const anchor = map.nodes.find((n) => n.id === anchorId);
  if (!anchor) throw new AiError("Pick a concept first.");
  const raw = await claude({
    feature: "map.expand", maxTokens: 2500, system: EXPAND_SYSTEM,
    user: [text(`Concept to expand: ${anchor.label}${anchor.note ? ` — ${anchor.note}` : ""}\nConcepts already on the map: ${map.nodes.map((n) => n.label).join("; ")}\n\nNotes:\n\n${ctxOf(excerpts)}`)],
  });
  const out = applyAdditions(map, anchorId, extractJson<unknown>(raw), srcOf(excerpts));
  if (!out.addedNodes && !out.addedEdges) throw new AiError("I couldn't find anything new in your notes connected to that concept.");
  return out;
}

export type Connection = { label: string; kind: EdgeKind; explanation: string; question: string };

const LINK_SYSTEM =
  "You explain how two concepts in a student's notes are related. Return STRICT JSON only: " +
  '{"label":"short verb phrase for a map link","kind":"part|cause|contrast|example|prereq|other","explanation":"2–3 sentences in plain words, using the student\'s notes where they help","question":"one question that tests whether the student understands the link"}. ' +
  "If the concepts are not meaningfully related, say so honestly in the explanation and use kind \"other\" and label \"unrelated\". Use LaTeX in $...$ for maths.";

export async function explainConnection(a: string, b: string, excerpts: Excerpt[]): Promise<Connection> {
  const raw = await claude({
    feature: "map.link", maxTokens: 800, system: LINK_SYSTEM,
    user: [text(`Concept A: ${a}\nConcept B: ${b}\n\nStudent's notes (for context):\n\n${ctxOf(excerpts).slice(0, 9000)}`)],
  });
  const j = extractJson<Partial<Connection>>(raw);
  const s = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");
  return {
    label: s(j.label, 36) || "relates to",
    kind: (["part", "cause", "contrast", "example", "prereq", "other"] as const).find((k) => k === j.kind) ?? "other",
    explanation: s(j.explanation, 700), question: s(j.question, 300),
  };
}
