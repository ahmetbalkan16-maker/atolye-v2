import type { ProductionPipelineExecutionContext } from "./ProductionPipelineExecutionAdapter";
import { createHash } from "node:crypto";
import { canonicalProductionSecurityValue, stableProductionId } from "./ProductionDeterminism";

export function buildProductionPipelineExecutionIdentity(
  context: ProductionPipelineExecutionContext,
  job: { id: string; attempts: number },
) {
  const core = {
    projectSlug: context.projectSlug,
    stage: context.stage,
    jobId: job.id,
    attemptNumber: job.attempts,
    ...(context.regeneration ? {
      regenerationId: context.regeneration.regenerationId,
      generationOrdinal: context.regeneration.generationOrdinal,
      planFingerprint: context.regeneration.planFingerprint,
      fromStage: context.regeneration.fromStage,
      reasonCode: context.regeneration.reasonCode,
    } : {}),
  };
  const id = context.regeneration ? secureId : stableProductionId;
  return {
    core,
    requestId: id("pipeline-request", core),
    idempotencyKey: id("pipeline-idempotency", core),
    executionFingerprint: id("pipeline-execution", { ...core, runType: context.runType }),
    claimId: id("pipeline-claim", core),
    leaseId: id("pipeline-lease", core),
    attemptId: id("pipeline-attempt", core),
    recordId: id("pipeline-record", core),
    runningEventId: id("pipeline-running", core),
    terminalEventId: id("pipeline-terminal", core),
  };
}

function secureId(prefix: string, value: unknown) {
  return `${prefix}-${createHash("sha256").update(
    canonicalProductionSecurityValue(value), "utf8").digest("hex")}`;
}
