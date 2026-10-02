/** Closed source closure in TEMP. Inert controller fixtures only; no live/runtime mutation. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
const repo = process.cwd(), temp = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-demand-audit-")), link = path.join(temp, "node_modules");
const test = "scripts/smoke-ayas-on-demand-lifecycle.ts", core = "src/lib/ayas/machine/AyasOnDemandLifecycle.ts", image = "src/lib/ayas/machine/AyasRuntimeImageLifecycle.ts";
const copied = new Set<string>();
function copy(file: string) {
  if (copied.has(file)) return; copied.add(file); const to = path.join(temp, file); fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(path.join(repo, file), to);
  if (!/\.tsx?$/.test(file)) return;
  for (const match of fs.readFileSync(to, "utf8").matchAll(/(?:from\s*|import\s*\(?\s*)['"](\.[^'"]+|@\/[^'"]+)['"]/g)) {
    const spec = match[1]!, base = spec.startsWith("@/") ? path.join(repo, "src", spec.slice(2)) : path.resolve(path.dirname(path.join(repo, file)), spec);
    const found = [base, base + ".ts", base + ".tsx", base + ".json", path.join(base, "index.ts")].find(f => fs.existsSync(f) && fs.statSync(f).isFile());
    if (found) { const relative = path.relative(repo, found).replace(/\\/g, "/"); assert.ok(!relative.startsWith("..") && !path.isAbsolute(relative)); copy(relative); }
  }
}
const mutants: readonly (readonly [string, string, string, string])[] = [
  ["startup demand accepted", core, 'input.trigger !== "EXPLICIT_TASK_DEMAND"', "false"],
  ["model identity not parsed", core, "modelManifest: parseAyasLocalCodingModelManifest(value.modelManifest)", "modelManifest: ayasLocalCodingCandidatePins.model"],
  ["timeout ceiling ignored", core, " || value.timeoutMs > 1_800_000", ""],
  ["durable mapping ignored", core, 's.input.codingContractSha256 === digest(task)', "true"],
  ["resource class downgraded", core, 'class: "HEAVY_LOCAL_AI", priority:', 'class: "LIGHT_BACKGROUND", priority:'],
  ["current capability ignored at admission", core, 'if (await boundedRuntimeCall(profile.timeoutMs, () => ports.authorize("RUN_TASK", profile, taskId)) !== true) return result', "if (false) return result"],
  ["prior lifecycle phase ignored", core, 'if (!["MISSING", "STOPPED"].includes(priorPhase))', "if (false)"],
  ["task changed after authority ignored", core, 'if (!current || current.status !== "ACTIVE" || current.lastDigest !== initial.lastDigest)', "if (false)"],
  ["pressure before model load ignored", core, "if (!evaluateAyasResourceAdmission(v.telemetry, v.context, request, v.maxRamAdmissionPercent, v.nowMs).mayStart)", "if (false)"],
  ["unknown dependencies become idle", core, "return s.dependentTaskIds !== null && s.dependentTaskIds.every", "return s.dependentTaskIds === null || s.dependentTaskIds.every"],
  ["uncertain dependency is terminal", core, '["COMPLETED", "FAILED", "REJECTED", "CANCELLED"].includes(t.status)', '(["COMPLETED", "FAILED", "REJECTED", "CANCELLED"].includes(t.status) || t.status === "UNCERTAIN")'],
  ["unsettled work allowed to drain", core, 'if (!settled || !taskSafeForUnload(settled, outcome))', "if (false)"],
  ["read-back receipt ignored", core, " || !back || digest(back) !== digest(receipt)", ""],
  ["checkpoint receipt not required", core, " || !HEX.test(receipt.checkpointDigest)", ""],
  ["quality failure hidden", core, 'modelQualityFailure: outcome === "MODEL_FAILURE"', "modelQualityFailure: false"],
  ["host interrupt counted as model failure", core, 'if (interrupted) outcome = interrupted.action === "RESOURCE_ABORT" ? "RESOURCE_ABORT" : "TASK_DEFERRED";', 'if (interrupted) outcome = "MODEL_FAILURE";'],
  ["idle threshold shortened", core, "now - s.lastDemandAtMs < 600_000", "now - s.lastDemandAtMs < 1"],
  ["idle recheck skipped", core, "latestNow - latest.lastDemandAtMs < 600_000", "false"],
  ["unknown model memory permits idle stop", core, "s.modelMemoryReleased !== true || s.foreignContainers", "false || s.foreignContainers"],
  ["foreign containers permit idle stop", core, "s.foreignContainers !== false || s.taskContainerIds", "false || s.taskContainerIds"],
  ["known evidence dependency ignored", image, '(value.evidenceReferences?.length ?? 0) > 0', "false"],
  ["incomplete image inventory treated complete", image, "!value.dependencyInventoryComplete || ", ""],
  ["stale rebuildable images can be cleaned", image, 'cleanupEligible: kind === "RECLAIMABLE"', 'cleanupEligible: kind === "RECLAIMABLE" || kind === "STALE_REBUILDABLE"'],
  ["lifecycle oracle autonomously editable", "src/lib/brain/selfheal/BrainPatchSafety.ts", '  "scripts/smoke-ayas-on-demand-lifecycle.ts",\n', ""],
];
const env: NodeJS.ProcessEnv = { NODE_ENV: "test" };
for (const key of ["SystemRoot", "WINDIR", "COMSPEC", "PATH", "PATHEXT", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "HOME"]) if (process.env[key]) env[key] = process.env[key];
const selectedCases = [3, 3, 3, 3, 5, 3, 9, 4, 4, 7, 7, 7, 8, 8, 6, 6, 10, 10, 10, 10, 11, 11, 11, 1];
assert.equal(selectedCases.length, mutants.length);
const run = (selected?: number) => spawnSync(process.execPath, ["--import", "tsx", test], { cwd: temp, env: selected === undefined ? env : { ...env, AYAS_DEMAND_MUTATION_CASE: String(selected) }, encoding: "utf8", windowsHide: true, timeout: 40_000, maxBuffer: 1_000_000 });
try {
  copy(test); copy("tsconfig.json"); fs.symlinkSync(fs.realpathSync(path.join(repo, "node_modules")), link, process.platform === "win32" ? "junction" : "dir");
  const baseline = run(); assert.equal(baseline.status, 0, `${baseline.stderr}${baseline.stdout}`.slice(0, 2000));
  for (const [index, [name, file, before, after]] of mutants.entries()) {
    const target = path.join(temp, file), original = fs.readFileSync(target, "utf8"); assert.equal(original.split(before).length - 1, 1, `${name}: exact mutation`);
    fs.writeFileSync(target, original.replace(before, () => after)); const result = run(selectedCases[index]); fs.writeFileSync(target, original);
    assert.equal(result.signal, null, `${name}: timeout`); assert.notEqual(result.status, 0, `${name}: survived`);
    assert.doesNotMatch(result.stderr, /SyntaxError|TransformError|ERR_MODULE_NOT_FOUND|Cannot find module|is not defined|is not a function/, `${name}: ${result.stderr.slice(0, 500)}`);
    assert.match(result.stderr, /AssertionError|ERR_ASSERTION/, `${name}: ${result.stderr.slice(0, 500)}`);
    if (process.env.SMOKE_TRACE === "1") console.log(`CAUGHT ${name}`);
  }
  console.log(`Stage15Q ON_DEMAND lifecycle mutation audit: PASS (${mutants.length}/${mutants.length} caught)`);
} finally {
  if (fs.existsSync(link)) { if (process.platform === "win32") fs.rmdirSync(link); else fs.unlinkSync(link); } assert.ok(!fs.existsSync(link));
  assert.equal(path.dirname(path.resolve(temp)), path.resolve(os.tmpdir())); assert.ok(path.basename(temp).startsWith("ayas-demand-audit-")); fs.rmSync(temp, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
