import type {
  VideoGenerationInput,
  VideoGenerationResult,
  VideoProvider,
} from "./VideoProvider";

export class MockVideoProvider implements VideoProvider {
  readonly name = "mock";

  async generateVideo(
    input: VideoGenerationInput,
  ): Promise<VideoGenerationResult> {
    return {
      success: true,
      provider: "mock",
      generationMode: "mock",
      scenes: input.scenes.map((scene) => ({
        sceneId: scene.sceneId,
        sourceImageAssetId: scene.sourceImageAssetId,
        animationAssetId: scene.animationAssetId,
        provider: "mock",
        model: "mock-video-model",
        generationMode: "mock",
        url: "",
        filePath: "",
        mimeType: "video/mock",
        byteLength: 0,
        durationSeconds: scene.motionPlan.durationSeconds,
        width: 0,
        height: 0,
        frameRate: 30,
        transition: scene.motionPlan.transition,
        status: "generated",
        createdAt: "2000-01-01T00:00:00.000Z",
      })),
    };
  }
}
