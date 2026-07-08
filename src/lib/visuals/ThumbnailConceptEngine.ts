import { getStringAllowEmpty, isRecord } from "@/lib/ai/utils";
import type { ThumbnailConcept } from "@/types/visual";

export class ThumbnailConceptEngine {
  static createFallbackConcept(_style?: string): ThumbnailConcept {
    return {
      title: "Historical Documentary Thumbnail",
      prompt:
        "Epic historical YouTube thumbnail, strong character focus, high contrast, cinematic documentary style",
      composition: "Centered hero subject with dramatic background and strong depth.",
      mood: "epic, dramatic, historical",
    };
  }

  static normalizeConcept(
    value: unknown,
    fallback: ThumbnailConcept = this.createFallbackConcept(),
  ): ThumbnailConcept {
    const thumbnail = value as Partial<ThumbnailConcept>;

    if (!isRecord(thumbnail)) {
      return fallback;
    }

    return {
      title: getStringAllowEmpty(thumbnail.title, fallback.title),
      prompt: getStringAllowEmpty(thumbnail.prompt, fallback.prompt),
      composition: getStringAllowEmpty(
        thumbnail.composition,
        fallback.composition,
      ),
      mood: getStringAllowEmpty(thumbnail.mood, fallback.mood),
    };
  }
}
