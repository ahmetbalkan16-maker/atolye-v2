import type { ThumbnailData } from "@/types/thumbnail";
import {
  createMockThumbnailData,
  MockThumbnailProvider,
} from "./providers/MockThumbnailProvider";
import type {
  ThumbnailGenerationInput,
  ThumbnailProvider,
} from "./providers/ThumbnailProvider";
import { ThumbnailProviderRouter } from "./ThumbnailProviderRouter";

export type GenerateThumbnailPlanInput = ThumbnailGenerationInput & {
  provider?: ThumbnailProvider;
};

export class ThumbnailEngine {
  private readonly router: ThumbnailProviderRouter;

  constructor(router = new ThumbnailProviderRouter()) {
    this.router = router;
  }

  async generateThumbnailPlan(
    input: GenerateThumbnailPlanInput,
  ): Promise<ThumbnailData> {
    try {
      const provider = input.provider ?? this.router.getProvider();
      const result = await provider.generateThumbnailPlan(input);

      if (result.error) {
        return this.createFallback(input);
      }

      return result.thumbnail;
    } catch (error) {
      console.error("[ThumbnailEngine] Falling back to mock plan:", error);
      return this.createFallback(input);
    }
  }

  private async createFallback(
    input: ThumbnailGenerationInput,
  ): Promise<ThumbnailData> {
    const fallbackProvider = new MockThumbnailProvider();

    try {
      const result = await fallbackProvider.generateThumbnailPlan(input);

      return result.thumbnail;
    } catch {
      return createMockThumbnailData(input);
    }
  }
}

export async function generateThumbnailPlan(
  input: GenerateThumbnailPlanInput,
): Promise<ThumbnailData> {
  return new ThumbnailEngine().generateThumbnailPlan(input);
}
