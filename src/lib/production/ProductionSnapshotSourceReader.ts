import { ProjectReader } from "@/lib/projects/ProjectReader";
import { PipelineJobManager } from "@/lib/pipeline/PipelineJobManager";
import { pipelineRecoveryStageOrder } from "@/lib/pipeline/PipelineRecoveryPlanner";
import type { AIUsageLog, AIUsageRecord } from "@/types/aiUsage";
import type {
  PipelineJob,
  PipelineJobHistory,
  PipelineJobHistoryEvent,
  PipelineJobList,
} from "@/types/pipelineJob";
import type {
  ProductionStepKey,
  Project,
  ProjectManifest,
} from "@/types/project";
import type { ProductionSnapshotSourceState } from "@/types/productionSnapshot";

const stageOutputFiles: Record<ProductionStepKey, string> = {
  research: "research.json",
  script: "script.json",
  scenes: "scenes.json",
  visuals: "visuals.json",
  animation: "animation.json",
  video: "video.json",
  audio: "audio.json",
  assembly: "assembly.json",
  thumbnail: "thumbnail.json",
  seo: "seo.json",
  youtube: "youtube.json",
  export: "export.json",
};

export interface ProductionSnapshotSource<T> {
  data?: T;
  state: ProductionSnapshotSourceState;
}

export interface ProductionSnapshotSourceBundle {
  projectSlug: string;
  project: ProductionSnapshotSource<Project>;
  manifest: ProductionSnapshotSource<ProjectManifest>;
  jobs: ProductionSnapshotSource<PipelineJobList>;
  history: ProductionSnapshotSource<PipelineJobHistory>;
  aiUsage: ProductionSnapshotSource<AIUsageLog>;
  stageOutputs: Record<
    ProductionStepKey,
    ProductionSnapshotSource<unknown>
  >;
}

export class ProductionSnapshotSourceReader {
  static async read(projectSlug: string): Promise<ProductionSnapshotSourceBundle> {
    return PipelineJobManager.withProjectLock(projectSlug, () =>
      this.readSources(projectSlug),
    );
  }

  private static async readSources(
    projectSlug: string,
  ): Promise<ProductionSnapshotSourceBundle> {
    const [project, manifest, jobs, history, aiUsage, outputEntries] =
      await Promise.all([
        readValidatedSource(projectSlug, "project.json", (value) =>
          isProject(value, projectSlug),
        ),
        readValidatedSource(projectSlug, "manifest.json", (value) =>
          isManifest(value, projectSlug),
        ),
        readValidatedSource(projectSlug, "pipeline-jobs.json", (value) =>
          isJobList(value, projectSlug),
        ),
        readValidatedSource(projectSlug, "pipeline-history.json", (value) =>
          isHistory(value, projectSlug),
        ),
        readValidatedSource(projectSlug, "ai-usage.json", (value) =>
          isUsageLog(value, projectSlug),
        ),
        Promise.all(
          pipelineRecoveryStageOrder.map(async (stage) => [
            stage,
            await readOutputSource(projectSlug, stageOutputFiles[stage]),
          ] as const),
        ),
      ]);

    return {
      projectSlug,
      project,
      manifest,
      jobs,
      history,
      aiUsage,
      stageOutputs: Object.fromEntries(outputEntries) as Record<
        ProductionStepKey,
        ProductionSnapshotSource<unknown>
      >,
    };
  }
}

async function readValidatedSource<T>(
  projectSlug: string,
  fileName: string,
  validate: (value: unknown) => value is T,
): Promise<ProductionSnapshotSource<T>> {
  try {
    const result = await ProjectReader.readJSONState<unknown>(
      projectSlug,
      fileName,
    );

    if (result.status === "missing") {
      return { state: { status: "missing" } };
    }

    if (result.status === "malformed" || !validate(result.value)) {
      return { state: { status: "malformed" } };
    }

    return { data: result.value, state: { status: "available" } };
  } catch {
    return { state: { status: "unreadable" } };
  }
}

