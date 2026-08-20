import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { createRuntimeStorageContext } from "../src/lib/runtime/RuntimeStoragePaths";
import { bootstrapTestRuntimeBackupStorageAuthority } from
  "../src/lib/runtime/backup/RuntimeBackupAuthority";
import { createVerifiedRuntimeBackup } from
  "../src/lib/runtime/backup/RuntimeBackupService";
import { createCompletedStageRegenerationPlan } from
  "../src/lib/production/ProductionCompletedStageRegenerationPlanner";
import {
  prepareCompletedStageRegeneration,
  ProductionRegenerationPreparationError,
} from "../src/lib/production/ProductionCompletedStageRegenerationService";
import { getProductionRegenerationClosure } from
  "../src/lib/production/ProductionCompletedStageRegenerationGraph";
import {
  readActiveRegenerationBinding,
  readCanonicalPackageBinding,
  recordRegeneratedPackageCompletion,
  requireRegenerationExecutionAdmission,
  sha256,
} from "../src/lib/production/ProductionCompletedStageRegenerationStore";
import { ProjectManager } from "../src/lib/projects/ProjectManager";
import { buildProductionPipelineExecutionIdentity } from
  "../src/lib/production/ProductionPipelineExecutionIdentity";
import { productionPipelineExecutionAuthorizationAction } from
  "../src/lib/production/ProductionPipelineExecutionSemantics";
import { prepareProductionPipelineExecution, readCompletedProductionPipelinePreparation } from
  "../src/lib/production/ProductionPipelineExecutionFactory";
import { createProductionRuntimeOperationContext, initialRuntimeAuthorityGeneration,
  runWithProductionRuntimeOperationContext } from
  "../src/lib/runtime/ProductionRuntimeOperationContext";
import { ProductionPipelineExecutionAdapter } from
  "../src/lib/production/ProductionPipelineExecutionAdapter";
import { settleFailedProductionPipelineExecution } from
  "../src/lib/production/ProductionPipelineTerminalSettlement";
import { prepareFailedStageRetry } from "../src/lib/pipeline/PipelineFailedStageRetry";
import { classifyProductionDurableAttemptLineage } from
  "../src/lib/production/ProductionDurableAttemptLineageClassifier";
import { withProductionAcceptanceRetryAdmission } from
  "../src/lib/production/ProductionAcceptanceLegacyAdmissionContext";
import { PipelineRecoveryPlanner, pipelineRecoveryStageOrder } from
  "../src/lib/pipeline/PipelineRecoveryPlanner";
import { PipelineRunner } from "../src/lib/pipeline/PipelineRunner";
import { VideoStorage } from "../src/lib/assets/storage/VideoStorage";
import { AudioStorage } from "../src/lib/assets/storage/AudioStorage";
import { VideoProviderRouter } from "../src/lib/video/providers/VideoProviderRouter";
import type { ConfiguredVideoProvider, VideoGenerationInput } from
  "../src/lib/video/providers/VideoProvider";
import { VideoAssemblyProviderRouter } from
  "../src/lib/assembly/providers/VideoAssemblyProviderRouter";
import type { ConfiguredVideoAssemblyProvider } from
  "../src/lib/assembly/providers/VideoAssemblyProvider";
import type { VideoAssemblyInput } from "../src/types/videoAssembly";
import type { VideoData } from "../src/types/video";
import type { AssemblyPlanData } from "../src/types/assembly";
import { createProviderDispatchAdapter } from
  "../src/lib/providers/ProviderDispatchAdapterAuthority";
import { AssemblyManager } from "../src/lib/assembly/AssemblyManager";
import { runWithProductionPipelineExecutionInstrumentation } from
  "../src/lib/production/ProductionPipelineExecutionInstrumentation";
import { configureScopedProductionPipelineExecution } from
  "../src/lib/production/ProductionPipelineExecutionConfiguration";
import { ProductionWorkerLifecycle } from
  "../src/lib/production/ProductionWorkerLifecycle";
import { productionAcceptanceConfigurationFingerprint,
  productionAcceptanceRequestFingerprint } from
  "../src/lib/production/ProductionAcceptancePolicy";
import { createProductionAcceptanceProjectSlug, productionAcceptanceTopicFingerprint } from
  "../src/lib/production/ProductionAcceptanceTopic";

const forbiddenProductionSlug =
  "fatih-sultan-mehmet-in-i-stanbul-un-fethine-hazirlanisi-cfe77fd8-8350-4415-bc87-211e3d36c4d5";
const at = "2026-08-08T12:00:00.000Z";
let passed = 0;

function check(value: unknown, message: string) {
  assert.ok(value, message);
  passed += 1;
  console.log(`[smoke-129.41] (${passed}/181) ${message}`);
}

function assertOwnedTempMutationTarget(projectSlug: string, projectRoot: string, ownedRoot: string) {
  const comparable = (value: string) => process.platform === "win32"
    ? path.normalize(value).toLowerCase() : path.normalize(value);
  const physical = (value: string) => {
    const remainder: string[] = [];
    let cursor = path.resolve(value);
    while (!fs.existsSync(cursor)) {
      const parent = path.dirname(cursor);
      if (parent === cursor) throw new Error("OWNED_TEMP_PROJECT_REQUIRED");
      remainder.unshift(path.basename(cursor)); cursor = parent;
    }
    const stat = fs.lstatSync(cursor, { bigint: true });
    if (stat.isSymbolicLink()) throw new Error("OWNED_TEMP_PROJECT_REQUIRED");
    const real = fs.realpathSync.native(cursor);
    return { path: path.resolve(real, ...remainder), device: stat.dev, inode: stat.ino };
  };
  const project = physical(projectRoot);
  const owned = physical(ownedRoot);
  const protectedRoot = physical(path.join(process.cwd(), "data", "projects",
    forbiddenProductionSlug));
  const contained = (root: string, target: string) => {
    const relative = path.relative(comparable(root), comparable(target));
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  };
  if (projectSlug.toLowerCase() === forbiddenProductionSlug.toLowerCase() ||
    !contained(owned.path, project.path) || contained(protectedRoot.path, project.path) ||
    (project.device === protectedRoot.device && project.inode === protectedRoot.inode)) {
    throw new Error("OWNED_TEMP_PROJECT_REQUIRED");
  }
}

function wav() {
  const dataLength = 16_000;
  const value = Buffer.alloc(44 + dataLength);
  value.write("RIFF", 0); value.writeUInt32LE(value.length - 8, 4);
  value.write("WAVE", 8); value.write("fmt ", 12); value.writeUInt32LE(16, 16);
  value.writeUInt16LE(1, 20); value.writeUInt16LE(1, 22);
  value.writeUInt32LE(8_000, 24); value.writeUInt32LE(16_000, 28);
  value.writeUInt16LE(2, 32); value.writeUInt16LE(16, 34);
  value.write("data", 36); value.writeUInt32LE(dataLength, 40);
  return value;
}

function mp4() {
  const box = (type: string, payload = Buffer.alloc(0)) => {
    const value = Buffer.alloc(8 + payload.length);
    value.writeUInt32BE(value.length, 0); value.write(type, 4, 4, "ascii");
    payload.copy(value, 8); return value;
  };
  return Buffer.concat([box("ftyp", Buffer.from("isom0000")), box("moov"),
    box("mdat", Buffer.from([0, 1, 2, 3]))]);
}

function publishCanonicalAudioFixture(f: Fixture) {
  const operation = createProductionRuntimeOperationContext({
    operationId: `sprint-129-41-audio-${sha256(f.root).slice(0, 24)}`,
    operationType: "canonical-smoke-runtime",
    authorityGeneration: initialRuntimeAuthorityGeneration,
    storageContext: f.context,
  });
  runWithProductionRuntimeOperationContext(operation, () => {
    const registry = JSON.parse(fs.readFileSync(
      path.join(f.projectRoot, "assets", "assets.json"), "utf8")) as {
        assets: Array<Record<string, unknown>>;
      };
    for (let index = 1; index <= 7; index += 1) {
      const assetId = index === 7 ? "audio-old" : `audio-${index}`;
      const saved = AudioStorage.saveAudio({ projectSlug: f.slug,
        assetId, fileName: `audio-${index}.wav`, data: wav() }, f.context);
      const registered = registry.assets.find((asset) => asset.id === assetId);
      if (!registered) throw new Error("canonical audio registry fixture missing");
      const owned = AudioStorage.transferPublicationOwnership(saved, registered);
      if (!AudioStorage.completePublishedAudio(owned)) {
        throw new Error("canonical audio publication handoff failed");
      }
      const inspection = AudioStorage.inspectStoredWav(f.slug, saved.filePath, f.context);
      if (inspection.byteLength !== saved.byteLength ||
        inspection.durationSeconds !== saved.durationSeconds) {
        throw new Error("canonical audio descriptor-bound inspection failed");
      }
    }
  });
}

function republishCanonicalAudioFixture(f: Fixture) {
  assertOwnedTempMutationTarget(f.slug, f.projectRoot, f.root);
  for (let index = 1; index <= 7; index += 1) {
    const filePath = path.join(f.projectRoot, "assets", "audio", `audio-${index}.wav`);
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error("owned canonical audio fixture identity invalid");
    }
    fs.unlinkSync(filePath);
  }
  publishCanonicalAudioFixture(f);
}

class FixtureVideoProvider implements ConfiguredVideoProvider {
  readonly name = "ffmpeg" as const;
  readonly calls: VideoGenerationInput[] = [];

  createImmutableVideoDispatchAdapter() {
    return createProviderDispatchAdapter(this, {
      metadata: { name: this.name }, requiredMethods: ["generateVideo"],
    });
  }

  async generateVideo(input: VideoGenerationInput) {
    this.calls.push(input);
    const scenes = input.scenes.map((scene) => {
      const paths = VideoStorage.createSceneRenderPaths(input.projectSlug, scene.sceneId);
      fs.writeFileSync(paths.temporaryAbsolutePath, mp4());
      VideoStorage.finalize(paths.temporaryAbsolutePath, paths.absolutePath);
      return { sceneId: scene.sceneId, sourceImageAssetId: scene.sourceImageAssetId,
        animationAssetId: scene.animationAssetId, provider: this.name,
        model: "ffmpeg-scene-h264", generationMode: "production" as const,
        filePath: paths.filePath, url: paths.url, mimeType: "video/mp4" as const,
        byteLength: mp4().length, durationSeconds: scene.motionPlan.durationSeconds,
        width: 1920, height: 1080, frameRate: 30, transition: scene.motionPlan.transition,
        status: "generated" as const, createdAt: new Date().toISOString() };
    });
    return { success: true as const, provider: this.name,
      generationMode: "production" as const, scenes };
  }
}

class FixtureAssemblyProvider implements ConfiguredVideoAssemblyProvider {
  readonly name = "ffmpeg" as const;
  readonly calls: VideoAssemblyInput[] = [];

  createImmutableAssemblyDispatchAdapter() {
    return createProviderDispatchAdapter(this, {
      metadata: { name: this.name }, requiredMethods: ["assemble"],
    });
  }

  async assemble(input: VideoAssemblyInput) {
    this.calls.push(input);
    const paths = VideoStorage.createRenderPaths(input.projectSlug);
    fs.writeFileSync(paths.temporaryAbsolutePath, mp4());
    VideoStorage.finalize(paths.temporaryAbsolutePath, paths.absolutePath);
    return { success: true as const, provider: this.name, status: "rendered" as const,
      model: "ffmpeg-h264-aac" as const, filePath: paths.filePath, url: paths.url,
      mimeType: "video/mp4" as const, byteLength: mp4().length, durationSeconds: 60,
      width: 1920 as const, height: 1080 as const, videoCodec: "h264" as const,
      audioCodec: "aac" as const, createdAt: new Date().toISOString() };
  }
}

async function observeBoundedResume(slug: string, stopAfterStage: "video" | "assembly") {
  const events: Array<{ event: string; detail?: Readonly<Record<string, unknown>> }> = [];
  const result = await runWithProductionPipelineExecutionInstrumentation({
    onEvent(event, detail) { events.push({ event, detail }); },
  }, () => PipelineRunner.resume(slug, { stopAfterStage }));
  return { result, events };
}

function observedCount(
  observed: Awaited<ReturnType<typeof observeBoundedResume>>,
  event: string,
  stage?: string,
  slot?: string,
) {
  return observed.events.filter((item) => item.event === event &&
    (stage === undefined || item.detail?.stage === stage) &&
    (slot === undefined || item.detail?.slot === slot)).length;
}

async function readyWorker(context: ReturnType<typeof createProductionRuntimeOperationContext>) {
  const worker = new ProductionWorkerLifecycle(() => at);
  worker.bindRuntimeOperationContext(context);
  const started = await worker.start({ initialization: { schemaVersion: "1", ok: true,
    decision: "ready", reasonCode: "RUNTIME_INITIALIZED", initializedAt: at, writeFree: true,
    partialInitialization: false, projects: [], counts: { active: 0, running: 0, terminal: 0,
      orphaned: 0, "expired-lease": 0, replayable: 0 }, worker: worker.snapshot(), evidence: [] } });
  assert.equal(started.ok, true);
  return worker;
}

