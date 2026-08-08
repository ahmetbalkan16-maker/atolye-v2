import type { PipelineJob, PipelineJobList } from "@/types/pipelineJob";
import type { ProductionStepKey, ProjectPackageRunType } from "@/types/project";
import { PipelineJobManager } from "@/lib/pipeline/PipelineJobManager";
import { fingerprintPipelineJob, freezePipelineRetryAdmission, type PipelineRetryAdmission } from "@/lib/pipeline/PipelineRetryAdmission";
import { buildProductionPipelineExecutionIdentity } from "./ProductionPipelineExecutionIdentity";
import { buildProductionPipelineRetryAdmissionBinding } from "./ProductionPipelineRetryAdmissionBinding";
import { reconcileFailedPipelineExecution } from "./ProductionPipelineRetryReconciliation";
import { verifyCanonicalPipelineRetryBudgetExtensionAdmission } from "./ProductionPipelineRetryBudgetExtensionGate";
import {
  buildRetryBudgetExtensionDurableBinding,
  buildProductionPipelineRetryBudgetExtensionReceipt,
  type RetryBudgetExtensionDurableBinding,
} from "./ProductionPipelineRetryBudgetExtensionSchema";
import {
  readRetryBudgetExtensionAuthority,
  readRetryBudgetExtensionReceipt,
  writeRetryBudgetExtensionReceipt,
} from "./ProductionPipelineRetryBudgetExtensionStore";

export interface ExtensionTransactionResult {
  readonly success: boolean;
  readonly status: number;
  readonly reason: string;
  readonly reasonCode: string;
  readonly job?: PipelineJob;
  readonly previousJob?: PipelineJob;
  readonly jobs?: PipelineJobList;
  readonly admission?: PipelineRetryAdmission;
  readonly durableBinding?: RetryBudgetExtensionDurableBinding;
  readonly evidence: readonly string[];
}

import {
  type RuntimeStorageInput,
  resolveRuntimeStorageContext,
} from "@/lib/runtime/RuntimeStoragePaths";

