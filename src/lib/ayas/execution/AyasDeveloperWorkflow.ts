/** Deterministic, bounded developer workflow orchestration. Authority always remains in the invoked runtime. */
import crypto from "node:crypto";

import { runAyasReadOnlyAction, type AyasActionRuntimeOutcome } from "./AyasActionRuntime";
import type { AyasExecutionRequest } from "./AyasExecutionPolicy";
import type { AyasPatch, AyasRepairAuthorization, AyasRepairProposal } from "./AyasGuidedRepair";

export type AyasWorkflowState = "planned" | "running" | "awaiting-authorization" | "validating" | "succeeded" | "failed" | "rejected" | "budget-exhausted" | "repair-non-convergent" | "cancelled";
export type AyasWorkflowStepState = "pending" | "ready" | "running" | "awaiting-authorization" | "succeeded" | "failed" | "rejected" | "skipped";
export type AyasWorkflowFailureCode = "invalid-workflow" | "invalid-workflow-step" | "invalid-action-input" | "policy-rejection" | "authorization-required" | "invalid-authorization" | "stale-authorization" | "stale-source-state" | "graphify-unavailable" | "graphify-stale" | "graphify-failure" | "graphify-output-limit" | "read-action-failure" | "command-unavailable" | "timeout" | "output-truncation" | "executor-failure" | "validation-failure" | "dependency-failure" | "budget-exhaustion" | "repair-non-convergence";
export interface AyasWorkflowFailure { readonly code: AyasWorkflowFailureCode; readonly detail: string; readonly retryable: boolean; }

export interface AyasWorkflowBudget {
  readonly maxSteps: number; readonly maxActions: number; readonly maxGraphifyQueries: number; readonly maxValidations: number;
  readonly maxRepairAttempts: number; readonly maxWrites: number; readonly maxReadRetries: number; readonly maxOutputChars: number;
}
export const AYAS_DEVELOPER_WORKFLOW_DEFAULT_BUDGET: AyasWorkflowBudget = Object.freeze({ maxSteps: 12, maxActions: 16, maxGraphifyQueries: 4, maxValidations: 4, maxRepairAttempts: 2, maxWrites: 2, maxReadRetries: 1, maxOutputChars: 192_000 });
export interface AyasWorkflowUsage { actions: number; graphifyQueries: number; validations: number; repairAttempts: number; writes: number; readRetries: number; outputChars: number; }
export type AyasWorkflowStep =
  | { readonly id: string; readonly kind: "read" | "graphify" | "validation"; readonly request: AyasExecutionRequest; readonly dependsOn?: readonly string[]; readonly expectedEvidence: string; readonly allowAfterValidationFailure?: boolean; readonly allowAfterEvidenceFailure?: boolean }
  | { readonly id: string; readonly kind: "repair"; readonly proposal: AyasRepairProposal; readonly patches: readonly AyasPatch[]; readonly dependsOn?: readonly string[]; readonly expectedEvidence: string; readonly allowAfterValidationFailure?: boolean; readonly allowAfterEvidenceFailure?: boolean };
