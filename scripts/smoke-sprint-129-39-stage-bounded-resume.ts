import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { PipelineJobManager } from "../src/lib/pipeline/PipelineJobManager";
import {
  PipelineRecoveryPlanner,
  pipelineRecoveryStageOrder,
} from "../src/lib/pipeline/PipelineRecoveryPlanner";
import {
  PipelineRunner,
  pipelineResumeBoundaryInvalidCode,
} from "../src/lib/pipeline/PipelineRunner";
import { ProjectManager } from "../src/lib/projects/ProjectManager";
import { ProjectReader } from "../src/lib/projects/ProjectReader";
import { ProductionExecutionFilePersistenceAdapter } from
  "../src/lib/production/ProductionExecutionPersistence";
import { readProductionExecutionRecoverySemanticAuthority } from
  "../src/lib/production/ProductionExecutionRecoveryBootstrap";
import {
  runProductionAcceptanceCommand,
  type ProductionAcceptanceCommandDependencies,
} from "../src/lib/production/ProductionAcceptanceCommand";
import type {
  ProductionAcceptanceBoundedResumeResult,
  ProductionAcceptanceResult,
} from "../src/lib/production/ProductionAcceptanceOrchestrator";
import type { ProductionAcceptanceStageExecutionIdentity } from
  "../src/lib/production/ProductionAcceptancePolicy";
import type { ProductionReadinessReport } from "../src/types/productionReadiness";
import type { ProductionStepKey, ProjectPackageRunType } from "../src/types/project";
import type { PipelineJobList } from "../src/types/pipelineJob";
import { AIRouter } from "../src/lib/ai/router/AIRouter";
import type { ConfiguredAIProvider } from "../src/lib/ai/providers/AIProvider";
import { VideoAssemblyProviderRouter } from
  "../src/lib/assembly/providers/VideoAssemblyProviderRouter";
import type { ConfiguredVideoAssemblyProvider } from
  "../src/lib/assembly/providers/VideoAssemblyProvider";
import { ThumbnailProviderRouter } from "../src/lib/thumbnail/ThumbnailProviderRouter";
import { MockThumbnailProvider } from
  "../src/lib/thumbnail/providers/MockThumbnailProvider";
import type { ConfiguredThumbnailProvider } from
  "../src/lib/thumbnail/providers/ThumbnailProvider";
import { YouTubePublishProviderRouter } from
  "../src/lib/youtube/publish/YouTubePublishProviderRouter";
import { MockYouTubePublishProvider } from
  "../src/lib/youtube/publish/providers/MockYouTubePublishProvider";
import { createProviderDispatchAdapter } from
  "../src/lib/providers/ProviderDispatchAdapterAuthority";
import {
  runWithProductionPipelineExecutionInstrumentation,
  type ProductionPipelineExecutionEvent,
  type ProductionPipelineExecutionEventDetail,
} from "../src/lib/production/ProductionPipelineExecutionInstrumentation";
import { withCanonicalSmokeRuntime } from "./lib/CanonicalSmokeRuntime";

const now = "2026-08-08T18:00:00.000Z";
let scenarios = 0;

class FixtureAIProvider implements ConfiguredAIProvider {
  readonly calls: Array<"assembly" | "seo"> = [];

  createImmutableAiDispatchAdapter() {
    return createProviderDispatchAdapter(this, {
      metadata: { name: "fixture" },
      requiredMethods: ["generate"],
    });
  }

  async generate(prompt: string) {
    if (prompt.includes("professional documentary video editor")) {
      this.calls.push("assembly");
      return JSON.stringify({
        scenes: [{ sceneId: 1, chapterId: 1, duration: "01:00",
          visualReference: "visual-1", audioReference: "section-1",
          transition: "cut", cameraMovement: "slow", effects: [], notes: "One" }],
        totalDuration: "01:00", style: "documentary",
        render: { status: "planned", format: "mp4" }, createdAt: now,
      });
    }
    if (prompt.includes("YouTube SEO strategist")) {
      this.calls.push("seo");
      return JSON.stringify({ titleSuggestions: ["Bounded resume"],
        description: "Bounded resume documentary.", tags: ["bounded"],
        hashtags: ["#bounded"], keywords: ["bounded resume"],
        targetAudience: "all", searchIntent: "Learn bounded resume.", createdAt: now });
    }
    throw new Error("Unexpected fixture AI operation.");
  }
}

import fsSync from "node:fs";
import { VideoStorage } from "../src/lib/assets/storage/VideoStorage";

function deterministicFixtureMp4(durationSeconds: number) {
  const box = (type: string, body: Buffer) => {
    const output = Buffer.alloc(body.length + 8);
    output.writeUInt32BE(output.length, 0); output.write(type, 4, 4, "ascii"); body.copy(output, 8);
    return output;
  };
  const track = (handler: "vide" | "soun") => {
    const value = Buffer.alloc(12); value.write(handler, 8, 4, "ascii");
    return box("trak", box("mdia", box("hdlr", value)));
  };
  const movieHeader = Buffer.alloc(20); movieHeader.writeUInt32BE(1_000, 12);
  movieHeader.writeUInt32BE(Math.max(1, Math.round(durationSeconds * 1_000)), 16);
  return Buffer.concat([box("ftyp", Buffer.from("isom0000")),
    box("moov", Buffer.concat([box("mvhd", movieHeader), track("vide"), track("soun")])),
    box("mdat", Buffer.from([1]))]);
}