export async function consumeRetryBudgetExtensionAndPrepareRetry(
  projectSlug: string,
  stage: ProductionStepKey,
  jobId: string,
  runType: Extract<ProjectPackageRunType, "retry" | "resume">,
  authorityId: string,
  input: RuntimeStorageInput = {},
): Promise<ExtensionTransactionResult> {
  const context = resolveRuntimeStorageContext(input);
  const gateCheck = await verifyCanonicalPipelineRetryBudgetExtensionAdmission({
    phase: "before-consumption",
    projectSlug,
    stage,
    jobId,
    runType,
    authorityId,
    input: context,
  });

  if (!gateCheck.ok || !gateCheck.authority) {
    return {
      success: false,
      status: 409,
      reason: "Retry budget extension authority is not eligible for consumption.",
      reasonCode: gateCheck.reasonCode || "PIPELINE_RETRY_BUDGET_EXTENSION_NOT_ELIGIBLE",
      evidence: [...gateCheck.evidence],
    };
  }

  const authority = gateCheck.authority;

  return PipelineJobManager.withProjectLock(projectSlug, async () => {
    const job = await PipelineJobManager.getJob(projectSlug, jobId);
    if (!job || job.status !== "failed" || job.attempts !== 2) {
      return {
        success: false,
        status: 409,
        reason: "Job state mismatch for retry budget extension.",
        reasonCode: "PIPELINE_RETRY_BUDGET_EXTENSION_STATE_DRIFT",
        evidence: [`job:status-${job?.status ?? "none"}:attempts-${job?.attempts ?? 0}`],
      };
    }

    const preMutationJobFingerprint = fingerprintPipelineJob(job);
    if (preMutationJobFingerprint !== authority.priorJob.fingerprint || job.updatedAt !== authority.priorJob.updatedAt) {
      return {
        success: false,
        status: 409,
        reason: "Job pre-mutation fingerprint mismatch.",
        reasonCode: "PIPELINE_RETRY_BUDGET_EXTENSION_STATE_DRIFT",
        evidence: ["job:fingerprint-mismatch"],
      };
    }

    const reconciliation = await reconcileFailedPipelineExecution(job, undefined, {
      storageContext: context,
    });
    if (!reconciliation.ok || !reconciliation.lineageIdentity || !reconciliation.lineageBinding) {
      return {
        success: false,
        status: 409,
        reason: "Pipeline durable retry reconciliation failed for extension.",
        reasonCode: reconciliation.ok ? "PIPELINE_RETRY_DURABLE_STATE_MISSING" : reconciliation.reasonCode,
        evidence: ["reconciliation:failed"],
      };
    }

    const now = new Date().toISOString();
    const consumingReceipt = buildProductionPipelineRetryBudgetExtensionReceipt(
      authorityId,
      "consuming",
      now,
      job.updatedAt,
      ["transaction:consuming-intent-published"],
    );

    const writeConsuming = writeRetryBudgetExtensionReceipt(projectSlug, consumingReceipt, context);
    if (!writeConsuming.ok && writeConsuming.status !== "replayed") {
      return {
        success: false,
        status: 409,
        reason: "Retry budget extension already consumed or in progress.",
        reasonCode: "PIPELINE_RETRY_BUDGET_EXTENSION_ALREADY_CONSUMED",
        evidence: [...writeConsuming.evidence],
      };
    }

    const prepared = await PipelineJobManager.prepareJobRetryUnderLock(
      projectSlug,
      jobId,
      { updatedAt: job.updatedAt, attempts: job.attempts, fingerprint: preMutationJobFingerprint },
    );

    if (!prepared.success) {
      const abortReceipt = buildProductionPipelineRetryBudgetExtensionReceipt(
        authorityId,
        "aborted",
        new Date().toISOString(),
        job.updatedAt,
        ["transaction:job-cas-failed-aborted"],
      );
      writeRetryBudgetExtensionReceipt(projectSlug, abortReceipt, context);
      return {
        success: false,
        status: prepared.status,
        reason: prepared.error,
        reasonCode: prepared.reasonCode ?? "PIPELINE_RETRY_PREPARATION_REJECTED",
        evidence: ["job:cas-failed"],
      };
    }

    if (prepared.job.attempts !== 3) {
      await PipelineJobManager.compensatePreparedRetry(projectSlug, prepared.previousJob, prepared.job);
      const abortReceipt = buildProductionPipelineRetryBudgetExtensionReceipt(
        authorityId,
        "aborted",
        new Date().toISOString(),
        job.updatedAt,
        ["transaction:admitted-attempt-mismatch-aborted"],
      );
      writeRetryBudgetExtensionReceipt(projectSlug, abortReceipt, context);
      return {
        success: false,
        status: 409,
        reason: "Pipeline retry admitted attempt index changed.",
        reasonCode: "PIPELINE_RETRY_CAS_CONFLICT",
        evidence: ["job:attempt-mismatch"],
      };
    }

    const consumedReceipt = buildProductionPipelineRetryBudgetExtensionReceipt(
      authorityId,
      "consumed",
      new Date().toISOString(),
      prepared.job.updatedAt,
      ["transaction:consumed-receipt-finalized"],
    );

    const writeConsumed = writeRetryBudgetExtensionReceipt(projectSlug, consumedReceipt, context);
    if (!writeConsumed.ok && writeConsumed.status !== "replayed") {
      return {
        success: false,
        status: 409,
        reason: "Failed to write consumed receipt for extension.",
        reasonCode: "PIPELINE_RETRY_BUDGET_EXTENSION_COMMIT_UNVERIFIED",
        evidence: [...writeConsumed.evidence],
      };
    }

    const admittedExecutionBinding = buildProductionPipelineRetryAdmissionBinding(
      { projectSlug, stage, runType },
      prepared.job,
    );
    const durableBinding: RetryBudgetExtensionDurableBinding =
      buildRetryBudgetExtensionDurableBinding({
      authorityId,
      authorityIntegrityFingerprint: authority.integrity.fingerprint,
      consumptionReceiptFingerprint: consumedReceipt.integrity.fingerprint,
      projectSlug,
      stage,
      jobId: job.id,
      identityFingerprint: admittedExecutionBinding.reservationIdentityFingerprint,
      reservationBinding: admittedExecutionBinding.reservationId,
    });

    const admission: PipelineRetryAdmission = freezePipelineRetryAdmission({
      projectSlug,
      stage,
      jobId: job.id,
      runType,
      priorJobAttemptIndex: job.attempts,
      currentDurableOrdinal: 3,
      admittedJobAttemptIndex: 3,
      admittedDurableOrdinal: 4,
      maxAttempts: 4,
      baseMaxAttempts: 3,
      effectiveMaxAttempts: 4,
      authorizedDurableOrdinal: 4,
      retryBudgetAuthorityProof: {
        authorityId,
        authorityIntegrityFingerprint: authority.integrity.fingerprint,
        consumptionReceiptFingerprint: consumedReceipt.integrity.fingerprint,
        authoritySchemaVersion: "1",
      },
      exactReconciledDurableLineageIdentity: reconciliation.lineageIdentity,
      exactReconciledLineageBinding: reconciliation.lineageBinding,
      admittedDurableLineageIdentity: buildProductionPipelineExecutionIdentity(
        { projectSlug, stage, runType },
        prepared.job,
      ),
      admittedExecutionBinding,
      priorJobStatus: "failed",
      preMutationJobFingerprint,
      preMutationJobVersion: job.updatedAt,
      admittedJobStatus: "queued",
      admittedJobFingerprint: fingerprintPipelineJob(prepared.job),
      admittedJobVersion: prepared.job.updatedAt,
    });

    return {
      success: true,
      status: 200,
      reason: "Pipeline retry budget extension admitted ordinal 4 successfully.",
      reasonCode: "PIPELINE_RETRY_BUDGET_EXTENSION_ADMITTED",
      job: prepared.job,
      previousJob: prepared.previousJob,
      jobs: prepared.jobs,
      admission,
      durableBinding,
      evidence: ["transaction:committed-verified"],
    };
  });
}

