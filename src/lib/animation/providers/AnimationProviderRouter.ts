import type { AnimationProvider } from "./AnimationProvider";
import { resolveAnimationProviderName } from "./AnimationProviderConfig";
import { MockAnimationProvider } from "./MockAnimationProvider";
import { OpenAIAnimationProvider } from "./OpenAIAnimationProvider";

export class AnimationProviderRouter {
  static getProvider(name?: string): AnimationProvider {
    switch (resolveAnimationProviderName(name)) {
      case "mock":
        return new MockAnimationProvider();
      case "openai":
        return new OpenAIAnimationProvider();
    }
  }
}
