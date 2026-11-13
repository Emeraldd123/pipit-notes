import test from "node:test";
import assert from "node:assert/strict";
import { replyUsable, routeAllowed } from "../src/lib/ai-route-core.ts";

test("which jobs may go to the cheaper provider", () => {
  for (const f of ["transcribe", "math", "working", "mathcheck", "ask", "explain.followup"]) assert.ok(routeAllowed(f, "light"), f);
  assert.ok(!routeAllowed("explain", "light") && routeAllowed("explain", "most"));
  for (const f of ["exam", "exam.mark", "exam.verify", "test"]) assert.ok(!routeAllowed(f, "most"), `${f} stays on Claude`);
  assert.ok(!routeAllowed("something-new", "most"), "unknown jobs stay on Claude");
});

test("a bad reply is thrown away so the job goes to Claude", () => {
  assert.ok(replyUsable("working", '{"lines":[]}'));
  assert.ok(!replyUsable("working", "Sure! Here are the lines: x = 2"));
  assert.ok(!replyUsable("math", "x^2 +", "length"), "cut off");
  assert.ok(!replyUsable("math", "  "));
  assert.ok(replyUsable("transcribe", ""), "a blank page reads as nothing");
  assert.ok(!replyUsable("exam", "Here is your exam!"), "exams are JSON too");
});
