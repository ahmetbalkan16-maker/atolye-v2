/**
 * Documentary media effort — Faz 1: real-media preference + AI-image budget in
 * VisualAssetPipeline.
 *
 * No real API. Stub image providers only. Verifies:
 *  1. an admissible real photo is used with 0 AI calls
 *  2. real-not-found -> AI fallback (when budget allows)
 *  3. a real result with a restricted / unknown licence is NOT admitted -> AI fallback
 *  4. AI-fallback assets carry honest mediaOrigin/mediaType/rightsStatus/selectionReason
 *  5. 16 scenes with exactly 4 AI-fallbacks -> PASS
 *  6. 16 scenes with a 5th AI-fallback -> deterministic VisualMediaAiBudgetExceededError
 *  7. the cap is deterministic at other scene counts (8/2, 3/3-fail)
 *  8. real-match provenance/source metadata is preserved (not lost by the new fields)
 */
import assert from "node:assert/strict";
import path from "node:path";
import { promises as fs } from "node:fs";
import { withCanonicalSmokeRuntime } from "./lib/CanonicalSmokeRuntime";
import {
  VisualAssetPipeline,
  VisualMediaAiBudgetExceededError,
} from "../src/lib/assets/VisualAssetPipeline";
import { ImageProviderRouter } from "../src/lib/assets/providers/ImageProviderRouter";
import { ImageStorage } from "../src/lib/assets/storage/ImageStorage";
import { createProviderDispatchAdapter } from "../src/lib/providers/ProviderDispatchAdapterAuthority";
import {
  resolveMaxAiImages,
  UNBOUNDED_AI_IMAGES,
  visualMediaAdmissionPolicy,
} from "../src/lib/assets/VisualMediaAdmissionPolicy";
import type {
  ConfiguredImageProvider,
  ImageGenerationInput,
} from "../src/lib/assets/providers/ImageProvider";
import type { ImageGenerationResult, ProjectAssets } from "../src/types/asset";
import type { VisualData } from "../src/types/visual";

const now = "2026-08-29T00:00:00.000Z";
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
let projectsRoot = "";
let prefix = "";
let count = 0;

function scenario(name: string, fn: () => Promise<void>) {
  return fn().then(() => {
    count += 1;
    if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
  });
}

function visualData(sceneCount: number): VisualData {
  return {
    projectId: "phase1-project",
    scenes: Array.from({ length: sceneCount }, (_, i) => ({
      sceneId: i + 1,
      visualPrompt: `Sahne ${i + 1} tek kare`,
      animationPrompt: "slow push in",
      style: "cinematic",
      searchKeywords: [`sahne ${i + 1}`],
    })),
    thumbnail: { title: "t", prompt: "p", composition: "c", mood: "m" },
    createdAt: now,
  };
}

function realPhoto(input: ImageGenerationInput, license: string): ImageGenerationResult {
  const saved = ImageStorage.saveImage({
    projectSlug: input.projectSlug as string, data: PNG, mimeType: "image/png",
  });
  return {
    success: true,
    sceneId: input.sceneId,
    provider: "real",
    model: "wikimedia-commons",
    filePath: saved.filePath,
    url: saved.url,
    mimeType: "image/png",
    sourceName: "wikimedia-commons",
    sourceUrl: `https://commons.wikimedia.org/wiki/File:Scene_${input.sceneId}.jpg`,
    license,
    attribution: "Example Photographer / Wikimedia Commons",
    selectionScore: 0.9,
    selectionRank: 1,
    candidateCount: 3,
    width: 1600,
    height: 1200,
    createdAt: now,
  };
}

function realNotFound(sceneId: number): ImageGenerationResult {
  return { success: false, sceneId, provider: "real", createdAt: now, error: "No matching real photo found." };
}

function aiImage(input: ImageGenerationInput): ImageGenerationResult {
  const saved = ImageStorage.saveImage({
    projectSlug: input.projectSlug as string, data: PNG, mimeType: "image/png",
  });
  return {
    success: true,
    sceneId: input.sceneId,
    provider: "openai",
    model: "stub-image-model",
    filePath: saved.filePath,
    url: saved.url,
    mimeType: "image/png",
    createdAt: now,
  };
}

