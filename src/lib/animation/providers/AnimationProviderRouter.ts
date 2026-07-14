import type { AnimationProvider } from "./AnimationProvider";
import { resolveAnimationProviderName } from "./AnimationProviderConfig";
import { MockAnimationProvider } from "./MockAnimationProvider";

export class AnimationProviderRouter {
  static getProvider(name?: string): AnimationProvider {
    switch (resolveAnimationProviderName(name)) {
      case "mock":
        return new MockAnimationProvider();
    }
  }
}
