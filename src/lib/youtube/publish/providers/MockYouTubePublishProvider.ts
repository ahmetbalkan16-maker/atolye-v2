import { createHash } from "node:crypto";
import type {
  YouTubePublishProviderResult,
  YouTubePublishReconciliationRequest,
  YouTubePublishReconciliationResult,
  YouTubePublishRequest,
} from "@/types/youtubePublish";
import { createYouTubeReconciliationMarker } from "../YouTubePublishValidation";
import type { YouTubePublishProvider } from "./YouTubePublishProvider";
import {
  YOUTUBE_PUBLISH_ERROR,
  YOUTUBE_RECONCILIATION_ERROR,
} from "./YouTubePublishProvider";

type MatchedResult = Extract<YouTubePublishReconciliationResult, { outcome: "matched" }>;
type NonMatchedOutcome = Exclude<YouTubePublishReconciliationResult["outcome"], "matched">;

export class MockYouTubePublishProvider implements YouTubePublishProvider {
  readonly name = "mock" as const;
  readonly model = "mock-youtube-publish-v1";
  readonly reconciliationChannelId = "mock-channel";
  uploadCallCount = 0;
  reconciliationCallCount = 0;
  private readonly remoteRecords: MatchedResult[] = [];
  private reconciliationOutcome?: NonMatchedOutcome;

  constructor(options: { reconciliationOutcome?: NonMatchedOutcome } = {}) {
    this.reconciliationOutcome = options.reconciliationOutcome;
  }

  async publish(request: YouTubePublishRequest): Promise<YouTubePublishProviderResult> {
    this.uploadCallCount++;
    if (request.signal?.aborted) {
      return {
        success: false,
        provider: this.name,
        model: this.model,
        outcome: "failed",
        error: YOUTUBE_PUBLISH_ERROR,
      };
    }
    const remoteVideoId = `mock-${createHash("sha256")
      .update(request.packageIdentity, "utf8")
      .digest("hex")
      .slice(0, 24)}`;
    const result = {
      success: true,
      provider: this.name,
      model: this.model,
      remoteVideoId,
      remoteVideoUrl: `https://www.youtube.com/watch?v=${remoteVideoId}`,
      channelId: request.channelBinding ?? this.reconciliationChannelId,
      providerRequestId: `mock-request-${remoteVideoId.slice(5)}`,
    } as const;
    if (request.reconciliationMarker) {
      this.remoteRecords.push({
        outcome: "matched",
        provider: this.name,
        model: this.model,
        reconciliationMarker: request.reconciliationMarker,
        remoteVideoId: result.remoteVideoId,
        remoteVideoUrl: result.remoteVideoUrl,
        channelId: result.channelId,
        providerRequestId: result.providerRequestId,
      });
    }
    return result;
  }

  async reconcilePublish(
    request: YouTubePublishReconciliationRequest,
  ): Promise<YouTubePublishReconciliationResult> {
    this.reconciliationCallCount++;
    if (request.signal?.aborted) return reconciliationFailure("failure");
    if (
      request.provider !== this.name || request.model !== this.model ||
      request.channelBinding !== this.reconciliationChannelId
    ) return reconciliationFailure("failure");
    try {
      if (request.reconciliationMarker !== createYouTubeReconciliationMarker(request)) {
        return reconciliationFailure("failure");
      }
    } catch {
      return reconciliationFailure("failure");
    }
    if (this.reconciliationOutcome) {
      return reconciliationFailure(this.reconciliationOutcome);
    }
    const matches = this.remoteRecords.filter(
      (record) => record.reconciliationMarker === request.reconciliationMarker,
    );
    if (matches.length === 0) return reconciliationFailure("not_found");
    if (matches.length !== 1) return reconciliationFailure("ambiguous");
    return { ...matches[0] };
  }

  seedRemotePublish(result: MatchedResult) {
    this.remoteRecords.push({ ...result });
  }

  setReconciliationOutcome(outcome?: NonMatchedOutcome) {
    this.reconciliationOutcome = outcome;
  }
}

function reconciliationFailure(
  outcome: NonMatchedOutcome,
): YouTubePublishReconciliationResult {
  return {
    outcome,
    provider: "mock",
    model: "mock-youtube-publish-v1",
    error: YOUTUBE_RECONCILIATION_ERROR,
  };
}
