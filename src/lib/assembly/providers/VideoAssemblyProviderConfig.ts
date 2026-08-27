import path from "node:path";
import type { VideoAssemblyProviderName } from "@/types/videoAssembly";

export const VIDEO_ASSEMBLY_CONFIGURATION_ERROR =
  "Video assembly configuration is invalid.";

export class VideoAssemblyConfigurationError extends Error {
  readonly code = "VIDEO_ASSEMBLY_CONFIGURATION_INVALID";

  constructor() {
    super(VIDEO_ASSEMBLY_CONFIGURATION_ERROR);
    this.name = "VideoAssemblyConfigurationError";
    this.stack = undefined;
  }
}

export interface FFmpegVideoAssemblyConfig {
  ffmpegPath: string;
  ffprobePath: string;
  timeoutMs: number;
  maxOutputBytes: number;
  maxStdioBytes: number;
}

const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;
const DEFAULT_MAX_OUTPUT_BYTES = 4 * 1024 * 1024 * 1024;
const DEFAULT_MAX_STDIO_BYTES = 1024 * 1024;

export function resolveVideoAssemblyProviderName(
  value: string | undefined = process.env.VIDEO_ASSEMBLY_PROVIDER,
): VideoAssemblyProviderName {
  const normalized = value?.trim().toLowerCase();

  if (!normalized) {
    return "mock";
  }

  if (normalized === "mock" || normalized === "ffmpeg") {
    return normalized;
  }

  throw new VideoAssemblyConfigurationError();
}

export function getFFmpegVideoAssemblyConfig(): FFmpegVideoAssemblyConfig {
  // FFMPEG_EXECUTABLE / FFPROBE_EXECUTABLE are an optional, per-machine override
  // for FFMPEG_PATH / FFPROBE_PATH: the same repo `.env.local` can carry a shared
  // FFMPEG_PATH default plus a machine-specific *_EXECUTABLE that wins when set.
  // When *_EXECUTABLE is unset the behaviour is byte-for-byte the old FFMPEG_PATH
  // resolution. (FFMPEG_EXECUTABLE was already a first-class component name in
  // ProductionAcceptanceConfigurationFingerprint since Sprint 129.23; this wires
  // it into the runtime path resolution the live pipeline actually uses.)
  const ffmpegPath = requireExecutablePath(
    process.env.FFMPEG_EXECUTABLE?.trim() || process.env.FFMPEG_PATH,
  );
  const ffprobePath = requireExecutablePath(
    process.env.FFPROBE_EXECUTABLE?.trim() || process.env.FFPROBE_PATH,
  );

  if (comparablePath(ffmpegPath) === comparablePath(ffprobePath)) {
    throw new VideoAssemblyConfigurationError();
  }

  return {
    ffmpegPath,
    ffprobePath,
    timeoutMs: integerValue(
      process.env.FFMPEG_TIMEOUT_MS,
      DEFAULT_TIMEOUT_MS,
      1_000,
      60 * 60 * 1000,
    ),
    maxOutputBytes: integerValue(
      process.env.VIDEO_ASSEMBLY_MAX_OUTPUT_BYTES,
      DEFAULT_MAX_OUTPUT_BYTES,
      1_024,
      8 * 1024 * 1024 * 1024,
    ),
    maxStdioBytes: integerValue(
      process.env.FFMPEG_MAX_STDIO_BYTES,
      DEFAULT_MAX_STDIO_BYTES,
      1_024,
      16 * 1024 * 1024,
    ),
  };
}

function comparablePath(value: string) {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function requireExecutablePath(value: string | undefined) {
  const normalized = value?.trim();

  if (
    !normalized ||
    !path.isAbsolute(normalized) ||
    /[\0\r\n]/.test(normalized)
  ) {
    throw new VideoAssemblyConfigurationError();
  }

  return path.normalize(normalized);
}

function integerValue(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  if (value === undefined) {
    return fallback;
  }

  const normalized = value.trim();

  if (!/^[0-9]+$/.test(normalized)) {
    throw new VideoAssemblyConfigurationError();
  }

  const parsed = Number(normalized);

  if (
    !Number.isSafeInteger(parsed) ||
    parsed < minimum ||
    parsed > maximum
  ) {
    throw new VideoAssemblyConfigurationError();
  }

  return parsed;
}
