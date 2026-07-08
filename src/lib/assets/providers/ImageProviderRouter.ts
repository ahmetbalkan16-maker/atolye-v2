import { imageProviderConfig } from "./ImageProviderConfig";
import type { ImageProvider } from "./ImageProvider";
import { MockImageProvider } from "./MockImageProvider";
import { OpenAIImageProvider } from "./OpenAIImageProvider";

export class ImageProviderRouter {
  static getProvider(name?: string): ImageProvider {
    const providerName = name ?? imageProviderConfig.defaultProvider;

    switch (providerName.toLowerCase()) {
      case "mock":
        return new MockImageProvider();
      case "openai":
        return new OpenAIImageProvider();
      default:
        return new MockImageProvider();
    }
  }
}

export function getDefaultProvider(): ImageProvider {
  return ImageProviderRouter.getProvider(imageProviderConfig.defaultProvider);
}

export function getProvider(name?: string): ImageProvider {
  return ImageProviderRouter.getProvider(name);
}
