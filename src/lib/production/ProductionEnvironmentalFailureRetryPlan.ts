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
  type RuntimeStorageInput,
  getProjectRoot,
  resolveRuntimeStorageContext,
} from "@/lib/runtime/RuntimeStoragePaths";
import {
  type EnvironmentalFailureRetryChallengePayload,
  type EnvironmentalFailureRetryOperatorEvidence,
  type ProductionPipelineEnvironmentalFailureRetryExtensionBody,
  buildProductionPipelineEnvironmentalFailureRetryExtensionBody,
  computeEnvironmentalFailureRetryAuthorityId,
  computeEnvironmentalFailureRetryChallengePayload,
  isCredentialSensitiveStageFailureCode,
  readEnvironmentalFailureRetryExtensionAuthority,
  validateEnvironmentalFailureRetryOperatorEvidence,
  writeEnvironmentalFailureRetryExtensionAuthority,
} from "./ProductionPipelineEnvironmentalFailureRetryExtension";

/**
 * The single non-regeneration durable ordinal an environmental-failure retry
 * extension is bounded to reach. Base budget is 3 (`pipelineRetryMaxAttempts`),
 * the ordinal-4 retry-budget-extension adds one, and this mechanism adds exactly
 * one more -- never beyond. `PipelineRetryAdmission` independently hard-rejects
 * `admittedDurableOrdinal >= 6` for any non-regeneration retry.
 */
const ENVIRONMENTAL_FAILURE_CURRENT_DURABLE_ORDINAL = 4;
const ENVIRONMENTAL_FAILURE_PRIOR_JOB_ATTEMPTS =
  ENVIRONMENTAL_FAILURE_CURRENT_DURABLE_ORDINAL - 1;

export interface EnvironmentalFailureRetryPlanResult {
  readonly eligible: boolean;
  readonly mode: "environmental-failure-retry-plan";
  readonly projectSlug: string;
  readonly stage: ProductionStepKey;
  readonly jobId: string;
  readonly authorityId?: string;
  readonly challengePayload?: EnvironmentalFailureRetryChallengePayload;
  readonly reasonCode: string;
  readonly evidence: readonly string[];
}

export interface EnvironmentalFailureRetryApplyResult {
  readonly mode: "apply-environmental-failure-retry";
  readonly decision: "published" | "replayed" | "rejected";
  readonly success: boolean;
  readonly writePerformed: boolean;
  readonly readbackVerified: boolean;
  readonly authorityId: string;
  readonly projectSlug: string;
  readonly stage: ProductionStepKey;
  readonly jobId: string;
  readonly reasonCode: string;
  readonly evidence: readonly string[];
}

function planFailure(
  projectSlug: string,
  stage: ProductionStepKey,
  jobId: string,
  reasonCode: string,
  evidence: readonly string[],
): EnvironmentalFailureRetryPlanResult {
  return {
    eligible: false,
    mode: "environmental-failure-retry-plan",
    projectSlug, stage, jobId, reasonCode, evidence,
  };
}

