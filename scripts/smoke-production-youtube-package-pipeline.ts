import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { deflateSync } from "node:zlib";
import { AssetManager } from "../src/lib/assets/AssetManager";
import { VideoStorage } from "../src/lib/assets/storage/VideoStorage";
import { ProjectManager } from "../src/lib/projects/ProjectManager";
import { ProjectWriter } from "../src/lib/projects/ProjectWriter";
import { PipelineRecoveryPlanner } from "../src/lib/pipeline/PipelineRecoveryPlanner";
import { createMockExportPackage } from "../src/lib/export/providers/MockExportProvider";
import { ThumbnailStorage } from "../src/lib/thumbnail/ThumbnailStorage";
import { OpenAIYouTubeProvider } from "../src/lib/youtube/providers/OpenAIYouTubeProvider";
import type {
  YouTubeGenerationInput,
  YouTubeGenerationResult,
  YouTubeProvider,
} from "../src/lib/youtube/providers/YouTubeProvider";
import { MockYouTubeProvider } from "../src/lib/youtube/providers/MockYouTubeProvider";
import { YouTubePackagePipeline } from "../src/lib/youtube/YouTubePackagePipeline";
import {
  MAX_DESCRIPTION_LENGTH,
  MAX_TITLE_LENGTH,
  isYouTubePublishingPackage,
  normalizeYouTubePackageDraft,
} from "../src/lib/youtube/YouTubePackageValidation";
import {
  YouTubeProviderConfigurationError,
  resolveYouTubeProviderName,
} from "../src/lib/youtube/YouTubeProviderConfig";
import { YouTubeProviderRouter } from "../src/lib/youtube/YouTubeProviderRouter";
import { createYouTubePackageIdentity } from "../src/lib/youtube/publish/YouTubePublishValidation";
import type { Asset, ProjectAssets } from "../src/types/asset";
import type { AssemblyPlanData } from "../src/types/assembly";
import type { Project } from "../src/types/project";
import type { SEOData } from "../src/types/seo";
import type { ThumbnailData } from "../src/types/thumbnail";
import type { YouTubePackageDraft } from "../src/types/youtube";
import { POST as youtubePost } from "../app/api/youtube/route";

const slug = `sprint-121-smoke-${process.pid}`;
const root = path.resolve(process.cwd(), "data", "projects", slug);
const project: Project = {
  id: `project-${process.pid}`,
  slug,
  title: "Production YouTube Package",
  status: "youtube",
  createdAt: "2026-07-14T00:00:00.000Z",
  updatedAt: "2026-07-14T00:00:00.000Z",
};
let assembly: AssemblyPlanData;
let thumbnail: ThumbnailData;
let seo: SEOData;
let baselineAssets: ProjectAssets;
let passed = 0;

