import test from "node:test";
import assert from "node:assert/strict";
import { priceFor, costUsd, effortFor, supportsEffort, maxTokensFor, modelFor, estimateUsd, formatUsd, record, monthTotal, monthByFeature, monthKey } from "../src/lib/ai-cost.ts";

const S = { model: "claude-sonnet-5-5", economy: true, economyModel: "claude-haiku-5-5", careful: false };

test("prices follow the published per-million rates, with cache discounts", () => {
  assert.deepEqual(priceFor("claude-sonnet-5-5"), [2, 10]);
  assert.deepEqual(priceFor("claude-haiku-5-5"), [0.1, 0.5]);
  assert.deepEqual(priceFor("claude-haiku-4-5-20251001"), [1, 5]);
  assert.deepEqual(priceFor("claude-opus-5-5"), [4, 20]);
  assert.deepEqual(priceFor("claude-opus-5"), [5, 25]);
  assert.deepEqual(priceFor("some-future-model"), [2, 10]);                                  // unknown -> a middle-of-the-road guess
  assert.ok(Math.abs(costUsd("claude-sonnet-5-5", { input_tokens: 1e6, output_tokens: 1e6 }) - 12) < 1e-9);
  assert.ok(Math.abs(costUsd("claude-sonnet-5-5", { cache_read_input_tokens: 1e6 }) - 0.2) < 1e-9);   // cache reads cost 10%
  assert.ok(Math.abs(costUsd("claude-sonnet-5-5", { cache_creation_input_tokens: 1e6 }) - 2.5) < 1e-9);
});

test("routine jobs use the cheaper model; hard ones never do", () => {
  assert.equal(modelFor("transcribe", S), "claude-haiku-5-5");
  assert.equal(modelFor("explain.followup", S), "claude-haiku-5-5");
  for (const f of ["exam", "exam.mark", "review", "explain", "cards", "map", "math", "working"]) assert.equal(modelFor(f, S), "claude-sonnet-5-5", f);
  assert.equal(modelFor("transcribe", { ...S, economy: false }), "claude-sonnet-5-5");
});

test("effort: simple jobs think little, hard ones more, careful mode raises it, old models get none", () => {
  assert.equal(effortFor("transcribe", false, "claude-sonnet-5-5"), "low");
  assert.equal(effortFor("exam", false, "claude-sonnet-5-5"), "medium");
  assert.equal(effortFor("transcribe", true, "claude-sonnet-5-5"), "medium");
  assert.equal(effortFor("exam", true, "claude-sonnet-5-5"), "high");
  assert.equal(effortFor("exam", false, "claude-haiku-4-5-20251001"), undefined);          // rejected by that model
  assert.equal(supportsEffort("claude-haiku-5-5"), true);
  assert.equal(supportsEffort("claude-sonnet-4-5"), false);
  assert.ok(maxTokensFor(600, "low") > 600 && maxTokensFor(12000, "medium") > maxTokensFor(12000, "low"));
  assert.equal(maxTokensFor(500, undefined), 500);
});

test("estimates scale with units and drop sharply on the cheap model", () => {
  const one = estimateUsd("review", 1, S), five = estimateUsd("review", 5, S);
  assert.ok(Math.abs(five - one * 5) < 1e-9);
  assert.ok(estimateUsd("transcribe", 20, S) < estimateUsd("transcribe", 20, { ...S, economy: false }) / 10);
  assert.ok(estimateUsd("exam", 1, S) > estimateUsd("review", 1, S));
  assert.equal(formatUsd(0.001), "< 1¢");
  assert.equal(formatUsd(0.042), "≈ 4¢");
  assert.equal(formatUsd(0.5), "≈ $0.50");
});

test("the ledger adds up per month and feature, and forgets old months", () => {
  const t = new Date("2026-03-15T12:00:00").getTime();
  let l = {};
  l = record(l, "exam", "claude-sonnet-5-5", { input_tokens: 6000, output_tokens: 8000 }, t);
  l = record(l, "exam", "claude-sonnet-5-5", { input_tokens: 6000, output_tokens: 8000 }, t);
  l = record(l, "transcribe", "claude-haiku-5-5", { input_tokens: 2000, output_tokens: 500 }, t);
  const m = monthKey(t);
  const by = monthByFeature(l, m);
  assert.equal(by[0].feature, "exam");
  assert.equal(by[0].calls, 2);
  assert.ok(Math.abs(monthTotal(l, m) - (2 * (6000 * 2 + 8000 * 10) / 1e6 + (2000 * 0.1 + 500 * 0.5) / 1e6)) < 1e-9);
  for (let i = 0; i < 8; i++) l = record(l, "exam", "claude-sonnet-5-5", { input_tokens: 1 }, new Date(2026, 3 + i, 5).getTime());
  assert.ok(Object.keys(l).length <= 6);
  assert.equal(monthTotal({}, m), 0);
});
