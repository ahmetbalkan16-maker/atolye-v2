import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { createHash, randomUUID } from "node:crypto";
import { AssetManager } from "@/lib/assets/AssetManager";
import { AudioStorage } from "@/lib/assets/storage/AudioStorage";
import { VideoStorage } from "@/lib/assets/storage/VideoStorage";
import { ThumbnailStorage } from "@/lib/thumbnail/ThumbnailStorage";
import { requireContainedStorageDirectory } from "@/lib/assets/storage/StoragePathSecurity";
import {
  acquireProjectWriteAuthority,
  ensureSafeContainedDirectory,
  resolveRuntimeLogicalPathForWrite,
  resolveRuntimeStorageContext,
  type RuntimeStorageContext,
} from "@/lib/runtime/RuntimeStoragePaths";
import type { Asset } from "@/types/asset";
import type { AssemblyPlanData } from "@/types/assembly";
import type { AudioData } from "@/types/audio";
import type {
  ExportBundleFileEntry,
  ExportBundleInfo,
  ExportBundleManifest,
} from "@/types/export";
import type { ThumbnailData, ThumbnailMimeType } from "@/types/thumbnail";
import type { YouTubePublishingPackage } from "@/types/youtube";
import { buildChapterSubtitles, SubtitleGenerationError } from "./SubtitleGenerator";
import { MAX_BLEND_SECONDS } from "@/lib/assembly/providers/FFmpegVideoAssemblyProvider";

/**
 * Physical export bundle materializer (Sprint 132).
 *
 * Deliberately scoped lighter than the asset registry's own hardened
 * publication path (AudioCompensationStore / PortableNoClobberFilePublisher):
 * the bundle is a derived, regenerable distribution artifact, not the system
 * of record, so this uses the same write-authority-lease + atomic-rename
 * primitives everywhere else in this codebase (FileStorage, ProjectWriter,
 * ThumbnailStorage) rather than a second copy of the canonical-asset
 * cross-process crash-safety machinery. This is a deliberate scope decision,
 * not an oversight - see the Sprint 132 report.
 */

export class ExportBundleMaterializationError extends Error {
  readonly code = "EXPORT_BUNDLE_MATERIALIZATION_FAILED";

  constructor(reason: string) {
    super(`Export bundle materialization failed: ${reason}`);
    this.name = "ExportBundleMaterializationError";
    this.stack = undefined;
  }
}

export interface MaterializeExportBundleInput {
  projectId: string;
  projectSlug: string;
  assembly: AssemblyPlanData;
  thumbnail: ThumbnailData;
  audio: AudioData;
  youtube: YouTubePublishingPackage;
  storageContext?: RuntimeStorageContext;
}

const MAX_VIDEO_BYTES = 8 * 1024 * 1024 * 1024;

