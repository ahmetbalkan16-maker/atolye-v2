import path from "node:path";
import { AIRouter } from "@/lib/ai/router/AIRouter";
import { AnimationProviderRouter } from "@/lib/animation/providers/AnimationProviderRouter";
import { VideoAssemblyProviderRouter } from "@/lib/assembly/providers/VideoAssemblyProviderRouter";
import { AssetManager } from "@/lib/assets/AssetManager";
import { ImageProviderRouter } from "@/lib/assets/providers/ImageProviderRouter";
import { AudioProviderRouter } from "@/lib/audio/providers/AudioProviderRouter";
import { AIUsageManager } from "@/lib/ai/AIUsageManager";
import { PipelineJobManager } from "@/lib/pipeline/PipelineJobManager";
import {
  PipelineRecoveryPlanner,
  pipelineRecoveryStageOrder,
} from "@/lib/pipeline/PipelineRecoveryPlanner";
import { PipelineRunner } from "@/lib/pipeline/PipelineRunner";
import { PipelineStageExecutor } from "@/lib/pipeline/PipelineStageExecutor";
import { ThumbnailProviderRouter } from "@/lib/thumbnail/ThumbnailProviderRouter";
import { VideoProviderRouter } from "@/lib/video/providers/VideoProviderRouter";
import { YouTubeProviderRouter } from "@/lib/youtube/YouTubeProviderRouter";
import {
  getProductionRuntimeStatus,
  initializeProductionProcessRuntime,
} from "@/lib/runtime/ProductionRuntimeCompositionRoot";
import type { ProductionReadinessReport } from "@/types/productionReadiness";
import { ProductionReadinessService } from "./ProductionReadinessService";
import {
  createProductionAcceptanceMarkerV3Profile2,
  markProductionAcceptanceValidated,
  readProductionAcceptanceMarker,
} from "./ProductionAcceptancePolicy";
import { createProductionAcceptancePortableConfigurationSnapshotV2 } from
  "./ProductionAcceptanceConfigurationFingerprint";
import { ProjectManager } from "@/lib/projects/ProjectManager";
import { validateProductionAcceptanceMedia } from "./ProductionAcceptanceMediaValidation";
import { validateProductionAcceptancePreflight } from "./ProductionAcceptancePreflight";
import { VideoStorage } from "@/lib/assets/storage/VideoStorage";
import { ThumbnailStorage } from "@/lib/thumbnail/ThumbnailStorage";
import type { Asset } from "@/types/asset";
import type { ThumbnailMimeType } from "@/types/thumbnail";
import {
  createProductionAcceptanceProjectSlug,
  normalizeProductionAcceptanceTopic,
} from "./ProductionAcceptanceTopic";

export const productionAcceptanceProject = Object.freeze({
  minimumDurationSeconds: 60,
  targetDurationSeconds: 90,
  maximumDurationSeconds: 120,
});

export interface ProductionAcceptanceCompletionReport {
  readonly projectSlug: string;
  readonly videoAssetId: string;
  readonly thumbnailAssetId: string;
  readonly durationSeconds: number;
  readonly resolution: string;
  readonly videoCodec: string;
  readonly audioCodec: string;
  readonly sceneCount: number;
  readonly imageCount: number;
  readonly providerCalls: number;
  readonly elapsedTimeMs: number;
  readonly retryCount: number;
  readonly warnings: readonly string[];
  readonly errors: readonly string[];
  readonly publishReady: boolean;
  readonly published: false;
  readonly productionReady: true;
}

export interface ProductionAcceptanceResult {
  readonly readiness: ProductionReadinessReport;
  readonly completion: ProductionAcceptanceCompletionReport;
}

export interface ProductionAcceptanceRequest {
  readonly topic: string;
}

export class ProductionAcceptanceBlockedError extends Error {
  readonly code = "PRODUCTION_ACCEPTANCE_READINESS_BLOCKED";
  readonly productionReady = false;

  constructor(readonly readiness: ProductionReadinessReport) {
    super("Production acceptance was blocked by readiness validation.");
    this.name = "ProductionAcceptanceBlockedError";
    this.stack = undefined;
  }
}

export class ProductionAcceptanceExecutionError extends Error {
  readonly code = "PRODUCTION_ACCEPTANCE_EXECUTION_FAILED";
  readonly productionReady = false;

