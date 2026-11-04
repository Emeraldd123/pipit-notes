import test from "node:test";
import assert from "node:assert/strict";
import { makeApi, BudgetError, writeExam, judgeExam } from "../tools/exam-lab.mjs";
import { mockFetch } from "../tools/exam-mock.mjs";
import { FIXTURES } from "../tools/exam-fixtures.mjs";

test("the spending cap refuses any call whose worst case could go over, counting calls in flight", async () => {
  const api = makeApi({ key: "mock", model: "claude-sonnet-5-5", budget: 0.3, fetchImpl: mockFetch });
  const f = FIXTURES[0];
  // two exams at once: each could cost ~$0.19, so the second must be refused even though nothing is spent yet
  const results = await Promise.allSettled([writeExam(api, f), writeExam(api, f)]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.ok(results.find((r) => r.status === "rejected").reason instanceof BudgetError);
  assert.ok(api.ledger.spent > 0 && api.ledger.spent <= 0.3);
  assert.equal(api.ledger.reserved, 0);
});

test("a mock exam goes through the app's validation and the judge", async () => {
  const api = makeApi({ key: "mock", model: "claude-sonnet-5-5", budget: 5, fetchImpl: mockFetch });
  const w = await writeExam(api, FIXTURES[1]);
  assert.ok(w.qs.length >= 6);
  const j = await judgeExam(api, { excerpts: w.excerpts, exam: w.exam, qs: w.qs });
  assert.equal(j.items.length, w.qs.length);
  assert.equal(typeof j.avg.realistic, "number");
});
