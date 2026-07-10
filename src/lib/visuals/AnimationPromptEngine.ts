import type { SceneItem } from "@/types/scene";

const fallbackPrompt =
  "Slow cinematic camera movement, realistic motion, atmospheric particles, documentary style";

const normalizedFallbackPrompt =
  "Slow cinematic camera movement, documentary style";

export class AnimationPromptEngine {
  static createFallbackPrompt(
    _scene?: SceneItem,
    _style?: string,
  ): string {
    void _scene;
    void _style;

    return fallbackPrompt;
  }

  static normalizePrompt(
    value?: string,
    _scene?: SceneItem,
    _style?: string,
  ): string {
    void _scene;
    void _style;

    return value?.trim() ? value : normalizedFallbackPrompt;
  }
}
