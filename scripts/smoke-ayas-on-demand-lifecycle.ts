/** Controller contract/TEMP journals and injected inert effects only. No real model, Podman, WSL or startup action. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { runAyasOnDemandTaskWith, stopAyasOnDemandIdleWith, AYAS_ON_DEMAND_STATES, AYAS_ON_DEMAND_DEPLOYMENT, type AyasOnDemandPorts, type AyasOnDemandSnapshot, type AyasOnDemandProfile, type AyasOnDemandReceipt, type AyasWorkOutcome } from "../src/lib/ayas/machine/AyasOnDemandLifecycle";
import { classifyAyasRuntimeImage, AYAS_RUNTIME_IMAGE_CLASSES, type AyasRuntimeImageFacts } from "../src/lib/ayas/machine/AyasRuntimeImageLifecycle";
import { ayasLocalCodingCandidatePins } from "../src/lib/brain/autonomy/AyasLocalCodingPins";
import type { AyasLocalCodingTaskContract } from "../src/lib/brain/autonomy/AyasLocalCodingTaskContract";
import { createAyasDurableTaskJournal } from "../src/lib/brain/autonomy/AyasDurableTaskJournal";
import { createAyasDurableTask, advanceAyasDurableTask } from "../src/lib/brain/autonomy/AyasDurableTaskRuntime";
import { classifyPatchTarget } from "../src/lib/brain/selfheal/BrainPatchSafety";

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-on-demand-"));
const H = "a".repeat(64), containerId = "b".repeat(64), sha = (v: unknown) => crypto.createHash("sha256").update(JSON.stringify(v)).digest("hex");
let serial = 0, scenarios = 0, scenarioIndex = 0;
const selectedCase = process.env.AYAS_DEMAND_MUTATION_CASE;
if (selectedCase !== undefined) {
  const cwd = fs.realpathSync(process.cwd());
  assert.equal(path.dirname(cwd).toLowerCase(), fs.realpathSync(os.tmpdir()).toLowerCase()); assert.ok(path.basename(cwd).startsWith("ayas-demand-audit-")); assert.ok(!fs.existsSync(path.join(cwd, ".git")));
  assert.match(selectedCase, /^(?:[1-9]|10|11)$/);
}
type MutablePorts = { -readonly [P in keyof AyasOnDemandPorts]: AyasOnDemandPorts[P] };
const profile: AyasOnDemandProfile = { machineName: "ayas-owned-test-machine", runtimeId: "ayas-test-runtime", modelManifest: ayasLocalCodingCandidatePins.model,
  runtimeIdentity: { engine: "podman", version: "5.0.0", binarySha256: H, host: "windows", backend: "wsl2", wslVersion: "2.0.0.0" }, peakMemoryMb: 100, requiresGpu: false, timeoutMs: 1000 };
function fixture() {
  let now = Date.parse("2026-10-02T00:00:00Z"), ram = 30, calls = 0, expectedOutcome: AyasWorkOutcome = "TASK_FINISHED";
  const journal = createAyasDurableTaskJournal({ rootDir: path.join(temp, "journal", String(serial++)), now: () => new Date(now) });
  const coding: AyasLocalCodingTaskContract = { schemaVersion: "1", taskId: "ayas-coding-12345678-1234-1234-1234-123456789abc", baseHead: "1".repeat(40), objective: "Repair the bounded source fixture", exactFiles: ["src/example.ts"], maxChangedLines: 8 };
  const task = createAyasDurableTask(journal, { domain: "SELF_DEVELOPMENT", taskKey: "controller-work", title: "Controller fixture", steps: [{ kind: "ACTIVITY", stepId: "work", activity: "fake.coding", effect: "READ_ONLY", exactTarget: "fixture:work", input: { codingContractSha256: sha(coding) }, timeoutMs: 1000, maxAttempts: 1, retryDelayMs: 0 }] });
  let s: AyasOnDemandSnapshot = { machineName: profile.machineName, runtimeId: profile.runtimeId, observedAtMs: now, machineState: "STOPPED", serverState: "STOPPED", modelMemoryReleased: true,
    serverOwnerTaskId: null, modelDigest: null, taskContainerOwnerTaskId: null, dependentTaskIds: [task.taskId], taskContainerIds: [], foreignContainers: false, demandPending: false, lastDemandAtMs: now };
  const actions: string[] = [], receiptPath = path.join(temp, `receipt-${serial}.json`), phasePath = path.join(temp, `phase-${serial}.json`);
  const ports: MutablePorts = {
    journal, hostCapacityRoot: path.join(temp, `capacity-${serial}`), nowMs: () => now,
    readCurrent: async () => ({ telemetry: { observedAt: new Date(now).toISOString(), cpuPercent: 20, ramUsedPercent: ram, gpuPercent: 20, vramUsedPercent: 20, diskFreePercent: 60, totalRamBytes: 32 * 1024 ** 3, freeRamBytes: 24 * 1024 ** 3, processRssMb: 50, localModelRunning: s.serverState === "RUNNING", ffmpegRunning: false, unavailable: [] },
      context: { ownerInteractive: false, productionActive: false, heavyWorkloads: s.serverState === "RUNNING" ? [{ taskId: task.taskId, class: "HEAVY_LOCAL_AI", state: "RUNNING" }] : [], queueDepth: 0, modelFootprintMb: s.serverState === "RUNNING" ? 100 : 0, thermalState: "NORMAL", hostProtection: "NORMAL", hardwareFingerprint: null, benchmarkedFingerprint: null }, nowMs: now, maxRamAdmissionPercent: 90 }),
    readRuntime: async () => ({ ...s, observedAtMs: now }), authorize: async () => true,
    readPhase: async () => fs.existsSync(phasePath) ? JSON.parse(fs.readFileSync(phasePath, "utf8")) : "MISSING",
    recordPhase: async phase => { fs.writeFileSync(phasePath, JSON.stringify(phase)); actions.push(`phase:${phase}`); },
    perform: async (action, p, taskId, ids) => {
      assert.equal(p.machineName, profile.machineName); assert.equal(p.runtimeId, profile.runtimeId); assert.equal((p.modelManifest as { sha256: string }).sha256, ayasLocalCodingCandidatePins.model.sha256);
      actions.push(action);
      if (action === "START_MACHINE") s = { ...s, machineState: "RUNNING" };
      if (action === "LOAD_PINNED_MODEL") s = { ...s, serverState: "RUNNING", serverOwnerTaskId: taskId, modelDigest: ayasLocalCodingCandidatePins.model.sha256, modelMemoryReleased: false, taskContainerIds: [containerId], taskContainerOwnerTaskId: taskId, dependentTaskIds: [taskId!] };
      if (action === "STOP_LLAMA_SERVER") s = { ...s, serverState: "STOPPED" };
      if (action === "REMOVE_TASK_CONTAINERS") { assert.equal(s.serverState, "STOPPED"); assert.deepEqual(ids, [containerId]); s = { ...s, taskContainerIds: [], taskContainerOwnerTaskId: null }; }
      if (action === "RELEASE_MODEL_MEMORY") { assert.equal(s.taskContainerIds?.length, 0); s = { ...s, modelMemoryReleased: true, modelDigest: null, serverOwnerTaskId: null }; }
      if (action === "STOP_MACHINE") s = { ...s, machineState: "STOPPED" };
      return "CONFIRMED";
    },
    runTask: async ({ signal, boundary }) => {
      calls++; actions.push("run"); const d = await boundary();
      if (!d.mayContinue || signal.aborted) {
        if (d.action !== "RESOURCE_ABORT") { s = { ...s, dependentTaskIds: [] }; return "TASK_DEFERRED"; }
        journal.append(task.taskId, journal.load(task.taskId)!.lastSequence, { type: "TASK_CANCELLED", reason: "RESOURCE_ABORT" }); return "RESOURCE_ABORT";
      }
      await advanceAyasDurableTask(task.taskId, { journal, owner: { pid: process.pid, startEpochMs: 1, nonce: "inert-controller-fixture" }, nowMs: () => now,
        activities: { "fake.coding": { declared: { effect: "READ_ONLY", domains: ["SELF_DEVELOPMENT"], targets: ["fixture:work"] }, run: async () => ({ outcome: "SUCCEEDED", result: { workloadOutcome: expectedOutcome } }) } } });
      return expectedOutcome;
    },
    persistEvidenceAndCheckpoint: async fact => { actions.push("persist"); const r = { ...fact, evidenceDigest: sha({ fact, kind: "EVIDENCE" }), checkpointDigest: sha({ fact, kind: "CHECKPOINT" }) }; fs.writeFileSync(receiptPath, JSON.stringify(r)); return r; },
    readReceipt: async () => { actions.push("read-back"); return JSON.parse(fs.readFileSync(receiptPath, "utf8")) as AyasOnDemandReceipt; },
  };
  const input = { trigger: "EXPLICIT_TASK_DEMAND" as const, task: coding, durableTaskId: task.taskId, profile };
  return { ports, input, journal, task, actions, snapshot: () => s, setSnapshot: (patch: Partial<AyasOnDemandSnapshot>) => { s = { ...s, ...patch }; }, setRam: (r: number) => { ram = r; }, setNow: (t: number) => { now = t; }, now: () => now, calls: () => calls, outcome: (o: AyasWorkOutcome) => { expectedOutcome = o; } };
}
async function scenario(name: string, run: () => Promise<void> | void) { scenarioIndex++; if (selectedCase !== undefined && Number(selectedCase) !== scenarioIndex) return; await run(); scenarios++; if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${scenarioIndex}: ${name}`); }
async function main() {
  await scenario("lazy source deployment, seven states and protected Windows spellings", () => {
    assert.equal(AYAS_ON_DEMAND_STATES.length, 7); assert.equal(AYAS_ON_DEMAND_DEPLOYMENT.status, "NOT_WIRED_ENGINE_UNREGISTERED"); assert.equal(AYAS_ON_DEMAND_DEPLOYMENT.lazyDefault, true); assert.equal(AYAS_ON_DEMAND_DEPLOYMENT.startupPreload, false); assert.equal(AYAS_ON_DEMAND_DEPLOYMENT.automaticGlobalWslShutdown, false);
    for (const f of ["src/lib/ayas/machine/AyasOnDemandLifecycle.ts", "src/lib/ayas/machine/AyasRuntimeImageLifecycle.ts", "scripts/smoke-ayas-on-demand-lifecycle.ts", "scripts/smoke-ayas-on-demand-lifecycle-mutations.ts"]) for (const spelling of [f, f.toUpperCase(), `./${f.replace(/\//g, "\\")}`]) assert.equal(classifyPatchTarget(spelling).level, "FORBIDDEN_AUTONOMOUS");
  });
  await scenario("one demand persists exact task/evidence/checkpoint before own model unload", async () => {
    const f = fixture(), r = await runAyasOnDemandTaskWith(f.input, f.ports); assert.equal(r.reason, "TASK_PERSISTED_AND_OWN_MODEL_UNLOADED"); assert.equal(r.authority, "NONE"); assert.equal(r.modelQualityFailure, false); assert.equal(f.calls(), 1); assert.equal(f.journal.load(f.task.taskId)!.status, "COMPLETED");
    assert.deepEqual(r.phases, ["STARTING", "READY", "BUSY", "DRAINING", "STOPPING", "STOPPED"]); assert.ok(f.actions.indexOf("persist") < f.actions.indexOf("read-back") && f.actions.indexOf("read-back") < f.actions.indexOf("STOP_LLAMA_SERVER")); assert.ok(f.actions.indexOf("STOP_LLAMA_SERVER") < f.actions.indexOf("REMOVE_TASK_CONTAINERS") && f.actions.indexOf("REMOVE_TASK_CONTAINERS") < f.actions.indexOf("RELEASE_MODEL_MEMORY")); assert.equal(f.snapshot().modelMemoryReleased, true); assert.equal(f.snapshot().machineState, "RUNNING"); assert.ok(!f.actions.includes("STOP_MACHINE"));
  });
  await scenario("running machine reused; no start without explicit task, valid pins/mapping and current capability", async () => {
    const f = fixture(); f.setSnapshot({ machineState: "RUNNING" }); assert.equal((await runAyasOnDemandTaskWith(f.input, f.ports)).state, "STOPPED"); assert.ok(!f.actions.includes("START_MACHINE"));
    for (const patch of [{ trigger: "WINDOWS_STARTUP" }, { task: { ...f.input.task, granted: true } }, { durableTaskId: "bad" }, { profile: { ...profile, modelManifest: { ...ayasLocalCodingCandidatePins.model, sha256: H } } }, { profile: { ...profile, timeoutMs: Infinity } }, { profile: { ...profile, timeoutMs: 1_800_001 } }]) { const g = fixture(); await runAyasOnDemandTaskWith({ ...g.input, ...patch } as never, g.ports); assert.equal(g.calls(), 0); assert.ok(!g.actions.includes("LOAD_PINNED_MODEL")); }
    const g = fixture(); g.ports.authorize = async () => false; assert.equal((await runAyasOnDemandTaskWith(g.input, g.ports)).reason, "CURRENT_CAPABILITY_AND_PINS_REQUIRED"); assert.equal(g.calls(), 0);
    const h = fixture(); const mapped = h.journal.load(h.task.taskId)!; h.ports.journal = { load: id => ({ ...h.journal.load(id)!, steps: mapped.steps.map(s => s.kind === "ACTIVITY" ? { ...s, input: { codingContractSha256: H } } : s) }) }; assert.equal((await runAyasOnDemandTaskWith(h.input, h.ports)).reason, "DURABLE_TASK_MAPPING_REQUIRED"); assert.equal(h.calls(), 0);
  });
  await scenario("RAM90 defer preserves journal/attempt budget; pressure before load is rechecked", async () => {
    const f = fixture(), before = JSON.stringify(f.journal.read(f.task.taskId)); f.setRam(90); await runAyasOnDemandTaskWith(f.input, f.ports); assert.equal(f.calls(), 0); assert.equal(JSON.stringify(f.journal.read(f.task.taskId)), before); assert.equal(f.journal.load(f.task.taskId)!.stepStates[0]!.attempts, 0);
    const g = fixture(), perform = g.ports.perform; g.ports.perform = async (...args) => { const r = await perform(...args); if (args[0] === "START_MACHINE") g.setRam(90); return r; }; await runAyasOnDemandTaskWith(g.input, g.ports); assert.ok(!g.actions.includes("LOAD_PINNED_MODEL")); assert.equal(g.calls(), 0);
    const h = fixture(); h.ports.authorize = async action => { if (action === "LOAD_PINNED_MODEL") h.setSnapshot({ dependentTaskIds: null }); return true; }; await runAyasOnDemandTaskWith(h.input, h.ports); assert.ok(!h.actions.includes("LOAD_PINNED_MODEL"));
    const changed = fixture(); changed.ports.authorize = async () => { const t = changed.journal.load(changed.task.taskId)!; if (t.status === "ACTIVE") changed.journal.append(t.taskId, t.lastSequence, { type: "TASK_CANCELLED", reason: "OWNER_CANCELLED_BEFORE_CAPACITY" }); return true; }; assert.equal((await runAyasOnDemandTaskWith(changed.input, changed.ports)).reason, "DURABLE_TASK_CHANGED"); assert.equal(changed.calls(), 0);
  });
  await scenario("shared capacity excludes concurrent actual controller cycles", async () => {
    const f = fixture(), g = fixture(); g.ports.hostCapacityRoot = f.ports.hostCapacityRoot; let enter!: () => void, release!: () => void; const started = new Promise<void>(r => { enter = r; }), wait = new Promise<void>(r => { release = r; }); const work = f.ports.runTask; f.ports.runTask = async i => { enter(); await wait; return work(i); }; const first = runAyasOnDemandTaskWith(f.input, f.ports); await started; const second = await runAyasOnDemandTaskWith(g.input, g.ports); assert.equal(second.reason, "RESOURCE_CAPACITY_BUSY"); assert.equal(g.calls(), 0); release(); assert.equal((await first).state, "STOPPED");
  });
  await scenario("safe active task crosses90 without kill; host abort does not count as model failure", async () => {
    const f = fixture(), work = f.ports.runTask; f.ports.runTask = async i => { f.setRam(91); return work(i); }; assert.equal((await runAyasOnDemandTaskWith(f.input, f.ports)).workloadOutcome, "TASK_FINISHED");
    const g = fixture(), run = g.ports.runTask; g.ports.runTask = async i => { g.setRam(97); return run(i); }; const r = await runAyasOnDemandTaskWith(g.input, g.ports); assert.equal(r.workloadOutcome, "RESOURCE_ABORT"); assert.equal(r.modelQualityFailure, false); assert.equal(g.journal.load(g.task.taskId)!.status, "CANCELLED"); assert.equal(g.snapshot().modelMemoryReleased, true);
    const h = fixture(); h.outcome("MODEL_FAILURE"); assert.equal((await runAyasOnDemandTaskWith(h.input, h.ports)).modelQualityFailure, true); assert.equal(h.snapshot().modelMemoryReleased, true);
    const deferred = fixture(), deferredWork = deferred.ports.runTask, read = deferred.ports.readCurrent; let pressure = false;
    deferred.ports.readCurrent = async () => { const v = await read(); return { ...v, context: { ...v.context, ownerInteractive: pressure } }; };
    deferred.ports.runTask = async i => { pressure = true; return deferredWork(i); };
    const before = JSON.stringify(deferred.journal.read(deferred.task.taskId)), paused = await runAyasOnDemandTaskWith(deferred.input, deferred.ports);
    assert.equal(paused.workloadOutcome, "TASK_DEFERRED"); assert.equal(paused.state, "STOPPED"); assert.equal(paused.modelQualityFailure, false); assert.equal(JSON.stringify(deferred.journal.read(deferred.task.taskId)), before); assert.equal(deferred.journal.load(deferred.task.taskId)!.status, "ACTIVE"); assert.equal(deferred.snapshot().modelMemoryReleased, true);
    pressure = false; deferred.ports.runTask = deferredWork; assert.equal((await runAyasOnDemandTaskWith(deferred.input, deferred.ports)).workloadOutcome, "TASK_FINISHED"); assert.equal(deferred.journal.load(deferred.task.taskId)!.status, "COMPLETED");
  });
  await scenario("unsettled/uncertain/missing journal, unknown or foreign ownership prevents unload", async () => {
    const active = fixture(); active.ports.runTask = async () => "TASK_FINISHED"; assert.equal((await runAyasOnDemandTaskWith(active.input, active.ports)).reason, "DURABLE_TASK_UNSETTLED_NO_UNLOAD"); assert.ok(!active.actions.includes("STOP_LLAMA_SERVER"));
    for (const patch of [{ dependentTaskIds: null }, { dependentTaskIds: ["ayas-task-" + "f".repeat(32)] }, { serverOwnerTaskId: "ayas-task-" + "f".repeat(32) }, { taskContainerOwnerTaskId: null }, { serverState: "UNKNOWN" }]) { const f = fixture(), persist = f.ports.persistEvidenceAndCheckpoint; f.ports.persistEvidenceAndCheckpoint = async fact => { const r = await persist(fact); f.setSnapshot(patch as Partial<AyasOnDemandSnapshot>); return r; }; assert.equal((await runAyasOnDemandTaskWith(f.input, f.ports)).state, "ERROR"); assert.ok(!f.actions.includes("STOP_LLAMA_SERVER")); }
    const f = fixture(), load = f.journal.load.bind(f.journal), persist = f.ports.persistEvidenceAndCheckpoint; f.ports.persistEvidenceAndCheckpoint = async fact => { const r = await persist(fact); f.ports.journal = { load: id => { const t = load(id); return t ? { ...t, status: "UNCERTAIN" } : undefined; } }; return r; }; assert.equal((await runAyasOnDemandTaskWith(f.input, f.ports)).state, "ERROR"); assert.ok(!f.actions.includes("STOP_LLAMA_SERVER"));
    for (const status of ["ACTIVE", "UNCERTAIN"] as const) {
      const other = fixture(), save = other.ports.persistEvidenceAndCheckpoint, otherId = "ayas-task-" + "e".repeat(32);
      other.ports.persistEvidenceAndCheckpoint = async fact => {
        const r = await save(fact), own = other.journal.load(other.task.taskId)!;
        // Synthetic foreign dependency observation; the real own task remains COMPLETED in its TEMP journal.
        other.ports.journal = { load: id => id === otherId ? { ...own, taskId: otherId, status } : other.journal.load(id) };
        other.setSnapshot({ dependentTaskIds: [otherId] }); return r;
      };
      assert.equal((await runAyasOnDemandTaskWith(other.input, other.ports)).state, "ERROR"); assert.ok(!other.actions.includes("STOP_LLAMA_SERVER"));
    }
  });
  await scenario("receipt drift, storage failure and cleanup dependency races fail closed", async () => {
    for (const bad of [null, { taskId: "wrong" }, { sequence: 999 }, { taskDigest: H }, { evidenceDigest: "bad" }, { checkpointDigest: "bad" }, { outcome: "MODEL_FAILURE" }]) { const f = fixture(), read = f.ports.readReceipt; f.ports.readReceipt = async id => { const r = await read(id); return bad === null ? null : { ...r!, ...bad } as AyasOnDemandReceipt; }; assert.equal((await runAyasOnDemandTaskWith(f.input, f.ports)).reason, "EVIDENCE_CHECKPOINT_NOT_VERIFIED_NO_UNLOAD"); assert.ok(!f.actions.includes("STOP_LLAMA_SERVER")); }
    const f = fixture(); f.ports.persistEvidenceAndCheckpoint = async () => { throw Error("SYNTHETIC_STORAGE_FAILURE"); }; assert.equal((await runAyasOnDemandTaskWith(f.input, f.ports)).state, "ERROR"); assert.ok(!f.actions.includes("STOP_LLAMA_SERVER"));
    for (const field of ["checkpointDigest", "evidenceDigest"] as const) { const invalid = fixture(), persist = invalid.ports.persistEvidenceAndCheckpoint; let receipt: AyasOnDemandReceipt; invalid.ports.persistEvidenceAndCheckpoint = async fact => { receipt = { ...await persist(fact), [field]: "bad" }; return receipt; }; invalid.ports.readReceipt = async () => receipt; assert.equal((await runAyasOnDemandTaskWith(invalid.input, invalid.ports)).reason, "EVIDENCE_CHECKPOINT_NOT_VERIFIED_NO_UNLOAD"); assert.ok(!invalid.actions.includes("STOP_LLAMA_SERVER")); }
    const g = fixture(); g.ports.authorize = async action => { if (action === "STOP_LLAMA_SERVER") g.setSnapshot({ dependentTaskIds: null }); return true; }; assert.equal((await runAyasOnDemandTaskWith(g.input, g.ports)).state, "ERROR"); assert.ok(!g.actions.includes("STOP_LLAMA_SERVER"));
    const h = fixture(), perform = h.ports.perform; h.ports.perform = async (...args) => { const r = await perform(...args); if (args[0] === "STOP_LLAMA_SERVER") h.setSnapshot({ dependentTaskIds: null }); return r; }; await runAyasOnDemandTaskWith(h.input, h.ports); assert.ok(!h.actions.includes("REMOVE_TASK_CONTAINERS"));
  });
  await scenario("unconfirmed effects, runtime identity drift and bounded timeout never auto replay", async () => {
    const f = fixture(), perform = f.ports.perform; f.ports.perform = async (...args) => args[0] === "LOAD_PINNED_MODEL" ? "UNKNOWN" : perform(...args); assert.equal((await runAyasOnDemandTaskWith(f.input, f.ports)).state, "ERROR"); assert.equal(f.calls(), 0); assert.ok(!f.actions.includes("STOP_LLAMA_SERVER"));
    const g = fixture(); g.setSnapshot({ machineName: "foreign-machine" }); await runAyasOnDemandTaskWith(g.input, g.ports); assert.ok(!g.actions.includes("START_MACHINE"));
    const h = fixture(); h.ports.runTask = async () => new Promise(() => {}); const r = await runAyasOnDemandTaskWith({ ...h.input, profile: { ...profile, timeoutMs: 10 } }, h.ports); assert.equal(r.state, "ERROR"); assert.equal(h.journal.load(h.task.taskId)!.status, "ACTIVE"); assert.ok(!h.actions.includes("STOP_LLAMA_SERVER"));
    for (const prior of ["UNAVAILABLE", "STARTING", "READY", "BUSY", "DRAINING", "STOPPING", "ERROR"] as const) { const held = fixture(); held.ports.readPhase = async () => prior; held.ports.authorize = async () => { assert.fail("unconfirmed lifecycle must refuse before authority/start"); }; assert.equal((await runAyasOnDemandTaskWith(held.input, held.ports)).reason, "PRIOR_LIFECYCLE_REQUIRES_CURRENT_STATE_REREAD"); assert.equal(held.calls(), 0); assert.ok(!held.actions.includes("START_MACHINE")); }
    const retryActions = [...h.actions]; assert.equal((await runAyasOnDemandTaskWith(h.input, h.ports)).reason, "PRIOR_LIFECYCLE_REQUIRES_CURRENT_STATE_REREAD"); assert.deepEqual(h.actions, retryActions);
    const slow = fixture(); slow.ports.perform = async () => new Promise(() => {}); assert.equal((await runAyasOnDemandTaskWith({ ...slow.input, profile: { ...profile, timeoutMs: 10 } }, slow.ports)).state, "ERROR"); assert.equal(slow.calls(), 0); assert.equal((await runAyasOnDemandTaskWith(slow.input, slow.ports)).reason, "PRIOR_LIFECYCLE_REQUIRES_CURRENT_STATE_REREAD");
  });
  await scenario("idle10min stops exact machine; less idle/new demand/active/uncertain/unknown/foreign blocks stop", async () => {
    const good = fixture(); await runAyasOnDemandTaskWith(good.input, good.ports); good.setNow(good.now() + 600_000); assert.equal((await stopAyasOnDemandIdleWith(profile, good.ports)).reason, "EXACT_IDLE_MACHINE_STOPPED"); assert.equal(good.snapshot().machineState, "STOPPED");
    for (const patch of [{ demandPending: true }, { demandPending: null }, { dependentTaskIds: null }, { serverState: "RUNNING" }, { modelMemoryReleased: null }, { foreignContainers: true }, { taskContainerIds: [containerId] }, { lastDemandAtMs: null }, { machineName: "foreign-machine" }]) { const f = fixture(); await runAyasOnDemandTaskWith(f.input, f.ports); f.setNow(f.now() + 600_000); f.setSnapshot(patch as Partial<AyasOnDemandSnapshot>); assert.equal((await stopAyasOnDemandIdleWith(profile, f.ports)).reason, "IDLE_STOP_DEFERRED"); assert.ok(!f.actions.includes("STOP_MACHINE")); }
    const short = fixture(); await runAyasOnDemandTaskWith(short.input, short.ports); short.setNow(short.now() + 599_999); assert.equal((await stopAyasOnDemandIdleWith(profile, short.ports)).reason, "IDLE_STOP_DEFERRED"); assert.ok(!short.actions.includes("STOP_MACHINE"));
    const active = fixture(); active.setSnapshot({ machineState: "RUNNING" }); active.setNow(active.now() + 600_000); await stopAyasOnDemandIdleWith(profile, active.ports); assert.ok(!active.actions.includes("STOP_MACHINE"));
    const race = fixture(); await runAyasOnDemandTaskWith(race.input, race.ports); race.setNow(race.now() + 600_000); race.ports.authorize = async action => { if (action === "STOP_MACHINE") race.setSnapshot({ demandPending: true }); return true; }; assert.equal((await stopAyasOnDemandIdleWith(profile, race.ports)).reason, "IDLE_DEMAND_CHANGED"); assert.ok(!race.actions.includes("STOP_MACHINE"));
    const timerRace = fixture(); await runAyasOnDemandTaskWith(timerRace.input, timerRace.ports); timerRace.setNow(timerRace.now() + 600_000); timerRace.ports.authorize = async action => { if (action === "STOP_MACHINE") timerRace.setSnapshot({ lastDemandAtMs: timerRace.now() - 1 }); return true; }; assert.equal((await stopAyasOnDemandIdleWith(profile, timerRace.ports)).reason, "IDLE_DEMAND_CHANGED"); assert.ok(!timerRace.actions.includes("STOP_MACHINE"));
  });
  await scenario("all image classes; all-version evidence dependencies beat rebuild/cleanup; unknown stays unknown", () => {
    const base: AyasRuntimeImageFacts = { contentId: `sha256:${H}`, managedByAyas: true, currentRuntimeRequired: false, dependentContainerCount: 0, evidenceReferences: [], dependencyInventoryComplete: true, rebuild: null };
    assert.equal(AYAS_RUNTIME_IMAGE_CLASSES.length, 5); assert.equal(classifyAyasRuntimeImage(base).class, "RECLAIMABLE");
    const recipe = { recipeDigest: H, pinnedInputsVerified: true };
    assert.equal(classifyAyasRuntimeImage({ ...base, rebuild: recipe }).class, "STALE_REBUILDABLE"); assert.equal(classifyAyasRuntimeImage({ ...base, rebuild: recipe }).cleanupEligible, false);
    assert.equal(classifyAyasRuntimeImage({ ...base, rebuild: recipe, currentRuntimeRequired: true }).class, "REBUILDABLE_REQUIRED"); assert.equal(classifyAyasRuntimeImage({ ...base, currentRuntimeRequired: true }).class, "REFERENCED_REQUIRED");
    for (const purpose of ["QUALIFICATION", "PROVENANCE", "ROLLBACK", "DURABLE_TASK"] as const) for (const complete of [true, false]) for (const rebuild of [recipe, null]) { const r = classifyAyasRuntimeImage({ ...base, rebuild, evidenceReferences: [{ purpose, digest: H }], dependencyInventoryComplete: complete }); assert.equal(r.class, "REFERENCED_REQUIRED"); assert.equal(r.cleanupEligible, false); assert.equal(r.authority, "NONE"); }
    assert.equal(classifyAyasRuntimeImage({ ...base, dependentContainerCount: 1 }).class, "REFERENCED_REQUIRED");
    for (const patch of [{ dependencyInventoryComplete: false }, { managedByAyas: null }, { managedByAyas: false }, { currentRuntimeRequired: null }, { dependentContainerCount: null }, { evidenceReferences: null }, { evidenceReferences: new Array(1) }, { contentId: "latest" }, { dependentContainerCount: NaN }, { rebuild: { recipeDigest: "latest", pinnedInputsVerified: true } }]) assert.equal(classifyAyasRuntimeImage({ ...base, ...patch } as never).class, "UNKNOWN");
  });
  assert.equal(scenarioIndex, 11); assert.equal(scenarios, selectedCase === undefined ? 11 : 1);
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-on-demand-lifecycle", scenarios, selectedMutationCase: selectedCase ?? null, physicalStarts: 0, evidenceClass: "CONTROLLER_CONTRACT_NOT_HARDWARE_QUALIFICATION" }));
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { assert.equal(path.dirname(fs.realpathSync(temp)).toLowerCase(), fs.realpathSync(os.tmpdir()).toLowerCase()); assert.ok(path.basename(temp).startsWith("ayas-on-demand-")); fs.rmSync(temp, { recursive: true, force: true }); });