class FixtureAssemblyProvider implements ConfiguredVideoAssemblyProvider {
  readonly name = "ffmpeg" as const;
  readonly calls = new Map<string, number>();

  createImmutableAssemblyDispatchAdapter() {
    return createProviderDispatchAdapter(this, {
      metadata: { name: this.name },
      requiredMethods: ["assemble"],
    });
  }

  async assemble(input: Parameters<ConfiguredVideoAssemblyProvider["assemble"]>[0]) {
    this.calls.set(input.projectSlug, (this.calls.get(input.projectSlug) ?? 0) + 1);
    if (input.projectSlug.endsWith("-failure")) {
      throw new Error("bounded assembly fixture failure");
    }
    const paths = VideoStorage.createRenderPaths(input.projectSlug);
    const data = deterministicFixtureMp4(60);
    fsSync.writeFileSync(paths.temporaryAbsolutePath, data);
    VideoStorage.finalize(paths.temporaryAbsolutePath, paths.absolutePath);
    return { success: true as const, provider: this.name, status: "rendered" as const,
      model: "ffmpeg-h264-aac" as const, filePath: paths.filePath, url: paths.url,
      mimeType: "video/mp4" as const, byteLength: data.length, durationSeconds: 60,
      width: 1920 as const, height: 1080 as const, videoCodec: "h264" as const,
      audioCodec: "aac" as const, createdAt: now };
  }
}

class FixtureThumbnailProvider implements ConfiguredThumbnailProvider {
  readonly name = "openai" as const;
  private readonly delegate = new MockThumbnailProvider();
  readonly planCalls = new Map<string, number>();
  readonly assetCalls = new Map<string, number>();

  createImmutableThumbnailDispatchAdapter() {
    return createProviderDispatchAdapter(this, {
      metadata: { name: this.name },
      requiredMethods: ["generateThumbnailPlan", "generateThumbnailAsset"],
    });
  }

  async generateThumbnailPlan(
    input: Parameters<MockThumbnailProvider["generateThumbnailPlan"]>[0],
  ) {
    const projectSlug = input.projectSlug;
    assert.ok(projectSlug);
    this.planCalls.set(projectSlug, (this.planCalls.get(projectSlug) ?? 0) + 1);
    const result = await this.delegate.generateThumbnailPlan(input);
    return { ...result, provider: "openai" as const,
      thumbnail: { ...result.thumbnail, provider: "openai" as const } };
  }

  async generateThumbnailAsset(
    input: Parameters<MockThumbnailProvider["generateThumbnailAsset"]>[0],
  ) {
    this.assetCalls.set(input.projectSlug, (this.assetCalls.get(input.projectSlug) ?? 0) + 1);
    const result = await this.delegate.generateThumbnailAsset(input);
    if (result.success) {
      const asset = AssetManager.getProjectAssets(input.projectSlug, input.projectId)
        .assets.find((a) => a.id === result.assetId);
      if (asset) {
        AssetManager.addAsset(input.projectSlug, input.projectId, {
          ...asset,
          provider: "openai",
          model: result.model,
          generationMode: "production",
        });
      }
      return { ...result, provider: "openai" as const, generationMode: "production" as const };
    }
    return { ...result, provider: "openai" as const };
  }
}

class FixtureYouTubePublishProvider extends MockYouTubePublishProvider {
  override async publish(input: Parameters<MockYouTubePublishProvider["publish"]>[0]) {
    const candidate = input as unknown as { projectSlug?: string };
    const slug = candidate.projectSlug ?? input.publishingPackage?.slug;
    if (typeof slug === "string" && slug.endsWith("-legacy")) {
      throw new Error("legacy fixture propagates its expected youtube asset preflight failure");
    }
    return super.publish(input);
  }
}

const fixtureAI = new FixtureAIProvider();
const fixtureAssembly = new FixtureAssemblyProvider();
const fixtureThumbnail = new FixtureThumbnailProvider();
const fixtureYouTubePublish = new FixtureYouTubePublishProvider();

function pass(condition: unknown, label: string) {
  assert.ok(condition, label);
  scenarios += 1;
}

type RunnerInternal = {
  runStage(
    slug: string,
    stage: ProductionStepKey,
    action: (
      capability: unknown,
      identity: ProductionAcceptanceStageExecutionIdentity,
    ) => Promise<boolean>,
    runType: ProjectPackageRunType,
  ): Promise<boolean>;
};

const runnerInternal = PipelineRunner as unknown as RunnerInternal;

