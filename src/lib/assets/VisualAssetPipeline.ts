import { AssetManager } from "@/lib/assets/AssetManager";
import type { ProjectAssets } from "@/types/asset";
import type { VisualData } from "@/types/visual";
import type { ImageProvider } from "./providers/ImageProvider";

type GenerateAssetsInput = {
  projectId: string;
  projectSlug: string;
  visualData: VisualData;
  provider: ImageProvider;
};

export class VisualAssetPipeline {
  static async generateAssets({
    projectId,
    projectSlug,
    visualData,
    provider,
  }: GenerateAssetsInput): Promise<ProjectAssets> {
    let projectAssets = AssetManager.getProjectAssets(
      projectSlug,
      projectId,
    );

    for (const scene of visualData.scenes) {
      const result = await provider.generateImage({
        prompt: scene.visualPrompt,
        style: scene.style,
        sceneId: scene.sceneId,
      });

      const asset = AssetManager.createAsset({
        projectId,
        projectSlug,
        sceneId: scene.sceneId,
        type: "image",
        status: result.error ? "failed" : "generated",
        provider: result.provider,
        model: result.model,
        prompt: scene.visualPrompt,
        filePath: result.filePath,
        url: result.url,
        mimeType: result.mimeType,
        error: result.error,
        createdAt: result.createdAt,
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
