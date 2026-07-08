import { AIRouter } from "@/lib/ai/router/AIRouter";
import {
  getStringAllowEmpty,
  parseAIJsonResponse,
} from "@/lib/ai/utils";
import type { AnimationData, AnimationScene } from "@/types/animation";
import type { SceneData } from "@/types/scene";
import type { VisualData, VisualScene } from "@/types/visual";
import { buildAnimationPrompt } from "./animationPrompt";

export type AnimationPromptGeneratorInput = {
  projectId: string;
  scenes: SceneData;
  visuals: VisualData;
  style?: string;
};

type AnimationPromptResponse = {
  sceneId?: number;
  animationPrompt?: string;
  createdAt?: string;
};

export class AnimationPromptGenerator {
  private static router = new AIRouter();

  static async generateAnimationData({
    projectId,
    scenes,
    visuals,
    style,
  }: AnimationPromptGeneratorInput): Promise<AnimationData> {
    const createdAt = new Date().toISOString();
    const animationScenes: AnimationScene[] = [];

    for (const visual of visuals.scenes) {
      animationScenes.push(
        await this.generateAnimationScene({
          scenes,
          visual,
          style,
        }),
      );
    }

    return {
      projectId,
      scenes: animationScenes,
      createdAt,
    };
  }

  static async generateAnimationSceneData({
    scenes,
    visual,
    style,
  }: {
    scenes: SceneData;
    visual: VisualScene;
    style?: string;
  }): Promise<AnimationScene> {
    return this.generateAnimationScene({
      scenes,
      visual,
      style,
    });
  }

  private static async generateAnimationScene({
    scenes,
    visual,
    style,
  }: {
    scenes: SceneData;
    visual: VisualScene;
    style?: string;
  }): Promise<AnimationScene> {
    const fallback = this.createFallbackAnimationScene(visual);
    const prompt = buildAnimationPrompt({
      scene: scenes,
      visual,
      style,
    });

    try {
      const provider = this.router.getProvider("openai");
      const response = await provider.generate(prompt);

      if (!response.trim()) {
        console.error("[AnimationPromptGenerator] Empty provider response.");
        return fallback;
      }

      const parsed = parseAIJsonResponse<AnimationPromptResponse>(response);

      return {
        sceneId: visual.sceneId,
        animationPrompt: getStringAllowEmpty(
          parsed.animationPrompt,
          fallback.animationPrompt,
        ),
        status: "planned",
      };
    } catch (error) {
      console.error(
        "[AnimationPromptGenerator] Falling back to visual animation prompt:",
        {
          sceneId: visual.sceneId,
          error,
        },
      );

      return fallback;
    }
  }

  private static createFallbackAnimationScene(
    visual: VisualScene,
  ): AnimationScene {
    return {
      sceneId: visual.sceneId,
      animationPrompt:
        visual.animationPrompt.trim() ||
        [
          "Slow cinematic camera movement",
          "realistic historical motion",
          "documentary atmosphere",
          "subtle depth and particles",
          visual.visualPrompt,
        ].join(", "),
      status: "planned",
    };
  }
}

export async function generateAnimationData(
  input: AnimationPromptGeneratorInput,
): Promise<AnimationData> {
  return AnimationPromptGenerator.generateAnimationData(input);
}
