import { stableProductionId } from "./ProductionDeterminism";
import type { ProductionStepKey } from "@/types/project";
import type { RetryBudgetExtensionDurableBinding } from
  "@/types/productionPipelineRetryBudgetExtension";

export type { RetryBudgetExtensionDurableBinding } from
  "@/types/productionPipelineRetryBudgetExtension";

export const retryBudgetExtensionSchemaVersion = "1" as const;
export const retryBudgetExtensionPolicyVersion = "retry-budget-extension-v1" as const;

export type RetryBudgetExtensionReceiptState = "issued" | "consuming" | "consumed" | "settled" | "aborted";

export interface ProductionPipelineRetryBudgetExtensionChallengePayload {
  readonly schemaVersion: typeof retryBudgetExtensionSchemaVersion;
  readonly policyVersion: typeof retryBudgetExtensionPolicyVersion;
  readonly authorizedRunType: "resume";
  readonly authorizedOperation: "pipeline.stage.resume";
  readonly currentDurableOrdinal: 3;
  readonly authorizedDurableOrdinal: 4;
  readonly baseMaxAttempts: 3;
  readonly effectiveMaxAttempts: 4;
  readonly projectSlug: string;
  readonly stage: ProductionStepKey;
  readonly jobId: string;
  readonly reason: string;
  readonly failureCode: string;
  readonly priorJob: {
    readonly id: string;
    readonly status: "failed";
    readonly attempts: 2;
    readonly updatedAt: string;
    readonly fingerprint: string;
  };
  readonly manifestAudio: {
    readonly status: "failed";
    readonly failureCode: string;
  };
  readonly latestHistory: {
    readonly eventId: string;
    readonly eventFingerprint: string;
  };
  readonly exactDurableLineage: {
    readonly reservationId: string;
    readonly reservationFingerprint: string;
    readonly recordId: string;
    readonly recordState: string;
    readonly recordAttempt: 3;
    readonly recordMaxAttempts: 3;
    readonly recordIntegrityFingerprint: string;
    readonly leaseId: string;
    readonly leaseState: string;
    readonly leaseIntegrityFingerprint: string;
    readonly claimId: string;
    readonly claimState: string;
    readonly claimIntegrityFingerprint: string;
    readonly attemptId: string;
    readonly attemptState: string;
    readonly attemptIntegrityFingerprint: string;
  };
  readonly acceptanceMarkerHash: string;
  readonly configurationFingerprint: string;
  readonly authorityFingerprint: string;
}

export interface ProductionPipelineRetryBudgetExtensionBody
  extends ProductionPipelineRetryBudgetExtensionChallengePayload {
  readonly authorityId: string;
  readonly issuedAt: string;
  readonly integrity: {
    readonly algorithm: "stable-production-id-v1";
    readonly fingerprint: string;
  };
}

export interface ProductionPipelineRetryBudgetExtensionReceipt {
  readonly schemaVersion: typeof retryBudgetExtensionSchemaVersion;
  readonly authorityId: string;
  readonly state: RetryBudgetExtensionReceiptState;
  readonly timestamp: string;
  readonly jobVersion: string;
  readonly evidence: readonly string[];
  readonly integrity: {
    readonly algorithm: "stable-production-id-v1";
    readonly fingerprint: string;
  };
}

export function buildRetryBudgetExtensionDurableBinding(
  input: Omit<RetryBudgetExtensionDurableBinding,
    "schemaVersion" | "authorizedDurableOrdinal" | "effectiveMaxAttempts" |
    "authorizedRunType" | "authorizedOperation" | "durableAttemptOrdinal">,
): RetryBudgetExtensionDurableBinding {
  return Object.freeze({
    schemaVersion: retryBudgetExtensionSchemaVersion,
    authorizedDurableOrdinal: 4,
    effectiveMaxAttempts: 4,
    authorizedRunType: "resume",
    authorizedOperation: "pipeline.stage.resume",
    durableAttemptOrdinal: 4,
    ...input,
  });
}

