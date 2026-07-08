import { AssetManager } from "@/lib/assets/AssetManager";
import type { ProjectAssets } from "@/types/asset";
import type { AnimationScene } from "@/types/animation";
import type { AnimationProvider } from "./providers/AnimationProvider";
import { MockAnimationProvider } from "./providers/MockAnimationProvider";

type GenerateAnimationAssetsInput = {
  projectId: string;
  projectSlug: string;
  scenes: AnimationScene[];
  provider?: AnimationProvider;
};

export class AnimationAssetPipeline {
  static async generateAnimationAssets({
    projectId,
    projectSlug,
    scenes,
    provider,
  }: GenerateAnimationAssetsInput): Promise<ProjectAssets> {
    const animationProvider = provider ?? new MockAnimationProvider();
    let projectAssets = AssetManager.getProjectAssets(
      projectSlug,
      projectId,
    );

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
    }

    return projectAssets;
  }
}

export async function generateAnimationAssets(
  input: GenerateAnimationAssetsInput,
): Promise<ProjectAssets> {
  return AnimationAssetPipeline.generateAnimationAssets(input);
}
