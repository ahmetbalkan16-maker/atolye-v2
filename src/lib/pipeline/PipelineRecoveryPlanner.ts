import { ProjectManager } from "@/lib/projects/ProjectManager";
import { isCompatibleVideoData } from "@/lib/video/VideoDataValidation";
import { isYouTubePublishingPackage } from "@/lib/youtube/YouTubePackageValidation";
import {
  createYouTubePackageIdentity,
  validateYouTubePublishRecord,
} from "@/lib/youtube/publish/YouTubePublishValidation";
import type { ProjectManifest } from "@/types/project";
import type {
  PipelineDependencyStatus,
  PipelineRecoveryPlan,
  PipelineRecoveryStageKey,
} from "@/types/pipelineRecovery";

export const pipelineRecoveryStageOrder: readonly PipelineRecoveryStageKey[] = [
  "research",
  "script",
  "scenes",
  "visuals",
  "animation",
  "video",
  "audio",
  "assembly",
  "thumbnail",
  "seo",
  "youtube",
  "export",
];

export const pipelineStageDependencies: Record<
  PipelineRecoveryStageKey,
  readonly PipelineRecoveryStageKey[]
> = {
  research: [],
  script: ["research"],
  scenes: ["script"],
  visuals: ["scenes"],
  animation: ["scenes", "visuals"],
  video: ["animation"],
  audio: ["script"],
  assembly: ["script", "scenes", "visuals", "audio", "video"],
  thumbnail: ["assembly", "video", "audio"],
  seo: ["script", "thumbnail"],
  youtube: ["video", "audio", "assembly", "thumbnail", "seo"],
  export: ["video", "audio", "assembly", "thumbnail", "youtube", "seo"],
};

export function getNextPipelineStage(
  completedStage: PipelineRecoveryStageKey,
): PipelineRecoveryStageKey | null {
  const completedIndex = pipelineRecoveryStageOrder.indexOf(completedStage);

  if (
    completedIndex === -1 ||
    completedIndex === pipelineRecoveryStageOrder.length - 1
  ) {
    return null;
  }

  return pipelineRecoveryStageOrder[completedIndex + 1];
}

export class PipelineRecoveryPlanner {
  static async getNextIncompleteStage(
    projectSlug: string,
  ): Promise<PipelineRecoveryStageKey | null> {
    const manifest = await ProjectManager.getManifest(projectSlug);

    if (!manifest) {
      return null;
    }

    return getNextIncompleteOrUnreadyStage(projectSlug, manifest);
  }

  static async getFailedStages(
    projectSlug: string,
  ): Promise<PipelineRecoveryStageKey[]> {
    const manifest = await ProjectManager.getManifest(projectSlug);

    if (!manifest) {
      return [];
    }

    return pipelineRecoveryStageOrder.filter(
      (stage) => manifest.packages[stage].status === "failed",
    );
  }

  static async createResumePlan(
    projectSlug: string,
  ): Promise<PipelineRecoveryPlan> {
    const createdAt = new Date().toISOString();
    const manifest = await ProjectManager.getManifest(projectSlug);

    if (!manifest) {
      return createBlockedPlan({
        projectSlug,
        type: "resume",
        startStage: null,
        stagesToRun: [],
        dependencies: [],
        reason: "Project manifest could not be read.",
        createdAt,
      });
    }

    const startStage = await getNextIncompleteOrUnreadyStage(projectSlug, manifest);

    if (!startStage) {
      return {
        projectSlug,
        type: "resume",
        startStage: null,
        stagesToRun: [],
        blocked: false,
        reason: "Pipeline is already completed.",
        dependencies: [],
        createdAt,
      };
    }

    const dependencies = await getDependencyStatuses(projectSlug, manifest, startStage);
    const blockedReason = getBlockedReason(dependencies);

    return {
      projectSlug,
      type: "resume",
      startStage,
      stagesToRun: getStagesFrom(startStage),
      blocked: Boolean(blockedReason),
      reason: blockedReason,
      dependencies,
      createdAt,
    };
  }

  static async createRetryPlan(
    projectSlug: string,
    stage: PipelineRecoveryStageKey,
  ): Promise<PipelineRecoveryPlan> {
    const createdAt = new Date().toISOString();
    const manifest = await ProjectManager.getManifest(projectSlug);

    if (!manifest) {
      return createBlockedPlan({
        projectSlug,
        type: "retry",
        startStage: stage,
        stagesToRun: [stage],
        dependencies: [],
        reason: "Project manifest could not be read.",
        createdAt,
      });
    }

    const dependencies = await getDependencyStatuses(projectSlug, manifest, stage);
    const dependencyBlockedReason = getBlockedReason(dependencies);
    const packageStatus = manifest.packages[stage].status;
    const retryBlockedReason =
      packageStatus === "failed"
        ? dependencyBlockedReason
        : `Requested stage "${stage}" is not failed.`;

    return {
      projectSlug,
      type: "retry",
      startStage: stage,
      stagesToRun: [stage],
      blocked: Boolean(retryBlockedReason),
      reason: retryBlockedReason,
      dependencies,
      createdAt,
    };
  }

