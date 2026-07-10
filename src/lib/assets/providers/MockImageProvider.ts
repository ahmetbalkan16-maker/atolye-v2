import type { ImageGenerationResult } from "@/types/asset";
import type {
  ImageGenerationInput,
  ImageProvider,
} from "./ImageProvider";

export class MockImageProvider implements ImageProvider {
  async generateImage(
    _input: ImageGenerationInput,
  ): Promise<ImageGenerationResult> {
    void _input;

    return {
      id: crypto.randomUUID(),
      provider: "mock",
      model: "mock-image-model",
      url: "",
      filePath: "",
      mimeType: "image/mock",
      createdAt: new Date().toISOString(),
    };
  }
}