async function main() {
  try {
    setup();
    await successAndReplayTests();
    providerConfigTests();
    await openAITests();
    validationTests();
    await assetFailureTests();
    await persistenceTests();
    console.log(`Sprint 121 production YouTube package smoke: PASS (${passed} scenarios)`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    delete process.env.YOUTUBE_PROVIDER;
    delete process.env.OPENAI_API_KEY;
  }
}

function setup() {
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, "project.json"), JSON.stringify(project));
  const renderPaths = VideoStorage.createRenderPaths(slug);
  fs.writeFileSync(renderPaths.temporaryAbsolutePath, minimalMp4());
  VideoStorage.finalize(renderPaths.temporaryAbsolutePath, renderPaths.absolutePath);
  const videoBytes = fs.statSync(renderPaths.absolutePath).size;
  const videoAsset = AssetManager.createAsset({
    id: "final-assembly-video",
    projectId: project.id,
    projectSlug: slug,
    type: "video",
    status: "generated",
    provider: "ffmpeg",
    model: "ffmpeg-h264-aac",
    prompt: "assembly",
    filePath: renderPaths.filePath,
    url: renderPaths.url,
    mimeType: "video/mp4",
    byteLength: videoBytes,
    durationSeconds: 30,
  });
  const savedThumbnail = ThumbnailStorage.saveThumbnail({
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
    model: "mock-thumbnail-image",
    prompt: "thumbnail",
    generationMode: "mock",
    ...savedThumbnail,
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
      filePath: renderPaths.filePath,
      outputUrl: renderPaths.url,
      byteLength: videoBytes,
      durationSeconds: 30,
    },
    createdAt: "2026-07-14T00:00:00.000Z",
  };
  thumbnail = {
    projectId: project.id,
    slug,
    provider: "mock",
    model: "mock-thumbnail-image",
    status: "generated",
    sourceAssemblyAssetId: videoAsset.id,
    outputAssetId: thumbnailAsset.id,
    variants: [{
      id: "v1", title: "v", concept: "c", prompt: "p", negativePrompt: "n",
      style: "documentary", composition: "c", textOverlaySuggestion: "GERÇEK",
      priority: 1, status: "planned",
    }],
    titleIdea: "Başlık", concept: "Konsept", mainSubject: "Konu",
    composition: "Kompozisyon", colorStyle: "Renk", textSuggestion: "GERÇEK",
    imagePrompt: "Prompt", clickReason: "Merak",
    generation: {
      provider: thumbnailAsset.provider,
      model: thumbnailAsset.model,
      assetId: thumbnailAsset.id,
      fileName: savedThumbnail.fileName,
      filePath: savedThumbnail.filePath,
      imageUrl: savedThumbnail.url,
      mimeType: savedThumbnail.mimeType,
      width: savedThumbnail.width,
      height: savedThumbnail.height,
      byteLength: savedThumbnail.byteLength,
      generationMode: "mock",
      status: "generated",
    },
    createdAt: "2026-07-14T00:00:00.000Z",
  };
  seo = {
    titleSuggestions: ["Production YouTube Package"],
    description: "Doğrulanmış ve kalıcı YouTube yayın paketi açıklaması.",
    tags: ["YouTube", "Pipeline"],
    hashtags: ["#YouTube", "#Pipeline"],
    keywords: ["Production"],
    targetAudience: "Creators",
    searchIntent: "Learn",
    createdAt: "2026-07-14T00:00:00.000Z",
  };
}

async function successAndReplayTests() {
  assert.equal(resolveYouTubeProviderName(undefined), "mock"); pass();
  assert.equal(new YouTubeProviderRouter().getProvider().name, "mock"); pass();
  const counting = new DraftProvider();
  const first = await generate(counting);
  assert.equal(counting.calls, 1); pass();
  assert.equal(first.schemaVersion, "1"); pass();
  assert.equal(first.videoAssetId, assembly.outputAssetId); pass();
  assert.equal(first.thumbnailAssetId, thumbnail.outputAssetId); pass();
  assert.equal(first.chapters[0].startSeconds, 0); pass();
  assert.equal(first.generatedAt, "2026-07-14T01:00:00.000Z"); pass();
  await ProjectWriter.writeJSONAtomically(slug, "youtube.json", first);
  const replay = await generate(counting);
  assert.deepEqual(replay, first); pass();
  assert.equal(counting.calls, 1); pass();
  assert.equal(isYouTubePublishingPackage(replay), true); pass();
  await ProjectManager.removeYouTube(slug);
  const a = await new MockYouTubeProvider().generatePublishingPackage(input());
  const b = await new MockYouTubeProvider().generatePublishingPackage(input());
  assert.deepEqual(a, b); pass();
}

function providerConfigTests() {
  assert.throws(() => resolveYouTubeProviderName("unknown"), YouTubeProviderConfigurationError); pass();
  assert.throws(() => new YouTubeProviderRouter().getProvider("unknown")); pass();
}

async function openAITests() {
  const previous = process.env.YOUTUBE_PROVIDER;
  const previousKey = process.env.OPENAI_API_KEY;
  try {
    delete process.env.YOUTUBE_PROVIDER;
    delete process.env.OPENAI_API_KEY;
    assert.equal((await new OpenAIYouTubeProvider().generatePublishingPackage(input())).success, false); pass();
    process.env.YOUTUBE_PROVIDER = "openai";
    assert.equal((await new OpenAIYouTubeProvider().generatePublishingPackage(input())).success, false); pass();
    process.env.OPENAI_API_KEY = "test-key";
    const invalid = new OpenAIYouTubeProvider({ fetcher: async () => new Response("not-json") });
    assert.equal((await invalid.generatePublishingPackage(input())).success, false); pass();
    const oversized = new OpenAIYouTubeProvider({
      maximumResponseBytes: 10,
      fetcher: async () => new Response("0123456789012345", { headers: { "content-length": "16" } }),
    });
    assert.equal((await oversized.generatePublishingPackage(input())).success, false); pass();
    const timeout = new OpenAIYouTubeProvider({
      timeoutMs: 1,
      fetcher: (_url, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      }),
    });
    assert.equal((await timeout.generatePublishingPackage(input())).success, false); pass();
    const shape = JSON.stringify({ choices: [{ message: { content: "{}" } }] });
    const malformedShape = new OpenAIYouTubeProvider({ fetcher: async () => new Response(shape) });
    const result = await malformedShape.generatePublishingPackage(input());
    assert.equal(result.success, true);
    await assert.rejects(() => generate(new StaticProvider(result))); pass();
  } finally {
    if (previous === undefined) delete process.env.YOUTUBE_PROVIDER; else process.env.YOUTUBE_PROVIDER = previous;
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previousKey;
  }
}

