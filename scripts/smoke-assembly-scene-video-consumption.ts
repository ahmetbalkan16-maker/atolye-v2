import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { AssetManager } from "../src/lib/assets/AssetManager";
import { AudioStorage } from "../src/lib/assets/storage/AudioStorage";
import { ImageStorage } from "../src/lib/assets/storage/ImageStorage";
import { VideoStorage } from "../src/lib/assets/storage/VideoStorage";
import { AssemblyManager } from "../src/lib/assembly/AssemblyManager";
import {
  VideoAssemblyError,
  VideoAssemblyManager,
} from "../src/lib/assembly/VideoAssemblyManager";
import {
  FFmpegVideoAssemblyProvider,
  type ProcessRunResult,
  type VideoAssemblyProcessRunner,
} from "../src/lib/assembly/providers/FFmpegVideoAssemblyProvider";
import { PipelineJobManager } from "../src/lib/pipeline/PipelineJobManager";
import { PipelineRunner } from "../src/lib/pipeline/PipelineRunner";
import {
  PipelineStageExecutor,
  type PipelineExecutionState,
} from "../src/lib/pipeline/PipelineStageExecutor";
import { ProjectManager } from "../src/lib/projects/ProjectManager";
import type { AnimationData, AnimationMotionPlanScene } from "../src/types/animation";
import type { AssemblyPlanData } from "../src/types/assembly";
import type { AudioData } from "../src/types/audio";
import type { SceneData } from "../src/types/scene";
import type { ScriptData } from "../src/types/script";
import type { VideoData } from "../src/types/video";
import type { VisualData } from "../src/types/visual";

const prefix = `sprint-118-scene-video-assembly-${process.pid}`;
const projectsRoot = path.join(process.cwd(), "data", "projects");
const now = "2026-07-14T12:00:00.000Z";
const originalEnvironment = {
  ffmpegPath: process.env.FFMPEG_PATH,
  ffprobePath: process.env.FFPROBE_PATH,
};
let count = 0;

const scenes: SceneData = {
  scenes: [
    { id: 1, title: "One", description: "One", duration: 1 },
    { id: 2, title: "Two", description: "Two", duration: 1 },
  ],
  createdAt: now,
};
const visuals: VisualData = {
  projectId: "fixture",
  scenes: [1, 2].map((sceneId) => ({
    sceneId,
    visualPrompt: `visual ${sceneId}`,
    animationPrompt: `motion ${sceneId}`,
    style: "cinematic",
  })),
  thumbnail: { title: "T", prompt: "P", composition: "C", mood: "M" },
  createdAt: now,
};
const script: ScriptData = {
  topic: "T", title: "T", subtitle: "", hook: "", introduction: "",
  chapters: [], conclusion: "", callToAction: "", estimatedDuration: 2,
  narrationWordCount: 2, targetAudience: "all", language: "tr",
  voiceStyle: "documentary", musicStyle: "none", thumbnailIdea: "",
  seoKeywords: [], createdAt: now,
};

async function scenario(name: string, test: () => void | Promise<void>) {
  await test();
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}

function wav(dataLength = 16000) {
  const value = Buffer.alloc(44 + dataLength);
  value.write("RIFF", 0); value.writeUInt32LE(value.length - 8, 4);
  value.write("WAVE", 8); value.write("fmt ", 12); value.writeUInt32LE(16, 16);
  value.writeUInt16LE(1, 20); value.writeUInt16LE(1, 22);
  value.writeUInt32LE(8000, 24); value.writeUInt32LE(16000, 28);
  value.writeUInt16LE(2, 32); value.writeUInt16LE(16, 34);
  value.write("data", 36); value.writeUInt32LE(dataLength, 40);
  return value;
}

function box(type: string, payload = Buffer.alloc(0)) {
  const value = Buffer.alloc(8 + payload.length);
  value.writeUInt32BE(value.length, 0); value.write(type, 4, 4, "ascii");
  payload.copy(value, 8); return value;
}

function mp4() {
  return Buffer.concat([
    box("ftyp", Buffer.from("isom0000")), box("moov"),
    box("mdat", Buffer.from([0, 1, 2, 3])),
  ]);
}

