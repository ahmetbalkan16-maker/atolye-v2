import { AIRouter } from "@/lib/ai/router/AIRouter";
import {
  getCreatedAt,
  getOptionalString,
  getString,
  getStringArray,
  isRecord,
  parseAIJsonResponse,
} from "@/lib/ai/utils";
import type { AssemblyPlanData, AssemblyRenderInfo, AssemblyScene } from "@/types/assembly";
import type { AudioData, AudioSection } from "@/types/audio";
import type { SceneData, SceneItem } from "@/types/scene";
import type { ScriptChapter, ScriptData } from "@/types/script";
import type { VisualData, VisualScene } from "@/types/visual";
import { createAssemblyPrompt } from "./prompts/assemblyPrompt";

export class AssemblyManager {
  private static router = new AIRouter();

  static async generateAssemblyPlan(
    script: ScriptData,
    scenes: SceneData,
    visuals: VisualData,
    audio: AudioData,
  ): Promise<AssemblyPlanData> {
    const fallback = this.createFallbackAssemblyPlan(
      script,
      scenes,
      visuals,
      audio,
    );
    const prompt = createAssemblyPrompt(script, scenes, visuals, audio);

    try {
      const provider = this.router.getProvider("openai");
      const response = await provider.generate(prompt);

      if (!response.trim()) {
        console.error("[AssemblyManager] Empty provider response.");
        return fallback;
      }

      const parsed = parseAIJsonResponse<Partial<AssemblyPlanData>>(response);

      return {
        scenes: this.mapScenes(parsed.scenes, fallback.scenes),
        totalDuration: getString(
          parsed.totalDuration,
          fallback.totalDuration,
        ),
        style: getString(parsed.style, fallback.style),
        render: this.mapRender(parsed.render, fallback.render),
        createdAt: getCreatedAt(parsed.createdAt, fallback.createdAt),
      };
    } catch (error) {
      console.error(
        "[AssemblyManager] Falling back to local assembly plan:",
        error,
      );
      return fallback;
    }
  }

  private static createFallbackAssemblyPlan(
    script: ScriptData,
    scenes: SceneData,
    visuals: VisualData,
    audio: AudioData,
  ): AssemblyPlanData {
    const assemblyScenes = scenes.scenes.map((scene, index) => {
      const chapter = this.findChapter(script.chapters, scene, index);
      const visual = this.findVisual(visuals.scenes, scene, index);
      const section = this.findAudioSection(audio.sections, scene, index);

      return this.createFallbackScene(scene, chapter, visual, section, index);
    });

    return {
      scenes: assemblyScenes,
      totalDuration:
        audio.production.estimatedTotalDuration ||
        this.formatDuration(script.estimatedDuration),
      style: "documentary cinematic",
      render: {
        status: "planned",
        format: "mp4",
      },
      createdAt: new Date().toISOString(),
    };
  }

  private static createFallbackScene(
    scene: SceneItem,
    chapter: ScriptChapter | undefined,
    visual: VisualScene | undefined,
    section: AudioSection | undefined,
    index: number,
  ): AssemblyScene {
    const sceneId = scene.id || index + 1;

    return {
      sceneId,
      duration:
        section?.duration ||
        this.formatDuration(scene.duration ?? chapter?.duration ?? 30),
      visualReference: `visual-${visual?.sceneId ?? sceneId}`,
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
      const fallbackScene = fallback[index] ?? {
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
        duration: getString(scene.duration, fallbackScene.duration),
        visualReference: getString(
          scene.visualReference,
          fallbackScene.visualReference,
        ),
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
    return chapters.find((chapter) => chapter.id === scene.id) ?? chapters[index];
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
      sections.find((section) => section.chapterId === scene.id) ??
      sections[index]
    );
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
