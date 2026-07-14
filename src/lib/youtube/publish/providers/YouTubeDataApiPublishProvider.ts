import fs from "node:fs";
import type {
  YouTubePublishProviderResult,
  YouTubePublishReconciliationRequest,
  YouTubePublishReconciliationResult,
  YouTubePublishRequest,
} from "@/types/youtubePublish";
import { createYouTubeReconciliationMarker } from "../YouTubePublishValidation";
import { youtubePublishProviderConfig } from "../YouTubePublishProviderConfig";
import type { YouTubePublishProvider } from "./YouTubePublishProvider";
import {
  YOUTUBE_PUBLISH_ERROR,
  YOUTUBE_RECONCILIATION_ERROR,
} from "./YouTubePublishProvider";

type Fetcher = (input: string, init?: RequestInit & { duplex?: "half" }) => Promise<Response>;

export class YouTubeDataApiPublishProvider implements YouTubePublishProvider {
  readonly name = "youtube-data-api" as const;
  readonly model = youtubePublishProviderConfig.youtubeDataApi.model;
  private readonly fetcher: Fetcher;
  private readonly timeoutMs: number;
  private readonly maximumResponseBytes: number;
  private readonly channelBindingValid: boolean;
  readonly reconciliationChannelId?: string;

  constructor(options: {
    fetcher?: Fetcher;
    timeoutMs?: number;
    maximumResponseBytes?: number;
    channelId?: string;
  } = {}) {
    this.fetcher = options.fetcher ?? (fetch as Fetcher);
    this.timeoutMs = options.timeoutMs ?? youtubePublishProviderConfig.youtubeDataApi.timeoutMs;
    this.maximumResponseBytes = options.maximumResponseBytes ??
      youtubePublishProviderConfig.youtubeDataApi.maximumResponseBytes;
    const channelId = options.channelId ?? process.env.YOUTUBE_CHANNEL_ID?.trim();
    const validatedChannelId = safeRemoteId(channelId);
    this.channelBindingValid = channelId === undefined || validatedChannelId !== null;
    this.reconciliationChannelId = validatedChannelId ?? undefined;
  }

  async publish(request: YouTubePublishRequest): Promise<YouTubePublishProviderResult> {
    const token = process.env.YOUTUBE_ACCESS_TOKEN?.trim();
    if (
      process.env.YOUTUBE_PUBLISH_PROVIDER?.trim().toLowerCase() !== this.name ||
      !token || !this.channelBindingValid
    ) return failure("failed");

    const controller = new AbortController();
    const abortFromCaller = () => controller.abort();
    if (request.signal?.aborted) return failure("failed");
    request.signal?.addEventListener("abort", abortFromCaller, { once: true });
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let uploadAccepted = false;
    let videoStream: fs.ReadStream | null = null;
    try {
      const videoStat = fs.statSync(request.videoAbsolutePath);
      const thumbnailStat = fs.statSync(request.thumbnailAbsolutePath);
      if (
        !videoStat.isFile() || videoStat.size <= 0 ||
        !thumbnailStat.isFile() || thumbnailStat.size <= 0 ||
        thumbnailStat.size > youtubePublishProviderConfig.youtubeDataApi.maximumThumbnailBytes
      ) return failure("failed");

      const start = await this.fetcher(
        "https://www.googleapis.com/upload/youtube/v3/videos?part=snippet,status&uploadType=resumable",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json; charset=utf-8",
            "X-Upload-Content-Length": String(videoStat.size),
            "X-Upload-Content-Type": "video/mp4",
          },
          signal: controller.signal,
          body: JSON.stringify({
            snippet: {
              title: request.metadata.title,
              description: descriptionWithMarker(
                request.metadata.description,
                request.reconciliationMarker,
              ),
              tags: request.metadata.tags,
            },
            status: { privacyStatus: request.metadata.privacyStatus },
          }),
        },
      );
      if (!start.ok) return failure("failed");
      const uploadUrl = start.headers.get("location");
      if (!isTrustedUploadUrl(uploadUrl)) return failure("failed");