function plan(sceneId: number): AnimationMotionPlanScene {
  const imageId = `image-${sceneId}`;
  const animationId = `animation-${sceneId}`;
  const frame = {
    crop: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
    transform: { scale: 1, translateX: 0, translateY: 0 },
  };
  return {
    sceneId, animationPrompt: `motion ${sceneId}`,
    sourceImageAssetId: imageId, outputAssetId: animationId,
    animationAssetId: animationId, durationSeconds: 1, motionType: "static",
    start: frame, end: frame, transition: "fade", provider: "mock",
    model: "mock-animation-model", generationMode: "mock",
    artifactType: "motion-plan", status: "generated",
  };
}

class Runner implements VideoAssemblyProcessRunner {
  readonly calls: Array<{ executable: string; args: readonly string[] }> = [];
  sceneProbeCount = 0;

  constructor(
    private readonly sceneOverride: Record<string, unknown> = {},
    private readonly failSceneProbe?: number,
    private readonly finalDuration = "2",
    private readonly overrideSecondSceneOnly = false,
  ) {}

  async run(executable: string, args: readonly string[]): Promise<ProcessRunResult> {
    this.calls.push({ executable, args: [...args] });
    if (executable === process.env.FFMPEG_PATH) {
      await fs.writeFile(args.at(-1) as string, mp4());
      return { exitCode: 0, signal: null, stdout: "", timedOut: false };
    }
    const sceneProbe = args.includes("-show_data");
    if (sceneProbe) {
      this.sceneProbeCount += 1;
      if (this.failSceneProbe === this.sceneProbeCount) {
        return { exitCode: 1, signal: null, stdout: "", timedOut: false };
      }
      return {
        exitCode: 0, signal: null, timedOut: false,
        stdout: JSON.stringify({
          format: { format_name: "mov,mp4", duration: "1" },
          streams: [{
            codec_type: "video", codec_name: "h264", width: 1920,
            height: 1080, pix_fmt: "yuv420p", avg_frame_rate: "30/1",
            r_frame_rate: "30/1", time_base: "1/15360", profile: "High",
            level: 40, codec_tag_string: "avc1", field_order: "progressive",
            extradata: "fixture-extradata",
            ...(this.overrideSecondSceneOnly && this.sceneProbeCount !== 2
              ? {}
              : this.sceneOverride),
          }],
        }),
      };
    }
    return {
      exitCode: 0, signal: null, timedOut: false,
      stdout: JSON.stringify({
        format: { format_name: "mov,mp4", duration: this.finalDuration },
        streams: [
          { codec_type: "video", codec_name: "h264", width: 1920, height: 1080, pix_fmt: "yuv420p", avg_frame_rate: "30/1", duration: this.finalDuration, disposition: { attached_pic: 0 } },
          { codec_type: "audio", codec_name: "aac", duration: this.finalDuration },
        ],
      }),
    };
  }
}

