import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import type { Readable } from "node:stream";
import { AudioStorage } from "@/lib/assets/storage/AudioStorage";
import { ImageStorage } from "@/lib/assets/storage/ImageStorage";
import { VideoStorage } from "@/lib/assets/storage/VideoStorage";
import type {
  VideoAssemblyInput,
  VideoAssemblyResult,
} from "@/types/videoAssembly";
import type { VideoAssemblyProvider } from "./VideoAssemblyProvider";
import { getFFmpegVideoAssemblyConfig } from "./VideoAssemblyProviderConfig";

const SAFE_ERROR = "Video assembly failed.";
const WIDTH = 1920;
const HEIGHT = 1080;
const FPS = 30;

interface SceneVideoProbeSignature {
  profile: string;
  level: number;
  codecTag: string;
  timeBase: string;
  fieldOrder: string;
  extradata: string;
}

export interface ProcessRunOptions {
  timeoutMs: number;
  maxOutputBytes: number;
}

export interface ProcessRunResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  timedOut: boolean;
  failed?: boolean;
}

export interface VideoAssemblyProcessRunner {
  run(
    executable: string,
    args: readonly string[],
    options: ProcessRunOptions,
  ): Promise<ProcessRunResult>;
}

export interface VideoAssemblyChildProcess {
  stdout: Readable | null;
  stderr: Readable | null;
  on(event: "error", listener: () => void): this;
  once(event: "error", listener: () => void): this;
  once(
    event: "close",
    listener: (exitCode: number | null, signal: NodeJS.Signals | null) => void,
  ): this;
  off(event: "error", listener: () => void): this;
  off(
    event: "close",
    listener: (exitCode: number | null, signal: NodeJS.Signals | null) => void,
  ): this;
  kill(signal: NodeJS.Signals): boolean;
  unref(): void;
}

export type VideoAssemblySpawn = (
  executable: string,
  args: readonly string[],
  options: {
    shell: false;
    windowsHide: true;
    stdio: ["ignore", "pipe", "pipe"];
  },
) => VideoAssemblyChildProcess;

export class FFmpegVideoAssemblyProvider implements VideoAssemblyProvider {
  readonly name = "ffmpeg";

  constructor(private readonly runner: VideoAssemblyProcessRunner = new SpawnRunner()) {}