async function main() {
  const result = await withCanonicalSmokeRuntime({
    name: "sprint-129-39-bounded-resume",
    environment: {
      AI_PROVIDER: "mock",
      IMAGE_PROVIDER: "mock",
      ANIMATION_PROVIDER: "mock",
      VIDEO_PROVIDER: "mock",
      AUDIO_PROVIDER: "mock",
      VIDEO_ASSEMBLY_PROVIDER: "mock",
      THUMBNAIL_PROVIDER: "mock",
      YOUTUBE_PROVIDER: "mock",
      YOUTUBE_PUBLISH_PROVIDER: "mock",
    },
  }, async (runtime) => {
    await withFixtureProviders(async () => {
      try {
        console.log("Running boundedSuccess...");
        await boundedSuccess(`${runtime.projectSlug}-success`);
        console.log("boundedSuccess PASSED");
      } catch (err) {
        console.error("boundedSuccess FAILED:", err);
        throw err;
      }
      try {
        console.log("Running boundedFailure...");
        await boundedFailure(`${runtime.projectSlug}-failure`);
        console.log("boundedFailure PASSED");
      } catch (err) {
        console.error("boundedFailure FAILED:", err);
        throw err;
      }
      try {
        console.log("Running laterBoundary...");
        await laterBoundary(`${runtime.projectSlug}-seo`);
        console.log("laterBoundary PASSED");
      } catch (err) {
        console.error("laterBoundary FAILED:", err);
        throw err;
      }
      try {
        console.log("Running boundedYouTube...");
        await boundedYouTube(`${runtime.projectSlug}-youtube`);
        console.log("boundedYouTube PASSED");
      } catch (err) {
        console.error("boundedYouTube FAILED:", err);
        throw err;
      }
      try {
        console.log("Running legacyUnbounded...");
        await legacyUnbounded(`${runtime.projectSlug}-legacy`);
        console.log("legacyUnbounded PASSED");
      } catch (err) {
        console.error("legacyUnbounded FAILED:", err);
        throw err;
      }
      try {
        console.log("Running invalidBoundary...");
        await invalidBoundary(`${runtime.projectSlug}-invalid`);
        console.log("invalidBoundary PASSED");
      } catch (err) {
        console.error("invalidBoundary FAILED:", err);
        throw err;
      }
      try {
        console.log("Running commandContract...");
        await commandContract();
        console.log("commandContract PASSED");
      } catch (err) {
        console.error("commandContract FAILED:", err);
        throw err;
      }
    });
  });

  pass(result.finalization.cleanupCompleted, "owned temp runtime is cleaned");
  pass(result.finalization.sharedAuthorityUnchanged, "shared authority remains unchanged");
  pass(result.finalization.lockGateQuarantineRemainder === 0,
    "no lock, gate, or quarantine remainder survives");
  console.log(`Sprint 129.39 stage-bounded resume smoke: PASS (${scenarios} scenarios)`);
}

async function withFixtureProviders(action: () => Promise<void>) {
  const originalAI = AIRouter.prototype.getProvider;
  const originalAssembly = VideoAssemblyProviderRouter.getProvider;
  const originalThumbnail = ThumbnailProviderRouter.prototype.getProvider;
  const originalYouTubePublish = YouTubePublishProviderRouter.prototype.getProvider;
  AIRouter.prototype.getProvider = (() => fixtureAI) as typeof originalAI;
  VideoAssemblyProviderRouter.getProvider = (() => fixtureAssembly) as typeof originalAssembly;
  ThumbnailProviderRouter.prototype.getProvider = (() => fixtureThumbnail) as typeof originalThumbnail;
  YouTubePublishProviderRouter.prototype.getProvider = (() => fixtureYouTubePublish) as typeof originalYouTubePublish;
  try {
    await action();
  } finally {
    AIRouter.prototype.getProvider = originalAI;
    VideoAssemblyProviderRouter.getProvider = originalAssembly;
    ThumbnailProviderRouter.prototype.getProvider = originalThumbnail;
    YouTubePublishProviderRouter.prototype.getProvider = originalYouTubePublish;
  }
}

async function boundedSuccess(slug: string) {
  await seedFailedAssembly(slug);
  const observed = await observeResume(slug, { stopAfterStage: "assembly" });
  const result = observed.result;
  pass(result.success && !result.blocked, "bounded assembly resume succeeds");
  pass(result.stoppedAfterStage === "assembly" &&
    result.completedStages.join(",") === "assembly",
  "bounded result stops exactly after assembly");
  pass(result.plan.stagesToRun.join(",") ===
    "assembly,thumbnail,seo,youtube,export",
  "bounded execution preserves the complete canonical recovery plan");
  assertProductionSeam(observed, ["assembly"]);
  pass(providerDispatches(observed, "assembly", "videoAssemblyProvider") === 1 &&
    fixtureAssembly.calls.get(slug) === 1,
  "real assembly provider authority dispatches exactly once");
  pass(providerDispatchesAfter(observed, "assembly") === 0,
    "bounded assembly performs zero downstream provider dispatches");
  const jobs = await PipelineJobManager.listJobsReadOnly(slug);
  pass(job(jobs, "assembly")?.status === "completed" &&
    job(jobs, "thumbnail")?.status === "queued",
  "assembly is completed while thumbnail remains queued");
  pass(["seo", "youtube", "export"].every((stage) =>
    job(jobs, stage as ProductionStepKey)?.status !== "running"),
  "all downstream stages remain unadmitted");
  const recovery = await PipelineRecoveryPlanner.createResumePlan(slug);
  pass(recovery.startStage === "thumbnail" && !recovery.blocked,
    "post-boundary recovery starts at thumbnail");
  await assertQuiescent(slug, 2);
  await assertNoDownstreamDurable(slug, ["thumbnail", "seo", "youtube", "export"]);
}

