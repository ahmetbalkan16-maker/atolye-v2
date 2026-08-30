import { createHash } from "node:crypto";
import fs from "node:fs";
import type { MediaRightsStatus } from "@/types/asset";
import type { ResearchMediaCandidate } from "@/types/research";
import type {
  ProcessRunResult,
  VideoAssemblyProcessRunner,
} from "@/lib/assembly/providers/FFmpegVideoAssemblyProvider";
import { VideoStorage } from "@/lib/assets/storage/VideoStorage";
import {
  getFFmpegSceneVideoConfig,
  type FFmpegSceneVideoConfig,
} from "@/lib/video/providers/VideoProviderConfig";
import type { VideoSceneGenerationSuccess } from "@/lib/video/providers/VideoProvider";
import type { RuntimeStorageContext } from "@/lib/runtime/RuntimeStoragePaths";
import {
  classifyMediaRightsStatus,
  isProductionAdmissibleRightsStatus,
} from "./MediaRightsPolicy";

/**
 * Documentary media effort — Faz 3 (ADR-020): safe, fail-closed ingestion of a
 * real archive/stock **video** candidate into a scene-video asset.
 *
 * Design constraints (see ADR-020):
 *  - Reuses the Faz 2 `ResearchMediaCandidate` model (now carrying optional
 *    `durationSeconds` / `segmentStartSeconds` / `segmentEndSeconds`) — no second
 *    candidate model, no second discovery path.
 *  - Every external dependency (`download`, the ffmpeg/ffprobe `runner`, the
 *    render config) is injected. This module NEVER opens an ambient network
 *    socket or spawns a binary by itself, so it is fully testable with a fixture
 *    downloader + a locally generated fixture clip.
 *  - Fail-closed at every step: an inadmissible licence, a missing/again
 *    non-HTTPS URL, a disallowed host, an oversized download, a non-video MIME,
 *    an unreadable/again-corrupt probe, an out-of-range segment, or an output
 *    that does not match the common scene-video contract all REJECT. Nothing
 *    ambiguous is ever accepted as a production asset.
 *  - The rendered segment normalises to the exact same `VideoSceneGenerationSuccess`
 *    shape `FFmpegSceneVideoProvider` produces, so the assembly layer never has
 *    to know whether a scene came from a real clip or a Ken Burns pan.
 *
 * This module is foundation only — it is not wired into the production pipeline
 * (that is Faz 6). `FFmpegSceneVideoProvider`, `VideoPipeline` and the assembly
 * flow are untouched.
 */

const RENDER_WIDTH = 1920;
const RENDER_HEIGHT = 1080;
const RENDER_FRAME_RATE = 30;

/**
 * All the magic numbers for video ingestion in one frozen place (ADR-020 rule:
 * no scattered constants). `allowedMediaHostSuffixes` starts with Wikimedia
 * upload infrastructure only; additional verified open-licence hosts require a
 * follow-up ADR entry, not a silent edit here.
 */
export const videoIngestionPolicy = Object.freeze({
  /** Shortest slice (or whole clip) we will render, in seconds. */
  minSegmentSeconds: 1,
  /** Longest slice we will render, in seconds — a documentary shot, not a film. */
  maxSegmentSeconds: 40,
  /** Hard cap on the downloaded source file, in bytes (192 MiB). */
  maxDownloadBytes: 192 * 1024 * 1024,
  /** ffprobe `format_name` must contain at least one of these container tokens. */
  allowedContainers: Object.freeze([
    "mp4",
    "mov",
    "m4v",
    "matroska",
    "webm",
  ]) as readonly string[],
  /** The source's video stream codec must be one of these. */
  allowedVideoCodecs: Object.freeze([
    "h264",
    "hevc",
    "vp9",
    "av1",
    "mpeg4",
    "mpeg2video",
  ]) as readonly string[],
  /** `mediaUrl` host must end with one of these (exact host or dotted suffix). */
  allowedMediaHostSuffixes: Object.freeze([
    "upload.wikimedia.org",
  ]) as readonly string[],
  /** Slack allowed when checking a requested segment end against the probed source duration. */
  sourceDurationToleranceSeconds: 0.75,
});

