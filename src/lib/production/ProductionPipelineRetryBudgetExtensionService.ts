import fs from "node:fs";
import path from "node:path";
import type { ProductionStepKey } from "@/types/project";
import { PipelineJobManager } from "@/lib/pipeline/PipelineJobManager";
import { readProductionAcceptanceMarker } from "./ProductionAcceptancePolicy";
import { ProductionExecutionFilePersistenceAdapter } from "./ProductionExecutionPersistence";
import { validateProductionGlobalTerminalQuiescence } from "./ProductionGlobalTerminalQuiescence";
import { classifyProductionDurableAttemptLineage } from "./ProductionDurableAttemptLineageClassifier";
import { AdapterBackedProductionExecutionDurableStorage } from "./ProductionExecutionDurableStorage";
import { readProductionCanonicalTerminalDurableLineage } from "./ProductionCanonicalDurableLineage";
import { buildProductionPipelineExecutionIdentity } from "./ProductionPipelineExecutionIdentity";
import { stableProductionId } from "./ProductionDeterminism";
import {
  type ProductionPipelineRetryBudgetExtensionBody,
  type ProductionPipelineRetryBudgetExtensionChallengePayload,
  buildProductionPipelineRetryBudgetExtensionBody,
  computeRetryBudgetExtensionAuthorityId,
  computeRetryBudgetExtensionChallengePayload,
} from "./ProductionPipelineRetryBudgetExtensionSchema";
import {
  readRetryBudgetExtensionAuthority,
  writeRetryBudgetExtensionAuthority,
} from "./ProductionPipelineRetryBudgetExtensionStore";

/**
 * Extracts the challenge payload fields from a published authority body,
 * returning a new immutable object containing only the fields that belong to
 * `ProductionPipelineRetryBudgetExtensionChallengePayload`.
 *
 * This explicit projection avoids unused-variable warnings that arise from
 * destructuring-based omission patterns and documents exactly which fields
 * are part of the challenge (excluding `authorityId`, `issuedAt`, `integrity`).
 */
function authorityChallengePayloadFromPublished(
  authority: ProductionPipelineRetryBudgetExtensionBody,
): ProductionPipelineRetryBudgetExtensionChallengePayload {
  return {
    schemaVersion: authority.schemaVersion,
    policyVersion: authority.policyVersion,
    authorizedRunType: authority.authorizedRunType,
    authorizedOperation: authority.authorizedOperation,
    currentDurableOrdinal: authority.currentDurableOrdinal,
    authorizedDurableOrdinal: authority.authorizedDurableOrdinal,
    baseMaxAttempts: authority.baseMaxAttempts,
    effectiveMaxAttempts: authority.effectiveMaxAttempts,
    projectSlug: authority.projectSlug,
    stage: authority.stage,
    jobId: authority.jobId,
    reason: authority.reason,
    failureCode: authority.failureCode,
    priorJob: authority.priorJob,
    manifestAudio: authority.manifestAudio,
    latestHistory: authority.latestHistory,
    exactDurableLineage: authority.exactDurableLineage,
    acceptanceMarkerHash: authority.acceptanceMarkerHash,
    configurationFingerprint: authority.configurationFingerprint,
    authorityFingerprint: authority.authorityFingerprint,
  };
}

export interface RetryBudgetExtensionPlanResult {

  readonly eligible: boolean;
  readonly mode: "retry-budget-extension-plan";
  readonly projectSlug: string;
  readonly stage: ProductionStepKey;
  readonly jobId: string;
  readonly authorityId?: string;
  readonly challengePayload?: ProductionPipelineRetryBudgetExtensionChallengePayload;
  readonly reasonCode: string;
  readonly evidence: readonly string[];
}

