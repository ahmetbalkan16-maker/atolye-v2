import { AIManager } from "@/lib/ai/AIManager";
import { strictGenerationExecutionPolicy } from "@/lib/ai/GenerationExecutionPolicy";
import type { AIProvider } from "@/lib/ai/providers";
import { AIRouter } from "@/lib/ai/router/AIRouter";
import { AnimationAssetPipeline } from "@/lib/animation/AnimationAssetPipeline";
import { isCompatibleAnimationData } from "@/lib/animation/AnimationMotionPlanValidation";
import { AnimationPromptGenerator } from "@/lib/animation/prompts/AnimationPromptGenerator";
import type { AnimationProvider } from "@/lib/animation/providers/AnimationProvider";
import { AnimationProviderRouter } from "@/lib/animation/providers/AnimationProviderRouter";
import { AssemblyManager } from "@/lib/assembly/AssemblyManager";
import {
  VideoAssemblyError,
  VideoAssemblyManager,
} from "@/lib/assembly/VideoAssemblyManager";
import type { VideoAssemblyProvider } from "@/lib/assembly/providers/VideoAssemblyProvider";
import { VideoAssemblyProviderRouter } from "@/lib/assembly/providers/VideoAssemblyProviderRouter";
import { AudioManager } from "@/lib/audio/AudioManager";
import {
  AudioAssetGenerationError,
  AudioPipeline,
} from "@/lib/audio/AudioPipeline";
import type { AudioProvider } from "@/lib/audio/providers/AudioProvider";
import { AudioProviderRouter } from "@/lib/audio/providers/AudioProviderRouter";
import { stageProjectBackgroundMusic } from "@/lib/audio/music/AudioMusicSelection";
import { VisualAssetPipeline } from "@/lib/assets/VisualAssetPipeline";
import { resolveMaxAiImages } from "@/lib/assets/VisualMediaAdmissionPolicy";
import { isLocalImageFallbackEnabled } from "@/lib/assets/providers/ImageProviderConfig";
import {
  selectSceneMedia,
  sceneMediaSelectionOverrides,
} from "@/lib/assets/SceneMediaSelection";
import {
  isRealMediaDiscoveryEnabled,
  isRealMediaSelectionEnabled,
} from "@/lib/assets/RealMediaProductionFlags";
import {
  applyResearchMediaCandidatesToVisualData,
  createWikimediaSearchClient,
  enrichResearchWithMediaDiscovery,
  type MediaSearchClient,
} from "@/lib/assets/ResearchMediaDiscovery";
import type { ImageProvider } from "@/lib/assets/providers/ImageProvider";
import { ImageProviderRouter } from "@/lib/assets/providers/ImageProviderRouter";
import { packageExport } from "@/lib/export/ExportPackager";
import { ProjectManager } from "@/lib/projects/ProjectManager";
import type { RuntimeStorageContext } from "@/lib/runtime/RuntimeStoragePaths";
import { SEOManager } from "@/lib/seo/SEOManager";
import { ThumbnailEngine } from "@/lib/thumbnail/ThumbnailEngine";
import {
  ThumbnailAssetGenerationError,
  ThumbnailAssetPipeline,
} from "@/lib/thumbnail/ThumbnailAssetPipeline";
import type { ThumbnailProvider } from "@/lib/thumbnail/providers/ThumbnailProvider";
import { ThumbnailProviderRouter } from "@/lib/thumbnail/ThumbnailProviderRouter";
import { VideoPipeline } from "@/lib/video/VideoPipeline";
import { isCompatibleVideoData } from "@/lib/video/VideoDataValidation";
import type { VideoProvider } from "@/lib/video/providers/VideoProvider";
import { VideoProviderRouter } from "@/lib/video/providers/VideoProviderRouter";
import { VisualManager } from "@/lib/visuals/VisualManager";
import {
  YouTubePackagePipeline,
} from "@/lib/youtube/YouTubePackagePipeline";
import { isYouTubePublishingPackage } from "@/lib/youtube/YouTubePackageValidation";
import type { YouTubeProvider } from "@/lib/youtube/providers/YouTubeProvider";
import { YouTubeProviderRouter } from "@/lib/youtube/YouTubeProviderRouter";
import { YouTubePublishError, YouTubePublishPipeline } from "@/lib/youtube/publish/YouTubePublishPipeline";
import type { YouTubePublishProvider } from "@/lib/youtube/publish/providers/YouTubePublishProvider";
import { YouTubePublishProviderRouter } from "@/lib/youtube/publish/YouTubePublishProviderRouter";
import { PipelineJobManager } from "./PipelineJobManager";
import type { AnimationData } from "@/types/animation";
import type { AssemblyPlanData } from "@/types/assembly";
import type { AudioData } from "@/types/audio";
import type { ExportPackageData } from "@/types/export";
import type { ProductionStepKey, Project } from "@/types/project";
import type { ResearchData } from "@/types/research";
import type { SceneData } from "@/types/scene";
import type { ScriptData } from "@/types/script";
import type { SEOData } from "@/types/seo";
import type { ThumbnailData } from "@/types/thumbnail";
import type { VideoData } from "@/types/video";
import type { VisualData } from "@/types/visual";
import type { YouTubePublishingPackage } from "@/types/youtube";
import {
  consumeProductionAcceptanceStageCapability,
  type ProductionAcceptanceStageCapability,
  type ProductionAcceptanceStageExecutionIdentity,
} from "@/lib/production/ProductionAcceptancePolicy";
import {
  validateProductionAcceptancePreflight,
  validateProductionAcceptanceScriptDuration,
} from "@/lib/production/ProductionAcceptancePreflight";
import { createProductionAcceptanceProviderSelection,
  createProductionAcceptanceStageExecutionScope,
  type ProductionAcceptanceProviderOptions,
  type ProductionAcceptanceProviderSelection } from
  "@/lib/production/ProductionAcceptanceExecutionScope";