  static async createJobRetryPlan(
    projectSlug: string,
    stage: PipelineRecoveryStageKey,
  ): Promise<PipelineRecoveryPlan> {
    const createdAt = new Date().toISOString();
    const manifest = await ProjectManager.getManifest(projectSlug);

    if (!manifest) {
      return createBlockedPlan({
        projectSlug,
        type: "retry",
        startStage: stage,
        stagesToRun: [stage],
        dependencies: [],
        reason: "Project manifest could not be read.",
        createdAt,
      });
    }

    const dependencies = await getDependencyStatuses(projectSlug, manifest, stage);
    const blockedReason = getBlockedReason(dependencies);

    return {
      projectSlug,
      type: "retry",
      startStage: stage,
      stagesToRun: [stage],
      blocked: Boolean(blockedReason),
      reason: blockedReason,
      dependencies,
      createdAt,
    };
  }
}

async function getNextIncompleteOrUnreadyStage(
  projectSlug: string,
  manifest: ProjectManifest,
): Promise<PipelineRecoveryStageKey | null> {
  for (const stage of pipelineRecoveryStageOrder) {
    if (
      manifest.packages[stage].status !== "completed" ||
      !(await isStageFileReady(projectSlug, stage))
    ) {
      return stage;
    }
  }
  return null;
}

async function getDependencyStatuses(
  projectSlug: string,
  manifest: ProjectManifest,
  stage: PipelineRecoveryStageKey,
): Promise<PipelineDependencyStatus[]> {
  return Promise.all(
    pipelineStageDependencies[stage].map(async (dependencyStage) => {
      const status = manifest.packages[dependencyStage]?.status ?? "unknown";
      const completed = status === "completed";
      const fileReady = await isStageFileReady(projectSlug, dependencyStage);
      const ready = completed && fileReady;

      return {
        stage: dependencyStage,
        status,
        completed,
        fileReady,
        ready,
        reason: ready
          ? undefined
          : getDependencyNotReadyReason(dependencyStage, completed, fileReady),
      };
    }),
  );
}

async function isStageFileReady(
  projectSlug: string,
  stage: PipelineRecoveryStageKey,
) {
  const data = await readStageData(projectSlug, stage);

  if (stage === "video") return isCompatibleVideoData(data);
  if (stage === "youtube") {
    if (!isYouTubePublishingPackage(data)) return false;
    const [project, publish] = await Promise.all([
      ProjectManager.getProject(projectSlug),
      ProjectManager.getYouTubePublish(projectSlug),
    ]);
    if (!project) return false;
    try {
      validateYouTubePublishRecord(publish, {
        projectId: project.id,
        slug: projectSlug,
        packageIdentity: createYouTubePackageIdentity(data),
        videoAssetId: data.videoAssetId,
        thumbnailAssetId: data.thumbnailAssetId,
      });
      return publish.status === "published";
    } catch {
      return false;
    }
  }
  return data !== null;
}

function readStageData(projectSlug: string, stage: PipelineRecoveryStageKey) {
  switch (stage) {
    case "research":
      return ProjectManager.getResearch(projectSlug);
    case "script":
      return ProjectManager.getScript(projectSlug);
    case "scenes":
      return ProjectManager.getScenes(projectSlug);
    case "visuals":
      return ProjectManager.getVisuals(projectSlug);
    case "animation":
      return ProjectManager.getAnimation(projectSlug);
    case "video":
      return ProjectManager.getVideo(projectSlug);
    case "audio":
      return ProjectManager.getAudio(projectSlug);
    case "assembly":
      return ProjectManager.getAssembly(projectSlug);
    case "thumbnail":
      return ProjectManager.getThumbnail(projectSlug);
    case "seo":
      return ProjectManager.getSEO(projectSlug);
    case "youtube":
      return ProjectManager.getYouTube(projectSlug);
    case "export":
      return ProjectManager.getExport(projectSlug);
  }
}

function getDependencyNotReadyReason(
  stage: PipelineRecoveryStageKey,
  completed: boolean,
  fileReady: boolean,
) {
  if (!completed) {
    return `Dependency stage "${stage}" is not completed.`;
  }

  if (!fileReady) {
    return `Dependency file for stage "${stage}" could not be read.`;
  }

  return `Dependency stage "${stage}" is not ready.`;
}

function getBlockedReason(dependencies: PipelineDependencyStatus[]) {
  return dependencies.find((dependency) => !dependency.ready)?.reason;
}

function getStagesFrom(stage: PipelineRecoveryStageKey) {
  const startIndex = pipelineRecoveryStageOrder.indexOf(stage);

  if (startIndex === -1) {
    return [];
  }

  return pipelineRecoveryStageOrder.slice(startIndex);
}

function createBlockedPlan({
  projectSlug,
  type,
  startStage,
  stagesToRun,
  dependencies,
  reason,
  createdAt,
}: Omit<PipelineRecoveryPlan, "blocked">): PipelineRecoveryPlan {
  return {
    projectSlug,
    type,
    startStage,
    stagesToRun,
    blocked: true,
    reason,
    dependencies,
    createdAt,
  };
}
