import { ProjectReader } from "@/lib/projects/ProjectReader";
import { ProjectWriter } from "@/lib/projects/ProjectWriter";
import { ProjectManager } from "@/lib/projects/ProjectManager";
import type { PackageStatus, ProductionStepKey } from "@/types/project";
import type {
  PipelineJob,
  PipelineJobAction,
  PipelineJobHistory,
  PipelineJobHistoryEvent,
  PipelineJobHistoryStatus,
  PipelineJobList,
  PipelineJobStatus,
} from "@/types/pipelineJob";

const pipelineJobsFileName = "pipeline-jobs.json";
const pipelineHistoryFileName = "pipeline-history.json";
const pipelineJobStatuses = [
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
] as const;

const stageLabels: Record<ProductionStepKey, string> = {
  research: "Research",
  script: "Script",
  scenes: "Scene Planning",
  visuals: "Visual Production",
  animation: "Animation",
  video: "Video",
  audio: "Audio",
  assembly: "Video Editing",
  thumbnail: "Thumbnail",
  seo: "SEO",
  youtube: "Publishing",
  export: "Export",
};

export class PipelineJobManager {
  static async listJobs(projectSlug: string): Promise<PipelineJobList> {
    const current = await this.readJobList(projectSlug);

    if (current.jobs.length > 0) {
      return current;
    }

    return this.seedJobsFromManifest(projectSlug, current);
  }

  static async markStageRunning(
    projectSlug: string,
    stage: ProductionStepKey,
  ): Promise<PipelineJobList> {
    return this.updateStageJob(projectSlug, stage, (job, now) => ({
      ...job,
      status: "running",
      updatedAt: now,
      startedAt: now,
      completedAt: undefined,
      error: undefined,
    }));
  }

  static async markStageCompleted(
    projectSlug: string,
    stage: ProductionStepKey,
  ): Promise<PipelineJobList> {
    return this.updateStageJob(projectSlug, stage, (job, now) => ({
      ...job,
      status: "completed",
      updatedAt: now,
      completedAt: now,
      error: undefined,
    }));
  }

  static async markStageFailed(
    projectSlug: string,
    stage: ProductionStepKey,
    error: string,
  ): Promise<PipelineJobList> {
    return this.updateStageJob(projectSlug, stage, (job, now) => ({
      ...job,
      status: "failed",
      updatedAt: now,
      completedAt: now,
      error,
    }));
  }

  static async applyAction(
    projectSlug: string,
    jobId: string,
    action: PipelineJobAction,
  ): Promise<PipelineJobActionResult> {
    const current = await this.listJobs(projectSlug);
    const job = current.jobs.find((item) => item.id === jobId);

    if (!job) {
      return {
        success: false,
        status: 404,
        error: "Pipeline job not found.",
      };
    }

    if (!this.canApplyAction(job.status, action)) {
      return {
        success: false,
        status: 409,
        error: `Action "${action}" is not supported for "${job.status}" jobs.`,
      };
    }

    const now = new Date().toISOString();
    let actionJob: PipelineJob | undefined;
    const jobs = current.jobs.map((item) => {
      if (item.id !== jobId) {
        return item;
      }

      if (action === "cancel") {
        actionJob = this.cancelJob(item, now);
        return actionJob;
      }

      actionJob = this.retryJob(item, now);
      return actionJob;
    });
    const nextJobs = await this.writeJobList(projectSlug, {
      ...current,
      jobs,
      updatedAt: now,
    });

    if (actionJob) {
      await this.recordHistoryEvent(projectSlug, actionJob, now);
    }

    return {
      success: true,
      jobs: nextJobs,
    };
  }

  private static cancelJob(job: PipelineJob, now: string): PipelineJob {
    if (job.status !== "queued" && job.status !== "running") {
      return job;
    }

    return {
      ...job,
      status: "cancelled",
      updatedAt: now,
      completedAt: now,
    };
  }

