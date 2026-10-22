import test from "node:test";
import assert from "node:assert/strict";
import { newSrs, schedule, isDue, isNew, crownOf, mastery, previewIntervals, formatInterval } from "../src/lib/srs.ts";

const T = 1_000_000_000_000, DAY = 86_400_000;

test("a new card climbs 1 → 3 → ease-scaled days when answered Good", () => {
  let s = newSrs(T);
  assert.ok(isNew(s));
  s = schedule(s, 2, T);          assert.equal(s.interval, 1);
  s = schedule(s, 2, T + DAY);    assert.equal(s.interval, 3);
  s = schedule(s, 2, T + 4 * DAY); assert.equal(s.interval, Math.round(3 * 2.5));
  assert.equal(s.reps, 3);
  assert.ok(Math.abs(s.due - (T + 4 * DAY + 8 * DAY)) < 1);
});

test("Again resets progress, costs ease, counts a lapse only for known cards", () => {
  const known = schedule(schedule(newSrs(T), 2, T), 2, T);
  const lapsed = schedule(known, 0, T + 10 * DAY);
  assert.equal(lapsed.interval, 0);
  assert.equal(lapsed.reps, 0);
  assert.equal(lapsed.lapses, 1);
  assert.ok(lapsed.ease < 2.5);
  assert.equal(lapsed.due, T + 10 * DAY + 10 * 60_000);
  assert.equal(schedule(newSrs(T), 0, T).lapses, 0);                  // failing a brand-new card isn't a lapse
  assert.ok(schedule({ ...newSrs(T), ease: 1.35 }, 0, T).ease >= 1.3); // ease has a floor
});

test("Easy grows faster than Good; Hard slower", () => {
  const base = schedule(schedule(newSrs(T), 2, T), 2, T); // interval 3
  const [h, g, e] = [1, 2, 3].map((gr) => schedule(base, gr, T).interval);
  assert.ok(h < g && g < e);
  assert.ok(schedule(base, 3, T).ease > base.ease);
});

test("due / crowns / mastery", () => {
  let s = newSrs(T);
  assert.equal(isDue(s, T + DAY), false);          // new cards aren't "due", they're new
  s = schedule(s, 2, T);
  assert.equal(isDue(s, T + 0.5 * DAY), false);
  assert.equal(isDue(s, T + 2 * DAY), true);
  assert.equal(crownOf(newSrs(T)), 0);
  assert.equal(crownOf({ ...s, interval: 7 }), 3);
  assert.equal(crownOf({ ...s, interval: 40 }), 5);
  assert.equal(mastery({ ...s, interval: 40 }), 1);
});

test("interval labels", () => {
  assert.equal(formatInterval(10 * 60_000), "10m");
  assert.equal(formatInterval(3 * 3600_000), "3h");
  assert.equal(formatInterval(3 * DAY), "3d");
  assert.equal(formatInterval(90 * DAY), "3mo");
  const p = previewIntervals(newSrs(T), T);
  assert.deepEqual(p, ["10m", "6h", "1d", "3d"]);
});
