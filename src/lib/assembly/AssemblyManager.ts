import { runObservedAIRequest } from "@/lib/ai/runObservedAIRequest";
import { failClosedOrReturn, type GenerationExecutionPolicy } from "@/lib/ai/GenerationExecutionPolicy";
import type { AIProvider } from "@/lib/ai/providers";
import {
  getCreatedAt,
  getOptionalString,
  getString,
  getStringArray,
  isRecord,
  parseAIJsonResponse,
} from "@/lib/ai/utils";
import type { AIRequestContext } from "@/types/aiUsage";
import type { AnimationData } from "@/types/animation";
import type { AssemblyPlanData, AssemblyRenderInfo, AssemblyScene } from "@/types/assembly";
import type { AudioData, AudioSection } from "@/types/audio";
import type { Project } from "@/types/project";
import type { SceneData, SceneItem } from "@/types/scene";
import type { ScriptChapter, ScriptData } from "@/types/script";
import type { VideoData, VideoScene } from "@/types/video";
import type { VisualData, VisualScene } from "@/types/visual";
import { createAssemblyPrompt } from "./prompts/assemblyPrompt";

export type AssemblySourceData = {
  project?: Project | null;
  animation?: AnimationData | null;
  video?: VideoData | null;
};

export class AssemblyManager {
  static async generateAssemblyPlan(
    script: ScriptData,
    scenes: SceneData,
    visuals: VisualData,
    audio: AudioData,
    sources: AssemblySourceData = {},
    context?: Partial<AIRequestContext>,
    options: { aiProvider?: AIProvider; generationPolicy?: GenerationExecutionPolicy } = {},
  ): Promise<AssemblyPlanData> {
    const fallback = this.createFallbackAssemblyPlan(
      script,
      scenes,
      visuals,
      audio,
      sources,
    );
    const prompt = createAssemblyPrompt(script, scenes, visuals, audio, sources);

    try {
      const { response } = await runObservedAIRequest({
        prompt,
        provider: options.aiProvider,
        context: {
          ...context,
          projectSlug: context?.projectSlug ?? sources.project?.slug,
          operation: context?.operation ?? "assembly-plan",
          stage: context?.stage ?? "assembly",
        },
      });

      if (!response.trim()) {
        console.error("[AssemblyManager] Empty provider response.");
        return failClosedOrReturn(fallback, options.generationPolicy);
      }

      const parsed = parseAIJsonResponse<Partial<AssemblyPlanData>>(response);
      if (
        options.generationPolicy?.failClosed &&
        !isStrictAssemblyResponse(parsed, scenes)
      ) throw new Error("invalid");

      return {
        projectId: fallback.projectId,
        slug: fallback.slug,
        title: fallback.title,
        status: "assembled",
        sourceVideoAssetId: fallback.sourceVideoAssetId,
        sourceAudioAssetId: fallback.sourceAudioAssetId,
        outputAssetId: fallback.outputAssetId,
        scenes: this.mapScenes(parsed.scenes, fallback.scenes),
        totalDuration: getString(
          parsed.totalDuration,
          fallback.totalDuration,
        ),
        style: getString(parsed.style, fallback.style),
        render: this.mapRender(parsed.render, fallback.render),
        createdAt: getCreatedAt(parsed.createdAt, fallback.createdAt),
        updatedAt: new Date().toISOString(),
      };
    } catch (error) {
      if (options.generationPolicy?.failClosed) return failClosedOrReturn(fallback, options.generationPolicy);
      console.error(
        "[AssemblyManager] Falling back to local assembly plan:",
        error,
      );
      return failClosedOrReturn(fallback, options.generationPolicy);
    }
  }

