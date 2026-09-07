import {
  MAX_CHAPTER_TITLE_LENGTH,
  MAX_DESCRIPTION_LENGTH,
  MAX_HASHTAG_COUNT,
  MAX_HASHTAG_LENGTH,
  MAX_PINNED_COMMENT_LENGTH,
  MAX_TAG_COUNT,
  MAX_TAG_LENGTH,
  MAX_THUMBNAIL_TEXT_LENGTH,
  MAX_TITLE_LENGTH,
} from "./YouTubePackageValidation";

/**
 * Grammar-constraint contract for the YouTube publishing-package draft.
 *
 * Mirrors `canonicalSeoProviderSchema` / `buildAssemblyResponseJsonSchema`: the
 * `jsonSchema` is handed to Ollama's `format` on the local ($0) path so a small
 * model is held to the exact seven-field draft shape (`additionalProperties:
 * false`, the two list fields, the `{startSeconds,title}` chapter objects, the
 * 3–6 chapter count).
 *
 * It only fixes STRUCTURE. The cross-field rules a JSON Schema cannot express —
 * the first chapter at `0`, strictly increasing `startSeconds`, single-token
 * `#hashtags`, de-duplication, per-field trimming — stay with
 * `normalizeYouTubePackageDraft`, which `OllamaYouTubeProvider` now calls to
 * accept or re-roll a draft before it reaches `YouTubePackagePipeline`
 * (unchanged). `OpenAIYouTubeProvider` keeps its raw-parse path.
 */
export const YOUTUBE_PACKAGE_MIN_CHAPTERS = 3;
export const YOUTUBE_PACKAGE_MAX_CHAPTERS = 6;

export function buildYouTubePackageResponseSchema(
  videoDurationSeconds: number,
): Record<string, unknown> {
  const maxChapterStart = Math.max(
    0,
    Math.floor(
      Number.isFinite(videoDurationSeconds) ? videoDurationSeconds : 0,
    ) - 1,
  );
  const boundedString = (maxLength: number) => ({
    type: "string",
    minLength: 1,
    maxLength: maxLength,
  });
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "title",
      "description",
      "tags",
      "hashtags",
      "chapters",
      "pinnedComment",
      "thumbnailText",
    ],
    properties: {
      title: boundedString(MAX_TITLE_LENGTH),
      description: boundedString(MAX_DESCRIPTION_LENGTH),
      tags: {
        type: "array",
        minItems: 1,
        maxItems: MAX_TAG_COUNT,
        items: boundedString(MAX_TAG_LENGTH),
      },
      hashtags: {
        type: "array",
        minItems: 1,
        maxItems: MAX_HASHTAG_COUNT,
        items: boundedString(MAX_HASHTAG_LENGTH),
      },
      chapters: {
        type: "array",
        minItems: YOUTUBE_PACKAGE_MIN_CHAPTERS,
        maxItems: YOUTUBE_PACKAGE_MAX_CHAPTERS,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["startSeconds", "title"],
          properties: {
            startSeconds: {
              type: "integer",
              minimum: 0,
              maximum: maxChapterStart,
            },
            title: boundedString(MAX_CHAPTER_TITLE_LENGTH),
          },
        },
      },
      pinnedComment: boundedString(MAX_PINNED_COMMENT_LENGTH),
      thumbnailText: boundedString(MAX_THUMBNAIL_TEXT_LENGTH),
    },
  };
}