async function boundedFailure(slug: string) {
  await seedFailedAssembly(slug);
  const observed = await observeResumeFailure(slug, { stopAfterStage: "assembly" });
  pass(observed.error instanceof Error &&
    /Pipeline stage execution failed|VIDEO_ASSEMBLY_FAILED/.test(observed.error.message),
  "canonical bounded assembly failure propagates");
  assertProductionSeam(observed, ["assembly"]);
  pass(fixtureAssembly.calls.get(slug) === 1 &&
    providerDispatches(observed, "assembly", "videoAssemblyProvider") === 1,
  "bounded failure performs exactly one real assembly provider attempt");
  const jobs = await PipelineJobManager.listJobsReadOnly(slug);
  pass(job(jobs, "assembly")?.status === "failed" &&
    job(jobs, "assembly")?.attempts === 1,
  "bounded failure preserves canonical failed retry evidence without automatic retry");
  pass(["thumbnail", "seo", "youtube", "export"].every((stage) =>
    job(jobs, stage as ProductionStepKey)?.status !== "running"),
  "bounded failure admits no downstream stage");
  await assertQuiescent(slug, 2);
  await assertNoDownstreamDurable(slug, ["thumbnail", "seo", "youtube", "export"]);
}

async function laterBoundary(slug: string) {
  await seedFailedAssembly(slug);
  const aiBefore = fixtureAI.calls.length;
  const observed = await observeResume(slug, { stopAfterStage: "seo" });
  pass(observed.result.success && observed.result.stoppedAfterStage === "seo" &&
    observed.result.completedStages.join(",") === "assembly,thumbnail,seo",
  "later boundary executes assembly, thumbnail, and seo in exact order");
  pass(observed.result.plan.stagesToRun.join(",") ===
    "assembly,thumbnail,seo,youtube,export",
  "later boundary preserves the complete recovery plan");
  assertProductionSeam(observed, ["assembly", "thumbnail", "seo"]);
  pass(fixtureAI.calls.slice(aiBefore).join(",") === "assembly,seo" &&
    fixtureAssembly.calls.get(slug) === 1 &&
    fixtureThumbnail.planCalls.get(slug) === 1 && fixtureThumbnail.assetCalls.get(slug) === 1,
  "later boundary uses the isolated production-authority fake providers");
  pass(providerDispatches(observed, "assembly", "videoAssemblyProvider") === 1 &&
    providerDispatches(observed, "thumbnail", "thumbnailProvider") === 1,
  "later boundary records real assembly and thumbnail dispatch instrumentation");
  pass(providerDispatchesAfter(observed, "seo") === 0,
    "youtube and export provider dispatch remains zero after seo settlement");
  const jobs = await PipelineJobManager.listJobsReadOnly(slug);
  pass(job(jobs, "seo")?.status === "completed" && job(jobs, "youtube")?.status === "queued" &&
    job(jobs, "export")?.status === "queued",
  "seo is terminal while youtube and export remain queued");
  const recovery = await PipelineRecoveryPlanner.createResumePlan(slug);
  pass(recovery.startStage === "youtube" && !recovery.blocked,
    "post-seo recovery starts at youtube");
  await assertQuiescent(slug, 4);
  await assertNoDownstreamDurable(slug, ["youtube", "export"]);
}

async function boundedYouTube(slug: string) {
  await seedFailedAssembly(slug);
  const observed = await observeResume(slug, { stopAfterStage: "youtube" });
  pass(observed.result.success && observed.result.stoppedAfterStage === "youtube" &&
    observed.result.completedStages.join(",") === "assembly,thumbnail,seo,youtube",
  "bounded youtube package-only resume completes stages up to youtube");
  const jobs = await PipelineJobManager.listJobsReadOnly(slug);
  pass(job(jobs, "youtube")?.status === "completed" && job(jobs, "export")?.status === "queued",
  "youtube job is completed while export remains queued");
  const manifest = await ProjectManager.getManifest(slug);
  pass(manifest?.packages.youtube?.status === "completed",
  "packages.youtube.status in manifest is completed after package-only youtube execution");
  const youtubePackage = await ProjectReader.readJSON<unknown>(slug, "youtube.json");
  pass(Boolean(youtubePackage), "youtube.json is persisted and valid");
  const youtubePublish = await ProjectReader.readJSON<unknown>(slug, "youtube-publish.json");
  pass(youtubePublish === null, "youtube-publish.json is absent in package-only execution");
  await assertQuiescent(slug, 5);
  await assertNoDownstreamDurable(slug, ["export"]);
}

