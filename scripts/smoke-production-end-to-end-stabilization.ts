import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { deflateSync } from "node:zlib";
import { AssetManager } from "../src/lib/assets/AssetManager";
import { VideoStorage } from "../src/lib/assets/storage/VideoStorage";
import { PipelineRecoveryPlanner, pipelineRecoveryStageOrder } from "../src/lib/pipeline/PipelineRecoveryPlanner";
import { ProjectManager } from "../src/lib/projects/ProjectManager";
import { ProjectWriter } from "../src/lib/projects/ProjectWriter";
import { ThumbnailStorage } from "../src/lib/thumbnail/ThumbnailStorage";
import { YouTubePackagePipeline } from "../src/lib/youtube/YouTubePackagePipeline";
import type { YouTubeProvider } from "../src/lib/youtube/providers/YouTubeProvider";
import { YouTubePublishPipeline } from "../src/lib/youtube/publish/YouTubePublishPipeline";
import { createYouTubePackageIdentity } from "../src/lib/youtube/publish/YouTubePublishValidation";
import type { YouTubePublishProvider } from "../src/lib/youtube/publish/providers/YouTubePublishProvider";
import { YOUTUBE_PUBLISH_ERROR } from "../src/lib/youtube/publish/providers/YouTubePublishProvider";
import type { Asset, ProjectAssets } from "../src/types/asset";
import type { AssemblyPlanData } from "../src/types/assembly";
import type { Project, ProductionStepKey } from "../src/types/project";
import type { SEOData } from "../src/types/seo";
import type { ThumbnailData } from "../src/types/thumbnail";
import type { YouTubePublishingPackage } from "../src/types/youtube";
import type { YouTubePublishProviderResult, YouTubePublishRecord, YouTubePublishRequest } from "../src/types/youtubePublish";

const slug = `sprint-123-stabilization-${process.pid}`;
const root = path.resolve(process.cwd(), "data", "projects", slug);
const now = "2026-07-14T03:00:00.000Z";
const project: Project = { id: `project-${process.pid}`, slug, title: "Production End-to-End Stabilization", status: "youtube", createdAt: now, updatedAt: now };
let assembly: AssemblyPlanData;
let thumbnail: ThumbnailData;
let seo: SEOData;
let publishingPackage: YouTubePublishingPackage;
let baselineAssets: ProjectAssets;
let passed = 0;

