import type { YouTubeGenerationInput } from "../providers/YouTubeProvider";

export function createYouTubePackagePrompt(input: YouTubeGenerationInput) {
  return [
    "Return only a JSON object with exactly these fields: title, description, tags, hashtags, chapters, pinnedComment, thumbnailText.",
    "chapters must be an array of {startSeconds,title}; first startSeconds is 0 and values are strictly increasing.",
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
