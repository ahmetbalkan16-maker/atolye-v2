import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { deflateSync } from "node:zlib";
import { POST as youtubePost } from "../app/api/youtube/route";
import { AssetManager } from "../src/lib/assets/AssetManager";
import { VideoStorage } from "../src/lib/assets/storage/VideoStorage";
import { PipelineRecoveryPlanner } from "../src/lib/pipeline/PipelineRecoveryPlanner";
import { PipelineStageExecutor } from "../src/lib/pipeline/PipelineStageExecutor";
import { ProjectManager } from "../src/lib/projects/ProjectManager";
import { ProjectWriter } from "../src/lib/projects/ProjectWriter";
import { ThumbnailStorage } from "../src/lib/thumbnail/ThumbnailStorage";
import { YouTubePublishPipeline } from "../src/lib/youtube/publish/YouTubePublishPipeline";
import {
  createYouTubePackageIdentity,
  isYouTubePublishRecord,
} from "../src/lib/youtube/publish/YouTubePublishValidation";
import {
  YouTubePublishProviderConfigurationError,
  resolveYouTubePublishProviderName,
} from "../src/lib/youtube/publish/YouTubePublishProviderConfig";
import { YouTubePublishProviderRouter } from "../src/lib/youtube/publish/YouTubePublishProviderRouter";
import { MockYouTubePublishProvider } from "../src/lib/youtube/publish/providers/MockYouTubePublishProvider";
import type { YouTubePublishProvider } from "../src/lib/youtube/publish/providers/YouTubePublishProvider";
import { YOUTUBE_PUBLISH_ERROR } from "../src/lib/youtube/publish/providers/YouTubePublishProvider";
import { YouTubeDataApiPublishProvider } from "../src/lib/youtube/publish/providers/YouTubeDataApiPublishProvider";
import type { Asset, ProjectAssets } from "../src/types/asset";
import type { AssemblyPlanData } from "../src/types/assembly";
import type { Project } from "../src/types/project";
import type { SEOData } from "../src/types/seo";
import type { ThumbnailData } from "../src/types/thumbnail";
import type { YouTubePublishingPackage } from "../src/types/youtube";
import type { YouTubePublishProviderResult, YouTubePublishRequest } from "../src/types/youtubePublish";

const slug = `sprint-122-smoke-${process.pid}`;
const root = path.resolve(process.cwd(), "data", "projects", slug);
const project: Project = {
  id: `project-${process.pid}`,
  slug,
  title: "Production YouTube Publish",
  status: "youtube",
  createdAt: "2026-07-14T00:00:00.000Z",
  updatedAt: "2026-07-14T00:00:00.000Z",
};
let assembly: AssemblyPlanData;
let thumbnail: ThumbnailData;
let seo: SEOData;
let publishingPackage: YouTubePublishingPackage;
let baselineAssets: ProjectAssets;
let videoAbsolutePath = "";
let thumbnailAbsolutePath = "";
let passed = 0;

