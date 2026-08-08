import assert from "node:assert/strict";
import { emitSmokeResult } from "./lib/SmokeResult";
import { EventEmitter } from "node:events";
import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { PassThrough } from "node:stream";
import { deflateSync } from "node:zlib";
import { withCanonicalSmokeRuntime } from "./lib/CanonicalSmokeRuntime";
import { ImageStorage } from "../src/lib/assets/storage/ImageStorage";
import { VideoStorage } from "../src/lib/assets/storage/VideoStorage";
import { AssetManager } from "../src/lib/assets/AssetManager";
import { createProviderDispatchAdapter } from "../src/lib/providers/ProviderDispatchAdapterAuthority";
import {
  SpawnRunner,
  type VideoAssemblyChildProcess,
  type VideoAssemblyProcessRunner,
  type VideoAssemblySpawn,
} from "../src/lib/assembly/providers/FFmpegVideoAssemblyProvider";
import {
  FFmpegSceneVideoProvider,
  buildSceneFFmpegArgs,
} from "../src/lib/video/providers/FFmpegSceneVideoProvider";
import {
  getFFmpegSceneVideoConfig,
  resolveVideoProviderName,
  type FFmpegSceneVideoConfig,
} from "../src/lib/video/providers/VideoProviderConfig";
import { MockVideoProvider } from "../src/lib/video/providers/MockVideoProvider";
import type {
  VideoGenerationInput,
  VideoGenerationResult,
  VideoProvider,
  VideoSceneGenerationSuccess,
} from "../src/lib/video/providers/VideoProvider";
import { isCompatibleVideoData } from "../src/lib/video/VideoDataValidation";
import { VideoPipeline } from "../src/lib/video/VideoPipeline";
import { PipelineJobManager } from "../src/lib/pipeline/PipelineJobManager";
import { PipelineQueueScheduler } from "../src/lib/pipeline/PipelineQueueScheduler";
import { PipelineRunner } from "../src/lib/pipeline/PipelineRunner";
import {
  PipelineStageExecutor,
  type PipelineExecutionState,
} from "../src/lib/pipeline/PipelineStageExecutor";
import { ProjectManager } from "../src/lib/projects/ProjectManager";
import type { AnimationData, AnimationMotionPlanScene, AnimationMotionType } from "../src/types/animation";
import type { Asset } from "../src/types/asset";
import type { ProductionStepKey, ProjectPackageRunType } from "../src/types/project";

type RunnerHarness = {
  runStageLegacy(
    slug: string,
    stage: ProductionStepKey,
    action: () => Promise<boolean>,
    runType: ProjectPackageRunType,
  ): Promise<boolean>;
};

let prefix: string;
let temporaryRuntimeRoot: string;
let projectsRoot: string;
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
let scenarios = 0;

