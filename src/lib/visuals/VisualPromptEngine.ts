import type { SceneData } from "@/types/scene";

export class VisualPromptEngine {
  static createPrompt(
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
      '      "style": "string",',
      '      "searchKeywords": ["string"]',
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
      "- searchKeywords must list concrete named real-world entities for this scene (people, " +
        "places, buildings, artifacts, events) suitable for searching a photo archive — e.g. " +
        '["Hagia Sophia", "Constantinople walls"]. Use an empty array when the scene depicts an ' +
        "imagined, abstract, or staged moment with no real photograph that could represent it " +
        "(e.g. an imagined battle instant) — do not guess or force keywords in that case.",
      "- Thumbnail concept must be dramatic, high contrast, and YouTube-ready.",
      "- Do not include text, logos, watermarks, or modern objects unless the scene requires them.",
      `Preferred style: ${style}`,
      "SceneData JSON:",
      JSON.stringify(scenes),
    ].join("\n");
  }
}
