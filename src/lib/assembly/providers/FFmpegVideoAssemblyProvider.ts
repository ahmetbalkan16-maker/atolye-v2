import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import type { Readable } from "node:stream";
import { AudioStorage } from "@/lib/assets/storage/AudioStorage";
import { ImageStorage } from "@/lib/assets/storage/ImageStorage";
import { VideoStorage } from "@/lib/assets/storage/VideoStorage";
import { createProviderDispatchAdapter } from "@/lib/providers/ProviderDispatchAdapterAuthority";
import {
  resolveRuntimeLogicalPath,
  type RuntimeStorageContext,
} from "@/lib/runtime/RuntimeStoragePaths";
import { requireActiveProductionRuntimeOperationContext,
  requireProductionRuntimeStorageContext } from "@/lib/runtime/ProductionRuntimeOperationContext";
import { animationTransitionTypes, type AnimationTransitionType } from "@/types/animation";
import type {
  VideoAssemblyInput,
  VideoAssemblyResult,
} from "@/types/videoAssembly";
import type { ConfiguredVideoAssemblyProvider } from "./VideoAssemblyProvider";
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
  stderr?: string;
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

export class FFmpegVideoAssemblyProvider implements ConfiguredVideoAssemblyProvider {
  readonly name = "ffmpeg";

  createImmutableAssemblyDispatchAdapter() {
    return createProviderDispatchAdapter(this, {
      metadata: { name: this.name }, requiredMethods: ["assemble"],
    });
  }

  constructor(
    private readonly runner: VideoAssemblyProcessRunner = new SpawnRunner(),
    private readonly runtimeStorageContext?: RuntimeStorageContext,
  ) {}