  private static retryJob(job: PipelineJob, now: string): PipelineJob {
    if (job.status !== "failed" && job.status !== "cancelled") {
      return job;
    }

    return {
      ...job,
      status: "queued",
      attempts: job.attempts + 1,
      updatedAt: now,
      startedAt: undefined,
      completedAt: undefined,
      error: undefined,
    };
  }

  private static canApplyAction(
    status: PipelineJobStatus,
    action: PipelineJobAction,
  ) {
    if (action === "cancel") {
      return status === "queued" || status === "running";
    }

    return status === "failed" || status === "cancelled";
  }

  private static async updateStageJob(
    projectSlug: string,
    stage: ProductionStepKey,
    update: (job: PipelineJob, now: string) => PipelineJob,
  ): Promise<PipelineJobList> {
    const current = await this.listJobs(projectSlug);
    const now = new Date().toISOString();
    const jobId = getJobId(projectSlug, stage);
    const existingJob = current.jobs.find((job) => job.id === jobId);
    const nextJob = update(
      existingJob ?? this.createJob(projectSlug, stage, now),
      now,
    );
    const jobs = existingJob
      ? current.jobs.map((job) => (job.id === jobId ? nextJob : job))
      : [...current.jobs, nextJob];

    const nextJobs = await this.writeJobList(projectSlug, {
      ...current,
      jobs,
      updatedAt: now,
    });

    await this.recordHistoryEvent(projectSlug, nextJob, now);

    return nextJobs;
  }

  private static createJob(
    projectSlug: string,
    stage: ProductionStepKey,
    now: string,
  ): PipelineJob {
    return {
      id: getJobId(projectSlug, stage),
      projectSlug,
      stage,
      title: stageLabels[stage],
      status: "queued",
      attempts: 0,
      createdAt: now,
      updatedAt: now,
    };
  }

  private static async seedJobsFromManifest(
    projectSlug: string,
    current: PipelineJobList,
  ): Promise<PipelineJobList> {
    const manifest = await ProjectManager.ensureManifest(projectSlug);
    const now = new Date().toISOString();

    if (!manifest) {
      return current;
    }

    const jobs: PipelineJob[] = Object.values(manifest.packages).map(
      (packageManifest) => ({
        id: getJobId(projectSlug, packageManifest.key),
        projectSlug,
        stage: packageManifest.key,
        title: stageLabels[packageManifest.key],
        status: toJobStatus(packageManifest.status),
        attempts: packageManifest.attempts?.total ?? 0,
        createdAt: packageManifest.updatedAt ?? manifest.createdAt,
        updatedAt: packageManifest.updatedAt ?? manifest.updatedAt,
        startedAt: packageManifest.startedAt,
        completedAt: packageManifest.completedAt,
        error: packageManifest.error,
      }),
    );

    return this.writeJobList(projectSlug, {
      ...current,
      jobs,
      updatedAt: now,
    });
  }

  private static async readJobList(
    projectSlug: string,
  ): Promise<PipelineJobList> {
    const now = new Date().toISOString();
    const stored = await ProjectReader.readJSON<unknown>(
      projectSlug,
      pipelineJobsFileName,
    );

    if (!this.isJobList(stored, projectSlug)) {
      return {
        projectSlug,
        jobs: [],
        createdAt: now,
        updatedAt: now,
      };
    }

    return {
      ...stored,
      jobs: stored.jobs.filter(isPipelineJob),
    };
  }

  private static async writeJobList(
    projectSlug: string,
    jobList: PipelineJobList,
  ) {
    await ProjectWriter.writeJSON(projectSlug, pipelineJobsFileName, jobList);

    return jobList;
  }

  private static async recordHistoryEvent(
    projectSlug: string,
    job: PipelineJob,
    now: string,
  ) {
    if (!isPipelineJobHistoryStatus(job.status)) {
      return;
    }

    const current = await this.readHistory(projectSlug);
    const event = createHistoryEvent(job, job.status, now);

    await ProjectWriter.writeJSON(projectSlug, pipelineHistoryFileName, {
      ...current,
      events: [...current.events, event],
      updatedAt: now,
    });
  }

