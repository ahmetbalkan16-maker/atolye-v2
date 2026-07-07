import { AIRouter } from "@/lib/ai/router/AIRouter";
import {
  getCreatedAt,
  getOptionalString,
  getString,
  isRecord,
  parseAIJsonResponse,
} from "@/lib/ai/utils";
import type { ScriptData } from "@/types/script";
import type { ThumbnailData, ThumbnailGenerationInfo } from "@/types/thumbnail";
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
      const provider = this.router.getProvider("openai");
      const response = await provider.generate(prompt);

      if (!response.trim()) {
        console.error("[ThumbnailManager] Empty provider response.");
        return fallback;
      }

      const parsed = parseAIJsonResponse<Partial<ThumbnailData>>(response);

      return {
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

    return {
      titleIdea,
      concept:
        visualThumbnail.composition ||
        visualThumbnail.prompt ||
        "Sinematik belgesel thumbnail konsepti",
      mainSubject,
      composition:
        visualThumbnail.composition ||
        "Merkezde guclu ana karakter, arka planda dramatik tarihsel atmosfer",
      colorStyle:
        visualThumbnail.mood ||
        firstVisualScene?.style ||
        "Yuksek kontrastli sinematik renkler",
      textSuggestion: this.createShortText(script.title || script.topic),
      imagePrompt:
        visualThumbnail.prompt ||
        firstVisualScene?.visualPrompt ||
        `Cinematic documentary YouTube thumbnail about ${mainSubject}, strong subject focus, dramatic lighting, high contrast, realistic historical detail, 16:9`,
      clickReason:
        "Net ana konu, guclu duygu ve merak uyandiran kisa metin sayesinde izleyicinin ilgisini ceker.",
      generation: {
        provider: "planned",
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
        generation.status === "planned"
          ? generation.status
          : fallback?.status ?? "planned",
    };
  }

  private static createShortText(value: string): string {
    const words = value.trim().split(/\s+/).filter(Boolean).slice(0, 3);

    return words.length > 0 ? words.join(" ").toUpperCase() : "GERCEK NE?";
  }
}
