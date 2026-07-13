import type { AudioProvider } from "./AudioProvider";
import { resolveAudioProviderName } from "./AudioProviderConfig";
import { MockAudioProvider } from "./MockAudioProvider";
import { OpenAIAudioProvider } from "./OpenAIAudioProvider";

export class AudioProviderRouter {
  static getProvider(name?: string): AudioProvider {
    switch (resolveAudioProviderName(name)) {
      case "mock":
        return new MockAudioProvider();
      case "openai":
        return new OpenAIAudioProvider();
    }
  }
}

export function getDefaultProvider(): AudioProvider {
  return AudioProviderRouter.getProvider();
}

export function getProvider(name?: string): AudioProvider {
  return AudioProviderRouter.getProvider(name);
}
