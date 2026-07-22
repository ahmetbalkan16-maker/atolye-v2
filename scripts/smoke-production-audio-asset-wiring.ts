import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  AudioAssetGenerationError,
  AudioPipeline,
} from "../src/lib/audio/AudioPipeline";
import { AudioManager } from "../src/lib/audio/AudioManager";
import type {
  AudioGenerationInput,
  AudioProvider,
} from "../src/lib/audio/providers/AudioProvider";
import {
  AUDIO_PROVIDER_CONFIGURATION_ERROR,
  AudioProviderConfigurationError,
  getOpenAIAudioProviderConfig,
  resolveAudioProviderName,
} from "../src/lib/audio/providers/AudioProviderConfig";
import { AudioProviderRouter } from "../src/lib/audio/providers/AudioProviderRouter";
import { MockAudioProvider } from "../src/lib/audio/providers/MockAudioProvider";
import { OpenAIAudioProvider } from "../src/lib/audio/providers/OpenAIAudioProvider";
import { AssetManager } from "../src/lib/assets/AssetManager";
import { AudioStorage } from "../src/lib/assets/storage/AudioStorage";
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
import { createRuntimeStorageContext } from "../src/lib/runtime/RuntimeStoragePaths";
import {
  createProductionRuntimeOperationContext,
  initialRuntimeAuthorityGeneration,
  runWithProductionRuntimeOperationContext,
} from "../src/lib/runtime/ProductionRuntimeOperationContext";
import type {
  AudioData,
  AudioGenerationResult,
} from "../src/types/audio";
import type { ProjectAssets } from "../src/types/asset";
import type {
  PipelineJobHistory,
  PipelineJobList,
} from "../src/types/pipelineJob";
import type {
  ProductionStepKey,
  Project,
  ProjectManifest,
  ProjectPackageRunType,
} from "../src/types/project";
import type { ScriptData } from "../src/types/script";
import { GET as getAudioAsset } from "../app/api/assets/audio/[slug]/[fileName]/route";

const fixturePrefix = `sprint-114-audio-assets-${process.pid}`;
const temporaryWorkspace = mkdtempSync(path.join(os.tmpdir(), "atolye-audio-wiring-"));
const temporaryRuntimeRoot = path.join(temporaryWorkspace, "runtime");
const projectsRoot = path.join(temporaryRuntimeRoot, "projects");
mkdirSync(projectsRoot, { recursive: true });
const previousRuntimeRoot = process.env.ATOLYE_RUNTIME_ROOT;
const now = "2026-07-13T12:00:00.000Z";
const originalEnvironment = {
  audioProvider: process.env.AUDIO_PROVIDER,
  openAIKey: process.env.OPENAI_API_KEY,
  ttsModel: process.env.OPENAI_TTS_MODEL,
  ttsVoice: process.env.OPENAI_TTS_VOICE,
  ttsTimeout: process.env.OPENAI_TTS_TIMEOUT_MS,
  ttsMaxResponseBytes: process.env.OPENAI_TTS_MAX_RESPONSE_BYTES,
};
let scenarioCount = 0;

const scriptData: ScriptData = {
  topic: "Sprint 114",
  title: "Production narration",
  subtitle: "Safe audio",
  hook: "Narration hook",
  introduction: "Narration introduction",
  chapters: [
    {
      id: 1,
      title: "First chapter",
      narration: "First narration section.",
      duration: 10,
      visualGoal: "First visual",
      emotion: "serious",
      transition: "cut",
    },
    {
      id: 2,
      title: "Second chapter",
      narration: "Second narration section.",
      duration: 10,
      visualGoal: "Second visual",
      emotion: "calm",
      transition: "fade",
    },
  ],
  conclusion: "Conclusion",
  callToAction: "Subscribe",
  estimatedDuration: 20,
  narrationWordCount: 6,
  targetAudience: "general",
  language: "tr",
  voiceStyle: "documentary",
  musicStyle: "cinematic",
  thumbnailIdea: "Narration",
  seoKeywords: ["narration"],
  createdAt: now,
};

const audioData: AudioData = {
  narrator: {
    style: "documentary",
    tone: "serious",
    language: "tr",
  },
  sections: scriptData.chapters.map((chapter) => ({
    chapterId: chapter.id,
    title: chapter.title,
    duration: "00:10",
    emotion: chapter.emotion,
    emphasis: [],
    narrationNotes: "Clear narration",
    pacing: "medium",
    sourceText: chapter.narration,
  })),
  music: {
    mood: "cinematic",
    suggestion: "none",
    intensity: "medium",
  },
  production: {
    targetFormat: "mp3",
    sampleRate: 44100,
    estimatedTotalDuration: "00:20",
    generationStatus: "planned",
  },
  createdAt: now,
};

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

const runner = PipelineRunner as unknown as PipelineRunnerInternals;

async function scenario(name: string, test: () => void | Promise<void>) {
  await test();
  scenarioCount += 1;
  if (process.env.SMOKE_TRACE === "1") {
    console.log(`PASS ${scenarioCount}: ${name}`);
  }
}

function setEnvironment(name: keyof NodeJS.ProcessEnv, value?: string) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

function createWav(dataByteLength = 1600) {
  const sampleRate = 8000;
  const channels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);
  const format = Buffer.alloc(16);
  format.writeUInt16LE(1, 0);
  format.writeUInt16LE(channels, 2);
  format.writeUInt32LE(sampleRate, 4);
  format.writeUInt32LE(byteRate, 8);
  format.writeUInt16LE(blockAlign, 12);
  format.writeUInt16LE(bitsPerSample, 14);

  return createRiff([
    createWavChunk("fmt ", format),
    createWavChunk("data", Buffer.alloc(dataByteLength)),
  ]);
}

function createWavChunk(id: string, data: Buffer) {
  const chunk = Buffer.alloc(8 + data.length + (data.length % 2));
  chunk.write(id, 0, 4, "ascii");
  chunk.writeUInt32LE(data.length, 4);
  data.copy(chunk, 8);
  return chunk;
}

function createRiff(chunks: Buffer[]) {
  const body = Buffer.concat(chunks);
  const buffer = Buffer.alloc(12 + body.length);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write("WAVE", 8, "ascii");
  body.copy(buffer, 12);
  return buffer;
}

