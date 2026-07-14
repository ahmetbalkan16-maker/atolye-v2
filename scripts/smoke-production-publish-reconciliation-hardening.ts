import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { deflateSync } from "node:zlib";
import { POST as youtubePost } from "../app/api/youtube/route";
import { AssetManager } from "../src/lib/assets/AssetManager";
import { VideoStorage } from "../src/lib/assets/storage/VideoStorage";
import {
  PipelineRecoveryPlanner,
  pipelineRecoveryStageOrder,
} from "../src/lib/pipeline/PipelineRecoveryPlanner";
import { ProjectManager } from "../src/lib/projects/ProjectManager";
import { ProjectWriter } from "../src/lib/projects/ProjectWriter";
import { ThumbnailStorage } from "../src/lib/thumbnail/ThumbnailStorage";
import { YouTubePublishPipeline } from "../src/lib/youtube/publish/YouTubePublishPipeline";
import {
  createYouTubePackageIdentity,
  createYouTubeReconciliationMarker,
} from "../src/lib/youtube/publish/YouTubePublishValidation";
import { MockYouTubePublishProvider } from "../src/lib/youtube/publish/providers/MockYouTubePublishProvider";
import type { YouTubePublishProvider } from "../src/lib/youtube/publish/providers/YouTubePublishProvider";
import { YOUTUBE_RECONCILIATION_ERROR } from "../src/lib/youtube/publish/providers/YouTubePublishProvider";
import { YouTubeDataApiPublishProvider } from "../src/lib/youtube/publish/providers/YouTubeDataApiPublishProvider";
import type { ProjectAssets } from "../src/types/asset";
import type { AssemblyPlanData } from "../src/types/assembly";
import type { Project, ProductionStepKey } from "../src/types/project";
import type { SEOData } from "../src/types/seo";
import type { ThumbnailData } from "../src/types/thumbnail";
import type { YouTubePublishingPackage } from "../src/types/youtube";
import type {
  YouTubePublishingRecord,
  YouTubePublishedRecord,
  YouTubePublishProviderResult,
  YouTubePublishReconciliationRequest,
  YouTubePublishReconciliationResult,
} from "../src/types/youtubePublish";

const slug = `sprint-124-reconciliation-${process.pid}`;
const root = path.resolve(process.cwd(), "data", "projects", slug);
const now = "2026-07-14T04:00:00.000Z";
const project: Project = {
  id: `project-${process.pid}`,
  slug,
  title: "Production Publish Reconciliation Hardening",
  status: "youtube",
  createdAt: now,
  updatedAt: now,
};
let assembly: AssemblyPlanData;
let thumbnail: ThumbnailData;
let seo: SEOData;
let publishingPackage: YouTubePublishingPackage;
let baselineAssets: ProjectAssets;
let passed = 0;