export async function recoverLingeringConsumingIntent(
  projectSlug: string,
  authorityId: string,
  input: RuntimeStorageInput = {},
): Promise<{ recovered: boolean; finalState: string }> {
  const context = resolveRuntimeStorageContext(input);
  const authorityRead = readRetryBudgetExtensionAuthority(projectSlug, authorityId, context);
  if (!authorityRead.ok || !authorityRead.value) {
    return { recovered: false, finalState: "not-found" };
  }
  const authority = authorityRead.value;
  const consumedRead = readRetryBudgetExtensionReceipt(projectSlug, authorityId, "consumed", context);
  if (consumedRead.ok) {
    return { recovered: true, finalState: "consumed" };
  }
  const abortedRead = readRetryBudgetExtensionReceipt(projectSlug, authorityId, "aborted", context);
  if (abortedRead.ok) {
    return { recovered: true, finalState: "aborted" };
  }

  const job = await PipelineJobManager.getJob(projectSlug, authority.jobId);
  if (job && job.status === "queued" && job.attempts === 3) {
    const consumedReceipt = buildProductionPipelineRetryBudgetExtensionReceipt(
      authorityId,
      "consumed",
      new Date().toISOString(),
      job.updatedAt,
      ["recovery:consumed-receipt-finalized"],
    );
    writeRetryBudgetExtensionReceipt(projectSlug, consumedReceipt, context);
    return { recovered: true, finalState: "consumed" };
  } else {
    const abortReceipt = buildProductionPipelineRetryBudgetExtensionReceipt(
      authorityId,
      "aborted",
      new Date().toISOString(),
      job?.updatedAt ?? authority.priorJob.updatedAt,
      ["recovery:job-untouched-aborted"],
    );
    writeRetryBudgetExtensionReceipt(projectSlug, abortReceipt, context);
    return { recovered: true, finalState: "aborted" };
  }
}