/** Batch provider that reports name "real" and runs a per-scene script. */
function realBatchProvider(
  script: (input: ImageGenerationInput) => ImageGenerationResult,
  onCall?: (sceneId: number) => void,
): ConfiguredImageProvider {
  const provider: ConfiguredImageProvider = {
    name: "real",
    async generateImage(input) {
      onCall?.(input.sceneId);
      return script(input);
    },
    createImmutableImageDispatchAdapter() {
      return createProviderDispatchAdapter(provider, {
        metadata: { name: provider.name }, requiredMethods: ["generateImage"],
      });
    },
  };
  return provider;
}

function fakeOpenAiProvider(calls: number[]): ConfiguredImageProvider {
  const provider: ConfiguredImageProvider = {
    name: "openai",
    async generateImage(input) {
      calls.push(input.sceneId);
      return aiImage(input);
    },
    createImmutableImageDispatchAdapter() {
      return createProviderDispatchAdapter(provider, {
        metadata: { name: provider.name }, requiredMethods: ["generateImage"],
      });
    },
  };
  return provider;
}

function patchOpenAiRouter(fake: ConfiguredImageProvider): () => void {
  const original = ImageProviderRouter.getProvider;
  ImageProviderRouter.getProvider = (name?: string) => (name === "openai" ? fake : original(name));
  return () => { ImageProviderRouter.getProvider = original; };
}

async function readAssets(slug: string): Promise<ProjectAssets> {
  return JSON.parse(await fs.readFile(path.join(projectsRoot, slug, "assets", "assets.json"), "utf8")) as ProjectAssets;
}