async function main() {
  try {
    await setup();
    await canonicalAndReceiptPaths();
    await matchedReconciliation();
    await failClosedOutcomes();
    await bindingAndStateValidation();
    await persistenceApiAndRecovery();
    await dataApiReadOnlyReconciliation();
    console.log(`Sprint 124 production publish reconciliation smoke: PASS (${passed} scenarios)`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    delete process.env.YOUTUBE_PUBLISH_PROVIDER;
    delete process.env.YOUTUBE_ACCESS_TOKEN;
    delete process.env.YOUTUBE_CHANNEL_ID;
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
  const videoAsset = AssetManager.createAsset({
    id: "final-video",
    projectId: project.id,
    projectSlug: slug,
    type: "video",
    status: "generated",
    provider: "ffmpeg",
    model: "ffmpeg",
    prompt: "assembly",
    filePath: videoPaths.filePath,
    url: videoPaths.url,
    mimeType: "video/mp4",
    byteLength: videoBytes,
    durationSeconds: 30,
  });
  const storedThumbnail = ThumbnailStorage.saveThumbnail({
    projectSlug: slug,
    assetId: "thumbnail-final",
    data: png(1280, 720),
    mimeType: "image/png",
  });
  const thumbnailAsset = AssetManager.createAsset({
    id: "thumbnail-final",
    projectId: project.id,
    projectSlug: slug,
    type: "thumbnail",
    status: "generated",
    provider: "mock",
    model: "mock-thumbnail",
    prompt: "thumbnail",
    generationMode: "mock",
    ...storedThumbnail,
  });
  AssetManager.addAssetAtomically(slug, project.id, videoAsset);
  baselineAssets = AssetManager.addAssetAtomically(slug, project.id, thumbnailAsset);
  assembly = {
    projectId: project.id,
    slug,
    title: project.title,
    status: "assembled",
    outputAssetId: videoAsset.id,
    scenes: [{
      sceneId: 1,
      duration: "00:30",
      visualReference: "visual",
      audioReference: "audio",
      transition: "fade",
      cameraMovement: "static",
      effects: [],
      notes: "Başlangıç",
    }],
    totalDuration: "00:30",
    style: "documentary",
    render: {
      status: "rendered",
      format: "mp4",
      mimeType: "video/mp4",
      filePath: videoPaths.filePath,
      outputUrl: videoPaths.url,
      byteLength: videoBytes,
      durationSeconds: 30,
    },
    createdAt: now,
  };
  thumbnail = {
    projectId: project.id,
    slug,
    provider: "mock",
    model: "mock-thumbnail",
    status: "generated",
    sourceAssemblyAssetId: videoAsset.id,
    outputAssetId: thumbnailAsset.id,
    variants: [{
      id: "v1",
      title: "v",
      concept: "c",
      prompt: "p",
      negativePrompt: "n",
      style: "documentary",
      composition: "c",
      textOverlaySuggestion: "GERÇEK",
      priority: 1,
      status: "planned",
    }],
    titleIdea: "Başlık",
    concept: "Konsept",
    mainSubject: "Konu",
    composition: "Kompozisyon",
    colorStyle: "Renk",
    textSuggestion: "GERÇEK",
    imagePrompt: "Prompt",
    clickReason: "Merak",
    generation: {
      provider: "mock",
      model: "mock-thumbnail",
      assetId: thumbnailAsset.id,
      fileName: storedThumbnail.fileName,
      filePath: storedThumbnail.filePath,
      imageUrl: storedThumbnail.url,
      mimeType: storedThumbnail.mimeType,
      width: storedThumbnail.width,
      height: storedThumbnail.height,
      byteLength: storedThumbnail.byteLength,
      generationMode: "mock",
      status: "generated",
    },
    createdAt: now,
  };
  seo = {
    titleSuggestions: [project.title],
    description: "Stored canonical reconciliation package.",
    tags: ["Production", "Reconciliation"],
    hashtags: ["#Production"],
    keywords: ["Pipeline"],
    targetAudience: "Creators",
    searchIntent: "Learn",
    createdAt: now,
  };
  publishingPackage = {
    schemaVersion: "1",
    projectId: project.id,
    slug,
    provider: "mock",
    model: "mock-youtube-package-v1",
    status: "generated",
    title: project.title,
    description: seo.description,
    tags: seo.tags,
    hashtags: seo.hashtags,
    chapters: [{ startSeconds: 0, title: "Başlangıç" }],
    pinnedComment: "Yorumunuz nedir?",
    thumbnailText: "GERÇEK",
    videoAssetId: videoAsset.id,
    thumbnailAssetId: thumbnailAsset.id,
    generatedAt: now,
  };
  await ProjectWriter.writeJSONAtomically(slug, "assembly.json", assembly);
  await ProjectWriter.writeJSONAtomically(slug, "thumbnail.json", thumbnail);
  await ProjectWriter.writeJSONAtomically(slug, "seo.json", seo);
  await ProjectManager.saveYouTube(slug, publishingPackage, { updatePackageStatus: false });
}

async function canonicalAndReceiptPaths() {
  await resetPublish();
  const provider = new MockYouTubePublishProvider();
  const published = await publish(provider);
  assert.equal(published.status, "published");
  const replay = await publish(provider);
  assert.deepEqual(replay, published);
  assert.equal(provider.uploadCallCount, 1);
  assert.equal(provider.reconciliationCallCount, 0);
  pass();

  await resetPublish();
  const intent = publishingIntent(provider);
  const receipt = matchedRecord(intent, "receipt-video");
  await ProjectManager.saveYouTubePublish(slug, intent);
  await ProjectManager.saveYouTubePublishRecovery(slug, receipt);
  const promoted = await publish(provider);
  assert.deepEqual(promoted, receipt);
  assert.equal(provider.reconciliationCallCount, 0);
  assert.equal(provider.uploadCallCount, 1);
  pass();
}

async function matchedReconciliation() {
  await resetPublish();
  const provider = new MockYouTubePublishProvider();
  const intent = publishingIntent(provider);
  const remote = matchedResult(intent, "reconciled-video");
  provider.seedRemotePublish(remote);
  await ProjectManager.saveYouTubePublish(slug, intent);
  const published = await publish(provider);
  assert.equal(published.status, "published");
  pass();
  assert.equal(provider.uploadCallCount, 0);
  pass();
  assert.equal(published.remoteVideoId, "reconciled-video");
  assert.equal(published.reconciliationMarker, intent.reconciliationMarker);
  pass();
  const replay = await publish(provider);
  assert.deepEqual(replay, published);
  assert.equal(provider.reconciliationCallCount, 1);
  pass();
}

async function failClosedOutcomes() {
  for (const outcome of ["not_found", "ambiguous", "indeterminate", "failure"] as const) {
    await resetPublish();
    const provider = new MockYouTubePublishProvider({ reconciliationOutcome: outcome });
    const intent = publishingIntent(provider);
    await ProjectManager.saveYouTubePublish(slug, intent);
    await assert.rejects(() => publish(provider));
    assert.deepEqual(await ProjectManager.getYouTubePublish(slug), intent);
    assert.equal(provider.uploadCallCount, 0);
    pass();
  }

  await resetPublish();
  const timeout = new FixedReconcileProvider("indeterminate");
  await ProjectManager.saveYouTubePublish(slug, publishingIntent(timeout));
  await assert.rejects(() => publish(timeout));
  assert.equal(timeout.publishCalls, 0);
  pass();

  await resetPublish();
  const cancelled = new FixedReconcileProvider("indeterminate");
  const cancelledIntent = publishingIntent(cancelled);
  await ProjectManager.saveYouTubePublish(slug, cancelledIntent);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(() => publish(cancelled, controller.signal));
  assert.deepEqual(await ProjectManager.getYouTubePublish(slug), cancelledIntent);
  assert.equal(cancelled.publishCalls, 0);
  pass();

  await resetPublish();
  const malformed = new FixedReconcileProvider("matched", { extra: "raw" });
  await ProjectManager.saveYouTubePublish(slug, publishingIntent(malformed));
  await assert.rejects(() => publish(malformed));
  assert.equal(malformed.publishCalls, 0);
  pass();
}

async function bindingAndStateValidation() {
  const mismatchCases = [
    { projectId: "other-project" },
    { packageIdentity: "a".repeat(64) },
    { videoAssetId: "other-video" },
    { thumbnailAssetId: "other-thumbnail" },
  ];
  for (const changed of mismatchCases) {
    await resetPublish();
    const provider = new FixedReconcileProvider("matched");
    const intent = publishingIntent(provider);
    provider.resultOverrides = {
      reconciliationMarker: marker(provider, changed),
    };
    await ProjectManager.saveYouTubePublish(slug, intent);
    await assert.rejects(() => publish(provider));
    assert.equal(provider.publishCalls, 0);
    pass();
  }

  await resetPublish();
  const providerMismatch = new FixedReconcileProvider("matched");
  providerMismatch.resultOverrides = { provider: "youtube-data-api" };
  await ProjectManager.saveYouTubePublish(slug, publishingIntent(providerMismatch));
  await assert.rejects(() => publish(providerMismatch));
  pass();

  await resetPublish();
  const channelMismatch = new FixedReconcileProvider("matched");
  channelMismatch.resultOverrides = { channelId: "other-channel" };
  await ProjectManager.saveYouTubePublish(slug, publishingIntent(channelMismatch));
  await assert.rejects(() => publish(channelMismatch));
  pass();

  await resetPublish();
  const multiple = new MockYouTubePublishProvider();
  const multipleIntent = publishingIntent(multiple);
  multiple.seedRemotePublish(matchedResult(multipleIntent, "candidate-one"));
  multiple.seedRemotePublish(matchedResult(multipleIntent, "candidate-two"));
  await ProjectManager.saveYouTubePublish(slug, multipleIntent);
  await assert.rejects(() => publish(multiple));
  assert.equal(multiple.uploadCallCount, 0);
  pass();

  await resetPublish();
  const stalePackageProvider = new MockYouTubePublishProvider();
  await ProjectManager.saveYouTubePublish(slug, publishingIntent(stalePackageProvider));
  await ProjectWriter.writeJSONAtomically(slug, "youtube.json", {
    ...publishingPackage,
    title: "Stale package",
  });
  await assert.rejects(() => publish(stalePackageProvider));
  await ProjectManager.saveYouTube(slug, publishingPackage, { updatePackageStatus: false });
  pass();

  await resetPublish();
  const staleAssetProvider = new MockYouTubePublishProvider();
  await ProjectManager.saveYouTubePublish(slug, publishingIntent(staleAssetProvider));
  AssetManager.saveProjectAssetsAtomically(slug, {
    ...baselineAssets,
    assets: baselineAssets.assets.filter((asset) => asset.id !== publishingPackage.videoAssetId),
  });
  await assert.rejects(() => publish(staleAssetProvider));
  AssetManager.saveProjectAssetsAtomically(slug, baselineAssets);
  pass();

  await resetPublish();
  await ProjectWriter.writeJSONAtomically(slug, "youtube-publish.json", {
    ...publishingIntent(new MockYouTubePublishProvider()),
    unexpected: true,
  });
  await assert.rejects(() => publish(new MockYouTubePublishProvider()));
  pass();

  await resetPublish();
  const legacyProvider = new MockYouTubePublishProvider();
  const legacy = { ...publishingIntent(legacyProvider), reconciliationMarker: undefined };
  await ProjectManager.saveYouTubePublish(slug, legacy);
  await assert.rejects(() => publish(legacyProvider));
  assert.equal(legacyProvider.uploadCallCount, 0);
  pass();
}

async function persistenceApiAndRecovery() {
  await resetPublish();
  const provider = new MockYouTubePublishProvider();
  const intent = publishingIntent(provider);
  provider.seedRemotePublish(matchedResult(intent, "persistence-video"));
  await ProjectManager.saveYouTubePublish(slug, intent);
  const original = ProjectWriter.writeJSONAtomically;
  ProjectWriter.writeJSONAtomically = async (projectSlug, fileName, value) => {
    if (fileName === "youtube-publish.json" && (value as { status?: unknown }).status === "published") {
      throw new Error("injected canonical persistence failure");
    }
    return original.call(ProjectWriter, projectSlug, fileName, value);
  };
  try {
    await assert.rejects(() => publish(provider));
  } finally {
    ProjectWriter.writeJSONAtomically = original;
  }
  assert.deepEqual(await ProjectManager.getYouTubePublish(slug), intent);
  assert.equal(provider.uploadCallCount, 0);
  pass();

  for (const key of ["remoteVideoId", "reconciliationMarker", "providerResult"]) {
    const response = await youtubePost(new Request("http://localhost/api/youtube", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectSlug: slug, [key]: "attacker" }),
    }));
    assert.equal(response.status, 400);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  pass();

  await resetPublish();
  const apiProvider = new MockYouTubePublishProvider();
  const canonical = matchedRecord(publishingIntent(apiProvider), "api-stored-video");
  await ProjectManager.saveYouTubePublish(slug, canonical);
  const response = await youtubePost(new Request("http://localhost/api/youtube", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectSlug: slug }),
  }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  pass();

  await markAllCompleted();
  const plannerProvider = new MockYouTubePublishProvider({ reconciliationOutcome: "ambiguous" });
  const plannerIntent = publishingIntent(plannerProvider);
  await ProjectManager.saveYouTubePublish(slug, plannerIntent);
  const plan = await PipelineRecoveryPlanner.createResumePlan(slug);
  assert.equal(plan.startStage, "youtube");
  pass();
  await assert.rejects(() => publish(plannerProvider));
  const afterAmbiguous = await PipelineRecoveryPlanner.createResumePlan(slug);
  assert.equal(afterAmbiguous.startStage, "youtube");
  pass();

  plannerProvider.setReconciliationOutcome("indeterminate");
  await assert.rejects(() => publish(plannerProvider));
  const afterIndeterminate = await PipelineRecoveryPlanner.createResumePlan(slug);
  assert.equal(afterIndeterminate.startStage, "youtube");
  pass();
  assert.equal(plannerProvider.uploadCallCount, 0);
  pass();
}