export interface AyasWorkflowStepRecord { readonly step: AyasWorkflowStep; state: AyasWorkflowStepState; attempts: number; result?: unknown; failure?: AyasWorkflowFailure; }
export interface AyasWorkflowHistoryEntry { readonly sequence: number; readonly event: string; readonly state: AyasWorkflowState; readonly stepId?: string; readonly detail: string; readonly usage: Readonly<AyasWorkflowUsage>; }
export interface AyasRepairAttemptRecord { readonly attempt: number; readonly stepId: string; readonly trigger: string; readonly proposalFingerprint: string; readonly patchFingerprint: string; readonly graphifyEvidence: readonly string[]; authorizationState: "required" | "approved" | "invalid"; writeResult?: unknown; validationResult?: unknown; retryReason?: string; terminalReason?: string; }
export interface AyasDeveloperWorkflow {
  readonly schemaVersion: "1"; readonly workflowId: string; readonly kind: "developer" | "automatic-repair"; readonly goal: string; readonly createdAt: string;
  state: AyasWorkflowState; readonly steps: AyasWorkflowStepRecord[]; readonly budget: AyasWorkflowBudget; readonly usage: AyasWorkflowUsage;
  readonly history: AyasWorkflowHistoryEntry[]; readonly repairHistory: AyasRepairAttemptRecord[]; terminalReason?: string;
}
export interface AyasWorkflowRepairOutcome { readonly ok: boolean; readonly lifecycle: string; readonly reason?: string; readonly files?: readonly string[]; readonly validations?: readonly unknown[]; readonly [key: string]: unknown; }
/**
 * Durable Workflow Persistence sprint — an OPTIONAL, additive checkpoint
 * hook. Existing callers that omit it behave byte-for-byte as before (a
 * no-op default). When supplied, the caller (a durable store adapter) is
 * given a chance to persist the CURRENT in-memory `workflow` object at the
 * few points where a crash would otherwise leave durable state stale:
 * right after the workflow starts/resumes, immediately BEFORE a mutation is
 * dispatched (`before-mutation` — the single most dangerous boundary,
 * called right after the repair attempt is recorded into `repairHistory`
 * but before `applyRepair` runs, so a crash mid-write still leaves a
 * recovered workflow whose repair-history already blocks a naive replay via
 * the existing non-convergence check below), immediately AFTER a mutation
 * result is known (`after-mutation`), and right before every terminal /
 * awaiting-authorization / budget-exhausted return. Never awaited in a way
 * that blocks step execution beyond what the hook itself takes — a slow or
 * failing checkpoint is the caller's own concern, not swallowed here.
 */
export type AyasWorkflowCheckpointPoint = "started" | "before-mutation" | "after-mutation" | "step-terminal" | "workflow-terminal";
export interface AyasDeveloperWorkflowDeps {
  readonly runReadOnlyAction?: typeof runAyasReadOnlyAction;
  readonly applyRepair: (proposal: AyasRepairProposal, authorization: AyasRepairAuthorization, patches: readonly AyasPatch[]) => Promise<AyasWorkflowRepairOutcome>;
  readonly onCheckpoint?: (workflow: AyasDeveloperWorkflow, point: AyasWorkflowCheckpointPoint) => void | Promise<void>;
}
export interface AyasWorkflowRunInput { readonly authorizations?: Readonly<Record<string, AyasRepairAuthorization>>; }

const TERMINAL = new Set<AyasWorkflowState>(["succeeded", "failed", "rejected", "budget-exhausted", "repair-non-convergent", "cancelled"]);
const STEP_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const patchFingerprint = (patches: readonly AyasPatch[]) => crypto.createHash("sha256").update(JSON.stringify(patches), "utf8").digest("hex");
function usage(): AyasWorkflowUsage { return { actions: 0, graphifyQueries: 0, validations: 0, repairAttempts: 0, writes: 0, readRetries: 0, outputChars: 0 }; }
function event(workflow: AyasDeveloperWorkflow, name: string, detail: string, stepId?: string) { workflow.history.push({ sequence: workflow.history.length + 1, event: name, state: workflow.state, ...(stepId ? { stepId } : {}), detail: detail.slice(0, 1_000), usage: clone(workflow.usage) }); }
function budgetIsWithinAuthority(value: AyasWorkflowBudget): boolean {
  return (Object.keys(AYAS_DEVELOPER_WORKFLOW_DEFAULT_BUDGET) as Array<keyof AyasWorkflowBudget>).every((key) => Number.isInteger(value[key]) && value[key] >= 0 && value[key] <= AYAS_DEVELOPER_WORKFLOW_DEFAULT_BUDGET[key]);
}