async function legacyUnbounded(slug: string) {
  await seedFailedAssembly(slug);
  const observed = await observeResumeFailure(slug, {});
  pass(observed.error instanceof Error && /Pipeline stage execution failed/.test(observed.error.message),
    "legacy fixture propagates its expected youtube asset preflight failure");
  pass(observed.identities.map((identity) => identity.stage).join(",") ===
    "assembly,thumbnail,seo,youtube",
  "omitted boundary remains unbounded through the downstream youtube admission");
  pass(observed.identities.every((identity) => identity.runType === "resume" &&
    identity.operation === "pipeline.stage.resume"),
  "legacy downstream admission retains canonical resume identity");
}

async function invalidBoundary(slug: string) {
  await seedFailedAssembly(slug);
  const before = await treeDigest(projectFolder(slug));
  const result = await PipelineRunner.resume(slug, { stopAfterStage: "audio" });
  pass(!result.success && result.blocked &&
    result.reasonCode === pipelineResumeBoundaryInvalidCode,
  "boundary before recovery start fails closed");
  pass(result.completedStages.length === 0,
    "invalid boundary executes no stage");
  pass(await treeDigest(projectFolder(slug)) === before,
    "invalid boundary is byte-for-byte zero-mutation");
}

async function commandContract() {
  const readiness = { ready: true, checks: [] } as unknown as ProductionReadinessReport;
  const full = { readiness, completion: {} } as unknown as ProductionAcceptanceResult;
  let observed: { slug?: string; stopAfterStage?: string } = {};
  let resumeCalls = 0;
  const bounded: ProductionAcceptanceBoundedResumeResult = {
    readiness,
    boundedResume: {
      projectSlug: "bounded-command-fixture",
      type: "resume",
      startStage: "assembly",
      completedStages: ["assembly"],
      stoppedAfterStage: "assembly",
      blocked: false,
      productionReady: false,
      published: false,
    },
  };
  const dependencies: ProductionAcceptanceCommandDependencies = {
    readiness: async () => readiness,
    execute: async () => full,
    resume: async (slug, options) => {
      resumeCalls += 1;
      observed = { slug, stopAfterStage: options?.stopAfterStage };
      if (options?.stopAfterStage === "seo") return {
        readiness,
        boundedResume: { ...bounded.boundedResume,
          completedStages: ["assembly", "thumbnail", "seo"], stoppedAfterStage: "seo" },
      };
      return options?.stopAfterStage ? bounded : full;
    },
  };
  const confirmation = "--confirm-production-acceptance";
  const slug = "bounded-command-fixture";
  const legacy = await runProductionAcceptanceCommand([
    "resume-finalize", `--project-slug=${slug}`, confirmation,
  ], dependencies);
  pass(legacy.exitCode === 0 && observed.stopAfterStage === undefined,
    "command preserves omitted-boundary legacy contract");
  const boundedResult = await runProductionAcceptanceCommand([
    "resume-finalize", `--project-slug=${slug}`,
    "--stop-after-stage=assembly", confirmation,
  ], dependencies);
  pass(boundedResult.exitCode === 0 && observed.stopAfterStage === "assembly" &&
    "boundedResume" in boundedResult.report,
  "command propagates a valid assembly boundary and returns bounded result");
  const laterResult = await runProductionAcceptanceCommand([
    "resume-finalize", `--project-slug=${slug}`,
    "--stop-after-stage=seo", confirmation,
  ], dependencies);
  const laterBounded = laterResult.report.boundedResume as
    Partial<ProductionAcceptanceBoundedResumeResult["boundedResume"]> | undefined;
  pass(laterResult.exitCode === 0 && "boundedResume" in laterResult.report &&
    laterBounded?.stoppedAfterStage === "seo" && laterBounded.productionReady === false &&
    laterBounded.published === false,
  "later command boundary remains explicitly bounded and non-final");
  const callsBeforeInvalid = resumeCalls;
  const invalid = await runProductionAcceptanceCommand([
    "resume-finalize", `--project-slug=${slug}`,
    "--stop-after-stage=unknown", confirmation,
  ], dependencies);
  pass(invalid.exitCode === 2 &&
    invalid.report.errorCode === pipelineResumeBoundaryInvalidCode && resumeCalls === callsBeforeInvalid,
  "unknown command boundary is rejected before dependency invocation");
  const empty = await runProductionAcceptanceCommand([
    "resume-finalize", `--project-slug=${slug}`, "--stop-after-stage=", confirmation,
  ], dependencies);
  pass(empty.exitCode === 2 && empty.report.errorCode === pipelineResumeBoundaryInvalidCode &&
    resumeCalls === callsBeforeInvalid,
  "empty command boundary fails closed before dependency invocation");
  const malformed = await runProductionAcceptanceCommand([
    "resume-finalize", `--project-slug=${slug}`, "--stop-after-stage", "seo", confirmation,
  ], dependencies);
  pass(malformed.exitCode === 2 &&
    malformed.report.errorCode === "PRODUCTION_ACCEPTANCE_ARGUMENT_UNKNOWN" &&
    resumeCalls === callsBeforeInvalid,
  "malformed split command boundary fails closed before dependency invocation");
  const duplicate = await runProductionAcceptanceCommand([
    "resume-finalize", `--project-slug=${slug}`,
    "--stop-after-stage=assembly", "--stop-after-stage=thumbnail", confirmation,
  ], dependencies);
  pass(duplicate.exitCode === 2 &&
    duplicate.report.errorCode === "PRODUCTION_ACCEPTANCE_ARGUMENT_UNKNOWN" &&
    resumeCalls === callsBeforeInvalid,
  "duplicate command boundary fails closed");
  const unsafeDependencies: ProductionAcceptanceCommandDependencies = {
    ...dependencies,
    resume: async () => { throw new Error("C:\\private\\secret stack"); },
  };
  const unsafe = await runProductionAcceptanceCommand([
    "resume-finalize", `--project-slug=${slug}`,
    "--stop-after-stage=assembly", confirmation,
  ], unsafeDependencies);
  pass(unsafe.report.errorCode === "PRODUCTION_ACCEPTANCE_COMMAND_FAILED" &&
    !JSON.stringify(unsafe.report).includes("private"),
  "unknown command failure remains sanitized");
}

