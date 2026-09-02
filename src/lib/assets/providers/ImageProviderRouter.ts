import { resolveImageProviderName } from "./ImageProviderConfig";
import type { ImageProvider } from "./ImageProvider";
import { LocalImageProvider } from "./LocalImageProvider";
import { MockImageProvider } from "./MockImageProvider";
import { OpenAIImageProvider } from "./OpenAIImageProvider";
import { RealPhotoImageProvider } from "./RealPhotoImageProvider";

export class ImageProviderRouter {
  static getProvider(name?: string): ImageProvider {
    const providerName = resolveImageProviderName(name);

    switch (providerName) {
      case "mock":
        return new MockImageProvider();
      case "openai":
        return new OpenAIImageProvider();
      case "real":
        return new RealPhotoImageProvider();
      case "local":
        return new LocalImageProvider();
    }
  }
}

export function getDefaultProvider(): ImageProvider {
  return ImageProviderRouter.getProvider();
}

export function getProvider(name?: string): ImageProvider {
  return ImageProviderRouter.getProvider(name);
}