      uploadAccepted = true;
      videoStream = fs.createReadStream(request.videoAbsolutePath);
      const uploaded = await this.fetcher(uploadUrl, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Length": String(videoStat.size),
          "Content-Type": "video/mp4",
        },
        signal: controller.signal,
        body: videoStream as unknown as BodyInit,
        duplex: "half",
      });
      if (!uploaded.ok) return failure(uploaded.status >= 500 ? "indeterminate" : "failed");
      const payload = await readBoundedJson(uploaded, this.maximumResponseBytes, controller);
      const remoteVideoId = safeRemoteId(payload.id);
      if (!remoteVideoId) return failure("indeterminate");

      const thumbnail = fs.readFileSync(request.thumbnailAbsolutePath);
      const thumbnailResponse = await this.fetcher(
        `https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${encodeURIComponent(remoteVideoId)}&uploadType=media`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": detectThumbnailMime(request.thumbnailAbsolutePath),
            "Content-Length": String(thumbnail.length),
          },
          signal: controller.signal,
          body: thumbnail,
        },
      );
      if (!thumbnailResponse.ok) return failure("indeterminate");

      const channelId = safeRemoteId((payload.snippet as Record<string, unknown> | undefined)?.channelId);
      const providerRequestId = safeProviderRequestId(uploaded.headers.get("x-guploader-uploadid"));
      return {
        success: true,
        provider: this.name,
        model: this.model,
        remoteVideoId,
        remoteVideoUrl: `https://www.youtube.com/watch?v=${remoteVideoId}`,
        ...(channelId ? { channelId } : {}),
        ...(providerRequestId ? { providerRequestId } : {}),
      };
    } catch {
      return failure(uploadAccepted ? "indeterminate" : "failed");
    } finally {
      clearTimeout(timer);
      request.signal?.removeEventListener("abort", abortFromCaller);
      videoStream?.destroy();
    }
  }

  async reconcilePublish(
    request: YouTubePublishReconciliationRequest,
  ): Promise<YouTubePublishReconciliationResult> {
    const token = process.env.YOUTUBE_ACCESS_TOKEN?.trim();
    let markerIsValid = false;
    try {
      markerIsValid = request.reconciliationMarker ===
        createYouTubeReconciliationMarker(request);
    } catch {
      markerIsValid = false;
    }
    if (
      process.env.YOUTUBE_PUBLISH_PROVIDER?.trim().toLowerCase() !== this.name ||
      !token || !this.channelBindingValid ||
      request.provider !== this.name || request.model !== this.model ||
      !markerIsValid ||
      (this.reconciliationChannelId !== undefined &&
        request.channelBinding !== this.reconciliationChannelId)
    ) return reconciliationFailure("failure");
    if (request.signal?.aborted) return reconciliationFailure("failure");

    const controller = new AbortController();
    const abortFromCaller = () => controller.abort();
    request.signal?.addEventListener("abort", abortFromCaller, { once: true });
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const query = new URLSearchParams({
        part: "id,snippet",
        forMine: "true",
        type: "video",
        maxResults: "10",
        q: request.reconciliationMarker,
      });
      const response = await this.fetcher(
        `https://www.googleapis.com/youtube/v3/search?${query.toString()}`,
        {
          method: "GET",
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        },
      );
      if (!response.ok) {
        await cancelResponseBody(response);
        return reconciliationFailure(response.status >= 500 ? "indeterminate" : "failure");
      }
      const payload = await readBoundedJson(response, this.maximumResponseBytes, controller);
      if (payload.nextPageToken !== undefined) {
        if (typeof payload.nextPageToken !== "string" || payload.nextPageToken.length > 500) {
          return reconciliationFailure("failure");
        }
        return reconciliationFailure("ambiguous");
      }
      const candidates = readReconciliationCandidates(
        payload,
        request.reconciliationMarker,
      );
      if (candidates.length === 0) return reconciliationFailure("not_found");
      if (candidates.length !== 1) return reconciliationFailure("ambiguous");
      const candidate = candidates[0];
      if (
        request.channelBinding !== undefined &&
        candidate.channelId !== request.channelBinding
      ) return reconciliationFailure("failure");
      return {
        outcome: "matched",
        provider: this.name,
        model: this.model,
        reconciliationMarker: request.reconciliationMarker,
        remoteVideoId: candidate.remoteVideoId,
        remoteVideoUrl: `https://www.youtube.com/watch?v=${candidate.remoteVideoId}`,
        channelId: candidate.channelId,
        ...(safeProviderRequestId(response.headers.get("x-goog-request-id"))
          ? { providerRequestId: safeProviderRequestId(response.headers.get("x-goog-request-id"))! }
          : {}),
      };
    } catch {
      return reconciliationFailure("indeterminate");
    } finally {
      clearTimeout(timer);
      request.signal?.removeEventListener("abort", abortFromCaller);
    }
  }
}

