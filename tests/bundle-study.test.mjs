import test from "node:test";
import assert from "node:assert/strict";
import { zipSync, unzipSync, strToU8 } from "fflate";
import { bundleFiles, readBundle } from "../src/lib/bundle-format.ts";

const zip = (files) => unzipSync(zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, [v, { level: 1 }]]))));

test("study data (cards, mistakes, exams, progress) survives a backup round trip", () => {
  const study = {
    cards: [{ id: "c1", front: "Q", back: "A", reps: 2, interval: 3, updatedAt: 5 }],
    mistakes: [{ id: "m1", noteId: "n1", page: 0, problem: "sign" }],
    exams: [{ id: "e1", exam: { title: "T", sections: [] }, attempts: [] }],
    progress: { xp: 120, streak: 4 },
    maps: [{ id: "m1", title: "Map", nodes: [], edges: [], updatedAt: 9 }],
  };
  const back = readBundle(zip(bundleFiles({ notebooks: [], notes: [], study })));
  assert.deepEqual(back.study, study);
});

test("older backups (no study file) still restore, and a damaged study file never blocks notes", () => {
  const plain = bundleFiles({ notebooks: [], notes: [] });
  assert.equal(readBundle(zip(plain)).study, undefined);
  const damaged = { ...plain, "study.json": strToU8("{ not json") };
  const back = readBundle(zip(damaged));
  assert.equal(back.study, undefined);
  assert.deepEqual(back.notes, []);
});
