import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  captureAyasRuntimeStabilitySnapshot,
  fingerprintAyasValue,
  type AyasRuntimeStabilitySnapshot,
} from "../src/lib/brain/autonomy/AyasRuntimeStabilitySnapshot";
import {
  declareAyasRuntimeImpactScope,
  diffAyasRuntimeStabilitySnapshots,
  findAyasOutOfScopeViolations,
} from "../src/lib/brain/autonomy/AyasRuntimeStabilityScope";
import {
  createAyasStabilityTransactionStore,
  recoverInterruptedAyasStabilityTransactions,
  AyasStabilityTransactionError,
} from "../src/lib/brain/autonomy/AyasRuntimeStabilityTransaction";
import { evaluateAyasRuntimeStabilityHealth } from "../src/lib/brain/autonomy/AyasRuntimeStabilityHealth";
import { restartAyasOwnedService, resolveAyasServiceOwnership } from "../src/lib/brain/autonomy/AyasRuntimeServiceRestart";
import { runAyasControlledOperation, baselineAyasPreconditions } from "../src/lib/brain/autonomy/AyasRuntimeStabilityGuard";

/**
 * AYAS RUNTIME STABILITY GUARD regression suite.
 *
 * Fully isolated: every durable store is rooted in a fresh `os.tmpdir()`
 * directory, every process/port/command probe is injected, and nothing here
 * kills a real process, touches the real repo, restarts a real server, or
 * approves/executes a real proposal. The guard's own value proposition —
 * "a change must not disturb an unrelated subsystem" — would be worthless
 * if proving it disturbed the live system.
 */

let scenarios = 0;
function scenario(name: string, run: () => void | Promise<void>): Promise<void> {
  scenarios += 1;
  const outcome = run();
  return Promise.resolve(outcome).catch((error: unknown) => {
    console.error(`FAIL: ${name}`);
    throw error;
  });
}

const SALT = "stability-suite-salt";

function snapshot(overrides: Partial<AyasRuntimeStabilitySnapshot> = {}): AyasRuntimeStabilitySnapshot {
  const base: AyasRuntimeStabilitySnapshot = {
    schemaVersion: "1",
    capturedAt: "2026-09-18T12:00:00.000Z",
    repo: { branch: "wip/guard", head: "a".repeat(40), clean: true, dirtyEntryCount: 0 },
    services: [
      { port: 3000, listening: true, pid: 100, commandFingerprint: fingerprintAyasValue("next start -p 3000", SALT) },
      { port: 3101, listening: true, pid: 200, commandFingerprint: fingerprintAyasValue("next start -p 3101", SALT) },
    ],
    gate: { autonomousExecutionEnabled: true, ownerApprovalRequired: true },
    scheduler: { nextLightAt: "2026-09-18T17:00:00.000Z", nextDeepAt: "2026-09-19T11:00:00.000Z", lastSuccessfulResearchAt: "2026-09-18T11:00:00.000Z", consecutiveFailures: 0, runInFlight: false, stateFilePresent: true },
    proposals: { statusCounts: { PENDING: 1 }, pendingProposalIds: ["proposal-1"], approvedProposalIds: [], decisionCount: 0, resultCount: 0 },
    env: [{ name: "AYAS_AUTONOMOUS_EXECUTION_ENABLED", set: true, literalValue: "1", valueFingerprint: fingerprintAyasValue("1", SALT) }],
    runtimeRootFingerprint: fingerprintAyasValue("D:/runtime", SALT),
    gaps: [],
  };
  return { ...base, ...overrides };
}

function tmpRoot(label: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `ayas-stability-${label}-`));
}

