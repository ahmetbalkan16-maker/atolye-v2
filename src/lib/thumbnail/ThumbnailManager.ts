import { AIRouter } from "@/lib/ai/router/AIRouter";
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

      const parsed = JSON.parse(
        this.extractJson(response),
      ) as Partial<ThumbnailData>;

      return {
        titleIdea: this.getString(parsed.titleIdea, fallback.titleIdea),
        concept: this.getString(parsed.concept, fallback.concept),
        mainSubject: this.getString(parsed.mainSubject, fallback.mainSubject),
        composition: this.getString(parsed.composition, fallback.composition),
        colorStyle: this.getString(parsed.colorStyle, fallback.colorStyle),
        textSuggestion: this.getString(
          parsed.textSuggestion,
          fallback.textSuggestion,
        ),
        imagePrompt: this.getString(parsed.imagePrompt, fallback.imagePrompt),
        clickReason: this.getString(parsed.clickReason, fallback.clickReason),
        generation: this.mapGeneration(parsed.generation, fallback.generation),
        createdAt:
          typeof parsed.createdAt === "string"
            ? parsed.createdAt
            : fallback.createdAt,
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

    if (!generation || typeof generation !== "object") {
      return fallback;
    }

    return {
      provider: this.getOptionalString(generation.provider),
      model: this.getOptionalString(generation.model),
      imageUrl: this.getOptionalString(generation.imageUrl),
      status:
        generation.status === "generated" ||
        generation.status === "failed" ||
        generation.status === "planned"
          ? generation.status
          : fallback?.status ?? "planned",
    };
  }

  private static extractJson(response: string): string {
    const trimmed = response.trim();
    const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);

    if (fencedMatch?.[1]) {
      return fencedMatch[1].trim();
    }

    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");

    if (start !== -1 && end !== -1 && end > start) {
      return trimmed.slice(start, end + 1);
    }

    return trimmed;
  }

  private static createShortText(value: string): string {
    const words = value.trim().split(/\s+/).filter(Boolean).slice(0, 3);

    return words.length > 0 ? words.join(" ").toUpperCase() : "GERCEK NE?";
  }

  private static getString(value: unknown, fallback: string): string {
    return typeof value === "string" && value.trim() ? value : fallback;
  }

  private static getOptionalString(value: unknown): string | undefined {
    return typeof value === "string" ? value : undefined;
  }
}