export function validateAyasDeveloperWorkflowPlan(input: { kind: "developer" | "automatic-repair"; goal: string; steps: readonly AyasWorkflowStep[]; budget?: AyasWorkflowBudget }): { ok: true } | { ok: false; failure: AyasWorkflowFailure } {
  const budget = input.budget ?? AYAS_DEVELOPER_WORKFLOW_DEFAULT_BUDGET;
  if (!budgetIsWithinAuthority(budget)) return { ok: false, failure: { code: "invalid-workflow", detail: "workflow budget exceeds deterministic authority", retryable: false } };
  if (!input.goal.trim() || input.goal.length > 2_000 || input.steps.length === 0 || input.steps.length > budget.maxSteps) return { ok: false, failure: { code: "invalid-workflow", detail: "goal or step count is outside workflow bounds", retryable: false } };
  const ids = new Set<string>();
  for (const step of input.steps) {
    if (!STEP_ID.test(step.id) || ids.has(step.id)) return { ok: false, failure: { code: "invalid-workflow-step", detail: `invalid or duplicate step id: ${step.id}`, retryable: false } };
    const deps = step.dependsOn ?? [];
    if (deps.some((id) => !ids.has(id))) return { ok: false, failure: { code: "invalid-workflow-step", detail: `${step.id} has a missing or forward dependency`, retryable: false } };
    if (step.kind === "graphify" && step.request.action !== "query-graphify") return { ok: false, failure: { code: "invalid-workflow-step", detail: `${step.id} graphify kind/action mismatch`, retryable: false } };
    if (step.kind === "validation" && step.request.action !== "run-developer-validation") return { ok: false, failure: { code: "invalid-workflow-step", detail: `${step.id} validation kind/action mismatch`, retryable: false } };
    if (step.kind === "repair" && step.proposal.validationActions.length === 0) return { ok: false, failure: { code: "invalid-workflow-step", detail: `${step.id} repair requires at least one registered validation`, retryable: false } };
    if (step.kind !== "repair" && step.request.action === "run-developer-validation" && step.kind !== "validation") return { ok: false, failure: { code: "invalid-workflow-step", detail: `${step.id} validation must use validation kind`, retryable: false } };
    ids.add(step.id);
  }
  return { ok: true };
}

export function createAyasDeveloperWorkflow(input: { readonly kind: "developer" | "automatic-repair"; readonly goal: string; readonly steps: readonly AyasWorkflowStep[]; readonly budget?: AyasWorkflowBudget; readonly workflowId?: string; readonly createdAt?: string }): AyasDeveloperWorkflow {
  const budget = clone(input.budget ?? AYAS_DEVELOPER_WORKFLOW_DEFAULT_BUDGET);
  const checked = validateAyasDeveloperWorkflowPlan({ kind: input.kind, goal: input.goal, steps: input.steps, budget });
  if (!checked.ok) throw new Error(`${checked.failure.code}: ${checked.failure.detail}`);
  return { schemaVersion: "1", workflowId: input.workflowId ?? `developer-workflow-${crypto.randomUUID()}`, kind: input.kind, goal: input.goal, createdAt: input.createdAt ?? new Date().toISOString(), state: "planned", steps: input.steps.map((step) => ({ step: clone(step), state: "pending", attempts: 0 })), budget: Object.freeze(budget), usage: usage(), history: [], repairHistory: [] };
}

