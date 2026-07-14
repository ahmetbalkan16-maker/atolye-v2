import { runObservedAIRequest } from "@/lib/ai/runObservedAIRequest";
import { failClosedOrReturn, type GenerationExecutionPolicy } from "@/lib/ai/GenerationExecutionPolicy";
import type { AIProvider } from "@/lib/ai/providers";
import {
  getStringAllowEmpty,
  parseAIJsonResponse,
} from "@/lib/ai/utils";
import type { AIRequestContext } from "@/types/aiUsage";
import type { AnimationData, AnimationScene } from "@/types/animation";
import type { SceneData } from "@/types/scene";
import type { VisualData, VisualScene } from "@/types/visual";
import { buildAnimationPrompt } from "./animationPrompt";

export type AnimationPromptGeneratorInput = {
  projectId: string;
  projectSlug?: string;
  scenes: SceneData;
  visuals: VisualData;
  style?: string;
  aiContext?: Partial<AIRequestContext>;
  aiProvider?: AIProvider;
  generationPolicy?: GenerationExecutionPolicy;
};

type AnimationPromptResponse = {
  sceneId?: number;
  animationPrompt?: string;
  createdAt?: string;
};

export class AnimationPromptGenerator {
  static async generateAnimationData({
    projectId,
    projectSlug,
    scenes,
    visuals,
    style,
    aiContext,
    aiProvider,
    generationPolicy,
  }: AnimationPromptGeneratorInput): Promise<AnimationData> {
    const createdAt = new Date().toISOString();
    const animationScenes: AnimationScene[] = [];

    for (const visual of visuals.scenes) {
      animationScenes.push(
        await this.generateAnimationScene({
          projectSlug,
          scenes,
          visual,
          style,
          aiContext,
          aiProvider,
          generationPolicy,
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
    projectSlug,
    scenes,
    visual,
    style,
    aiContext,
    aiProvider,
    generationPolicy,
  }: {
    projectSlug?: string;
    scenes: SceneData;
    visual: VisualScene;
    style?: string;
    aiContext?: Partial<AIRequestContext>;
    aiProvider?: AIProvider;
    generationPolicy?: GenerationExecutionPolicy;
  }): Promise<AnimationScene> {
    return this.generateAnimationScene({
      projectSlug,
      scenes,
      visual,
      style,
      aiContext,
      aiProvider,
      generationPolicy,
    });
  }

  private static async generateAnimationScene({
    projectSlug,
    scenes,
    visual,
    style,
    aiContext,
    aiProvider,
    generationPolicy,
  }: {
    projectSlug?: string;
    scenes: SceneData;
    visual: VisualScene;
    style?: string;
    aiContext?: Partial<AIRequestContext>;
    aiProvider?: AIProvider;
    generationPolicy?: GenerationExecutionPolicy;
  }): Promise<AnimationScene> {
    const sourceScene = scenes.scenes.find((scene) => scene.id === visual.sceneId);
    const fallback = this.createFallbackAnimationScene(
      visual,
      sourceScene?.duration ?? 6,
    );
    const prompt = buildAnimationPrompt({
      scene: scenes,
      visual,
      style,
    });

    try {
      const { response } = await runObservedAIRequest({
        prompt,
        provider: aiProvider,
        context: {
          ...aiContext,
          projectSlug: aiContext?.projectSlug ?? projectSlug,
          operation:
            aiContext?.operation ?? `animation-prompt-scene-${visual.sceneId}`,
          stage: aiContext?.stage ?? "animation",
        },
      });

      if (!response.trim()) {
        console.error("[AnimationPromptGenerator] Empty provider response.");
        return failClosedOrReturn(fallback, generationPolicy);
      }

      const parsed = parseAIJsonResponse<AnimationPromptResponse>(response);
      if (
        generationPolicy?.failClosed &&
        (parsed.sceneId !== visual.sceneId ||
          typeof parsed.animationPrompt !== "string" || !parsed.animationPrompt.trim())
      ) throw new Error("invalid");

      return {
        sceneId: visual.sceneId,
        animationPrompt: getStringAllowEmpty(
          parsed.animationPrompt,
          fallback.animationPrompt,
        ),
        durationSeconds: fallback.durationSeconds,
        status: "planned",
      };
    } catch (error) {
      if (generationPolicy?.failClosed) return failClosedOrReturn(fallback, generationPolicy);
      console.error(
        "[AnimationPromptGenerator] Falling back to visual animation prompt:",
        {
          sceneId: visual.sceneId,
          error,
        },
      );

      return failClosedOrReturn(fallback, generationPolicy);
    }
  }

  private static createFallbackAnimationScene(
    visual: VisualScene,
    durationSeconds = 6,
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
      durationSeconds,
      status: "planned",
    };
  }
}

export async function generateAnimationData(
  input: AnimationPromptGeneratorInput,
): Promise<AnimationData> {
  return AnimationPromptGenerator.generateAnimationData(input);
}