async function main() {
  try {
    await setup();
    await successReplayAndConfig();
    await storedStateAndAssetFailures();
    await realProviderFailures();
    await persistenceApiRunnerAndRecovery();
    console.log(`Sprint 122 production YouTube publish smoke: PASS (${passed} scenarios)`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    delete process.env.YOUTUBE_PUBLISH_PROVIDER;
    delete process.env.YOUTUBE_ACCESS_TOKEN;
  }
}

async function setup() {
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, "project.json"), JSON.stringify(project));
  await ProjectManager.createManifest(project);
  const paths = VideoStorage.createRenderPaths(slug);
  fs.writeFileSync(paths.temporaryAbsolutePath, minimalMp4());
  VideoStorage.finalize(paths.temporaryAbsolutePath, paths.absolutePath);
  videoAbsolutePath = paths.absolutePath;
  const videoBytes = fs.statSync(paths.absolutePath).size;
  const videoAsset = AssetManager.createAsset({
    id: "final-video", projectId: project.id, projectSlug: slug, type: "video",
    status: "generated", provider: "ffmpeg", model: "ffmpeg", prompt: "assembly",
    filePath: paths.filePath, url: paths.url, mimeType: "video/mp4",
    byteLength: videoBytes, durationSeconds: 30,
  });
  const storedThumbnail = ThumbnailStorage.saveThumbnail({
    projectSlug: slug, assetId: "thumbnail-final", data: png(1280, 720), mimeType: "image/png",
  });
  thumbnailAbsolutePath = path.resolve(process.cwd(), ...storedThumbnail.filePath.split("/"));
  const thumbnailAsset = AssetManager.createAsset({
    id: "thumbnail-final", projectId: project.id, projectSlug: slug, type: "thumbnail",
    status: "generated", provider: "mock", model: "mock-thumbnail", prompt: "thumbnail",
    generationMode: "mock", ...storedThumbnail,
  });
  AssetManager.addAssetAtomically(slug, project.id, videoAsset);
  baselineAssets = AssetManager.addAssetAtomically(slug, project.id, thumbnailAsset);
  assembly = {
    projectId: project.id, slug, title: project.title, status: "assembled",
    outputAssetId: videoAsset.id,
    scenes: [{ sceneId: 1, duration: "00:30", visualReference: "visual", audioReference: "audio", transition: "fade", cameraMovement: "static", effects: [], notes: "Başlangıç" }],
    totalDuration: "00:30", style: "documentary",
    render: { status: "rendered", format: "mp4", mimeType: "video/mp4", filePath: paths.filePath, outputUrl: paths.url, byteLength: videoBytes, durationSeconds: 30 },
    createdAt: "2026-07-14T00:00:00.000Z",
  };
  thumbnail = {
    projectId: project.id, slug, provider: "mock", model: "mock-thumbnail", status: "generated",
    sourceAssemblyAssetId: videoAsset.id, outputAssetId: thumbnailAsset.id,
    variants: [{ id: "v1", title: "v", concept: "c", prompt: "p", negativePrompt: "n", style: "documentary", composition: "c", textOverlaySuggestion: "GERÇEK", priority: 1, status: "planned" }],
    titleIdea: "Başlık", concept: "Konsept", mainSubject: "Konu", composition: "Kompozisyon",
    colorStyle: "Renk", textSuggestion: "GERÇEK", imagePrompt: "Prompt", clickReason: "Merak",
    generation: { provider: "mock", model: "mock-thumbnail", assetId: thumbnailAsset.id, fileName: storedThumbnail.fileName, filePath: storedThumbnail.filePath, imageUrl: storedThumbnail.url, mimeType: storedThumbnail.mimeType, width: storedThumbnail.width, height: storedThumbnail.height, byteLength: storedThumbnail.byteLength, generationMode: "mock", status: "generated" },
    createdAt: "2026-07-14T00:00:00.000Z",
  };
  seo = { titleSuggestions: [project.title], description: "Canonical publish description.", tags: ["YouTube", "Publish"], hashtags: ["#YouTube"], keywords: ["Pipeline"], targetAudience: "Creators", searchIntent: "Learn", createdAt: "2026-07-14T00:00:00.000Z" };
  publishingPackage = {
    schemaVersion: "1", projectId: project.id, slug, provider: "mock", model: "mock-youtube-package-v1", status: "generated",
    title: project.title, description: seo.description, tags: ["YouTube", "Publish"], hashtags: ["#YouTube"],
    chapters: [{ startSeconds: 0, title: "Başlangıç" }], pinnedComment: "Yorumunuz nedir?", thumbnailText: "GERÇEK",
    videoAssetId: videoAsset.id, thumbnailAssetId: thumbnailAsset.id, generatedAt: "2026-07-14T01:00:00.000Z",
  };
  await ProjectWriter.writeJSONAtomically(slug, "assembly.json", assembly);
  await ProjectWriter.writeJSONAtomically(slug, "thumbnail.json", thumbnail);
  await ProjectWriter.writeJSONAtomically(slug, "seo.json", seo);
  await ProjectManager.saveYouTube(slug, publishingPackage, { updatePackageStatus: false });
}

