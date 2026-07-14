import { createHash } from "node:crypto";
import type { YouTubePublishingPackage } from "@/types/youtube";
import type {
  YouTubePublishMetadata,
  YouTubePublishProviderName,
  YouTubePublishReconciliationResult,
  YouTubePublishRecord,
} from "@/types/youtubePublish";
import { validateYouTubePublishingPackage } from "../YouTubePackageValidation";

const SAFE_SEGMENT = /^[a-zA-Z0-9-_]+$/;
const SAFE_ID = /^[a-zA-Z0-9._:-]+$/;
const SHA256 = /^[a-f0-9]{64}$/;
const RECONCILIATION_MARKER = /^atolye-v1-[a-f0-9]{64}$/;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/u;

export class YouTubePublishValidationError extends Error {
  readonly code = "YOUTUBE_PUBLISH_INVALID";

  constructor() {
    super("YouTube publish record is invalid.");
    this.name = "YouTubePublishValidationError";
    this.stack = undefined;
  }
}

export function createYouTubePackageIdentity(value: YouTubePublishingPackage) {
  validateYouTubePublishingPackage(value);
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

export function createYouTubeReconciliationMarker(value: {
  projectId: string;
  slug: string;
  packageIdentity: string;
  videoAssetId: string;
  thumbnailAssetId: string;
  provider: YouTubePublishProviderName;
  model?: string;
  channelBinding?: string;
}) {
  if (
    !safeText(value.projectId, 200) ||
    !SAFE_SEGMENT.test(value.slug) ||
    !SHA256.test(value.packageIdentity) ||
    !safeText(value.videoAssetId, 300) ||
    !safeText(value.thumbnailAssetId, 300) ||
    !isProvider(value.provider) ||
    (value.model !== undefined && !safeText(value.model, 200)) ||
    (value.channelBinding !== undefined && !safeRemoteId(value.channelBinding))
  ) throw new YouTubePublishValidationError();
  const binding = JSON.stringify({
    schemaVersion: "1",
    projectId: value.projectId,
    slug: value.slug,
    packageIdentity: value.packageIdentity,
    videoAssetId: value.videoAssetId,
    thumbnailAssetId: value.thumbnailAssetId,
    provider: value.provider,
    model: value.model ?? null,
    channelBinding: value.channelBinding ?? null,
  });
  return `atolye-v1-${createHash("sha256").update(binding, "utf8").digest("hex")}`;
}

export function createYouTubePublishMetadata(
  value: YouTubePublishingPackage,
): YouTubePublishMetadata {
  validateYouTubePublishingPackage(value);
  if (value.tags.join(",").length > 500) {
    throw new YouTubePublishValidationError();
  }
  return {
    title: value.title,
    description: value.description,
    tags: [...value.tags],
    privacyStatus: "private",
  };
}

export function isYouTubePublishRecord(value: unknown): value is YouTubePublishRecord {
  try {
    validateYouTubePublishRecord(value);
    return true;
  } catch {
    return false;
  }
}

export function validateYouTubePublishReconciliationResult(
  value: unknown,
): asserts value is YouTubePublishReconciliationResult {
  try {
    const result = requireRecord(value);
    const outcomes = new Set([
      "matched", "not_found", "ambiguous", "indeterminate", "failure",
    ]);
    if (typeof result.outcome !== "string" || !outcomes.has(result.outcome)) {
      throw new Error("invalid");
    }
    const allowed = result.outcome === "matched"
      ? new Set([
          "outcome", "provider", "model", "reconciliationMarker", "remoteVideoId",
          "remoteVideoUrl", "channelId", "providerRequestId",
        ])
      : new Set(["outcome", "provider", "model", "error"]);
    if (
      Object.keys(result).some((key) => !allowed.has(key)) ||
      !isProvider(result.provider) ||
      (result.model !== undefined && !safeText(result.model, 200))
    ) throw new Error("invalid");
    if (result.outcome === "matched") {
      if (
        typeof result.reconciliationMarker !== "string" ||
        !RECONCILIATION_MARKER.test(result.reconciliationMarker) ||
        !safeRemoteId(result.remoteVideoId) ||
        result.remoteVideoUrl !== `https://www.youtube.com/watch?v=${result.remoteVideoId}` ||
        (result.channelId !== undefined && !safeRemoteId(result.channelId)) ||
        (result.providerRequestId !== undefined && !safeText(result.providerRequestId, 300))
      ) throw new Error("invalid");
    } else if (result.error !== "YouTube publish reconciliation failed.") {
      throw new Error("invalid");
    }
  } catch {
    throw new YouTubePublishValidationError();
  }
}

export function validateYouTubePublishRecord(
  value: unknown,
  expected: {
    projectId?: string;
    slug?: string;
    packageIdentity?: string;
    videoAssetId?: string;
    thumbnailAssetId?: string;
    provider?: YouTubePublishProviderName;
    model?: string;
    reconciliationMarker?: string;
    channelBinding?: string;
  } = {},
): asserts value is YouTubePublishRecord {
  try {
    const record = requireRecord(value);
    const common = new Set([
      "schemaVersion", "projectId", "slug", "packageIdentity",
      "videoAssetId", "thumbnailAssetId", "provider", "model", "attemptId",
      "status", "createdAt", "reconciliationMarker", "channelBinding",
    ]);
    const statusKeys: Record<string, string[]> = {
      publishing: [],
      failed: ["failedAt"],
      published: [
        "remoteVideoId", "remoteVideoUrl", "channelId",
        "providerRequestId", "publishedAt",
      ],
    };
    if (typeof record.status !== "string" || !(record.status in statusKeys)) {
      throw new Error("invalid");
    }
    const allowed = new Set([...common, ...statusKeys[record.status]]);
    if (
      Object.keys(record).some((key) => !allowed.has(key)) ||
      record.schemaVersion !== "1" ||
      !safeText(record.projectId, 200) ||
      typeof record.slug !== "string" || !SAFE_SEGMENT.test(record.slug) ||
      typeof record.packageIdentity !== "string" || !SHA256.test(record.packageIdentity) ||
      !safeText(record.videoAssetId, 300) ||
      !safeText(record.thumbnailAssetId, 300) ||
      !isProvider(record.provider) ||
      !safeText(record.attemptId, 200) ||
      !timestamp(record.createdAt) ||
      (record.model !== undefined && !safeText(record.model, 200)) ||
      (expected.projectId !== undefined && record.projectId !== expected.projectId) ||
      (expected.slug !== undefined && record.slug !== expected.slug) ||
      (expected.packageIdentity !== undefined && record.packageIdentity !== expected.packageIdentity) ||
      (expected.videoAssetId !== undefined && record.videoAssetId !== expected.videoAssetId) ||
      (expected.thumbnailAssetId !== undefined && record.thumbnailAssetId !== expected.thumbnailAssetId)
      || (expected.provider !== undefined && record.provider !== expected.provider)
      || (expected.model !== undefined && record.model !== expected.model)
      || (expected.reconciliationMarker !== undefined &&
        record.reconciliationMarker !== expected.reconciliationMarker)
      || (expected.channelBinding !== undefined && record.channelBinding !== expected.channelBinding)
    ) throw new Error("invalid");

    if (
      (record.reconciliationMarker !== undefined &&
        (typeof record.reconciliationMarker !== "string" ||
          !RECONCILIATION_MARKER.test(record.reconciliationMarker) ||
          record.reconciliationMarker !== createYouTubeReconciliationMarker({
            projectId: record.projectId as string,
            slug: record.slug as string,
            packageIdentity: record.packageIdentity as string,
            videoAssetId: record.videoAssetId as string,
            thumbnailAssetId: record.thumbnailAssetId as string,
            provider: record.provider as YouTubePublishProviderName,
            ...(record.model === undefined ? {} : { model: record.model as string }),
            ...(record.channelBinding === undefined
              ? {}
              : { channelBinding: record.channelBinding as string }),
          }))) ||
      (record.channelBinding !== undefined && !safeRemoteId(record.channelBinding))
    ) throw new Error("invalid");

    if (record.status === "published") {
      if (
        !safeRemoteId(record.remoteVideoId) ||
        record.remoteVideoUrl !== `https://www.youtube.com/watch?v=${record.remoteVideoId}` ||
        !timestamp(record.publishedAt) ||
        (record.channelId !== undefined && !safeRemoteId(record.channelId)) ||
        (record.providerRequestId !== undefined && !safeText(record.providerRequestId, 300))
      ) throw new Error("invalid");
    } else if (record.status === "failed" && !timestamp(record.failedAt)) {
      throw new Error("invalid");
    }
  } catch {
    throw new YouTubePublishValidationError();
  }
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid");
  return value as Record<string, unknown>;
}

function safeText(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value === value.normalize("NFC").trim() &&
    value.length > 0 && value.length <= maximum && !CONTROL.test(value);
}

function safeRemoteId(value: unknown): value is string {
  return safeText(value, 200) && SAFE_ID.test(value);
}

function timestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isProvider(value: unknown): value is YouTubePublishProviderName {
  return value === "mock" || value === "youtube-data-api";
}
