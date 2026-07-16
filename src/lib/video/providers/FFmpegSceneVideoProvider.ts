import fs from "node:fs";
import { ImageStorage } from "@/lib/assets/storage/ImageStorage";
import { VideoStorage } from "@/lib/assets/storage/VideoStorage";
import {
  createRuntimeStorageContext,
  resolveRuntimeLogicalPath,
  type RuntimeStorageContext,
} from "@/lib/runtime/RuntimeStoragePaths";
import {
  SpawnRunner,
  type ProcessRunResult,
  type VideoAssemblyProcessRunner,
} from "@/lib/assembly/providers/FFmpegVideoAssemblyProvider";
import { isAnimationMotionPlanScene } from "@/lib/animation/AnimationMotionPlanValidation";
import type { AnimationMotionFrame } from "@/types/animation";
import type {
  VideoGenerationInput,
  VideoGenerationResult,
  VideoProvider,
  VideoProviderSceneInput,
  VideoSceneGenerationSuccess,
} from "./VideoProvider";
import {
  getFFmpegSceneVideoConfig,
  type FFmpegSceneVideoConfig,
} from "./VideoProviderConfig";

const SAFE_ERROR = "Scene video generation failed.";
const WIDTH = 1920;
const HEIGHT = 1080;
const FRAME_RATE = 30;
const MAX_ZOOMPAN_ZOOM = 10;

export class FFmpegSceneVideoProvider implements VideoProvider {
  readonly name = "ffmpeg";

  constructor(
    private readonly runner: VideoAssemblyProcessRunner = new SpawnRunner(),
    private readonly loadConfig: () => FFmpegSceneVideoConfig =
      getFFmpegSceneVideoConfig,
    private readonly runtimeStorageContext?: RuntimeStorageContext,
  ) {}

  async generateVideo(input: VideoGenerationInput): Promise<VideoGenerationResult> {
    const paths: Array<ReturnType<typeof VideoStorage.createSceneRenderPaths>> = [];
    const context = this.runtimeStorageContext ?? createRuntimeStorageContext();

    try {
      validateBatch(input, context);
      const config = this.loadConfig();
      validateExecutable(config.ffmpegPath);
      validateExecutable(config.ffprobePath);
      const scenes: VideoSceneGenerationSuccess[] = [];

      for (const scene of input.scenes) {
        const renderPaths = VideoStorage.createSceneRenderPaths(
          input.projectSlug,
          scene.sceneId,
          context,
        );
        paths.push(renderPaths);
        const ffmpeg = await this.runner.run(
          config.ffmpegPath,
          buildSceneFFmpegArgs(scene, renderPaths.temporaryAbsolutePath, context),
          { timeoutMs: config.timeoutMs, maxOutputBytes: config.maxStdioBytes },
        );
        requireSuccessfulProcess(ffmpeg);
        const temporaryInspection = VideoStorage.inspectMp4(
          renderPaths.temporaryAbsolutePath,
          config.maxOutputBytes,
        );
        const probe = await this.runner.run(
          config.ffprobePath,
          buildSceneFFprobeArgs(renderPaths.temporaryAbsolutePath),
          { timeoutMs: config.timeoutMs, maxOutputBytes: config.maxStdioBytes },
        );
        requireSuccessfulProcess(probe);
        const durationSeconds = validateProbe(
          probe.stdout,
          scene.motionPlan.durationSeconds,
        );
        VideoStorage.finalize(
          renderPaths.temporaryAbsolutePath,
          renderPaths.absolutePath,
          context,
        );
        const finalInspection = VideoStorage.inspectStoredMp4(
          input.projectSlug,
          renderPaths.filePath,
          config.maxOutputBytes,
          context,
        );
        if (finalInspection.byteLength !== temporaryInspection.byteLength) {
          throw new Error(SAFE_ERROR);
        }

        scenes.push({
          sceneId: scene.sceneId,
          sourceImageAssetId: scene.sourceImageAssetId,
          animationAssetId: scene.animationAssetId,
          provider: "ffmpeg",
          model: "ffmpeg-scene-h264",
          generationMode: "production",
          filePath: renderPaths.filePath,
          url: renderPaths.url,
          mimeType: "video/mp4",
          byteLength: finalInspection.byteLength,
          durationSeconds,
          width: WIDTH,
          height: HEIGHT,
          frameRate: FRAME_RATE,
          transition: scene.motionPlan.transition,
          status: "generated",
          createdAt: new Date().toISOString(),
        });
      }

      return {
        success: true,
        provider: "ffmpeg",
        generationMode: "production",
        scenes,
      };
    } catch {
      for (const item of paths) {
        VideoStorage.removeIfExists(item.temporaryAbsolutePath, context);
        VideoStorage.removeIfExists(item.absolutePath, context);
      }
      return { success: false, provider: "ffmpeg", error: SAFE_ERROR };
    }
  }
}

function validateBatch(input: VideoGenerationInput, context: RuntimeStorageContext) {
  if (
    !input ||
    typeof input !== "object" ||
    !/^[a-zA-Z0-9-_]+$/.test(input.projectSlug) ||
    typeof input.projectId !== "string" ||
    !input.projectId.trim() ||
    !Array.isArray(input.scenes) ||
    input.scenes.length === 0
  ) {
    throw new Error(SAFE_ERROR);
  }
  const ids = new Set<number>();
  for (const scene of input.scenes) {
    if (
      !Number.isSafeInteger(scene.sceneId) ||
      scene.sceneId <= 0 ||
      ids.has(scene.sceneId) ||
      !isAnimationMotionPlanScene(scene.motionPlan) ||
      scene.motionPlan.sceneId !== scene.sceneId ||
      scene.motionPlan.sourceImageAssetId !== scene.sourceImageAssetId ||
      scene.motionPlan.animationAssetId !== scene.animationAssetId ||
      !isRenderableZoom(scene.motionPlan.start) ||
      !isRenderableZoom(scene.motionPlan.end) ||
      scene.imageMimeType === "image/mock" ||
      scene.imageFilePath.includes("\\")
    ) {
      throw new Error(SAFE_ERROR);
    }
    ImageStorage.inspectStoredImage(
      input.projectSlug,
      scene.imageFilePath,
      scene.imageMimeType,
      context,
    );
    ids.add(scene.sceneId);
  }
}