async function scenario(name: string, run: () => void | Promise<void>) {
  await run();
  scenarios += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${scenarios}: ${name}`);
}

function frame(scale: number, x = 0, y = 0) {
  return {
    crop: { x, y, width: 0.8, height: 0.8 },
    transform: { scale, translateX: 0, translateY: 0 },
  };
}

function plan(
  sceneId: number,
  imageId: string,
  animationId: string,
  motionType: AnimationMotionType = "zoom-in",
): AnimationMotionPlanScene {
  return {
    sceneId,
    animationPrompt: `motion ${sceneId}`,
    sourceImageAssetId: imageId,
    outputAssetId: animationId,
    animationAssetId: animationId,
    durationSeconds: 2,
    motionType,
    start: frame(1, 0.1, 0.1),
    end: motionType === "static" ? frame(1, 0.1, 0.1) : frame(1.2, 0.15, 0.1),
    transition: "fade",
    provider: "mock",
    model: "mock-animation-model",
    generationMode: "mock",
    artifactType: "motion-plan",
    status: "generated",
  };
}

async function fixture(
  suffix: string,
  motions: AnimationMotionType[] = ["zoom-in"],
  imageMode: "mock" | "production" = "mock",
) {
  const slug = `${prefix}-${suffix}`;
  const project = await ProjectManager.createProject(slug);
  const assets: Asset[] = [];
  const plans: AnimationMotionPlanScene[] = [];
  for (let index = 0; index < motions.length; index += 1) {
    const sceneId = index + 1;
    const imageId = `${slug}-image-${sceneId}`;
    let filePath = "";
    let url = "";
    let mimeType: "image/mock" | "image/png" = "image/mock";
    if (imageMode === "production") {
      const saved = ImageStorage.saveImage({
        projectSlug: slug,
        data: png,
        assetId: imageId,
        mimeType: "image/png",
      });
      filePath = saved.filePath;
      url = saved.url;
      mimeType = "image/png";
    }
    assets.push(
      AssetManager.createAsset({
        id: imageId,
        projectId: project.id,
        projectSlug: slug,
        sceneId,
        type: "image",
        status: "generated",
        provider: imageMode === "mock" ? "mock" : "openai",
        prompt: `image ${sceneId}`,
        filePath,
        url,
        mimeType,
      }),
    );
    const animationId = `${slug}-animation-${sceneId}`;
    const motionPlan = plan(sceneId, imageId, animationId, motions[index]);
    plans.push(motionPlan);
    assets.push(
      AssetManager.createAsset({
        id: animationId,
        projectId: project.id,
        projectSlug: slug,
        sceneId,
        type: "animation",
        status: "generated",
        provider: "mock",
        model: "mock-animation-model",
        prompt: motionPlan.animationPrompt,
        mimeType: "application/vnd.atolye.motion-plan+json",
        durationSeconds: motionPlan.durationSeconds,
        artifactType: "motion-plan",
        sourceAssetId: imageId,
        generationMode: "mock",
      }),
    );
  }
  const now = new Date().toISOString();
  AssetManager.saveProjectAssets(slug, {
    projectId: project.id,
    projectSlug: slug,
    assets,
    createdAt: now,
    updatedAt: now,
  });
  const animation: AnimationData = {
    projectId: project.id,
    schemaVersion: "2",
    artifactType: "motion-plan",
    scenes: plans,
    createdAt: now,
  };
  return {
    slug,
    project,
    animation,
    plans,
    assetsPath: path.join(temporaryRuntimeRoot,
      path.relative("data", AssetManager.getAssetsPath(slug))),
  };
}

function provider(
  name: string,
  generate: (input: VideoGenerationInput) => VideoGenerationResult | Promise<VideoGenerationResult>,
): VideoProvider {
  const value: VideoProvider = { name, generateVideo: async (input) => generate(input) };
  Object.defineProperty(value, "createImmutableVideoDispatchAdapter", {
    enumerable: false, configurable: false, writable: false,
    value: () => createProviderDispatchAdapter(value, {
      metadata: { name: value.name }, requiredMethods: ["generateVideo"],
    }),
  });
  return value;
}

function validMock(input: VideoGenerationInput) {
  return new MockVideoProvider().generateVideo(input);
}

function mp4() {
  const box = (type: string, payload = Buffer.alloc(0)) => {
    const header = Buffer.alloc(8);
    header.writeUInt32BE(8 + payload.length, 0);
    header.write(type, 4, 4, "ascii");
    return Buffer.concat([header, payload]);
  };
  return Buffer.concat([box("ftyp", Buffer.from("isom0000")), box("moov"), box("mdat", Buffer.from([1]))]);
}

const edgeColors = {
  top: [230, 30, 30],
  bottom: [30, 230, 30],
  left: [30, 30, 230],
  right: [230, 230, 30],
  topLeft: [230, 30, 230],
  topRight: [30, 230, 230],
  bottomLeft: [230, 120, 30],
  bottomRight: [230, 230, 230],
} as const;

function markedPng(width: number, height: number) {
  const pixels = Buffer.alloc((width * 3 + 1) * height);
  const edge = Math.max(8, Math.floor(Math.min(width, height) * 0.06));
  const corner = edge * 2;
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 3 + 1);
    for (let x = 0; x < width; x += 1) {
      let color: readonly number[] = [70, 70, 70];
      if (y < edge) color = edgeColors.top;
      else if (y >= height - edge) color = edgeColors.bottom;
      else if (x < edge) color = edgeColors.left;
      else if (x >= width - edge) color = edgeColors.right;
      if (x < corner && y < corner) color = edgeColors.topLeft;
      else if (x >= width - corner && y < corner) color = edgeColors.topRight;
      else if (x < corner && y >= height - corner) color = edgeColors.bottomLeft;
      else if (x >= width - corner && y >= height - corner) color = edgeColors.bottomRight;
      const offset = row + 1 + x * 3;
      pixels[offset] = color[0];
      pixels[offset + 1] = color[1];
      pixels[offset + 2] = color[2];
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(pixels)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function pngChunk(type: string, data: Buffer) {
  const name = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

function crc32(value: Buffer) {
  let crc = 0xffffffff;
  for (const byte of value) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function filterGraph(args: readonly string[]) {
  const index = args.indexOf("-filter_complex");
  assert.ok(index >= 0);
  return args[index + 1];
}

async function readFirstFrame(
  runner: VideoAssemblyProcessRunner,
  selectedConfig: FFmpegSceneVideoConfig,
  videoPath: string,
  suffix: string,
) {
  const rawPath = path.join(temporaryRuntimeRoot, `scene-video-frame-${suffix}.rgb`);
  const result = await runner.run(selectedConfig.ffmpegPath, [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-n",
    "-i", videoPath, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", rawPath,
  ], { timeoutMs: selectedConfig.timeoutMs, maxOutputBytes: selectedConfig.maxStdioBytes });
  assert.equal(result.exitCode, 0);
  assert.equal(result.signal, null);
  assert.equal(result.timedOut, false);
  const frame = await fs.readFile(rawPath);
  assert.equal(frame.byteLength, 1920 * 1080 * 3);
  return frame;
}

class ActualProcessRunner implements VideoAssemblyProcessRunner {
  readonly diagnostics: string[] = [];

  async run(executable: string, args: readonly string[], options: { timeoutMs: number;
    maxOutputBytes: number }) {
    const result = spawnSync(executable, [...args], {
      encoding: "utf8",
      maxBuffer: options.maxOutputBytes,
      shell: false,
      timeout: options.timeoutMs,
      windowsHide: true,
    });
    this.diagnostics.push(result.stderr ?? "");
    return {
      exitCode: result.status,
      signal: result.signal as NodeJS.Signals | null,
      stdout: result.stdout ?? "",
      timedOut: Boolean(result.error && "code" in result.error && result.error.code === "ETIMEDOUT"),
      failed: Boolean(result.error),
    };
  }
}

function assertFullFrameMarkers(
  frame: Buffer,
  sourceWidth: number,
  sourceHeight: number,
) {
  const fit = Math.min(1920 / sourceWidth, 1080 / sourceHeight);
  const width = Math.floor(sourceWidth * fit / 2) * 2;
  const height = Math.floor(sourceHeight * fit / 2) * 2;
  const left = Math.floor((1920 - width) / 2);
  const top = Math.floor((1080 - height) / 2);
  const right = left + width - 1;
  const bottom = top + height - 1;
  const inset = Math.max(8, Math.floor(Math.min(width, height) * 0.015));
  const centerX = Math.floor((left + right) / 2);
  const centerY = Math.floor((top + bottom) / 2);
  assertColor(pixel(frame, centerX, top + inset), "red");
  assertColor(pixel(frame, centerX, bottom - inset), "green");
  assertColor(pixel(frame, left + inset, centerY), "blue");
  assertColor(pixel(frame, right - inset, centerY), "yellow");
  assertColor(pixel(frame, left + inset, top + inset), "magenta");
  assertColor(pixel(frame, right - inset, top + inset), "cyan");
  assertColor(pixel(frame, left + inset, bottom - inset), "orange");
  assertColor(pixel(frame, right - inset, bottom - inset), "white");
}

function pixel(frame: Buffer, x: number, y: number) {
  const offset = (y * 1920 + x) * 3;
  return [frame[offset], frame[offset + 1], frame[offset + 2]] as const;
}

function assertColor(
  [red, green, blue]: readonly [number, number, number],
  expected: "red" | "green" | "blue" | "yellow" | "magenta" | "cyan" | "orange" | "white",
) {
  const dominant = 35;
  const bright = 135;
  if (expected === "red") assert.ok(red > bright && red > green + dominant && red > blue + dominant);
  if (expected === "green") assert.ok(green > bright && green > red + dominant && green > blue + dominant);
  if (expected === "blue") assert.ok(blue > bright && blue > red + dominant && blue > green + dominant);
  if (expected === "yellow") assert.ok(red > bright && green > bright && blue < 120);
  if (expected === "magenta") assert.ok(red > bright && blue > bright && green < 120);
  if (expected === "cyan") assert.ok(green > bright && blue > bright && red < 120);
  if (expected === "orange") assert.ok(red > bright && green > 55 && green < 190 && blue < 120);
  if (expected === "white") assert.ok(red > bright && green > bright && blue > bright);
}

function config(): FFmpegSceneVideoConfig {
  const second = process.env.ComSpec ?? path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "cmd.exe");
  return {
    ffmpegPath: process.execPath,
    ffprobePath: second,
    timeoutMs: 1_000,
    maxOutputBytes: 1024 * 1024,
    maxStdioBytes: 1024 * 1024,
  };
}

class RenderingRunner implements VideoAssemblyProcessRunner {
  readonly ffmpegArgs: string[][] = [];
  private durations: number[] = [];
  constructor(private readonly selectedConfig = config()) {}
  async run(executable: string, args: readonly string[]) {
    if (executable === this.selectedConfig.ffmpegPath) {
      const values = [...args];
      this.ffmpegArgs.push(values);
      const duration = Number(values[values.indexOf("-t") + 1]);
      this.durations.push(duration);
      await fs.writeFile(values.at(-1) as string, mp4());
      return { exitCode: 0, signal: null, stdout: "", timedOut: false };
    }
    const duration = this.durations.shift() as number;
    return {
      exitCode: 0,
      signal: null,
      timedOut: false,
      stdout: JSON.stringify({
        format: { format_name: "mov,mp4", duration: String(duration) },
        streams: [{ codec_type: "video", codec_name: "h264", width: 1920, height: 1080, pix_fmt: "yuv420p", avg_frame_rate: "30/1" }],
      }),
    };
  }
}

class FakeChild extends EventEmitter implements VideoAssemblyChildProcess {
  stdout = new PassThrough();
  stderr = new PassThrough();
  kills: string[] = [];
  unrefs = 0;
  kill(signal: NodeJS.Signals) { this.kills.push(signal); return true; }
  unref() { this.unrefs += 1; }
}

async function run() {
  try {
    await scenario("provider config is mock-first and unknown values fail closed", () => {
      assert.equal(resolveVideoProviderName(undefined), "mock");
      assert.equal(resolveVideoProviderName("  "), "mock");
      assert.equal(resolveVideoProviderName("ffmpeg"), "ffmpeg");
      assert.throws(() => resolveVideoProviderName("cloud"));
    });

    await scenario("mock provider preserves deterministic non-physical scene sentinels", async () => {
      const value = await fixture("mock", ["static", "zoom-in"]);
      const first = await VideoPipeline.generateVideo({ projectId: value.project.id, projectSlug: value.slug, animation: value.animation });
      const secondProvider = new MockVideoProvider();
      const input = { projectId: value.project.id, projectSlug: value.slug, scenes: [] };
      assert.deepEqual(await secondProvider.generateVideo(input), await secondProvider.generateVideo(input));
      assert.equal(first.video.schemaVersion, "2");
      assert.equal(first.video.scenes.length, 2);
      assert.ok(first.video.scenes.every((scene) => scene.mimeType === "video/mock" && scene.filePath === "" && scene.url === "" && scene.generationMode === "mock"));
      assert.notEqual(first.video.scenes[0].videoAssetId, first.video.scenes[1].videoAssetId);
    });

    await scenario("all supported motion types produce separate physical MP4 scene assets", async () => {
      const motions: AnimationMotionType[] = ["static", "zoom-in", "zoom-out", "pan-left", "pan-right"];
      const value = await fixture("physical", motions, "production");
      const runner = new RenderingRunner();
      const selectedConfig = config();
      const result = await VideoPipeline.generateVideo({
        projectId: value.project.id,
        projectSlug: value.slug,
        animation: value.animation,
        provider: new FFmpegSceneVideoProvider(runner, () => selectedConfig),
      });
      assert.equal(result.video.scenes.length, motions.length);
      assert.equal(new Set(result.video.scenes.map((scene) => scene.filePath)).size, motions.length);
      assert.equal(new Set(result.video.scenes.map((scene) => scene.videoAssetId)).size, motions.length);
      assert.ok(result.video.scenes.every((scene) => scene.mimeType === "video/mp4" && scene.generationMode === "production" && scene.width === 1920 && scene.height === 1080 && scene.frameRate === 30));
      assert.ok(runner.ffmpegArgs.every((args) => args.includes("-an") && args.includes("yuv420p") && args.includes("libx264")));
    });

    await scenario("motion filters use start/end plans and keep transition as metadata", () => {
      const motionPlan = plan(1, "image", "animation", "pan-right");
      const args = buildSceneFFmpegArgs({ sceneId: 1, sourceImageAssetId: "image", animationAssetId: "animation", imageFilePath: "data/projects/x/assets/images/x.png", imageMimeType: "image/png", motionPlan }, "out.mp4");
      const filter = filterGraph(args);
      assert.match(filter, /zoompan/);
      assert.match(filter, /ot\/1\.966666667/);
      assert.match(filter, /:d=1:/);
      assert.ok(args.includes("[scene]"));
      assert.equal(args.includes("fade"), false);
    });

    await scenario("authoritative foreground is contained while motion remains background-only", () => {
      const motionPlan = plan(1, "image", "animation", "zoom-in");
      const args = buildSceneFFmpegArgs({ sceneId: 1, sourceImageAssetId: "image", animationAssetId: "animation", imageFilePath: "data/projects/x/assets/images/x.png", imageMimeType: "image/png", motionPlan }, "out.mp4");
      const filter = filterGraph(args);
      const chains = filter.split(";");
      const background = chains.find((chain) => chain.startsWith("[backgroundSource]"));
      const foreground = chains.find((chain) => chain.startsWith("[foregroundSource]"));
      const composite = chains.find((chain) => chain.startsWith("[backgroundMotion]"));
      assert.ok(background && foreground && composite);
      assert.match(background, /force_original_aspect_ratio=increase/);
      assert.match(background, /crop=1920:1080/);
      assert.match(background, /zoompan=/);
      assert.match(background, /boxblur=20:2/);
      assert.match(foreground, /scale=1920:1080:force_original_aspect_ratio=decrease:force_divisible_by=2/);
      assert.doesNotMatch(foreground, /crop|zoompan/);
      assert.match(composite, /overlay=x='\(W-w\)\/2':y='\(H-h\)\/2'/);
      assert.match(composite, /format=yuv420p\[scene\]/);
    });

    await scenario("real square landscape portrait and motion renders retain every source edge", async () => {
      const selectedConfig = getFFmpegSceneVideoConfig();
      const runner = new ActualProcessRunner();
      const slug = `${prefix}-full-frame-pixels`;
      const project = await ProjectManager.createProject(slug);
      const specs = [
        { width: 256, height: 256, motion: "static" as const },
        { width: 320, height: 180, motion: "zoom-in" as const },
        { width: 192, height: 320, motion: "zoom-out" as const },
        { width: 256, height: 256, motion: "pan-left" as const },
        { width: 256, height: 256, motion: "pan-right" as const, extreme: true },
      ];
      const scenes = specs.map((spec, index) => {
        const sceneId = index + 1;
        const imageId = `edge-image-${sceneId}`;
        const animationId = `edge-animation-${sceneId}`;
        const image = ImageStorage.saveImage({
          projectSlug: slug,
          assetId: imageId,
          data: markedPng(spec.width, spec.height),
          mimeType: "image/png",
        });
        const motionPlan = plan(sceneId, imageId, animationId, spec.motion);
        motionPlan.durationSeconds = 1;
        if (spec.motion === "pan-left") {
          motionPlan.start.transform.translateX = -1;
          motionPlan.start.transform.translateY = 1;
          motionPlan.end.transform.translateX = 1;
          motionPlan.end.transform.translateY = -1;
        }
        if (spec.extreme) {
          motionPlan.start = {
            crop: { x: 0, y: 0, width: 0.2, height: 0.2 },
            transform: { scale: 2, translateX: -1, translateY: -1 },
          };
          motionPlan.end = {
            crop: { x: 0.8, y: 0.8, width: 0.2, height: 0.2 },
            transform: { scale: 2, translateX: 1, translateY: 1 },
          };
          const graph = filterGraph(buildSceneFFmpegArgs({
            sceneId, sourceImageAssetId: imageId, animationAssetId: animationId,
            imageFilePath: image.filePath, imageMimeType: "image/png", motionPlan,
          }, "extreme.mp4"));
          assert.match(graph, /10\.000000000/);
          assert.doesNotMatch(graph, /NaN|Infinity/);
        }
        return {
          sceneId,
          sourceImageAssetId: imageId,
          animationAssetId: animationId,
          imageFilePath: image.filePath,
          imageMimeType: "image/png" as const,
          motionPlan,
        };
      });
      const result = await new FFmpegSceneVideoProvider(runner, () => selectedConfig).generateVideo({
        projectId: project.id,
        projectSlug: slug,
        scenes,
      });
      assert.equal(result.success, true, runner.diagnostics.filter(Boolean).join("\n"));
      if (!result.success) return;
      assert.equal(result.scenes.length, specs.length);
      for (let index = 0; index < result.scenes.length; index += 1) {
        const rendered: VideoSceneGenerationSuccess = result.scenes[index];
        assert.equal(rendered.width, 1920);
        assert.equal(rendered.height, 1080);
        assert.equal(rendered.frameRate, 30);
        assert.equal(rendered.durationSeconds, 1);
        const absoluteVideo = path.join(temporaryRuntimeRoot, path.relative("data", rendered.filePath));
        const frame = await readFirstFrame(runner, selectedConfig, absoluteVideo, String(index + 1));
        assertFullFrameMarkers(frame, specs[index].width, specs[index].height);
      }
    });

    await scenario("minimum and maximum durations produce bounded non-zero frame spans", () => {
      const minimum = plan(1, "image", "animation", "zoom-in");
      minimum.durationSeconds = 1;
      const minimumArgs = buildSceneFFmpegArgs({ sceneId: 1, sourceImageAssetId: "image", animationAssetId: "animation", imageFilePath: "data/projects/x/assets/images/x.png", imageMimeType: "image/png", motionPlan: minimum }, "minimum.mp4");
      assert.match(filterGraph(minimumArgs), /ot\/0\.966666667/);
      assert.equal(minimumArgs[minimumArgs.indexOf("-t") + 1], "1.000000");

      const maximum = plan(1, "image", "animation", "zoom-in");
      maximum.durationSeconds = 300;
      const maximumArgs = buildSceneFFmpegArgs({ sceneId: 1, sourceImageAssetId: "image", animationAssetId: "animation", imageFilePath: "data/projects/x/assets/images/x.png", imageMimeType: "image/png", motionPlan: maximum }, "maximum.mp4");
      assert.match(filterGraph(maximumArgs), /ot\/299\.966666667/);
      assert.equal(maximumArgs[maximumArgs.indexOf("-t") + 1], "300.000000");
    });

    await scenario("FFmpeg zoompan-incompatible crop and scale fail before rendering", async () => {
      const value = await fixture("zoompan-limit", ["zoom-in"], "production");
      value.plans[0].start = {
        crop: { x: 0, y: 0, width: 0.1, height: 0.1 },
        transform: { scale: 2, translateX: 0, translateY: 0 },
      };
      value.plans[0].end = value.plans[0].start;
      const runner = new RenderingRunner();
      const result = await new FFmpegSceneVideoProvider(runner, config).generateVideo({
        projectId: value.project.id,
        projectSlug: value.slug,
        scenes: [{ sceneId: 1, sourceImageAssetId: value.plans[0].sourceImageAssetId, animationAssetId: value.plans[0].animationAssetId, imageFilePath: AssetManager.getProjectAssets(value.slug, value.project.id).assets[0].filePath as string, imageMimeType: "image/png", motionPlan: value.plans[0] }],
      });
      assert.equal(result.success, false);
      assert.equal(runner.ffmpegArgs.length, 0);
    });

    await scenario("invalid focus and non-finite motion fail before FFmpeg admission", async () => {
      const mutations = [
        (motion: AnimationMotionPlanScene) => { motion.start.crop.x = 0.9; },
        (motion: AnimationMotionPlanScene) => { motion.start.transform.translateX = Number.NaN; },
        (motion: AnimationMotionPlanScene) => { motion.end.transform.translateY = Number.POSITIVE_INFINITY; },
      ];
      for (let index = 0; index < mutations.length; index += 1) {
        const value = await fixture(`invalid-motion-${index}`, ["pan-right"], "production");
        mutations[index](value.plans[0]);
        const runner = new RenderingRunner();
        const image = AssetManager.getProjectAssets(value.slug, value.project.id).assets[0];
        const result = await new FFmpegSceneVideoProvider(runner, config).generateVideo({
          projectId: value.project.id,
          projectSlug: value.slug,
          scenes: [{
            sceneId: 1,
            sourceImageAssetId: value.plans[0].sourceImageAssetId,
            animationAssetId: value.plans[0].animationAssetId,
            imageFilePath: image.filePath as string,
            imageMimeType: "image/png",
            motionPlan: value.plans[0],
          }],
        });
        assert.equal(result.success, false);
        assert.equal(runner.ffmpegArgs.length, 0);
      }
    });

    for (const [name, mutate] of [
      ["missing image", (value: Awaited<ReturnType<typeof fixture>>) => { value.animation.scenes[0].sourceImageAssetId = "missing"; }],
      ["source image mismatch", (value: Awaited<ReturnType<typeof fixture>>) => { (value.animation.scenes[0] as AnimationMotionPlanScene).sourceImageAssetId = value.assetsPath; }],
      ["animation asset mismatch", (value: Awaited<ReturnType<typeof fixture>>) => { (value.animation.scenes[0] as AnimationMotionPlanScene).animationAssetId = "wrong"; (value.animation.scenes[0] as AnimationMotionPlanScene).outputAssetId = "wrong"; }],
    ] as const) {
      await scenario(`${name} fails before provider calls`, async () => {
        const value = await fixture(name.replaceAll(" ", "-"));
        mutate(value);
        let calls = 0;
        await assert.rejects(VideoPipeline.generateVideo({ projectId: value.project.id, projectSlug: value.slug, animation: value.animation, provider: provider("mock", async (input) => { calls += 1; return validMock(input); }) }));
        assert.equal(calls, 0);
      });
    }

    await scenario("missing motion-plan registry asset fails before provider calls", async () => {
      const value = await fixture("missing-motion");
      const current = AssetManager.getProjectAssets(value.slug, value.project.id);
      AssetManager.saveProjectAssets(value.slug, { ...current, assets: current.assets.filter((asset) => asset.type !== "animation") });
      let calls = 0;
      await assert.rejects(VideoPipeline.generateVideo({ projectId: value.project.id, projectSlug: value.slug, animation: value.animation, provider: provider("mock", async (input) => { calls += 1; return validMock(input); }) }));
      assert.equal(calls, 0);
    });

    await scenario("legacy placeholder animation and duplicate scene input fail closed", async () => {
      const value = await fixture("legacy-duplicate");
      const legacy: AnimationData = { projectId: value.project.id, scenes: [{ sceneId: 1, animationPrompt: "legacy", outputAssetId: "legacy", status: "generated" }], createdAt: new Date().toISOString() };
      await assert.rejects(VideoPipeline.generateVideo({ projectId: value.project.id, projectSlug: value.slug, animation: legacy }));
      value.animation.scenes.push(value.animation.scenes[0]);
      await assert.rejects(VideoPipeline.generateVideo({ projectId: value.project.id, projectSlug: value.slug, animation: value.animation }));
    });

    await scenario("retry history selects latest matching image and active motion plan", async () => {
      const value = await fixture("retry");
      const current = AssetManager.getProjectAssets(value.slug, value.project.id);
      const oldImage = { ...current.assets[0], id: "old-image", createdAt: "2000-01-01T00:00:00.000Z" };
      const oldMotion = { ...current.assets[1], id: "old-motion", sourceAssetId: "old-image", createdAt: "2000-01-01T00:00:00.000Z" };
      AssetManager.saveProjectAssets(value.slug, { ...current, assets: [oldImage, oldMotion, ...current.assets] });
      const result = await VideoPipeline.generateVideo({ projectId: value.project.id, projectSlug: value.slug, animation: value.animation });
      assert.equal(result.video.scenes[0].sourceImageAssetId, value.plans[0].sourceImageAssetId);
      assert.equal(result.video.scenes[0].animationAssetId, value.plans[0].animationAssetId);
    });

    await scenario("provider missing extra duplicate and malformed results write no registry assets", async () => {
      for (const suffix of ["missing", "extra", "duplicate", "malformed"]) {
        const value = await fixture(`provider-${suffix}`, ["zoom-in", "zoom-out"]);
        const before = await fs.readFile(value.assetsPath, "utf8");
        await assert.rejects(VideoPipeline.generateVideo({
          projectId: value.project.id,
          projectSlug: value.slug,
          animation: value.animation,
          provider: provider("mock", async (input) => {
            const result = await validMock(input);
            if (!result.success) return result;
            if (suffix === "missing") return { ...result, scenes: result.scenes.slice(0, 1) };
            if (suffix === "extra") return { ...result, scenes: [...result.scenes, { ...result.scenes[0], sceneId: 99 }] };
            if (suffix === "duplicate") return { ...result, scenes: [result.scenes[0], result.scenes[0]] };
            return { ...result, scenes: [{ ...result.scenes[0], mimeType: "video/mp4" }, result.scenes[1]] } as VideoGenerationResult;
          }),
        }));
        assert.equal(await fs.readFile(value.assetsPath, "utf8"), before);
      }
    });

    await scenario("production provider cannot reuse one physical MP4 for multiple scenes", async () => {
      const value = await fixture("provider-shared-output", ["zoom-in", "zoom-out"], "production");
      const before = await fs.readFile(value.assetsPath, "utf8");
      await assert.rejects(VideoPipeline.generateVideo({
        projectId: value.project.id,
        projectSlug: value.slug,
        animation: value.animation,
        provider: provider("ffmpeg", async (input) => {
          const paths = VideoStorage.createSceneRenderPaths(value.slug, 1);
          const data = mp4();
          await fs.writeFile(paths.temporaryAbsolutePath, data);
          VideoStorage.finalize(paths.temporaryAbsolutePath, paths.absolutePath);
          return {
            success: true,
            provider: "ffmpeg",
            generationMode: "production",
            scenes: input.scenes.map((scene) => ({
              sceneId: scene.sceneId,
              sourceImageAssetId: scene.sourceImageAssetId,
              animationAssetId: scene.animationAssetId,
              provider: "ffmpeg",
              model: "ffmpeg-scene-h264",
              generationMode: "production",
              filePath: paths.filePath,
              url: paths.url,
              mimeType: "video/mp4",
              byteLength: data.byteLength,
              durationSeconds: scene.motionPlan.durationSeconds,
              width: 1920,
              height: 1080,
              frameRate: 30,
              transition: scene.motionPlan.transition,
              status: "generated",
              createdAt: new Date().toISOString(),
            })),
          };
        }),
      }));
      assert.equal(await fs.readFile(value.assetsPath, "utf8"), before);
    });

    await scenario("production MIME path URL slug and filename mismatches fail before registry write", async () => {
      for (const mismatch of ["mime", "path", "url"] as const) {
        const value = await fixture(`locator-${mismatch}`, ["zoom-in"], "production");
        const before = await fs.readFile(value.assetsPath, "utf8");
        await assert.rejects(VideoPipeline.generateVideo({
          projectId: value.project.id,
          projectSlug: value.slug,
          animation: value.animation,
          provider: provider("ffmpeg", async (input) => {
            const paths = VideoStorage.createSceneRenderPaths(value.slug, 1);
            await fs.writeFile(paths.temporaryAbsolutePath, mp4());
            VideoStorage.finalize(paths.temporaryAbsolutePath, paths.absolutePath);
            return {
              success: true,
              provider: "ffmpeg",
              generationMode: "production",
              scenes: [{
                sceneId: 1,
                sourceImageAssetId: input.scenes[0].sourceImageAssetId,
                animationAssetId: input.scenes[0].animationAssetId,
                provider: "ffmpeg",
                model: "ffmpeg-scene-h264",
                generationMode: "production",
                filePath: mismatch === "path" ? `${paths.filePath}.wrong` : paths.filePath,
                url: mismatch === "url" ? `${paths.url}-wrong` : paths.url,
                mimeType: mismatch === "mime" ? "video/mock" : "video/mp4",
                byteLength: mp4().byteLength,
                durationSeconds: 2,
                width: 1920,
                height: 1080,
                frameRate: 30,
                transition: "fade",
                status: "generated",
                createdAt: new Date().toISOString(),
              }],
            };
          }),
        }));
        assert.equal(await fs.readFile(value.assetsPath, "utf8"), before);
      }
    });

    await scenario("invalid FFmpeg executable fails closed without final output", async () => {
      const value = await fixture("invalid-executable", ["zoom-in"], "production");
      const bad = { ...config(), ffmpegPath: path.join(projectsRoot, "missing-ffmpeg.exe") };
      const result = await new FFmpegSceneVideoProvider(new RenderingRunner(bad), () => bad).generateVideo({
        projectId: value.project.id,
        projectSlug: value.slug,
        scenes: [{ sceneId: 1, sourceImageAssetId: value.plans[0].sourceImageAssetId, animationAssetId: value.plans[0].animationAssetId, imageFilePath: (AssetManager.getProjectAssets(value.slug, value.project.id).assets[0].filePath as string), imageMimeType: "image/png", motionPlan: value.plans[0] }],
      });
      assert.equal(result.success, false);
    });

    await scenario("spawn exception is sanitized", async () => {
      const spawnProcess: VideoAssemblySpawn = () => { throw new Error("secret path"); };
      await assert.rejects(new SpawnRunner(spawnProcess, 10).run("x", [], { timeoutMs: 10, maxOutputBytes: 1024 }), /Video assembly failed/);
    });

    await scenario("timeout uses repeated kill forced settlement and unref", async () => {
      const child = new FakeChild();
      await assert.rejects(new SpawnRunner(() => child, 10).run("x", [], { timeoutMs: 2, maxOutputBytes: 1024 }));
      assert.ok(child.kills.length >= 2);
      assert.equal(child.unrefs, 1);
    });

    await scenario("stderr overflow terminates and settles once", async () => {
      const child = new FakeChild();
      const promise = new SpawnRunner(() => child, 10).run("x", [], { timeoutMs: 100, maxOutputBytes: 4 });
      child.stderr.write(Buffer.alloc(5));
      await assert.rejects(promise);
      assert.ok(child.kills.length >= 2);
    });

    await scenario("output missing empty or invalid MP4 fails and cleans partial files", async () => {
      for (const mode of ["missing", "empty", "invalid"] as const) {
        const value = await fixture(`invalid-output-${mode}`, ["zoom-in"], "production");
        const selectedConfig = config();
        const runner: VideoAssemblyProcessRunner = {
          async run(executable, args) {
            if (executable === selectedConfig.ffmpegPath && mode !== "missing") {
              await fs.writeFile(
                args.at(-1) as string,
                mode === "empty" ? Buffer.alloc(0) : Buffer.from("not-mp4"),
              );
            }
            return { exitCode: 0, signal: null, stdout: "", timedOut: false };
          },
        };
        const image = AssetManager.getProjectAssets(value.slug, value.project.id).assets[0];
        const result = await new FFmpegSceneVideoProvider(runner, () => selectedConfig).generateVideo({ projectId: value.project.id, projectSlug: value.slug, scenes: [{ sceneId: 1, sourceImageAssetId: value.plans[0].sourceImageAssetId, animationAssetId: value.plans[0].animationAssetId, imageFilePath: image.filePath as string, imageMimeType: "image/png", motionPlan: value.plans[0] }] });
        assert.equal(result.success, false);
        const videoDir = path.join(projectsRoot, value.slug, "assets", "videos");
        assert.deepEqual(await fs.readdir(videoDir), []);
      }
    });

    await scenario("legacy video remains readable while partial and mixed v2 fail closed", () => {
      const legacy = { projectId: "p", status: "generated", scenes: [{ sceneId: 1, sourceAnimationAssetId: "a", outputAssetId: "v", provider: "mock", status: "generated" }], createdAt: new Date().toISOString() };
      assert.equal(isCompatibleVideoData(legacy), true);
      assert.equal(isCompatibleVideoData({ ...legacy, schemaVersion: "2" }), false);
      assert.equal(isCompatibleVideoData({ ...legacy, scenes: [{ ...legacy.scenes[0], artifactType: "scene-video", videoAssetId: "v" }] }), false);
    });

    await scenario("pipeline success persists video registry manifest job history and queues audio", async () => {
      const value = await fixture("pipeline-success");
      await PipelineJobManager.listJobs(value.slug);
      await ProjectManager.saveAnimation(value.slug, value.animation);
      const state = { ...PipelineStageExecutor.createInitialState(value.project), animation: value.animation } as PipelineExecutionState;
      const runner = PipelineRunner as unknown as RunnerHarness;
      assert.equal(await runner.runStageLegacy(value.slug, "video", () => PipelineStageExecutor.execute(value.slug, "video", state, { videoProvider: new MockVideoProvider() }), "initial"), true);
      const stored = await ProjectManager.getVideo(value.slug);
      const jobs = await PipelineJobManager.listJobsReadOnly(value.slug);
      const history = await PipelineJobManager.listHistory(value.slug);
      assert.equal(isCompatibleVideoData(stored), true);
      assert.equal((await ProjectManager.getManifest(value.slug))?.packages.video.status, "completed");
      assert.equal(jobs.jobs.find((job) => job.stage === "video")?.status, "completed");
      assert.equal(jobs.jobs.find((job) => job.stage === "audio")?.status, "queued");
      assert.ok(history.events.some((event) => event.stage === "video" && event.status === "completed"));
      const before = await fs.readFile(value.assetsPath, "utf8");
      assert.equal(await runner.runStageLegacy(value.slug, "video", () => PipelineStageExecutor.execute(value.slug, "video", state, { videoProvider: new MockVideoProvider() }), "initial"), false);
      assert.equal(await fs.readFile(value.assetsPath, "utf8"), before);
    });

    await scenario("pipeline failure blocks audio and assembly", async () => {
      const value = await fixture("pipeline-failure");
      await PipelineJobManager.listJobs(value.slug);
      await ProjectManager.saveAnimation(value.slug, value.animation);
      const state = { ...PipelineStageExecutor.createInitialState(value.project), animation: value.animation } as PipelineExecutionState;
      const runner = PipelineRunner as unknown as RunnerHarness;
      await assert.rejects(runner.runStageLegacy(value.slug, "video", () => PipelineStageExecutor.execute(value.slug, "video", state, { videoProvider: provider("mock", async () => ({ success: false, provider: "mock", error: "raw" })) }), "initial"));
      const jobs = await PipelineJobManager.listJobsReadOnly(value.slug);
      const scheduled = await PipelineQueueScheduler.getNextRunnableStage(value.slug, ["video", "audio", "assembly"]);
      assert.equal(jobs.jobs.find((job) => job.stage === "video")?.status, "failed");
      assert.equal(jobs.jobs.find((job) => job.stage === "audio")?.status, "queued");
      assert.equal(jobs.jobs.find((job) => job.stage === "assembly")?.status, "queued");
      assert.equal(scheduled.stage, null);
    });

    console.log(`Sprint 117 production scene video rendering smoke: PASS (${scenarios} scenarios)`);
    emitSmokeResult("production-scene-video-rendering", scenarios);
  } finally {
    // The canonical runtime owns and removes every fixture beneath projectsRoot.
  }
}

async function main() {
  const ffmpegPath = process.env.FFMPEG_PATH;
  const ffprobePath = process.env.FFPROBE_PATH;
  await withCanonicalSmokeRuntime({
    name: "scene-video-rendering",
    operationType: "scene-video-smoke",
    environment: { VIDEO_PROVIDER: undefined, FFMPEG_PATH: ffmpegPath, FFPROBE_PATH: ffprobePath },
  }, async (runtime) => {
    prefix = `sprint-117-scene-video-${runtime.runId}`;
    temporaryRuntimeRoot = runtime.runtimeRoot;
    projectsRoot = runtime.runtimeStorageContext.projectsRoot;
    assert.notEqual(
      path.resolve(projectsRoot),
      path.resolve(process.cwd(), "data", "projects"),
      "Scene-video smoke fixture root must not resolve to repository data/projects.",
    );
    await run();
  });
}

void main();
