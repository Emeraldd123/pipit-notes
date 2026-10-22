// Pure helpers for "review my mistakes": turn the model's per-page findings into a clean,
// ordered list of issues with document-space highlight rectangles. No DOM, no network.
import { PAGE_H, PAGE_W, pageTop } from "./page.ts";

export type IssueKind = "arithmetic" | "algebra" | "sign" | "concept" | "units" | "missing-step" | "notation" | "other";
export const ISSUE_KINDS: IssueKind[] = ["arithmetic", "algebra", "sign", "concept", "units", "missing-step", "notation", "other"];

/** What the model returns for one page; bbox is fractions of the page image: [x, y, w, h] in 0..1. */
export type RawIssue = {
  bbox?: unknown;
  read?: unknown;        // what the model read on that line
  problem?: unknown;     // what is wrong
  why?: unknown;         // why it's wrong / the principle
  fix?: unknown;         // the corrected version
  kind?: unknown;
  confidence?: unknown;
};

export type Issue = {
  id: string;
  page: number;                                   // 0-based
  rect: { x: number; y: number; w: number; h: number };   // document coordinates (pages stacked)
  read: string;
  problem: string;
  why: string;
  fix: string;
  kind: IssueKind;
  confidence: "high" | "medium";
};

const str = (v: unknown, max = 600) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** Fractions-of-page bbox -> document rect, padded a little, clamped to the page. Null if unusable. */
export function bboxToDoc(bbox: unknown, page: number): Issue["rect"] | null {
  if (!Array.isArray(bbox) || bbox.length !== 4) return null;
  const n = bbox.map((v) => (typeof v === "number" ? v : Number.NaN));
  if (n.some((v) => !Number.isFinite(v))) return null;
  let [x, y, w, h] = n;
  if (w <= 0 || h <= 0) return null;
  // tolerate a model that answered in 0..100 percent instead of 0..1
  if (x > 1.5 || y > 1.5 || w > 1.5 || h > 1.5) { x /= 100; y /= 100; w /= 100; h /= 100; }
  const padX = 0.012, padY = 0.006;
  const x0 = clamp01(x - padX), y0 = clamp01(y - padY);
  const x1 = clamp01(x + w + padX), y1 = clamp01(y + h + padY);
  if (x1 - x0 < 0.005 || y1 - y0 < 0.003) return null;
  return { x: x0 * PAGE_W, y: pageTop(page) + y0 * PAGE_H, w: (x1 - x0) * PAGE_W, h: (y1 - y0) * PAGE_H };
}

export function normalizeIssues(raw: unknown, page: number): Issue[] {
  if (!Array.isArray(raw)) return [];
  const out: Issue[] = [];
  for (const r of raw as RawIssue[]) {
    if (!r || typeof r !== "object") continue;
    const rect = bboxToDoc(r.bbox, page);
    const problem = str(r.problem);
    if (!rect || !problem) continue;
    const kind = ISSUE_KINDS.includes(r.kind as IssueKind) ? (r.kind as IssueKind) : "other";
    out.push({
      id: `${page}-${out.length}`,
      page, rect, kind,
      read: str(r.read, 300), problem, why: str(r.why), fix: str(r.fix),
      confidence: r.confidence === "medium" ? "medium" : "high",
    });
  }
  return sortIssues(dedupe(out));
}

/** Top-to-bottom reading order (page, then y, then x). */
export function sortIssues(issues: Issue[]): Issue[] {
  return [...issues].sort((a, b) => a.page - b.page || a.rect.y - b.rect.y || a.rect.x - b.rect.x);
}

/** Drop findings that highlight (almost) the same spot as an earlier, same-page finding. */
function dedupe(issues: Issue[]): Issue[] {
  const kept: Issue[] = [];
  for (const i of issues) {
    const dup = kept.some((k) => k.page === i.page && overlap(k.rect, i.rect) > 0.7);
    if (!dup) kept.push(i);
  }
  return kept;
}

function overlap(a: Issue["rect"], b: Issue["rect"]): number {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const inter = ix * iy;
  return inter / Math.min(a.w * a.h, b.w * b.h);
}

/** Merge per-page results into one globally ordered list with stable ids. */
export function mergeReview(perPage: { page: number; issues: Issue[] }[]): Issue[] {
  const all = sortIssues(perPage.flatMap((p) => p.issues));
  return all.map((i, n) => ({ ...i, id: `m${n}` }));
}

/** Pages chosen in the picker -> sorted, de-duplicated, in-range indices. */
export function pickPages(selected: Iterable<number>, pageCount: number): number[] {
  return [...new Set([...selected].filter((p) => Number.isInteger(p) && p >= 0 && p < pageCount))].sort((a, b) => a - b);
}

export function summarize(issues: Issue[]): string {
  if (!issues.length) return "No mistakes found";
  const pages = new Set(issues.map((i) => i.page)).size;
  return `${issues.length} possible mistake${issues.length === 1 ? "" : "s"} on ${pages} page${pages === 1 ? "" : "s"}`;
}
