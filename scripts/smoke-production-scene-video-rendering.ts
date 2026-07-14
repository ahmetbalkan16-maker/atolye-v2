import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { promises as fs } from "node:fs";
import path from "node:path";
import { PassThrough } from "node:stream";
import { ImageStorage } from "../src/lib/assets/storage/ImageStorage";
import { VideoStorage } from "../src/lib/assets/storage/VideoStorage";
import { AssetManager } from "../src/lib/assets/AssetManager";
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
  resolveVideoProviderName,
  type FFmpegSceneVideoConfig,
} from "../src/lib/video/providers/VideoProviderConfig";
import { MockVideoProvider } from "../src/lib/video/providers/MockVideoProvider";
import type {
  VideoGenerationInput,
  VideoGenerationResult,
  VideoProvider,
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
  runStage(
    slug: string,
    stage: ProductionStepKey,
    action: () => Promise<boolean>,
    runType: ProjectPackageRunType,
  ): Promise<boolean>;
};

const prefix = `sprint-117-scene-video-${process.pid}`;
const projectsRoot = path.join(process.cwd(), "data", "projects");
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
  return { slug, project, animation, plans, assetsPath: AssetManager.getAssetsPath(slug) };
}

function provider(
  name: string,
  generate: (input: VideoGenerationInput) => VideoGenerationResult | Promise<VideoGenerationResult>,
): VideoProvider {
  return { name, generateVideo: async (input) => generate(input) };
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

async function main() {
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
      const filter = args[args.indexOf("-vf") + 1];
      assert.match(filter, /zoompan/);
      assert.match(filter, /ot\/1\.966666667/);
      assert.match(filter, /:d=1:/);
      assert.equal(args.includes("fade"), false);
    });

    await scenario("minimum and maximum durations produce bounded non-zero frame spans", () => {
      const minimum = plan(1, "image", "animation", "zoom-in");
      minimum.durationSeconds = 1;
      const minimumArgs = buildSceneFFmpegArgs({ sceneId: 1, sourceImageAssetId: "image", animationAssetId: "animation", imageFilePath: "data/projects/x/assets/images/x.png", imageMimeType: "image/png", motionPlan: minimum }, "minimum.mp4");
      assert.match(minimumArgs[minimumArgs.indexOf("-vf") + 1], /ot\/0\.966666667/);
      assert.equal(minimumArgs[minimumArgs.indexOf("-t") + 1], "1.000000");

      const maximum = plan(1, "image", "animation", "zoom-in");
      maximum.durationSeconds = 300;
      const maximumArgs = buildSceneFFmpegArgs({ sceneId: 1, sourceImageAssetId: "image", animationAssetId: "animation", imageFilePath: "data/projects/x/assets/images/x.png", imageMimeType: "image/png", motionPlan: maximum }, "maximum.mp4");
      assert.match(maximumArgs[maximumArgs.indexOf("-vf") + 1], /ot\/299\.966666667/);
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
      await ProjectManager.saveAnimation(value.slug, value.animation);
      await PipelineJobManager.listJobs(value.slug);
      const state = { ...PipelineStageExecutor.createInitialState(value.project), animation: value.animation } as PipelineExecutionState;
      const runner = PipelineRunner as unknown as RunnerHarness;
      assert.equal(await runner.runStage(value.slug, "video", () => PipelineStageExecutor.execute(value.slug, "video", state, { videoProvider: new MockVideoProvider() }), "initial"), true);
      const stored = await ProjectManager.getVideo(value.slug);
      const jobs = await PipelineJobManager.listJobsReadOnly(value.slug);
      const history = await PipelineJobManager.listHistory(value.slug);
      assert.equal(isCompatibleVideoData(stored), true);
      assert.equal((await ProjectManager.getManifest(value.slug))?.packages.video.status, "completed");
      assert.equal(jobs.jobs.find((job) => job.stage === "video")?.status, "completed");
      assert.equal(jobs.jobs.find((job) => job.stage === "audio")?.status, "queued");
      assert.ok(history.events.some((event) => event.stage === "video" && event.status === "completed"));
      const before = await fs.readFile(value.assetsPath, "utf8");
      assert.equal(await runner.runStage(value.slug, "video", () => PipelineStageExecutor.execute(value.slug, "video", state, { videoProvider: new MockVideoProvider() }), "initial"), false);
      assert.equal(await fs.readFile(value.assetsPath, "utf8"), before);
    });

    await scenario("pipeline failure blocks audio and assembly", async () => {
      const value = await fixture("pipeline-failure");
      await ProjectManager.saveAnimation(value.slug, value.animation);
      await PipelineJobManager.listJobs(value.slug);
      const state = { ...PipelineStageExecutor.createInitialState(value.project), animation: value.animation } as PipelineExecutionState;
      const runner = PipelineRunner as unknown as RunnerHarness;
      await assert.rejects(runner.runStage(value.slug, "video", () => PipelineStageExecutor.execute(value.slug, "video", state, { videoProvider: provider("mock", async () => ({ success: false, provider: "mock", error: "raw" })) }), "initial"));
      const jobs = await PipelineJobManager.listJobsReadOnly(value.slug);
      const scheduled = await PipelineQueueScheduler.getNextRunnableStage(value.slug, ["video", "audio", "assembly"]);
      assert.equal(jobs.jobs.find((job) => job.stage === "video")?.status, "failed");
      assert.equal(jobs.jobs.find((job) => job.stage === "audio")?.status, "queued");
      assert.equal(jobs.jobs.find((job) => job.stage === "assembly")?.status, "queued");
      assert.equal(scheduled.stage, null);
    });

    console.log(`Sprint 117 production scene video rendering smoke: PASS (${scenarios} scenarios)`);
  } finally {
    const entries = await fs.readdir(projectsRoot, { withFileTypes: true });
    await Promise.all(entries.filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix)).map((entry) => fs.rm(path.join(projectsRoot, entry.name), { recursive: true, force: true })));
  }
}

void main();