function validationTests() {
  const valid = draft();
  assert.throws(() => normalizeYouTubePackageDraft({ ...valid, title: "" }, 30)); pass();
  assert.throws(() => normalizeYouTubePackageDraft({ ...valid, title: "x".repeat(MAX_TITLE_LENGTH + 1) }, 30)); pass();
  assert.throws(() => normalizeYouTubePackageDraft({ ...valid, description: "" }, 30)); pass();
  assert.throws(() => normalizeYouTubePackageDraft({ ...valid, description: "x".repeat(MAX_DESCRIPTION_LENGTH + 1) }, 30)); pass();
  assert.throws(() => normalizeYouTubePackageDraft({ ...valid, title: "bad\0title" }, 30)); pass();
  assert.throws(() => normalizeYouTubePackageDraft({ ...valid, hashtags: ["#bad tag"] }, 30)); pass();
  const normalized = normalizeYouTubePackageDraft({ ...valid, tags: ["Tag", " tag "], hashtags: ["one", "#ONE"] }, 30);
  assert.deepEqual(normalized.tags, ["Tag"]); assert.deepEqual(normalized.hashtags, ["#one"]); pass();
  assert.throws(() => normalizeYouTubePackageDraft({ ...valid, chapters: [{ startSeconds: 1, title: "A" }] }, 30)); pass();
  assert.throws(() => normalizeYouTubePackageDraft({ ...valid, chapters: [{ startSeconds: 0, title: "A" }, { startSeconds: -1, title: "B" }] }, 30)); pass();
  assert.throws(() => normalizeYouTubePackageDraft({ ...valid, chapters: [{ startSeconds: 0, title: "A" }, { startSeconds: 0, title: "B" }] }, 30)); pass();
  assert.throws(() => normalizeYouTubePackageDraft({ ...valid, chapters: [{ startSeconds: 0, title: "A" }, { startSeconds: 31, title: "B" }] }, 30)); pass();
  const injected = { ...valid, videoAssetId: "evil", generatedAt: "evil" };
  assert.deepEqual(normalizeYouTubePackageDraft(injected, 30), valid); pass();
}

