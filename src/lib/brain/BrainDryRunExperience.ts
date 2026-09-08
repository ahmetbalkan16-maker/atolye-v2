/**
 * Atölye Brain — dry-run plan → experience record (Sprint 181, PHASE 6).
 *
 * PHASE 3 of the sprint: the *foundation* for recording the safe part of a
 * dry-run plan (strategy, decisions, constraints, plan metadata) into the
 * Experience Store — without ever pretending a production happened.
 *
 * What this is NOT:
 *  - It never fabricates a stage outcome, a GPU temperature, a model result or
 *    a quality score. `stages` and `media` are empty; `qualityScore` is 0;
 *    `qualityOutcome` is `"reject"` (nothing was produced to release).
 *  - The record is stamped `mode: "dry-run"` and `finalStatus:
 *    "dry-run-planned"`. `deriveBrainExperienceInsights` skips it, and the
 *    store's `list()` hides it unless `includeDryRun` is asked for.
 *
 * The value it carries: the constraints the Safety Governor imposed, which
 * phases would need approval, where the plan is blocked, and the single next
 * step — all auditable later, none of it a claimed outcome.
 */

import { brainExperienceRecordId } from "./store/BrainExperienceStore";
import type { BrainRunPlan } from "./BrainOrchestrator";
import { redactBrainText } from "./BrainRedaction";
import type {
  BrainExperienceRecord,
  BrainProductionRequest,
  BrainSafetyVerdict,
  BrainStrategyRecommendation,
} from "@/types/brain";

export interface BrainDryRunExperienceInput {
  readonly request: BrainProductionRequest;
  readonly plan: BrainRunPlan;
  readonly safety: BrainSafetyVerdict;
  readonly recommendation?: BrainStrategyRecommendation;
  /** ISO instant the plan was produced. */
  readonly plannedAt: string;
}

/**
 * Build a `dry-run` experience record from a planner result. Deterministic:
 * same inputs → identical record (including `recordId`), so re-recording the
 * same plan is idempotent in the store.
 */
export function buildBrainDryRunExperienceRecord(
  input: BrainDryRunExperienceInput,
): BrainExperienceRecord {
  const { request, plan, safety, recommendation, plannedAt } = input;

  const constraints = [
    ...new Set(plan.phases.flatMap((phase) => phase.constraints)),
  ].sort();

  const approvalPhases = plan.phases
    .filter((phase) => phase.requiresApproval)
    .map((phase) => phase.phase);

  const strategyLabel = recommendation?.label ?? "dry-run/default-strategy";

  const notes = [
    "DRY RUN — no pipeline stage, model, GPU or network call was made.",
    `safety: ${safety.decision} (snapshot: ${safety.snapshotSource})`,
    `constraints: ${constraints.join(", ") || "none"}`,
    `approval-gated phases: ${approvalPhases.join(", ") || "none"}`,
    plan.firstBlockedPhase
      ? `first blocked phase: ${plan.firstBlockedPhase}`
      : "no blocked phases",
    `next single step: ${plan.nextSingleStep}`,
    ...(recommendation
      ? [`experience hint applied: ${recommendation.label} (from ${recommendation.derivedFromInsightCount} insight(s))`]
      : ["no prior experience — default strategy"]),
  ].map((line) => redactBrainText(line).text);

  return {
    schemaVersion: "1",
    recordId: brainExperienceRecordId({
      topic: request.topic,
      hardwareProfileId: request.hardwareProfileId,
      requestedAt: request.requestedAt,
      mode: "dry-run",
      planId: plan.planId,
    }),
    mode: "dry-run",
    topic: request.topic,
    topicCategory: request.topicCategory,
    hardwareProfileId: request.hardwareProfileId,
    qualityFloor: request.qualityFloor,
    requestedAt: request.requestedAt,
    completedAt: plannedAt,
    finalStatus: "dry-run-planned",
    strategyLabel,
    strategyConstraints: constraints,
    planId: plan.planId,
    notes,
    stages: [],
    media: [],
    totals: {
      wallClockMs: 0,
      promptTokens: 0,
      completionTokens: 0,
      aiCostUsd: 0,
      regenerationCount: 0,
    },
    qualityScore: 0,
    qualityOutcome: "reject",
    errorClasses: [],
  };
}
