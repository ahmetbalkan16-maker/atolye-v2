/**
 * AYAS Schema-Bound Workflow Planner (Durable Workflow / Schema-Bound Planner sprint).
 *
 * Transforms a structured, UNTRUSTED intent into a validated `AyasDeveloperWorkflow`
 * — or a typed rejection, with ZERO workflow created and ZERO execution, ever.
 * The planner has no authority of its own; it is a deterministic translator
 * from a narrow intent shape into the SAME `AyasWorkflowStep[]`
 * `AyasDeveloperWorkflow.ts` already accepts from hand-written callers, then
 * hands the result to that file's OWN validator
 * (`createAyasDeveloperWorkflow` → `validateAyasDeveloperWorkflowPlan`).
 * Nothing here re-implements that validation — duplicating it would risk the
 * two drifting apart.
 *
 * Three closed registries bound everything the intent can name:
 *  - read/graphify/validation steps: `action` must be a real
 *    `AyasExecutionActionId` (`AyasExecutionPolicy.ts`'s own allowlist,
 *    checked via `validateAyasExecutionRequest` — the SAME deterministic
 *    gate the real dispatcher uses, not a parallel copy of it).
 *  - repair steps: the model/caller may NOT invent a proposal inside the
 *    planner's own narrow schema (that would reinvent
 *    `createAyasRepairProposal`'s own validation surface, badly). A repair
 *    step intent instead REFERENCES an already-created, already-validated
 *    `AyasRepairProposal` (produced by the existing diagnosis pipeline,
 *    `AyasGuidedRepairProduction.ts` today) — its fingerprint authenticity
 *    is re-verified here (`isAyasRepairProposalAuthentic`), so a tampered
 *    or hand-constructed fake proposal is rejected before it ever reaches
 *    the workflow.
 *  - budgets: a requested budget may only be EQUAL TO OR NARROWER THAN the
 *    deterministic default ceilings — `createAyasDeveloperWorkflow`'s own
 *    `validateAyasDeveloperWorkflowPlan` already enforces this
 *    (`budgetIsWithinAuthority`); the planner never raises it, and asking to
 *    escalate is rejected exactly the same way a hand-written caller's
 *    escalation attempt already is.
 *
 * The planner never bypasses authorization: every repair-kind step in the
 * resulting workflow is, by construction of `runAyasDeveloperWorkflow`
 * itself, unconditionally gated on `input.authorizations[stepId]` — there is
 * no planner-controlled path around that, because the planner never touches
 * that runtime at all, only produces the plan it will later run under.
 *
 * No DAG engine, no loops, no parallel mutation, no dynamic action creation.
 * `dependsOn` is the only structuring primitive, and even that is validated
 * (no forward/missing/cyclic references) by the existing plan validator —
 * the planner adds no new execution model of its own.
 */

import { validateAyasExecutionRequest, type AyasExecutionActionId } from "./AyasExecutionPolicy";
import { isAyasRepairProposalAuthentic, type AyasPatch, type AyasRepairProposal } from "./AyasGuidedRepair";
import {
  createAyasDeveloperWorkflow,
  AYAS_DEVELOPER_WORKFLOW_DEFAULT_BUDGET,
  type AyasDeveloperWorkflow,
  type AyasWorkflowBudget,
  type AyasWorkflowStep,
} from "./AyasDeveloperWorkflow";

export type AyasPlannerRejectionCode =
  | "empty-plan"
  | "too-many-steps"
  | "duplicate-step-id"
  | "invalid-step-id"
  | "unregistered-action"
  | "action-kind-mismatch"
  | "malformed-action-input"
  | "invalid-proposal-reference"
  | "proposal-fingerprint-mismatch"
  | "no-validation-for-repair"
  | "budget-escalation"
  | "invalid-goal"
  | "plan-rejected";

export interface AyasPlannerRejection {
  readonly ok: false;
  readonly code: AyasPlannerRejectionCode;
  readonly detail: string;
}
export interface AyasPlannerAcceptance {
  readonly ok: true;
  readonly workflow: AyasDeveloperWorkflow;
}
export type AyasPlannerOutcome = AyasPlannerAcceptance | AyasPlannerRejection;

