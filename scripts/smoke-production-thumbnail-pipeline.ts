import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { AssetManager } from "../src/lib/assets/AssetManager";
import { VideoStorage } from "../src/lib/assets/storage/VideoStorage";
import { PipelineJobManager } from "../src/lib/pipeline/PipelineJobManager";
import { PipelineRunner } from "../src/lib/pipeline/PipelineRunner";
import { ProjectManager } from "../src/lib/projects/ProjectManager";
import {
  ThumbnailAssetGenerationError,
  ThumbnailAssetPipeline,
} from "../src/lib/thumbnail/ThumbnailAssetPipeline";
import {
  resolveThumbnailProviderName,
  ThumbnailProviderConfigurationError,
} from "../src/lib/thumbnail/ThumbnailProviderConfig";
import { ThumbnailProviderRouter } from "../src/lib/thumbnail/ThumbnailProviderRouter";
import { ThumbnailStorage } from "../src/lib/thumbnail/ThumbnailStorage";
import { MockThumbnailProvider } from "../src/lib/thumbnail/providers/MockThumbnailProvider";
import { OpenAIThumbnailProvider } from "../src/lib/thumbnail/providers/OpenAIThumbnailProvider";
import type {
  ThumbnailAssetGenerationResult,
  ThumbnailGenerationInput,
  ThumbnailProvider,
} from "../src/lib/thumbnail/providers/ThumbnailProvider";
import type { AssemblyPlanData } from "../src/types/assembly";
import type { AudioData } from "../src/types/audio";
import type { ThumbnailData, ThumbnailProviderName } from "../src/types/thumbnail";
import type { VideoData } from "../src/types/video";
import { GET as getThumbnailAsset } from "../app/api/assets/thumbnails/[slug]/[fileName]/route";

const prefix = `sprint-120-thumbnail-${process.pid}`;
const projectsRoot = path.join(process.cwd(), "data", "projects");
const originalProvider = process.env.THUMBNAIL_PROVIDER;
const originalOpenAIKey = process.env.OPENAI_API_KEY;
const originalRouterGetProvider = ThumbnailProviderRouter.prototype.getProvider;
const originalAssetAdd = AssetManager.addAsset;
const originalAssetAddAtomically = AssetManager.addAssetAtomically;
const originalSaveThumbnail = ProjectManager.saveThumbnail;
const originalUpdatePackageStatus = ProjectManager.updatePackageStatus;
const originalPersistStageSuccess = PipelineJobManager.persistStageSuccess;
const originalFetch = globalThis.fetch;
let scenarios = 0;