async function run() {
  await scenario("admissible real photo (CC BY-SA 4.0) is used with ZERO AI calls", async () => {
    const aiCalls: number[] = [];
    const restore = patchOpenAiRouter(fakeOpenAiProvider(aiCalls));
    try {
      await VisualAssetPipeline.generateAssets({
        projectId: "phase1-project",
        projectSlug: `${prefix}-p1`,
        visualData: visualData(3),
        provider: realBatchProvider((i) => realPhoto(i, "CC BY-SA 4.0")),
        maxAiImages: 4,
      });
      const assets = await readAssets(`${prefix}-p1`);
      const images = assets.assets.filter((a) => a.type === "image" && a.status === "generated");
      assert.equal(images.length, 3);
      assert.ok(images.every((a) => a.provider === "real" && a.mediaOrigin === "real"));
      assert.ok(images.every((a) => a.rightsStatus === "open-license"));
      assert.ok(images.every((a) => a.mediaType === "photo" && a.selectionReason === "archive-photo-match"));
      assert.deepEqual(aiCalls, []);
    } finally { restore(); }
  });

  await scenario("real-not-found -> AI fallback (budget permitting)", async () => {
    const aiCalls: number[] = [];
    const restore = patchOpenAiRouter(fakeOpenAiProvider(aiCalls));
    try {
      await VisualAssetPipeline.generateAssets({
        projectId: "phase1-project",
        projectSlug: `${prefix}-p2`,
        visualData: visualData(2),
        provider: realBatchProvider((i) => realNotFound(i.sceneId)),
        maxAiImages: 4,
      });
      const assets = await readAssets(`${prefix}-p2`);
      const images = assets.assets.filter((a) => a.type === "image" && a.status === "generated");
      assert.equal(images.length, 2);
      assert.ok(images.every((a) => a.provider === "openai" && a.mediaOrigin === "ai"));
      assert.deepEqual(aiCalls.sort(), [1, 2]);
    } finally { restore(); }
  });

  await scenario("restricted-licence real result is NOT admitted -> AI fallback", async () => {
    const aiCalls: number[] = [];
    const restore = patchOpenAiRouter(fakeOpenAiProvider(aiCalls));
    try {
      await VisualAssetPipeline.generateAssets({
        projectId: "phase1-project",
        projectSlug: `${prefix}-p3`,
        visualData: visualData(1),
        provider: realBatchProvider((i) => realPhoto(i, "CC BY-NC 4.0")),
        maxAiImages: 4,
      });
      const assets = await readAssets(`${prefix}-p3`);
      const image = assets.assets.find((a) => a.type === "image" && a.status === "generated");
      assert.equal(image?.provider, "openai");
      assert.equal(image?.mediaOrigin, "ai");
      assert.deepEqual(aiCalls, [1]);
    } finally { restore(); }
  });

  await scenario("unknown-licence real result is NOT admitted -> AI fallback", async () => {
    const aiCalls: number[] = [];
    const restore = patchOpenAiRouter(fakeOpenAiProvider(aiCalls));
    try {
      await VisualAssetPipeline.generateAssets({
        projectId: "phase1-project",
        projectSlug: `${prefix}-p3b`,
        visualData: visualData(1),
        provider: realBatchProvider((i) => realPhoto(i, "see file page")),
        maxAiImages: 4,
      });
      const assets = await readAssets(`${prefix}-p3b`);
      assert.equal(assets.assets.find((a) => a.type === "image")?.provider, "openai");
      assert.deepEqual(aiCalls, [1]);
    } finally { restore(); }
  });

  await scenario("AI-fallback asset metadata is honest (mediaOrigin/mediaType/rightsStatus/selectionReason)", async () => {
    const restore = patchOpenAiRouter(fakeOpenAiProvider([]));
    try {
      await VisualAssetPipeline.generateAssets({
        projectId: "phase1-project",
        projectSlug: `${prefix}-p4`,
        visualData: visualData(1),
        provider: realBatchProvider((i) => realNotFound(i.sceneId)),
        maxAiImages: 4,
      });
      const image = (await readAssets(`${prefix}-p4`)).assets.find((a) => a.type === "image");
      assert.equal(image?.mediaOrigin, "ai");
      assert.equal(image?.mediaType, "ai-image");
      assert.equal(image?.rightsStatus, undefined); // AI images have no real-media licence
      assert.equal(image?.selectionReason, "no-suitable-real-media-found");
      assert.equal(typeof image?.discoveredAt, "string");
      assert.equal(image?.sourceUrl, undefined);
    } finally { restore(); }
  });

  await scenario("16 scenes, exactly 4 AI fallbacks -> PASS", async () => {
    const aiCalls: number[] = [];
    const restore = patchOpenAiRouter(fakeOpenAiProvider(aiCalls));
    try {
      // scenes 1-12 real (admissible), 13-16 real-not-found -> 4 AI fallbacks
      await VisualAssetPipeline.generateAssets({
        projectId: "phase1-project",
        projectSlug: `${prefix}-p5`,
        visualData: visualData(16),
        provider: realBatchProvider((i) =>
          i.sceneId <= 12 ? realPhoto(i, "Public domain") : realNotFound(i.sceneId)),
        maxAiImages: 4,
      });
      const images = (await readAssets(`${prefix}-p5`)).assets.filter((a) => a.type === "image" && a.status === "generated");
      assert.equal(images.length, 16);
      assert.equal(images.filter((a) => a.mediaOrigin === "real").length, 12);
      assert.equal(images.filter((a) => a.mediaOrigin === "ai").length, 4);
      assert.equal(images.filter((a) => a.rightsStatus === "public-domain").length, 12);
      assert.deepEqual(aiCalls.sort((x, y) => x - y), [13, 14, 15, 16]);
    } finally { restore(); }
  });

  await scenario("16 scenes, a 5th AI fallback -> deterministic VisualMediaAiBudgetExceededError", async () => {
    const aiCalls: number[] = [];
    const restore = patchOpenAiRouter(fakeOpenAiProvider(aiCalls));
    try {
      await assert.rejects(
        VisualAssetPipeline.generateAssets({
          projectId: "phase1-project",
          projectSlug: `${prefix}-p6`,
          visualData: visualData(16),
          // scenes 1-11 real, 12-16 real-not-found -> the 5th AI fallback (scene 16) is over budget
          provider: realBatchProvider((i) =>
            i.sceneId <= 11 ? realPhoto(i, "CC0") : realNotFound(i.sceneId)),
          maxAiImages: 4,
        }),
        (e) => e instanceof VisualMediaAiBudgetExceededError && e.maxAiImages === 4 && e.sceneId === 16,
      );
      // exactly 4 AI images were produced; the 5th request was never dispatched
      assert.equal(aiCalls.length, 4);
      const images = (await readAssets(`${prefix}-p6`)).assets.filter((a) => a.type === "image" && a.status === "generated");
      assert.equal(images.filter((a) => a.mediaOrigin === "ai").length, 4);
      // scene 16 persisted as a failed asset (deterministic, not silent)
      assert.ok((await readAssets(`${prefix}-p6`)).assets.some((a) => a.sceneId === 16 && a.status === "failed"));
    } finally { restore(); }
  });

  await scenario("cap is deterministic at other scene counts (8 scenes: 6 real + 2 AI ok; then 3rd AI fails)", async () => {
    const restore = patchOpenAiRouter(fakeOpenAiProvider([]));
    try {
      await VisualAssetPipeline.generateAssets({
        projectId: "phase1-project",
        projectSlug: `${prefix}-p7a`,
        visualData: visualData(8),
        provider: realBatchProvider((i) => (i.sceneId <= 6 ? realPhoto(i, "CC BY 4.0") : realNotFound(i.sceneId))),
        maxAiImages: 2,
      });
      const a = (await readAssets(`${prefix}-p7a`)).assets.filter((x) => x.type === "image" && x.status === "generated");
      assert.equal(a.filter((x) => x.mediaOrigin === "ai").length, 2);

      await assert.rejects(
        VisualAssetPipeline.generateAssets({
          projectId: "phase1-project",
          projectSlug: `${prefix}-p7b`,
          visualData: visualData(3),
          provider: realBatchProvider((i) => realNotFound(i.sceneId)),
          maxAiImages: 2,
        }),
        (e) => e instanceof VisualMediaAiBudgetExceededError && e.sceneId === 3,
      );
    } finally { restore(); }
  });

  await scenario("real-match provenance + source metadata is preserved (Sprint 130 fields not lost)", async () => {
    const restore = patchOpenAiRouter(fakeOpenAiProvider([]));
    try {
      await VisualAssetPipeline.generateAssets({
        projectId: "phase1-project",
        projectSlug: `${prefix}-p8`,
        visualData: visualData(1),
        provider: realBatchProvider((i) => realPhoto(i, "CC BY-SA 4.0")),
        maxAiImages: 4,
      });
      const image = (await readAssets(`${prefix}-p8`)).assets.find((a) => a.type === "image");
      // pre-existing provenance (Sprint 130)
      assert.equal(image?.provider, "real");
      assert.equal(image?.sourceName, "wikimedia-commons");
      assert.match(image?.sourceUrl ?? "", /^https:\/\/commons\.wikimedia\.org\//);
      assert.equal(image?.license, "CC BY-SA 4.0");
      assert.equal(image?.attribution, "Example Photographer / Wikimedia Commons");
      assert.equal(image?.selectionScore, 0.9);
      assert.equal(image?.selectionRank, 1);
      assert.equal(image?.candidateCount, 3);
      assert.equal(image?.width, 1600);
      assert.equal(image?.height, 1200);
      // new provenance (Faz 1)
      assert.equal(image?.mediaOrigin, "real");
      assert.equal(image?.mediaType, "photo");
      assert.equal(image?.rightsStatus, "open-license");
      assert.equal(image?.selectionReason, "archive-photo-match");
      assert.equal(typeof image?.discoveredAt, "string");
    } finally { restore(); }
  });

  await scenario("policy exposes a single maxAiImages point, default 4", () => {
    assert.equal(visualMediaAdmissionPolicy.maxAiImages, 4);
    return Promise.resolve();
  });

  await scenario("resolveMaxAiImages: unset/empty/malformed -> strict default 4; explicit int/unbounded honoured", () => {
    const e = (v?: string) =>
      (v === undefined ? {} : { ATOLYE_MAX_AI_IMAGES: v }) as unknown as NodeJS.ProcessEnv;
    assert.equal(resolveMaxAiImages(e()), 4);
    assert.equal(resolveMaxAiImages(e("")), 4);
    assert.equal(resolveMaxAiImages(e("not-a-number")), 4);
    assert.equal(resolveMaxAiImages(e("-3")), 4);
    assert.equal(resolveMaxAiImages(e("0")), 0);
    assert.equal(resolveMaxAiImages(e("16")), 16);
    assert.equal(resolveMaxAiImages(e(" 12 ")), 12);
    assert.equal(resolveMaxAiImages(e("unbounded")), UNBOUNDED_AI_IMAGES);
    assert.equal(resolveMaxAiImages(e("OFF")), UNBOUNDED_AI_IMAGES);
    return Promise.resolve();
  });

  console.log(`Phase 1 visual media admission smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "phase1-visual-media-admission", scenarios: count }));
}

async function main() {
  await withCanonicalSmokeRuntime({ name: "phase1-visual-media-admission", now }, async (runtime) => {
    projectsRoot = runtime.runtimeStorageContext.projectsRoot;
    prefix = `phase1-${runtime.runId.slice(0, 10)}`;
    await run();
  });
}

main().catch((error) => {
  console.error("Phase 1 visual media admission smoke FAILED:", error);
  process.exitCode = 1;
});