async function dataApiReadOnlyReconciliation() {
  process.env.YOUTUBE_PUBLISH_PROVIDER = "youtube-data-api";
  process.env.YOUTUBE_ACCESS_TOKEN = "test-token";
  process.env.YOUTUBE_CHANNEL_ID = "channel-124";
  const dataRequest = reconciliationRequest();
  const called: string[] = [];
  const provider = new YouTubeDataApiPublishProvider({
    channelId: "channel-124",
    fetcher: async (url) => {
      called.push(url);
      return searchResponse(dataRequest.reconciliationMarker, ["remote-124"]);
    },
  });
  const matched = await provider.reconcilePublish(dataRequest);
  assert.equal(matched.outcome, "matched");
  assert.equal(called.length, 1);
  assert.equal(called.some((url) => url.includes("/upload/")), false);
  pass();

  const multiple = new YouTubeDataApiPublishProvider({
    channelId: "channel-124",
    fetcher: async () => searchResponse(dataRequest.reconciliationMarker, ["one", "two"]),
  });
  assert.equal((await multiple.reconcilePublish(dataRequest)).outcome, "ambiguous");
  pass();

  const malformed = new YouTubeDataApiPublishProvider({
    channelId: "channel-124",
    fetcher: async () => new Response("{}", { status: 200 }),
  });
  assert.equal((await malformed.reconcilePublish(dataRequest)).outcome, "indeterminate");
  pass();

  const timeout = new YouTubeDataApiPublishProvider({
    channelId: "channel-124",
    timeoutMs: 1,
    fetcher: async (_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }),
  });
  assert.equal((await timeout.reconcilePublish(dataRequest)).outcome, "indeterminate");
  pass();

  const controller = new AbortController();
  controller.abort();
  assert.equal((await provider.reconcilePublish({ ...dataRequest, signal: controller.signal })).outcome, "failure");
  pass();
}

