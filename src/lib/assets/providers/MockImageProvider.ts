import type { ImageGenerationResult } from "@/types/asset";
import type {
  ImageGenerationInput,
  ImageProvider,
} from "./ImageProvider";

export class MockImageProvider implements ImageProvider {
  readonly name = "mock";

  async generateImage(
    _input: ImageGenerationInput,
  ): Promise<ImageGenerationResult> {
    void _input;

    return {
      success: true,
      id: crypto.randomUUID(),
      sceneId: _input.sceneId,
      provider: "mock",
      model: "mock-image-model",
      url: "",
      filePath: "",
      mimeType: "image/mock",
      createdAt: new Date().toISOString(),
    };
  }
}
