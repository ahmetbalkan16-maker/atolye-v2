import type { VideoProvider } from "./VideoProvider";
import { FFmpegSceneVideoProvider } from "./FFmpegSceneVideoProvider";
import { MockVideoProvider } from "./MockVideoProvider";
import { resolveVideoProviderName } from "./VideoProviderConfig";

export class VideoProviderRouter {
  static getProvider(name?: string): VideoProvider {
    switch (resolveVideoProviderName(name)) {
      case "mock":
        return new MockVideoProvider();
      case "ffmpeg":
        return new FFmpegSceneVideoProvider();
    }
  }
}
