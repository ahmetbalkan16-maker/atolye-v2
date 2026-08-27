import fs from "node:fs";
import { reconcileFailedPipelineExecution } from "@/lib/production/ProductionPipelineRetryReconciliation";
import type { PipelineJob, PipelineJobList } from "@/types/pipelineJob";
import { PipelineJobManager } from "./PipelineJobManager";
import { buildProductionPipelineExecutionIdentity } from
  "@/lib/production/ProductionPipelineExecutionIdentity";
import { fingerprintPipelineJob, freezePipelineRetryAdmission, pipelineRetryMaxAttempts,
  type PipelineRetryAdmission } from "./PipelineRetryAdmission";
import type { ProjectPackageRunType } from "@/types/project";
import { buildProductionPipelineRetryAdmissionBinding } from
  "@/lib/production/ProductionPipelineRetryAdmissionBinding";
import {
  type RuntimeStorageInput,
  resolveRuntimeStorageContext,
} from "@/lib/runtime/RuntimeStoragePaths";
import {
  getRetryBudgetExtensionDirectory,
  readRetryBudgetExtensionAuthority,
} from "@/lib/production/ProductionPipelineRetryBudgetExtensionStore";
import { consumeRetryBudgetExtensionAndPrepareRetry } from "@/lib/production/ProductionPipelineRetryBudgetExtensionTransaction";
import { regenerationBindingForExecution } from
  "@/lib/production/ProductionCompletedStageRegenerationStore";
import {
  findMatchingRegenerationRetryBudgetExtension,
  buildProductionPipelineRegenerationRetryBudgetExtensionReceipt,
  writeRegenerationRetryBudgetExtensionReceipt,
} from "@/lib/production/ProductionPipelineRegenerationRetryBudgetExtension";

export type PipelineFailedStageRetryPreparationResult =
  | { success: true; job: PipelineJob; previousJob: PipelineJob; jobs: PipelineJobList;
      admission: PipelineRetryAdmission }
  | { success: false; status: 404 | 409; reason: string; reasonCode: string };

