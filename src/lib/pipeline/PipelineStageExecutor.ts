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
import { VisualAssetPipeline } from "@/lib/assets/VisualAssetPipeline";
import type { ImageProvider } from "@/lib/assets/providers/ImageProvider";
import { ImageProviderRouter } from "@/lib/assets/providers/ImageProviderRouter";
import { ExportEngine } from "@/lib/export/ExportEngine";
import { ProjectManager } from "@/lib/projects/ProjectManager";
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
  type ProductionAcceptanceProviderSelection } from
  "@/lib/production/ProductionAcceptanceExecutionScope";
import type { ProjectPackageRunType } from "@/types/project";
import { emitProductionPipelineExecutionEvent } from
  "@/lib/production/ProductionPipelineExecutionInstrumentation";

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
};

export function materializePipelineStageExecutionOptions(
  stage: ProductionStepKey,
  source: PipelineStageExecutionOptions = {},
): { options: Readonly<PipelineStageExecutionOptions>;
  configuredOptions: readonly (keyof PipelineStageExecutionOptions)[] } {
  const captured: PipelineStageExecutionOptions = {
    aiProvider: source.aiProvider, visualAssetProvider: source.visualAssetProvider,
    animationProvider: source.animationProvider, videoProvider: source.videoProvider,
    audioProvider: source.audioProvider, videoAssemblyProvider: source.videoAssemblyProvider,
    thumbnailProvider: source.thumbnailProvider, youtubeProvider: source.youtubeProvider,
    youtubePublishProvider: source.youtubePublishProvider,
  };
  const configured: (keyof PipelineStageExecutionOptions)[] = [];
  const ensure = <K extends keyof PipelineStageExecutionOptions>(key: K, create: () =>
    NonNullable<PipelineStageExecutionOptions[K]>) => {
    if (!captured[key]) {
      (captured as Record<K, PipelineStageExecutionOptions[K]>)[key] = create();
      configured.push(key);
    }
  };
  if (["research", "script", "scenes", "visuals", "animation", "audio", "assembly", "seo"]
    .includes(stage)) ensure("aiProvider", () => new AIRouter().getProvider());
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

  static async loadState(projectSlug: string): Promise<PipelineExecutionState | null> {
    const project = await ProjectManager.getProject(projectSlug);

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
      ProjectManager.getResearch(projectSlug) as Promise<ResearchData | null>,
      ProjectManager.getScript(projectSlug) as Promise<ScriptData | null>,
      ProjectManager.getScenes(projectSlug) as Promise<SceneData | null>,
      ProjectManager.getVisuals(projectSlug) as Promise<VisualData | null>,
      ProjectManager.getAnimation(projectSlug),
      ProjectManager.getVideo(projectSlug),
      ProjectManager.getAudio(projectSlug) as Promise<AudioData | null>,
      ProjectManager.getAssembly(projectSlug) as Promise<AssemblyPlanData | null>,
      ProjectManager.getThumbnail(projectSlug) as Promise<ThumbnailData | null>,
      ProjectManager.getSEO(projectSlug) as Promise<SEOData | null>,
      ProjectManager.getYouTube(projectSlug) as Promise<YouTubePublishingPackage | null>,
      ProjectManager.getExport(projectSlug) as Promise<ExportPackageData | null>,
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
      case "research":
        await dispatchBranch("aiProvider");
        state.research = await AIManager.runResearch(state.project.title, {
          projectSlug,
          stage: "research",
          operation: "research",
        }, dispatchOptions.aiProvider, generationPolicy);
        return this.persistStageResult(projectSlug, stage, () =>
          ProjectManager.saveResearch(projectSlug, state.research),
        );

      case "script":
        await dispatchBranch("aiProvider");
        state.script = await AIManager.runScript(state.project.title, {
          projectSlug,
          stage: "script",
          operation: "script",
        }, dispatchOptions.aiProvider, generationPolicy);
        if (persistedPolicy?.strictProductionAcceptance) {
          validateProductionAcceptanceScriptDuration(state.script);
        }
        return this.persistStageResult(projectSlug, stage, () =>
          ProjectManager.saveScript(projectSlug, state.script),
        );

      case "scenes": {
        await dispatchBranch("aiProvider");
        const script = requireStageInput(state.script, "script", stage);
        state.scenes = await AIManager.runScenes(script, {
          projectSlug,
          stage: "scenes",
          operation: "scenes",
        }, dispatchOptions.aiProvider, generationPolicy);
        if (persistedPolicy?.strictProductionAcceptance) {
          validateProductionAcceptancePreflight(script, state.scenes);
        }
        return this.persistStageResult(projectSlug, stage, () =>
          ProjectManager.saveScenes(projectSlug, state.scenes),
        );
      }

      case "visuals": {
        const scenes = requireStageInput(state.scenes, "scenes", stage);
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
        await dispatchBranch("visualAssetProvider");
        await ProjectManager.persistVisualsArtifact(projectSlug, state.visuals);
        await VisualAssetPipeline.generateAssets({
          projectId: state.project.id,
          projectSlug,
          visualData: state.visuals,
          provider: dispatchOptions.visualAssetProvider,
        });
        return this.persistStageResult(projectSlug, stage, () =>
          ProjectManager.updatePackageStatus(projectSlug, "visuals", "completed").then(() => undefined),
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
          ProjectManager.saveAnimation(projectSlug, state.animation),
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
          ProjectManager.saveVideo(projectSlug, state.video),
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
        try {
          return await this.persistStageResult(projectSlug, stage, () =>
            ProjectManager.saveAudio(projectSlug, state.audio),
          );
        } catch {
          throw new AudioAssetGenerationError();
        }
      }

      case "assembly": {
        const script = requireStageInput(state.script, "script", stage);
        const scenes = requireStageInput(state.scenes, "scenes", stage);
        const visuals = requireStageInput(state.visuals, "visuals", stage);
        const audio = requireStageInput(state.audio, "audio", stage);
        const animation = requireStageInput(state.animation, "animation", stage);
        const video = requireStageInput(state.video, "video", stage);
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
            ProjectManager.saveAssembly(projectSlug, state.assembly),
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
              await ProjectManager.saveThumbnail(projectSlug, state.thumbnail);
            } catch {
              await ThumbnailAssetPipeline.compensatePersistenceFailure(
                state.project.id,
                projectSlug,
                state.thumbnail as ThumbnailData,
              );
              throw new ThumbnailAssetGenerationError();
            }
          });
        } catch {
          throw new ThumbnailAssetGenerationError();
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
          },
        );
        return this.persistStageResult(projectSlug, stage, () =>
          ProjectManager.saveSEO(projectSlug, state.seo),
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
          await ProjectManager.saveYouTube(projectSlug, state.youtube, {
            reuseExisting:
              isYouTubePublishingPackage(previousYouTube) &&
              JSON.stringify(previousYouTube) === JSON.stringify(state.youtube),
            updatePackageStatus: false,
          });
          if (persistedPolicy?.youtubePublishMode === "package-only") {
            return await this.persistStageResult(projectSlug, stage, async () => {});
          }
          await YouTubePublishPipeline.publishStoredPackage({
            projectSlug,
            provider: dispatchOptions.youtubePublishProvider,
          });
          return await this.persistStageResult(projectSlug, stage, () =>
            ProjectManager.markYouTubePublished(projectSlug),
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
        state.exportPackage = await new ExportEngine().generateExportPackage({
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
        });
        return this.persistStageResult(projectSlug, stage, () =>
          ProjectManager.saveExport(projectSlug, state.exportPackage),
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
