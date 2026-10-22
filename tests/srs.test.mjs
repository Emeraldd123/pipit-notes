import test from "node:test";
import assert from "node:assert/strict";
import { newSrs, schedule, isDue, isNew, crownOf, mastery, previewIntervals, formatInterval, retrievability, intervalFor, memoryOf, W } from "../src/lib/srs.ts";

const T = 1_000_000_000_000, DAY = 86_400_000;

test("FSRS forgetting curve: 90% recall exactly one stability out", () => {
  assert.ok(Math.abs(retrievability(10, 10) - 0.9) < 1e-12);
  assert.ok(retrievability(1, 10) > retrievability(20, 10));
  assert.ok(Math.abs(intervalFor(7) - 7) < 1e-9);             // at 90% desired retention the interval equals stability
  assert.ok(intervalFor(7, 0.95) < 7 && intervalFor(7, 0.8) > 7);
  assert.equal(W.length, 19);
});

test("a new card's first answer sets its starting interval", () => {
  const s = newSrs(T);
  assert.ok(isNew(s));
  const [again, hard, good, easy] = [0, 1, 2, 3].map((g) => schedule(s, g, T));
  assert.equal(again.interval, 0);
  assert.equal(again.due, T + 10 * 60_000);                    // relearn in 10 minutes
  assert.equal(hard.interval, 1);
  assert.equal(good.interval, 3);
  assert.equal(easy.interval, 16);
  assert.ok(good.difficulty < hard.difficulty && easy.difficulty < good.difficulty);
  assert.equal(again.lapses, 0);                                // failing a brand-new card isn't a lapse
});

test("remembering on time grows the gap; Easy grows it more, Hard less", () => {
  const first = schedule(newSrs(T), 2, T);                     // 3 days
  const t2 = T + first.interval * DAY;
  const [h, g, e] = [1, 2, 3].map((gr) => schedule(first, gr, t2).interval);
  assert.ok(h < g && g < e, `${h} ${g} ${e}`);
  assert.ok(g >= 8 && g <= 15, `good after 3 days -> ${g}`);
  let s = first, t = T;
  for (let i = 0; i < 5; i++) { t += s.interval * DAY; const n = schedule(s, 2, t); assert.ok(n.interval > s.interval); s = n; }
});

test("forgetting resets the gap, lowers stability and counts a lapse", () => {
  const known = schedule(schedule(newSrs(T), 2, T), 2, T + 3 * DAY);
  const lapsed = schedule(known, 0, T + 20 * DAY);
  assert.equal(lapsed.interval, 0);
  assert.equal(lapsed.lapses, 1);
  assert.ok(lapsed.stability < known.stability);
  assert.ok(lapsed.difficulty > known.difficulty);
  assert.ok(isDue(lapsed, T + 20 * DAY + 11 * 60_000));       // a lapsed card comes back as due (not lost)
});

test("cards from the old scheduler migrate sensibly", () => {
  const old = { due: T, interval: 10, ease: 2.5, reps: 4, lapses: 0, lastReviewed: T - 10 * DAY };
  const m = memoryOf(old);
  assert.equal(m.S, 10);
  assert.ok(m.D > 1 && m.D < 10);
  const next = schedule(old, 2, T);
  assert.ok(next.interval > 10);                                 // remembered on time: the gap keeps growing
  assert.ok(memoryOf({ ...old, ease: 1.3 }).D > memoryOf({ ...old, ease: 3 }).D);   // low ease = hard card
});

test("same-day re-review barely moves the schedule", () => {
  const s = schedule(newSrs(T), 2, T);
  const again = schedule(s, 2, T + 60 * 60_000);
  assert.ok(Math.abs(again.stability - s.stability) / s.stability < 0.5);
});

test("due / crowns / mastery / labels", () => {
  let s = newSrs(T);
  assert.equal(isDue(s, T + DAY), false);                      // new cards aren't "due", they're new
  s = schedule(s, 2, T);
  assert.equal(isDue(s, T + 2 * DAY), false);
  assert.equal(isDue(s, T + 4 * DAY), true);
  assert.equal(crownOf(newSrs(T)), 0);
  assert.equal(crownOf({ ...s, interval: 7 }), 3);
  assert.equal(mastery({ ...s, interval: 40 }), 1);
  assert.equal(formatInterval(10 * 60_000), "10m");
  assert.equal(formatInterval(3 * DAY), "3d");
  assert.deepEqual(previewIntervals(newSrs(T), T), ["10m", "1d", "3d", "16d"]);
});
