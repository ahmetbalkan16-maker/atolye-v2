import type { ImageGenerationResult } from "@/types/asset";
import { createProviderDispatchAdapter } from "@/lib/providers/ProviderDispatchAdapterAuthority";
import type {
  ConfiguredImageProvider,
  ImageGenerationInput,
} from "./ImageProvider";

export class MockImageProvider implements ConfiguredImageProvider {
  readonly name = "mock";

  createImmutableImageDispatchAdapter() {
    return createProviderDispatchAdapter(this, {
      metadata: { name: this.name }, requiredMethods: ["generateImage"],
    });
  }

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
