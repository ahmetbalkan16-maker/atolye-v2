import type { VideoAssemblyProvider } from "./VideoAssemblyProvider";
import { resolveVideoAssemblyProviderName } from "./VideoAssemblyProviderConfig";
import { FFmpegVideoAssemblyProvider } from "./FFmpegVideoAssemblyProvider";
import { MockVideoAssemblyProvider } from "./MockVideoAssemblyProvider";

export class VideoAssemblyProviderRouter {
  static getProvider(name?: string): VideoAssemblyProvider {
    switch (resolveVideoAssemblyProviderName(name)) {
      case "mock":
        return new MockVideoAssemblyProvider();
      case "ffmpeg":
        return new FFmpegVideoAssemblyProvider();
    }
  }
}
