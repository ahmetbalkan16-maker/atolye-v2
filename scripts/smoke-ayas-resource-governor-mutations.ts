/** Stage15Q negative controls. Recursive source closure in TEMP; production files never mutated. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
const repo = process.cwd(), temp = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-resource-audit-")), link = path.join(temp, "node_modules");
const test = "scripts/smoke-ayas-resource-governor.ts", core = "src/lib/ayas/machine/AyasResourceGovernor.ts", capacity = "src/lib/ayas/machine/AyasResourceCapacity.ts", health = "src/lib/ayas/machine/AyasMachineHealthGuard.ts";
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
  ["90 percent admission removed", health, "if (!workload.ownedActive && telemetry.ramUsedPercent >= maxRamAdmissionPercent)", "if (false)"],
  ["active task killed at admission threshold", health, "!workload.ownedActive && telemetry.ramUsedPercent >= maxRamAdmissionPercent", "telemetry.ramUsedPercent >= maxRamAdmissionPercent"],
  ["bad old sensor permits work", health, "(!Number.isFinite(value) || value < 0 || value > 100)", "false"],
  ["invalid owner policy permits admission", core, " || !Number.isSafeInteger(maxRamAdmissionPercent)", ""],
  ["explicit host protection ignored", core, "context.hostProtection !== \"NORMAL\" && context.hostProtection !== \"UNKNOWN\"", "false"],
  ["critical thermal state ignored", core, " || context.thermalState === \"CRITICAL\"", ""],
  ["critical health is only defer", core, "return decide(\"RESOURCE_ABORT\", \"RESOURCE_HOST_PROTECTION\");\n  throttle", "return decide(\"DEFER\", \"RESOURCE_HOST_PROTECTION\");\n  throttle"],
  ["bad sensor allowed", core, "value !== undefined && !number(value, 100)", "false"],
  ["stale snapshot allowed", core, " || age > 30_000", ""],
  ["future snapshot allowed", core, " || age < 0", ""],
  ["interactive owner paused behind background", core, "if (request.class === \"INTERACTIVE\" && !request.prewarm)", "if (false)"],
  ["unmeasured occupancy considered empty", core, "if (context.heavyWorkloads === null) return decide(\"DEFER\", \"RESOURCE_HEAVY_INVENTORY_UNKNOWN\");", "if (context.heavyWorkloads === null) return decide(\"ALLOW\", \"RESOURCE_HEAVY_INVENTORY_UNKNOWN\");"],
  ["uncertain dependencies ignored", core, "context.heavyWorkloads.some(w => w.state === \"UNCERTAIN\")", "false"],
  ["one-heavy restriction removed", core, "context.heavyWorkloads.some(w => w.taskId !== request.taskId)", "false"],
  ["duplicate task allowed to start", core, "!request.ownedActive && context.heavyWorkloads.some(w => w.taskId === request.taskId)", "false"],
  ["unproven active identity passes", core, "request.ownedActive && !context.heavyWorkloads.some(w => w.taskId === request.taskId && w.class === request.class)", "false"],
  ["external render not counted", core, "telemetry.ffmpegRunning !== false", "false"],
  ["model presence fabricated as zero loaded memory", core, "(context.modelFootprintMb ?? 0) > 0 || (telemetry.localModelRunning !== false && context.modelFootprintMb === null)", "false"],
  ["owner priority ignored", core, "context.ownerInteractive && request.priority === \"BACKGROUND\"", "false"],
  ["production priority ignored", core, "context.productionActive && request.priority !== \"PRODUCTION\"", "false"],
  ["hardware migration skips calibration", core, "context.hardwareFingerprint !== context.benchmarkedFingerprint", "false"],
  ["unmeasured owner priority passes", core, "context.ownerInteractive === null", "false"],
  ["missing CPU becomes safe headroom", core, "telemetry.cpuPercent === undefined || request.requiresGpu", "false || request.requiresGpu"],
  ["unknown projected footprint passes", core, "request.peakMemoryMb === null || ", ""],
  ["projected memory limit ignored", core, "request.peakMemoryMb * 1024 * 1024 >= telemetry.freeRamBytes - Math.ceil(telemetry.totalRamBytes * (100 - maxRamAdmissionPercent) / 100)", "false"],
  ["prewarm needs no measured benefit", core, "request.measuredPrewarmBenefitMs === null || request.measuredPrewarmBenefitMs <= 0", "false"],
  ["resource abort scored as model failure", core, "modelQualityFailure: false, pressureClass:", "modelQualityFailure: true as never, pressureClass:"],
  ["defer loses task", core, "preserveTask: true, modelQualityFailure:", "preserveTask: false as never, modelQualityFailure:"],
  ["heavy operation bypasses common lock", capacity, "return await withAyasExecutionAuthorityLock(deps.hostCapacityRoot, async () => { acquired = true; return run(); }, { acquireRetryLimit: 0 });", "return await run();"],
  ["post-lock pressure not re-read", capacity, "const decision = await read();", "const decision = initial;"],
  ["ambiguous capacity root accepted", capacity, "!path.isAbsolute(deps.hostCapacityRoot)", "false"],
  ["operation domain error disguised as unstarted capacity defer", capacity, "!acquired && error instanceof", "error instanceof"],
  ["resource kernel can rewrite itself via Windows case", "src/lib/brain/selfheal/BrainPatchSafety.ts", "p.toLowerCase().startsWith(\"src/lib/ayas/machine/\")", "p.startsWith(\"src/lib/ayas/machine/\")"],
  ["resource oracle can rewrite itself", "src/lib/brain/selfheal/BrainPatchSafety.ts", "  \"scripts/smoke-ayas-resource-governor.ts\",\n", ""],
];
const env: NodeJS.ProcessEnv = { NODE_ENV: "test" };
for (const key of ["SystemRoot", "WINDIR", "COMSPEC", "PATH", "PATHEXT", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "HOME"]) if (process.env[key]) env[key] = process.env[key];
const run = () => spawnSync(process.execPath, ["--import", "tsx", test], { cwd: temp, env, encoding: "utf8", windowsHide: true, timeout: 40_000, maxBuffer: 1_000_000 });
try {
  copy(test); copy("tsconfig.json"); fs.symlinkSync(fs.realpathSync(path.join(repo, "node_modules")), link, process.platform === "win32" ? "junction" : "dir");
  const baseline = run(); assert.equal(baseline.status, 0, `${baseline.stderr}${baseline.stdout}`.slice(0, 2000));
  for (const [name, file, before, after] of mutants) {
    const target = path.join(temp, file), original = fs.readFileSync(target, "utf8"); assert.equal(original.split(before).length - 1, 1, `${name}: exact mutation`);
    fs.writeFileSync(target, original.replace(before, () => after)); const result = run(); fs.writeFileSync(target, original);
    assert.equal(result.signal, null, `${name}: timeout`); assert.notEqual(result.status, 0, `${name}: survived`);
    assert.doesNotMatch(result.stderr, /SyntaxError|TransformError|ERR_MODULE_NOT_FOUND|Cannot find module|is not defined|is not a function/, `${name}: ${result.stderr.slice(0, 500)}`);
    assert.match(result.stderr, /AssertionError|ERR_ASSERTION/, `${name}: ${result.stderr.slice(0, 500)}`);
    if (process.env.SMOKE_TRACE === "1") console.log(`CAUGHT ${name}`);
  }
  console.log(`Stage15Q resource admission mutation audit: PASS (${mutants.length}/${mutants.length} caught)`);
} finally {
  if (fs.existsSync(link)) { if (process.platform === "win32") fs.rmdirSync(link); else fs.unlinkSync(link); } assert.ok(!fs.existsSync(link));
  assert.equal(path.dirname(path.resolve(temp)), path.resolve(os.tmpdir())); assert.ok(path.basename(temp).startsWith("ayas-resource-audit-")); fs.rmSync(temp, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
