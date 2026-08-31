import type { AudioProvider } from "./AudioProvider";
import { resolveAudioProviderName } from "./AudioProviderConfig";
import { MockAudioProvider } from "./MockAudioProvider";
import { OpenAIAudioProvider } from "./OpenAIAudioProvider";
import { PiperAudioProvider } from "./PiperAudioProvider";

export class AudioProviderRouter {
  static getProvider(name?: string): AudioProvider {
    switch (resolveAudioProviderName(name)) {
      case "mock":
        return new MockAudioProvider();
      case "openai":
        return new OpenAIAudioProvider();
      case "piper":
        return new PiperAudioProvider();
    }
  }
}

export function getDefaultProvider(): AudioProvider {
  return AudioProviderRouter.getProvider();
}

export function getProvider(name?: string): AudioProvider {
  return AudioProviderRouter.getProvider(name);
}