async function successReplayAndConfig() {
  assert.equal(resolveYouTubePublishProviderName(undefined), "mock"); pass();
  assert.equal(new YouTubePublishProviderRouter().getProvider().name, "mock"); pass();
  assert.throws(() => resolveYouTubePublishProviderName("unknown"), YouTubePublishProviderConfigurationError); pass();
  assert.throws(() => new YouTubePublishProviderRouter().getProvider("unknown")); pass();
  const provider = new CountingProvider();
  const first = await publish(provider);
  assert.equal(first.status, "published"); assert.equal(provider.calls, 1); pass();
  assert.equal(isYouTubePublishRecord(first), true); pass();
  const replay = await publish(provider);
  assert.deepEqual(replay, first); assert.equal(provider.calls, 1); pass();
  await ProjectManager.removeYouTubePublish(slug);
  const a = await new MockYouTubePublishProvider().publish(providerRequest());
  const b = await new MockYouTubePublishProvider().publish(providerRequest());
  assert.deepEqual(a, b); pass();
  await ProjectManager.saveYouTubePublish(slug, intent("publishing"));
  await assert.rejects(() => publish(provider)); assert.equal(provider.calls, 1); pass();
  await ProjectManager.saveYouTubePublish(slug, { ...intent("published"), packageIdentity: "a".repeat(64) });
  await assert.rejects(() => publish(provider)); assert.equal(provider.calls, 1); pass();
  await ProjectManager.removeYouTubePublish(slug);
}

async function storedStateAndAssetFailures() {
  await withMissingFile("youtube.json", async () => { await assert.rejects(() => publish(new CountingProvider())); }); pass();
  await withFile("youtube.json", "{bad", async () => { await assert.rejects(() => publish(new CountingProvider())); }); pass();
  await mutateAssets((items) => items.filter((asset) => asset.id !== publishingPackage.videoAssetId));
  await mutateAssets((items) => items.filter((asset) => asset.id !== publishingPackage.thumbnailAssetId));
  await mutateAssets((items) => items.map((asset) => asset.id === publishingPackage.videoAssetId ? { ...asset, projectId: "other" } : asset));
  await mutateAssets((items) => items.map((asset) => asset.id === publishingPackage.videoAssetId ? { ...asset, status: "failed" } : asset));
  await mutateAssets((items) => [...items, { ...items.find((asset) => asset.id === publishingPackage.videoAssetId)! }]);
  await mutateAssets((items) => items.map((asset) => asset.id === publishingPackage.thumbnailAssetId ? { ...asset, generationMode: undefined } : asset));
  await mutateAssets((items) => items.map((asset) => asset.id === publishingPackage.thumbnailAssetId ? { ...asset, filePath: asset.filePath?.replace("thumbnail-final", "mismatch") } : asset));
  await ProjectWriter.writeJSONAtomically(slug, "youtube-publish.json", { legacy: true });
  const corruptProvider = new CountingProvider();
  await assert.rejects(() => publish(corruptProvider)); assert.equal(corruptProvider.calls, 0); pass();
  await ProjectManager.removeYouTubePublish(slug);
}

