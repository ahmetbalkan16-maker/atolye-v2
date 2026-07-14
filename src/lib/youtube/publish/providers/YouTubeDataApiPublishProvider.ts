import fs from "node:fs";
import type { YouTubePublishProviderResult, YouTubePublishRequest } from "@/types/youtubePublish";
import { youtubePublishProviderConfig } from "../YouTubePublishProviderConfig";
import type { YouTubePublishProvider } from "./YouTubePublishProvider";
import { YOUTUBE_PUBLISH_ERROR } from "./YouTubePublishProvider";

type Fetcher = (input: string, init?: RequestInit & { duplex?: "half" }) => Promise<Response>;

export class YouTubeDataApiPublishProvider implements YouTubePublishProvider {
  readonly name = "youtube-data-api" as const;
  readonly model = youtubePublishProviderConfig.youtubeDataApi.model;
  private readonly fetcher: Fetcher;
  private readonly timeoutMs: number;
  private readonly maximumResponseBytes: number;

  constructor(options: {
    fetcher?: Fetcher;
    timeoutMs?: number;
    maximumResponseBytes?: number;
  } = {}) {
    this.fetcher = options.fetcher ?? (fetch as Fetcher);
    this.timeoutMs = options.timeoutMs ?? youtubePublishProviderConfig.youtubeDataApi.timeoutMs;
    this.maximumResponseBytes = options.maximumResponseBytes ??
      youtubePublishProviderConfig.youtubeDataApi.maximumResponseBytes;
  }

  async publish(request: YouTubePublishRequest): Promise<YouTubePublishProviderResult> {
    const token = process.env.YOUTUBE_ACCESS_TOKEN?.trim();
    if (
      process.env.YOUTUBE_PUBLISH_PROVIDER?.trim().toLowerCase() !== this.name ||
      !token
    ) return failure("failed");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let uploadAccepted = false;
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
              description: request.metadata.description,
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
      const uploaded = await this.fetcher(uploadUrl, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Length": String(videoStat.size),
          "Content-Type": "video/mp4",
        },
        signal: controller.signal,
        body: fs.createReadStream(request.videoAbsolutePath) as unknown as BodyInit,
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
    }
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
