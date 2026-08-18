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
  WikimediaCommonsRateLimitedError,
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
  thumburl: string; thumbwidth: number; thumbheight: number;
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
      ...(overrides.thumburl ? {
        thumburl: overrides.thumburl,
        thumbwidth: overrides.thumbwidth,
        thumbheight: overrides.thumbheight,
      } : {}),
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
    search?: (url?: string) => Response | Promise<Response>;
    download?: (url?: string) => Response | Promise<Response>;
  },
  calls: { search: number; download: number } = { search: 0, download: 0 },
): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("commons.wikimedia.org")) {
      calls.search += 1;
      if (!handlers.search) throw new Error("unexpected search call");
      return handlers.search(url);
    }
    if (url.includes("upload.wikimedia.org")) {
      calls.download += 1;
      if (!handlers.download) throw new Error("unexpected download call");
      return handlers.download(url);
    }
    throw new Error(`unexpected fetch target: ${url}`);
  }) as typeof fetch;
}

/** No-op delay for tests: exercises retry/pacing code paths without real elapsed time. */
async function noDelay(): Promise<void> {}

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

  await scenario("client search retries once after a transient failure, then succeeds", async () => {
    let attempts = 0;
    const client = new WikimediaCommonsClient({
      fetcher: fakeFetcher({
        search: () => {
          attempts += 1;
          if (attempts === 1) throw new Error("transient network blip");
          return searchResponse([wikimediaPage()]);
        },
      }),
      timeoutMs: 5_000,
      maxResponseBytes: 1024 * 1024,
      retryDelayMs: 10,
      delayFn: noDelay,
    });
    const candidates = await client.search("Hagia Sophia", 5);
    assert.equal(attempts, 2);
    assert.equal(candidates.length, 1);
  });

  await scenario("client search does not retry when retryDelayMs is 0", async () => {
    let attempts = 0;
    const client = new WikimediaCommonsClient({
      fetcher: fakeFetcher({
        search: () => {
          attempts += 1;
          throw new Error("always fails");
        },
      }),
      timeoutMs: 5_000,
      maxResponseBytes: 1024 * 1024,
      retryDelayMs: 0,
    });
    assert.deepEqual(await client.search("x", 5), []);
    assert.equal(attempts, 1);
  });

  await scenario("client downloadImage retries once after a transient failure, then succeeds", async () => {
    let attempts = 0;
    const client = new WikimediaCommonsClient({
      fetcher: fakeFetcher({
        download: () => {
          attempts += 1;
          if (attempts === 1) throw new Error("transient network blip");
          return new Response(new Uint8Array(pngBytes), { status: 200 });
        },
      }),
      timeoutMs: 5_000,
      maxResponseBytes: 1024 * 1024,
      retryDelayMs: 10,
      delayFn: noDelay,
    });
    const bytes = await client.downloadImage("https://upload.wikimedia.org/wikipedia/commons/x.jpg");
    assert.equal(attempts, 2);
    assert.equal(bytes.length, pngBytes.length);
  });

  await scenario("client downloadImage gives up after two consecutive failures", async () => {
    let attempts = 0;
    const client = new WikimediaCommonsClient({
      fetcher: fakeFetcher({
        download: () => {
          attempts += 1;
          throw new Error("always fails");
        },
      }),
      timeoutMs: 5_000,
      maxResponseBytes: 1024 * 1024,
      retryDelayMs: 10,
      delayFn: noDelay,
    });
    await assert.rejects(
      client.downloadImage("https://upload.wikimedia.org/wikipedia/commons/x.jpg"),
      (error) => error instanceof WikimediaCommonsClientError,
    );
    assert.equal(attempts, 2);
  });

  await scenario("client downloadImage never retries a 429 — Wikimedia asks callers not to", async () => {
    let attempts = 0;
    const client = new WikimediaCommonsClient({
      fetcher: fakeFetcher({
        download: () => { attempts += 1; return new Response("Too many requests", { status: 429 }); },
      }),
      timeoutMs: 5_000,
      maxResponseBytes: 1024 * 1024,
      retryDelayMs: 10,
      delayFn: noDelay,
    });
    await assert.rejects(
      client.downloadImage("https://upload.wikimedia.org/wikipedia/commons/x.jpg"),
      (error) => error instanceof WikimediaCommonsRateLimitedError,
    );
    assert.equal(attempts, 1);
  });

  await scenario("client search never retries a 429 either", async () => {
    let attempts = 0;
    const client = new WikimediaCommonsClient({
      fetcher: fakeFetcher({
        search: () => { attempts += 1; return new Response("Too many requests", { status: 429 }); },
      }),
      timeoutMs: 5_000,
      maxResponseBytes: 1024 * 1024,
      retryDelayMs: 10,
      delayFn: noDelay,
    });
    assert.deepEqual(await client.search("x", 5), []);
    assert.equal(attempts, 1);
  });

  await scenario("client search requests iiurlwidth and prefers the thumbnail over a larger original", async () => {
    let requestedUrl = "";
    const client = new WikimediaCommonsClient({
      fetcher: fakeFetcher({
        search: (url) => {
          requestedUrl = url ?? "";
          return searchResponse([wikimediaPage({
            width: 8000, height: 6000,
            thumburl: "https://upload.wikimedia.org/wikipedia/commons/thumb/hagia-sophia-1920px.jpg",
            thumbwidth: 1920, thumbheight: 1440,
          })]);
        },
      }),
      timeoutMs: 5_000,
      maxResponseBytes: 1024 * 1024,
    });
    const candidates = await client.search("Hagia Sophia", 5, 1920);
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].width, 1920);
    assert.equal(candidates[0].height, 1440);
    assert.match(candidates[0].imageUrl, /thumb/);
    assert.equal(requestedUrl.includes("iiurlwidth=1920"), true);
  });

  await scenario("client search ignores a thumbnail that would upscale the original", async () => {
    const client = new WikimediaCommonsClient({
      fetcher: fakeFetcher({
        search: () => searchResponse([wikimediaPage({
          width: 800, height: 600,
          thumburl: "https://upload.wikimedia.org/wikipedia/commons/thumb/should-not-be-used.jpg",
          thumbwidth: 1920, thumbheight: 1440,
        })]),
      }),
      timeoutMs: 5_000,
      maxResponseBytes: 1024 * 1024,
    });
    const candidates = await client.search("Hagia Sophia", 5, 1920);
    assert.equal(candidates[0].width, 800);
    assert.doesNotMatch(candidates[0].imageUrl, /thumb/);
  });

  // --- RealPhotoImageProvider ---

  await scenario("provider returns not-found without a network call when no keywords are given", async () => {
    const calls = { search: 0, download: 0 };
    const provider = new RealPhotoImageProvider({
      delayFn: noDelay,
      fetcher: fakeFetcher({ search: () => searchResponse([wikimediaPage()]) }, calls),
    });
    const result = await provider.generateImage(testInput({ searchKeywords: [] }));
    assert.equal(result.success, false);
    assert.equal(calls.search, 0);
  });

  await scenario("provider succeeds with a matching free-licensed candidate", async () => {
    const provider = new RealPhotoImageProvider({
      delayFn: noDelay,
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
      delayFn: noDelay,
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
      delayFn: noDelay,
      fetcher: fakeFetcher({ search: () => searchResponse([page]) }),
    });
    const result = await provider.generateImage(testInput({ projectSlug: `${fixturePrefix}-no-license` }));
    assert.equal(result.success, false);
  });

  await scenario("provider returns not-found when every candidate is below the minimum resolution", async () => {
    const provider = new RealPhotoImageProvider({
      delayFn: noDelay,
      fetcher: fakeFetcher({
        search: () => searchResponse([wikimediaPage({ width: 100, height: 80 })]),
      }),
    });
    const result = await provider.generateImage(testInput({ projectSlug: `${fixturePrefix}-small` }));
    assert.equal(result.success, false);
  });

  await scenario("provider returns not-found for an unsupported MIME type", async () => {
    const provider = new RealPhotoImageProvider({
      delayFn: noDelay,
      fetcher: fakeFetcher({
        search: () => searchResponse([wikimediaPage({ mime: "image/svg+xml" })]),
      }),
    });
    const result = await provider.generateImage(testInput({ projectSlug: `${fixturePrefix}-svg` }));
    assert.equal(result.success, false);
  });

  await scenario("provider returns not-found rather than throwing when the download fails", async () => {
    const provider = new RealPhotoImageProvider({
      delayFn: noDelay,
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
      delayFn: noDelay,
      fetcher: fakeFetcher({
        search: () => searchResponse([small, large]),
        download: () => new Response(new Uint8Array(pngBytes), { status: 200 }),
      }),
    });
    const result = await provider.generateImage(testInput({ projectSlug: `${fixturePrefix}-rank` }));
    assert.equal(result.success, true);
    if (result.success && "model" in result) assert.equal(result.model, "wikimedia-commons");
  });

  await scenario("provider prefers a title-relevant candidate over a larger but off-topic one", async () => {
    // Reproduces the Sprint 130 live-check finding: "Kuppel Kleine Hagia Sophia.jpg" (a
    // different, smaller building) outranked "Hagia Sophia Interior Panorama.jpg" purely on
    // resolution. Word-overlap scoring must now prefer the fully-matching title.
    const offTopicButLarger = wikimediaPage({
      title: "File:Kuppel Kleine Hagia Sophia.jpg", width: 4288, height: 2848,
      descriptionurl: "https://commons.wikimedia.org/wiki/File:Kuppel_Kleine_Hagia_Sophia.jpg",
    });
    const relevantButSmaller = wikimediaPage({
      title: "File:Hagia Sophia Interior Panorama.jpg", width: 3856, height: 3047,
      descriptionurl: "https://commons.wikimedia.org/wiki/File:Hagia_Sophia_Interior_Panorama.jpg",
    });
    const provider = new RealPhotoImageProvider({
      delayFn: noDelay,
      fetcher: fakeFetcher({
        search: () => searchResponse([offTopicButLarger, relevantButSmaller]),
        download: () => new Response(new Uint8Array(pngBytes), { status: 200 }),
      }),
    });
    const result = await provider.generateImage(testInput({
      projectSlug: `${fixturePrefix}-relevance`, searchKeywords: ["Hagia Sophia interior"],
    }));
    assert.equal(result.success, true);
    if (result.success && "sourceUrl" in result) {
      assert.match(result.sourceUrl, /Interior_Panorama/);
      assert.equal(result.selectionScore, 1);
      assert.equal(result.selectionRank, 1);
      assert.equal(result.candidateCount, 2);
    } else {
      assert.fail("expected a successful result with sourceUrl");
    }
  });

  await scenario("provider excludes Internet Archive Book Images candidates even when free-licensed", async () => {
    // Reproduces the Sprint 130 live-check finding: a public-domain, correctly-formed candidate
    // whose actual page content is an unrelated scanned-book illustration, tagged with
    // Wikimedia's batch book-scan attribution.
    const bookScan = wikimediaPage({
      title: "File:Constantine the Great; unrelated book plate.jpg",
      license: "Public domain", artist: "Internet Archive Book Images",
    });
    const provider = new RealPhotoImageProvider({
      delayFn: noDelay,
      fetcher: fakeFetcher({ search: () => searchResponse([bookScan]) }),
    });
    const result = await provider.generateImage(testInput({ projectSlug: `${fixturePrefix}-book-scan` }));
    assert.equal(result.success, false);
  });

  await scenario("provider falls through to the next candidate when the top-ranked download fails", async () => {
    const first = wikimediaPage({
      title: "File:Hagia Sophia A.jpg", width: 3000, height: 2000,
      descriptionurl: "https://commons.wikimedia.org/wiki/File:Hagia_Sophia_A.jpg",
    });
    const second = wikimediaPage({
      title: "File:Hagia Sophia B.jpg", width: 2000, height: 1500,
      descriptionurl: "https://commons.wikimedia.org/wiki/File:Hagia_Sophia_B.jpg",
    });
    let downloadCalls = 0;
    const provider = new RealPhotoImageProvider({
      delayFn: noDelay,
      fetcher: fakeFetcher({
        search: () => searchResponse([first, second]),
        download: () => {
          downloadCalls += 1;
          // The first candidate's download fails on both the client's initial attempt and its
          // own internal retry (calls 1-2), so the provider must move on to the next candidate.
          if (downloadCalls <= 2) return new Response("", { status: 500 });
          return new Response(new Uint8Array(pngBytes), { status: 200 });
        },
      }),
    });
    const result = await provider.generateImage(testInput({
      projectSlug: `${fixturePrefix}-fallthrough`, searchKeywords: ["Hagia Sophia"],
    }));
    assert.equal(result.success, true);
    assert.equal(downloadCalls, 3);
    if (result.success && "selectionRank" in result) {
      assert.equal(result.selectionRank, 2);
      assert.equal(result.candidateCount, 2);
      assert.match(result.sourceUrl, /Hagia_Sophia_B/);
    } else {
      assert.fail("expected a successful result with selectionRank");
    }
  });

  await scenario("provider stops immediately on a 429 instead of trying more candidates", async () => {
    const pages = [
      wikimediaPage({ title: "File:Hagia Sophia A.jpg", width: 3000, height: 2000,
        descriptionurl: "https://commons.wikimedia.org/wiki/File:Hagia_Sophia_A.jpg" }),
      wikimediaPage({ title: "File:Hagia Sophia B.jpg", width: 2000, height: 1500,
        descriptionurl: "https://commons.wikimedia.org/wiki/File:Hagia_Sophia_B.jpg" }),
    ];
    let downloadCalls = 0;
    const provider = new RealPhotoImageProvider({
      delayFn: noDelay,
      fetcher: fakeFetcher({
        search: () => searchResponse(pages),
        download: () => { downloadCalls += 1; return new Response("", { status: 429 }); },
      }),
    });
    const result = await provider.generateImage(testInput({
      projectSlug: `${fixturePrefix}-rate-limited`, searchKeywords: ["Hagia Sophia"],
    }));
    assert.equal(result.success, false);
    // One download call: the client itself never retries a 429, and the provider must not touch
    // the second candidate either — both would just add to the same active rate limit.
    assert.equal(downloadCalls, 1);
  });

  await scenario("provider gives up after exhausting the candidate attempt limit", async () => {
    const pages = Array.from({ length: 5 }, (_, index) =>
      wikimediaPage({ title: `File:Hagia Sophia ${index}.jpg`, width: 2000 - index, height: 1000 }));
    let downloadCalls = 0;
    const provider = new RealPhotoImageProvider({
      delayFn: noDelay,
      fetcher: fakeFetcher({
        search: () => searchResponse(pages),
        download: () => { downloadCalls += 1; return new Response("", { status: 500 }); },
      }),
    });
    const result = await provider.generateImage(testInput({
      projectSlug: `${fixturePrefix}-exhausted`, searchKeywords: ["Hagia Sophia"],
    }));
    assert.equal(result.success, false);
    // Default candidateAttemptLimit is 3, each candidate retried once by the client = 6 calls.
    assert.equal(downloadCalls, 6);
  });

  await scenario("provider downloads and persists the thumbnail rendition, not the multi-MB original", async () => {
    const provider = new RealPhotoImageProvider({
      delayFn: noDelay,
      fetcher: fakeFetcher({
        search: () => searchResponse([wikimediaPage({
          width: 8000, height: 6000,
          thumburl: "https://upload.wikimedia.org/wikipedia/commons/thumb/hagia-sophia-1920px.jpg",
          thumbwidth: 1920, thumbheight: 1440,
        })]),
        download: (url) => {
          assert.match(url ?? "", /thumb/);
          return new Response(new Uint8Array(pngBytes), { status: 200 });
        },
      }),
    });
    const result = await provider.generateImage(testInput({ projectSlug: `${fixturePrefix}-thumb` }));
    assert.equal(result.success, true);
    if (result.success && "width" in result) {
      assert.equal(result.width, 1920);
      assert.equal(result.height, 1440);
    } else {
      assert.fail("expected a successful result with width/height");
    }
  });

  await scenario("provider stops trying more candidates once the scene budget is exhausted", async () => {
    const originalBudget = process.env.IMAGE_REAL_SCENE_BUDGET_MS;
    process.env.IMAGE_REAL_SCENE_BUDGET_MS = "5000";
    try {
      let clock = 0;
      const now = () => clock;
      const advancingDelay = async (ms: number) => { clock += ms; };
      const pages = Array.from({ length: 3 }, (_, index) => wikimediaPage({
        title: `File:Hagia Sophia ${index}.jpg`, width: 2000, height: 1500,
        descriptionurl: `https://commons.wikimedia.org/wiki/File:Hagia_Sophia_${index}.jpg`,
      }));
      let downloadCalls = 0;
      const provider = new RealPhotoImageProvider({
        now,
        delayFn: advancingDelay,
        fetcher: fakeFetcher({
          search: () => searchResponse(pages),
          download: () => {
            downloadCalls += 1;
            // Simulate each attempt eating far more than its fair share of the scene budget.
            clock += 6_000;
            return new Response("", { status: 500 });
          },
        }),
      });
      const result = await provider.generateImage(testInput({
        projectSlug: `${fixturePrefix}-scene-budget`, searchKeywords: ["Hagia Sophia"],
      }));
      assert.equal(result.success, false);
      // The first candidate's failure plus the client's own retry (2 calls) already exceeds the
      // 5s scene budget, so the deadline check must stop before ever trying candidates 2 or 3.
      assert.ok(
        downloadCalls <= 2,
        `expected the scene budget to stop further candidates early, got ${downloadCalls} download calls`,
      );
    } finally {
      if (originalBudget === undefined) delete process.env.IMAGE_REAL_SCENE_BUDGET_MS;
      else process.env.IMAGE_REAL_SCENE_BUDGET_MS = originalBudget;
    }
  });

  await scenario("provider paces consecutive scenes on the same instance, never the first one", async () => {
    const originalInterval = process.env.IMAGE_REAL_MIN_REQUEST_INTERVAL_MS;
    process.env.IMAGE_REAL_MIN_REQUEST_INTERVAL_MS = "1000";
    try {
      let clock = 0;
      const now = () => clock;
      const waits: number[] = [];
      const trackingDelay = async (ms: number) => { waits.push(ms); clock += ms; };
      const provider = new RealPhotoImageProvider({
        now,
        delayFn: trackingDelay,
        fetcher: fakeFetcher({
          search: () => searchResponse([wikimediaPage()]),
          download: () => new Response(new Uint8Array(pngBytes), { status: 200 }),
        }),
      });
      await provider.generateImage(testInput({ projectSlug: `${fixturePrefix}-pace-1` }));
      assert.deepEqual(waits, []); // first request on a fresh instance is never delayed

      clock += 200; // barely any time passed between "scenes" — well under the 1000ms floor
      await provider.generateImage(testInput({ projectSlug: `${fixturePrefix}-pace-2` }));
      assert.deepEqual(waits, [800]); // tops the gap up to exactly the configured 1000ms floor
    } finally {
      if (originalInterval === undefined) delete process.env.IMAGE_REAL_MIN_REQUEST_INTERVAL_MS;
      else process.env.IMAGE_REAL_MIN_REQUEST_INTERVAL_MS = originalInterval;
    }
  });

  await scenario("provider never paces a scene with no search keywords", async () => {
    const originalInterval = process.env.IMAGE_REAL_MIN_REQUEST_INTERVAL_MS;
    process.env.IMAGE_REAL_MIN_REQUEST_INTERVAL_MS = "5000";
    try {
      let clock = 0;
      const waits: number[] = [];
      const provider = new RealPhotoImageProvider({
        now: () => clock,
        delayFn: async (ms) => { waits.push(ms); clock += ms; },
        fetcher: fakeFetcher({}),
      });
      await provider.generateImage(testInput({
        projectSlug: `${fixturePrefix}-no-pace`, searchKeywords: [],
      }));
      assert.deepEqual(waits, []);
    } finally {
      if (originalInterval === undefined) delete process.env.IMAGE_REAL_MIN_REQUEST_INTERVAL_MS;
      else process.env.IMAGE_REAL_MIN_REQUEST_INTERVAL_MS = originalInterval;
    }
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
      delayFn: noDelay,
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

  await scenario("pipeline persists selection metadata onto the asset for a real match", async () => {
    const slug = `${fixturePrefix}-selection-metadata`;
    const realProvider = new RealPhotoImageProvider({
      delayFn: noDelay,
      fetcher: fakeFetcher({
        search: () => searchResponse([wikimediaPage({
          title: "File:Walls of Constantinople 1.jpg", width: 1200, height: 900,
        })]),
        download: () => new Response(new Uint8Array(pngBytes), { status: 200 }),
      }),
    });
    const assets = await VisualAssetPipeline.generateAssets({
      projectId: visualData.projectId,
      projectSlug: slug,
      visualData,
      provider: realProvider,
    });
    const asset = assets.assets.find((item) => item.sceneId === 1);
    assert.equal(asset?.provider, "real");
    assert.equal(asset?.selectionScore, 1);
    assert.equal(asset?.selectionRank, 1);
    assert.equal(asset?.candidateCount, 1);
    assert.equal(asset?.width, 1200);
    assert.equal(asset?.height, 900);
    assert.equal(asset?.sourceName, "wikimedia-commons");
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
      delayFn: noDelay,
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
