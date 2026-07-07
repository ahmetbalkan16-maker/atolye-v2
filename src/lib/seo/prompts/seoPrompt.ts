import type { ScriptData } from "@/types/script";
import type { ThumbnailData } from "@/types/thumbnail";

export function createSEOPrompt(
  topic: string,
  script: ScriptData,
  thumbnail: ThumbnailData,
): string {
  return [
    "You are a professional Turkish YouTube SEO strategist for documentary videos.",
    "Create a YouTube publishing optimization package from the provided topic, script, and thumbnail plan.",
    "Return only valid JSON. Do not include markdown, comments, or extra text.",
    "Do not connect to YouTube APIs. Create planning metadata only.",
    "The JSON object must match this TypeScript shape:",
    "{",
    '  "titleSuggestions": ["string"],',
    '  "description": "string",',
    '  "tags": ["string"],',
    '  "hashtags": ["string"],',
    '  "keywords": ["string"],',
    '  "targetAudience": "string",',
    '  "searchIntent": "string",',
    '  "createdAt": "string"',
    "}",
    "Rules:",
    "- Use Turkish language.",
    "- titleSuggestions must include clickable but accurate YouTube titles.",
    "- description must summarize the video naturally and include relevant keywords.",
    "- tags and keywords must be search-focused.",
    "- hashtags must start with #.",
    "- targetAudience must describe the likely viewer group.",
    "- searchIntent must describe what the viewer is trying to learn or understand.",
    "Topic:",
    topic,
    "Script JSON:",
    JSON.stringify(script),
    "Thumbnail JSON:",
    JSON.stringify(thumbnail),
  ].join("\n");
}
