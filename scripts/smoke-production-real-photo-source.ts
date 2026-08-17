import assert from "node:assert/strict";
import {
  VisualAssetGenerationError,
  VisualAssetPipeline,
} from "../src/lib/assets/VisualAssetPipeline";
import { ImageStorage } from "../src/lib/assets/storage/ImageStorage";
import type {
  ConfiguredImageProvider,
  ImageGenerationInput,
} from "../src/lib/assets/providers/ImageProvider";
import { createProviderDispatchAdapter } from
  "../src/lib/providers/ProviderDispatchAdapterAuthority";
import { ImageProviderRouter } from "../src/lib/assets/providers/ImageProviderRouter";
import { RealPhotoImageProvider } from "../src/lib/assets/providers/RealPhotoImageProvider";
import {
  WikimediaCommonsClient,
  WikimediaCommonsClientError,
} from "../src/lib/assets/providers/sources/WikimediaCommonsClient";
import {
  validateProviderVisualPlan,
} from "../src/lib/ai/VisualStructuredOutput";
import type { AIProvider } from "../src/lib/ai/providers/AIProvider";
import { VisualManager } from "../src/lib/visuals/VisualManager";
import type { ImageGenerationResult } from "../src/types/asset";
import type { VisualData } from "../src/types/visual";
import type { SceneData } from "../src/types/scene";
import { emitSmokeResult } from "./lib/SmokeResult";
import { withCanonicalSmokeRuntime } from "./lib/CanonicalSmokeRuntime";

let fixturePrefix = "";
const now = "2026-08-17T12:00:00.000Z";
const pngBytes = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  Buffer.alloc(256, 1),
]);
let scenarioCount = 0;

async function scenario(name: string, test: () => void | Promise<void>) {
  try {
    await test();
  } catch (error) {
    console.error(`Real photo source scenario failed: ${name}`);
    throw error;
  }
  scenarioCount += 1;
}

function wikimediaPage(overrides: Partial<{
  title: string; url: string; descriptionurl: string; width: number; height: number;
  mime: string; license: string; artist: string; credit: string;
}> = {}) {
  return {
    pageid: Math.floor(Math.random() * 1_000_000),
    title: overrides.title ?? "File:Hagia Sophia Istanbul.jpg",
    imageinfo: [{
      url: overrides.url ?? "https://upload.wikimedia.org/wikipedia/commons/hagia-sophia.jpg",
      descriptionurl: overrides.descriptionurl ??
        "https://commons.wikimedia.org/wiki/File:Hagia_Sophia_Istanbul.jpg",
      width: overrides.width ?? 1920,
      height: overrides.height ?? 1080,
      mime: overrides.mime ?? "image/png",
      extmetadata: {
        LicenseShortName: { value: overrides.license ?? "CC BY-SA 4.0" },
        Artist: { value: overrides.artist ?? "Example Photographer" },
        Credit: { value: overrides.credit ?? "Wikimedia Commons" },
      },
    }],
  };
}

function searchResponse(pages: ReturnType<typeof wikimediaPage>[]) {
  const record = Object.fromEntries(pages.map((page) => [String(page.pageid), page]));
  return new Response(JSON.stringify({ query: { pages: record } }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function fakeFetcher(
  handlers: {
    search?: () => Response | Promise<Response>;
    download?: () => Response | Promise<Response>;
  },
  calls: { search: number; download: number } = { search: 0, download: 0 },
): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("commons.wikimedia.org")) {
      calls.search += 1;
      if (!handlers.search) throw new Error("unexpected search call");
      return handlers.search();
    }
    if (url.includes("upload.wikimedia.org")) {
      calls.download += 1;
      if (!handlers.download) throw new Error("unexpected download call");
      return handlers.download();
    }
    throw new Error(`unexpected fetch target: ${url}`);
  }) as typeof fetch;
}

