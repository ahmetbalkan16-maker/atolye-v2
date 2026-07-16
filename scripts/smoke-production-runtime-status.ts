import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { ProductionRuntimeInitializer } from "../src/lib/production/ProductionRuntimeInitializer";
import { ProductionWorkerLifecycle } from "../src/lib/production/ProductionWorkerLifecycle";
import { getProductionRuntimeStatus } from "../src/lib/runtime/ProductionRuntimeCompositionRoot";
import type { ProductionExecutionRecoveryBootstrapResult } from "../src/types/productionExecutionRecoveryBootstrap";
import type { ProductionRuntimeStatus } from "../src/types/productionRuntimeStatus";

const startupTimestamp = "2026-07-13T13:00:00.000Z";
const readyTimestamp = "2026-07-13T13:01:00.000Z";
const drainTimestamp = "2026-07-13T13:05:00.000Z";
const stoppedTimestamp = "2026-07-13T13:06:00.000Z";

function bootstrap(): ProductionExecutionRecoveryBootstrapResult {
  return {
    schemaVersion: "1",
    bootstrapId: "runtime-status-bootstrap",
    evaluatedAt: startupTimestamp,
    decision: "ready",
    writeFree: true,
    attempts: [],
    plannerPlans: [],
    counts: { active: 0, running: 0, terminal: 0, orphaned: 0, "expired-lease": 0, replayable: 0 },
    evidence: ["bootstrap:read-only"],
  };
}