import { AudioStorage } from "../src/lib/assets/storage/AudioStorage";
import { ImageStorage } from "../src/lib/assets/storage/ImageStorage";
import { AssetManager } from "../src/lib/assets/AssetManager";
import { deflateSync } from "node:zlib";

function wav() {
  const samples = Buffer.alloc(16_000 * 2); const output = Buffer.alloc(44 + samples.length);
  output.write("RIFF", 0); output.writeUInt32LE(output.length - 8, 4); output.write("WAVEfmt ", 8);
  output.writeUInt32LE(16, 16); output.writeUInt16LE(1, 20); output.writeUInt16LE(1, 22);
  output.writeUInt32LE(16_000, 24); output.writeUInt32LE(32_000, 28);
  output.writeUInt16LE(2, 32); output.writeUInt16LE(16, 34); output.write("data", 36);
  output.writeUInt32LE(samples.length, 40); samples.copy(output, 44); return output;
}

function png() {
  const chunk = (type: string, data: Buffer) => {
    const name = Buffer.from(type); const output = Buffer.alloc(data.length + 12);
    output.writeUInt32BE(data.length, 0); name.copy(output, 4); data.copy(output, 8);
    let crc = 0xffffffff;
    for (const byte of Buffer.concat([name, data])) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
    output.writeUInt32BE((crc ^ 0xffffffff) >>> 0, data.length + 8); return output;
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(1, 0); header.writeUInt32BE(1, 4);
  header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header), chunk("IDAT", deflateSync(Buffer.from([0, 32, 64, 96]))),
    chunk("IEND", Buffer.alloc(0))]);
}