async function main(): Promise<void> {
  // ---------------------------------------------------------------- snapshot
  await scenario("snapshot records env vars by fingerprint and never by raw secret value", () => {
    const captured = captureAyasRuntimeStabilitySnapshot({
      repoRoot: process.cwd(),
      env: { AYAS_AUTONOMOUS_EXECUTION_ENABLED: "1", ATOLYE_RUNTIME_ROOT: "D:/secret-runtime-path", OPENAI_API_KEY: "sk-must-never-appear" },
      trackedEnvVars: ["AYAS_AUTONOMOUS_EXECUTION_ENABLED", "ATOLYE_RUNTIME_ROOT", "OPENAI_API_KEY"],
      salt: SALT,
      ports: [],
      inbox: { load: () => ({ schemaVersion: "1", revision: 0, proposals: [], decisions: [], results: [] }) } as never,
      schedulerStore: { file: "", read: () => ({ schemaVersion: "1", consecutiveFailures: 0 }), write: (state) => state },
    });
    const serialized = JSON.stringify(captured);
    assert.ok(!serialized.includes("sk-must-never-appear"), "raw secret value must never be persisted in a snapshot");
    assert.ok(!serialized.includes("D:/secret-runtime-path"), "raw runtime root must be fingerprinted, not stored literally");
    const gateVar = captured.env.find((entry) => entry.name === "AYAS_AUTONOMOUS_EXECUTION_ENABLED");
    assert.equal(gateVar?.literalValue, "1", "non-secret gate flag is recorded literally for diagnosability");
    const secretVar = captured.env.find((entry) => entry.name === "OPENAI_API_KEY");
    assert.equal(secretVar?.literalValue, undefined, "secret-bearing var must have no literal value");
    assert.ok(secretVar?.valueFingerprint, "secret-bearing var is still comparable via fingerprint");
    assert.equal(captured.gate.autonomousExecutionEnabled, true, "gate state is read through the real gate function");
  });

  // ------------------------------------------------------------------- scope
  await scenario("scope diff detects a change in every snapshot section (totality)", () => {
    const before = snapshot();
    const mutations: Array<[string, AyasRuntimeStabilitySnapshot]> = [
      ["git-history", snapshot({ repo: { ...before.repo, head: "b".repeat(40) } })],
      ["source", snapshot({ repo: { ...before.repo, clean: false, dirtyEntryCount: 2 } })],
      ["service", snapshot({ services: [{ port: 3000, listening: true, pid: 999 }, before.services[1]!] })],
      ["runtime-config", snapshot({ gate: { autonomousExecutionEnabled: false, ownerApprovalRequired: true } })],
      ["research-scheduler", snapshot({ scheduler: { ...before.scheduler, nextDeepAt: "2026-09-20T00:00:00.000Z" } })],
      ["proposal-state", snapshot({ proposals: { ...before.proposals, decisionCount: 1 } })],
      ["runtime-root", snapshot({ runtimeRootFingerprint: "different" })],
    ];
    for (const [dimension, after] of mutations) {
      const changes = diffAyasRuntimeStabilitySnapshots(before, after);
      assert.ok(changes.some((change) => change.dimension === dimension), `a change in ${dimension} must be detected by the diff`);
    }
  });

  await scenario("an undeclared dimension is an out-of-scope violation", () => {
    const before = snapshot();
    // Operation claims it only restarts :3000, but the gate flipped too.
    const after = snapshot({ services: [{ port: 3000, listening: true, pid: 999 }, before.services[1]!], gate: { autonomousExecutionEnabled: false, ownerApprovalRequired: true } });
    const scope = declareAyasRuntimeImpactScope("restart-3000", ["service"], [3000]);
    const violations = findAyasOutOfScopeViolations(before, after, scope);
    assert.equal(violations.length, 1, "exactly the undeclared runtime-config change is a violation");
    assert.equal(violations[0]?.dimension, "runtime-config");
    assert.equal(violations[0]?.reasonCode, "DIMENSION_NOT_DECLARED");
  });

  await scenario("touching an undeclared port is a violation even when 'service' is allowed", () => {
    const before = snapshot();
    const after = snapshot({ services: [before.services[0]!, { port: 3101, listening: false }] });
    const scope = declareAyasRuntimeImpactScope("restart-3000", ["service"], [3000]);
    const violations = findAyasOutOfScopeViolations(before, after, scope);
    assert.equal(violations.length, 1, "the unrelated :3101 listener going down is a violation");
    assert.equal(violations[0]?.reasonCode, "PORT_NOT_DECLARED");
  });

  // ------------------------------------------------------------------ health
  await scenario("health fails when the service answers but the gate silently reverted", () => {
    const before = snapshot();
    const after = snapshot({ gate: { autonomousExecutionEnabled: false, ownerApprovalRequired: true } });
    const decision = evaluateAyasRuntimeStabilityHealth(before, after, { requiredPorts: [3000], httpStatusByPort: { 3000: 200 }, expectAutonomousExecutionEnabled: true });
    assert.equal(decision.healthy, false, "HTTP 200 must not be enough to call the runtime healthy");
    assert.ok(decision.failures.some((failure) => failure.startsWith("execution-gate")), "the gate regression is the reported failure");
  });

  await scenario("health fails when an unrelated port's owner changed", () => {
    const before = snapshot();
    const after = snapshot({ services: [{ port: 3000, listening: true, pid: 101, commandFingerprint: before.services[0]!.commandFingerprint! }, { port: 3101, listening: false }] });
    const decision = evaluateAyasRuntimeStabilityHealth(before, after, { requiredPorts: [3000], restartedPorts: [3000] });
    assert.equal(decision.healthy, false, "collateral damage to :3101 must fail health");
    assert.ok(decision.failures.some((failure) => failure.includes("3101")), "the failure names the disturbed port");
  });

  await scenario("health fails when the research scheduler stops advancing", () => {
    const before = snapshot();
    const after = snapshot({ scheduler: { consecutiveFailures: 3, runInFlight: false, stateFilePresent: false } });
    const decision = evaluateAyasRuntimeStabilityHealth(before, after, { requireSchedulerOperational: true });
    assert.equal(decision.healthy, false, "a runtime operation must not silently disable research scheduling");
    assert.ok(decision.failures.some((failure) => failure.startsWith("research-scheduler")));
  });

  await scenario("health fails when a pinned proposal stops being PENDING or gains a result", () => {
    const before = snapshot();
    const executed = snapshot({ proposals: { statusCounts: { COMPLETED: 1 }, pendingProposalIds: [], approvedProposalIds: [], decisionCount: 1, resultCount: 1 } });
    const decision = evaluateAyasRuntimeStabilityHealth(before, executed, { expectStillPending: ["proposal-1"] });
    assert.equal(decision.healthy, false, "an unexpected execution must fail health");
    assert.ok(decision.failures.some((failure) => failure.startsWith("no-unexpected-execution")));
  });

  await scenario("owner approval stays mandatory and an incomplete snapshot fails closed", () => {
    const before = snapshot();
    const weakened = snapshot({ gate: { autonomousExecutionEnabled: true, ownerApprovalRequired: false } });
    assert.equal(evaluateAyasRuntimeStabilityHealth(before, weakened, {}).healthy, false, "owner approval must never become optional");

    const gapped = snapshot({ gaps: ["port probe unavailable"] });
    const decision = evaluateAyasRuntimeStabilityHealth(before, gapped, {});
    assert.equal(decision.healthy, false, "an unprovable snapshot is a failure, not a pass");
    assert.ok(decision.failures.some((failure) => failure.startsWith("snapshot-complete")));
  });

  await scenario("a healthy, in-scope operation passes every check", () => {
    const before = snapshot();
    const after = snapshot({ services: [{ port: 3000, listening: true, pid: 101, commandFingerprint: before.services[0]!.commandFingerprint! }, before.services[1]!] });
    const decision = evaluateAyasRuntimeStabilityHealth(before, after, {
      requiredPorts: [3000], httpStatusByPort: { 3000: 200 }, restartedPorts: [3000],
      expectAutonomousExecutionEnabled: true, requireSchedulerOperational: true,
      expectRepoHead: before.repo.head, expectRepoClean: true, expectStillPending: ["proposal-1"],
    });
    assert.equal(decision.healthy, true, `expected a clean restart to be healthy, got: ${decision.failures.join(" | ")}`);
    assert.equal(decision.checks.some((check) => check.status === "FAIL"), false);
  });

  // ----------------------------------------------------------- restart discipline
  await scenario("restart refuses when the pid does not own the declared port", () => {
    const result = restartAyasOwnedService(
      { port: 3000, expectedPid: 100, expectedCommandContains: ["next"] },
      { portProbe: () => 555, commandProbe: () => "next start -p 3000", terminate: () => assert.fail("must not terminate on pid mismatch"), start: () => assert.fail("must not start") },
    );
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.reasonCode, "PID_MISMATCH");
    assert.equal(result.ok === false && result.terminated, false, "nothing may be terminated when ownership is unproven");
  });

  await scenario("restart refuses when the owning process identity does not match", () => {
    const result = restartAyasOwnedService(
      { port: 3000, expectedCommandContains: ["next", "atolye-v2"] },
      { portProbe: () => 100, commandProbe: () => "python -m http.server 3000", terminate: () => assert.fail("must not terminate an unrelated process"), start: () => assert.fail("must not start") },
    );
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.reasonCode, "COMMAND_FINGERPRINT_MISMATCH");
    assert.equal(result.ok === false && result.terminated, false);
  });

  await scenario("restart refuses when the command line cannot be read (ownership unprovable)", () => {
    const result = restartAyasOwnedService(
      { port: 3000, expectedCommandContains: ["next"] },
      { portProbe: () => 100, commandProbe: () => undefined, terminate: () => assert.fail("must not terminate"), start: () => assert.fail("must not start") },
    );
    assert.equal(result.ok === false && result.reasonCode, "COMMAND_UNREADABLE");
  });

  await scenario("a proven restart succeeds and leaves unrelated processes alive", () => {
    const terminated: number[] = [];
    let started = false;
    const result = restartAyasOwnedService(
      { port: 3000, expectedPid: 100, expectedCommandContains: ["next", "-p 3000"], protectedPids: [200, 300] },
      {
        portProbe: () => 100,
        commandProbe: () => "node next start -p 3000",
        terminate: (pid) => { terminated.push(pid); },
        start: () => { started = true; },
        waitForPort: () => 101,
        isProcessAlive: (pid) => pid === 200 || pid === 300,
      },
    );
    assert.equal(result.ok, true, "a fully proven restart must succeed");
    assert.deepEqual(terminated, [100], "exactly one process — the proven owner — may be terminated");
    assert.equal(started, true);
    assert.equal(result.ok === true && result.newPid, 101);
  });

  await scenario("restart reports collateral loss when a protected process dies", () => {
    const result = restartAyasOwnedService(
      { port: 3000, expectedCommandContains: ["next"], protectedPids: [200] },
      { portProbe: () => 100, commandProbe: () => "node next start -p 3000", terminate: () => undefined, start: () => undefined, waitForPort: () => 101, isProcessAlive: () => false },
    );
    assert.equal(result.ok === false && result.reasonCode, "COLLATERAL_PROCESS_LOST");
  });

  await scenario("restart reports a failure to come back up rather than claiming success", () => {
    const result = restartAyasOwnedService(
      { port: 3000, expectedCommandContains: ["next"] },
      { portProbe: () => 100, commandProbe: () => "node next start -p 3000", terminate: () => undefined, start: () => undefined, waitForPort: () => undefined },
    );
    assert.equal(result.ok === false && result.reasonCode, "PORT_NOT_RECLAIMED");
    assert.equal(result.ok === false && result.terminated, true, "the caller must learn the old process is already gone");
  });

  await scenario("ownership resolution returns undefined when nothing is listening", () => {
    assert.equal(resolveAyasServiceOwnership(3000, { portProbe: () => undefined }), undefined);
    assert.equal(resolveAyasServiceOwnership(3000, { portProbe: () => 5, commandProbe: () => undefined }), undefined, "an unreadable command line is unproven ownership");
  });

  // ------------------------------------------------------------- transaction
  await scenario("transaction rejects an illegal state transition", () => {
    const store = createAyasStabilityTransactionStore({ rootDir: tmpRoot("illegal"), pid: 4242 });
    const transaction = store.begin("op", declareAyasRuntimeImpactScope("op", ["service"], [3000]), snapshot());
    assert.throws(() => store.transition(transaction.transactionId, "COMPLETED"), (error: unknown) => error instanceof AyasStabilityTransactionError && error.code === "ILLEGAL_TRANSITION", "PREPARED must not jump straight to COMPLETED");
    store.transition(transaction.transactionId, "APPLYING");
    store.transition(transaction.transactionId, "VERIFYING");
    const completed = store.transition(transaction.transactionId, "COMPLETED");
    assert.equal(completed.state, "COMPLETED");
    assert.throws(() => store.transition(transaction.transactionId, "APPLYING"), (error: unknown) => error instanceof AyasStabilityTransactionError && error.code === "ILLEGAL_TRANSITION", "a terminal transaction is never re-decidable");
  });

  await scenario("an interrupted PREPARED transaction recovers deterministically as ABANDONED", () => {
    const root = tmpRoot("recover-prepared");
    const store = createAyasStabilityTransactionStore({ rootDir: root, pid: 777 });
    const transaction = store.begin("op", declareAyasRuntimeImpactScope("op", ["service"], [3000]), snapshot());
    const first = recoverInterruptedAyasStabilityTransactions({ store, currentPid: 999, isProcessAlive: () => false });
    assert.equal(first.length, 1);
    assert.equal(first[0]?.recoveredState, "ABANDONED", "nothing could have been mutated before APPLYING");
    assert.equal(store.get(transaction.transactionId)?.state, "ABANDONED");
    const second = recoverInterruptedAyasStabilityTransactions({ store, currentPid: 999, isProcessAlive: () => false });
    assert.equal(second.length, 0, "recovery is idempotent — a terminal transaction is never re-recovered");
  });

  await scenario("an interrupted APPLYING transaction recovers as RECOVERY_REQUIRED, never auto-continued", () => {
    const store = createAyasStabilityTransactionStore({ rootDir: tmpRoot("recover-applying"), pid: 777 });
    const transaction = store.begin("op", declareAyasRuntimeImpactScope("op", ["runtime-config"]), snapshot());
    store.transition(transaction.transactionId, "APPLYING");
    const outcomes = recoverInterruptedAyasStabilityTransactions({ store, currentPid: 999, isProcessAlive: () => false });
    assert.equal(outcomes[0]?.recoveredState, "RECOVERY_REQUIRED", "a possibly-half-applied change must never be auto-resolved");
    assert.equal(store.get(transaction.transactionId)?.state, "RECOVERY_REQUIRED");
  });

  await scenario("a transaction owned by a live process is left alone", () => {
    const store = createAyasStabilityTransactionStore({ rootDir: tmpRoot("recover-live"), pid: 777 });
    const transaction = store.begin("op", declareAyasRuntimeImpactScope("op", ["service"], [3000]), snapshot());
    store.transition(transaction.transactionId, "APPLYING");
    assert.equal(recoverInterruptedAyasStabilityTransactions({ store, currentPid: 999, isProcessAlive: () => true }).length, 0, "another live owner must not have its transaction stolen");
    assert.equal(recoverInterruptedAyasStabilityTransactions({ store, currentPid: 777, isProcessAlive: () => false }).length, 0, "our own in-flight transaction must not be recovered out from under us");
  });

  await scenario("a corrupt ledger fails closed instead of silently reporting no history", () => {
    const root = tmpRoot("corrupt");
    fs.writeFileSync(path.join(root, "stability-transactions.json"), "{not json", "utf8");
    const store = createAyasStabilityTransactionStore({ rootDir: root });
    assert.throws(() => store.load(), (error: unknown) => error instanceof AyasStabilityTransactionError && error.code === "STORE_CORRUPT");
  });

  // ------------------------------------------------------------ orchestration
  const guardScope = declareAyasRuntimeImpactScope("runtime-config-change", ["runtime-config"], []);

  await scenario("a healthy controlled operation completes and is durably COMPLETED", async () => {
    const store = createAyasStabilityTransactionStore({ rootDir: tmpRoot("guard-ok"), pid: 1 });
    let gateEnabled = false;
    const outcome = await runAyasControlledOperation<string>({
      operation: "enable-gate",
      scope: guardScope,
      apply: () => { gateEnabled = true; return "applied"; },
      expectations: () => ({ expectAutonomousExecutionEnabled: true, requireSchedulerOperational: true }),
    }, {
      store,
      captureSnapshot: () => (gateEnabled ? snapshot() : snapshot({ gate: { autonomousExecutionEnabled: false, ownerApprovalRequired: true } })),
    });
    assert.equal(outcome.ok, true, `expected COMPLETED, got ${outcome.state}: ${outcome.ok === false ? outcome.reasons.join(" | ") : ""}`);
    assert.equal(outcome.state, "COMPLETED");
    assert.equal(outcome.ok === true && outcome.value, "applied");
    assert.equal(store.get(outcome.ok === true ? outcome.transaction.transactionId : "")?.state, "COMPLETED");
  });

  await scenario("a post-change health failure triggers rollback and ends ROLLED_BACK", async () => {
    const store = createAyasStabilityTransactionStore({ rootDir: tmpRoot("guard-rollback"), pid: 1 });
    let applied = false;
    let rolledBack = false;
    const outcome = await runAyasControlledOperation<string>({
      operation: "bad-change",
      scope: guardScope,
      apply: () => { applied = true; return "applied"; },
      // Expect the gate ON, but the snapshot will report it OFF — a health failure.
      expectations: () => ({ expectAutonomousExecutionEnabled: true }),
      rollback: () => { rolledBack = true; applied = false; },
    }, {
      store,
      captureSnapshot: () => snapshot({ gate: { autonomousExecutionEnabled: false, ownerApprovalRequired: true } }),
    });
    assert.equal(outcome.ok, false);
    assert.equal(outcome.state, "ROLLED_BACK");
    assert.equal(rolledBack, true, "a failed invariant must trigger the caller's rollback");
    assert.equal(applied, false, "rollback must actually undo the change");
    assert.equal(outcome.ok === false && outcome.state === "ROLLED_BACK" && outcome.transaction.rollbackPerformed, true);
  });

  await scenario("a failure with no rollback available ends RECOVERY_REQUIRED, never a silent pass", async () => {
    const store = createAyasStabilityTransactionStore({ rootDir: tmpRoot("guard-norollback"), pid: 1 });
    const outcome = await runAyasControlledOperation<string>({
      operation: "unrecoverable",
      scope: guardScope,
      apply: () => "applied",
      expectations: () => ({ expectAutonomousExecutionEnabled: false }),
    }, { store, captureSnapshot: () => snapshot() });
    assert.equal(outcome.state, "RECOVERY_REQUIRED");
    assert.equal(outcome.ok, false);
  });

  await scenario("a dirty repo fail-closes before anything is applied", async () => {
    const store = createAyasStabilityTransactionStore({ rootDir: tmpRoot("guard-dirty"), pid: 1 });
    let applied = false;
    const outcome = await runAyasControlledOperation<string>({
      operation: "mutation",
      scope: guardScope,
      preconditions: baselineAyasPreconditions({ requireCleanRepo: true }),
      apply: () => { applied = true; return "applied"; },
    }, { store, captureSnapshot: () => snapshot({ repo: { branch: "wip/guard", head: "a".repeat(40), clean: false, dirtyEntryCount: 3 } }) });
    assert.equal(outcome.state, "REFUSED");
    assert.equal(applied, false, "a refused operation must never reach apply()");
    assert.equal(store.load().transactions.length, 0, "a refused operation must not open a transaction at all");
  });

  await scenario("a stale HEAD and an in-flight research run both fail-close", async () => {
    const store = createAyasStabilityTransactionStore({ rootDir: tmpRoot("guard-stale"), pid: 1 });
    const staleHead = await runAyasControlledOperation<string>({
      operation: "mutation", scope: guardScope,
      preconditions: baselineAyasPreconditions({ requireExpectedHead: "b".repeat(40) }),
      apply: () => assert.fail("must not apply against an unexpected HEAD"),
    }, { store, captureSnapshot: () => snapshot() });
    assert.equal(staleHead.state, "REFUSED");

    const running = await runAyasControlledOperation<string>({
      operation: "restart", scope: guardScope,
      preconditions: baselineAyasPreconditions({ refuseWhileResearchRunning: true }),
      apply: () => assert.fail("must not restart mid research run"),
    }, { store, captureSnapshot: () => snapshot({ scheduler: { consecutiveFailures: 0, runInFlight: true, stateFilePresent: true, nextLightAt: "x", nextDeepAt: "y" } }) });
    assert.equal(running.state, "REFUSED");
  });

  await scenario("runtime root movement fails closed (storage-authority leakage)", async () => {
    const store = createAyasStabilityTransactionStore({ rootDir: tmpRoot("guard-root"), pid: 1 });
    let call = 0;
    const outcome = await runAyasControlledOperation<string>({
      operation: "config", scope: declareAyasRuntimeImpactScope("config", ["runtime-config"]),
      apply: () => "applied",
      rollback: () => undefined,
    }, { store, captureSnapshot: () => (call++ === 0 ? snapshot() : snapshot({ runtimeRootFingerprint: "moved-elsewhere" })) });
    assert.equal(outcome.state, "ROLLED_BACK", "a runtime storage root that moves mid-operation must roll back");
    assert.ok(outcome.ok === false && outcome.reasons.join(" ").includes("runtime-root"));
  });

  await scenario("an apply() that throws rolls back and never reports success", async () => {
    const store = createAyasStabilityTransactionStore({ rootDir: tmpRoot("guard-throw"), pid: 1 });
    let rolledBack = false;
    const outcome = await runAyasControlledOperation<string>({
      operation: "throwing", scope: guardScope,
      apply: () => { throw new Error("restart failed after config mutation"); },
      rollback: () => { rolledBack = true; },
    }, { store, captureSnapshot: () => snapshot() });
    assert.equal(outcome.state, "ROLLED_BACK");
    assert.equal(rolledBack, true, "a mid-apply crash must restore the previous safe state");
    assert.ok(outcome.ok === false && outcome.reasons[0]?.includes("apply failed"));
  });

  await scenario("a retried operation opens a new transaction and never double-executes", async () => {
    const store = createAyasStabilityTransactionStore({ rootDir: tmpRoot("guard-retry"), pid: 1 });
    let applyCount = 0;
    const operation = {
      operation: "retryable", scope: guardScope,
      apply: () => { applyCount += 1; return "applied"; },
      expectations: () => ({ expectAutonomousExecutionEnabled: true }),
      rollback: () => undefined,
    };
    const first = await runAyasControlledOperation<string>(operation, { store, captureSnapshot: () => snapshot() });
    const second = await runAyasControlledOperation<string>(operation, { store, captureSnapshot: () => snapshot() });
    assert.equal(first.state, "COMPLETED");
    assert.equal(second.state, "COMPLETED");
    assert.equal(applyCount, 2, "each controlled run applies exactly once");
    const log = store.load();
    assert.equal(log.transactions.length, 2, "each run is its own durable transaction");
    assert.equal(new Set(log.transactions.map((entry) => entry.transactionId)).size, 2, "transaction ids are never reused");
    assert.equal(log.transactions.every((entry) => entry.state === "COMPLETED"), true);
  });

  console.log(`PASS (${scenarios} scenarios)`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
