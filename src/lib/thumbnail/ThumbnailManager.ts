import { AIRouter } from "@/lib/ai/router/AIRouter";
import {
  getCreatedAt,
  getOptionalString,
  getString,
  isRecord,
  parseAIJsonResponse,
} from "@/lib/ai/utils";
import type { ScriptData } from "@/types/script";
import type {
  ThumbnailData,
  ThumbnailGenerationInfo,
  ThumbnailVariant,
} from "@/types/thumbnail";
import type { VisualData } from "@/types/visual";
import { createThumbnailPrompt } from "./prompts/thumbnailPrompt";

export class ThumbnailManager {
  private static router = new AIRouter();

  static async generateThumbnailData(
    script: ScriptData,
    visuals: VisualData,
  ): Promise<ThumbnailData> {
    const fallback = this.createFallbackThumbnailData(script, visuals);
    const prompt = createThumbnailPrompt(script, visuals);

    try {
      const provider = this.router.getProvider();
      const response = await provider.generate(prompt);

      if (!response.trim()) {
        console.error("[ThumbnailManager] Empty provider response.");
        return fallback;
      }

      const parsed = parseAIJsonResponse<Partial<ThumbnailData>>(response);

      return {
        projectId: fallback.projectId,
        slug: fallback.slug,
        provider: getOptionalString(parsed.provider) ?? fallback.provider,
        model: getOptionalString(parsed.model) ?? fallback.model,
        status:
          parsed.status === "generated" ||
          parsed.status === "failed" ||
          parsed.status === "generating" ||
          parsed.status === "planned"
            ? parsed.status
            : fallback.status,
        sourceAssemblyAssetId: fallback.sourceAssemblyAssetId,
        sourceVideoAssetId: fallback.sourceVideoAssetId,
        sourceAudioAssetId: fallback.sourceAudioAssetId,
        variants: this.mapVariants(parsed.variants, fallback.variants),
        titleIdea: getString(parsed.titleIdea, fallback.titleIdea),
        concept: getString(parsed.concept, fallback.concept),
        mainSubject: getString(parsed.mainSubject, fallback.mainSubject),
        composition: getString(parsed.composition, fallback.composition),
        colorStyle: getString(parsed.colorStyle, fallback.colorStyle),
        textSuggestion: getString(
          parsed.textSuggestion,
          fallback.textSuggestion,
        ),
        imagePrompt: getString(parsed.imagePrompt, fallback.imagePrompt),
        clickReason: getString(parsed.clickReason, fallback.clickReason),
        generation: this.mapGeneration(parsed.generation, fallback.generation),
        createdAt: getCreatedAt(parsed.createdAt, fallback.createdAt),
        updatedAt: new Date().toISOString(),
      };
    } catch (error) {
      console.error(
        "[ThumbnailManager] Falling back to local thumbnail plan:",
        error,
      );
      return fallback;
    }
  }

  private static createFallbackThumbnailData(
    script: ScriptData,
    visuals: VisualData,
  ): ThumbnailData {
    const visualThumbnail = visuals.thumbnail;
    const firstVisualScene = visuals.scenes[0];
    const titleIdea =
      script.thumbnailIdea || visualThumbnail.title || `${script.title} gercegi`;
    const mainSubject =
      script.topic || script.title || visualThumbnail.title || "Ana konu";

    const variant: ThumbnailVariant = {
      id: "legacy-manager-primary",
      title: titleIdea,
      concept:
        visualThumbnail.composition ||
        visualThumbnail.prompt ||
        "Sinematik belgesel thumbnail konsepti",
      prompt:
        visualThumbnail.prompt ||
        firstVisualScene?.visualPrompt ||
        `Cinematic documentary YouTube thumbnail about ${mainSubject}, strong subject focus, dramatic lighting, high contrast, realistic historical detail, 16:9`,
      negativePrompt:
        "low quality, blurry, distorted anatomy, unreadable text, cluttered composition, misleading imagery",
      style: "documentary",
      composition:
        visualThumbnail.composition ||
        "Merkezde guclu ana karakter, arka planda dramatik tarihsel atmosfer",
      textOverlaySuggestion: this.createShortText(script.title || script.topic),
      priority: 1,
      status: "planned",
    };

    return {
      provider: "mock",
      model: "legacy-thumbnail-manager",
      status: "planned",
      variants: [variant],
      titleIdea,
      concept: variant.concept,
      mainSubject,
      composition: variant.composition,
      colorStyle:
        visualThumbnail.mood ||
        firstVisualScene?.style ||
        "Yuksek kontrastli sinematik renkler",
      textSuggestion: variant.textOverlaySuggestion,
      imagePrompt: variant.prompt,
      clickReason:
        "Net ana konu, guclu duygu ve merak uyandiran kisa metin sayesinde izleyicinin ilgisini ceker.",
      generation: {
        provider: "mock",
        model: "legacy-thumbnail-manager",
        status: "planned",
      },
      createdAt: new Date().toISOString(),
    };
  }

  private static mapGeneration(
    value: unknown,
    fallback: ThumbnailGenerationInfo | undefined,
  ): ThumbnailGenerationInfo | undefined {
    const generation = value as Partial<ThumbnailGenerationInfo>;

    if (!isRecord(generation)) {
      return fallback;
    }

    return {
      provider: getOptionalString(generation.provider),
      model: getOptionalString(generation.model),
      imageUrl: getOptionalString(generation.imageUrl),
      status:
        generation.status === "generated" ||
        generation.status === "failed" ||
        generation.status === "planned" ||
        generation.status === "generating"
          ? generation.status
          : fallback?.status ?? "planned",
    };
  }

  private static mapVariants(
    value: unknown,
    fallback: ThumbnailVariant[],
  ): ThumbnailVariant[] {
    if (!Array.isArray(value)) {
      return fallback;
    }

    const variants = value
      .map((item, index) => {
        const variant = item as Partial<ThumbnailVariant>;
        const fallbackVariant = fallback[index] ?? fallback[0];

        if (!fallbackVariant) {
          return null;
        }

        return {
          id: getString(variant.id, fallbackVariant.id),
          title: getString(variant.title, fallbackVariant.title),
          concept: getString(variant.concept, fallbackVariant.concept),
          prompt: getString(variant.prompt, fallbackVariant.prompt),
          negativePrompt: getString(
            variant.negativePrompt,
            fallbackVariant.negativePrompt,
          ),
          style: getString(variant.style, fallbackVariant.style),
          composition: getString(
            variant.composition,
            fallbackVariant.composition,
          ),
          textOverlaySuggestion: getString(
            variant.textOverlaySuggestion,
            fallbackVariant.textOverlaySuggestion,
          ),
          priority:
            typeof variant.priority === "number"
              ? variant.priority
              : fallbackVariant.priority,
          status:
            variant.status === "generated" ||
            variant.status === "failed" ||
            variant.status === "generating" ||
            variant.status === "planned"
              ? variant.status
              : fallbackVariant.status,
        };
      })
      .filter((variant): variant is ThumbnailVariant => variant !== null);

    return variants.length > 0 ? variants : fallback;
  }

  private static createShortText(value: string): string {
    const words = value.trim().split(/\s+/).filter(Boolean).slice(0, 3);

    return words.length > 0 ? words.join(" ").toUpperCase() : "GERCEK NE?";
  }
}
