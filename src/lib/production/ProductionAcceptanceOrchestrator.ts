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
import {
  executePipelineRunnerProductionRuntimeOperation,
  PipelineRunner,
} from "@/lib/pipeline/PipelineRunner";
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
import {
  assertProductionMediaRights,
  ProductionMediaRightsError,
} from "./ProductionMediaRightsAudit";
import {
  buildProductionCostReceipt,
  persistProductionCostReceipt,
  ProductionCostBudgetExceededAtAcceptanceError,
} from "./ProductionCostReceipt";
import {
  buildProductionCostReport,
  persistProductionCostReport,
} from "./ProductionCostReport";
import { buildProductionCostPreflight } from "./ProductionCostPreflight";
import { isCostBudgetGuardEnabled } from "@/lib/assets/RealMediaProductionFlags";
import { ProjectReader } from "@/lib/projects/ProjectReader";
import type { ScriptData } from "@/types/script";
import type { SceneData } from "@/types/scene";
import { VideoStorage } from "@/lib/assets/storage/VideoStorage";
import { ThumbnailStorage } from "@/lib/thumbnail/ThumbnailStorage";
import type { Asset } from "@/types/asset";
import type { ThumbnailMimeType } from "@/types/thumbnail";
import {
  createProductionAcceptanceProjectSlug,
  normalizeProductionAcceptanceTopic,
} from "./ProductionAcceptanceTopic";
import type {
  PipelineRecoveryStageKey,
  PipelineResumeOptions,
} from "@/types/pipelineRecovery";

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

export interface ProductionAcceptanceBoundedResumeResult {
  readonly readiness: ProductionReadinessReport;
  readonly boundedResume: Readonly<{
    projectSlug: string;
    type: "resume";
    startStage: PipelineRecoveryStageKey;
    completedStages: readonly PipelineRecoveryStageKey[];
    stoppedAfterStage: PipelineRecoveryStageKey;
    blocked: false;
    productionReady: false;
    published: false;
  }>;
}

export type ProductionAcceptanceResumeResult =
  | ProductionAcceptanceResult
  | ProductionAcceptanceBoundedResumeResult;

/**
 * A fresh `execute` that was asked (via `--stop-after-stage`) to stop the
 * moment a stage completed. The run's own acceptance marker is created and
 * stays `acceptanceStatus: "prepared"` (never finalized), the remaining
 * pipeline stages — thumbnail / seo / youtube / export — are never scheduled,
 * and `finalize()` is not called. Complete it later with
 * `resume-finalize --project-slug=<the-new-run-slug>`.
 */
export interface ProductionAcceptanceBoundedRunResult {
  readonly readiness: ProductionReadinessReport;
  readonly boundedRun: Readonly<{
    projectSlug: string;
    type: "run";
    completedStages: readonly PipelineRecoveryStageKey[];
    stoppedAfterStage: PipelineRecoveryStageKey;
    blocked: false;
    productionReady: false;
    published: false;
  }>;
}

export type ProductionAcceptanceRunResult =
  | ProductionAcceptanceResult
  | ProductionAcceptanceBoundedRunResult;

export interface ProductionAcceptanceRequest {
  readonly topic: string;
}

export interface ProductionAcceptanceRunOptions {
  readonly stopAfterStage?: PipelineRecoveryStageKey;
}

export class ProductionAcceptanceBlockedError extends Error {
  readonly code = "PRODUCTION_ACCEPTANCE_READINESS_BLOCKED";
  readonly productionReady = false;

  constructor(readonly readiness: ProductionReadinessReport) {
    super("Production acceptance was blocked by readiness validation.");
    if (new.target === ProductionAcceptanceBlockedError) {
      authenticProductionAcceptanceBlockedErrors.add(this);
    }
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
    if (new.target === ProductionAcceptanceExecutionError) {
      authenticProductionAcceptanceExecutionErrors.add(this);
    }
    this.name = "ProductionAcceptanceExecutionError";
    this.stack = undefined;
  }
}

const authenticProductionAcceptanceBlockedErrors = new WeakSet<object>();
export function isAuthenticProductionAcceptanceBlockedError(
  value: unknown,
): value is ProductionAcceptanceBlockedError {
  return typeof value === "object" && value !== null &&
    authenticProductionAcceptanceBlockedErrors.has(value) &&
    Object.getPrototypeOf(value) === ProductionAcceptanceBlockedError.prototype;
}

const authenticProductionAcceptanceExecutionErrors = new WeakSet<object>();

export function isAuthenticProductionAcceptanceExecutionError(
  value: unknown,
): value is ProductionAcceptanceExecutionError {
  return typeof value === "object" && value !== null &&
    authenticProductionAcceptanceExecutionErrors.has(value) &&
    Object.getPrototypeOf(value) === ProductionAcceptanceExecutionError.prototype;
}

export class ProductionAcceptanceConfigurationChangedError extends Error {
  readonly code = "PRODUCTION_ACCEPTANCE_CONFIGURATION_CHANGED";
  readonly productionReady = false;