async function seedFailedAssembly(slug: string) {
  const project = await ProjectManager.createProject(slug);
  const audioAssetId = `audio-fixture-1`;
  const imageAssetId = `image-fixture-1`;
  const savedAudio = AudioStorage.saveAudio({ projectSlug: slug, assetId: audioAssetId, data: wav() });
  const ownedAudio = AudioStorage.transferPublicationOwnership(savedAudio, {
    success: true as const,
    target: { kind: "section" as const, chapterId: 1 },
    provider: "openai" as const,
    model: "fixture-audio-v1",
    ...savedAudio,
    createdAt: now,
  });
  AudioStorage.completePublishedAudio(ownedAudio);
  AssetManager.addAsset(slug, project.id, {
    id: audioAssetId,
    projectId: project.id,
    projectSlug: slug,
    sceneId: 1,
    type: "audio",
    status: "generated",
    provider: "openai",
    model: "fixture-audio-v1",
    prompt: "Fixture audio",
    filePath: savedAudio.filePath,
    url: savedAudio.url,
    mimeType: "audio/wav",
    byteLength: savedAudio.byteLength,
    durationSeconds: savedAudio.durationSeconds,
    createdAt: now,
  });
  const pngData = png();
  const savedImage = ImageStorage.saveImage({
    projectSlug: slug,
    assetId: imageAssetId,
    data: pngData,
    mimeType: "image/png",
  });
  AssetManager.addAsset(slug, project.id, {
    id: imageAssetId,
    projectId: project.id,
    projectSlug: slug,
    sceneId: 1,
    type: "image",
    status: "generated",
    provider: "openai",
    model: "fixture-image-v1",
    prompt: "Fixture image",
    filePath: savedImage.filePath,
    url: savedImage.url,
    mimeType: "image/png",
    byteLength: pngData.length,
    createdAt: now,
  });
  const audioMixAssetId = `audio-fixture-mix`;
  const savedMix = AudioStorage.saveAudio({ projectSlug: slug, assetId: audioMixAssetId, data: wav() });
  const ownedMix = AudioStorage.transferPublicationOwnership(savedMix, {
    success: true as const,
    target: { kind: "mix" as const },
    provider: "openai" as const,
    model: "fixture-audio-v1",
    ...savedMix,
    createdAt: now,
  });
  AudioStorage.completePublishedAudio(ownedMix);
  AssetManager.addAsset(slug, project.id, {
    id: audioMixAssetId,
    projectId: project.id,
    projectSlug: slug,
    type: "audio",
    status: "generated",
    provider: "openai",
    model: "fixture-audio-v1",
    prompt: "Fixture audio mix",
    filePath: savedMix.filePath,
    url: savedMix.url,
    mimeType: "audio/wav",
    byteLength: savedMix.byteLength,
    durationSeconds: savedMix.durationSeconds,
    createdAt: now,
  });
  const script = {
    topic: "Bounded resume", title: "Bounded resume", subtitle: "", hook: "",
    introduction: "", chapters: [{ id: 1, title: "One", narration: "One",
      duration: 60, visualGoal: "One", emotion: "calm", transition: "cut" }],
    conclusion: "", callToAction: "", estimatedDuration: 60,
    narrationWordCount: 120, targetAudience: "all", language: "tr",
    voiceStyle: "documentary", musicStyle: "none", thumbnailIdea: "",
    seoKeywords: [], createdAt: now,
  };
  const scenes = { scenes: [{ id: 1, chapterId: 1, title: "One",
    description: "One", duration: 60 }], createdAt: now };
  const data: Partial<Record<ProductionStepKey, unknown>> = {
    research: { topic: "Bounded resume", createdAt: now },
    script,
    scenes,
    visuals: { projectId: project.id, scenes: [{ sceneId: 1,
      visualPrompt: "One", animationPrompt: "Slow movement", style: "documentary", outputAssetId: imageAssetId }], thumbnail: {
      title: "One", prompt: "One", composition: "One", mood: "calm",
    }, createdAt: now },
    animation: { projectId: project.id, scenes: [], createdAt: now },
    video: { projectId: project.id, status: "generated", scenes: [], createdAt: now },
    audio: { status: "generated", outputAssetId: audioMixAssetId, narrator: { style: "documentary", tone: "calm",
      language: "tr" }, sections: [{ chapterId: 1, title: "One", duration: "01:00",
      emotion: "calm", emphasis: ["one"], narrationNotes: "One", pacing: "medium",
      sourceText: "One", outputAssetId: audioAssetId }], music: { mood: "none", suggestion: "none",
      intensity: "none" }, production: { targetFormat: "wav", sampleRate: 16000,
      estimatedTotalDuration: "01:00", generationStatus: "generated" }, createdAt: now },
  };
  const save: Partial<Record<ProductionStepKey, (value: unknown) => Promise<void>>> = {
    research: (value) => ProjectManager.saveResearch(slug, value),
    script: (value) => ProjectManager.saveScript(slug, value),
    scenes: (value) => ProjectManager.saveScenes(slug, value),
    visuals: (value) => ProjectManager.saveVisuals(slug, value),
    animation: (value) => ProjectManager.saveAnimation(slug, value),
    video: (value) => ProjectManager.saveVideo(slug, value),
    audio: (value) => ProjectManager.saveAudio(slug, value),
  };
  await PipelineJobManager.listJobs(slug);
  for (const stage of pipelineRecoveryStageOrder.slice(0,
    pipelineRecoveryStageOrder.indexOf("assembly"))) {
    const started = await PipelineJobManager.startStage(slug, stage, async () => {
      await ProjectManager.updatePackageStatus(slug, stage, "running");
    });
    assert.equal(started, true);
    const value = data[stage];
    const saver = save[stage];
    assert.ok(value && saver);
    const completed = await PipelineJobManager.persistStageSuccess(slug, stage, async () => {
      await saver(value);
      await ProjectManager.updatePackageStatus(slug, stage, "completed");
    });
    assert.equal(completed, true);
  }
  await assert.rejects(
    runnerInternal.runStage(slug, "assembly", async (_capability, identity) => {
      assert.equal(identity.runType, "initial");
      assert.equal(identity.operation, "pipeline.stage.initial");
      throw new Error("seed assembly failure");
    }, "initial"),
  );
  const recovery = await PipelineRecoveryPlanner.createResumePlan(slug);
  assert.equal(recovery.startStage, "assembly");
  assert.equal(recovery.blocked, false);
}

type ResumeObservation = {
  readonly events: ReadonlyArray<{ event: ProductionPipelineExecutionEvent;
    detail?: Readonly<ProductionPipelineExecutionEventDetail> }>;
  readonly identities: readonly ProductionAcceptanceStageExecutionIdentity[];
  readonly result: Awaited<ReturnType<typeof PipelineRunner.resume>>;
};

async function observeResume(
  slug: string,
  options: NonNullable<Parameters<typeof PipelineRunner.resume>[1]>,
): Promise<ResumeObservation> {
  const events: Array<{ event: ProductionPipelineExecutionEvent;
    detail?: Readonly<ProductionPipelineExecutionEventDetail> }> = [];
  const identities: ProductionAcceptanceStageExecutionIdentity[] = [];
  const result = await runWithProductionPipelineExecutionInstrumentation({
    onEvent(event, detail) {
      events.push({ event, detail });
      if (event === "capability-consumed" && detail?.identity) {
        identities.push(detail.identity as unknown as ProductionAcceptanceStageExecutionIdentity);
      }
    },
  }, () => PipelineRunner.resume(slug, options));
  return { events, identities, result };
}

