import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { runAyasReadOnlyAction } from "../src/lib/ayas/execution/AyasActionRuntime";
import { resolveAyasExecutor } from "../src/lib/ayas/execution/AyasSafeExecutors";
import type { AyasExecutor } from "../src/lib/ayas/execution/AyasActionContracts";
import { createAyasGuidedRepairService, createAyasRepairProposal, type AyasPatch, type AyasRepairProposal } from "../src/lib/ayas/execution/AyasGuidedRepair";
import { AYAS_DEVELOPER_WORKFLOW_DEFAULT_BUDGET, createAyasDeveloperWorkflow, runAyasDeveloperWorkflow, validateAyasDeveloperWorkflowPlan, type AyasWorkflowStep } from "../src/lib/ayas/execution/AyasDeveloperWorkflow";

let assertions = 0; let scenarios = 0;
const check = (value: unknown, message: string) => { assertions += 1; assert.ok(value, message); };
const hash = (value: string) => crypto.createHash("sha256").update(value, "utf8").digest("hex");
const request = (action: AyasWorkflowStep extends never ? never : string, plan: Record<string, unknown> = {}) => ({ schemaVersion: "1" as const, action, requestedBy: "workflow-smoke", intent: "controlled workflow fixture", plan } as never);
const noWrite = async () => ({ ok: true, lifecycle: "completed" });
async function scenario(name: string, fn: () => Promise<void>) { await fn(); scenarios += 1; if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${scenarios}: ${name}`); }

function proposal(workspaceId: string, filePath: string, before: string, after: string, marker: string): { proposal: AyasRepairProposal; patches: readonly AyasPatch[] } {
  const patches: readonly AyasPatch[] = [{ filePath, operation: "patch-source", expectedHash: hash(before), content: after }];
  return { patches, proposal: createAyasRepairProposal({ issueFingerprint: hash(marker), workspaceId, rootCauseStatus: "reproduced", rootCause: marker, evidence: [{ kind: "source", ref: filePath, summary: marker, digest: hash(before) }], graphifyFindings: [`AyasActionRuntime:${marker}`], approvedFiles: [filePath], operationClasses: ["patch-source"], validationActions: ["run-registered-smoke-test"], forbiddenOperations: ["shell", "git", "delete"], exclusions: ["other files"], expectedResult: marker, risk: "controlled one-file fixture", bounds: { maxFiles: 1, maxNewFiles: 0, maxRepairCycles: 0, maxValidationCycles: 1, maxDurationMs: 30_000, allowFileCreation: false } }) };
}
function approve(service: ReturnType<typeof createAyasGuidedRepairService>, value: AyasRepairProposal, turn: string) { return service.approve(value, { proposalId: value.proposalId, proposalFingerprint: value.proposalFingerprint, issueFingerprint: value.issueFingerprint, workspaceId: value.workspaceId, approvedByUser: true, userTurnId: turn, currentTurnId: turn }); }

async function main() {
  await scenario("A-E: Graphify diagnosis → authorization pause → failed validation re-analysis → second authorized success", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-developer-workflow-"));
    try {
      const rel = "src/fixture.ts"; const absolute = path.join(root, rel); fs.mkdirSync(path.dirname(absolute), { recursive: true });
      const original = "export const answer = 0;\n"; fs.writeFileSync(absolute, original);
      let validations = 0;
      const service = createAyasGuidedRepairService({ workspaceRoot: root, workspaceId: "fixture", validators: { "run-registered-smoke-test": async () => { validations += 1; if (validations === 1) throw new Error("expected answer 42"); return { answer: 42 }; } } });
      const first = proposal("fixture", rel, original, "export const answer = 41;\n", "first diagnosis");
      const second = proposal("fixture", rel, original, "export const answer = 42;\n", "corrective diagnosis");
      const sourceExecutor: AyasExecutor = async (value) => { const lines = fs.readFileSync(absolute, "utf8").split(/\r?\n/u); return { action: "inspect-source-range", write: false, summary: "fixture source inspected", data: { filePath: value.plan.filePath, content: lines.slice(0, 10).join("\n"), startLine: 1, endLine: lines.length, totalLines: lines.length, truncated: false } }; };
      const graphExecutor: AyasExecutor = async (value) => ({ action: "query-graphify", write: false, summary: "controlled fresh structural fixture", data: { status: "fresh", symbol: value.plan.symbol, evidence: "AyasActionRuntime imports policy and executor registry; GuidedRepair owns mutation.", truncated: false } });
      const read = (input: Parameters<typeof runAyasReadOnlyAction>[0]) => runAyasReadOnlyAction({ ...input, resolveExecutor: (action) => action === "inspect-source-range" ? sourceExecutor : action === "query-graphify" ? graphExecutor : resolveAyasExecutor(action) });
      const steps: AyasWorkflowStep[] = [
        { id: "status", kind: "read", request: request("inspect-repository-status"), expectedEvidence: "structured status" },
        { id: "graph-1", kind: "graphify", request: request("query-graphify", { symbol: "AyasActionRuntime" }), dependsOn: ["status"], expectedEvidence: "fresh structural neighborhood" },
        { id: "source-1", kind: "read", request: request("inspect-source-range", { filePath: rel, startLine: 1, endLine: 10 }), dependsOn: ["graph-1"], allowAfterEvidenceFailure: true, expectedEvidence: "target source" },
        { id: "repair-1", kind: "repair", proposal: first.proposal, patches: first.patches, dependsOn: ["source-1"], allowAfterValidationFailure: true, expectedEvidence: "first write validates" },
        { id: "graph-2", kind: "graphify", request: request("query-graphify", { symbol: "AyasGuidedRepair" }), dependsOn: ["repair-1"], allowAfterValidationFailure: true, expectedEvidence: "re-analysis" },
        { id: "source-2", kind: "read", request: request("inspect-source-range", { filePath: rel, startLine: 1, endLine: 10 }), dependsOn: ["graph-2"], allowAfterEvidenceFailure: true, expectedEvidence: "corrective source evidence" },
        { id: "repair-2", kind: "repair", proposal: second.proposal, patches: second.patches, dependsOn: ["source-2"], expectedEvidence: "corrective validation passes" },
      ];
      const workflow = createAyasDeveloperWorkflow({ kind: "automatic-repair", goal: "repair controlled fixture", steps });
      await runAyasDeveloperWorkflow(workflow, { runReadOnlyAction: read, applyRepair: service.apply });
      check(workflow.state === "awaiting-authorization", "first run pauses at write gate"); check(workflow.usage.writes === 0, "pause performs zero writes"); check(JSON.stringify(workflow.steps[1]?.result).includes("AyasActionRuntime imports policy"), "Graphify evidence is retained and consumed as data"); check(fs.readFileSync(absolute, "utf8") === original, "source unchanged before authorization");
      await runAyasDeveloperWorkflow(workflow, { runReadOnlyAction: read, applyRepair: service.apply }, { authorizations: { "repair-1": approve(service, first.proposal, "approve-1") } });
      check(workflow.state === "awaiting-authorization", "failed validation leads to second authorization boundary"); check(workflow.repairHistory.length === 2, "two causal repair attempts recorded"); check(workflow.repairHistory[0]?.retryReason?.includes("validation failed"), "failed validation retained as retry reason"); check(fs.readFileSync(absolute, "utf8") === original, "failed first repair rolled back");
      await runAyasDeveloperWorkflow(workflow, { runReadOnlyAction: read, applyRepair: service.apply }, { authorizations: { "repair-2": approve(service, second.proposal, "approve-2") } });
      check(workflow.state === "succeeded", "second authorized repair succeeds"); check(fs.readFileSync(absolute, "utf8").includes("42"), "corrective source is present"); check(workflow.usage.writes === 2 && workflow.usage.validations === 2, "write and validation budgets counted exactly"); check(workflow.history.some((item) => item.event === "validation-failed"), "history explains re-diagnosis");
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  await scenario("F: repeated patch terminates as non-convergent", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-non-convergent-"));
    try {
      const rel = "src/a.ts"; fs.mkdirSync(path.join(root, "src")); fs.writeFileSync(path.join(root, rel), "a\n");
      const service = createAyasGuidedRepairService({ workspaceRoot: root, validators: { "run-registered-smoke-test": async () => { throw new Error("same failure"); } } });
      const value = proposal("nc", rel, "a\n", "b\n", "same");
      const workflow = createAyasDeveloperWorkflow({ kind: "automatic-repair", goal: "detect loop", steps: [
        { id: "r1", kind: "repair", proposal: value.proposal, patches: value.patches, allowAfterValidationFailure: true, expectedEvidence: "fail" },
        { id: "r2", kind: "repair", proposal: value.proposal, patches: value.patches, dependsOn: ["r1"], allowAfterValidationFailure: true, expectedEvidence: "repeat" },
      ] });
      await runAyasDeveloperWorkflow(workflow, { applyRepair: service.apply }, { authorizations: { r1: approve(service, value.proposal, "nc-1") } });
      check(workflow.state === "repair-non-convergent", "duplicate patch stops workflow"); check(workflow.usage.writes === 1, "duplicate write never executes");
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  for (const [label, graphStatus, expected] of [["G: stale Graphify", "stale", "graphify-stale"], ["H: unavailable Graphify", "unavailable", "graphify-unavailable"]] as const) await scenario(label, async () => {
    let sourceRuns = 0;
    const mockedRead: typeof runAyasReadOnlyAction = async ({ rawRequest }) => { const action = (rawRequest as { action: string }).action; if (action === "query-graphify") return { executed: true, action: "query-graphify", result: { action: "query-graphify", write: false, summary: graphStatus, data: { status: graphStatus, evidence: [], truncated: false } }, durationMs: 0 }; sourceRuns += 1; return { executed: true, action: "inspect-source-range", result: { action: "inspect-source-range", write: false, summary: "fallback", data: {} }, durationMs: 0 }; };
    const workflow = createAyasDeveloperWorkflow({ kind: "developer", goal: "safe evidence fallback", steps: [
      { id: "graph", kind: "graphify", request: request("query-graphify", { symbol: "AyasActionRuntime" }), expectedEvidence: "graph" },
      { id: "source", kind: "read", request: request("inspect-source-range", { filePath: "src/a.ts" }), dependsOn: ["graph"], allowAfterEvidenceFailure: true, expectedEvidence: "fallback" },
    ] });
    await runAyasDeveloperWorkflow(workflow, { runReadOnlyAction: mockedRead, applyRepair: noWrite });
    check(workflow.state === "succeeded", `${graphStatus} degrades safely`); check(workflow.steps[0]?.failure?.code === expected, `${graphStatus} is structured`); check(sourceRuns === 1, "only safe source fallback executes"); check(workflow.usage.writes === 0, "Graphify evidence grants no write authority");
  });

  await scenario("I: policy rejection blocks dependent execution", async () => {
    let calls = 0; const read: typeof runAyasReadOnlyAction = async (value) => { calls += 1; return runAyasReadOnlyAction(value); };
    const workflow = createAyasDeveloperWorkflow({ kind: "developer", goal: "reject unknown action", steps: [
      { id: "bad", kind: "read", request: request("shell", { command: "echo x" }), expectedEvidence: "none" },
      { id: "later", kind: "read", request: request("inspect-repository-status"), dependsOn: ["bad"], expectedEvidence: "must not run" },
    ] });
    await runAyasDeveloperWorkflow(workflow, { runReadOnlyAction: read, applyRepair: noWrite });
    check(workflow.state === "rejected", "policy denial rejects workflow"); check(calls === 1, "dependent executor never runs");
  });

  await scenario("J: action budget exhaustion prevents later work", async () => {
    let calls = 0; const read: typeof runAyasReadOnlyAction = async () => { calls += 1; return { executed: true, action: "inspect-repository-status", result: { action: "inspect-repository-status", write: false, summary: "ok", data: {} }, durationMs: 0 }; };
    const workflow = createAyasDeveloperWorkflow({ kind: "developer", goal: "bounded", budget: { ...AYAS_DEVELOPER_WORKFLOW_DEFAULT_BUDGET, maxActions: 1 }, steps: [
      { id: "one", kind: "read", request: request("inspect-repository-status"), expectedEvidence: "one" }, { id: "two", kind: "read", request: request("inspect-repository-status"), dependsOn: ["one"], expectedEvidence: "two" },
    ] });
    await runAyasDeveloperWorkflow(workflow, { runReadOnlyAction: read, applyRepair: noWrite });
    check(workflow.state === "budget-exhausted", "budget has terminal state"); check(calls === 1, "later action does not execute");
  });

  await scenario("K: stale repair refuses mutation", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-stale-repair-"));
    try {
      const rel = "src/a.ts"; const absolute = path.join(root, rel); fs.mkdirSync(path.dirname(absolute)); fs.writeFileSync(absolute, "before\n");
      const service = createAyasGuidedRepairService({ workspaceRoot: root, validators: { "run-registered-smoke-test": async () => ({ ok: true }) } }); const value = proposal("stale", rel, "before\n", "repair\n", "stale");
      const workflow = createAyasDeveloperWorkflow({ kind: "automatic-repair", goal: "stale", steps: [{ id: "repair", kind: "repair", proposal: value.proposal, patches: value.patches, expectedEvidence: "validated" }] });
      await runAyasDeveloperWorkflow(workflow, { applyRepair: service.apply }); fs.writeFileSync(absolute, "external\n");
      await runAyasDeveloperWorkflow(workflow, { applyRepair: service.apply }, { authorizations: { repair: approve(service, value.proposal, "stale-approval") } });
      check(workflow.state === "failed", "stale workflow fails"); check(workflow.steps[0]?.failure?.code === "stale-source-state", "stale source is classified"); check(fs.readFileSync(absolute, "utf8") === "external\n", "stale repair does not mutate source");
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  await scenario("plan validation and terminal-state protection", async () => {
    const invalid = validateAyasDeveloperWorkflowPlan({ kind: "developer", goal: "bad", steps: [{ id: "late", kind: "read", request: request("inspect-repository-status"), dependsOn: ["missing"], expectedEvidence: "none" }] }); check(!invalid.ok, "forward/missing dependency rejected");
    let calls = 0; const workflow = createAyasDeveloperWorkflow({ kind: "developer", goal: "terminal", steps: [{ id: "only", kind: "read", request: request("inspect-repository-status"), expectedEvidence: "ok" }] });
    const read: typeof runAyasReadOnlyAction = async () => { calls += 1; return { executed: true, action: "inspect-repository-status", result: { action: "inspect-repository-status", write: false, summary: "ok", data: {} }, durationMs: 0 }; };
    await runAyasDeveloperWorkflow(workflow, { runReadOnlyAction: read, applyRepair: noWrite }); await runAyasDeveloperWorkflow(workflow, { runReadOnlyAction: read, applyRepair: noWrite }); check(calls === 1, "terminal workflow is inert");
    const elevated = validateAyasDeveloperWorkflowPlan({ kind: "developer", goal: "escalate", budget: { ...AYAS_DEVELOPER_WORKFLOW_DEFAULT_BUDGET, maxWrites: 99 }, steps: [{ id: "one", kind: "read", request: request("inspect-repository-status"), expectedEvidence: "none" }] }); check(!elevated.ok, "workflow cannot increase deterministic budgets");
  });

  await scenario("transient read retry is bounded", async () => {
    let calls = 0; const read: typeof runAyasReadOnlyAction = async () => { calls += 1; return calls === 1 ? { executed: false, action: "inspect-repository-status", stage: "timeout", reason: "timeout", detail: "transient timeout", durationMs: 0 } : { executed: true, action: "inspect-repository-status", result: { action: "inspect-repository-status", write: false, summary: "ok", data: {} }, durationMs: 0 }; };
    const workflow = createAyasDeveloperWorkflow({ kind: "developer", goal: "retry once", steps: [{ id: "read", kind: "read", request: request("inspect-repository-status"), expectedEvidence: "status" }] });
    await runAyasDeveloperWorkflow(workflow, { runReadOnlyAction: read, applyRepair: noWrite }); check(workflow.state === "succeeded", "one transient retry may recover"); check(calls === 2 && workflow.usage.readRetries === 1, "retry counter is exact and bounded");
  });

  console.log(`AYAS developer workflow smoke: PASS (${scenarios} scenarios / ${assertions} assertions)`);
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-developer-workflow", scenarios, assertions }));
}
void main();