  constructor() {
    super("Production acceptance configuration changed after readiness validation.");
    if (new.target === ProductionAcceptanceConfigurationChangedError) {
      authenticProductionAcceptanceConfigurationChangedErrors.add(this);
    }
    this.name = "ProductionAcceptanceConfigurationChangedError";
    this.stack = undefined;
  }
}

const authenticProductionAcceptanceConfigurationChangedErrors = new WeakSet<object>();
export function isAuthenticProductionAcceptanceConfigurationChangedError(
  value: unknown,
): value is ProductionAcceptanceConfigurationChangedError {
  return typeof value === "object" && value !== null &&
    authenticProductionAcceptanceConfigurationChangedErrors.has(value) &&
    Object.getPrototypeOf(value) === ProductionAcceptanceConfigurationChangedError.prototype;
}

export class ProductionAcceptanceOrchestrator {
  static async run(request: ProductionAcceptanceRequest): Promise<ProductionAcceptanceResult>;
  static async run(
    request: ProductionAcceptanceRequest,
    options: ProductionAcceptanceRunOptions,
  ): Promise<ProductionAcceptanceRunResult>;
  static async run(
    request: ProductionAcceptanceRequest,
    options: ProductionAcceptanceRunOptions = {},
  ): Promise<ProductionAcceptanceRunResult> {
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
        // Resolve from IMAGE_PROVIDER (mock | openai | real) exactly like the
        // resume path (`materializePipelineStageExecutionOptions`). Hard-coding
        // "openai" here silently defeated `IMAGE_PROVIDER=real`, so a fresh
        // `execute` could never use archival photos even when configured to.
        visualAssetProvider: ImageProviderRouter.getProvider(),
        animationProvider: AnimationProviderRouter.getProvider(),
        videoProvider: VideoProviderRouter.getProvider("ffmpeg"),
        audioProvider: AudioProviderRouter.getProvider("openai"),
        videoAssemblyProvider: VideoAssemblyProviderRouter.getProvider("ffmpeg"),
        thumbnailProvider: new ThumbnailProviderRouter().getProvider("openai"),
        youtubeProvider: new YouTubeProviderRouter().getProvider("openai"),
      },
      ...(options.stopAfterStage ? { stopAfterStage: options.stopAfterStage } : {}),
      });
    } catch {
      throw new ProductionAcceptanceExecutionError(runSlug);
    }

    // Bounded fresh run: stop cleanly after the requested stage. No thumbnail /
    // seo / youtube / export, no finalize() — the run's marker stays "prepared".
    if (options.stopAfterStage) {
      if (
        !result.success ||
        result.stoppedAfterStage !== options.stopAfterStage ||
        result.completedStages.at(-1) !== options.stopAfterStage ||
        (options.stopAfterStage === "assembly" && !result.assembly)
      ) {
        throw new ProductionAcceptanceExecutionError(runSlug);
      }
      return {
        readiness,
        boundedRun: Object.freeze({
          projectSlug: result.slug,
          type: "run" as const,
          completedStages: Object.freeze([...result.completedStages]),
          stoppedAfterStage: options.stopAfterStage,
          blocked: false as const,
          productionReady: false as const,
          published: false as const,
        }),
      };
    }

    if (!result.success || !result.assembly || !result.thumbnail || !result.youtube) {
      throw new ProductionAcceptanceExecutionError(runSlug);
    }
    return this.finalizeWithinCanonicalRuntimeOperation(result.slug, readiness, startedAt);
  }

  static async evaluateReadiness(): Promise<ProductionReadinessReport> {
    await initializeProductionProcessRuntime();
    return new ProductionReadinessService().evaluate();
  }

  static async resumeAndFinalize(
    projectSlug: string,
    options: PipelineResumeOptions = {},
  ): Promise<ProductionAcceptanceResumeResult> {
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
    // Faz 5/6: fail closed BEFORE any paid resume work when the deterministic
    // pre-run cost estimate would blow the $1 budget (or a model has no price).
    // Opt-in: `execute` / `resume-finalize` enable `ATOLYE_AI_COST_GUARD`.
    if (isCostBudgetGuardEnabled()) {
      const script = await ProjectReader.readJSON<ScriptData>(projectSlug, "script.json");
      const scenes = await ProjectReader.readJSON<SceneData>(projectSlug, "scenes.json");
      const preflight = await buildProductionCostPreflight({ projectSlug, script, scenes });
      if (preflight.decision === "block") {
        throw new ProductionAcceptanceExecutionError(
          projectSlug,
          preflight.blockReason === "unknown-pricing"
            ? "PRODUCTION_AI_COST_PRICING_UNKNOWN"
            : "PRODUCTION_AI_COST_BUDGET_EXCEEDED",
        );
      }
    }

    const plan = await PipelineRecoveryPlanner.createResumePlan(projectSlug);
    const resumed = await resumeProductionAcceptanceIfNeeded(
      plan,
      projectSlug,
      () => PipelineRunner.resume(projectSlug, options),
    );
    if (options.stopAfterStage) {
      if (
        !resumed || resumed.stoppedAfterStage !== options.stopAfterStage ||
        resumed.completedStages.at(-1) !== options.stopAfterStage || !plan.startStage
      ) throw new ProductionAcceptanceExecutionError(projectSlug);
      return {
        readiness,
        boundedResume: Object.freeze({
          projectSlug,
          type: "resume" as const,
          startStage: plan.startStage,
          completedStages: Object.freeze([...resumed.completedStages]),
          stoppedAfterStage: resumed.stoppedAfterStage,
          blocked: false as const,
          productionReady: false as const,
          published: false as const,
        }),
      };
    }
    return this.finalizeWithinCanonicalRuntimeOperation(projectSlug, readiness, startedAt);
  }

  /**
   * finalize() re-verifies media + the asset registry and writes the acceptance
   * marker. Its registry read (AssetManager.getProjectAssets ->
   * getCommittedAudioPublicationAssets) requires the active
   * ProductionRuntimeOperationContext that authored this run's audio publication
   * intents during the pipeline. PipelineRunner.run/resume establish that context
   * only for their own scope and tear it down before returning here, so finalize()
   * must re-enter the same canonical runtime operation explicitly. This derives a
   * fresh operation from the already-registered canonical parent authority
   * (installed by initializeProductionProcessRuntime); it adds no ambient fallback
   * and still fails closed with RUNTIME_OPERATION_CONTEXT_MISSING when no runtime
   * is registered. When finalize() is already reached inside an active context
   * (e.g. smoke runtimes), that context is reused, not nested.
   */
  private static finalizeWithinCanonicalRuntimeOperation(
    projectSlug: string,
    readiness: ProductionReadinessReport,
    startedAt: number,
  ): Promise<ProductionAcceptanceResult> {
    return executePipelineRunnerProductionRuntimeOperation(
      "production-acceptance-finalize",
      () => this.finalize(projectSlug, readiness, startedAt),
    );
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
    // Faz 6.7: every real-media production asset must be rights-admissible
    // (public-domain / open-license / verified, with provenance and no drift).
    // AI/mock assets are exempt; a run with no real media passes trivially.
    try {
      assertProductionMediaRights(assets);
    } catch (error) {
      if (error instanceof ProductionMediaRightsError) {
        throw new ProductionAcceptanceExecutionError(
          projectSlug,
          "PRODUCTION_MEDIA_RIGHTS_INADMISSIBLE",
        );
      }
      throw error;
    }

    // Faz 5.6: deterministic, auditable post-run cost receipt. When the cost
    // guard is enabled it is also a hard gate — an over-budget or unknown-priced
    // run does not become `validated`.
    const costReceipt = buildProductionCostReceipt({ projectSlug, usage });
    try {
      persistProductionCostReceipt(costReceipt);
    } catch {
      // A receipt-persistence failure must not mask a validated render, but a
      // guarded run still enforces the budget below.
    }
    if (isCostBudgetGuardEnabled() && costReceipt.status !== "within-budget") {
      throw new ProductionCostBudgetExceededAtAcceptanceError(costReceipt);
    }

    // P1: the human-readable production cost report (per-category spend, cost
    // per minute / scene, per-preset comparison). Best-effort — it is a report,
    // never a gate; the receipt above is the budget authority.
    try {
      const chapters = state?.script?.chapters ?? [];
      const generatedImages = assets.filter(
        (asset) => asset.type === "image" && asset.status === "generated",
      );
      const aiImageCount = generatedImages.some((asset) => asset.mediaOrigin !== undefined)
        ? generatedImages.filter((asset) => asset.mediaOrigin === "ai").length
        : generatedImages.filter((asset) => asset.provider === "openai").length;
      const report = buildProductionCostReport({
        projectSlug,
        usage,
        facts: {
          durationSeconds: media.durationSeconds,
          sceneCount: state?.scenes?.scenes.length ?? 0,
          chapterCount: chapters.length,
          narrationCharacters: chapters.reduce(
            (total, chapter) =>
              total + (typeof chapter.narration === "string" ? chapter.narration.length : 0),
            0,
          ),
          aiImageCount,
          aiVideoCount: 0,
          cachedAssetCount: 0,
          retryCount: jobs.jobs.reduce(
            (total, job) => total + Math.max(0, job.attempts - 1),
            0,
          ),
        },
      });
      persistProductionCostReport(report);
    } catch {
      // A cost-report failure must never mask a validated render.
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

export async function resumeProductionAcceptanceIfNeeded<
  T extends { readonly success: boolean; readonly blocked: boolean; readonly reasonCode?: string },
>(
  plan: { readonly blocked: boolean; readonly startStage: string | null },
  projectSlug: string,
  resume: () => Promise<T>,
) {
  if (!requiresProductionAcceptanceResume(plan, projectSlug)) return undefined;
  const result = await resume();
  if (!result.success || result.blocked) {
    throw new ProductionAcceptanceExecutionError(projectSlug, result.reasonCode);
  }
  return result;
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
