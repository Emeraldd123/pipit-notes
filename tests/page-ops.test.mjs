import test from "node:test";
import assert from "node:assert/strict";
import { moveMapping, duplicateMapping, insertBlankMapping, deleteMapping, pageOfY, remapItems, targetsByOldPage } from "../src/lib/page-ops.ts";
import { pageTop, PAGE_H } from "../src/lib/page.ts";

test("mappings", () => {
  assert.deepEqual(moveMapping(4, 0, 2), [1, 2, 0, 3]);
  assert.deepEqual(moveMapping(4, 3, 0), [3, 0, 1, 2]);
  assert.deepEqual(moveMapping(3, 1, 99), [0, 2, 1]);
  assert.deepEqual(duplicateMapping(3, 1), [0, 1, 1, 2]);
  assert.deepEqual(insertBlankMapping(2, 0), [0, -1, 1]);
  assert.deepEqual(insertBlankMapping(2, -1), [-1, 0, 1]);
  assert.deepEqual(deleteMapping(3, 1), [0, 2]);
  assert.deepEqual(deleteMapping(1, 0), [-1]);              // a note always keeps one page
});

test("page of a y position, including gaps and overshoot", () => {
  assert.equal(pageOfY(10, 3), 0);
  assert.equal(pageOfY(pageTop(1) + 5, 3), 1);
  assert.equal(pageOfY(PAGE_H + 10, 3), 0);                  // in the gap below page 0 stays with page 0
  assert.equal(pageOfY(1e9, 3), 2);
  assert.equal(pageOfY(-50, 3), 0);
});

const mk = (id, page, off = 100) => ({ id, y: pageTop(page) + off });
const at = (page) => (t) => page;
test("moving a page carries its items; others shift to fill the gap", () => {
  const items = [mk("a", 0), mk("b", 1), mk("c", 2)];
  const out = remapItems(items, 3, [1, 2, 0], (t) => Math.floor(t.y / (PAGE_H + 36)), (t, dy) => ({ ...t, y: t.y + dy }));
  const byId = Object.fromEntries(out.map((o) => [o.item.id, o.item.y]));
  assert.equal(byId.b, pageTop(0) + 100);
  assert.equal(byId.c, pageTop(1) + 100);
  assert.equal(byId.a, pageTop(2) + 100);
  assert.ok(out.every((o) => !o.isClone));
});

test("duplicating a page clones its items onto the copy", () => {
  const items = [mk("a", 0), mk("b", 1)];
  const out = remapItems(items, 2, [0, 1, 1], (t) => Math.floor(t.y / (PAGE_H + 36)), (t, dy) => ({ ...t, y: t.y + dy }));
  assert.equal(out.length, 3);
  const bs = out.filter((o) => o.item.id === "b");
  assert.equal(bs.length, 2);
  assert.deepEqual(bs.map((o) => o.isClone), [false, true]);
  assert.deepEqual(bs.map((o) => o.item.y), [pageTop(1) + 100, pageTop(2) + 100]);
});

test("deleting a page drops its items; inserted blanks hold nothing", () => {
  const items = [mk("a", 0), mk("b", 1), mk("c", 2)];
  const del = remapItems(items, 3, [0, 2], (t) => Math.floor(t.y / (PAGE_H + 36)), (t, dy) => ({ ...t, y: t.y + dy }));
  assert.deepEqual(del.map((o) => o.item.id), ["a", "c"]);
  assert.equal(del[1].item.y, pageTop(1) + 100);
  const ins = remapItems(items, 3, [0, -1, 1, 2], (t) => Math.floor(t.y / (PAGE_H + 36)), (t, dy) => ({ ...t, y: t.y + dy }));
  assert.equal(ins.find((o) => o.item.id === "b").item.y, pageTop(2) + 100);
  assert.equal(targetsByOldPage([0, -1, 1]).get(1)[0], 2);
});
