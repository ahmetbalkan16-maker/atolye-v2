import type { ProductionActionType, ProductionExecutionDryRunResult, ProductionExecutionOperation, ProductionExecutionValidationResult } from "@/types/productionIntelligence";

const registry: Partial<Record<ProductionActionType, ProductionExecutionOperation>> = {
  "retry-stage": { operationKey: "pipeline.stage.retry.preview", serviceKey: "PipelineRunner.executeJobRetry", requiredInputs: ["projectSlug", "stage", "idempotencyKey"], expectedOutputs: ["pipeline-retry-result"], possibleWrites: ["manifest", "stage-output", "pipeline-job", "pipeline-history"], manifestEffects: ["stage-status-transition"] },
  "resume-stage": { operationKey: "pipeline.stage.resume.preview", serviceKey: "PipelineRunner.runFromStage", requiredInputs: ["projectSlug", "stage", "idempotencyKey"], expectedOutputs: ["pipeline-stage-result"], possibleWrites: ["manifest", "stage-output", "pipeline-job", "pipeline-history"], manifestEffects: ["stage-status-transition", "downstream-stage-enqueue"] },
};
export class ProductionExecutionGateway {
  static dryRun(validation: ProductionExecutionValidationResult): ProductionExecutionDryRunResult {
    const requestId = validation.request?.requestId ?? "rejected-request";
    if (!validation.valid || !validation.request) return { status: validation.code === "stale-plan" ? "stale" : validation.code === "blocked-step" ? "blocked" : "rejected", requestId, reasonCode: validation.code };
    const operation = registry[validation.request.actionType];
    if (!operation) return { status: "unsupported", requestId, reasonCode: "unsupported-action" };
    return { status: "prepared", requestId, operation: { ...operation, requiredInputs: [...operation.requiredInputs], expectedOutputs: [...operation.expectedOutputs], possibleWrites: [...operation.possibleWrites], manifestEffects: [...operation.manifestEffects] } };
  }
  static execute(): ProductionExecutionDryRunResult { return { status: "rejected", requestId: "rejected-request", reasonCode: "execute-mode-not-supported" }; }
}