async function observeResumeFailure(
  slug: string,
  options: NonNullable<Parameters<typeof PipelineRunner.resume>[1]>,
) {
  const events: Array<{ event: ProductionPipelineExecutionEvent;
    detail?: Readonly<ProductionPipelineExecutionEventDetail> }> = [];
  const identities: ProductionAcceptanceStageExecutionIdentity[] = [];
  let error: unknown;
  try {
    await runWithProductionPipelineExecutionInstrumentation({
      onEvent(event, detail) {
        events.push({ event, detail });
        if (event === "capability-consumed" && detail?.identity) {
          identities.push(detail.identity as unknown as ProductionAcceptanceStageExecutionIdentity);
        }
      },
    }, () => PipelineRunner.resume(slug, options));
  } catch (caught) {
    error = caught;
  }
  return { events, identities, error };
}

function assertProductionSeam(
  observed: Pick<ResumeObservation, "events" | "identities">,
  stages: readonly ProductionStepKey[],
) {
  pass(observed.identities.map((identity) => identity.stage).join(",") === stages.join(",") &&
    observed.identities.every((identity) => identity.runType === "resume" &&
      identity.operation === "pipeline.stage.resume"),
  "production identities preserve exact resume run type and operation");
  pass(observed.events.filter(({ event }) => event === "capability-consumed").length ===
    stages.length,
  "every stage consumes capability authority in the production executor");
  pass(["durable-attempt-persisted", "durable-readback-verified", "canonical-identity-extracted",
    "lifecycle-bound", "capability-issuance-entered", "capability-consumed"]
    .every((event) => observed.events.filter((entry) => entry.event === event).length === stages.length),
  "every stage traverses canonical durable preparation, authority, and lifecycle events");
  pass(observed.events.filter(({ event, detail }) => event === "capability-consumed" &&
    Boolean((detail?.executionScope as { providerSelection?: { selectionId?: string } } | undefined)
      ?.providerSelection?.selectionId)).length === stages.length,
  "every capability binds an immutable production provider selection");
}

function providerDispatches(
  observed: Pick<ResumeObservation, "events">,
  stage: ProductionStepKey,
  slot: string,
) {
  return observed.events.filter(({ event, detail }) => event === "provider-dispatch-entered" &&
    detail?.stage === stage && detail.slot === slot).length;
}

function providerDispatchesAfter(
  observed: Pick<ResumeObservation, "events">,
  boundary: ProductionStepKey,
) {
  const boundaryIndex = pipelineRecoveryStageOrder.indexOf(boundary);
  return observed.events.filter(({ event, detail }) => event === "provider-dispatch-entered" &&
    pipelineRecoveryStageOrder.indexOf(detail?.stage as ProductionStepKey) > boundaryIndex).length;
}

async function assertQuiescent(slug: string, terminal: number) {
  const semantic = await readProductionExecutionRecoverySemanticAuthority(
    new ProductionExecutionFilePersistenceAdapter({
      trustedRootDirectory: path.join(projectFolder(slug), "production-execution"),
      createRootDirectory: false,
    }),
    new Date().toISOString(),
  );
  pass(semantic.decision === "ready" && semantic.activeReservationCount === 0 &&
    semantic.counts.active === 0 && semantic.counts.running === 0 &&
    semantic.counts.terminal === terminal,
  "durable lifecycle is terminal and quiescent");
}

async function assertNoDownstreamDurable(
  slug: string,
  downstream: readonly ProductionStepKey[],
) {
  const root = path.join(projectFolder(slug), "production-execution");
  const families = ["reservations", "idempotency", "claims", "attempts"] as const;
  const observed: Array<{ family: string; stage?: string }> = [];
  for (const family of families) {
    for (const file of await fs.readdir(path.join(root, family))) {
      const value = JSON.parse(await fs.readFile(path.join(root, family, file), "utf8")) as {
        stage?: string;
      };
      observed.push({ family, stage: value.stage });
    }
  }
  pass(!observed.some(({ stage }) => downstream.includes(stage as ProductionStepKey)),
    "downstream reservation, record/lease, claim, and attempt artifacts are absent");
}

function job(jobs: PipelineJobList, stage: ProductionStepKey) {
  return jobs.jobs.find((candidate) => candidate.stage === stage);
}

function projectFolder(slug: string) {
  return ProjectReader.getProjectFolder(slug);
}

async function treeDigest(root: string) {
  const entries: string[] = [];
  const visit = async (directory: string) => {
    for (const entry of (await fs.readdir(directory, { withFileTypes: true }))
      .sort((left, right) => left.name.localeCompare(right.name))) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(target);
      else entries.push(`${path.relative(root, target)}:${createHash("sha256")
        .update(await fs.readFile(target)).digest("hex")}`);
    }
  };
  await visit(root);
  return createHash("sha256").update(entries.join("\n")).digest("hex");
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Sprint 129.39 smoke failed");
  process.exitCode = 1;
});
