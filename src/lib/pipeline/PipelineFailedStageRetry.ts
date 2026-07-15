import { reconcileFailedPipelineExecution } from "@/lib/production/ProductionPipelineRetryReconciliation";
import type { PipelineJob, PipelineJobList } from "@/types/pipelineJob";
import { PipelineJobManager } from "./PipelineJobManager";

export type PipelineFailedStageRetryPreparationResult =
  | { success: true; job: PipelineJob; previousJob: PipelineJob; jobs: PipelineJobList }
  | { success: false; status: 404 | 409; reason: string; reasonCode: string };

export async function prepareFailedStageRetry(
  projectSlug: string,
  jobId: string,
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

  const reconciliation = await reconcileFailedPipelineExecution(job);
  if (!reconciliation.ok) {
    return {
      success: false,
      status: 409,
      reason: "Pipeline durable retry reconciliation failed.",
      reasonCode: reconciliation.reasonCode,
    };
  }

  const prepared = await PipelineJobManager.prepareJobRetry(
    projectSlug,
    jobId,
    { updatedAt: job.updatedAt, attempts: job.attempts },
  );
  if (!prepared.success) {
    return {
      success: false,
      status: prepared.status,
      reason: prepared.error,
      reasonCode: prepared.reasonCode ?? "PIPELINE_RETRY_PREPARATION_REJECTED",
    };
  }
  return prepared;
}
