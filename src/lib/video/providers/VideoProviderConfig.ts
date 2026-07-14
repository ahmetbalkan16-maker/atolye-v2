import path from "node:path";
import type { VideoProviderName } from "@/types/video";

export const VIDEO_PROVIDER_CONFIGURATION_ERROR =
  "Video provider configuration is invalid.";

export class VideoProviderConfigurationError extends Error {
  readonly code = "VIDEO_PROVIDER_CONFIGURATION_INVALID";

  constructor() {
    super(VIDEO_PROVIDER_CONFIGURATION_ERROR);
    this.name = "VideoProviderConfigurationError";
    this.stack = undefined;
  }
}

export interface FFmpegSceneVideoConfig {
  ffmpegPath: string;
  ffprobePath: string;
  timeoutMs: number;
  maxOutputBytes: number;
  maxStdioBytes: number;
}

export function resolveVideoProviderName(
  value: string | undefined = process.env.VIDEO_PROVIDER,
): VideoProviderName {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return "mock";
  if (normalized === "mock" || normalized === "ffmpeg") return normalized;
  throw new VideoProviderConfigurationError();
}

export function getFFmpegSceneVideoConfig(): FFmpegSceneVideoConfig {
  const ffmpegPath = requireExecutablePath(process.env.FFMPEG_PATH);
  const ffprobePath = requireExecutablePath(process.env.FFPROBE_PATH);
  if (comparablePath(ffmpegPath) === comparablePath(ffprobePath)) {
    throw new VideoProviderConfigurationError();
  }
  return {
    ffmpegPath,
    ffprobePath,
    timeoutMs: integerValue(process.env.FFMPEG_TIMEOUT_MS, 15 * 60 * 1000, 1_000, 60 * 60 * 1000),
    maxOutputBytes: integerValue(process.env.SCENE_VIDEO_MAX_OUTPUT_BYTES, 2 * 1024 * 1024 * 1024, 1_024, 8 * 1024 * 1024 * 1024),
    maxStdioBytes: integerValue(process.env.FFMPEG_MAX_STDIO_BYTES, 1024 * 1024, 1_024, 16 * 1024 * 1024),
  };
}

function requireExecutablePath(value: string | undefined) {
  const normalized = value?.trim();
  if (!normalized || !path.isAbsolute(normalized) || /[\0\r\n]/.test(normalized)) {
    throw new VideoProviderConfigurationError();
  }
  return path.normalize(normalized);
}

function comparablePath(value: string) {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function integerValue(value: string | undefined, fallback: number, minimum: number, maximum: number) {
  if (value === undefined) return fallback;
  const normalized = value.trim();
  if (!/^[0-9]+$/.test(normalized)) throw new VideoProviderConfigurationError();
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new VideoProviderConfigurationError();
  }
  return parsed;
}
