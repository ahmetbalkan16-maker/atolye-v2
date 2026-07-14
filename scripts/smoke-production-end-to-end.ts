import assert from "node:assert/strict";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { deflateSync } from "node:zlib";
import { AssetManager } from "../src/lib/assets/AssetManager";
import { AudioStorage } from "../src/lib/assets/storage/AudioStorage";
import { ImageStorage } from "../src/lib/assets/storage/ImageStorage";
import { VideoStorage } from "../src/lib/assets/storage/VideoStorage";
import { ThumbnailStorage } from "../src/lib/thumbnail/ThumbnailStorage";
import { createMockThumbnailData } from "../src/lib/thumbnail/providers/MockThumbnailProvider";
import { PipelineRunner } from "../src/lib/pipeline/PipelineRunner";
import { pipelineRecoveryStageOrder } from "../src/lib/pipeline/PipelineRecoveryPlanner";
import { ImageProviderRouter } from "../src/lib/assets/providers/ImageProviderRouter";
import { ProjectManager } from "../src/lib/projects/ProjectManager";
import { ProjectReader } from "../src/lib/projects/ProjectReader";
import { ProjectWriter } from "../src/lib/projects/ProjectWriter";
import {
  ProductionEndToEndValidationError,
  validateProductionEndToEnd,
  type ProductionEndToEndValidationCode,
} from "../src/lib/production/ProductionEndToEndValidation";
import { MockYouTubePublishProvider } from "../src/lib/youtube/publish/providers/MockYouTubePublishProvider";
import { getProductionRuntimeStatus, initializeProductionProcessRuntime } from "../src/lib/runtime/ProductionRuntimeCompositionRoot";
import type { AIProvider } from "../src/lib/ai/providers";
import type { AudioProvider } from "../src/lib/audio/providers/AudioProvider";
import type { ImageProvider } from "../src/lib/assets/providers/ImageProvider";
import type { VideoProvider } from "../src/lib/video/providers/VideoProvider";
import type { VideoAssemblyProvider } from "../src/lib/assembly/providers/VideoAssemblyProvider";
import { getFFmpegVideoAssemblyConfig } from "../src/lib/assembly/providers/VideoAssemblyProviderConfig";
import type { ThumbnailProvider } from "../src/lib/thumbnail/providers/ThumbnailProvider";
import type { YouTubeProvider } from "../src/lib/youtube/providers/YouTubeProvider";
import type { ProjectAssets } from "../src/types/asset";
import type { PipelineJobHistory, PipelineJobList } from "../src/types/pipelineJob";

const topic = "Sprint 125 Doğrulama - Fatih Sultan Mehmet'in İstanbul'u Fethi";
const slug = ProjectManager.createSlug(topic);
const root = ProjectReader.getProjectFolder(slug);
const sentinel = "sprint-125-validation.json";
const runToken = crypto.randomUUID();
const now = "2026-07-14T12:00:00.000Z";
let passed = 0;

