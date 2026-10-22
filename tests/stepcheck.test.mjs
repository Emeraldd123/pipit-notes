// Verifies the SymPy step-checker against known-right and known-wrong working, by
// extracting the EXACT Python from src/lib/stepcheck.ts and running it with a local
// Python that has sympy. Skipped (not failed) if Python/sympy isn't available.
//   PYTHON=python PYTHONPATH=<dir with sympy> node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const src = readFileSync(new URL("../src/lib/stepcheck.ts", import.meta.url), "utf8");
const m = /String\.raw`([\s\S]*?)`;\s*\n\s*export async function verifyWorking/.exec(src);
assert.ok(m, "could not extract VERIFY python from stepcheck.ts");
const code = m[1].replace(/\njson\.dumps\(res\)\s*$/, "\nprint(json.dumps(res))");

const py = process.env.PYTHON || "python";
const probe = spawnSync(py, ["-c", "import sympy"], { env: process.env });
const haveSympy = probe.status === 0;

function run(lines) {
  const dir = mkdtempSync(join(tmpdir(), "pn-"));
  const file = join(dir, "v.py");
  writeFileSync(file, `_pn_lines = ${JSON.stringify(JSON.stringify(lines))}\n${code}`);
  const r = spawnSync(py, [file], { env: process.env, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout.trim().split("\n").pop());
}
const eq = (s) => ({ latex: s, sympy: s, kind: "eq" });
const ex = (s) => ({ latex: s, sympy: s, kind: "expr" });
const statuses = (res) => res.map((r) => r.status);

test("linear equation solved correctly", { skip: !haveSympy }, () => {
  assert.deepEqual(statuses(run([eq("2*x+3=7"), eq("2*x=4"), eq("x=2")])), ["start", "ok", "ok"]);
});
test("arithmetic slip in an equation is flagged", { skip: !haveSympy }, () => {
  assert.deepEqual(statuses(run([eq("2*x+3=7"), eq("2*x=5"), eq("x=5/2")])), ["start", "error", "ok"]);
});
test("implicit multiplication (2x) parses", { skip: !haveSympy }, () => {
  assert.deepEqual(statuses(run([eq("2x+3=7"), eq("x=2")])), ["start", "ok"]);
});
test("expression expansion", { skip: !haveSympy }, () => {
  assert.deepEqual(statuses(run([ex("(x+1)**2"), ex("x**2+2*x+1")])), ["start", "ok"]);
  assert.deepEqual(statuses(run([ex("(x+1)**2"), ex("x**2+1")])), ["start", "error"]);
});
test("calculus: chain rule right and wrong", { skip: !haveSympy }, () => {
  assert.deepEqual(statuses(run([ex("diff(sin(x**2), x)"), ex("cos(x**2)*2*x")])), ["start", "ok"]);
  assert.deepEqual(statuses(run([ex("diff(sin(x**2), x)"), ex("cos(x**2)")])), ["start", "error"]);
});
test("dropping a root is an error; squaring only adds roots", { skip: !haveSympy }, () => {
  assert.deepEqual(statuses(run([eq("x**2=4"), eq("x=2")])), ["start", "error"]);
  assert.deepEqual(statuses(run([eq("x=2"), eq("x**2=4")])), ["start", "ok-extra"]);
});
test("text lines are skipped and junk is reported as unparsed", { skip: !haveSympy }, () => {
  const res = run([{ latex: "Solve", sympy: "", kind: "text" }, eq("x+1=2"), { latex: "??", sympy: "((", kind: "expr" }, eq("x=1")]);
  assert.deepEqual(statuses(res), ["skip", "start", "unparsed", "ok"]);
});
test("trig identity", { skip: !haveSympy }, () => {
  assert.deepEqual(statuses(run([ex("sin(x)**2+cos(x)**2"), ex("1")])), ["start", "ok"]);
});
