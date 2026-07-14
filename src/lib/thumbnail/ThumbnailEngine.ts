import type { ThumbnailData } from "@/types/thumbnail";
import { GenerationFallbackBlockedError, type GenerationExecutionPolicy } from "@/lib/ai/GenerationExecutionPolicy";
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
  generationPolicy?: GenerationExecutionPolicy;
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
        if (input.generationPolicy?.failClosed) throw new GenerationFallbackBlockedError();
        return this.createFallback(input);
      }
      if (
        input.generationPolicy?.failClosed &&
        !isStrictThumbnailPlan(result.thumbnail, provider.name)
      ) throw new GenerationFallbackBlockedError();

      return result.thumbnail;
    } catch (error) {
      if (input.generationPolicy?.failClosed) throw new GenerationFallbackBlockedError();
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

function isStrictThumbnailPlan(value: ThumbnailData, providerName: ThumbnailProvider["name"]) {
  return value.provider === providerName && providerName !== "mock" &&
    Array.isArray(value.variants) && value.variants.length > 0 && value.variants.every((variant) =>
      [variant.id, variant.title, variant.concept, variant.prompt, variant.negativePrompt,
        variant.style, variant.composition, variant.textOverlaySuggestion]
        .every((item) => typeof item === "string" && item.trim()) &&
      typeof variant.priority === "number" && Number.isFinite(variant.priority) &&
      ["planned", "generating", "generated", "failed"].includes(variant.status)) &&
    [value.titleIdea, value.concept, value.mainSubject, value.composition, value.colorStyle,
      value.textSuggestion, value.imagePrompt, value.clickReason]
      .every((item) => typeof item === "string" && item.trim()) &&
    validTimestamp(value.createdAt);
}

function validTimestamp(value: unknown) { if (typeof value !== "string") return false; const parsed = Date.parse(value); return Number.isFinite(parsed) && new Date(parsed).toISOString() === value; }

export async function generateThumbnailPlan(
  input: GenerateThumbnailPlanInput,
): Promise<ThumbnailData> {
  return new ThumbnailEngine().generateThumbnailPlan(input);
}