  private static async readHistory(
    projectSlug: string,
  ): Promise<PipelineJobHistory> {
    const now = new Date().toISOString();
    const stored = await ProjectReader.readJSON<unknown>(
      projectSlug,
      pipelineHistoryFileName,
    );

    if (!this.isHistory(stored, projectSlug)) {
      return {
        projectSlug,
        events: [],
        createdAt: now,
        updatedAt: now,
      };
    }

    return {
      ...stored,
      events: stored.events.filter(isPipelineJobHistoryEvent),
    };
  }

  private static isJobList(
    value: unknown,
    projectSlug: string,
  ): value is PipelineJobList {
    if (!value || typeof value !== "object") {
      return false;
    }

    const record = value as PipelineJobList;

    return (
      record.projectSlug === projectSlug &&
      Array.isArray(record.jobs) &&
      typeof record.createdAt === "string" &&
      typeof record.updatedAt === "string"
    );
  }

  private static isHistory(
    value: unknown,
    projectSlug: string,
  ): value is PipelineJobHistory {
    if (!value || typeof value !== "object") {
      return false;
    }

    const record = value as PipelineJobHistory;

    return (
      record.projectSlug === projectSlug &&
      Array.isArray(record.events) &&
      typeof record.createdAt === "string" &&
      typeof record.updatedAt === "string"
    );
  }
}

type PipelineJobActionResult =
  | {
      success: true;
      jobs: PipelineJobList;
    }
  | {
      success: false;
      status: 404 | 409;
      error: string;
    };

function getJobId(projectSlug: string, stage: ProductionStepKey) {
  return `${projectSlug}-${stage}`;
}

function isPipelineJob(value: unknown): value is PipelineJob {
  if (!value || typeof value !== "object") {
    return false;
  }

  const job = value as PipelineJob;

  return (
    typeof job.id === "string" &&
    job.id.length > 0 &&
    typeof job.projectSlug === "string" &&
    typeof job.stage === "string" &&
    typeof job.title === "string" &&
    isPipelineJobStatus(job.status) &&
    typeof job.attempts === "number" &&
    Number.isFinite(job.attempts) &&
    typeof job.createdAt === "string" &&
    typeof job.updatedAt === "string"
  );
}

function isPipelineJobStatus(value: unknown): value is PipelineJobStatus {
  return pipelineJobStatuses.includes(value as PipelineJobStatus);
}

function isPipelineJobHistoryStatus(
  value: PipelineJobStatus,
): value is PipelineJobHistoryStatus {
  return (
    value === "completed" || value === "failed" || value === "cancelled"
  );
}

function createHistoryEvent(
  job: PipelineJob,
  status: PipelineJobHistoryStatus,
  now: string,
): PipelineJobHistoryEvent {
  return {
    id: `${job.id}-${status}-${now}`,
    jobId: job.id,
    stage: job.stage,
    status,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    jobCreatedAt: job.createdAt,
    jobUpdatedAt: job.updatedAt,
    recordedAt: now,
  };
}

function isPipelineJobHistoryEvent(
  value: unknown,
): value is PipelineJobHistoryEvent {
  if (!value || typeof value !== "object") {
    return false;
  }

  const event = value as PipelineJobHistoryEvent;

  return (
    typeof event.id === "string" &&
    event.id.length > 0 &&
    typeof event.jobId === "string" &&
    event.jobId.length > 0 &&
    typeof event.stage === "string" &&
    isPipelineJobHistoryStatus(event.status as PipelineJobStatus) &&
    typeof event.jobCreatedAt === "string" &&
    typeof event.jobUpdatedAt === "string" &&
    typeof event.recordedAt === "string"
  );
}

function toJobStatus(status: PackageStatus): PipelineJobStatus {
  if (status === "running") {
    return "running";
  }

  if (status === "completed") {
    return "completed";
  }

  if (status === "failed") {
    return "failed";
  }

  return "queued";
}