async function assetFailureTests() {
  const preflightProvider = new DraftProvider();
  await ProjectManager.removeYouTube(slug);
  await assert.rejects(() => YouTubePackagePipeline.generatePackage({
    project,
    assembly: { ...assembly, outputAssetId: undefined },
    thumbnail,
    seo,
    provider: preflightProvider,
  }));
  assert.equal(preflightProvider.calls, 0); pass();
  await failWith({ assembly: { ...assembly, outputAssetId: "scene-video" } });
  await mutateAssets((assets) => assets.filter((asset) => asset.id !== assembly.outputAssetId));
  await mutateAssets((assets) => assets.map((asset) => asset.id === assembly.outputAssetId ? { ...asset, status: "failed" } : asset));
  await mutateAssets((assets) => [...assets, { ...assets.find((asset) => asset.id === assembly.outputAssetId)! }]);
  await mutateAssets((assets) => assets.map((asset) => asset.id === assembly.outputAssetId ? { ...asset, byteLength: (asset.byteLength ?? 0) + 1 } : asset));
  await ProjectManager.removeYouTube(slug);
  AssetManager.saveProjectAssetsAtomically(slug, {
    ...baselineAssets,
    assets: baselineAssets.assets.map((asset) =>
      asset.id === assembly.outputAssetId
        ? { ...asset, durationSeconds: 31 }
        : asset,
    ),
  });
  try {
    await assert.rejects(() => YouTubePackagePipeline.generatePackage({
      project,
      assembly: {
        ...assembly,
        render: { ...assembly.render!, durationSeconds: 31 },
      },
      thumbnail,
      seo,
      provider: new DraftProvider(),
    }));
    pass();
  } finally {
    AssetManager.saveProjectAssetsAtomically(slug, baselineAssets);
  }
  await mutateAssets((assets) => assets.map((asset) => asset.id === assembly.outputAssetId ? { ...asset, filePath: "data/projects/outside.mp4" } : asset));
  await failWith({ thumbnail: { ...thumbnail, outputAssetId: undefined } });
  await failWith({ thumbnail: { ...thumbnail, generation: { ...thumbnail.generation!, assetId: "other" } } });
  await mutateAssets((assets) => assets.filter((asset) => asset.id !== thumbnail.outputAssetId));
  await mutateAssets((assets) => assets.map((asset) => asset.id === thumbnail.outputAssetId ? { ...asset, status: "failed" } : asset));
  await mutateAssets((assets) => [...assets, { ...assets.find((asset) => asset.id === thumbnail.outputAssetId)! }]);
  await mutateAssets((assets) => assets.map((asset) => asset.id === thumbnail.outputAssetId ? { ...asset, width: 1 } : asset));
  await mutateAssets((assets) => assets.map((asset) => asset.id === thumbnail.outputAssetId ? { ...asset, generationMode: undefined } : asset));
  await ProjectManager.removeYouTube(slug);
  AssetManager.saveProjectAssetsAtomically(slug, {
    ...baselineAssets,
    assets: baselineAssets.assets.map((asset) =>
      asset.id === thumbnail.outputAssetId
        ? { ...asset, generationMode: undefined }
        : asset,
    ),
  });
  try {
    await assert.rejects(() => YouTubePackagePipeline.generatePackage({
      project,
      assembly,
      thumbnail: {
        ...thumbnail,
        generation: { ...thumbnail.generation!, generationMode: undefined },
      },
      seo,
      provider: new DraftProvider(),
    }));
    pass();
  } finally {
    AssetManager.saveProjectAssetsAtomically(slug, baselineAssets);
  }
  await failWith({ thumbnail: { ...thumbnail, provider: "openai" } });
  await failWith({ project: { ...project, id: "cross-project" } });
}

async function persistenceTests() {
  const canonical = await generate(new DraftProvider());
  await ProjectManager.saveYouTube(slug, canonical);
  await ProjectManager.saveYouTubePublish(slug, {
    schemaVersion: "1",
    projectId: project.id,
    slug,
    packageIdentity: createYouTubePackageIdentity(canonical),
    videoAssetId: canonical.videoAssetId,
    thumbnailAssetId: canonical.thumbnailAssetId,
    provider: "mock",
    model: "mock-youtube-publish-v1",
    attemptId: "sprint-121-compatibility",
    status: "published",
    remoteVideoId: "mock-sprint-121",
    remoteVideoUrl: "https://www.youtube.com/watch?v=mock-sprint-121",
    channelId: "mock-channel",
    publishedAt: "2026-07-14T01:00:00.000Z",
    createdAt: "2026-07-14T01:00:00.000Z",
  });
  assert.deepEqual(await ProjectManager.getYouTube(slug), canonical); pass();
  assert.equal(isYouTubePublishingPackage(await ProjectManager.getYouTube(slug)), true); pass();
  const exported = createMockExportPackage({
    projectId: project.id,
    projectSlug: slug,
    project,
    assembly,
    thumbnail,
    seo,
    youtube: canonical,
  });
  assert.equal(
    exported.items.find((item) => item.type === "youtube")?.sourceAssetId,
    canonical.videoAssetId,
  ); pass();
  const validPlan = await PipelineRecoveryPlanner.createJobRetryPlan(slug, "export");
  assert.equal(validPlan.dependencies.find((item) => item.stage === "youtube")?.fileReady, true); pass();
  const malformed = { ...canonical, schemaVersion: "legacy" };
  assert.equal(isYouTubePublishingPackage(malformed), false); pass();
  await ProjectWriter.writeJSONAtomically(slug, "youtube.json", malformed);
  const malformedPlan = await PipelineRecoveryPlanner.createJobRetryPlan(slug, "export");
  assert.equal(malformedPlan.dependencies.find((item) => item.stage === "youtube")?.fileReady, false); pass();
  await ProjectManager.removeYouTube(slug);
  const original = ProjectWriter.writeJSONAtomically;
  ProjectWriter.writeJSONAtomically = async () => { throw new Error("write failed"); };
  try {
    await assert.rejects(() => ProjectManager.saveYouTube(slug, canonical));
    assert.equal(fs.existsSync(path.join(root, "youtube.json")), false); pass();
  } finally {
    ProjectWriter.writeJSONAtomically = original;
  }
  const apiResponse = await youtubePost(new Request("http://localhost/api/youtube", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      projectSlug: "../escape",
      assembly: { outputAssetId: "attacker-controlled" },
      internalPath: "C:\\secret",
    }),
  }));
  const apiBody = await apiResponse.json() as Record<string, unknown>;
  assert.equal(apiResponse.status, 400);
  assert.deepEqual(apiBody, {
    success: false,
    error: "YouTube package could not be generated.",
  }); pass();
}

