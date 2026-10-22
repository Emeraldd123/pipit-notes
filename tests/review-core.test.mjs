import test from "node:test";
import assert from "node:assert/strict";
import { bboxToDoc, normalizeIssues, mergeReview, pickPages, summarize } from "../src/lib/review-core.ts";
import { PAGE_H, PAGE_W, pageTop } from "../src/lib/page.ts";

test("bbox fractions map onto the right page in document space", () => {
  const r = bboxToDoc([0.1, 0.5, 0.4, 0.05], 2);
  assert.ok(r);
  assert.ok(r.x < 0.1 * PAGE_W && r.x > 0.08 * PAGE_W);                 // padded slightly left
  assert.ok(r.y > pageTop(2) + 0.49 * PAGE_H && r.y < pageTop(2) + 0.5 * PAGE_H);
  assert.ok(r.w > 0.4 * PAGE_W && r.h > 0.05 * PAGE_H);
  assert.ok(r.y + r.h < pageTop(2) + PAGE_H);                           // never spills onto the next page
});

test("bad boxes are rejected; percent answers are tolerated; edges are clamped", () => {
  for (const bad of [null, [], [0, 0, 0, 0], [0.1, 0.1, -1, 0.1], ["a", 0, 1, 1], [0.1, 0.1, 0.1], "x", [NaN, 0, 1, 1]]) assert.equal(bboxToDoc(bad, 0), null);
  const pct = bboxToDoc([10, 50, 40, 5], 0);
  const frac = bboxToDoc([0.1, 0.5, 0.4, 0.05], 0);
  assert.ok(pct && frac);
  assert.ok(Math.abs(pct.x - frac.x) < 1e-6 && Math.abs(pct.y - frac.y) < 1e-6);
  const edge = bboxToDoc([0.95, 0.97, 0.3, 0.2], 0);
  assert.ok(edge && edge.x + edge.w <= PAGE_W + 1e-6 && edge.y + edge.h <= PAGE_H + 1e-6);
});

test("issues are validated, defaulted and put in reading order", () => {
  const raw = [
    { bbox: [0.1, 0.6, 0.5, 0.04], problem: "Sign error", why: "−(−3) = +3", fix: "x = 5", kind: "sign", read: "x = 2 - 3" },
    { bbox: [0.1, 0.2, 0.5, 0.04], problem: "Forgot to square", kind: "nonsense", confidence: "medium" },
    { bbox: "oops", problem: "no location" },
    { bbox: [0.1, 0.3, 0.2, 0.04] },                 // no problem text
    null, 7,
  ];
  const out = normalizeIssues(raw, 0);
  assert.equal(out.length, 2);
  assert.equal(out[0].problem, "Forgot to square");  // higher on the page first
  assert.equal(out[0].kind, "other");
  assert.equal(out[0].confidence, "medium");
  assert.equal(out[1].kind, "sign");
  assert.equal(out[1].confidence, "high");
  assert.deepEqual(normalizeIssues("not an array", 0), []);
});

test("duplicate findings on the same spot collapse", () => {
  const out = normalizeIssues([
    { bbox: [0.1, 0.2, 0.5, 0.04], problem: "A" },
    { bbox: [0.11, 0.2, 0.5, 0.04], problem: "A again" },
    { bbox: [0.1, 0.5, 0.5, 0.04], problem: "B" },
  ], 1);
  assert.equal(out.length, 2);
});

test("whole-note review runs top to bottom across pages", () => {
  const p0 = normalizeIssues([{ bbox: [0.1, 0.8, 0.3, 0.03], problem: "late on p1" }], 0);
  const p1 = normalizeIssues([{ bbox: [0.1, 0.1, 0.3, 0.03], problem: "early on p2" }], 1);
  const merged = mergeReview([{ page: 1, issues: p1 }, { page: 0, issues: p0 }]);
  assert.deepEqual(merged.map((i) => i.problem), ["late on p1", "early on p2"]);
  assert.equal(new Set(merged.map((i) => i.id)).size, 2);
  assert.equal(summarize(merged), "2 possible mistakes on 2 pages");
  assert.equal(summarize([]), "No mistakes found");
});

test("page picker ignores junk and out-of-range pages", () => {
  assert.deepEqual(pickPages([3, 1, 1, -1, 9, 2.5, 0], 4), [0, 1, 3]);
});
