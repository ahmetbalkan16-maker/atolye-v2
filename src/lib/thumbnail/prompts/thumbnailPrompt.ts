import type { ScriptData } from "@/types/script";
import type { VisualData } from "@/types/visual";

export function createThumbnailPrompt(
  script: ScriptData,
  visuals: VisualData,
): string {
  return [
    "You are a professional YouTube thumbnail strategist for Turkish documentary videos.",
    "Create a high-click thumbnail production plan from the provided script and visual plan.",
    "Return only valid JSON. Do not include markdown, comments, or extra text.",
    "Do not generate a real image. Create planning metadata only.",
    "The JSON object must match this TypeScript shape:",
    "{",
    '  "titleIdea": "string",',
    '  "concept": "string",',
    '  "mainSubject": "string",',
    '  "composition": "string",',
    '  "colorStyle": "string",',
    '  "textSuggestion": "string",',
    '  "imagePrompt": "string",',
    '  "clickReason": "string",',
    '  "generation": {',
    '    "provider": "string",',
    '    "model": "string",',
    '    "imageUrl": "string",',
    '    "status": "planned"',
    "  },",
    '  "createdAt": "string"',
    "}",
    "Rules:",
    "- Use Turkish thumbnail strategy language.",
    "- Focus on one clear main subject.",
    "- textSuggestion must be short, punchy, and suitable for a YouTube thumbnail.",
    "- imagePrompt must be a detailed AI image generation prompt in cinematic documentary style.",
    "- clickReason must explain why the thumbnail attracts clicks without misleading the viewer.",
    "- generation.status must be planned.",
    "Script JSON:",
    JSON.stringify(script),
    "Visual JSON:",
    JSON.stringify(visuals),
  ].join("\n");
}
