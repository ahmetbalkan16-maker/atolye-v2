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

export type PipelineFailedStageRetryPreparationResult =
  | { success: true; job: PipelineJob; previousJob: PipelineJob; jobs: PipelineJobList;
      admission: PipelineRetryAdmission }
  | { success: false; status: 404 | 409; reason: string; reasonCode: string };

export async function prepareFailedStageRetry(
  projectSlug: string,
  jobId: string,
  runType: Extract<ProjectPackageRunType, "retry" | "resume"> = "retry",
): Promise<PipelineFailedStageRetryPreparationResult> {
  const job = await PipelineJobManager.getJob(projectSlug, jobId);
  if (!job || job.status !== "failed") {
    return {
      success: false,
      status: job ? 409 : 404,
      reason: job ? `Retry is not supported for "${job.status}" jobs.` : "Pipeline job not found.",
      reasonCode: "PIPELINE_RETRY_PREPARATION_REJECTED",
    };
  }

  const maxAttempts = pipelineRetryMaxAttempts;
  const currentDurableOrdinal = job.attempts + 1;
  const admittedJobAttemptIndex = job.attempts + 1;
  const admittedDurableOrdinal = admittedJobAttemptIndex + 1;
  if (!Number.isSafeInteger(job.attempts) || job.attempts < 0 ||
    admittedDurableOrdinal > maxAttempts) {
    return {
      success: false,
      status: 409,
      reason: "Pipeline retry attempt budget exceeded.",
      reasonCode: "PIPELINE_RETRY_MAX_ATTEMPTS_EXCEEDED",
    };
  }

  const reconciliation = await reconcileFailedPipelineExecution(job);
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
    return { success: false, status: 409,
      reason: "Pipeline retry admitted attempt changed.",
      reasonCode: "PIPELINE_RETRY_CAS_CONFLICT" };
  }
  const admission: PipelineRetryAdmission = freezePipelineRetryAdmission({
    projectSlug, stage: job.stage, jobId: job.id, runType,
    priorJobAttemptIndex: job.attempts, currentDurableOrdinal,
    admittedJobAttemptIndex, admittedDurableOrdinal, maxAttempts,
    exactReconciledDurableLineageIdentity: reconciliation.lineageIdentity,
    exactReconciledLineageBinding: reconciliation.lineageBinding,
    admittedDurableLineageIdentity: buildProductionPipelineExecutionIdentity(
      { projectSlug, stage: job.stage, runType }, prepared.job,
    ),
    admittedExecutionBinding: buildProductionPipelineRetryAdmissionBinding(
      { projectSlug, stage: job.stage, runType },
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
