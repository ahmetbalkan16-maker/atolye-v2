import { AIRouter } from "@/lib/ai/router/AIRouter";
import type { ScriptData } from "@/types/script";
import type { SEOData } from "@/types/seo";
import type { ThumbnailData } from "@/types/thumbnail";
import { createSEOPrompt } from "./prompts/seoPrompt";

export class SEOManager {
  private static router = new AIRouter();

  static async generateSEOData(
    topic: string,
    script: ScriptData,
    thumbnail: ThumbnailData,
  ): Promise<SEOData> {
    const fallback = this.createFallbackSEOData(topic, script, thumbnail);
    const prompt = createSEOPrompt(topic, script, thumbnail);

    try {
      const provider = this.router.getProvider("openai");
      const response = await provider.generate(prompt);

      if (!response.trim()) {
        console.error("[SEOManager] Empty provider response.");
        return fallback;
      }

      const parsed = JSON.parse(this.extractJson(response)) as Partial<SEOData>;

      return {
        titleSuggestions: this.getStringArray(
          parsed.titleSuggestions,
          fallback.titleSuggestions,
        ),
        description: this.getString(parsed.description, fallback.description),
        tags: this.getStringArray(parsed.tags, fallback.tags),
        hashtags: this.getHashtags(parsed.hashtags, fallback.hashtags),
        keywords: this.getStringArray(parsed.keywords, fallback.keywords),
        targetAudience: this.getString(
          parsed.targetAudience,
          fallback.targetAudience,
        ),
        searchIntent: this.getString(parsed.searchIntent, fallback.searchIntent),
        createdAt:
          typeof parsed.createdAt === "string"
            ? parsed.createdAt
            : fallback.createdAt,
      };
    } catch (error) {
      console.error("[SEOManager] Falling back to local SEO plan:", error);
      return fallback;
    }
  }

  private static createFallbackSEOData(
    topic: string,
    script: ScriptData,
    thumbnail: ThumbnailData,
  ): SEOData {
    const baseTitle = script.title || topic;
    const keywords = this.uniqueStrings([
      topic,
      baseTitle,
      thumbnail.mainSubject,
      ...script.seoKeywords,
    ]);

    return {
      titleSuggestions: [
        baseTitle,
        `${baseTitle}: Bilinmeyen Gercekler`,
        `${thumbnail.textSuggestion} | ${baseTitle}`,
      ],
      description: [
        `${baseTitle} hakkinda hazirlanan bu belgesel, konunun tarihsel arka planini, onemli kirilma noktalarini ve etkilerini anlatiyor.`,
        script.hook,
        script.conclusion,
      ]
        .filter(Boolean)
        .join("\n\n"),
      tags: keywords.slice(0, 15),
      hashtags: this.getHashtags(
        keywords.slice(0, 5).map((keyword) => keyword.replace(/\s+/g, "")),
        ["#belgesel", "#tarih", "#youtube"],
      ),
      keywords,
      targetAudience:
        script.targetAudience || "Tarih ve belgesel iceriklerine ilgi duyan izleyiciler",
      searchIntent:
        "Izleyici konunun neden onemli oldugunu, tarihsel baglamini ve ana olaylarini anlamak istiyor.",
      createdAt: new Date().toISOString(),
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

  private static getString(value: unknown, fallback: string): string {
    return typeof value === "string" && value.trim() ? value : fallback;
  }

  private static getStringArray(
    value: unknown,
    fallback: string[],
  ): string[] {
    return Array.isArray(value)
      ? this.uniqueStrings(
          value.filter((item): item is string => typeof item === "string"),
        )
      : fallback;
  }

  private static getHashtags(value: unknown, fallback: string[]): string[] {
    const items = this.getStringArray(value, fallback);

    return items.map((item) => {
      const normalized = item.trim().replace(/\s+/g, "");

      return normalized.startsWith("#") ? normalized : `#${normalized}`;
    });
  }

  private static uniqueStrings(values: string[]): string[] {
    return Array.from(
      new Set(values.map((value) => value.trim()).filter(Boolean)),
    );
  }
}
