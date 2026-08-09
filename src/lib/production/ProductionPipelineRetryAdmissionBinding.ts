import type { PipelineJob } from "@/types/pipelineJob";
import type { ProductionPipelineExecutionContext } from
  "./ProductionPipelineExecutionAdapter";
import { defaultProductionExecutionIdempotencyPolicy,
  buildProductionExecutionIdempotencyIdentity } from
  "./ProductionExecutionIdempotency";
import { stableProductionId } from "./ProductionDeterminism";
import { buildProductionPipelineExecutionIdentity } from
  "./ProductionPipelineExecutionIdentity";
import { productionPipelineExecutionAuthorizationAction } from
  "./ProductionPipelineExecutionSemantics";
import type { ProductionExecutionAuthorizationResult } from
  "@/types/productionExecutionAuthorization";
import type { ProductionExecutionConfirmationValidationResult } from
  "@/types/productionExecutionConfirmation";

const ttlSeconds = 31_536_000;

export interface ProductionPipelineRetryAdmissionBinding {
  readonly identity: ReturnType<typeof buildProductionPipelineExecutionIdentity>;
  readonly operation: string;
  readonly durableOrdinal: number;
  readonly maxAttempts: number;
  readonly reservationId: string;
  readonly workerId: string;
  readonly workerSessionId: string;
  readonly recordVersion: 1;
  readonly reservationVersion: 1;
  readonly claimVersion: 1;
  readonly attemptVersion: 1;
  readonly leaseVersion: 1;
  readonly reservationIdentityFingerprint: string;
  readonly recordIntegrityFingerprint: string;
  readonly recordIntegrityVersion: 1;
}

/** Pure canonical plan used independently by retry admission and its consumer. */
export function buildProductionPipelineRetryAdmissionBinding(
  context: ProductionPipelineExecutionContext,
  job: Pick<PipelineJob, "id" | "attempts" | "updatedAt" | "createdAt" |
    "attemptWithinGeneration">,
): ProductionPipelineRetryAdmissionBinding {
  const identity = buildProductionPipelineExecutionIdentity(context, job);
  const anchor = job.updatedAt ?? job.createdAt;
  const operation = `pipeline.stage.${context.runType}`;
  const maxAttempts = context.regeneration
    ? job.attempts - (job.attemptWithinGeneration ?? 0) + 3
    : job.attempts + 1 === 4 ? 4 : 3;
  const action = productionPipelineExecutionAuthorizationAction(context);
  const authorization: ProductionExecutionAuthorizationResult = {
    schemaVersion: "1", decisionId: stableProductionId("pipeline-authorization", identity.core),
    decision: "allow", authorized: true, reasonCode: "AUTHORIZED",
    reason: "trusted pipeline composition", evaluatedAt: anchor,
    requestId: identity.requestId, idempotencyKey: identity.idempotencyKey,
    executionFingerprint: identity.executionFingerprint, actorId: "pipeline-system",
    actorType: "system", projectSlug: context.projectSlug, operation,
    action, stage: context.stage, requiredCapabilities: [],
    grantedCapabilities: [], missingCapabilities: [], policyVersion: "pipeline-durable-v1",
    risk: "high", requiresConfirmation: true, requiredConfirmationLevel: "high",
    evidence: ["source:pipeline-composition"],
  };
  const confirmation: ProductionExecutionConfirmationValidationResult = {
    schemaVersion: "1", decision: "valid", valid: true, reasonCode: "CONFIRMATION_VALID",
    reason: "trusted pipeline composition", evaluatedAt: anchor,
    confirmationId: stableProductionId("pipeline-confirmation", identity.core),
    confirmationRequestId: stableProductionId("pipeline-confirmation-request", identity.core),
    authorizationDecisionId: authorization.decisionId, requestId: identity.requestId,
    idempotencyKey: identity.idempotencyKey, actorId: "pipeline-system",
    projectSlug: context.projectSlug, operation, action, stage: context.stage,
    riskLevel: "high", requiredConfirmationLevel: "high", providedConfirmationLevel: "high",
    bindingMatches: true,
    bindingFingerprint: stableProductionId("pipeline-confirmation-binding", identity.core),
    expired: false, singleUse: true, consumed: false, policyVersion: "pipeline-durable-v1",
    evidence: ["source:pipeline-composition"],
  };
  const idempotencyIdentity = buildProductionExecutionIdempotencyIdentity(
    { authorization, confirmation },
    { evaluatedAt: anchor, policy: { ...defaultProductionExecutionIdempotencyPolicy,
      enabled: true, reservationTtlSeconds: ttlSeconds,
      maximumAttemptsByAction: {
        ...defaultProductionExecutionIdempotencyPolicy.maximumAttemptsByAction,
        [action]: maxAttempts,
      } } },
  ).identity;
  if (!idempotencyIdentity) {
    throw new Error("PIPELINE_RETRY_ADMISSION_BINDING_CONSTRUCTION_FAILED");
  }
  return Object.freeze({ identity, operation, durableOrdinal: job.attempts + 1,
    maxAttempts, reservationId: idempotencyIdentity.identityFingerprint,
    workerId: "pipeline-worker",
    workerSessionId: "pipeline-session-v1",
    recordVersion: 1, reservationVersion: 1, claimVersion: 1, attemptVersion: 1,
    leaseVersion: 1,
    reservationIdentityFingerprint: idempotencyIdentity.identityFingerprint,
    recordIntegrityFingerprint: idempotencyIdentity.identityFingerprint,
    recordIntegrityVersion: 1 });
}
