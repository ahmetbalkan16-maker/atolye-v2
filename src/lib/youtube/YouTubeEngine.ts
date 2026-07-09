import type { YouTubePublishingPackage } from "@/types/youtube";
import {
  createMockYouTubePackage,
  MockYouTubeProvider,
} from "./providers/MockYouTubeProvider";
import type {
  YouTubeGenerationInput,
  YouTubeProvider,
} from "./providers/YouTubeProvider";
import { YouTubeProviderRouter } from "./YouTubeProviderRouter";

export type GenerateYouTubePackageInput = YouTubeGenerationInput & {
  provider?: YouTubeProvider;
};

export class YouTubeEngine {
  private readonly router: YouTubeProviderRouter;

  constructor(router = new YouTubeProviderRouter()) {
    this.router = router;
  }

  async generatePublishingPackage(
    input: GenerateYouTubePackageInput,
  ): Promise<YouTubePublishingPackage> {
    try {
      const provider = input.provider ?? this.router.getProvider();
      const result = await provider.generatePublishingPackage(input);

      if (result.error) {
        return this.createFallback(input);
      }

      return result.package;
    } catch (error) {
      console.error("[YouTubeEngine] Falling back to mock package:", error);
      return this.createFallback(input);
    }
  }

  private async createFallback(
    input: YouTubeGenerationInput,
  ): Promise<YouTubePublishingPackage> {
    const fallbackProvider = new MockYouTubeProvider();

    try {
      const result = await fallbackProvider.generatePublishingPackage(input);

      return result.package;
    } catch {
      return createMockYouTubePackage(input);
    }
  }
}

export async function generatePublishingPackage(
  input: GenerateYouTubePackageInput,
): Promise<YouTubePublishingPackage> {
  return new YouTubeEngine().generatePublishingPackage(input);
}
