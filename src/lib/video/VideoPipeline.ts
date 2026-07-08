import { AssetManager } from "@/lib/assets/AssetManager";
import type { AnimationData } from "@/types/animation";
import type { ProjectAssets } from "@/types/asset";
import type { VideoData, VideoScene, VideoStatus } from "@/types/video";
import { MockVideoProvider } from "./providers/MockVideoProvider";
import type { VideoProvider } from "./providers/VideoProvider";

type GenerateVideoInput = {
  projectId: string;
  projectSlug: string;
  animation: AnimationData;
  provider?: VideoProvider;
};

export type VideoPipelineResult = {
  video: VideoData;
  projectAssets: ProjectAssets;
};

export class VideoPipeline {
  static async generateVideo({
    projectId,
    projectSlug,
    animation,
    provider,
  }: GenerateVideoInput): Promise<VideoPipelineResult> {
    const videoScenes = buildVideoScenes(animation);

    if (videoScenes.length === 0) {
      throw new Error("Aktif animation asset bulunamadi.");
    }

    const videoProvider = provider ?? new MockVideoProvider();
    const result = await videoProvider.generateVideo({
      projectId,
      scenes: videoScenes.map((scene) => ({
        sceneId: scene.sceneId,
        sourceAnimationAssetId: scene.sourceAnimationAssetId,
      })),
    });

    const asset = AssetManager.createAsset({
      projectId,
      projectSlug,
      type: "video",
      status: result.error ? "failed" : result.status,
      provider: result.provider,
      model: result.model,
      prompt: buildVideoAssetPrompt(videoScenes),
      filePath: result.filePath,
      url: result.url,
      mimeType: result.mimeType,
      error: result.error,
    });

    const projectAssets = AssetManager.addAsset(projectSlug, projectId, asset);
    const status = toVideoStatus(result.error ? "failed" : result.status);
    const video: VideoData = {
      projectId,
      outputAssetId: asset.id,
      provider: result.provider,
      model: result.model,
      status,
      scenes: videoScenes.map((scene) => ({
        ...scene,
        outputAssetId: asset.id,
        provider: result.provider,
        model: result.model,
        status,
      })),
      createdAt: new Date().toISOString(),
    };

    return {
      video,
      projectAssets,
    };
  }
}

export async function generateVideo(
  input: GenerateVideoInput,
): Promise<VideoPipelineResult> {
  return VideoPipeline.generateVideo(input);
}

function buildVideoScenes(animation: AnimationData): VideoScene[] {
  return animation.scenes
    .filter((scene) => scene.status === "generated" && scene.outputAssetId)
    .map((scene) => ({
      sceneId: scene.sceneId,
      sourceAnimationAssetId: scene.outputAssetId as string,
      status: "planned",
    }));
}

function buildVideoAssetPrompt(scenes: VideoScene[]): string {
  const sourceList = scenes
    .map((scene) => `scene ${scene.sceneId}: ${scene.sourceAnimationAssetId}`)
    .join(", ");

  return `Mock video assembly from active animation assets: ${sourceList}`;
}

function toVideoStatus(status: string): VideoStatus {
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
