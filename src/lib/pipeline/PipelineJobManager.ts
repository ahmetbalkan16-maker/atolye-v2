import { ProjectReader } from "@/lib/projects/ProjectReader";
import { ProjectWriter } from "@/lib/projects/ProjectWriter";
import { ProjectManager } from "@/lib/projects/ProjectManager";
import {
  PipelineStateError,
  type PipelineStateKind,
} from "./PipelineStateError";
import { getNextPipelineStage } from "./PipelineRecoveryPlanner";
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

const allowedStateTransitions: Record<
  PipelineJobStatus,
  readonly PipelineJobStatus[]
> = {
  queued: ["running", "cancelled"],
  running: ["completed", "failed", "cancelled"],
  completed: [],
  failed: ["queued"],
  cancelled: ["queued"],
};

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
  private static projectLocks = new Map<string, Promise<void>>();

  static async listJobs(projectSlug: string): Promise<PipelineJobList> {
    const current = await this.readJobList(projectSlug);

    if (current.jobs.length > 0) {
      return current;
    }

    return this.seedJobsFromManifest(projectSlug, current);
  }

  static async listHistory(projectSlug: string): Promise<PipelineJobHistory> {
    return this.readHistory(projectSlug);
  }

  static async getJob(
    projectSlug: string,
    jobId: string,
  ): Promise<PipelineJob | null> {
    const current = await this.listJobs(projectSlug);

    return current.jobs.find((job) => job.id === jobId) ?? null;
  }

  static async getJobReadOnly(
    projectSlug: string,
    jobId: string,
  ): Promise<PipelineJob | null> {
    const current = await this.readJobList(projectSlug);

    return current.jobs.find((job) => job.id === jobId) ?? null;
  }

  static async getJobForStage(
    projectSlug: string,
    stage: ProductionStepKey,
  ): Promise<PipelineJob | null> {
    const current = await this.listJobs(projectSlug);

    return current.jobs.find((job) => job.stage === stage) ?? null;
  }

  static async getJobForStageReadOnly(
    projectSlug: string,
    stage: ProductionStepKey,
  ): Promise<PipelineJob | null> {
    const current = await this.readJobList(projectSlug);

    return current.jobs.find((job) => job.stage === stage) ?? null;
  }

  static async prepareJobRetry(
    projectSlug: string,
    jobId: string,
  ): Promise<PipelineJobRetryPreparationResult> {
    return this.withProjectLock(projectSlug, async () => {
      const current = await this.listJobs(projectSlug);
      const job = current.jobs.find((item) => item.id === jobId);

      if (!job) {
        return {
          success: false,
          status: 404,
          error: "Pipeline job not found.",
        };
      }

      if (!this.canTransition(job.status, "queued")) {
        return {
          success: false,
          status: 409,
          error: `Retry is not supported for "${job.status}" jobs.`,
        };
      }

      const now = new Date().toISOString();
      const nextJob = this.retryJob(job, now);
      const jobs = current.jobs.map((item) =>
        item.id === jobId ? nextJob : item,
      );
      const nextJobs = await this.writeJobList(projectSlug, {
        ...current,
        jobs,
        updatedAt: now,
      });

      return {
        success: true,
        job: nextJob,
        previousJob: job,
        jobs: nextJobs,
      };
    });
  }

  static async compensatePreparedRetry(
    projectSlug: string,
    previousJob: PipelineJob,
    preparedJob: PipelineJob,
  ): Promise<boolean> {
    return this.withProjectLock(projectSlug, async () => {
      const current = await this.readJobList(projectSlug);
      const currentJob = current.jobs.find((job) => job.id === preparedJob.id);

      if (
        !currentJob ||
        currentJob.id !== previousJob.id ||
        currentJob.status !== "queued" ||
        currentJob.attempts !== preparedJob.attempts ||
        currentJob.cancelRequestedAt
      ) {
        return false;
      }

      const now = new Date().toISOString();
      await this.writeJobList(projectSlug, {
        ...current,
        jobs: current.jobs.map((job) =>
          job.id === preparedJob.id ? previousJob : job,
        ),
        updatedAt: now,
      });

      return true;
    });
  }

  static async persistStageSuccess(
    projectSlug: string,
    stage: ProductionStepKey,
    persist: () => Promise<void>,
  ): Promise<boolean> {
    return this.withProjectLock(projectSlug, async () => {
      const current = await this.listJobs(projectSlug);
      const job = current.jobs.find(
        (item) => item.id === getJobId(projectSlug, stage),
      );

      if (!this.canPersistStageResult(job)) {
        return false;
      }

      await persist();
      await this.transitionStageJobUnlocked(
        projectSlug,
        stage,
        "completed",
        (currentJob, now) => ({
          ...currentJob,
          status: "completed",
          updatedAt: now,
          completedAt: now,
          error: undefined,
        }),
        true,
      );

      return true;
    });
  }

  static async startStage(
    projectSlug: string,
    stage: ProductionStepKey,
    persist: () => Promise<void>,
  ): Promise<boolean> {
    return this.withProjectLock(projectSlug, async () => {
      const current = await this.listJobs(projectSlug);
      const job = current.jobs.find(
        (item) => item.id === getJobId(projectSlug, stage),
      );

      if (!job || !this.canTransition(job.status, "running")) {
        return false;
      }

      await persist();
      await this.transitionStageJobUnlocked(
        projectSlug,
        stage,
        "running",
        (currentJob, now) => ({
          ...currentJob,
          status: "running",
          updatedAt: now,
          startedAt: now,
          completedAt: undefined,
          cancelRequestedAt: undefined,
          error: undefined,
        }),
      );

      return true;
    });
  }

  static async persistStageFailure(
    projectSlug: string,
    stage: ProductionStepKey,
    persist: () => Promise<void>,
    error: string,
  ): Promise<boolean> {
    return this.withProjectLock(projectSlug, async () => {
      const current = await this.listJobs(projectSlug);
      const job = current.jobs.find(
        (item) => item.id === getJobId(projectSlug, stage),
      );

      if (!this.canPersistStageResult(job)) {
        return false;
      }

      await persist();
      await this.transitionStageJobUnlocked(
        projectSlug,
        stage,
        "failed",
        (currentJob, now) => ({
          ...currentJob,
          status: "failed",
          updatedAt: now,
          completedAt: now,
          error,
        }),
      );

      return true;
    });
  }

  static async persistProjectCompletion(
    projectSlug: string,
    persist: () => Promise<void>,
  ): Promise<boolean> {
    return this.withProjectLock(projectSlug, async () => {
      const current = await this.listJobs(projectSlug);
      const hasBlockingJob = current.jobs.some(
        (job) => job.status !== "completed",
      );

      if (hasBlockingJob) {
        return false;
      }

      await persist();

      return true;
    });
  }

  static async applyAction(
    projectSlug: string,
    jobId: string,
    action: PipelineJobAction,
  ): Promise<PipelineJobActionResult> {
    return this.withProjectLock(projectSlug, () =>
      this.applyActionUnlocked(projectSlug, jobId, action),
    );
  }

  private static async applyActionUnlocked(
    projectSlug: string,
    jobId: string,
    action: PipelineJobAction,
  ): Promise<PipelineJobActionResult> {
    if (action === "retry") {
      return {
        success: false,
        status: 409,
        error: "Retry must be executed through PipelineRunner.",
      };
    }

    const current = await this.listJobs(projectSlug);
    const job = current.jobs.find((item) => item.id === jobId);

    if (!job) {
      return {
        success: false,
        status: 404,
        error: "Pipeline job not found.",
      };
    }

    if (!this.canTransition(job.status, "cancelled")) {
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

      actionJob = this.cancelJob(item, now);
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
      cancelRequestedAt: now,
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
      cancelRequestedAt: undefined,
      error: undefined,
    };
  }

  private static canTransition(
    currentStatus: PipelineJobStatus,
    nextStatus: PipelineJobStatus,
  ) {
    return allowedStateTransitions[currentStatus].includes(nextStatus);
  }

  private static async transitionStageJobUnlocked(
    projectSlug: string,
    stage: ProductionStepKey,
    nextStatus: PipelineJobStatus,
    update: (job: PipelineJob, now: string) => PipelineJob,
    enqueueNextStage = false,
  ): Promise<PipelineJobList> {
    const current = await this.listJobs(projectSlug);
    const now = new Date().toISOString();
    const jobId = getJobId(projectSlug, stage);
    const existingJob = current.jobs.find((job) => job.id === jobId);
    const currentJob = existingJob ?? this.createJob(projectSlug, stage, now);

    if (!this.canTransition(currentJob.status, nextStatus)) {
      return current;
    }

    const nextJob = update(currentJob, now);
    let jobs = existingJob
      ? current.jobs.map((job) => (job.id === jobId ? nextJob : job))
      : [...current.jobs, nextJob];

    if (enqueueNextStage) {
      const nextStage = getNextPipelineStage(stage);
      const hasDownstreamJob = nextStage
        ? jobs.some((job) => job.stage === nextStage)
        : false;

      if (nextStage && !hasDownstreamJob) {
        jobs = [...jobs, this.createJob(projectSlug, nextStage, now)];
      }
    }

    const nextJobs = await this.writeJobList(projectSlug, {
      ...current,
      jobs,
      updatedAt: now,
    });

    await this.recordHistoryEvent(projectSlug, nextJob, now);

    return nextJobs;
  }

  private static canPersistStageResult(job: PipelineJob | undefined) {
    return job?.status === "running" && !job.cancelRequestedAt;
  }

  private static async withProjectLock<T>(
    projectSlug: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    let releaseCurrentLock: (() => void) | undefined;
    const currentLock = new Promise<void>((resolve) => {
      releaseCurrentLock = resolve;
    });
    const previousLock = this.projectLocks.get(projectSlug);

    this.projectLocks.set(projectSlug, currentLock);
    await previousLock;

    try {
      return await operation();
    } finally {
      releaseCurrentLock?.();

      if (this.projectLocks.get(projectSlug) === currentLock) {
        this.projectLocks.delete(projectSlug);
      }
    }
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
    const stored = await this.readPipelineStateFile(
      projectSlug,
      pipelineJobsFileName,
      (value): value is PipelineJobList => this.isJobList(value, projectSlug),
    );

    if (!stored) {
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
    await ProjectWriter.writeJSONAtomically(
      projectSlug,
      pipelineJobsFileName,
      jobList,
    );

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

    await ProjectWriter.writeJSONAtomically(
      projectSlug,
      pipelineHistoryFileName,
      {
        ...current,
        events: [...current.events, event],
        updatedAt: now,
      },
    );
  }

  private static async readHistory(
    projectSlug: string,
  ): Promise<PipelineJobHistory> {
    const now = new Date().toISOString();
    const stored = await this.readPipelineStateFile(
      projectSlug,
      pipelineHistoryFileName,
      (value): value is PipelineJobHistory =>
        this.isHistory(value, projectSlug),
    );

    if (!stored) {
      return {
        projectSlug,
        events: [],
        createdAt: now,
        updatedAt: now,
      };
    }

    return stored;
  }

  private static async readPipelineStateFile<T>(
    projectSlug: string,
    fileName: string,
    validate: (value: unknown) => value is T,
  ): Promise<T | null> {
    const state = getPipelineStateKind(fileName);
    let result: Awaited<
      ReturnType<typeof ProjectReader.readJSONState<unknown>>
    >;

    try {
      result = await ProjectReader.readJSONState<unknown>(
        projectSlug,
        fileName,
      );
    } catch (cause) {
      throw new PipelineStateError(state, "read-failed", fileName, { cause });
    }

    if (result.status === "missing") {
      return null;
    }

    if (result.status === "malformed") {
      throw new PipelineStateError(state, "malformed", fileName);
    }

    if (!validate(result.value)) {
      throw new PipelineStateError(state, "invalid", fileName);
    }

    return result.value;
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
      typeof record.updatedAt === "string" &&
      record.jobs.every(
        (job) => isPipelineJob(job) && job.projectSlug === projectSlug,
      )
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
      typeof record.updatedAt === "string" &&
      record.events.every(isPipelineJobHistoryEvent)
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

type PipelineJobRetryPreparationResult =
  | {
      success: true;
      job: PipelineJob;
      previousJob: PipelineJob;
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
    isProductionStepKey(job.stage) &&
    typeof job.title === "string" &&
    isPipelineJobStatus(job.status) &&
    typeof job.attempts === "number" &&
    Number.isFinite(job.attempts) &&
    typeof job.createdAt === "string" &&
    typeof job.updatedAt === "string" &&
    isOptionalString(job.startedAt) &&
    isOptionalString(job.completedAt) &&
    isOptionalString(job.cancelRequestedAt) &&
    isOptionalString(job.error)
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
    isProductionStepKey(event.stage) &&
    isPipelineJobHistoryStatus(event.status as PipelineJobStatus) &&
    typeof event.jobCreatedAt === "string" &&
    typeof event.jobUpdatedAt === "string" &&
    typeof event.recordedAt === "string" &&
    isOptionalString(event.startedAt) &&
    isOptionalString(event.completedAt)
  );
}

function isProductionStepKey(value: unknown): value is ProductionStepKey {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(stageLabels, value)
  );
}

function isOptionalString(value: unknown) {
  return value === undefined || typeof value === "string";
}

function getPipelineStateKind(fileName: string): PipelineStateKind {
  return fileName === pipelineJobsFileName ? "jobs" : "history";
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
