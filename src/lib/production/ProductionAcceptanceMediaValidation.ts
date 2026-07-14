import {
  SpawnRunner,
  type VideoAssemblyProcessRunner,
} from "@/lib/assembly/providers/FFmpegVideoAssemblyProvider";
import { getFFmpegVideoAssemblyConfig } from "@/lib/assembly/providers/VideoAssemblyProviderConfig";
import { VideoStorage } from "@/lib/assets/storage/VideoStorage";

export interface ProductionAcceptanceMediaResult {
  readonly durationSeconds: number;
  readonly width: number;
  readonly height: number;
  readonly videoCodec: "h264";
  readonly audioCodec: "aac";
  readonly container: "mp4";
}

export class ProductionAcceptanceMediaValidationError extends Error {
  readonly code = "PRODUCTION_ACCEPTANCE_MEDIA_INVALID";

  constructor() {
    super("Production acceptance media validation failed.");
    this.name = "ProductionAcceptanceMediaValidationError";
    this.stack = undefined;
  }
}

export async function validateProductionAcceptanceMedia(
  projectSlug: string,
  filePath: string,
  runner: VideoAssemblyProcessRunner = new SpawnRunner(),
): Promise<ProductionAcceptanceMediaResult> {
  try {
    const config = getFFmpegVideoAssemblyConfig();
    const stored = VideoStorage.inspectStoredMp4(projectSlug, filePath, config.maxOutputBytes);
    const result = await runner.run(config.ffprobePath, [
      "-v", "error",
      "-show_entries", "format=format_name,duration:stream=codec_type,codec_name,width,height",
      "-of", "json",
      stored.realPath,
    ], { timeoutMs: config.timeoutMs, maxOutputBytes: config.maxStdioBytes });
    if (result.exitCode !== 0 || result.failed || result.timedOut) throw new Error("invalid");
    const value = JSON.parse(result.stdout) as {
      format?: { format_name?: unknown; duration?: unknown };
      streams?: Array<{ codec_type?: unknown; codec_name?: unknown; width?: unknown; height?: unknown }>;
    };
    const durationSeconds = Number(value.format?.duration);
    const formats = typeof value.format?.format_name === "string" ? value.format.format_name.split(",") : [];
    const video = value.streams?.find((stream) => stream.codec_type === "video");
    const audio = value.streams?.find((stream) => stream.codec_type === "audio");
    if (
      (!formats.includes("mp4") && !formats.includes("mov")) ||
      !Number.isFinite(durationSeconds) || durationSeconds < 60 || durationSeconds > 120 ||
      video?.codec_name !== "h264" || video.width !== 1920 || video.height !== 1080 ||
      audio?.codec_name !== "aac"
    ) throw new Error("invalid");
    return { durationSeconds, width: 1920, height: 1080, videoCodec: "h264", audioCodec: "aac", container: "mp4" };
  } catch {
    throw new ProductionAcceptanceMediaValidationError();
  }
}
