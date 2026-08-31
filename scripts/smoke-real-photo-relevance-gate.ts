/**
 * Sprint 173 regression: the real-photo provider must reject a semantically
 * wrong Wikimedia hit instead of shipping it as a scene image.
 *
 * Root cause of the 302ce03f "tamamen alakasız fotoğraflar" incident:
 * RealPhotoImageProvider ranked candidates only by file-title keyword overlap
 * with no minimum, so a bare keyword ("Edirne", "Boğaz", "Urban",
 * "Fatih Sultan Mehmet") matched a modern street / war memorial / papal statue
 * / the suspension bridge on a perfect title score, was accepted, and the AI
 * fallback (which only fires on `success:false` or a bad licence) never ran.
 *
 * These scenarios drive the provider directly with a stubbed Wikimedia client
 * (no network, no OpenAI, no cost) and assert:
 *   - a modern street / bridge / statue / shipyard / demographic chart / wrong
 *     namesake is NOT selected — the query yields `success:false`;
 *   - `buildSearchQueries` tries the specific phrase before the bare place name;
 *   - cross-scene dedup that removes every good candidate ends in
 *     `success:false`, never a drop to modern junk;
 *   - VisualAssetPipeline falls back to AI exactly once when the real search
 *     comes back empty (mock AI provider, zero real calls);
 *   - a period-art candidate outranks an equally title-matching modern one;
 *   - isLowSpecificityKeywordSet flags a bare-keyword plan.
 */
import assert from "node:assert/strict";
import { withCanonicalSmokeRuntime } from "./lib/CanonicalSmokeRuntime";
import { emitSmokeResult } from "./lib/SmokeResult";
import { RealPhotoImageProvider } from "../src/lib/assets/providers/RealPhotoImageProvider";
import { ImageProviderRouter } from "../src/lib/assets/providers/ImageProviderRouter";
import { createProviderDispatchAdapter } from
  "../src/lib/providers/ProviderDispatchAdapterAuthority";
import {
  VisualAssetPipeline,
} from "../src/lib/assets/VisualAssetPipeline";
import { isLowSpecificityKeywordSet } from "../src/lib/ai/VisualStructuredOutput";
import type {
  ConfiguredImageProvider,
  ImageGenerationInput,
} from "../src/lib/assets/providers/ImageProvider";
import type { ImageGenerationResult } from "../src/types/asset";
import type { VisualData } from "../src/types/visual";

let count = 0;
const now = "2026-08-30T12:00:00.000Z";
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(256, 7)]);

async function scenario(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
  } catch (error) {
    console.error(`relevance-gate scenario FAILED: ${name}`);
    throw error;
  }
  count += 1;
}

function page(overrides: Partial<{
  title: string; descriptionurl: string; width: number; height: number;
  mime: string; license: string; artist: string;
}> = {}) {
  const id = Math.floor(Math.random() * 1e9);
  return {
    pageid: id,
    title: overrides.title ?? "File:Generic.jpg",
    imageinfo: [{
      url: `https://upload.wikimedia.org/wikipedia/commons/${id}.jpg`,
      descriptionurl: overrides.descriptionurl ??
        `https://commons.wikimedia.org/wiki/File:Generic_${id}.jpg`,
      width: overrides.width ?? 1920,
      height: overrides.height ?? 1080,
      mime: overrides.mime ?? "image/png",
      extmetadata: {
        LicenseShortName: { value: overrides.license ?? "Public domain" },
        Artist: { value: overrides.artist ?? "Historic Source" },
        Credit: { value: "Wikimedia Commons" },
      },
    }],
  };
}