function descriptionWithMarker(description: string, marker?: string) {
  if (!marker) return description;
  if (!/^atolye-v1-[a-f0-9]{64}$/.test(marker)) throw new Error("invalid");
  const suffix = `\n\n[atolye-reconcile:${marker}]`;
  if (description.length + suffix.length > 5_000) throw new Error("invalid");
  return `${description}${suffix}`;
}

function readReconciliationCandidates(
  payload: Record<string, unknown>,
  marker: string,
) {
  if (!Array.isArray(payload.items) || payload.items.length > 10) {
    throw new Error("invalid");
  }
  const token = `[atolye-reconcile:${marker}]`;
  return payload.items.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("invalid");
    const record = item as Record<string, unknown>;
    if (!record.id || typeof record.id !== "object" || Array.isArray(record.id) ||
      !record.snippet || typeof record.snippet !== "object" || Array.isArray(record.snippet)) {
      throw new Error("invalid");
    }
    const id = record.id as Record<string, unknown>;
    const snippet = record.snippet as Record<string, unknown>;
    const description = snippet.description;
    if (typeof description !== "string" || description.length > 10_000) {
      throw new Error("invalid");
    }
    if (!description.includes(token)) return [];
    const remoteVideoId = safeRemoteId(id.videoId);
    const channelId = safeRemoteId(snippet.channelId);
    if (!remoteVideoId || !channelId) throw new Error("invalid");
    return [{ remoteVideoId, channelId }];
  });
}

async function cancelResponseBody(response: Response) {
  try {
    await response.body?.cancel();
  } catch {
    // Response cleanup is best-effort and must not expose transport details.
  }
}

async function readBoundedJson(
  response: Response,
  maximumBytes: number,
  controller: AbortController,
): Promise<Record<string, unknown>> {
  const length = response.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > maximumBytes)) {
    controller.abort();
    throw new Error("invalid");
  }
  if (!response.body) throw new Error("invalid");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        controller.abort();
        await reader.cancel();
        throw new Error("invalid");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid");
  return parsed as Record<string, unknown>;
}

function isTrustedUploadUrl(value: string | null): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      (url.hostname === "www.googleapis.com" || url.hostname === "youtube.googleapis.com");
  } catch {
    return false;
  }
}

function safeRemoteId(value: unknown) {
  return typeof value === "string" && /^[a-zA-Z0-9._:-]{1,200}$/.test(value) ? value : null;
}

function safeProviderRequestId(value: string | null) {
  return value && /^[a-zA-Z0-9._:-]{1,300}$/.test(value) ? value : null;
}

function detectThumbnailMime(filePath: string) {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  throw new Error("invalid");
}

function failure(outcome: "failed" | "indeterminate"): YouTubePublishProviderResult {
  return {
    success: false,
    provider: "youtube-data-api",
    model: youtubePublishProviderConfig.youtubeDataApi.model,
    outcome,
    error: YOUTUBE_PUBLISH_ERROR,
  };
}

function reconciliationFailure(
  outcome: Exclude<YouTubePublishReconciliationResult["outcome"], "matched">,
): YouTubePublishReconciliationResult {
  return {
    outcome,
    provider: "youtube-data-api",
    model: youtubePublishProviderConfig.youtubeDataApi.model,
    error: YOUTUBE_RECONCILIATION_ERROR,
  };
}