function publishingIntent(provider: YouTubePublishProvider): YouTubePublishingRecord {
  const channelBinding = provider.reconciliationChannelId;
  return {
    schemaVersion: "1",
    projectId: project.id,
    slug,
    packageIdentity: createYouTubePackageIdentity(publishingPackage),
    videoAssetId: publishingPackage.videoAssetId,
    thumbnailAssetId: publishingPackage.thumbnailAssetId,
    provider: provider.name,
    ...(provider.model ? { model: provider.model } : {}),
    attemptId: "attempt-reconciliation",
    status: "publishing",
    createdAt: now,
    reconciliationMarker: marker(provider),
    ...(channelBinding ? { channelBinding } : {}),
  };
}

function marker(
  provider: YouTubePublishProvider,
  changed: Partial<{
    projectId: string;
    packageIdentity: string;
    videoAssetId: string;
    thumbnailAssetId: string;
  }> = {},
) {
  return createYouTubeReconciliationMarker({
    projectId: changed.projectId ?? project.id,
    slug,
    packageIdentity: changed.packageIdentity ?? createYouTubePackageIdentity(publishingPackage),
    videoAssetId: changed.videoAssetId ?? publishingPackage.videoAssetId,
    thumbnailAssetId: changed.thumbnailAssetId ?? publishingPackage.thumbnailAssetId,
    provider: provider.name,
    ...(provider.model ? { model: provider.model } : {}),
    ...(provider.reconciliationChannelId
      ? { channelBinding: provider.reconciliationChannelId }
      : {}),
  });
}

