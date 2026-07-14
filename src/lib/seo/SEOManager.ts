import { runObservedAIRequest } from "@/lib/ai/runObservedAIRequest";
import { failClosedOrReturn, type GenerationExecutionPolicy } from "@/lib/ai/GenerationExecutionPolicy";
import type { AIProvider } from "@/lib/ai/providers";
import {
  getCreatedAt,
  getString,
  getStringArray,
  parseAIJsonResponse,
} from "@/lib/ai/utils";
import type { AIRequestContext } from "@/types/aiUsage";
import type { ScriptData } from "@/types/script";
import type { SEOData } from "@/types/seo";
import type { ThumbnailData } from "@/types/thumbnail";
import { createSEOPrompt } from "./prompts/seoPrompt";

export class SEOManager {
  static async generateSEOData(
    topic: string,
    script: ScriptData,
    thumbnail: ThumbnailData,
    context?: Partial<AIRequestContext>,
    options: { aiProvider?: AIProvider; generationPolicy?: GenerationExecutionPolicy } = {},
  ): Promise<SEOData> {
    const fallback = this.createFallbackSEOData(topic, script, thumbnail);
    const prompt = createSEOPrompt(topic, script, thumbnail);

    try {
      const { response } = await runObservedAIRequest({
        prompt,
        provider: options.aiProvider,
        context: {
          ...context,
          operation: context?.operation ?? "seo-plan",
          stage: context?.stage ?? "seo",
        },
      });

      if (!response.trim()) {
        console.error("[SEOManager] Empty provider response.");
        return failClosedOrReturn(fallback, options.generationPolicy);
      }

      const parsed = parseAIJsonResponse<Partial<SEOData>>(response);
      if (
        options.generationPolicy?.failClosed &&
        !isStrictSEOResponse(parsed)
      ) throw new Error("invalid");

      return {
        titleSuggestions: this.getStringArray(
          parsed.titleSuggestions,
          fallback.titleSuggestions,
        ),
        description: getString(parsed.description, fallback.description),
        tags: this.getStringArray(parsed.tags, fallback.tags),
        hashtags: this.getHashtags(parsed.hashtags, fallback.hashtags),
        keywords: this.getStringArray(parsed.keywords, fallback.keywords),
        targetAudience: getString(
          parsed.targetAudience,
          fallback.targetAudience,
        ),
        searchIntent: getString(parsed.searchIntent, fallback.searchIntent),
        createdAt: getCreatedAt(parsed.createdAt, fallback.createdAt),
      };
    } catch (error) {
      if (options.generationPolicy?.failClosed) return failClosedOrReturn(fallback, options.generationPolicy);
      console.error("[SEOManager] Falling back to local SEO plan:", error);
      return failClosedOrReturn(fallback, options.generationPolicy);
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

  private static getStringArray(
    value: unknown,
    fallback: string[],
  ): string[] {
    return Array.isArray(value)
      ? this.uniqueStrings(getStringArray(value))
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

function isStrictSEOResponse(value: Partial<SEOData>) {
  return [value.titleSuggestions, value.tags, value.hashtags, value.keywords]
    .every((items) => Array.isArray(items) && items.length > 0 && items.every((item) => typeof item === "string" && item.trim())) &&
    [value.description, value.targetAudience, value.searchIntent]
      .every((item) => typeof item === "string" && item.trim()) &&
    validTimestamp(value.createdAt);
}

function validTimestamp(value: unknown) { if (typeof value !== "string") return false; const parsed = Date.parse(value); return Number.isFinite(parsed) && new Date(parsed).toISOString() === value; }