export async function materializeExportBundle(
  input: MaterializeExportBundleInput,
): Promise<ExportBundleInfo> {
  const context = resolveRuntimeStorageContext(input.storageContext ?? {});
  const slug = requireSafeSlug(input.projectSlug);
  const lease = acquireProjectWriteAuthority(slug, context);
  let stagingAbsolute: string | undefined;

  try {
    const projectAssets = AssetManager.getProjectAssets(slug, input.projectId, context);

    const videoSource = resolveCanonicalVideo(slug, input.assembly, projectAssets.assets, context);
    const thumbnailSource = resolveCanonicalThumbnail(
      slug,
      input.thumbnail,
      projectAssets.assets,
      context,
    );
    const chapterDurations = resolveChapterDurations(
      slug,
      input.audio,
      projectAssets.assets,
      context,
    );

    let subtitles;
    try {
      subtitles = buildChapterSubtitles(input.audio, chapterDurations);
    } catch (error) {
      if (error instanceof SubtitleGenerationError) {
        throw new ExportBundleMaterializationError(error.message);
      }
      throw error;
    }

    const renderedDuration = input.assembly.render?.durationSeconds;
    if (typeof renderedDuration === "number" && Number.isFinite(renderedDuration)) {
      // Subtitles span the full narration timeline; a crossfaded final video is
      // shorter than that narration sum by the transition-blend overlap (up to
      // MAX_BLEND_SECONDS per inter-scene junction). Allow for that on top of
      // the 1%/1s base tolerance so a legitimately blended render is not
      // rejected, while a genuinely wrong subtitle set (off by many seconds)
      // still fails.
      const sceneCount = Array.isArray(input.assembly.scenes)
        ? input.assembly.scenes.length
        : 0;
      const blendAllowanceSeconds = Math.max(0, sceneCount - 1) * MAX_BLEND_SECONDS;
      const tolerance = Math.max(1, renderedDuration * 0.01) + blendAllowanceSeconds;
      if (Math.abs(subtitles.totalDurationSeconds - renderedDuration) > tolerance) {
        throw new ExportBundleMaterializationError(
          "subtitle total duration diverges from the canonical rendered video duration",
        );
      }
    }

    const youtubeMetadataJson = JSON.stringify(input.youtube, null, 2);

    const exportDirAbsolute = ensureBundleParentDir(slug, context);
    const bundleDirAbsolute = path.join(exportDirAbsolute, "bundle");
    stagingAbsolute = path.join(exportDirAbsolute, `.staging-${randomUUID()}`);
    fs.mkdirSync(stagingAbsolute);

    const files: ExportBundleFileEntry[] = [];

    files.push(
      await linkBinaryFile({
        sourceRealPath: videoSource.realPath,
        stagingDir: stagingAbsolute,
        fileName: videoSource.fileName,
        sourceAssetId: videoSource.assetId,
        sourcePackage: "assembly",
        expectedByteLength: videoSource.byteLength,
      }),
    );

    files.push(
      await linkBinaryFile({
        sourceRealPath: thumbnailSource.realPath,
        stagingDir: stagingAbsolute,
        fileName: thumbnailSource.fileName,
        sourceAssetId: thumbnailSource.assetId,
        sourcePackage: "thumbnail",
        expectedByteLength: thumbnailSource.byteLength,
      }),
    );

    files.push(
      writeTextFile(stagingAbsolute, "youtube_metadata.json", youtubeMetadataJson, "youtube"),
    );
    files.push(writeTextFile(stagingAbsolute, "subtitles.srt", subtitles.srt, "audio"));
    files.push(writeTextFile(stagingAbsolute, "subtitles.vtt", subtitles.vtt, "audio"));

    const manifest = buildManifest(input, files);
    writeManifestFile(stagingAbsolute, manifest);

    const promoted = promoteStagedBundle({
      exportDirAbsolute,
      bundleDirAbsolute,
      stagingAbsolute,
      manifest,
    });
    stagingAbsolute = undefined;

    requireContainedStorageDirectory(bundleDirAbsolute, context);

    return {
      status: "packaged",
      path: getExportBundleLogicalPath(slug),
      files: promoted.manifest.files,
      manifestChecksum: promoted.manifest.checksum,
    };
  } catch (error) {
    if (stagingAbsolute) {
      try {
        fs.rmSync(stagingAbsolute, { recursive: true, force: true });
      } catch {
        // Best effort: an orphaned staging dir is inert and never treated as canonical.
      }
    }
    if (error instanceof ExportBundleMaterializationError) throw error;
    throw new ExportBundleMaterializationError(
      error instanceof Error ? error.message : "unknown error",
    );
  } finally {
    lease.release();
  }
}

interface ResolvedBinarySource {
  assetId: string;
  realPath: string;
  byteLength: number;
  fileName: string;
}

function resolveCanonicalVideo(
  slug: string,
  assembly: AssemblyPlanData,
  assets: readonly Asset[],
  context: RuntimeStorageContext,
): ResolvedBinarySource {
  const assetId = assembly?.outputAssetId;
  if (typeof assetId !== "string" || !assetId) {
    throw new ExportBundleMaterializationError(
      "assembly.outputAssetId is missing; no canonical final video asset",
    );
  }
  const candidates = assets.filter((asset) => asset.id === assetId);
  if (candidates.length !== 1) {
    throw new ExportBundleMaterializationError("canonical video asset record not found");
  }
  const asset = candidates[0];
  if (
    asset.type !== "video" ||
    asset.status !== "generated" ||
    asset.provider !== "ffmpeg" ||
    typeof asset.filePath !== "string" ||
    !Number.isSafeInteger(asset.byteLength) ||
    (asset.byteLength as number) <= 0
  ) {
    throw new ExportBundleMaterializationError(
      "canonical video asset record is invalid or not generated",
    );
  }

  let inspection;
  try {
    inspection = VideoStorage.inspectStoredMp4(slug, asset.filePath, MAX_VIDEO_BYTES, context);
  } catch {
    throw new ExportBundleMaterializationError(
      "canonical video file could not be verified on disk",
    );
  }
  if (inspection.byteLength !== asset.byteLength) {
    throw new ExportBundleMaterializationError(
      "canonical video file byte length does not match its asset record",
    );
  }

  return {
    assetId,
    realPath: inspection.realPath,
    byteLength: inspection.byteLength,
    fileName: "video.mp4",
  };
}