function matchedResult(
  intent: YouTubePublishingRecord,
  remoteVideoId: string,
): Extract<YouTubePublishReconciliationResult, { outcome: "matched" }> {
  return {
    outcome: "matched",
    provider: intent.provider,
    ...(intent.model ? { model: intent.model } : {}),
    reconciliationMarker: intent.reconciliationMarker!,
    remoteVideoId,
    remoteVideoUrl: `https://www.youtube.com/watch?v=${remoteVideoId}`,
    ...(intent.channelBinding ? { channelId: intent.channelBinding } : {}),
  };
}

function matchedRecord(intent: YouTubePublishingRecord, remoteVideoId: string): YouTubePublishedRecord {
  return {
    ...intent,
    status: "published",
    remoteVideoId,
    remoteVideoUrl: `https://www.youtube.com/watch?v=${remoteVideoId}`,
    ...(intent.channelBinding ? { channelId: intent.channelBinding } : {}),
    publishedAt: now,
  };
}

class FixedReconcileProvider implements YouTubePublishProvider {
  readonly name = "mock" as const;
  readonly model = "fixed-reconciliation-v1";
  readonly reconciliationChannelId = "fixed-channel";
  publishCalls = 0;
  reconciliationCalls = 0;
  resultOverrides: Record<string, unknown> = {};