export async function planEnvironmentalFailureRetryExtension(
  projectSlug: string,
  stage: ProductionStepKey,
  jobId: string,
  reason: string,
  operatorEvidence: EnvironmentalFailureRetryOperatorEvidence,
  input: RuntimeStorageInput = {},
): Promise<EnvironmentalFailureRetryPlanResult> {
  const context = resolveRuntimeStorageContext(input);
  const targetJobId = `${projectSlug}-${stage}`;
  if (jobId !== targetJobId) {
    return planFailure(projectSlug, stage, jobId,
      "ENVIRONMENTAL_FAILURE_RETRY_ARGUMENT_INVALID", ["argument:job-id-mismatch"]);
  }
  if (typeof reason !== "string" || !reason.trim()) {
    return planFailure(projectSlug, stage, jobId,
      "ENVIRONMENTAL_FAILURE_RETRY_ARGUMENT_INVALID", ["argument:reason-missing"]);
  }
  if (!validateEnvironmentalFailureRetryOperatorEvidence(operatorEvidence)) {
    return planFailure(projectSlug, stage, jobId,
      "ENVIRONMENTAL_FAILURE_RETRY_ARGUMENT_INVALID", ["argument:operator-evidence-invalid"]);
  }

  const projectPath = getProjectRoot(projectSlug, context);
  if (!fs.existsSync(projectPath)) {
    return planFailure(projectSlug, stage, jobId,
      "ENVIRONMENTAL_FAILURE_RETRY_NOT_ELIGIBLE", ["project:not-found"]);
  }

  let jobsText: string, manifestText: string, historyText: string;
  try {
    jobsText = fs.readFileSync(path.join(projectPath, "pipeline-jobs.json"), "utf8");
    manifestText = fs.readFileSync(path.join(projectPath, "manifest.json"), "utf8");
    historyText = fs.readFileSync(path.join(projectPath, "pipeline-history.json"), "utf8");
  } catch {
    return planFailure(projectSlug, stage, jobId,
      "ENVIRONMENTAL_FAILURE_RETRY_NOT_ELIGIBLE", ["project:files-unreadable"]);
  }

  const jobs = JSON.parse(jobsText);
  const manifest = JSON.parse(manifestText);
  const history = JSON.parse(historyText);

  const job = jobs.jobs?.find(
    (candidate: { id?: string; stage?: string; status?: string; attempts?: number;
      updatedAt?: string; regenerationId?: string }) =>
      candidate.id === jobId && candidate.stage === stage,
  );
  // Non-regeneration only, and exactly the state left behind after the ordinal-4
  // retry-budget-extension was itself consumed and failed.
  if (!job || job.status !== "failed" || job.attempts !== ENVIRONMENTAL_FAILURE_PRIOR_JOB_ATTEMPTS ||
    job.regenerationId) {
    return planFailure(projectSlug, stage, jobId, "ENVIRONMENTAL_FAILURE_RETRY_NOT_ELIGIBLE",
      [`job:status-${job?.status ?? "none"}:attempts-${job?.attempts ?? 0}` +
        (job?.regenerationId ? ":regeneration" : "")]);
  }

  const manifestPackage = manifest.packages?.[stage];
  if (!manifestPackage || manifestPackage.status !== "failed" ||
    typeof manifestPackage.error !== "string") {
    return planFailure(projectSlug, stage, jobId,
      "ENVIRONMENTAL_FAILURE_RETRY_NOT_ELIGIBLE", ["manifest:package-not-failed"]);
  }
  const observedFailureCode = manifestPackage.error;
  if (!isCredentialSensitiveStageFailureCode(observedFailureCode)) {
    return planFailure(projectSlug, stage, jobId, "ENVIRONMENTAL_FAILURE_RETRY_NOT_ELIGIBLE",
      [`manifest:failure-code-not-credential-sensitive:${observedFailureCode}`]);
  }

  const latestHistory = history.events
    ?.filter((event: { jobId?: string; stage?: string }) =>
      event.jobId === jobId && event.stage === stage).at(-1);
  if (!latestHistory || latestHistory.status !== "failed" ||
    latestHistory.errorCode !== observedFailureCode) {
    return planFailure(projectSlug, stage, jobId,
      "ENVIRONMENTAL_FAILURE_RETRY_NOT_ELIGIBLE", ["history:event-mismatch"]);
  }

  const adapter = new ProductionExecutionFilePersistenceAdapter({
    trustedRootDirectory: path.join(projectPath, "production-execution"),
    createRootDirectory: false,
  });

  const quiescent = await validateProductionGlobalTerminalQuiescence(adapter, projectSlug);
  if (!quiescent) {
    return planFailure(projectSlug, stage, jobId,
      "ENVIRONMENTAL_FAILURE_RETRY_NOT_ELIGIBLE", ["durable:global-quiescence-false"]);
  }

  const lineage = await classifyProductionDurableAttemptLineage(
    adapter, projectSlug, stage, ENVIRONMENTAL_FAILURE_PRIOR_JOB_ATTEMPTS, "exact",
  );
  if (lineage.status !== "valid" ||
    lineage.maximumRecordAttempt !== ENVIRONMENTAL_FAILURE_CURRENT_DURABLE_ORDINAL ||
    lineage.latestAttempt.state !== "failed") {
    return planFailure(projectSlug, stage, jobId, "ENVIRONMENTAL_FAILURE_RETRY_NOT_ELIGIBLE",
      [`durable:lineage-${lineage.status}`]);
  }

  let canonical;
  let terminalRecordFailure;
  try {
    const recordRead = await new AdapterBackedProductionExecutionDurableStorage(adapter)
      .read(lineage.latestAttempt.identity.recordId);
    if (!recordRead.record) throw new Error("record missing");
    terminalRecordFailure = recordRead.record.failure;
    const identity = buildProductionPipelineExecutionIdentity(
      { projectSlug, stage, runType: "resume" },
      { id: job.id, attempts: ENVIRONMENTAL_FAILURE_PRIOR_JOB_ATTEMPTS },
    );
    canonical = await readProductionCanonicalTerminalDurableLineage(
      adapter, identity, recordRead.record.identityFingerprint, undefined,
      recordRead.record.operation,
    );
  } catch {
    return planFailure(projectSlug, stage, jobId,
      "ENVIRONMENTAL_FAILURE_RETRY_NOT_ELIGIBLE", ["durable:terminal-lineage-unreadable"]);
  }

  if (
    canonical.record.state !== "cancelled" ||
    canonical.record.attempt !== ENVIRONMENTAL_FAILURE_CURRENT_DURABLE_ORDINAL ||
    canonical.record.maxAttempts !== ENVIRONMENTAL_FAILURE_CURRENT_DURABLE_ORDINAL ||
    canonical.lease.status !== "released" ||
    canonical.claim.state !== "abandoned" ||
    canonical.attempt.state !== "failed"
  ) {
    return planFailure(projectSlug, stage, jobId,
      "ENVIRONMENTAL_FAILURE_RETRY_NOT_ELIGIBLE", ["durable:terminal-state-invalid"]);
  }

  // The ordinal-4 attempt's own durable failure block must attest a provider
  // (outbound-call) failure that the runtime already classified as retryable.
  // This is the "durable/history evidence" gate: a bare
  // THUMBNAIL_ASSET_GENERATION_FAILED with a non-provider or non-retryable
  // failure block is refused.
  if (!terminalRecordFailure ||
    terminalRecordFailure.category !== "provider" ||
    terminalRecordFailure.retryable !== true ||
    terminalRecordFailure.failureCode !== observedFailureCode) {
    return planFailure(projectSlug, stage, jobId, "ENVIRONMENTAL_FAILURE_RETRY_NOT_ELIGIBLE",
      [`durable:failure-block-not-provider-retryable:` +
        `${terminalRecordFailure?.category ?? "none"}:${terminalRecordFailure?.retryable ?? "none"}`]);
  }

  let marker;
  try {
    marker = await readProductionAcceptanceMarker(projectSlug);
  } catch {
    return planFailure(projectSlug, stage, jobId,
      "ENVIRONMENTAL_FAILURE_RETRY_NOT_ELIGIBLE", ["marker:unreadable"]);
  }
  const acceptanceMarkerHash = stableProductionId("acceptance-marker-sha256", marker);
  const configurationFingerprint = marker.configurationFingerprint;
  const authorityFingerprint = stableProductionId("runtime-authority-fingerprint", {
    projectSlug,
    runtimeRoot: path.join(projectPath, "production-execution"),
  });

  const preMutationJobFingerprint = stableProductionId(
    "pipeline-job-pre-mutation", JSON.parse(JSON.stringify(job)),
  );
  const latestHistoryFingerprint = stableProductionId(
    "latest-history-event-fingerprint", latestHistory,
  );

  const challengePayload = computeEnvironmentalFailureRetryChallengePayload({
    currentDurableOrdinal: ENVIRONMENTAL_FAILURE_CURRENT_DURABLE_ORDINAL,
    failureClass: "external-provider-credential-invalid",
    projectSlug, stage, jobId, reason,
    observedFailureCode,
    priorJob: {
      id: job.id,
      status: "failed",
      attempts: ENVIRONMENTAL_FAILURE_PRIOR_JOB_ATTEMPTS,
      updatedAt: job.updatedAt,
      fingerprint: preMutationJobFingerprint,
    },
    manifestPackage: { status: "failed", failureCode: observedFailureCode },
    latestHistory: {
      eventId: latestHistory.id ?? latestHistory.eventId ?? `${job.id}-failed-event`,
      eventFingerprint: latestHistoryFingerprint,
    },
    terminalDurableAttempt: {
      recordId: canonical.record.recordId,
      recordState: canonical.record.state,
      recordAttempt: canonical.record.attempt,
      recordMaxAttempts: canonical.record.maxAttempts,
      recordIntegrityFingerprint: canonical.record.integrity.fingerprint,
      failureCategory: "provider",
      failureRetryable: true,
      failureCode: observedFailureCode,
      attemptId: canonical.attempt.identity.attemptId,
      attemptState: canonical.attempt.state,
      attemptIntegrityFingerprint: canonical.attempt.integrity.fingerprint,
      leaseId: canonical.lease.identity.leaseId,
      leaseState: canonical.lease.status,
      leaseIntegrityFingerprint: canonical.lease.integrity.fingerprint,
      claimId: canonical.claim.identity.claimId,
      claimState: canonical.claim.state,
      claimIntegrityFingerprint: canonical.claim.integrity.fingerprint,
      reservationId: canonical.claim?.identity?.reservationId ??
        canonical.attempt?.identity?.reservationId ?? canonical.record.identityFingerprint,
    },
    operatorEvidence,
    acceptanceMarkerHash,
    configurationFingerprint,
    authorityFingerprint,
  });

  const authorityId = computeEnvironmentalFailureRetryAuthorityId(challengePayload);

  // Single-use per stage: refuse if a DIFFERENT environmental-failure authority
  // already exists for this job (state drift). The exact same authorityId is the
  // idempotent-replay case and is fine.
  const conflict = existingEnvironmentalFailureAuthorityConflict(
    projectPath, projectSlug, jobId, authorityId, context,
  );
  if (conflict) {
    return planFailure(projectSlug, stage, jobId,
      "ENVIRONMENTAL_FAILURE_RETRY_NOT_ELIGIBLE", ["authority:existing-conflict"]);
  }

  return {
    eligible: true,
    mode: "environmental-failure-retry-plan",
    projectSlug, stage, jobId,
    authorityId,
    challengePayload,
    reasonCode: "ENVIRONMENTAL_FAILURE_RETRY_ELIGIBLE",
    evidence: [
      "plan:eligible-verified",
      `durable:ordinal-${ENVIRONMENTAL_FAILURE_CURRENT_DURABLE_ORDINAL}-terminal-provider-retryable`,
      `authorized:ordinal-${ENVIRONMENTAL_FAILURE_CURRENT_DURABLE_ORDINAL + 1}`,
    ],
  };
}

