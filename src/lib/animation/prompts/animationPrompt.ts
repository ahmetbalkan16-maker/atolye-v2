import type { SceneData } from "@/types/scene";
import type { VisualScene } from "@/types/visual";

export interface BuildAnimationPromptInput {
  scene: SceneData;
  visual: VisualScene;
  style?: string;
}

export function buildAnimationPrompt({
  scene,
  visual,
  style,
}: BuildAnimationPromptInput): string {
  const sceneItem = scene.scenes.find((item) => item.id === visual.sceneId);
  const preferredStyle = style || visual.style || "cinematic";

  return [
    "You are a professional animation director for historical documentary production.",
    "Create a production-ready animation prompt for the provided scene and visual direction.",
    "Return only valid JSON. Do not include markdown, comments, or extra text.",
    "The JSON object must match this TypeScript shape:",
    "{",
    '  "sceneId": 1,',
    '  "animationPrompt": "string"',
    "}",
    "Rules:",
    "- Use the historical context and scene description as the narrative anchor.",
    "- Use the visual prompt as the source image direction.",
    "- Describe cinematic camera movement, subject movement, atmosphere, particles, depth, and pacing.",
    "- Keep motion realistic, documentary, historically grounded, and suitable for image-to-video generation.",
    "- Do not add text, logos, subtitles, or modern objects unless the scene requires them.",
    `Preferred style: ${preferredStyle}`,
    "Scene context JSON:",
    JSON.stringify({
      sceneId: visual.sceneId,
      title: sceneItem?.title || `Scene ${visual.sceneId}`,
      description: sceneItem?.description || "",
      historicalContext: sceneItem?.visualPrompt || sceneItem?.description || "",
      duration: sceneItem?.duration,
    }),
    "Visual direction JSON:",
    JSON.stringify({
      sceneId: visual.sceneId,
      visualPrompt: visual.visualPrompt,
      existingAnimationPrompt: visual.animationPrompt,
      style: visual.style,
    }),
  ].join("\n");
}