export async function prepareFailedStageRetry(
  projectSlug: string,
  jobId: string,
  runType: Extract<ProjectPackageRunType, "retry" | "resume"> = "retry",
  input: RuntimeStorageInput = {},
): Promise<PipelineFailedStageRetryPreparationResult> {
  const context = resolveRuntimeStorageContext(input);
  const job = await PipelineJobManager.getJob(projectSlug, jobId);
  if (!job || job.status !== "failed") {
    return {
      success: false,
      status: job ? 409 : 404,
      reason: job ? `Retry is not supported for "${job.status}" jobs.` : "Pipeline job not found.",
      reasonCode: "PIPELINE_RETRY_PREPARATION_REJECTED",
    };
  }

  const regeneration = regenerationBindingForExecution(
    projectSlug, job.stage, job.attempts, context);
  const generationStartAttempt = regeneration
    ? job.attempts - (job.attemptWithinGeneration ?? 0)
    : 0;
  const maxAttempts = regeneration
    ? generationStartAttempt + pipelineRetryMaxAttempts
    : pipelineRetryMaxAttempts;
  const currentDurableOrdinal = job.attempts + 1;
  const admittedJobAttemptIndex = job.attempts + 1;
  const admittedDurableOrdinal = admittedJobAttemptIndex + 1;

  let extensionAuthorityId: string | undefined;
  if (!regeneration && admittedDurableOrdinal === 4 && runType === "resume") {
    const dir = getRetryBudgetExtensionDirectory(projectSlug, context);
    if (fs.existsSync(dir)) {
      try {
        const files = fs.readdirSync(dir);
        for (const file of files) {
          if (file.startsWith("authority-") && file.endsWith(".json")) {
            const authId = file.slice("authority-".length, -".json".length);
            const authRead = readRetryBudgetExtensionAuthority(projectSlug, authId, context);
            if (
              authRead.ok &&
              authRead.value &&
              authRead.value.stage === job.stage &&
              authRead.value.jobId === job.id &&
              authRead.value.priorJob.attempts === job.attempts
            ) {
              extensionAuthorityId = authId;
              break;
            }
          }
        }
      } catch { /* ignore */ }
    }
  }

  // Sibling of the ordinal-4 lookup above, for a regeneration whose durable
  // history has already advanced past generationMaxAttempts (e.g. reopening
  // an orphan-recovered attempt via reconcileOrphanedReservationWithoutClaim).
  // Guarded by `regeneration` so it can never match — and never widens the
  // budget for — a non-regeneration job, or an ordinary regeneration retry
  // that's still within generationMaxAttempts (the lookup itself also
  // requires an authority file whose authorizedDurableOrdinal exactly equals
  // this admittedDurableOrdinal, and that hasn't already been consumed).
  const regenerationExtension = regeneration
    ? findMatchingRegenerationRetryBudgetExtension(
      projectSlug, job.stage, job, admittedDurableOrdinal, context,
    )
    : undefined;

  const budgetCeiling = extensionAuthorityId ? 4
    : regenerationExtension ? admittedDurableOrdinal
    : maxAttempts;
  if (!Number.isSafeInteger(job.attempts) || job.attempts < 0 || admittedDurableOrdinal > budgetCeiling) {
    return {
      success: false,
      status: 409,
      reason: "Pipeline retry attempt budget exceeded.",
      reasonCode: "PIPELINE_RETRY_MAX_ATTEMPTS_EXCEEDED",
    };
  }

  if (admittedDurableOrdinal === 4 && extensionAuthorityId) {
    const extResult = await consumeRetryBudgetExtensionAndPrepareRetry(
      projectSlug,
      job.stage,
      jobId,
      runType,
      extensionAuthorityId,
      context,
    );
    if (!extResult.success || !extResult.admission || !extResult.job || !extResult.previousJob || !extResult.jobs) {
      return {
        success: false,
        status: (extResult.status === 404 ? 404 : 409),
        reason: extResult.reason,
        reasonCode: extResult.reasonCode,
      };
    }
    return {
      success: true,
      job: extResult.job,
      previousJob: extResult.previousJob,
      jobs: extResult.jobs,
      admission: extResult.admission,
    };
  }

  const reconciliation = await reconcileFailedPipelineExecution(job, undefined, {
    storageContext: context,
  });
  if (!reconciliation.ok) {
    return {
      success: false,
      status: 409,
      reason: "Pipeline durable retry reconciliation failed.",
      reasonCode: reconciliation.reasonCode,
    };
  }

  if (!reconciliation.lineageIdentity || !reconciliation.lineageBinding ||
    reconciliation.lineageIdentity.core.attemptNumber !== job.attempts) {
    return {
      success: false,
      status: 409,
      reason: "Pipeline durable retry reconciliation identity is invalid.",
      reasonCode: "PIPELINE_RETRY_DURABLE_STATE_MISSING",
    };
  }

  const preMutationJobFingerprint = fingerprintPipelineJob(job);

  const prepared = await PipelineJobManager.prepareJobRetry(
    projectSlug,
    jobId,
    { updatedAt: job.updatedAt, attempts: job.attempts,
      fingerprint: preMutationJobFingerprint },
  );
  if (!prepared.success) {
    return {
      success: false,
      status: prepared.status,
      reason: prepared.error,
      reasonCode: prepared.reasonCode ?? "PIPELINE_RETRY_PREPARATION_REJECTED",
    };
  }
  if (prepared.job.attempts !== admittedJobAttemptIndex) {
    await PipelineJobManager.compensatePreparedRetry(projectSlug, prepared.previousJob, prepared.job);
    if (regenerationExtension) {
      const abortReceipt = buildProductionPipelineRegenerationRetryBudgetExtensionReceipt(
        regenerationExtension.authorityId, "aborted", new Date().toISOString(),
        job.updatedAt, ["transaction:admitted-attempt-mismatch-aborted"],
      );
      writeRegenerationRetryBudgetExtensionReceipt(projectSlug, abortReceipt, context);
    }
    return { success: false, status: 409,
      reason: "Pipeline retry admitted attempt changed.",
      reasonCode: "PIPELINE_RETRY_CAS_CONFLICT" };
  }
  // The regen-extension authority (if any) is single-use: mark it consumed
  // only once the CAS-protected retry preparation above has genuinely gone
  // through with the exact admitted attempt it authorized. Write-once and
  // idempotent — a replayed call after a crash between here and the return
  // below just re-reads the same "consumed" receipt.
  let regenerationExtensionConsumedReceipt:
    ReturnType<typeof buildProductionPipelineRegenerationRetryBudgetExtensionReceipt> | undefined;
  if (regenerationExtension) {
    regenerationExtensionConsumedReceipt = buildProductionPipelineRegenerationRetryBudgetExtensionReceipt(
      regenerationExtension.authorityId, "consumed", new Date().toISOString(),
      prepared.job.updatedAt, ["transaction:consumed-receipt-finalized"],
    );
    const writeConsumed = writeRegenerationRetryBudgetExtensionReceipt(
      projectSlug, regenerationExtensionConsumedReceipt, context,
    );
    if (!writeConsumed.ok && writeConsumed.status !== "replayed") {
      await PipelineJobManager.compensatePreparedRetry(projectSlug, prepared.previousJob, prepared.job);
      return { success: false, status: 409,
        reason: "Failed to record regeneration retry budget extension consumption.",
        reasonCode: "PIPELINE_RETRY_BUDGET_EXTENSION_COMMIT_UNVERIFIED" };
    }
    if (writeConsumed.value) regenerationExtensionConsumedReceipt = writeConsumed.value;
  }
  const admittedMaxAttempts = regenerationExtension ? admittedDurableOrdinal : maxAttempts;
  const admission: PipelineRetryAdmission = freezePipelineRetryAdmission({
    projectSlug, stage: job.stage, jobId: job.id, runType,
    priorJobAttemptIndex: job.attempts, currentDurableOrdinal,
    admittedJobAttemptIndex, admittedDurableOrdinal, maxAttempts: admittedMaxAttempts,
    ...(regenerationExtension ? {
      baseMaxAttempts: maxAttempts,
      effectiveMaxAttempts: admittedDurableOrdinal,
      authorizedDurableOrdinal: admittedDurableOrdinal,
      retryBudgetAuthorityProof: {
        authorityId: regenerationExtension.authorityId,
        authorityIntegrityFingerprint: regenerationExtension.body.integrity.fingerprint,
        consumptionReceiptFingerprint: regenerationExtensionConsumedReceipt!.integrity.fingerprint,
        authoritySchemaVersion: "1",
      },
    } : {}),
    exactReconciledDurableLineageIdentity: reconciliation.lineageIdentity,
    exactReconciledLineageBinding: reconciliation.lineageBinding,
    admittedDurableLineageIdentity: buildProductionPipelineExecutionIdentity(
      { projectSlug, stage: job.stage, runType, regeneration }, prepared.job,
    ),
    admittedExecutionBinding: buildProductionPipelineRetryAdmissionBinding(
      { projectSlug, stage: job.stage, runType, regeneration },
      prepared.job,
    ),
    priorJobStatus: "failed",
    preMutationJobFingerprint,
    preMutationJobVersion: job.updatedAt,
    admittedJobStatus: "queued",
    admittedJobFingerprint: fingerprintPipelineJob(prepared.job),
    admittedJobVersion: prepared.job.updatedAt,
  });
  return { ...prepared, admission };
}