  async assemble(input: VideoAssemblyInput): Promise<VideoAssemblyResult> {
    const createdAt = new Date().toISOString();
    let paths: ReturnType<typeof VideoStorage.createRenderPaths> | null = null;
    let concatManifestPath: string | null = null;

    try {
      validateInput(input);
      const config = getFFmpegVideoAssemblyConfig();
      validateExecutable(config.ffmpegPath);
      validateExecutable(config.ffprobePath);
      const sceneProbeSignatures: SceneVideoProbeSignature[] = [];
      if (input.scenes[0].inputType === "scene-video") {
        for (const scene of input.scenes) {
          if (scene.inputType !== "scene-video") throw new Error(SAFE_ERROR);
          const sceneProbe = await this.runner.run(
            config.ffprobePath,
            buildSceneInputProbeArgs(absoluteInput(scene.filePath)),
            { timeoutMs: config.timeoutMs, maxOutputBytes: config.maxStdioBytes },
          );
          requireSuccessfulProcess(sceneProbe);
          sceneProbeSignatures.push(
            validateSceneInputProbe(sceneProbe.stdout, scene.durationSeconds),
          );
        }
      }
      paths = VideoStorage.createRenderPaths(input.projectSlug);
      if (canCopySceneVideos(input, sceneProbeSignatures)) {
        concatManifestPath = `${paths.temporaryAbsolutePath}.concat.txt`;
        fs.writeFileSync(
          concatManifestPath,
          buildConcatManifest(input),
          { encoding: "utf8", flag: "wx" },
        );
      }
      const ffmpegResult = await this.runner.run(
        config.ffmpegPath,
        buildFFmpegArgs(input, paths.temporaryAbsolutePath, concatManifestPath),
        { timeoutMs: config.timeoutMs, maxOutputBytes: config.maxStdioBytes },
      );

      requireSuccessfulProcess(ffmpegResult);
      const structural = VideoStorage.inspectMp4(
        paths.temporaryAbsolutePath,
        config.maxOutputBytes,
      );
      VideoStorage.finalize(paths.temporaryAbsolutePath, paths.absolutePath);
      const finalInspection = VideoStorage.inspectMp4(
        paths.absolutePath,
        config.maxOutputBytes,
      );

      if (finalInspection.byteLength !== structural.byteLength) {
        throw new Error(SAFE_ERROR);
      }
      const probeResult = await this.runner.run(
        config.ffprobePath,
        buildFFprobeArgs(paths.absolutePath),
        { timeoutMs: config.timeoutMs, maxOutputBytes: config.maxStdioBytes },
      );
      requireSuccessfulProcess(probeResult);
      const durationSeconds = validateProbe(
        probeResult.stdout,
        expectedOutputDuration(input),
      );
      if (concatManifestPath) {
        VideoStorage.removeIfExists(concatManifestPath);
        concatManifestPath = null;
      }

      return {
        success: true,
        provider: "ffmpeg",
        status: "rendered",
        model: "ffmpeg-h264-aac",
        filePath: paths.filePath,
        url: paths.url,
        mimeType: "video/mp4",
        byteLength: finalInspection.byteLength,
        durationSeconds,
        width: WIDTH,
        height: HEIGHT,
        videoCodec: "h264",
        audioCodec: "aac",
        createdAt,
      };
    } catch {
      if (concatManifestPath) VideoStorage.removeIfExists(concatManifestPath);
      if (paths) {
        VideoStorage.removeIfExists(paths.temporaryAbsolutePath);
        VideoStorage.removeIfExists(paths.absolutePath);
      }
      return {
        success: false,
        provider: "ffmpeg",
        createdAt,
        error: SAFE_ERROR,
      };
    }
  }
}

export class SpawnRunner implements VideoAssemblyProcessRunner {
  constructor(
    private readonly spawnProcess: VideoAssemblySpawn = (executable, args, options) =>
      spawn(executable, [...args], options) as VideoAssemblyChildProcess,
    private readonly terminationGraceMs = 1_000,
  ) {}

  run(
    executable: string,
    args: readonly string[],
    options: ProcessRunOptions,
  ): Promise<ProcessRunResult> {
    return new Promise((resolve, reject) => {
      let child: VideoAssemblyChildProcess;

      try {
        child = this.spawnProcess(executable, args, {
          shell: false,
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch {
        reject(new Error(SAFE_ERROR));
        return;
      }

      const stdout: Buffer[] = [];
      let outputBytes = 0;
      let timedOut = false;
      let settled = false;
      let terminating = false;
      let retryKillTimer: ReturnType<typeof setTimeout> | undefined;
      let forceSettleTimer: ReturnType<typeof setTimeout> | undefined;
      const swallowLateError = () => {};
      const safeKill = () => {
        try {
          child.kill("SIGKILL");
        } catch {
          // Termination still settles through the bounded fallback timer.
        }
      };
      const cleanup = () => {
        clearTimeout(timeoutTimer);
        if (retryKillTimer) clearTimeout(retryKillTimer);
        if (forceSettleTimer) clearTimeout(forceSettleTimer);
        child.off("error", onChildError);
        child.on("error", swallowLateError);
        child.off("close", onClose);
        child.stdout?.off("data", onStdoutData);
        child.stdout?.off("error", onStreamError);
        child.stdout?.on("error", swallowLateError);
        child.stderr?.off("data", onStderrData);
        child.stderr?.off("error", onStreamError);
        child.stderr?.on("error", swallowLateError);
        child.stdout?.destroy();
        child.stderr?.destroy();
      };
      const fail = () => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error(SAFE_ERROR));
      };
      const terminate = (timeout: boolean) => {
        if (settled || terminating) return;
        terminating = true;
        timedOut ||= timeout;
        safeKill();

        if (settled) return;

        retryKillTimer = setTimeout(() => {
          if (!settled) safeKill();
        }, Math.max(1, Math.floor(this.terminationGraceMs / 2)));

        if (settled) {
          clearTimeout(retryKillTimer);
          retryKillTimer = undefined;
          return;
        }

        forceSettleTimer = setTimeout(() => {
          safeKill();
          if (settled) return;
          try {
            child.unref();
          } catch {
            // Best-effort process detachment before normalized settlement.
          }
          fail();
        }, this.terminationGraceMs);
      };
      const collect = (chunk: Buffer, keep: boolean) => {
        if (settled || terminating) return;
        outputBytes += chunk.byteLength;
        if (
          !Number.isSafeInteger(outputBytes) ||
          outputBytes > options.maxOutputBytes
        ) {
          terminate(false);
          return;
        }
        if (keep) {
          stdout.push(Buffer.from(chunk));
        }
      };
      const onStdoutData = (chunk: Buffer) => collect(chunk, true);
      const onStderrData = (chunk: Buffer) => collect(chunk, false);
      const onStreamError = () => terminate(false);
      const onChildError = () => terminate(false);
      const onClose = (
        exitCode: number | null,
        signal: NodeJS.Signals | null,
      ) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        resolve({
          exitCode,
          signal,
          stdout: Buffer.concat(stdout).toString("utf8"),
          timedOut,
          failed: terminating,
        });
      };
      const timeoutTimer = setTimeout(() => terminate(true), options.timeoutMs);

      child.stdout?.on("data", onStdoutData);
      child.stdout?.on("error", onStreamError);
      child.stderr?.on("data", onStderrData);
      child.stderr?.on("error", onStreamError);
      child.on("error", onChildError);
      child.once("close", onClose);
    });
  }
}