function createProvider(
  name: "mock" | "openai",
  generate: (
    input: AudioGenerationInput,
  ) => AudioGenerationResult | Promise<AudioGenerationResult>,
  validate: (input: AudioGenerationInput) => void = () => undefined,
): AudioProvider {
  return {
    name,
    validateInput: validate,
    async generateAudio(input) {
      return generate(input);
    },
  };
}

function validMockResult(input: AudioGenerationInput): AudioGenerationResult {
  return {
    success: true,
    target: input.target,
    provider: "mock",
    model: "mock-audio-model",
    filePath: "",
    url: "",
    mimeType: "audio/mock",
    byteLength: 0,
    durationSeconds: 0,
    createdAt: now,
  };
}

function createStoredOpenAIResult(
  input: AudioGenerationInput,
  mutate?: (result: AudioGenerationResult) => unknown,
): AudioGenerationResult {
  const saved = AudioStorage.saveAudio({
    projectSlug: input.projectSlug,
    data: createWav(),
  });
  const result: AudioGenerationResult = {
    success: true,
    target: input.target,
    provider: "openai",
    model: "fake-tts-model",
    filePath: saved.filePath,
    url: saved.url,
    mimeType: "audio/wav",
    byteLength: saved.byteLength,
    durationSeconds: saved.durationSeconds,
    createdAt: now,
  };

  return (mutate ? mutate(result) : result) as AudioGenerationResult;
}

function assetsPath(slug: string) {
  return path.join(projectsRoot, slug, "assets", "assets.json");
}

async function readAssets(slug: string): Promise<ProjectAssets> {
  return JSON.parse(await fs.readFile(assetsPath(slug), "utf8")) as ProjectAssets;
}

async function generate(
  suffix: string,
  provider?: AudioProvider,
  audio: AudioData = audioData,
) {
  const slug = `${fixturePrefix}-${suffix}`;
  const result = await AudioPipeline.generateAudio({
    projectId: "project-114",
    projectSlug: slug,
    audio,
    provider,
  });
  return { slug, ...result };
}

async function expectSafeFailure(
  suffix: string,
  provider: AudioProvider,
  audio: AudioData = audioData,
) {
  const slug = `${fixturePrefix}-${suffix}`;
  await assert.rejects(
    AudioPipeline.generateAudio({
      projectId: "project-114",
      projectSlug: slug,
      audio,
      provider,
    }),
    isSafeAudioError,
  );
  return { slug, assets: await readAssets(slug) };
}

async function expectWriteFreeFailure(
  suffix: string,
  audio: AudioData,
  provider: AudioProvider = new MockAudioProvider(),
) {
  const slug = `${fixturePrefix}-${suffix}`;
  let calls = 0;
  const countingProvider = createProvider(
    provider.name,
    async (input) => {
      calls += 1;
      return provider.generateAudio(input);
    },
    (input) => provider.validateInput(input),
  );
  await assert.rejects(
    AudioPipeline.generateAudio({
      projectId: "project-114",
      projectSlug: slug,
      audio,
      provider: countingProvider,
    }),
    isSafeAudioError,
  );
  assert.equal(calls, 0);
  await assert.rejects(fs.access(assetsPath(slug)));
}

function isSafeAudioError(error: unknown) {
  return (
    error instanceof AudioAssetGenerationError &&
    error.message === "Audio asset generation failed." &&
    error.stack === undefined
  );
}

function isSafeDurableError(error: unknown) {
  return (
    error instanceof ProductionPipelineDurableExecutionError &&
    error.message === "Pipeline stage execution failed."
  );
}

function createExecutionState(project: Project): PipelineExecutionState {
  return {
    ...PipelineStageExecutor.createInitialState(project),
    script: scriptData,
  };
}

