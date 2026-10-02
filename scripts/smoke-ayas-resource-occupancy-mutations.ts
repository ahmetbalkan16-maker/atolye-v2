/** Stage 15Q.3 negative controls. Source closure copied to a gitless TEMP root; repository files are never mutated. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
const repo = process.cwd(), temp = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-occupancy-audit-")), link = path.join(temp, "node_modules");
const test = "scripts/smoke-ayas-resource-occupancy.ts", occupancy = "src/lib/ayas/machine/AyasResourceOccupancy.ts", capacity = "src/lib/ayas/machine/AyasResourceCapacity.ts";
const health = "src/lib/ayas/machine/AyasMachineHealthGuard.ts", runtime = "src/lib/production/ProductionPipelineExecutionCanonicalRuntime.ts", discovery = "scripts/ayas-discovery-daemon.ts", status = "scripts/ayas-resource-status.ts";
const novel = "src/lib/brain/autonomy/AyasNovelPatchDiscovery.ts", micro = "src/lib/brain/autonomy/AyasMicroBatchAccumulator.ts", safety = "src/lib/brain/selfheal/BrainPatchSafety.ts";
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
/** Read as text by the binding scenario; its own imports are not needed. */
function copyText(file: string) { const to = path.join(temp, file); fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(path.join(repo, file), to); }
const oldLaneGate = '(observation.machineAction === "PAUSE" || observation.machineAction === "STOP OWN WORKLOAD")', laneGate = '(observation.machineAction !== "ALLOW" && observation.machineAction !== "THROTTLE")';
/** [name, file, exact source text, replacement, the scenario that must catch it] */
const mutants: readonly (readonly [string, string, string, string, number])[] = [
  ["occupancy grader can rewrite itself", safety, "  \"scripts/smoke-ayas-resource-occupancy.ts\",\n", "", 1],
  ["operator CLI can be rewritten autonomously", safety, "  \"scripts/ayas-resource-status.ts\",\n", "", 1],
  ["release removes nothing", occupancy, "await fs.rm(file, { force: true, maxRetries: 3, retryDelay: 50 });", "", 2],
  ["unknown workload class accepted", occupancy, "!AYAS_RESOURCE_CLASSES.includes(entry.class)", "false", 2],
  ["malformed record treated as absent", occupancy, "if (!record) return null;", "if (!record) continue;", 3],
  ["unreadable inventory treated as empty", occupancy, "catch (error) { if ((error as NodeJS.ErrnoException).code === \"ENOENT\") return Object.freeze({ productionActive: false, records: Object.freeze([]) }); return null; }", "catch { return Object.freeze({ productionActive: false, records: Object.freeze([]) }); }", 3],
  ["file name not bound to the record identity", occupancy, " || name !== `${v.occupancyId}.json`", "", 3],
  ["unknown inventory reported as no production", occupancy, "productionActive: occupancy ? occupancy.productionActive : null,", "productionActive: occupancy ? occupancy.productionActive : false,", 3],
  ["unknown inventory reported as no heavy workload", occupancy, "heavyWorkloads: occupancy ? Object.freeze([...heavy.values()]) : null,", "heavyWorkloads: Object.freeze([...heavy.values()]),", 3],
  ["render not held by a loaded model", occupancy, "return models.length ? { action: \"BLOCK NEW HEAVY WORK\", reasonCode: \"RESOURCE_MODEL_RENDER_OVERLAP\" } : undefined;", "return undefined;", 4],
  ["render ignores an unconfirmed model", occupancy, "if (models.some((record) => record.state === \"UNCERTAIN\")) return { action: \"BLOCK NEW HEAVY WORK\", reasonCode: \"RESOURCE_UNCERTAIN_MODEL_DEPENDENCY\" };", "", 4],
  ["production blocked by an unreadable inventory", occupancy, "if (workload === \"PRODUCTION_RENDER\") {", "if (workload === \"PRODUCTION_RENDER\") { if (!occupancy) return { action: \"BLOCK NEW HEAVY WORK\", reasonCode: \"RESOURCE_OCCUPANCY_UNKNOWN\" };", 4],
  ["light production stage held like background work", occupancy, "if (workload === \"PRODUCTION_LIGHT\") return undefined;", "", 4],
  ["self-development ignores an unknown inventory", occupancy, "if (!occupancy) return { action: \"PAUSE\", reasonCode: \"RESOURCE_OCCUPANCY_UNKNOWN\" };", "if (!occupancy) return undefined;", 4],
  ["self-development ignores production priority", occupancy, "if (occupancy.productionActive) return { action: \"PAUSE\", reasonCode: \"RESOURCE_PRODUCTION_PRIORITY\" };", "", 4],
  ["self-development ignores another heavy workload", occupancy, "return heavy.length ? { action: \"PAUSE\", reasonCode: \"RESOURCE_ONE_HEAVY_AT_A_TIME\" } : undefined;", "return undefined;", 4],
  ["self-development ignores an uncertain dependency", occupancy, "if (heavy.some((record) => record.state === \"UNCERTAIN\")) return { action: \"PAUSE\", reasonCode: \"RESOURCE_UNCERTAIN_DEPENDENCY\" };", "", 4],
  ["occupancy rewrites a refused health decision", occupancy, "if (!health.mayStart) return health;", "", 4],
  ["production stage not published", occupancy, "try { handle = await publishAyasResourceOccupancy(root,", "try { if (false) handle = await publishAyasResourceOccupancy(root,", 5],
  ["production stage record leaks", occupancy, "} finally { await handle?.release().catch(() => undefined); }", "} finally { /* leak */ }", 5],
  ["render stage published as light work", occupancy, "class: render ? \"MEDIA_RENDER\" : \"LIGHT_BACKGROUND\", production: true", "class: \"LIGHT_BACKGROUND\", production: true", 5],
  ["render stage set emptied", health, "export function ayasStageIsGpuLikely(stage: ProductionStepKey): boolean { return GPU_LIKELY.has(stage); }", "export function ayasStageIsGpuLikely(stage: ProductionStepKey): boolean { return stage === undefined; }", 5],
  ["production refused when it cannot publish", occupancy, "catch { /* unpublished: heavy local work still sees the render through telemetry and pressure */ }", "catch (error) { throw error; }", 5],
  ["render overlap not enforced at stage start", occupancy, "if (hold) throw new AyasResourceOccupancyBlockedError(hold);", "", 6],
  ["heavy holder published as light work", capacity, "class: request.class, production: request.priority === \"PRODUCTION\"", "class: \"LIGHT_BACKGROUND\", production: request.priority === \"PRODUCTION\"", 6],
  ["production priority not rechecked after publishing", capacity, "if (seen.productionActive && request.priority !== \"PRODUCTION\") return held(decision, \"RESOURCE_OWNER_OR_PRODUCTION_PRIORITY\");", "", 6],
  ["unknown inventory after publishing starts anyway", capacity, "if (!seen) return held(decision, \"RESOURCE_HEAVY_INVENTORY_UNKNOWN\");", "if (!seen) return { decision, executed: true, result: await operation() };", 6],
  ["unpublished holder starts anyway", capacity, "catch { return held(decision, \"RESOURCE_OCCUPANCY_UNPUBLISHED\"); }", "catch { return { decision, executed: true, result: await operation() }; }", 6],
  ["holder record leaks", capacity, "} finally { await occupancy.release().catch(() => undefined); }", "} finally { /* leak */ }", 6],
  ["dead process still counts as production", occupancy, "record.production && record.state === \"RUNNING\"", "record.production", 7],
  ["dead local model treated as gone", occupancy, "record.class === \"HEAVY_LOCAL_AI\" ? \"UNCERTAIN\" : \"STALE\"", "\"STALE\"", 7],
  ["process liveness not checked", occupancy, " || await isSameLiveProcess(record.pid, record.processStartEpochMs)", " || true", 7],
  ["unconfirmed model record pruned", occupancy, "record.state !== \"STALE\" || !OCCUPANCY_ID", "record.state === \"RUNNING\" || !OCCUPANCY_ID", 7],
  ["young stale record pruned", occupancy, " || nowMs - Date.parse(record.startedAt) <= AYAS_OCCUPANCY_STALE_AFTER_MS", "", 7],
  ["stale record listed as a heavy workload", occupancy, "if (record.state === \"STALE\" || !HEAVY.includes(record.class)) continue;", "if (!HEAVY.includes(record.class)) continue;", 7],
  ["light production stage listed as a heavy workload", occupancy, "if (record.state === \"STALE\" || !HEAVY.includes(record.class)) continue;", "if (record.state === \"STALE\") continue;", 8],
  ["owner idle invented", occupancy, "ownerInteractive: null, productionActive:", "ownerInteractive: false, productionActive:", 8],
  ["host protection state invented", occupancy, "thermalState: \"UNKNOWN\", hostProtection: \"UNKNOWN\",", "thermalState: \"UNKNOWN\", hostProtection: \"NORMAL\",", 8],
  ["a second record of one task hides its uncertainty", occupancy, "if (heavy.get(record.taskId)?.state !== \"UNCERTAIN\") heavy.set(", "heavy.set(", 8],
  ["novel patch sandbox starts under BLOCK NEW HEAVY WORK (the predicate before this packet)", novel, laneGate, oldLaneGate, 9],
  ["micro batch validation starts under BLOCK NEW HEAVY WORK (the predicate before this packet)", micro, laneGate, oldLaneGate, 9],
  // One line of the call only: this file's working-tree line endings differ between checkouts.
  ["production stage bypasses the occupancy", runtime, "return withAyasProductionStageOccupancy(context.stage,", "return ((_stage: unknown, run: () => Promise<boolean>) => run())(context.stage,", 10],
  ["discovery ignores the owner RAM policy", discovery, ", policy.state === \"ACTIVE\" ? policy.policy.rules.maxRamAdmissionPercent : policy.state === \"MISSING\" ? 90 : NaN),", "),", 10],
  ["discovery ignores the shared inventory", discovery, "await readAyasResourceOccupancy(resolveAyasHostCapacityRoot(root)), \"SELF_EVOLUTION\");", "{ productionActive: false, records: [] }, \"SELF_EVOLUTION\");", 11],
  ["status read prunes without being asked", status, "const pruned = prune && before ? await pruneAyasStaleOccupancy(capacityRoot, before) : 0;", "const pruned = before ? await pruneAyasStaleOccupancy(capacityRoot, before) : 0;", 12],
];
const env: NodeJS.ProcessEnv = { NODE_ENV: "test" };
for (const key of ["SystemRoot", "WINDIR", "COMSPEC", "PATH", "PATHEXT", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "HOME"]) if (process.env[key]) env[key] = process.env[key];
const run = (selected?: number) => spawnSync(process.execPath, ["--import", "tsx", test], { cwd: temp, env: selected === undefined ? env : { ...env, AYAS_OCCUPANCY_MUTATION_CASE: String(selected) }, encoding: "utf8", windowsHide: true, timeout: 100_000, maxBuffer: 1_000_000 });
try {
  for (const file of [test, discovery, status, "tsconfig.json", ".gitignore"]) copy(file);
  for (const file of [runtime, "src/lib/production/ProductionHealthService.ts", "src/lib/production/ProductionReadinessService.ts"]) copyText(file);
  fs.symlinkSync(fs.realpathSync(path.join(repo, "node_modules")), link, process.platform === "win32" ? "junction" : "dir");
  const baseline = run(); assert.equal(baseline.status, 0, `${baseline.stderr}${baseline.stdout}`.slice(0, 2000));
  for (const [name, file, before, after, selected] of mutants) {
    const target = path.join(temp, file), original = fs.readFileSync(target, "utf8"); assert.equal(original.split(before).length - 1, 1, `${name}: exact mutation`);
    fs.writeFileSync(target, original.replace(before, () => after)); const result = run(selected); fs.writeFileSync(target, original);
    assert.equal(result.signal, null, `${name}: timeout`); assert.notEqual(result.status, 0, `${name}: survived`);
    assert.doesNotMatch(result.stderr, /SyntaxError|TransformError|ERR_MODULE_NOT_FOUND|Cannot find module|is not defined|is not a function/, `${name}: ${result.stderr.slice(0, 500)}`);
    assert.match(result.stderr, /AssertionError|ERR_ASSERTION/, `${name}: ${result.stderr.slice(0, 500)}`);
    if (process.env.SMOKE_TRACE === "1") console.log(`CAUGHT ${name}`);
  }
  console.log(`Stage15Q resource occupancy mutation audit: PASS (${mutants.length}/${mutants.length} caught)`);
} finally {
  if (fs.existsSync(link)) { if (process.platform === "win32") fs.rmdirSync(link); else fs.unlinkSync(link); } assert.ok(!fs.existsSync(link));
  assert.equal(path.dirname(path.resolve(temp)), path.resolve(os.tmpdir())); assert.ok(path.basename(temp).startsWith("ayas-occupancy-audit-")); fs.rmSync(temp, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
