/**
 * Stage 15Q.3 — host-common occupancy and its consumer bindings.
 * TEMP roots, TEMP fixture repositories and child processes of this suite only. No live root,
 * model, container, render, provider, production stage or host setting is touched.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn, spawnSync, type ChildProcess } from "node:child_process";
import { evaluateAyasMachineHealth } from "../src/lib/ayas/machine/AyasMachineHealthGuard";
import type { AyasMachineTelemetry } from "../src/lib/ayas/machine/AyasMachineTelemetry";
import { withAyasResourceCapacity } from "../src/lib/ayas/machine/AyasResourceCapacity";
import { evaluateAyasResourceAdmission, type AyasResourceContext, type AyasResourceRequest } from "../src/lib/ayas/machine/AyasResourceGovernor";
import {
  AyasResourceOccupancyBlockedError, applyAyasSharedOccupancy, ayasHardwareFingerprint, ayasSharedOccupancyHold, collectAyasResourceContext,
  pruneAyasStaleOccupancy, publishAyasResourceOccupancy, readAyasCurrentResourceState, readAyasResourceOccupancy, resolveAyasHostCapacityRoot,
  withAyasProductionStageOccupancy, type AyasOccupancyRecord, type AyasResourceOccupancy,
} from "../src/lib/ayas/machine/AyasResourceOccupancy";
import { accumulateAyasMicroBatchCandidates } from "../src/lib/brain/autonomy/AyasMicroBatchAccumulator";
import { discoverAyasNovelPatchCandidates } from "../src/lib/brain/autonomy/AyasNovelPatchDiscovery";
import { classifyPatchTarget } from "../src/lib/brain/selfheal/BrainPatchSafety";

const repo = process.cwd();
const SCENARIOS = 12;
const NOW = Date.parse("2026-10-02T00:00:00.000Z");
const telemetry: AyasMachineTelemetry = { observedAt: new Date(NOW).toISOString(), cpuPercent: 20, ramUsedPercent: 30, gpuPercent: 20, vramUsedPercent: 30, diskFreePercent: 50, totalRamBytes: 32 * 1024 ** 3, freeRamBytes: 22.4 * 1024 ** 3, processRssMb: 100, localModelRunning: false, ffmpegRunning: false, unavailable: [] };
const context: AyasResourceContext = { ownerInteractive: false, productionActive: false, heavyWorkloads: [], queueDepth: 0, modelFootprintMb: null, thermalState: "UNKNOWN", hostProtection: "NORMAL", hardwareFingerprint: null, benchmarkedFingerprint: null };
const request: AyasResourceRequest = { taskId: "model-task", class: "HEAVY_LOCAL_AI", priority: "BACKGROUND", ownedActive: false, requiresGpu: false, peakMemoryMb: 100, prewarm: false, measuredPrewarmBenefitMs: null };
const current = (patch: Partial<AyasResourceContext> = {}) => async () => ({ telemetry, context: { ...context, ...patch }, nowMs: NOW, maxRamAdmissionPercent: 90 });

/** Child mode: hold one production render record and one local model record until this process is killed. */
async function hold(root: string): Promise<void> {
  await publishAyasResourceOccupancy(root, { taskId: "child-render", class: "MEDIA_RENDER", production: true });
  await publishAyasResourceOccupancy(root, { taskId: "child-model", class: "HEAVY_LOCAL_AI", production: false });
  console.log("READY");
  setInterval(() => undefined, 60_000);
}

const selectedCase = process.env.AYAS_OCCUPANCY_MUTATION_CASE;
if (selectedCase !== undefined) {
  // Private to the mutation audit: a gitless TEMP copy only. The declared baseline always runs every scenario.
  const cwd = fs.realpathSync(repo);
  assert.equal(path.dirname(cwd).toLowerCase(), fs.realpathSync(os.tmpdir()).toLowerCase()); assert.ok(path.basename(cwd).startsWith("ayas-occupancy-audit-")); assert.ok(!fs.existsSync(path.join(cwd, ".git")));
  assert.match(selectedCase, /^(?:[1-9]|1[0-2])$/);
}
const holdMode = process.argv[2] === "--hold";
const temp = holdMode ? "" : fs.mkdtempSync(path.join(os.tmpdir(), "ayas-resource-occupancy-"));
let scenarios = 0, scenarioIndex = 0, serial = 0;
async function scenario(name: string, run: () => Promise<void> | void) {
  scenarioIndex++; if (selectedCase !== undefined && Number(selectedCase) !== scenarioIndex) return;
  await run(); scenarios++; if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${scenarioIndex}: ${name}`);
}
const freshRoot = () => path.join(temp, `root-${++serial}`);
const names = (root: string) => fs.existsSync(path.join(root, "occupancy")) ? fs.readdirSync(path.join(root, "occupancy")).sort() : [];
const view = (occupancy: AyasResourceOccupancy | null) => occupancy?.records.map((r) => `${r.taskId.replace(/:[0-9a-f-]{36}$/, "")}|${r.class}|${r.production}|${r.state}`).sort();
const source = (file: string) => fs.readFileSync(path.join(repo, file), "utf8");
const code = (file: string) => source(file).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const record = (patch: Partial<AyasOccupancyRecord>): AyasOccupancyRecord => ({ occupancyId: "a".repeat(32), taskId: "task", class: "HEAVY_LOCAL_AI", production: false, pid: 1, processStartEpochMs: 1, startedAt: new Date(NOW).toISOString(), state: "RUNNING", ...patch });
const inventory = (...records: AyasOccupancyRecord[]): AyasResourceOccupancy => ({ productionActive: records.some((r) => r.production && r.state === "RUNNING"), records });
/** A record on disk owned by a process that no longer exists. */
function seedDeadRecord(root: string, id: string, patch: { taskId: string; class: string; production: boolean; startedAt: string }): string {
  const gone = spawnSync(process.execPath, ["-e", ""], { windowsHide: true }); assert.equal(gone.status, 0);
  const file = path.join(root, "occupancy", `${id}.json`); fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ schemaVersion: "1", occupancyId: id, ...patch, pid: gone.pid, processStartEpochMs: 1 })}\n`);
  return file;
}
async function holder(root: string): Promise<ChildProcess> {
  const child = spawn(process.execPath, ["--import", "tsx", process.argv[1]!, "--hold", root], { cwd: repo, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  let stderr = ""; child.stderr!.on("data", (chunk) => { stderr += String(chunk); });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(Error(`HOLDER_NOT_READY ${stderr.slice(0, 500)}`)), 30_000);
    child.stdout!.on("data", (chunk) => { if (String(chunk).includes("READY")) { clearTimeout(timer); resolve(); } });
    child.once("exit", () => { clearTimeout(timer); reject(Error(`HOLDER_EXITED ${stderr.slice(0, 500)}`)); });
  });
  return child;
}
const killed = (child: ChildProcess) => new Promise<void>((resolve) => { if (child.exitCode !== null || child.signalCode !== null) return resolve(); child.once("exit", () => resolve()); child.kill(); });
function git(cwd: string, ...args: string[]) { return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(); }
const tsx = (script: string, args: readonly string[], cwd: string, env: NodeJS.ProcessEnv = process.env) => spawnSync(process.execPath, [path.join(repo, "node_modules", "tsx", "dist", "cli.mjs"), path.join(repo, "scripts", script), ...args], { cwd, env, encoding: "utf8", windowsHide: true, timeout: 100_000 });

