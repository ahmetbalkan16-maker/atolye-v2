import assert from "node:assert/strict";
import { withCanonicalSmokeRuntime, type CanonicalSmokeRuntime } from "./lib/CanonicalSmokeRuntime";
import { emitSmokeResult } from "./lib/SmokeResult";
import fs from "node:fs";
import path from "node:path";
import { GenerationFallbackBlockedError, strictGenerationExecutionPolicy } from "../src/lib/ai/GenerationExecutionPolicy";
import { AIResponseError } from "../src/lib/ai/AIResponseError";
import { AIManager } from "../src/lib/ai/AIManager";
import { AIUsageManager } from "../src/lib/ai/AIUsageManager";
import { PipelineRunner } from "../src/lib/pipeline/PipelineRunner";
import { PipelineStageExecutor } from "../src/lib/pipeline/PipelineStageExecutor";
import { PipelineJobManager } from "../src/lib/pipeline/PipelineJobManager";
import { ProjectManager } from "../src/lib/projects/ProjectManager";
import {
  ProductionAcceptanceBlockedError,
  ProductionAcceptanceOrchestrator,
} from "../src/lib/production/ProductionAcceptanceOrchestrator";
import { ProductionReadinessService, validateProductionReadinessChecks } from "../src/lib/production/ProductionReadinessService";
import { ThumbnailEngine } from "../src/lib/thumbnail/ThumbnailEngine";
import type { ThumbnailProvider } from "../src/lib/thumbnail/providers/ThumbnailProvider";
import { YouTubePackagePipeline } from "../src/lib/youtube/YouTubePackagePipeline";
import { YouTubePublishPipeline } from "../src/lib/youtube/publish/YouTubePublishPipeline";
import type { AssemblyPlanData } from "../src/types/assembly";
import type { SEOData } from "../src/types/seo";
import type { ThumbnailData } from "../src/types/thumbnail";
import type { YouTubePublishingPackage } from "../src/types/youtube";
import {
  createProductionAcceptanceProjectSlug,
} from "../src/lib/production/ProductionAcceptanceTopic";
import {
  createProductionAcceptanceMarker,
  productionAcceptanceConfigurationFingerprint,
} from "../src/lib/production/ProductionAcceptancePolicy";
import type { Project } from "../src/types/project";
import type { VideoData } from "../src/types/video";
import type { AudioData } from "../src/types/audio";
import { ProductionAcceptancePolicyError } from "../src/lib/production/ProductionAcceptancePolicy";
import { SpawnRunner } from "../src/lib/assembly/providers/FFmpegVideoAssemblyProvider";
import { VisualManager } from "../src/lib/visuals/VisualManager";
import { AnimationPromptGenerator } from "../src/lib/animation/prompts/AnimationPromptGenerator";
import { AudioManager } from "../src/lib/audio/AudioManager";
import { AudioAssetRootError } from "../src/lib/audio/AudioAssetError";
import { AudioStorage } from "../src/lib/assets/storage/AudioStorage";
import { AssemblyManager } from "../src/lib/assembly/AssemblyManager";
import { SEOManager } from "../src/lib/seo/SEOManager";
import { createProviderDispatchAdapter } from "../src/lib/providers/ProviderDispatchAdapterAuthority";
import type { ScriptData } from "../src/types/script";
import type { SceneData } from "../src/types/scene";
import type { VisualData } from "../src/types/visual";
import {
  createProductionRuntimeOperationContext,
  runWithProductionRuntimeOperationContext,
} from "../src/lib/runtime/ProductionRuntimeOperationContext";

let projectsRoot = "";
let canonicalRuntime: CanonicalSmokeRuntime;
const probePrefix = "sprint-126-readiness-";
const trace = (step: string) => { if (process.env.SMOKE_TRACE === "1") console.error(`TRACE ${step}`); };