function searchResponse(pages: ReturnType<typeof page>[]) {
  return new Response(
    JSON.stringify({ query: { pages: Object.fromEntries(pages.map((p) => [String(p.pageid), p])) } }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

/** Records every gsrsearch query string, in dispatch order. */
function fetcherFor(
  perQuery: (query: string) => ReturnType<typeof page>[],
  queryLog: string[] = [],
): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("commons.wikimedia.org")) {
      const q = new URL(url).searchParams.get("gsrsearch") ?? "";
      queryLog.push(q);
      return searchResponse(perQuery(q));
    }
    if (url.includes("upload.wikimedia.org")) {
      return new Response(new Uint8Array(png), { status: 200 });
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;
}

const noDelay = async () => {};

function makeProvider(
  perQuery: (query: string) => ReturnType<typeof page>[],
  queryLog: string[] = [],
) {
  return new RealPhotoImageProvider({ delayFn: noDelay, fetcher: fetcherFor(perQuery, queryLog) });
}

function input(overrides: Partial<ImageGenerationInput>): ImageGenerationInput {
  return {
    prompt: "A cinematic historical frame",
    style: "cinematic",
    sceneId: 1,
    projectSlug: "relevance-gate-input",
    searchKeywords: ["placeholder"],
    ...overrides,
  };
}

async function run() {
  // 1-6, 12: a single semantically-wrong hit per query is never accepted.
  const wrongHits: Array<{ label: string; keywords: string[]; prompt: string; title: string }> = [
    {
      label: "modern street ('… Saraçlar Caddesi') for a historical Edirne scene",
      keywords: ["Edirne"], prompt: "Ottoman soldiers gather before the Edirne palace, 1453",
      title: "File:Edirne, Merkez, Saraçlar Caddesi 2.JPG",
    },
    {
      label: "modern suspension bridge ('Fatih Sultan Mehmet Bridge') for a Mehmed II scene",
      keywords: ["Fatih Sultan Mehmet"], prompt: "Mehmed II with scholars and manuscripts in the palace",
      title: "File:Fatih Sultan Mehmet Bridge-Boğaziçi.jpg",
    },
    {
      label: "statue of a same-name pope ('Wooden statue of Pope Urban I') for a cannon-founder scene",
      keywords: ["Urban"], prompt: "Ottoman foundry casting the great bombard cannon, smoke and sparks",
      title: "File:Wooden statue of Pope Urban I in Nova.jpg",
    },
    {
      label: "modern shipyard ('Haliç Tersanesi 2015') for a 1453 Golden Horn scene",
      keywords: ["Haliç"], prompt: "Ottoman ships hauled overland at the Golden Horn at night",
      title: "File:Haliç Tersanesi 2015.jpg",
    },
    {
      label: "demographic chart ('İstanbul Çingeneleri ve Oranları') for a besieging-army scene",
      keywords: ["İstanbul"], prompt: "The Ottoman army positioned with cannon before the walls of Constantinople",
      title: "File:İstanbul Çingeneleri ve Oranları.png",
    },
    {
      label: "wrong-namesake religious painting ('Blessed Giovanni Giustiniani and Saints')",
      keywords: ["Giovanni Giustiniani"], prompt: "Constantine XI and the Genoese commander Giustiniani on the Byzantine walls",
      title: "File:Blessed Giovanni Giustiniani and Saints by Il Pordenone - Accademia.jpg",
    },
    {
      label: "modern mosque tourist photo ('New Mosque, Istanbul, from Bosphorus')",
      keywords: ["İstanbul"], prompt: "Ottoman soldiers advance through the streets of the captured city",
      title: "File:New Mosque, Istanbul, from Bosphorus.jpg",
    },
    {
      label: "war memorial ('Boğaz Şehitliği Komando Anıtı')",
      keywords: ["Boğaz"], prompt: "A great Ottoman mosque under construction with the Bosphorus behind",
      title: "File:Boğaz Şehitliği Komando Anıtı.jpg",
    },
    {
      label: "another modern Edirne back street ('Edirne Merkez, Terziler Sokak')",
      keywords: ["Edirne"], prompt: "Heavy siege cannons hauled on carts toward the fortress walls",
      title: "File:Edirne Merkez, Terziler Sokak.JPG",
    },
    {
      label: "modern Edirne avenue reused for a battle scene ('… Saraçlar Caddesi')",
      keywords: ["Edirne"], prompt: "Cannonballs strike the Byzantine walls as Ottoman troops assault",
      title: "File:Edirne, Merkez, Saraçlar Caddesi.JPG",
    },
    {
      label: "modern cemetery gate ('Boğaz Şehitliği Girişi')",
      keywords: ["Boğaz"], prompt: "The Ottoman navy sails the Bosphorus with a coastal fortress on the shore",
      title: "File:Boğaz Şehitliği Girişi.jpg",
    },
  ];

  for (const hit of wrongHits) {
    await scenario(`rejects ${hit.label}`, async () => {
      const provider = makeProvider(() => [page({
        title: hit.title, width: 4000, height: 3000,
        descriptionurl: `https://commons.wikimedia.org/wiki/${hit.title.replace(/[: ]/g, "_")}`,
      })]);
      const result = await provider.generateImage(input({
        projectSlug: `relevance-gate-${count}`, searchKeywords: hit.keywords, prompt: hit.prompt,
      }));
      assert.equal(result.success, false, `expected rejection, got ${JSON.stringify(result)}`);
    });
  }

  // A genuinely relevant, period-appropriate candidate is still accepted.
  await scenario("still accepts a topical period-art candidate", async () => {
    const provider = makeProvider(() => [page({
      title: "File:Bellini, Gentile - Sultan Mehmet II portrait.jpg", width: 2000, height: 2600,
      descriptionurl: "https://commons.wikimedia.org/wiki/File:Bellini_Sultan_Mehmet_II.jpg",
    })]);
    const result = await provider.generateImage(input({
      projectSlug: "relevance-gate-accept",
      searchKeywords: ["Mehmed II sultan portrait"],
      prompt: "Young determined Mehmed II on the Ottoman throne in the palace",
    }));
    assert.equal(result.success, true, JSON.stringify(result));
    if (result.success && result.provider === "real") {
      assert.equal(result.model, "wikimedia-commons");
    } else {
      assert.fail("expected a real-photo success");
    }
  });

  // 7 — query ordering: the specific multi-word phrase is tried before the bare place name.
  await scenario("buildSearchQueries tries the specific phrase before the bare place name", async () => {
    const queryLog: string[] = [];
    const provider = makeProvider((q) => {
      // Only the specific query returns a usable, on-topic candidate.
      if (/foundry/i.test(q)) {
        return [page({
          title: "File:Ottoman cannon foundry bombard 1453 engraving.jpg",
          width: 3000, height: 2000,
          descriptionurl: "https://commons.wikimedia.org/wiki/File:Ottoman_cannon_foundry_1453.jpg",
        })];
      }
      return [page({ title: "File:Edirne, Merkez, Saraçlar Caddesi 2.JPG", width: 4000, height: 3000 })];
    }, queryLog);
    const result = await provider.generateImage(input({
      projectSlug: "relevance-gate-order",
      searchKeywords: ["Edirne", "Ottoman cannon foundry Edirne 1453"],
      prompt: "Ottoman foundry casting the great bombard cannon",
    }));
    assert.equal(result.success, true, JSON.stringify(result));
    assert.ok(queryLog.length >= 1);
    assert.match(queryLog[0], /Ottoman cannon foundry Edirne 1453/,
      `first query should be the specific phrase, got ${JSON.stringify(queryLog)}`);
    assert.ok(
      !queryLog.slice(0, 1).some((q) => q === "Edirne"),
      "the bare place name must not be the first query",
    );
  });

  // 8 — dedup safety: when the one good candidate is already used, the scene fails
  // over to AI rather than dropping to the co-listed modern junk.
  await scenario("dedup that removes the only good candidate ends in success:false, not modern junk", async () => {
    const good = page({
      title: "File:Mehmed the Conqueror portrait painting.jpg", width: 2200, height: 2800,
      descriptionurl: "https://commons.wikimedia.org/wiki/File:Mehmed_Conqueror_portrait.jpg",
    });
    const junk = page({
      title: "File:Fatih Sultan Mehmet Bridge at sunset.jpg", width: 6000, height: 4000,
      descriptionurl: "https://commons.wikimedia.org/wiki/File:FSM_Bridge_sunset.jpg",
    });
    const provider = makeProvider(() => [good, junk]);
    const first = await provider.generateImage(input({
      sceneId: 1, projectSlug: "relevance-gate-dedup",
      searchKeywords: ["Mehmed the Conqueror portrait"],
      prompt: "Mehmed II commands the final assault through the breached walls",
    }));
    assert.equal(first.success, true, JSON.stringify(first));
    const second = await provider.generateImage(input({
      sceneId: 2, projectSlug: "relevance-gate-dedup",
      searchKeywords: ["Mehmed the Conqueror portrait"],
      prompt: "Mehmed II on the walls at sunrise, hand raised",
    }));
    assert.equal(second.success, false,
      `dedup must not fall through to the bridge photo, got ${JSON.stringify(second)}`);
  });

  // 9 — pipeline falls back to AI exactly once on an empty real search (mock AI, no real call).
  await scenario("VisualAssetPipeline falls back to AI exactly once when the gate yields nothing", async () => {
    const visualData: VisualData = {
      projectId: "relevance-gate-fallback",
      scenes: [{
        sceneId: 1,
        visualPrompt: "Ottoman cannon foundry casting the great bombard, 1453",
        animationPrompt: "Slow push in",
        style: "cinematic",
        searchKeywords: ["Urban"],
      }],
      thumbnail: { title: "T", prompt: "P", composition: "C", mood: "M" },
      createdAt: now,
    };
    // Real provider only ever finds the papal-statue junk → gate rejects → success:false.
    const realProvider = makeProvider(() => [page({
      title: "File:Wooden statue of Pope Urban I.jpg", width: 3000, height: 4000,
    })]);
    const aiCalls: number[] = [];
    const fakeAi = trackedProvider("openai", aiCalls, (i) => ({
      success: true, sceneId: i.sceneId, provider: "openai", model: "fake-openai",
      filePath: `data/projects/${i.projectSlug}/assets/images/scene-${i.sceneId}.png`,
      url: `https://img.test/${i.sceneId}.png`, mimeType: "image/png", createdAt: now,
    }));
    const restore = patchRouter(fakeAi);
    try {
      const assets = await VisualAssetPipeline.generateAssets({
        projectId: visualData.projectId,
        projectSlug: "relevance-gate-fallback",
        visualData,
        provider: realProvider,
      });
      const asset = assets.assets.find((a) => a.sceneId === 1);
      assert.equal(asset?.provider, "openai");
      assert.deepEqual(aiCalls, [1], "exactly one AI fallback dispatch expected");
    } finally {
      restore();
    }
  });

  // 10 — historical-art bias: an equally title-matching period engraving beats a modern photo.
  await scenario("a period-art candidate outranks an equally title-matching modern one", async () => {
    const modern = page({
      title: "File:Siege of Constantinople reenactment photo.jpg", width: 4000, height: 3000,
      descriptionurl: "https://commons.wikimedia.org/wiki/File:Siege_reenactment_photo.jpg",
    });
    const periodArt = page({
      title: "File:Siege of Constantinople 1453 engraving.jpg", width: 2000, height: 1500,
      descriptionurl: "https://commons.wikimedia.org/wiki/File:Siege_of_Constantinople_1453_engraving.jpg",
    });
    const provider = makeProvider(() => [modern, periodArt]);
    const result = await provider.generateImage(input({
      projectSlug: "relevance-gate-historical",
      searchKeywords: ["Siege Constantinople"],
      prompt: "Cannonballs strike the Byzantine walls as the Ottoman assault presses in",
    }));
    assert.equal(result.success, true, JSON.stringify(result));
    if (result.success && result.provider === "real") {
      assert.match(result.sourceUrl, /1453_engraving/,
        `period engraving should win over the modern reenactment photo, got ${result.sourceUrl}`);
    } else {
      assert.fail("expected a real-photo success");
    }
  });

  // 11 — bare-keyword detection.
  await scenario("isLowSpecificityKeywordSet flags bare keywords, passes specific phrases", () => {
    assert.equal(isLowSpecificityKeywordSet(["Edirne"]), true);
    assert.equal(isLowSpecificityKeywordSet(["Edirne", "İstanbul", "Boğaz", "Urban"]), true);
    assert.equal(isLowSpecificityKeywordSet(["Ottoman cannon foundry Edirne 1453"]), false);
    assert.equal(
      isLowSpecificityKeywordSet(["Edirne", "Ottoman siege cannon 1453"]),
      false,
      "one usable phrase is enough",
    );
    assert.equal(isLowSpecificityKeywordSet([]), false);
    assert.equal(isLowSpecificityKeywordSet(undefined), false);
  });

  // 12 — end-to-end: a realistic mixed pool. The historical hit is chosen; pure junk → fallback.
  await scenario("end-to-end mixed pool: picks the period art, rejects the modern noise", async () => {
    const pool = [
      page({ title: "File:Edirne, Merkez, Saraçlar Caddesi.JPG", width: 4032, height: 3024 }),
      page({ title: "File:Fatih Sultan Mehmet Bridge.jpg", width: 6000, height: 4000 }),
      page({ title: "File:Wooden statue of Pope Urban I.jpg", width: 3000, height: 4000 }),
      page({ title: "File:İstanbul Çingeneleri ve Oranları.png", width: 2000, height: 1400 }),
      page({
        title: "File:Ottoman miniature siege of Constantinople 1453.jpg",
        width: 2400, height: 1800,
        descriptionurl: "https://commons.wikimedia.org/wiki/File:Ottoman_miniature_siege_1453.jpg",
      }),
    ];
    const provider = makeProvider(() => pool);
    const good = await provider.generateImage(input({
      projectSlug: "relevance-gate-e2e-good",
      searchKeywords: ["Ottoman siege of Constantinople 1453"],
      prompt: "The Ottoman army storms the walls of Constantinople in 1453",
    }));
    assert.equal(good.success, true, JSON.stringify(good));
    if (good.success && good.provider === "real") {
      assert.match(good.sourceUrl, /Ottoman_miniature_siege_1453/);
    } else {
      assert.fail("expected the period miniature to be selected");
    }

    const junkOnly = makeProvider(() => pool.slice(0, 4));
    const nothing = await junkOnly.generateImage(input({
      projectSlug: "relevance-gate-e2e-junk",
      searchKeywords: ["Ottoman siege of Constantinople 1453"],
      prompt: "The Ottoman army storms the walls of Constantinople in 1453",
    }));
    assert.equal(nothing.success, false,
      `a pool of only modern/wrong-context hits must yield success:false, got ${JSON.stringify(nothing)}`);
  });

  emitSmokeResult("real-photo-relevance-gate", count);
  console.log(`Real-photo relevance gate smoke: PASS (${count} scenarios)`);
}

function trackedProvider(
  name: "real" | "openai" | "mock",
  calls: number[],
  generate: (i: ImageGenerationInput) => ImageGenerationResult | Promise<ImageGenerationResult>,
): ConfiguredImageProvider {
  const provider: ConfiguredImageProvider = {
    name,
    async generateImage(i) {
      calls.push(i.sceneId);
      return generate(i);
    },
    createImmutableImageDispatchAdapter() {
      return createProviderDispatchAdapter(provider, {
        metadata: { name: provider.name }, requiredMethods: ["generateImage"],
      });
    },
  };
  return provider;
}

function patchRouter(fake: ConfiguredImageProvider): () => void {
  const original = ImageProviderRouter.getProvider;
  ImageProviderRouter.getProvider = (n?: string) => (n === "openai" ? fake : original(n));
  return () => { ImageProviderRouter.getProvider = original; };
}

async function main() {
  await withCanonicalSmokeRuntime({ name: "real-photo-relevance-gate", now }, async () => {
    await run();
  });
}

void main();