/** The narrow, closed-registry-bound shape an AYAS reasoning intent may express for one step. Every field is UNTRUSTED input. */
export type AyasPlannerStepIntent =
  | {
      readonly id: string;
      readonly kind: "read" | "graphify" | "validation";
      /** Must be a real `AyasExecutionActionId` — validated, never trusted. */
      readonly action: string;
      readonly requestedBy: string;
      readonly intent: string;
      readonly plan: Readonly<Record<string, unknown>>;
      readonly dependsOn?: readonly string[];
      readonly expectedEvidence: string;
      readonly allowAfterValidationFailure?: boolean;
      readonly allowAfterEvidenceFailure?: boolean;
    }
  | {
      readonly id: string;
      readonly kind: "repair";
      /** A REFERENCE to an already-created, already-validated proposal — never constructed from raw planner input. */
      readonly proposal: AyasRepairProposal;
      readonly patches: readonly AyasPatch[];
      readonly dependsOn?: readonly string[];
      readonly expectedEvidence: string;
      readonly allowAfterValidationFailure?: boolean;
    };

export interface AyasPlannerIntent {
  readonly kind: "developer" | "automatic-repair";
  readonly goal: string;
  readonly steps: readonly AyasPlannerStepIntent[];
  /** Optional — the planner may request a budget NARROWER than the defaults, never wider. Omitted → the deterministic defaults. */
  readonly budget?: Partial<AyasWorkflowBudget>;
  readonly workflowId?: string;
}

const MAX_PLANNER_STEPS = AYAS_DEVELOPER_WORKFLOW_DEFAULT_BUDGET.maxSteps;
const STEP_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u;

function reject(code: AyasPlannerRejectionCode, detail: string): AyasPlannerRejection {
  return { ok: false, code, detail };
}

/**
 * A budget the caller requests may only narrow the deterministic defaults,
 * never widen them — this is a SEPARATE, EARLIER check than
 * `validateAyasDeveloperWorkflowPlan`'s own (which also enforces the same
 * thing) so the planner reports the more specific `budget-escalation` code
 * rather than the generic `invalid-workflow` one.
 */
function clampedOrRejectedBudget(requested: Partial<AyasWorkflowBudget> | undefined): AyasWorkflowBudget | AyasPlannerRejection {
  if (!requested) return AYAS_DEVELOPER_WORKFLOW_DEFAULT_BUDGET;
  const merged: AyasWorkflowBudget = { ...AYAS_DEVELOPER_WORKFLOW_DEFAULT_BUDGET, ...requested };
  for (const key of Object.keys(AYAS_DEVELOPER_WORKFLOW_DEFAULT_BUDGET) as (keyof AyasWorkflowBudget)[]) {
    const value = merged[key];
    if (!Number.isInteger(value) || value < 0) return reject("budget-escalation", `budget.${key} must be a non-negative integer`);
    if (value > AYAS_DEVELOPER_WORKFLOW_DEFAULT_BUDGET[key]) {
      return reject("budget-escalation", `budget.${key} (${value}) may not exceed the deterministic ceiling (${AYAS_DEVELOPER_WORKFLOW_DEFAULT_BUDGET[key]})`);
    }
  }
  return merged;
}

const KIND_ACTION: Readonly<Record<"graphify" | "validation", AyasExecutionActionId>> = Object.freeze({
  graphify: "query-graphify",
  validation: "run-developer-validation",
});