async function readOutputSource(
  projectSlug: string,
  fileName: string,
): Promise<ProductionSnapshotSource<unknown>> {
  try {
    const result = await ProjectReader.readJSONState<unknown>(
      projectSlug,
      fileName,
    );

    if (result.status === "missing") {
      return { state: { status: "missing" } };
    }

    if (result.status === "malformed" || result.value === null) {
      return { state: { status: "malformed" } };
    }

    return { data: result.value, state: { status: "available" } };
  } catch {
    return { state: { status: "unreadable" } };
  }
}

function isProject(value: unknown, projectSlug: string): value is Project {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    value.slug === projectSlug &&
    typeof value.title === "string" &&
    isProjectStatus(value.status) &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string"
  );
}

function isManifest(
  value: unknown,
  projectSlug: string,
): value is ProjectManifest {
  if (
    !isRecord(value) ||
    !isRecord(value.packages) ||
    !isProject(value.project, projectSlug)
  ) {
    return false;
  }
  const packages = value.packages;
  return (
    typeof value.projectId === "string" &&
    value.slug === projectSlug &&
    value.version === 1 &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string" &&
    pipelineRecoveryStageOrder.every((stage) => {
      const item = packages[stage];
      return isRecord(item) && item.key === stage && isPackageStatus(item.status);
    })
  );
}

function isJobList(value: unknown, projectSlug: string): value is PipelineJobList {
  return (
    isRecord(value) &&
    value.projectSlug === projectSlug &&
    Array.isArray(value.jobs) &&
    value.jobs.every((job) => isJob(job, projectSlug)) &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string"
  );
}

function isJob(value: unknown, projectSlug: string): value is PipelineJob {
  return (
    isRecord(value) &&
    value.projectSlug === projectSlug &&
    typeof value.id === "string" &&
    typeof value.stage === "string" &&
    pipelineRecoveryStageOrder.includes(value.stage as ProductionStepKey) &&
    isJobStatus(value.status) &&
    typeof value.attempts === "number" &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string"
  );
}

function isHistory(value: unknown, projectSlug: string): value is PipelineJobHistory {
  return (
    isRecord(value) &&
    value.projectSlug === projectSlug &&
    Array.isArray(value.events) &&
    value.events.every(isHistoryEvent) &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string"
  );
}

function isHistoryEvent(value: unknown): value is PipelineJobHistoryEvent {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.jobId === "string" &&
    typeof value.stage === "string" &&
    pipelineRecoveryStageOrder.includes(value.stage as ProductionStepKey) &&
    (value.status === "completed" || value.status === "failed" || value.status === "cancelled") &&
    typeof value.recordedAt === "string"
  );
}

function isUsageLog(value: unknown, projectSlug: string): value is AIUsageLog {
  return (
    isRecord(value) &&
    value.projectSlug === projectSlug &&
    Array.isArray(value.records) &&
    value.records.every((record) => isUsageRecord(record, projectSlug)) &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string"
  );
}

function isUsageRecord(
  value: unknown,
  projectSlug: string,
): value is AIUsageRecord {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    value.projectSlug === projectSlug &&
    typeof value.stage === "string" &&
    typeof value.operation === "string" &&
    typeof value.provider === "string" &&
    (value.status === "success" || value.status === "fallback" || value.status === "failed") &&
    typeof value.fallbackUsed === "boolean" &&
    typeof value.durationMs === "number" &&
    typeof value.createdAt === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isProjectStatus(value: unknown) {
  return (
    value === "draft" ||
    value === "research" ||
    value === "script" ||
    value === "scenes" ||
    value === "visuals" ||
    value === "animation" ||
    value === "video" ||
    value === "audio" ||
    value === "assembly" ||
    value === "thumbnail" ||
    value === "seo" ||
    value === "voice" ||
    value === "youtube" ||
    value === "export" ||
    value === "completed"
  );
}

function isPackageStatus(value: unknown) {
  return (
    value === "pending" ||
    value === "running" ||
    value === "completed" ||
    value === "failed" ||
    value === "missing"
  );
}

function isJobStatus(value: unknown) {
  return (
    value === "queued" ||
    value === "running" ||
    value === "completed" ||
    value === "failed" ||
    value === "cancelled"
  );
}
