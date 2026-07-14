import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
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
  SpawnRunner,
  type ProcessRunResult,
  type VideoAssemblyChildProcess,
  type VideoAssemblyProcessRunner,
  type VideoAssemblySpawn,
} from "../src/lib/assembly/providers/FFmpegVideoAssemblyProvider";
import { MockVideoAssemblyProvider } from "../src/lib/assembly/providers/MockVideoAssemblyProvider";
import {
  VideoAssemblyConfigurationError,
  getFFmpegVideoAssemblyConfig,
  resolveVideoAssemblyProviderName,
} from "../src/lib/assembly/providers/VideoAssemblyProviderConfig";
import { VideoAssemblyProviderRouter } from "../src/lib/assembly/providers/VideoAssemblyProviderRouter";
import type { VideoAssemblyProvider } from "../src/lib/assembly/providers/VideoAssemblyProvider";
import { PipelineJobManager } from "../src/lib/pipeline/PipelineJobManager";
import { PipelineRunner } from "../src/lib/pipeline/PipelineRunner";
import {
  PipelineStageExecutor,
  type PipelineExecutionState,
} from "../src/lib/pipeline/PipelineStageExecutor";
import { ProjectManager } from "../src/lib/projects/ProjectManager";
import {
  ProductionPipelineDurableExecutionError,
  ProductionPipelineExecutionAdapter,
} from "../src/lib/production/ProductionPipelineExecutionAdapter";
import { prepareProductionPipelineExecution } from "../src/lib/production/ProductionPipelineExecutionFactory";
import type { AssemblyPlanData } from "../src/types/assembly";
import type { AudioData } from "../src/types/audio";
import type { SceneData } from "../src/types/scene";
import type { PipelineJobHistory, PipelineJobList } from "../src/types/pipelineJob";
import type {
  ProductionStepKey,
  Project,
  ProjectManifest,
  ProjectPackageRunType,
} from "../src/types/project";
import type { VideoAssemblyResult } from "../src/types/videoAssembly";
import type { VisualData } from "../src/types/visual";
import { GET as getVideo } from "../app/api/assets/videos/[slug]/[fileName]/route";

const prefix = `sprint-115-video-assembly-${process.pid}`;
const projectsRoot = path.join(process.cwd(), "data", "projects");
const now = "2026-07-13T12:00:00.000Z";
const originalEnvironment = {
  provider: process.env.VIDEO_ASSEMBLY_PROVIDER,
  ffmpegPath: process.env.FFMPEG_PATH,
  ffprobePath: process.env.FFPROBE_PATH,
  timeout: process.env.FFMPEG_TIMEOUT_MS,
  maxOutput: process.env.VIDEO_ASSEMBLY_MAX_OUTPUT_BYTES,
  maxStdio: process.env.FFMPEG_MAX_STDIO_BYTES,
};
let count = 0;
const externalFixtureDirectories: string[] = [];

type PipelineRunnerInternals = {
  runStageLegacy(
    slug: string,
    stage: ProductionStepKey,
    action: () => Promise<boolean>,
    runType: ProjectPackageRunType,
  ): Promise<boolean>;
  runStage(
    slug: string,
    stage: ProductionStepKey,
    action: () => Promise<boolean>,
    runType: ProjectPackageRunType,
  ): Promise<boolean>;
};

const pipelineRunner = PipelineRunner as unknown as PipelineRunnerInternals;

const scenes: SceneData = {
  scenes: [
    { id: 1, title: "One", description: "One" },
    { id: 2, title: "Two", description: "Two" },
  ],
  createdAt: now,
};
const visuals: VisualData = {
  projectId: "project-115",
  scenes: [
    { sceneId: 1, visualPrompt: "One", animationPrompt: "", style: "cinematic" },
    { sceneId: 2, visualPrompt: "Two", animationPrompt: "", style: "cinematic" },
  ],
  thumbnail: { title: "T", prompt: "P", composition: "C", mood: "M" },
  createdAt: now,
};
const baseAudio: AudioData = {
  outputAssetId: "mix-audio",
  status: "generated",
  provider: "openai",
  narrator: { style: "documentary", tone: "calm", language: "tr" },
  sections: [1, 2].map((chapterId) => ({
    chapterId,
    title: `Section ${chapterId}`,
    duration: "00:01",
    emotion: "calm",
    emphasis: [],
    narrationNotes: "",
    pacing: "medium",
    sourceText: `Narration ${chapterId}`,
    outputAssetId: `audio-${chapterId}`,
    status: "generated",
    provider: "openai",
  })),
  music: { mood: "none", suggestion: "none", intensity: "none" },
  production: {
    targetFormat: "wav",
    sampleRate: 8000,
    estimatedTotalDuration: "00:02",
    generationStatus: "generated",
  },
  createdAt: now,
};
const assembly: AssemblyPlanData = {
  projectId: "project-115",
  slug: "fixture",
  status: "assembled",
  scenes: [1, 2].map((sceneId) => ({
    sceneId,
    duration: "00:01",
    visualReference: `visual-${sceneId}`,
    audioAssetId: `audio-${sceneId}`,
    audioReference: `section-${sceneId}`,
    transition: "cut",
    cameraMovement: "none",
    effects: [],
  })),
  totalDuration: "00:02",
  style: "documentary",
  render: { status: "planned", format: "mp4" },
  createdAt: now,
};

async function scenario(name: string, test: () => void | Promise<void>) {
  await test();
  count += 1;
  if (process.env.SMOKE_TRACE === "1") {
    console.log(`PASS ${count}: ${name}`);
  }
}

function env(name: keyof NodeJS.ProcessEnv, value?: string) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function wav(dataLength = 16000) {
  const buffer = Buffer.alloc(44 + dataLength);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(8000, 24);
  buffer.writeUInt32LE(16000, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataLength, 40);
  return buffer;
}

function box(type: string, payload = Buffer.alloc(0)) {
  const value = Buffer.alloc(8 + payload.length);
  value.writeUInt32BE(value.length, 0);
  value.write(type, 4, 4, "ascii");
  payload.copy(value, 8);
  return value;
}

