import crypto from "node:crypto";
import path from "node:path";
import { AssetManager } from "@/lib/assets/AssetManager";
import { VideoStorage } from "@/lib/assets/storage/VideoStorage";
import { ProjectManager } from "@/lib/projects/ProjectManager";
import { ThumbnailStorage } from "@/lib/thumbnail/ThumbnailStorage";
import type { Asset } from "@/types/asset";
import type { AssemblyPlanData } from "@/types/assembly";
import type { Project } from "@/types/project";
import type { SEOData } from "@/types/seo";
import type { ThumbnailData, ThumbnailMimeType } from "@/types/thumbnail";
import type { YouTubePublishingPackage } from "@/types/youtube";
import type { YouTubePublishRecord, YouTubePublishRequest } from "@/types/youtubePublish";
import { YouTubePackagePipeline } from "../YouTubePackagePipeline";
import type { YouTubeProvider } from "../providers/YouTubeProvider";
import {
  createYouTubePackageIdentity,
  createYouTubePublishMetadata,
  validateYouTubePublishRecord,
} from "./YouTubePublishValidation";
import type { YouTubePublishProvider } from "./providers/YouTubePublishProvider";
import { YouTubePublishProviderRouter } from "./YouTubePublishProviderRouter";

const MAX_VIDEO_BYTES = 8 * 1024 * 1024 * 1024;

export class YouTubePublishError extends Error {
  readonly code = "YOUTUBE_PUBLISH_FAILED";

  constructor() {
    super("YouTube publish failed.");
    this.name = "YouTubePublishError";
    this.stack = undefined;
  }
}

