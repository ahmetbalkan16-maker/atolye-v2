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
import { YouTubeEngine } from "./YouTubeEngine";
import {
  normalizeYouTubePackageDraft,
  validateYouTubePublishingPackage,
} from "./YouTubePackageValidation";
import type { YouTubeProvider } from "./providers/YouTubeProvider";
import { YouTubeProviderRouter } from "./YouTubeProviderRouter";

const SAFE_ERROR = "YouTube package generation failed.";
const MAX_VIDEO_BYTES = 8 * 1024 * 1024 * 1024;

export class YouTubePackageGenerationError extends Error {
  readonly code = "YOUTUBE_PACKAGE_GENERATION_FAILED";

  constructor() {
    super(SAFE_ERROR);
    this.name = "YouTubePackageGenerationError";
    this.stack = undefined;
  }
}

export interface GenerateYouTubePackageInput {
  project: Project;
  assembly: AssemblyPlanData;
  thumbnail: ThumbnailData;
  seo: SEOData;
  provider?: YouTubeProvider;
  generatedAt?: string;
}

export class YouTubePackagePipeline {
  static async generatePackage({
    project,
    assembly,
    thumbnail,
    seo,
    provider,
    generatedAt = new Date().toISOString(),
  }: GenerateYouTubePackageInput): Promise<YouTubePublishingPackage> {
    try {
      validateProject(project);
      const selected = provider ?? new YouTubeProviderRouter().getProvider();
      if (selected.name !== "mock" && selected.name !== "openai") {
        throw new Error("invalid");
      }
      const assets = AssetManager.getProjectAssets(project.slug, project.id).assets;
      const video = requireFinalVideoAsset(project, assembly, assets);
      const thumbnailAsset = requireThumbnailAsset(
        project,
        thumbnail,
        assets,
      );
      const durationSeconds = requireVideoDuration(assembly, video);

      const existing = await ProjectManager.getYouTube(project.slug);
      if (
        existing &&
        typeof existing === "object" &&
        "provider" in existing &&
        existing.provider === selected.name
      ) {
        try {
          validateYouTubePublishingPackage(existing, {
            projectId: project.id,
            slug: project.slug,
            videoAssetId: video.id,
            thumbnailAssetId: thumbnailAsset.id,
            videoDurationSeconds: durationSeconds,
          });
          return existing;
        } catch {
          // Legacy, malformed or stale packages are never replayed.
        }
      }

      const result = await new YouTubeEngine().generatePublishingPackage({
        projectId: project.id,
        projectSlug: project.slug,
        title: project.title,
        videoDurationSeconds: durationSeconds,
        assembly,
        thumbnail,
        seo,
        provider: selected,
      });
      if (
        result.success !== true ||
        result.provider !== selected.name ||
        (result as { error?: unknown }).error !== undefined
      ) {
        throw new Error("invalid");
      }

      const draft = normalizeYouTubePackageDraft(
        result.draft,
        durationSeconds,
      );
      const canonical: YouTubePublishingPackage = {
        schemaVersion: "1",
        projectId: project.id,
        slug: project.slug,
        provider: selected.name,
        model: normalizeModel(selected.model),
        status: "generated",
        ...draft,
        videoAssetId: video.id,
        thumbnailAssetId: thumbnailAsset.id,
        generatedAt: requireTimestamp(generatedAt),
      };
      validateYouTubePublishingPackage(canonical, {
        projectId: project.id,
        slug: project.slug,
        videoAssetId: video.id,
        thumbnailAssetId: thumbnailAsset.id,
        videoDurationSeconds: durationSeconds,
      });
      return canonical;
    } catch {
      throw new YouTubePackageGenerationError();
    }
  }
}

function requireFinalVideoAsset(
  project: Project,
  assembly: AssemblyPlanData,
  assets: Asset[],
) {
  if (
    assembly.projectId !== project.id ||
    assembly.slug !== project.slug ||
    assembly.status !== "assembled" ||
    assembly.render?.status !== "rendered" ||
    assembly.render.format !== "mp4" ||
    assembly.render.mimeType !== "video/mp4" ||
    typeof assembly.outputAssetId !== "string" ||
    !assembly.outputAssetId
  ) {
    throw new Error("invalid");
  }
  const matches = assets.filter((asset) => asset.id === assembly.outputAssetId);
  if (matches.length !== 1) throw new Error("invalid");
  const asset = matches[0];
  if (
    asset.projectId !== project.id ||
    asset.projectSlug !== project.slug ||
    asset.type !== "video" ||
    asset.status !== "generated" ||
    asset.provider === "mock" ||
    asset.mimeType !== "video/mp4" ||
    typeof asset.filePath !== "string" ||
    typeof asset.url !== "string" ||
    !Number.isSafeInteger(asset.byteLength) ||
    (asset.byteLength as number) <= 0
  ) {
    throw new Error("invalid");
  }
  const fileName = path.posix.basename(asset.filePath);
  if (
    asset.filePath !== VideoStorage.getVideoPath(project.slug, fileName) ||
    asset.url !== VideoStorage.getVideoUrl(project.slug, fileName) ||
    assembly.render.filePath !== asset.filePath ||
    assembly.render.outputUrl !== asset.url ||
    assembly.render.byteLength !== asset.byteLength
  ) {
    throw new Error("invalid");
  }
  const inspection = VideoStorage.inspectStoredMp4(
    project.slug,
    asset.filePath,
    MAX_VIDEO_BYTES,
  );
  if (
    inspection.byteLength !== asset.byteLength ||
    !Number.isFinite(inspection.durationSeconds) ||
    Math.abs((inspection.durationSeconds as number) - (asset.durationSeconds as number)) > 1e-3
  ) throw new Error("invalid");
  return asset;
}