async function createRunnerFixture(suffix: string) {
  const project = await ProjectManager.createProject(
    `${fixturePrefix}-runner-${suffix}`,
  );
  const jobList: PipelineJobList = {
    projectSlug: project.slug,
    jobs: [
      {
        id: `${project.slug}-audio`,
        projectSlug: project.slug,
        stage: "audio",
        title: "Audio",
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
    JSON.stringify(jobList, null, 2),
    "utf8",
  );
  return { project, state: createExecutionState(project) };
}

async function runFailureThroughRunner(
  durable: boolean,
  options: { saveAudioFailure?: boolean } = {},
) {
  const fixture = await createRunnerFixture(
    durable ? "durable" : options.saveAudioFailure ? "save-failure" : "legacy",
  );
  const originalGenerateAudioData = AudioManager.generateAudioData;
  const originalSaveAudio = ProjectManager.saveAudio;
  const originalConsoleError = console.error;
  const logs: unknown[][] = [];
  const unsafeProvider = options.saveAudioFailure
    ? new MockAudioProvider()
    : createProvider("mock", (input) => ({
        ...validMockResult(input),
        filePath: "C:\\private\\API_KEY=secret\\audio.wav",
      }) as unknown as AudioGenerationResult);
  let durableExecution:
    | Awaited<ReturnType<typeof prepareProductionPipelineExecution>>
    | null = null;

  AudioManager.generateAudioData = async () => audioData;
  if (options.saveAudioFailure) {
    ProjectManager.saveAudio = async () => {
      throw new Error("EACCES C:\\private\\API_KEY=secret\\audio.json stack");
    };
  }
  console.error = (...args: unknown[]) => logs.push(args);

  if (durable) {
    durableExecution = await prepareProductionPipelineExecution({
      projectSlug: fixture.project.slug,
      stage: "audio",
      runType: "initial",
    });
    PipelineRunner.configureDurableExecution(
      new ProductionPipelineExecutionAdapter(
        durableExecution.adapter,
        () => durableExecution!.request,
      ),
    );
  }

  const action = () =>
    PipelineStageExecutor.execute(
      fixture.project.slug,
      "audio",
      fixture.state,
      { audioProvider: unsafeProvider },
    );

  try {
    await assert.rejects(
      durable
        ? runner.runStage(fixture.project.slug, "audio", action, "initial")
        : runner.runStageLegacy(fixture.project.slug, "audio", action, "initial"),
      durable ? isSafeDurableError : isSafeAudioError,
    );
  } finally {
    AudioManager.generateAudioData = originalGenerateAudioData;
    ProjectManager.saveAudio = originalSaveAudio;
    console.error = originalConsoleError;
  }

  let durableAttemptRead = null;

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
          .sort((left, right) =>
            Number(right.match![1]) - Number(left.match![1]))[0]?.key
      : undefined;

    durableAttemptRead = latestKey
      ? await durableExecution.adapter.read("attempt", latestKey)
      : null;
  }

  const jobs = JSON.parse(
    await fs.readFile(
      path.join(projectsRoot, fixture.project.slug, "pipeline-jobs.json"),
      "utf8",
    ),
  ) as PipelineJobList;
  const manifest = JSON.parse(
    await fs.readFile(
      path.join(projectsRoot, fixture.project.slug, "manifest.json"),
      "utf8",
    ),
  ) as ProjectManifest;
  const history = JSON.parse(
    await fs.readFile(
      path.join(projectsRoot, fixture.project.slug, "pipeline-history.json"),
      "utf8",
    ),
  ) as PipelineJobHistory;
  const project = JSON.parse(
    await fs.readFile(
      path.join(projectsRoot, fixture.project.slug, "project.json"),
      "utf8",
    ),
  ) as Project;
  const assets = await readAssets(fixture.project.slug);
  const audioPath = path.join(projectsRoot, fixture.project.slug, "audio.json");

  return {
    jobs,
    manifest,
    history,
    project,
    assets,
    logs,
    durableAttempt:
      durableAttemptRead?.status === "found"
        ? durableAttemptRead.value
        : null,
    durableTerminalEventId:
      durableExecution?.request.terminalEventId ?? null,
    audioPersisted: await fs.access(audioPath).then(() => true, () => false),
  };
}

async function run() {
  const originalFetch = globalThis.fetch;

  try {
    setEnvironment("AUDIO_PROVIDER", undefined);
    await scenario("undefined provider resolves to mock", () => {
      assert.equal(resolveAudioProviderName(undefined), "mock");
    });
    await scenario("blank provider resolves to mock", () => {
      assert.equal(resolveAudioProviderName("   "), "mock");
    });
    await scenario("explicit providers resolve deterministically", () => {
      assert.equal(resolveAudioProviderName("mock"), "mock");
      assert.equal(resolveAudioProviderName(" OPENAI "), "openai");
      assert.ok(AudioProviderRouter.getProvider("mock") instanceof MockAudioProvider);
      assert.ok(AudioProviderRouter.getProvider("openai") instanceof OpenAIAudioProvider);
    });
    await scenario("unknown provider fails closed", () => {
      assert.throws(
        () => resolveAudioProviderName("unknown-provider"),
        (error) =>
          error instanceof AudioProviderConfigurationError &&
          error.message === AUDIO_PROVIDER_CONFIGURATION_ERROR &&
          error.stack === undefined,
      );
    });
    await scenario("OpenAI model is read from server-side configuration", () => {
      setEnvironment("OPENAI_TTS_MODEL", undefined);
      assert.equal(getOpenAIAudioProviderConfig().model, "tts-1");
      setEnvironment("OPENAI_TTS_MODEL", "tts-1-hd");
      assert.equal(getOpenAIAudioProviderConfig().model, "tts-1-hd");
      setEnvironment("OPENAI_TTS_MODEL", "future-tts-model-1");
      assert.equal(getOpenAIAudioProviderConfig().model, "future-tts-model-1");
    });
    await scenario("unsafe model configuration fails closed", () => {
      setEnvironment("OPENAI_TTS_MODEL", "model secret=value");
      assert.throws(
        () => getOpenAIAudioProviderConfig(),
        AudioProviderConfigurationError,
      );
      setEnvironment("OPENAI_TTS_MODEL", "tts-1");
    });
    await scenario("timeout and response byte limits use safe server defaults", () => {
      setEnvironment("OPENAI_TTS_TIMEOUT_MS", undefined);
      setEnvironment("OPENAI_TTS_MAX_RESPONSE_BYTES", undefined);
      const config = getOpenAIAudioProviderConfig();
      assert.equal(config.timeoutMs, 60_000);
      assert.equal(config.maxResponseBytes, 64 * 1024 * 1024);
    });
    await scenario("invalid timeout and response byte limits fail closed", () => {
      for (const value of ["", "0", "9", "300001", "1.5", "secret"]) {
        setEnvironment("OPENAI_TTS_TIMEOUT_MS", value);
        assert.throws(
          () => getOpenAIAudioProviderConfig(),
          AudioProviderConfigurationError,
        );
      }
      setEnvironment("OPENAI_TTS_TIMEOUT_MS", undefined);
      for (const value of ["", "0", "1023", "268435457", "1.5", "secret"]) {
        setEnvironment("OPENAI_TTS_MAX_RESPONSE_BYTES", value);
        assert.throws(
          () => getOpenAIAudioProviderConfig(),
          AudioProviderConfigurationError,
        );
      }
      setEnvironment("OPENAI_TTS_MAX_RESPONSE_BYTES", undefined);
    });
    await scenario("provider resolution has no network side effect", () => {
      let fetchCalls = 0;
      globalThis.fetch = async () => {
        fetchCalls += 1;
        throw new Error("Unexpected network call");
      };
      AudioProviderRouter.getProvider("openai");
      assert.equal(fetchCalls, 0);
      globalThis.fetch = originalFetch;
    });

    await scenario("default mock keeps section and mix asset contract", async () => {
      setEnvironment("AUDIO_PROVIDER", undefined);
      const result = await generate("default-mock");
      assert.equal(result.projectAssets.assets.length, 3);
      assert.deepEqual(
        result.projectAssets.assets.map((asset) => asset.sceneId),
        [1, 2, undefined],
      );
      assert.ok(result.projectAssets.assets.every((asset) => asset.provider === "mock"));
      assert.ok(result.projectAssets.assets.every((asset) => asset.mimeType === "audio/mock"));
      assert.ok(result.projectAssets.assets.every((asset) => asset.status === "generated"));
      assert.equal(result.audio.outputAssetId, result.projectAssets.assets[2].id);
      assert.deepEqual(
        result.audio.sections.map((section) => section.outputAssetId),
        result.projectAssets.assets.slice(0, 2).map((asset) => asset.id),
      );
      assert.equal(result.audio.production.targetFormat, "mp3");
    });

    await scenario("empty section list fails before calls and writes", () =>
      expectWriteFreeFailure("empty", { ...audioData, sections: [] }));
    await scenario("invalid chapter id fails before calls and writes", () =>
      expectWriteFreeFailure("invalid-id", {
        ...audioData,
        sections: [{ ...audioData.sections[0], chapterId: 0 }],
      }));
    await scenario("duplicate chapter id fails before calls and writes", () =>
      expectWriteFreeFailure("duplicate-id", {
        ...audioData,
        sections: [audioData.sections[0], { ...audioData.sections[1], chapterId: 1 }],
      }));
    await scenario("empty narration fails before calls and writes", () =>
      expectWriteFreeFailure("empty-text", {
        ...audioData,
        sections: [{ ...audioData.sections[0], sourceText: "   " }],
      }));
    await scenario("unsafe project slug fails before calls and writes", async () => {
      let calls = 0;
      await assert.rejects(
        AudioPipeline.generateAudio({
          projectId: "project-114",
          projectSlug: "../unsafe-project",
          audio: audioData,
          provider: createProvider("mock", (input) => {
            calls += 1;
            return validMockResult(input);
          }),
        }),
        isSafeAudioError,
      );
      assert.equal(calls, 0);
    });
    await scenario("provider-specific input limit is preflighted for the full batch", () => {
      let validations = 0;
      return expectWriteFreeFailure(
        "provider-preflight",
        audioData,
        createProvider(
          "openai",
          (input) => createStoredOpenAIResult(input),
          () => {
            validations += 1;
            if (validations === 3) {
              throw new Error("mix too long secret");
            }
          },
        ),
      );
    });

    const malformedMockResults: Array<[string, (input: AudioGenerationInput) => unknown]> = [
      ["wrong provider", (input) => ({ ...validMockResult(input), provider: "openai" })],
      ["wrong target", (input) => ({ ...validMockResult(input), target: { kind: "mix" } })],
      ["wrong MIME", (input) => ({ ...validMockResult(input), mimeType: "audio/wav" })],
      ["non-empty path", (input) => ({ ...validMockResult(input), filePath: "secret.wav" })],
      ["non-empty URL", (input) => ({ ...validMockResult(input), url: "https://example.test/audio.wav" })],
      ["positive byte length", (input) => ({ ...validMockResult(input), byteLength: 44 })],
      ["positive duration", (input) => ({ ...validMockResult(input), durationSeconds: 1 })],
      ["invalid timestamp", (input) => ({ ...validMockResult(input), createdAt: "invalid" })],
      ["failure result", (input) => ({ success: false, target: input.target, provider: "mock", createdAt: now, error: "raw secret" })],
    ];

    for (const [name, createResult] of malformedMockResults) {
      await scenario(`malformed mock ${name} fails safely`, async () => {
        const failure = await expectSafeFailure(
          `mock-${name.replace(/\s+/g, "-")}`,
          createProvider("mock", (input) => createResult(input) as AudioGenerationResult),
        );
        assert.equal(failure.assets.assets.length, 1);
        assert.equal(failure.assets.assets[0].status, "failed");
        assert.equal(failure.assets.assets[0].error, "Audio asset generation failed.");
        assert.equal(failure.assets.assets[0].prompt, "Audio generation request.");
        assert.doesNotMatch(JSON.stringify(failure), /secret|example\.test/i);
      });
    }
    await scenario("getter exception fails safely", async () => {
      const raw = "getter API_KEY=secret C:\\private\\audio.wav";
      const failure = await expectSafeFailure(
        "getter",
        createProvider("mock", () => {
          const result = {} as Record<string, unknown>;
          Object.defineProperty(result, "success", {
            get() {
              throw new Error(raw);
            },
          });
          return result as unknown as AudioGenerationResult;
        }),
      );
      assert.doesNotMatch(JSON.stringify(failure), /API_KEY|private/i);
    });

    await scenario("WAV inspection requires RIFF and WAVE", () => {
      const invalid = createWav();
      invalid.write("NOPE", 0, "ascii");
      assert.throws(() => AudioStorage.inspectWav(invalid));
      invalid.write("RIFF", 0, "ascii");
      invalid.write("NOPE", 8, "ascii");
      assert.throws(() => AudioStorage.inspectWav(invalid));
    });
    await scenario("WAV inspection requires fmt chunk", () => {
      const invalid = createWav();
      invalid.write("junk", 12, "ascii");
      assert.throws(() => AudioStorage.inspectWav(invalid));
    });
    await scenario("WAV inspection requires non-empty data chunk", () => {
      const invalid = createWav(2);
      invalid.writeUInt32LE(0, 40);
      assert.throws(() => AudioStorage.inspectWav(invalid));
    });
    await scenario("WAV inspection rejects truncated data", () => {
      const invalid = createWav();
      invalid.writeUInt32LE(invalid.length, 40);
      assert.throws(() => AudioStorage.inspectWav(invalid));
    });
    await scenario("WAV inspection returns finite positive duration", () => {
      const inspection = AudioStorage.inspectWav(createWav());
      assert.ok(inspection.byteLength > 0);
      assert.ok(Number.isFinite(inspection.durationSeconds));
      assert.ok(inspection.durationSeconds > 0);
    });
    await scenario("WAV inspection rejects RIFF size mismatch", () => {
      const invalid = createWav();
      invalid.writeUInt32LE(invalid.length - 9, 4);
      assert.throws(() => AudioStorage.inspectWav(invalid));
    });
    await scenario("WAV inspection rejects missing data chunk", () => {
      const wav = createWav(2);
      const formatChunk = Buffer.from(wav.subarray(12, 36));
      assert.throws(() => AudioStorage.inspectWav(createRiff([formatChunk])));
    });
    await scenario("WAV inspection rejects duplicate fmt chunk", () => {
      const wav = createWav(2);
      const formatChunk = Buffer.from(wav.subarray(12, 36));
      const dataChunk = Buffer.from(wav.subarray(36));
      assert.throws(() =>
        AudioStorage.inspectWav(
          createRiff([formatChunk, formatChunk, dataChunk]),
        ));
    });
    await scenario("WAV inspection rejects duplicate data chunk", () => {
      const wav = createWav(2);
      const formatChunk = Buffer.from(wav.subarray(12, 36));
      const dataChunk = Buffer.from(wav.subarray(36));
      assert.throws(() =>
        AudioStorage.inspectWav(
          createRiff([formatChunk, dataChunk, dataChunk]),
        ));
    });
    await scenario("WAV inspection preserves odd ancillary chunk padding", () => {
      const wav = createWav(2);
      const formatChunk = Buffer.from(wav.subarray(12, 36));
      const dataChunk = Buffer.from(wav.subarray(36));
      const ancillary = createWavChunk("JUNK", Buffer.from([1, 2, 3]));
      const inspection = AudioStorage.inspectWav(
        createRiff([formatChunk, ancillary, dataChunk]),
      );
      assert.ok(inspection.durationSeconds > 0);
    });
    await scenario("duplicate data never reaches storage success", async () => {
      const slug = `${fixturePrefix}-duplicate-data-storage`;
      const wav = createWav(2);
      const formatChunk = Buffer.from(wav.subarray(12, 36));
      const dataChunk = Buffer.from(wav.subarray(36));
      assert.throws(() =>
        AudioStorage.saveAudio({
          projectSlug: slug,
          data: createRiff([formatChunk, dataChunk, dataChunk]),
        }));
      await assert.rejects(
        fs.access(path.join(projectsRoot, slug, "assets", "audio")),
      );
    });

    await scenario("real OpenAI provider stores usable WAV section and mix assets", async () => {
      setEnvironment("AUDIO_PROVIDER", "openai");
      setEnvironment("OPENAI_API_KEY", "test-key-not-real");
      setEnvironment("OPENAI_TTS_MODEL", "configured-tts-model");
      setEnvironment("OPENAI_TTS_VOICE", "alloy");
      const bodies: Array<Record<string, unknown>> = [];
      const requests: Array<{ url: string; init?: RequestInit }> = [];
      const wav = createWav();
      globalThis.fetch = async (url, init) => {
        requests.push({ url: String(url), init });
        bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return new Response(new Uint8Array(wav), {
          status: 200,
          headers: {
            "Content-Type": "audio/wav",
            "Content-Length": String(wav.length),
          },
        });
      };
      const result = await generate("openai-success");
      assert.equal(bodies.length, 3);
      assert.ok(requests.every((request) => request.url === "https://api.openai.com/v1/audio/speech"));
      assert.ok(requests.every((request) => request.init?.method === "POST"));
      assert.ok(requests.every((request) => request.init?.signal instanceof AbortSignal));
      assert.ok(requests.every((request) => new Headers(request.init?.headers).get("Authorization") === "Bearer test-key-not-real"));
      assert.ok(requests.every((request) => new Headers(request.init?.headers).get("Content-Type") === "application/json"));
      assert.ok(bodies.every((body) => body.model === "configured-tts-model"));
      assert.ok(bodies.every((body) => body.voice === "alloy"));
      assert.ok(bodies.every((body) => body.response_format === "wav"));
      assert.deepEqual(
        bodies.map((body) => body.input),
        [
          "First narration section.",
          "Second narration section.",
          "First narration section.\n\nSecond narration section.",
        ],
      );
      assert.equal(result.audio.production.targetFormat, "wav");
      assert.equal(result.projectAssets.assets.length, 3);
      for (const asset of result.projectAssets.assets) {
        assert.equal(asset.provider, "openai");
        assert.equal(asset.model, "configured-tts-model");
        assert.equal(asset.mimeType, "audio/wav");
        assert.ok((asset.byteLength ?? 0) > 0);
        assert.ok((asset.durationSeconds ?? 0) > 0);
        assert.match(asset.filePath ?? "", /^data\/projects\/.+\/assets\/audio\/[a-zA-Z0-9-_.]+\.wav$/);
        const fileName = path.posix.basename(asset.filePath ?? "");
        assert.equal(asset.url, AudioStorage.getAudioUrl(result.slug, fileName));
        const logicalLocator = asset.filePath ?? "";
        const stored = await fs.readFile(path.join(
          projectsRoot, logicalLocator.slice("data/projects/".length),
        ));
        assert.deepEqual(AudioStorage.inspectWav(stored), {
          byteLength: asset.byteLength,
          durationSeconds: asset.durationSeconds,
        });
      }
      const firstFileName = path.posix.basename(result.projectAssets.assets[0].filePath ?? "");
      const response = await getAudioAsset(new Request("http://local.test"), {
        params: Promise.resolve({ slug: result.slug, fileName: firstFileName }),
      });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("content-type"), "audio/wav");
      globalThis.fetch = originalFetch;
    });
    await scenario("OpenAI success accepts valid WAV without content-length header", async () => {
      setEnvironment("OPENAI_API_KEY", "test-key-not-real");
      const wav = createWav();
      globalThis.fetch = async () =>
        new Response(new Uint8Array(wav), {
          status: 200,
          headers: { "Content-Type": "audio/wav" },
        });
      const result = await generate("openai-no-content-length", new OpenAIAudioProvider());
      assert.equal(result.projectAssets.assets.length, 3);
      assert.ok(result.projectAssets.assets.every((asset) => asset.status === "generated"));
      globalThis.fetch = originalFetch;
    });
    await scenario("OpenAI passes AbortSignal and aborts a never-ending stream on timeout", async () => {
      setEnvironment("OPENAI_TTS_TIMEOUT_MS", "10");
      setEnvironment("OPENAI_TTS_MAX_RESPONSE_BYTES", "4096");
      let observedSignal: AbortSignal | null = null;
      let readerCancelled = false;
      globalThis.fetch = async (_url, init) => {
        observedSignal = init?.signal as AbortSignal;
        const reader = {
          read: () => new Promise<ReadableStreamReadResult<Uint8Array>>(() => undefined),
          cancel: async () => {
            readerCancelled = true;
          },
          releaseLock: () => undefined,
        } as unknown as ReadableStreamDefaultReader<Uint8Array>;
        return {
          ok: true,
          headers: new Headers({ "Content-Type": "audio/wav" }),
          body: {
            getReader: () => reader,
          },
        } as unknown as Response;
      };
      const failure = await expectSafeFailure(
        "openai-timeout",
        new OpenAIAudioProvider(),
      );
      assert.equal((observedSignal as AbortSignal | null)?.aborted, true);
      assert.equal(readerCancelled, true);
      assert.doesNotMatch(JSON.stringify(failure), /Abort|stack/i);
      setEnvironment("OPENAI_TTS_TIMEOUT_MS", undefined);
      setEnvironment("OPENAI_TTS_MAX_RESPONSE_BYTES", undefined);
      globalThis.fetch = originalFetch;
    });
    await scenario("oversize Content-Length fails before body reader access", async () => {
      setEnvironment("OPENAI_TTS_MAX_RESPONSE_BYTES", "1024");
      let readerAccessed = false;
      let bodyCancelled = false;
      globalThis.fetch = async () => ({
        ok: true,
        headers: new Headers({
          "Content-Type": "audio/wav",
          "Content-Length": "1025",
        }),
        body: {
          getReader: () => {
            readerAccessed = true;
            throw new Error("reader should not be accessed");
          },
          cancel: async () => {
            bodyCancelled = true;
          },
        },
      }) as unknown as Response;
      await expectSafeFailure(
        "openai-content-length-oversize",
        new OpenAIAudioProvider(),
      );
      assert.equal(readerAccessed, false);
      assert.equal(bodyCancelled, true);
      setEnvironment("OPENAI_TTS_MAX_RESPONSE_BYTES", undefined);
      globalThis.fetch = originalFetch;
    });
    await scenario("chunked response exceeding limit aborts and cancels early", async () => {
      setEnvironment("OPENAI_TTS_MAX_RESPONSE_BYTES", "1024");
      let reads = 0;
      let cancelled = false;
      let observedSignal: AbortSignal | null = null;
      globalThis.fetch = async (_url, init) => {
        observedSignal = init?.signal as AbortSignal;
        const reader = {
          async read() {
            reads += 1;
            return reads <= 2
              ? { done: false, value: new Uint8Array(800) }
              : { done: true, value: undefined };
          },
          async cancel() {
            cancelled = true;
          },
          releaseLock() {},
        } as unknown as ReadableStreamDefaultReader<Uint8Array>;
        return {
          ok: true,
          headers: new Headers({ "Content-Type": "audio/wav" }),
          body: { getReader: () => reader },
        } as unknown as Response;
      };
      await expectSafeFailure(
        "openai-chunked-oversize",
        new OpenAIAudioProvider(),
      );
      assert.equal(reads, 2);
      assert.equal(cancelled, true);
      assert.equal((observedSignal as AbortSignal | null)?.aborted, true);
      setEnvironment("OPENAI_TTS_MAX_RESPONSE_BYTES", undefined);
      globalThis.fetch = originalFetch;
    });
    await scenario("bounded chunked WAV succeeds and successful timers are cleared", async () => {
      setEnvironment("OPENAI_TTS_TIMEOUT_MS", "20");
      setEnvironment("OPENAI_TTS_MAX_RESPONSE_BYTES", "4096");
      const wav = createWav();
      const signals: AbortSignal[] = [];
      globalThis.fetch = async (_url, init) => {
        signals.push(init?.signal as AbortSignal);
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array(wav.subarray(0, 600)));
            controller.enqueue(new Uint8Array(wav.subarray(600)));
            controller.close();
          },
        });
        return new Response(stream, {
          status: 200,
          headers: { "Content-Type": "application/octet-stream" },
        });
      };
      const result = await generate(
        "openai-bounded-chunked",
        new OpenAIAudioProvider(),
      );
      assert.equal(result.projectAssets.assets.length, 3);
      await new Promise((resolve) => setTimeout(resolve, 30));
      assert.ok(signals.every((signal) => !signal.aborted));
      setEnvironment("OPENAI_TTS_TIMEOUT_MS", undefined);
      setEnvironment("OPENAI_TTS_MAX_RESPONSE_BYTES", undefined);
      globalThis.fetch = originalFetch;
    });
    await scenario("stream read error is cancelled and sanitized", async () => {
      let cancelled = false;
      globalThis.fetch = async () => {
        const reader = {
          read: async () => {
            throw new Error("EACCES C:\\private\\API_KEY=secret stack");
          },
          cancel: async () => {
            cancelled = true;
          },
          releaseLock: () => undefined,
        } as unknown as ReadableStreamDefaultReader<Uint8Array>;
        return {
          ok: true,
          headers: new Headers({ "Content-Type": "audio/wav" }),
          body: { getReader: () => reader },
        } as unknown as Response;
      };
      const failure = await expectSafeFailure(
        "openai-stream-error",
        new OpenAIAudioProvider(),
      );
      assert.equal(cancelled, true);
      assert.doesNotMatch(JSON.stringify(failure), /EACCES|private|API_KEY|stack/i);
      globalThis.fetch = originalFetch;
    });
    await scenario("truncated stream length mismatch fails closed", async () => {
      const wav = createWav();
      let cancelled = false;
      globalThis.fetch = async () => {
        let read = false;
        const reader = {
          async read() {
            if (read) {
              return { done: true, value: undefined };
            }
            read = true;
            return {
              done: false,
              value: new Uint8Array(wav.subarray(0, 100)),
            };
          },
          async cancel() {
            cancelled = true;
          },
          releaseLock() {},
        } as unknown as ReadableStreamDefaultReader<Uint8Array>;
        return {
          ok: true,
          headers: new Headers({
            "Content-Type": "audio/wav",
            "Content-Length": String(wav.length),
          }),
          body: { getReader: () => reader },
        } as unknown as Response;
      };
      const failure = await expectSafeFailure(
        "openai-truncated-stream",
        new OpenAIAudioProvider(),
      );
      assert.equal(cancelled, true);
      assert.equal(failure.assets.assets[0].status, "failed");
      globalThis.fetch = originalFetch;
    });

    const invalidRealMutations: Array<[
      string,
      (result: AudioGenerationResult) => unknown,
    ]> = [
      ["wrong provider", (result) => ({ ...result, provider: "mock" }) as AudioGenerationResult],
      ["wrong target", (result) => ({ ...result, target: { kind: "mix" } })],
      ["wrong MIME", (result) => ({ ...result, mimeType: "audio/mpeg" }) as AudioGenerationResult],
      ["absolute path", (result) => ({ ...result, filePath: "C:\\private\\audio.wav" })],
      ["traversal path", (result) => ({ ...result, filePath: "data/projects/../audio.wav" })],
      ["backslash path", (result) => ({ ...result, filePath: String(result.filePath).replaceAll("/", "\\") })],
      ["external URL", (result) => ({ ...result, url: "https://example.test/audio.wav" })],
      ["wrong local URL slug", (result) => ({ ...result, url: String(result.url).replace(fixturePrefix, "wrong-slug") })],
      ["wrong URL filename", (result) => ({ ...result, url: String(result.url).replace(/[^/]+\.wav$/, "other.wav") })],
      ["zero byte length", (result) => ({ ...result, byteLength: 0 })],
      ["zero duration", (result) => ({ ...result, durationSeconds: 0 })],
      ["infinite duration", (result) => ({ ...result, durationSeconds: Number.POSITIVE_INFINITY })],
    ];

    for (const [name, mutate] of invalidRealMutations) {
      await scenario(`invalid real result ${name} fails safely`, async () => {
        const failure = await expectSafeFailure(
          `real-${name.replace(/\s+/g, "-")}`,
          createProvider("openai", (input) => createStoredOpenAIResult(input, mutate)),
        );
        assert.equal(failure.assets.assets[0].status, "failed");
        assert.doesNotMatch(JSON.stringify(failure), /private|example\.test|wrong-slug/i);
      });
    }

    await scenario("stored WAV metadata mismatch fails safely", async () => {
      const failure = await expectSafeFailure(
        "metadata-mismatch",
        createProvider("openai", (input) =>
          createStoredOpenAIResult(input, (result) => ({
            ...result,
            durationSeconds: Number(result.durationSeconds) + 1,
          }))),
      );
      assert.equal(failure.assets.assets[0].status, "failed");
    });
    await scenario("partial real generation remains append-only but batch fails", async () => {
      let calls = 0;
      const failure = await expectSafeFailure(
        "partial",
        createProvider("openai", (input) => {
          calls += 1;
          if (calls === 1) {
            return createStoredOpenAIResult(input);
          }
          return {
            success: false,
            target: input.target,
            provider: "openai",
            model: "fake-tts-model",
            createdAt: now,
            error: "raw provider secret",
          };
        }),
      );
      assert.deepEqual(
        failure.assets.assets.map((asset) => asset.status),
        ["generated", "failed"],
      );
      assert.doesNotMatch(JSON.stringify(failure), /raw provider secret/i);
    });

    await scenario("missing OpenAI key fails before calls and writes", async () => {
      setEnvironment("OPENAI_API_KEY", undefined);
      let fetchCalls = 0;
      globalThis.fetch = async () => {
        fetchCalls += 1;
        throw new Error("Unexpected fetch");
      };
      await expectWriteFreeFailure(
        "missing-key",
        audioData,
        new OpenAIAudioProvider(),
      );
      assert.equal(fetchCalls, 0);
      globalThis.fetch = originalFetch;
    });
    await scenario("blank OpenAI key fails before fetch", async () => {
      setEnvironment("OPENAI_API_KEY", "   ");
      let fetchCalls = 0;
      globalThis.fetch = async () => {
        fetchCalls += 1;
        throw new Error("Unexpected fetch");
      };
      await expectWriteFreeFailure(
        "blank-key",
        audioData,
        new OpenAIAudioProvider(),
      );
      assert.equal(fetchCalls, 0);
      setEnvironment("OPENAI_API_KEY", "test-key-not-real");
      globalThis.fetch = originalFetch;
    });
    await scenario("OpenAI HTTP and malformed WAV failures expose no raw response", async () => {
      setEnvironment("OPENAI_API_KEY", "test-key-not-real");
      globalThis.fetch = async () =>
        new Response("API_KEY=secret C:\\private\\stack", {
          status: 500,
          headers: { "Content-Type": "text/plain" },
        });
      const failure = await expectSafeFailure(
        "openai-http",
        new OpenAIAudioProvider(),
      );
      assert.doesNotMatch(JSON.stringify(failure), /API_KEY|private|stack/i);
      globalThis.fetch = originalFetch;
    });
    await scenario("OpenAI 200 response with malformed WAV fails safely", async () => {
      globalThis.fetch = async () =>
        new Response(new Uint8Array(Buffer.from("not a wav API_KEY=secret")), {
          status: 200,
          headers: { "Content-Type": "audio/wav" },
        });
      const failure = await expectSafeFailure(
        "openai-malformed-wav",
        new OpenAIAudioProvider(),
      );
      assert.doesNotMatch(JSON.stringify(failure), /API_KEY|not a wav/i);
      globalThis.fetch = originalFetch;
    });
    await scenario("OpenAI thrown fetch error and unsupported MIME fail safely", async () => {
      globalThis.fetch = async () => {
        throw new Error("API_KEY=secret C:\\private\\stack");
      };
      const thrownFailure = await expectSafeFailure(
        "openai-fetch-throw",
        new OpenAIAudioProvider(),
      );
      assert.doesNotMatch(JSON.stringify(thrownFailure), /API_KEY|private|stack/i);

      globalThis.fetch = async () =>
        new Response(new Uint8Array(createWav()), {
          status: 200,
          headers: { "Content-Type": "audio/mpeg" },
        });
      const mimeFailure = await expectSafeFailure(
        "openai-unsupported-mime",
        new OpenAIAudioProvider(),
      );
      assert.equal(mimeFailure.assets.assets[0].status, "failed");
      globalThis.fetch = originalFetch;
    });
    await scenario("AudioStorage write error is normalized before runner boundaries", async () => {
      const originalSaveAudio = AudioStorage.saveAudio;
      const wav = createWav();
      setEnvironment("OPENAI_API_KEY", "test-key-not-real");
      globalThis.fetch = async () =>
        new Response(new Uint8Array(wav), {
          status: 200,
          headers: { "Content-Type": "audio/wav" },
        });
      AudioStorage.saveAudio = () => {
        throw new Error("EACCES C:\\private\\API_KEY=secret\\audio.wav stack");
      };
      try {
        const failure = await expectSafeFailure(
          "storage-write-error",
          new OpenAIAudioProvider(),
        );
        assert.equal(failure.assets.assets[0].prompt, "Audio generation request.");
        assert.doesNotMatch(
          JSON.stringify(failure),
          /EACCES|private|API_KEY|stack|First narration/i,
        );
      } finally {
        AudioStorage.saveAudio = originalSaveAudio;
        globalThis.fetch = originalFetch;
      }
    });
    await scenario("storage readback error is normalized", async () => {
      const originalInspectStoredWav = AudioStorage.inspectStoredWav;
      AudioStorage.inspectStoredWav = () => {
        throw new Error("ENOSPC C:\\private\\API_KEY=secret stack");
      };
      try {
        const failure = await expectSafeFailure(
          "storage-readback-error",
          createProvider("openai", (input) => createStoredOpenAIResult(input)),
        );
        assert.doesNotMatch(
          JSON.stringify(failure),
          /ENOSPC|private|API_KEY|stack/i,
        );
      } finally {
        AudioStorage.inspectStoredWav = originalInspectStoredWav;
      }
    });
    await scenario("registry read and generated-asset append errors are normalized", async () => {
      const originalGetProjectAssets = AssetManager.getProjectAssets;
      AssetManager.getProjectAssets = () => {
        throw new Error("EACCES C:\\private\\registry.json API_KEY=secret stack");
      };
      try {
        await assert.rejects(
          AudioPipeline.generateAudio({
            projectId: "project-114",
            projectSlug: `${fixturePrefix}-registry-read-error`,
            audio: audioData,
            provider: new MockAudioProvider(),
          }),
          isSafeAudioError,
        );
      } finally {
        AssetManager.getProjectAssets = originalGetProjectAssets;
      }

      const originalAddAsset = AssetManager.addAssetAtomically;
      AssetManager.addAssetAtomically = () => {
        throw new Error("ENOSPC C:\\private\\registry.json API_KEY=secret stack");
      };
      try {
        await assert.rejects(
          AudioPipeline.generateAudio({
            projectId: "project-114",
            projectSlug: `${fixturePrefix}-registry-append-error`,
            audio: audioData,
            provider: new MockAudioProvider(),
          }),
          isSafeAudioError,
        );
      } finally {
        AssetManager.addAssetAtomically = originalAddAsset;
      }
    });
    await scenario("secondary failed-asset append error preserves safe primary failure", async () => {
      const originalAddAsset = AssetManager.addAsset;
      AssetManager.addAsset = () => {
        throw new Error("EPERM C:\\private\\registry.json API_KEY=secret stack");
      };
      try {
        await assert.rejects(
          AudioPipeline.generateAudio({
            projectId: "project-114",
            projectSlug: `${fixturePrefix}-failed-append-error`,
            audio: audioData,
            provider: createProvider("mock", (input) => ({
              ...validMockResult(input),
              filePath: "C:\\private\\raw-locator.wav",
            }) as unknown as AudioGenerationResult),
          }),
          isSafeAudioError,
        );
      } finally {
        AssetManager.addAsset = originalAddAsset;
      }
    });

    const legacyFailure = await runFailureThroughRunner(false);
    await scenario("real runner persists safe failed audio state", () => {
      assert.equal(legacyFailure.jobs.jobs[0].status, "failed");
      assert.equal(legacyFailure.manifest.packages.audio.status, "failed");
      assert.equal(legacyFailure.history.events[0].status, "failed");
      assert.equal(legacyFailure.history.events[0].stage, "audio");
      assert.equal(legacyFailure.audioPersisted, false);
      assert.notEqual(legacyFailure.project.status, "completed");
    });
    await scenario("audio failure blocks assembly enqueue and completed persistence", () => {
      assert.equal(
        legacyFailure.jobs.jobs.some((job) => job.stage === "assembly"),
        false,
      );
      assert.notEqual(legacyFailure.manifest.packages.audio.status, "completed");
    });
    await scenario("runner persistence and logs contain no raw locator or secret", () => {
      assert.doesNotMatch(
        JSON.stringify(legacyFailure),
        /private|API_KEY|secret|stack/i,
      );
    });

    const saveAudioFailure = await runFailureThroughRunner(false, {
      saveAudioFailure: true,
    });
    await scenario("saveAudio filesystem failure is normalized and blocks completion", () => {
      assert.equal(saveAudioFailure.jobs.jobs[0].status, "failed");
      assert.equal(saveAudioFailure.manifest.packages.audio.status, "failed");
      assert.equal(saveAudioFailure.history.events[0].status, "failed");
      assert.equal(saveAudioFailure.audioPersisted, false);
      assert.equal(
        saveAudioFailure.jobs.jobs.some((job) => job.stage === "assembly"),
        false,
      );
      assert.doesNotMatch(
        JSON.stringify(saveAudioFailure),
        /EACCES|private|API_KEY|secret|stack/i,
      );
    });

    await scenario("wiring creates no runtime graph or lifecycle", async () => {
      const source = await fs.readFile(
        path.join(process.cwd(), "src", "lib", "pipeline", "PipelineStageExecutor.ts"),
        "utf8",
      );
      assert.doesNotMatch(
        source,
        /ProductionRuntimeCompositionRoot|ProductionWorkerLifecycle|ProductionRuntimeInitializer/,
      );
    });

    console.log(
      `Sprint 114 production audio asset wiring smoke: PASS (${scenarioCount} scenarios)`,
    );
  } finally {
    globalThis.fetch = originalFetch;
    setEnvironment("AUDIO_PROVIDER", originalEnvironment.audioProvider);
    setEnvironment("OPENAI_API_KEY", originalEnvironment.openAIKey);
    setEnvironment("OPENAI_TTS_MODEL", originalEnvironment.ttsModel);
    setEnvironment("OPENAI_TTS_VOICE", originalEnvironment.ttsVoice);
    setEnvironment("OPENAI_TTS_TIMEOUT_MS", originalEnvironment.ttsTimeout);
    setEnvironment(
      "OPENAI_TTS_MAX_RESPONSE_BYTES",
      originalEnvironment.ttsMaxResponseBytes,
    );
    const entries = await fs.readdir(projectsRoot, { withFileTypes: true });
    await Promise.all(
      entries
        .filter((entry) => entry.isDirectory() && entry.name.startsWith(fixturePrefix))
        .map((entry) =>
          fs.rm(path.join(projectsRoot, entry.name), {
            recursive: true,
            force: true,
          }),
        ),
    );
  }
}

async function main() {
  process.env.ATOLYE_RUNTIME_ROOT = temporaryRuntimeRoot;
  try {
    const storageContext = createRuntimeStorageContext({
      environment: { ...process.env, ATOLYE_RUNTIME_ROOT: temporaryRuntimeRoot },
      workspaceRoot: process.cwd(), authorityRoot: path.join(temporaryWorkspace, "authority"),
    });
    const operationContext = createProductionRuntimeOperationContext({
      operationId: `sprint-114-audio-${process.pid}`,
      operationType: "audio-wiring-test",
      authorityGeneration: initialRuntimeAuthorityGeneration,
      storageContext,
    });
    await runWithProductionRuntimeOperationContext(operationContext, run);
  } finally {
    if (previousRuntimeRoot === undefined) delete process.env.ATOLYE_RUNTIME_ROOT;
    else process.env.ATOLYE_RUNTIME_ROOT = previousRuntimeRoot;
    rmSync(temporaryWorkspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
}

void main();