type PreparationWorkerInput = {
  workspaceRoot: string;
  runtimeRoot: string;
  authorityRoot: string;
  backupRoot: string;
  plan: Awaited<ReturnType<typeof createCompletedStageRegenerationPlan>>;
  backupId: string;
  reasonCode: string;
};

async function preparationWorker(inputPath: string) {
  const input = JSON.parse(fs.readFileSync(inputPath, "utf8")) as PreparationWorkerInput;
  process.env.ATOLYE_RUNTIME_ROOT = input.runtimeRoot;
  process.env.ATOLYE_RUNTIME_AUTHORITY_ROOT = input.authorityRoot;
  process.env.ATOLYE_WORKSPACE_ROOT = input.workspaceRoot;
  const context = createRuntimeStorageContext({ workspaceRoot: input.workspaceRoot,
    environment: { ATOLYE_RUNTIME_ROOT: input.runtimeRoot,
      ATOLYE_RUNTIME_AUTHORITY_ROOT: input.authorityRoot }, authorityRoot: input.authorityRoot });
  const authority = bootstrapTestRuntimeBackupStorageAuthority(context, input.backupRoot);
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      const result = await prepareCompletedStageRegeneration({ plan: input.plan,
        backupId: input.backupId, reasonCode: input.reasonCode,
        confirmation: input.plan.planFingerprint, context, backupAuthority: authority });
      process.stdout.write(JSON.stringify({ status: result.status }));
      return;
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error
        ? String((error as { code: unknown }).code) : "UNKNOWN";
      if (code === "RUNTIME_STORAGE_AUTHORITY_LOCKED") {
        await new Promise<void>((resolve) => setTimeout(resolve, 25));
        continue;
      }
      process.stdout.write(JSON.stringify({ status: "rejected", code }));
      return;
    }
  }
  process.stdout.write(JSON.stringify({ status: "rejected", code: "WORKER_TIMEOUT" }));
}

function spawnPreparationWorker(inputPath: string) {
  const tsx = path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
  return new Promise<{ status: string; code?: string }>((resolve, reject) => {
    const child = spawn(process.execPath, [tsx, __filename, "prepare-worker", inputPath], {
      cwd: process.cwd(), windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = ""; let stderr = "";
    child.stdout.on("data", (value) => { stdout += String(value); });
    child.stderr.on("data", (value) => { stderr += String(value); });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code !== 0) return reject(new Error(`worker failed: ${stderr}`));
      try { resolve(JSON.parse(stdout) as { status: string; code?: string }); }
      catch { reject(new Error(`worker output invalid: ${stdout} ${stderr}`)); }
    });
  });
}

function publishRecord(f: Fixture, status: "publishing" | "published" = "published") {
  return { schemaVersion: "1", projectId: `project-${f.slug.replace("owned-temp-", "")}`,
    slug: f.slug, packageIdentity: "a".repeat(64), videoAssetId: "video-1",
    thumbnailAssetId: "thumbnail-1", provider: "mock", attemptId: "attempt-1",
    status, createdAt: at, ...(status === "published" ? { remoteVideoId: "remote-1",
      remoteVideoUrl: "https://www.youtube.com/watch?v=remote-1", publishedAt: at } : {}) };
}

interface Fixture {
  root: string;
  slug: string;
  projectRoot: string;
  context: ReturnType<typeof createRuntimeStorageContext>;
  authority: ReturnType<typeof bootstrapTestRuntimeBackupStorageAuthority>;
}

function fixture(label: string, forcedSlug?: string): Fixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "a41-"));
  const workspaceRoot = path.join(root, "w");
  const runtimeRoot = path.join(workspaceRoot, "data");
  const authorityRoot = path.join(root, "a");
  const backupRoot = path.join(root, "b");
  const runnerTopic = "Runner test";
  const runnerRunId = "00000000-0000-4000-8000-000000000041";
  const slug = forcedSlug ?? (label === "real-runner"
    ? createProductionAcceptanceProjectSlug(runnerTopic, runnerRunId)
    : `p-${sha256(label).slice(0, 12)}`);
  process.env.ATOLYE_RUNTIME_ROOT = runtimeRoot;
  process.env.ATOLYE_RUNTIME_AUTHORITY_ROOT = authorityRoot;
  process.env.ATOLYE_WORKSPACE_ROOT = workspaceRoot;
  fs.mkdirSync(workspaceRoot, { recursive: true });
  execFileSync("git", ["init", "--quiet"], { cwd: workspaceRoot });
  const context = createRuntimeStorageContext({
    workspaceRoot,
    environment: {
      ATOLYE_RUNTIME_ROOT: runtimeRoot,
      ATOLYE_RUNTIME_AUTHORITY_ROOT: authorityRoot,
    },
    authorityRoot,
  });
  fs.mkdirSync(context.projectsRoot, { recursive: true });
  const authority = bootstrapTestRuntimeBackupStorageAuthority(context, backupRoot);
  const projectRoot = path.join(context.projectsRoot, slug);
  assertOwnedTempMutationTarget(slug, projectRoot, root);
  fs.mkdirSync(path.join(projectRoot, "assets", "videos"), { recursive: true });
  fs.mkdirSync(path.join(projectRoot, "assets", "images"), { recursive: true });
  const project = { id: `project-${label}`, slug, title: label, status: "assembly",
    createdAt: at, updatedAt: at };
  const completed = new Set(["research", "script", "scenes", "visuals", "animation",
    "video", "audio", "assembly"]);
  const packages = Object.fromEntries(pipelineRecoveryStageOrder.map((stage) => [stage, {
    key: stage,
    status: completed.has(stage) ? "completed" : "pending",
    fileName: `${stage}.json`,
    updatedAt: at,
    ...(completed.has(stage) ? { completedAt: at, attempts: { total: 1, retry: 0,
      lastAttemptAt: at, lastRunType: "resume" } } : {}),
  }]));
  write(projectRoot, "project.json", project);
  write(projectRoot, "manifest.json", { project, projectId: project.id, slug, version: 1,
    packages, createdAt: at, updatedAt: at });
  const frame = { crop: { x: 0, y: 0, width: 1, height: 1 },
    transform: { scale: 1, translateX: 0, translateY: 0 } };
  const animationScene = { sceneId: 1, animationPrompt: "Slow movement",
    sourceImageAssetId: "image-1", outputAssetId: "animation-1",
    animationAssetId: "animation-1", durationSeconds: 60, motionType: "static",
    start: frame, end: frame, transition: "fade", provider: "mock",
    model: "mock-animation-model", generationMode: "mock", artifactType: "motion-plan",
    status: "generated" };
  write(projectRoot, "research.json", { topic: label, createdAt: at });
  write(projectRoot, "script.json", { topic: label, title: label, subtitle: "", hook: "",
    introduction: "", chapters: [{ id: 1, title: "One", narration: "One", duration: 60,
      visualGoal: "One", emotion: "calm", transition: "cut" }], conclusion: "",
    callToAction: "", estimatedDuration: 60, narrationWordCount: 120,
    targetAudience: "all", language: "tr", voiceStyle: "documentary", musicStyle: "none",
    thumbnailIdea: "", seoKeywords: [], createdAt: at });
  write(projectRoot, "scenes.json", { scenes: [{ id: 1, chapterId: 1, title: "One",
    description: "One", duration: 60 }], createdAt: at });
  write(projectRoot, "visuals.json", { projectId: project.id, scenes: [{ sceneId: 1,
    visualPrompt: "One", animationPrompt: "Slow movement", style: "documentary" }],
    thumbnail: { title: "One", prompt: "One", composition: "One", mood: "calm" }, createdAt: at });
  write(projectRoot, "animation.json", { projectId: project.id, schemaVersion: "2",
    artifactType: "motion-plan", scenes: [animationScene], createdAt: at });
  const oldVideoPath = `data/projects/${slug}/assets/videos/scene-old-1.mp4`;
  const oldVideoUrl = `/api/assets/videos/${slug}/scene-old-1.mp4`;
  write(projectRoot, "video.json", { projectId: project.id, schemaVersion: "2",
    artifactType: "scene-video", provider: "ffmpeg", createdAt: at, status: "generated",
    scenes: [{ sceneId: 1, sourceAnimationAssetId: "animation-1",
      sourceImageAssetId: "image-1", animationAssetId: "animation-1", status: "generated",
      outputAssetId: "video-old-1", videoAssetId: "video-old-1", durationSeconds: 60,
      frameRate: 30, transition: "fade", provider: "ffmpeg", generationMode: "production",
      filePath: oldVideoPath, url: oldVideoUrl, mimeType: "video/mp4", byteLength: mp4().length,
      width: 1920, height: 1080, artifactType: "scene-video" }] });
  write(projectRoot, "audio.json", { outputAssetId: "audio-old", status: "generated",
    provider: "openai", narrator: { style: "documentary", tone: "calm", language: "tr" },
    sections: [{ chapterId: 1, title: "One", duration: "00:01", emotion: "calm",
      emphasis: ["one"], narrationNotes: "One", pacing: "medium", sourceText: "One",
      outputAssetId: "audio-1", status: "generated", provider: "openai",
      audioFileUrl: `/api/assets/audio/${slug}/audio-1.wav`, byteLength: wav().length,
      durationSeconds: 1 }], music: { mood: "none", suggestion: "none", intensity: "none" },
    production: { targetFormat: "wav", sampleRate: 8000, estimatedTotalDuration: "00:01",
      generationStatus: "generated", audioFileUrl: `/api/assets/audio/${slug}/audio-7.wav`,
      byteLength: wav().length, durationSeconds: 1 }, createdAt: at });
  write(projectRoot, "assembly.json", { projectId: project.id, slug, status: "assembled",
    outputAssetId: "assembly-old", sourceVideoAssetId: "video-old-1",
    sourceAudioAssetId: "audio-old", scenes: [{ sceneId: 1, chapterId: 1, duration: "01:00",
      visualReference: "One", animationAssetId: "animation-1", videoAssetId: "video-old-1",
      audioAssetId: "audio-1", audioReference: "One", transition: "fade",
      cameraMovement: "static", effects: [] }], totalDuration: "01:00", style: "documentary",
    render: { status: "rendered", format: "mp4" }, createdAt: at });
  const imagePath = `data/projects/${slug}/assets/images/image-1.png`;
  const audioPath = (index: number) => `data/projects/${slug}/assets/audio/audio-${index}.wav`;
  write(projectRoot, "assets/assets.json", { projectId: project.id, projectSlug: slug,
    assets: [
      { id: "image-1", projectId: project.id, projectSlug: slug, sceneId: 1, type: "image",
        status: "generated", provider: "openai", prompt: "One", filePath: imagePath,
        url: `/api/assets/images/${slug}/image-1.png`, mimeType: "image/png", createdAt: at },
      { id: "animation-1", projectId: project.id, projectSlug: slug, sceneId: 1,
        type: "animation", status: "generated", provider: "mock", model: "mock-animation-model",
        prompt: "Slow movement", mimeType: "application/vnd.atolye.motion-plan+json",
        durationSeconds: 60, artifactType: "motion-plan", sourceAssetId: "image-1",
        generationMode: "mock", createdAt: at },
      { id: "video-old-1", projectId: project.id, projectSlug: slug, sceneId: 1, type: "video",
        status: "generated", provider: "ffmpeg", model: "ffmpeg-scene-h264",
        prompt: "Scene video render.", filePath: oldVideoPath, url: oldVideoUrl,
        mimeType: "video/mp4", byteLength: mp4().length, durationSeconds: 60,
        artifactType: "scene-video", sourceAssetId: "image-1", animationAssetId: "animation-1",
        generationMode: "production", width: 1920, height: 1080, frameRate: 30,
        transition: "fade", createdAt: at },
      ...Array.from({ length: 7 }, (_, offset) => ({ file: offset + 1,
        id: offset === 6 ? "audio-old" : `audio-${offset + 1}`, sceneId: offset === 0 ? 1 : undefined }))
        .map((item) =>
        ({ id: item.id, projectId: project.id, projectSlug: slug, ...(item.sceneId ? { sceneId: 1 } : {}),
          type: "audio", status: "generated", provider: "openai", model: "fixture",
          prompt: "audio", filePath: audioPath(item.file),
          url: `/api/assets/audio/${slug}/audio-${item.file}.wav`, mimeType: "audio/wav",
          byteLength: wav().length, durationSeconds: 1, createdAt: at })),
      { id: "assembly-old", projectId: project.id, projectSlug: slug, type: "video",
        status: "generated", provider: "ffmpeg", model: "ffmpeg-h264-aac", prompt: "Assembly",
        filePath: `data/projects/${slug}/assets/videos/assembly-old.mp4`,
        url: `/api/assets/videos/${slug}/assembly-old.mp4`, mimeType: "video/mp4",
        byteLength: mp4().length, durationSeconds: 60, createdAt: at },
    ], createdAt: at, updatedAt: at });
  if (label === "real-runner") {
    const configurationFingerprint = productionAcceptanceConfigurationFingerprint();
    write(projectRoot, "production-acceptance.json", { schemaVersion: "2", runId: runnerRunId,
      topic: runnerTopic, topicFingerprint: productionAcceptanceTopicFingerprint(runnerTopic),
      requestFingerprint: productionAcceptanceRequestFingerprint({ topic: runnerTopic,
        runId: runnerRunId, configurationFingerprint }), strictProductionAcceptance: true,
      publishMode: "package-only", configurationFingerprint, createdAt: at,
      acceptanceStatus: "validated", productionReady: true, published: false,
      validatedAt: at });
  } else {
    write(projectRoot, "production-acceptance.json", { schemaVersion: "3",
      configurationFingerprint: "config-a", componentFingerprints: { renderer: "renderer-a" },
      acceptanceStatus: "validated", productionReady: false });
  }
  const fixtureValue = { root, slug, projectRoot, context, authority };
  publishCanonicalAudioFixture(fixtureValue);
  const cleanupRoot = path.join(projectRoot, "production-execution",
    "audio-compensation-cleanup");
  if (fs.existsSync(cleanupRoot)) {
    const physicalCleanup = fs.realpathSync.native(cleanupRoot);
    const relative = path.relative(root, physicalCleanup);
    const stat = fs.lstatSync(cleanupRoot);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative) ||
      stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error("owned audio terminal-record retirement escaped fixture");
    }
    fs.rmSync(cleanupRoot, { recursive: true, force: false });
  }
  fs.writeFileSync(path.join(projectRoot, "assets", "images", "image-1.png"),
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  for (let index = 1; index <= 6; index += 1) {
    fs.writeFileSync(path.join(projectRoot, "assets", "videos", `scene-old-${index}.mp4`),
      mp4());
  }
  fs.writeFileSync(path.join(projectRoot, "assets", "videos", "assembly-old.mp4"),
    mp4());
  write(projectRoot, "pipeline-jobs.json", { projectSlug: slug, createdAt: at, updatedAt: at,
    jobs: pipelineRecoveryStageOrder.map((stage) => ({ id: `${slug}-${stage}`, projectSlug: slug,
      stage, title: stage, status: completed.has(stage) ? "completed" : "queued",
      attempts: stage === "assembly" ? 1 : 0, createdAt: at, updatedAt: at,
      ...(completed.has(stage) ? { completedAt: at } : {}) })) });
  write(projectRoot, "pipeline-history.json", { projectSlug: slug, events: [], createdAt: at,
    updatedAt: at });
  return fixtureValue;
}