async function main() {
  const previousDurableFlag = process.env.ATOLYE_DURABLE_PIPELINE_EXECUTION;
  try {
    await removeFixture({ allowStaleOwner: true });
    await fixtureGuardScenarios();
    process.env.ATOLYE_DURABLE_PIPELINE_EXECUTION = "enabled";
    const runtime = await initializeProductionProcessRuntime();
    assert.equal(runtime.ok, true);
    pass();
    await fs.mkdir(root, { recursive: false });
    await fs.writeFile(path.join(root, sentinel), JSON.stringify({ owner: "sprint-125", slug, runToken, pid: process.pid }), "utf8");

    const result = await PipelineRunner.run(topic, {
      stageExecution: {
        aiProvider: new DeterministicAIProvider(),
        visualAssetProvider: new StoredImageProvider(),
        videoProvider: new StoredSceneVideoProvider(),
        audioProvider: new StoredAudioProvider(),
        videoAssemblyProvider: new StoredAssemblyProvider(),
        thumbnailProvider: new StoredThumbnailProvider(),
        youtubeProvider: new DeterministicYouTubeProvider(),
        youtubePublishProvider: new MockYouTubePublishProvider(),
      },
    });
    assert.equal(result.success, true);
    assert.equal(result.slug, slug);
    pass();

    const runtimeStatus = getProductionRuntimeStatus();
    const validation = await validateProductionEndToEnd(slug, { runtimeStatus });
    assert.equal(validation.stages.length, 12);
    assert.equal(validation.stages, pipelineRecoveryStageOrder);
    assert.ok(validation.assetCount > 0);
    assert.equal(validation.productionReady, false);
    assert.deepEqual(validation.videoValidation, { mode: "structural-only", reasonCode: "FFPROBE_NOT_EXECUTED" });
    pass();
    await expectFailure("RUNTIME_NOT_READY", () => validateProductionEndToEnd(slug, { runtimeStatus: { ...runtimeStatus, workerReady: false } }));

    const baselineAssets = AssetManager.getProjectAssets(slug, result.project.id);
    const baselineJobs = await readJson<PipelineJobList>("pipeline-jobs.json");
    const baselineHistory = await readJson<PipelineJobHistory>("pipeline-history.json");
    const baselineYouTube = await readJson<Record<string, unknown>>("youtube.json");

    const researchJob = baselineJobs.jobs.find((job) => job.stage === "research")!;
    const researchCompletionIndex = baselineHistory.events.findIndex((event) => event.jobId === researchJob.id && event.status === "completed");
    const failedAttempt = { ...baselineHistory.events[researchCompletionIndex], id: `${researchJob.id}-failed-attempt`, status: "failed" as const };
    await ProjectWriter.writeJSONAtomically(slug, "pipeline-jobs.json", { ...baselineJobs, jobs: baselineJobs.jobs.map((job) => job.id === researchJob.id ? { ...job, attempts: 1 } : job) });
    await ProjectWriter.writeJSONAtomically(slug, "pipeline-history.json", { ...baselineHistory, events: [...baselineHistory.events.slice(0, researchCompletionIndex), failedAttempt, ...baselineHistory.events.slice(researchCompletionIndex)] });
    await validate(); pass();
    await ProjectWriter.writeJSONAtomically(slug, "pipeline-jobs.json", baselineJobs);
    await ProjectWriter.writeJSONAtomically(slug, "pipeline-history.json", baselineHistory);

    await ProjectWriter.writeJSONAtomically(slug, "pipeline-jobs.json", { ...baselineJobs, jobs: [...baselineJobs.jobs, { ...researchJob, id: `${researchJob.id}-duplicate` }] });
    await expectFailure("JOB_STATE_INVALID", validate);
    await ProjectWriter.writeJSONAtomically(slug, "pipeline-jobs.json", baselineJobs);

    const activeImage = baselineAssets.assets.find((asset) => asset.type === "image")!;
    await mutateAssets(baselineAssets, (assets) => [...assets, { ...activeImage, id: `${activeImage.id}-obsolete` }]);
    await validate(); pass();
    await restoreAssets(baselineAssets);

    const originalInspectImage = ImageStorage.inspectStoredImage;
    let snapshotMutated = false;
    ImageStorage.inspectStoredImage = function (...args) {
      const inspection = originalInspectImage.apply(ImageStorage, args);
      if (!snapshotMutated) {
        snapshotMutated = true;
        AssetManager.saveProjectAssetsAtomically(slug, { ...baselineAssets, assets: [...baselineAssets.assets, { ...activeImage, id: `${activeImage.id}-concurrent` }] });
      }
      return inspection;
    };
    try { await expectFailure("SNAPSHOT_CHANGED", validate); }
    finally { ImageStorage.inspectStoredImage = originalInspectImage; await restoreAssets(baselineAssets); }

    await mutateAssets(baselineAssets, (assets) => assets.filter((asset) => asset.type !== "image"));
    await expectFailure("VISUAL_ASSET_INVALID", validate);
    await restoreAssets(baselineAssets);

    const audioAsset = baselineAssets.assets.find((asset) => asset.type === "audio")!;
    await corruptFile(audioAsset.filePath!, async () => expectFailure("AUDIO_ASSET_INVALID", validate));

    await mutateAssets(baselineAssets, (assets) => assets.filter((asset) => !(asset.type === "video" && asset.artifactType === "scene-video")));
    await expectFailure("SCENE_VIDEO_ASSET_INVALID", validate);
    await restoreAssets(baselineAssets);

    const finalVideo = baselineAssets.assets.find((asset) => asset.id === result.assembly?.outputAssetId)!;
    await corruptFile(finalVideo.filePath!, async () => expectFailure("FINAL_VIDEO_INVALID", validate));

    await mutateAssets(baselineAssets, (assets) => assets.filter((asset) => asset.type !== "thumbnail"));
    await expectFailure("THUMBNAIL_ASSET_INVALID", validate);
    await restoreAssets(baselineAssets);

    await mutateAssets(baselineAssets, (assets) => assets.map((asset) => asset.type === "image" ? { ...asset, filePath: "data/projects/foreign/assets/images/wrong.png" } : asset));
    await expectFailure("VISUAL_ASSET_INVALID", validate);
    await restoreAssets(baselineAssets);

    await ProjectWriter.writeJSONAtomically(slug, "pipeline-history.json", { ...baselineHistory, events: [baselineHistory.events[1], baselineHistory.events[0], ...baselineHistory.events.slice(2)] });
    await expectFailure("STAGE_ORDER_INVALID", validate);
    await ProjectWriter.writeJSONAtomically(slug, "pipeline-history.json", baselineHistory);

    await ProjectWriter.writeJSONAtomically(slug, "youtube.json", { ...baselineYouTube, videoAssetId: "missing-final-video" });
    await expectFailure("PUBLISH_PACKAGE_INVALID", validate);
    await ProjectWriter.writeJSONAtomically(slug, "youtube.json", baselineYouTube);

    await validate();
    const defaultProvider = ImageProviderRouter.getProvider().name;
    await assert.rejects(new ThrowingImageProvider().generateImage({ prompt: "failure", sceneId: 1 }));
    assert.equal(ImageProviderRouter.getProvider().name, defaultProvider);
    pass();

    const previousFFmpegPath = process.env.FFMPEG_PATH;
    const previousFFprobePath = process.env.FFPROBE_PATH;
    try {
      process.env.FFMPEG_PATH = path.resolve("ffmpeg-test.exe");
      delete process.env.FFPROBE_PATH;
      assert.throws(() => getFFmpegVideoAssemblyConfig(), (error) => error instanceof Error && error.name === "VideoAssemblyConfigurationError" && error.stack === undefined);
      pass();
    } finally {
      if (previousFFmpegPath === undefined) delete process.env.FFMPEG_PATH; else process.env.FFMPEG_PATH = previousFFmpegPath;
      if (previousFFprobePath === undefined) delete process.env.FFPROBE_PATH; else process.env.FFPROBE_PATH = previousFFprobePath;
    }

    assert.equal(passed, 20);
    console.log(`Sprint 125 production end-to-end validation: PASS (${passed} scenarios)`);
  } finally {
    PipelineRunner.configureDurableExecution();
    PipelineRunner.configureContinuationAdmission();
    if (previousDurableFlag === undefined) delete process.env.ATOLYE_DURABLE_PIPELINE_EXECUTION;
    else process.env.ATOLYE_DURABLE_PIPELINE_EXECUTION = previousDurableFlag;
    await removeFixture();
  }
}