  constructor(
    readonly projectSlug?: string,
    readonly reasonCode?: string,
  ) {
    super("Production acceptance execution failed.");
    this.name = "ProductionAcceptanceExecutionError";
    this.stack = undefined;
  }
}

export class ProductionAcceptanceConfigurationChangedError extends Error {
  readonly code = "PRODUCTION_ACCEPTANCE_CONFIGURATION_CHANGED";
  readonly productionReady = false;

  constructor() {
    super("Production acceptance configuration changed after readiness validation.");
    this.name = "ProductionAcceptanceConfigurationChangedError";
    this.stack = undefined;
  }
}

export class ProductionAcceptanceOrchestrator {
  static async run(request: ProductionAcceptanceRequest): Promise<ProductionAcceptanceResult> {
    const topic = normalizeProductionAcceptanceTopic(request.topic);
    const runId = crypto.randomUUID();
    const runSlug = createProductionAcceptanceProjectSlug(topic, runId);
    const configuration = await createProductionAcceptancePortableConfigurationSnapshotV2(
      runSlug,
    );
    const readiness = await this.evaluateReadiness();
    if (!readiness.ready) throw new ProductionAcceptanceBlockedError(readiness);
    const currentConfiguration = await createProductionAcceptancePortableConfigurationSnapshotV2(
      runSlug,
    );
    if (
      configuration.unavailableComponents.length > 0 ||
      currentConfiguration.unavailableComponents.length > 0 ||
      configuration.configurationFingerprint !== currentConfiguration.configurationFingerprint
    ) {
      throw new ProductionAcceptanceConfigurationChangedError();
    }

    const runTopic = `${topic} ${runId}`;
    if (await ProjectManager.getProject(runSlug)) {
      throw new ProductionAcceptanceExecutionError();
    }
    try {
      await createProductionAcceptanceMarkerV3Profile2(runSlug, runId, configuration, topic);
    } catch {
      throw new ProductionAcceptanceExecutionError();
    }

    const startedAt = Date.now();
    let result: Awaited<ReturnType<typeof PipelineRunner.run>>;
    try {
      result = await PipelineRunner.run(runTopic, {
      stageExecution: {
        aiProvider: new AIRouter().getProvider("openai"),
        visualAssetProvider: ImageProviderRouter.getProvider("openai"),
        animationProvider: AnimationProviderRouter.getProvider(),
        videoProvider: VideoProviderRouter.getProvider("ffmpeg"),
        audioProvider: AudioProviderRouter.getProvider("openai"),
        videoAssemblyProvider: VideoAssemblyProviderRouter.getProvider("ffmpeg"),
        thumbnailProvider: new ThumbnailProviderRouter().getProvider("openai"),
        youtubeProvider: new YouTubeProviderRouter().getProvider("openai"),
      },
      });
    } catch {
      throw new ProductionAcceptanceExecutionError(runSlug);
    }
    if (!result.success || !result.assembly || !result.thumbnail || !result.youtube) {
      throw new ProductionAcceptanceExecutionError(runSlug);
    }
    return this.finalize(result.slug, readiness, startedAt);
  }

  static async evaluateReadiness(): Promise<ProductionReadinessReport> {
    await initializeProductionProcessRuntime();
    return new ProductionReadinessService().evaluate();
  }

  static async resumeAndFinalize(projectSlug: string): Promise<ProductionAcceptanceResult> {
    const startedAt = Date.now();
    const readiness = await this.evaluateReadiness();
    if (!readiness.ready) throw new ProductionAcceptanceBlockedError(readiness);
    const marker = await readProductionAcceptanceMarker(projectSlug);
    const project = await ProjectManager.getProject(projectSlug);
    if (
      !project || project.slug !== projectSlug || marker.published !== false ||
      createProductionAcceptanceProjectSlug(marker.topic, marker.runId) !== projectSlug
    ) {
      throw new ProductionAcceptanceExecutionError(projectSlug);
    }
    const plan = await PipelineRecoveryPlanner.createResumePlan(projectSlug);
    await resumeProductionAcceptanceIfNeeded(
      plan,
      projectSlug,
      () => PipelineRunner.resume(projectSlug),
    );
    return this.finalize(projectSlug, readiness, startedAt);
  }

