import { ProjectManager } from "@/lib/projects/ProjectManager";
import { PipelineJobManager } from "./PipelineJobManager";
import { pipelineRecoveryStageOrder } from "./PipelineRecoveryPlanner";
import type { ProductionStepKey } from "@/types/project";

export interface PipelineQueueScheduleResult {
  stage: ProductionStepKey | null;
  reason?: string;
}

export class PipelineQueueScheduler {
  static async getNextRunnableStage(
    projectSlug: string,
    stages: readonly ProductionStepKey[] = pipelineRecoveryStageOrder,
  ): Promise<PipelineQueueScheduleResult> {
    const [manifest, jobList] = await Promise.all([
      ProjectManager.getManifest(projectSlug),
      PipelineJobManager.listJobs(projectSlug),
    ]);

    if (!manifest) {
      return {
        stage: null,
        reason: "Project manifest could not be read.",
      };
    }

    const runningJob = jobList.jobs.find((job) => job.status === "running");

    if (runningJob) {
      return {
        stage: null,
        reason: `Stage "${runningJob.stage}" is already running.`,
      };
    }

    for (const stage of stages) {
      const packageStatus = manifest.packages[stage]?.status;
      const job = jobList.jobs.find((item) => item.stage === stage);
      const jobStatus = job?.status;

      if (jobStatus === "cancelled") {
        return {
          stage: null,
          reason: `Stage "${stage}" is cancelled.`,
        };
      }

      if (packageStatus === "completed" || jobStatus === "completed") {
        continue;
      }

      if (packageStatus === "failed" || jobStatus === "failed") {
        return {
          stage: null,
          reason: `Stage "${stage}" is failed and requires manual retry.`,
        };
      }

      if (packageStatus === "running" || jobStatus === "running") {
        return {
          stage: null,
          reason: `Stage "${stage}" is already running.`,
        };
      }

      if (jobStatus === "queued") {
        return { stage };
      }

      if (!jobStatus) {
        return { stage };
      }

      return {
        stage: null,
        reason: `Stage "${stage}" is not queued.`,
      };
    }

    return {
      stage: null,
      reason: "No queued stage is available.",
    };
  }
}