function validateInput(input: VideoAssemblyInput) {
  if (
    !/^[a-zA-Z0-9-_]+$/.test(input.projectSlug) ||
    !Array.isArray(input.scenes) ||
    input.scenes.length === 0
  ) {
    throw new Error(SAFE_ERROR);
  }

  const ids = new Set<number>();
  const inputType = input.scenes[0].inputType;

  for (const scene of input.scenes) {
    if (
      scene.inputType !== inputType ||
      !Number.isSafeInteger(scene.sceneId) ||
      scene.sceneId <= 0 ||
      ids.has(scene.sceneId) ||
      !Number.isFinite(scene.durationSeconds) ||
      scene.durationSeconds <= 0 ||
      !isSafeInputPath(
        scene.audioFilePath,
        AudioStorage.getAudioDir(input.projectSlug),
      )
    ) {
      throw new Error(SAFE_ERROR);
    }
    if (scene.inputType === "image") {
      if (
        !isSafeInputPath(
          scene.imageFilePath,
          ImageStorage.getImagesDir(input.projectSlug),
        )
      ) {
        throw new Error(SAFE_ERROR);
      }
    } else if (
      !nonEmpty(scene.videoAssetId) ||
      !nonEmpty(scene.sourceImageAssetId) ||
      !nonEmpty(scene.animationAssetId) ||
      scene.provider !== "ffmpeg" ||
      scene.generationMode !== "production" ||
      scene.status !== "generated" ||
      scene.byteLength <= 0 ||
      !Number.isSafeInteger(scene.byteLength) ||
      !Number.isFinite(scene.narrationDurationSeconds) ||
      scene.narrationDurationSeconds <= 0 ||
      !isSafeInputPath(scene.filePath, VideoStorage.getVideoDir(input.projectSlug)) ||
      scene.url !==
        VideoStorage.getVideoUrl(input.projectSlug, path.posix.basename(scene.filePath))
    ) {
      throw new Error(SAFE_ERROR);
    } else {
      const inspection = VideoStorage.inspectStoredMp4(
        input.projectSlug,
        scene.filePath,
        8 * 1024 * 1024 * 1024,
      );
      if (inspection.byteLength !== scene.byteLength) throw new Error(SAFE_ERROR);
    }
    ids.add(scene.sceneId);
  }
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && Boolean(value.trim());
}

function isSafeInputPath(value: string, root: string) {
  return (
    typeof value === "string" &&
    value.startsWith(`${root}/`) &&
    !value.includes("\\") &&
    !value.includes("..") &&
    !path.posix.isAbsolute(value) &&
    !path.win32.isAbsolute(value) &&
    path.posix.normalize(value) === value &&
    !value.slice(root.length + 1).includes("/")
  );
}