function resolveCanonicalThumbnail(
  slug: string,
  thumbnail: ThumbnailData,
  assets: readonly Asset[],
  context: RuntimeStorageContext,
): ResolvedBinarySource {
  const assetId = thumbnail?.outputAssetId;
  if (typeof assetId !== "string" || !assetId) {
    throw new ExportBundleMaterializationError(
      "thumbnail.outputAssetId is missing; no canonical thumbnail asset",
    );
  }
  const candidates = assets.filter((asset) => asset.id === assetId);
  if (candidates.length !== 1) {
    throw new ExportBundleMaterializationError("canonical thumbnail asset record not found");
  }
  const asset = candidates[0];
  const mimeType = thumbnail.generation?.mimeType;
  if (
    asset.type !== "thumbnail" ||
    asset.status !== "generated" ||
    typeof asset.filePath !== "string" ||
    !mimeType
  ) {
    throw new ExportBundleMaterializationError(
      "canonical thumbnail asset record is invalid or not generated",
    );
  }

  let inspection;
  try {
    inspection = ThumbnailStorage.inspectStoredThumbnail(slug, asset.filePath, mimeType, context);
  } catch {
    throw new ExportBundleMaterializationError(
      "canonical thumbnail file could not be verified on disk",
    );
  }
  if (typeof asset.byteLength === "number" && inspection.byteLength !== asset.byteLength) {
    throw new ExportBundleMaterializationError(
      "canonical thumbnail file byte length does not match its asset record",
    );
  }

  return {
    assetId,
    realPath: inspection.realPath,
    byteLength: inspection.byteLength,
    fileName: `thumbnail${extensionForThumbnailMimeType(mimeType)}`,
  };
}

function extensionForThumbnailMimeType(mimeType: ThumbnailMimeType): string {
  switch (mimeType) {
    case "image/png":
      return ".png";
    case "image/jpeg":
      return ".jpg";
    case "image/webp":
      return ".webp";
    default:
      throw new ExportBundleMaterializationError("unsupported thumbnail mime type");
  }
}

function resolveChapterDurations(
  slug: string,
  audio: AudioData,
  assets: readonly Asset[],
  context: RuntimeStorageContext,
): Map<number, number> {
  const sections = audio?.sections;
  if (!Array.isArray(sections) || sections.length === 0) {
    throw new ExportBundleMaterializationError(
      "audio.sections is empty; no narration duration chain available",
    );
  }
  const durations = new Map<number, number>();
  for (const section of sections) {
    const chapterId = section?.chapterId;
    const assetId = section?.outputAssetId;
    if (!Number.isSafeInteger(chapterId) || chapterId <= 0) {
      throw new ExportBundleMaterializationError("audio section has an invalid chapterId");
    }
    if (typeof assetId !== "string" || !assetId) {
      throw new ExportBundleMaterializationError(
        `chapter ${chapterId} has no generated narration asset (outputAssetId missing)`,
      );
    }
    const candidates = assets.filter((asset) => asset.id === assetId);
    if (candidates.length !== 1) {
      throw new ExportBundleMaterializationError(
        `chapter ${chapterId} narration asset record not found`,
      );
    }
    const asset = candidates[0];
    if (
      asset.type !== "audio" ||
      asset.status !== "generated" ||
      asset.provider === "mock" ||
      typeof asset.filePath !== "string" ||
      !Number.isFinite(asset.durationSeconds) ||
      (asset.durationSeconds as number) <= 0
    ) {
      throw new ExportBundleMaterializationError(
        `chapter ${chapterId} has no real, generated narration duration`,
      );
    }
    let inspection;
    try {
      inspection = AudioStorage.inspectStoredWav(slug, asset.filePath, context);
    } catch {
      throw new ExportBundleMaterializationError(
        `chapter ${chapterId} narration audio file could not be verified on disk`,
      );
    }
    if (Math.abs(inspection.durationSeconds - (asset.durationSeconds as number)) > 1e-6) {
      throw new ExportBundleMaterializationError(
        `chapter ${chapterId} narration duration does not match its stored audio file`,
      );
    }
    durations.set(chapterId, inspection.durationSeconds);
  }
  return durations;
}

