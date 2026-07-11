import { stableProductionId } from "./ProductionDeterminism";
import type { ProductionExecutionDryRunResult, ProductionExecutionJobPreview, ProductionExecutionRequest, ProductionPlanStep } from "@/types/productionIntelligence";

export class ProductionExecutionJobContract {
  static preview(request: ProductionExecutionRequest, result: ProductionExecutionDryRunResult, step: ProductionPlanStep): ProductionExecutionJobPreview {
    return { schemaVersion: 1, jobId: stableProductionId("job-preview", { requestId: request.requestId, operationKey: result.operation?.operationKey }), idempotencyKey: request.idempotencyKey, projectSlug: request.projectSlug, stage: request.stage, status: result.status, operationKey: result.operation?.operationKey, prerequisites: [...step.prerequisites], requiredInputs: (result.operation?.requiredInputs ?? []).map((key) => ({ key, source: key === "projectSlug" || key === "idempotencyKey" ? "request" : "project-state" })), expectedOutputs: (result.operation?.expectedOutputs ?? []).map((key) => ({ key, persistence: "preview-only" })) };
  }
}