export type VideoIngestionRejectionReason =
  | "not-a-video-candidate"
  | "rights-not-admissible"
  | "missing-source-url"
  | "missing-media-url"
  | "media-url-not-https"
  | "media-host-not-allowed"
  | "invalid-segment"
  | "download-failed"
  | "download-too-large"
  | "mime-not-video"
  | "source-probe-failed"
  | "source-container-not-allowed"
  | "source-codec-not-allowed"
  | "source-duration-unreadable"
  | "segment-exceeds-source"
  | "segment-render-failed"
  | "output-probe-failed"
  | "storage-failed";

export interface VideoDownloadResult {
  readonly bytes: Buffer;
  /** The `Content-Type` header the source reported, when present. */
  readonly contentType?: string;
}

export interface VideoDownloader {
  /**
   * Fetch `url` and return its bytes. MUST abort and throw once more than
   * `maxBytes` have been received rather than buffering an unbounded response.
   * MUST NOT follow redirects to a different host silently.
   */
  download(url: string, options: { maxBytes: number }): Promise<VideoDownloadResult>;
}

export interface IngestVideoCandidateInput {
  readonly candidate: ResearchMediaCandidate;
  readonly projectSlug: string;
  readonly runtimeStorageContext: RuntimeStorageContext;
  /** Bind the rendered asset to a scene (affects on-disk naming only). */
  readonly sceneId?: number;
  readonly downloader: VideoDownloader;
  readonly runner: VideoAssemblyProcessRunner;
  /** ffmpeg/ffprobe paths + limits. Defaults to `getFFmpegSceneVideoConfig()`. */
  readonly loadConfig?: () => FFmpegSceneVideoConfig;
  readonly now?: () => string;
}

export interface IngestedVideoAsset {
  /** Deterministic identity: sha256 of `{sourceUrl, mediaUrl, segment}`. */
  readonly id: string;
  readonly provider: string;
  readonly mediaOrigin: "real";
  readonly mediaType: "video";
  readonly sourceName: string;
  readonly sourceUrl: string;
  readonly mediaUrl: string;
  readonly license?: string;
  readonly attribution?: string;
  readonly rightsStatus: MediaRightsStatus;
  /** sha256 (hex) of the downloaded source bytes — download-integrity + identity. */
  readonly checksum: string;
  /** Probed runtime of the whole source clip. */
  readonly sourceDurationSeconds: number;
  readonly segmentStartSeconds?: number;
  readonly segmentEndSeconds?: number;
  /** Probed runtime of the rendered (segment or full) MP4. */
  readonly durationSeconds: number;
  readonly filePath: string;
  readonly url: string;
  readonly mimeType: "video/mp4";
  readonly byteLength: number;
  readonly width: number;
  readonly height: number;
  readonly frameRate: number;
  readonly discoveredAt: string;
  readonly selectionReason: string;
}

export type VideoIngestionResult =
  | { readonly success: true; readonly asset: IngestedVideoAsset }
  | {
      readonly success: false;
      readonly reason: VideoIngestionRejectionReason;
      readonly detail: string;
    };

export interface ResolvedSegment {
  /** `null` = render the whole clip. */
  readonly range: { readonly start: number; readonly end: number } | null;
}

// --------------------------------------------------------------------------- pure validation

/**
 * All pre-download, fail-closed checks on the candidate itself. Pure; no I/O.
 */