function requireThumbnailAsset(
  project: Project,
  thumbnail: ThumbnailData,
  assets: Asset[],
) {
  const generation = thumbnail.generation;
  if (
    thumbnail.projectId !== project.id ||
    thumbnail.slug !== project.slug ||
    thumbnail.status !== "generated" ||
    typeof thumbnail.outputAssetId !== "string" ||
    !thumbnail.outputAssetId ||
    generation?.status !== "generated" ||
    generation.assetId !== thumbnail.outputAssetId ||
    thumbnail.provider !== generation.provider ||
    thumbnail.model !== generation.model ||
    (generation.generationMode !== "mock" &&
      generation.generationMode !== "production")
  ) {
    throw new Error("invalid");
  }
  const matches = assets.filter((asset) => asset.id === thumbnail.outputAssetId);
  if (matches.length !== 1) throw new Error("invalid");
  const asset = matches[0];
  if (
    asset.projectId !== project.id ||
    asset.projectSlug !== project.slug ||
    asset.type !== "thumbnail" ||
    asset.status !== "generated" ||
    typeof asset.filePath !== "string" ||
    typeof asset.url !== "string" ||
    typeof asset.mimeType !== "string" ||
    typeof generation.fileName !== "string" ||
    typeof generation.filePath !== "string" ||
    typeof generation.imageUrl !== "string" ||
    asset.provider !== generation.provider ||
    asset.model !== generation.model ||
    asset.filePath !== generation.filePath ||
    asset.url !== generation.imageUrl ||
    asset.mimeType !== generation.mimeType ||
    asset.width !== generation.width ||
    asset.height !== generation.height ||
    asset.byteLength !== generation.byteLength ||
    asset.generationMode !== generation.generationMode
  ) {
    throw new Error("invalid");
  }
  const fileName = path.posix.basename(asset.filePath);
  const extension = path.posix.extname(fileName).toLowerCase();
  if (
    fileName !== generation.fileName ||
    fileName !== `${asset.id}${extension}` ||
    asset.filePath !== ThumbnailStorage.getThumbnailPath(project.slug, fileName) ||
    asset.url !== ThumbnailStorage.getThumbnailUrl(project.slug, fileName)
  ) {
    throw new Error("invalid");
  }
  const inspection = ThumbnailStorage.inspectStoredThumbnail(
    project.slug,
    asset.filePath,
    asset.mimeType as ThumbnailMimeType,
  );
  if (
    inspection.width !== asset.width ||
    inspection.height !== asset.height ||
    inspection.byteLength !== asset.byteLength
  ) {
    throw new Error("invalid");
  }
  return asset;
}

function requireVideoDuration(assembly: AssemblyPlanData, asset: Asset) {
  const renderDuration = assembly.render?.durationSeconds;
  const assetDuration = asset.durationSeconds;
  if (
    !Number.isFinite(renderDuration) ||
    (renderDuration as number) <= 0 ||
    !Number.isFinite(assetDuration) ||
    (assetDuration as number) <= 0 ||
    Math.abs((renderDuration as number) - (assetDuration as number)) > 1e-6
  ) {
    throw new Error("invalid");
  }
  return assetDuration as number;
}

function validateProject(project: Project) {
  if (
    !project.id?.trim() ||
    !/^[a-zA-Z0-9-_]+$/.test(project.slug) ||
    !project.title?.trim()
  ) {
    throw new Error("invalid");
  }
}

function normalizeModel(model: string | undefined) {
  if (model === undefined) return undefined;
  const normalized = model.normalize("NFC").trim();
  if (!normalized || normalized.length > 200 || /[\u0000-\u001f\u007f-\u009f]/u.test(normalized)) {
    throw new Error("invalid");
  }
  return normalized;
}

function requireTimestamp(value: string) {
  if (!value || !Number.isFinite(Date.parse(value))) throw new Error("invalid");
  return value;
}
