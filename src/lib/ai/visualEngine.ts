import { VisualData, VisualPrompt } from "@/types/visual";

type SceneItem = {
  id?: string;
  title?: string;
  description?: string;
  visualDescription?: string;
};

type SceneDataInput = {
  scenes: SceneItem[];
};

function createVisualPrompt(scene: SceneItem, index: number): VisualPrompt {
  return {
    id: `visual-${index + 1}`,
    sceneId: scene.id || `scene-${index + 1}`,
    title: scene.title || `Sahne ${index + 1}`,
    aspectRatio: "16:9",
    style: "cinematic",
    camera: "wide cinematic shot",
    lighting: "dramatic historical lighting",
    lens: "35mm lens",
    mood: "epic, emotional, documentary",
    colorPalette: "natural historical colors, cinematic contrast",
    prompt: `
Ultra realistic cinematic documentary scene.

Scene title: ${scene.title || `Scene ${index + 1}`}

Scene description:
${scene.description || scene.visualDescription || ""}

Create a historically grounded, realistic, high-detail visual.
No modern objects.
No text, no subtitles, no logos, no watermark.
Cinematic composition, documentary realism, 8K detail.
    `.trim(),
    negativePrompt:
      "text, subtitles, logo, watermark, modern clothes, modern buildings, cartoon, anime, low quality, blurry, distorted faces",
    createdAt: new Date().toISOString(),
  };
}

export function generateVisualPrompts(
  projectId: string,
  scenes: SceneDataInput
): VisualData {
  const prompts = scenes.scenes.map((scene, index) =>
    createVisualPrompt(scene, index)
  );

  return {
    projectId,
    prompts,
    generatedAt: new Date().toISOString(),
  };
}