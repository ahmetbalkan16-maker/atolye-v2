import type { ProductionStepKey } from "@/types/project";
import type { ProductionPipelineExecutionContext } from "./ProductionPipelineExecutionAdapter";
import { stableProductionId } from "./ProductionDeterminism";

export type ProductionPipelineIdentityVersion =
  | "production-pipeline-identity-v1"
  | "production-pipeline-identity-v2";

export interface VersionedProductionPipelineExecutionIdentity {
  readonly version: ProductionPipelineIdentityVersion;
  readonly core: {
    readonly projectSlug: string;
    readonly stage: ProductionStepKey;
    readonly jobId: string;
    readonly attemptNumber: number;
  };
  readonly requestId: string;
  readonly idempotencyKey: string;
  readonly executionFingerprint: string;
  readonly claimId: string;
  readonly leaseId: string;
  readonly attemptId: string;
  readonly recordId: string;
  readonly runningEventId: string;
  readonly terminalEventId: string;
}

export function buildVersionedProductionPipelineExecutionIdentity(
  version: ProductionPipelineIdentityVersion,
  context: ProductionPipelineExecutionContext,
  job: { id: string; attempts: number },
): VersionedProductionPipelineExecutionIdentity {
  if (version !== "production-pipeline-identity-v1" && version !== "production-pipeline-identity-v2") {
    throw new Error("UNSUPPORTED_LEGACY_IDENTITY_VERSION");
  }
  const core = {
    projectSlug: context.projectSlug,
    stage: context.stage,
    jobId: job.id,
    attemptNumber: job.attempts,
  };
  return {
    version,
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