async function run() {
  const beforeProbes = probeDirectories();
  let completedProbeRoot = "";
  const readiness = await readinessService({
    beforeProbeCleanup(root) {
      completedProbeRoot = root;
      assertCompletedAudioProbe(root);
    },
  }).evaluate();
  assert.equal(readiness.ready, false);
  assert.equal(find(readiness, "animation-provider").status, "NOT_CONFIGURED");
  assert.equal(find(readiness, "animation-provider").reasonCode, "ANIMATION_PROVIDER_MISSING");
  assert.equal(find(readiness, "api-key").status, "NOT_CONFIGURED");
  assert.equal(find(readiness, "ffmpeg").status, "NOT_CONFIGURED");
  assert.equal(find(readiness, "ffprobe").status, "NOT_CONFIGURED");
  assert.equal(find(readiness, "filesystem-permission").status, "READY");
  assert.equal(find(readiness, "filesystem-permission").reasonCode, "FILESYSTEM_READ_WRITE_READY");
  assert.equal(find(readiness, "audio-storage").status, "READY");
  assert.equal(find(readiness, "audio-storage").reasonCode, "AUDIO_STORAGE_READY");
  assert.equal(find(readiness, "storage-containment").status, "READY");
  assert(completedProbeRoot);
  assert.equal(fs.existsSync(completedProbeRoot), false);
  assert.deepEqual(probeDirectories(), beforeProbes, "Readiness probe workspace was not cleaned.");
  assert(readiness.checks.every((item) => /^[A-Z0-9_]+$/.test(item.reasonCode)));

  trace("mock-animation"); await verifyMockAnimationIsBlocked();
  verifyReadinessCheckSetValidation(readiness);
  trace("strict-ai"); await verifyStrictAIProviderFailure();
  trace("strict-thumbnail"); await verifyStrictThumbnailFailure();
  trace("package-only"); await verifyPackageOnlyPublish();
  trace("probe-cleanup"); await verifyProbeCleanupFailsClosed();
  trace("spawn-timeout"); await verifySpawnRunnerTimeoutCleanup();
  trace("runtime-reevaluation"); await verifyRuntimeReevaluation();
  trace("audio-operation-scope"); await verifyAudioOperationScope();
  trace("acceptance-gate"); await verifyAcceptanceGateStopsPipeline();

  console.log("Sprint 126 production readiness acceptance smoke passed.");
  for (const item of readiness.checks) {
    console.log(`${item.id}: ${item.status} (${item.reasonCode})`);
  }
}

async function main() {
  await withCanonicalSmokeRuntime({ name: "production-readiness-acceptance",
    configureProductionExecution: false,
    enterOperationContext: false,
    environment: { AI_PROVIDER: undefined, IMAGE_PROVIDER: undefined, AUDIO_PROVIDER: undefined,
      ANIMATION_PROVIDER: undefined, VIDEO_PROVIDER: undefined, VIDEO_ASSEMBLY_PROVIDER: undefined,
      THUMBNAIL_PROVIDER: undefined, YOUTUBE_PROVIDER: undefined, YOUTUBE_PUBLISH_PROVIDER: undefined,
      OPENAI_API_KEY: undefined, FFMPEG_PATH: undefined, FFPROBE_PATH: undefined } }, async (runtime) => {
    projectsRoot = runtime.runtimeStorageContext.projectsRoot;
    canonicalRuntime = runtime;
    await run();
  });
  emitSmokeResult("production-readiness-acceptance", 24);
}

async function verifyAudioOperationScope() {
  const directSlug = `readiness-direct-audio-${crypto.randomUUID()}`;
  assert.throws(
    () => AudioStorage.saveAudio({
      projectSlug: directSlug,
      assetId: "scope-required",
      data: readinessWavFixture(),
    }, canonicalRuntime.runtimeStorageContext),
    (error) => error instanceof AudioAssetRootError &&
      error.evidence.rootCode === "AUDIO_STORAGE_WRITE_FAILED",
  );

  const beforeProbes = probeDirectories();
  const mismatched = createProductionRuntimeOperationContext({
    operationId: `readiness-mismatch-${crypto.randomUUID()}`,
    operationType: "readiness-mismatch-test",
    authorityGeneration: "runtime-authority-generation-mismatch",
    storageContext: canonicalRuntime.runtimeStorageContext,
  });
  const report = await runWithProductionRuntimeOperationContext(
    mismatched,
    () => readinessService().evaluate(),
  );
  assert.equal(find(report, "audio-storage").status, "UNAVAILABLE");
  assert.equal(find(report, "audio-storage").reasonCode, "AUDIO_STORAGE_ADAPTER_UNAVAILABLE");
  assert.equal(find(report, "images-storage").status, "READY");
  assert.equal(find(report, "video-storage").status, "READY");
  assert.equal(find(report, "thumbnail-storage").status, "READY");
  assert.equal(find(report, "assembly-storage").status, "READY");
  assert.deepEqual(probeDirectories(), beforeProbes);
}