function validateExecutable(executable: string) {
  const stat = fs.statSync(executable);

  if (!stat.isFile()) {
    throw new Error(SAFE_ERROR);
  }
  fs.accessSync(executable, fs.constants.X_OK);
}

function buildFFmpegArgs(
  input: VideoAssemblyInput,
  outputPath: string,
  concatManifestPath: string | null,
) {
  if (input.scenes[0].inputType === "scene-video") {
    return concatManifestPath
      ? buildCopyConcatArgs(input, outputPath, concatManifestPath)
      : buildRetimedConcatArgs(input, outputPath);
  }

  const args: string[] = ["-hide_banner", "-loglevel", "error", "-nostdin", "-n"];
  const filters: string[] = [];
  const concatInputs: string[] = [];

  input.scenes.forEach((scene, index) => {
    if (scene.inputType !== "image") throw new Error(SAFE_ERROR);
    const duration = scene.durationSeconds.toFixed(6);
    const imageIndex = index * 2;
    const audioIndex = imageIndex + 1;
    args.push(
      "-loop",
      "1",
      "-framerate",
      String(FPS),
      "-t",
      duration,
      "-i",
      absoluteInput(scene.imageFilePath),
      "-i",
      absoluteInput(scene.audioFilePath),
    );
    filters.push(
      `[${imageIndex}:v]scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=decrease,pad=${WIDTH}:${HEIGHT}:(ow-iw)/2:(oh-ih)/2,fps=${FPS},format=yuv420p,trim=duration=${duration},setpts=PTS-STARTPTS[v${index}]`,
      `[${audioIndex}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=duration=${duration},asetpts=PTS-STARTPTS[a${index}]`,
    );
    concatInputs.push(`[v${index}][a${index}]`);
  });

  filters.push(
    `${concatInputs.join("")}concat=n=${input.scenes.length}:v=1:a=1[v][a]`,
  );
  args.push(
    "-filter_complex",
    filters.join(";"),
    "-map",
    "[v]",
    "-map",
    "[a]",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "23",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-ar",
    "48000",
    "-ac",
    "2",
    "-movflags",
    "+faststart",
    outputPath,
  );
  return args;
}

function canCopySceneVideos(
  input: VideoAssemblyInput,
  signatures: SceneVideoProbeSignature[],
) {
  return (
    signatures.length === input.scenes.length &&
    signatures.every((signature) => sameProbeSignature(signature, signatures[0])) &&
    input.scenes.every(
    (scene) =>
      scene.inputType === "scene-video" &&
      Math.abs(scene.durationSeconds - scene.narrationDurationSeconds) <=
        1 / FPS,
    )
  );
}

function sameProbeSignature(
  left: SceneVideoProbeSignature,
  right: SceneVideoProbeSignature,
) {
  return (
    left.profile === right.profile &&
    left.level === right.level &&
    left.codecTag === right.codecTag &&
    left.timeBase === right.timeBase &&
    left.fieldOrder === right.fieldOrder &&
    left.extradata === right.extradata
  );
}

function buildConcatManifest(input: VideoAssemblyInput) {
  return [
    "ffconcat version 1.0",
    ...input.scenes.map((scene) => {
      if (scene.inputType !== "scene-video") throw new Error(SAFE_ERROR);
      const absolute = absoluteInput(scene.filePath).replaceAll("\\", "/");
      return `file '${absolute.replaceAll("'", "'\\''")}'`;
    }),
    "",
  ].join("\n");
}