function buildStep(intent: AyasPlannerStepIntent): AyasWorkflowStep | AyasPlannerRejection {
  if (!STEP_ID_RE.test(intent.id)) return reject("invalid-step-id", `"${intent.id}" is not a safe step id`);
  if (!intent.expectedEvidence?.trim()) return reject("invalid-goal", `step "${intent.id}" is missing expectedEvidence`);

  if (intent.kind === "repair") {
    if (!isAyasRepairProposalAuthentic(intent.proposal)) {
      return reject("proposal-fingerprint-mismatch", `step "${intent.id}" references a proposal whose fingerprint does not authenticate — never constructed or trusted from raw planner input`);
    }
    if (!Array.isArray(intent.patches) || intent.patches.length === 0) {
      return reject("invalid-proposal-reference", `step "${intent.id}" repair has no patches`);
    }
    if (intent.proposal.validationActions.length === 0) {
      return reject("no-validation-for-repair", `step "${intent.id}" repair proposal has no registered validation — never planned without one`);
    }
    return {
      id: intent.id, kind: "repair", proposal: intent.proposal, patches: intent.patches,
      ...(intent.dependsOn ? { dependsOn: intent.dependsOn } : {}),
      expectedEvidence: intent.expectedEvidence,
      ...(intent.allowAfterValidationFailure ? { allowAfterValidationFailure: true } : {}),
    };
  }

  // read / graphify / validation — the action id is UNTRUSTED input; the
  // SAME deterministic gate the real dispatcher uses is reused here, not a
  // parallel copy of the allowlist.
  const validated = validateAyasExecutionRequest({
    schemaVersion: "1", action: intent.action, requestedBy: intent.requestedBy, intent: intent.intent, plan: intent.plan,
  });
  if (!validated.ok) {
    const code: AyasPlannerRejectionCode = validated.reason === "unknown-action" || validated.reason === "reserved-action-not-enabled" ? "unregistered-action" : "malformed-action-input";
    return reject(code, `step "${intent.id}": ${validated.detail}`);
  }
  if (validated.spec.write) {
    // Defense in depth — the allowlist this sprint draws from is entirely
    // read-only today, so this should be structurally unreachable, but the
    // planner never trusts that silently.
    return reject("unregistered-action", `step "${intent.id}" resolves to a write-classified action — the planner never plans a write action directly`);
  }
  if (intent.kind === "graphify" && validated.request.action !== KIND_ACTION.graphify) {
    return reject("action-kind-mismatch", `step "${intent.id}" is kind "graphify" but names action "${validated.request.action}"`);
  }
  if (intent.kind === "validation" && validated.request.action !== KIND_ACTION.validation) {
    return reject("action-kind-mismatch", `step "${intent.id}" is kind "validation" but names action "${validated.request.action}"`);
  }

  return {
    id: intent.id, kind: intent.kind, request: validated.request,
    ...(intent.dependsOn ? { dependsOn: intent.dependsOn } : {}),
    expectedEvidence: intent.expectedEvidence,
    ...(intent.allowAfterValidationFailure ? { allowAfterValidationFailure: true } : {}),
    ...(intent.allowAfterEvidenceFailure ? { allowAfterEvidenceFailure: true } : {}),
  };
}

/** Deterministic, pure, never throws — every outcome is a typed value. Creates NOTHING and executes NOTHING; a caller still has to hand the returned workflow to `runAyasDeveloperWorkflow` itself. */
export function planAyasDeveloperWorkflow(intent: AyasPlannerIntent): AyasPlannerOutcome {
  if (!intent.goal?.trim() || intent.goal.length > 2_000) return reject("invalid-goal", "goal is missing or too long");
  if (!Array.isArray(intent.steps) || intent.steps.length === 0) return reject("empty-plan", "at least one step is required");
  if (intent.steps.length > MAX_PLANNER_STEPS) return reject("too-many-steps", `at most ${MAX_PLANNER_STEPS} steps are permitted`);

  const budget = clampedOrRejectedBudget(intent.budget);
  if ("ok" in budget) return budget;

  const seen = new Set<string>();
  const steps: AyasWorkflowStep[] = [];
  for (const stepIntent of intent.steps) {
    if (seen.has(stepIntent.id)) return reject("duplicate-step-id", `duplicate step id "${stepIntent.id}"`);
    seen.add(stepIntent.id);
    const built = buildStep(stepIntent);
    if ("ok" in built) return built;
    steps.push(built);
  }

  try {
    const workflow = createAyasDeveloperWorkflow({ kind: intent.kind, goal: intent.goal, steps, budget, ...(intent.workflowId ? { workflowId: intent.workflowId } : {}) });
    return { ok: true, workflow };
  } catch (error) {
    // `createAyasDeveloperWorkflow` throws on any remaining structural
    // violation (forward/missing dependency, kind/action mismatch it
    // catches independently, a repair step with no validation action,
    // etc.) — surfaced here as a typed rejection rather than an exception,
    // so a caller never needs a try/catch around planning.
    return reject("plan-rejected", error instanceof Error ? error.message : String(error));
  }
}
