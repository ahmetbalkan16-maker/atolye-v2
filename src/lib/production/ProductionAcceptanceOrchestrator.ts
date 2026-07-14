import { AIRouter } from "@/lib/ai/router/AIRouter";
import { AnimationProviderRouter } from "@/lib/animation/providers/AnimationProviderRouter";
import { VideoAssemblyProviderRouter } from "@/lib/assembly/providers/VideoAssemblyProviderRouter";
import { AssetManager } from "@/lib/assets/AssetManager";
import { ImageProviderRouter } from "@/lib/assets/providers/ImageProviderRouter";
import { AudioProviderRouter } from "@/lib/audio/providers/AudioProviderRouter";
import { AIUsageManager } from "@/lib/ai/AIUsageManager";
import { PipelineJobManager } from "@/lib/pipeline/PipelineJobManager";
import { pipelineRecoveryStageOrder } from "@/lib/pipeline/PipelineRecoveryPlanner";
import { PipelineRunner } from "@/lib/pipeline/PipelineRunner";
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
  createProductionAcceptanceMarker,
  markProductionAcceptanceValidated,
  productionAcceptanceConfigurationFingerprint,
} from "./ProductionAcceptancePolicy";
import { ProjectManager } from "@/lib/projects/ProjectManager";
import { validateProductionAcceptanceMedia } from "./ProductionAcceptanceMediaValidation";

export const productionAcceptanceProject = Object.freeze({
  topic: "Sprint 126 Production Acceptance: 90 saniyelik deterministik Istanbul silueti belgeseli",
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

  constructor() {
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
  static async run(): Promise<ProductionAcceptanceResult> {
    const runId = crypto.randomUUID();
    const configurationFingerprint = productionAcceptanceConfigurationFingerprint();
    await initializeProductionProcessRuntime();
    const readiness = await new ProductionReadinessService().evaluate();
    if (!readiness.ready) throw new ProductionAcceptanceBlockedError(readiness);
    if (configurationFingerprint !== productionAcceptanceConfigurationFingerprint()) {
      throw new ProductionAcceptanceConfigurationChangedError();
    }

    const runTopic = `${productionAcceptanceProject.topic} ${runId}`;
    const runSlug = ProjectManager.createSlug(runTopic);
    if (await ProjectManager.getProject(runSlug)) {
      throw new ProductionAcceptanceExecutionError();
    }
    try {
      await createProductionAcceptanceMarker(runSlug, runId, configurationFingerprint);
    } catch {
      throw new ProductionAcceptanceExecutionError();
    }

    const startedAt = Date.now();
    const result = await PipelineRunner.run(runTopic, {
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
    if (!result.success || !result.assembly || !result.thumbnail || !result.youtube) {
      throw new ProductionAcceptanceExecutionError();
    }

    const render = result.assembly.render;
    if (
      render?.status !== "rendered" ||
      !result.assembly.outputAssetId ||
      !result.thumbnail.outputAssetId ||
      result.youtube.status !== "generated" ||
      !render.filePath
    ) {
      throw new ProductionAcceptanceExecutionError();
    }
    if (configurationFingerprint !== productionAcceptanceConfigurationFingerprint()) {
      throw new ProductionAcceptanceConfigurationChangedError();
    }
    let media: Awaited<ReturnType<typeof validateProductionAcceptanceMedia>>;
    try {
      media = await validateProductionAcceptanceMedia(result.slug, render.filePath);
    } catch {
      throw new ProductionAcceptanceExecutionError();
    }
    const durationSeconds = media.durationSeconds;

    const [usage, jobs] = await Promise.all([
      AIUsageManager.getUsageLog(result.slug),
      PipelineJobManager.listJobsReadOnly(result.slug),
    ]);
    const assets = AssetManager.getProjectAssets(result.slug, result.project.id).assets;
    const generatedProviderAssets = assets.filter((asset) => asset.status === "generated" && asset.provider !== "mock").length;
    const publishReady =
      result.youtube.videoAssetId === result.assembly.outputAssetId &&
      result.youtube.thumbnailAssetId === result.thumbnail.outputAssetId &&
      pipelineRecoveryStageOrder.every((stage) => jobs.jobs.some((job) => job.stage === stage && job.status === "completed"));
    if (!publishReady) throw new ProductionAcceptanceExecutionError();
    try {
      await markProductionAcceptanceValidated(result.slug, configurationFingerprint);
    } catch {
      throw new ProductionAcceptanceExecutionError();
    }

    return {
      readiness,
      completion: Object.freeze({
        projectSlug: result.slug,
        videoAssetId: result.assembly.outputAssetId,
        thumbnailAssetId: result.thumbnail.outputAssetId,
        durationSeconds,
        resolution: `${media.width}x${media.height}`,
        videoCodec: media.videoCodec,
        audioCodec: media.audioCodec,
        sceneCount: result.scenes?.scenes.length ?? 0,
        imageCount: assets.filter((asset) => asset.type === "image" && asset.status === "generated").length,
        providerCalls: usage.records.length + generatedProviderAssets,
        elapsedTimeMs: Date.now() - startedAt,
        retryCount: jobs.jobs.reduce((total, job) => total + job.attempts, 0),
        warnings: Object.freeze([]),
        errors: Object.freeze([]),
        publishReady,
        published: false,
        productionReady: true,
      }),
    };
  }

  static runtimeStatus() {
    return getProductionRuntimeStatus();
  }
}