function testInput(overrides: Partial<ImageGenerationInput> = {}): ImageGenerationInput {
  return {
    prompt: "A dramatic wide shot",
    style: "cinematic",
    sceneId: 1,
    projectSlug: `${fixturePrefix}-input`,
    searchKeywords: ["Hagia Sophia"],
    ...overrides,
  };
}

async function run() {
  // --- WikimediaCommonsClient ---

  await scenario("client search parses a well-formed candidate", async () => {
    const client = new WikimediaCommonsClient({
      fetcher: fakeFetcher({ search: () => searchResponse([wikimediaPage()]) }),
      timeoutMs: 5_000,
      maxResponseBytes: 1024 * 1024,
    });
    const candidates = await client.search("Hagia Sophia", 5);
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].sourceName, "wikimedia-commons");
    assert.equal(candidates[0].mimeType, "image/png");
    assert.equal(candidates[0].width, 1920);
    assert.equal(candidates[0].license, "CC BY-SA 4.0");
    assert.equal(candidates[0].attribution, "Example Photographer");
  });

  await scenario("client search returns empty on malformed response", async () => {
    const client = new WikimediaCommonsClient({
      fetcher: fakeFetcher({ search: () => new Response("not json", { status: 200 }) }),
      timeoutMs: 5_000,
      maxResponseBytes: 1024 * 1024,
    });
    assert.deepEqual(await client.search("x", 5), []);
  });

  await scenario("client search returns empty on non-ok response", async () => {
    const client = new WikimediaCommonsClient({
      fetcher: fakeFetcher({ search: () => new Response("", { status: 503 }) }),
      timeoutMs: 5_000,
      maxResponseBytes: 1024 * 1024,
    });
    assert.deepEqual(await client.search("x", 5), []);
  });

  await scenario("client search returns empty for a blank query without dispatching", async () => {
    const calls = { search: 0, download: 0 };
    const client = new WikimediaCommonsClient({
      fetcher: fakeFetcher({ search: () => searchResponse([wikimediaPage()]) }, calls),
      timeoutMs: 5_000,
      maxResponseBytes: 1024 * 1024,
    });
    assert.deepEqual(await client.search("   ", 5), []);
    assert.equal(calls.search, 0);
  });

  await scenario("client downloadImage rejects a non-upload.wikimedia.org host", async () => {
    const client = new WikimediaCommonsClient({
      fetcher: fakeFetcher({}),
      timeoutMs: 5_000,
      maxResponseBytes: 1024 * 1024,
    });
    await assert.rejects(
      client.downloadImage("https://evil.example.com/image.png"),
      (error) => error instanceof WikimediaCommonsClientError,
    );
  });

  await scenario("client downloadImage enforces the response byte cap while streaming", async () => {
    const bigStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(2048));
        controller.close();
      },
    });
    const client = new WikimediaCommonsClient({
      fetcher: fakeFetcher({
        download: () => new Response(bigStream, { status: 200 }),
      }),
      timeoutMs: 5_000,
      maxResponseBytes: 512,
    });
    await assert.rejects(
      client.downloadImage("https://upload.wikimedia.org/wikipedia/commons/large.jpg"),
      (error) => error instanceof WikimediaCommonsClientError,
    );
  });

  await scenario("client downloadImage returns the full body under the cap", async () => {
    const client = new WikimediaCommonsClient({
      fetcher: fakeFetcher({
        download: () => new Response(new Uint8Array(pngBytes), { status: 200 }),
      }),
      timeoutMs: 5_000,
      maxResponseBytes: 1024 * 1024,
    });
    const bytes = await client.downloadImage("https://upload.wikimedia.org/wikipedia/commons/x.jpg");
    assert.equal(bytes.length, pngBytes.length);
  });

  // --- RealPhotoImageProvider ---

  await scenario("provider returns not-found without a network call when no keywords are given", async () => {
    const calls = { search: 0, download: 0 };
    const provider = new RealPhotoImageProvider({
      fetcher: fakeFetcher({ search: () => searchResponse([wikimediaPage()]) }, calls),
    });
    const result = await provider.generateImage(testInput({ searchKeywords: [] }));
    assert.equal(result.success, false);
    assert.equal(calls.search, 0);
  });

  await scenario("provider succeeds with a matching free-licensed candidate", async () => {
    const provider = new RealPhotoImageProvider({
      fetcher: fakeFetcher({
        search: () => searchResponse([wikimediaPage()]),
        download: () => new Response(new Uint8Array(pngBytes), { status: 200 }),
      }),
    });
    const slug = `${fixturePrefix}-success`;
    const result = await provider.generateImage(testInput({ projectSlug: slug }));
    assert.equal(result.success, true);
    if (result.success && result.provider === "real") {
      assert.equal(result.sourceName, "wikimedia-commons");
      assert.equal(result.license, "CC BY-SA 4.0");
      assert.equal(result.attribution, "Example Photographer");
      assert.equal(result.sourceUrl, "https://commons.wikimedia.org/wiki/File:Hagia_Sophia_Istanbul.jpg");
      assert.equal(result.mimeType, "image/png");
      assert.ok(result.filePath);
      const inspection = ImageStorage.inspectStoredImage(slug, result.filePath as string, "image/png");
      assert.equal(inspection.byteLength, pngBytes.length);
    } else {
      assert.fail("expected a successful real-photo result");
    }
  });

  await scenario("provider returns not-found when every candidate has a non-free license", async () => {
    const provider = new RealPhotoImageProvider({
      fetcher: fakeFetcher({
        search: () => searchResponse([wikimediaPage({ license: "All rights reserved" })]),
      }),
    });
    const result = await provider.generateImage(testInput({ projectSlug: `${fixturePrefix}-license` }));
    assert.equal(result.success, false);
  });

  await scenario("provider returns not-found when every candidate is missing license metadata", async () => {
    const page = wikimediaPage();
    page.imageinfo[0].extmetadata.LicenseShortName.value = "";
    page.imageinfo[0].extmetadata.Artist.value = "";
    page.imageinfo[0].extmetadata.Credit.value = "";
    const provider = new RealPhotoImageProvider({
      fetcher: fakeFetcher({ search: () => searchResponse([page]) }),
    });
    const result = await provider.generateImage(testInput({ projectSlug: `${fixturePrefix}-no-license` }));
    assert.equal(result.success, false);
  });

  await scenario("provider returns not-found when every candidate is below the minimum resolution", async () => {
    const provider = new RealPhotoImageProvider({
      fetcher: fakeFetcher({
        search: () => searchResponse([wikimediaPage({ width: 100, height: 80 })]),
      }),
    });
    const result = await provider.generateImage(testInput({ projectSlug: `${fixturePrefix}-small` }));
    assert.equal(result.success, false);
  });

  await scenario("provider returns not-found for an unsupported MIME type", async () => {
    const provider = new RealPhotoImageProvider({
      fetcher: fakeFetcher({
        search: () => searchResponse([wikimediaPage({ mime: "image/svg+xml" })]),
      }),
    });
    const result = await provider.generateImage(testInput({ projectSlug: `${fixturePrefix}-svg` }));
    assert.equal(result.success, false);
  });

  await scenario("provider returns not-found rather than throwing when the download fails", async () => {
    const provider = new RealPhotoImageProvider({
      fetcher: fakeFetcher({
        search: () => searchResponse([wikimediaPage()]),
        download: () => new Response("", { status: 500 }),
      }),
    });
    const result = await provider.generateImage(testInput({ projectSlug: `${fixturePrefix}-download-fail` }));
    assert.equal(result.success, false);
  });

  await scenario("provider selects the highest-resolution eligible candidate", async () => {
    const small = wikimediaPage({ title: "File:Small.jpg", width: 700, height: 400 });
    const large = wikimediaPage({ title: "File:Large.jpg", width: 3000, height: 2000 });
    const provider = new RealPhotoImageProvider({
      fetcher: fakeFetcher({
        search: () => searchResponse([small, large]),
        download: () => new Response(new Uint8Array(pngBytes), { status: 200 }),
      }),
    });
    const result = await provider.generateImage(testInput({ projectSlug: `${fixturePrefix}-rank` }));
    assert.equal(result.success, true);
    if (result.success && "model" in result) assert.equal(result.model, "wikimedia-commons");
  });

  // --- VisualAssetPipeline wiring: fallback and overrides ---

  const visualData: VisualData = {
    projectId: "real-photo-project",
    scenes: [{
      sceneId: 1,
      visualPrompt: "A dramatic wide shot of the city walls",
      animationPrompt: "Slow push-in",
      style: "cinematic",
      searchKeywords: ["Walls of Constantinople"],
    }],
    thumbnail: { title: "T", prompt: "P", composition: "C", mood: "M" },
    createdAt: now,
  };

  await scenario("pipeline falls back to AI when the real provider finds nothing", async () => {
    const slug = `${fixturePrefix}-fallback`;
    const realProvider = new RealPhotoImageProvider({
      fetcher: fakeFetcher({ search: () => searchResponse([]) }),
    });
    const aiCalls: number[] = [];
    const fakeOpenAI = fakeOpenAIProvider(aiCalls);
    const restore = patchOpenAIRouter(fakeOpenAI);
    try {
      const assets = await VisualAssetPipeline.generateAssets({
        projectId: visualData.projectId,
        projectSlug: slug,
        visualData,
        provider: realProvider,
      });
      const asset = assets.assets.find((item) => item.sceneId === 1);
      assert.equal(asset?.status, "generated");
      assert.equal(asset?.provider, "openai");
      assert.deepEqual(aiCalls, [1]);
    } finally {
      restore();
    }
  });

  await scenario('override "ai" skips the real attempt entirely', async () => {
    const slug = `${fixturePrefix}-override-ai`;
    const realCalls: number[] = [];
    const realProvider = createTrackedProvider("real", realCalls, () => ({
      success: false, sceneId: 1, provider: "real", createdAt: now, error: "should not be called",
    }));
    const aiCalls: number[] = [];
    const restore = patchOpenAIRouter(fakeOpenAIProvider(aiCalls));
    try {
      const assets = await VisualAssetPipeline.generateAssets({
        projectId: visualData.projectId,
        projectSlug: slug,
        visualData,
        provider: realProvider,
        overrides: { 1: "ai" },
      });
      const asset = assets.assets.find((item) => item.sceneId === 1);
      assert.equal(asset?.provider, "openai");
      assert.deepEqual(realCalls, []);
      assert.deepEqual(aiCalls, [1]);
    } finally {
      restore();
    }
  });

  await scenario('override "real" fails the scene instead of falling back when nothing is found', async () => {
    const slug = `${fixturePrefix}-override-real`;
    const realProvider = new RealPhotoImageProvider({
      fetcher: fakeFetcher({ search: () => searchResponse([]) }),
    });
    const aiCalls: number[] = [];
    const restore = patchOpenAIRouter(fakeOpenAIProvider(aiCalls));
    try {
      await assert.rejects(
        VisualAssetPipeline.generateAssets({
          projectId: visualData.projectId,
          projectSlug: slug,
          visualData,
          provider: realProvider,
          overrides: { 1: "real" },
        }),
        (error) => error instanceof VisualAssetGenerationError,
      );
      assert.deepEqual(aiCalls, []);
    } finally {
      restore();
    }
  });

  await scenario("overrides are ignored when the batch provider is not real", async () => {
    const slug = `${fixturePrefix}-override-ignored`;
    const aiCalls: number[] = [];
    const mockProvider: ConfiguredImageProvider = {
      name: "mock",
      async generateImage(input) {
        return {
          success: true, sceneId: input.sceneId, provider: "mock", model: "mock-image-model",
          url: "", filePath: "", mimeType: "image/mock", createdAt: now,
        };
      },
      createImmutableImageDispatchAdapter() {
        return createProviderDispatchAdapter(this, {
          metadata: { name: this.name }, requiredMethods: ["generateImage"],
        });
      },
    };
    const restore = patchOpenAIRouter(fakeOpenAIProvider(aiCalls));
    try {
      const assets = await VisualAssetPipeline.generateAssets({
        projectId: visualData.projectId,
        projectSlug: slug,
        visualData,
        provider: mockProvider,
        overrides: { 1: "real" },
      });
      assert.equal(assets.assets.find((item) => item.sceneId === 1)?.provider, "mock");
      assert.deepEqual(aiCalls, []);
    } finally {
      restore();
    }
  });

  await scenario("pipeline forwards scene searchKeywords into the provider input", async () => {
    const slug = `${fixturePrefix}-keywords`;
    const seen: (string[] | undefined)[] = [];
    const provider = createTrackedProvider("real", [], (input) => {
      seen.push(input.searchKeywords);
      return { success: false, sceneId: input.sceneId, provider: "real", createdAt: now, error: "x" };
    });
    const restore = patchOpenAIRouter(fakeOpenAIProvider([]));
    try {
      await VisualAssetPipeline.generateAssets({
        projectId: visualData.projectId,
        projectSlug: slug,
        visualData,
        provider,
      });
    } finally {
      restore();
    }
    assert.deepEqual(seen, [["Walls of Constantinople"]]);
  });

  // --- Strict canonical schema: searchKeywords ---

  const scenes: SceneData = {
    scenes: [{ id: 1, title: "T", description: "D" }],
    createdAt: now,
  };

  await scenario("strict schema accepts an omitted searchKeywords field", () => {
    const evidence = validateProviderVisualPlan({
      scenes: [{ sceneId: 1, visualPrompt: "p", animationPrompt: "a", style: "cinematic" }],
      thumbnail: { title: "t", prompt: "p", composition: "c", mood: "m" },
    }, scenes);
    assert.equal(evidence, undefined);
  });

  await scenario("strict schema accepts a valid searchKeywords array", () => {
    const evidence = validateProviderVisualPlan({
      scenes: [{
        sceneId: 1, visualPrompt: "p", animationPrompt: "a", style: "cinematic",
        searchKeywords: ["Hagia Sophia", "Istanbul"],
      }],
      thumbnail: { title: "t", prompt: "p", composition: "c", mood: "m" },
    }, scenes);
    assert.equal(evidence, undefined);
  });

  await scenario("strict schema rejects more than 12 searchKeywords", () => {
    const evidence = validateProviderVisualPlan({
      scenes: [{
        sceneId: 1, visualPrompt: "p", animationPrompt: "a", style: "cinematic",
        searchKeywords: Array.from({ length: 13 }, (_, index) => `k${index}`),
      }],
      thumbnail: { title: "t", prompt: "p", composition: "c", mood: "m" },
    }, scenes);
    assert.ok(evidence?.issues.some((issue) => issue.path === "$.scenes[0].searchKeywords" && issue.reason === "MAX_ITEMS"));
  });

  await scenario("strict schema rejects a non-array searchKeywords", () => {
    const evidence = validateProviderVisualPlan({
      scenes: [{
        sceneId: 1, visualPrompt: "p", animationPrompt: "a", style: "cinematic",
        searchKeywords: "Hagia Sophia",
      }],
      thumbnail: { title: "t", prompt: "p", composition: "c", mood: "m" },
    }, scenes);
    assert.ok(evidence?.issues.some((issue) => issue.path === "$.scenes[0].searchKeywords" && issue.reason === "WRONG_TYPE"));
  });

  await scenario("strict schema still rejects unrelated unknown fields", () => {
    const evidence = validateProviderVisualPlan({
      scenes: [{
        sceneId: 1, visualPrompt: "p", animationPrompt: "a", style: "cinematic",
        searchKeywords: ["Hagia Sophia"], unexpectedField: "nope",
      }],
      thumbnail: { title: "t", prompt: "p", composition: "c", mood: "m" },
    }, scenes);
    assert.ok(evidence?.issues.some((issue) => issue.path === "$.scenes[0].unexpectedField" && issue.reason === "UNKNOWN_FIELD"));
  });

  // --- Loose (non-strict) parsing path: VisualManager ---

  await scenario("VisualManager preserves valid AI-provided searchKeywords", async () => {
    const provider = fakeAIProvider(JSON.stringify({
      scenes: [{
        sceneId: 1, visualPrompt: "p", animationPrompt: "a", style: "cinematic",
        searchKeywords: ["Hagia Sophia", "  ", "Istanbul"],
      }],
      thumbnail: { title: "t", prompt: "p", composition: "c", mood: "m" },
    }));
    const result = await VisualManager.generateVisualData({
      projectId: "vm-1", projectSlug: `${fixturePrefix}-vm-1`, scenes, aiProvider: provider,
    });
    assert.deepEqual(result.scenes[0].searchKeywords, ["Hagia Sophia", "Istanbul"]);
  });

  await scenario("VisualManager drops a non-array searchKeywords without crashing", async () => {
    const provider = fakeAIProvider(JSON.stringify({
      scenes: [{
        sceneId: 1, visualPrompt: "p", animationPrompt: "a", style: "cinematic",
        searchKeywords: "not-an-array",
      }],
      thumbnail: { title: "t", prompt: "p", composition: "c", mood: "m" },
    }));
    const result = await VisualManager.generateVisualData({
      projectId: "vm-2", projectSlug: `${fixturePrefix}-vm-2`, scenes, aiProvider: provider,
    });
    assert.equal(result.scenes[0].searchKeywords, undefined);
  });
}