  private static async finalize(
    projectSlug: string,
    readiness: ProductionReadinessReport,
    startedAt: number,
  ): Promise<ProductionAcceptanceResult> {
    const marker = await readProductionAcceptanceMarker(projectSlug);
    const state = await PipelineStageExecutor.loadState(projectSlug);
    const project = state?.project;
    const assembly = state?.assembly;
    const thumbnail = state?.thumbnail;
    const youtube = state?.youtube;
    const render = assembly?.render;
    if (
      !project || project.slug !== projectSlug ||
      createProductionAcceptanceProjectSlug(marker.topic, marker.runId) !== projectSlug ||
      render?.status !== "rendered" || !assembly?.outputAssetId ||
      !thumbnail?.outputAssetId || youtube?.status !== "generated" || !render.filePath
    ) throw new ProductionAcceptanceExecutionError(projectSlug);
    try {
      if (!state?.script || !state.scenes) throw new Error("invalid");
      validateProductionAcceptancePreflight(state.script, state.scenes);
    } catch {
      throw new ProductionAcceptanceExecutionError(projectSlug);
    }
    let media: Awaited<ReturnType<typeof validateProductionAcceptanceMedia>>;
    try {
      media = await validateProductionAcceptanceMedia(projectSlug, render.filePath);
    } catch {
      throw new ProductionAcceptanceExecutionError(projectSlug);
    }
    const [usage, jobs] = await Promise.all([
      AIUsageManager.getUsageLog(projectSlug),
      PipelineJobManager.listJobsReadOnly(projectSlug),
    ]);
    const registry = AssetManager.getProjectAssets(projectSlug, project.id);
    if (registry.projectId !== project.id || registry.projectSlug !== projectSlug) {
      throw new ProductionAcceptanceExecutionError(projectSlug);
    }
    const assets = registry.assets;
    try {
      validateProductionAcceptanceRegistryAssets({
        projectId: project.id,
        projectSlug,
        assemblyAssetId: assembly.outputAssetId,
        assemblyFilePath: render.filePath,
        assemblyUrl: render.outputUrl,
        assemblyByteLength: render.byteLength,
        thumbnailAssetId: thumbnail.outputAssetId,
        youtubeVideoAssetId: youtube.videoAssetId,
        youtubeThumbnailAssetId: youtube.thumbnailAssetId,
        assets,
      });
    } catch {
      throw new ProductionAcceptanceExecutionError(projectSlug);
    }
    const generatedProviderAssets = assets.filter(
      (asset) => asset.status === "generated" && asset.provider !== "mock",
    ).length;
    const publishReady = youtube.videoAssetId === assembly.outputAssetId &&
      youtube.thumbnailAssetId === thumbnail.outputAssetId &&
      pipelineRecoveryStageOrder.every((stage) =>
        jobs.jobs.some((job) => job.stage === stage && job.status === "completed"));
    if (!publishReady) throw new ProductionAcceptanceExecutionError(projectSlug);
    try {
      await markProductionAcceptanceValidated(projectSlug, marker.configurationFingerprint);
    } catch {
      throw new ProductionAcceptanceExecutionError(projectSlug);
    }
    return {
      readiness,
      completion: Object.freeze({
        projectSlug,
        videoAssetId: assembly.outputAssetId,
        thumbnailAssetId: thumbnail.outputAssetId,
        durationSeconds: media.durationSeconds,
        resolution: `${media.width}x${media.height}`,
        videoCodec: media.videoCodec,
        audioCodec: media.audioCodec,
        sceneCount: state?.scenes?.scenes.length ?? 0,
        imageCount: assets.filter((asset) => asset.type === "image" && asset.status === "generated").length,
        providerCalls: usage.records.length + generatedProviderAssets,
        elapsedTimeMs: Date.now() - startedAt,
        retryCount: jobs.jobs.reduce((total, job) => total + job.attempts, 0),
        warnings: Object.freeze([]), errors: Object.freeze([]), publishReady,
        published: false, productionReady: true,
      }),
    };
  }

  static runtimeStatus() {
    return getProductionRuntimeStatus();
  }
}

export function requiresProductionAcceptanceResume(
  plan: { readonly blocked: boolean; readonly startStage: string | null },
  projectSlug: string,
) {
  if (plan.blocked) throw new ProductionAcceptanceExecutionError(projectSlug);
  return plan.startStage !== null;
}

