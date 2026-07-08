import { AssetManager } from "@/lib/assets/AssetManager";
import type { ProjectAssets } from "@/types/asset";
import type { AnimationScene, AnimationStatus } from "@/types/animation";
import type { AnimationProvider } from "./providers/AnimationProvider";
import { MockAnimationProvider } from "./providers/MockAnimationProvider";

type GenerateAnimationAssetsInput = {
  projectId: string;
  projectSlug: string;
  scenes: AnimationScene[];
  provider?: AnimationProvider;
};

export type AnimationAssetPipelineResult = {
  projectAssets: ProjectAssets;
  updatedScenes: AnimationScene[];
};

export class AnimationAssetPipeline {
  static async generateAnimationAssets({
    projectId,
    projectSlug,
    scenes,
    provider,
  }: GenerateAnimationAssetsInput): Promise<AnimationAssetPipelineResult> {
    const animationProvider = provider ?? new MockAnimationProvider();
    let projectAssets = AssetManager.getProjectAssets(
      projectSlug,
      projectId,
    );
    const updatedScenes: AnimationScene[] = [];

    for (const scene of scenes) {
      const result = await animationProvider.generateAnimation({
        sceneId: scene.sceneId,
        animationPrompt: scene.animationPrompt,
        sourceImageAssetId: scene.sourceImageAssetId,
      });

      const asset = AssetManager.createAsset({
        projectId,
        projectSlug,
        sceneId: scene.sceneId,
        type: "animation",
        status: result.error ? "failed" : result.status,
        provider: result.provider,
        model: result.model,
        prompt: scene.animationPrompt,
        filePath: result.filePath,
        url: result.url,
        error: result.error,
      });

      projectAssets = AssetManager.addAsset(
        projectSlug,
        projectId,
        asset,
      );

      updatedScenes.push({
        ...scene,
        outputAssetId: asset.id,
        provider: result.provider,
        model: result.model,
        status: toAnimationStatus(result.error ? "failed" : result.status),
      });
    }

    return {
      projectAssets,
      updatedScenes,
    };
  }
}

export async function generateAnimationAssets(
  input: GenerateAnimationAssetsInput,
): Promise<AnimationAssetPipelineResult> {
  return AnimationAssetPipeline.generateAnimationAssets(input);
}

function toAnimationStatus(status: string): AnimationStatus {
  if (
    status === "planned" ||
    status === "generating" ||
    status === "generated" ||
    status === "failed"
  ) {
    return status;
  }

  return "generated";
}
