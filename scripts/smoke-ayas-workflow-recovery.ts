/**
 * AYAS Workflow Recovery smoke suite.
 *
 * Deterministic / $0 / no network / no model. Covers `classifyAyasWorkflowRecovery`
 * / `findAyasStaleRepairSteps`: every classification (recoverable,
 * awaiting-authorization, terminal, stale, corrupt, unsupported-schema,
 * blocked), and the two end-to-end product scenarios that hinge on it —
 * Scenario D (stale source after restart → zero mutation) and Scenario F
 * (terminal workflow restart → zero additional action).
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { classifyAyasWorkflowRecovery, findAyasStaleRepairSteps } from "../src/lib/ayas/execution/AyasWorkflowRecovery";
import { createAyasDeveloperWorkflow, runAyasDeveloperWorkflow, type AyasWorkflowStep } from "../src/lib/ayas/execution/AyasDeveloperWorkflow";
import { createAyasGuidedRepairService, createAyasRepairProposal, type AyasPatch, type AyasRepairProposal } from "../src/lib/ayas/execution/AyasGuidedRepair";
import { AyasDeveloperWorkflowStore } from "../src/lib/ayas/execution/AyasDeveloperWorkflowStore";

let count = 0;
async function scenario(name: string, test: () => void | Promise<void>) {
  await test();
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}

const hash = (value: string) => crypto.createHash("sha256").update(value, "utf8").digest("hex");

function simpleWorkflow(): AyasWorkflowStep[] {
  return [{ id: "one", kind: "read", request: { schemaVersion: "1", action: "inspect-repository-status", requestedBy: "recovery-smoke", intent: "fixture", plan: {} }, expectedEvidence: "status" }];
}

function repairFixture(root: string, workflowId: string) {
  const rel = "src/fixture.ts";
  const absolute = path.join(root, rel);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  const original = "export const answer = 0;\n";
  fs.writeFileSync(absolute, original);
  const patches: readonly AyasPatch[] = [{ filePath: rel, operation: "patch-source", expectedHash: hash(original), content: "export const answer = 42;\n" }];
  const proposal: AyasRepairProposal = createAyasRepairProposal({
    issueFingerprint: hash("recovery-fixture"), workspaceId: "recovery", rootCauseStatus: "reproduced", rootCause: "recovery fixture",
    evidence: [{ kind: "source", ref: rel, summary: "fixture", digest: hash(original) }], graphifyFindings: [],
    approvedFiles: [rel], operationClasses: ["patch-source"], validationActions: ["run-registered-smoke-test"],
    forbiddenOperations: ["shell", "git", "delete"], exclusions: [], expectedResult: "answer becomes 42", risk: "single fixture file",
    bounds: { maxFiles: 1, maxNewFiles: 0, maxRepairCycles: 0, maxValidationCycles: 1, maxDurationMs: 30_000, allowFileCreation: false },
  });
  const steps: AyasWorkflowStep[] = [{ id: "repair", kind: "repair", proposal, patches, expectedEvidence: "answer becomes 42" }];
  const workflow = createAyasDeveloperWorkflow({ kind: "automatic-repair", goal: "recovery fixture", steps, workflowId });
  return { absolute, original, proposal, patches, workflow };
}

async function main() {
  await scenario("recoverable — a plan-only workflow with no pending repair is safe to resume", () => {
    const workflow = createAyasDeveloperWorkflow({ kind: "developer", goal: "recoverable fixture", steps: simpleWorkflow(), workflowId: "developer-workflow-recoverable" });
    const result = classifyAyasWorkflowRecovery({ workflow });
    assert.equal(result.classification, "recoverable");
  });

  await scenario("awaiting-authorization — recovered workflow still shows as awaiting authorization, not silently continued", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-recovery-"));
    try {
      const fixture = repairFixture(root, "developer-workflow-awaiting");
      const service = createAyasGuidedRepairService({ workspaceRoot: root });
      await runAyasDeveloperWorkflow(fixture.workflow, { applyRepair: service.apply });
      assert.equal(fixture.workflow.state, "awaiting-authorization");
      const result = classifyAyasWorkflowRecovery({ workflow: fixture.workflow, workspaceRoot: root });
      assert.equal(result.classification, "awaiting-authorization");
      assert.equal(fs.readFileSync(fixture.absolute, "utf8"), fixture.original, "classification alone performs zero mutation");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await scenario("terminal — a succeeded workflow classifies as terminal, never re-actioned (SCENARIO F)", () => {
    const workflow = createAyasDeveloperWorkflow({ kind: "developer", goal: "terminal fixture", steps: simpleWorkflow(), workflowId: "developer-workflow-terminal" });
    workflow.state = "succeeded"; // simulating a persisted, already-terminal workflow
    const result = classifyAyasWorkflowRecovery({ workflow });
    assert.equal(result.classification, "terminal");
    assert.equal(result.detail.includes("succeeded"), true);
  });
  for (const state of ["failed", "rejected", "budget-exhausted", "repair-non-convergent", "cancelled"] as const) {
    await scenario(`terminal — ${state} also classifies as terminal`, () => {
      const workflow = createAyasDeveloperWorkflow({ kind: "developer", goal: "terminal fixture", steps: simpleWorkflow(), workflowId: `developer-workflow-terminal-${state}` });
      workflow.state = state;
      assert.equal(classifyAyasWorkflowRecovery({ workflow }).classification, "terminal");
    });
  }

  await scenario("SCENARIO F (full) — a persisted succeeded workflow, reloaded and re-run, dispatches zero additional actions", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-recovery-store-"));
    try {
      const store = new AyasDeveloperWorkflowStore({ rootDir: root });
      const workflow = createAyasDeveloperWorkflow({ kind: "developer", goal: "terminal reload", steps: simpleWorkflow(), workflowId: "developer-workflow-terminal-reload" });
      let calls = 0;
      const read = async () => { calls += 1; return { executed: true as const, action: "inspect-repository-status" as const, result: { action: "inspect-repository-status" as const, write: false, summary: "ok", data: {} }, durationMs: 0 }; };
      await runAyasDeveloperWorkflow(workflow, { runReadOnlyAction: read, applyRepair: async () => ({ ok: true, lifecycle: "completed" }) });
      assert.equal(workflow.state, "succeeded");
      store.save(workflow);
      const reloaded = store.load(workflow.workflowId).workflow;
      const classification = classifyAyasWorkflowRecovery({ workflow: reloaded });
      assert.equal(classification.classification, "terminal");
      // Even a naive re-run attempt (a caller ignoring the classification) is itself inert — the runtime's own terminal guard is the final backstop.
      await runAyasDeveloperWorkflow(reloaded, { runReadOnlyAction: read, applyRepair: async () => ({ ok: true, lifecycle: "completed" }) });
      assert.equal(calls, 1, "no additional action dispatched for an already-terminal recovered workflow");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await scenario("SCENARIO D — stale recovery: repository source changed while offline → stale, zero mutation", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-recovery-stale-"));
    try {
      const fixture = repairFixture(root, "developer-workflow-stale");
      const service = createAyasGuidedRepairService({ workspaceRoot: root });
      await runAyasDeveloperWorkflow(fixture.workflow, { applyRepair: service.apply }); // pauses awaiting authorization
      fs.writeFileSync(fixture.absolute, "external edit while offline\n"); // repository changed while "offline"
      const staleSteps = findAyasStaleRepairSteps(fixture.workflow, root);
      assert.deepEqual(staleSteps, ["repair"]);
      const classification = classifyAyasWorkflowRecovery({ workflow: fixture.workflow, workspaceRoot: root });
      assert.equal(classification.classification, "stale");
      assert.deepEqual(classification.staleSteps, ["repair"]);
      // Confirm the actual runtime independently refuses the mutation too (defense in depth, not just the classifier).
      const authorization = service.approve(fixture.proposal, { proposalId: fixture.proposal.proposalId, proposalFingerprint: fixture.proposal.proposalFingerprint, issueFingerprint: fixture.proposal.issueFingerprint, workspaceId: fixture.proposal.workspaceId, approvedByUser: true, userTurnId: "t1", currentTurnId: "t1" });
      await runAyasDeveloperWorkflow(fixture.workflow, { applyRepair: service.apply }, { authorizations: { repair: authorization } });
      assert.equal(fixture.workflow.state, "failed");
      assert.equal(fixture.workflow.steps[0]?.failure?.code, "stale-source-state");
      assert.equal(fs.readFileSync(fixture.absolute, "utf8"), "external edit while offline\n", "stale recovery never mutates source");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await scenario("stale is NOT reported when the source is unchanged", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-recovery-fresh-"));
    try {
      const fixture = repairFixture(root, "developer-workflow-fresh");
      const service = createAyasGuidedRepairService({ workspaceRoot: root });
      await runAyasDeveloperWorkflow(fixture.workflow, { applyRepair: service.apply });
      const classification = classifyAyasWorkflowRecovery({ workflow: fixture.workflow, workspaceRoot: root });
      assert.equal(classification.classification, "awaiting-authorization");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await scenario("blocked — a pending repair step without a supplied workspaceRoot refuses to guess staleness", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-recovery-noroot-"));
    try {
      const fixture = repairFixture(root, "developer-workflow-noroot");
      const service = createAyasGuidedRepairService({ workspaceRoot: root });
      await runAyasDeveloperWorkflow(fixture.workflow, { applyRepair: service.apply });
      const classification = classifyAyasWorkflowRecovery({ workflow: fixture.workflow }); // no workspaceRoot
      assert.equal(classification.classification, "blocked");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await scenario("corrupt — a load error is passed through as corrupt", () => {
    const result = classifyAyasWorkflowRecovery({ workflow: undefined, loadError: { code: "AYAS_WORKFLOW_STORE_CORRUPT", message: "not valid JSON" } });
    assert.equal(result.classification, "corrupt");
  });

  await scenario("unsupported-schema — a future schema version is classified distinctly from generic corruption", () => {
    const result = classifyAyasWorkflowRecovery({ workflow: undefined, loadError: { code: "AYAS_WORKFLOW_STORE_UNSUPPORTED_SCHEMA", message: "storeSchemaVersion is 99, expected 1" } });
    assert.equal(result.classification, "unsupported-schema");
  });

  await scenario("corrupt — a tampered in-process workflow object is re-validated, not trusted blindly", () => {
    const workflow = createAyasDeveloperWorkflow({ kind: "developer", goal: "tamper fixture", steps: simpleWorkflow(), workflowId: "developer-workflow-tamper" });
    const tampered = { ...workflow, state: "not-a-real-state" as never };
    const result = classifyAyasWorkflowRecovery({ workflow: tampered });
    assert.equal(result.classification, "corrupt");
  });

  console.log(`AYAS workflow recovery smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-workflow-recovery", scenarios: count }));
}

main().catch((error) => {
  console.error("AYAS workflow recovery smoke FAILED:", error);
  process.exitCode = 1;
});