export interface RetryBudgetExtensionApplyResult {
  readonly mode: "extend-retry-budget";
  readonly decision: "published" | "replayed" | "rejected";
  readonly success: boolean;
  readonly writePerformed: boolean;
  readonly mutationState: "committed-verified" | "committed-unverified" | "write-free";
  readonly publicationAttempted: boolean;
  readonly publicationCommitted: boolean;
  readonly readbackVerified: boolean;
  readonly authorityId: string;
  readonly projectSlug: string;
  readonly stage: ProductionStepKey;
  readonly jobId: string;
  readonly reasonCode: string;
  readonly evidence: readonly string[];
}

import {
  type RuntimeStorageInput,
  getProjectRoot,
  resolveRuntimeStorageContext,
} from "@/lib/runtime/RuntimeStoragePaths";

export async function planRetryBudgetExtension(
  projectSlug: string,
  stage: ProductionStepKey,
  jobId: string,
  reason: string,
  input: RuntimeStorageInput = {},
): Promise<RetryBudgetExtensionPlanResult> {
  const context = resolveRuntimeStorageContext(input);
  const targetJobId = `${projectSlug}-${stage}`;
  if (jobId !== targetJobId) {
    return {
      eligible: false,
      mode: "retry-budget-extension-plan",
      projectSlug,
      stage,
      jobId,
      reasonCode: "PIPELINE_RETRY_BUDGET_EXTENSION_ARGUMENT_INVALID",
      evidence: ["argument:job-id-mismatch"],
    };
  }

  const projectPath = getProjectRoot(projectSlug, context);
  if (!fs.existsSync(projectPath)) {
    return {
      eligible: false,
      mode: "retry-budget-extension-plan",
      projectSlug,
      stage,
      jobId,
      reasonCode: "PIPELINE_RETRY_BUDGET_EXTENSION_NOT_ELIGIBLE",
      evidence: ["project:not-found"],
    };
  }

  let jobsText: string, manifestText: string, historyText: string;
  try {
    jobsText = fs.readFileSync(path.join(projectPath, "pipeline-jobs.json"), "utf8");
    manifestText = fs.readFileSync(path.join(projectPath, "manifest.json"), "utf8");
    historyText = fs.readFileSync(path.join(projectPath, "pipeline-history.json"), "utf8");
  } catch {
    return {
      eligible: false,
      mode: "retry-budget-extension-plan",
      projectSlug,
      stage,
      jobId,
      reasonCode: "PIPELINE_RETRY_BUDGET_EXTENSION_NOT_ELIGIBLE",
      evidence: ["project:files-unreadable"],
    };
  }

  const jobs = JSON.parse(jobsText);
  const manifest = JSON.parse(manifestText);
  const history = JSON.parse(historyText);

  const job = jobs.jobs?.find((j: { id?: string; stage?: string; status?: string; attempts?: number }) => j.id === jobId && j.stage === stage);
  if (!job || job.status !== "failed" || job.attempts !== 2) {
    return {
      eligible: false,
      mode: "retry-budget-extension-plan",
      projectSlug,
      stage,
      jobId,
      reasonCode: "PIPELINE_RETRY_BUDGET_EXTENSION_NOT_ELIGIBLE",
      evidence: [`job:status-${job?.status ?? "none"}:attempts-${job?.attempts ?? 0}`],
    };
  }

  const manifestPackage = manifest.packages?.[stage];
  if (!manifestPackage || manifestPackage.status !== "failed" || typeof manifestPackage.error !== "string") {
    return {
      eligible: false,
      mode: "retry-budget-extension-plan",
      projectSlug,
      stage,
      jobId,
      reasonCode: "PIPELINE_RETRY_BUDGET_EXTENSION_NOT_ELIGIBLE",
      evidence: ["manifest:package-not-failed"],
    };
  }

  const latestHistory = history.events?.filter((e: { jobId?: string; stage?: string; status?: string; errorCode?: string; id?: string; eventId?: string }) => e.jobId === jobId && e.stage === stage).at(-1);
  if (!latestHistory || latestHistory.status !== "failed" || latestHistory.errorCode !== manifestPackage.error) {
    return {
      eligible: false,
      mode: "retry-budget-extension-plan",
      projectSlug,
      stage,
      jobId,
      reasonCode: "PIPELINE_RETRY_BUDGET_EXTENSION_NOT_ELIGIBLE",
      evidence: ["history:event-mismatch"],
    };
  }

  const adapter = new ProductionExecutionFilePersistenceAdapter({
    trustedRootDirectory: path.join(projectPath, "production-execution"),
    createRootDirectory: false,
  });

  const quiescent = await validateProductionGlobalTerminalQuiescence(adapter, projectSlug);
  if (!quiescent) {
    return {
      eligible: false,
      mode: "retry-budget-extension-plan",
      projectSlug,
      stage,
      jobId,
      reasonCode: "PIPELINE_RETRY_BUDGET_EXTENSION_NOT_ELIGIBLE",
      evidence: ["durable:global-quiescence-false"],
    };
  }

  const lineage = await classifyProductionDurableAttemptLineage(adapter, projectSlug, stage, 2, "exact");
  if (lineage.status !== "valid" || lineage.maximumRecordAttempt !== 3 || lineage.latestAttempt.state !== "failed") {
    return {
      eligible: false,
      mode: "retry-budget-extension-plan",
      projectSlug,
      stage,
      jobId,
      reasonCode: "PIPELINE_RETRY_BUDGET_EXTENSION_NOT_ELIGIBLE",
      evidence: [`durable:lineage-${lineage.status}`],
    };
  }

  let canonical;
  try {
    const record = await new AdapterBackedProductionExecutionDurableStorage(adapter).read(lineage.latestAttempt.identity.recordId);
    if (!record.record) throw new Error("record missing");
    const identity = buildProductionPipelineExecutionIdentity(
      { projectSlug, stage, runType: "resume" },
      { id: job.id, attempts: 2 },
    );
    canonical = await readProductionCanonicalTerminalDurableLineage(
      adapter,
      identity,
      record.record.identityFingerprint,
      undefined,
      record.record.operation,
    );
  } catch {
    return {
      eligible: false,
      mode: "retry-budget-extension-plan",
      projectSlug,
      stage,
      jobId,
      reasonCode: "PIPELINE_RETRY_BUDGET_EXTENSION_NOT_ELIGIBLE",
      evidence: ["durable:terminal-lineage-unreadable"],
    };
  }

  if (
    canonical.record.state !== "cancelled" ||
    canonical.record.attempt !== 3 ||
    canonical.record.maxAttempts !== 3 ||
    canonical.lease.status !== "released" ||
    canonical.claim.state !== "abandoned" ||
    canonical.attempt.state !== "failed"
  ) {
    return {
      eligible: false,
      mode: "retry-budget-extension-plan",
      projectSlug,
      stage,
      jobId,
      reasonCode: "PIPELINE_RETRY_BUDGET_EXTENSION_NOT_ELIGIBLE",
      evidence: ["durable:terminal-state-invalid"],
    };
  }

  let marker;
  try {
    marker = await readProductionAcceptanceMarker(projectSlug);
  } catch {
    return {
      eligible: false,
      mode: "retry-budget-extension-plan",
      projectSlug,
      stage,
      jobId,
      reasonCode: "PIPELINE_RETRY_BUDGET_EXTENSION_NOT_ELIGIBLE",
      evidence: ["marker:unreadable"],
    };
  }

  const acceptanceMarkerHash = stableProductionId("acceptance-marker-sha256", marker);
  const configurationFingerprint = marker.configurationFingerprint;
  const authorityFingerprint = stableProductionId("runtime-authority-fingerprint", {
    projectSlug,
    runtimeRoot: path.join(projectPath, "production-execution"),
  });

  const preMutationJobFingerprint = stableProductionId(
    "pipeline-job-pre-mutation",
    JSON.parse(JSON.stringify(job)),
  );

  const latestHistoryFingerprint = stableProductionId("latest-history-event-fingerprint", latestHistory);

  const challengePayload = computeRetryBudgetExtensionChallengePayload({
    projectSlug,
    stage,
    jobId,
    reason,
    failureCode: manifestPackage.error,
    priorJob: {
      id: job.id,
      status: "failed",
      attempts: 2,
      updatedAt: job.updatedAt,
      fingerprint: preMutationJobFingerprint,
    },
    manifestAudio: {
      status: "failed",
      failureCode: manifestPackage.error,
    },
    latestHistory: {
      eventId: latestHistory.id ?? latestHistory.eventId ?? `${job.id}-failed-event`,
      eventFingerprint: latestHistoryFingerprint,
    },
    exactDurableLineage: {
      reservationId: canonical.claim?.identity?.reservationId ?? canonical.attempt?.identity?.reservationId ?? canonical.record.identityFingerprint,
      reservationFingerprint: canonical.record.identityFingerprint,
      recordId: canonical.record.recordId,
      recordState: canonical.record.state,
      recordAttempt: 3,
      recordMaxAttempts: 3,
      recordIntegrityFingerprint: canonical.record.integrity.fingerprint,
      leaseId: canonical.lease.identity.leaseId,
      leaseState: canonical.lease.status,
      leaseIntegrityFingerprint: canonical.lease.integrity.fingerprint,
      claimId: canonical.claim.identity.claimId,
      claimState: canonical.claim.state,
      claimIntegrityFingerprint: canonical.claim.integrity.fingerprint,
      attemptId: canonical.attempt.identity.attemptId,
      attemptState: canonical.attempt.state,
      attemptIntegrityFingerprint: canonical.attempt.integrity.fingerprint,
    },
    acceptanceMarkerHash,
    configurationFingerprint,
    authorityFingerprint,
  });

  const authorityId = computeRetryBudgetExtensionAuthorityId(challengePayload);

  return {
    eligible: true,
    mode: "retry-budget-extension-plan",
    projectSlug,
    stage,
    jobId,
    authorityId,
    challengePayload,
    reasonCode: "PIPELINE_RETRY_BUDGET_EXTENSION_ELIGIBLE",
    evidence: ["plan:eligible-verified"],
  };
}