async function fixture(suffix: string) {
  const slug = `${prefix}-${suffix}`;
  const project = await ProjectManager.createProject(slug);
  const animation: AnimationData = {
    projectId: project.id, schemaVersion: "2", artifactType: "motion-plan",
    scenes: [plan(1), plan(2)], createdAt: now,
  };
  const videoScenes: NonNullable<VideoData["scenes"]> = [];
  const audioSections: AudioData["sections"] = [];

  for (const sceneId of [1, 2]) {
    const image = ImageStorage.saveImage({
      projectSlug: slug,
      data: Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(4)]),
      mimeType: "image/png",
    });
    const audio = AudioStorage.saveAudio({ projectSlug: slug, data: wav() });
    const videoPaths = VideoStorage.createSceneRenderPaths(slug, sceneId);
    await fs.writeFile(videoPaths.temporaryAbsolutePath, mp4());
    VideoStorage.finalize(videoPaths.temporaryAbsolutePath, videoPaths.absolutePath);
    const videoBytes = mp4().byteLength;
    const imageId = `image-${sceneId}`;
    const animationId = `animation-${sceneId}`;
    const videoId = `video-${sceneId}`;
    AssetManager.addAsset(slug, project.id, AssetManager.createAsset({
      id: imageId, projectId: project.id, projectSlug: slug, sceneId,
      type: "image", status: "generated", provider: "openai", prompt: "image",
      filePath: image.filePath, url: image.url, mimeType: "image/png",
    }));
    AssetManager.addAsset(slug, project.id, AssetManager.createAsset({
      id: animationId, projectId: project.id, projectSlug: slug, sceneId,
      type: "animation", status: "generated", provider: "mock", prompt: `motion ${sceneId}`,
      artifactType: "motion-plan", mimeType: "application/vnd.atolye.motion-plan+json",
      sourceAssetId: imageId, generationMode: "mock", durationSeconds: 1,
    }));
    AssetManager.addAsset(slug, project.id, AssetManager.createAsset({
      id: videoId, projectId: project.id, projectSlug: slug, sceneId,
      type: "video", status: "generated", provider: "ffmpeg", model: "ffmpeg-scene-h264",
      prompt: "Scene video render.", artifactType: "scene-video", sourceAssetId: imageId,
      animationAssetId: animationId, generationMode: "production",
      filePath: videoPaths.filePath, url: videoPaths.url, mimeType: "video/mp4",
      byteLength: videoBytes, durationSeconds: 1, width: 1920, height: 1080,
      frameRate: 30, transition: "fade",
    }));
    AssetManager.addAsset(slug, project.id, AssetManager.createAsset({
      id: `audio-${sceneId}`, projectId: project.id, projectSlug: slug, sceneId,
      type: "audio", status: "generated", provider: "openai", prompt: "audio",
      filePath: audio.filePath, url: audio.url, mimeType: "audio/wav",
      byteLength: audio.byteLength, durationSeconds: audio.durationSeconds,
    }));
    videoScenes.push({
      sceneId, sourceAnimationAssetId: animationId, sourceImageAssetId: imageId,
      animationAssetId: animationId, outputAssetId: videoId, videoAssetId: videoId,
      provider: "ffmpeg", model: "ffmpeg-scene-h264", status: "generated",
      durationSeconds: 1, filePath: videoPaths.filePath, url: videoPaths.url,
      mimeType: "video/mp4", byteLength: videoBytes, width: 1920, height: 1080,
      frameRate: 30, transition: "fade", generationMode: "production",
      artifactType: "scene-video",
    });
    audioSections.push({
      chapterId: sceneId, title: `Section ${sceneId}`, duration: "00:01",
      emotion: "calm", emphasis: [], narrationNotes: "", pacing: "medium",
      sourceText: `Narration ${sceneId}`, outputAssetId: `audio-${sceneId}`,
      status: "generated", provider: "openai",
    });
  }
  const mix = AudioStorage.saveAudio({ projectSlug: slug, data: wav(32000) });
  AssetManager.addAsset(slug, project.id, AssetManager.createAsset({
    id: "mix-audio", projectId: project.id, projectSlug: slug, type: "audio",
    status: "generated", provider: "openai", prompt: "mix", filePath: mix.filePath,
    url: mix.url, mimeType: "audio/wav", byteLength: mix.byteLength,
    durationSeconds: mix.durationSeconds,
  }));
  const audio: AudioData = {
    outputAssetId: "mix-audio", status: "generated", provider: "openai",
    narrator: { style: "documentary", tone: "calm", language: "tr" },
    sections: audioSections, music: { mood: "none", suggestion: "none", intensity: "none" },
    production: { targetFormat: "wav", sampleRate: 8000, estimatedTotalDuration: "00:02", generationStatus: "generated" },
    createdAt: now,
  };
  const video: VideoData = {
    projectId: project.id, schemaVersion: "2", artifactType: "scene-video",
    provider: "ffmpeg", status: "generated", scenes: videoScenes, createdAt: now,
  };
  const assembly: AssemblyPlanData = {
    projectId: project.id, slug, status: "assembled",
    scenes: [1, 2].map((sceneId) => ({
      sceneId, duration: "00:01", visualReference: `visual-${sceneId}`,
      animationAssetId: `animation-${sceneId}`, videoAssetId: `video-${sceneId}`,
      audioAssetId: `audio-${sceneId}`, audioReference: `section-${sceneId}`,
      transition: "fade", cameraMovement: "none", effects: [],
    })),
    totalDuration: "00:02", style: "documentary",
    render: { status: "planned", format: "mp4" }, createdAt: now,
  };
  return { slug, project, animation, video, audio, assembly };
}

