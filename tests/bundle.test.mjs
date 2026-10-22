// Backup format round-trip: bundle -> zip -> unzip -> bundle must be lossless.
import { test } from "node:test";
import assert from "node:assert/strict";
import { zipSync, unzipSync } from "fflate";
import { bundleFiles, readBundle } from "../src/lib/bundle-format.ts";

const note = (id, strokes = 3) => ({
  meta: { id, title: `Note ${id}`, notebookId: "nb1", paper: "ruled", pageCount: 2, tags: ["a"], isPinned: false, createdAt: 1, updatedAt: 2, strokeCount: strokes, imageCount: 1 },
  strokes: Array.from({ length: strokes }, (_, i) => ({ id: `${id}-s${i}`, tool: "pen", color: "#111", width: 3, points: [{ x: i, y: i * 2, p: 0.5 }, { x: i + 1, y: i * 2 + 1, p: 0.6 }] })),
  blocks: [{ id: `${id}-b`, noteId: id, kind: "code", x: 1, y: 2, width: 600, height: 200, text: "print(1)", lang: "python", output: "1", createdAt: 3 }],
  pageText: [{ key: `${id}:0:ink`, noteId: id, page: 0, source: "ink", text: "hello", hash: "h", updatedAt: 4 }],
  images: [{ id: `${id}-i`, x: 10, y: 20, width: 300, height: 400, rotation: 0, zIndex: 1, mime: "image/jpeg", bytes: new Uint8Array([1, 2, 3, 255, 0, 7]) }],
});

test("bundle round-trips through a real zip", () => {
  const bundle = { notebooks: [{ id: "nb1", name: "Chem", color: "#3d5244", createdAt: 5 }], notes: [note("n1"), note("n2", 5)] };
  const zipped = zipSync(Object.fromEntries(Object.entries(bundleFiles(bundle)).map(([k, v]) => [k, [v, { level: k.startsWith("images/") ? 0 : 1 }]])));
  const back = readBundle(unzipSync(zipped));
  assert.deepEqual(back.notebooks, bundle.notebooks);
  assert.equal(back.notes.length, 2);
  const n2 = back.notes.find((n) => n.meta.id === "n2");
  assert.equal(n2.strokes.length, 5);
  assert.deepEqual(n2.strokes[4], bundle.notes[1].strokes[4]);
  assert.deepEqual(n2.blocks, bundle.notes[1].blocks);
  assert.deepEqual(n2.pageText, bundle.notes[1].pageText);
  assert.deepEqual([...n2.images[0].bytes], [1, 2, 3, 255, 0, 7]);
  assert.equal(n2.images[0].mime, "image/jpeg");
});

test("rejects things that aren't backups", () => {
  assert.throws(() => readBundle({}), /Not a Pipit Notes backup/);
  assert.throws(() => readBundle({ "manifest.json": new TextEncoder().encode('{"format":"other"}') }), /Not a Pipit Notes backup/);
  assert.throws(() => readBundle({ "manifest.json": new TextEncoder().encode('{"format":"pipit-notes-bundle","version":99}') }), /newer version/);
});

test("a missing image file skips that image, not the whole note", () => {
  const files = bundleFiles({ notebooks: [], notes: [note("n1")] });
  for (const k of Object.keys(files)) if (k.startsWith("images/")) delete files[k];
  const back = readBundle(files);
  assert.equal(back.notes.length, 1);
  assert.equal(back.notes[0].images.length, 0);
  assert.equal(back.notes[0].strokes.length, 3);
});