import type { ProjectPackageRunType } from "@/types/project";
import { emitProductionPipelineExecutionEvent } from
  "@/lib/production/ProductionPipelineExecutionInstrumentation";
import type { PipelineRecoveryStageKey } from "@/types/pipelineRecovery";

export type PipelineStageExecutionResultMap = {
  research: ResearchData;
  script: ScriptData;
  scenes: SceneData;
  visuals: VisualData;
  animation: AnimationData;
  audio: AudioData;
  assembly: AssemblyPlanData;
  seo: SEOData;
  thumbnail: ThumbnailData;
  youtube: YouTubePublishingPackage | null;
  exportPackage: ExportPackageData | null;
};

export type PipelineExecutionState = {
  project: Project;
  research: ResearchData | null;
  script: ScriptData | null;
  scenes: SceneData | null;
  visuals: VisualData | null;
  animation: AnimationData | null;
  video: VideoData | null;
  audio: AudioData | null;
  assembly: AssemblyPlanData | null;
  thumbnail: ThumbnailData | null;
  seo: SEOData | null;
  youtube: YouTubePublishingPackage | null;
  exportPackage: ExportPackageData | null;
};

export type PipelineStageExecutionOptions = {
  aiProvider?: AIProvider;
  visualAssetProvider?: ImageProvider;
  animationProvider?: AnimationProvider;
  videoProvider?: VideoProvider;
  audioProvider?: AudioProvider;
  videoAssemblyProvider?: VideoAssemblyProvider;
  thumbnailProvider?: ThumbnailProvider;
  youtubeProvider?: YouTubeProvider;
  youtubePublishProvider?: YouTubePublishProvider;
  /**
   * Real-media source client for the research-stage discovery step (Faz 2).
   * Opt-in: `materializePipelineStageExecutionOptions` never auto-creates one,
   * so discovery only runs when a caller wires a client in. Not serializable and
   * not part of the acceptance fingerprint.
   */
  mediaSearchClient?: MediaSearchClient;
  stopAfterStage?: PipelineRecoveryStageKey;
};

