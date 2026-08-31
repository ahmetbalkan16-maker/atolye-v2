/**
 * Smoke: `production:acceptance:execute --stop-after-stage=<stage>`
 *
 * A fresh `execute` can now be told to stop cleanly the moment a stage
 * completes — the exact bounded semantics already proven for
 * `resume-finalize --stop-after-stage` in
 * `scripts/smoke-sprint-129-39-stage-bounded-resume.ts`. This suite covers the
 * new surface only:
 *
 *   A. Command contract — `execute` argument parsing + the bounded / full
 *      report shapes, with stubbed dependencies (no pipeline, no providers).
 *   B. `PipelineRunner.run` mechanism — a real fresh run driven by fully
 *      deterministic fixture providers, asserting the bounded stop, that no
 *      downstream stage runs, that the project is NOT marked "completed", and
 *      that an un-bounded run still completes exactly as before.
 *   C. Orchestrator structural guard — `ProductionAcceptanceOrchestrator.run`
 *      threads `stopAfterStage` into `PipelineRunner.run`, returns before
 *      `finalize()` on a bounded run, and fails closed when the run did not
 *      settle exactly on the requested boundary.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import fsSync from "node:fs";
import path from "node:path";
import { deflateSync } from "node:zlib";
import { PipelineRunner, pipelineResumeBoundaryInvalidCode } from "../src/lib/pipeline/PipelineRunner";
import { pipelineRecoveryStageOrder } from "../src/lib/pipeline/PipelineRecoveryPlanner";
import { ProjectManager } from "../src/lib/projects/ProjectManager";
import {
  runProductionAcceptanceCommand,
  type ProductionAcceptanceCommandDependencies,
} from "../src/lib/production/ProductionAcceptanceCommand";
import type {
  ProductionAcceptanceBoundedRunResult,
  ProductionAcceptanceResult,
  ProductionAcceptanceRunResult,
} from "../src/lib/production/ProductionAcceptanceOrchestrator";
import { AudioStorage } from "../src/lib/assets/storage/AudioStorage";
import { ImageStorage } from "../src/lib/assets/storage/ImageStorage";
import { VideoStorage } from "../src/lib/assets/storage/VideoStorage";
import { ThumbnailStorage } from "../src/lib/thumbnail/ThumbnailStorage";
import { createMockThumbnailData } from "../src/lib/thumbnail/providers/MockThumbnailProvider";
import { MockYouTubePublishProvider } from "../src/lib/youtube/publish/providers/MockYouTubePublishProvider";
import { createProviderDispatchAdapter } from "../src/lib/providers/ProviderDispatchAdapterAuthority";
import { withCanonicalSmokeRuntime } from "./lib/CanonicalSmokeRuntime";
import type { AIProvider } from "../src/lib/ai/providers";
import type { AudioProvider } from "../src/lib/audio/providers/AudioProvider";
import type { ImageProvider } from "../src/lib/assets/providers/ImageProvider";
import type { VideoProvider } from "../src/lib/video/providers/VideoProvider";
import type { VideoAssemblyProvider } from "../src/lib/assembly/providers/VideoAssemblyProvider";
import type { ThumbnailProvider } from "../src/lib/thumbnail/providers/ThumbnailProvider";
import type { YouTubeProvider } from "../src/lib/youtube/providers/YouTubeProvider";

const now = "2026-08-30T12:00:00.000Z";
let scenarios = 0;
function pass(condition: unknown, label: string) {
  assert.ok(condition, label);
  scenarios += 1;
}

// ---------------------------------------------------------------------------
// A. Command contract (stubbed dependencies)
// ---------------------------------------------------------------------------

async function commandContract() {
  const readiness = { ready: true, checks: [] } as unknown as ProductionReadinessReportLike;
  const fullResult = { readiness, completion: { projectSlug: "x" } } as unknown as ProductionAcceptanceResult;
  const boundedResult: ProductionAcceptanceBoundedRunResult = {
    readiness: readiness as never,
    boundedRun: Object.freeze({
      projectSlug: "bounded-execute-fixture",
      type: "run",
      completedStages: [
        "research", "script", "scenes", "visuals", "animation", "video", "audio", "assembly",
      ] as const,
      stoppedAfterStage: "assembly" as const,
      blocked: false,
      productionReady: false,
      published: false,
    }),
  };

  let executeCalls = 0;
  let observed: { topic?: string; stopAfterStage?: string } = {};
  const dependencies: ProductionAcceptanceCommandDependencies = {
    readiness: async () => readiness as never,
    resume: async () => fullResult as never,
    execute: async (request, options): Promise<ProductionAcceptanceRunResult> => {
      executeCalls += 1;
      observed = { topic: request.topic, stopAfterStage: options?.stopAfterStage };
      return options?.stopAfterStage ? boundedResult : fullResult;
    },
  };
  const confirm = "--confirm-production-acceptance";

  // 1. No boundary -> legacy full execute; dependency sees no stopAfterStage.
  const full = await runProductionAcceptanceCommand(
    ["execute", confirm, "--topic=Fatih Sultan Mehmet"],
    dependencies,
  );
  pass(
    full.exitCode === 0 && observed.stopAfterStage === undefined &&
      full.report.mode === "execute" && full.report.success === true &&
      "completion" in full.report && !("boundedRun" in full.report),
    "execute without --stop-after-stage keeps the legacy full-run contract",
  );

  // 2. --stop-after-stage=assembly -> propagated; bounded report shape returned.
  const bounded = await runProductionAcceptanceCommand(
    ["execute", confirm, "--topic=Fatih Sultan Mehmet", "--stop-after-stage=assembly"],
    dependencies,
  );
  const boundedReport = bounded.report.boundedRun as
    Partial<ProductionAcceptanceBoundedRunResult["boundedRun"]> | undefined;
  pass(
    bounded.exitCode === 0 && observed.stopAfterStage === "assembly" &&
      bounded.report.mode === "execute" && bounded.report.success === true &&
      "boundedRun" in bounded.report && !("completion" in bounded.report) &&
      boundedReport?.stoppedAfterStage === "assembly" &&
      boundedReport.type === "run" &&
      boundedReport.blocked === false &&
      boundedReport.productionReady === false &&
      boundedReport.published === false,
    "execute --stop-after-stage=assembly propagates the boundary and returns a bounded, non-final result",
  );

  // 3. A non-assembly recovery stage key is accepted verbatim too.
  const boundedSeo = await runProductionAcceptanceCommand(
    ["execute", confirm, "--topic=Fatih Sultan Mehmet", "--stop-after-stage=seo"],
    dependencies,
  );
  pass(
    boundedSeo.exitCode === 0 && observed.stopAfterStage === "seo" &&
      "boundedRun" in boundedSeo.report,
    "execute --stop-after-stage accepts any canonical recovery stage key",
  );

  // 4. Unknown stage key -> fail closed BEFORE the dependency is invoked.
  const callsBeforeInvalid = executeCalls;
  const unknown = await runProductionAcceptanceCommand(
    ["execute", confirm, "--topic=Fatih Sultan Mehmet", "--stop-after-stage=unknown"],
    dependencies,
  );
  pass(
    unknown.exitCode === 2 &&
      unknown.report.errorCode === pipelineResumeBoundaryInvalidCode &&
      executeCalls === callsBeforeInvalid,
    "unknown execute boundary is rejected before dependency invocation",
  );

  // 5. Empty boundary value -> fail closed before the dependency is invoked.
  const empty = await runProductionAcceptanceCommand(
    ["execute", confirm, "--topic=Fatih Sultan Mehmet", "--stop-after-stage="],
    dependencies,
  );
  pass(
    empty.exitCode === 2 &&
      empty.report.errorCode === pipelineResumeBoundaryInvalidCode &&
      executeCalls === callsBeforeInvalid,
    "empty execute boundary fails closed before dependency invocation",
  );

  // 6. Split `--stop-after-stage assembly` (no `=`) -> unknown argument.
  const split = await runProductionAcceptanceCommand(
    ["execute", confirm, "--topic=Fatih Sultan Mehmet", "--stop-after-stage", "assembly"],
    dependencies,
  );
  pass(
    split.exitCode === 2 &&
      split.report.errorCode === "PRODUCTION_ACCEPTANCE_ARGUMENT_UNKNOWN" &&
      executeCalls === callsBeforeInvalid,
    "malformed split execute boundary fails closed before dependency invocation",
  );

  // 7. Duplicate boundary -> unknown argument.
  const duplicate = await runProductionAcceptanceCommand(
    [
      "execute", confirm, "--topic=Fatih Sultan Mehmet",
      "--stop-after-stage=assembly", "--stop-after-stage=video",
    ],
    dependencies,
  );
  pass(
    duplicate.exitCode === 2 &&
      duplicate.report.errorCode === "PRODUCTION_ACCEPTANCE_ARGUMENT_UNKNOWN" &&
      executeCalls === callsBeforeInvalid,
    "duplicate execute boundary fails closed",
  );

  // 8. Missing confirmation flag still wins over the boundary.
  const noConfirm = await runProductionAcceptanceCommand(
    ["execute", "--topic=Fatih Sultan Mehmet", "--stop-after-stage=assembly"],
    dependencies,
  );
  pass(
    noConfirm.exitCode === 2 &&
      noConfirm.report.errorCode === "PRODUCTION_ACCEPTANCE_CONFIRMATION_REQUIRED" &&
      executeCalls === callsBeforeInvalid,
    "confirmation is still mandatory for a bounded execute",
  );

  // 9. A throwing dependency is sanitized, never leaking its stack / paths.
  const unsafe = await runProductionAcceptanceCommand(
    ["execute", confirm, "--topic=Fatih Sultan Mehmet", "--stop-after-stage=assembly"],
    {
      ...dependencies,
      execute: async () => {
        throw new Error("unsafe-provider-body C:\\private\\secret sk-test stack");
      },
    },
  );
  pass(
    unsafe.exitCode === 1 &&
      unsafe.report.errorCode === "PRODUCTION_ACCEPTANCE_COMMAND_FAILED" &&
      !JSON.stringify(unsafe.report).includes("private") &&
      !JSON.stringify(unsafe.report).includes("sk-test"),
    "a bounded execute dependency failure stays sanitized",
  );
}

type ProductionReadinessReportLike = { ready: boolean; checks: readonly unknown[] };

// ---------------------------------------------------------------------------
// B. PipelineRunner.run bounded mechanism (deterministic fixture providers)
// ---------------------------------------------------------------------------

const fixtureStageExecution = () => ({
  aiProvider: new DeterministicAIProvider(),
  visualAssetProvider: new StoredImageProvider(),
  videoProvider: new StoredSceneVideoProvider(),
  audioProvider: new StoredAudioProvider(),
  videoAssemblyProvider: new StoredAssemblyProvider(),
  thumbnailProvider: new CountingThumbnailProvider(),
  youtubeProvider: new CountingYouTubeProvider(),
  youtubePublishProvider: new MockYouTubePublishProvider(),
});

const downstreamStages = ["thumbnail", "seo", "youtube", "export"] as const;

async function boundedRun() {
  const topic = "Bounded execute smoke - Fatih Sultan Mehmet ve Istanbul'un Fethi bounded";
  const execution = fixtureStageExecution();
  const result = await PipelineRunner.run(topic, {
    stageExecution: execution as never,
    stopAfterStage: "assembly",
  });

  pass(result.success === true, "bounded fresh run reports success");
  pass(
    result.stoppedAfterStage === "assembly" &&
      result.completedStages.at(-1) === "assembly" &&
      !result.stopReason,
    "bounded fresh run stops cleanly exactly after assembly",
  );
  pass(
    downstreamStages.every((stage) => !result.completedStages.includes(stage)),
    "bounded fresh run schedules no downstream stage",
  );
  pass(
    Boolean(result.assembly) && !result.thumbnail && !result.seo &&
      !result.youtube && !result.export,
    "bounded fresh run leaves the assembly stage state present and every downstream stage empty",
  );
  pass(
    execution.thumbnailProvider.calls === 0 &&
      execution.youtubeProvider.calls === 0,
    "bounded fresh run never dispatches the thumbnail or youtube providers",
  );

  const project = await ProjectManager.getProject(result.slug);
  pass(
    project !== null && project.status !== "completed",
    "a bounded fresh run is NOT marked completed",
  );
  const manifest = await ProjectManager.getManifest(result.slug);
  pass(
    manifest?.packages.assembly?.status === "completed" &&
      downstreamStages.every(
        (stage) =>
          manifest?.packages[stage]?.status === "pending" ||
          manifest?.packages[stage]?.status === "missing" ||
          manifest?.packages[stage] === undefined,
      ),
    "manifest shows assembly completed while every downstream package stays pending",
  );
}

async function unboundedRunUnchanged() {
  const topic = "Bounded execute smoke - Fatih Sultan Mehmet ve Istanbul'un Fethi full";
  const execution = fixtureStageExecution();
  const result = await PipelineRunner.run(topic, { stageExecution: execution as never });

  pass(
    result.success === true && result.stoppedAfterStage === undefined && !result.stopReason,
    "an un-bounded fresh run still runs the whole pipeline",
  );
  pass(
    pipelineRecoveryStageOrder.every((stage) => result.completedStages.includes(stage)),
    "an un-bounded fresh run completes every canonical recovery stage",
  );
  pass(
    execution.thumbnailProvider.calls > 0 && execution.youtubeProvider.calls > 0,
    "an un-bounded fresh run still dispatches the downstream providers",
  );
  const project = await ProjectManager.getProject(result.slug);
  pass(project?.status === "completed", "an un-bounded fresh run is marked completed");
}

async function boundedRunFailureSafety() {
  const topic = "Bounded execute smoke - Fatih Sultan Mehmet ve Istanbul'un Fethi fail";
  const execution = {
    ...fixtureStageExecution(),
    videoAssemblyProvider: new ThrowingAssemblyProvider(),
  };
  let threw: unknown;
  let result: Awaited<ReturnType<typeof PipelineRunner.run>> | undefined;
  try {
    result = await PipelineRunner.run(topic, {
      stageExecution: execution as never,
      stopAfterStage: "assembly",
    });
  } catch (error) {
    threw = error;
  }

  pass(
    Boolean(threw) || (result !== undefined && result.success === false),
    "a failing assembly stage never yields a bounded success",
  );
  if (result !== undefined) {
    pass(
      result.stoppedAfterStage === undefined,
      "a failing bounded run reports no stoppedAfterStage boundary",
    );
    const project = await ProjectManager.getProject(result.slug);
    pass(
      project === null || project.status !== "completed",
      "a failing bounded run is never marked completed",
    );
  } else {
    pass(true, "a failing bounded run reports no stoppedAfterStage boundary (threw)");
    pass(true, "a failing bounded run is never marked completed (threw)");
  }
}

// ---------------------------------------------------------------------------
// C. Orchestrator structural guard (source assertions)
// ---------------------------------------------------------------------------

function orchestratorStructuralGuard() {
  const source = fs.readFileSync(
    path.resolve(__dirname, "../src/lib/production/ProductionAcceptanceOrchestrator.ts"),
    "utf8",
  );

  // The fresh-run `stopAfterStage` is threaded into the single PipelineRunner.run
  // call — no second execution path.
  const runCallMatches = source.match(/PipelineRunner\.run\(/g) ?? [];
  pass(runCallMatches.length === 1, "orchestrator has exactly one PipelineRunner.run call");
  pass(
    /\.\.\.\(options\.stopAfterStage \? \{ stopAfterStage: options\.stopAfterStage \} : \{\}\),/.test(
      source,
    ),
    "orchestrator threads options.stopAfterStage into PipelineRunner.run",
  );

  // The bounded branch returns before finalize, and finalize is only reached on
  // the un-bounded path.
  const boundedIndex = source.indexOf("if (options.stopAfterStage) {");
  const finalizeIndex = source.indexOf(
    "return this.finalizeWithinCanonicalRuntimeOperation(result.slug, readiness, startedAt);",
  );
  pass(boundedIndex > 0 && finalizeIndex > boundedIndex, "bounded branch precedes the run finalize call");

  const boundedBranch = source.slice(boundedIndex, finalizeIndex);
  pass(
    /throw new ProductionAcceptanceExecutionError\(runSlug\);/.test(boundedBranch) &&
      /!result\.success \|\|/.test(boundedBranch) &&
      /result\.stoppedAfterStage !== options\.stopAfterStage \|\|/.test(boundedBranch) &&
      /result\.completedStages\.at\(-1\) !== options\.stopAfterStage/.test(boundedBranch),
    "bounded branch fails closed unless the run settled exactly on the requested boundary",
  );
  pass(
    /return \{\s*readiness,\s*boundedRun: Object\.freeze\(\{/.test(boundedBranch) &&
      /productionReady: false as const,/.test(boundedBranch) &&
      /published: false as const,/.test(boundedBranch) &&
      !/finalize/.test(boundedBranch),
    "bounded branch returns a frozen, non-final boundedRun result and never calls finalize",
  );

  // The overload keeps the 1-arg `run({ topic })` callers on the concrete type.
  pass(
    /static async run\(request: ProductionAcceptanceRequest\): Promise<ProductionAcceptanceResult>;/.test(
      source,
    ),
    "orchestrator.run keeps a 1-arg overload returning the concrete ProductionAcceptanceResult",
  );
}

// ---------------------------------------------------------------------------
// Deterministic fixture providers (adapted from smoke-production-end-to-end.ts)
// ---------------------------------------------------------------------------

class DeterministicAIProvider implements AIProvider {
  createImmutableAiDispatchAdapter() {
    return createProviderDispatchAdapter(this, { metadata: { name: "deterministic" }, requiredMethods: ["generate"] });
  }
  async generate(prompt: string) {
    if (prompt.includes("documentary research assistant")) {
      return JSON.stringify({
        topic: "İstanbul'un Fethi", summary: "Deterministik araştırma.",
        historicalContext: "1453", timeline: ["1453: Fetih"], characters: ["Fatih Sultan Mehmet"],
        locations: ["İstanbul"], keyEvents: ["Fetih"], strategies: ["Kuşatma"], controversies: [],
        interestingFacts: [], documentaryFlow: ["Hazırlık", "Fetih"], sceneIdeas: ["Surlar"],
        imagePrompts: ["İstanbul surları"], animationPrompts: ["Yavaş yaklaşma"],
        musicIdeas: ["Sinematik"], soundEffects: ["Top sesi"], thumbnailIdeas: ["Fatih ve surlar"],
        youtubeTitles: ["İstanbul'un Fethi"], sources: ["Deterministik fixture"], createdAt: now,
      });
    }
    if (prompt.includes("documentary script writer")) {
      return JSON.stringify({
        topic: "İstanbul'un Fethi", title: "İstanbul'un Fethi", subtitle: "Bir çağın kapanışı",
        hook: "1453'te dünya değişti.", introduction: "Fatih'in hazırlıkları başladı.",
        chapters: [{ id: 1, title: "Fetih", narration: "Osmanlı ordusu İstanbul surlarına ulaştı.", duration: 2, visualGoal: "İstanbul surları", emotion: "kararlı", transition: "fade" }],
        conclusion: "İstanbul fethedildi.", callToAction: "Takip edin.", estimatedDuration: 2,
        narrationWordCount: 12, targetAudience: "genel", language: "tr", voiceStyle: "documentary",
        musicStyle: "cinematic", thumbnailIdea: "Fatih", seoKeywords: ["İstanbul'un fethi"], createdAt: now,
      });
    }
    if (prompt.includes("documentary scene planner")) {
      return JSON.stringify({
        scenes: [{ id: 1, title: "Fetih", description: "Fatih ve İstanbul surları.", visualPrompt: "1453 İstanbul surları, sinematik", duration: 2 }],
        createdAt: now,
      });
    }
    if (prompt.includes("professional documentary video editor")) {
      return JSON.stringify({
        scenes: [{ sceneId: 1, chapterId: 1, duration: "00:02", visualReference: "visual-1", audioReference: "section-1", transition: "fade", cameraMovement: "slow", effects: [], notes: "Fetih" }],
        totalDuration: "00:02", style: "documentary", render: { status: "planned", format: "mp4" }, createdAt: now,
      });
    }
    if (prompt.includes("YouTube SEO strategist")) {
      return JSON.stringify({
        titleSuggestions: ["İstanbul'un Fethi"], description: "Fatih Sultan Mehmet ve 1453.",
        tags: ["fetih"], hashtags: ["#fetih"], keywords: ["istanbul fethi"], targetAudience: "genel",
        searchIntent: "Fethi öğren.", createdAt: now,
      });
    }
    return "";
  }
}

class StoredImageProvider implements ImageProvider {
  readonly name = "openai" as const;
  createImmutableImageDispatchAdapter() {
    return createProviderDispatchAdapter(this, { metadata: { name: this.name }, requiredMethods: ["generateImage"] });
  }
  async generateImage(input: Parameters<ImageProvider["generateImage"]>[0]) {
    const id = `bounded-execute-image-${input.sceneId}`;
    const saved = ImageStorage.saveImage({ projectSlug: input.projectSlug!, assetId: id, data: png(), mimeType: "image/png" });
    return { success: true as const, id, sceneId: input.sceneId, provider: this.name, model: "deterministic-image-v1", ...saved, mimeType: "image/png" as const, createdAt: now };
  }
}

class StoredAudioProvider implements AudioProvider {
  readonly name = "openai" as const;
  createImmutableAudioDispatchAdapter() {
    return createProviderDispatchAdapter(this, { metadata: { name: this.name }, requiredMethods: ["validateInput", "generateAudio"] });
  }
  validateInput() {}
  async generateAudio(input: Parameters<AudioProvider["generateAudio"]>[0]) {
    const id = input.target.kind === "mix" ? "bounded-execute-audio-mix" : `bounded-execute-audio-${input.target.chapterId}`;
    return { success: true as const, target: input.target, provider: this.name, model: "deterministic-audio-v1", ...AudioStorage.saveAudio({ projectSlug: input.projectSlug, assetId: id, data: wav() }), createdAt: now };
  }
}

class StoredSceneVideoProvider implements VideoProvider {
  readonly name = "ffmpeg";
  createImmutableVideoDispatchAdapter() {
    return createProviderDispatchAdapter(this, { metadata: { name: this.name }, requiredMethods: ["generateVideo"] });
  }
  async generateVideo(input: Parameters<VideoProvider["generateVideo"]>[0]) {
    return {
      success: true as const, provider: "ffmpeg" as const, generationMode: "production" as const,
      scenes: input.scenes.map((scene) => {
        const paths = VideoStorage.createSceneRenderPaths(input.projectSlug, scene.sceneId);
        const data = mp4(scene.motionPlan.durationSeconds);
        fsSync.writeFileSync(paths.temporaryAbsolutePath, data);
        VideoStorage.finalize(paths.temporaryAbsolutePath, paths.absolutePath);
        return { sceneId: scene.sceneId, sourceImageAssetId: scene.sourceImageAssetId, animationAssetId: scene.animationAssetId, provider: "ffmpeg" as const, model: "ffmpeg-h264", generationMode: "production" as const, filePath: paths.filePath, url: paths.url, mimeType: "video/mp4" as const, byteLength: data.length, durationSeconds: scene.motionPlan.durationSeconds, width: 1920 as const, height: 1080 as const, frameRate: 30 as const, transition: scene.motionPlan.transition, status: "generated" as const, createdAt: now };
      }),
    };
  }
}

class StoredAssemblyProvider implements VideoAssemblyProvider {
  readonly name = "ffmpeg" as const;
  createImmutableAssemblyDispatchAdapter() {
    return createProviderDispatchAdapter(this, { metadata: { name: this.name }, requiredMethods: ["assemble"] });
  }
  async assemble(input: Parameters<VideoAssemblyProvider["assemble"]>[0]) {
    const duration = input.scenes.reduce((sum, scene) => sum + scene.durationSeconds, 0);
    const paths = VideoStorage.createRenderPaths(input.projectSlug);
    const data = mp4(duration);
    fsSync.writeFileSync(paths.temporaryAbsolutePath, data);
    VideoStorage.finalize(paths.temporaryAbsolutePath, paths.absolutePath);
    return { success: true as const, provider: this.name, status: "rendered" as const, model: "ffmpeg-h264-aac" as const, filePath: paths.filePath, url: paths.url, mimeType: "video/mp4" as const, byteLength: data.length, durationSeconds: duration, width: 1920 as const, height: 1080 as const, videoCodec: "h264" as const, audioCodec: "aac" as const, createdAt: now };
  }
}

class ThrowingAssemblyProvider implements VideoAssemblyProvider {
  readonly name = "ffmpeg" as const;
  createImmutableAssemblyDispatchAdapter() {
    return createProviderDispatchAdapter(this, { metadata: { name: this.name }, requiredMethods: ["assemble"] });
  }
  async assemble(): Promise<never> {
    throw new Error("Injected bounded-execute assembly failure.");
  }
}

class CountingThumbnailProvider implements ThumbnailProvider {
  readonly name = "openai" as const;
  calls = 0;
  createImmutableThumbnailDispatchAdapter() {
    return createProviderDispatchAdapter(this, { metadata: { name: this.name }, requiredMethods: ["generateThumbnailPlan", "generateThumbnailAsset"] });
  }
  async generateThumbnailPlan(input: Parameters<ThumbnailProvider["generateThumbnailPlan"]>[0]) {
    this.calls += 1;
    const thumbnail = createMockThumbnailData(input);
    return { provider: this.name, model: "deterministic-thumbnail-plan-v1", status: "planned" as const, thumbnail: { ...thumbnail, provider: this.name, model: "deterministic-thumbnail-plan-v1" } };
  }
  async generateThumbnailAsset(input: Parameters<ThumbnailProvider["generateThumbnailAsset"]>[0]) {
    this.calls += 1;
    const assetId = "bounded-execute-thumbnail";
    return { success: true as const, assetId, provider: this.name, model: "deterministic-thumbnail-v1", status: "generated" as const, generationMode: "production" as const, ...ThumbnailStorage.saveThumbnail({ projectSlug: input.projectSlug, assetId, data: png(), mimeType: "image/png" }), createdAt: now };
  }
}

class CountingYouTubeProvider implements YouTubeProvider {
  readonly name = "mock" as const;
  readonly model = "deterministic-youtube-package-v1";
  calls = 0;
  createImmutableYoutubeDispatchAdapter() {
    return createProviderDispatchAdapter(this, { metadata: { name: this.name, model: this.model }, requiredMethods: ["generatePublishingPackage"] });
  }
  async generatePublishingPackage() {
    this.calls += 1;
    return {
      success: true as const, provider: this.name, model: this.model,
      draft: { title: "İstanbul'un Fethi", description: "Fatih Sultan Mehmet ve 1453 fethini anlatan paket.", tags: ["İstanbul", "1453"], hashtags: ["#İstanbul", "#Tarih"], chapters: [{ startSeconds: 0, title: "Fetih" }], pinnedComment: "Fetih hakkındaki görüşünüz nedir?", thumbnailText: "1453" },
    };
  }
}

// --- deterministic media byte helpers (from smoke-production-end-to-end.ts) ---
function wav() {
  const samples = Buffer.alloc(16_000 * 2);
  const out = Buffer.alloc(44 + samples.length);
  out.write("RIFF", 0); out.writeUInt32LE(out.length - 8, 4); out.write("WAVEfmt ", 8);
  out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(1, 22);
  out.writeUInt32LE(16_000, 24); out.writeUInt32LE(32_000, 28); out.writeUInt16LE(2, 32);
  out.writeUInt16LE(16, 34); out.write("data", 36); out.writeUInt32LE(samples.length, 40);
  samples.copy(out, 44);
  return out;
}
function mp4(duration: number) {
  const mvhd = Buffer.alloc(20);
  mvhd.writeUInt32BE(1_000, 12);
  mvhd.writeUInt32BE(Math.max(1, Math.round(duration * 1_000)), 16);
  return Buffer.concat([box("ftyp", Buffer.from("isom0000")), box("moov", Buffer.concat([box("mvhd", mvhd), track("vide"), track("soun")])), box("mdat", Buffer.from([1]))]);
}
function track(handler: "vide" | "soun") {
  const hdlr = Buffer.alloc(12);
  hdlr.write(handler, 8, 4, "ascii");
  return box("trak", box("mdia", box("hdlr", hdlr)));
}
function box(type: string, body: Buffer) {
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(out.length, 0); out.write(type, 4, 4, "ascii"); body.copy(out, 8);
  return out;
}
function png() {
  const raw = Buffer.from([0, 32, 64, 96]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk("IHDR", ihdr), pngChunk("IDAT", deflateSync(raw)), pngChunk("IEND", Buffer.alloc(0))]);
}
function pngChunk(type: string, data: Buffer) {
  const t = Buffer.from(type);
  const out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length, 0); t.copy(out, 4); data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([t, data])), data.length + 8);
  return out;
}
function crc32(data: Buffer) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// ---------------------------------------------------------------------------

async function main() {
  // A + C need no runtime; B drives a real fresh pipeline run.
  await commandContract();
  orchestratorStructuralGuard();

  const outcome = await withCanonicalSmokeRuntime(
    { name: "execute-stage-bounded" },
    async () => {
      await boundedRun();
      await unboundedRunUnchanged();
      await boundedRunFailureSafety();
    },
  );

  pass(outcome.finalization.cleanupCompleted, "owned temp runtime is cleaned");
  pass(outcome.finalization.sharedAuthorityUnchanged, "shared runtime authority is unchanged");
  pass(
    outcome.finalization.lockGateQuarantineRemainder === 0,
    "no lock, gate, or quarantine remainder survives",
  );

  console.log(`execute --stop-after-stage bounded smoke: PASS (${scenarios} scenarios)`);
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