async function generate(provider: YouTubeProvider) {
  return YouTubePackagePipeline.generatePackage({
    project,
    assembly,
    thumbnail,
    seo,
    provider,
    generatedAt: "2026-07-14T01:00:00.000Z",
  });
}

async function failWith(overrides: { project?: Project; assembly?: AssemblyPlanData; thumbnail?: ThumbnailData }) {
  await ProjectManager.removeYouTube(slug);
  await assert.rejects(() => YouTubePackagePipeline.generatePackage({
    project: overrides.project ?? project,
    assembly: overrides.assembly ?? assembly,
    thumbnail: overrides.thumbnail ?? thumbnail,
    seo,
    provider: new DraftProvider(),
  }));
  pass();
}

async function mutateAssets(change: (assets: Asset[]) => Asset[]) {
  await ProjectManager.removeYouTube(slug);
  AssetManager.saveProjectAssetsAtomically(slug, { ...baselineAssets, assets: change(baselineAssets.assets) });
  try {
    await assert.rejects(() => generate(new DraftProvider()));
    pass();
  } finally {
    AssetManager.saveProjectAssetsAtomically(slug, baselineAssets);
  }
}

class DraftProvider implements YouTubeProvider {
  readonly name = "mock" as const;
  readonly model = "test";
  calls = 0;
  async generatePublishingPackage(): Promise<YouTubeGenerationResult> {
    this.calls++;
    return { success: true, provider: "mock", model: "test", draft: draft() };
  }
}

class StaticProvider implements YouTubeProvider {
  readonly name = "openai" as const;
  readonly model = "test-openai";
  constructor(private result: YouTubeGenerationResult) {}
  async generatePublishingPackage() { return this.result; }
}

function draft(): YouTubePackageDraft {
  return {
    title: "Production YouTube Package",
    description: "Doğrulanmış YouTube yayın paketi.",
    tags: ["YouTube", "Pipeline"],
    hashtags: ["#YouTube", "#Pipeline"],
    chapters: [{ startSeconds: 0, title: "Başlangıç" }],
    pinnedComment: "En önemli bölüm sizce hangisi?",
    thumbnailText: "GERÇEK",
  };
}

function input(): YouTubeGenerationInput {
  return { projectId: project.id, projectSlug: slug, title: project.title, videoDurationSeconds: 30, assembly, thumbnail, seo };
}

function minimalMp4() {
  const mvhd = Buffer.alloc(20);
  mvhd.writeUInt32BE(1_000, 12);
  mvhd.writeUInt32BE(30_000, 16);
  return Buffer.concat([box("ftyp", Buffer.from("isom0000")), box("moov", box("mvhd", mvhd)), box("mdat", Buffer.from([0]))]);
}

function box(type: string, body: Buffer) {
  const output = Buffer.alloc(body.length + 8);
  output.writeUInt32BE(output.length, 0); output.write(type, 4, 4, "ascii"); body.copy(output, 8); return output;
}

function png(width: number, height: number) {
  const row = width * 3 + 1; const raw = Buffer.alloc(row * height);
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([signature, pngChunk("IHDR", ihdr), pngChunk("IDAT", deflateSync(raw)), pngChunk("IEND", Buffer.alloc(0))]);
}

function pngChunk(type: string, data: Buffer) {
  const t = Buffer.from(type); const output = Buffer.alloc(data.length + 12); output.writeUInt32BE(data.length, 0); t.copy(output, 4); data.copy(output, 8); output.writeUInt32BE(crc32(Buffer.concat([t, data])), data.length + 8); return output;
}

function crc32(data: Buffer) { let crc = 0xffffffff; for (const byte of data) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); } return (crc ^ 0xffffffff) >>> 0; }
function pass() { passed++; }

void main();