export function validateVideoCandidateForIngestion(
  candidate: ResearchMediaCandidate,
):
  | { readonly ok: true; readonly mediaUrl: string; readonly sourceUrl: string }
  | { readonly ok: false; readonly reason: VideoIngestionRejectionReason; readonly detail: string } {
  if (!candidate || typeof candidate !== "object" || candidate.mediaType !== "video") {
    return fail("not-a-video-candidate", "Candidate mediaType is not \"video\".");
  }

  // Belt-and-suspenders: trust neither the stored `admissible` flag nor the
  // stored `rightsStatus` alone — reclassify the licence and require both.
  const rightsStatus = classifyMediaRightsStatus(candidate.license);
  if (
    candidate.admissible !== true ||
    !isProductionAdmissibleRightsStatus(rightsStatus) ||
    !isProductionAdmissibleRightsStatus(candidate.rightsStatus)
  ) {
    return fail(
      "rights-not-admissible",
      `Rights status "${rightsStatus}" is not production-admissible.`,
    );
  }

  const sourceUrl = normalizeHttpsUrl(candidate.sourceUrl, true);
  if (!sourceUrl) {
    return fail("missing-source-url", "Candidate has no usable https/http source page URL.");
  }

  const mediaUrl = normalizeHttpsUrl(candidate.mediaUrl, false);
  if (!candidate.mediaUrl || !mediaUrl) {
    return candidate.mediaUrl && !mediaUrl
      ? fail("media-url-not-https", "Candidate mediaUrl is not an https URL.")
      : fail("missing-media-url", "Candidate has no direct media file URL.");
  }

  if (!isAllowedMediaHost(mediaUrl)) {
    return fail(
      "media-host-not-allowed",
      `Media host "${new URL(mediaUrl).host}" is not in the allow-list.`,
    );
  }

  return { ok: true, mediaUrl, sourceUrl };
}

/**
 * Resolve + validate the requested segment against policy and (when known) the
 * probed source duration. Pure. Both segment bounds must be set together.
 */
export function validateSegment(
  candidate: Pick<ResearchMediaCandidate, "segmentStartSeconds" | "segmentEndSeconds">,
  sourceDurationSeconds?: number,
):
  | { readonly ok: true; readonly segment: ResolvedSegment }
  | { readonly ok: false; readonly reason: VideoIngestionRejectionReason; readonly detail: string } {
  const hasStart = typeof candidate.segmentStartSeconds === "number";
  const hasEnd = typeof candidate.segmentEndSeconds === "number";

  if (!hasStart && !hasEnd) {
    if (typeof sourceDurationSeconds === "number") {
      const withinPolicy =
        sourceDurationSeconds >= videoIngestionPolicy.minSegmentSeconds &&
        sourceDurationSeconds <= videoIngestionPolicy.maxSegmentSeconds;
      if (!withinPolicy) {
        return fail(
          "invalid-segment",
          `Whole clip is ${sourceDurationSeconds}s — outside the ` +
            `[${videoIngestionPolicy.minSegmentSeconds}, ${videoIngestionPolicy.maxSegmentSeconds}]s policy; ` +
            "an explicit segment is required.",
        );
      }
    }
    return { ok: true, segment: { range: null } };
  }

  if (hasStart !== hasEnd) {
    return fail("invalid-segment", "segmentStartSeconds and segmentEndSeconds must be set together.");
  }

  const start = candidate.segmentStartSeconds as number;
  const end = candidate.segmentEndSeconds as number;

  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < 0 ||
    end <= start
  ) {
    return fail("invalid-segment", `Segment [${start}, ${end}) is not a valid forward range.`);
  }

  const length = end - start;
  if (
    length < videoIngestionPolicy.minSegmentSeconds ||
    length > videoIngestionPolicy.maxSegmentSeconds
  ) {
    return fail(
      "invalid-segment",
      `Segment length ${length}s is outside the ` +
        `[${videoIngestionPolicy.minSegmentSeconds}, ${videoIngestionPolicy.maxSegmentSeconds}]s policy.`,
    );
  }

  if (
    typeof sourceDurationSeconds === "number" &&
    end > sourceDurationSeconds + videoIngestionPolicy.sourceDurationToleranceSeconds
  ) {
    return fail(
      "segment-exceeds-source",
      `Segment end ${end}s exceeds the probed source duration ${sourceDurationSeconds}s.`,
    );
  }

  return { ok: true, segment: { range: { start, end } } };
}

/**
 * Deterministic asset identity — the same candidate (same source URL, media URL
 * and segment) always maps to the same id, regardless of ffmpeg version or run
 * order.
 */
export function deriveVideoAssetIdentity(
  candidate: Pick<
    ResearchMediaCandidate,
    "sourceUrl" | "mediaUrl" | "segmentStartSeconds" | "segmentEndSeconds"
  >,
): string {
  const canonical = JSON.stringify({
    sourceUrl: candidate.sourceUrl ?? null,
    mediaUrl: candidate.mediaUrl ?? null,
    segmentStartSeconds:
      typeof candidate.segmentStartSeconds === "number" ? candidate.segmentStartSeconds : null,
    segmentEndSeconds:
      typeof candidate.segmentEndSeconds === "number" ? candidate.segmentEndSeconds : null,
  });
  return `real-video:${createHash("sha256").update(canonical).digest("hex").slice(0, 40)}`;
}