async function main() {
  try {
    await setup();
    await happyPathAndReplay();
    await reconciliationAndRestart();
    await failureCancellationAndValidation();
    await recoveryPlannerConsistency();
    console.log(`Sprint 123 production end-to-end stabilization smoke: PASS (${passed} scenarios)`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function setup() {
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, "project.json"), JSON.stringify(project));
  await ProjectManager.createManifest(project);
  const videoPaths = VideoStorage.createRenderPaths(slug);
  fs.writeFileSync(videoPaths.temporaryAbsolutePath, minimalMp4());
  VideoStorage.finalize(videoPaths.temporaryAbsolutePath, videoPaths.absolutePath);
  const videoBytes = fs.statSync(videoPaths.absolutePath).size;
  const videoAsset = AssetManager.createAsset({ id: "final-video", projectId: project.id, projectSlug: slug, type: "video", status: "generated", provider: "ffmpeg", model: "ffmpeg", prompt: "assembly", filePath: videoPaths.filePath, url: videoPaths.url, mimeType: "video/mp4", byteLength: videoBytes, durationSeconds: 30 });
  const storedThumbnail = ThumbnailStorage.saveThumbnail({ projectSlug: slug, assetId: "thumbnail-final", data: png(1280, 720), mimeType: "image/png" });
  const thumbnailAsset = AssetManager.createAsset({ id: "thumbnail-final", projectId: project.id, projectSlug: slug, type: "thumbnail", status: "generated", provider: "mock", model: "mock-thumbnail", prompt: "thumbnail", generationMode: "mock", ...storedThumbnail });
  AssetManager.addAssetAtomically(slug, project.id, videoAsset);
  baselineAssets = AssetManager.addAssetAtomically(slug, project.id, thumbnailAsset);
  assembly = { projectId: project.id, slug, title: project.title, status: "assembled", outputAssetId: videoAsset.id, scenes: [{ sceneId: 1, duration: "00:30", visualReference: "visual", audioReference: "audio", transition: "fade", cameraMovement: "static", effects: [], notes: "Başlangıç" }], totalDuration: "00:30", style: "documentary", render: { status: "rendered", format: "mp4", mimeType: "video/mp4", filePath: videoPaths.filePath, outputUrl: videoPaths.url, byteLength: videoBytes, durationSeconds: 30 }, createdAt: now };
  thumbnail = { projectId: project.id, slug, provider: "mock", model: "mock-thumbnail", status: "generated", sourceAssemblyAssetId: videoAsset.id, outputAssetId: thumbnailAsset.id, variants: [{ id: "v1", title: "v", concept: "c", prompt: "p", negativePrompt: "n", style: "documentary", composition: "c", textOverlaySuggestion: "GERÇEK", priority: 1, status: "planned" }], titleIdea: "Başlık", concept: "Konsept", mainSubject: "Konu", composition: "Kompozisyon", colorStyle: "Renk", textSuggestion: "GERÇEK", imagePrompt: "Prompt", clickReason: "Merak", generation: { provider: "mock", model: "mock-thumbnail", assetId: thumbnailAsset.id, fileName: storedThumbnail.fileName, filePath: storedThumbnail.filePath, imageUrl: storedThumbnail.url, mimeType: storedThumbnail.mimeType, width: storedThumbnail.width, height: storedThumbnail.height, byteLength: storedThumbnail.byteLength, generationMode: "mock", status: "generated" }, createdAt: now };
  seo = { titleSuggestions: [project.title], description: "Stored canonical end-to-end package.", tags: ["Production", "Stabilization"], hashtags: ["#Production"], keywords: ["Pipeline"], targetAudience: "Creators", searchIntent: "Learn", createdAt: now };
  publishingPackage = { schemaVersion: "1", projectId: project.id, slug, provider: "mock", model: "mock-youtube-package-v1", status: "generated", title: project.title, description: seo.description, tags: seo.tags, hashtags: seo.hashtags, chapters: [{ startSeconds: 0, title: "Başlangıç" }], pinnedComment: "Yorumunuz nedir?", thumbnailText: "GERÇEK", videoAssetId: videoAsset.id, thumbnailAssetId: thumbnailAsset.id, generatedAt: now };
  await ProjectWriter.writeJSONAtomically(slug, "assembly.json", assembly);
  await ProjectWriter.writeJSONAtomically(slug, "thumbnail.json", thumbnail);
  await ProjectWriter.writeJSONAtomically(slug, "seo.json", seo);
  await ProjectManager.saveYouTube(slug, publishingPackage, { updatePackageStatus: false });
}

async function happyPathAndReplay() {
  assert.deepEqual(pipelineRecoveryStageOrder, ["research", "script", "scenes", "visuals", "animation", "video", "audio", "assembly", "thumbnail", "seo", "youtube", "export"]); pass();
  const provider = new CountingPublishProvider();
  const assemblyBefore = bytes("assembly.json"); const thumbnailBefore = bytes("thumbnail.json"); const packageBefore = bytes("youtube.json");
  const published = await publish(provider);
  assert.equal(published.status, "published"); assert.equal(provider.calls, 1); pass();
  const replay = await publish(provider);
  assert.deepEqual(replay, published); assert.equal(provider.calls, 1); pass();
  assert.deepEqual(bytes("assembly.json"), assemblyBefore); pass();
  assert.deepEqual(bytes("thumbnail.json"), thumbnailBefore); pass();
  assert.deepEqual(bytes("youtube.json"), packageBefore); pass();
  const packageProvider = new NeverPackageProvider();
  const packageReplay = await YouTubePackagePipeline.generatePackage({ project, assembly, thumbnail, seo, provider: packageProvider });
  assert.deepEqual(packageReplay, publishingPackage); assert.equal(packageProvider.calls, 0); pass();
  assert.equal(fs.existsSync(path.join(root, "youtube-publish-recovery.json")), false); pass();
}

async function reconciliationAndRestart() {
  await resetPublish();
  const provider = new CountingPublishProvider();
  const original = ProjectManager.saveYouTubePublish;
  let failFinal = true;
  ProjectManager.saveYouTubePublish = async (projectSlug, value) => {
    if (failFinal && (value as { status?: unknown }).status === "published") {
      failFinal = false;
      throw new Error("injected final persistence failure");
    }
    return original.call(ProjectManager, projectSlug, value);
  };
  try { await assert.rejects(() => publish(provider)); } finally { ProjectManager.saveYouTubePublish = original; }
  assert.equal(provider.calls, 1); assert.equal(fs.existsSync(path.join(root, "youtube-publish-recovery.json")), true); pass();
  const recovered = await publish(provider);
  assert.equal(recovered.status, "published"); assert.equal(provider.calls, 1); pass();
  assert.equal(fs.existsSync(path.join(root, "youtube-publish-recovery.json")), false); pass();

  await resetPublish();
  const receipt = publishedRecord("restart-receipt");
  await ProjectManager.saveYouTubePublish(slug, publishingIntent(receipt));
  await ProjectManager.saveYouTubePublishRecovery(slug, receipt);
  const restartProvider = new CountingPublishProvider();
  const restartRecovered = await publish(restartProvider);
  assert.equal(restartRecovered.status, "published"); assert.equal(restartProvider.calls, 0); pass();

  await resetPublish();
  const interruptedPackageProvider = new CountingPublishProvider();
  const interruptedPackage = await publish(interruptedPackageProvider);
  assert.equal(interruptedPackage.status, "published"); assert.equal(interruptedPackageProvider.calls, 1); pass();
}

async function failureCancellationAndValidation() {
  await resetPublish();
  const failure = new ExplicitFailureProvider();
  await assert.rejects(() => publish(failure));
  const failed = await ProjectManager.getYouTubePublish(slug) as YouTubePublishRecord | null;
  assert.equal(failed?.status, "failed"); pass();

  await resetPublish();
  const timeout = new IndeterminateProvider();
  await assert.rejects(() => publish(timeout));
  const intent = await ProjectManager.getYouTubePublish(slug) as YouTubePublishRecord | null;
  assert.equal(intent?.status, "publishing"); pass();
  await assert.rejects(() => publish(timeout)); assert.equal(timeout.calls, 1); pass();

  await resetPublish();
  const controller = new AbortController(); controller.abort();
  const cancelled = new CountingPublishProvider();
  await assert.rejects(() => YouTubePublishPipeline.publishStoredPackage({ projectSlug: slug, provider: cancelled, signal: controller.signal }));
  assert.equal(cancelled.calls, 0); assert.equal(await ProjectManager.getYouTubePublish(slug), null); pass();

  await mutateAssets((items) => items.filter((asset) => asset.id !== publishingPackage.videoAssetId));
  await mutateAssets((items) => [...items, { ...items.find((asset) => asset.id === publishingPackage.thumbnailAssetId)! }]);
  await mutateAssets((items) => items.map((asset) => asset.id === publishingPackage.thumbnailAssetId ? { ...asset, projectId: "cross-project" } : asset));

  await resetPublish();
  await ProjectManager.saveYouTubePublish(slug, { ...publishedRecord("stale"), packageIdentity: "a".repeat(64) });
  const staleProvider = new CountingPublishProvider();
  await assert.rejects(() => publish(staleProvider)); assert.equal(staleProvider.calls, 0); pass();

  await resetPublish();
  await ProjectWriter.writeJSONAtomically(slug, "youtube-publish-recovery.json", { schemaVersion: "legacy" });
  const corruptRecoveryProvider = new CountingPublishProvider();
  await assert.rejects(() => publish(corruptRecoveryProvider));
  assert.equal(corruptRecoveryProvider.calls, 0); pass();
  await resetPublish();
}

async function recoveryPlannerConsistency() {
  await resetPublish();
  await markAllCompleted();
  const resume = await PipelineRecoveryPlanner.createResumePlan(slug);
  assert.equal(resume.startStage, "youtube"); pass();

  const receipt = publishedRecord("planner-restart");
  await ProjectManager.saveYouTubePublish(slug, publishingIntent(receipt));
  await ProjectManager.saveYouTubePublishRecovery(slug, receipt);
  const beforePromotion = await PipelineRecoveryPlanner.createResumePlan(slug);
  assert.equal(beforePromotion.startStage, "youtube"); pass();
  await publish(new CountingPublishProvider());
  const afterPromotion = await PipelineRecoveryPlanner.createResumePlan(slug);
  assert.equal(afterPromotion.startStage, "export"); pass();

  await ProjectWriter.writeJSONAtomically(slug, "youtube-publish.json", { schemaVersion: "legacy" });
  const malformed = await PipelineRecoveryPlanner.createResumePlan(slug);
  assert.equal(malformed.startStage, "youtube"); pass();
}

async function publish(provider: YouTubePublishProvider) {
  return YouTubePublishPipeline.publishStoredPackage({ projectSlug: slug, provider, timestamp: now, attemptId: "attempt-stabilization" });
}

async function resetPublish() {
  await ProjectManager.removeYouTubePublish(slug);
  await ProjectManager.removeYouTubePublishRecovery(slug);
}

async function mutateAssets(change: (items: Asset[]) => Asset[]) {
  await resetPublish();
  AssetManager.saveProjectAssetsAtomically(slug, { ...baselineAssets, assets: change(baselineAssets.assets) });
  try { await assert.rejects(() => publish(new CountingPublishProvider())); pass(); }
  finally { AssetManager.saveProjectAssetsAtomically(slug, baselineAssets); await resetPublish(); }
}

async function markAllCompleted() {
  for (const stage of pipelineRecoveryStageOrder) {
    if (stage !== "youtube" && stage !== "export") {
      const file = stageFile(stage);
      if (!fs.existsSync(path.join(root, file))) {
        await ProjectWriter.writeJSONAtomically(
          slug,
          file,
          stage === "video"
            ? { projectId: project.id, status: "generated", scenes: [{ sceneId: 1, sourceAnimationAssetId: "animation-1", status: "generated" }], createdAt: now }
            : { ready: true },
        );
      }
    }
    await ProjectManager.updatePackageStatus(slug, stage, "completed");
  }
  await ProjectWriter.removeJSON(slug, "export.json");
  await ProjectManager.updatePackageStatus(slug, "export", "pending");
}

function stageFile(stage: ProductionStepKey) {
  return stage === "scenes" ? "scenes.json" : `${stage}.json`;
}

function publishedRecord(remoteVideoId: string): Extract<YouTubePublishRecord, { status: "published" }> {
  return { schemaVersion: "1", projectId: project.id, slug, packageIdentity: createYouTubePackageIdentity(publishingPackage), videoAssetId: publishingPackage.videoAssetId, thumbnailAssetId: publishingPackage.thumbnailAssetId, provider: "mock", model: "stabilization-provider", attemptId: "attempt-stabilization", status: "published", remoteVideoId, remoteVideoUrl: `https://www.youtube.com/watch?v=${remoteVideoId}`, channelId: "channel", publishedAt: now, createdAt: now };
}

function publishingIntent(
  record: Extract<YouTubePublishRecord, { status: "published" }>,
): Extract<YouTubePublishRecord, { status: "publishing" }> {
  return {
    schemaVersion: record.schemaVersion,
    projectId: record.projectId,
    slug: record.slug,
    packageIdentity: record.packageIdentity,
    videoAssetId: record.videoAssetId,
    thumbnailAssetId: record.thumbnailAssetId,
    provider: record.provider,
    ...(record.model ? { model: record.model } : {}),
    attemptId: record.attemptId,
    status: "publishing",
    createdAt: record.createdAt,
  };
}

class CountingPublishProvider implements YouTubePublishProvider {
  readonly name = "mock" as const; readonly model = "stabilization-provider"; calls = 0;
  async publish(request: YouTubePublishRequest): Promise<YouTubePublishProviderResult> { this.calls++; const id = `stable-${request.packageIdentity.slice(0, 16)}`; return { success: true, provider: this.name, model: this.model, remoteVideoId: id, remoteVideoUrl: `https://www.youtube.com/watch?v=${id}`, channelId: "channel" }; }
}

class ExplicitFailureProvider implements YouTubePublishProvider {
  readonly name = "mock" as const; readonly model = "stabilization-provider";
  async publish(): Promise<YouTubePublishProviderResult> { return { success: false, provider: this.name, model: this.model, outcome: "failed", error: YOUTUBE_PUBLISH_ERROR }; }
}

class IndeterminateProvider implements YouTubePublishProvider {
  readonly name = "mock" as const; readonly model = "stabilization-provider"; calls = 0;
  async publish(): Promise<YouTubePublishProviderResult> { this.calls++; return { success: false, provider: this.name, model: this.model, outcome: "indeterminate", error: YOUTUBE_PUBLISH_ERROR }; }
}

class NeverPackageProvider implements YouTubeProvider {
  readonly name = "mock" as const; readonly model = "never"; calls = 0;
  async generatePublishingPackage(): Promise<never> { this.calls++; throw new Error("unexpected package generation"); }
}

function bytes(fileName: string) { return fs.readFileSync(path.join(root, fileName)); }
function minimalMp4() { const mvhd = Buffer.alloc(20); mvhd.writeUInt32BE(1_000, 12); mvhd.writeUInt32BE(30_000, 16); return Buffer.concat([box("ftyp", Buffer.from("isom0000")), box("moov", box("mvhd", mvhd)), box("mdat", Buffer.from([0]))]); }
function box(type: string, body: Buffer) { const output = Buffer.alloc(body.length + 8); output.writeUInt32BE(output.length, 0); output.write(type, 4, 4, "ascii"); body.copy(output, 8); return output; }
function png(width: number, height: number) { const row = width * 3 + 1; const raw = Buffer.alloc(row * height); const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]); const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2; return Buffer.concat([signature, pngChunk("IHDR", ihdr), pngChunk("IDAT", deflateSync(raw)), pngChunk("IEND", Buffer.alloc(0))]); }
function pngChunk(type: string, data: Buffer) { const t = Buffer.from(type); const output = Buffer.alloc(data.length + 12); output.writeUInt32BE(data.length, 0); t.copy(output, 4); data.copy(output, 8); output.writeUInt32BE(crc32(Buffer.concat([t, data])), data.length + 8); return output; }
function crc32(data: Buffer) { let crc = 0xffffffff; for (const byte of data) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); } return (crc ^ 0xffffffff) >>> 0; }
function pass() { passed++; }

void main();