function mp4() {
  return Buffer.concat([
    box("ftyp", Buffer.from("isom0000")),
    box("moov"),
    box("mdat", Buffer.from([0, 1, 2, 3])),
  ]);
}

class FakeRunner implements VideoAssemblyProcessRunner {
  calls: Array<{ executable: string; args: readonly string[] }> = [];

  constructor(
    private readonly failure: Partial<ProcessRunResult> | null = null,
    private readonly probeOverride?: string,
  ) {}

  async run(executable: string, args: readonly string[]): Promise<ProcessRunResult> {
    this.calls.push({ executable, args: [...args] });

    if (this.failure) {
      return {
        exitCode: 0,
        signal: null,
        stdout: "",
        timedOut: false,
        ...this.failure,
      };
    }

    if (executable === process.env.FFMPEG_PATH) {
      await fs.writeFile(args.at(-1) as string, mp4());
      return { exitCode: 0, signal: null, stdout: "", timedOut: false };
    }

    return {
      exitCode: 0,
      signal: null,
      timedOut: false,
      stdout:
        this.probeOverride ??
        JSON.stringify({
          format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "2" },
          streams: [
            { codec_type: "video", codec_name: "h264", width: 1920, height: 1080, pix_fmt: "yuv420p", avg_frame_rate: "30/1", duration: "2", disposition: { attached_pic: 0 } },
            { codec_type: "audio", codec_name: "aac", duration: "2" },
          ],
        }),
    };
  }
}

class ControlledChild extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  killCount = 0;
  unrefCalled = false;

  constructor(
    private readonly closeOnKill: false | "sync" | "async" = false,
  ) {
    super();
  }

  kill() {
    this.killCount += 1;
    if (this.closeOnKill === "sync") {
      this.emit("close", null, "SIGKILL");
    } else if (this.closeOnKill === "async") {
      queueMicrotask(() => this.emit("close", null, "SIGKILL"));
    }
    return true;
  }

  unref() {
    this.unrefCalled = true;
  }
}

function childProcess(value: ControlledChild) {
  return value as unknown as VideoAssemblyChildProcess;
}

function isSafeProcessError(error: unknown) {
  return (
    error instanceof Error &&
    error.message === "Video assembly failed." &&
    !/private|secret|stack|ffmpeg/i.test(error.message)
  );
}

async function fixture(
  suffix: string,
  identity?: { slug: string; projectId: string },
) {
  const slug = identity?.slug ?? `${prefix}-${suffix}`;
  const projectId = identity?.projectId ?? "project-115";
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    Buffer.from([0, 0, 0, 0]),
  ]);

  for (const sceneId of [1, 2]) {
    const image = ImageStorage.saveImage({ projectSlug: slug, data: png, mimeType: "image/png" });
    const audio = AudioStorage.saveAudio({ projectSlug: slug, data: wav() });
    AssetManager.addAsset(slug, projectId, AssetManager.createAsset({
      id: `image-${sceneId}`,
      projectId,
      projectSlug: slug,
      sceneId,
      type: "image",
      status: "generated",
      provider: "openai",
      prompt: "safe",
      filePath: image.filePath,
      url: image.url,
      mimeType: "image/png",
    }));
    AssetManager.addAsset(slug, projectId, AssetManager.createAsset({
      id: `audio-${sceneId}`,
      projectId,
      projectSlug: slug,
      sceneId,
      type: "audio",
      status: "generated",
      provider: "openai",
      prompt: "safe",
      filePath: audio.filePath,
      url: audio.url,
      mimeType: "audio/wav",
      byteLength: audio.byteLength,
      durationSeconds: audio.durationSeconds,
    }));
  }

  const mix = AudioStorage.saveAudio({ projectSlug: slug, data: wav(32000) });
  AssetManager.addAsset(slug, projectId, AssetManager.createAsset({
    id: "mix-audio",
    projectId,
    projectSlug: slug,
    type: "audio",
    status: "generated",
    provider: "openai",
    prompt: "safe",
    filePath: mix.filePath,
    url: mix.url,
    mimeType: "audio/wav",
    byteLength: mix.byteLength,
    durationSeconds: mix.durationSeconds,
  }));
  return { slug, projectId };
}

async function replaceDirectoryWithExternalJunction(
  directory: string,
  files: Array<{ fileName: string; data: Buffer }>,
) {
  const external = await fs.mkdtemp(path.join(os.tmpdir(), `${prefix}-escape-`));
  externalFixtureDirectories.push(external);
  await Promise.all(
    files.map(({ fileName, data }) => fs.writeFile(path.join(external, fileName), data)),
  );
  await fs.rm(directory, { recursive: true, force: true });
  await fs.symlink(
    external,
    directory,
    process.platform === "win32" ? "junction" : "dir",
  );
}

async function withProjectsRootJunction(test: () => Promise<void>) {
  const backup = path.join(
    path.dirname(projectsRoot),
    `${prefix}-projects-backup`,
  );
  const external = await fs.mkdtemp(
    path.join(os.tmpdir(), `${prefix}-projects-root-`),
  );
  externalFixtureDirectories.push(external);
  await fs.rename(projectsRoot, backup);

  try {
    await fs.symlink(
      external,
      projectsRoot,
      process.platform === "win32" ? "junction" : "dir",
    );
    await test();
  } finally {
    try {
      await fs.rm(projectsRoot, { recursive: true, force: true });
    } finally {
      await fs.rename(backup, projectsRoot);
    }
  }
}

async function expectFailure(
  suffix: string,
  mutate: (value: Awaited<ReturnType<typeof fixture>>) => void | Promise<void>,
  provider: VideoAssemblyProvider = new FFmpegVideoAssemblyProvider(new FakeRunner()),
  audio = baseAudio,
  sceneData = scenes,
  visualData = visuals,
  assemblyData = assembly,
) {
  const value = await fixture(suffix);
  await mutate(value);
  await assert.rejects(
    VideoAssemblyManager.renderExistingAssets({
      projectId: value.projectId,
      projectSlug: value.slug,
      scenes: sceneData,
      visuals: visualData,
      audio,
      assembly: assemblyData,
      provider,
    }),
    (error) =>
      error instanceof VideoAssemblyError &&
      error.message === "Video assembly failed." &&
      error.stack === undefined,
  );
  return AssetManager.getProjectAssets(value.slug, value.projectId);
}