async function realProviderFailures() {
  const oldProvider = process.env.YOUTUBE_PUBLISH_PROVIDER;
  const oldToken = process.env.YOUTUBE_ACCESS_TOKEN;
  try {
    delete process.env.YOUTUBE_PUBLISH_PROVIDER; delete process.env.YOUTUBE_ACCESS_TOKEN;
    assert.equal((await new YouTubeDataApiPublishProvider().publish(providerRequest())).success, false); pass();
    process.env.YOUTUBE_PUBLISH_PROVIDER = "youtube-data-api";
    assert.throws(() => new YouTubePublishProviderRouter().getProvider(), YouTubePublishProviderConfigurationError); pass();
    assert.equal((await new YouTubeDataApiPublishProvider().publish(providerRequest())).success, false); pass();
    process.env.YOUTUBE_ACCESS_TOKEN = "test-token";
    const explicit = new YouTubeDataApiPublishProvider({ fetcher: async () => new Response("denied", { status: 403 }) });
    const explicitResult = await explicit.publish(providerRequest());
    assert.equal(explicitResult.success, false); if (!explicitResult.success) assert.equal(explicitResult.outcome, "failed"); pass();
    let call = 0;
    const timeout = new YouTubeDataApiPublishProvider({ timeoutMs: 1, fetcher: async (_url, init) => {
      call++;
      if (call === 1) return new Response(null, { status: 200, headers: { location: "https://www.googleapis.com/upload/youtube/v3/resumable/test" } });
      return new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))));
    } });
    const timeoutResult = await timeout.publish(providerRequest());
    assert.equal(timeoutResult.success, false); if (!timeoutResult.success) assert.equal(timeoutResult.outcome, "indeterminate"); pass();
    call = 0;
    const malformed = new YouTubeDataApiPublishProvider({ fetcher: async () => {
      call++;
      return call === 1
        ? new Response(null, { status: 200, headers: { location: "https://www.googleapis.com/upload/youtube/v3/resumable/test" } })
        : new Response("{}", { status: 200 });
    } });
    const malformedResult = await malformed.publish(providerRequest());
    assert.equal(malformedResult.success, false); if (!malformedResult.success) assert.equal(malformedResult.outcome, "indeterminate"); pass();
  } finally {
    if (oldProvider === undefined) delete process.env.YOUTUBE_PUBLISH_PROVIDER; else process.env.YOUTUBE_PUBLISH_PROVIDER = oldProvider;
    if (oldToken === undefined) delete process.env.YOUTUBE_ACCESS_TOKEN; else process.env.YOUTUBE_ACCESS_TOKEN = oldToken;
  }
}

async function persistenceApiRunnerAndRecovery() {
  const original = ProjectWriter.writeJSONAtomically;
  const provider = new CountingProvider();
  ProjectWriter.writeJSONAtomically = async (_slug, fileName, data) => {
    if (fileName === "youtube-publish.json") throw new Error("write failed");
    return original.call(ProjectWriter, _slug, fileName, data);
  };
  try {
    await assert.rejects(() => publish(provider)); assert.equal(provider.calls, 0); pass();
  } finally { ProjectWriter.writeJSONAtomically = original; }

  const override = await youtubePost(new Request("http://localhost/api/youtube", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectSlug: slug, videoAssetId: "attacker" }),
  }));
  assert.equal(override.status, 400); assert.equal(override.headers.get("cache-control"), "no-store"); pass();

  await ProjectManager.removeYouTubePublish(slug);
  const api = await youtubePost(new Request("http://localhost/api/youtube", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectSlug: slug }),
  }));
  const apiBody = await api.json() as Record<string, unknown>;
  assert.equal(api.status, 200); assert.equal(api.headers.get("cache-control"), "no-store"); assert.equal(apiBody.success, true); pass();

  await ProjectManager.removeYouTubePublish(slug);
  const state = await PipelineStageExecutor.loadState(slug);
  assert.ok(state);
  await assert.rejects(() => PipelineStageExecutor.execute(slug, "youtube", state, { youtubePublishProvider: new ExplicitFailureProvider() })); pass();

  await ProjectManager.saveYouTube(slug, publishingPackage);
  await ProjectWriter.writeJSONAtomically(slug, "youtube-publish.json", { schemaVersion: "legacy" });
  const plan = await PipelineRecoveryPlanner.createJobRetryPlan(slug, "export");
  const youtubeDependency = plan.dependencies.find((item) => item.stage === "youtube");
  assert.equal(youtubeDependency?.fileReady, false); pass();
  await ProjectManager.removeYouTubePublish(slug);
}

async function publish(provider: YouTubePublishProvider) {
  return YouTubePublishPipeline.publishStoredPackage({
    projectSlug: slug, provider, timestamp: "2026-07-14T02:00:00.000Z", attemptId: "attempt-1",
  });
}