export class YouTubePublishPipeline {
  static async publishStoredPackage(input: {
    projectSlug: string;
    provider?: YouTubePublishProvider;
    timestamp?: string;
    attemptId?: string;
    signal?: AbortSignal;
  }): Promise<YouTubePublishRecord> {
    try {
      const slug = safeSlug(input.projectSlug);
      const timestamp = requireTimestamp(input.timestamp ?? new Date().toISOString());
      const attemptId = normalizeId(input.attemptId ?? crypto.randomUUID());
      const provider = input.provider ?? new YouTubePublishProviderRouter().getProvider();
      input.signal?.throwIfAborted();
      const [project, publishingPackage, assembly, thumbnail, seo, publishState, recoveryState] =
        await Promise.all([
          ProjectManager.getProject(slug) as Promise<Project | null>,
          ProjectManager.getYouTube(slug) as Promise<YouTubePublishingPackage | null>,
          ProjectManager.getAssembly(slug) as Promise<AssemblyPlanData | null>,
          ProjectManager.getThumbnail(slug) as Promise<ThumbnailData | null>,
          ProjectManager.getSEO(slug) as Promise<SEOData | null>,
          ProjectManager.getYouTubePublishState(slug),
          ProjectManager.getYouTubePublishRecoveryState(slug),
        ]);
      if (!project || !publishingPackage || !assembly || !thumbnail || !seo) {
        throw new Error("invalid");
      }

      const validatedPackage = await validateStoredPackage(
        project,
        publishingPackage,
        assembly,
        thumbnail,
        seo,
      );
      const packageIdentity = createYouTubePackageIdentity(validatedPackage);
      const assets = requireAssets(project, validatedPackage);
      const request = createProviderRequest(
        validatedPackage,
        packageIdentity,
        assets,
        input.signal,
      );

      if (publishState.status === "malformed") throw new Error("invalid");
      if (recoveryState.status === "malformed") throw new Error("invalid");
      const recovered = recoveryState.status === "parsed"
        ? requireMatchingPublishedRecord(recoveryState.value, {
            projectId: project.id,
            slug,
            packageIdentity,
            videoAssetId: validatedPackage.videoAssetId,
            thumbnailAssetId: validatedPackage.thumbnailAssetId,
            provider: provider.name,
          })
        : null;
      if (publishState.status === "parsed") {
        validateYouTubePublishRecord(publishState.value);
        const previous = publishState.value;
        if (
          previous.projectId !== project.id || previous.slug !== slug ||
          previous.packageIdentity !== packageIdentity ||
          previous.videoAssetId !== validatedPackage.videoAssetId ||
          previous.thumbnailAssetId !== validatedPackage.thumbnailAssetId ||
          previous.provider !== provider.name
        ) throw new Error("stale");
        if (previous.status === "published") {
          await removeRecoveryReceiptBestEffort(slug);
          return previous;
        }
        if (recovered) return promoteRecoveryReceipt(slug, recovered);
        if (previous.status === "publishing") throw new Error("indeterminate");
      }
      if (recovered) return promoteRecoveryReceipt(slug, recovered);

      input.signal?.throwIfAborted();
      const publishing: YouTubePublishRecord = {
        schemaVersion: "1",
        projectId: project.id,
        slug,
        packageIdentity,
        videoAssetId: validatedPackage.videoAssetId,
        thumbnailAssetId: validatedPackage.thumbnailAssetId,
        provider: provider.name,
        ...(provider.model ? { model: normalizeId(provider.model, 200) } : {}),
        attemptId,
        status: "publishing",
        createdAt: timestamp,
      };
      await ProjectManager.saveYouTubePublish(slug, publishing);

      const result = await provider.publish(request);
      if (result.provider !== provider.name || result.model !== provider.model) {
        throw new Error("invalid");
      }
      if (!result.success) {
        if (result.outcome === "failed") {
          const failed: YouTubePublishRecord = {
            ...publishing,
            status: "failed",
            failedAt: timestamp,
          };
          await ProjectManager.saveYouTubePublish(slug, failed);
        }
        throw new Error("provider");
      }

      const published: YouTubePublishRecord = {
        ...publishing,
        status: "published",
        remoteVideoId: normalizeRemoteId(result.remoteVideoId),
        remoteVideoUrl: result.remoteVideoUrl,
        ...(result.channelId ? { channelId: normalizeRemoteId(result.channelId) } : {}),
        ...(result.providerRequestId ? { providerRequestId: normalizeId(result.providerRequestId, 300) } : {}),
        publishedAt: timestamp,
      };
      validateYouTubePublishRecord(published, {
        projectId: project.id,
        slug,
        packageIdentity,
        videoAssetId: validatedPackage.videoAssetId,
        thumbnailAssetId: validatedPackage.thumbnailAssetId,
      });
      await ProjectManager.saveYouTubePublishRecovery(slug, published);
      await ProjectManager.saveYouTubePublish(slug, published);
      await removeRecoveryReceiptBestEffort(slug);
      return published;
    } catch {
      throw new YouTubePublishError();
    }
  }
}

async function validateStoredPackage(
  project: Project,
  publishingPackage: YouTubePublishingPackage,
  assembly: AssemblyPlanData,
  thumbnail: ThumbnailData,
  seo: SEOData,
) {
  const noGeneration: YouTubeProvider = {
    name: publishingPackage.provider,
    model: publishingPackage.model,
    async generatePublishingPackage() {
      throw new Error("Stored canonical package was not replayable.");
    },
  };
  const replay = await YouTubePackagePipeline.generatePackage({
    project,
    assembly,
    thumbnail,
    seo,
    provider: noGeneration,
  });
  if (JSON.stringify(replay) !== JSON.stringify(publishingPackage)) throw new Error("invalid");
  return replay;
}

