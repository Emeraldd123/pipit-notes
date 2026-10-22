import test from "node:test";
import assert from "node:assert/strict";
import {
  mulberry32, normalizeAnswer, parseNumber, checkTyped, levenshtein, pickDistractors, buildLesson, selectCards, exerciseCards,
  gradeFor, applyOutcomes, newProgress, addXp, currentStreak, lessonXp, dayKey, topicStats, makeCard, dedupeCards, lastDays, xpToday,
} from "../src/lib/study-core.ts";
import { newSrs, schedule } from "../src/lib/srs.ts";

const NOW = new Date("2026-03-10T12:00:00").getTime(), DAY = 86_400_000;
let n = 0;
const card = (front, back, extra = {}) => ({ id: `c${++n}`, front, back, kind: "basic", notebookId: null, source: "manual", createdAt: NOW + n, updatedAt: NOW, ...newSrs(NOW), ...extra });
const deck = () => [
  card("Powerhouse of the cell", "Mitochondria", { topic: "Cells" }),
  card("Site of photosynthesis", "Chloroplast", { topic: "Cells" }),
  card("Controls the cell", "Nucleus", { topic: "Cells" }),
  card("Makes proteins", "Ribosome", { topic: "Cells" }),
  card("Packages proteins", "Golgi apparatus", { topic: "Cells" }),
  card("Unit of heredity", "Gene", { topic: "Genetics" }),
  card("Allele pair identical", "Homozygous", { topic: "Genetics" }),
  card("Allele pair different", "Heterozygous", { topic: "Genetics" }),
];

test("answers are compared forgivingly but not carelessly", () => {
  assert.equal(normalizeAnswer("  The  Nucleus! "), "the nucleus");
  assert.ok(checkTyped("mitochondria", "Mitochondria").ok);
  assert.ok(checkTyped("mitochondira", "Mitochondria").close);              // typo accepted, flagged
  assert.equal(checkTyped("ribosome", "Mitochondria").ok, false);
  assert.equal(checkTyped("", "x").ok, false);
  assert.ok(checkTyped("1/2", "0.5").ok);
  assert.ok(checkTyped("$\\frac{1}{2}$", "1/2").ok);
  assert.ok(checkTyped("3.0 x 10^2", "300").ok);
  assert.equal(checkTyped("300.2", "300").ok, true);                        // within 0.1%
  assert.equal(checkTyped("301", "300").ok, false);
  assert.equal(checkTyped("310", "300").ok, false);
  assert.ok(checkTyped("2 x", "2x").ok);
  assert.ok(checkTyped("O2", "oxygen", ["o2"]).ok);                          // alternates
  assert.equal(parseNumber("abc"), null);
  assert.equal(parseNumber("1/0"), null);
  assert.equal(levenshtein("kitten", "sitting"), 3);
});

test("distractors are other cards answers, never the right one, preferring the same topic", () => {
  const d = deck();
  const rng = mulberry32(1);
  const opts = pickDistractors(d[0], d, 3, rng);
  assert.equal(opts.length, 3);
  assert.ok(!opts.includes("Mitochondria"));
  assert.ok(opts.filter((o) => ["Chloroplast", "Nucleus", "Ribosome", "Golgi apparatus"].includes(o)).length >= 2);
  assert.deepEqual(pickDistractors(d[0], [d[0]], 3, rng), []);              // nothing to choose from
});

test("a lesson mixes exercise types, covers every chosen card, is deterministic for a seed", () => {
  const d = deck();
  const a = buildLesson(d, { size: 8, rng: mulberry32(7), now: NOW });
  const b = buildLesson(d, { size: 8, rng: mulberry32(7), now: NOW });
  assert.deepEqual(a, b);
  const covered = new Set(a.flatMap(exerciseCards));
  assert.equal(covered.size, 8);
  assert.ok(new Set(a.map((e) => e.kind)).size >= 2);
  const mcq = a.find((e) => e.kind === "mcq");
  assert.ok(mcq && mcq.options.length === 4 && mcq.options[mcq.answer]);
  assert.notEqual(a[0].kind, "match");                                       // the matching round isn't first
});

test("tiny decks degrade gracefully", () => {
  const two = deck().slice(0, 2);
  const l = buildLesson(two, { rng: mulberry32(3), now: NOW });
  assert.equal(l.length, 2);
  assert.ok(l.every((e) => ["flip", "typed", "tf"].includes(e.kind)));        // not enough distractors for multiple choice
  assert.deepEqual(buildLesson([], {}), []);
});

test("cloze and step cards get their own exercise types", () => {
  const cl = card("Water boils at ____ C at sea level", "100", { kind: "cloze" });
  const st = card("Order the steps of mitosis", "PMAT", { kind: "steps", steps: ["Prophase", "Metaphase", "Anaphase", "Telophase"] });
  const l = buildLesson([cl, st, ...deck().slice(0, 3)], { size: 5, rng: mulberry32(2), now: NOW });
  assert.ok(l.some((e) => e.kind === "cloze" && e.answer === "100"));
  assert.ok(l.some((e) => e.kind === "order" && e.steps.length === 4));
});

