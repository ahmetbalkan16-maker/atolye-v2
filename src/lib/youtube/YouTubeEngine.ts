import type {
  YouTubeGenerationInput,
  YouTubeGenerationResult,
  YouTubeProvider,
} from "./providers/YouTubeProvider";
import { YouTubeProviderRouter } from "./YouTubeProviderRouter";

export type GenerateYouTubePackageInput = YouTubeGenerationInput & {
  provider?: YouTubeProvider;
};

export class YouTubeEngine {
  constructor(private readonly router = new YouTubeProviderRouter()) {}

  async generatePublishingPackage(
    input: GenerateYouTubePackageInput,
  ): Promise<YouTubeGenerationResult> {
    const provider = input.provider ?? this.router.getProvider();
    return provider.generatePublishingPackage(input);
  }
}