async function main() {
  let scenarios = 0;
  const scenario = async (name: string, run: () => unknown | Promise<unknown>) => {
    await run();
    scenarios++;
    void name;
  };

  await scenario("composition root exposes pre-initialization snapshot", () => {
    assert.deepEqual(getProductionRuntimeStatus(), {
      schemaVersion: "1",
      writeFree: true,
      lifecycleState: "created",
      activeExecutionCount: 0,
      acceptingExecutions: false,
      initialized: false,
      recoveryCompleted: false,
      workerReady: false,
      draining: false,
      startupTimestamp: null,
      lastStateTransitionTimestamp: null,
      initializationFailure: null,
    });
  });

  let lifecycleNow = readyTimestamp;
  const worker = new ProductionWorkerLifecycle(() => lifecycleNow);
  let releaseDiscovery!: () => void;
  const discoveryGate = new Promise<void>((resolve) => { releaseDiscovery = resolve; });
  let enterBootstrap!: () => void;
  const bootstrapEntered = new Promise<void>((resolve) => { enterBootstrap = resolve; });
  let releaseBootstrap!: (value: ProductionExecutionRecoveryBootstrapResult) => void;
  const bootstrapGate = new Promise<ProductionExecutionRecoveryBootstrapResult>((resolve) => { releaseBootstrap = resolve; });
  const counters = { discovery: 0, bootstrap: 0, writes: 0, schedulerActions: 0, executions: 0 };
  const initializer = new ProductionRuntimeInitializer({
    now: () => startupTimestamp,
    listProjectSlugs: async () => {
      counters.discovery++;
      await discoveryGate;
      return ["project-1"];
    },
    createRecoveryBootstrap: () => ({
      bootstrapRecovery: async () => {
        counters.bootstrap++;
        enterBootstrap();
        return bootstrapGate;
      },
    }),
    workerLifecycle: worker,
  });

  const initialization = initializer.initialize();
  await scenario("startup is observable as starting", () => {
    assert.deepEqual(worker.statusSnapshot(), {
      schemaVersion: "1",
      writeFree: true,
      lifecycleState: "starting",
      activeExecutionCount: 0,
      acceptingExecutions: false,
      initialized: false,
      recoveryCompleted: false,
      workerReady: false,
      draining: false,
      startupTimestamp,
      lastStateTransitionTimestamp: startupTimestamp,
      initializationFailure: null,
    });
  });

  releaseDiscovery();
  await bootstrapEntered;
  await scenario("worker is not ready before recovery completes", () => {
    const status = worker.statusSnapshot();
    assert.equal(status.lifecycleState, "starting");
    assert.equal(status.recoveryCompleted, false);
    assert.equal(status.workerReady, false);
    assert.equal(status.acceptingExecutions, false);
  });

  releaseBootstrap(bootstrap());
  const initialized = await initialization;
  await scenario("successful initialization produces ready snapshot", () => {
    assert.equal(initialized.ok, true);
    assert.deepEqual(worker.statusSnapshot(), {
      schemaVersion: "1",
      writeFree: true,
      lifecycleState: "ready",
      activeExecutionCount: 0,
      acceptingExecutions: true,
      initialized: true,
      recoveryCompleted: true,
      workerReady: true,
      draining: false,
      startupTimestamp,
      lastStateTransitionTimestamp: readyTimestamp,
      initializationFailure: null,
    });
  });

  await scenario("repeated initialize and start preserve state and timestamps", async () => {
    const status = worker.statusSnapshot();
    const repeatedInitialization = initializer.initialize();
    assert.strictEqual(repeatedInitialization, initialization);
    assert.strictEqual(await repeatedInitialization, initialized);
    if (!initialized.ok) assert.fail("Expected successful initialization.");
    const repeatedStartOne = worker.start({ initialization: initialized });
    const repeatedStartTwo = worker.start({ initialization: initialized });
    assert.strictEqual(repeatedStartOne, repeatedStartTwo);
    assert.equal((await repeatedStartOne).snapshot.state, "ready");
    assert.deepEqual(worker.statusSnapshot(), status);
  });

  await scenario("snapshot reads do not change the last transition timestamp", () => {
    const before = worker.statusSnapshot();
    lifecycleNow = "2026-07-13T13:04:00.000Z";
    const after = worker.statusSnapshot();
    assert.notStrictEqual(before, after);
    assert.equal(after.lastStateTransitionTimestamp, readyTimestamp);
    assert.equal(after.startupTimestamp, startupTimestamp);
  });

  let releaseExecution!: () => void;
  const executionGate = new Promise<void>((resolve) => { releaseExecution = resolve; });
  const execution = worker.execute(async () => {
    counters.executions++;
    await executionGate;
  });
  await scenario("active execution count uses lifecycle admission counter", () => {
    assert.equal(worker.snapshot().activeExecutions, 1);
    assert.equal(worker.statusSnapshot().activeExecutionCount, 1);
  });

  lifecycleNow = drainTimestamp;
  const drain = worker.drain();
  await scenario("drain closes execution acceptance", () => {
    const status = worker.statusSnapshot();
    assert.equal(status.lifecycleState, "draining");
    assert.equal(status.draining, true);
    assert.equal(status.acceptingExecutions, false);
    assert.equal(status.workerReady, false);
    assert.equal(status.initialized, true);
    assert.equal(status.recoveryCompleted, true);
    assert.equal(status.activeExecutionCount, 1);
    assert.equal(status.lastStateTransitionTimestamp, drainTimestamp);
  });

  releaseExecution();
  await execution;
  await drain;
  lifecycleNow = stoppedTimestamp;
  await worker.stop();
  await scenario("completed drain can transition to stopped", () => {
    const status = worker.statusSnapshot();
    assert.equal(status.lifecycleState, "stopped");
    assert.equal(status.activeExecutionCount, 0);
    assert.equal(status.acceptingExecutions, false);
    assert.equal(status.draining, false);
    assert.equal(status.initialized, true);
    assert.equal(status.recoveryCompleted, true);
    assert.equal(status.workerReady, false);
    assert.equal(status.startupTimestamp, startupTimestamp);
    assert.equal(status.lastStateTransitionTimestamp, stoppedTimestamp);
  });

  const failedWorker = new ProductionWorkerLifecycle(() => "2026-07-13T14:01:00.000Z");
  const failedInitializer = new ProductionRuntimeInitializer({
    now: () => "2026-07-13T14:00:00.000Z",
    listProjectSlugs: async () => ["failed-project"],
    createRecoveryBootstrap: () => ({
      bootstrapRecovery: async () => {
        throw new Error("raw secret failure at C:\\private\\runtime.json", { cause: new Error("raw cause payload") });
      },
    }),
    workerLifecycle: failedWorker,
  });
  const failedResult = await failedInitializer.initialize();
  await scenario("initialization failure produces failed snapshot", () => {
    assert.equal(failedResult.ok, false);
    const status = failedWorker.statusSnapshot();
    assert.equal(status.lifecycleState, "failed");
    assert.equal(status.initialized, false);
    assert.equal(status.recoveryCompleted, false);
    assert.equal(status.workerReady, false);
    assert.equal(status.acceptingExecutions, false);
    assert.equal(status.draining, false);
    assert.equal(status.startupTimestamp, "2026-07-13T14:00:00.000Z");
    assert.equal(status.lastStateTransitionTimestamp, "2026-07-13T14:01:00.000Z");
    assert.deepEqual(status.initializationFailure, { reasonCode: "RUNTIME_BOOTSTRAP_FAILED", failedProjectSlug: "failed-project" });
  });

  await scenario("unsafe failure reason and project slug are not exposed", () => {
    const unsafeWorker = new ProductionWorkerLifecycle(() => "2026-07-13T15:01:00.000Z");
    unsafeWorker.beginInitialization("2026-07-13T15:00:00.000Z");
    unsafeWorker.fail("raw failure with spaces", { failedProjectSlug: "../private-project" });
    assert.deepEqual(unsafeWorker.statusSnapshot().initializationFailure, { reasonCode: "WORKER_LIFECYCLE_FAILED" });
  });

  await scenario("repeated snapshot reads are stable and write free", () => {
    const before = { ...counters };
    const first = worker.statusSnapshot();
    const second = worker.statusSnapshot();
    assert.notStrictEqual(first, second);
    assert.deepEqual(first, second);
    assert.deepEqual(counters, before);
  });

  await scenario("external snapshot mutation cannot affect lifecycle", () => {
    const snapshot = worker.statusSnapshot() as { -readonly [K in keyof ProductionRuntimeStatus]: ProductionRuntimeStatus[K] };
    assert.equal(Object.isFrozen(snapshot), true);
    assert.throws(() => { snapshot.activeExecutionCount = 999; }, TypeError);
    assert.equal(worker.statusSnapshot().activeExecutionCount, 0);
  });

  await scenario("failure details contain no raw Error or stack", () => {
    const status = failedWorker.statusSnapshot();
    assert.equal(status.initializationFailure instanceof Error, false);
    assert.equal(Object.isFrozen(status.initializationFailure), true);
    const failure = status.initializationFailure as { reasonCode: string; failedProjectSlug?: string };
    assert.throws(() => { failure.reasonCode = "MUTATED"; }, TypeError);
    assert.throws(() => { failure.failedProjectSlug = "mutated-project"; }, TypeError);
    assert.deepEqual(failedWorker.statusSnapshot().initializationFailure, { reasonCode: "RUNTIME_BOOTSTRAP_FAILED", failedProjectSlug: "failed-project" });
    const serialized = JSON.stringify(status);
    assert.equal(serialized.includes("raw secret"), false);
    assert.equal(serialized.toLowerCase().includes("stack"), false);
    assert.equal(serialized.toLowerCase().includes("cause"), false);
    assert.equal(serialized.includes("C:\\private"), false);
    assert.deepEqual(Object.keys(status.initializationFailure ?? {}).sort(), ["failedProjectSlug", "reasonCode"]);
  });

  await scenario("status path shares composition lifecycle and has no runtime side effects", async () => {
    const root = await fs.readFile("src/lib/runtime/ProductionRuntimeCompositionRoot.ts", "utf8");
    const lifecycle = await fs.readFile("src/lib/production/ProductionWorkerLifecycle.ts", "utf8");
    assert.match(root, /return productionWorkerLifecycle\.statusSnapshot\(\)/);
    assert.match(root, /workerLifecycle:\s*productionWorkerLifecycle/);
    assert.match(root, /runtimeOperationContext:\s*processRuntimeOperationContext/);
    const statusBody = lifecycle.slice(lifecycle.indexOf("statusSnapshot():"), lifecycle.indexOf("beginInitialization("));
    assert.ok(!/\.write\(|persist|schedule|execute\(|Promise|Error/.test(statusBody));
    assert.deepEqual(counters, { discovery: 1, bootstrap: 1, writes: 0, schedulerActions: 0, executions: 1 });
  });

  assert.equal(scenarios, 15);
  console.log(`Sprint 111 production runtime status smoke: PASS (${scenarios}/15 scenarios)`);
}

void main();