function classifyActionFailure(outcome: Extract<AyasActionRuntimeOutcome, { executed: false }>): AyasWorkflowFailure {
  if (outcome.stage === "policy") return { code: outcome.reason === "malformed-plan" || outcome.reason === "malformed-request" ? "invalid-action-input" : "policy-rejection", detail: outcome.detail, retryable: false };
  if (outcome.stage === "timeout") return { code: "timeout", detail: outcome.detail, retryable: true };
  return { code: outcome.stage === "executor" ? "executor-failure" : "read-action-failure", detail: outcome.detail, retryable: outcome.stage === "executor" };
}
function graphifyFailure(data: Readonly<Record<string, unknown>>): AyasWorkflowFailure | undefined {
  const status = data.status;
  if (status === "fresh") return data.truncated === true ? { code: "graphify-output-limit", detail: "Graphify evidence was truncated", retryable: false } : undefined;
  if (status === "stale") return { code: "graphify-stale", detail: "Graphify graph does not match repository HEAD", retryable: false };
  if (status === "unavailable") return { code: "graphify-unavailable", detail: "Graphify is unavailable", retryable: false };
  if (status === "timeout") return { code: "timeout", detail: "Graphify query timed out", retryable: true };
  return { code: "graphify-failure", detail: "Graphify query failed", retryable: false };
}
function repairFailure(reason: string): AyasWorkflowFailure {
  if (/precondition hash mismatch/iu.test(reason)) return { code: "stale-source-state", detail: reason, retryable: false };
  if (/authorization expired|revoked/iu.test(reason)) return { code: "stale-authorization", detail: reason, retryable: false };
  if (/authorization|proposal.*mismatch|scope/iu.test(reason)) return { code: "invalid-authorization", detail: reason, retryable: false };
  if (/validation failed/iu.test(reason)) return { code: "validation-failure", detail: reason, retryable: false };
  return { code: "executor-failure", detail: reason, retryable: false };
}
function budgetFailure(workflow: AyasDeveloperWorkflow, step: AyasWorkflowStep, resumingAuthorization = false): AyasWorkflowFailure | undefined {
  const b = workflow.budget; const u = workflow.usage;
  if (u.actions >= b.maxActions) return { code: "budget-exhaustion", detail: "maximum executed actions reached", retryable: false };
  if (step.kind === "graphify" && u.graphifyQueries >= b.maxGraphifyQueries) return { code: "budget-exhaustion", detail: "maximum Graphify queries reached", retryable: false };
  if (step.kind === "validation" && u.validations >= b.maxValidations) return { code: "budget-exhaustion", detail: "maximum validations reached", retryable: false };
  if (step.kind === "repair" && ((!resumingAuthorization && u.repairAttempts >= b.maxRepairAttempts) || u.writes >= b.maxWrites || u.validations + step.proposal.validationActions.length > b.maxValidations)) return { code: "budget-exhaustion", detail: "repair, write, or validation budget reached", retryable: false };
  return undefined;
}
function canFollowFailedDependency(workflow: AyasDeveloperWorkflow, record: AyasWorkflowStepRecord): boolean {
  return (record.step.dependsOn ?? []).some((id) => {
    const code = workflow.steps.find((item) => item.step.id === id)?.failure?.code;
    return (record.step.allowAfterValidationFailure && code === "validation-failure") ||
      (record.step.allowAfterEvidenceFailure && (code === "graphify-stale" || code === "graphify-unavailable" || code === "graphify-failure" || code === "graphify-output-limit"));
  });
}