function render(value: Awaited<ReturnType<typeof fixture>>, runner = new Runner()) {
  return VideoAssemblyManager.renderExistingAssets({
    projectId: value.project.id, projectSlug: value.slug, scenes,
    visuals: { ...visuals, projectId: value.project.id }, audio: value.audio,
    assembly: value.assembly, animation: value.animation, video: value.video,
    provider: new FFmpegVideoAssemblyProvider(runner),
  });
}

async function expectPreflightFailure(
  suffix: string,
  mutate: (value: Awaited<ReturnType<typeof fixture>>) => void | Promise<void>,
) {
  const value = await fixture(suffix);
  await mutate(value);
  const runner = new Runner();
  const before = AssetManager.getProjectAssets(value.slug, value.project.id).assets.length;
  await assert.rejects(render(value, runner), (error) => error instanceof VideoAssemblyError);
  assert.equal(runner.calls.length, 0);
  assert.equal(AssetManager.getProjectAssets(value.slug, value.project.id).assets.length, before);
}

async function main() {
  process.env.FFMPEG_PATH = process.execPath;
  process.env.FFPROBE_PATH = process.env.ComSpec ?? "C:\\Windows\\System32\\cmd.exe";
  try {
    await scenario("scene-video v2 consumes multiple MP4s with copy concat", async () => {
      const value = await fixture("copy-concat");
      const runner = new Runner();
      const result = await render(value, runner);
      assert.equal(result.render?.status, "rendered");
      assert.ok(result.outputAssetId);
      assert.equal(runner.sceneProbeCount, 2);
      const ffmpeg = runner.calls.find((call) => call.executable === process.env.FFMPEG_PATH)!;
      assert.ok(ffmpeg.args.includes("concat"));
      assert.ok(ffmpeg.args.includes("copy"));
      assert.equal(ffmpeg.args.some((arg) => arg.includes("assets/images")), false);
    });

    await scenario("duration mismatch uses safe retime and re-encode path", async () => {
      const value = await fixture("retime");
      const current = AssetManager.getProjectAssets(value.slug, value.project.id);
      const audio = current.assets.find((asset) => asset.id === "audio-1")!;
      const replacement = AudioStorage.saveAudio({ projectSlug: value.slug, data: wav(32000) });
      audio.filePath = replacement.filePath;
      audio.url = replacement.url;
      audio.byteLength = replacement.byteLength;
      audio.durationSeconds = replacement.durationSeconds;
      value.audio.sections[0].duration = "00:02";
      AssetManager.saveProjectAssets(value.slug, { ...current, assets: current.assets });
      const runner = new Runner({}, undefined, "3");
      await render(value, runner);
      const ffmpeg = runner.calls.find((call) => call.executable === process.env.FFMPEG_PATH)!;
      assert.ok(ffmpeg.args.includes("libx264"));
      assert.equal(ffmpeg.args.includes("copy"), false);
    });

    await scenario("missing scene-video fails before provider", () =>
      expectPreflightFailure("missing-video", (value) => {
        const current = AssetManager.getProjectAssets(value.slug, value.project.id);
        AssetManager.saveProjectAssets(value.slug, { ...current, assets: current.assets.filter((asset) => asset.id !== "video-2") });
      }));
    await scenario("duplicate scene-video fails before provider", () =>
      expectPreflightFailure("duplicate-video", (value) => {
        const current = AssetManager.getProjectAssets(value.slug, value.project.id);
        const duplicate = current.assets.find((asset) => asset.id === "video-1")!;
        AssetManager.saveProjectAssets(value.slug, { ...current, assets: [...current.assets, duplicate] });
      }));
    await scenario("duplicate scene-video locator fails before provider", () =>
      expectPreflightFailure("duplicate-locator", (value) => {
        const current = AssetManager.getProjectAssets(value.slug, value.project.id);
        const first = current.assets.find((asset) => asset.id === "video-1")!;
        const second = current.assets.find((asset) => asset.id === "video-2")!;
        second.filePath = first.filePath;
        second.url = first.url;
        second.byteLength = first.byteLength;
        value.video.scenes[1].filePath = first.filePath;
        value.video.scenes[1].url = first.url;
        value.video.scenes[1].byteLength = first.byteLength;
        AssetManager.saveProjectAssets(value.slug, current);
      }));
    await scenario("incompatible stream signature uses re-encode path", async () => {
      const value = await fixture("stream-signature");
      const runner = new Runner({ time_base: "1/90000" }, undefined, "2", true);
      await render(value, runner);
      const ffmpeg = runner.calls.find((call) => call.executable === process.env.FFMPEG_PATH)!;
      assert.ok(ffmpeg.args.includes("libx264"));
      assert.equal(ffmpeg.args.includes("copy"), false);
    });
    await scenario("wrong animation identity fails before provider", () =>
      expectPreflightFailure("wrong-animation", (value) => {
        value.assembly.scenes[0].animationAssetId = "animation-2";
      }));
    await scenario("wrong source image identity fails before provider", () =>
      expectPreflightFailure("wrong-source", (value) => {
        value.animation.scenes[0].sourceImageAssetId = "image-2";
      }));
    await scenario("mixed legacy and v2 video data fails closed", () =>
      expectPreflightFailure("mixed", (value) => {
        value.video.schemaVersion = undefined;
        value.video.artifactType = undefined;
        value.video.scenes[1] = { sceneId: 2, sourceAnimationAssetId: "legacy", status: "generated" };
      }));

    await scenario("legacy image-only assembly fallback remains readable", async () => {
      const value = await fixture("legacy");
      const runner = new Runner();
      const result = await VideoAssemblyManager.renderExistingAssets({
        projectId: value.project.id, projectSlug: value.slug, scenes,
        visuals: { ...visuals, projectId: value.project.id }, audio: value.audio,
        assembly: value.assembly, provider: new FFmpegVideoAssemblyProvider(runner),
      });
      assert.equal(result.render?.status, "rendered");
      const ffmpeg = runner.calls.find((call) => call.executable === process.env.FFMPEG_PATH)!;
      assert.ok(ffmpeg.args.some((arg) => /assets[\\/]images/.test(arg)));
    });

    for (const [name, override] of [
      ["invalid codec", { codec_name: "vp9" }],
      ["invalid FPS", { avg_frame_rate: "24/1" }],
      ["invalid resolution", { width: 1280 }],
      ["invalid pixel format", { pix_fmt: "yuv444p" }],
      ["audio stream present", { codec_type: "audio", codec_name: "aac" }],
    ] as const) {
      await scenario(`${name} probe fails before concat`, async () => {
        const value = await fixture(name.replaceAll(" ", "-"));
        const runner = new Runner(override);
        const before = AssetManager.getProjectAssets(value.slug, value.project.id).assets.length;
        await assert.rejects(render(value, runner));
        assert.equal(runner.calls.some((call) => call.executable === process.env.FFMPEG_PATH), false);
        assert.equal(AssetManager.getProjectAssets(value.slug, value.project.id).assets.length, before + 1);
        assert.equal(AssetManager.getProjectAssets(value.slug, value.project.id).assets.at(-1)?.status, "failed");
      });
    }

    await scenario("structural validation failure occurs before provider", () =>
      expectPreflightFailure("structural", async (value) => {
        const asset = AssetManager.getProjectAssets(value.slug, value.project.id).assets.find((item) => item.id === "video-1")!;
        await fs.writeFile(path.resolve(process.cwd(), ...(asset.filePath as string).split("/")), "bad");
      }));

    await scenario("provider partial probe failure writes no final generated asset", async () => {
      const value = await fixture("partial-provider");
      const runner = new Runner({}, 2);
      const before = AssetManager.getProjectAssets(value.slug, value.project.id).assets;
      await assert.rejects(render(value, runner));
      const after = AssetManager.getProjectAssets(value.slug, value.project.id).assets;
      assert.equal(after.filter((asset) => asset.type === "video" && asset.status === "generated").length, before.filter((asset) => asset.type === "video" && asset.status === "generated").length);
      assert.equal(runner.calls.some((call) => call.executable === process.env.FFMPEG_PATH), false);
    });

    await scenario("completed assembly replay is write-free", async () => {
      const value = await fixture("replay");
      await ProjectManager.saveAnimation(value.slug, value.animation);
      await ProjectManager.saveVideo(value.slug, value.video);
      await ProjectManager.saveAudio(value.slug, value.audio);
      await PipelineJobManager.listJobs(value.slug);
      const state = {
        ...PipelineStageExecutor.createInitialState(value.project), script, scenes,
        visuals: { ...visuals, projectId: value.project.id }, animation: value.animation,
        video: value.video, audio: value.audio,
      } as PipelineExecutionState;
      const original = AssemblyManager.generateAssemblyPlan;
      AssemblyManager.generateAssemblyPlan = async () => value.assembly;
      const runner = new Runner();
      const internal = PipelineRunner as unknown as { runStage(slug: string, stage: "assembly", action: () => Promise<boolean>, runType: "initial"): Promise<boolean> };
      try {
        assert.equal(await internal.runStage(value.slug, "assembly", () => PipelineStageExecutor.execute(value.slug, "assembly", state, { videoAssemblyProvider: new FFmpegVideoAssemblyProvider(runner) }), "initial"), true);
        const calls = runner.calls.length;
        const assets = JSON.stringify(AssetManager.getProjectAssets(value.slug, value.project.id));
        assert.equal(await internal.runStage(value.slug, "assembly", () => PipelineStageExecutor.execute(value.slug, "assembly", state, { videoAssemblyProvider: new FFmpegVideoAssemblyProvider(runner) }), "initial"), false);
        assert.equal(runner.calls.length, calls);
        assert.equal(JSON.stringify(AssetManager.getProjectAssets(value.slug, value.project.id)), assets);
      } finally {
        AssemblyManager.generateAssemblyPlan = original;
      }
    });

    await scenario("assembly failure persists failed state and blocks downstream", async () => {
      const value = await fixture("pipeline-failure");
      await PipelineJobManager.listJobs(value.slug);
      const state = {
        ...PipelineStageExecutor.createInitialState(value.project), script, scenes,
        visuals: { ...visuals, projectId: value.project.id }, animation: value.animation,
        video: value.video, audio: value.audio,
      } as PipelineExecutionState;
      const original = AssemblyManager.generateAssemblyPlan;
      AssemblyManager.generateAssemblyPlan = async () => value.assembly;
      const internal = PipelineRunner as unknown as { runStage(slug: string, stage: "assembly", action: () => Promise<boolean>, runType: "initial"): Promise<boolean> };
      try {
        await assert.rejects(internal.runStage(value.slug, "assembly", () => PipelineStageExecutor.execute(value.slug, "assembly", state, { videoAssemblyProvider: new FFmpegVideoAssemblyProvider(new Runner({}, 1)) }), "initial"));
        const jobs = await PipelineJobManager.listJobsReadOnly(value.slug);
        const manifest = await ProjectManager.getManifest(value.slug);
        assert.equal(jobs.jobs.find((job) => job.stage === "assembly")?.status, "failed");
        assert.notEqual(jobs.jobs.find((job) => job.stage === "thumbnail")?.status, "completed");
        assert.equal(manifest?.packages.assembly.status, "failed");
        assert.notEqual((await ProjectManager.getProject(value.slug))?.status, "completed");
      } finally {
        AssemblyManager.generateAssemblyPlan = original;
      }
    });

    console.log(`Sprint 118 assembly scene-video consumption smoke: PASS (${count} scenarios)`);
  } finally {
    if (originalEnvironment.ffmpegPath === undefined) delete process.env.FFMPEG_PATH;
    else process.env.FFMPEG_PATH = originalEnvironment.ffmpegPath;
    if (originalEnvironment.ffprobePath === undefined) delete process.env.FFPROBE_PATH;
    else process.env.FFPROBE_PATH = originalEnvironment.ffprobePath;
    const entries = await fs.readdir(projectsRoot, { withFileTypes: true });
    await Promise.all(entries.filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix)).map((entry) => fs.rm(path.join(projectsRoot, entry.name), { recursive: true, force: true })));
  }
}

void main();