async function scenario(name: string, run: () => void | Promise<void>) {
  await run();
  scenarios++;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${scenarios}: ${name}`);
}

function assemblyMock(): AssemblyPlanData {
  const now = new Date().toISOString();
  return {
    projectId: "project-120",
    slug: prefix,
    title: "Thumbnail Test",
    status: "assembled",
    sourceVideoAssetId: "video-source",
    sourceAudioAssetId: "audio-source",
    scenes: [{
      sceneId: 1,
      duration: "00:05",
      visualReference: "visual-1",
      audioReference: "audio-1",
      transition: "fade",
      cameraMovement: "static",
      effects: [],
    }],
    totalDuration: "00:05",
    style: "documentary",
    render: { status: "planned", format: "mp4" },
    createdAt: now,
    updatedAt: now,
  };
}

function thumbnailPlan(): ThumbnailData {
  const now = new Date().toISOString();
  return {
    provider: "mock",
    model: "test-plan",
    status: "planned",
    variants: [{
      id: "primary",
      title: "Thumbnail Test",
      concept: "Test concept",
      prompt: "Cinematic documentary thumbnail, 16:9",
      negativePrompt: "blur",
      style: "documentary",
      composition: "center",
      textOverlaySuggestion: "TEST",
      priority: 1,
      status: "planned",
    }],
    titleIdea: "Thumbnail Test",
    concept: "Test concept",
    mainSubject: "Thumbnail Test",
    composition: "center",
    colorStyle: "high contrast",
    textSuggestion: "TEST",
    imagePrompt: "Cinematic documentary thumbnail, 16:9",
    clickReason: "clear subject",
    generation: { provider: "mock", status: "planned" },
    createdAt: now,
  };
}

function thumbnailAssetInput(projectSlug: string) {
  return {
    projectId: "project-120",
    projectSlug,
    title: "Thumbnail Test",
    prompt: thumbnailPlan().imagePrompt,
    thumbnail: thumbnailPlan(),
    assembly: { ...assemblyMock(), slug: projectSlug },
  };
}

function injectedProvider(
  name: ThumbnailProviderName,
  mutate?: (result: ThumbnailAssetGenerationResult) => unknown,
): ThumbnailProvider {
  const mock = new MockThumbnailProvider();
  return {
    name,
    generateThumbnailPlan(input: ThumbnailGenerationInput) {
      return mock.generateThumbnailPlan(input);
    },
    async generateThumbnailAsset(input) {
      const result = await mock.generateThumbnailAsset(input);
      const adjusted = result.success
        ? {
            ...result,
            provider: name,
            generationMode: name === "mock" ? "mock" as const : "production" as const,
          }
        : { ...result, provider: name };
      const typed = adjusted as ThumbnailAssetGenerationResult;
      return (mutate ? mutate(typed) : typed) as ThumbnailAssetGenerationResult;
    },
  };
}

async function generate(
  suffix: string,
  provider: ThumbnailProvider = new MockThumbnailProvider(),
  assembly: AssemblyPlanData = assemblyMock(),
) {
  const slug = `${prefix}-${suffix}`;
  const value = await ThumbnailAssetPipeline.generateThumbnail({
    projectId: "project-120",
    projectSlug: slug,
    title: "Thumbnail Test",
    assembly: { ...assembly, slug },
    thumbnail: thumbnailPlan(),
    provider,
  });
  return { slug, value, assets: AssetManager.getProjectAssets(slug, "project-120") };
}

async function expectFailure(
  suffix: string,
  provider: ThumbnailProvider,
  assembly: AssemblyPlanData = assemblyMock(),
) {
  await assert.rejects(
    generate(suffix, provider, assembly),
    (error: unknown) => error instanceof ThumbnailAssetGenerationError,
  );
}

async function createProductionAssembly(slug: string) {
  const paths = VideoStorage.createRenderPaths(slug);
  const data = Buffer.concat([box("ftyp", Buffer.from("isom0000")), box("moov"), box("mdat", Buffer.from([0]))]);
  await fs.writeFile(paths.absolutePath, data);
  const assetId = crypto.randomUUID();
  AssetManager.addAsset(slug, "project-120", AssetManager.createAsset({
    id: assetId,
    projectId: "project-120",
    projectSlug: slug,
    type: "video",
    status: "generated",
    provider: "ffmpeg",
    prompt: "assembly",
    filePath: paths.filePath,
    url: paths.url,
    mimeType: "video/mp4",
    byteLength: data.length,
  }));
  return {
    ...assemblyMock(),
    slug,
    outputAssetId: assetId,
    render: {
      status: "rendered" as const,
      format: "mp4" as const,
      mimeType: "video/mp4" as const,
      filePath: paths.filePath,
      outputUrl: paths.url,
      byteLength: data.length,
      durationSeconds: 5,
      width: 1920,
      height: 1080,
      videoCodec: "h264",
      audioCodec: "aac",
    },
  };
}

function box(type: string, payload = Buffer.alloc(0)) {
  const result = Buffer.alloc(payload.length + 8);
  result.writeUInt32BE(result.length, 0);
  result.write(type, 4, 4, "ascii");
  payload.copy(result, 8);
  return result;
}

function rewritePngDimensions(data: Buffer, width: number, height: number) {
  const result = Buffer.from(data);
  result.writeUInt32BE(width, 16);
  result.writeUInt32BE(height, 20);
  result.writeUInt32BE(crc32(result.subarray(12, 29)), 29);
  return result;
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

async function thumbnailFiles(slug: string) {
  const directory = path.join(projectsRoot, slug, "assets", "thumbnails");
  try {
    return await fs.readdir(directory);
  } catch {
    return [];
  }
}

function videoData(): VideoData {
  return {
    projectId: "project-120",
    provider: "mock",
    status: "planned",
    scenes: [{ sceneId: 1, sourceAnimationAssetId: "animation-1", status: "planned" }],
    createdAt: new Date().toISOString(),
  };
}

function audioData(): AudioData {
  return {
    status: "planned",
    provider: "mock",
    narrator: { style: "documentary", tone: "calm", language: "tr" },
    sections: [],
    music: { mood: "calm", suggestion: "none", intensity: "low" },
    production: { targetFormat: "wav", sampleRate: 44100, estimatedTotalDuration: "00:05", generationStatus: "planned" },
    createdAt: new Date().toISOString(),
  };
}

async function pipelineFixture(suffix: string) {
  const title = `${prefix}-${suffix}`;
  const project = await ProjectManager.createProject(title);
  await ProjectManager.saveVideo(project.slug, videoData());
  await ProjectManager.saveAudio(project.slug, audioData());
  await ProjectManager.saveAssembly(project.slug, { ...assemblyMock(), projectId: project.id, slug: project.slug });
  for (const stage of ["research", "script", "scenes", "visuals", "animation"] as const) {
    await ProjectManager.updatePackageStatus(project.slug, stage, "completed");
  }
  await PipelineJobManager.listJobs(project.slug);
  return project;
}

async function main() {
  try {
    await scenario("undefined and blank provider default to mock", () => {
      assert.equal(resolveThumbnailProviderName(undefined), "mock");
      assert.equal(resolveThumbnailProviderName("  "), "mock");
    });
    await scenario("explicit providers route without fallback", () => {
      assert.equal(resolveThumbnailProviderName("mock"), "mock");
      assert.equal(resolveThumbnailProviderName("OPENAI"), "openai");
      assert.ok(new ThumbnailProviderRouter().getProvider("mock") instanceof MockThumbnailProvider);
      assert.ok(new ThumbnailProviderRouter().getProvider("openai") instanceof OpenAIThumbnailProvider);
    });
    await scenario("unknown provider fails configuration closed", () => {
      assert.throws(() => resolveThumbnailProviderName("private"), ThumbnailProviderConfigurationError);
    });
    await scenario("mock thumbnail is a persisted valid deterministic PNG", async () => {
      const first = await generate("mock-success");
      const second = await generate("mock-determinism");
      assert.equal(first.value.status, "generated");
      assert.equal(first.value.generation?.width, 1280);
      assert.equal(first.value.generation?.height, 720);
      assert.equal(first.assets.assets.at(-1)?.type, "thumbnail");
      const a = await fs.readFile(path.join(process.cwd(), first.value.generation!.filePath!));
      const b = await fs.readFile(path.join(process.cwd(), second.value.generation!.filePath!));
      assert.deepEqual(a, b);
    });
    await scenario("production provider result uses validated thumbnail storage", async () => {
      const slug = `${prefix}-production-valid`;
      const assembly = await createProductionAssembly(slug);
      const result = await ThumbnailAssetPipeline.generateThumbnail({
        projectId: "project-120", projectSlug: slug, title: "Thumbnail Test",
        assembly, thumbnail: thumbnailPlan(), provider: injectedProvider("openai"),
      });
      assert.equal(result.generation?.generationMode, "production");
      assert.equal(result.generation?.imageUrl, ThumbnailStorage.getThumbnailUrl(slug, result.generation.fileName!));
    });
    await scenario("provider throw is normalized and raw secret is not persisted", async () => {
      const provider = injectedProvider("mock");
      provider.generateThumbnailAsset = async () => { throw new Error("secret-token-private"); };
      await expectFailure("provider-throw", provider);
      const raw = await fs.readFile(
        path.join(projectsRoot, `${prefix}-provider-throw`, "assets", "assets.json"),
        "utf8",
      ).catch(() => "");
      assert.doesNotMatch(raw, /secret-token-private/);
    });
    await scenario("provider failure result fails closed", async () => {
      await expectFailure("provider-failure", injectedProvider("mock", (value) => ({
        success: false, assetId: value.assetId, provider: "mock", model: "bad",
        status: "failed", createdAt: new Date().toISOString(), error: "private detail",
      })));
    });

    const invalidCases: Array<[string, (value: Record<string, unknown>) => void]> = [
      ["missing asset identity", (value) => { value.assetId = ""; }],
      ["missing fileName", (value) => { value.fileName = ""; }],
      ["invalid MIME", (value) => { value.mimeType = "image/gif"; }],
      ["fileName extension mismatch", (value) => { value.fileName = `${value.assetId}.jpg`; }],
      ["URL fileName mismatch", (value) => { value.url = "/api/assets/thumbnails/wrong/wrong.png"; }],
      ["storage outside path", (value) => { value.filePath = "../outside.png"; }],
      ["zero width", (value) => { value.width = 0; }],
      ["invalid height", (value) => { value.height = Number.NaN; }],
      ["zero byteLength", (value) => { value.byteLength = 0; }],
      ["wrong byteLength", (value) => { value.byteLength = Number(value.byteLength) + 1; }],
    ];
    for (const [name, mutate] of invalidCases) {
      await scenario(`${name} is rejected`, async () => {
        await expectFailure(name.toLowerCase().replace(/\s+/g, "-"), injectedProvider("mock", (result) => {
          const value = { ...result } as unknown as Record<string, unknown>;
          mutate(value);
          return value;
        }));
      });
    }
    await scenario("duplicate asset identity is rejected", async () => {
      let captured: ThumbnailAssetGenerationResult | undefined;
      const firstProvider = injectedProvider("mock", (result) => (captured = result));
      const first = await generate("duplicate", firstProvider);
      assert.ok(first.value.outputAssetId);
      const replay: ThumbnailProvider = {
        name: "mock",
        generateThumbnailPlan: (input) => new MockThumbnailProvider().generateThumbnailPlan(input),
        generateThumbnailAsset: async () => captured as ThumbnailAssetGenerationResult,
      };
      await expectFailure("duplicate", replay);
    });
    await scenario("missing assembly dependency is rejected before provider", async () => {
      let calls = 0;
      const provider = injectedProvider("mock");
      provider.generateThumbnailAsset = async (input) => { calls++; return new MockThumbnailProvider().generateThumbnailAsset(input); };
      await assert.rejects(ThumbnailAssetPipeline.generateThumbnail({
        projectId: "project-120", projectSlug: `${prefix}-missing-assembly`, title: "T",
        assembly: null as unknown as AssemblyPlanData, thumbnail: thumbnailPlan(), provider,
      }), ThumbnailAssetGenerationError);
      assert.equal(calls, 0);
    });
    await scenario("invalid project slug cannot escape through failure persistence", async () => {
      const escaped = path.join(process.cwd(), "data", `${prefix}-escaped`);
      await assert.rejects(ThumbnailAssetPipeline.generateThumbnail({
        projectId: "project-120",
        projectSlug: `../${prefix}-escaped`,
        title: "T",
        assembly: assemblyMock(),
        thumbnail: thumbnailPlan(),
        provider: new MockThumbnailProvider(),
      }), ThumbnailAssetGenerationError);
      await assert.rejects(fs.access(escaped));
    });
    await scenario("untrusted provider identity fails before generation", async () => {
      let calls = 0;
      const provider = injectedProvider("mock") as ThumbnailProvider & { name: string };
      Object.defineProperty(provider, "name", { value: "private-provider" });
      provider.generateThumbnailAsset = async (input) => { calls++; return new MockThumbnailProvider().generateThumbnailAsset(input); };
      await assert.rejects(generate("provider-identity", provider as ThumbnailProvider), ThumbnailAssetGenerationError);
      assert.equal(calls, 0);
    });
    await scenario("malformed mock sentinel is rejected", async () => {
      await expectFailure("bad-mock", injectedProvider("mock", (result) => ({
        ...result as object, provider: "openai", generationMode: "production",
      })));
    });
    await scenario("thumbnail route serves validated bytes", async () => {
      const result = await generate("route");
      const response = await getThumbnailAsset(new Request("http://local"), {
        params: Promise.resolve({ slug: result.slug, fileName: result.value.generation!.fileName! }),
      });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("content-type"), "image/png");
      assert.equal((await response.arrayBuffer()).byteLength, result.value.generation?.byteLength);
    });
    await scenario("thumbnail route rejects unsafe locator", async () => {
      const response = await getThumbnailAsset(new Request("http://local"), {
        params: Promise.resolve({ slug: "..", fileName: "outside.png" }),
      });
      assert.equal(response.status, 404);
    });
    await scenario("thumbnail storage rejects junction escape", async () => {
      const slug = `${prefix}-junction`;
      const assets = path.join(projectsRoot, slug, "assets");
      const outside = path.join(process.cwd(), `${prefix}-outside`);
      await fs.mkdir(assets, { recursive: true });
      await fs.mkdir(outside, { recursive: true });
      await fs.symlink(outside, path.join(assets, "thumbnails"), process.platform === "win32" ? "junction" : "dir");
      await expectFailure("junction", new MockThumbnailProvider());
    });
    await scenario("project storage root junction fails without secondary registry write", async () => {
      const slug = `${prefix}-project-root-junction`;
      const outside = path.join(process.cwd(), `${prefix}-root-outside`);
      await fs.mkdir(outside, { recursive: true });
      await fs.symlink(outside, path.join(projectsRoot, slug), process.platform === "win32" ? "junction" : "dir");
      await expectFailure("project-root-junction", new MockThumbnailProvider());
      assert.deepEqual(await fs.readdir(outside), []);
    });
    await scenario("atomic publish rejects rename collision and cleans temp file", async () => {
      const source = await generate("atomic-source");
      const data = await fs.readFile(path.join(process.cwd(), source.value.generation!.filePath!));
      const slug = `${prefix}-atomic-collision`;
      ThumbnailStorage.saveThumbnail({ projectSlug: slug, assetId: "collision-id", data, mimeType: "image/png" });
      assert.throws(() => ThumbnailStorage.saveThumbnail({
        projectSlug: slug, assetId: "collision-id", data, mimeType: "image/png",
      }));
      assert.deepEqual(await thumbnailFiles(slug), ["collision-id.png"]);
    });
    await scenario("oversized thumbnail payload is rejected before write", async () => {
      const slug = `${prefix}-oversized`;
      assert.throws(() => ThumbnailStorage.saveThumbnail({
        projectSlug: slug,
        assetId: "oversized",
        data: Buffer.alloc(64 * 1024 * 1024 + 1),
        mimeType: "image/png",
      }));
      assert.deepEqual(await thumbnailFiles(slug), []);
    });
    await scenario("extreme raster dimensions are rejected from physical PNG", async () => {
      const source = await generate("dimension-source");
      const data = await fs.readFile(path.join(process.cwd(), source.value.generation!.filePath!));
      assert.throws(() => ThumbnailStorage.saveThumbnail({
        projectSlug: `${prefix}-extreme-dimension`,
        assetId: "extreme",
        data: rewritePngDimensions(data, 16_385, 1),
        mimeType: "image/png",
      }));
    });
    await scenario("malformed and truncated PNG payloads fail structural validation", async () => {
      const source = await generate("truncated-source");
      const data = await fs.readFile(path.join(process.cwd(), source.value.generation!.filePath!));
      assert.throws(() => ThumbnailStorage.saveThumbnail({
        projectSlug: `${prefix}-truncated`, assetId: "truncated",
        data: data.subarray(0, data.length - 5), mimeType: "image/png",
      }));
      const corrupt = Buffer.from(data);
      corrupt[40] ^= 0xff;
      assert.throws(() => ThumbnailStorage.saveThumbnail({
        projectSlug: `${prefix}-corrupt-crc`, assetId: "corrupt",
        data: corrupt, mimeType: "image/png",
      }));
    });
    await scenario("JPEG and WebP MIME cannot accept PNG signatures", async () => {
      const source = await generate("signature-source");
      const data = await fs.readFile(path.join(process.cwd(), source.value.generation!.filePath!));
      assert.throws(() => ThumbnailStorage.saveThumbnail({
        projectSlug: `${prefix}-fake-jpeg`, assetId: "fake-jpeg", data, mimeType: "image/jpeg",
      }));
      assert.throws(() => ThumbnailStorage.saveThumbnail({
        projectSlug: `${prefix}-fake-webp`, assetId: "fake-webp", data, mimeType: "image/webp",
      }));
    });
    await scenario("route rejects encoded traversal and Windows separators", async () => {
      for (const value of ["%2e%2e", "..%2foutside", "..\\outside", "％2e％2e"]) {
        const response = await getThumbnailAsset(new Request("http://local"), {
          params: Promise.resolve({ slug: value, fileName: "outside.png" }),
        });
        assert.equal(response.status, 404);
        assert.equal(await response.text(), "Not found");
      }
    });
    await scenario("OpenAI timeout aborts and returns only normalized failure", async () => {
      process.env.OPENAI_API_KEY = "secret-thumbnail-key";
      globalThis.fetch = ((_input, init) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("secret-timeout-body")));
      })) as typeof fetch;
      const result = await new OpenAIThumbnailProvider({ timeoutMs: 10 }).generateThumbnailAsset(
        thumbnailAssetInput(`${prefix}-provider-timeout`),
      );
      assert.equal(result.success, false);
      assert.equal(result.error, "Thumbnail provider request failed.");
      globalThis.fetch = originalFetch;
      delete process.env.OPENAI_API_KEY;
    });
    await scenario("OpenAI response size limit aborts before body parsing", async () => {
      process.env.OPENAI_API_KEY = "secret-thumbnail-key";
      globalThis.fetch = (async () => new Response("private-response-body", {
        status: 200,
        headers: { "content-length": "1024" },
      })) as typeof fetch;
      const result = await new OpenAIThumbnailProvider({ maximumResponseBytes: 16 }).generateThumbnailAsset(
        thumbnailAssetInput(`${prefix}-provider-oversize`),
      );
      assert.equal(result.success, false);
      assert.equal(result.error, "Thumbnail provider request failed.");
      globalThis.fetch = originalFetch;
      delete process.env.OPENAI_API_KEY;
    });
    await scenario("AssetManager failure cleans the newly written physical orphan", async () => {
      const slug = `${prefix}-asset-manager-failure`;
      AssetManager.addAssetAtomically = () => { throw new Error("asset registry unavailable"); };
      await assert.rejects(generate("asset-manager-failure"), ThumbnailAssetGenerationError);
      AssetManager.addAssetAtomically = originalAssetAddAtomically;
      assert.deepEqual(await thumbnailFiles(slug), []);
    });
    await scenario("thumbnail persistence failure compensates registry and physical file", async () => {
      const project = await pipelineFixture("thumbnail-persistence-failure");
      ProjectManager.saveThumbnail = async () => { throw new Error("thumbnail write unavailable"); };
      const result = await PipelineRunner.continueProject(project.slug, ["thumbnail"]);
      ProjectManager.saveThumbnail = originalSaveThumbnail;
      assert.equal(result.continued, true);
      const assets = AssetManager.getProjectAssets(project.slug, project.id).assets;
      assert.equal(assets.filter((asset) => asset.type === "thumbnail" && asset.status === "generated").length, 0);
      assert.deepEqual(await thumbnailFiles(project.slug), []);
      const manifest = await ProjectManager.getManifest(project.slug);
      assert.equal(manifest?.packages.thumbnail.status, "failed");
      assert.equal(manifest?.packages.assembly.status, "completed");
    });
    await scenario("manifest failure retries to one canonical thumbnail asset", async () => {
      const project = await pipelineFixture("manifest-persistence-failure");
      ProjectManager.updatePackageStatus = async function(slug, stage, status, error, options) {
        if (stage === "thumbnail" && status === "completed") throw new Error("manifest unavailable");
        return originalUpdatePackageStatus.call(ProjectManager, slug, stage, status, error, options);
      };
      await PipelineRunner.continueProject(project.slug, ["thumbnail"]);
      ProjectManager.updatePackageStatus = originalUpdatePackageStatus;
      const failedJob = await PipelineJobManager.getJobForStage(project.slug, "thumbnail");
      assert.equal(failedJob?.status, "failed");
      const retry = await PipelineRunner.executeJobRetry(project.slug, failedJob!.id);
      assert.equal(retry.status, 200);
      const assets = AssetManager.getProjectAssets(project.slug, project.id).assets;
      const generated = assets.filter((asset) => asset.type === "thumbnail" && asset.status === "generated");
      assert.equal(generated.length, 1);
      assert.equal((assets.filter((asset) => asset.type === "thumbnail" && asset.status === "failed")).length, 1);
      assert.deepEqual(await thumbnailFiles(project.slug), [path.posix.basename(generated[0].filePath!)]);
      const stored = await ProjectManager.getThumbnail(project.slug) as ThumbnailData;
      assert.equal(stored.outputAssetId, generated[0].id);
    });
    await scenario("job persistence failure is reconciled on retry without false replay", async () => {
      const project = await pipelineFixture("job-persistence-failure");
      PipelineJobManager.persistStageSuccess = async function(slug, stage, persist) {
        if (stage === "thumbnail") {
          await persist();
          throw new Error("job persistence unavailable");
        }
        return originalPersistStageSuccess.call(PipelineJobManager, slug, stage, persist);
      };
      await PipelineRunner.continueProject(project.slug, ["thumbnail"]);
      PipelineJobManager.persistStageSuccess = originalPersistStageSuccess;
      const failedJob = await PipelineJobManager.getJobForStage(project.slug, "thumbnail");
      assert.equal(failedJob?.status, "failed");
      const retry = await PipelineRunner.executeJobRetry(project.slug, failedJob!.id);
      assert.equal(retry.status, 200);
      const thumbnails = AssetManager.getProjectAssets(project.slug, project.id).assets.filter(
        (asset) => asset.type === "thumbnail",
      );
      assert.equal(thumbnails.filter((asset) => asset.status === "generated").length, 1);
      assert.equal((await thumbnailFiles(project.slug)).length, 1);
    });
    await scenario("concurrent continuation claims execute thumbnail only once", async () => {
      const project = await pipelineFixture("concurrent");
      let calls = 0;
      const provider = injectedProvider("mock");
      const originalGenerate = provider.generateThumbnailAsset.bind(provider);
      provider.generateThumbnailAsset = async (input) => { calls++; return originalGenerate(input); };
      ThumbnailProviderRouter.prototype.getProvider = () => provider;
      const results = await Promise.all([
        PipelineRunner.continueProject(project.slug, ["thumbnail"]),
        PipelineRunner.continueProject(project.slug, ["thumbnail"]),
      ]);
      ThumbnailProviderRouter.prototype.getProvider = originalRouterGetProvider;
      assert.equal(results.filter((result) => result.continued).length, 1);
      assert.equal(calls, 1);
      const generated = AssetManager.getProjectAssets(project.slug, project.id).assets.filter(
        (asset) => asset.type === "thumbnail" && asset.status === "generated",
      );
      assert.equal(generated.length, 1);
    });
    await scenario("continuation executes thumbnail once and queues SEO", async () => {
      const project = await pipelineFixture("continuation");
      const result = await PipelineRunner.continueProject(project.slug, ["thumbnail"]);
      assert.equal(result.continued, true);
      if (!result.continued) throw new Error("Expected continuation.");
      assert.equal(result.completed, true);
      const jobs = await PipelineJobManager.listJobs(project.slug);
      assert.equal(jobs.jobs.find((job) => job.stage === "thumbnail")?.status, "completed");
      assert.equal(jobs.jobs.find((job) => job.stage === "seo")?.status, "queued");
    });
    await scenario("runner persists thumbnail failure and does not start downstream", async () => {
      const project = await pipelineFixture("runner-failure");
      ThumbnailProviderRouter.prototype.getProvider = () => injectedProvider("mock", (result) => ({ ...result as object, width: 0 })) as ThumbnailProvider;
      const result = await PipelineRunner.continueProject(project.slug, ["thumbnail"]);
      assert.equal(result.continued, true);
      if (!result.continued) throw new Error("Expected continuation.");
      assert.equal(result.completed, false);
      const jobs = await PipelineJobManager.listJobs(project.slug);
      assert.equal(jobs.jobs.find((job) => job.stage === "thumbnail")?.status, "failed");
      assert.notEqual(jobs.jobs.find((job) => job.stage === "seo")?.status, "running");
      assert.notEqual(jobs.jobs.find((job) => job.stage === "seo")?.status, "completed");
      const manifest = await ProjectManager.getManifest(project.slug);
      assert.equal(manifest?.packages.thumbnail.status, "failed");
      assert.notEqual(manifest?.packages.assembly.status, "failed");
      ThumbnailProviderRouter.prototype.getProvider = originalRouterGetProvider;
    });
    await scenario("retry succeeds without rolling back assembly", async () => {
      const project = await pipelineFixture("retry");
      ThumbnailProviderRouter.prototype.getProvider = () => injectedProvider("mock", (result) => ({ ...result as object, byteLength: 0 })) as ThumbnailProvider;
      await PipelineRunner.continueProject(project.slug, ["thumbnail"]);
      ThumbnailProviderRouter.prototype.getProvider = originalRouterGetProvider;
      const failedJob = await PipelineJobManager.getJobForStage(project.slug, "thumbnail");
      assert.ok(failedJob);
      const retry = await PipelineRunner.executeJobRetry(project.slug, failedJob!.id);
      assert.equal(retry.status, 200);
      const manifest = await ProjectManager.getManifest(project.slug);
      assert.equal(manifest?.packages.thumbnail.status, "completed");
      assert.equal(manifest?.packages.assembly.status, "completed");
    });

    assert.equal(scenarios, 42);
    console.log(`Sprint 120 production thumbnail pipeline smoke: PASS (${scenarios} scenarios)`);
  } finally {
    ThumbnailProviderRouter.prototype.getProvider = originalRouterGetProvider;
    AssetManager.addAsset = originalAssetAdd;
    AssetManager.addAssetAtomically = originalAssetAddAtomically;
    ProjectManager.saveThumbnail = originalSaveThumbnail;
    ProjectManager.updatePackageStatus = originalUpdatePackageStatus;
    PipelineJobManager.persistStageSuccess = originalPersistStageSuccess;
    globalThis.fetch = originalFetch;
    if (originalOpenAIKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalOpenAIKey;
    if (originalProvider === undefined) delete process.env.THUMBNAIL_PROVIDER;
    else process.env.THUMBNAIL_PROVIDER = originalProvider;
    const entries = await fs.readdir(projectsRoot, { withFileTypes: true });
    await Promise.all(entries.filter((entry) => entry.name.startsWith(prefix)).map((entry) => fs.rm(path.join(projectsRoot, entry.name), { recursive: true, force: true })));
    await fs.rm(path.join(process.cwd(), `${prefix}-outside`), { recursive: true, force: true });
    await fs.rm(path.join(process.cwd(), `${prefix}-root-outside`), { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
