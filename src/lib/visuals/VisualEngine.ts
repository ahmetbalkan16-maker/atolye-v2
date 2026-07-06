export type VisualStyle =
  | "cinematic"
  | "realistic"
  | "documentary"
  | "epic"
  | "dark"
  | "ancient";

export interface SceneInput {
  id: string;
  title: string;
  description: string;
  narration?: string;
  location?: string;
  timePeriod?: string;
  mood?: string;
}

export interface VisualPrompt {
  sceneId: string;
  title: string;
  prompt: string;
  negativePrompt: string;
  style: VisualStyle;
}

export class VisualEngine {
  static generatePrompt(
    scene: SceneInput,
    style: VisualStyle = "cinematic"
  ): VisualPrompt {
    const prompt = `
Create a highly detailed ${style} documentary visual.

Scene title: ${scene.title}

Scene description:
${scene.description}

${scene.location ? `Location: ${scene.location}` : ""}
${scene.timePeriod ? `Time period: ${scene.timePeriod}` : ""}
${scene.mood ? `Mood: ${scene.mood}` : ""}

Visual direction:
- cinematic composition
- realistic historical atmosphere
- dramatic lighting
- detailed environment
- natural human poses
- film still quality
- ultra realistic
- high detail
- 16:9 aspect ratio
`.trim();

    const negativePrompt = `
cartoon, anime, modern clothes, modern buildings, blurry, low quality,
bad anatomy, extra fingers, text, watermark, logo, oversaturated
`.trim();

    return {
      sceneId: scene.id,
      title: scene.title,
      prompt,
      negativePrompt,
      style,
    };
  }

  static generatePrompts(
    scenes: SceneInput[],
    style: VisualStyle = "cinematic"
  ): VisualPrompt[] {
    return scenes.map((scene) => this.generatePrompt(scene, style));
  }
}