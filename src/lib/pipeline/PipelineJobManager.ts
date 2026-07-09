import { ProjectReader } from "@/lib/projects/ProjectReader";
import { ProjectWriter } from "@/lib/projects/ProjectWriter";
import { ProjectManager } from "@/lib/projects/ProjectManager";
import type { PackageStatus, ProductionStepKey } from "@/types/project";
import type {
  PipelineJob,
  PipelineJobAction,
  PipelineJobList,
  PipelineJobStatus,
} from "@/types/pipelineJob";

const pipelineJobsFileName = "pipeline-jobs.json";

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

  static async applyAction(
    projectSlug: string,
    jobId: string,
    action: PipelineJobAction,
  ): Promise<PipelineJobList | null> {
    const current = await this.listJobs(projectSlug);
    const job = current.jobs.find((item) => item.id === jobId);

    if (!job) {
      return null;
    }

    const now = new Date().toISOString();
    const jobs = current.jobs.map((item) => {
      if (item.id !== jobId) {
        return item;
      }

      if (action === "cancel") {
        return this.cancelJob(item, now);
      }

      return this.retryJob(item, now);
    });

    return this.writeJobList(projectSlug, {
      ...current,
      jobs,
      updatedAt: now,
    });
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
        id: `${projectSlug}-${packageManifest.key}`,
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

    return stored;
  }

  private static async writeJobList(
    projectSlug: string,
    jobList: PipelineJobList,
  ) {
    await ProjectWriter.writeJSON(projectSlug, pipelineJobsFileName, jobList);

    return jobList;
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