async function createAssemblyRunnerFixture(suffix: string) {
  const project = await ProjectManager.createProject(`${prefix}-runner-${suffix}`);
  await fixture(suffix, { slug: project.slug, projectId: project.id });
  const jobs: PipelineJobList = {
    projectSlug: project.slug,
    jobs: [
      {
        id: `${project.slug}-assembly`,
        projectSlug: project.slug,
        stage: "assembly",
        title: "Assembly",
        status: "queued",
        attempts: 0,
        createdAt: now,
        updatedAt: now,
      },
    ],
    createdAt: now,
    updatedAt: now,
  };
  await fs.writeFile(
    path.join(projectsRoot, project.slug, "pipeline-jobs.json"),
    JSON.stringify(jobs, null, 2),
    "utf8",
  );
  const state = {
    ...PipelineStageExecutor.createInitialState(project),
    script: {
      topic: "T",
      title: "T",
      subtitle: "",
      hook: "",
      introduction: "",
      chapters: [],
      conclusion: "",
      callToAction: "",
      estimatedDuration: 2,
      narrationWordCount: 2,
      targetAudience: "all",
      language: "tr",
      voiceStyle: "doc",
      musicStyle: "none",
      thumbnailIdea: "",
      seoKeywords: [],
      createdAt: now,
    },
    scenes,
    visuals,
    animation: { projectId: project.id, scenes: [], createdAt: now },
    video: { projectId: project.id, status: "generated", scenes: [], createdAt: now },
    audio: baseAudio,
  } as PipelineExecutionState;
  return { project, state };
}

async function runAssemblyFailureThroughRunner(durable: boolean) {
  const fixtureValue = await createAssemblyRunnerFixture(
    durable ? "durable" : "legacy",
  );
  const originalPlan = AssemblyManager.generateAssemblyPlan;
  const originalConsoleError = console.error;
  const logs: unknown[][] = [];
  let durableExecution:
    | Awaited<ReturnType<typeof prepareProductionPipelineExecution>>
    | null = null;
  const failedProvider: VideoAssemblyProvider = {
    name: "ffmpeg",
    async assemble() {
      return {
        success: false,
        provider: "ffmpeg",
        createdAt: new Date().toISOString(),
        error: "Video assembly failed.",
      };
    },
  };

  const action = () =>
    PipelineStageExecutor.execute(
      fixtureValue.project.slug,
      "assembly",
      fixtureValue.state,
      { videoAssemblyProvider: failedProvider },
    );

  try {
    AssemblyManager.generateAssemblyPlan = async () => ({
      ...assembly,
      projectId: fixtureValue.project.id,
      slug: fixtureValue.project.slug,
    });
    console.error = (...args: unknown[]) => logs.push(args);

    if (durable) {
      durableExecution = await prepareProductionPipelineExecution({
        projectSlug: fixtureValue.project.slug,
        stage: "assembly",
        runType: "initial",
      });
      PipelineRunner.configureDurableExecution(
        new ProductionPipelineExecutionAdapter(
          durableExecution.adapter,
          () => durableExecution!.request,
        ),
      );
    }

    await assert.rejects(
      durable
        ? pipelineRunner.runStage(
            fixtureValue.project.slug,
            "assembly",
            action,
            "initial",
          )
        : pipelineRunner.runStageLegacy(
            fixtureValue.project.slug,
            "assembly",
            action,
            "initial",
          ),
      (error) =>
        durable
          ? error instanceof ProductionPipelineDurableExecutionError &&
            error.message === "Pipeline stage execution failed."
          : error instanceof VideoAssemblyError &&
            error.message === "Video assembly failed." &&
            error.stack === undefined,
    );
  } finally {
    PipelineRunner.configureDurableExecution();
    AssemblyManager.generateAssemblyPlan = originalPlan;
    console.error = originalConsoleError;
  }

  let durableAttempt: Record<string, unknown> | null = null;

  if (durableExecution) {
    const attemptId = durableExecution.request.coordinator.attempt.attemptId;
    const listed = await durableExecution.adapter.listKeys("attempt");
    const latestKey = listed.ok
      ? listed.keys
          .map((key) => ({
            key,
            match: new RegExp(`^${attemptId}-v([1-9][0-9]*)$`).exec(key),
          }))
          .filter((item) => item.match)
          .sort((left, right) => Number(right.match![1]) - Number(left.match![1]))[0]
          ?.key
      : undefined;
    const read = latestKey
      ? await durableExecution.adapter.read("attempt", latestKey)
      : null;
    durableAttempt = read?.status === "found"
      ? (read.value as unknown as Record<string, unknown>)
      : null;
  }

  const readJson = async <T>(fileName: string) =>
    JSON.parse(
      await fs.readFile(
        path.join(projectsRoot, fixtureValue.project.slug, fileName),
        "utf8",
      ),
    ) as T;

  return {
    jobs: await readJson<PipelineJobList>("pipeline-jobs.json"),
    manifest: await readJson<ProjectManifest>("manifest.json"),
    history: await readJson<PipelineJobHistory>("pipeline-history.json"),
    project: await readJson<Project>("project.json"),
    logs,
    durableAttempt,
    durableTerminalEventId: durableExecution?.request.terminalEventId ?? null,
    assemblyPersisted: await fs
      .access(path.join(projectsRoot, fixtureValue.project.slug, "assembly.json"))
      .then(() => true, () => false),
  };
}