function existingEnvironmentalFailureAuthorityConflict(
  projectPath: string,
  projectSlug: string,
  jobId: string,
  computedAuthorityId: string,
  context: RuntimeStorageInput,
): boolean {
  const dir = path.join(projectPath, "production-execution", "retry-budget-extensions");
  if (!fs.existsSync(dir)) return false;
  let files: string[];
  try { files = fs.readdirSync(dir); } catch { return true; }
  for (const file of files) {
    if (!file.startsWith("envfail-authority-") || !file.endsWith(".json")) continue;
    const authorityId = file.slice("envfail-authority-".length, -".json".length);
    if (authorityId === computedAuthorityId) continue;
    const read = readEnvironmentalFailureRetryExtensionAuthority(projectSlug, authorityId, context);
    if (read.ok && read.value && read.value.jobId === jobId) return true;
  }
  return false;
}

export async function applyEnvironmentalFailureRetryExtension(
  projectSlug: string,
  stage: ProductionStepKey,
  jobId: string,
  reason: string,
  operatorEvidence: EnvironmentalFailureRetryOperatorEvidence,
  authorityId: string,
  confirmation: string,
  input: RuntimeStorageInput = {},
): Promise<EnvironmentalFailureRetryApplyResult> {
  const context = resolveRuntimeStorageContext(input);
  if (!authorityId || !confirmation || authorityId !== confirmation ||
    !/^[a-z0-9-]{16,128}$/i.test(authorityId)) {
    return {
      mode: "apply-environmental-failure-retry", decision: "rejected", success: false,
      writePerformed: false, readbackVerified: false,
      authorityId: authorityId ?? "", projectSlug, stage, jobId,
      reasonCode: "ENVIRONMENTAL_FAILURE_RETRY_CONFIRMATION_REQUIRED",
      evidence: ["confirmation:invalid-or-mismatched"],
    };
  }

  return PipelineJobManager.withProjectLock(projectSlug, async () => {
    const plan = await planEnvironmentalFailureRetryExtension(
      projectSlug, stage, jobId, reason, operatorEvidence, context,
    );
    if (!plan.eligible || !plan.authorityId || !plan.challengePayload) {
      return {
        mode: "apply-environmental-failure-retry", decision: "rejected" as const, success: false,
        writePerformed: false, readbackVerified: false,
        authorityId, projectSlug, stage, jobId,
        reasonCode: plan.reasonCode || "ENVIRONMENTAL_FAILURE_RETRY_STATE_DRIFT",
        evidence: [...plan.evidence],
      };
    }
    if (plan.authorityId !== authorityId) {
      return {
        mode: "apply-environmental-failure-retry", decision: "rejected" as const, success: false,
        writePerformed: false, readbackVerified: false,
        authorityId, projectSlug, stage, jobId,
        reasonCode: "ENVIRONMENTAL_FAILURE_RETRY_STATE_DRIFT",
        evidence: ["authority:computed-id-mismatch"],
      };
    }

    const existing = readEnvironmentalFailureRetryExtensionAuthority(projectSlug, authorityId, context);
    if (existing.ok && existing.value) {
      const recomputed = recomputeEnvironmentalFailureAuthorityId(existing.value);
      if (recomputed === authorityId) {
        return {
          mode: "apply-environmental-failure-retry", decision: "replayed" as const, success: true,
          writePerformed: false, readbackVerified: true,
          authorityId, projectSlug, stage, jobId,
          reasonCode: "ENVIRONMENTAL_FAILURE_RETRY_REPLAYED",
          evidence: ["apply:replayed-existing-authority"],
        };
      }
      return {
        mode: "apply-environmental-failure-retry", decision: "rejected" as const, success: false,
        writePerformed: false, readbackVerified: false,
        authorityId, projectSlug, stage, jobId,
        reasonCode: "ENVIRONMENTAL_FAILURE_RETRY_DURABLE_CONFLICT",
        evidence: ["apply:existing-authority-payload-conflict"],
      };
    }

    const issuedAt = new Date().toISOString();
    const body = buildProductionPipelineEnvironmentalFailureRetryExtensionBody(
      plan.challengePayload, issuedAt,
    );
    const writeResult = writeEnvironmentalFailureRetryExtensionAuthority(projectSlug, body, context);
    if (!writeResult.ok) {
      return {
        mode: "apply-environmental-failure-retry", decision: "rejected" as const, success: false,
        writePerformed: !writeResult.writeFree, readbackVerified: false,
        authorityId, projectSlug, stage, jobId,
        reasonCode: writeResult.reasonCode || "ENVIRONMENTAL_FAILURE_RETRY_PUBLICATION_FAILED",
        evidence: [...writeResult.evidence],
      };
    }

    const readback = readEnvironmentalFailureRetryExtensionAuthority(projectSlug, authorityId, context);
    if (!readback.ok || !readback.value) {
      return {
        mode: "apply-environmental-failure-retry", decision: "rejected" as const, success: false,
        writePerformed: true, readbackVerified: false,
        authorityId, projectSlug, stage, jobId,
        reasonCode: "ENVIRONMENTAL_FAILURE_RETRY_COMMIT_UNVERIFIED",
        evidence: ["apply:readback-failed-after-write"],
      };
    }

    return {
      mode: "apply-environmental-failure-retry",
      decision: writeResult.status === "replayed" ? "replayed" as const : "published" as const,
      success: true,
      writePerformed: !writeResult.writeFree,
      readbackVerified: true,
      authorityId, projectSlug, stage, jobId,
      reasonCode: "ENVIRONMENTAL_FAILURE_RETRY_PUBLISHED",
      evidence: ["apply:published-and-verified"],
    };
  });
}

function recomputeEnvironmentalFailureAuthorityId(
  body: ProductionPipelineEnvironmentalFailureRetryExtensionBody,
): string {
  const { integrity, authorityId, issuedAt, ...payload } = body;
  void integrity; void authorityId; void issuedAt;
  return computeEnvironmentalFailureRetryAuthorityId(
    payload as EnvironmentalFailureRetryChallengePayload,
  );
}