export function materializePipelineStageExecutionOptions(
  stage: ProductionStepKey,
  source: PipelineStageExecutionOptions = {},
): { options: Readonly<PipelineStageExecutionOptions>;
  configuredOptions: readonly (keyof ProductionAcceptanceProviderOptions)[] } {
  const captured: PipelineStageExecutionOptions = {
    aiProvider: source.aiProvider, visualAssetProvider: source.visualAssetProvider,
    animationProvider: source.animationProvider, videoProvider: source.videoProvider,
    audioProvider: source.audioProvider, videoAssemblyProvider: source.videoAssemblyProvider,
    thumbnailProvider: source.thumbnailProvider, youtubeProvider: source.youtubeProvider,
    youtubePublishProvider: source.youtubePublishProvider,
    mediaSearchClient: source.mediaSearchClient,
    stopAfterStage: source.stopAfterStage,
  };
  const configured: (keyof ProductionAcceptanceProviderOptions)[] = [];
  const ensure = <K extends keyof ProductionAcceptanceProviderOptions>(key: K, create: () =>
    NonNullable<PipelineStageExecutionOptions[K]>) => {
    if (!captured[key]) {
      (captured as Record<K, PipelineStageExecutionOptions[K]>)[key] = create();
      configured.push(key);
    }
  };
  if (["research", "script", "scenes", "visuals", "animation", "audio", "assembly", "seo"]
    .includes(stage)) ensure("aiProvider", () => new AIRouter().getProvider());
  // Faz 6 (opt-in, off by default): auto-wire the real-media discovery client for
  // the research stage. Best-effort — discovery never fails the research stage.
  // Not tracked as a configured provider option, so the acceptance fingerprint
  // is unchanged.
  if (stage === "research" && !captured.mediaSearchClient && isRealMediaDiscoveryEnabled()) {
    captured.mediaSearchClient = createWikimediaSearchClient();
  }
  if (stage === "visuals") ensure("visualAssetProvider", () => ImageProviderRouter.getProvider());
  if (stage === "animation") ensure("animationProvider", () => AnimationProviderRouter.getProvider());
  if (stage === "video") ensure("videoProvider", () => VideoProviderRouter.getProvider());
  if (stage === "audio") ensure("audioProvider", () => AudioProviderRouter.getProvider());
  if (stage === "assembly") ensure("videoAssemblyProvider", () =>
    VideoAssemblyProviderRouter.getProvider());
  if (stage === "thumbnail") ensure("thumbnailProvider", () =>
    new ThumbnailProviderRouter().getProvider());
  if (stage === "youtube") {
    ensure("youtubeProvider", () => new YouTubeProviderRouter().getProvider());
    ensure("youtubePublishProvider", () => new YouTubePublishProviderRouter().getProvider());
  }
  return { options: Object.freeze(captured), configuredOptions: Object.freeze(configured) };
}

export class PipelineStageExecutor {
  static createInitialState(project: Project): PipelineExecutionState {
    return {
      project,
      research: null,
      script: null,
      scenes: null,
      visuals: null,
      animation: null,
      video: null,
      audio: null,
      assembly: null,
      thumbnail: null,
      seo: null,
      youtube: null,
      exportPackage: null,
    };
  }

  static async loadState(
    projectSlug: string,
    storageContext?: RuntimeStorageContext,
  ): Promise<PipelineExecutionState | null> {
    const project = await ProjectManager.getProject(projectSlug, storageContext);

    if (!project) {
      return null;
    }

    const [
      research,
      script,
      scenes,
      visuals,
      animation,
      video,
      audio,
      assembly,
      thumbnail,
      seo,
      youtube,
      exportPackage,
    ] = await Promise.all([
      ProjectManager.getResearch(projectSlug, storageContext) as Promise<ResearchData | null>,
      ProjectManager.getScript(projectSlug, storageContext) as Promise<ScriptData | null>,
      ProjectManager.getScenes(projectSlug, storageContext) as Promise<SceneData | null>,
      ProjectManager.getVisuals(projectSlug, storageContext) as Promise<VisualData | null>,
      ProjectManager.getAnimation(projectSlug, storageContext),
      ProjectManager.getVideo(projectSlug, storageContext),
      ProjectManager.getAudio(projectSlug, storageContext) as Promise<AudioData | null>,
      ProjectManager.getAssembly(projectSlug, storageContext) as Promise<AssemblyPlanData | null>,
      ProjectManager.getThumbnail(projectSlug, storageContext) as Promise<ThumbnailData | null>,
      ProjectManager.getSEO(projectSlug, storageContext) as Promise<SEOData | null>,
      ProjectManager.getYouTube(projectSlug, storageContext) as Promise<YouTubePublishingPackage | null>,
      ProjectManager.getExport(projectSlug, storageContext) as Promise<ExportPackageData | null>,
    ]);

    return {
      project,
      research,
      script,
      scenes,
      visuals,
      animation: isCompatibleAnimationData(animation) ? animation : null,
      video: isCompatibleVideoData(video) ? video : null,
      audio,
      assembly,
      thumbnail,
      seo,
      youtube,
      exportPackage,
    };
  }

