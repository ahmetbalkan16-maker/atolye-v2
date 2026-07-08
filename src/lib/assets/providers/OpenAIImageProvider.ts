import type { ImageGenerationResult } from "@/types/asset";
import type {
  ImageGenerationInput,
  ImageProvider,
} from "./ImageProvider";

export class OpenAIImageProvider implements ImageProvider {
  async generateImage(
    _input: ImageGenerationInput,
  ): Promise<ImageGenerationResult> {
    return {
      provider: "openai",
      model: "pending",
      mimeType: "image/placeholder",
      createdAt: new Date().toISOString(),
      error: "OpenAI image provider not configured",
    };
  }
}
