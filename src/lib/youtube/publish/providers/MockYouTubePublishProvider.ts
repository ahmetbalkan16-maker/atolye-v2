import { createHash } from "node:crypto";
import type { YouTubePublishProviderResult, YouTubePublishRequest } from "@/types/youtubePublish";
import type { YouTubePublishProvider } from "./YouTubePublishProvider";

export class MockYouTubePublishProvider implements YouTubePublishProvider {
  readonly name = "mock" as const;
  readonly model = "mock-youtube-publish-v1";

  async publish(request: YouTubePublishRequest): Promise<YouTubePublishProviderResult> {
    const remoteVideoId = `mock-${createHash("sha256")
      .update(request.packageIdentity, "utf8")
      .digest("hex")
      .slice(0, 24)}`;
    return {
      success: true,
      provider: this.name,
      model: this.model,
      remoteVideoId,
      remoteVideoUrl: `https://www.youtube.com/watch?v=${remoteVideoId}`,
      channelId: "mock-channel",
      providerRequestId: `mock-request-${remoteVideoId.slice(5)}`,
    };
  }
}