export function computeRetryBudgetExtensionChallengePayload(
  input: Omit<ProductionPipelineRetryBudgetExtensionChallengePayload, "schemaVersion" | "policyVersion" | "authorizedRunType" | "authorizedOperation" | "currentDurableOrdinal" | "authorizedDurableOrdinal" | "baseMaxAttempts" | "effectiveMaxAttempts">,
): ProductionPipelineRetryBudgetExtensionChallengePayload {
  return {
    schemaVersion: retryBudgetExtensionSchemaVersion,
    policyVersion: retryBudgetExtensionPolicyVersion,
    authorizedRunType: "resume",
    authorizedOperation: "pipeline.stage.resume",
    currentDurableOrdinal: 3,
    authorizedDurableOrdinal: 4,
    baseMaxAttempts: 3,
    effectiveMaxAttempts: 4,
    ...input,
  };
}

export function computeRetryBudgetExtensionAuthorityId(
  challengePayload: ProductionPipelineRetryBudgetExtensionChallengePayload,
): string {
  return stableProductionId("retry-budget-extension-authority", challengePayload);
}

export function buildProductionPipelineRetryBudgetExtensionBody(
  challengePayload: ProductionPipelineRetryBudgetExtensionChallengePayload,
  issuedAt: string,
): ProductionPipelineRetryBudgetExtensionBody {
  const authorityId = computeRetryBudgetExtensionAuthorityId(challengePayload);
  const core = {
    ...challengePayload,
    authorityId,
    issuedAt,
  };
  const fingerprint = stableProductionId("retry-budget-extension-body-integrity", core);
  return {
    ...core,
    integrity: {
      algorithm: "stable-production-id-v1",
      fingerprint,
    },
  };
}

export function buildProductionPipelineRetryBudgetExtensionReceipt(
  authorityId: string,
  state: RetryBudgetExtensionReceiptState,
  timestamp: string,
  jobVersion: string,
  evidence: readonly string[] = [],
): ProductionPipelineRetryBudgetExtensionReceipt {
  const core = {
    schemaVersion: retryBudgetExtensionSchemaVersion,
    authorityId,
    state,
    timestamp,
    jobVersion,
    evidence: [...evidence],
  };
  const fingerprint = stableProductionId("retry-budget-extension-receipt-integrity", core);
  return {
    ...core,
    integrity: {
      algorithm: "stable-production-id-v1",
      fingerprint,
    },
  };
}

export function validateExtensionBodyIntegrity(
  body: ProductionPipelineRetryBudgetExtensionBody,
): boolean {
  if (
    !body ||
    body.schemaVersion !== retryBudgetExtensionSchemaVersion ||
    body.policyVersion !== retryBudgetExtensionPolicyVersion ||
    body.authorizedDurableOrdinal !== 4 ||
    body.effectiveMaxAttempts !== 4 ||
    !body.integrity ||
    body.integrity.algorithm !== "stable-production-id-v1"
  ) {
    return false;
  }
  const { integrity, authorityId, issuedAt, ...payload } = body;
  const expectedFingerprint = stableProductionId("retry-budget-extension-body-integrity", { authorityId, issuedAt, ...payload });
  if (integrity.fingerprint !== expectedFingerprint) return false;
  const computedAuthorityId = computeRetryBudgetExtensionAuthorityId(payload as ProductionPipelineRetryBudgetExtensionChallengePayload);
  return computedAuthorityId === authorityId;
}

export function validateExtensionReceiptIntegrity(
  receipt: ProductionPipelineRetryBudgetExtensionReceipt,
): boolean {
  if (
    !receipt ||
    receipt.schemaVersion !== retryBudgetExtensionSchemaVersion ||
    !receipt.integrity ||
    receipt.integrity.algorithm !== "stable-production-id-v1"
  ) {
    return false;
  }
  const { integrity, ...core } = receipt;
  const expectedFingerprint = stableProductionId("retry-budget-extension-receipt-integrity", core);
  return integrity.fingerprint === expectedFingerprint;
}