// --------------------------------------------------------------------------- ingestion

export async function ingestVideoCandidate(
  input: IngestVideoCandidateInput,
): Promise<VideoIngestionResult> {
  const now = input.now ?? (() => new Date().toISOString());
  const preflight = validateVideoCandidateForIngestion(input.candidate);
  if (!preflight.ok) {
    return { success: false, reason: preflight.reason, detail: preflight.detail };
  }

  // Segment shape check that does not need the source duration yet.
  const shape = validateSegment(input.candidate);
  if (!shape.ok) {
    return { success: false, reason: shape.reason, detail: shape.detail };
  }

  let config: FFmpegSceneVideoConfig;
  try {
    config = (input.loadConfig ?? getFFmpegSceneVideoConfig)();
    assertExecutable(config.ffmpegPath);
    assertExecutable(config.ffprobePath);
  } catch (error) {
    return { success: false, reason: "storage-failed", detail: safeMessage(error) };
  }

  // Download (bounded).
  let download: VideoDownloadResult;
  try {
    download = await input.downloader.download(preflight.mediaUrl, {
      maxBytes: videoIngestionPolicy.maxDownloadBytes,
    });
  } catch (error) {
    return { success: false, reason: "download-failed", detail: safeMessage(error) };
  }
  if (!download || !Buffer.isBuffer(download.bytes) || download.bytes.length === 0) {
    return { success: false, reason: "download-failed", detail: "Downloader returned no bytes." };
  }
  if (download.bytes.length > videoIngestionPolicy.maxDownloadBytes) {
    return {
      success: false,
      reason: "download-too-large",
      detail: `Downloaded ${download.bytes.length} bytes exceeds the ${videoIngestionPolicy.maxDownloadBytes} cap.`,
    };
  }
  if (
    typeof download.contentType === "string" &&
    download.contentType.trim() !== "" &&
    !/^video\//i.test(download.contentType.trim())
  ) {
    return {
      success: false,
      reason: "mime-not-video",
      detail: `Source reported Content-Type "${download.contentType}".`,
    };
  }

  const checksum = createHash("sha256").update(download.bytes).digest("hex");

  // Reserve storage paths and stage the raw download beside them.
  let renderPaths: ReturnType<typeof VideoStorage.createRenderPaths>;
  try {
    renderPaths =
      typeof input.sceneId === "number"
        ? VideoStorage.createSceneRenderPaths(input.projectSlug, input.sceneId, input.runtimeStorageContext)
        : VideoStorage.createRenderPaths(input.projectSlug, input.runtimeStorageContext);
  } catch (error) {
    return { success: false, reason: "storage-failed", detail: safeMessage(error) };
  }
  const rawPath = renderPaths.temporaryAbsolutePath.replace(/\.partial\.mp4$/i, ".source.partial.mp4");
  const cleanup = () => {
    VideoStorage.removeIfExists(rawPath, input.runtimeStorageContext);
    VideoStorage.removeIfExists(renderPaths.temporaryAbsolutePath, input.runtimeStorageContext);
    VideoStorage.removeIfExists(renderPaths.absolutePath, input.runtimeStorageContext);
  };

  try {
    fs.writeFileSync(rawPath, download.bytes);

    // Probe the raw source: real container + video codec + readable duration.
    const sourceProbe = await input.runner.run(
      config.ffprobePath,
      buildSourceProbeArgs(rawPath),
      { timeoutMs: config.timeoutMs, maxOutputBytes: config.maxStdioBytes },
    );
    if (!processSucceeded(sourceProbe)) {
      cleanup();
      return { success: false, reason: "source-probe-failed", detail: "ffprobe did not exit cleanly." };
    }
    const source = parseSourceProbe(sourceProbe.stdout);
    if (!source.ok) {
      cleanup();
      return { success: false, reason: source.reason, detail: source.detail };
    }

    // Re-validate the segment now that the true source duration is known.
    const resolved = validateSegment(input.candidate, source.durationSeconds);
    if (!resolved.ok) {
      cleanup();
      return { success: false, reason: resolved.reason, detail: resolved.detail };
    }

    // Render the segment (or the whole clip) to the common scene-video shape.
    const render = await input.runner.run(
      config.ffmpegPath,
      buildSegmentRenderArgs(rawPath, renderPaths.temporaryAbsolutePath, resolved.segment),
      { timeoutMs: config.timeoutMs, maxOutputBytes: config.maxStdioBytes },
    );
    if (!processSucceeded(render)) {
      cleanup();
      return { success: false, reason: "segment-render-failed", detail: "ffmpeg did not exit cleanly." };
    }

    const expectedDuration = resolved.segment.range
      ? resolved.segment.range.end - resolved.segment.range.start
      : source.durationSeconds;

    let temporaryInspection: { byteLength: number };
    try {
      temporaryInspection = VideoStorage.inspectMp4(
        renderPaths.temporaryAbsolutePath,
        config.maxOutputBytes,
      );
    } catch (error) {
      cleanup();
      return { success: false, reason: "output-probe-failed", detail: safeMessage(error) };
    }

    const outputProbe = await input.runner.run(
      config.ffprobePath,
      buildOutputProbeArgs(renderPaths.temporaryAbsolutePath),
      { timeoutMs: config.timeoutMs, maxOutputBytes: config.maxStdioBytes },
    );
    if (!processSucceeded(outputProbe)) {
      cleanup();
      return { success: false, reason: "output-probe-failed", detail: "Output ffprobe did not exit cleanly." };
    }
    const output = validateOutputProbe(outputProbe.stdout, expectedDuration);
    if (!output.ok) {
      cleanup();
      return { success: false, reason: "output-probe-failed", detail: output.detail };
    }

    // Commit.
    try {
      VideoStorage.finalize(
        renderPaths.temporaryAbsolutePath,
        renderPaths.absolutePath,
        input.runtimeStorageContext,
      );
    } catch (error) {
      cleanup();
      return { success: false, reason: "storage-failed", detail: safeMessage(error) };
    }
    const stored = VideoStorage.inspectStoredMp4(
      input.projectSlug,
      renderPaths.filePath,
      config.maxOutputBytes,
      input.runtimeStorageContext,
    );
    if (stored.byteLength !== temporaryInspection.byteLength) {
      cleanup();
      return { success: false, reason: "storage-failed", detail: "Stored byte length changed on finalize." };
    }

    VideoStorage.removeIfExists(rawPath, input.runtimeStorageContext);

    const discoveredAt = now();
    const asset: IngestedVideoAsset = {
      id: deriveVideoAssetIdentity(input.candidate),
      provider: normalizeText(input.candidate.provider, 80) ?? "unknown",
      mediaOrigin: "real",
      mediaType: "video",
      sourceName: normalizeText(input.candidate.provider, 80) ?? "unknown",
      sourceUrl: preflight.sourceUrl,
      mediaUrl: preflight.mediaUrl,
      license: normalizeText(input.candidate.license, 200),
      attribution: normalizeText(input.candidate.attribution, 300),
      rightsStatus: classifyMediaRightsStatus(input.candidate.license),
      checksum,
      sourceDurationSeconds: source.durationSeconds,
      segmentStartSeconds: resolved.segment.range?.start,
      segmentEndSeconds: resolved.segment.range?.end,
      durationSeconds: output.durationSeconds,
      filePath: renderPaths.filePath,
      url: renderPaths.url,
      mimeType: "video/mp4",
      byteLength: stored.byteLength,
      width: RENDER_WIDTH,
      height: RENDER_HEIGHT,
      frameRate: RENDER_FRAME_RATE,
      discoveredAt,
      selectionReason: "archive-video-match",
    };
    return { success: true, asset };
  } catch (error) {
    cleanup();
    return { success: false, reason: "segment-render-failed", detail: safeMessage(error) };
  }
}