test("card selection: overdue first, a few new, then weakest", () => {
  const d = deck();
  const known = schedule(schedule(newSrs(NOW - 20 * DAY), 2, NOW - 20 * DAY), 2, NOW - 19 * DAY); // due ~15 days ago
  d[0] = { ...d[0], ...known };
  d[1] = { ...d[1], ...schedule(newSrs(NOW), 2, NOW) };                       // learned today, not due
  const sel = selectCards(d, { size: 5, now: NOW, maxNew: 2 });
  assert.equal(sel[0].id, d[0].id);
  assert.equal(sel.length, 5);
  assert.equal(selectCards(d, { size: 5, now: NOW, dueOnly: true }).length, 1);
  assert.equal(selectCards(d, { size: 8, now: NOW, topic: "Genetics" }).every((c) => c.topic === "Genetics"), true);
  assert.equal(selectCards(d.map((c) => ({ ...c, suspended: true })), { now: NOW }).length, 0);
});

test("outcomes reschedule cards: right first time = Good, a slip = Again, self-grade wins", () => {
  const d = deck().slice(0, 3);
  const out = applyOutcomes(d, [
    { cardId: d[0].id, firstTry: true },
    { cardId: d[1].id, firstTry: false },
    { cardId: d[2].id, firstTry: true, grade: 3 },
    { cardId: d[2].id, firstTry: true },
  ], NOW);
  assert.equal(out[0].interval, 3);                                            // Good on a new card (FSRS default)
  assert.equal(out[1].interval, 0);
  assert.equal(out[2].interval, 16);                                           // Easy
  assert.equal(gradeFor([{ cardId: "x", firstTry: false }, { cardId: "x", firstTry: true }]), 0);
});

test("streaks, XP and the daily goal", () => {
  let p = { ...newProgress(), freezes: 0 };                      // without a freeze in hand
  const D1 = NOW, D2 = NOW + DAY, D4 = NOW + 3 * DAY;
  p = addXp(p, 30, D1);  assert.equal(p.streak, 1);
  p = addXp(p, 25, D1);  assert.equal(p.streak, 1); assert.equal(xpToday(p, D1), 55);
  p = addXp(p, 10, D2);  assert.equal(p.streak, 2); assert.equal(p.best, 2);
  assert.equal(currentStreak(p, D2), 2);
  assert.equal(currentStreak(p, D2 + DAY), 2);                                 // yesterday still counts until today passes
  assert.equal(currentStreak(p, D4), 0);                                       // two missed days breaks it
  p = addXp(p, 10, D4);  assert.equal(p.streak, 1); assert.equal(p.best, 2);
  assert.equal(p.xp, 75);
  assert.equal(lastDays(p, 3, D4).map((d) => d.xp).join(), "10,0,10");
  assert.equal(dayKey(NOW), "2026-03-10");
});

test("lesson XP rewards accuracy and combos", () => {
  const perfect = lessonXp({ total: 8, correctFirstTry: 8, maxCombo: 8, completed: true });
  const messy = lessonXp({ total: 8, correctFirstTry: 4, maxCombo: 2, completed: true });
  const quit = lessonXp({ total: 8, correctFirstTry: 4, maxCombo: 2, completed: false });
  assert.ok(perfect > messy && messy > quit);
  assert.equal(quit, 20);
});

test("topics group cards for the skill path", () => {
  const d = deck();
  d[0] = { ...d[0], ...schedule(schedule(newSrs(NOW), 3, NOW), 3, NOW) };
  const t = topicStats(d, NOW + 30 * DAY);
  assert.deepEqual(t.map((x) => x.topic), ["Cells", "Genetics"]);
  assert.equal(t[0].cards.length, 5);
  assert.ok(t[0].mastery > 0 && t[1].mastery === 0);
  assert.equal(t[1].fresh, 3);
});

test("new cards and duplicates", () => {
  const c = makeCard({ front: "Q", back: "A" }, NOW);
  assert.equal(c.reps, 0); assert.equal(c.kind, "basic"); assert.equal(c.source, "manual");
  const out = dedupeCards([{ front: "Powerhouse of the cell?" }, { front: "New thing" }, { front: "New thing" }], deck());
  assert.deepEqual(out.map((x) => x.front), ["New thing"]);          // the first is the same question as an existing card
});

test("streak freezes cover a missed day, are earned every 7 days, and cap at 2", () => {
  let p = newProgress();
  assert.equal(p.freezes, 1);
  const day = (n) => NOW + n * DAY;
  p = addXp(p, 5, day(0)); p = addXp(p, 5, day(1));            // streak 2
  assert.equal(currentStreak(p, day(3)), 2);                      // one missed day: the freeze will save it
  p = addXp(p, 5, day(3));                                        // missed day 2
  assert.equal(p.streak, 3);
  assert.equal(p.freezes, 0);
  assert.equal(p.frozen.length, 1);
  assert.equal(currentStreak(p, day(5)), 0);                      // no freezes left: a missed day breaks it
  for (let d = 4; d <= 7; d++) p = addXp(p, 5, day(d));           // streak reaches 7 -> earn one back
  assert.equal(p.streak, 7);
  assert.equal(p.freezes, 1);
  for (let d = 8; d <= 21; d++) p = addXp(p, 5, day(d));
  assert.equal(p.freezes, 2);                                     // capped
});