function providerRequest(): YouTubePublishRequest {
  return { schemaVersion: "1", packageIdentity: createYouTubePackageIdentity(publishingPackage), publishingPackage, videoAbsolutePath, thumbnailAbsolutePath, metadata: { title: publishingPackage.title, description: publishingPackage.description, tags: publishingPackage.tags, privacyStatus: "private" } };
}

function intent(status: "publishing" | "published") {
  const base = { schemaVersion: "1" as const, projectId: project.id, slug, packageIdentity: createYouTubePackageIdentity(publishingPackage), videoAssetId: publishingPackage.videoAssetId, thumbnailAssetId: publishingPackage.thumbnailAssetId, provider: "mock" as const, model: "test-publish", attemptId: "attempt-1", createdAt: "2026-07-14T02:00:00.000Z" };
  return status === "publishing" ? { ...base, status } : { ...base, status, remoteVideoId: "remote-1", remoteVideoUrl: "https://www.youtube.com/watch?v=remote-1", publishedAt: "2026-07-14T02:00:00.000Z" };
}

async function mutateAssets(change: (items: Asset[]) => Asset[]) {
  AssetManager.saveProjectAssetsAtomically(slug, { ...baselineAssets, assets: change(baselineAssets.assets) });
  try { await assert.rejects(() => publish(new CountingProvider())); pass(); }
  finally { AssetManager.saveProjectAssetsAtomically(slug, baselineAssets); await ProjectManager.removeYouTubePublish(slug); }
}

async function withMissingFile(fileName: string, test: () => Promise<void>) {
  const file = path.join(root, fileName); const previous = fs.readFileSync(file);
  fs.rmSync(file); try { await test(); } finally { fs.writeFileSync(file, previous); }
}

async function withFile(fileName: string, value: string, test: () => Promise<void>) {
  const file = path.join(root, fileName); const previous = fs.readFileSync(file);
  fs.writeFileSync(file, value); try { await test(); } finally { fs.writeFileSync(file, previous); }
}

class CountingProvider implements YouTubePublishProvider {
  readonly name = "mock" as const; readonly model = "test-publish"; calls = 0;
  async publish(request: YouTubePublishRequest): Promise<YouTubePublishProviderResult> {
    this.calls++;
    return { success: true, provider: this.name, model: this.model, remoteVideoId: `remote-${request.packageIdentity.slice(0, 16)}`, remoteVideoUrl: `https://www.youtube.com/watch?v=remote-${request.packageIdentity.slice(0, 16)}`, channelId: "channel-1" };
  }
}

class ExplicitFailureProvider implements YouTubePublishProvider {
  readonly name = "mock" as const; readonly model = "failed";
  async publish(): Promise<YouTubePublishProviderResult> { return { success: false, provider: this.name, model: this.model, outcome: "failed", error: YOUTUBE_PUBLISH_ERROR }; }
}

function minimalMp4() { const mvhd = Buffer.alloc(20); mvhd.writeUInt32BE(1_000, 12); mvhd.writeUInt32BE(30_000, 16); return Buffer.concat([box("ftyp", Buffer.from("isom0000")), box("moov", box("mvhd", mvhd)), box("mdat", Buffer.from([0]))]); }
function box(type: string, body: Buffer) { const output = Buffer.alloc(body.length + 8); output.writeUInt32BE(output.length, 0); output.write(type, 4, 4, "ascii"); body.copy(output, 8); return output; }
function png(width: number, height: number) { const row = width * 3 + 1; const raw = Buffer.alloc(row * height); const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]); const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2; return Buffer.concat([signature, pngChunk("IHDR", ihdr), pngChunk("IDAT", deflateSync(raw)), pngChunk("IEND", Buffer.alloc(0))]); }
function pngChunk(type: string, data: Buffer) { const t = Buffer.from(type); const output = Buffer.alloc(data.length + 12); output.writeUInt32BE(data.length, 0); t.copy(output, 4); data.copy(output, 8); output.writeUInt32BE(crc32(Buffer.concat([t, data])), data.length + 8); return output; }
function crc32(data: Buffer) { let crc = 0xffffffff; for (const byte of data) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); } return (crc ^ 0xffffffff) >>> 0; }
function pass() { passed++; }

void main();
