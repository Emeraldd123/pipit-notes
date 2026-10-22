import test from "node:test";
import assert from "node:assert/strict";
import { unitCirclePoints } from "../src/lib/templates.ts";

test("unit circle values are right in every quadrant", () => {
  const pts = unitCirclePoints();
  const at = (d) => pts.find((p) => p.deg === d);
  assert.equal(pts.length, 16);                                    // every 30° and 45°
  assert.deepEqual(at(0), { deg: 0, rad: "0", x: "1", y: "0" });
  assert.deepEqual(at(30), { deg: 30, rad: "π/6", x: "√3/2", y: "1/2" });
  assert.deepEqual(at(120), { deg: 120, rad: "2π/3", x: "−1/2", y: "√3/2" });
  assert.deepEqual(at(225), { deg: 225, rad: "5π/4", x: "−√2/2", y: "−√2/2" });
  assert.deepEqual(at(270), { deg: 270, rad: "3π/2", x: "0", y: "−1" });
  assert.deepEqual(at(180), { deg: 180, rad: "π", x: "−1", y: "0" });
  assert.deepEqual(at(330), { deg: 330, rad: "11π/6", x: "√3/2", y: "−1/2" });
});