/**
 * Normalise an ingested clip to the exact `VideoSceneGenerationSuccess` shape
 * `FFmpegSceneVideoProvider` emits, so the assembly layer treats a real clip and
 * a Ken Burns pan identically.
 */
export function ingestedVideoToSceneVideoSuccess(
  asset: IngestedVideoAsset,
  scene: {
    readonly sceneId: number;
    readonly sourceImageAssetId?: string;
    readonly animationAssetId?: string;
    readonly transition?: string;
  },
): VideoSceneGenerationSuccess {
  return {
    sceneId: scene.sceneId,
    sourceImageAssetId: scene.sourceImageAssetId ?? asset.id,
    animationAssetId: scene.animationAssetId ?? asset.id,
    provider: "video-media-ingestion",
    model: "ffmpeg-real-video-segment",
    generationMode: "production",
    filePath: asset.filePath,
    url: asset.url,
    mimeType: "video/mp4",
    byteLength: asset.byteLength,
    durationSeconds: asset.durationSeconds,
    width: asset.width,
    height: asset.height,
    frameRate: asset.frameRate,
    transition: scene.transition ?? "none",
    status: "generated",
    createdAt: asset.discoveredAt,
  };
}

/**
 * Real HTTPS downloader — used only by the production wiring (Faz 6), never by
 * tests. `redirect: "error"` refuses a cross-host bounce; the body is read in
 * bounded chunks and aborted the moment it exceeds `maxBytes`.
 */
