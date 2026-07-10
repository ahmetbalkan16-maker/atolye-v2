import type {
  VideoGenerationInput,
  VideoGenerationResult,
  VideoProvider,
} from "./VideoProvider";

export class MockVideoProvider implements VideoProvider {
  async generateVideo(
    _input: VideoGenerationInput,
  ): Promise<VideoGenerationResult> {
    void _input;

    return {
      provider: "mock",
      model: "mock-video-model",
      url: "",
      filePath: "",
      mimeType: "video/mp4",
      status: "generated",
    };
  }
}
