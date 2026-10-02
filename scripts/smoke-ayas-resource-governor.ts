/** Synthetic host snapshots and TEMP-only locks/journals. No live runtime, model, OS startup or production changes. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { evaluateAyasResourceAdmission, AYAS_RESOURCE_CLASSES, type AyasResourceContext, type AyasResourceRequest } from "../src/lib/ayas/machine/AyasResourceGovernor";
import { withAyasResourceCapacity } from "../src/lib/ayas/machine/AyasResourceCapacity";
import { evaluateAyasMachineHealth } from "../src/lib/ayas/machine/AyasMachineHealthGuard";
import { collectAyasMachineTelemetry, type AyasMachineTelemetry } from "../src/lib/ayas/machine/AyasMachineTelemetry";
import { createAyasDurableTaskJournal } from "../src/lib/brain/autonomy/AyasDurableTaskJournal";
import { advanceAyasDurableTask, createAyasDurableTask } from "../src/lib/brain/autonomy/AyasDurableTaskRuntime";
import { classifyPatchTarget } from "../src/lib/brain/selfheal/BrainPatchSafety";
import { AyasExecutionAuthorityLockError } from "../src/lib/brain/autonomy/AyasExecutionAuthorityLock";

const NOW = Date.parse("2026-10-02T00:00:00.000Z"); let scenarios = 0;
const telemetry: AyasMachineTelemetry = { observedAt: new Date(NOW).toISOString(), cpuPercent: 20, ramUsedPercent: 30, gpuPercent: 20, vramUsedPercent: 30, diskFreePercent: 50, totalRamBytes: 32 * 1024 ** 3, freeRamBytes: 22.4 * 1024 ** 3, processRssMb: 100, localModelRunning: false, ffmpegRunning: false, unavailable: [] };
const context: AyasResourceContext = { ownerInteractive: false, productionActive: false, heavyWorkloads: [], queueDepth: 0, modelFootprintMb: null, thermalState: "UNKNOWN", hostProtection: "NORMAL", hardwareFingerprint: null, benchmarkedFingerprint: null };
const request: AyasResourceRequest = { taskId: "test-job", class: "HEAVY_LOCAL_AI", priority: "BACKGROUND", ownedActive: false, requiresGpu: false, peakMemoryMb: 100, prewarm: false, measuredPrewarmBenefitMs: null };
const decide = (t: Partial<AyasMachineTelemetry> = {}, c: Partial<AyasResourceContext> = {}, r: Partial<AyasResourceRequest> = {}, limit = 90, now = NOW) => evaluateAyasResourceAdmission({ ...telemetry, ...t }, { ...context, ...c }, { ...request, ...r }, limit, now);
const scenario = async (name: string, run: () => unknown) => { await run(); scenarios++; if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${scenarios}: ${name}`); };
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-resource-governor-"));
async function main() {
  await scenario("resource policy, common capacity and graders are never-autonomous in every Windows path spelling", () => {
    for (const file of ["src/lib/ayas/machine/AyasResourceGovernor.ts", "src/lib/ayas/machine/AyasResourceCapacity.ts", "src/lib/ayas/machine/AyasMachineHealthGuard.ts", "scripts/smoke-ayas-resource-governor.ts", "scripts/smoke-ayas-resource-governor-mutations.ts"])
      for (const spelling of [file, file.toUpperCase(), `./${file.replace(/\//g, "\\")}`]) assert.equal(classifyPatchTarget(spelling).level, "FORBIDDEN_AUTONOMOUS");
  });
  await scenario("five classes, metadata and action flags", () => {
    for (const kind of AYAS_RESOURCE_CLASSES) { const r = decide({}, {}, { class: kind }); assert.equal(r.action, "ALLOW"); assert.equal(r.authority, "NONE"); assert.equal(r.preserveTask, true); assert.equal(r.modelQualityFailure, false); assert.equal(r.mayStart, true); }
    assert.equal(decide().observed.modelFootprintMb, null); assert.equal(decide().observed.thermalState, "UNKNOWN");
  });
  await scenario("90 percent refuses a new heavy job; a safe active job is not killed at90/91", () => {
    for (const ramUsedPercent of [90, 91]) { assert.equal(decide({ ramUsedPercent }).action, "DEFER"); const d = decide({ ramUsedPercent }, { heavyWorkloads: [{ taskId: request.taskId, class: request.class, state: "RUNNING" }] }, { ownedActive: true }); assert.equal(d.action, "ALLOW"); assert.equal(d.mayContinue, true); assert.equal(d.mayStart, false); assert.equal(d.stopOwnWorkload, false); }
    assert.equal(decide({ ramUsedPercent: 85 }, {}, {}, 85).action, "DEFER"); assert.equal(decide({}, {}, {}, NaN).action, "REQUIRE_OWNER");
  });
  await scenario("critical pressure and host events are resource aborts, never model-quality failures", () => {
    for (const t of [{ ramUsedPercent: 97 }, { vramUsedPercent: 99 }, { diskFreePercent: 2 }]) { const d = decide(t, {}, { ownedActive: true }); assert.equal(d.action, "RESOURCE_ABORT"); assert.equal(d.stopOwnWorkload, true); assert.equal(d.modelQualityFailure, false); assert.equal(d.pressureClass, "HOST_PROTECTION"); }
    for (const hostProtection of ["OOM", "SWAP_THRASHING", "RESPONSIVENESS_LOSS"] as const) assert.equal(decide({}, { hostProtection }).action, "RESOURCE_ABORT");
    assert.equal(decide({}, { thermalState: "CRITICAL" }).action, "RESOURCE_ABORT");
  });
  await scenario("active CPU/high pressure pauses without discarding/killing the task", () => { const d = decide({ cpuPercent: 99 }, {}, { ownedActive: true }); assert.equal(d.action, "DEFER"); assert.equal(d.stopOwnWorkload, false); assert.equal(d.preserveTask, true); });
  await scenario("one heavy job and model/render overlap refuse even if declared capacity is ample", () => {
    for (const kind of ["HEAVY_LOCAL_AI", "MEDIA_RENDER", "MAINTENANCE"] as const) assert.equal(decide({}, { heavyWorkloads: [{ taskId: "other", class: kind, state: "RUNNING" }] }).reasonCode, "RESOURCE_ONE_HEAVY_AT_A_TIME");
    assert.equal(decide({}, { heavyWorkloads: [{ taskId: request.taskId, class: request.class, state: "RUNNING" }] }).reasonCode, "RESOURCE_TASK_ALREADY_ACTIVE");
    assert.equal(decide({}, {}, { ownedActive: true }).reasonCode, "RESOURCE_ACTIVE_OWNERSHIP_UNPROVEN");
  });
  await scenario("unmeasured and UNCERTAIN occupancy never become empty capacity", () => {
    assert.equal(decide({}, { heavyWorkloads: null }).action, "DEFER"); assert.equal(decide({}, { heavyWorkloads: [{ taskId: "lost", class: request.class, state: "UNCERTAIN" }] }).reasonCode, "RESOURCE_UNCERTAIN_DEPENDENCY");
  });
  await scenario("external runtime signals remain conservative; app presence is not fabricated loaded-model memory", () => {
    for (const ffmpegRunning of [true, undefined]) assert.equal(decide({ ffmpegRunning }).action, "DEFER");
    for (const localModelRunning of [true, undefined]) assert.equal(decide({ localModelRunning }).action, "DEFER");
    assert.equal(decide({ localModelRunning: true }, { modelFootprintMb: 0 }).action, "ALLOW");
    assert.equal(decide({}, { modelFootprintMb: 1000 }).action, "DEFER");
  });
  await scenario("owner interaction and explicit production priority", () => {
    assert.equal(decide({}, { ownerInteractive: true }).action, "DEFER"); assert.equal(decide({}, { ownerInteractive: true }, { class: "INTERACTIVE", priority: "OWNER_INTERACTIVE", peakMemoryMb: 0 }).action, "ALLOW");
    assert.equal(decide({ ramUsedPercent: 90 }, {}, { class: "INTERACTIVE", priority: "OWNER_INTERACTIVE", peakMemoryMb: 0 }).action, "ALLOW");
    assert.equal(decide({}, { productionActive: true }).action, "DEFER"); assert.equal(decide({}, { productionActive: true }, { class: "MEDIA_RENDER", priority: "PRODUCTION" }).action, "ALLOW");
    for (const c of [{ ownerInteractive: null }, { productionActive: null }, { hostProtection: "UNKNOWN" as const }]) assert.equal(decide({}, c).action, "DEFER");
  });
  await scenario("new peak footprint must fit current owner headroom", () => { assert.equal(decide({}, {}, { peakMemoryMb: 30_000 }).reasonCode, "RESOURCE_PROJECTED_RAM_LIMIT"); assert.equal(decide({}, {}, { peakMemoryMb: null }).reasonCode, "RESOURCE_PROJECTED_MEMORY_UNKNOWN"); for (const t of [{ totalRamBytes: undefined }, { freeRamBytes: undefined }, { totalRamBytes: 0 }]) assert.equal(decide(t).action, "DEFER"); });
  await scenario("stale/future/invalid snapshots and sensors cannot admit work", () => {
    for (const observedAt of [new Date(NOW - 30_001).toISOString(), new Date(NOW + 1).toISOString(), "bad"]) assert.equal(decide({ observedAt }).action, "DEFER");
    assert.equal(decide({ observedAt: new Date(NOW - 30_000).toISOString() }).action, "ALLOW");
    for (const value of [NaN, Infinity, -1, 101]) { assert.equal(decide({ ramUsedPercent: value }).action, "DEFER"); assert.equal(decide({ ramUsedPercent: value }, {}, { class: "INTERACTIVE", peakMemoryMb: 0 }).action, "DEFER"); assert.equal(evaluateAyasMachineHealth({ ...telemetry, diskFreePercent: value }, { stage: "video", ownedActive: false }).mayStart, false); }
  });
  await scenario("unknown required GPU/CPU remains conservative; CPU-only work does not invent GPU sensors", () => {
    assert.equal(decide({ cpuPercent: undefined }).action, "DEFER"); assert.equal(decide({ gpuPercent: undefined, vramUsedPercent: undefined }).action, "ALLOW");
    assert.equal(decide({ gpuPercent: undefined }, {}, { requiresGpu: true }).action, "DEFER"); assert.equal(decide({ vramUsedPercent: undefined }, {}, { requiresGpu: true }).action, "DEFER");
    assert.equal(decide({ ramUsedPercent: undefined }).action, "DEFER"); assert.equal(decide({ diskFreePercent: undefined }).action, "DEFER");
  });
  await scenario("changed hardware requires benchmark recalibration", () => { assert.equal(decide({}, { hardwareFingerprint: "a".repeat(64), benchmarkedFingerprint: "b".repeat(64) }).reasonCode, "RESOURCE_HARDWARE_RECALIBRATION_REQUIRED"); assert.equal(decide({}, { hardwareFingerprint: "a".repeat(64), benchmarkedFingerprint: "a".repeat(64) }).action, "ALLOW"); });
  await scenario("lazy is default; prewarm needs measured benefit and is cancelled by owner/production/pressure", () => {
    assert.equal(request.prewarm, false); assert.equal(decide({}, {}, { prewarm: true }).action, "DEFER");
    const warm = { prewarm: true, measuredPrewarmBenefitMs: 50 }; assert.equal(decide({}, { thermalState: "NORMAL" }, warm).action, "ALLOW");
    for (const c of [{ ownerInteractive: true }, { productionActive: true }]) { const d = decide({}, { ...c, thermalState: "NORMAL" }, warm); assert.equal(d.action, "DEFER"); assert.equal(d.cancelPrewarm, true); }
    assert.equal(decide({ cpuPercent: 90 }, { thermalState: "NORMAL" }, warm).cancelPrewarm, true);
    for (const measuredPrewarmBenefitMs of [null, 0]) assert.equal(decide({}, { thermalState: "NORMAL" }, { ...warm, measuredPrewarmBenefitMs }).action, "DEFER");
  });
  await scenario("malformed/sparse/duplicate observations refuse", () => {
    for (const c of [{ heavyWorkloads: new Array(1) }, { queueDepth: -1 }, { queueDepth: 0.5 }, { modelFootprintMb: NaN }, { hardwareFingerprint: "bad" }]) assert.equal(decide({}, c).action, "REQUIRE_OWNER");
    const w = { taskId: "duplicate", class: request.class, state: "RUNNING" as const }; assert.equal(decide({}, { heavyWorkloads: [w, w] }).action, "REQUIRE_OWNER");
    assert.equal(evaluateAyasResourceAdmission(telemetry, context, null as never, 90, NOW).action, "REQUIRE_OWNER");
  });
  await scenario("common capacity lock admits one concurrent heavy caller and rereads pressure under lock", async () => {
    let release!: () => void, entered!: () => void, calls = 0;
    const blocked = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
    const deps = { hostCapacityRoot: path.join(temp, "capacity"), readCurrent: async () => ({ telemetry, context, nowMs: NOW, maxRamAdmissionPercent: 90 }) };
    const first = withAyasResourceCapacity(request, deps, async () => { calls++; entered(); await blocked; return "done"; }); await started;
    const second = await withAyasResourceCapacity({ ...request, taskId: "other" }, deps, async () => { calls++; }); assert.equal(second.executed, false); assert.equal(second.decision.reasonCode, "RESOURCE_CAPACITY_BUSY"); release(); assert.equal((await first).result, "done"); assert.equal(calls, 1);
    let reads = 0; const reread = await withAyasResourceCapacity(request, { ...deps, readCurrent: async () => ({ telemetry: ++reads === 1 ? telemetry : { ...telemetry, ramUsedPercent: 90 }, context, nowMs: NOW, maxRamAdmissionPercent: 90 }) }, async () => { calls++; }); assert.equal(reread.executed, false); assert.equal(reads, 2); assert.equal(calls, 1);
    const retry = await withAyasResourceCapacity(request, deps, async () => "next"); assert.equal(retry.executed, true);
  });
  await scenario("capacity refuses ambiguous roots and releases its own lock after an operation failure", async () => {
    const deps = { hostCapacityRoot: path.join(temp, "capacity-failure"), readCurrent: async () => ({ telemetry, context, nowMs: NOW, maxRamAdmissionPercent: 90 }) };
    for (const root of ["", "relative-root", "\\\\server\\share"]) { const r = await withAyasResourceCapacity(request, { ...deps, hostCapacityRoot: root }, async () => { assert.fail("must not run"); }); assert.equal(r.executed, false); assert.equal(r.decision.action, "REQUIRE_OWNER"); }
    await assert.rejects(withAyasResourceCapacity(request, deps, async () => { throw Error("EXPECTED_OPERATION_FAILURE"); }), /EXPECTED_OPERATION_FAILURE/);
    await assert.rejects(withAyasResourceCapacity(request, deps, async () => { throw new AyasExecutionAuthorityLockError("AYAS_LOCK_BUSY", "DOMAIN_LOCK_BUSY"); }), /DOMAIN_LOCK_BUSY/);
    assert.equal((await withAyasResourceCapacity(request, deps, async () => "retry")).result, "retry");
  });
  await scenario("admission defer preserves durable task journal/attempts and executes on later safe capacity", async () => {
    const journal = createAyasDurableTaskJournal({ rootDir: path.join(temp, "journal"), now: () => new Date(NOW) });
    const task = createAyasDurableTask(journal, { domain: "SELF_DEVELOPMENT", taskKey: "resource-defer", title: "Resource task", steps: [{ kind: "ACTIVITY", stepId: "work", activity: "fake.heavy", effect: "READ_ONLY", exactTarget: "fixture:work", input: {}, timeoutMs: 1000, maxAttempts: 2, retryDelayMs: 0 }] });
    let safe = false, calls = 0; const deps = { journal, owner: { pid: process.pid, startEpochMs: 1, nonce: "resource-test" }, nowMs: () => NOW,
      activities: { "fake.heavy": { declared: { domains: ["SELF_DEVELOPMENT" as const], effect: "READ_ONLY" as const, targets: ["fixture:work"] }, run: async () => { calls++; return { outcome: "SUCCEEDED" as const, result: { ok: true } }; } } },
      admitStart: () => { const d = decide({ ramUsedPercent: safe ? 30 : 90 }); return d.mayStart ? undefined : d.reasonCode; } };
    const before = JSON.stringify(journal.read(task.taskId)); const refused = await advanceAyasDurableTask(task.taskId, deps); assert.equal(refused.note, "START_NOT_ADMITTED"); assert.equal(JSON.stringify(journal.read(task.taskId)), before); assert.equal(calls, 0); assert.equal(journal.load(task.taskId)!.stepStates[0]!.attempts, 0);
    safe = true; const ran = await advanceAyasDurableTask(task.taskId, deps); assert.equal(calls, 1); assert.equal(ran.state.status, "COMPLETED");
  });
  await scenario("collector reports measured host RAM bytes without fabricating unavailable optional sensors", async () => {
    const t = await collectAyasMachineTelemetry({ cwd: temp, platform: "win32", now: () => new Date(NOW).toISOString(), run: async () => { throw Error("UNAVAILABLE"); } }); assert.ok(t.totalRamBytes! > 0); assert.ok(t.freeRamBytes! >= 0); assert.equal(t.gpuPercent, undefined); assert.equal(t.vramUsedPercent, undefined); assert.equal(t.localModelRunning, undefined);
  });
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-resource-governor", scenarios, runtimeStarts: 0, evidenceClass: "SYNTHETIC_RESOURCE_AND_TEMP_BOUNDARY" }));
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { assert.equal(path.dirname(fs.realpathSync(temp)).toLowerCase(), fs.realpathSync(os.tmpdir()).toLowerCase()); assert.ok(path.basename(temp).startsWith("ayas-resource-governor-")); fs.rmSync(temp, { recursive: true, force: true }); });