export function createHttpsVideoDownloader(fetcher: typeof fetch = fetch): VideoDownloader {
  return {
    async download(url, options) {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:") {
        throw new Error("Video download requires https.");
      }
      const response = await fetcher(url, { redirect: "error", signal: AbortSignal.timeout(120_000) });
      if (!response.ok || !response.body) {
        throw new Error(`Video download failed with status ${response.status}.`);
      }
      const contentType = response.headers.get("content-type") ?? undefined;
      const reader = response.body.getReader();
      const chunks: Buffer[] = [];
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          total += value.byteLength;
          if (total > options.maxBytes) {
            await reader.cancel();
            throw new Error("Video download exceeded the byte cap.");
          }
          chunks.push(Buffer.from(value));
        }
      }
      return { bytes: Buffer.concat(chunks), contentType };
    },
  };
}

// --------------------------------------------------------------------------- internals

function fail(
  reason: VideoIngestionRejectionReason,
  detail: string,
): { readonly ok: false; readonly reason: VideoIngestionRejectionReason; readonly detail: string } {
  return { ok: false, reason, detail };
}

function normalizeHttpsUrl(value: unknown, allowHttp: boolean): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol === "https:") return parsed.toString();
    if (allowHttp && parsed.protocol === "http:") return parsed.toString();
    return null;
  } catch {
    return null;
  }
}

function isAllowedMediaHost(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).host.toLowerCase();
  } catch {
    return false;
  }
  return videoIngestionPolicy.allowedMediaHostSuffixes.some(
    (suffix) => host === suffix || host.endsWith(`.${suffix}`),
  );
}

function buildSourceProbeArgs(filePath: string): string[] {
  return [
    "-v",
    "error",
    "-show_entries",
    "format=format_name,duration:stream=codec_type,codec_name",
    "-of",
    "json",
    filePath,
  ];
}

function buildOutputProbeArgs(filePath: string): string[] {
  return [
    "-v",
    "error",
    "-show_entries",
    "format=format_name,duration:stream=codec_type,codec_name,width,height,pix_fmt,avg_frame_rate",
    "-of",
    "json",
    filePath,
  ];
}

function buildSegmentRenderArgs(
  sourcePath: string,
  outputPath: string,
  segment: ResolvedSegment,
): string[] {
  const filter =
    `[0:v]scale=${RENDER_WIDTH}:${RENDER_HEIGHT}:force_original_aspect_ratio=decrease:force_divisible_by=2,` +
    `pad=${RENDER_WIDTH}:${RENDER_HEIGHT}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${RENDER_FRAME_RATE},` +
    `format=yuv420p[scene]`;
  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-nostdin",
    "-n",
    ...(segment.range ? ["-ss", segment.range.start.toFixed(6)] : []),
    "-i",
    sourcePath,
    ...(segment.range ? ["-t", (segment.range.end - segment.range.start).toFixed(6)] : []),
    "-filter_complex",
    filter,
    "-map",
    "[scene]",
    "-an",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "23",
    "-pix_fmt",
    "yuv420p",
    "-r",
    String(RENDER_FRAME_RATE),
    "-movflags",
    "+faststart",
    outputPath,
  ];
}