export async function resumeProductionAcceptanceIfNeeded(
  plan: { readonly blocked: boolean; readonly startStage: string | null },
  projectSlug: string,
  resume: () => Promise<{
    readonly success: boolean;
    readonly blocked: boolean;
    readonly reasonCode?: string;
  }>,
) {
  if (!requiresProductionAcceptanceResume(plan, projectSlug)) return;
  const result = await resume();
  if (!result.success || result.blocked) {
    throw new ProductionAcceptanceExecutionError(projectSlug, result.reasonCode);
  }
}

export function validateProductionAcceptanceRegistryAssets({
  projectId,
  projectSlug,
  assemblyAssetId,
  assemblyFilePath,
  assemblyUrl,
  assemblyByteLength,
  thumbnailAssetId,
  youtubeVideoAssetId,
  youtubeThumbnailAssetId,
  assets,
}: {
  projectId: string;
  projectSlug: string;
  assemblyAssetId: string;
  assemblyFilePath?: string;
  assemblyUrl?: string;
  assemblyByteLength?: number;
  thumbnailAssetId: string;
  youtubeVideoAssetId: string;
  youtubeThumbnailAssetId: string;
  assets: readonly Asset[];
}) {
  if (
    youtubeVideoAssetId !== assemblyAssetId ||
    youtubeThumbnailAssetId !== thumbnailAssetId
  ) throw new ProductionAcceptanceExecutionError(projectSlug);
  const video = requireUniqueAsset(assets, assemblyAssetId, projectSlug);
  if (
    video.projectId !== projectId || video.projectSlug !== projectSlug ||
    video.type !== "video" || video.status !== "generated" ||
    video.mimeType !== "video/mp4" || video.filePath !== assemblyFilePath ||
    video.url !== assemblyUrl || video.byteLength !== assemblyByteLength ||
    typeof video.filePath !== "string" || typeof video.url !== "string" ||
    !Number.isSafeInteger(video.byteLength) || (video.byteLength as number) <= 0
  ) throw new ProductionAcceptanceExecutionError(projectSlug);
  const videoFileName = path.posix.basename(video.filePath);
  if (
    video.filePath !== VideoStorage.getVideoPath(projectSlug, videoFileName) ||
    video.url !== VideoStorage.getVideoUrl(projectSlug, videoFileName)
  ) throw new ProductionAcceptanceExecutionError(projectSlug);

  const thumbnail = requireUniqueAsset(assets, thumbnailAssetId, projectSlug);
  if (
    thumbnail.projectId !== projectId || thumbnail.projectSlug !== projectSlug ||
    thumbnail.type !== "thumbnail" || thumbnail.status !== "generated" ||
    !isThumbnailMimeType(thumbnail.mimeType) ||
    typeof thumbnail.filePath !== "string" || typeof thumbnail.url !== "string" ||
    !Number.isSafeInteger(thumbnail.byteLength) || (thumbnail.byteLength as number) <= 0
  ) throw new ProductionAcceptanceExecutionError(projectSlug);
  const thumbnailFileName = path.posix.basename(thumbnail.filePath);
  if (
    thumbnail.filePath !== ThumbnailStorage.getThumbnailPath(projectSlug, thumbnailFileName) ||
    thumbnail.url !== ThumbnailStorage.getThumbnailUrl(projectSlug, thumbnailFileName)
  ) throw new ProductionAcceptanceExecutionError(projectSlug);
  const thumbnailInspection = ThumbnailStorage.inspectStoredThumbnail(
    projectSlug,
    thumbnail.filePath,
    thumbnail.mimeType,
  );
  if (thumbnailInspection.byteLength !== thumbnail.byteLength) {
    throw new ProductionAcceptanceExecutionError(projectSlug);
  }
}

function requireUniqueAsset(assets: readonly Asset[], id: string, projectSlug: string) {
  const matches = assets.filter((asset) => asset.id === id);
  if (matches.length !== 1) throw new ProductionAcceptanceExecutionError(projectSlug);
  return matches[0];
}

function isThumbnailMimeType(value: unknown): value is ThumbnailMimeType {
  return value === "image/png" || value === "image/jpeg" || value === "image/webp";
}