  constructor(
    private readonly outcome: YouTubePublishReconciliationResult["outcome"],
    resultOverrides: Record<string, unknown> = {},
  ) {
    this.resultOverrides = resultOverrides;
  }

  async publish(): Promise<YouTubePublishProviderResult> {
    this.publishCalls++;
    throw new Error("unexpected upload");
  }

  async reconcilePublish(
    request: YouTubePublishReconciliationRequest,
  ): Promise<YouTubePublishReconciliationResult> {
    this.reconciliationCalls++;
    if (this.outcome !== "matched") {
      return {
        outcome: this.outcome,
        provider: this.name,
        model: this.model,
        error: YOUTUBE_RECONCILIATION_ERROR,
      };
    }
    return {
      outcome: "matched",
      provider: this.name,
      model: this.model,
      reconciliationMarker: request.reconciliationMarker,
      remoteVideoId: "fixed-video",
      remoteVideoUrl: "https://www.youtube.com/watch?v=fixed-video",
      channelId: this.reconciliationChannelId,
      ...this.resultOverrides,
    } as YouTubePublishReconciliationResult;
  }
}

function reconciliationRequest(): YouTubePublishReconciliationRequest {
  const provider = new YouTubeDataApiPublishProvider({ channelId: "channel-124" });
  return {
    schemaVersion: "1",
    projectId: project.id,
    slug,
    packageIdentity: createYouTubePackageIdentity(publishingPackage),
    videoAssetId: publishingPackage.videoAssetId,
    thumbnailAssetId: publishingPackage.thumbnailAssetId,
    provider: provider.name,
    model: provider.model,
    reconciliationMarker: marker(provider),
    channelBinding: "channel-124",
  };
}

function searchResponse(reconciliationMarker: string, ids: string[]) {
  return Response.json({
    items: ids.map((videoId) => ({
      id: { videoId },
      snippet: {
        channelId: "channel-124",
        description: `Description\n\n[atolye-reconcile:${reconciliationMarker}]`,
      },
    })),
  });
}

async function publish(provider: YouTubePublishProvider, signal?: AbortSignal) {
  return YouTubePublishPipeline.publishStoredPackage({
    projectSlug: slug,
    provider,
    timestamp: now,
    attemptId: "attempt-reconciliation",
    ...(signal ? { signal } : {}),
  });
}

async function resetPublish() {
  await ProjectManager.removeYouTubePublish(slug);
  await ProjectManager.removeYouTubePublishRecovery(slug);
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
            ? {
                projectId: project.id,
                status: "generated",
                scenes: [{
                  sceneId: 1,
                  sourceAnimationAssetId: "animation-1",
                  status: "generated",
                }],
                createdAt: now,
              }
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

function minimalMp4() {
  const mvhd = Buffer.alloc(20);
  mvhd.writeUInt32BE(1_000, 12);
  mvhd.writeUInt32BE(30_000, 16);
  return Buffer.concat([
    box("ftyp", Buffer.from("isom0000")),
    box("moov", box("mvhd", mvhd)),
    box("mdat", Buffer.from([0])),
  ]);
}

function box(type: string, body: Buffer) {
  const output = Buffer.alloc(body.length + 8);
  output.writeUInt32BE(output.length, 0);
  output.write(type, 4, 4, "ascii");
  body.copy(output, 8);
  return output;
}

function png(width: number, height: number) {
  const row = width * 3 + 1;
  const raw = Buffer.alloc(row * height);
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function pngChunk(type: string, data: Buffer) {
  const typeBytes = Buffer.from(type);
  const output = Buffer.alloc(data.length + 12);
  output.writeUInt32BE(data.length, 0);
  typeBytes.copy(output, 4);
  data.copy(output, 8);
  output.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), data.length + 8);
  return output;
}

function crc32(data: Buffer) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pass() {
  passed++;
}

void main();