function assertCompletedAudioProbe(root: string) {
  assert.equal(fs.existsSync(path.join(root, "assets", "audio", "readiness-audio.wav")), true);
  const cleanupRoot = path.join(root, "production-execution", "audio-compensation-cleanup");
  const records = fs.readdirSync(cleanupRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("audio-comp-"));
  assert.equal(records.length, 1);
  const recordRoot = path.join(cleanupRoot, records[0].name, "record");
  const stateFiles = fs.readdirSync(recordRoot)
    .filter((entry) => /^state-[0-9]{6}\.json$/.test(entry))
    .sort();
  assert(stateFiles.length > 0);
  const terminal = JSON.parse(
    fs.readFileSync(path.join(recordRoot, stateFiles.at(-1)!), "utf8"),
  ) as { status?: unknown; outcome?: unknown };
  assert.equal(terminal.status, "completed");
  assert.equal(terminal.outcome, "compensated");
}

function readinessWavFixture() {
  const samples = 80;
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write("WAVEfmt ", 8, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(8_000, 24);
  buffer.writeUInt32LE(16_000, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(samples * 2, 40);
  return buffer;
}

async function verifyStrictAIProviderFailure() {
  const originalAppend = AIUsageManager.appendRecord;
  const originalConsoleError = console.error;
  const logged: unknown[] = [];
  try {
    AIUsageManager.appendRecord = async (record) => ({
      projectSlug: record.projectSlug,
      records: [record],
      createdAt: record.createdAt,
      updatedAt: record.createdAt,
    });
    console.error = (...values) => { logged.push(...values); };
    await assert.rejects(
      () => AIManager.runResearch(
        "Acceptance",
        { projectSlug: "acceptance", operation: "strict-smoke", stage: "research" },
        { async generate() { throw new Error("sensitive provider detail"); } },
        strictGenerationExecutionPolicy,
      ),
      (error) => error instanceof AIResponseError && error.code === "AI_PROVIDER_REQUEST_FAILED",
    );
    const fixtures = strictPlanFixtures();
    const invalidProvider = { async generate() { return "{}"; } };
    await assert.rejects(
      () => AIManager.runScript("Acceptance", { projectSlug: "acceptance", operation: "script", stage: "script" }, invalidProvider, strictGenerationExecutionPolicy),
      (error) => error instanceof AIResponseError && error.code === "AI_RESPONSE_SCHEMA_INVALID",
    );
    await assert.rejects(
      () => AIManager.runScenes(fixtures.script, { projectSlug: "acceptance", operation: "scenes", stage: "scenes" }, invalidProvider, strictGenerationExecutionPolicy),
      (error) => error instanceof AIResponseError && error.code === "AI_RESPONSE_SCHEMA_INVALID",
    );
    await assert.rejects(
      () => VisualManager.generateVisualData({ projectSlug: "acceptance", scenes: fixtures.scenes, aiProvider: invalidProvider, generationPolicy: strictGenerationExecutionPolicy }),
      (error) => error instanceof AIResponseError && error.code === "AI_RESPONSE_SCHEMA_INVALID",
    );
    const strictCalls = [
      () => AnimationPromptGenerator.generateAnimationData({ projectId: "acceptance", projectSlug: "acceptance", scenes: fixtures.scenes, visuals: fixtures.visuals, aiProvider: { async generate() { return JSON.stringify({ sceneId: 2, animationPrompt: "invalid scene" }); } }, generationPolicy: strictGenerationExecutionPolicy }),
      () => AudioManager.generateAudioData(fixtures.script, { projectSlug: "acceptance", operation: "audio", stage: "audio" }, { aiProvider: invalidProvider, generationPolicy: strictGenerationExecutionPolicy }),
      () => AssemblyManager.generateAssemblyPlan(fixtures.script, fixtures.scenes, fixtures.visuals, fixtures.audio, {}, { projectSlug: "acceptance", operation: "assembly", stage: "assembly" }, { aiProvider: invalidProvider, generationPolicy: strictGenerationExecutionPolicy }),
      () => SEOManager.generateSEOData("Acceptance", fixtures.script, fixtures.thumbnail, { projectSlug: "acceptance", operation: "seo", stage: "seo" }, { aiProvider: invalidProvider, generationPolicy: strictGenerationExecutionPolicy }),
    ];
    for (const call of strictCalls) {
      await assert.rejects(call, (error) => error instanceof GenerationFallbackBlockedError);
    }
    await assert.rejects(
      () => AIManager.runResearch(
        "Acceptance",
        { projectSlug: "acceptance", operation: "strict-shape-smoke", stage: "research" },
        { async generate() { return "{}"; } },
        strictGenerationExecutionPolicy,
      ),
      (error) => error instanceof AIResponseError && error.code === "AI_RESPONSE_SCHEMA_INVALID",
    );
    assert(!JSON.stringify(logged).includes("sensitive provider detail"));
    const normalFallback = await AIManager.runResearch(
      "Acceptance",
      { projectSlug: "acceptance", operation: "normal-after-strict", stage: "research" },
      { async generate() { throw new Error("normal provider failure"); } },
    );
    assert.equal(normalFallback.summary, "mock");
  } finally {
    AIUsageManager.appendRecord = originalAppend;
    console.error = originalConsoleError;
  }
}

function strictPlanFixtures() {
  const now = new Date().toISOString();
  const script = {
    topic: "Acceptance", title: "Acceptance", subtitle: "Acceptance", hook: "Acceptance",
    introduction: "Acceptance", chapters: [{ id: 1, title: "Scene", narration: "Narration",
      duration: 90, visualGoal: "Visual", emotion: "Calm", transition: "fade" }],
    conclusion: "Conclusion", callToAction: "Subscribe", estimatedDuration: 90,
    narrationWordCount: 1, targetAudience: "General", language: "tr",
    voiceStyle: "documentary", musicStyle: "cinematic", thumbnailIdea: "Acceptance",
    seoKeywords: ["acceptance"], createdAt: now,
  } as ScriptData;
  const scenes = { scenes: [{ id: 1, title: "Scene", description: "Scene", visualPrompt: "Visual", duration: 90 }], createdAt: now } as SceneData;
  const visuals = { projectId: "acceptance", scenes: [{ sceneId: 1, visualPrompt: "Visual", animationPrompt: "Motion", style: "cinematic" }], thumbnail: { title: "Acceptance", prompt: "Prompt", composition: "Composition", mood: "Mood" }, createdAt: now } as VisualData;
  const audio = { narrator: { style: "documentary", tone: "calm", language: "tr" }, sections: [{ chapterId: 1, title: "Scene", duration: "01:30", emotion: "calm", emphasis: [], narrationNotes: "Notes", pacing: "medium", sourceText: "Narration" }], music: { mood: "calm", suggestion: "music", intensity: "low" }, production: { targetFormat: "mp3", sampleRate: 44_100, estimatedTotalDuration: "01:30", generationStatus: "planned" }, createdAt: now } as AudioData;
  const thumbnail = { variants: [], titleIdea: "Acceptance", concept: "Acceptance", mainSubject: "Acceptance", composition: "Acceptance", colorStyle: "Acceptance", textSuggestion: "Acceptance", imagePrompt: "Acceptance", clickReason: "Acceptance", createdAt: now } as ThumbnailData;
  return { script, scenes, visuals, audio, thumbnail };
}

async function verifyMockAnimationIsBlocked() {
  const report = await new ProductionReadinessService({
    environment: { ...process.env, ANIMATION_PROVIDER: "mock" },
  }).evaluate();
  const animation = find(report, "animation-provider");
  assert.equal(animation.status, "BLOCKED");
  assert.equal(animation.reasonCode, "ANIMATION_PROVIDER_MOCK_ONLY");
  const unknownReport = await new ProductionReadinessService({
    environment: { ...process.env, ANIMATION_PROVIDER: "unknown" },
  }).evaluate();
  const unknown = find(unknownReport, "animation-provider");
  assert.equal(unknown.status, "INVALID");
  assert.equal(unknown.reasonCode, "ANIMATION_PROVIDER_INVALID");
}

function verifyReadinessCheckSetValidation(
  readiness: Awaited<ReturnType<ProductionReadinessService["evaluate"]>>,
) {
  assert.equal(validateProductionReadinessChecks(readiness.checks), true);
  assert.equal(validateProductionReadinessChecks([...readiness.checks, readiness.checks[0]]), false);
  const invalidStatus = readiness.checks.map((item, index) =>
    index === 0 ? { ...item, status: "UNKNOWN" } : item);
  assert.equal(validateProductionReadinessChecks(invalidStatus), false);
  const unexpectedCheck = readiness.checks.map((item, index) =>
    index === 0 ? { ...item, id: "unexpected-check" } : item);
  assert.equal(validateProductionReadinessChecks(unexpectedCheck), false);
}

async function verifyStrictThumbnailFailure() {
  const provider: ThumbnailProvider = {
    name: "openai",
    async generateThumbnailPlan() { throw new Error("sensitive provider detail"); },
    async generateThumbnailAsset() { throw new Error("not called"); },
  };
  await assert.rejects(
    () => new ThumbnailEngine().generateThumbnailPlan({
      projectId: "acceptance-project",
      projectSlug: "acceptance-project",
      title: "Acceptance",
      provider,
      generationPolicy: strictGenerationExecutionPolicy,
    }),
    (error) => error instanceof GenerationFallbackBlockedError,
  );
  const invalidProvider: ThumbnailProvider = {
    name: "openai",
    async generateThumbnailPlan() {
      return { provider: "openai", status: "planned", thumbnail: {} as ThumbnailData };
    },
    async generateThumbnailAsset() { throw new Error("not called"); },
  };
  await assert.rejects(
    () => new ThumbnailEngine().generateThumbnailPlan({
      projectId: "acceptance-project",
      projectSlug: "acceptance-project",
      title: "Acceptance",
      provider: invalidProvider,
      generationPolicy: strictGenerationExecutionPolicy,
    }),
    (error) => error instanceof GenerationFallbackBlockedError,
  );
  const originalConsoleError = console.error;
  console.error = () => {};
  const fallback = await new ThumbnailEngine().generateThumbnailPlan({
    projectId: "acceptance-project",
    projectSlug: "acceptance-project",
    title: "Acceptance",
    provider,
  }).finally(() => { console.error = originalConsoleError; });
  assert.equal(fallback.provider, "mock");
  assert(!(new GenerationFallbackBlockedError()).stack);
}

async function verifyPackageOnlyPublish() {
  const originals = {
    generatePackage: YouTubePackagePipeline.generatePackage,
    saveYouTube: ProjectManager.saveYouTube,
    publish: YouTubePublishPipeline.publishStoredPackage,
    markPublished: ProjectManager.markYouTubePublished,
    persist: PipelineJobManager.persistStageSuccess,
  };
  let saveCalls = 0;
  let generateCalls = 0;
  let publishCalls = 0;
  let markCalls = 0;
  const runId = crypto.randomUUID();
  const acceptanceTopic = "Sprint 126 package only acceptance";
  const acceptanceRunTopic = `${acceptanceTopic} ${runId}`;
  const acceptanceSlug = createProductionAcceptanceProjectSlug(acceptanceTopic, runId);
  await createProductionAcceptanceMarker(
    acceptanceSlug,
    runId,
    productionAcceptanceConfigurationFingerprint(),
    acceptanceTopic,
  );
  const acceptanceProject = await ProjectManager.createProject(acceptanceRunTopic);
  const preparedMarker = JSON.parse(fs.readFileSync(
    path.join(projectsRoot, acceptanceProject.slug, "production-acceptance.json"),
    "utf8",
  )) as { acceptanceStatus?: unknown; productionReady?: unknown; published?: unknown };
  assert.deepEqual(
    { status: preparedMarker.acceptanceStatus, ready: preparedMarker.productionReady, published: preparedMarker.published },
    { status: "prepared", ready: false, published: false },
  );
  const publishingPackage = {
    schemaVersion: "1",
    projectId: acceptanceProject.id,
    slug: acceptanceProject.slug,
    provider: "openai",
    model: "safe-model",
    status: "generated",
    title: "Acceptance",
    description: "Acceptance package",
    tags: ["acceptance"],
    hashtags: ["#acceptance"],
    chapters: [{ startSeconds: 0, title: "Acceptance" }],
    pinnedComment: "Acceptance",
    thumbnailText: "Acceptance",
    videoAssetId: "video-id",
    thumbnailAssetId: "thumbnail-id",
    generatedAt: new Date().toISOString(),
  } as YouTubePublishingPackage;
  try {
    YouTubePackagePipeline.generatePackage = async () => { generateCalls += 1; return publishingPackage; };
    ProjectManager.saveYouTube = async (slug, youtube, options) => {
      saveCalls += 1;
      if (slug === acceptanceProject.slug) {
        await originals.saveYouTube.call(ProjectManager, slug, youtube, options);
      }
    };
    YouTubePublishPipeline.publishStoredPackage = async () => { publishCalls += 1; return {} as never; };
    ProjectManager.markYouTubePublished = async () => { markCalls += 1; };
    PipelineJobManager.persistStageSuccess = async (_slug, _stage, persist) => { await persist(); return true; };

    const state = stageState(acceptanceProject);
    const packageOnly = await PipelineStageExecutor.execute(
      state.project.slug,
      "youtube",
      state,
    );
    assert.equal(packageOnly, true);
    assert.equal(saveCalls, 1);
    assert.equal(publishCalls, 0);
    assert.equal(markCalls, 0);
    await verifyPersistedStrictPolicy(acceptanceProject);
    assert.equal((await ProjectManager.getProject(acceptanceProject.slug))?.status, "draft");
    assert.equal((await ProjectManager.getYouTube(acceptanceProject.slug) as { status?: unknown } | null)?.status, "generated");
    assert.equal((await ProjectManager.getYouTubePublishState(acceptanceProject.slug)).status, "missing");
    assert.equal((await ProjectManager.getYouTubePublishRecoveryState(acceptanceProject.slug)).status, "missing");

    const resumedState = stageState(acceptanceProject);
    await PipelineStageExecutor.execute(resumedState.project.slug, "youtube", resumedState);
    assert.equal(saveCalls, 2);
    assert.equal(publishCalls, 0);
    assert.equal(markCalls, 0);
    assert.equal((await ProjectManager.getProject(acceptanceProject.slug))?.status, "draft");
    assert.equal((await ProjectManager.getYouTubePublishState(acceptanceProject.slug)).status, "missing");

    const previousModel = process.env.OPENAI_MODEL;
    process.env.OPENAI_MODEL = "changed-after-readiness";
    const callsBeforeConfigurationChange = generateCalls;
    try {
      await assert.rejects(
        () => PipelineStageExecutor.execute(resumedState.project.slug, "youtube", resumedState),
        (error) => error instanceof ProductionAcceptancePolicyError,
      );
      assert.equal(generateCalls, callsBeforeConfigurationChange);
    } finally {
      if (previousModel === undefined) delete process.env.OPENAI_MODEL;
      else process.env.OPENAI_MODEL = previousModel;
    }

    const normalState = stageState();
    await PipelineStageExecutor.execute(normalState.project.slug, "youtube", normalState);
    assert.equal(saveCalls, 3);
    assert.equal(publishCalls, 1);
    assert.equal(markCalls, 1);
  } finally {
    YouTubePackagePipeline.generatePackage = originals.generatePackage;
    ProjectManager.saveYouTube = originals.saveYouTube;
    YouTubePublishPipeline.publishStoredPackage = originals.publish;
    ProjectManager.markYouTubePublished = originals.markPublished;
    PipelineJobManager.persistStageSuccess = originals.persist;
    removeMarkedSmokeProject(acceptanceProject.slug);
  }
}

async function verifyPersistedStrictPolicy(project: Project) {
  const provider = {
    name: "openai",
    async generateThumbnailPlan() { throw new Error("must be normalized"); },
    async generateThumbnailAsset() { throw new Error("not called"); },
  } as const;
  const configuredProvider: ThumbnailProvider = Object.assign(provider, {
    createImmutableThumbnailDispatchAdapter: () => createProviderDispatchAdapter(provider, {
      metadata: { name: provider.name },
      requiredMethods: ["generateThumbnailPlan", "generateThumbnailAsset"],
    }),
  });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const state = stageState(project);
    state.video = {} as VideoData;
    state.audio = {} as AudioData;
    await assert.rejects(
      () => PipelineStageExecutor.execute(project.slug, "thumbnail", state, { thumbnailProvider: configuredProvider }),
      (error) => error instanceof GenerationFallbackBlockedError,
    );
  }
}

async function verifyProbeCleanupFailsClosed() {
  let missingSentinelRoot = "";
  const sentinelReport = await readinessService({
    beforeProbeCleanup: (root) => {
      missingSentinelRoot = root;
      fs.rmSync(path.join(root, ".atolye-readiness-sentinel"));
    },
  }).evaluate();
  assert.equal(find(sentinelReport, "filesystem-permission").status, "UNAVAILABLE");
  assert.equal(find(sentinelReport, "filesystem-permission").reasonCode, "PROBE_CLEANUP_FAILED");
  restoreAndRemoveProbeRoot(missingSentinelRoot);

  const outside = path.join(process.cwd(), "data", `readiness-junction-target-${crypto.randomUUID()}`);
  fs.mkdirSync(outside);
  const outsideMarker = path.join(outside, "must-survive.txt");
  fs.writeFileSync(outsideMarker, "outside");
  let junctionRoot = "";
  let originalRoot = "";
  const junctionReport = await readinessService({
    beforeProbeCleanup: (root) => {
      junctionRoot = root;
      originalRoot = `${root}.original`;
      fs.renameSync(root, originalRoot);
      fs.symlinkSync(outside, root, "junction");
    },
  }).evaluate();
  assert.equal(find(junctionReport, "filesystem-permission").status, "UNAVAILABLE");
  assert.equal(fs.readFileSync(outsideMarker, "utf8"), "outside");
  fs.unlinkSync(junctionRoot);
  fs.renameSync(originalRoot, junctionRoot);
  removeProbeRoot(junctionRoot);
  fs.rmSync(outside, { recursive: true, force: false });
}

async function verifySpawnRunnerTimeoutCleanup() {
  const startedAt = Date.now();
  const result = await new SpawnRunner().run(
    process.execPath,
    ["-e", "setInterval(() => {}, 1000)"],
    { timeoutMs: 25, maxOutputBytes: 1024 },
  );
  assert.equal(result.timedOut, true);
  assert.equal(result.failed, true);
  assert(Date.now() - startedAt < 3_000);
}

async function verifyRuntimeReevaluation() {
  assert.equal(canonicalRuntime.workerLifecycle.statusSnapshot().workerReady, true);
  const report = await readinessService({
    runtimeStatus: () => canonicalRuntime.workerLifecycle.statusSnapshot(),
  }).evaluate();
  assert.equal(find(report, "runtime").status, "READY");
  assert.equal(find(report, "health").status, "READY");
  assert.equal(report.ready, false);
}

async function verifyAcceptanceGateStopsPipeline() {
  const originalRun = PipelineRunner.run;
  const originalCreateProject = ProjectManager.createProject;
  const originalResearch = AIManager.runResearch;
  const originalEvaluateReadiness = ProductionAcceptanceOrchestrator.evaluateReadiness;
  let pipelineStarted = false;
  let projectCreations = 0;
  let providerCalls = 0;
  try {
    ProductionAcceptanceOrchestrator.evaluateReadiness = () => readinessService().evaluate();
    PipelineRunner.run = async (...args: Parameters<typeof PipelineRunner.run>) => {
      pipelineStarted = true;
      return originalRun.apply(PipelineRunner, args);
    };
    ProjectManager.createProject = async (...args: Parameters<typeof ProjectManager.createProject>) => {
      projectCreations += 1;
      return originalCreateProject.apply(ProjectManager, args);
    };
    AIManager.runResearch = async (...args: Parameters<typeof AIManager.runResearch>) => {
      providerCalls += 1;
      return originalResearch.apply(AIManager, args);
    };
    await assert.rejects(
      () => ProductionAcceptanceOrchestrator.run({ topic: "Readiness gate acceptance" }),
      (error) => {
        assert(error instanceof ProductionAcceptanceBlockedError);
        assert.equal(error.readiness.ready, false);
        assert(error.readiness.checks.some((item) => item.critical && item.status !== "READY"));
        return true;
      },
    );
    assert.equal(pipelineStarted, false);
    assert.equal(projectCreations, 0);
    assert.equal(providerCalls, 0);
  } finally {
    PipelineRunner.run = originalRun;
    ProjectManager.createProject = originalCreateProject;
    AIManager.runResearch = originalResearch;
    ProductionAcceptanceOrchestrator.evaluateReadiness = originalEvaluateReadiness;
  }
}

function stageState(project?: Project) {
  const state = PipelineStageExecutor.createInitialState(project ?? {
    id: "acceptance-id",
    slug: "acceptance-package-only",
    title: "Acceptance",
    status: "draft",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  state.assembly = { scenes: [] } as unknown as AssemblyPlanData;
  state.thumbnail = {} as ThumbnailData;
  state.seo = {} as SEOData;
  return state;
}

function removeMarkedSmokeProject(projectSlug: string) {
  const root = path.join(projectsRoot, projectSlug);
  const marker = path.join(root, "production-acceptance.json");
  const parsed = JSON.parse(fs.readFileSync(marker, "utf8")) as { strictProductionAcceptance?: unknown };
  assert.equal(parsed.strictProductionAcceptance, true);
  fs.rmSync(root, { recursive: true, force: false });
}

function restoreAndRemoveProbeRoot(root: string) {
  assert(path.basename(root).startsWith(probePrefix));
  fs.writeFileSync(
    path.join(root, ".atolye-readiness-sentinel"),
    "atolye-production-readiness-v1",
    { flag: "wx" },
  );
  removeProbeRoot(root);
}

function removeProbeRoot(root: string) {
  assert(path.basename(root).startsWith(probePrefix));
  assert.equal(fs.lstatSync(root).isSymbolicLink(), false);
  const realProjects = fs.realpathSync(projectsRoot);
  const realRoot = fs.realpathSync(root);
  const relative = path.relative(realProjects, realRoot);
  assert(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
  assert.equal(
    fs.readFileSync(path.join(realRoot, ".atolye-readiness-sentinel"), "utf8"),
    "atolye-production-readiness-v1",
  );
  fs.rmSync(realRoot, { recursive: true, force: false });
}

function find(report: Awaited<ReturnType<ProductionReadinessService["evaluate"]>>, id: string) {
  const item = report.checks.find((check) => check.id === id);
  assert(item, `Missing readiness check: ${id}`);
  return item;
}

function readinessService(
  dependencies: ConstructorParameters<typeof ProductionReadinessService>[0] = {},
) {
  return new ProductionReadinessService({
    ...dependencies,
    runtimeStorageContext: canonicalRuntime.runtimeStorageContext,
  });
}

function probeDirectories() {
  if (!fs.existsSync(projectsRoot)) return [];
  return fs.readdirSync(projectsRoot).filter((name) => name.startsWith(probePrefix)).sort();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