function requireAssets(project: Project, publishingPackage: YouTubePublishingPackage) {
  const registry = AssetManager.getProjectAssets(project.slug, project.id).assets;
  const video = uniqueAsset(registry, publishingPackage.videoAssetId);
  const thumbnail = uniqueAsset(registry, publishingPackage.thumbnailAssetId);
  if (
    video.projectId !== project.id || video.projectSlug !== project.slug ||
    video.type !== "video" || video.status !== "generated" || video.mimeType !== "video/mp4" ||
    typeof video.filePath !== "string" || typeof video.url !== "string" ||
    thumbnail.projectId !== project.id || thumbnail.projectSlug !== project.slug ||
    thumbnail.type !== "thumbnail" || thumbnail.status !== "generated" ||
    (thumbnail.generationMode !== "mock" && thumbnail.generationMode !== "production") ||
    typeof thumbnail.filePath !== "string" || typeof thumbnail.url !== "string" ||
    typeof thumbnail.mimeType !== "string"
  ) throw new Error("invalid");

  const videoInspection = VideoStorage.inspectStoredMp4(project.slug, video.filePath, MAX_VIDEO_BYTES);
  const thumbnailFileName = path.posix.basename(thumbnail.filePath);
  const extension = path.posix.extname(thumbnailFileName).toLowerCase();
  if (
    video.url !== VideoStorage.getVideoUrl(project.slug, path.posix.basename(video.filePath)) ||
    videoInspection.byteLength !== video.byteLength ||
    thumbnailFileName !== `${thumbnail.id}${extension}` ||
    thumbnail.url !== ThumbnailStorage.getThumbnailUrl(project.slug, thumbnailFileName)
  ) throw new Error("invalid");
  const thumbnailInspection = ThumbnailStorage.inspectStoredThumbnail(
    project.slug,
    thumbnail.filePath,
    thumbnail.mimeType as ThumbnailMimeType,
  );
  if (
    thumbnailInspection.byteLength !== thumbnail.byteLength ||
    thumbnailInspection.width !== thumbnail.width ||
    thumbnailInspection.height !== thumbnail.height
  ) throw new Error("invalid");
  return {
    video,
    thumbnail,
    videoAbsolutePath: videoInspection.realPath,
    thumbnailAbsolutePath: thumbnailInspection.realPath,
  };
}

function createProviderRequest(
  publishingPackage: YouTubePublishingPackage,
  packageIdentity: string,
  assets: ReturnType<typeof requireAssets>,
  signal?: AbortSignal,
): YouTubePublishRequest {
  return {
    schemaVersion: "1",
    packageIdentity,
    publishingPackage,
    videoAbsolutePath: assets.videoAbsolutePath,
    thumbnailAbsolutePath: assets.thumbnailAbsolutePath,
    metadata: createYouTubePublishMetadata(publishingPackage),
    ...(signal ? { signal } : {}),
  };
}

function requireMatchingPublishedRecord(
  value: unknown,
  expected: {
    projectId: string;
    slug: string;
    packageIdentity: string;
    videoAssetId: string;
    thumbnailAssetId: string;
    provider: YouTubePublishProvider["name"];
  },
) {
  validateYouTubePublishRecord(value, expected);
  if (value.status !== "published" || value.provider !== expected.provider) {
    throw new Error("invalid");
  }
  return value;
}

async function promoteRecoveryReceipt(
  slug: string,
  recovered: Extract<YouTubePublishRecord, { status: "published" }>,
) {
  await ProjectManager.saveYouTubePublish(slug, recovered);
  await removeRecoveryReceiptBestEffort(slug);
  return recovered;
}

async function removeRecoveryReceiptBestEffort(slug: string) {
  try {
    await ProjectManager.removeYouTubePublishRecovery(slug);
  } catch {
    // A validated published record remains authoritative; stale receipt cleanup is retryable.
  }
}

function uniqueAsset(assets: Asset[], id: string) {
  const matches = assets.filter((asset) => asset.id === id);
  if (matches.length !== 1) throw new Error("invalid");
  return matches[0];
}

function safeSlug(value: string) {
  if (!/^[a-zA-Z0-9-_]+$/.test(value)) throw new Error("invalid");
  return value;
}

function requireTimestamp(value: string) {
  if (!Number.isFinite(Date.parse(value))) throw new Error("invalid");
  return value;
}

function normalizeId(value: string, maximum = 200) {
  const normalized = value.normalize("NFC").trim();
  if (!normalized || normalized.length > maximum || /[\u0000-\u001f\u007f-\u009f]/u.test(normalized)) {
    throw new Error("invalid");
  }
  return normalized;
}

function normalizeRemoteId(value: string) {
  const normalized = normalizeId(value);
  if (!/^[a-zA-Z0-9._:-]+$/.test(normalized)) throw new Error("invalid");
  return normalized;
}
