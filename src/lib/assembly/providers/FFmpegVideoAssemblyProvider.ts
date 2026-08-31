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
export const FPS = 30;

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
          requireSuccessfulProcess(sceneProbe, "ffprobe(scene-input)");
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

      requireSuccessfulProcess(ffmpegResult, "ffmpeg(assemble)");
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
      requireSuccessfulProcess(probeResult, "ffprobe(output)");
      const durationSeconds = validateProbe(
        probeResult.stdout,
        expectedRenderedDuration(input, concatManifestPath),
        frameRoundingAllowance(input.scenes, concatManifestPath),
        input.scenes.length,
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
    } catch (err) {
      console.error("[FFmpegVideoAssemblyProvider] assembly failed:", err);
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
        ) ||
        (scene.transition !== undefined &&
          !(animationTransitionTypes as readonly string[]).includes(scene.transition))
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

/** Music bed fades (seconds), clamped to a third of the render on short cuts. */
const BGM_FADE_IN_SECONDS = 1.5;
const BGM_FADE_OUT_SECONDS = 3;

function appendBgmFilterGraph(
  args: string[],
  filters: string[],
  narrationLabel: string,
  bgmInputIndex: number,
  bgmConfig: NonNullable<VideoAssemblyInput["backgroundMusic"]>,
  context: RuntimeStorageContext,
  totalSeconds: number,
): void {
  const bgmVol = (bgmConfig.volume ?? 0.15).toFixed(2);
  const useDucking = bgmConfig.ducking !== false;
  // `-stream_loop -1` makes the bed input infinite; `atrim` bounds it to the
  // exact render length so `afade=out` lands on the real end and the mux
  // terminates cleanly. Fade in from silence at the start, fade out to silence
  // at the end — never a hard cut on the music.
  const total = Number.isFinite(totalSeconds) && totalSeconds > 0 ? totalSeconds : 1;
  const fadeIn = Math.min(BGM_FADE_IN_SECONDS, total / 3);
  const fadeOut = Math.min(BGM_FADE_OUT_SECONDS, total / 3);
  const fadeOutStart = Math.max(0, total - fadeOut);

  args.push("-stream_loop", "-1", "-i", absoluteInput(bgmConfig.filePath, context));

  filters.push(
    `[${bgmInputIndex}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,` +
      `atrim=duration=${total.toFixed(6)},asetpts=PTS-STARTPTS,volume=${bgmVol},` +
      `afade=t=in:st=0:d=${fadeIn.toFixed(3)},` +
      `afade=t=out:st=${fadeOutStart.toFixed(3)}:d=${fadeOut.toFixed(3)}[bgm_raw]`,
  );
  if (useDucking) {
    // Split the narration: one copy is the sidechain key that pulls the music
    // down while the narrator speaks, the other is mixed at full level.
    filters.push(
      `[${narrationLabel}]asplit=2[a_narration_sc][a_narration_main]`,
      `[bgm_raw][a_narration_sc]sidechaincompress=threshold=0.03:ratio=5:attack=100:release=800[bgm_ducked]`,
      `[a_narration_main][bgm_ducked]amix=inputs=2:weights=1 1:normalize=0[a]`,
    );
  } else {
    filters.push(
      `[${narrationLabel}][bgm_raw]amix=inputs=2:weights=1 1:normalize=0[a]`,
    );
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

  return hasAnyBlendedJunction(input.scenes)
    ? buildTransitionedImageConcatArgs(input, outputPath, context)
    : buildImageConcatArgs(input, outputPath, context);
}

/**
 * Static-image assembly path used whenever every junction resolves to "cut"
 * (see hasAnyBlendedJunction) — i.e. the original Sprint 138/139 behavior,
 * untouched by Sprint 140's fade/fadeblack xfade support. Each scene gets
 * its own Ken Burns + scale/pad filter chain and scenes are joined with a
 * plain concat filter (zero blend overlap).
 */
function buildImageConcatArgs(
  input: VideoAssemblyInput,
  outputPath: string,
  context: RuntimeStorageContext,
) {
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
      `[${imageIndex}:v]${zoompanFilter},scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=decrease:out_range=tv,pad=${WIDTH}:${HEIGHT}:(ow-iw)/2:(oh-ih)/2,format=yuv420p,trim=duration=${duration},setpts=PTS-STARTPTS[v${index}]`,
      `[${audioIndex}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=start=${audioStartSeconds}:end=${audioEndSeconds},atrim=duration=${duration},asetpts=PTS-STARTPTS[a${index}]`,
    );
    concatInputs.push(`[v${index}][a${index}]`);
  });

  const audioMapLabel = "[a]";

  if (!input.backgroundMusic) {
    filters.push(
      `${concatInputs.join("")}concat=n=${input.scenes.length}:v=1:a=1[v][a]`,
    );
  } else {
    const bgmIndex = input.scenes.length * 2;
    filters.push(
      `${concatInputs.map((_, i) => `[v${i}]`).join("")}concat=n=${input.scenes.length}:v=1:a=0[v]`,
      `${concatInputs.map((_, i) => `[a${i}]`).join("")}concat=n=${input.scenes.length}:v=0:a=1[a_narration_full]`,
    );
    appendBgmFilterGraph(args, filters, "a_narration_full", bgmIndex, input.backgroundMusic, context, expectedRenderedDuration(input, null));
  }

  args.push(
    "-filter_complex",
    filters.join(";"),
    "-map",
    "[v]",
    "-map",
    audioMapLabel,
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

/**
 * Real fade/fadeblack xfade + acrossfade transitions between static image
 * scenes, applied whenever at least one junction resolves to something other
 * than "cut" (see hasAnyBlendedJunction). Mirrors buildTransitionedConcatArgs
 * (Sprint 133/139's scene-video equivalent): each scene gets its own Ken
 * Burns + scale/pad per-scene filter chain (the same filter buildImageConcatArgs
 * uses, plus an explicit setsar=1 so xfade never rejects mismatched SAR
 * metadata), then scenes are chained pairwise with xfade/acrossfade instead
 * of the plain concat filter buildImageConcatArgs uses. A fully "cut"
 * sequence never reaches this function (hasAnyBlendedJunction routes it to
 * buildImageConcatArgs instead), so the pre-Sprint-140 image path is never
 * touched by this code.
 */
function buildTransitionedImageConcatArgs(
  input: VideoAssemblyInput,
  outputPath: string,
  context: RuntimeStorageContext,
) {
  const args: string[] = ["-hide_banner", "-loglevel", "error", "-nostats", "-nostdin", "-n"];
  const filters: string[] = [];
  const timeline = planTransitionedTimeline(input.scenes);

  input.scenes.forEach((scene, index) => {
    if (scene.inputType !== "image") throw new Error(SAFE_ERROR);
    const duration = scene.durationSeconds;
    const frames = timeline.sceneFrames[index];
    const audioStartSeconds = audioStart(scene).toFixed(6);
    const audioEndSeconds = (audioStart(scene) + duration).toFixed(6);
    const imageIndex = index * 2;
    const audioIndex = imageIndex + 1;
    const motion = selectKenBurnsMotion(scene.sceneId);
    const zoompanFilter = buildKenBurnsFilter(motion, duration);

    args.push(
      "-i",
      absoluteInput(scene.imageFilePath, context),
      "-i",
      absoluteInput(scene.audioFilePath, context),
    );
    filters.push(
      // buildKenBurnsFilter already emits exactly `round(duration * FPS)`
      // frames at fps=FPS, so `trim=end_frame` here is an exact clamp to the
      // same integer count planTransitionedTimeline() offsets the xfade chain
      // against — never a `trim=duration=<seconds>` sub-frame snap.
      `[${imageIndex}:v]${zoompanFilter},scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=decrease:out_range=tv,pad=${WIDTH}:${HEIGHT}:(ow-iw)/2:(oh-ih)/2,format=yuv420p,setsar=1,trim=end_frame=${frames},setpts=PTS-STARTPTS[v${index}]`,
      `[${audioIndex}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=start=${audioStartSeconds}:end=${audioEndSeconds},atrim=duration=${duration.toFixed(6)},asetpts=PTS-STARTPTS[a${index}]`,
    );
  });

  let videoLabel = "v0";
  let audioLabel = "a0";

  timeline.junctions.forEach((junction, junctionIndex) => {
    const index = junctionIndex + 1;
    const transition = sceneTransitionAt(input.scenes[index]);
    const nextVideoLabel = `vx${index}`;
    const nextAudioLabel = `ax${index}`;
    filters.push(
      `[${videoLabel}][v${index}]xfade=transition=${xfadeModeFor(transition)}:duration=${frameSeconds(junction.videoBlendFrames)}:offset=${frameSeconds(junction.offsetFrames)}[${nextVideoLabel}]`,
      `[${audioLabel}][a${index}]acrossfade=d=${frameSeconds(junction.audioBlendFrames)}[${nextAudioLabel}]`,
    );
    videoLabel = nextVideoLabel;
    audioLabel = nextAudioLabel;
  });

  let finalAudioLabel = audioLabel;

  if (input.backgroundMusic) {
    const bgmIndex = input.scenes.length * 2;
    appendBgmFilterGraph(args, filters, audioLabel, bgmIndex, input.backgroundMusic, context, expectedRenderedDuration(input, null));
    finalAudioLabel = "a";
  }

  args.push(
    "-filter_complex",
    filters.join(";"),
    "-map",
    `[${videoLabel}]`,
    "-map",
    `[${finalAudioLabel}]`,
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
export function hasAnyBlendedJunction(scenes: VideoAssemblyInput["scenes"]) {
  return scenes.some(
    (scene, index) => index > 0 && sceneTransitionAt(scene) !== "cut",
  );
}

function sceneTransitionAt(
  scene: VideoAssemblyInput["scenes"][number],
): AnimationTransitionType {
  return scene.transition ?? "cut";
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

  const audioMapLabel = "[a]";

  if (!input.backgroundMusic) {
    filters.push(`${concatInputs.join("")}concat=n=${input.scenes.length}:v=1:a=1[v][a]`);
  } else {
    const bgmIndex = input.scenes.length * 2;
    filters.push(
      `${concatInputs.map((_, i) => `[v${i}]`).join("")}concat=n=${input.scenes.length}:v=1:a=0[v]`,
      `${concatInputs.map((_, i) => `[a${i}]`).join("")}concat=n=${input.scenes.length}:v=0:a=1[a_narration_full]`,
    );
    appendBgmFilterGraph(args, filters, "a_narration_full", bgmIndex, input.backgroundMusic, context, expectedRenderedDuration(input, null));
  }

  args.push(
    "-filter_complex", filters.join(";"), "-map", "[v]", "-map", audioMapLabel,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
    "-pix_fmt", "yuv420p", "-c:a", "aac", "-ar", "48000", "-ac", "2",
    "-movflags", "+faststart", outputPath,
  );
  return args;
}

export const MAX_BLEND_SECONDS = 0.5;
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
  const timeline = planTransitionedTimeline(input.scenes);

  input.scenes.forEach((scene, index) => {
    if (scene.inputType !== "scene-video") throw new Error(SAFE_ERROR);
    const videoIndex = index * 2;
    const audioIndex = videoIndex + 1;
    const narrationSeconds = scene.narrationDurationSeconds;
    const frames = timeline.sceneFrames[index];
    const audioStartSeconds = audioStart(scene).toFixed(6);
    const audioEndSeconds = (audioStart(scene) + narrationSeconds).toFixed(6);
    // tpad clones the final frame well past the target, `fps` puts the stream
    // on the fixed frame grid, and `trim=end_frame` then cuts to an exact
    // integer frame count — deterministic, unlike `trim=duration=<seconds>`
    // which snaps to whichever frame boundary happens to fall under the raw
    // narration seconds and can leave the stream up to a frame short. The +1s
    // of clone headroom swamps any tpad/fps rounding; trim removes the excess.
    const padSeconds = (
      Math.max(0, frames / FPS - scene.durationSeconds) + 1
    ).toFixed(6);
    args.push(
      "-i",
      absoluteInput(scene.filePath, context),
      "-i",
      absoluteInput(scene.audioFilePath, context),
    );
    filters.push(
      `[${videoIndex}:v]tpad=stop_mode=clone:stop_duration=${padSeconds},fps=${FPS},trim=end_frame=${frames},setpts=PTS-STARTPTS,format=yuv420p,setsar=1[v${index}]`,
      `[${audioIndex}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=start=${audioStartSeconds}:end=${audioEndSeconds},atrim=duration=${narrationSeconds.toFixed(6)},asetpts=PTS-STARTPTS[a${index}]`,
    );
  });

  let videoLabel = "v0";
  let audioLabel = "a0";

  timeline.junctions.forEach((junction, junctionIndex) => {
    const index = junctionIndex + 1;
    const transition = sceneTransitionAt(input.scenes[index]);
    const nextVideoLabel = `vx${index}`;
    const nextAudioLabel = `ax${index}`;
    filters.push(
      `[${videoLabel}][v${index}]xfade=transition=${xfadeModeFor(transition)}:duration=${frameSeconds(junction.videoBlendFrames)}:offset=${frameSeconds(junction.offsetFrames)}[${nextVideoLabel}]`,
      `[${audioLabel}][a${index}]acrossfade=d=${frameSeconds(junction.audioBlendFrames)}[${nextAudioLabel}]`,
    );
    videoLabel = nextVideoLabel;
    audioLabel = nextAudioLabel;
  });

  let finalAudioLabel = audioLabel;

  if (input.backgroundMusic) {
    const bgmIndex = input.scenes.length * 2;
    appendBgmFilterGraph(args, filters, audioLabel, bgmIndex, input.backgroundMusic, context, expectedRenderedDuration(input, null));
    finalAudioLabel = "a";
  }

  args.push(
    "-filter_complex",
    filters.join(";"),
    "-map",
    `[${videoLabel}]`,
    "-map",
    `[${finalAudioLabel}]`,
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

export function narrationDuration(scene: VideoAssemblyInput["scenes"][number]) {
  return scene.inputType === "scene-video"
    ? scene.narrationDurationSeconds
    : scene.durationSeconds;
}

function audioStart(scene: VideoAssemblyInput["scenes"][number]) {
  return scene.audioStartSeconds ?? 0;
}

/**
 * Deterministic frame-boundary safety margin between the end of a chained
 * xfade's transition window and the real end of its (accumulated) first
 * input. FFmpeg's xfade terminates the ENTIRE filter output the instant the
 * first input reaches EOF before `offset + duration` is reached — silently
 * dropping the second input and every downstream scene still in the chain.
 * The pre-fix offset math (`offset = cumulative - blend`, with `cumulative`
 * summed from exact, non-frame-aligned narration seconds) placed that window
 * flush against the nominal timeline end with ZERO margin, so once the
 * accumulated frame-quantization drift pushed the real accumulated stream a
 * fraction of a frame short of `cumulative`, the chain collapsed: the real
 * 302ce03f incident rendered a ~15-scene / ~99s assembly as 37.6s (expected
 * ~96s) and failed validateProbe(). Reserving one whole frame of headroom —
 * with every per-scene stream forced to an exact integer frame count
 * (`trim=end_frame`) and the running offset tracked in integer frames — makes
 * `offset + duration <= realFirstInputFrames - 1` hold at every junction.
 */
const XFADE_SAFETY_MARGIN_FRAMES = 1;

/**
 * blendSecondsFor() re-expressed on the integer-frame grid the transitioned
 * concat paths actually render on. Keeps blendSecondsFor()'s exact clamp
 * (target vs 40%-of-either-neighbour) so "cut" junctions still collapse to a
 * single-frame xfade and fade/crossfade junctions still cap at
 * MAX_BLEND_SECONDS, then snaps to whole frames — never below 1, since xfade
 * rejects a zero-length transition.
 */
function blendFramesFor(
  transition: AnimationTransitionType,
  framesA: number,
  framesB: number,
) {
  return Math.max(
    1,
    Math.round(blendSecondsFor(transition, framesA / FPS, framesB / FPS) * FPS),
  );
}

interface TransitionedJunction {
  readonly offsetFrames: number;
  readonly videoBlendFrames: number;
  readonly audioBlendFrames: number;
}

interface TransitionedTimeline {
  /** Exact integer frame count each scene's per-scene filter is forced to. */
  readonly sceneFrames: readonly number[];
  /** One entry per inter-scene junction (scene index 1..n-1). */
  readonly junctions: readonly TransitionedJunction[];
  /** Exact frame count of the fully chained xfade output. */
  readonly totalFrames: number;
}

/**
 * Single source of truth for the xfade/acrossfade chain geometry shared by
 * buildTransitionedConcatArgs (scene-video), buildTransitionedImageConcatArgs
 * (static image) and expectedRenderedDuration(). Everything is in integer
 * frames:
 *
 *  - each scene contributes exactly `round(narrationDuration * FPS)` frames —
 *    its per-scene filter ends in `trim=end_frame=<thatCount>`, so this is the
 *    real stream length, not an estimate of it;
 *  - `offsetFrames` for junction k sits `videoBlendFrames + margin` frames
 *    before the real end of the accumulated first input, so the transition
 *    window always closes at least one frame early;
 *  - `accumulated` advances by xfade's real output law
 *    (`out = offset + len(secondInput)`), never by `cumulative - blend`, so it
 *    can never run ahead of what ffmpeg actually produces;
 *  - the audio acrossfade overlaps by `videoBlendFrames + margin` (not just
 *    `videoBlendFrames`) so the narration track loses the same total length
 *    the video track does and the two stay within a few frames end to end.
 */
function planTransitionedTimeline(
  scenes: VideoAssemblyInput["scenes"],
): TransitionedTimeline {
  const sceneFrames = scenes.map((scene) =>
    Math.max(1, Math.round(narrationDuration(scene) * FPS)),
  );
  const junctions: TransitionedJunction[] = [];
  let accumulated = sceneFrames[0];
  for (let index = 1; index < scenes.length; index += 1) {
    const videoBlendFrames = blendFramesFor(
      sceneTransitionAt(scenes[index]),
      sceneFrames[index - 1],
      sceneFrames[index],
    );
    const offsetFrames = Math.max(
      0,
      accumulated - videoBlendFrames - XFADE_SAFETY_MARGIN_FRAMES,
    );
    junctions.push({
      offsetFrames,
      videoBlendFrames,
      audioBlendFrames: videoBlendFrames + XFADE_SAFETY_MARGIN_FRAMES,
    });
    accumulated = offsetFrames + sceneFrames[index];
  }
  return { sceneFrames, junctions, totalFrames: accumulated };
}

/** Seconds string for a whole-frame count at the fixed assembly FPS. */
function frameSeconds(frames: number) {
  return (frames / FPS).toFixed(6);
}

function expectedOutputDuration(input: VideoAssemblyInput) {
  return input.scenes.reduce((sum, scene) => sum + narrationDuration(scene), 0);
}

/**
 * The self-check duration passed to validateProbe after render. Equal to
 * expectedOutputDuration() (the naive per-scene sum) on the copy-concat path
 * (concatManifestPath set, stream-copied, no retiming) and the all-"cut"
 * plain-concat paths. On the xfade/acrossfade transitioned-concat paths
 * (buildTransitionedConcatArgs / buildTransitionedImageConcatArgs) the render
 * is fully frame-quantized, so this returns planTransitionedTimeline()'s
 * exact total-frame count — the SAME geometry those builders emit their
 * filter graph from — converted to seconds. Sharing planTransitionedTimeline()
 * (rather than mirroring a blend-sum in a second function) is what keeps the
 * self-check and the filter graph from ever drifting apart.
 */
function expectedRenderedDuration(
  input: VideoAssemblyInput,
  concatManifestPath: string | null,
) {
  if (concatManifestPath || !hasAnyBlendedJunction(input.scenes)) {
    return expectedOutputDuration(input);
  }
  return planTransitionedTimeline(input.scenes).totalFrames / FPS;
}

/**
 * Sprint 149: additional post-render duration tolerance (seconds), beyond
 * validateProbe()'s base percentage-of-duration allowance, to accept the
 * real, bounded frame-quantization every rendered assembly goes through —
 * not an arbitrary widening. Two concrete, filter-graph-verified sources of
 * drift exist, and this function counts exactly how many of each apply to
 * `scenes`, so the allowance scales with how much frame-quantizing work the
 * render actually does instead of being a flat constant:
 *
 *  1. Every per-scene retiming filter resamples that scene onto the fixed
 *     FPS grid: `round(durationSeconds * FPS)` frames for "image" scenes
 *     (buildKenBurnsFilter) and buildRetimedConcatArgs' `trim=duration` for
 *     the all-"cut" scene-video path can each land up to one frame off the
 *     exact narration seconds. This never happens on the canCopySceneVideos
 *     zero-re-encode path (`concatManifestPath` set): video is stream-copied
 *     untouched, so there is no per-scene retiming filter to quantize.
 *  2. On the xfade/acrossfade transitioned paths every per-scene video
 *     stream is forced to an exact integer frame count
 *     (planTransitionedTimeline / `trim=end_frame`), but its narration audio
 *     is atrim-cut to the precise, generally non-frame-aligned segment
 *     seconds, so video and audio can differ by up to half a frame per
 *     scene. This only applies when hasAnyBlendedJunction() is true.
 *
 * Either way the per-point bound is one frame (1/FPS), so the total
 * allowance is capped at `(scenes.length + junctionCount) / FPS`. A
 * one-scene, transition-free assembly keeps validateProbe()'s original tight
 * tolerance; a real multi-scene, multi-transition assembly gets exactly the
 * slack its own filter graph can legitimately need. A genuinely broken
 * render (wrong audio track, truncated/collapsed output, mismatched asset)
 * drifts by whole seconds, far outside even this widened bound, and still
 * fails closed.
 */
export function frameRoundingAllowance(
  scenes: VideoAssemblyInput["scenes"],
  concatManifestPath: string | null,
): number {
  if (concatManifestPath) return 0;
  const perSceneRetimingPoints = scenes.length;
  const junctionOffsetPoints = hasAnyBlendedJunction(scenes)
    ? Math.max(0, scenes.length - 1)
    : 0;
  return (perSceneRetimingPoints + junctionOffsetPoints) / FPS;
}

export function durationTolerance(duration: number) {
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

function requireSuccessfulProcess(result: ProcessRunResult, label = "ffmpeg") {
  if (
    result.exitCode !== 0 ||
    result.signal !== null ||
    result.timedOut ||
    result.failed
  ) {
    // Detailed cause for the server log only (the assemble() catch logs the
    // thrown error, then returns the opaque SAFE_ERROR to callers). stderr is
    // where ffmpeg/ffprobe explain themselves; keep only its tail so a
    // runaway log can't blow past maxStdioBytes here.
    const stderrTail =
      typeof result.stderr === "string" && result.stderr.trim().length > 0
        ? `; stderr=${result.stderr.slice(-2000)}`
        : "";
    throw new Error(
      `${label} process failed: exitCode=${String(result.exitCode)} ` +
        `signal=${String(result.signal)} timedOut=${result.timedOut} ` +
        `failed=${result.failed ?? false}${stderrTail}`,
    );
  }
}

function validateProbe(
  value: string,
  expectedDuration: number,
  extraTolerance = 0,
  sceneCount = 0,
) {
  const parsed = JSON.parse(value) as {
    format?: { format_name?: unknown; duration?: unknown };
    streams?: Array<Record<string, unknown>>;
  };
  const formatName = parsed.format?.format_name;
  const duration = Number(parsed.format?.duration);
  const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
  const videos = streams.filter((stream) => stream.codec_type === "video");
  const audios = streams.filter((stream) => stream.codec_type === "audio");
  const tolerance =
    Math.max(0.25, Math.min(1, expectedDuration * 0.001)) + extraTolerance;
  const videoDuration = Number(videos[0]?.duration);
  const audioDuration = Number(audios[0]?.duration);

  // Each failed check is named individually so the server log (see assemble()'s
  // catch) records exactly *why* an otherwise-successful render was rejected —
  // the single most common real cause is a duration just outside `tolerance`,
  // which was previously indistinguishable from a codec/dimension mismatch.
  // Behaviour is unchanged: any non-empty reason list still throws.
  const reasons: string[] = [];
  if (typeof formatName !== "string" || !formatName.split(",").includes("mp4")) {
    reasons.push(`format_name=${JSON.stringify(formatName)} (expected to include "mp4")`);
  }
  if (!Number.isFinite(duration) || duration <= 0) {
    reasons.push(`container duration=${parsed.format?.duration} (not a positive number)`);
  } else if (Math.abs(duration - expectedDuration) > tolerance) {
    reasons.push(
      `container duration=${duration}s vs expected≈${expectedDuration.toFixed(3)}s ` +
        `(Δ${Math.abs(duration - expectedDuration).toFixed(3)}s > tolerance ${tolerance.toFixed(3)}s)`,
    );
  }
  if (videos.length !== 1) reasons.push(`video stream count=${videos.length} (expected 1)`);
  if (audios.length !== 1) reasons.push(`audio stream count=${audios.length} (expected 1)`);
  if (videos[0] && videos[0].codec_name !== "h264") {
    reasons.push(`video codec=${String(videos[0].codec_name)} (expected h264)`);
  }
  if (videos[0] && (videos[0].width !== WIDTH || videos[0].height !== HEIGHT)) {
    reasons.push(`video dimensions=${String(videos[0].width)}x${String(videos[0].height)} (expected ${WIDTH}x${HEIGHT})`);
  }
  if (videos[0] && videos[0].pix_fmt !== "yuv420p") {
    reasons.push(`video pix_fmt=${String(videos[0].pix_fmt)} (expected yuv420p)`);
  }
  if (videos[0] && !isFrameRate(videos[0].avg_frame_rate, FPS)) {
    reasons.push(`video avg_frame_rate=${String(videos[0].avg_frame_rate)} (expected ${FPS} fps)`);
  }
  if (
    videos[0] && videos[0].disposition !== undefined &&
    (videos[0].disposition as Record<string, unknown>).attached_pic !== 0
  ) {
    reasons.push("video disposition.attached_pic != 0 (cover-art stream, not a real video track)");
  }
  if (audios[0] && audios[0].codec_name !== "aac") {
    reasons.push(`audio codec=${String(audios[0].codec_name)} (expected aac)`);
  }
  if (!Number.isFinite(videoDuration) || Math.abs(videoDuration - expectedDuration) > tolerance) {
    reasons.push(
      `video stream duration=${videos[0]?.duration} vs expected≈${expectedDuration.toFixed(3)}s ` +
        `(tolerance ${tolerance.toFixed(3)}s)`,
    );
  }
  if (!Number.isFinite(audioDuration) || Math.abs(audioDuration - expectedDuration) > tolerance) {
    reasons.push(
      `audio stream duration=${audios[0]?.duration} vs expected≈${expectedDuration.toFixed(3)}s ` +
        `(tolerance ${tolerance.toFixed(3)}s)`,
    );
  }
  if (Number.isFinite(videoDuration) && Number.isFinite(audioDuration)) {
    // On the retimed/transitioned paths this reuses extraTolerance
    // (frameRoundingAllowance()), for the same reason the other checks
    // above do: both streams are built by the same per-scene/per-junction
    // retiming and blend filters. On the zero-re-encode copy-concat path
    // (concatManifestPath set, extraTolerance passed in as 0 -- no retiming
    // filter runs there) that alone under-counts: canCopySceneVideos()'s own
    // precondition only guarantees each scene's pre-existing clip is within
    // 1/FPS of ITS OWN narration target individually, not that those
    // per-scene roundings cancel out -- copied straight through with no
    // retiming, they can accumulate across all sceneCount clips in the
    // concatenated video track, while the audio track is independently
    // atrim-cut to the precise (generally non-frame-aligned) segment
    // boundaries. sceneCount/FPS is that same already-audited per-scene
    // bound, summed -- not a new number.
    const skewTolerance = Math.max(1 / FPS + extraTolerance, sceneCount / FPS);
    if (Math.abs(videoDuration - audioDuration) > skewTolerance) {
      reasons.push(
        `audio/video skew=${Math.abs(videoDuration - audioDuration).toFixed(4)}s > ${skewTolerance.toFixed(4)}s`,
      );
    }
  }

  if (reasons.length > 0) {
    throw new Error(`video assembly output probe rejected: ${reasons.join("; ")}`);
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