  static async execute(
    projectSlug: string,
    stage: ProductionStepKey,
    state: PipelineExecutionState,
    options: PipelineStageExecutionOptions = {},
    acceptanceCapability?: ProductionAcceptanceStageCapability,
    acceptanceIdentity?: ProductionAcceptanceStageExecutionIdentity,
    acceptanceRunType?: ProjectPackageRunType,
    acceptanceProviderSelection?: ProductionAcceptanceProviderSelection,
    storageContext?: RuntimeStorageContext,
    visualSourceOverrides?: Readonly<Record<number, "ai" | "real">>,
  ): Promise<boolean> {
    const actualRunType = acceptanceRunType ?? acceptanceIdentity?.runType;
    const providerSelection = acceptanceProviderSelection ??
      createProductionAcceptanceProviderSelection(stage, options);
    const executionScope = acceptanceIdentity && actualRunType
      ? createProductionAcceptanceStageExecutionScope({
        projectSlug,
        stage,
        runType: actualRunType,
        operation: `pipeline.stage.${actualRunType}`,
        executionFingerprint: acceptanceIdentity.executionFingerprint,
        providerSelection,
        regeneration: acceptanceIdentity.regeneration,
      })
      : undefined;
    const persistedPolicy = acceptanceIdentity
      ? await consumeProductionAcceptanceStageCapability(
        acceptanceIdentity,
        acceptanceCapability,
        executionScope,
      )
      : await consumeProductionAcceptanceStageCapability({
        projectSlug, stage, runType: "initial", attemptNumber: -1,
        attemptId: "missing", recordId: "missing", reservationId: "missing",
        claimId: "missing", leaseId: "missing", requestId: "missing", idempotencyKey: "missing",
        operation: "missing", executionFingerprint: "missing",
      });
    await emitProductionPipelineExecutionEvent("capability-consumed", {
      stage,
      identity: acceptanceIdentity as unknown as object | undefined,
      executionScope: executionScope as unknown as object | undefined,
    });
    const generationPolicy = persistedPolicy?.strictProductionAcceptance
      ? strictGenerationExecutionPolicy
      : undefined;
    const dispatchOptions = (persistedPolicy?.providerOptions ??
      providerSelection.dispatchOptions) as PipelineStageExecutionOptions;
    const dispatchBranch = async (slot: keyof PipelineStageExecutionOptions) => {
      const binding = providerSelection.providers.find((provider) => provider.slot === slot);
      await emitProductionPipelineExecutionEvent("provider-dispatch-entered", {
        stage, slot, selectionId: providerSelection.selectionId, adapterId: binding?.adapterId,
      });
    };
    switch (stage) {
      case "research": {
        await dispatchBranch("aiProvider");
        state.research = await AIManager.runResearch(state.project.title, {
          projectSlug,
          stage: "research",
          operation: "research",
        }, dispatchOptions.aiProvider, generationPolicy);
        // Faz 2/6: enrich with real media discovered from a source client.
        // Runs when a client was wired in OR when real-media discovery is
        // enabled for this render (the production-acceptance provider-selection
        // machinery does not forward the non-provider `mediaSearchClient`, so
        // the flag is the reliable signal). `enrichResearchWithMediaDiscovery`
        // creates its own Wikimedia client when none is passed and is fully
        // best-effort — a discovery failure never fails the research stage.
        if (dispatchOptions.mediaSearchClient || isRealMediaDiscoveryEnabled()) {
          state.research = await enrichResearchWithMediaDiscovery(state.research, {
            ...(dispatchOptions.mediaSearchClient
              ? { client: dispatchOptions.mediaSearchClient }
              : {}),
          });
        }
        return this.persistStageResult(projectSlug, stage, () =>
          ProjectManager.saveResearch(projectSlug, state.research, requireStorageContext(storageContext)),
        );
      }

      case "script":
        await dispatchBranch("aiProvider");
        state.script = await AIManager.runScript(state.project.title, {
          projectSlug,
          stage: "script",
          operation: "script",
        }, dispatchOptions.aiProvider, generationPolicy, state.research);
        if (persistedPolicy?.strictProductionAcceptance) {
          validateProductionAcceptanceScriptDuration(state.script);
        }
        return this.persistStageResult(projectSlug, stage, () =>
          ProjectManager.saveScript(projectSlug, state.script, requireStorageContext(storageContext)),
        );

      case "scenes": {
        await dispatchBranch("aiProvider");
        const script = requireStageInput(state.script, "script", stage);
        state.scenes = await AIManager.runScenes(script, {
          projectSlug,
          stage: "scenes",
          operation: "scenes",
        }, dispatchOptions.aiProvider, generationPolicy, state.research);
        if (persistedPolicy?.strictProductionAcceptance) {
          validateProductionAcceptancePreflight(script, state.scenes);
        }
        return this.persistStageResult(projectSlug, stage, () =>
          ProjectManager.saveScenes(projectSlug, state.scenes, requireStorageContext(storageContext)),
        );
      }

      case "visuals": {
        const scenes = requireStageInput(state.scenes, "scenes", stage);
        if (!state.visuals) {
          state.visuals = await VisualManager.generateVisualData({
            projectId: state.project.id,
            projectSlug,
            scenes,
            aiContext: {
              projectSlug,
              stage: "visuals",
              operation: "visuals",
            },
            aiProvider: dispatchOptions.aiProvider,
            generationPolicy,
          });
        }
        // Faz 2: attach research-discovered real-media candidates to scenes and
        // prepend their known-good query terms to searchKeywords (additive,
        // deterministic; a no-op when research carries no mediaCandidates).
        state.visuals = applyResearchMediaCandidatesToVisualData(state.visuals, state.research);
        // Faz 6 (opt-in): compute the deterministic per-scene media ladder
        // (admissible real video > real photo > AI) and turn it into per-scene
        // overrides so the AI-image cap is spent predictably. Throws
        // `VisualMediaAiBudgetExceededError` BEFORE any dispatch when the plan
        // would need more than `maxAiImages` AI images.
        const maxAiImages = resolveMaxAiImages();
        // $0 opt-in: when the local placeholder covers every real miss, an
        // unmatched scene is not an AI-budget overflow — plan without the cap so
        // the ladder never fails closed here, and leave those scenes un-forced so
        // `VisualAssetPipeline` still tries a live archival search first.
        const localImageFallback = isLocalImageFallbackEnabled();
        let effectiveVisualOverrides = visualSourceOverrides;
        if (isRealMediaSelectionEnabled()) {
          const plan = selectSceneMedia({
            scenes: state.visuals.scenes,
            candidates: state.research?.mediaCandidates ?? [],
            maxAiImages: localImageFallback ? Number.POSITIVE_INFINITY : maxAiImages,
          });
          effectiveVisualOverrides = sceneMediaSelectionOverrides(
            plan,
            visualSourceOverrides,
            { skipAiImageScenes: localImageFallback },
          );
        }
        await dispatchBranch("visualAssetProvider");
        await ProjectManager.persistVisualsArtifact(projectSlug, state.visuals, requireStorageContext(storageContext));
        await VisualAssetPipeline.generateAssets({
          projectId: state.project.id,
          projectSlug,
          visualData: state.visuals,
          provider: dispatchOptions.visualAssetProvider,
          overrides: effectiveVisualOverrides,
          // Documentary media policy: a production render may contain at most
          // this many AI-generated images (default 4, overridable per render via
          // `ATOLYE_MAX_AI_IMAGES`); every other scene must be admissible real
          // media or the visuals stage fails closed.
          maxAiImages,
        });
        return this.persistStageResult(projectSlug, stage, () =>
          ProjectManager.updatePackageStatus(projectSlug, "visuals", "completed", undefined, undefined, requireStorageContext(storageContext)).then(() => undefined),
        );
      }

      case "animation": {
        const scenes = requireStageInput(state.scenes, "scenes", stage);
        const visuals = requireStageInput(state.visuals, "visuals", stage);
        const animationPlan = await AnimationPromptGenerator.generateAnimationData({
          projectId: state.project.id,
          projectSlug,
          scenes,
          visuals,
          aiContext: {
            projectSlug,
            stage: "animation",
            operation: "animation-prompt",
          },
          aiProvider: dispatchOptions.aiProvider,
          generationPolicy,
        });
        await dispatchBranch("animationProvider");
        const { updatedScenes } =
          await AnimationAssetPipeline.generateAnimationAssets({
            projectId: state.project.id,
            projectSlug,
            scenes: animationPlan.scenes,
            provider: dispatchOptions.animationProvider,
          });
        state.animation = {
          ...animationPlan,
          schemaVersion: "2",
          artifactType: "motion-plan",
          scenes: updatedScenes,
        };
        return this.persistStageResult(projectSlug, stage, () =>
          ProjectManager.saveAnimation(projectSlug, state.animation, requireStorageContext(storageContext)),
        );
      }

      case "video": {
        await dispatchBranch("videoProvider");
        const animation = requireStageInput(state.animation, "animation", stage);
        const { video } = await VideoPipeline.generateVideo({
          projectId: state.project.id,
          projectSlug,
          animation,
          provider: dispatchOptions.videoProvider,
        });
        state.video = video;
        return this.persistStageResult(projectSlug, stage, () =>
          ProjectManager.saveVideo(projectSlug, state.video, requireStorageContext(storageContext)),
        );
      }

      case "audio": {
        const script = requireStageInput(state.script, "script", stage);
        const audioPlan = await AudioManager.generateAudioData(script, {
          projectSlug,
          stage: "audio",
          operation: "audio-plan",
        }, {
          aiProvider: dispatchOptions.aiProvider,
          generationPolicy,
        });
        const { audio } = await AudioPipeline.generateAudio({
          projectId: state.project.id,
          projectSlug,
          audio: audioPlan,
          provider: dispatchOptions.audioProvider,
        });
        state.audio = audio;
        // Faz 4 (additive, best-effort): stage a licence-cleared background-music
        // bed from the local library. Rights fail-closed; any failure leaves the
        // render narration-only. Never fails the audio stage.
        try {
          const music = await stageProjectBackgroundMusic({
            projectId: state.project.id,
            projectSlug,
            audio: state.audio,
            musicStyleHint: script.musicStyle,
            // Faz 4: deterministic ambience bed from research sound-effect ideas +
            // dominant scene emotions/visual styles. Best-effort, rights-gated.
            ambienceHints: deriveAmbienceHints(state.research, script),
            storageContext: requireStorageContext(storageContext),
          });
          state.audio = music.audio;
        } catch (error) {
          console.error(
            "[PipelineStageExecutor] background music staging skipped (best-effort):",
            error,
          );
        }
        try {
          return await this.persistStageResult(projectSlug, stage, () =>
            ProjectManager.saveAudio(projectSlug, state.audio, requireStorageContext(storageContext)),
          );
        } catch {
          throw new AudioAssetGenerationError();
        }
      }

      case "assembly": {
        const script = requireStageInput(state.script, "script", stage);
        const scenes = requireStageInput(state.scenes, "scenes", stage);
        const visuals = requireStageInput(state.visuals, "visuals", stage);
        let audio = requireStageInput(state.audio, "audio", stage);
        const animation = requireStageInput(state.animation, "animation", stage);
        const video = requireStageInput(state.video, "video", stage);
        // Faz 4 (additive, best-effort, $0): ensure the licence-cleared
        // background-music bed is staged before the render. The audio stage
        // already does this, but runs whose audio stage predates music staging
        // (or where staging was skipped) would otherwise render narration-only
        // forever. Idempotent (reuses an existing `bgm` asset), rights
        // fail-closed, local-library + ffmpeg-transcode only — no provider,
        // LLM or TTS call — and never fails the assembly stage.
        try {
          const music = await stageProjectBackgroundMusic({
            projectId: state.project.id,
            projectSlug,
            audio,
            musicStyleHint: script.musicStyle,
            ambienceHints: deriveAmbienceHints(state.research, script),
            storageContext: requireStorageContext(storageContext),
          });
          if (music.staged && music.audio !== audio) {
            audio = music.audio;
            state.audio = music.audio;
            await ProjectManager.saveAudio(
              projectSlug, state.audio, requireStorageContext(storageContext),
            );
          }
        } catch (error) {
          console.error(
            "[PipelineStageExecutor] assembly-stage background music staging skipped (best-effort):",
            error,
          );
        }
        const assemblyPlan = await AssemblyManager.generateAssemblyPlan(
          script,
          scenes,
          visuals,
          audio,
          {
            project: state.project,
            animation,
            video,
          },
          {
            projectSlug,
            stage: "assembly",
            operation: "assembly-plan",
          },
          {
            aiProvider: dispatchOptions.aiProvider,
            generationPolicy,
          },
        );
        await dispatchBranch("videoAssemblyProvider");
        state.assembly = await VideoAssemblyManager.renderExistingAssets({
          projectId: state.project.id,
          projectSlug,
          scenes,
          visuals,
          audio,
          assembly: assemblyPlan,
          animation,
          video,
          provider: dispatchOptions.videoAssemblyProvider,
          strictProductionAcceptance:
            persistedPolicy?.strictProductionAcceptance === true,
        });
        try {
          return await this.persistStageResult(projectSlug, stage, () =>
            ProjectManager.saveAssembly(projectSlug, state.assembly, requireStorageContext(storageContext)),
          );
        } catch {
          throw new VideoAssemblyError();
        }
      }

      case "thumbnail": {
        const assembly = requireStageInput(state.assembly, "assembly", stage);
        const video = requireStageInput(state.video, "video", stage);
        const audio = requireStageInput(state.audio, "audio", stage);
        const previousThumbnail = state.thumbnail;
        await dispatchBranch("thumbnailProvider");
        const thumbnailPlan = await new ThumbnailEngine().generateThumbnailPlan({
          projectId: state.project.id,
          projectSlug,
          title: state.project.title,
          assembly,
          video,
          audio,
          provider: dispatchOptions.thumbnailProvider,
          generationPolicy,
        });
        state.thumbnail = await ThumbnailAssetPipeline.generateThumbnail({
          projectId: state.project.id,
          projectSlug,
          title: state.project.title,
          assembly,
          thumbnail: thumbnailPlan,
          previousThumbnail,
          provider: dispatchOptions.thumbnailProvider,
        });
        try {
          return await this.persistStageResult(projectSlug, stage, async () => {
            try {
              await ProjectManager.saveThumbnail(projectSlug, state.thumbnail, requireStorageContext(storageContext));
            } catch {
              await ThumbnailAssetPipeline.compensatePersistenceFailure(
                state.project.id,
                projectSlug,
                state.thumbnail as ThumbnailData,
              );
              throw new ThumbnailAssetGenerationError({ phase: "persistence" });
            }
          });
        } catch (error) {
          if (error instanceof ThumbnailAssetGenerationError) throw error;
          throw new ThumbnailAssetGenerationError({ phase: "persistence" });
        }
      }

      case "seo": {
        const script = requireStageInput(state.script, "script", stage);
        const thumbnail = requireStageInput(state.thumbnail, "thumbnail", stage);
        state.seo = await SEOManager.generateSEOData(
          state.project.title,
          script,
          thumbnail,
          {
            projectSlug,
            stage: "seo",
            operation: "seo-plan",
          },
          {
            aiProvider: dispatchOptions.aiProvider,
            generationPolicy,
            research: state.research,
          },
        );
        return this.persistStageResult(projectSlug, stage, () =>
          ProjectManager.saveSEO(projectSlug, state.seo, requireStorageContext(storageContext)),
        );
      }

      case "youtube": {
        const assembly = requireStageInput(state.assembly, "assembly", stage);
        const thumbnail = requireStageInput(state.thumbnail, "thumbnail", stage);
        const seo = requireStageInput(state.seo, "seo", stage);
        const previousYouTube = state.youtube;
        await dispatchBranch("youtubeProvider");
        state.youtube = await YouTubePackagePipeline.generatePackage({
          project: state.project,
          assembly,
          thumbnail,
          seo,
          provider: dispatchOptions.youtubeProvider,
        });
        try {
          const isPackageOnly =
            persistedPolicy?.youtubePublishMode === "package-only" ||
            options.stopAfterStage === "youtube";
          await ProjectManager.saveYouTube(projectSlug, state.youtube, {
            reuseExisting:
              isYouTubePublishingPackage(previousYouTube) &&
              JSON.stringify(previousYouTube) === JSON.stringify(state.youtube),
            updatePackageStatus: isPackageOnly,
          }, requireStorageContext(storageContext));
          if (isPackageOnly) {
            await emitProductionPipelineExecutionEvent("youtube-publish-skipped-package-only", {
              stage, slot: "youtubePublishProvider", selectionId: providerSelection.selectionId,
            });
            return await this.persistStageResult(projectSlug, stage, async () => {});
          }
          await dispatchBranch("youtubePublishProvider");
          await YouTubePublishPipeline.publishStoredPackage({
            projectSlug,
            provider: dispatchOptions.youtubePublishProvider,
          });
          return await this.persistStageResult(projectSlug, stage, () =>
            ProjectManager.markYouTubePublished(projectSlug, requireStorageContext(storageContext)),
          );
        } catch {
          throw new YouTubePublishError();
        }
      }

      case "export": {
        const video = requireStageInput(state.video, "video", stage);
        const audio = requireStageInput(state.audio, "audio", stage);
        const assembly = requireStageInput(state.assembly, "assembly", stage);
        const thumbnail = requireStageInput(state.thumbnail, "thumbnail", stage);
        const youtube = requireStageInput(state.youtube, "youtube", stage);
        const seo = requireStageInput(state.seo, "seo", stage);
        state.exportPackage = await packageExport({
          projectId: state.project.id,
          projectSlug,
          title: state.project.title,
          project: state.project,
          video,
          audio,
          assembly,
          thumbnail,
          youtube,
          seo,
          storageContext,
        });
        return this.persistStageResult(projectSlug, stage, () =>
          ProjectManager.saveExport(projectSlug, state.exportPackage, requireStorageContext(storageContext)),
        );
      }
    }
  }