  private static createFallbackAssemblyPlan(
    script: ScriptData,
    scenes: SceneData,
    visuals: VisualData,
    audio: AudioData,
    sources: AssemblySourceData,
  ): AssemblyPlanData {
    const assemblyScenes = scenes.scenes.map((scene, index) => {
      const chapter = this.findChapter(script.chapters, scene, index);
      const visual = this.findVisual(visuals.scenes, scene, index);
      const section = this.findAudioSection(audio.sections, scene, index);
      const videoScene = this.findVideoScene(sources.video?.scenes, scene, index);

      return this.createFallbackScene(
        scene,
        chapter,
        visual,
        section,
        videoScene,
        sources.animation,
        index,
      );
    });
    const now = new Date().toISOString();

    return {
      projectId: sources.project?.id,
      slug: sources.project?.slug,
      title: sources.project?.title,
      status: "assembled",
      sourceVideoAssetId: sources.video?.outputAssetId,
      sourceAudioAssetId: audio.outputAssetId,
      scenes: assemblyScenes,
      totalDuration:
        audio.production.estimatedTotalDuration ||
        this.formatDuration(script.estimatedDuration),
      style: "documentary cinematic",
      render: {
        status: "planned",
        format: "mp4",
      },
      createdAt: now,
      updatedAt: now,
    };
  }

  private static createFallbackScene(
    scene: SceneItem,
    chapter: ScriptChapter | undefined,
    visual: VisualScene | undefined,
    section: AudioSection | undefined,
    video: VideoScene | undefined,
    animation: AnimationData | null | undefined,
    index: number,
  ): AssemblyScene {
    const sceneId = scene.id || index + 1;
    const animationScene = animation?.scenes.find(
      (item) => item.sceneId === sceneId,
    );

    return {
      sceneId,
      chapterId: scene.chapterId ?? chapter?.id,
      duration:
        section?.duration ||
        this.formatDuration(scene.duration ?? chapter?.duration ?? 30),
      visualReference: `visual-${visual?.sceneId ?? sceneId}`,
      animationAssetId: animationScene?.outputAssetId,
      videoAssetId: video?.outputAssetId,
      audioAssetId: section?.outputAssetId,
      audioReference: `section-${section?.chapterId ?? chapter?.id ?? sceneId}`,
      transition: chapter?.transition || "fade",
      cameraMovement: this.inferCameraMovement(visual?.animationPrompt),
      effects: this.inferEffects(scene, visual, section),
      notes: scene.description,
    };
  }

  private static mapScenes(
    value: unknown,
    fallback: AssemblyScene[],
  ): AssemblyScene[] {
    if (!Array.isArray(value)) {
      return fallback;
    }

    return value.map((item, index) => {
      const scene = item as Partial<AssemblyScene>;
      const fallbackScene: AssemblyScene = fallback[index] ?? {
        sceneId: index + 1,
        duration: "00:30",
        visualReference: `visual-${index + 1}`,
        audioReference: `section-${index + 1}`,
        transition: "fade",
        cameraMovement: "slow zoom",
        effects: [],
      };

      return {
        sceneId:
          typeof scene.sceneId === "number"
            ? scene.sceneId
            : fallbackScene.sceneId,
        chapterId:
          typeof scene.chapterId === "number"
            ? scene.chapterId
            : fallbackScene.chapterId,
        duration: getString(scene.duration, fallbackScene.duration),
        visualReference: getString(
          scene.visualReference,
          fallbackScene.visualReference,
        ),
        animationAssetId:
          getOptionalString(scene.animationAssetId) ??
          fallbackScene.animationAssetId,
        videoAssetId:
          getOptionalString(scene.videoAssetId) ?? fallbackScene.videoAssetId,
        audioAssetId:
          getOptionalString(scene.audioAssetId) ?? fallbackScene.audioAssetId,
        audioReference: getString(
          scene.audioReference,
          fallbackScene.audioReference,
        ),
        transition: getString(scene.transition, fallbackScene.transition),
        cameraMovement: getString(
          scene.cameraMovement,
          fallbackScene.cameraMovement,
        ),
        effects: getStringArray(scene.effects, fallbackScene.effects),
        notes: getOptionalString(scene.notes) ?? fallbackScene.notes,
      };
    });
  }

