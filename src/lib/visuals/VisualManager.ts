import { runObservedAIRequest } from "@/lib/ai/runObservedAIRequest";
import {
  getCreatedAt,
  getNumber,
  getStringAllowEmpty,
  parseAIJsonResponse,
} from "@/lib/ai/utils";
import type { AIRequestContext } from "@/types/aiUsage";
import type { SceneData, SceneItem } from "@/types/scene";
import type {
  ThumbnailConcept,
  VisualData,
  VisualPrompt,
  VisualScene,
} from "@/types/visual";
import { AnimationPromptEngine } from "./AnimationPromptEngine";
import { ThumbnailConceptEngine } from "./ThumbnailConceptEngine";
import { VisualPromptEngine } from "./VisualPromptEngine";

type VisualManagerInput = {
  projectId?: string;
  projectSlug?: string;
  scenes: SceneData;
  style?: string;
  aiContext?: Partial<AIRequestContext>;
};

export class VisualManager {
  static async generateVisualData({
    projectId,
    projectSlug,
    scenes,
    style = "cinematic",
    aiContext,
  }: VisualManagerInput): Promise<VisualData> {
    const fallback = this.createFallbackVisualData(scenes, style, projectId);
    const prompt = VisualPromptEngine.createPrompt(scenes, style);

    try {
      const { response } = await runObservedAIRequest({
        prompt,
        context: {
          ...aiContext,
          projectSlug: aiContext?.projectSlug ?? projectSlug,
          operation: aiContext?.operation ?? "visuals",
          stage: aiContext?.stage ?? "visuals",
        },
      });

      if (!response.trim()) {
        console.error("[VisualManager] Empty provider response.");
        return fallback;
      }

      const parsed = parseAIJsonResponse<Partial<VisualData>>(response);
      const visualScenes = this.mapVisualScenes(parsed.scenes, scenes.scenes, style);
      const thumbnail = this.mapThumbnail(parsed.thumbnail, fallback.thumbnail);
      const createdAt = getCreatedAt(parsed.createdAt, fallback.createdAt);

      return {
        scenes: visualScenes,
        thumbnail,
        createdAt,
        projectId: projectId ?? "visual-project",
        prompts: this.toLegacyPrompts(visualScenes, scenes.scenes, createdAt),
        generatedAt: createdAt,
      };
    } catch (error) {
      console.error("[VisualManager] Falling back to local visual prompts:", error);
      return fallback;
    }
  }

  private static createFallbackVisualData(
    scenes: SceneData,
    style: string,
    projectId?: string,
  ): VisualData {
    const createdAt = new Date().toISOString();
    const visualScenes = scenes.scenes.map((scene) =>
      this.createFallbackVisualScene(scene, style),
    );

    return {
      scenes: visualScenes,
      thumbnail: ThumbnailConceptEngine.createFallbackConcept(style),
      createdAt,
      projectId: projectId ?? "visual-project",
      prompts: this.toLegacyPrompts(visualScenes, scenes.scenes, createdAt),
      generatedAt: createdAt,
    };
  }

  private static createFallbackVisualScene(
    scene: SceneItem,
    style: string,
  ): VisualScene {
    return {
      sceneId: scene.id,
      visualPrompt: [
        `${style} documentary style`,
        scene.visualPrompt || scene.description,
        "realistic historical atmosphere",
        "dramatic lighting",
        "8K detail",
        "no text, no logo, no watermark",
      ].join(", "),
      animationPrompt: AnimationPromptEngine.createFallbackPrompt(scene, style),
      style,
    };
  }

  private static mapVisualScenes(
    value: unknown,
    sourceScenes: SceneItem[],
    style: string,
  ): VisualScene[] {
    if (!Array.isArray(value)) {
      return sourceScenes.map((scene) => this.createFallbackVisualScene(scene, style));
    }

    return value.map((item, index) => {
      const scene = item as Partial<VisualScene>;
      const sourceScene = sourceScenes[index];

      return {
        sceneId:
          getNumber(scene.sceneId, sourceScene?.id ?? index + 1),
        visualPrompt:
          getStringAllowEmpty(
            scene.visualPrompt,
            this.createFallbackVisualScene(sourceScene, style).visualPrompt,
          ),
        animationPrompt: AnimationPromptEngine.normalizePrompt(
          scene.animationPrompt,
          sourceScene,
          style,
        ),
        style: getStringAllowEmpty(scene.style, style),
      };
    });
  }

  private static mapThumbnail(
    value: unknown,
    fallback: ThumbnailConcept,
  ): ThumbnailConcept {
    return ThumbnailConceptEngine.normalizeConcept(value, fallback);
  }

  private static toLegacyPrompts(
    visualScenes: VisualScene[],
    sourceScenes: SceneItem[],
    createdAt: string,
  ): VisualPrompt[] {
    return visualScenes.map((scene, index) => ({
      id: `visual-${index + 1}`,
      sceneId: String(scene.sceneId),
      title: sourceScenes[index]?.title ?? `Sahne ${index + 1}`,
      prompt: scene.visualPrompt,
      negativePrompt:
        "text, subtitles, logo, watermark, modern clothes, modern buildings, cartoon, anime, low quality, blurry",
      aspectRatio: "16:9",
      style: "cinematic",
      camera: "wide cinematic shot",
      lighting: "dramatic historical lighting",
      lens: "35mm lens",
      mood: "epic, emotional, documentary",
      colorPalette: "natural historical colors, cinematic contrast",
      createdAt,
    }));
  }

}