async function linkBinaryFile(input: {
  sourceRealPath: string;
  stagingDir: string;
  fileName: string;
  sourceAssetId: string;
  sourcePackage: string;
  expectedByteLength: number;
}): Promise<ExportBundleFileEntry> {
  const destination = path.join(input.stagingDir, input.fileName);
  try {
    fs.linkSync(input.sourceRealPath, destination);
  } catch (error) {
    if (isNodeErrnoException(error) && error.code === "EXDEV") {
      await copyFileAtomically(input.sourceRealPath, destination);
    } else {
      throw new ExportBundleMaterializationError(
        `could not materialize ${input.fileName}: ${
          error instanceof Error ? error.message : "unknown error"
        }`,
      );
    }
  }
  const stat = fs.statSync(destination);
  if (!stat.isFile() || stat.size !== input.expectedByteLength) {
    throw new ExportBundleMaterializationError(
      `${input.fileName} byte length mismatch after materialization`,
    );
  }
  return {
    fileName: input.fileName,
    sourceAssetId: input.sourceAssetId,
    sourcePackage: input.sourcePackage,
    byteLength: stat.size,
    sha256: sha256File(destination),
    status: "packaged",
  };
}

/**
 * Same-volume EXDEV fallback: streamed temp write + fsync + rename (never a
 * plain overwrite copy, never a whole-file readFileSync). fs.createReadStream
 * piped into fs.createWriteStream copies large video files in bounded chunks
 * rather than buffering the whole file into memory. The fsync step opens the
 * already-fully-written temp file with its own independent descriptor, kept
 * deliberately separate from the write stream's own lifecycle (a shared
 * FileHandle-backed write stream + a later handle.close() was found to hang
 * indefinitely - see Sprint 132 remediation notes).
 */
async function copyFileAtomically(sourceRealPath: string, destination: string): Promise<void> {
  const temp = `${destination}.${process.pid}.${randomUUID()}.tmp`;
  await pipeline(
    fs.createReadStream(sourceRealPath),
    fs.createWriteStream(temp, { flags: "wx", mode: 0o600 }),
  );
  const descriptor = fs.openSync(temp, "r+");
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  fs.renameSync(temp, destination);
}

function writeTextFile(
  stagingDir: string,
  fileName: string,
  content: string,
  sourcePackage: string,
): ExportBundleFileEntry {
  const destination = path.join(stagingDir, fileName);
  const temp = `${destination}.${process.pid}.${randomUUID()}.tmp`;
  const buffer = Buffer.from(content, "utf-8");
  const handle = fs.openSync(temp, "wx", 0o600);
  try {
    fs.writeFileSync(handle, buffer);
    fs.fsyncSync(handle);
  } finally {
    fs.closeSync(handle);
  }
  fs.renameSync(temp, destination);
  return {
    fileName,
    sourcePackage,
    byteLength: buffer.length,
    sha256: sha256Buffer(buffer),
    status: "packaged",
  };
}

function buildManifest(
  input: MaterializeExportBundleInput,
  files: ExportBundleFileEntry[],
): ExportBundleManifest {
  const withoutChecksum = {
    schemaVersion: "1" as const,
    projectId: input.projectId,
    slug: input.projectSlug,
    createdAt: new Date().toISOString(),
    files,
  };
  const checksum = sha256Buffer(Buffer.from(canonicalJson(withoutChecksum), "utf-8"));
  return { ...withoutChecksum, checksum };
}

function writeManifestFile(stagingDir: string, manifest: ExportBundleManifest): void {
  const destination = path.join(stagingDir, "export_manifest.json");
  const temp = `${destination}.${process.pid}.${randomUUID()}.tmp`;
  const buffer = Buffer.from(JSON.stringify(manifest, null, 2), "utf-8");
  const handle = fs.openSync(temp, "wx", 0o600);
  try {
    fs.writeFileSync(handle, buffer);
    fs.fsyncSync(handle);
  } finally {
    fs.closeSync(handle);
  }
  fs.renameSync(temp, destination);
}