function createTrackedProvider(
  name: "real" | "openai" | "mock",
  calls: number[],
  generateImage: (input: ImageGenerationInput) => ImageGenerationResult | Promise<ImageGenerationResult>,
): ConfiguredImageProvider {
  const provider: ConfiguredImageProvider = {
    name,
    async generateImage(input) {
      calls.push(input.sceneId);
      return generateImage(input);
    },
    createImmutableImageDispatchAdapter() {
      return createProviderDispatchAdapter(provider, {
        metadata: { name: provider.name }, requiredMethods: ["generateImage"],
      });
    },
  };
  return provider;
}

function fakeOpenAIProvider(calls: number[]): ConfiguredImageProvider {
  return createTrackedProvider("openai", calls, (input) => ({
    success: true,
    sceneId: input.sceneId,
    provider: "openai",
    model: "fake-openai-model",
    filePath: `data/projects/${input.projectSlug}/assets/images/scene-${input.sceneId}.png`,
    url: `https://images.example.test/scene-${input.sceneId}.png`,
    mimeType: "image/png",
    createdAt: now,
  }));
}

function patchOpenAIRouter(fake: ConfiguredImageProvider): () => void {
  const original = ImageProviderRouter.getProvider;
  ImageProviderRouter.getProvider = (name?: string) =>
    name === "openai" ? fake : original(name);
  return () => {
    ImageProviderRouter.getProvider = original;
  };
}

function fakeAIProvider(response: string): AIProvider {
  return {
    async generate() {
      return response;
    },
  };
}

async function main() {
  await withCanonicalSmokeRuntime({ name: "real-photo-source", now }, async (runtime) => {
    fixturePrefix = `sprint-130-real-photo-${runtime.runId.slice(0, 12)}`;
    await run();
  });
  emitSmokeResult("production-real-photo-source", scenarioCount);
}

void main();
