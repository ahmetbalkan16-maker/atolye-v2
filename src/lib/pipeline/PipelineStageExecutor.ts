import { AIManager } from "@/lib/ai/AIManager";
import { AnimationAssetPipeline } from "@/lib/animation/AnimationAssetPipeline";
import { AnimationPromptGenerator } from "@/lib/animation/prompts/AnimationPromptGenerator";
import { AssemblyManager } from "@/lib/assembly/AssemblyManager";
import { AudioManager } from "@/lib/audio/AudioManager";
import {
  AudioAssetGenerationError,
  AudioPipeline,
} from "@/lib/audio/AudioPipeline";
import type { AudioProvider } from "@/lib/audio/providers/AudioProvider";
import { VisualAssetPipeline } from "@/lib/assets/VisualAssetPipeline";
import type { ImageProvider } from "@/lib/assets/providers/ImageProvider";
import { ExportEngine } from "@/lib/export/ExportEngine";
import { ProjectManager } from "@/lib/projects/ProjectManager";
import { SEOManager } from "@/lib/seo/SEOManager";
import { ThumbnailEngine } from "@/lib/thumbnail/ThumbnailEngine";
import { VideoPipeline } from "@/lib/video/VideoPipeline";
import { VisualManager } from "@/lib/visuals/VisualManager";
import { YouTubeEngine } from "@/lib/youtube/YouTubeEngine";
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
  visualAssetProvider?: ImageProvider;
  audioProvider?: AudioProvider;
};

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
      ProjectManager.getAnimation(projectSlug) as Promise<AnimationData | null>,
      ProjectManager.getVideo(projectSlug) as Promise<VideoData | null>,
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
      animation,
      video,
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
  ): Promise<boolean> {
    switch (stage) {
      case "research":
        state.research = await AIManager.runResearch(state.project.title, {
          projectSlug,
          stage: "research",
          operation: "research",
        });
        return this.persistStageResult(projectSlug, stage, () =>
          ProjectManager.saveResearch(projectSlug, state.research),
        );

      case "script":
        state.script = await AIManager.runScript(state.project.title, {
          projectSlug,
          stage: "script",
          operation: "script",
        });
        return this.persistStageResult(projectSlug, stage, () =>
          ProjectManager.saveScript(projectSlug, state.script),
        );

      case "scenes": {
        const script = requireStageInput(state.script, "script", stage);
        state.scenes = await AIManager.runScenes(script, {
          projectSlug,
          stage: "scenes",
          operation: "scenes",
        });
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
        });
        await VisualAssetPipeline.generateAssets({
          projectId: state.project.id,
          projectSlug,
          visualData: state.visuals,
          provider: options.visualAssetProvider,
        });
        return this.persistStageResult(projectSlug, stage, () =>
          ProjectManager.saveVisuals(projectSlug, state.visuals),
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
        });
        const { updatedScenes } =
          await AnimationAssetPipeline.generateAnimationAssets({
            projectId: state.project.id,
            projectSlug,
            scenes: animationPlan.scenes,
          });
        state.animation = {
          ...animationPlan,
          scenes: updatedScenes,
        };
        return this.persistStageResult(projectSlug, stage, () =>
          ProjectManager.saveAnimation(projectSlug, state.animation),
        );
      }

      case "video": {
        const animation = requireStageInput(state.animation, "animation", stage);
        const { video } = await VideoPipeline.generateVideo({
          projectId: state.project.id,
          projectSlug,
          animation,
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
        });
        const { audio } = await AudioPipeline.generateAudio({
          projectId: state.project.id,
          projectSlug,
          audio: audioPlan,
          provider: options.audioProvider,
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
        state.assembly = await AssemblyManager.generateAssemblyPlan(
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
        );
        return this.persistStageResult(projectSlug, stage, () =>
          ProjectManager.saveAssembly(projectSlug, state.assembly),
        );
      }

      case "thumbnail": {
        const assembly = requireStageInput(state.assembly, "assembly", stage);
        const video = requireStageInput(state.video, "video", stage);
        const audio = requireStageInput(state.audio, "audio", stage);
        state.thumbnail = await new ThumbnailEngine().generateThumbnailPlan({
          projectId: state.project.id,
          projectSlug,
          title: state.project.title,
          assembly,
          video,
          audio,
        });
        return this.persistStageResult(projectSlug, stage, () =>
          ProjectManager.saveThumbnail(projectSlug, state.thumbnail),
        );
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
        );
        return this.persistStageResult(projectSlug, stage, () =>
          ProjectManager.saveSEO(projectSlug, state.seo),
        );
      }

      case "youtube": {
        const video = requireStageInput(state.video, "video", stage);
        const audio = requireStageInput(state.audio, "audio", stage);
        const assembly = requireStageInput(state.assembly, "assembly", stage);
        const thumbnail = requireStageInput(state.thumbnail, "thumbnail", stage);
        state.youtube = await new YouTubeEngine().generatePublishingPackage({
          projectId: state.project.id,
          projectSlug,
          title: state.project.title,
          video,
          audio,
          assembly,
          thumbnail,
        });
        return this.persistStageResult(projectSlug, stage, () =>
          ProjectManager.saveYouTube(projectSlug, state.youtube),
        );
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
