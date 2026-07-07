import type { SceneData } from "@/types/scene";

export function createVisualPrompt(
  scenes: SceneData,
  style: string = "cinematic",
): string {
  return [
    "You are a professional visual director for historical documentary production.",
    "Create visual generation data from the provided scene data.",
    "Return only valid JSON. Do not include markdown, comments, or extra text.",
    "The JSON object must match this TypeScript shape:",
    "{",
    '  "scenes": [',
    "    {",
    '      "sceneId": 1,',
    '      "visualPrompt": "string",',
    '      "animationPrompt": "string",',
    '      "style": "string"',
    "    }",
    "  ],",
    '  "thumbnail": {',
    '    "title": "string",',
    '    "prompt": "string",',
    '    "composition": "string",',
    '    "mood": "string"',
    "  },",
    '  "createdAt": "string"',
    "}",
    "Rules:",
    "- Use cinematic documentary style.",
    "- Visual prompts must be realistic, historically grounded, detailed, and suitable for image generation.",
    "- Animation prompts must describe camera motion, atmosphere, particles, and documentary movement.",
    "- Thumbnail concept must be dramatic, high contrast, and YouTube-ready.",
    "- Do not include text, logos, watermarks, or modern objects unless the scene requires them.",
    `Preferred style: ${style}`,
    "SceneData JSON:",
    JSON.stringify(scenes),
  ].join("\n");
}