export async function applyRetryBudgetExtension(
  projectSlug: string,
  stage: ProductionStepKey,
  jobId: string,
  reason: string,
  authorityId: string,
  confirmation: string,
  input: RuntimeStorageInput = {},
): Promise<RetryBudgetExtensionApplyResult> {
  const context = resolveRuntimeStorageContext(input);
  if (!authorityId || !confirmation || authorityId !== confirmation || !/^[a-z0-9-]{16,128}$/i.test(authorityId)) {
    return {
      mode: "extend-retry-budget",
      decision: "rejected",
      success: false,
      writePerformed: false,
      mutationState: "write-free",
      publicationAttempted: false,
      publicationCommitted: false,
      readbackVerified: false,
      authorityId: authorityId ?? "",
      projectSlug,
      stage,
      jobId,
      reasonCode: "PIPELINE_RETRY_BUDGET_EXTENSION_CONFIRMATION_REQUIRED",
      evidence: ["confirmation:invalid-or-mismatched"],
    };
  }

  return PipelineJobManager.withProjectLock(projectSlug, async () => {
    const plan = await planRetryBudgetExtension(projectSlug, stage, jobId, reason, context);
    if (!plan.eligible || !plan.authorityId || !plan.challengePayload) {
      return {
        mode: "extend-retry-budget",
        decision: "rejected",
        success: false,
        writePerformed: false,
        mutationState: "write-free",
        publicationAttempted: false,
        publicationCommitted: false,
        readbackVerified: false,
        authorityId,
        projectSlug,
        stage,
        jobId,
        reasonCode: plan.reasonCode || "PIPELINE_RETRY_BUDGET_EXTENSION_STATE_DRIFT",
        evidence: [...plan.evidence],
      };
    }

    if (plan.authorityId !== authorityId) {
      return {
        mode: "extend-retry-budget",
        decision: "rejected",
        success: false,
        writePerformed: false,
        mutationState: "write-free",
        publicationAttempted: false,
        publicationCommitted: false,
        readbackVerified: false,
        authorityId,
        projectSlug,
        stage,
        jobId,
        reasonCode: "PIPELINE_RETRY_BUDGET_EXTENSION_STATE_DRIFT",
        evidence: ["authority:computed-id-mismatch"],
      };
    }

    const existing = readRetryBudgetExtensionAuthority(projectSlug, authorityId, context);
    if (existing.ok && existing.value) {
      const existingPayload = authorityChallengePayloadFromPublished(existing.value);
      const computedId = computeRetryBudgetExtensionAuthorityId(existingPayload);

      if (computedId === authorityId) {
        return {
          mode: "extend-retry-budget",
          decision: "replayed",
          success: true,
          writePerformed: false,
          mutationState: "write-free",
          publicationAttempted: false,
          publicationCommitted: true,
          readbackVerified: true,
          authorityId,
          projectSlug,
          stage,
          jobId,
          reasonCode: "PIPELINE_RETRY_BUDGET_EXTENSION_REPLAYED",
          evidence: ["apply:replayed-existing-authority"],
        };
      }
      return {
        mode: "extend-retry-budget",
        decision: "rejected",
        success: false,
        writePerformed: false,
        mutationState: "write-free",
        publicationAttempted: false,
        publicationCommitted: false,
        readbackVerified: false,
        authorityId,
        projectSlug,
        stage,
        jobId,
        reasonCode: "PIPELINE_RETRY_BUDGET_EXTENSION_DURABLE_CONFLICT",
        evidence: ["apply:existing-authority-payload-conflict"],
      };
    }

    const issuedAt = new Date().toISOString();
    const body: ProductionPipelineRetryBudgetExtensionBody = buildProductionPipelineRetryBudgetExtensionBody(
      plan.challengePayload,
      issuedAt,
    );

    const writeResult = writeRetryBudgetExtensionAuthority(projectSlug, body, context);
    if (!writeResult.ok) {
      return {
        mode: "extend-retry-budget",
        decision: "rejected",
        success: false,
        writePerformed: !writeResult.writeFree,
        mutationState: writeResult.writeFree ? "write-free" : "committed-unverified",
        publicationAttempted: true,
        publicationCommitted: false,
        readbackVerified: false,
        authorityId,
        projectSlug,
        stage,
        jobId,
        reasonCode: writeResult.reasonCode || "PIPELINE_RETRY_BUDGET_EXTENSION_PUBLICATION_FAILED",
        evidence: [...writeResult.evidence],
      };
    }

    const readback = readRetryBudgetExtensionAuthority(projectSlug, authorityId, context);
    if (!readback.ok || !readback.value) {
      return {
        mode: "extend-retry-budget",
        decision: "rejected",
        success: false,
        writePerformed: true,
        mutationState: "committed-unverified",
        publicationAttempted: true,
        publicationCommitted: true,
        readbackVerified: false,
        authorityId,
        projectSlug,
        stage,
        jobId,
        reasonCode: "PIPELINE_RETRY_BUDGET_EXTENSION_COMMIT_UNVERIFIED",
        evidence: ["apply:readback-failed-after-write"],
      };
    }

    return {
      mode: "extend-retry-budget",
      decision: writeResult.status === "replayed" ? "replayed" : "published",
      success: true,
      writePerformed: !writeResult.writeFree,
      mutationState: "committed-verified",
      publicationAttempted: true,
      publicationCommitted: true,
      readbackVerified: true,
      authorityId,
      projectSlug,
      stage,
      jobId,
      reasonCode: writeResult.reasonCode,
      evidence: ["apply:published-and-verified"],
    };
  });
}