async function runPublicPipelineAssemblyFailure() {
  const topic = `${prefix}-public-runner`;
  const slug = ProjectManager.createSlug(topic);
  const originalExecute = PipelineStageExecutor.execute;
  const originalPlan = AssemblyManager.generateAssemblyPlan;
  const originalCompletion = PipelineJobManager.persistProjectCompletion;
  const originalConsoleError = console.error;
  const executedStages: ProductionStepKey[] = [];
  let completionCalls = 0;
  let projectId = "";
  let assetsReady = false;
  const failedProvider: VideoAssemblyProvider = {
    name: "ffmpeg",
    async assemble() {
      return {
        success: false,
        provider: "ffmpeg",
        createdAt: new Date().toISOString(),
        error: "Video assembly failed.",
      };
    },
  };

  try {
    console.error = () => {};
    PipelineJobManager.persistProjectCompletion = async (
      projectSlug,
      persist,
    ) => {
      completionCalls += 1;
      return originalCompletion.call(PipelineJobManager, projectSlug, persist);
    };
    AssemblyManager.generateAssemblyPlan = async () => ({
      ...assembly,
      projectId,
      slug,
    });
    PipelineStageExecutor.execute = async (
      projectSlug,
      stage,
      state,
      options = {},
    ) => {
      executedStages.push(stage);
      projectId = state.project.id;
      state.script = {
        topic: "T",
        title: "T",
        subtitle: "",
        hook: "",
        introduction: "",
        chapters: [],
        conclusion: "",
        callToAction: "",
        estimatedDuration: 2,
        narrationWordCount: 2,
        targetAudience: "all",
        language: "tr",
        voiceStyle: "doc",
        musicStyle: "none",
        thumbnailIdea: "",
        seoKeywords: [],
        createdAt: now,
      };
      state.scenes = scenes;
      state.visuals = visuals;
      state.animation = { projectId, scenes: [], createdAt: now };
      state.video = {
        projectId,
        status: "generated",
        scenes: [],
        createdAt: now,
      };
      state.audio = baseAudio;

      if (stage === "assembly") {
        if (!assetsReady) {
          await fixture("public-runner", { slug: projectSlug, projectId });
          assetsReady = true;
        }
        return originalExecute(projectSlug, stage, state, {
          ...options,
          videoAssemblyProvider: failedProvider,
        });
      }

      return PipelineJobManager.persistStageSuccess(
        projectSlug,
        stage,
        async () => {},
      );
    };

    await assert.rejects(
      PipelineRunner.run(topic),
      (error) =>
        error instanceof VideoAssemblyError &&
        error.message === "Video assembly failed." &&
        error.stack === undefined,
    );
  } finally {
    PipelineStageExecutor.execute = originalExecute;
    AssemblyManager.generateAssemblyPlan = originalPlan;
    PipelineJobManager.persistProjectCompletion = originalCompletion;
    console.error = originalConsoleError;
  }

  const readJson = async <T>(fileName: string) =>
    JSON.parse(
      await fs.readFile(path.join(projectsRoot, slug, fileName), "utf8"),
    ) as T;

  return {
    completionCalls,
    executedStages,
    jobs: await readJson<PipelineJobList>("pipeline-jobs.json"),
    manifest: await readJson<ProjectManifest>("manifest.json"),
    history: await readJson<PipelineJobHistory>("pipeline-history.json"),
    project: await readJson<Project>("project.json"),
  };
}

