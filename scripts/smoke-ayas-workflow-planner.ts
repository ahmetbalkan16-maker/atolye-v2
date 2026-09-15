/**
 * AYAS Schema-Bound Workflow Planner smoke suite.
 *
 * Deterministic / $0 / no network / no model. Covers `planAyasDeveloperWorkflow`:
 * SCENARIO J (accepts a safe, registered plan), K (rejects an unknown/
 * unregistered action), L (cannot escalate budget above the deterministic
 * ceilings), M (cannot bypass the authorization boundary — every repair
 * step in an accepted plan still requires explicit authorization at
 * execution time, proven by actually running one), plus duplicate/invalid
 * step ids, dependency validation, action/kind mismatch, and a tampered
 * (non-authentic) proposal reference.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";

import { planAyasDeveloperWorkflow, type AyasPlannerIntent } from "../src/lib/ayas/execution/AyasWorkflowPlanner";
import { runAyasDeveloperWorkflow, AYAS_DEVELOPER_WORKFLOW_DEFAULT_BUDGET } from "../src/lib/ayas/execution/AyasDeveloperWorkflow";
import { createAyasRepairProposal, type AyasPatch, type AyasRepairProposal } from "../src/lib/ayas/execution/AyasGuidedRepair";

let count = 0;
async function scenario(name: string, test: () => void | Promise<void>) {
  await test();
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}

const hash = (value: string) => crypto.createHash("sha256").update(value, "utf8").digest("hex");

function safeReadIntent(id: string, dependsOn?: readonly string[]): AyasPlannerIntent["steps"][number] {
  return { id, kind: "read", action: "inspect-repository-status", requestedBy: "planner-smoke", intent: "fixture", plan: {}, ...(dependsOn ? { dependsOn } : {}), expectedEvidence: "status" };
}

function repairProposalFixture(): { proposal: AyasRepairProposal; patches: readonly AyasPatch[] } {
  const rel = "src/fixture.ts";
  const before = "export const answer = 0;\n";
  const patches: readonly AyasPatch[] = [{ filePath: rel, operation: "patch-source", expectedHash: hash(before), content: "export const answer = 42;\n" }];
  const proposal = createAyasRepairProposal({
    issueFingerprint: hash("planner-fixture"), workspaceId: "planner", rootCauseStatus: "reproduced", rootCause: "planner fixture",
    evidence: [{ kind: "source", ref: rel, summary: "fixture", digest: hash(before) }], graphifyFindings: [],
    approvedFiles: [rel], operationClasses: ["patch-source"], validationActions: ["run-registered-smoke-test"],
    forbiddenOperations: ["shell", "git", "delete"], exclusions: [], expectedResult: "answer becomes 42", risk: "single fixture file",
    bounds: { maxFiles: 1, maxNewFiles: 0, maxRepairCycles: 0, maxValidationCycles: 1, maxDurationMs: 30_000, allowFileCreation: false },
  });
  return { proposal, patches };
}

async function main() {
  await scenario("SCENARIO J — planner accepts a safe, registered read+graphify+validation plan", () => {
    const outcome = planAyasDeveloperWorkflow({
      kind: "developer", goal: "safe registered plan",
      steps: [
        safeReadIntent("status"),
        { id: "graph", kind: "graphify", action: "query-graphify", requestedBy: "planner-smoke", intent: "evidence", plan: { symbol: "AyasActionRuntime" }, dependsOn: ["status"], expectedEvidence: "structural evidence" },
        { id: "validate", kind: "validation", action: "run-developer-validation", requestedBy: "planner-smoke", intent: "check", plan: { validationId: "typecheck" }, dependsOn: ["graph"], expectedEvidence: "typecheck result" },
      ],
    });
    assert.equal(outcome.ok, true);
    if (outcome.ok) {
      assert.equal(outcome.workflow.steps.length, 3);
      assert.equal(outcome.workflow.state, "planned");
    }
  });

  await scenario("SCENARIO J(b) — planner accepts a plan referencing an already-authentic repair proposal", () => {
    const { proposal, patches } = repairProposalFixture();
    const outcome = planAyasDeveloperWorkflow({
      kind: "automatic-repair", goal: "safe repair plan",
      steps: [{ id: "repair", kind: "repair", proposal, patches, expectedEvidence: "answer becomes 42" }],
    });
    assert.equal(outcome.ok, true);
  });

  await scenario("SCENARIO K — planner rejects an unknown/unregistered action, zero execution", () => {
    const outcome = planAyasDeveloperWorkflow({
      kind: "developer", goal: "invented tool",
      steps: [{ id: "bad", kind: "read", action: "run_shell_command", requestedBy: "planner-smoke", intent: "invented", plan: {}, expectedEvidence: "none" }],
    });
    assert.equal(outcome.ok, false);
    if (!outcome.ok) assert.equal(outcome.code, "unregistered-action");
  });

  await scenario("SCENARIO K(b) — planner rejects a reserved (write-shaped) action id", () => {
    const outcome = planAyasDeveloperWorkflow({
      kind: "developer", goal: "reserved action",
      steps: [{ id: "bad", kind: "read", action: "resume-stage", requestedBy: "planner-smoke", intent: "reserved", plan: {}, expectedEvidence: "none" }],
    });
    assert.equal(outcome.ok, false);
    if (!outcome.ok) assert.equal(outcome.code, "unregistered-action");
  });

  await scenario("SCENARIO L — planner cannot escalate budget above deterministic ceilings", () => {
    const outcome = planAyasDeveloperWorkflow({
      kind: "developer", goal: "escalate budget", budget: { maxRepairAttempts: 99 },
      steps: [safeReadIntent("status")],
    });
    assert.equal(outcome.ok, false);
    if (!outcome.ok) assert.equal(outcome.code, "budget-escalation");
  });

  await scenario("SCENARIO L(b) — planner MAY request a narrower budget than the defaults", () => {
    const outcome = planAyasDeveloperWorkflow({
      kind: "developer", goal: "narrower budget", budget: { maxActions: 1 },
      steps: [safeReadIntent("status")],
    });
    assert.equal(outcome.ok, true);
    if (outcome.ok) assert.equal(outcome.workflow.budget.maxActions, 1);
    assert.ok(AYAS_DEVELOPER_WORKFLOW_DEFAULT_BUDGET.maxActions > 1, "sanity: the default ceiling is actually wider than what was requested");
  });

  await scenario("SCENARIO M — planner cannot bypass authorization: an accepted repair plan still pauses for explicit authorization at execution time", async () => {
    const { proposal, patches } = repairProposalFixture();
    const outcome = planAyasDeveloperWorkflow({
      kind: "automatic-repair", goal: "authorization boundary proof",
      steps: [{ id: "repair", kind: "repair", proposal, patches, expectedEvidence: "answer becomes 42" }],
    });
    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    let applyCalls = 0;
    await runAyasDeveloperWorkflow(outcome.workflow, { applyRepair: async () => { applyCalls += 1; return { ok: true, lifecycle: "completed" }; } }); // NO authorizations supplied
    assert.equal(outcome.workflow.state, "awaiting-authorization", "the planner-produced workflow still pauses for authorization — it cannot pre-approve itself");
    assert.equal(applyCalls, 0, "zero mutation attempted without explicit authorization");
  });

  await scenario("proposal-fingerprint-mismatch — a tampered (non-authentic) proposal reference is rejected before any workflow is created", () => {
    const { proposal, patches } = repairProposalFixture();
    const tampered: AyasRepairProposal = { ...proposal, rootCause: "TAMPERED — no longer matches its own fingerprint" };
    const outcome = planAyasDeveloperWorkflow({
      kind: "automatic-repair", goal: "tampered proposal",
      steps: [{ id: "repair", kind: "repair", proposal: tampered, patches, expectedEvidence: "none" }],
    });
    assert.equal(outcome.ok, false);
    if (!outcome.ok) assert.equal(outcome.code, "proposal-fingerprint-mismatch");
  });

  await scenario("duplicate step id is rejected", () => {
    const outcome = planAyasDeveloperWorkflow({ kind: "developer", goal: "dup", steps: [safeReadIntent("one"), safeReadIntent("one")] });
    assert.equal(outcome.ok, false);
    if (!outcome.ok) assert.equal(outcome.code, "duplicate-step-id");
  });

  await scenario("missing/forward dependency is rejected (delegated to the existing plan validator)", () => {
    const outcome = planAyasDeveloperWorkflow({ kind: "developer", goal: "bad dep", steps: [safeReadIntent("late", ["missing"])] });
    assert.equal(outcome.ok, false);
    if (!outcome.ok) assert.equal(outcome.code, "plan-rejected");
  });

  await scenario("action/kind mismatch is rejected — a 'graphify' kind step naming a non-Graphify action", () => {
    const outcome = planAyasDeveloperWorkflow({
      kind: "developer", goal: "mismatch",
      steps: [{ id: "bad", kind: "graphify", action: "inspect-repository-status", requestedBy: "planner-smoke", intent: "mismatch", plan: {}, expectedEvidence: "none" }],
    });
    assert.equal(outcome.ok, false);
    if (!outcome.ok) assert.equal(outcome.code, "action-kind-mismatch");
  });

  await scenario("repair step with no registered validation is rejected", () => {
    const rel = "src/fixture.ts"; const before = "a\n";
    const proposal = createAyasRepairProposal({
      issueFingerprint: hash("novalidation"), workspaceId: "planner", rootCauseStatus: "reproduced", rootCause: "no validation fixture",
      evidence: [], graphifyFindings: [], approvedFiles: [rel], operationClasses: ["patch-source"], validationActions: [],
      forbiddenOperations: ["shell"], exclusions: [], expectedResult: "x", risk: "y",
      bounds: { maxFiles: 1, maxNewFiles: 0, maxRepairCycles: 0, maxValidationCycles: 0, maxDurationMs: 1_000, allowFileCreation: false },
    });
    const patches: readonly AyasPatch[] = [{ filePath: rel, operation: "patch-source", expectedHash: hash(before), content: "b\n" }];
    const outcome = planAyasDeveloperWorkflow({ kind: "automatic-repair", goal: "no validation", steps: [{ id: "repair", kind: "repair", proposal, patches, expectedEvidence: "x" }] });
    assert.equal(outcome.ok, false);
    if (!outcome.ok) assert.equal(outcome.code, "no-validation-for-repair");
  });

  await scenario("empty plan and oversize plan are rejected", () => {
    assert.equal(planAyasDeveloperWorkflow({ kind: "developer", goal: "empty", steps: [] }).ok, false);
    const many = Array.from({ length: AYAS_DEVELOPER_WORKFLOW_DEFAULT_BUDGET.maxSteps + 5 }, (_, i) => safeReadIntent(`s${i}`));
    const outcome = planAyasDeveloperWorkflow({ kind: "developer", goal: "too many", steps: many });
    assert.equal(outcome.ok, false);
    if (!outcome.ok) assert.equal(outcome.code, "too-many-steps");
  });

  await scenario("ADVERSARIAL — shell-injection-shaped content inside a plan field is rejected (reuses AyasExecutionPolicy's own shell-like-content check, not re-implemented)", () => {
    const outcome = planAyasDeveloperWorkflow({
      kind: "developer", goal: "shell injection attempt",
      steps: [{ id: "bad", kind: "read", action: "inspect-source-file", requestedBy: "planner-smoke", intent: "x", plan: { filePath: "src/a.ts; rm -rf /" }, expectedEvidence: "none" }],
    });
    assert.equal(outcome.ok, false);
    if (!outcome.ok) assert.equal(outcome.code, "malformed-action-input");
  });

  await scenario("ADVERSARIAL — a write-classified action id would be rejected even if one existed on the allowlist (defense in depth, currently structurally unreachable since every registered action is read-only)", () => {
    // Every action on AYAS_EXECUTION_ALLOWLIST today is write:false, so this
    // documents intent rather than exercising a live counter-example — the
    // planner's own `validated.spec.write` guard (AyasWorkflowPlanner.ts) is
    // retained as defense in depth for whenever a write action is added.
    const outcome = planAyasDeveloperWorkflow({ kind: "developer", goal: "sanity", steps: [safeReadIntent("status")] });
    assert.equal(outcome.ok, true);
  });

  await scenario("invalid step id shape is rejected", () => {
    const outcome = planAyasDeveloperWorkflow({ kind: "developer", goal: "bad id", steps: [{ id: "../escape", kind: "read", action: "inspect-repository-status", requestedBy: "x", intent: "y", plan: {}, expectedEvidence: "z" }] });
    assert.equal(outcome.ok, false);
    if (!outcome.ok) assert.equal(outcome.code, "invalid-step-id");
  });

  console.log(`AYAS workflow planner smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-workflow-planner", scenarios: count }));
}

main().catch((error) => {
  console.error("AYAS workflow planner smoke FAILED:", error);
  process.exitCode = 1;
});