  private static async persistStageResult(
    projectSlug: string,
    stage: ProductionStepKey,
    persist: () => Promise<void>,
  ) {
    return PipelineJobManager.persistStageSuccess(projectSlug, stage, persist);
  }
}

function requireStorageContext(
  context: RuntimeStorageContext | undefined,
): RuntimeStorageContext {
  if (!context) throw new Error("RUNTIME_STORAGE_CONTEXT_REQUIRED");
  return context;
}

function requireStageInput<T>(
  value: T | null,
  inputStage: ProductionStepKey,
  targetStage: ProductionStepKey,
): T {
  if (!value) {
    throw new Error(
      `Cannot run ${targetStage}: required ${inputStage} data is missing.`,
    );
  }

  return value;
}

/**
 * Faz 4: free-text hints for the ambience-bed selector, drawn from the research
 * sound-effect / music ideas and the script's per-chapter emotions and visual
 * styles. Pure; a `SfxLibrary` lookup maps these onto a category. Bounded.
 */
function deriveAmbienceHints(
  research: PipelineExecutionState["research"],
  script: PipelineExecutionState["script"],
): string[] {
  const out: string[] = [];
  const push = (value: unknown) => {
    if (typeof value === "string" && value.trim() && out.length < 24) out.push(value.trim());
  };
  if (research) {
    for (const idea of asStringArray(research.soundEffects)) push(idea);
    for (const idea of asStringArray(research.musicIdeas)) push(idea);
  }
  if (script && Array.isArray(script.chapters)) {
    for (const chapter of script.chapters) {
      push((chapter as { emotion?: unknown }).emotion);
      push((chapter as { visualStyle?: unknown }).visualStyle);
    }
  }
  return out;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