async function main() {
  try {
    await scenario("undefined and blank provider resolve to mock", () => {
      assert.equal(resolveVideoAssemblyProviderName(undefined), "mock");
      assert.equal(resolveVideoAssemblyProviderName("  "), "mock");
    });
    await scenario("explicit provider resolution is deterministic", () => {
      assert.equal(resolveVideoAssemblyProviderName(" FFMPEG "), "ffmpeg");
      assert.ok(VideoAssemblyProviderRouter.getProvider("mock") instanceof MockVideoAssemblyProvider);
      assert.ok(VideoAssemblyProviderRouter.getProvider("ffmpeg") instanceof FFmpegVideoAssemblyProvider);
    });
    await scenario("unknown provider fails closed", () => {
      assert.throws(() => resolveVideoAssemblyProviderName("other"), VideoAssemblyConfigurationError);
    });
    await scenario("FFmpeg config requires absolute executable paths", () => {
      env("FFMPEG_PATH", "ffmpeg");
      env("FFPROBE_PATH", "ffprobe");
      assert.throws(() => getFFmpegVideoAssemblyConfig(), VideoAssemblyConfigurationError);
    });

    const executableDir = path.join(projectsRoot, `${prefix}-executables`);
    await fs.mkdir(executableDir, { recursive: true });
    const ffmpegPath = path.join(executableDir, "ffmpeg.exe");
    const ffprobePath = path.join(executableDir, "ffprobe.exe");
    await fs.writeFile(ffmpegPath, "fake");
    await fs.writeFile(ffprobePath, "fake");
    env("FFMPEG_PATH", ffmpegPath);
    env("FFPROBE_PATH", ffprobePath);
    env("VIDEO_ASSEMBLY_PROVIDER", "ffmpeg");

    await scenario("bounded config defaults and invalid integers", () => {
      env("FFMPEG_TIMEOUT_MS", undefined);
      env("VIDEO_ASSEMBLY_MAX_OUTPUT_BYTES", undefined);
      const config = getFFmpegVideoAssemblyConfig();
      assert.equal(config.timeoutMs, 900000);
      assert.equal(config.maxOutputBytes, 4 * 1024 * 1024 * 1024);
      env("FFMPEG_TIMEOUT_MS", "0");
      assert.throws(() => getFFmpegVideoAssemblyConfig(), VideoAssemblyConfigurationError);
      env("FFMPEG_TIMEOUT_MS", undefined);
    });
    await scenario("FFmpeg and FFprobe paths must be distinct", () => {
      env("FFPROBE_PATH", process.env.FFMPEG_PATH);
      assert.throws(() => getFFmpegVideoAssemblyConfig(), VideoAssemblyConfigurationError);
      env("FFPROBE_PATH", ffprobePath);
    });
    await scenario("production spawn keeps safe options and separate arguments", async () => {
      const child = new ControlledChild();
      let captured:
        | { executable: string; args: readonly string[]; options: Parameters<VideoAssemblySpawn>[2] }
        | undefined;
      const spawnProcess: VideoAssemblySpawn = (executable, args, options) => {
        captured = { executable, args, options };
        queueMicrotask(() => child.emit("close", 0, null));
        return childProcess(child);
      };
      const result = await new SpawnRunner(spawnProcess, 20).run(
        "C:\\safe\\ffmpeg.exe",
        ["-i", "C:\\safe path\\input.wav"],
        { timeoutMs: 100, maxOutputBytes: 1024 },
      );
      assert.equal(result.exitCode, 0);
      assert.equal(captured?.options.shell, false);
      assert.equal(captured?.options.windowsHide, true);
      assert.deepEqual(captured?.options.stdio, ["ignore", "pipe", "pipe"]);
      assert.deepEqual(captured?.args, ["-i", "C:\\safe path\\input.wav"]);
    });
    await scenario("never-closing process settles after bounded timeout and kill", async () => {
      const child = new ControlledChild();
      const startedAt = Date.now();
      await assert.rejects(
        new SpawnRunner(() => childProcess(child), 20).run("safe", [], {
          timeoutMs: 10,
          maxOutputBytes: 1024,
        }),
        isSafeProcessError,
      );
      assert.ok(Date.now() - startedAt < 500);
      assert.ok(child.killCount >= 2);
      assert.equal(child.unrefCalled, true);
      assert.equal(child.listenerCount("close"), 0);
      assert.equal(child.stdout.destroyed, true);
      assert.equal(child.stderr.destroyed, true);
    });
    await scenario("synchronous kill-induced close creates no late timers", async () => {
      const child = new ControlledChild("sync");
      const result = await new SpawnRunner(() => childProcess(child), 40).run(
        "safe",
        [],
        { timeoutMs: 5, maxOutputBytes: 1024 },
      );
      assert.equal(result.timedOut, true);
      assert.equal(result.failed, true);
      assert.equal(result.signal, "SIGKILL");
      await new Promise((resolve) => setTimeout(resolve, 60));
      assert.equal(child.killCount, 1);
      assert.equal(child.unrefCalled, false);
    });
    for (const streamName of ["stdout", "stderr"] as const) {
      await scenario(`${streamName} stream error fails closed and settles`, async () => {
        const child = new ControlledChild();
        const promise = new SpawnRunner(() => childProcess(child), 20).run(
          "safe",
          [],
          { timeoutMs: 1_000, maxOutputBytes: 1024 },
        );
        queueMicrotask(() =>
          child[streamName].emit(
            "error",
            new Error("C:\\private API_KEY=secret stack"),
          ),
        );
        await assert.rejects(promise, isSafeProcessError);
        assert.ok(child.killCount >= 2);
        assert.equal(child[streamName].listenerCount("error"), 1);
      });
    }
    for (const streamName of ["stdout", "stderr"] as const) {
      await scenario(`${streamName} overflow kills and settles safely`, async () => {
        const child = new ControlledChild();
        const promise = new SpawnRunner(() => childProcess(child), 20).run(
          "safe",
          [],
          { timeoutMs: 1_000, maxOutputBytes: 8 },
        );
        child[streamName].write(Buffer.alloc(9));
        await assert.rejects(promise, isSafeProcessError);
        assert.ok(child.killCount >= 2);
      });
    }
    await scenario("synchronous spawn exception is sanitized", async () => {
      await assert.rejects(
        new SpawnRunner(() => {
          throw new Error("C:\\private\\ffmpeg.exe API_KEY=secret stack");
        }).run("safe", [], { timeoutMs: 100, maxOutputBytes: 1024 }),
        isSafeProcessError,
      );
    });
    await scenario("asynchronous spawn error is bounded and sanitized", async () => {
      const child = new ControlledChild();
      const promise = new SpawnRunner(() => childProcess(child), 20).run(
        "C:\\private\\ffmpeg.exe",
        [],
        { timeoutMs: 1_000, maxOutputBytes: 1024 },
      );
      queueMicrotask(() =>
        child.emit("error", new Error("C:\\private API_KEY=secret stack")),
      );
      await assert.rejects(promise, isSafeProcessError);
      assert.ok(child.killCount >= 2);
      assert.equal(child.listenerCount("error"), 1);
    });
    for (const source of ["child", "stdout", "stderr"] as const) {
      await scenario(`forced settlement safely absorbs late ${source} error`, async () => {
        const child = new ControlledChild();
        await assert.rejects(
          new SpawnRunner(() => childProcess(child), 10).run("safe", [], {
            timeoutMs: 5,
            maxOutputBytes: 1024,
          }),
          isSafeProcessError,
        );
        assert.doesNotThrow(() => {
          if (source === "child") {
            child.emit("error", new Error("late child secret"));
          } else {
            child[source].emit("error", new Error(`late ${source} secret`));
          }
        });
      });
    }
    await scenario("mock keeps plan-only behavior and writes no video asset", async () => {
      const result = await VideoAssemblyManager.renderExistingAssets({
        projectId: "project-115",
        projectSlug: `${prefix}-mock`,
        scenes,
        visuals,
        audio: baseAudio,
        assembly,
        provider: new MockVideoAssemblyProvider(),
      });
      assert.equal(result.render?.status, "planned");
      await assert.rejects(fs.access(path.join(projectsRoot, `${prefix}-mock`, "assets", "assets.json")));
    });
    await scenario("malformed mock result fails safely", async () => {
      const provider: VideoAssemblyProvider = {
        name: "mock",
        async assemble() {
          return { ...(await new MockVideoAssemblyProvider().assemble()), url: "https://example.test/raw" } as VideoAssemblyResult;
        },
      };
      await assert.rejects(
        VideoAssemblyManager.renderExistingAssets({ projectId: "project-115", projectSlug: `${prefix}-bad-mock`, scenes, visuals, audio: baseAudio, assembly, provider }),
        (error) => error instanceof VideoAssemblyError,
      );
    });
    await scenario("scene identity mismatch fails before provider call", async () => {
      let calls = 0;
      const provider: VideoAssemblyProvider = { name: "mock", async assemble() { calls += 1; return new MockVideoAssemblyProvider().assemble(); } };
      await assert.rejects(
        VideoAssemblyManager.renderExistingAssets({ projectId: "project-115", projectSlug: `${prefix}-identity`, scenes, visuals: { ...visuals, scenes: visuals.scenes.slice(0, 1) }, audio: baseAudio, assembly, provider }),
        (error) => error instanceof VideoAssemblyError,
      );
      assert.equal(calls, 0);
    });
    await scenario("duplicate canonical scene id fails closed", async () => {
      const duplicate = { ...scenes, scenes: [scenes.scenes[0], { ...scenes.scenes[1], id: 1 }] };
      await assert.rejects(
        VideoAssemblyManager.renderExistingAssets({ projectId: "project-115", projectSlug: `${prefix}-duplicate-id`, scenes: duplicate, visuals, audio: baseAudio, assembly, provider: new MockVideoAssemblyProvider() }),
        (error) => error instanceof VideoAssemblyError,
      );
    });
    await scenario("throwing identity getter is normalized", async () => {
      const malformed = {
        ...scenes,
        scenes: [
          Object.defineProperty({}, "id", {
            get() {
              throw new Error("C:\\private API_KEY=secret stack");
            },
          }),
        ],
      } as SceneData;
      await assert.rejects(
        VideoAssemblyManager.renderExistingAssets({ projectId: "project-115", projectSlug: `${prefix}-getter`, scenes: malformed, visuals, audio: baseAudio, assembly, provider: new MockVideoAssemblyProvider() }),
        (error) =>
          error instanceof VideoAssemblyError &&
          error.message === "Video assembly failed." &&
          error.stack === undefined,
      );
    });
    await scenario("missing section asset id fails before process", async () => {
      const audio = { ...baseAudio, sections: [{ ...baseAudio.sections[0], outputAssetId: undefined }, baseAudio.sections[1]] };
      const runner = new FakeRunner();
      await expectFailure("missing-audio-id", () => undefined, new FFmpegVideoAssemblyProvider(runner), audio);
      assert.equal(runner.calls.length, 0);
    });
    await scenario("assembly audioAssetId mismatch fails before process", async () => {
      const runner = new FakeRunner();
      const mismatched = {
        ...assembly,
        scenes: assembly.scenes.map((scene) =>
          scene.sceneId === 1 ? { ...scene, audioAssetId: "audio-2" } : scene,
        ),
      };
      await expectFailure(
        "assembly-audio-mismatch",
        () => undefined,
        new FFmpegVideoAssemblyProvider(runner),
        baseAudio,
        scenes,
        visuals,
        mismatched,
      );
      assert.equal(runner.calls.length, 0);
    });
    await scenario("ambiguous real image fails before process", async () => {
      const runner = new FakeRunner();
      await expectFailure("ambiguous-image", async ({ slug, projectId }) => {
        const image = ImageStorage.saveImage({ projectSlug: slug, data: Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.alloc(4)]), mimeType: "image/png" });
        AssetManager.addAsset(slug, projectId, AssetManager.createAsset({ projectId, projectSlug: slug, sceneId: 1, type: "image", status: "generated", provider: "openai", prompt: "safe", filePath: image.filePath, url: image.url, mimeType: "image/png" }));
      }, new FFmpegVideoAssemblyProvider(runner));
      assert.equal(runner.calls.length, 0);
    });
    await scenario("unsafe registry locator fails closed", async () => {
      await expectFailure("unsafe-path", ({ slug, projectId }) => {
        const current = AssetManager.getProjectAssets(slug, projectId);
        AssetManager.saveProjectAssets(slug, { ...current, assets: current.assets.map((asset) => asset.id === "image-1" ? { ...asset, filePath: "C:\\private\\image.png" } : asset) });
      });
    });
    await scenario("corrupt stored image fails closed", async () => {
      await expectFailure("corrupt-image", async ({ slug, projectId }) => {
        const current = AssetManager.getProjectAssets(slug, projectId);
        const image = current.assets.find((asset) => asset.id === "image-1")!;
        await fs.writeFile(path.resolve(process.cwd(), ...(image.filePath as string).split("/")), "bad");
      });
    });
    await scenario("image storage junction escape fails before process", async () => {
      const runner = new FakeRunner();
      await expectFailure("image-junction", async ({ slug, projectId }) => {
        const current = AssetManager.getProjectAssets(slug, projectId);
        const image = current.assets.find((asset) => asset.id === "image-1")!;
        const absolutePath = path.resolve(process.cwd(), ...(image.filePath as string).split("/"));
        const data = await fs.readFile(absolutePath);
        await replaceDirectoryWithExternalJunction(path.dirname(absolutePath), [
          { fileName: path.basename(absolutePath), data },
        ]);
      }, new FFmpegVideoAssemblyProvider(runner));
      assert.equal(runner.calls.length, 0);
    });
    await scenario("audio storage junction escape fails before process", async () => {
      const runner = new FakeRunner();
      await expectFailure("audio-junction", async ({ slug, projectId }) => {
        const current = AssetManager.getProjectAssets(slug, projectId);
        const audioAsset = current.assets.find((asset) => asset.id === "audio-1")!;
        const absolutePath = path.resolve(process.cwd(), ...(audioAsset.filePath as string).split("/"));
        const data = await fs.readFile(absolutePath);
        await replaceDirectoryWithExternalJunction(path.dirname(absolutePath), [
          { fileName: path.basename(absolutePath), data },
        ]);
      }, new FFmpegVideoAssemblyProvider(runner));
      assert.equal(runner.calls.length, 0);
    });
    await scenario("WAV metadata mismatch fails closed", async () => {
      await expectFailure("wav-mismatch", ({ slug, projectId }) => {
        const current = AssetManager.getProjectAssets(slug, projectId);
        AssetManager.saveProjectAssets(slug, { ...current, assets: current.assets.map((asset) => asset.id === "audio-1" ? { ...asset, durationSeconds: 99 } : asset) });
      });
    });
    await scenario("valid fake FFmpeg render creates verified registry asset", async () => {
      const value = await fixture("success");
      const runner = new FakeRunner();
      const result = await VideoAssemblyManager.renderExistingAssets({ projectId: value.projectId, projectSlug: value.slug, scenes, visuals, audio: baseAudio, assembly, provider: new FFmpegVideoAssemblyProvider(runner) });
      assert.equal(result.render?.status, "rendered");
      assert.equal(result.render?.mimeType, "video/mp4");
      assert.ok(result.outputAssetId);
      assert.equal(runner.calls.length, 2);
      const registered = AssetManager.getProjectAssets(value.slug, value.projectId).assets.find((asset) => asset.id === result.outputAssetId)!;
      assert.equal(registered.type, "video");
      assert.equal(registered.status, "generated");
      assert.equal(registered.provider, "ffmpeg");
      assert.equal(registered.prompt, "Video assembly request.");
      assert.doesNotMatch(JSON.stringify(registered), /ffmpeg\.exe|Narration|private/i);
    });
    await scenario("FFmpeg arguments use canonical inputs and safe codecs", async () => {
      const value = await fixture("args");
      const runner = new FakeRunner();
      await VideoAssemblyManager.renderExistingAssets({ projectId: value.projectId, projectSlug: value.slug, scenes, visuals, audio: baseAudio, assembly, provider: new FFmpegVideoAssemblyProvider(runner) });
      const args = runner.calls[0].args;
      assert.ok(args.includes("libx264"));
      assert.ok(args.includes("yuv420p"));
      assert.ok(args.includes("aac"));
      assert.ok(args.includes("+faststart"));
      assert.equal(args.filter((value) => value === "-i").length, 4);
      assert.doesNotMatch(args.join(" "), /Narration 1|Narration 2/);
    });
    await scenario("timeout and nonzero process results fail safely", async () => {
      const timeout = new FFmpegVideoAssemblyProvider(new FakeRunner({ timedOut: true }));
      const assets = await expectFailure("timeout", () => undefined, timeout);
      assert.equal(assets.assets.at(-1)?.status, "failed");
      assert.equal(assets.assets.at(-1)?.error, "Video assembly failed.");
      await expectFailure("nonzero", () => undefined, new FFmpegVideoAssemblyProvider(new FakeRunner({ exitCode: 1 })));
      await expectFailure("signal", () => undefined, new FFmpegVideoAssemblyProvider(new FakeRunner({ exitCode: null, signal: "SIGTERM" })));
    });
    await scenario("production child signal exit fails closed", async () => {
      const child = new ControlledChild();
      const spawnProcess: VideoAssemblySpawn = () => {
        queueMicrotask(() => child.emit("close", null, "SIGTERM"));
        return childProcess(child);
      };
      await expectFailure(
        "production-signal",
        () => undefined,
        new FFmpegVideoAssemblyProvider(new SpawnRunner(spawnProcess, 20)),
      );
      assert.equal(child.stdout.destroyed, true);
      assert.equal(child.stderr.destroyed, true);
      assert.equal(child.listenerCount("close"), 0);
    });
    await scenario("invalid probe codec fails without final asset", async () => {
      const probe = JSON.stringify({ format: { format_name: "mp4", duration: "2" }, streams: [{ codec_type: "video", codec_name: "vp9", width: 1920, height: 1080, pix_fmt: "yuv420p" }, { codec_type: "audio", codec_name: "aac" }] });
      const assets = await expectFailure("probe-codec", () => undefined, new FFmpegVideoAssemblyProvider(new FakeRunner(null, probe)));
      assert.equal(assets.assets.filter((asset) => asset.type === "video" && asset.status === "generated").length, 0);
    });
    await scenario("malformed probe output is sanitized", async () => {
      const assets = await expectFailure("probe-json", () => undefined, new FFmpegVideoAssemblyProvider(new FakeRunner(null, "C:\\private API_KEY=secret stack")));
      assert.doesNotMatch(JSON.stringify(assets), /private|API_KEY|secret|stack/i);
    });
    await scenario("video route serves verified MP4 and rejects traversal", async () => {
      const value = await fixture("route");
      const result = await VideoAssemblyManager.renderExistingAssets({ projectId: value.projectId, projectSlug: value.slug, scenes, visuals, audio: baseAudio, assembly, provider: new FFmpegVideoAssemblyProvider(new FakeRunner()) });
      const fileName = path.posix.basename(result.render?.filePath as string);
      const response = await getVideo(new Request("http://local.test"), { params: Promise.resolve({ slug: value.slug, fileName }) });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("content-type"), "video/mp4");
      assert.ok((await response.arrayBuffer()).byteLength > 0);
      const rejected = await getVideo(new Request("http://local.test"), { params: Promise.resolve({ slug: value.slug, fileName: "../secret.mp4" }) });
      assert.equal(rejected.status, 404);
    });
    await scenario("video route rejects storage junction escape", async () => {
      const value = await fixture("route-junction");
      const result = await VideoAssemblyManager.renderExistingAssets({ projectId: value.projectId, projectSlug: value.slug, scenes, visuals, audio: baseAudio, assembly, provider: new FFmpegVideoAssemblyProvider(new FakeRunner()) });
      const filePath = result.render?.filePath as string;
      const absolutePath = path.resolve(process.cwd(), ...filePath.split("/"));
      const data = await fs.readFile(absolutePath);
      await replaceDirectoryWithExternalJunction(path.dirname(absolutePath), [
        { fileName: path.basename(absolutePath), data },
      ]);
      const response = await getVideo(new Request("http://local.test"), {
        params: Promise.resolve({ slug: value.slug, fileName: path.basename(absolutePath) }),
      });
      assert.equal(response.status, 404);
    });
    await scenario("trusted data projects root junction fails closed", async () => {
      await withProjectsRootJunction(async () => {
        assert.throws(() =>
          ImageStorage.inspectStoredImage(
            "root-junction",
            "data/projects/root-junction/assets/images/image.png",
            "image/png",
          ),
        );
        assert.throws(() =>
          AudioStorage.inspectStoredWav(
            "root-junction",
            "data/projects/root-junction/assets/audio/audio.wav",
          ),
        );
        const response = await getVideo(new Request("http://local.test"), {
          params: Promise.resolve({
            slug: "root-junction",
            fileName: "video.mp4",
          }),
        });
        assert.equal(response.status, 404);
      });
    });
    await scenario("VideoStorage rejects missing MP4 boxes", async () => {
      const file = path.join(projectsRoot, `${prefix}-invalid.mp4`);
      await fs.writeFile(file, box("ftyp"));
      assert.throws(() => VideoStorage.inspectMp4(file, 1024));
    });
    await scenario("assembly stage keeps plan-render-save ordering in mock mode", async () => {
      const originalPlan = AssemblyManager.generateAssemblyPlan;
      const originalPersist = PipelineJobManager.persistStageSuccess;
      const order: string[] = [];
      AssemblyManager.generateAssemblyPlan = async () => { order.push("plan"); return assembly; };
      PipelineJobManager.persistStageSuccess = async (_slug, _stage, persist) => { order.push("persist"); await persist(); order.push("success"); return true; };
      const state = {
        ...PipelineStageExecutor.createInitialState({ id: "project-115", slug: `${prefix}-stage`, title: "Stage", status: "audio", createdAt: now, updatedAt: now }),
        script: { topic: "T", title: "T", subtitle: "", hook: "", introduction: "", chapters: [], conclusion: "", callToAction: "", estimatedDuration: 2, narrationWordCount: 2, targetAudience: "all", language: "tr", voiceStyle: "doc", musicStyle: "none", thumbnailIdea: "", seoKeywords: [], createdAt: now },
        scenes,
        visuals,
        animation: { projectId: "project-115", scenes: [], createdAt: now },
        video: { projectId: "project-115", status: "generated", scenes: [], createdAt: now },
        audio: baseAudio,
      } as PipelineExecutionState;
      try {
        assert.equal(await PipelineStageExecutor.execute(state.project.slug, "assembly", state, { videoAssemblyProvider: new MockVideoAssemblyProvider() }), true);
        assert.deepEqual(order, ["plan", "persist", "success"]);
        assert.equal(state.assembly?.render?.status, "planned");
      } finally {
        AssemblyManager.generateAssemblyPlan = originalPlan;
        PipelineJobManager.persistStageSuccess = originalPersist;
      }
    });
    const legacyFailure = await runAssemblyFailureThroughRunner(false);
    await scenario("real PipelineRunner persists terminal assembly failure", () => {
      const assemblyJob = legacyFailure.jobs.jobs.find(
        (job) => job.stage === "assembly",
      );
      assert.equal(assemblyJob?.status, "failed");
      assert.equal(legacyFailure.manifest.packages.assembly.status, "failed");
      assert.ok(
        legacyFailure.history.events.some(
          (event) => event.stage === "assembly" && event.status === "failed",
        ),
      );
      assert.equal(
        legacyFailure.jobs.jobs.some((job) => job.stage === "thumbnail"),
        false,
      );
      assert.equal(legacyFailure.assemblyPersisted, false);
      assert.notEqual(legacyFailure.project.status, "completed");
      assert.doesNotMatch(
        JSON.stringify(legacyFailure),
        /private|API_KEY|secret|stack|raw provider/i,
      );
    });
    const publicFailure = await runPublicPipelineAssemblyFailure();
    await scenario("public scheduled PipelineRunner blocks project completion", () => {
      assert.ok(publicFailure.executedStages.includes("assembly"));
      assert.equal(publicFailure.executedStages.includes("thumbnail"), false);
      assert.equal(publicFailure.completionCalls, 0);
      assert.equal(
        publicFailure.jobs.jobs.find((job) => job.stage === "assembly")?.status,
        "failed",
      );
      assert.equal(publicFailure.manifest.packages.assembly.status, "failed");
      assert.ok(
        publicFailure.history.events.some(
          (event) => event.stage === "assembly" && event.status === "failed",
        ),
      );
      assert.notEqual(publicFailure.project.status, "completed");
    });
    const durableFailure = await runAssemblyFailureThroughRunner(true);
    await scenario("durable runner readback records terminal assembly failure", () => {
      assert.equal(durableFailure.durableAttempt?.state, "failed");
      const journal = durableFailure.durableAttempt?.journal as
        | Array<{ entryId?: string }>
        | undefined;
      assert.ok(
        journal?.some(
          (entry) => entry.entryId === durableFailure.durableTerminalEventId,
        ),
      );
      assert.equal(
        durableFailure.jobs.jobs.find((job) => job.stage === "assembly")?.status,
        "failed",
      );
      assert.equal(durableFailure.manifest.packages.assembly.status, "failed");
      assert.ok(
        durableFailure.history.events.some(
          (event) => event.stage === "assembly" && event.status === "failed",
        ),
      );
      assert.equal(
        durableFailure.jobs.jobs.some((job) => job.stage === "thumbnail"),
        false,
      );
      assert.equal(durableFailure.assemblyPersisted, false);
      assert.notEqual(durableFailure.project.status, "completed");
    });
    await scenario("source contains no new runner or lifecycle", async () => {
      const source = await fs.readFile(path.join(process.cwd(), "src", "lib", "assembly", "VideoAssemblyManager.ts"), "utf8");
      assert.doesNotMatch(source, /PipelineRunner|ProductionRuntimeCompositionRoot|ProductionWorkerLifecycle/);
    });

    console.log(`Sprint 115 production video assembly wiring smoke: PASS (${count} scenarios)`);
  } finally {
    env("VIDEO_ASSEMBLY_PROVIDER", originalEnvironment.provider);
    env("FFMPEG_PATH", originalEnvironment.ffmpegPath);
    env("FFPROBE_PATH", originalEnvironment.ffprobePath);
    env("FFMPEG_TIMEOUT_MS", originalEnvironment.timeout);
    env("VIDEO_ASSEMBLY_MAX_OUTPUT_BYTES", originalEnvironment.maxOutput);
    env("FFMPEG_MAX_STDIO_BYTES", originalEnvironment.maxStdio);
    PipelineRunner.configureDurableExecution();
    const cleanupResults = await Promise.allSettled([
      (async () => {
        const entries = await fs.readdir(projectsRoot, { withFileTypes: true });
        await Promise.all(
          entries
            .filter((entry) => entry.name.startsWith(prefix))
            .map((entry) =>
              fs.rm(path.join(projectsRoot, entry.name), {
                recursive: true,
                force: true,
              }),
            ),
        );
      })(),
      Promise.all(
        externalFixtureDirectories.map((directory) =>
          fs.rm(directory, { recursive: true, force: true }),
        ),
      ),
    ]);
    const cleanupFailure = cleanupResults.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );

    if (cleanupFailure) throw cleanupFailure.reason;
  }
}

void main();