function buildCopyConcatArgs(
  input: VideoAssemblyInput,
  outputPath: string,
  concatManifestPath: string,
) {
  const args = [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-n",
    "-f", "concat", "-safe", "0", "-i", concatManifestPath,
  ];
  const audioLabels: string[] = [];
  input.scenes.forEach((scene, index) => {
    args.push("-i", absoluteInput(scene.audioFilePath));
    const duration = narrationDuration(scene).toFixed(6);
    audioLabels.push(
      `[${index + 1}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=duration=${duration},asetpts=PTS-STARTPTS[a${index}]`,
    );
  });
  audioLabels.push(
    `${input.scenes.map((_, index) => `[a${index}]`).join("")}concat=n=${input.scenes.length}:v=0:a=1[a]`,
  );
  args.push(
    "-filter_complex", audioLabels.join(";"),
    "-map", "0:v:0", "-map", "[a]",
    "-c:v", "copy", "-c:a", "aac", "-ar", "48000", "-ac", "2",
    "-movflags", "+faststart", "-shortest", outputPath,
  );
  return args;
}

function buildRetimedConcatArgs(input: VideoAssemblyInput, outputPath: string) {
  const args: string[] = ["-hide_banner", "-loglevel", "error", "-nostdin", "-n"];
  const filters: string[] = [];
  const concatInputs: string[] = [];
  input.scenes.forEach((scene, index) => {
    if (scene.inputType !== "scene-video") throw new Error(SAFE_ERROR);
    const videoIndex = index * 2;
    const audioIndex = videoIndex + 1;
    const duration = scene.narrationDurationSeconds.toFixed(6);
    const padding = Math.max(0, scene.narrationDurationSeconds - scene.durationSeconds).toFixed(6);
    args.push("-i", absoluteInput(scene.filePath), "-i", absoluteInput(scene.audioFilePath));
    filters.push(
      `[${videoIndex}:v]tpad=stop_mode=clone:stop_duration=${padding},trim=duration=${duration},setpts=PTS-STARTPTS,fps=${FPS},format=yuv420p[v${index}]`,
      `[${audioIndex}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=duration=${duration},asetpts=PTS-STARTPTS[a${index}]`,
    );
    concatInputs.push(`[v${index}][a${index}]`);
  });
  filters.push(`${concatInputs.join("")}concat=n=${input.scenes.length}:v=1:a=1[v][a]`);
  args.push(
    "-filter_complex", filters.join(";"), "-map", "[v]", "-map", "[a]",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
    "-pix_fmt", "yuv420p", "-c:a", "aac", "-ar", "48000", "-ac", "2",
    "-movflags", "+faststart", outputPath,
  );
  return args;
}

function narrationDuration(scene: VideoAssemblyInput["scenes"][number]) {
  return scene.inputType === "scene-video"
    ? scene.narrationDurationSeconds
    : scene.durationSeconds;
}

function expectedOutputDuration(input: VideoAssemblyInput) {
  return input.scenes.reduce((sum, scene) => sum + narrationDuration(scene), 0);
}

function durationTolerance(duration: number) {
  return Math.max(0.25, Math.min(1, duration * 0.001));
}

function buildFFprobeArgs(outputPath: string) {
  return [
    "-v",
    "error",
    "-show_entries",
    "format=format_name,duration:stream=codec_type,codec_name,width,height,pix_fmt,avg_frame_rate,duration:stream_disposition=attached_pic",
    "-of",
    "json",
    outputPath,
  ];
}

function buildSceneInputProbeArgs(inputPath: string) {
  return [
    "-v",
    "error",
    "-show_data",
    "-show_entries",
    "format=format_name,duration:stream=codec_type,codec_name,profile,level,codec_tag_string,width,height,pix_fmt,avg_frame_rate,r_frame_rate,time_base,field_order,extradata",
    "-of",
    "json",
    inputPath,
  ];
}

function absoluteInput(relativePath: string) {
  return path.resolve(process.cwd(), ...relativePath.split("/"));
}

function requireSuccessfulProcess(result: ProcessRunResult) {
  if (
    result.exitCode !== 0 ||
    result.signal !== null ||
    result.timedOut ||
    result.failed
  ) {
    throw new Error(SAFE_ERROR);
  }
}

