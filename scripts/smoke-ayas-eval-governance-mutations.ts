/** Stage 15F.4 negative controls: only isolated TEMP copies are mutated. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repo = process.cwd();
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-15f4-audit-"));
const moduleFile = "src/lib/ayas/observability/AyasEvalGovernance.ts";
const test = "scripts/smoke-ayas-eval-governance.ts";
const files = [moduleFile, test, "docs/ayas-execution/2026-09-27-master/03_STAGE15_BASE/hardening/15F/EVAL_MANIFEST.json"];
const mutants: readonly (readonly [string, string, string])[] = [
  ["weak-grader-argument", 'suite.args.some((arg) => arg !== "--gate")', "false"],
  ["ignored-pin-drift", 'crypto.createHash("sha256").update(read(pin.file)).digest("hex") !== pin.sha256', "false"],
  ["ignored-exit-failure", "input.exitCode !== 0", "false"],
  ["unexpected-quality-failure-hidden", "r.unexpectedFailures.length", "false"],
  ["frozen-heldout-threshold-weakened", "Number(match[1]) === Number(match[2])", "Number(match[1]) <= Number(match[2])"],
  ["repeated-failure-hidden", "Number(trials.every(pass))", "1"],
  ["known-limit-labelled-complete", 'outcome: ids.length ? "PASS_WITH_KNOWN_LIMITATIONS" : "PASS"', 'outcome: "PASS"'],
  ["unbounded-trials", "k > 3", "false"],
];
const run = () => spawnSync(process.execPath, ["--import", "tsx", path.join(temp, test)], { cwd: repo, encoding: "utf8", windowsHide: true, timeout: 30_000 });
try {
  for (const file of files) {
    const target = path.join(temp, file); fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(repo, file), target);
  }
  const target = path.join(temp, moduleFile); const original = fs.readFileSync(target, "utf8");
  const baseline = run(); assert.equal(baseline.status, 0, baseline.stderr);
  for (const [id, before, after] of mutants) {
    assert.equal(original.split(before).length - 1, 1, `${id}: exact anchor`);
    fs.writeFileSync(target, original.replace(before, after));
    const result = run(); fs.writeFileSync(target, original);
    assert.equal(result.signal, null, `${id}: timeout`); assert.notEqual(result.status, 0, `${id}: survived`);
    assert.match(result.stderr, /AssertionError/, `${id}: assertion must reject, not imports or syntax`);
  }
  console.log(`Stage 15F.4 mutation audit: PASS (${mutants.length}/${mutants.length} caught; TEMP only)`);
} finally {
  assert.equal(path.dirname(path.resolve(temp)), path.resolve(os.tmpdir())); assert.ok(path.basename(temp).startsWith("ayas-15f4-audit-"));
  fs.rmSync(temp, { recursive: true, force: true });
}