function parseSourceProbe(
  raw: string,
):
  | { readonly ok: true; readonly durationSeconds: number }
  | { readonly ok: false; readonly reason: VideoIngestionRejectionReason; readonly detail: string } {
  let parsed: {
    format?: { format_name?: unknown; duration?: unknown };
    streams?: Array<Record<string, unknown>>;
  };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fail("source-probe-failed", "ffprobe output was not JSON.");
  }
  const formatName = typeof parsed.format?.format_name === "string" ? parsed.format.format_name : "";
  const containerTokens = formatName.toLowerCase().split(",").map((token) => token.trim());
  if (!containerTokens.some((token) => videoIngestionPolicy.allowedContainers.includes(token))) {
    return fail("source-container-not-allowed", `Source container "${formatName}" is not allowed.`);
  }

  const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
  const videoStreams = streams.filter((stream) => stream.codec_type === "video");
  if (videoStreams.length === 0) {
    return fail("source-codec-not-allowed", "Source has no video stream.");
  }
  const codec = typeof videoStreams[0].codec_name === "string" ? videoStreams[0].codec_name : "";
  if (!videoIngestionPolicy.allowedVideoCodecs.includes(codec.toLowerCase())) {
    return fail("source-codec-not-allowed", `Source video codec "${codec}" is not allowed.`);
  }

  const duration = Number(parsed.format?.duration);
  if (!Number.isFinite(duration) || duration <= 0) {
    return fail("source-duration-unreadable", "Source duration is not a positive finite number.");
  }
  return { ok: true, durationSeconds: duration };
}

function validateOutputProbe(
  raw: string,
  expectedDuration: number,
):
  | { readonly ok: true; readonly durationSeconds: number }
  | { readonly ok: false; readonly detail: string } {
  let parsed: {
    format?: { format_name?: unknown; duration?: unknown };
    streams?: Array<Record<string, unknown>>;
  };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, detail: "Output ffprobe output was not JSON." };
  }
  const formatName = typeof parsed.format?.format_name === "string" ? parsed.format.format_name : "";
  const duration = Number(parsed.format?.duration);
  const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
  const videos = streams.filter((stream) => stream.codec_type === "video");
  const audios = streams.filter((stream) => stream.codec_type === "audio");
  const tolerance = Math.max(0.5, expectedDuration * 0.03);

  if (!formatName.split(",").includes("mp4")) {
    return { ok: false, detail: `Output container "${formatName}" is not mp4.` };
  }
  if (!Number.isFinite(duration) || duration <= 0 || Math.abs(duration - expectedDuration) > tolerance) {
    return {
      ok: false,
      detail: `Output duration ${duration}s is not within ${tolerance}s of the expected ${expectedDuration}s.`,
    };
  }
  if (
    videos.length !== 1 ||
    audios.length !== 0 ||
    videos[0].codec_name !== "h264" ||
    videos[0].width !== RENDER_WIDTH ||
    videos[0].height !== RENDER_HEIGHT ||
    videos[0].pix_fmt !== "yuv420p" ||
    videos[0].avg_frame_rate !== `${RENDER_FRAME_RATE}/1`
  ) {
    return { ok: false, detail: "Output stream shape does not match the scene-video contract." };
  }
  return { ok: true, durationSeconds: duration };
}

function processSucceeded(result: ProcessRunResult): boolean {
  return (
    !!result &&
    result.exitCode === 0 &&
    result.signal === null &&
    result.timedOut === false &&
    result.failed !== true
  );
}

function assertExecutable(executable: string): void {
  const stat = fs.statSync(executable);
  if (!stat.isFile()) throw new Error("Configured ffmpeg/ffprobe path is not a file.");
  fs.accessSync(executable, fs.constants.X_OK);
}

function normalizeText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= maxLength ? trimmed : undefined;
}

function safeMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/[\r\n]+/g, " ").slice(0, 200);
}