/** Resumes in place. Completed steps are never rerun; terminal workflows are inert. */
export async function runAyasDeveloperWorkflow(workflow: AyasDeveloperWorkflow, deps: AyasDeveloperWorkflowDeps, input: AyasWorkflowRunInput = {}): Promise<AyasDeveloperWorkflow> {
  if (TERMINAL.has(workflow.state)) return workflow;
  const checkpoint = async (point: AyasWorkflowCheckpointPoint) => { await deps.onCheckpoint?.(workflow, point); };
  const planCheck = validateAyasDeveloperWorkflowPlan({ kind: workflow.kind, goal: workflow.goal, steps: workflow.steps.map((record) => record.step), budget: workflow.budget });
  if (!planCheck.ok) { workflow.state = "rejected"; workflow.terminalReason = planCheck.failure.detail; event(workflow, "workflow-rejected", planCheck.failure.detail); await checkpoint("workflow-terminal"); return workflow; }
  workflow.state = "running"; event(workflow, "workflow-running", "deterministic execution started/resumed"); await checkpoint("started");
  const read = deps.runReadOnlyAction ?? runAyasReadOnlyAction;
  for (const record of workflow.steps) {
    if (record.state === "succeeded" || record.state === "skipped" || record.state === "failed" || record.state === "rejected") continue;
    const resumingAuthorization = record.state === "awaiting-authorization";
    const dependencies = (record.step.dependsOn ?? []).map((id) => workflow.steps.find((item) => item.step.id === id)!);
    const failedDependency = dependencies.some((item) => item.state !== "succeeded");
    if (failedDependency && !canFollowFailedDependency(workflow, record)) { record.state = "skipped"; record.failure = { code: "dependency-failure", detail: "a prerequisite did not succeed", retryable: false }; event(workflow, "step-skipped", record.failure.detail, record.step.id); continue; }
    const exhausted = budgetFailure(workflow, record.step, resumingAuthorization);
    if (exhausted) { record.state = "rejected"; record.failure = exhausted; workflow.state = "budget-exhausted"; workflow.terminalReason = exhausted.detail; event(workflow, "budget-exhausted", exhausted.detail, record.step.id); await checkpoint("workflow-terminal"); return workflow; }
    record.state = "ready"; record.state = "running"; delete record.failure; record.attempts += 1; event(workflow, "step-running", record.step.kind, record.step.id);
    if (record.step.kind !== "repair") {
      workflow.usage.actions += 1; if (record.step.kind === "graphify") workflow.usage.graphifyQueries += 1; if (record.step.kind === "validation") { workflow.usage.validations += 1; workflow.state = "validating"; }
      let outcome = await read({ rawRequest: record.step.request });
      let failure = outcome.executed ? undefined : classifyActionFailure(outcome);
      if (!failure && record.step.kind === "graphify" && outcome.executed) failure = graphifyFailure(outcome.result.data);
      if (failure?.retryable && record.step.kind !== "validation" && workflow.usage.readRetries < workflow.budget.maxReadRetries && workflow.usage.actions < workflow.budget.maxActions && (record.step.kind !== "graphify" || workflow.usage.graphifyQueries < workflow.budget.maxGraphifyQueries)) {
        workflow.usage.readRetries += 1; workflow.usage.actions += 1; if (record.step.kind === "graphify") workflow.usage.graphifyQueries += 1; record.attempts += 1; event(workflow, "read-retry", failure.detail, record.step.id);
        outcome = await read({ rawRequest: record.step.request }); failure = outcome.executed ? undefined : classifyActionFailure(outcome); if (!failure && record.step.kind === "graphify" && outcome.executed) failure = graphifyFailure(outcome.result.data);
      }
      record.result = outcome; workflow.usage.outputChars += JSON.stringify(outcome).length;
      if (workflow.usage.outputChars > workflow.budget.maxOutputChars) { record.state = "failed"; record.failure = { code: "output-truncation", detail: "workflow output budget exceeded", retryable: false }; workflow.state = "budget-exhausted"; workflow.terminalReason = record.failure.detail; event(workflow, "budget-exhausted", record.failure.detail, record.step.id); await checkpoint("workflow-terminal"); return workflow; }
      if (!failure && record.step.kind === "validation" && outcome.executed && outcome.result.data.status !== "passed") failure = { code: outcome.result.data.status === "unavailable" ? "command-unavailable" : "validation-failure", detail: outcome.result.summary, retryable: false };
      if (failure) { record.state = failure.code === "policy-rejection" || failure.code === "invalid-action-input" ? "rejected" : "failed"; record.failure = failure; event(workflow, "step-failed", `${failure.code}: ${failure.detail}`, record.step.id); if (!record.step.allowAfterValidationFailure && failure.code !== "graphify-stale" && failure.code !== "graphify-unavailable" && failure.code !== "graphify-failure") { workflow.state = record.state === "rejected" ? "rejected" : "failed"; workflow.terminalReason = failure.detail; await checkpoint("workflow-terminal"); return workflow; } }
      else { record.state = "succeeded"; event(workflow, "step-succeeded", record.step.expectedEvidence, record.step.id); }
      workflow.state = "running"; await checkpoint("step-terminal"); continue;
    }
    const fingerprint = patchFingerprint(record.step.patches);
    if (!resumingAuthorization && workflow.repairHistory.some((attempt) => attempt.patchFingerprint === fingerprint)) { record.state = "failed"; record.failure = { code: "repair-non-convergence", detail: "the same patch was proposed again", retryable: false }; workflow.state = "repair-non-convergent"; workflow.terminalReason = record.failure.detail; event(workflow, "repair-non-convergent", record.failure.detail, record.step.id); await checkpoint("workflow-terminal"); return workflow; }
    if (!resumingAuthorization) workflow.usage.repairAttempts += 1;
    const attempt: AyasRepairAttemptRecord = resumingAuthorization
      ? workflow.repairHistory.find((item) => item.stepId === record.step.id)!
      : { attempt: workflow.repairHistory.length + 1, stepId: record.step.id, trigger: workflow.repairHistory.at(-1)?.retryReason ?? workflow.goal, proposalFingerprint: record.step.proposal.proposalFingerprint, patchFingerprint: fingerprint, graphifyEvidence: clone(record.step.proposal.graphifyFindings), authorizationState: "required" };
    if (!resumingAuthorization) workflow.repairHistory.push(attempt);
    const authorization = input.authorizations?.[record.step.id];
    if (!authorization) { record.state = "awaiting-authorization"; record.failure = { code: "authorization-required", detail: `explicit authorization is required for ${record.step.proposal.proposalId}`, retryable: false }; workflow.state = "awaiting-authorization"; event(workflow, "authorization-required", record.failure.detail, record.step.id); await checkpoint("workflow-terminal"); return workflow; }
    attempt.authorizationState = "approved"; workflow.usage.actions += 1; workflow.usage.writes += 1; workflow.usage.validations += record.step.proposal.validationActions.length;
    // The single most dangerous boundary — `repairHistory` already carries
    // this attempt's fingerprint (pushed above), so a checkpoint HERE means
    // a crash mid-`applyRepair` recovers into a workflow whose own
    // non-convergence check (above) blocks a naive resume from replaying
    // the same patch, even before the write's own precondition-hash check
    // would independently reject the replay (see AyasGuidedRepair.ts).
    await checkpoint("before-mutation");
    const applied = await deps.applyRepair(record.step.proposal, authorization, record.step.patches); record.result = applied; attempt.writeResult = applied; attempt.validationResult = applied.validations; workflow.usage.outputChars += JSON.stringify(applied).length;
    await checkpoint("after-mutation");
    if (workflow.usage.outputChars > workflow.budget.maxOutputChars) { record.state = "failed"; record.failure = { code: "output-truncation", detail: "workflow output budget exceeded", retryable: false }; workflow.state = "budget-exhausted"; workflow.terminalReason = record.failure.detail; event(workflow, "budget-exhausted", record.failure.detail, record.step.id); await checkpoint("workflow-terminal"); return workflow; }
    if (!applied.ok) {
      const failure = repairFailure(applied.reason ?? "repair failed"); record.state = "failed"; record.failure = failure; attempt.retryReason = failure.detail; if (failure.code === "invalid-authorization" || failure.code === "stale-authorization") attempt.authorizationState = "invalid";
      if (failure.code === "validation-failure" && record.step.allowAfterValidationFailure) { event(workflow, "validation-failed", failure.detail, record.step.id); workflow.state = "running"; await checkpoint("step-terminal"); continue; }
      attempt.terminalReason = failure.detail; workflow.state = failure.code === "invalid-authorization" || failure.code === "stale-authorization" ? "rejected" : "failed"; workflow.terminalReason = failure.detail; event(workflow, "repair-failed", `${failure.code}: ${failure.detail}`, record.step.id); await checkpoint("workflow-terminal"); return workflow;
    }
    record.state = "succeeded"; event(workflow, "repair-succeeded", record.step.expectedEvidence, record.step.id); await checkpoint("step-terminal");
  }
  const unresolvedFailure = workflow.steps.find((record) => record.state === "failed" && !record.step.allowAfterValidationFailure && !(record.step.kind === "graphify" && ["graphify-stale", "graphify-unavailable", "graphify-failure", "graphify-output-limit"].includes(record.failure?.code ?? "")));
  workflow.state = unresolvedFailure ? "failed" : "succeeded"; workflow.terminalReason = unresolvedFailure?.failure?.detail ?? "all eligible steps completed and required validations passed"; event(workflow, "workflow-terminal", workflow.terminalReason); await checkpoint("workflow-terminal"); return workflow;
}
