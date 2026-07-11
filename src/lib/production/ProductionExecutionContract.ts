import { pipelineRecoveryStageOrder } from "@/lib/pipeline/PipelineRecoveryPlanner";
import { isValidProductionProjectSlug } from "./ProductionProjectSlug";
import { stableProductionId } from "./ProductionDeterminism";
import type { ProductionActionType, ProductionExecutionRequest, ProductionExecutionValidationResult, ProductionPlan, ProductionPlanStep } from "@/types/productionIntelligence";

const allowedActions: readonly ProductionActionType[] = ["inspect-source", "reconcile-state", "retry-stage", "resume-stage", "review-metric"];
export class ProductionExecutionContract {
  static build(projectSlug: string, plan: ProductionPlan, step: ProductionPlanStep, confirmationProvided = false): ProductionExecutionRequest {
    const identity = { projectSlug, fingerprint: plan.snapshotFingerprint, planId: plan.id, stepId: step.id, actionType: step.actionType, stage: step.stage };
    return { schemaVersion: 1, requestId: stableProductionId("request", identity), idempotencyKey: stableProductionId("execution", identity), projectSlug, snapshotFingerprint: plan.snapshotFingerprint, planId: plan.id, stepId: step.id, actionType: step.actionType, stage: step.stage, mode: "dry-run", confirmation: step.confirmationRequired ? confirmationProvided ? "provided" : "required-not-provided" : "not-required" };
  }
  static validate(request: ProductionExecutionRequest, plan: ProductionPlan, currentSnapshotFingerprint: string): ProductionExecutionValidationResult {
    if (!isValidProductionProjectSlug(request.projectSlug)) return { valid: false, code: "invalid-slug" };
    if (!allowedActions.includes(request.actionType)) return { valid: false, code: "invalid-action" };
    if (request.snapshotFingerprint !== currentSnapshotFingerprint || plan.snapshotFingerprint !== currentSnapshotFingerprint) return { valid: false, code: "stale-plan" };
    const step = plan.steps.find((item) => item.id === request.stepId);
    if (!step || request.planId !== plan.id || request.mode !== "dry-run") return { valid: false, code: "invalid-request" };
    if (step.status === "blocked") return { valid: false, code: "blocked-step" };
    if (request.stage !== step.stage || (request.stage && !pipelineRecoveryStageOrder.includes(request.stage))) return { valid: false, code: "stage-mismatch" };
    if (request.actionType !== step.actionType) return { valid: false, code: "invalid-action" };
    if (step.confirmationRequired && request.confirmation !== "provided") return { valid: false, code: "confirmation-required" };
    return { valid: true, code: "valid", request };
  }
}