function validateProbe(value: string, expectedDuration: number) {
  const parsed = JSON.parse(value) as {
    format?: { format_name?: unknown; duration?: unknown };
    streams?: Array<Record<string, unknown>>;
  };
  const formatName = parsed.format?.format_name;
  const duration = Number(parsed.format?.duration);
  const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
  const videos = streams.filter((stream) => stream.codec_type === "video");
  const audios = streams.filter((stream) => stream.codec_type === "audio");
  const tolerance = Math.max(0.25, Math.min(1, expectedDuration * 0.001));
  const videoDuration = Number(videos[0]?.duration);
  const audioDuration = Number(audios[0]?.duration);

  if (
    typeof formatName !== "string" ||
    !formatName.split(",").includes("mp4") ||
    !Number.isFinite(duration) ||
    duration <= 0 ||
    Math.abs(duration - expectedDuration) > tolerance ||
    videos.length !== 1 ||
    audios.length !== 1 ||
    videos[0].codec_name !== "h264" ||
    videos[0].width !== WIDTH ||
    videos[0].height !== HEIGHT ||
    videos[0].pix_fmt !== "yuv420p" ||
    !isFrameRate(videos[0].avg_frame_rate, FPS) ||
    (videos[0].disposition !== undefined &&
      (videos[0].disposition as Record<string, unknown>).attached_pic !== 0) ||
    audios[0].codec_name !== "aac" ||
    !Number.isFinite(videoDuration) ||
    !Number.isFinite(audioDuration) ||
    Math.abs(videoDuration - expectedDuration) > tolerance ||
    Math.abs(audioDuration - expectedDuration) > tolerance ||
    Math.abs(videoDuration - audioDuration) > 1 / FPS
  ) {
    throw new Error(SAFE_ERROR);
  }

  return duration;
}

function validateSceneInputProbe(
  value: string,
  expectedDuration: number,
): SceneVideoProbeSignature {
  const parsed = JSON.parse(value) as {
    format?: { format_name?: unknown; duration?: unknown };
    streams?: Array<Record<string, unknown>>;
  };
  const formatName = parsed.format?.format_name;
  const duration = Number(parsed.format?.duration);
  const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
  const videos = streams.filter((stream) => stream.codec_type === "video");
  const audios = streams.filter((stream) => stream.codec_type === "audio");
  if (
    typeof formatName !== "string" ||
    !formatName.split(",").includes("mp4") ||
    !Number.isFinite(duration) ||
    duration <= 0 ||
    Math.abs(duration - expectedDuration) > durationTolerance(expectedDuration) ||
    videos.length !== 1 ||
    audios.length !== 0 ||
    videos[0].codec_name !== "h264" ||
    videos[0].width !== WIDTH ||
    videos[0].height !== HEIGHT ||
    videos[0].pix_fmt !== "yuv420p" ||
    !isFrameRate(videos[0].avg_frame_rate, FPS) ||
    !isFrameRate(videos[0].r_frame_rate, FPS)
  ) {
    throw new Error(SAFE_ERROR);
  }

  const video = videos[0];
  if (
    typeof video.profile !== "string" ||
    !video.profile ||
    !Number.isSafeInteger(video.level) ||
    typeof video.codec_tag_string !== "string" ||
    !video.codec_tag_string ||
    typeof video.time_base !== "string" ||
    !isPositiveRational(video.time_base) ||
    typeof video.field_order !== "string" ||
    !video.field_order ||
    typeof video.extradata !== "string" ||
    !video.extradata
  ) {
    throw new Error(SAFE_ERROR);
  }

  return {
    profile: video.profile,
    level: video.level as number,
    codecTag: video.codec_tag_string,
    timeBase: video.time_base,
    fieldOrder: video.field_order,
    extradata: video.extradata,
  };
}

function isFrameRate(value: unknown, expected: number) {
  const parsed = parseRational(value);
  return parsed !== null && Math.abs(parsed - expected) <= Number.EPSILON * expected;
}

function isPositiveRational(value: unknown) {
  const parsed = parseRational(value);
  return parsed !== null && parsed > 0;
}

function parseRational(value: unknown) {
  if (typeof value !== "string" || !/^\d+\/\d+$/.test(value)) return null;
  const [numerator, denominator] = value.split("/").map(Number);
  if (
    !Number.isSafeInteger(numerator) ||
    !Number.isSafeInteger(denominator) ||
    denominator === 0
  ) {
    return null;
  }
  const result = numerator / denominator;
  return Number.isFinite(result) ? result : null;
}