function promoteStagedBundle(input: {
  exportDirAbsolute: string;
  bundleDirAbsolute: string;
  stagingAbsolute: string;
  manifest: ExportBundleManifest;
}): { manifest: ExportBundleManifest } {
  const existing = readVerifiedExistingBundleManifest(input.bundleDirAbsolute);
  if (existing && manifestsEquivalent(existing, input.manifest)) {
    // Idempotent re-export: canonical bundle is already byte-identical.
    try {
      fs.rmSync(input.stagingAbsolute, { recursive: true, force: true });
    } catch {
      // Best effort; the redundant staging copy is inert either way.
    }
    return { manifest: existing };
  }

  let supersededPath: string | undefined;
  if (fs.existsSync(input.bundleDirAbsolute)) {
    // Regeneration (or corruption recovery): supersede rather than clobber in place.
    supersededPath = path.join(input.exportDirAbsolute, `.superseded-${randomUUID()}`);
    fs.renameSync(input.bundleDirAbsolute, supersededPath);
  }

  try {
    fs.renameSync(input.stagingAbsolute, input.bundleDirAbsolute);
  } catch (promoteError) {
    // Compensating rollback: the previous canonical bundle was already moved
    // aside above. If promoting the new one fails, restore the previous
    // bundle to the canonical path rather than leaving the project without
    // any canonical bundle. The staging directory is left in place here -
    // the caller's existing top-level catch removes it, same as every other
    // materialization failure.
    if (supersededPath) {
      try {
        fs.renameSync(supersededPath, input.bundleDirAbsolute);
      } catch (rollbackError) {
        throw new ExportBundleMaterializationError(
          "bundle promotion failed and rollback of the previous canonical bundle also " +
            `failed (promotion: ${describeError(promoteError)}; rollback: ` +
            `${describeError(rollbackError)}); the previous bundle's contents remain at ` +
            `${supersededPath}`,
        );
      }
      throw new ExportBundleMaterializationError(
        `bundle promotion failed; the previous canonical bundle was restored: ` +
          describeError(promoteError),
      );
    }
    throw new ExportBundleMaterializationError(
      `bundle promotion failed: ${describeError(promoteError)}`,
    );
  }

  return { manifest: input.manifest };
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}

/**
 * Returns the existing canonical bundle's manifest only if every file it
 * references is still present on disk with a byte length and SHA-256 that
 * match the manifest exactly. A missing manifest, or any mismatch, is
 * corruption: the caller treats it identically to "no valid bundle yet" and
 * regenerates.
 */
function readVerifiedExistingBundleManifest(
  bundleDirAbsolute: string,
): ExportBundleManifest | null {
  const manifestPath = path.join(bundleDirAbsolute, "export_manifest.json");
  if (!fs.existsSync(manifestPath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as ExportBundleManifest;
    if (!isValidManifestShape(parsed)) return null;
    for (const file of parsed.files) {
      const filePath = path.join(bundleDirAbsolute, file.fileName);
      if (!fs.existsSync(filePath)) return null;
      const stat = fs.statSync(filePath);
      if (!stat.isFile() || stat.size !== file.byteLength) return null;
      if (sha256File(filePath) !== file.sha256) return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function isValidManifestShape(value: unknown): value is ExportBundleManifest {
  if (!value || typeof value !== "object") return false;
  const manifest = value as Partial<ExportBundleManifest>;
  return (
    manifest.schemaVersion === "1" &&
    Array.isArray(manifest.files) &&
    typeof manifest.checksum === "string" &&
    typeof manifest.createdAt === "string"
  );
}

function manifestsEquivalent(a: ExportBundleManifest, b: ExportBundleManifest): boolean {
  if (a.files.length !== b.files.length) return false;
  const byName = new Map(a.files.map((file) => [file.fileName, file]));
  return b.files.every((file) => {
    const match = byName.get(file.fileName);
    return Boolean(match) && match!.sha256 === file.sha256 && match!.byteLength === file.byteLength;
  });
}

function ensureBundleParentDir(slug: string, context: RuntimeStorageContext): string {
  const absolute = resolveRuntimeLogicalPathForWrite(getExportLogicalDir(slug), context);
  ensureSafeContainedDirectory(context.runtimeRoot, context.projectsRoot);
  ensureSafeContainedDirectory(context.projectsRoot, absolute);
  return requireContainedStorageDirectory(absolute, context);
}

function getExportLogicalDir(slug: string): string {
  return `data/projects/${slug}/export`;
}

function getExportBundleLogicalPath(slug: string): string {
  return `${getExportLogicalDir(slug)}/bundle`;
}

function requireSafeSlug(slug: string): string {
  if (typeof slug !== "string" || !/^[a-zA-Z0-9-_]+$/.test(slug)) {
    throw new ExportBundleMaterializationError("invalid project slug");
  }
  return slug;
}

function isNodeErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function sha256File(filePath: string): string {
  return sha256Buffer(fs.readFileSync(filePath));
}

function sha256Buffer(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    return `{${entries.map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJson(nested)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