async function validate() { await validateProductionEndToEnd(slug, { runtimeStatus: getProductionRuntimeStatus() }); }
async function expectFailure(code: ProductionEndToEndValidationCode, action: () => Promise<unknown>) {
  await assert.rejects(action, (error) => error instanceof ProductionEndToEndValidationError && error.code === code && !/[A-Z]:\\|stack|secret/i.test(error.message));
  pass();
}
async function mutateAssets(baseline: ProjectAssets, mutate: (assets: ProjectAssets["assets"]) => ProjectAssets["assets"]) {
  AssetManager.saveProjectAssetsAtomically(slug, { ...baseline, assets: mutate(baseline.assets) });
}
async function restoreAssets(baseline: ProjectAssets) { AssetManager.saveProjectAssetsAtomically(slug, baseline); }
async function corruptFile(relativePath: string, action: () => Promise<void>) {
  const absolutePath = path.resolve(...relativePath.split("/"));
  const baseline = await fs.readFile(absolutePath);
  try { await fs.writeFile(absolutePath, Buffer.from("corrupt")); await action(); }
  finally { await fs.writeFile(absolutePath, baseline); }
}
async function readJson<T>(fileName: string) { return JSON.parse(await fs.readFile(path.join(root, fileName), "utf8")) as T; }
async function removeFixture(options: { allowStaleOwner?: boolean } = {}) {
  requireFixtureRoot(root, slug);
  try {
    const marker = JSON.parse(await fs.readFile(path.join(root, sentinel), "utf8")) as { owner?: unknown; slug?: unknown; runToken?: unknown; pid?: unknown };
    if (marker.owner !== "sprint-125" || marker.slug !== slug) throw new Error("Sprint 125 fixture ownership check failed.");
    if (marker.runToken !== runToken) {
      if (!options.allowStaleOwner || (typeof marker.pid === "number" && processIsAlive(marker.pid))) throw new Error("Sprint 125 fixture is owned by another active run.");
    }
    await fs.rm(root, { recursive: true, force: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
async function fixtureGuardScenarios() {
  const collisionSlug = `${slug}-collision`;
  const collisionRoot = ProjectReader.getProjectFolder(collisionSlug);
  await fs.mkdir(collisionRoot, { recursive: false });
  try {
    await assert.rejects(removeOwnedFixture(collisionRoot, collisionSlug), /ownership check failed/);
    pass();
  } finally { await fs.rm(collisionRoot, { recursive: true, force: true }); }
  await assert.rejects(removeOwnedFixture(ProjectReader.getProjectsRoot(), slug), /outside the fixture root/);
  pass();
}
async function removeOwnedFixture(target: string, expectedSlug: string) {
  requireFixtureRoot(target, expectedSlug);
  let marker: { owner?: unknown; slug?: unknown };
  try { marker = JSON.parse(await fs.readFile(path.join(target, sentinel), "utf8")) as { owner?: unknown; slug?: unknown }; }
  catch { throw new Error("Sprint 125 fixture ownership check failed."); }
  if (marker.owner !== "sprint-125" || marker.slug !== expectedSlug) throw new Error("Sprint 125 fixture ownership check failed.");
  await fs.rm(target, { recursive: true, force: true });
}
function requireFixtureRoot(target: string, expectedSlug: string) {
  const expected = path.resolve(ProjectReader.getProjectFolder(expectedSlug));
  const actual = path.resolve(target);
  const projects = path.resolve(ProjectReader.getProjectsRoot());
  const relative = path.relative(projects, actual);
  if (actual !== expected || !relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Fixture cleanup target is outside the fixture root.");
}
function processIsAlive(pid: number) { try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; } }
function pass() { passed += 1; }

class DeterministicAIProvider implements AIProvider {
  async generate(prompt: string) {
    if (prompt.includes("documentary research assistant")) return JSON.stringify({ topic, summary: "İstanbul'un fethine ilişkin deterministik araştırma.", historicalContext: "1453", timeline: ["1453: Fetih"], characters: ["Fatih Sultan Mehmet"], locations: ["İstanbul"], keyEvents: ["Fetih"], strategies: ["Kuşatma"], controversies: [], interestingFacts: [], documentaryFlow: ["Hazırlık", "Fetih"], sceneIdeas: ["Surlar"], imagePrompts: ["İstanbul surları"], animationPrompts: ["Yavaş yaklaşma"], musicIdeas: ["Sinematik"], soundEffects: ["Top sesi"], thumbnailIdeas: ["Fatih ve surlar"], youtubeTitles: ["İstanbul'un Fethi"], sources: ["Deterministik fixture"], createdAt: now });
    if (prompt.includes("documentary script writer")) return JSON.stringify({ topic, title: "İstanbul'un Fethi", subtitle: "Bir çağın kapanışı", hook: "1453'te dünya değişti.", introduction: "Fatih'in hazırlıkları başladı.", chapters: [{ id: 1, title: "Fetih", narration: "Osmanlı ordusu İstanbul surlarına ulaştı.", duration: 2, visualGoal: "İstanbul surları", emotion: "kararlı", transition: "fade" }], conclusion: "İstanbul fethedildi.", callToAction: "Takip edin.", estimatedDuration: 2, narrationWordCount: 12, targetAudience: "genel", language: "tr", voiceStyle: "documentary", musicStyle: "cinematic", thumbnailIdea: "Fatih", seoKeywords: ["İstanbul'un fethi"], createdAt: now });
    if (prompt.includes("documentary scene planner")) return JSON.stringify({ scenes: [{ id: 1, title: "Fetih", description: "Fatih ve İstanbul surları.", visualPrompt: "1453 İstanbul surları, sinematik", duration: 2 }], createdAt: now });
    return "";
  }
}

class StoredImageProvider implements ImageProvider {
  readonly name = "openai" as const;
  async generateImage(input: Parameters<ImageProvider["generateImage"]>[0]) {
    const id = `sprint-125-image-${input.sceneId}`;
    const saved = ImageStorage.saveImage({ projectSlug: input.projectSlug!, assetId: id, data: png(), mimeType: "image/png" });
    return { success: true as const, id, sceneId: input.sceneId, provider: this.name, model: "deterministic-image-v1", ...saved, mimeType: "image/png" as const, createdAt: now };
  }
}
class ThrowingImageProvider implements ImageProvider {
  readonly name = "openai" as const;
  async generateImage(_input: Parameters<ImageProvider["generateImage"]>[0]): Promise<never> { void _input; throw new Error("Injected provider failure."); }
}
class StoredAudioProvider implements AudioProvider {
  readonly name = "openai" as const;
  validateInput() {}
  async generateAudio(input: Parameters<AudioProvider["generateAudio"]>[0]) {
    const id = input.target.kind === "mix" ? "sprint-125-audio-mix" : `sprint-125-audio-${input.target.chapterId}`;
    return { success: true as const, target: input.target, provider: this.name, model: "deterministic-audio-v1", ...AudioStorage.saveAudio({ projectSlug: input.projectSlug, assetId: id, data: wav() }), createdAt: now };
  }
}
class StoredSceneVideoProvider implements VideoProvider {
  readonly name = "ffmpeg";
  async generateVideo(input: Parameters<VideoProvider["generateVideo"]>[0]) {
    return { success: true as const, provider: "ffmpeg" as const, generationMode: "production" as const, scenes: input.scenes.map((scene) => {
      const paths = VideoStorage.createSceneRenderPaths(input.projectSlug, scene.sceneId);
      const data = mp4(scene.motionPlan.durationSeconds); fsSync.writeFileSync(paths.temporaryAbsolutePath, data); VideoStorage.finalize(paths.temporaryAbsolutePath, paths.absolutePath);
      return { sceneId: scene.sceneId, sourceImageAssetId: scene.sourceImageAssetId, animationAssetId: scene.animationAssetId, provider: "ffmpeg" as const, model: "ffmpeg-h264", generationMode: "production" as const, filePath: paths.filePath, url: paths.url, mimeType: "video/mp4" as const, byteLength: data.length, durationSeconds: scene.motionPlan.durationSeconds, width: 1920 as const, height: 1080 as const, frameRate: 30 as const, transition: scene.motionPlan.transition, status: "generated" as const, createdAt: now };
    }) };
  }
}
class StoredAssemblyProvider implements VideoAssemblyProvider {
  readonly name = "ffmpeg" as const;
  async assemble(input: Parameters<VideoAssemblyProvider["assemble"]>[0]) {
    const duration = input.scenes.reduce((sum, scene) => sum + scene.durationSeconds, 0);
    const paths = VideoStorage.createRenderPaths(input.projectSlug); const data = mp4(duration); fsSync.writeFileSync(paths.temporaryAbsolutePath, data); VideoStorage.finalize(paths.temporaryAbsolutePath, paths.absolutePath);
    return { success: true as const, provider: this.name, status: "rendered" as const, model: "ffmpeg-h264-aac" as const, filePath: paths.filePath, url: paths.url, mimeType: "video/mp4" as const, byteLength: data.length, durationSeconds: duration, width: 1920 as const, height: 1080 as const, videoCodec: "h264" as const, audioCodec: "aac" as const, createdAt: now };
  }
}
class StoredThumbnailProvider implements ThumbnailProvider {
  readonly name = "openai" as const;
  async generateThumbnailPlan(input: Parameters<ThumbnailProvider["generateThumbnailPlan"]>[0]) {
    const thumbnail = createMockThumbnailData(input);
    return { provider: this.name, model: "deterministic-thumbnail-plan-v1", status: "planned" as const, thumbnail: { ...thumbnail, provider: this.name, model: "deterministic-thumbnail-plan-v1" } };
  }
  async generateThumbnailAsset(input: Parameters<ThumbnailProvider["generateThumbnailAsset"]>[0]) {
    const assetId = "sprint-125-thumbnail";
    return { success: true as const, assetId, provider: this.name, model: "deterministic-thumbnail-v1", status: "generated" as const, generationMode: "production" as const, ...ThumbnailStorage.saveThumbnail({ projectSlug: input.projectSlug, assetId, data: png(), mimeType: "image/png" }), createdAt: now };
  }
}
class DeterministicYouTubeProvider implements YouTubeProvider {
  readonly name = "mock" as const;
  readonly model = "deterministic-youtube-package-v1";
  async generatePublishingPackage() {
    return { success: true as const, provider: this.name, model: this.model, draft: { title: "İstanbul'un Fethi", description: "Fatih Sultan Mehmet ve 1453 fethini anlatan doğrulama paketi.", tags: ["İstanbul", "1453"], hashtags: ["#İstanbul", "#Tarih"], chapters: [{ startSeconds: 0, title: "Fetih" }], pinnedComment: "Fetih hakkındaki görüşünüz nedir?", thumbnailText: "1453" } };
  }
}

function wav() { const samples = Buffer.alloc(16_000 * 2); const out = Buffer.alloc(44 + samples.length); out.write("RIFF", 0); out.writeUInt32LE(out.length - 8, 4); out.write("WAVEfmt ", 8); out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(1, 22); out.writeUInt32LE(16_000, 24); out.writeUInt32LE(32_000, 28); out.writeUInt16LE(2, 32); out.writeUInt16LE(16, 34); out.write("data", 36); out.writeUInt32LE(samples.length, 40); samples.copy(out, 44); return out; }
function mp4(duration: number) { const mvhd = Buffer.alloc(20); mvhd.writeUInt32BE(1_000, 12); mvhd.writeUInt32BE(Math.max(1, Math.round(duration * 1_000)), 16); return Buffer.concat([box("ftyp", Buffer.from("isom0000")), box("moov", Buffer.concat([box("mvhd", mvhd), track("vide"), track("soun")])), box("mdat", Buffer.from([1]))]); }
function track(handler: "vide" | "soun") { const hdlr = Buffer.alloc(12); hdlr.write(handler, 8, 4, "ascii"); return box("trak", box("mdia", box("hdlr", hdlr))); }
function box(type: string, body: Buffer) { const out = Buffer.alloc(body.length + 8); out.writeUInt32BE(out.length, 0); out.write(type, 4, 4, "ascii"); body.copy(out, 8); return out; }
function png() { const raw = Buffer.from([0, 32, 64, 96]); const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 2; return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), pngChunk("IHDR", ihdr), pngChunk("IDAT", deflateSync(raw)), pngChunk("IEND", Buffer.alloc(0))]); }
function pngChunk(type: string, data: Buffer) { const t = Buffer.from(type); const out = Buffer.alloc(data.length + 12); out.writeUInt32BE(data.length, 0); t.copy(out, 4); data.copy(out, 8); out.writeUInt32BE(crc32(Buffer.concat([t, data])), data.length + 8); return out; }
function crc32(data: Buffer) { let crc = 0xffffffff; for (const byte of data) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); } return (crc ^ 0xffffffff) >>> 0; }

void main();