export function buildSceneFFmpegArgs(
  scene: VideoProviderSceneInput,
  outputPath: string,
  input?: RuntimeStorageContext,
) {
  const context = input ?? createRuntimeStorageContext();
  const duration = scene.motionPlan.durationSeconds.toFixed(6);
  const frames = Math.max(1, Math.round(scene.motionPlan.durationSeconds * FRAME_RATE));
  const filter = buildMotionFilter(
    scene.motionPlan.start,
    scene.motionPlan.end,
    scene.motionPlan.motionType === "static",
    frames,
  );
  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-nostdin",
    "-n",
    "-loop",
    "1",
    "-framerate",
    String(FRAME_RATE),
    "-t",
    duration,
    "-i",
    absoluteInput(scene.imageFilePath, context),
    "-vf",
    filter,
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
    String(FRAME_RATE),
    "-movflags",
    "+faststart",
    outputPath,
  ];
}

function buildMotionFilter(
  start: AnimationMotionFrame,
  end: AnimationMotionFrame,
  isStatic: boolean,
  frames: number,
) {
  const startZoom = zoomFor(start);
  const endZoom = isStatic ? startZoom : zoomFor(end);
  const startX = focusX(start);
  const endX = isStatic ? startX : focusX(end);
  const startY = focusY(start);
  const endY = isStatic ? startY : focusY(end);
  const outputSpanSeconds = (frames - 1) / FRAME_RATE;
  const progress =
    frames <= 1 || isStatic
      ? "0"
      : `min(max(ot/${outputSpanSeconds.toFixed(9)},0),1)`;
  const zoom = interpolate(startZoom, endZoom, progress);
  const x = interpolate(startX, endX, progress);
  const y = interpolate(startY, endY, progress);
  return [
    `scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase`,
    `crop=${WIDTH}:${HEIGHT}`,
    `zoompan=z='${zoom}':x='(iw-iw/zoom)*(${x})':y='(ih-ih/zoom)*(${y})':d=1:s=${WIDTH}x${HEIGHT}:fps=${FRAME_RATE}`,
    "format=yuv420p",
  ].join(",");
}

function zoomFor(frame: AnimationMotionFrame) {
  return frame.transform.scale / Math.min(frame.crop.width, frame.crop.height);
}

function isRenderableZoom(frame: AnimationMotionFrame) {
  const zoom = zoomFor(frame);
  return Number.isFinite(zoom) && zoom >= 1 && zoom <= MAX_ZOOMPAN_ZOOM;
}

function focusX(frame: AnimationMotionFrame) {
  return clamp(frame.crop.x + frame.crop.width / 2 + frame.transform.translateX / 2);
}

function focusY(frame: AnimationMotionFrame) {
  return clamp(frame.crop.y + frame.crop.height / 2 + frame.transform.translateY / 2);
}

function clamp(value: number) {
  return Math.min(1, Math.max(0, value));
}

function interpolate(start: number, end: number, progress: string) {
  return `(${start.toFixed(9)}+${(end - start).toFixed(9)}*${progress})`;
}

function buildSceneFFprobeArgs(outputPath: string) {
  return [
    "-v",
    "error",
    "-show_entries",
    "format=format_name,duration:stream=codec_type,codec_name,width,height,pix_fmt,avg_frame_rate",
    "-of",
    "json",
    outputPath,
  ];
}

function validateProbe(value: string, expectedDuration: number) {
  const parsed = JSON.parse(value) as {
    format?: { format_name?: unknown; duration?: unknown };
    streams?: Array<Record<string, unknown>>;
  };
  const duration = Number(parsed.format?.duration);
  const formatName = parsed.format?.format_name;
  const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
  const videos = streams.filter((stream) => stream.codec_type === "video");
  const audios = streams.filter((stream) => stream.codec_type === "audio");
  const tolerance = Math.max(0.25, Math.min(1, expectedDuration * 0.001));
  if (
    typeof formatName !== "string" ||
    !formatName.split(",").includes("mp4") ||
    !Number.isFinite(duration) ||
    duration <= 0 ||
    Math.abs(duration - expectedDuration) > tolerance ||
    videos.length !== 1 ||
    audios.length !== 0 ||
    videos[0].codec_name !== "h264" ||
    videos[0].width !== WIDTH ||
    videos[0].height !== HEIGHT ||
    videos[0].pix_fmt !== "yuv420p" ||
    videos[0].avg_frame_rate !== `${FRAME_RATE}/1`
  ) {
    throw new Error(SAFE_ERROR);
  }
  return duration;
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

function validateExecutable(executable: string) {
  const stat = fs.statSync(executable);
  if (!stat.isFile()) throw new Error(SAFE_ERROR);
  fs.accessSync(executable, fs.constants.X_OK);
}

function absoluteInput(relativePath: string, context: RuntimeStorageContext) {
  return resolveRuntimeLogicalPath(relativePath, context);
}
