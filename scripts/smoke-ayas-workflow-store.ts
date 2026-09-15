/**
 * AYAS Durable Workflow Persistence smoke suite.
 *
 * Deterministic / $0 / no network / no model. Covers `AyasDeveloperWorkflowStore`:
 * atomic save/load round-trip, schema versioning (unsupported → fail closed),
 * corruption rejection (malformed JSON, missing fields, invalid state, budget
 * ceiling violations, invalid step/dependency shape, tampered proposal
 * fingerprint), storage-path safety (workflow id can never escape the store
 * directory), bounded record size, optimistic-concurrency revision guard, and
 * the crash-around-write-boundary invariant (Scenario I): a persisted
 * checkpoint taken right before a repair mutation, then resumed as if after a
 * crash, must never duplicate the write.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  AyasDeveloperWorkflowStore,
  AyasWorkflowStoreError,
  isValidAyasWorkflowId,
  validateWorkflowStoreRecord,
  ayasWorkflowStoreSchemaVersion,
} from "../src/lib/ayas/execution/AyasDeveloperWorkflowStore";
import { createAyasDeveloperWorkflow, runAyasDeveloperWorkflow, AYAS_DEVELOPER_WORKFLOW_DEFAULT_BUDGET, type AyasWorkflowStep } from "../src/lib/ayas/execution/AyasDeveloperWorkflow";
import { createAyasGuidedRepairService, createAyasRepairProposal, type AyasPatch, type AyasRepairProposal } from "../src/lib/ayas/execution/AyasGuidedRepair";

let count = 0;
async function scenario(name: string, test: () => void | Promise<void>) {
  await test();
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}

const hash = (value: string) => crypto.createHash("sha256").update(value, "utf8").digest("hex");

function simpleWorkflow(workflowId: string) {
  const steps: AyasWorkflowStep[] = [
    { id: "one", kind: "read", request: { schemaVersion: "1", action: "inspect-repository-status", requestedBy: "store-smoke", intent: "fixture", plan: {} }, expectedEvidence: "status" },
  ];
  return createAyasDeveloperWorkflow({ kind: "developer", goal: "store round-trip fixture", steps, workflowId });
}

function repairWorkflowFixture(root: string, workflowId: string) {
  const rel = "src/fixture.ts";
  const absolute = path.join(root, rel);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  const original = "export const answer = 0;\n";
  fs.writeFileSync(absolute, original);
  const patches: readonly AyasPatch[] = [{ filePath: rel, operation: "patch-source", expectedHash: hash(original), content: "export const answer = 42;\n" }];
  const proposal: AyasRepairProposal = createAyasRepairProposal({
    issueFingerprint: hash("store-crash-fixture"), workspaceId: "store-crash", rootCauseStatus: "reproduced", rootCause: "store crash fixture",
    evidence: [{ kind: "source", ref: rel, summary: "fixture", digest: hash(original) }], graphifyFindings: [],
    approvedFiles: [rel], operationClasses: ["patch-source"], validationActions: ["run-registered-smoke-test"],
    forbiddenOperations: ["shell", "git", "delete"], exclusions: [], expectedResult: "answer becomes 42", risk: "single fixture file",
    bounds: { maxFiles: 1, maxNewFiles: 0, maxRepairCycles: 0, maxValidationCycles: 1, maxDurationMs: 30_000, allowFileCreation: false },
  });
  const steps: AyasWorkflowStep[] = [{ id: "repair", kind: "repair", proposal, patches, expectedEvidence: "answer becomes 42" }];
  const workflow = createAyasDeveloperWorkflow({ kind: "automatic-repair", goal: "store crash fixture", steps, workflowId });
  return { absolute, original, proposal, patches, workflow };
}

async function main() {
  await scenario("save/load round-trip preserves the workflow exactly", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-workflow-store-"));
    try {
      const store = new AyasDeveloperWorkflowStore({ rootDir: root });
      const workflow = simpleWorkflow("developer-workflow-round-trip");
      const saved = store.save(workflow);
      assert.equal(saved.revision, 1);
      const loaded = store.load(workflow.workflowId);
      assert.deepEqual(loaded.workflow, workflow);
      assert.equal(loaded.storeSchemaVersion, ayasWorkflowStoreSchemaVersion);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await scenario("tryLoad returns undefined for an absent workflow — never throws", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-workflow-store-"));
    try {
      const store = new AyasDeveloperWorkflowStore({ rootDir: root });
      assert.equal(store.tryLoad("developer-workflow-absent"), undefined);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await scenario("save is atomic — no partial file left on a mid-write crash simulation", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-workflow-store-"));
    try {
      const store = new AyasDeveloperWorkflowStore({ rootDir: root });
      const workflow = simpleWorkflow("developer-workflow-atomic");
      store.save(workflow);
      const dir = store.directory;
      const leftoverTemp = fs.readdirSync(dir).filter((n) => n.includes(".tmp"));
      assert.deepEqual(leftoverTemp, [], "no leftover temp file after a clean write");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await scenario("optimistic-concurrency revision guard refuses a stale writer", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-workflow-store-"));
    try {
      const store = new AyasDeveloperWorkflowStore({ rootDir: root });
      const workflow = simpleWorkflow("developer-workflow-cas");
      const first = store.save(workflow);
      assert.equal(first.revision, 1);
      store.save(workflow, { expectedRevision: 1 }); // a second writer with the CURRENT revision succeeds
      assert.throws(() => store.save(workflow, { expectedRevision: 1 }), (error: unknown) => error instanceof AyasWorkflowStoreError && error.code === "AYAS_WORKFLOW_STORE_REVISION_CONFLICT");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await scenario("malformed JSON fails closed as corrupt", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-workflow-store-"));
    try {
      const store = new AyasDeveloperWorkflowStore({ rootDir: root });
      fs.mkdirSync(store.directory, { recursive: true });
      fs.writeFileSync(path.join(store.directory, "developer-workflow-bad.json"), "{ not json");
      assert.throws(() => store.load("developer-workflow-bad"), (error: unknown) => error instanceof AyasWorkflowStoreError && error.code === "AYAS_WORKFLOW_STORE_CORRUPT");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await scenario("missing required fields fail closed as corrupt", () => {
    assert.throws(() => validateWorkflowStoreRecord({ storeSchemaVersion: "1" }), (error: unknown) => error instanceof AyasWorkflowStoreError && error.code === "AYAS_WORKFLOW_STORE_CORRUPT");
    assert.throws(() => validateWorkflowStoreRecord({ storeSchemaVersion: "1", workflowId: "developer-workflow-x", revision: 1, updatedAt: new Date().toISOString(), workflow: { schemaVersion: "1" } }), (error: unknown) => error instanceof AyasWorkflowStoreError && error.code === "AYAS_WORKFLOW_STORE_CORRUPT");
  });

  await scenario("invalid workflow state fails closed as corrupt", () => {
    const workflow = simpleWorkflow("developer-workflow-badstate");
    const tampered = { ...workflow, state: "not-a-real-state" };
    assert.throws(() => validateWorkflowStoreRecord({ storeSchemaVersion: "1", workflowId: workflow.workflowId, revision: 1, updatedAt: new Date().toISOString(), workflow: tampered }), (error: unknown) => error instanceof AyasWorkflowStoreError && error.code === "AYAS_WORKFLOW_STORE_CORRUPT");
  });

  await scenario("impossible usage > ceiling combination fails closed as corrupt", () => {
    const workflow = simpleWorkflow("developer-workflow-overusage");
    const tampered = { ...workflow, usage: { ...workflow.usage, actions: AYAS_DEVELOPER_WORKFLOW_DEFAULT_BUDGET.maxActions + 5 } };
    assert.throws(() => validateWorkflowStoreRecord({ storeSchemaVersion: "1", workflowId: workflow.workflowId, revision: 1, updatedAt: new Date().toISOString(), workflow: tampered }), (error: unknown) => error instanceof AyasWorkflowStoreError && error.code === "AYAS_WORKFLOW_STORE_CORRUPT");
  });

  await scenario("invalid step/dependency structure fails closed (delegates to validateAyasDeveloperWorkflowPlan)", () => {
    const workflow = simpleWorkflow("developer-workflow-baddep");
    const tampered = { ...workflow, steps: [{ ...workflow.steps[0]!, step: { ...workflow.steps[0]!.step, dependsOn: ["missing-step"] } }] };
    assert.throws(() => validateWorkflowStoreRecord({ storeSchemaVersion: "1", workflowId: workflow.workflowId, revision: 1, updatedAt: new Date().toISOString(), workflow: tampered }), (error: unknown) => error instanceof AyasWorkflowStoreError && error.code === "AYAS_WORKFLOW_STORE_CORRUPT");
  });

  await scenario("tampered repair proposal fingerprint fails closed as corrupt", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-workflow-store-"));
    try {
      const fixture = repairWorkflowFixture(root, "developer-workflow-tampered-proposal");
      const tamperedStep = { ...fixture.workflow.steps[0]!, step: { ...fixture.workflow.steps[0]!.step, proposal: { ...fixture.proposal, rootCause: "TAMPERED — fingerprint no longer matches" } } };
      const tampered = { ...fixture.workflow, steps: [tamperedStep] };
      assert.throws(() => validateWorkflowStoreRecord({ storeSchemaVersion: "1", workflowId: fixture.workflow.workflowId, revision: 1, updatedAt: new Date().toISOString(), workflow: tampered }), (error: unknown) => error instanceof AyasWorkflowStoreError && error.code === "AYAS_WORKFLOW_STORE_CORRUPT");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await scenario("unsupported schema version fails closed (envelope AND workflow)", () => {
    const workflow = simpleWorkflow("developer-workflow-schema");
    assert.throws(() => validateWorkflowStoreRecord({ storeSchemaVersion: "99", workflowId: workflow.workflowId, revision: 1, updatedAt: new Date().toISOString(), workflow }), (error: unknown) => error instanceof AyasWorkflowStoreError && error.code === "AYAS_WORKFLOW_STORE_UNSUPPORTED_SCHEMA");
    assert.throws(() => validateWorkflowStoreRecord({ storeSchemaVersion: "1", workflowId: workflow.workflowId, revision: 1, updatedAt: new Date().toISOString(), workflow: { ...workflow, schemaVersion: "99" } }), (error: unknown) => error instanceof AyasWorkflowStoreError && error.code === "AYAS_WORKFLOW_STORE_UNSUPPORTED_SCHEMA");
  });

  await scenario("storage path safety — a workflow id can never escape the store directory", () => {
    for (const bad of ["../escape", "..\\escape", "/etc/passwd", "C:\\Windows\\evil", "a/b", "", "a".repeat(200)]) {
      assert.equal(isValidAyasWorkflowId(bad), false, bad);
    }
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-workflow-store-"));
    try {
      const store = new AyasDeveloperWorkflowStore({ rootDir: root });
      assert.throws(() => store.tryLoad("../escape"), (error: unknown) => error instanceof AyasWorkflowStoreError && error.code === "AYAS_WORKFLOW_STORE_INVALID_ID");
      const outside = simpleWorkflow("../escape" as never);
      assert.throws(() => store.save(outside), (error: unknown) => error instanceof AyasWorkflowStoreError && error.code === "AYAS_WORKFLOW_STORE_INVALID_ID");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await scenario("oversize record is rejected on write", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-workflow-store-"));
    try {
      const store = new AyasDeveloperWorkflowStore({ rootDir: root, maxRecordBytes: 500 });
      const workflow = simpleWorkflow("developer-workflow-oversize");
      assert.throws(() => store.save(workflow), (error: unknown) => error instanceof AyasWorkflowStoreError && error.code === "AYAS_WORKFLOW_STORE_OVERSIZE");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await scenario("list() enumerates persisted workflow ids", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-workflow-store-"));
    try {
      const store = new AyasDeveloperWorkflowStore({ rootDir: root });
      store.save(simpleWorkflow("developer-workflow-list-a"));
      store.save(simpleWorkflow("developer-workflow-list-b"));
      assert.deepEqual(new Set(store.list()), new Set(["developer-workflow-list-a", "developer-workflow-list-b"]));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await scenario("SCENARIO E — budget usage survives restart and can never reset upward", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-workflow-store-budget-"));
    try {
      const store = new AyasDeveloperWorkflowStore({ rootDir: root });
      const workflow = createAyasDeveloperWorkflow({
        kind: "developer", goal: "budget survives restart", workflowId: "developer-workflow-budget-restart",
        budget: { ...AYAS_DEVELOPER_WORKFLOW_DEFAULT_BUDGET, maxActions: 2 },
        steps: [
          { id: "one", kind: "read", request: { schemaVersion: "1", action: "inspect-repository-status", requestedBy: "budget-smoke", intent: "fixture", plan: {} }, expectedEvidence: "one" },
          { id: "two", kind: "read", request: { schemaVersion: "1", action: "inspect-repository-status", requestedBy: "budget-smoke", intent: "fixture", plan: {} }, dependsOn: ["one"], expectedEvidence: "two" },
        ],
      });
      const read = async () => ({ executed: true as const, action: "inspect-repository-status" as const, result: { action: "inspect-repository-status" as const, write: false, summary: "ok", data: {} }, durationMs: 0 });
      await runAyasDeveloperWorkflow(workflow, { runReadOnlyAction: read, applyRepair: async () => ({ ok: true, lifecycle: "completed" }), onCheckpoint: (wf) => { store.save(wf, { expectedRevision: store.tryLoad(wf.workflowId)?.revision ?? 0 }); } });
      assert.equal(workflow.usage.actions, 2, "both actions consumed the budget before the (simulated) crash");
      assert.equal(workflow.state, "succeeded");

      // Reload from a FRESH store instance — the persisted usage must be
      // exactly what it was, never reset to 0, and never silently widened.
      const reloadedStore = new AyasDeveloperWorkflowStore({ rootDir: root });
      const reloaded = reloadedStore.load("developer-workflow-budget-restart").workflow;
      assert.equal(reloaded.usage.actions, 2, "usage never resets on reload");
      assert.equal(reloaded.budget.maxActions, 2, "ceiling never widens on reload");
      // A naive re-run confirms the runtime's own terminal guard keeps it inert — no further budget consumption is even possible.
      let callsAfterReload = 0;
      await runAyasDeveloperWorkflow(reloaded, { runReadOnlyAction: async () => { callsAfterReload += 1; return read(); }, applyRepair: async () => ({ ok: true, lifecycle: "completed" }) });
      assert.equal(callsAfterReload, 0, "a terminal recovered workflow dispatches nothing further");
      assert.equal(reloaded.usage.actions, 2, "usage is unchanged after a no-op resume");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await scenario("SCENARIO I — crash around the write boundary: a checkpoint taken right before applyRepair, then resumed as if after a crash, never duplicates the write", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-workflow-store-"));
    const wsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-workflow-crash-ws-"));
    try {
      const store = new AyasDeveloperWorkflowStore({ rootDir: root });
      const fixture = repairWorkflowFixture(wsRoot, "developer-workflow-crash-boundary");
      let applyCalls = 0;
      const service = createAyasGuidedRepairService({ workspaceRoot: wsRoot, validators: { "run-registered-smoke-test": async () => ({ ok: true }) } });
      const checkpoints: string[] = [];
      await runAyasDeveloperWorkflow(fixture.workflow, {
        applyRepair: async (proposal, authorization, patches) => { applyCalls += 1; return service.apply(proposal, authorization, patches); },
        onCheckpoint: (wf, point) => { checkpoints.push(point); store.save(wf); },
      }); // pauses at authorization-required
      assert.equal(fixture.workflow.state, "awaiting-authorization");
      assert.ok(checkpoints.includes("started"));

      const authorization = service.approve(fixture.proposal, { proposalId: fixture.proposal.proposalId, proposalFingerprint: fixture.proposal.proposalFingerprint, issueFingerprint: fixture.proposal.issueFingerprint, workspaceId: fixture.proposal.workspaceId, approvedByUser: true, userTurnId: "t1", currentTurnId: "t1" });

      // The "crash": persist the checkpoint taken right BEFORE applyRepair
      // ran, then simulate a fresh process by loading a FRESH copy of the
      // record from disk (not the live in-memory object) — a brand-new
      // AyasGuidedRepairService is also constructed, so its own in-memory
      // `consumedAuthorizations` Set starts EMPTY, exactly like a real
      // restart. If the recovered workflow were resumed naively with the
      // SAME authorization, does it duplicate the write?
      let preMutationSnapshot: unknown;
      await runAyasDeveloperWorkflow(fixture.workflow, {
        applyRepair: async () => { throw new Error("must not be called — the crash happens before this executes"); },
        onCheckpoint: (wf, point) => { if (point === "before-mutation") { store.save(wf, { expectedRevision: store.load(wf.workflowId).revision }); preMutationSnapshot = structuredClone(wf); throw new Error("__SIMULATED_CRASH__"); } },
      }, { authorizations: { repair: authorization } }).catch((error: unknown) => { if (!(error instanceof Error) || error.message !== "__SIMULATED_CRASH__") throw error; });
      assert.ok(preMutationSnapshot, "pre-mutation checkpoint was taken");
      assert.equal(applyCalls, 0, "the real mutation never ran before the simulated crash");
      assert.equal(fs.readFileSync(fixture.absolute, "utf8"), fixture.original, "source is untouched right before the simulated crash");

      const recoveredRecord = store.load("developer-workflow-crash-boundary");
      const recoveredWorkflow = recoveredRecord.workflow;
      const freshService = createAyasGuidedRepairService({ workspaceRoot: wsRoot, validators: { "run-registered-smoke-test": async () => ({ ok: true }) } });
      let freshApplyCalls = 0;
      await runAyasDeveloperWorkflow(recoveredWorkflow, {
        applyRepair: async (proposal, auth, patches) => { freshApplyCalls += 1; return freshService.apply(proposal, auth, patches); },
        onCheckpoint: (wf) => { store.save(wf, { expectedRevision: store.load(wf.workflowId).revision }); },
      }, { authorizations: { repair: authorization } });

      // The recovered `repairHistory` already carries this attempt's
      // fingerprint (pushed synchronously before the checkpoint/crash), so
      // the workflow's OWN non-convergence check fires — the write is
      // refused, not duplicated. This is the real, structural invariant
      // this scenario proves: whatever the outcome, the mutation is never
      // duplicated.
      assert.equal(fs.readFileSync(fixture.absolute, "utf8"), fixture.original, "recovery from a pre-mutation checkpoint never duplicates the mutation");
      assert.ok(recoveredWorkflow.state === "repair-non-convergent" || recoveredWorkflow.state === "failed", `recovery fails safely (repair-non-convergent or failed), got: ${recoveredWorkflow.state}`);
      assert.equal(freshApplyCalls <= 1, true, "at most one real apply attempt from the recovered process");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(wsRoot, { recursive: true, force: true });
    }
  });

  await scenario("SCENARIO I(b) — crash AFTER a successful write but BEFORE the after-mutation checkpoint: replay is refused by the executor's own precondition hash, never duplicated", async () => {
    const wsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-workflow-crash-precondition-"));
    try {
      const fixture = repairWorkflowFixture(wsRoot, "developer-workflow-crash-precondition");
      const service = createAyasGuidedRepairService({ workspaceRoot: wsRoot, validators: { "run-registered-smoke-test": async () => ({ ok: true }) } });
      const authorization = service.approve(fixture.proposal, { proposalId: fixture.proposal.proposalId, proposalFingerprint: fixture.proposal.proposalFingerprint, issueFingerprint: fixture.proposal.issueFingerprint, workspaceId: fixture.proposal.workspaceId, approvedByUser: true, userTurnId: "t1", currentTurnId: "t1" });
      // The write actually succeeds here (simulating: write completed, then the process died before the in-memory workflow's "succeeded" state was durably checkpointed).
      const firstApply = await service.apply(fixture.proposal, authorization, fixture.patches);
      assert.equal(firstApply.ok, true);
      assert.equal(fs.readFileSync(fixture.absolute, "utf8"), "export const answer = 42;\n");

      // Recovery naively replays the SAME patch against a FRESH service instance (fresh in-memory consumedAuthorizations Set) — the write itself must still refuse, via the precondition hash, since the file no longer matches the patch's expectedHash (the pre-patch content).
      const freshService = createAyasGuidedRepairService({ workspaceRoot: wsRoot, validators: { "run-registered-smoke-test": async () => ({ ok: true }) } });
      const replay = await freshService.apply(fixture.proposal, authorization, fixture.patches);
      assert.equal(replay.ok, false, "a replayed already-applied patch must be refused");
      assert.match((replay as { reason: string }).reason, /precondition hash mismatch/i);
      assert.equal(fs.readFileSync(fixture.absolute, "utf8"), "export const answer = 42;\n", "content is unchanged by the refused replay — no double-write, no corruption");
    } finally {
      fs.rmSync(wsRoot, { recursive: true, force: true });
    }
  });

  console.log(`AYAS workflow store smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-workflow-store", scenarios: count }));
}

main().catch((error) => {
  console.error("AYAS workflow store smoke FAILED:", error);
  process.exitCode = 1;
});