function write(root: string, relative: string, value: unknown) {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`);
}

function treeDigest(root: string) {
  const rows: string[] = [];
  const visit = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name))) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(target);
      else rows.push(`${path.relative(root, target)}:${sha256(fs.readFileSync(target))}`);
    }
  };
  visit(root);
  return sha256(rows.join("\n"));
}

async function plan(f: Fixture) {
  process.env.ATOLYE_RUNTIME_ROOT = f.context.runtimeRoot;
  process.env.ATOLYE_RUNTIME_AUTHORITY_ROOT = f.context.authorityRoot;
  process.env.ATOLYE_WORKSPACE_ROOT = f.context.workspaceRoot;
  return createCompletedStageRegenerationPlan({ projectSlug: f.slug, fromStage: "video",
    context: f.context, runtimeAuthorityId: f.authority.runtimeAuthorityId });
}

async function assertSupersessionPrecommitRejection(
  roots: string[],
  label: string,
  stage: "video" | "assembly",
  mutate: (input: { fixture: Fixture; intendedPath: string }) => void,
) {
  const value = fixture(label); roots.push(value.root);
  const valuePlan = await plan(value);
  const valueBackup = createVerifiedRuntimeBackup({ authority: value.authority,
    projectSlug: value.slug });
  const prepared = await prepareCompletedStageRegeneration({ plan: valuePlan,
    backupId: valueBackup.backupId, reasonCode: "FRAMING_REMEDIATION",
    confirmation: valuePlan.planFingerprint, context: value.context,
    backupAuthority: value.authority });
  const directory = path.join(value.projectRoot, "production-regeneration", "regenerations",
    prepared.intent.regenerationId);
  const intendedPath = path.join(directory, "supersession", `${stage}-intended.json`);
  const packagePath = path.join(value.projectRoot, `${stage}.json`);
  const manifestPath = path.join(value.projectRoot, "manifest.json");
  const packageBefore = fs.readFileSync(packagePath);
  const manifestBefore = fs.readFileSync(manifestPath);
  mutate({ fixture: value, intendedPath });
  await assert.rejects(() => stage === "video"
    ? ProjectManager.saveVideo(value.slug, { replacement: true }, value.context)
    : ProjectManager.saveAssembly(value.slug, { replacement: true }, value.context),
  /PRODUCTION_REGENERATION_SUPERSESSION_INVALID/);
  const noEvidence = !fs.existsSync(path.join(directory, "package-bindings", `${stage}.json`)) &&
    !fs.existsSync(path.join(directory, "stage-receipts", `${stage}.json`)) &&
    !fs.existsSync(path.join(directory, "supersession", `${stage}-completed.json`));
  check(fs.readFileSync(packagePath).equals(packageBefore) &&
    fs.readFileSync(manifestPath).equals(manifestBefore) && noEvidence,
  `${label} rejected before canonical package, manifest, or completion evidence`);
}

async function main() {
  const roots: string[] = [];
  try {
    const forbiddenRoot = path.join(process.cwd(), "data", "projects", forbiddenProductionSlug);
    const forbiddenBefore = fs.existsSync(forbiddenRoot) ? treeDigest(forbiddenRoot) : "missing";
    assert.throws(() => assertOwnedTempMutationTarget(
      forbiddenProductionSlug, forbiddenRoot, os.tmpdir()), /OWNED_TEMP_PROJECT_REQUIRED/);
    const equivalentForbidden = path.join(forbiddenRoot, "..", forbiddenProductionSlug);
    assert.throws(() => assertOwnedTempMutationTarget(
      `owned-temp-${forbiddenProductionSlug}`, equivalentForbidden, os.tmpdir()),
    /OWNED_TEMP_PROJECT_REQUIRED/);
    if (process.platform === "win32") {
      assert.throws(() => assertOwnedTempMutationTarget(
        `owned-temp-${forbiddenProductionSlug}`, forbiddenRoot.toUpperCase(), os.tmpdir()),
      /OWNED_TEMP_PROJECT_REQUIRED/);
    }
    const guardRoot = fs.mkdtempSync(path.join(os.tmpdir(), "atolye-129-41-guard-"));
    roots.push(guardRoot);
    const genuineTarget = path.join(guardRoot, "genuine-project");
    assert.doesNotThrow(() => assertOwnedTempMutationTarget(
      "owned-temp-genuine-project", genuineTarget, guardRoot));
    const junction = path.join(guardRoot, "production-alias");
    fs.symlinkSync(forbiddenRoot, junction, process.platform === "win32" ? "junction" : "dir");
    try {
      assert.throws(() => assertOwnedTempMutationTarget(
        "owned-temp-production-alias", junction, guardRoot), /OWNED_TEMP_PROJECT_REQUIRED/);
      assert.throws(() => assertOwnedTempMutationTarget(
        "owned-temp-production-alias-nested", path.join(junction, "nested"), guardRoot),
      /OWNED_TEMP_PROJECT_REQUIRED/);
    } finally {
      const junctionStat = fs.lstatSync(junction);
      assert.equal(junctionStat.isSymbolicLink(), true);
      fs.unlinkSync(junction);
    }
    check((fs.existsSync(forbiddenRoot) ? treeDigest(forbiddenRoot) : "missing") === forbiddenBefore,
      "physical production guard rejects direct, equivalent, case, junction, and nested aliases");
    const closure = getProductionRegenerationClosure("video");
    check(JSON.stringify(closure.preservedStages) === JSON.stringify(
      ["research", "script", "scenes", "visuals", "animation", "audio"]), "closure preserved");
    check(JSON.stringify(closure.regeneratedStages) === JSON.stringify(["video"]), "closure target");
    check(JSON.stringify(closure.invalidatedStages) === JSON.stringify(
      ["assembly", "thumbnail", "seo", "youtube", "export"]), "closure invalidated");
    check(!closure.effectiveSequence.includes("audio"), "audio outside closure");
    check(JSON.stringify(closure.effectiveSequence) === JSON.stringify(
      ["video", "assembly", "thumbnail", "seo", "youtube", "export"]), "effective sequence");

    const f = fixture("primary"); roots.push(f.root);
    check(f.slug !== forbiddenProductionSlug && f.projectRoot.startsWith(os.tmpdir()), "owned temp only");
    for (const rejectedStage of ["research", "script", "scenes", "visuals", "animation",
      "audio", "thumbnail", "seo", "youtube", "export", "unknown-stage"]) {
      await assert.rejects(() => createCompletedStageRegenerationPlan({ projectSlug: f.slug,
        fromStage: rejectedStage as never, context: f.context,
        runtimeAuthorityId: f.authority.runtimeAuthorityId }),
      /PRODUCTION_REGENERATION_STAGE_INVALID/);
    }
    check(true, "public planner admits video and assembly only");
    assert.throws(() => execFileSync(process.execPath, [path.join(process.cwd(), "node_modules",
      "tsx", "dist", "cli.mjs"), path.join(process.cwd(), "scripts",
      "run-production-regeneration.ts"), "plan", "--project-slug=owned-temp-cli",
      "--from-stage=thumbnail"], { cwd: process.cwd(), stdio: "pipe" }));
    check(true, "public CLI still rejects a non-video/non-assembly stage before project access");
    let assemblyCliError: { stderr?: Buffer } | null = null;
    try {
      execFileSync(process.execPath, [path.join(process.cwd(), "node_modules", "tsx", "dist",
        "cli.mjs"), path.join(process.cwd(), "scripts", "run-production-regeneration.ts"), "plan",
        "--project-slug=owned-temp-cli-assembly", "--from-stage=assembly"],
        { cwd: process.cwd(), stdio: "pipe" });
    } catch (error) {
      assemblyCliError = error as { stderr?: Buffer };
    }
    check(assemblyCliError !== null,
      "public CLI still rejects a nonexistent project even with a valid --from-stage=assembly");
    check(!(assemblyCliError?.stderr?.toString("utf8") ?? "").includes("INVALID_ARGUMENTS"),
      "public CLI now accepts --from-stage=assembly at the argument-parsing stage");

    // ── B extension: assembly-only regeneration (--from-stage=assembly) ──
    {
    const closureAssemblyOnly = getProductionRegenerationClosure("assembly");
    check(JSON.stringify(closureAssemblyOnly.preservedStages) === JSON.stringify(
      ["research", "script", "scenes", "visuals", "animation", "video", "audio"]),
      "assembly closure preserves research..audio, including video");
    check(JSON.stringify(closureAssemblyOnly.regeneratedStages) === JSON.stringify(["assembly"]),
      "assembly closure regenerates assembly alone");
    check(JSON.stringify(closureAssemblyOnly.invalidatedStages) === JSON.stringify(
      ["thumbnail", "seo", "youtube", "export"]),
      "assembly closure invalidates only downstream stages");
    check(!closureAssemblyOnly.effectiveSequence.includes("video") &&
      !closureAssemblyOnly.effectiveSequence.includes("audio"),
      "assembly closure never touches video or audio");

    const g = fixture("assembly-only"); roots.push(g.root);
    process.env.ATOLYE_RUNTIME_ROOT = g.context.runtimeRoot;
    process.env.ATOLYE_RUNTIME_AUTHORITY_ROOT = g.context.authorityRoot;
    process.env.ATOLYE_WORKSPACE_ROOT = g.context.workspaceRoot;
    const videoJsonBefore = fs.readFileSync(path.join(g.projectRoot, "video.json"));
    const videoAssetBefore = fs.readFileSync(
      path.join(g.projectRoot, "assets", "videos", "scene-old-1.mp4"));
    const audioJsonBefore = fs.readFileSync(path.join(g.projectRoot, "audio.json"));
    const audioAssetBefore = fs.readFileSync(
      path.join(g.projectRoot, "assets", "audio", "audio-1.wav"));

    const assemblyPlan = await createCompletedStageRegenerationPlan({ projectSlug: g.slug,
      fromStage: "assembly", context: g.context, runtimeAuthorityId: g.authority.runtimeAuthorityId });
    check(JSON.stringify(assemblyPlan.regeneratedStages) === JSON.stringify(["assembly"]),
      "assembly-only plan targets assembly alone");
    check(assemblyPlan.preservedStages.includes("video") &&
      assemblyPlan.preservedStages.includes("audio"),
      "assembly-only plan preserves video and audio");
    check(JSON.stringify(assemblyPlan.invalidatedStages) === JSON.stringify(
      ["thumbnail", "seo", "youtube", "export"]),
      "assembly-only plan invalidates only downstream stages");
    check(assemblyPlan.audioFiles.length === 7,
      "assembly-only plan still fingerprints all 7 audio files for preservation");

    const assemblyBackup = createVerifiedRuntimeBackup({ authority: g.authority,
      projectSlug: g.slug });
    await assert.rejects(() => prepareCompletedStageRegeneration({ plan: assemblyPlan,
      backupId: assemblyBackup.backupId, reasonCode: "TRANSITION_QUALITY_REMEDIATION",
      confirmation: "not-the-plan-fingerprint", context: g.context, backupAuthority: g.authority }),
    /PRODUCTION_REGENERATION_REQUEST_INVALID/);
    check(true, "assembly-only prepare still enforces confirmation === planFingerprint");
    await assert.rejects(() => prepareCompletedStageRegeneration({ plan: assemblyPlan,
      backupId: "missing", reasonCode: "TRANSITION_QUALITY_REMEDIATION",
      confirmation: assemblyPlan.planFingerprint, context: g.context, backupAuthority: g.authority }),
    /PRODUCTION_REGENERATION_BACKUP_INVALID/);
    check(true, "assembly-only prepare still enforces a verified backup binding");

    const assemblyPrepared = await prepareCompletedStageRegeneration({ plan: assemblyPlan,
      backupId: assemblyBackup.backupId, reasonCode: "TRANSITION_QUALITY_REMEDIATION",
      confirmation: assemblyPlan.planFingerprint, context: g.context, backupAuthority: g.authority });
    check(assemblyPrepared.status === "prepared", "assembly-only prepare succeeds");
    check(assemblyPrepared.intent.affectedStages.length === 5 &&
      !assemblyPrepared.intent.affectedStages.includes("video") &&
      !assemblyPrepared.intent.affectedStages.includes("audio"),
      "assembly-only intent's affected stages exclude video and audio");

    check(fs.readFileSync(path.join(g.projectRoot, "video.json")).equals(videoJsonBefore),
      "video.json byte-identical after assembly-only prepare");
    check(fs.readFileSync(path.join(g.projectRoot, "assets", "videos", "scene-old-1.mp4"))
      .equals(videoAssetBefore), "video scene asset byte-identical after assembly-only prepare");
    check(fs.readFileSync(path.join(g.projectRoot, "audio.json")).equals(audioJsonBefore),
      "audio.json byte-identical after assembly-only prepare");
    check(fs.readFileSync(path.join(g.projectRoot, "assets", "audio", "audio-1.wav"))
      .equals(audioAssetBefore), "audio asset byte-identical after assembly-only prepare");

    const assemblyRegenDir = path.join(g.projectRoot, "production-regeneration", "regenerations",
      assemblyPrepared.intent.regenerationId);
    check(!fs.existsSync(path.join(assemblyRegenDir, "snapshots",
      `generation-${assemblyPlan.currentGeneration}`, "video.json")),
      "no video snapshot recorded for an assembly-only regeneration");
    check(!fs.existsSync(path.join(assemblyRegenDir, "supersession", "video-intended.json")),
      "no video supersession intent recorded for an assembly-only regeneration");
    check(fs.existsSync(path.join(assemblyRegenDir, "snapshots",
      `generation-${assemblyPlan.currentGeneration}`, "assembly.json")) &&
      fs.existsSync(path.join(assemblyRegenDir, "supersession", "assembly-intended.json")),
      "assembly snapshot and supersession intent recorded for the regenerated stage");

    const manifestAfterAssembly = JSON.parse(fs.readFileSync(
      path.join(g.projectRoot, "manifest.json"), "utf8"));
    check(manifestAfterAssembly.packages.video.status === "completed" &&
      manifestAfterAssembly.packages.audio.status === "completed",
      "manifest keeps video and audio completed after assembly-only prepare");
    check(manifestAfterAssembly.packages.assembly.status === "pending" &&
      manifestAfterAssembly.packages.thumbnail.status === "pending" &&
      manifestAfterAssembly.packages.seo.status === "pending" &&
      manifestAfterAssembly.packages.youtube.status === "pending" &&
      manifestAfterAssembly.packages.export.status === "pending",
      "manifest resets assembly and every downstream stage to pending");

    const assemblyReplay = await prepareCompletedStageRegeneration({ plan: assemblyPlan,
      backupId: assemblyBackup.backupId, reasonCode: "TRANSITION_QUALITY_REMEDIATION",
      confirmation: assemblyPlan.planFingerprint, context: g.context, backupAuthority: g.authority });
    check(assemblyReplay.status === "already-prepared" &&
      assemblyReplay.intent.regenerationId === assemblyPrepared.intent.regenerationId,
      "assembly-only prepare replay is idempotent");
    }

    const contextSlug = "owned-temp-context-isolation";
    const contextA = fixture("context-a", contextSlug); roots.push(contextA.root);
    const contextB = fixture("context-b", contextSlug); roots.push(contextB.root);
    const contextBJobs = JSON.parse(fs.readFileSync(
      path.join(contextB.projectRoot, "pipeline-jobs.json"), "utf8"));
    contextBJobs.jobs.find((job: { stage: string }) => job.stage === "audio").status = "queued";
    write(contextB.projectRoot, "pipeline-jobs.json", contextBJobs);
    const contextBBefore = treeDigest(contextB.projectRoot);
    const contextAManifestHash = sha256(fs.readFileSync(
      path.join(contextA.projectRoot, "manifest.json")));
    process.env.ATOLYE_RUNTIME_ROOT = contextB.context.runtimeRoot;
    process.env.ATOLYE_RUNTIME_AUTHORITY_ROOT = contextB.context.authorityRoot;
    process.env.ATOLYE_WORKSPACE_ROOT = contextB.context.workspaceRoot;
    const contextAPlan = await createCompletedStageRegenerationPlan({ projectSlug: contextSlug,
      fromStage: "video", context: contextA.context,
      runtimeAuthorityId: contextA.authority.runtimeAuthorityId });
    const contextABackup = createVerifiedRuntimeBackup({ authority: contextA.authority,
      projectSlug: contextSlug });
    const contextAPrepared = await prepareCompletedStageRegeneration({ plan: contextAPlan,
      backupId: contextABackup.backupId, reasonCode: "FRAMING_REMEDIATION",
      confirmation: contextAPlan.planFingerprint, context: contextA.context,
      backupAuthority: contextA.authority });
    check(contextAPlan.projectId === "project-context-a" &&
      contextAPlan.manifestFingerprint === contextAManifestHash &&
      contextAPrepared.status === "prepared" && treeDigest(contextB.projectRoot) === contextBBefore,
    "explicit context A exclusively plans, locks, and mutates A while ambient B would fail");

    const reverseSlug = "owned-temp-context-isolation-reverse";
    const reverseA = fixture("context-reverse-a", reverseSlug); roots.push(reverseA.root);
    const reverseB = fixture("context-reverse-b", reverseSlug); roots.push(reverseB.root);
    const reverseAJobs = JSON.parse(fs.readFileSync(
      path.join(reverseA.projectRoot, "pipeline-jobs.json"), "utf8"));
    reverseAJobs.jobs.find((job: { stage: string }) => job.stage === "audio").status = "failed";
    write(reverseA.projectRoot, "pipeline-jobs.json", reverseAJobs);
    process.env.ATOLYE_RUNTIME_ROOT = reverseA.context.runtimeRoot;
    process.env.ATOLYE_RUNTIME_AUTHORITY_ROOT = reverseA.context.authorityRoot;
    process.env.ATOLYE_WORKSPACE_ROOT = reverseA.context.workspaceRoot;
    const reverseBPlan = await createCompletedStageRegenerationPlan({ projectSlug: reverseSlug,
      fromStage: "video", context: reverseB.context,
      runtimeAuthorityId: reverseB.authority.runtimeAuthorityId });
    check(reverseBPlan.projectId === "project-context-reverse-b" &&
      reverseBPlan.jobsFingerprint === sha256(fs.readFileSync(
        path.join(reverseB.projectRoot, "pipeline-jobs.json"))),
    "explicit context B ignores ambient failing A with the same slug");

    const beforePlan = treeDigest(f.projectRoot);
    const p = await plan(f);
    check(treeDigest(f.projectRoot) === beforePlan, "planner write free");
    check(p.audioFiles.length === 7, "seven wav planned");
    check(/^[a-f0-9]{64}$/.test(p.planFingerprint), "plan fingerprint");
    check(p.currentGeneration === 0 && p.proposedGeneration === 1, "generation advance");
    check(p.durableQuiescent, "canonical quiescence");

    await assert.rejects(() => prepareCompletedStageRegeneration({ plan: p, backupId: "missing",
      reasonCode: "FRAMING_REMEDIATION", confirmation: p.planFingerprint, context: f.context,
      backupAuthority: f.authority }), ProductionRegenerationPreparationError);
    check(treeDigest(f.projectRoot) === beforePlan, "missing backup zero mutation");
    const backup = createVerifiedRuntimeBackup({ authority: f.authority, projectSlug: f.slug });
    const afterBackupPlan = await plan(f);
    if (afterBackupPlan.planFingerprint !== p.planFingerprint) {
      throw new Error(`plan drift ${p.planFingerprint} ${afterBackupPlan.planFingerprint} ${p.projectAggregateFingerprint} ${afterBackupPlan.projectAggregateFingerprint}`);
    }
    const audioBefore = fs.readFileSync(path.join(f.projectRoot, "audio.json"));
    const videoJsonBefore = fs.readFileSync(path.join(f.projectRoot, "video.json"));
    const wavBefore = Array.from({ length: 7 }, (_, index) =>
      sha256(fs.readFileSync(path.join(f.projectRoot, "assets", "audio", `audio-${index + 1}.wav`))));
    const videoBefore = Array.from({ length: 6 }, (_, index) =>
      sha256(fs.readFileSync(path.join(f.projectRoot, "assets", "videos", `scene-old-${index + 1}.mp4`))));
    const assemblyBefore = sha256(fs.readFileSync(path.join(f.projectRoot, "assets", "videos", "assembly-old.mp4")));
    const assetRegistryBefore = fs.readFileSync(path.join(f.projectRoot, "assets", "assets.json"));
    const result = await prepareCompletedStageRegeneration({ plan: p, backupId: backup.backupId,
      reasonCode: "FRAMING_REMEDIATION", confirmation: p.planFingerprint, context: f.context,
      backupAuthority: f.authority });
    check(result.status === "prepared", "prepared");
    check(result.intent.generationOrdinal === 1, "intent generation");
    check(result.intent.affectedStages.length === 6, "affected journal");
    check(fs.readFileSync(path.join(f.projectRoot, "audio.json")).equals(audioBefore), "audio json unchanged");
    check(wavBefore.every((hash, index) => hash === sha256(fs.readFileSync(
      path.join(f.projectRoot, "assets", "audio", `audio-${index + 1}.wav`)))), "wav unchanged");
    check(videoBefore.every((hash, index) => hash === sha256(fs.readFileSync(
      path.join(f.projectRoot, "assets", "videos", `scene-old-${index + 1}.mp4`)))), "old video unchanged");
    check(assemblyBefore === sha256(fs.readFileSync(
      path.join(f.projectRoot, "assets", "videos", "assembly-old.mp4"))), "old assembly unchanged");
    check(fs.readFileSync(path.join(f.projectRoot, "assets", "assets.json")).equals(assetRegistryBefore),
      "asset registry unchanged");
    check(await ProjectManager.getVideo(f.slug, f.context) === null, "old video noncanonical");
    check(await ProjectManager.getAssembly(f.slug, f.context) === null, "old assembly noncanonical");
    const jobs = JSON.parse(fs.readFileSync(path.join(f.projectRoot, "pipeline-jobs.json"), "utf8"));
    check(jobs.jobs.find((job: { stage: string }) => job.stage === "audio").status === "completed",
      "audio remains completed");
    check(jobs.jobs.find((job: { stage: string }) => job.stage === "video").attempts === 1,
      "video global ordinal advanced");
    check(jobs.jobs.find((job: { stage: string }) => job.stage === "assembly").attempts === 2,
      "assembly global ordinal advanced");
    check(jobs.jobs.filter((job: { stage: string; status: string }) =>
      closure.effectiveSequence.includes(job.stage as never) && job.status === "queued").length === 6,
      "affected jobs queued");
    const manifest = JSON.parse(fs.readFileSync(path.join(f.projectRoot, "manifest.json"), "utf8"));
    check(closure.effectiveSequence.every((stage) => manifest.packages[stage].status === "pending"),
      "affected manifest pending");
    check(closure.preservedStages.every((stage) => manifest.packages[stage].status === "completed"),
      "preserved manifest completed");
    check((await PipelineRecoveryPlanner.createResumePlan(f.slug)).startStage === "video",
      "post preparation recovery starts at video");
    check(fs.readFileSync(path.join(f.projectRoot, "production-regeneration", "regenerations",
      result.intent.regenerationId, "snapshots", "generation-0", "video.json")).equals(videoJsonBefore),
    "video snapshot exact");
    check(fs.existsSync(path.join(f.projectRoot, "production-regeneration", "regenerations",
      result.intent.regenerationId, "snapshots", "generation-0", "assembly.json")),
    "assembly snapshot exists");
    const replay = await prepareCompletedStageRegeneration({ plan: p, backupId: backup.backupId,
      reasonCode: "FRAMING_REMEDIATION", confirmation: p.planFingerprint, context: f.context,
      backupAuthority: f.authority });
    check(replay.status === "already-prepared", "idempotent replay");
    await assert.rejects(() => prepareCompletedStageRegeneration({ plan: p,
      backupId: backup.backupId, reasonCode: "ALTERED_REPLAY_REASON",
      confirmation: p.planFingerprint, context: f.context, backupAuthority: f.authority }),
    /PRODUCTION_REGENERATION_CONFLICT/);
    check(true, "already-prepared replay requires exact immutable request identity");
    const alternateReplayBackup = createVerifiedRuntimeBackup({ authority: f.authority,
      projectSlug: f.slug });
    await assert.rejects(() => prepareCompletedStageRegeneration({ plan: p,
      backupId: alternateReplayBackup.backupId, reasonCode: "FRAMING_REMEDIATION",
      confirmation: p.planFingerprint, context: f.context, backupAuthority: f.authority }));
    check(true, "already-prepared replay rejects a different backup identity");
    await assert.rejects(() => prepareCompletedStageRegeneration({ plan: p,
      backupId: "nonexistent-replay-backup", reasonCode: "FRAMING_REMEDIATION",
      confirmation: p.planFingerprint, context: f.context, backupAuthority: f.authority }));
    check(true, "already-prepared replay rejects a nonexistent backup identity");
    const oldIdentity = buildProductionPipelineExecutionIdentity(
      { projectSlug: f.slug, stage: "video", runType: "resume" },
      { id: `${f.slug}-video`, attempts: 0 });
    const binding = readActiveRegenerationBinding(f.slug, "video", f.context)!;
    const newIdentity = buildProductionPipelineExecutionIdentity(
      { projectSlug: f.slug, stage: "video", runType: "resume", regeneration: binding },
      { id: `${f.slug}-video`, attempts: 1 });
    check(oldIdentity.recordId !== newIdentity.recordId, "record identity distinct");
    check(oldIdentity.claimId !== newIdentity.claimId, "claim identity distinct");
    check(oldIdentity.leaseId !== newIdentity.leaseId, "lease identity distinct");
    check(oldIdentity.attemptId !== newIdentity.attemptId, "attempt identity distinct");
    check(oldIdentity.executionFingerprint !== newIdentity.executionFingerprint,
      "execution fingerprint distinct");
    check(newIdentity.core.generationOrdinal === 1, "identity generation bound");
    check(binding.reasonCode === "FRAMING_REMEDIATION", "reason authority bound");
    check(productionPipelineExecutionAuthorizationAction({ regeneration: binding }) ===
      "regenerate-stage", "regeneration authorization action distinct");
    check(productionPipelineExecutionAuthorizationAction({}) === "retry-stage",
      "legacy authorization action unchanged");
    const videoJob = jobs.jobs.find((job: { stage: string }) => job.stage === "video");
    check(requireRegenerationExecutionAdmission(f.slug, "video", videoJob, f.context)?.regenerationId ===
      binding.regenerationId, "video admission audio binding valid");
    const audioJob = jobs.jobs.find((job: { stage: string }) => job.stage === "audio");
    assert.throws(() => requireRegenerationExecutionAdmission(f.slug, "audio", audioJob, f.context),
      /PRODUCTION_REGENERATION_STAGE_OUTSIDE_ACTIVE_SCOPE/);
    check(true, "active regeneration fails closed outside affected stages");
    const firstWav = path.join(f.projectRoot, "assets", "audio", "audio-1.wav");
    const firstWavBytes = fs.readFileSync(firstWav);
    fs.writeFileSync(firstWav, "tampered");
    assert.throws(() => requireRegenerationExecutionAdmission(f.slug, "video", videoJob, f.context),
      /PRODUCTION_REGENERATION_AUDIO_BINDING_INVALID/);
    check(true, "audio drift blocks before provider admission");
    fs.writeFileSync(firstWav, firstWavBytes);
    check(requireRegenerationExecutionAdmission(f.slug, "video", videoJob, f.context) !== undefined,
      "audio restoration readmits");
    const runtimeOperation = createProductionRuntimeOperationContext({
      operationId: "sprint-129-41-durable-preparation",
      operationType: "pipeline-stage-execution",
      authorityGeneration: initialRuntimeAuthorityGeneration,
      storageContext: f.context,
    });
    await runWithProductionRuntimeOperationContext(runtimeOperation, async () => {
      const durable = await prepareProductionPipelineExecution({ projectSlug: f.slug,
        stage: "video", runType: "resume", regeneration: binding });
      const completed = readCompletedProductionPipelinePreparation(durable.authority);
      check(completed.canonicalIdentity.regeneration?.regenerationId === binding.regenerationId,
        "durable canonical identity regeneration bound");
      check(completed.record.action === "regenerate-stage", "durable action regeneration distinct");
      check(completed.record.operation === "pipeline.stage.resume", "durable operation remains resume");
      check(completed.record.attempt === 2, "durable global execution ordinal advanced");
      check(completed.record.maxAttempts === 4, "new generation receives independent retry allowance");
      const execution = new ProductionPipelineExecutionAdapter(
        durable.executionAdapter,
        () => durable.request,
        undefined,
        (workerResult) => settleFailedProductionPipelineExecution({
          ...durable.settlement,
          expectedProjectSlug: f.slug,
          expectedStage: "video",
          storageContext: f.context,
        }, workerResult),
      );
      await assert.rejects(() => execution.execute({ projectSlug: f.slug, stage: "video",
        runType: "resume", regeneration: binding }, async () => {
        throw new Error("owned-temp-regeneration-failure");
      }));
      check(true, "regeneration failure terminally settled");
      const classified = await classifyProductionDurableAttemptLineage(
        durable.adapter, f.slug, "video", 1, "exact");
      if (classified.status === "invalid") throw new Error(`classification:${classified.boundary}`);
      check(classified.status === "valid", "regeneration terminal lineage classified");
    });
    const failedJobs = JSON.parse(fs.readFileSync(path.join(f.projectRoot, "pipeline-jobs.json"),
      "utf8"));
    const failedVideoJob = failedJobs.jobs.find((job: { stage: string }) => job.stage === "video");
    failedVideoJob.status = "failed";
    failedVideoJob.error = "OWNED_TEMP_FAILURE";
    failedVideoJob.updatedAt = new Date().toISOString();
    failedVideoJob.completedAt = failedVideoJob.updatedAt;
    write(f.projectRoot, "pipeline-jobs.json", failedJobs);
    const generationRetry = await prepareFailedStageRetry(
      f.slug, `${f.slug}-video`, "retry", f.context);
    if (!generationRetry.success) throw new Error(`retry-failed:${generationRetry.reasonCode}`);
    check(generationRetry.success, "retry within generation admitted");
    check(generationRetry.job.attemptWithinGeneration === 1 && generationRetry.job.attempts === 2,
      "retry advances local and global ordinals");
    check(generationRetry.admission.maxAttempts === 4,
      "generation retry budget independent from historical ordinal");
    check(generationRetry.admission.admittedDurableLineageIdentity.core.generationOrdinal === 1,
      "retry identity remains generation bound");
    const retryRuntime = createProductionRuntimeOperationContext({
      operationId: "sprint-129-41-generation-retry",
      operationType: "pipeline-stage-execution",
      authorityGeneration: initialRuntimeAuthorityGeneration,
      storageContext: f.context,
    });
    const retryDurable = await withProductionAcceptanceRetryAdmission(
      generationRetry.admission, generationRetry.previousJob,
      () => runWithProductionRuntimeOperationContext(retryRuntime, () =>
        prepareProductionPipelineExecution({ projectSlug: f.slug, stage: "video",
          runType: "retry", regeneration: binding })),
    );
    const retryCompleted = readCompletedProductionPipelinePreparation(retryDurable.authority);
    check(retryCompleted.record.action === "regenerate-stage", "generation retry action bound");
    check(retryCompleted.record.operation === "pipeline.stage.retry", "generation retry run type normal");
    check(retryCompleted.record.attempt === 3 && retryCompleted.record.maxAttempts === 4,
      "generation retry durable budget exact");
    check(retryCompleted.canonicalIdentity.regeneration?.regenerationId === binding.regenerationId,
      "generation retry durable identity bound");
    const retryExecution = new ProductionPipelineExecutionAdapter(
      retryDurable.executionAdapter,
      () => retryDurable.request,
      undefined,
      (workerResult) => settleFailedProductionPipelineExecution({
        ...retryDurable.settlement,
        expectedProjectSlug: f.slug,
        expectedStage: "video",
        storageContext: f.context,
      }, workerResult),
    );
    await withProductionAcceptanceRetryAdmission(
      generationRetry.admission, generationRetry.previousJob,
      () => runWithProductionRuntimeOperationContext(retryRuntime, () => assert.rejects(
        () => retryExecution.execute({ projectSlug: f.slug, stage: "video", runType: "retry",
          regeneration: binding }, async () => { throw new Error("owned-temp-retry-failure"); }),
      )),
    );
    check(true, "generation retry durable preparation is terminally settled");

    process.env.AI_PROVIDER = "mock";
    process.env.VIDEO_PROVIDER = "ffmpeg";
    process.env.VIDEO_ASSEMBLY_PROVIDER = "ffmpeg";
    const runnerFixture = fixture("real-runner"); roots.push(runnerFixture.root);
    const runnerPlan = await plan(runnerFixture);
    const runnerBackup = createVerifiedRuntimeBackup({ authority: runnerFixture.authority,
      projectSlug: runnerFixture.slug });
    const runnerPrepared = await prepareCompletedStageRegeneration({ plan: runnerPlan,
      backupId: runnerBackup.backupId, reasonCode: "FRAMING_REMEDIATION",
      confirmation: runnerPlan.planFingerprint, context: runnerFixture.context,
      backupAuthority: runnerFixture.authority });
    republishCanonicalAudioFixture(runnerFixture);
    const runnerAudioBefore = fs.readFileSync(path.join(runnerFixture.projectRoot, "audio.json"));
    const runnerVideoBefore = Array.from({ length: 6 }, (_, index) => sha256(fs.readFileSync(
      path.join(runnerFixture.projectRoot, "assets", "videos", `scene-old-${index + 1}.mp4`))));
    const runnerAssemblyBefore = sha256(fs.readFileSync(path.join(runnerFixture.projectRoot,
      "assets", "videos", "assembly-old.mp4")));
    const fixtureVideo = new FixtureVideoProvider();
    const fixtureAssembly = new FixtureAssemblyProvider();
    const runnerParent = createProductionRuntimeOperationContext({
      operationId: "sprint-129-41-real-bounded-resume",
      operationType: "canonical-smoke-runtime",
      authorityGeneration: initialRuntimeAuthorityGeneration,
      storageContext: runnerFixture.context,
    });
    const runnerWorker = await readyWorker(runnerParent);
    const scopedExecution = configureScopedProductionPipelineExecution({
      lifecycle: runnerWorker, runtimeOperationContext: runnerParent,
    });
    const originalVideoProvider = VideoProviderRouter.getProvider;
    const originalAssemblyProvider = VideoAssemblyProviderRouter.getProvider;
    const originalAssemblyPlan = AssemblyManager.generateAssemblyPlan;
    VideoProviderRouter.getProvider = (() => fixtureVideo) as typeof originalVideoProvider;
    VideoAssemblyProviderRouter.getProvider = (() => fixtureAssembly) as typeof originalAssemblyProvider;
    AssemblyManager.generateAssemblyPlan = (async (_script, _scenes, _visuals, _audio,
      options) => {
      const currentVideo = options?.video;
      const videoAssetId = currentVideo?.scenes?.[0]?.videoAssetId;
      if (!videoAssetId) throw new Error("fixture video identity missing");
      return { projectId: `project-real-runner`, slug: runnerFixture.slug, status: "planned" as const,
        sourceVideoAssetId: videoAssetId, sourceAudioAssetId: "audio-old",
        scenes: [{ sceneId: 1, chapterId: 1, duration: "01:00", visualReference: "One",
          animationAssetId: "animation-1", videoAssetId, audioAssetId: "audio-1",
          audioReference: "One", transition: "fade", cameraMovement: "static", effects: [] }],
        totalDuration: "01:00", style: "documentary", render: { status: "planned" as const,
          format: "mp4" as const }, createdAt: new Date().toISOString() };
    }) as typeof originalAssemblyPlan;
    let videoObserved: Awaited<ReturnType<typeof observeBoundedResume>>;
    let assemblyObserved: Awaited<ReturnType<typeof observeBoundedResume>>;
    let postVideoStart: string | null | undefined;
    let assemblyInvalidatedAfterVideo = false;
    try {
      videoObserved = await observeBoundedResume(runnerFixture.slug, "video");
      check(videoObserved.result.success && videoObserved.result.stoppedAfterStage === "video" &&
        videoObserved.result.completedStages.join(",") === "video",
      "real scheduler completes bounded video regeneration");
      check(observedCount(videoObserved, "durable-entry", "video") === 1 &&
        observedCount(videoObserved, "capability-issuance-entered", "video") === 1 &&
        observedCount(videoObserved, "capability-consumed", "video") === 1 &&
        observedCount(videoObserved, "provider-dispatch-entered", "video", "videoProvider") === 1 &&
        fixtureVideo.calls.length === 1 &&
        observedCount(videoObserved, "capability-issuance-entered", "audio") === 0 &&
        observedCount(videoObserved, "capability-consumed", "audio") === 0 &&
        observedCount(videoObserved, "provider-dispatch-entered", "assembly") === 0 &&
        !videoObserved.events.some(({ event, detail }) =>
          (event === "durable-entry" && detail?.stage !== "video") ||
          (event === "capability-issuance-entered" && detail?.stage !== "video") ||
          (event === "capability-consumed" && detail?.stage !== "video") ||
          (event === "provider-dispatch-entered" && detail?.slot !== "videoProvider")),
      "video exact durable, capability, and configured provider cardinality");
      postVideoStart = (await PipelineRecoveryPlanner.createResumePlan(runnerFixture.slug)).startStage;
      assemblyInvalidatedAfterVideo = await ProjectManager.getAssembly(
        runnerFixture.slug, runnerFixture.context) === null;
      const preservedAudioAssets = JSON.parse(fs.readFileSync(
        path.join(runnerFixture.projectRoot, "assets", "assets.json"), "utf8",
      )).assets.filter((asset: { type?: string }) => asset.type === "audio");
      check(preservedAudioAssets.length === 7 && preservedAudioAssets.every(
        (asset: { id?: string; filePath?: string; byteLength?: number; durationSeconds?: number }) => {
          const inspection = AudioStorage.inspectStoredWav(
            runnerFixture.slug,
            asset.filePath as string,
            runnerFixture.context,
          );
          return inspection.byteLength === asset.byteLength &&
            Math.abs(inspection.durationSeconds - (asset.durationSeconds as number)) <= 1e-9;
        },
      ), "seven preserved audio assets remain descriptor-bound before assembly");
      assemblyObserved = await observeBoundedResume(runnerFixture.slug, "assembly");
      check(assemblyObserved.result.success && assemblyObserved.result.stoppedAfterStage === "assembly" &&
        assemblyObserved.result.completedStages.join(",") === "assembly",
      "real scheduler completes bounded assembly regeneration");
      check(observedCount(assemblyObserved, "durable-entry", "assembly") === 1 &&
        observedCount(assemblyObserved, "capability-issuance-entered", "assembly") === 1 &&
        observedCount(assemblyObserved, "capability-consumed", "assembly") === 1 &&
        observedCount(assemblyObserved, "provider-dispatch-entered", "assembly",
          "videoAssemblyProvider") === 1 && fixtureAssembly.calls.length === 1 &&
        observedCount(assemblyObserved, "capability-issuance-entered", "audio") === 0 &&
        observedCount(assemblyObserved, "capability-consumed", "audio") === 0 &&
        observedCount(assemblyObserved, "provider-dispatch-entered", "video") === 0 &&
        !assemblyObserved.events.some(({ event, detail }) =>
          (event === "durable-entry" && detail?.stage !== "assembly") ||
          (event === "capability-issuance-entered" && detail?.stage !== "assembly") ||
          (event === "capability-consumed" && detail?.stage !== "assembly") ||
          (event === "provider-dispatch-entered" && detail?.slot !== "videoAssemblyProvider")),
      "assembly exact durable, capability, and configured provider cardinality");
    } finally {
      VideoProviderRouter.getProvider = originalVideoProvider;
      VideoAssemblyProviderRouter.getProvider = originalAssemblyProvider;
      AssemblyManager.generateAssemblyPlan = originalAssemblyPlan;
      scopedExecution.restore();
      await runnerWorker.stop();
    }
    const regeneratedVideo = await ProjectManager.getVideo(
      runnerFixture.slug, runnerFixture.context) as VideoData | null;
    const regeneratedVideoId = regeneratedVideo?.scenes?.[0]?.videoAssetId;
    check(Boolean(regeneratedVideoId) && regeneratedVideoId !== "video-old-1",
      "new video asset identity differs from superseded generation");
    check(regeneratedVideo !== null, "new video canonical");
    check(postVideoStart === "assembly",
      "post video recovery starts at assembly");
    check(readCanonicalPackageBinding(runnerFixture.slug, "video", runnerFixture.context)?.generationOrdinal === 1,
      "video package binding");
    check(Boolean(regeneratedVideo?.scenes?.[0]?.filePath) && runnerVideoBefore.every((hash, index) => hash === sha256(
      fs.readFileSync(path.join(runnerFixture.projectRoot, "assets", "videos", `scene-old-${index + 1}.mp4`)))),
    "new no clobber video");
    check(assemblyInvalidatedAfterVideo, "assembly remains invalidated at video boundary");
    const regeneratedAssembly = await ProjectManager.getAssembly(
      runnerFixture.slug, runnerFixture.context) as AssemblyPlanData | null;
    check(regeneratedAssembly !== null, "new assembly canonical");
    const audioAfterVideo = fs.readFileSync(path.join(runnerFixture.projectRoot, "audio.json"));
    check(audioAfterVideo.equals(runnerAudioBefore), "video zero audio mutation");
    check((await PipelineRecoveryPlanner.createResumePlan(runnerFixture.slug)).startStage === "thumbnail",
      "post assembly recovery starts at thumbnail");
    check(readCanonicalPackageBinding(runnerFixture.slug, "assembly", runnerFixture.context)?.generationOrdinal === 1,
      "assembly package binding");
    check(fixtureAssembly.calls[0]?.scenes.length === 1 &&
      fixtureAssembly.calls[0]?.scenes[0]?.inputType === "scene-video" &&
      fixtureAssembly.calls[0]?.scenes[0]?.videoAssetId === regeneratedVideoId &&
      fixtureAssembly.calls[0]?.scenes[0]?.audioFilePath.endsWith("audio-1.wav") &&
      fixtureAssembly.calls[0]?.scenes[0]?.videoAssetId !== "video-old-1",
    "assembly consumes exact generation-1 scene-video identity");
    check(fixtureAssembly.calls[0].scenes.every((scene) => {
      const inspection = AudioStorage.inspectStoredWav(
        runnerFixture.slug, scene.audioFilePath, runnerFixture.context);
      return inspection.byteLength === wav().length && inspection.durationSeconds === 1;
    }), "assembly preserved audio paths pass canonical descriptor-bound inspection");
    check(regeneratedAssembly?.outputAssetId !== "assembly-old" &&
      regeneratedAssembly?.scenes[0]?.videoAssetId === regeneratedVideoId &&
      runnerAssemblyBefore === sha256(fs.readFileSync(path.join(runnerFixture.projectRoot,
        "assets", "videos", "assembly-old.mp4"))),
    "assembly output and source identities advance canonically");
    const videoSupersession = JSON.parse(fs.readFileSync(path.join(runnerFixture.projectRoot,
      "production-regeneration", "regenerations", runnerPrepared.intent.regenerationId,
      "supersession", "video-completed.json"), "utf8"));
    check(videoSupersession.state === "completed" &&
      videoSupersession.previousAssetIds.includes("video-old-1") &&
      videoSupersession.newAssetIds.includes(regeneratedVideoId),
    "video supersession preserves old and replacement asset continuity");
    const assemblySupersession = JSON.parse(fs.readFileSync(path.join(runnerFixture.projectRoot,
      "production-regeneration", "regenerations", runnerPrepared.intent.regenerationId,
      "supersession", "assembly-completed.json"), "utf8"));
    check(assemblySupersession.state === "completed" &&
      assemblySupersession.previousAssetIds.includes("assembly-old") &&
      assemblySupersession.newAssetIds.includes(regeneratedAssembly?.outputAssetId),
    "assembly supersession preserves exact old and replacement asset continuity");
    check(fs.readFileSync(path.join(runnerFixture.projectRoot, "audio.json")).equals(runnerAudioBefore),
      "assembly zero audio mutation");
    const afterAssemblyJobs = JSON.parse(fs.readFileSync(
      path.join(runnerFixture.projectRoot, "pipeline-jobs.json"), "utf8"));
    for (const downstream of ["thumbnail", "seo", "youtube", "export"]) {
      check(afterAssemblyJobs.jobs.find((job: { stage: string }) => job.stage === downstream).status ===
        "queued", `${downstream} queued`);
    }

    {
      // ── B extension E2E: assembly-only regeneration through real resume/execute ──
      process.env.AI_PROVIDER = "mock";
      process.env.VIDEO_PROVIDER = "ffmpeg";
      process.env.VIDEO_ASSEMBLY_PROVIDER = "ffmpeg";
      const aoFixture = fixture("real-runner");
      roots.push(aoFixture.root);
      process.env.ATOLYE_RUNTIME_ROOT = aoFixture.context.runtimeRoot;
      process.env.ATOLYE_RUNTIME_AUTHORITY_ROOT = aoFixture.context.authorityRoot;
      process.env.ATOLYE_WORKSPACE_ROOT = aoFixture.context.workspaceRoot;
      const aoPlan = await createCompletedStageRegenerationPlan({ projectSlug: aoFixture.slug,
        fromStage: "assembly", context: aoFixture.context,
        runtimeAuthorityId: aoFixture.authority.runtimeAuthorityId });
      const aoBackup = createVerifiedRuntimeBackup({ authority: aoFixture.authority,
        projectSlug: aoFixture.slug });
      const aoPrepared = await prepareCompletedStageRegeneration({ plan: aoPlan,
        backupId: aoBackup.backupId, reasonCode: "TRANSITION_QUALITY_REMEDIATION",
        confirmation: aoPlan.planFingerprint, context: aoFixture.context,
        backupAuthority: aoFixture.authority });
      republishCanonicalAudioFixture(aoFixture);
      const aoAudioBefore = fs.readFileSync(path.join(aoFixture.projectRoot, "audio.json"));
      const aoVideoJsonBefore = fs.readFileSync(path.join(aoFixture.projectRoot, "video.json"));
      const aoVideoAssetsBefore = Array.from({ length: 6 }, (_, index) => sha256(fs.readFileSync(
        path.join(aoFixture.projectRoot, "assets", "videos", `scene-old-${index + 1}.mp4`))));
      const aoAssemblyOldHash = sha256(fs.readFileSync(path.join(aoFixture.projectRoot,
        "assets", "videos", "assembly-old.mp4")));
      const aoVideosDirBefore = fs.readdirSync(path.join(aoFixture.projectRoot, "assets", "videos"));

      const aoFixtureAssembly = new FixtureAssemblyProvider();
      const aoParent = createProductionRuntimeOperationContext({
        operationId: "sprint-129-41-assembly-only-bounded-resume",
        operationType: "canonical-smoke-runtime",
        authorityGeneration: initialRuntimeAuthorityGeneration,
        storageContext: aoFixture.context,
      });
      const aoWorker = await readyWorker(aoParent);
      const aoScoped = configureScopedProductionPipelineExecution({
        lifecycle: aoWorker, runtimeOperationContext: aoParent,
      });
      const originalAoVideoProvider = VideoProviderRouter.getProvider;
      const originalAoAssemblyProvider = VideoAssemblyProviderRouter.getProvider;
      const originalAoAssemblyPlan = AssemblyManager.generateAssemblyPlan;
      VideoProviderRouter.getProvider = (() => {
        throw new Error("assembly-only regeneration must never dispatch the video provider");
      }) as typeof originalAoVideoProvider;
      VideoAssemblyProviderRouter.getProvider =
        (() => aoFixtureAssembly) as typeof originalAoAssemblyProvider;
      AssemblyManager.generateAssemblyPlan = (async (_script, _scenes, _visuals, _audio,
        options) => {
        const currentVideo = options?.video;
        const videoAssetId = currentVideo?.scenes?.[0]?.videoAssetId;
        if (!videoAssetId) throw new Error("fixture video identity missing");
        return { projectId: `project-real-runner`, slug: aoFixture.slug,
          status: "planned" as const, sourceVideoAssetId: videoAssetId,
          sourceAudioAssetId: "audio-old",
          scenes: [{ sceneId: 1, chapterId: 1, duration: "01:00", visualReference: "One",
            animationAssetId: "animation-1", videoAssetId, audioAssetId: "audio-1",
            audioReference: "One", transition: "fade", cameraMovement: "static", effects: [] }],
          totalDuration: "01:00", style: "documentary", render: { status: "planned" as const,
            format: "mp4" as const }, createdAt: new Date().toISOString() };
      }) as typeof originalAoAssemblyPlan;

      let aoObserved: Awaited<ReturnType<typeof observeBoundedResume>>;
      try {
        aoObserved = await observeBoundedResume(aoFixture.slug, "assembly");
        check(aoObserved.result.success && aoObserved.result.stoppedAfterStage === "assembly" &&
          aoObserved.result.completedStages.join(",") === "assembly",
        "assembly-only E2E: real scheduler resumes and completes assembly alone");
        check(observedCount(aoObserved, "durable-entry", "assembly") === 1 &&
          observedCount(aoObserved, "provider-dispatch-entered", "assembly",
            "videoAssemblyProvider") === 1 && aoFixtureAssembly.calls.length === 1 &&
          observedCount(aoObserved, "durable-entry", "video") === 0 &&
          observedCount(aoObserved, "capability-issuance-entered", "video") === 0 &&
          observedCount(aoObserved, "provider-dispatch-entered", "video") === 0 &&
          observedCount(aoObserved, "durable-entry", "audio") === 0 &&
          observedCount(aoObserved, "capability-issuance-entered", "audio") === 0,
        "assembly-only E2E: video and audio stages are never entered or dispatched");
      } finally {
        VideoProviderRouter.getProvider = originalAoVideoProvider;
        VideoAssemblyProviderRouter.getProvider = originalAoAssemblyProvider;
        AssemblyManager.generateAssemblyPlan = originalAoAssemblyPlan;
        aoScoped.restore();
        await aoWorker.stop();
      }

      // ── Assembly output actually regenerated (real render, real asset registry) ──
      const aoNewAssembly = await ProjectManager.getAssembly(
        aoFixture.slug, aoFixture.context) as AssemblyPlanData | null;
      check(aoNewAssembly !== null && aoNewAssembly.outputAssetId !== "assembly-old",
        "assembly-only E2E: a new assembly output asset id was produced");
      const aoVideosDirAfter = fs.readdirSync(path.join(aoFixture.projectRoot, "assets", "videos"));
      const aoNewPhysicalFiles = aoVideosDirAfter.filter((name) => !aoVideosDirBefore.includes(name));
      check(aoNewPhysicalFiles.length >= 1 && aoNewPhysicalFiles.every((name) =>
        fs.statSync(path.join(aoFixture.projectRoot, "assets", "videos", name)).size > 0),
        "assembly-only E2E: a new, non-empty physical assembly video file was written to disk");
      const aoRegistryAfter = JSON.parse(fs.readFileSync(
        path.join(aoFixture.projectRoot, "assets", "assets.json"), "utf8")) as
        { assets: Array<{ id?: string; type?: string }> };
      const aoNewAssetEntry = aoRegistryAfter.assets.find((asset) =>
        asset.id === aoNewAssembly?.outputAssetId);
      check(Boolean(aoNewAssetEntry) && aoNewAssetEntry?.type === "video",
        "assembly-only E2E: asset registry records the new assembly output");
      check(readCanonicalPackageBinding(aoFixture.slug, "assembly",
        aoFixture.context)?.generationOrdinal === aoPlan.proposedGeneration,
        "assembly-only E2E: assembly package binding advanced to the proposed generation");

      // ── Video preserved byte-for-byte, never regenerated ──
      const aoVideoAfter = await ProjectManager.getVideo(
        aoFixture.slug, aoFixture.context) as VideoData | null;
      check(aoVideoAfter?.scenes?.[0]?.videoAssetId === "video-old-1",
        "assembly-only E2E: video's canonical output asset id is unchanged");
      check(fs.readFileSync(path.join(aoFixture.projectRoot, "video.json")).equals(aoVideoJsonBefore),
        "assembly-only E2E: video.json byte-identical after real resume/execute");
      check(aoVideoAssetsBefore.every((hash, index) => hash === sha256(fs.readFileSync(
        path.join(aoFixture.projectRoot, "assets", "videos", `scene-old-${index + 1}.mp4`)))),
        "assembly-only E2E: every scene video asset byte-identical after real resume/execute");
      check(aoNewAssembly?.sourceVideoAssetId === "video-old-1",
        "assembly-only E2E: regenerated assembly still references the preserved (untouched) video");

      // ── Audio preserved byte-for-byte, never regenerated ──
      check(fs.readFileSync(path.join(aoFixture.projectRoot, "audio.json")).equals(aoAudioBefore),
        "assembly-only E2E: audio.json byte-identical after real resume/execute");
      const aoAudioAssetsIntact = Array.from({ length: 7 }, (_, index) =>
        fs.readFileSync(path.join(aoFixture.projectRoot, "assets", "audio", `audio-${index + 1}.wav`)));
      check(aoAudioAssetsIntact.every((buffer) => buffer.length === wav().length),
        "assembly-only E2E: every audio asset remains present and correctly sized");

      // ── No video supersession; assembly supersession recorded ──
      const aoRegenDir = path.join(aoFixture.projectRoot, "production-regeneration", "regenerations",
        aoPrepared.intent.regenerationId);
      check(!fs.existsSync(path.join(aoRegenDir, "supersession", "video-intended.json")) &&
        !fs.existsSync(path.join(aoRegenDir, "supersession", "video-completed.json")),
        "assembly-only E2E: no video supersession record exists, before or after execution");
      const aoAssemblySupersession = JSON.parse(fs.readFileSync(
        path.join(aoRegenDir, "supersession", "assembly-completed.json"), "utf8"));
      check(aoAssemblySupersession.state === "completed" &&
        aoAssemblySupersession.previousAssetIds.includes("assembly-old") &&
        aoAssemblySupersession.newAssetIds.includes(aoNewAssembly?.outputAssetId),
        "assembly-only E2E: assembly supersession preserves old and replacement asset continuity");
      check(sha256(fs.readFileSync(path.join(aoFixture.projectRoot, "assets", "videos",
        "assembly-old.mp4"))) === aoAssemblyOldHash,
        "assembly-only E2E: superseded assembly-old.mp4 retained byte-for-byte (append-only)");

      // ── Manifest / downstream state ──
      const aoManifestAfter = JSON.parse(fs.readFileSync(
        path.join(aoFixture.projectRoot, "manifest.json"), "utf8"));
      check(aoManifestAfter.packages.video.status === "completed" &&
        aoManifestAfter.packages.audio.status === "completed",
        "assembly-only E2E: manifest keeps video and audio completed after real execution");
      check(aoManifestAfter.packages.assembly.status === "completed",
        "assembly-only E2E: manifest marks assembly completed after real execution");
      for (const downstream of ["thumbnail", "seo", "youtube", "export"]) {
        check(aoManifestAfter.packages[downstream].status === "pending",
          `assembly-only E2E: ${downstream} remains pending after assembly-only execution`);
      }
      check((await PipelineRecoveryPlanner.createResumePlan(aoFixture.slug)).startStage === "thumbnail",
        "assembly-only E2E: next recovery stage is thumbnail");

      // ── Idempotency / generation rules still hold after real execution ──
      const aoReplay = await prepareCompletedStageRegeneration({ plan: aoPlan,
        backupId: aoBackup.backupId, reasonCode: "TRANSITION_QUALITY_REMEDIATION",
        confirmation: aoPlan.planFingerprint, context: aoFixture.context,
        backupAuthority: aoFixture.authority });
      check(aoReplay.status === "already-prepared" &&
        aoReplay.intent.regenerationId === aoPrepared.intent.regenerationId,
        "assembly-only E2E: prepare replay after real execution remains idempotent");
    }

    const crash = fixture("crash"); roots.push(crash.root);
    const crashPlan = await plan(crash);
    const crashBackup = createVerifiedRuntimeBackup({ authority: crash.authority,
      projectSlug: crash.slug });
    await assert.rejects(() => prepareCompletedStageRegeneration({ plan: crashPlan,
      backupId: crashBackup.backupId, reasonCode: "FRAMING_REMEDIATION",
      confirmation: crashPlan.planFingerprint, context: crash.context,
      backupAuthority: crash.authority, hooks: { afterMutation: (_path, index) => {
        if (index === 1) throw new Error("injected-crash");
      } } }));
    check(fs.existsSync(path.join(crash.projectRoot, "production-regeneration")), "intent before crash");
    const recovered = await prepareCompletedStageRegeneration({ plan: crashPlan,
      backupId: crashBackup.backupId, reasonCode: "FRAMING_REMEDIATION",
      confirmation: crashPlan.planFingerprint, context: crash.context,
      backupAuthority: crash.authority });
    check(recovered.status === "prepared", "crash replay recovered");
    check(await ProjectManager.getVideo(crash.slug, crash.context) === null, "recovered canonical gate");

    const assetDrift = fixture("asset-drift"); roots.push(assetDrift.root);
    const assetDriftPlan = await plan(assetDrift);
    const assetDriftBackup = createVerifiedRuntimeBackup({ authority: assetDrift.authority,
      projectSlug: assetDrift.slug });
    const assetDriftPrepared = await prepareCompletedStageRegeneration({ plan: assetDriftPlan,
      backupId: assetDriftBackup.backupId, reasonCode: "FRAMING_REMEDIATION",
      confirmation: assetDriftPlan.planFingerprint, context: assetDrift.context,
      backupAuthority: assetDrift.authority });
    const intendedPath = path.join(assetDrift.projectRoot, "production-regeneration",
      "regenerations", assetDriftPrepared.intent.regenerationId, "supersession",
      "video-intended.json");
    const driftedIntent = JSON.parse(fs.readFileSync(intendedPath, "utf8"));
    driftedIntent.previousAssetIds = ["drifted-old-video"];
    write(path.dirname(intendedPath), path.basename(intendedPath), driftedIntent);
    write(assetDrift.projectRoot, "video.json", { projectId: "project-asset-drift",
      schemaVersion: "2", artifactType: "scene-video", provider: "mock", status: "generated",
      createdAt: at, scenes: [{ sceneId: 1, sourceAnimationAssetId: "animation-1",
        sourceImageAssetId: "image-1", animationAssetId: "animation-1",
        outputAssetId: "new-drift-video", videoAssetId: "new-drift-video", provider: "mock",
        status: "generated", durationSeconds: 60, filePath: "", url: "",
        mimeType: "video/mock", byteLength: 0, width: 0, height: 0, frameRate: 30,
        transition: "fade", generationMode: "mock", artifactType: "scene-video" }] });
    assert.throws(() => recordRegeneratedPackageCompletion(assetDrift.slug, "video",
      path.join(assetDrift.projectRoot, "video.json"), assetDrift.context),
    /PRODUCTION_REGENERATION_SUPERSESSION_INVALID/);
    check(!fs.existsSync(path.join(assetDrift.projectRoot, "production-regeneration",
      "regenerations", assetDriftPrepared.intent.regenerationId, "package-bindings", "video.json")),
    "supersession asset drift fails before canonical completion evidence");

    await assertSupersessionPrecommitRejection(roots, "missing-video-intent", "video",
      ({ intendedPath }) => fs.unlinkSync(intendedPath));
    await assertSupersessionPrecommitRejection(roots, "corrupt-video-intent", "video",
      ({ intendedPath }) => fs.writeFileSync(intendedPath, "{"));
    await assertSupersessionPrecommitRejection(roots, "missing-video-predecessor", "video",
      ({ fixture: value }) => fs.unlinkSync(path.join(
        value.projectRoot, "assets", "videos", "scene-old-1.mp4")));
    await assertSupersessionPrecommitRejection(roots, "wrong-video-generation", "video",
      ({ intendedPath }) => {
        const intended = JSON.parse(fs.readFileSync(intendedPath, "utf8"));
        intended.generationOrdinal += 1;
        write(path.dirname(intendedPath), path.basename(intendedPath), intended);
      });
    await assertSupersessionPrecommitRejection(roots, "video-asset-set-drift", "video",
      ({ intendedPath }) => {
        const intended = JSON.parse(fs.readFileSync(intendedPath, "utf8"));
        intended.previousAssetIds = ["foreign-video"];
        write(path.dirname(intendedPath), path.basename(intendedPath), intended);
      });
    await assertSupersessionPrecommitRejection(roots, "missing-assembly-intent", "assembly",
      ({ intendedPath }) => fs.unlinkSync(intendedPath));
    await assertSupersessionPrecommitRejection(roots, "corrupt-assembly-intent", "assembly",
      ({ intendedPath }) => fs.writeFileSync(intendedPath, "{"));
    await assertSupersessionPrecommitRejection(roots, "missing-assembly-predecessor", "assembly",
      ({ fixture: value }) => fs.unlinkSync(path.join(
        value.projectRoot, "assets", "videos", "assembly-old.mp4")));
    await assertSupersessionPrecommitRejection(roots, "wrong-assembly-generation", "assembly",
      ({ intendedPath }) => {
        const intended = JSON.parse(fs.readFileSync(intendedPath, "utf8"));
        intended.previousGenerationOrdinal += 1;
        write(path.dirname(intendedPath), path.basename(intendedPath), intended);
      });

    for (const boundary of ["after-intent", "mutation-0", "mutation-2", "mutation-3",
      "mutation-4", "mutation-5", "before-prepared"] as const) {
      const boundaryFixture = fixture(boundary); roots.push(boundaryFixture.root);
      const boundaryPlan = await plan(boundaryFixture);
      const boundaryBackup = createVerifiedRuntimeBackup({ authority: boundaryFixture.authority,
        projectSlug: boundaryFixture.slug });
      const hooks = boundary === "after-intent"
        ? { afterIntent: () => { throw new Error("injected-crash"); } }
        : boundary === "before-prepared"
          ? { beforePreparedReceipt: () => { throw new Error("injected-crash"); } }
          : { afterMutation: (_relativePath: string, index: number) => {
            if (index === Number(boundary.slice("mutation-".length))) {
              throw new Error("injected-crash");
            }
          } };
      await assert.rejects(() => prepareCompletedStageRegeneration({ plan: boundaryPlan,
        backupId: boundaryBackup.backupId, reasonCode: "FRAMING_REMEDIATION",
        confirmation: boundaryPlan.planFingerprint, context: boundaryFixture.context,
        backupAuthority: boundaryFixture.authority, hooks }));
      const boundaryRecovery = await prepareCompletedStageRegeneration({ plan: boundaryPlan,
        backupId: boundaryBackup.backupId, reasonCode: "FRAMING_REMEDIATION",
        confirmation: boundaryPlan.planFingerprint, context: boundaryFixture.context,
        backupAuthority: boundaryFixture.authority });
      check(boundaryRecovery.status === "prepared", `recovered ${boundary}`);
    }

    const conflict = fixture("conflict"); roots.push(conflict.root);
    const conflictPlan = await plan(conflict);
    const conflictBackup = createVerifiedRuntimeBackup({ authority: conflict.authority,
      projectSlug: conflict.slug });
    await assert.rejects(() => prepareCompletedStageRegeneration({ plan: conflictPlan,
      backupId: conflictBackup.backupId, reasonCode: "FRAMING_REMEDIATION",
      confirmation: "0".repeat(64), context: conflict.context,
      backupAuthority: conflict.authority }), ProductionRegenerationPreparationError);
    check(!fs.existsSync(path.join(conflict.projectRoot, "production-regeneration")),
      "invalid confirmation zero mutation");

    const stalePlanFixture = fixture("stale-plan"); roots.push(stalePlanFixture.root);
    const stalePlan = await plan(stalePlanFixture);
    const stalePlanBackup = createVerifiedRuntimeBackup({ authority: stalePlanFixture.authority,
      projectSlug: stalePlanFixture.slug });
    write(stalePlanFixture.projectRoot, "production-acceptance.json", { schemaVersion: "3",
      configurationFingerprint: "config-drift", componentFingerprints: { renderer: "renderer-a" },
      acceptanceStatus: "validated", productionReady: false });
    await assert.rejects(() => prepareCompletedStageRegeneration({ plan: stalePlan,
      backupId: stalePlanBackup.backupId, reasonCode: "FRAMING_REMEDIATION",
      confirmation: stalePlan.planFingerprint, context: stalePlanFixture.context,
      backupAuthority: stalePlanFixture.authority }), (error: unknown) =>
      error instanceof ProductionRegenerationPreparationError &&
      error.code === "PRODUCTION_REGENERATION_PLAN_STALE");
    check(!fs.existsSync(path.join(stalePlanFixture.projectRoot, "production-regeneration")),
      "stale plan zero mutation");

    const staleBackupFixture = fixture("stale-backup"); roots.push(staleBackupFixture.root);
    await plan(staleBackupFixture);
    const staleBackup = createVerifiedRuntimeBackup({ authority: staleBackupFixture.authority,
      projectSlug: staleBackupFixture.slug });
    write(staleBackupFixture.projectRoot, "research.json", { stage: "research", changed: true });
    const freshPlan = await plan(staleBackupFixture);
    await assert.rejects(() => prepareCompletedStageRegeneration({ plan: freshPlan,
      backupId: staleBackup.backupId, reasonCode: "FRAMING_REMEDIATION",
      confirmation: freshPlan.planFingerprint, context: staleBackupFixture.context,
      backupAuthority: staleBackupFixture.authority }), (error: unknown) =>
      error instanceof ProductionRegenerationPreparationError &&
      error.code === "PRODUCTION_REGENERATION_BACKUP_STALE");
    check(!fs.existsSync(path.join(staleBackupFixture.projectRoot, "production-regeneration")),
      "stale backup zero mutation");

    const foreignA = fixture("foreign-a"); roots.push(foreignA.root);
    const foreignPlan = await plan(foreignA);
    const foreignB = fixture("foreign-b"); roots.push(foreignB.root);
    const foreignBackup = createVerifiedRuntimeBackup({ authority: foreignB.authority,
      projectSlug: foreignB.slug });
    await plan(foreignA);
    await assert.rejects(() => prepareCompletedStageRegeneration({ plan: foreignPlan,
      backupId: foreignBackup.backupId, reasonCode: "FRAMING_REMEDIATION",
      confirmation: foreignPlan.planFingerprint, context: foreignA.context,
      backupAuthority: foreignA.authority }), (error: unknown) =>
      error instanceof ProductionRegenerationPreparationError &&
      error.code === "PRODUCTION_REGENERATION_BACKUP_INVALID");
    check(!fs.existsSync(path.join(foreignA.projectRoot, "production-regeneration")),
      "foreign backup zero mutation");

    const running = fixture("running"); roots.push(running.root);
    const runningJobsPath = path.join(running.projectRoot, "pipeline-jobs.json");
    const runningJobs = JSON.parse(fs.readFileSync(runningJobsPath, "utf8"));
    runningJobs.jobs.find((job: { stage: string }) => job.stage === "video").status = "running";
    write(running.projectRoot, "pipeline-jobs.json", runningJobs);
    await assert.rejects(() => plan(running), /PRODUCTION_REGENERATION_DEPENDENCY_INVALID/);
    check(true, "non-completed source job rejected canonically");

    const duplicate = fixture("duplicate-job"); roots.push(duplicate.root);
    const duplicateJobs = JSON.parse(fs.readFileSync(path.join(duplicate.projectRoot,
      "pipeline-jobs.json"), "utf8"));
    duplicateJobs.jobs.push({ ...duplicateJobs.jobs.find((job: { stage: string }) =>
      job.stage === "audio"), id: `${duplicate.slug}-audio-duplicate` });
    write(duplicate.projectRoot, "pipeline-jobs.json", duplicateJobs);
    await assert.rejects(() => plan(duplicate), /PRODUCTION_REGENERATION_DEPENDENCY_INVALID/);
    check(true, "preserved stage requires exactly one canonical completed job");

    const queuedAudio = fixture("queued-audio"); roots.push(queuedAudio.root);
    const queuedAudioJobs = JSON.parse(fs.readFileSync(path.join(queuedAudio.projectRoot,
      "pipeline-jobs.json"), "utf8"));
    queuedAudioJobs.jobs.find((job: { stage: string }) => job.stage === "audio").status = "queued";
    write(queuedAudio.projectRoot, "pipeline-jobs.json", queuedAudioJobs);
    await assert.rejects(() => plan(queuedAudio), /PRODUCTION_REGENERATION_DEPENDENCY_INVALID/);
    check(true, "completed audio package with queued audio job is rejected");

    const corrupt = fixture("corrupt-durable"); roots.push(corrupt.root);
    write(corrupt.projectRoot, "production-execution/idempotency/corrupt-v1.json", { broken: true });
    await assert.rejects(() => plan(corrupt), /PRODUCTION_REGENERATION_NOT_QUIESCENT/);
    check(true, "corrupt durable sibling rejected");

    const published = fixture("published"); roots.push(published.root);
    write(published.projectRoot, "youtube-publish.json", publishRecord(published));
    await assert.rejects(() => plan(published), /PRODUCTION_REGENERATION_EXTERNAL_SIDE_EFFECT/);
    check(true, "canonical primary publication record rejected");

    const publishing = fixture("publishing"); roots.push(publishing.root);
    write(publishing.projectRoot, "youtube-publish.json", publishRecord(publishing, "publishing"));
    await assert.rejects(() => plan(publishing), /PRODUCTION_REGENERATION_EXTERNAL_SIDE_EFFECT/);
    check(true, "canonical primary in-flight publication rejected");

    const malformedPrimary = fixture("primary-malformed"); roots.push(malformedPrimary.root);
    fs.writeFileSync(path.join(malformedPrimary.projectRoot, "youtube-publish.json"), "{");
    await assert.rejects(() => plan(malformedPrimary),
      /PRODUCTION_REGENERATION_EXTERNAL_SIDE_EFFECT/);
    check(true, "malformed primary publication state fails closed");

    const recoveryPublished = fixture("recovery-published"); roots.push(recoveryPublished.root);
    write(recoveryPublished.projectRoot, "youtube-publish-recovery.json",
      publishRecord(recoveryPublished));
    await assert.rejects(() => plan(recoveryPublished),
      /PRODUCTION_REGENERATION_EXTERNAL_SIDE_EFFECT/);
    check(true, "canonical recovery publication record rejected");

    const malformedRecovery = fixture("recovery-malformed"); roots.push(malformedRecovery.root);
    fs.writeFileSync(path.join(malformedRecovery.projectRoot, "youtube-publish-recovery.json"), "{");
    await assert.rejects(() => plan(malformedRecovery),
      /PRODUCTION_REGENERATION_EXTERNAL_SIDE_EFFECT/);
    check(true, "malformed recovery publication state fails closed");

    const publicationConflict = fixture("publication-conflict"); roots.push(publicationConflict.root);
    write(publicationConflict.projectRoot, "youtube-publish.json",
      publishRecord(publicationConflict, "publishing"));
    write(publicationConflict.projectRoot, "youtube-publish-recovery.json",
      publishRecord(publicationConflict, "published"));
    await assert.rejects(() => plan(publicationConflict),
      /PRODUCTION_REGENERATION_EXTERNAL_SIDE_EFFECT/);
    check(true, "conflicting canonical primary and recovery publication evidence fails closed");

    const missingAudio = fixture("missing-audio"); roots.push(missingAudio.root);
    fs.unlinkSync(path.join(missingAudio.projectRoot, "assets", "audio", "audio-7.wav"));
    await assert.rejects(() => plan(missingAudio), /PRODUCTION_REGENERATION_AUDIO_INVALID/);
    check(true, "audio count mismatch rejected");

    const race = fixture("race"); roots.push(race.root);
    const racePlan = await plan(race);
    const raceBackup = createVerifiedRuntimeBackup({ authority: race.authority,
      projectSlug: race.slug });
    const raceInput = { plan: racePlan, backupId: raceBackup.backupId,
      reasonCode: "FRAMING_REMEDIATION", confirmation: racePlan.planFingerprint,
      context: race.context, backupAuthority: race.authority } as const;
    const raceResults = await Promise.allSettled([
      prepareCompletedStageRegeneration(raceInput),
      prepareCompletedStageRegeneration(raceInput),
    ]);
    check(raceResults.filter((item) => item.status === "fulfilled").length === 1,
      "concurrent preparation one winner");

    await assert.rejects(() => prepareCompletedStageRegeneration({ ...raceInput,
      reasonCode: "ALTERNATE_REMEDIATION" }));
    check(true, "conflicting regeneration rejected");

    const processRace = fixture("process-race"); roots.push(processRace.root);
    const processPlan = await plan(processRace);
    const processBackup = createVerifiedRuntimeBackup({ authority: processRace.authority,
      projectSlug: processRace.slug });
    const processInputPath = path.join(processRace.root, "same-request.json");
    write(processRace.root, "same-request.json", { workspaceRoot: processRace.context.workspaceRoot,
      runtimeRoot: processRace.context.runtimeRoot, authorityRoot: processRace.context.authorityRoot,
      backupRoot: processRace.authority.canonicalBackupRoot, plan: processPlan,
      backupId: processBackup.backupId, reasonCode: "FRAMING_REMEDIATION" });
    const processResults = await Promise.all([
      spawnPreparationWorker(processInputPath), spawnPreparationWorker(processInputPath),
    ]);
    const processRegenerationRoot = path.join(processRace.projectRoot, "production-regeneration",
      "regenerations");
    const processRegenerations = fs.readdirSync(processRegenerationRoot);
    check(processResults.filter(({ status }) => status === "prepared").length === 1 &&
      processResults.filter(({ status }) => status === "already-prepared").length === 1,
    "two-process identical preparation has one mutation owner and one exact replay");

    const processConflict = fixture("process-conflict"); roots.push(processConflict.root);
    const processConflictPlan = await plan(processConflict);
    const processConflictBackup = createVerifiedRuntimeBackup({ authority: processConflict.authority,
      projectSlug: processConflict.slug });
    const processConflictBase = { workspaceRoot: processConflict.context.workspaceRoot,
      runtimeRoot: processConflict.context.runtimeRoot,
      authorityRoot: processConflict.context.authorityRoot,
      backupRoot: processConflict.authority.canonicalBackupRoot, plan: processConflictPlan,
      backupId: processConflictBackup.backupId };
    const firstPath = path.join(processConflict.root, "first-request.json");
    const secondPath = path.join(processConflict.root, "second-request.json");
    write(processConflict.root, "first-request.json", { ...processConflictBase,
      reasonCode: "FRAMING_REMEDIATION" });
    write(processConflict.root, "second-request.json", { ...processConflictBase,
      reasonCode: "ALTERNATE_REMEDIATION" });
    const conflictResults = await Promise.all([
      spawnPreparationWorker(firstPath), spawnPreparationWorker(secondPath),
    ]);
    const conflictRegenerationRoot = path.join(processConflict.projectRoot,
      "production-regeneration", "regenerations");
    check(processRegenerations.length === 1 && fs.existsSync(path.join(processRegenerationRoot,
      processRegenerations[0], "snapshots", "generation-0", "video.json")) &&
      fs.existsSync(path.join(processRegenerationRoot, processRegenerations[0], "supersession",
        "video-intended.json")),
    "two-process identical preparation creates one generation snapshot and supersession intent");
    check(conflictResults.filter(({ status }) => status === "prepared").length === 1 &&
      conflictResults.filter(({ status, code }) => status === "rejected" &&
        code === "PRODUCTION_REGENERATION_CONFLICT").length === 1 &&
      fs.readdirSync(conflictRegenerationRoot).length === 1,
    "two-process conflicting preparation has one winner and fail-closed loser");

    assert.equal(passed, 181, `expected 181 scenarios, received ${passed}`);
    process.stdout.write(`Sprint 129.41 completed-stage regeneration smoke: PASS (${passed}/181)\n`);
  } finally {
    delete process.env.ATOLYE_RUNTIME_ROOT;
    delete process.env.ATOLYE_RUNTIME_AUTHORITY_ROOT;
    delete process.env.ATOLYE_WORKSPACE_ROOT;
    for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
  }
}

if (process.argv[2] === "prepare-worker") {
  void preparationWorker(process.argv[3]).catch((error) => {
    process.stderr.write(error instanceof Error ? error.message : "worker failed");
    process.exitCode = 1;
  });
} else {
  void main();
}
