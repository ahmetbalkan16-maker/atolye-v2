import type { YouTubeGenerationInput } from "../providers/YouTubeProvider";

export function createYouTubePackagePrompt(input: YouTubeGenerationInput) {
  const maxChapterStart = Math.max(0, Math.floor(input.videoDurationSeconds) - 1);
  return [
    "Return only a JSON object with exactly these fields: title, description, tags, hashtags, chapters, pinnedComment, thumbnailText.",
    "title (Turkish, at most 100 characters): a curiosity-driven documentary headline, not a bare topic label. " +
      "Prefer including the key year or number and a hook (a question or a stakes phrase). " +
      "Front-load the most searchable term. Avoid clickbait punctuation spam and ALL CAPS.",
    "thumbnailText (Turkish): 1 to 3 short words that read instantly at small size; never a truncated phrase. " +
      "Keep it a complete idea (e.g. a name or a single loaded word), not the first half of a sentence.",
    "chapters must be an array of {startSeconds,title} with 3 to 6 entries.",
    `startSeconds must be whole integers (seconds), strictly increasing; the first entry's startSeconds is exactly 0, and every startSeconds must be between 0 and ${maxChapterStart} inclusive. durationSeconds below is the authoritative final video length - never place a chapter at or after it, and ignore any scene duration that would push past it.`,
    "Do not include schema, provider, model, project identity, asset identity, status, timestamps, Markdown or code fences.",
    JSON.stringify({
      title: input.title,
      durationSeconds: input.videoDurationSeconds,
      assembly: input.assembly.scenes.slice(0, 100).map((scene) => ({
        sceneId: scene.sceneId,
        duration: scene.duration,
        notes: scene.notes,
      })),
      thumbnailText: input.thumbnail.textSuggestion,
      seo: {
        titleSuggestions: input.seo.titleSuggestions.slice(0, 10),
        description: input.seo.description,
        tags: input.seo.tags.slice(0, 50),
        hashtags: input.seo.hashtags.slice(0, 15),
      },
    }),
  ].join("\n");
}
