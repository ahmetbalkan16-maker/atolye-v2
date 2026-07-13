import { resolveImageProviderName } from "./ImageProviderConfig";
import type { ImageProvider } from "./ImageProvider";
import { MockImageProvider } from "./MockImageProvider";
import { OpenAIImageProvider } from "./OpenAIImageProvider";

export class ImageProviderRouter {
  static getProvider(name?: string): ImageProvider {
    const providerName = resolveImageProviderName(name);

    switch (providerName) {
      case "mock":
        return new MockImageProvider();
      case "openai":
        return new OpenAIImageProvider();
    }
  }
}

export function getDefaultProvider(): ImageProvider {
  return ImageProviderRouter.getProvider();
}

export function getProvider(name?: string): ImageProvider {
  return ImageProviderRouter.getProvider(name);
}