  async assemble(input: VideoAssemblyInput): Promise<VideoAssemblyResult> {
    const createdAt = new Date().toISOString();
    let paths: ReturnType<typeof VideoStorage.createRenderPaths> | null = null;
    let concatManifestPath: string | null = null;
    const context = this.runtimeStorageContext ?? requireProductionRuntimeStorageContext(
      requireActiveProductionRuntimeOperationContext());

    try {
      validateInput(input, context);
      const config = getFFmpegVideoAssemblyConfig();
      validateExecutable(config.ffmpegPath);
      validateExecutable(config.ffprobePath);
      const sceneProbeSignatures: SceneVideoProbeSignature[] = [];
      if (input.scenes[0].inputType === "scene-video") {
        for (const scene of input.scenes) {
          if (scene.inputType !== "scene-video") throw new Error(SAFE_ERROR);
          const sceneProbe = await this.runner.run(
            config.ffprobePath,
            buildSceneInputProbeArgs(absoluteInput(scene.filePath, context)),
            { timeoutMs: config.timeoutMs, maxOutputBytes: config.maxStdioBytes },
          );
          requireSuccessfulProcess(sceneProbe);
          sceneProbeSignatures.push(
            validateSceneInputProbe(sceneProbe.stdout, scene.durationSeconds),
          );
        }
      }
      paths = VideoStorage.createRenderPaths(input.projectSlug, context);
      if (canCopySceneVideos(input, sceneProbeSignatures)) {
        concatManifestPath = `${paths.temporaryAbsolutePath}.concat.txt`;
        fs.writeFileSync(
          concatManifestPath,
          buildConcatManifest(input, context),
          { encoding: "utf8", flag: "wx" },
        );
      }
      const ffmpegResult = await this.runner.run(
        config.ffmpegPath,
        buildFFmpegArgs(input, paths.temporaryAbsolutePath, concatManifestPath, context),
        { timeoutMs: config.timeoutMs, maxOutputBytes: config.maxStdioBytes },
      );

      requireSuccessfulProcess(ffmpegResult);
      const structural = VideoStorage.inspectMp4(
        paths.temporaryAbsolutePath,
        config.maxOutputBytes,
      );
      VideoStorage.finalize(paths.temporaryAbsolutePath, paths.absolutePath, context);
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
        expectedRenderedDuration(input, concatManifestPath),
      );
      if (concatManifestPath) {
        VideoStorage.removeIfExists(concatManifestPath, context);
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
      if (concatManifestPath) VideoStorage.removeIfExists(concatManifestPath, context);
      if (paths) {
        VideoStorage.removeIfExists(paths.temporaryAbsolutePath, context);
        VideoStorage.removeIfExists(paths.absolutePath, context);
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
      const stderr: Buffer[] = [];
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
          stderr: Buffer.concat(stderr).toString("utf8"),
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

function validateInput(input: VideoAssemblyInput, context: RuntimeStorageContext) {
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
      (scene.audioStartSeconds !== undefined &&
        (!Number.isFinite(scene.audioStartSeconds) || scene.audioStartSeconds < 0)) ||
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
        VideoStorage.getVideoUrl(input.projectSlug, path.posix.basename(scene.filePath)) ||
      (scene.transition !== undefined &&
        !(animationTransitionTypes as readonly string[]).includes(scene.transition))
    ) {
      throw new Error(SAFE_ERROR);
    } else {
      const inspection = VideoStorage.inspectStoredMp4(
        input.projectSlug,
        scene.filePath,
        8 * 1024 * 1024 * 1024,
        context,
      );
      if (inspection.byteLength !== scene.byteLength) throw new Error(SAFE_ERROR);
    }
    ids.add(scene.sceneId);
  }

  if (input.backgroundMusic !== undefined) {
    if (
      !input.backgroundMusic ||
      typeof input.backgroundMusic !== "object" ||
      !isSafeInputPath(
        input.backgroundMusic.filePath,
        AudioStorage.getAudioDir(input.projectSlug),
      ) ||
      (input.backgroundMusic.volume !== undefined &&
        (!Number.isFinite(input.backgroundMusic.volume) ||
          input.backgroundMusic.volume <= 0 ||
          input.backgroundMusic.volume > 2.0))
    ) {
      throw new Error(SAFE_ERROR);
    }
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
  if (process.platform !== "win32") {
    fs.accessSync(executable, fs.constants.X_OK);
  }
}

export type KenBurnsMotionType = "zoom-in" | "zoom-out" | "pan-left" | "pan-right";

export function selectKenBurnsMotion(sceneId: number): KenBurnsMotionType {
  const motions: KenBurnsMotionType[] = ["zoom-in", "zoom-out", "pan-left", "pan-right"];
  const index = (Math.abs(sceneId) - 1) % motions.length;
  return motions[index];
}

export function buildKenBurnsFilter(motion: KenBurnsMotionType, durationSeconds: number): string {
  const totalFrames = Math.max(1, Math.round(durationSeconds * FPS));
  switch (motion) {
    case "zoom-in":
      return `zoompan=z='min(1+0.0015*on,1.15)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${totalFrames}:fps=${FPS}:s=${WIDTH}x${HEIGHT}`;
    case "zoom-out":
      return `zoompan=z='max(1.15-0.0015*on,1.0)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${totalFrames}:fps=${FPS}:s=${WIDTH}x${HEIGHT}`;
    case "pan-left":
      return `zoompan=z=1.15:x='(on/${totalFrames})*(iw-iw/zoom)':y='ih/2-(ih/zoom/2)':d=${totalFrames}:fps=${FPS}:s=${WIDTH}x${HEIGHT}`;
    case "pan-right":
      return `zoompan=z=1.15:x='(1-on/${totalFrames})*(iw-iw/zoom)':y='ih/2-(ih/zoom/2)':d=${totalFrames}:fps=${FPS}:s=${WIDTH}x${HEIGHT}`;
  }
}

function buildFFmpegArgs(
  input: VideoAssemblyInput,
  outputPath: string,
  concatManifestPath: string | null,
  context: RuntimeStorageContext,
) {
  if (input.scenes[0].inputType === "scene-video") {
    if (concatManifestPath) {
      return buildCopyConcatArgs(input, outputPath, concatManifestPath, context);
    }
    return hasAnyBlendedJunction(input.scenes)
      ? buildTransitionedConcatArgs(input, outputPath, context)
      : buildRetimedConcatArgs(input, outputPath, context);
  }

  const args: string[] = ["-hide_banner", "-loglevel", "error", "-nostats", "-nostdin", "-n"];
  const filters: string[] = [];
  const concatInputs: string[] = [];

  input.scenes.forEach((scene, index) => {
    if (scene.inputType !== "image") throw new Error(SAFE_ERROR);
    const duration = scene.durationSeconds.toFixed(6);
    const audioStartSeconds = audioStart(scene).toFixed(6);
    const audioEndSeconds = (audioStart(scene) + scene.durationSeconds).toFixed(6);
    const imageIndex = index * 2;
    const audioIndex = imageIndex + 1;
    const motion = selectKenBurnsMotion(scene.sceneId);
    const zoompanFilter = buildKenBurnsFilter(motion, scene.durationSeconds);

    args.push(
      "-i",
      absoluteInput(scene.imageFilePath, context),
      "-i",
      absoluteInput(scene.audioFilePath, context),
    );
    filters.push(
      `[${imageIndex}:v]${zoompanFilter},scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=decrease,pad=${WIDTH}:${HEIGHT}:(ow-iw)/2:(oh-ih)/2,format=yuv420p,trim=duration=${duration},setpts=PTS-STARTPTS[v${index}]`,
      `[${audioIndex}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=start=${audioStartSeconds}:end=${audioEndSeconds},atrim=duration=${duration},asetpts=PTS-STARTPTS[a${index}]`,
    );
    concatInputs.push(`[v${index}][a${index}]`);
  });

  if (!input.backgroundMusic) {
    filters.push(
      `${concatInputs.join("")}concat=n=${input.scenes.length}:v=1:a=1[v][a]`,
    );
  } else {
    const bgmIndex = input.scenes.length * 2;
    const bgmVol = (input.backgroundMusic.volume ?? 0.15).toFixed(2);
    const useDucking = input.backgroundMusic.ducking !== false;

    args.push("-stream_loop", "-1", "-i", absoluteInput(input.backgroundMusic.filePath, context));

    filters.push(
      `${concatInputs.map((_, i) => `[v${i}]`).join("")}concat=n=${input.scenes.length}:v=1:a=0[v]`,
      `${concatInputs.map((_, i) => `[a${i}]`).join("")}concat=n=${input.scenes.length}:v=0:a=1[a_narration_full]`,
      `[a_narration_full]asplit=2[a_narration_sc][a_narration_main]`,
      `[${bgmIndex}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,volume=${bgmVol}[bgm_raw]`,
    );
    if (useDucking) {
      filters.push(
        `[bgm_raw][a_narration_sc]sidechaincompress=threshold=0.03:ratio=5:attack=100:release=800[bgm_ducked]`,
        `[a_narration_main][bgm_ducked]amix=inputs=2:weights=1 1:normalize=0[a]`,
      );
    } else {
      filters.push(
        `[a_narration_main][bgm_raw]amix=inputs=2:weights=1 1:normalize=0[a]`,
      );
    }
  }

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
    !input.backgroundMusic &&
    signatures.length === input.scenes.length &&
    signatures.every((signature) => sameProbeSignature(signature, signatures[0])) &&
    input.scenes.every(
      (scene) =>
        scene.inputType === "scene-video" &&
        Math.abs(scene.durationSeconds - scene.narrationDurationSeconds) <=
          1 / FPS,
    ) &&
    !hasAnyBlendedJunction(input.scenes)
  );
}

/**
 * A junction (the cut from scene index-1 into scene index) is "blended" when
 * its transition resolves to anything other than "cut". Scene 0 has no
 * predecessor, so its own transition value is never a junction and is
 * ignored here regardless of what it holds.
 */
function hasAnyBlendedJunction(scenes: VideoAssemblyInput["scenes"]) {
  return scenes.some(
    (scene, index) =>
      index > 0 && scene.inputType === "scene-video" && sceneTransitionAt(scene) !== "cut",
  );
}

function sceneTransitionAt(
  scene: VideoAssemblyInput["scenes"][number],
): AnimationTransitionType {
  return scene.inputType === "scene-video" ? scene.transition ?? "cut" : "cut";
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

function buildConcatManifest(input: VideoAssemblyInput, context: RuntimeStorageContext) {
  return [
    "ffconcat version 1.0",
    ...input.scenes.map((scene) => {
      if (scene.inputType !== "scene-video") throw new Error(SAFE_ERROR);
      const absolute = absoluteInput(scene.filePath, context).replaceAll("\\", "/");
      return `file '${absolute.replaceAll("'", "'\\''")}'`;
    }),
    "",
  ].join("\n");
}

function buildCopyConcatArgs(
  input: VideoAssemblyInput,
  outputPath: string,
  concatManifestPath: string,
  context: RuntimeStorageContext,
) {
  const args = [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-n",
    "-f", "concat", "-safe", "0", "-i", concatManifestPath,
  ];
  const audioLabels: string[] = [];
  input.scenes.forEach((scene, index) => {
    args.push("-i", absoluteInput(scene.audioFilePath, context));
    const duration = narrationDuration(scene).toFixed(6);
    const start = audioStart(scene).toFixed(6);
    const end = (audioStart(scene) + narrationDuration(scene)).toFixed(6);
    audioLabels.push(
      `[${index + 1}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=start=${start}:end=${end},atrim=duration=${duration},asetpts=PTS-STARTPTS[a${index}]`,
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

function buildRetimedConcatArgs(
  input: VideoAssemblyInput,
  outputPath: string,
  context: RuntimeStorageContext,
) {
  const args: string[] = ["-hide_banner", "-loglevel", "error", "-nostdin", "-n"];
  const filters: string[] = [];
  const concatInputs: string[] = [];
  input.scenes.forEach((scene, index) => {
    if (scene.inputType !== "scene-video") throw new Error(SAFE_ERROR);
    const videoIndex = index * 2;
    const audioIndex = videoIndex + 1;
    const duration = scene.narrationDurationSeconds.toFixed(6);
    const audioStartSeconds = audioStart(scene).toFixed(6);
    const audioEndSeconds = (audioStart(scene) + scene.narrationDurationSeconds).toFixed(6);
    const padding = Math.max(0, scene.narrationDurationSeconds - scene.durationSeconds).toFixed(6);
    args.push(
      "-i",
      absoluteInput(scene.filePath, context),
      "-i",
      absoluteInput(scene.audioFilePath, context),
    );
    filters.push(
      `[${videoIndex}:v]tpad=stop_mode=clone:stop_duration=${padding},trim=duration=${duration},setpts=PTS-STARTPTS,fps=${FPS},format=yuv420p[v${index}]`,
      `[${audioIndex}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=start=${audioStartSeconds}:end=${audioEndSeconds},atrim=duration=${duration},asetpts=PTS-STARTPTS[a${index}]`,
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

const MAX_BLEND_SECONDS = 0.5;
const CUT_BLEND_SECONDS = 1 / FPS;
const MIN_BLEND_SECONDS = 0.01;

/**
 * Real cut/fade/crossfade transitions between scene-video segments, applied
 * whenever at least one junction resolves to something other than "cut"
 * (see hasAnyBlendedJunction). Reuses the same per-scene retime/normalize
 * filters as buildRetimedConcatArgs, then chains scenes pairwise with
 * xfade/acrossfade instead of a plain concat filter. "cut" junctions inside
 * an otherwise-blended sequence still get a real xfade node, but with a
 * single-frame duration so it reads as a hard cut; a fully "cut" sequence
 * never reaches this function (canCopySceneVideos/hasAnyBlendedJunction keep
 * it on the original zero-re-encode paths).
 */
function buildTransitionedConcatArgs(
  input: VideoAssemblyInput,
  outputPath: string,
  context: RuntimeStorageContext,
) {
  const args: string[] = ["-hide_banner", "-loglevel", "error", "-nostdin", "-n"];
  const filters: string[] = [];
  const durations: number[] = [];

  input.scenes.forEach((scene, index) => {
    if (scene.inputType !== "scene-video") throw new Error(SAFE_ERROR);
    const videoIndex = index * 2;
    const audioIndex = videoIndex + 1;
    const duration = scene.narrationDurationSeconds;
    durations.push(duration);
    const audioStartSeconds = audioStart(scene).toFixed(6);
    const audioEndSeconds = (audioStart(scene) + duration).toFixed(6);
    const padding = Math.max(0, duration - scene.durationSeconds).toFixed(6);
    args.push(
      "-i",
      absoluteInput(scene.filePath, context),
      "-i",
      absoluteInput(scene.audioFilePath, context),
    );
    filters.push(
      `[${videoIndex}:v]tpad=stop_mode=clone:stop_duration=${padding},trim=duration=${duration.toFixed(6)},setpts=PTS-STARTPTS,fps=${FPS},format=yuv420p,setsar=1[v${index}]`,
      `[${audioIndex}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=start=${audioStartSeconds}:end=${audioEndSeconds},atrim=duration=${duration.toFixed(6)},asetpts=PTS-STARTPTS[a${index}]`,
    );
  });

  let videoLabel = "v0";
  let audioLabel = "a0";
  let cumulative = durations[0];

  for (let index = 1; index < input.scenes.length; index += 1) {
    const transition = sceneTransitionAt(input.scenes[index]);
    const blend = blendSecondsFor(transition, durations[index - 1], durations[index]);
    const offset = Math.max(0, cumulative - blend).toFixed(6);
    const nextVideoLabel = `vx${index}`;
    const nextAudioLabel = `ax${index}`;
    filters.push(
      `[${videoLabel}][v${index}]xfade=transition=${xfadeModeFor(transition)}:duration=${blend.toFixed(6)}:offset=${offset}[${nextVideoLabel}]`,
      `[${audioLabel}][a${index}]acrossfade=d=${blend.toFixed(6)}[${nextAudioLabel}]`,
    );
    videoLabel = nextVideoLabel;
    audioLabel = nextAudioLabel;
    cumulative = cumulative + durations[index] - blend;
  }

  args.push(
    "-filter_complex",
    filters.join(";"),
    "-map",
    `[${videoLabel}]`,
    "-map",
    `[${audioLabel}]`,
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

function blendSecondsFor(
  transition: AnimationTransitionType,
  durationA: number,
  durationB: number,
) {
  const target = transition === "cut" ? CUT_BLEND_SECONDS : MAX_BLEND_SECONDS;
  return Math.max(
    MIN_BLEND_SECONDS,
    Math.min(target, durationA * 0.4, durationB * 0.4),
  );
}

function xfadeModeFor(transition: AnimationTransitionType) {
  return transition === "fade" ? "fadeblack" : "fade";
}

function narrationDuration(scene: VideoAssemblyInput["scenes"][number]) {
  return scene.inputType === "scene-video"
    ? scene.narrationDurationSeconds
    : scene.durationSeconds;
}

function audioStart(scene: VideoAssemblyInput["scenes"][number]) {
  return scene.audioStartSeconds ?? 0;
}

function expectedOutputDuration(input: VideoAssemblyInput) {
  return input.scenes.reduce((sum, scene) => sum + narrationDuration(scene), 0);
}

/**
 * The self-check duration passed to validateProbe after render. Equal to
 * expectedOutputDuration() (the naive per-scene sum) on every path except
 * the xfade/acrossfade transitioned-concat path built by
 * buildTransitionedConcatArgs: there, each blended junction overlaps two
 * scenes by `blend` seconds, so ffmpeg's real output is shorter than the
 * naive sum by the total overlap. totalBlendSeconds() mirrors that
 * function's per-junction blend math (via the same blendSecondsFor/
 * sceneTransitionAt calls) without touching its filter-graph construction,
 * so the two can never drift apart.
 */
function expectedRenderedDuration(
  input: VideoAssemblyInput,
  concatManifestPath: string | null,
) {
  const naive = expectedOutputDuration(input);
  if (
    input.scenes[0].inputType !== "scene-video" ||
    concatManifestPath ||
    !hasAnyBlendedJunction(input.scenes)
  ) {
    return naive;
  }
  return naive - totalBlendSeconds(input.scenes);
}

/**
 * Sum of per-junction xfade/acrossfade overlap seconds that
 * buildTransitionedConcatArgs will apply for this scene list. See
 * expectedRenderedDuration() for why this must stay in lockstep with that
 * function's blend loop.
 */
function totalBlendSeconds(scenes: VideoAssemblyInput["scenes"]) {
  let total = 0;
  for (let index = 1; index < scenes.length; index += 1) {
    total += blendSecondsFor(
      sceneTransitionAt(scenes[index]),
      narrationDuration(scenes[index - 1]),
      narrationDuration(scenes[index]),
    );
  }
  return total;
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

function absoluteInput(relativePath: string, context: RuntimeStorageContext) {
  return resolveRuntimeLogicalPath(relativePath, context);
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