async function main() {
  await scenario("the occupancy source, its graders and the operator CLI are never-autonomous; the root is this checkout's ignored execution tree", () => {
    for (const file of ["src/lib/ayas/machine/AyasResourceOccupancy.ts", "scripts/smoke-ayas-resource-occupancy.ts", "scripts/smoke-ayas-resource-occupancy-mutations.ts", "scripts/ayas-resource-status.ts"])
      for (const spelling of [file, file.toUpperCase(), `./${file.replace(/\//g, "\\")}`]) assert.equal(classifyPatchTarget(spelling).level, "FORBIDDEN_AUTONOMOUS", spelling);
    assert.equal(resolveAyasHostCapacityRoot(), path.join(path.resolve(repo), "data", "brain", "execution", "resource-capacity"));
    assert.equal(resolveAyasHostCapacityRoot(temp), path.join(temp, "data", "brain", "execution", "resource-capacity"));
    assert.ok(path.isAbsolute(resolveAyasHostCapacityRoot("relative")));
    // Runtime state under this root never makes the repository look dirty to a cleanliness gate.
    assert.ok(source(".gitignore").split(/\r?\n/).includes("/data/brain/execution/"));
  });

  await scenario("a record is published atomically, read back as RUNNING and removed on release; bad roots and entries are refused", async () => {
    const root = freshRoot();
    assert.deepEqual(await readAyasResourceOccupancy(root), { productionActive: false, records: [] });
    assert.ok(!fs.existsSync(root), "a read creates nothing");
    const handle = await publishAyasResourceOccupancy(root, { taskId: "production:script:1", class: "LIGHT_BACKGROUND", production: true });
    assert.deepEqual(names(root), [`${handle.occupancyId}.json`]);
    const seen = await readAyasResourceOccupancy(root); assert.ok(seen); assert.equal(seen.productionActive, true);
    assert.deepEqual(seen.records.map((r) => [r.occupancyId, r.taskId, r.class, r.production, r.pid, r.state]), [[handle.occupancyId, "production:script:1", "LIGHT_BACKGROUND", true, process.pid, "RUNNING"]]);
    const other = await publishAyasResourceOccupancy(root, { taskId: "model-task", class: "HEAVY_LOCAL_AI", production: false });
    await handle.release(); await handle.release();
    assert.deepEqual(view(await readAyasResourceOccupancy(root)), ["model-task|HEAVY_LOCAL_AI|false|RUNNING"]);
    assert.equal((await readAyasResourceOccupancy(root))!.productionActive, false);
    await other.release(); assert.deepEqual(names(root), []);
    for (const bad of ["", "relative-root", "\\\\server\\share"]) {
      await assert.rejects(publishAyasResourceOccupancy(bad, { taskId: "t", class: "MAINTENANCE", production: false }), /AYAS_OCCUPANCY_ROOT_INVALID/);
      assert.equal(await readAyasResourceOccupancy(bad), null);
    }
    for (const entry of [{ taskId: "", class: "MAINTENANCE", production: false }, { taskId: "bad id", class: "MAINTENANCE", production: false }, { taskId: "t", class: "UNKNOWN_CLASS", production: false }, { taskId: "t", class: "MAINTENANCE", production: "yes" }, null])
      await assert.rejects(publishAyasResourceOccupancy(root, entry as never), /AYAS_OCCUPANCY_ENTRY_INVALID/);
    assert.deepEqual(names(root), []);
  });

  await scenario("an unreadable or malformed inventory is unknown, never empty", async () => {
    const valid = { schemaVersion: "1", occupancyId: "b".repeat(32), taskId: "t", class: "MAINTENANCE", production: false, pid: process.pid, processStartEpochMs: 1, startedAt: new Date(NOW).toISOString() };
    const own = `${"b".repeat(32)}.json`;
    const cases: [string, string][] = [[own, "{"], [own, "{}"], [own, "null"],
      [`${"c".repeat(32)}.json`, JSON.stringify(valid)], // the file name is not the record's identity
      ...["schemaVersion", "taskId", "class", "production", "pid", "processStartEpochMs", "startedAt"].map((key): [string, string] => [own, JSON.stringify({ ...valid, [key]: key === "pid" ? 0 : "bad value" })])];
    for (const [name, bytes] of cases) {
      const root = freshRoot(); fs.mkdirSync(path.join(root, "occupancy"), { recursive: true }); fs.writeFileSync(path.join(root, "occupancy", name), bytes);
      assert.equal(await readAyasResourceOccupancy(root), null, bytes);
    }
    const root = freshRoot(); fs.mkdirSync(path.join(root, "occupancy"), { recursive: true });
    // An in-flight publication (dot-prefixed temp file) and unrelated files are not records.
    fs.writeFileSync(path.join(root, "occupancy", `.${"d".repeat(32)}.tmp`), "{"); fs.writeFileSync(path.join(root, "occupancy", "notes.txt"), "x");
    assert.deepEqual(await readAyasResourceOccupancy(root), { productionActive: false, records: [] });
    const blocked = freshRoot(); fs.mkdirSync(blocked, { recursive: true }); fs.writeFileSync(path.join(blocked, "occupancy"), "not a directory");
    assert.equal(await readAyasResourceOccupancy(blocked), null);
    const unknown = await collectAyasResourceContext(blocked);
    assert.equal(unknown.productionActive, null); assert.equal(unknown.heavyWorkloads, null);
    assert.equal(evaluateAyasResourceAdmission(telemetry, { ...unknown, ownerInteractive: false, hostProtection: "NORMAL" }, request, 90, NOW).reasonCode, "RESOURCE_HEAVY_INVENTORY_UNKNOWN");
  });

  await scenario("what the shared inventory adds: production priority, model/render overlap, one heavy workload, unknown inventory", () => {
    const model = record({ taskId: "model" }), lost = record({ taskId: "lost", state: "UNCERTAIN", occupancyId: "b".repeat(32) });
    const render = record({ taskId: "render", class: "MEDIA_RENDER", production: true, occupancyId: "c".repeat(32) }), light = record({ taskId: "light", class: "LIGHT_BACKGROUND", production: true, occupancyId: "d".repeat(32) });
    const maintenance = record({ taskId: "build", class: "MAINTENANCE", occupancyId: "e".repeat(32) }), staleRender = { ...render, state: "STALE" as const }, staleBuild = { ...maintenance, state: "STALE" as const };
    // Production: a light stage is never held; a render stage only by a loaded or unconfirmed local model.
    for (const occupancy of [null, inventory(), inventory(model), inventory(lost), inventory(render, maintenance)]) assert.equal(ayasSharedOccupancyHold(occupancy, "PRODUCTION_LIGHT"), undefined);
    for (const occupancy of [null, inventory(), inventory(render, light), inventory(maintenance), inventory(staleRender, staleBuild)]) assert.equal(ayasSharedOccupancyHold(occupancy, "PRODUCTION_RENDER"), undefined);
    assert.deepEqual(ayasSharedOccupancyHold(inventory(model), "PRODUCTION_RENDER"), { action: "BLOCK NEW HEAVY WORK", reasonCode: "RESOURCE_MODEL_RENDER_OVERLAP" });
    assert.deepEqual(ayasSharedOccupancyHold(inventory(lost), "PRODUCTION_RENDER"), { action: "BLOCK NEW HEAVY WORK", reasonCode: "RESOURCE_UNCERTAIN_MODEL_DEPENDENCY" });
    assert.deepEqual(ayasSharedOccupancyHold(inventory(model, lost), "PRODUCTION_RENDER"), { action: "BLOCK NEW HEAVY WORK", reasonCode: "RESOURCE_UNCERTAIN_MODEL_DEPENDENCY" });
    // Heavy self-development: waits for production, another heavy workload and an inventory it cannot read.
    assert.deepEqual(ayasSharedOccupancyHold(null, "SELF_EVOLUTION"), { action: "PAUSE", reasonCode: "RESOURCE_OCCUPANCY_UNKNOWN" });
    for (const occupancy of [inventory(light), inventory(render), inventory(render, model)]) assert.deepEqual(ayasSharedOccupancyHold(occupancy, "SELF_EVOLUTION"), { action: "PAUSE", reasonCode: "RESOURCE_PRODUCTION_PRIORITY" });
    for (const occupancy of [inventory(model), inventory(maintenance)]) assert.deepEqual(ayasSharedOccupancyHold(occupancy, "SELF_EVOLUTION"), { action: "PAUSE", reasonCode: "RESOURCE_ONE_HEAVY_AT_A_TIME" });
    for (const occupancy of [inventory(lost), inventory(lost, maintenance)]) assert.deepEqual(ayasSharedOccupancyHold(occupancy, "SELF_EVOLUTION"), { action: "PAUSE", reasonCode: "RESOURCE_UNCERTAIN_DEPENDENCY" });
    for (const occupancy of [inventory(), inventory(staleRender), inventory(staleBuild)]) assert.equal(ayasSharedOccupancyHold(occupancy, "SELF_EVOLUTION"), undefined);
    // Applied to a Machine Health decision it can only tighten an admitted one.
    const allow = evaluateAyasMachineHealth(telemetry, { stage: "video", ownedActive: false }), throttle = evaluateAyasMachineHealth({ ...telemetry, cpuPercent: 92 }, { stage: "video", ownedActive: false });
    const blocked = evaluateAyasMachineHealth({ ...telemetry, ramUsedPercent: 91 }, { stage: "video", ownedActive: false });
    assert.deepEqual([allow.action, throttle.action, blocked.action], ["ALLOW", "THROTTLE", "BLOCK NEW HEAVY WORK"]);
    assert.equal(applyAyasSharedOccupancy(allow, inventory(), "SELF_EVOLUTION"), allow); assert.equal(applyAyasSharedOccupancy(throttle, inventory(maintenance), "PRODUCTION_RENDER"), throttle);
    for (const occupancy of [null, inventory(render), inventory(model)]) assert.equal(applyAyasSharedOccupancy(blocked, occupancy, "SELF_EVOLUTION"), blocked);
    const held = applyAyasSharedOccupancy(throttle, inventory(render), "SELF_EVOLUTION");
    assert.deepEqual([held.action, held.reasonCode, held.mayStart, held.telemetry], ["PAUSE", "RESOURCE_PRODUCTION_PRIORITY", false, throttle.telemetry]);
    const overlap = applyAyasSharedOccupancy(allow, inventory(model), "PRODUCTION_RENDER");
    assert.deepEqual([overlap.action, overlap.reasonCode, overlap.mayStart], ["BLOCK NEW HEAVY WORK", "RESOURCE_MODEL_RENDER_OVERLAP", false]);
  });

  await scenario("a production stage is published for its whole run and released on success, failure and refusal; publication is advisory", async () => {
    const root = freshRoot();
    assert.equal(await withAyasProductionStageOccupancy("script", async () => {
      const seen = await readAyasResourceOccupancy(root); assert.equal(seen!.productionActive, true); assert.deepEqual(view(seen), ["production:script|LIGHT_BACKGROUND|true|RUNNING"]);
      return "script done";
    }, root), "script done");
    assert.deepEqual(names(root), []);
    for (const stage of ["visuals", "animation", "video", "assembly"] as const) await withAyasProductionStageOccupancy(stage, async () => assert.deepEqual(view(await readAyasResourceOccupancy(root)), [`production:${stage}|MEDIA_RENDER|true|RUNNING`]), root);
    await assert.rejects(withAyasProductionStageOccupancy("video", async () => { assert.equal(names(root).length, 1); throw Error("EXPECTED_STAGE_FAILURE"); }, root), /EXPECTED_STAGE_FAILURE/);
    assert.deepEqual(names(root), []);
    // Two production stages never exclude each other.
    let open = 0, peak = 0, entered = 0, checked = 0;
    let releaseEntered!: () => void, releaseChecked!: () => void;
    const bothEntered = new Promise<void>((resolve) => { releaseEntered = resolve; });
    const bothChecked = new Promise<void>((resolve) => { releaseChecked = resolve; });
    const rendezvous = async (barrier: Promise<void>) => {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([barrier, new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => reject(new assert.AssertionError({ message: "parallel production stage rendezvous timed out" })), 5_000);
        })]);
      } finally { if (timeout !== undefined) clearTimeout(timeout); }
    };
    const stage = async () => {
      open++; peak = Math.max(peak, open); entered++; if (entered === 2) releaseEntered();
      try {
        await rendezvous(bothEntered);
        assert.equal(names(root).length, 2);
        checked++; if (checked === 2) releaseChecked();
        await rendezvous(bothChecked);
        return true;
      } finally { open--; }
    };
    assert.deepEqual(await Promise.all([withAyasProductionStageOccupancy("video", stage, root), withAyasProductionStageOccupancy("assembly", stage, root)]), [true, true]); assert.equal(peak, 2);
    // A stage is never refused because its record could not be written or the inventory could not be read.
    const blocked = freshRoot(); fs.mkdirSync(blocked, { recursive: true }); fs.writeFileSync(path.join(blocked, "occupancy"), "not a directory");
    const refusal = (error: unknown) => `REFUSED ${error instanceof Error ? error.message : String(error)}`;
    for (const stageKey of ["script", "video"] as const) assert.equal(await withAyasProductionStageOccupancy(stageKey, async () => "ran", blocked).catch(refusal), "ran");
    assert.equal(await withAyasProductionStageOccupancy("video", async () => "ran", "relative-root").catch(refusal), "ran");
  });

  await scenario("a heavy capacity holder is published and proven; a loaded model and a render never start together; production has priority", async () => {
    const root = freshRoot(), deps = { hostCapacityRoot: root, readCurrent: current() };
    const result = await withAyasResourceCapacity(request, deps, async () => {
      assert.deepEqual(view(await readAyasResourceOccupancy(root)), ["model-task|HEAVY_LOCAL_AI|false|RUNNING"]);
      // The real host context proves this task's ownership, so a safe active workload continues.
      const real = await collectAyasResourceContext(root); assert.deepEqual(real.heavyWorkloads, [{ taskId: "model-task", class: "HEAVY_LOCAL_AI", state: "RUNNING" }]);
      assert.equal(evaluateAyasResourceAdmission(telemetry, real, { ...request, ownedActive: true }, 90, NOW).mayContinue, true);
      assert.equal(evaluateAyasResourceAdmission(telemetry, real, { ...request, taskId: "second-model" }, 90, NOW).reasonCode, "RESOURCE_ONE_HEAVY_AT_A_TIME");
      // A render stage that starts now is refused before its handler; a light stage is not.
      await assert.rejects(withAyasProductionStageOccupancy("video", async () => assert.fail("a render must not start beside a loaded model"), root),
        (error: unknown) => error instanceof AyasResourceOccupancyBlockedError && error.code === "RESOURCE_MODEL_RENDER_OVERLAP" && error.hold.action === "BLOCK NEW HEAVY WORK" && error.stack === undefined);
      assert.deepEqual(view(await readAyasResourceOccupancy(root)), ["model-task|HEAVY_LOCAL_AI|false|RUNNING"], "the refused stage released its record");
      assert.equal(await withAyasProductionStageOccupancy("script", async () => "light", root), "light");
      return "done";
    });
    assert.deepEqual([result.executed, result.result], [true, "done"]); assert.deepEqual(names(root), []);
    // The other order: a stage is running, and the heavy caller's own snapshot is too old to show it.
    let ran = 0;
    await withAyasProductionStageOccupancy("video", async () => {
      const deferred = await withAyasResourceCapacity(request, deps, async () => { ran++; });
      assert.deepEqual([deferred.executed, deferred.decision.action, deferred.decision.reasonCode, deferred.decision.mayStart, deferred.decision.preserveTask], [false, "DEFER", "RESOURCE_OWNER_OR_PRODUCTION_PRIORITY", false, true]);
      assert.deepEqual(view(await readAyasResourceOccupancy(root)), ["production:video|MEDIA_RENDER|true|RUNNING"], "the deferred holder released its record");
      const production = await withAyasResourceCapacity({ ...request, taskId: "render-task", class: "MEDIA_RENDER", priority: "PRODUCTION" }, { hostCapacityRoot: root, readCurrent: current({ productionActive: true }) }, async () => "rendered");
      assert.deepEqual([production.executed, production.result], [true, "rendered"]);
    }, root);
    assert.equal(ran, 0); assert.deepEqual(names(root), []);
    assert.equal((await withAyasResourceCapacity(request, deps, async () => "later")).result, "later", "the deferred task runs on later safe capacity");
    // An operation failure releases the record as well as the lock.
    await assert.rejects(withAyasResourceCapacity(request, deps, async () => { throw Error("EXPECTED_OPERATION_FAILURE"); }), /EXPECTED_OPERATION_FAILURE/); assert.deepEqual(names(root), []);
    // A holder that cannot publish itself, or cannot read the inventory back, does not start.
    const unpublished = freshRoot(); fs.mkdirSync(unpublished, { recursive: true }); fs.writeFileSync(path.join(unpublished, "occupancy"), "not a directory");
    const refused = await withAyasResourceCapacity(request, { hostCapacityRoot: unpublished, readCurrent: current() }, async () => { ran++; });
    assert.deepEqual([refused.executed, refused.decision.action, refused.decision.reasonCode], [false, "DEFER", "RESOURCE_OCCUPANCY_UNPUBLISHED"]);
    const unreadable = freshRoot(); fs.mkdirSync(path.join(unreadable, "occupancy"), { recursive: true }); fs.writeFileSync(path.join(unreadable, "occupancy", `${"f".repeat(32)}.json`), "{");
    const unknown = await withAyasResourceCapacity(request, { hostCapacityRoot: unreadable, readCurrent: current() }, async () => { ran++; });
    assert.deepEqual([unknown.executed, unknown.decision.action, unknown.decision.reasonCode], [false, "DEFER", "RESOURCE_HEAVY_INVENTORY_UNKNOWN"]);
    assert.deepEqual(names(unreadable), [`${"f".repeat(32)}.json`]); assert.equal(ran, 0);
    // A light workload takes no capacity and publishes nothing.
    const light = freshRoot(); assert.equal((await withAyasResourceCapacity({ ...request, class: "LIGHT_BACKGROUND" }, { hostCapacityRoot: light, readCurrent: current() }, async () => names(light))).result?.length, 0);
  });

  await scenario("another process's records are RUNNING while it lives; after it dies its render is STALE and its model is UNCERTAIN", async () => {
    const root = freshRoot(), child = await holder(root);
    try {
      const live = await readAyasResourceOccupancy(root); assert.ok(live); assert.equal(live.productionActive, true);
      assert.deepEqual(view(live), ["child-model|HEAVY_LOCAL_AI|false|RUNNING", "child-render|MEDIA_RENDER|true|RUNNING"]);
      assert.ok(live.records.every((r) => r.pid === child.pid && r.pid !== process.pid));
      assert.equal(ayasSharedOccupancyHold(live, "SELF_EVOLUTION")?.reasonCode, "RESOURCE_PRODUCTION_PRIORITY");
      assert.equal(ayasSharedOccupancyHold(live, "PRODUCTION_RENDER")?.reasonCode, "RESOURCE_MODEL_RENDER_OVERLAP");
      assert.equal(await pruneAyasStaleOccupancy(root, live, Date.now() + 60 * 60_000), 0, "a live record is never pruned");
    } finally { await killed(child); }
    const dead = await readAyasResourceOccupancy(root); assert.ok(dead); assert.equal(dead.productionActive, false);
    assert.deepEqual(view(dead), ["child-model|HEAVY_LOCAL_AI|false|UNCERTAIN", "child-render|MEDIA_RENDER|true|STALE"]);
    assert.equal(ayasSharedOccupancyHold(dead, "PRODUCTION_RENDER")?.reasonCode, "RESOURCE_UNCERTAIN_MODEL_DEPENDENCY");
    assert.equal(ayasSharedOccupancyHold(dead, "SELF_EVOLUTION")?.reasonCode, "RESOURCE_UNCERTAIN_DEPENDENCY");
    const real = await collectAyasResourceContext(root);
    assert.deepEqual([real.productionActive, real.heavyWorkloads], [false, [{ taskId: "child-model", class: "HEAVY_LOCAL_AI", state: "UNCERTAIN" }]]);
    assert.equal(evaluateAyasResourceAdmission(telemetry, { ...real, ownerInteractive: false, hostProtection: "NORMAL" }, request, 90, NOW).reasonCode, "RESOURCE_UNCERTAIN_DEPENDENCY");
    // Only an old record whose process is gone is removed; the unconfirmed model record stays until its runtime is reread.
    assert.equal(await pruneAyasStaleOccupancy(root, dead), 0); assert.equal(names(root).length, 2);
    assert.equal(await pruneAyasStaleOccupancy("relative-root", dead, Date.now() + 11 * 60_000), 0);
    assert.equal(await pruneAyasStaleOccupancy(root, dead, Date.now() + 11 * 60_000), 1);
    assert.deepEqual(view(await readAyasResourceOccupancy(root)), ["child-model|HEAVY_LOCAL_AI|false|UNCERTAIN"]);
  });

  await scenario("the host context is honest: unmeasured signals stay unknown, so a new heavy local model start is never admitted on a guess", async () => {
    const root = freshRoot(), real = await collectAyasResourceContext(root);
    assert.deepEqual(real, { ownerInteractive: null, productionActive: false, heavyWorkloads: [], queueDepth: null, modelFootprintMb: null, thermalState: "UNKNOWN", hostProtection: "UNKNOWN", hardwareFingerprint: ayasHardwareFingerprint(), benchmarkedFingerprint: null });
    assert.match(real.hardwareFingerprint!, /^[a-f0-9]{64}$/); assert.equal(ayasHardwareFingerprint(), real.hardwareFingerprint);
    const start = evaluateAyasResourceAdmission(telemetry, real, request, 90, NOW); assert.deepEqual([start.action, start.mayStart, start.reasonCode], ["DEFER", false, "RESOURCE_PRIORITY_OR_HOST_STATE_UNKNOWN"]);
    assert.equal(evaluateAyasResourceAdmission(telemetry, real, { ...request, class: "INTERACTIVE", priority: "OWNER_INTERACTIVE", peakMemoryMb: 0 }, 90, NOW).action, "ALLOW");
    // A light production stage sets production priority without counting as a heavy workload; one task is listed once, worst state first.
    await withAyasProductionStageOccupancy("script", async () => { const during = await collectAyasResourceContext(root); assert.deepEqual([during.productionActive, during.heavyWorkloads], [true, []]); }, root);
    // The dead record's file name sorts before any published one, so the live record is read last.
    seedDeadRecord(root, "0".repeat(32), { taskId: "model-task", class: "HEAVY_LOCAL_AI", production: false, startedAt: new Date().toISOString() });
    const again = await publishAyasResourceOccupancy(root, { taskId: "model-task", class: "HEAVY_LOCAL_AI", production: false });
    assert.deepEqual((await collectAyasResourceContext(root)).heavyWorkloads, [{ taskId: "model-task", class: "HEAVY_LOCAL_AI", state: "UNCERTAIN" }]); await again.release();
    // The provider the capacity primitive reads on a real host: measured telemetry, the owner policy default and this root's inventory.
    const checkout = path.join(temp, "state-checkout"); fs.mkdirSync(checkout, { recursive: true });
    const handle = await publishAyasResourceOccupancy(resolveAyasHostCapacityRoot(checkout), { taskId: "production:video:1", class: "MEDIA_RENDER", production: true });
    const state = await readAyasCurrentResourceState(checkout); await handle.release();
    assert.equal(state.maxRamAdmissionPercent, 90); assert.ok(Math.abs(state.nowMs - Date.parse(state.telemetry.observedAt)) < 30_000); assert.ok(state.telemetry.totalRamBytes! > 0);
    assert.deepEqual([state.context.productionActive, state.context.heavyWorkloads], [true, [{ taskId: "production:video:1", class: "MEDIA_RENDER", state: "RUNNING" }]]);
    assert.notEqual(evaluateAyasResourceAdmission(state.telemetry, state.context, request, state.maxRamAdmissionPercent, state.nowMs).action, "ALLOW");
  });

  await scenario("the sandbox lanes are heavy build work: BLOCK NEW HEAVY WORK holds them like PAUSE and STOP", async () => {
    const fixture = path.join(temp, "lane-fixture"); fs.mkdirSync(path.join(fixture, "src", "lib", "widget"), { recursive: true }); fs.mkdirSync(path.join(fixture, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(fixture, "src", "lib", "widget", "WidgetError.ts"), "export class WidgetError extends Error {\n  constructor(readonly code: \"X\", message: string) {\n    super(message);\n    this.name = \"WidgetError\";\n  }\n}\n");
    const tripwire = (): never => { throw new assert.AssertionError({ message: "HEAVY_LANE_STARTED" }); };
    const observation = (machineAction: "ALLOW" | "THROTTLE" | "PAUSE" | "STOP OWN WORKLOAD" | "BLOCK NEW HEAVY WORK") => ({ now: new Date(NOW).toISOString(), branch: "wip/test", head: "0".repeat(40), repoClean: true, graphifyFresh: true, machineAction, gaps: [] });
    const micro = (machineAction: Parameters<typeof observation>[0]) => accumulateAyasMicroBatchCandidates({ repoRoot: fixture, observation: observation(machineAction), itemStore: { load: tripwire } as never, batchStore: { load: tripwire } as never, artifactStore: {} as never });
    const novel = (machineAction: Parameters<typeof observation>[0]) => discoverAyasNovelPatchCandidates({ repoRoot: fixture, observation: observation(machineAction), artifactStore: {} as never, sandboxUnvalidatableStore: { shouldSkip: tripwire } as never });
    for (const machineAction of ["BLOCK NEW HEAVY WORK", "PAUSE", "STOP OWN WORKLOAD"] as const) {
      const batch = await micro(machineAction); assert.deepEqual([batch.itemsAdded, batch.batch, batch.rejections], [[], null, []]);
      const patch = await novel(machineAction); assert.deepEqual([patch.candidates, patch.rejections], [[], []]);
    }
    // The same fixture does reach the lanes' work when it is admitted, so the holds above are the gate and not an empty fixture.
    for (const machineAction of ["ALLOW", "THROTTLE"] as const) { await assert.rejects(micro(machineAction), /HEAVY_LANE_STARTED/); await assert.rejects(novel(machineAction), /HEAVY_LANE_STARTED/); }
    assert.ok(!fs.existsSync(path.join(fixture, "data")), "a held lane writes nothing");
  });

  await scenario("the bindings: production publishes around its admitted stage, discovery asks the shared inventory before its lease, read paths stay unbound", () => {
    const runtime = code("src/lib/production/ProductionPipelineExecutionCanonicalRuntime.ts");
    assert.match(runtime, /return withAyasProductionStageOccupancy\(context\.stage,\s*\(\) => executePreparedDurableProductionPipelineStage\(context, handler, active\)\);/);
    assert.equal(runtime.split("executePreparedDurableProductionPipelineStage(").length - 1, 2, "one definition and the one published call");
    assert.equal(runtime.split("withAyasProductionStageOccupancy(").length - 1, 1);
    // The existing pressure guard is unchanged: before durable preparation and at the owned boundary.
    assert.match(runtime, /assertAyasHeavyWorkloadAllowed\(\{ stage: context\.stage, ownedActive: false \}\)/); assert.match(runtime, /assertAyasHeavyWorkloadAllowed\(\{ stage: context\.stage, ownedActive: true \}\)/);
    for (const file of ["src/lib/production/ProductionHealthService.ts", "src/lib/production/ProductionReadinessService.ts"]) assert.doesNotMatch(source(file), /AyasResourceOccupancy|AyasResourceGovernor|AyasResourceCapacity/);
    const discovery = code("scripts/ayas-discovery-daemon.ts");
    assert.match(discovery, /const health = applyAyasSharedOccupancy\(\s*evaluateAyasMachineHealth\(telemetry, \{ stage: "video", ownedActive: false \}, policy\.state === "ACTIVE" \? policy\.policy\.rules\.maxRamAdmissionPercent : policy\.state === "MISSING" \? 90 : NaN\),\s*await readAyasResourceOccupancy\(resolveAyasHostCapacityRoot\(root\)\), "SELF_EVOLUTION"\);/);
    assert.match(discovery, /const policy = readAyasOwnerConstitution\(root\);/); assert.match(discovery, /machineAction: health\.action,/); assert.match(discovery, /machineReason: health\.reasonCode,/);
    assert.ok(discovery.indexOf("applyAyasSharedOccupancy(") > 0 && discovery.indexOf("applyAyasSharedOccupancy(") < discovery.indexOf("admitAyasDiscoveryRun("));
    // Discovery only reads the inventory: it publishes, prunes and takes no capacity.
    assert.doesNotMatch(discovery, /publishAyasResourceOccupancy|pruneAyasStaleOccupancy|withAyasResourceCapacity|withAyasProductionStageOccupancy/);
    for (const file of ["src/lib/brain/autonomy/AyasNovelPatchDiscovery.ts", "src/lib/brain/autonomy/AyasMicroBatchAccumulator.ts"])
      assert.match(code(file), /\(observation\.machineAction !== "ALLOW" && observation\.machineAction !== "THROTTLE"\)\) \{\s*return \{/, file);
    // The occupancy source starts nothing: no process, shell, container or WSL surface, and only its own records are removed.
    const occupancy = code("src/lib/ayas/machine/AyasResourceOccupancy.ts");
    assert.doesNotMatch(occupancy, /child_process|execFile|spawn\(|wsl|podman|ollama|llama/i);
    assert.equal(occupancy.split("fs.rm(").length - 1, 3); assert.doesNotMatch(occupancy, /recursive: true, force|rmdir|unlink/);
    const capacity = code("src/lib/ayas/machine/AyasResourceCapacity.ts");
    assert.ok(capacity.indexOf("publishAyasResourceOccupancy(") > 0 && capacity.indexOf("publishAyasResourceOccupancy(") < capacity.indexOf("await readAyasResourceOccupancy("));
    // The on-demand controller stays unwired: no production code or script imports it.
    const status = code("scripts/ayas-resource-status.ts"); assert.match(status, /AYAS_ON_DEMAND_DEPLOYMENT/); assert.doesNotMatch(status, /runAyasOnDemandTaskWith|stopAyasOnDemandIdleWith|withAyasResourceCapacity|publishAyasResourceOccupancy/);
  });

  await scenario("the discovery child pauses while a production stage is published and resumes when it is released", async () => {
    const checkout = fs.mkdtempSync(path.join(temp, "checkout-"));
    git(checkout, "init", "-q"); git(checkout, "config", "user.email", "smoke@example.invalid"); git(checkout, "config", "user.name", "Smoke"); git(checkout, "config", "core.autocrlf", "false");
    fs.writeFileSync(path.join(checkout, "fixture.txt"), "fixture\n"); fs.writeFileSync(path.join(checkout, ".gitignore"), "/data/\n.graphify/\n");
    git(checkout, "add", "fixture.txt", ".gitignore"); git(checkout, "commit", "-qm", "base"); const head = git(checkout, "rev-parse", "HEAD");
    fs.mkdirSync(path.join(checkout, ".graphify"), { recursive: true }); fs.writeFileSync(path.join(checkout, ".graphify", "graph.json"), "{}\n");
    fs.writeFileSync(path.join(checkout, ".graphify", "branch.json"), `${JSON.stringify({ lastSeenHead: head, lastAnalyzedHead: head, stale: false })}\n`);
    // The research scheduler is disabled: enabled against an empty fixture it would start a real network and model run.
    const env = { ...process.env, AYAS_RESEARCH_SCHEDULER_ENABLED: "0", AYAS_RESEARCH_IMPROVEMENT_ENABLED: "0", AYAS_CONTROLLED_EVOLUTION_REGISTER_FILE: "" };
    const run = () => { const child = tsx("ayas-discovery-daemon.ts", [], checkout, env); assert.equal(child.status, 0, child.stderr + child.stdout); return JSON.parse(child.stdout.trim().split("\n").pop()!) as { status: string; head: string; machineAction: string; machineReason: string; discovered: string[]; microItemsAdded: string[] }; };
    const stage = await publishAyasResourceOccupancy(resolveAyasHostCapacityRoot(checkout), { taskId: "production:script:1", class: "LIGHT_BACKGROUND", production: true });
    const paused = run(); await stage.release();
    assert.deepEqual([paused.status, paused.head, paused.machineAction, paused.machineReason, paused.discovered, paused.microItemsAdded], ["OK", head, "PAUSE", "RESOURCE_PRODUCTION_PRIORITY", [], []]);
    assert.equal(git(checkout, "status", "--porcelain"), "");
    const resumed = run();
    assert.deepEqual([resumed.status, resumed.head], ["OK", head]); assert.match(resumed.machineReason, /^MACHINE_HEALTH_/, "without a published stage only this host's own pressure decides");
    // The child read the inventory and left it alone.
    assert.deepEqual(names(resolveAyasHostCapacityRoot(checkout)), []);
  });

  await scenario("the operator CLI is read-only, reports unmeasured signals as unmeasured and prunes only on request", async () => {
    const cwd = fs.mkdtempSync(path.join(temp, "status-")), root = resolveAyasHostCapacityRoot(cwd);
    const report = (args: readonly string[] = []) => { const child = tsx("ayas-resource-status.ts", args, cwd); assert.equal(child.status, 0, child.stderr + child.stdout); return JSON.parse(child.stdout) as { authority: string; policy: { maxRamAdmissionPercent: number }; telemetry: Record<string, unknown>; occupancy: { state: string; productionActive: boolean; records: { class: string; state: string }[]; prunedStale: number }; context: AyasResourceContext; decisions: Record<string, { action: string; reasonCode: string }>; onDemand: { status: string; startupPreload: boolean; automaticGlobalWslShutdown: boolean }; unmeasured: string[] }; };
    const empty = report();
    assert.deepEqual([empty.authority, empty.policy.maxRamAdmissionPercent, empty.occupancy], ["NONE", 90, { state: "READ", productionActive: false, records: [], prunedStale: 0 }]);
    assert.deepEqual([empty.context.ownerInteractive, empty.context.thermalState, empty.context.hostProtection, empty.context.heavyWorkloads], [null, "UNKNOWN", "UNKNOWN", []]);
    assert.deepEqual(empty.unmeasured, ["ownerInteractive", "queueDepth", "modelFootprintMb", "thermalState", "hostProtection", "benchmarkedFingerprint"]);
    assert.equal(empty.decisions.interactive!.action, "ALLOW"); assert.notEqual(empty.decisions.heavyLocalModelStart!.action, "ALLOW");
    assert.deepEqual([empty.onDemand.status, empty.onDemand.startupPreload, empty.onDemand.automaticGlobalWslShutdown], ["NOT_WIRED_ENGINE_UNREGISTERED", false, false]);
    // Coarse signals only: percentages, byte totals and two process-presence booleans.
    for (const key of Object.keys(empty.telemetry)) assert.ok(["observedAt", "cpuPercent", "gpuPercent", "ramUsedPercent", "totalRamBytes", "freeRamBytes", "vramUsedPercent", "diskFreePercent", "processRssMb", "ffmpegRunning", "localModelRunning", "unavailable"].includes(key), key);
    assert.ok(!fs.existsSync(path.join(cwd, "data")), "a status read creates nothing");
    const old = new Date(Date.now() - 11 * 60_000).toISOString();
    const staleFile = seedDeadRecord(root, "1".repeat(32), { taskId: "production:video:old", class: "MEDIA_RENDER", production: true, startedAt: old });
    const youngFile = seedDeadRecord(root, "2".repeat(32), { taskId: "production:video:new", class: "MEDIA_RENDER", production: true, startedAt: new Date().toISOString() });
    const modelFile = seedDeadRecord(root, "3".repeat(32), { taskId: "lost-model", class: "HEAVY_LOCAL_AI", production: false, startedAt: old });
    const seen = report(["--peak-mb", "100"]);
    assert.deepEqual(seen.occupancy.records.map((r) => `${r.class}|${r.state}`).sort(), ["HEAVY_LOCAL_AI|UNCERTAIN", "MEDIA_RENDER|STALE", "MEDIA_RENDER|STALE"]); assert.equal(seen.occupancy.prunedStale, 0);
    assert.deepEqual([seen.decisions.productionRenderStage, seen.decisions.heavyLocalModelStart!.action], [{ action: "BLOCK NEW HEAVY WORK", reasonCode: "RESOURCE_UNCERTAIN_MODEL_DEPENDENCY" }, "DEFER"]);
    assert.deepEqual([staleFile, youngFile, modelFile].map((file) => fs.existsSync(file)), [true, true, true], "a plain status read removes nothing");
    const pruned = report(["--prune-stale"]); assert.equal(pruned.occupancy.prunedStale, 1);
    assert.deepEqual([staleFile, youngFile, modelFile].map((file) => fs.existsSync(file)), [false, true, true]);
    for (const args of [["--unknown"], ["--peak-mb"], ["--peak-mb", "-1"], ["--peak-mb", "0"]]) { const bad = tsx("ayas-resource-status.ts", args, cwd); assert.equal(bad.status, 1); assert.match(bad.stderr, /ARGUMENT_INVALID/); assert.equal(bad.stdout, ""); }
  });

  assert.equal(scenarioIndex, SCENARIOS); assert.equal(scenarios, selectedCase === undefined ? SCENARIOS : 1);
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-resource-occupancy", scenarios, selectedMutationCase: selectedCase ?? null, physicalStarts: 0, evidenceClass: "TEMP_OCCUPANCY_AND_SOURCE_BINDING_NOT_HARDWARE_QUALIFICATION" }));
}

if (holdMode) hold(process.argv[3]!).catch((error) => { console.error(error); process.exit(1); });
else main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => {
  assert.equal(path.dirname(fs.realpathSync(temp)).toLowerCase(), fs.realpathSync(os.tmpdir()).toLowerCase()); assert.ok(path.basename(temp).startsWith("ayas-resource-occupancy-"));
  fs.rmSync(temp, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
});
