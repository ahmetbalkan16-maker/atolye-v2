import { AIRouter } from "@/lib/ai/router/AIRouter";
import {
  getCreatedAt,
  getNumber,
  getStringAllowEmpty,
  isRecord,
  parseAIJsonResponse,
} from "@/lib/ai/utils";
import type { SceneData, SceneItem } from "@/types/scene";
import type {
  ThumbnailConcept,
  VisualData,
  VisualPrompt,
  VisualScene,
} from "@/types/visual";
import { VisualPromptEngine } from "./VisualPromptEngine";

type VisualManagerInput = {
  projectId?: string;
  scenes: SceneData;
  style?: string;
};

export class VisualManager {
  private static router = new AIRouter();

  static async generateVisualData({
    projectId,
    scenes,
    style = "cinematic",
  }: VisualManagerInput): Promise<VisualData> {
    const fallback = this.createFallbackVisualData(scenes, style, projectId);
    const prompt = VisualPromptEngine.createPrompt(scenes, style);

    try {
      const provider = this.router.getProvider("openai");
      const response = await provider.generate(prompt);

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
      thumbnail: {
        title: "Historical Documentary Thumbnail",
        prompt:
          "Epic historical YouTube thumbnail, strong character focus, high contrast, cinematic documentary style",
        composition: "Centered hero subject with dramatic background and strong depth.",
        mood: "epic, dramatic, historical",
      },
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
      animationPrompt:
        "Slow cinematic camera movement, realistic motion, atmospheric particles, documentary style",
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
        animationPrompt:
          getStringAllowEmpty(
            scene.animationPrompt,
            "Slow cinematic camera movement, documentary style",
          ),
        style: getStringAllowEmpty(scene.style, style),
      };
    });
  }

  private static mapThumbnail(
    value: unknown,
    fallback: ThumbnailConcept,
  ): ThumbnailConcept {
    const thumbnail = value as Partial<ThumbnailConcept>;

    if (!isRecord(thumbnail)) {
      return fallback;
    }

    return {
      title: getStringAllowEmpty(thumbnail.title, fallback.title),
      prompt: getStringAllowEmpty(thumbnail.prompt, fallback.prompt),
      composition: getStringAllowEmpty(
        thumbnail.composition,
        fallback.composition,
      ),
      mood: getStringAllowEmpty(thumbnail.mood, fallback.mood),
    };
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
