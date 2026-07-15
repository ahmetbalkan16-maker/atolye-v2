import type { ProductionPipelineExecutionContext } from "./ProductionPipelineExecutionAdapter";
import { stableProductionId } from "./ProductionDeterminism";

export function buildProductionPipelineExecutionIdentity(
  context: ProductionPipelineExecutionContext,
  job: { id: string; attempts: number },
) {
  const core = {
    projectSlug: context.projectSlug,
    stage: context.stage,
    jobId: job.id,
    attemptNumber: job.attempts,
  };
  return {
    core,
    requestId: stableProductionId("pipeline-request", core),
    idempotencyKey: stableProductionId("pipeline-idempotency", core),
    executionFingerprint: stableProductionId("pipeline-execution", { ...core, runType: context.runType }),
    claimId: stableProductionId("pipeline-claim", core),
    leaseId: stableProductionId("pipeline-lease", core),
    attemptId: stableProductionId("pipeline-attempt", core),
    recordId: stableProductionId("pipeline-record", core),
    runningEventId: stableProductionId("pipeline-running", core),
    terminalEventId: stableProductionId("pipeline-terminal", core),
  };
}