  private static mapRender(
    value: unknown,
    fallback: AssemblyRenderInfo | undefined,
  ): AssemblyRenderInfo | undefined {
    const render = value as Partial<AssemblyRenderInfo>;

    if (!isRecord(render)) {
      return fallback;
    }

    return {
      status:
        render.status === "rendered" ||
        render.status === "failed" ||
        render.status === "planned"
          ? render.status
          : fallback?.status ?? "planned",
      outputUrl: getOptionalString(render.outputUrl),
      format: render.format === "mp4" ? render.format : fallback?.format,
    };
  }

  private static findChapter(
    chapters: ScriptChapter[],
    scene: SceneItem,
    index: number,
  ): ScriptChapter | undefined {
    return chapters.find((chapter) => chapter.id === scene.chapterId) ??
      chapters.find((chapter) => chapter.id === scene.id) ?? chapters[index];
  }

  private static findVisual(
    visuals: VisualScene[],
    scene: SceneItem,
    index: number,
  ): VisualScene | undefined {
    return visuals.find((visual) => visual.sceneId === scene.id) ?? visuals[index];
  }

  private static findAudioSection(
    sections: AudioSection[],
    scene: SceneItem,
    index: number,
  ): AudioSection | undefined {
    return (
      sections.find((section) => section.chapterId === scene.chapterId) ??
      sections.find((section) => section.chapterId === scene.id) ??
      sections[index]
    );
  }

  private static findVideoScene(
    videos: VideoScene[] | undefined,
    scene: SceneItem,
    index: number,
  ): VideoScene | undefined {
    if (!videos) {
      return undefined;
    }

    return videos.find((video) => video.sceneId === scene.id) ?? videos[index];
  }

  private static inferCameraMovement(animationPrompt?: string): string {
    if (animationPrompt?.trim()) {
      return animationPrompt;
    }

    return "slow cinematic zoom";
  }

  private static inferEffects(
    scene: SceneItem,
    visual: VisualScene | undefined,
    section: AudioSection | undefined,
  ): string[] {
    return [
      visual?.style ? `${visual.style} grade` : "cinematic color grade",
      section?.emotion ? `${section.emotion} pacing` : "documentary pacing",
      scene.visualPrompt ? "prompt matched visual atmosphere" : "subtle dust",
    ];
  }

  private static formatDuration(seconds: number): string {
    const safeSeconds = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
    const minutes = Math.floor(safeSeconds / 60);
    const remainingSeconds = Math.round(safeSeconds % 60);

    return `${String(minutes).padStart(2, "0")}:${String(
      remainingSeconds,
    ).padStart(2, "0")}`;
  }

}

function isStrictAssemblyResponse(value: Partial<AssemblyPlanData>, source: SceneData) {
  const render = value.render as Partial<AssemblyRenderInfo> | undefined;
  return Array.isArray(value.scenes) && value.scenes.length === source.scenes.length &&
    value.scenes.every((scene, index) => typeof scene?.sceneId === "number" &&
      scene.sceneId === source.scenes[index]?.id &&
      typeof scene.chapterId === "number" &&
      scene.chapterId === source.scenes[index]?.chapterId &&
      [scene.duration, scene.visualReference, scene.audioReference, scene.transition, scene.cameraMovement]
        .every(nonEmptyString) &&
      Array.isArray(scene.effects) && scene.effects.every((item) => typeof item === "string") &&
      (scene.notes === undefined || typeof scene.notes === "string")) &&
    nonEmptyString(value.totalDuration) && nonEmptyString(value.style) &&
    render?.status === "planned" && render.format === "mp4" &&
    validTimestamp(value.createdAt);
}

function nonEmptyString(value: unknown): value is string { return typeof value === "string" && Boolean(value.trim()); }
function validTimestamp(value: unknown) { if (typeof value !== "string") return false; const parsed = Date.parse(value); return Number.isFinite(parsed) && new Date(parsed).toISOString() === value; }
