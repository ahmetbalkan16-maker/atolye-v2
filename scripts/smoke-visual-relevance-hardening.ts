/**
 * Visual relevance hardening regression (documentary media).
 *
 * Root cause of "son videoda görseller alakasızdı" (project 302ce03f): the
 * real-photo relevance gate authorised a Wikimedia candidate from lexical overlap
 * between the (LLM-authored, sometimes generic / bare-namesake) search query and
 * the candidate's file TITLE alone. It had no requirement that the candidate
 * positively depict the scene's own subject and no era constraint, so a generic
 * "Ottoman soldiers" hit, a wrong-namesake, a modern reenactment / dated photo,
 * or a modern street/bridge/mosque cleared the 0.34 floor and shipped. Nothing
 * downstream (VisualAssetPipeline, assembly) re-checked relevance.
 * `isLowSpecificityKeywordSet` — the guard written for exactly this — was wired
 * only into a smoke, never production.
 *
 * These scenarios drive the provider and the pipeline directly with a stubbed
 * Wikimedia client (no network, no OpenAI, no cost) and assert the production
 * rule: a visual that does not meaningfully support its scene's subject / event
 * is never a final asset — the scene falls through to the AI fallback (a bespoke
 * frame from the scene's own visual prompt) or fails closed, but never ships an
 * off-topic archive image.
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
  VisualAssetGenerationError,
} from "../src/lib/assets/VisualAssetPipeline";
import {
  MIN_SCENE_MEDIA_OVERLAP,
  applyResearchMediaCandidatesToVisualData,
  matchResearchMediaToScenes,
} from "../src/lib/assets/ResearchMediaDiscovery";
import type {
  ConfiguredImageProvider,
  ImageGenerationInput,
} from "../src/lib/assets/providers/ImageProvider";
import type { ImageGenerationResult } from "../src/types/asset";
import type { ResearchMediaCandidate } from "../src/types/research";
import type { VisualData, VisualScene } from "../src/types/visual";

let count = 0;
const now = "2026-09-02T12:00:00.000Z";
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(256, 7)]);

async function scenario(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
  } catch (error) {
    console.error(`visual-relevance scenario FAILED: ${name}`);
    throw error;
  }
  count += 1;
  console.log(`  PASS ${count}: ${name}`);
}

function page(title: string, overrides: Partial<{ width: number; height: number; mime: string; license: string }> = {}) {
  const id = Math.floor(Math.random() * 1e9);
  return {
    pageid: id,
    title,
    imageinfo: [{
      url: `https://upload.wikimedia.org/wikipedia/commons/${id}.jpg`,
      descriptionurl: `https://commons.wikimedia.org/wiki/${title.replace(/[: ]/g, "_")}_${id}`,
      width: overrides.width ?? 2200,
      height: overrides.height ?? 1600,
      mime: overrides.mime ?? "image/png",
      extmetadata: {
        LicenseShortName: { value: overrides.license ?? "Public domain" },
        Artist: { value: "Historic Source" },
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

function fetcherFor(perQuery: (query: string) => ReturnType<typeof page>[]): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("commons.wikimedia.org")) {
      const q = new URL(url).searchParams.get("gsrsearch") ?? "";
      return searchResponse(perQuery(q));
    }
    if (url.includes("upload.wikimedia.org")) return new Response(new Uint8Array(png), { status: 200 });
    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;
}

const noDelay = async () => {};

function makeProvider(perQuery: (query: string) => ReturnType<typeof page>[]) {
  return new RealPhotoImageProvider({ delayFn: noDelay, fetcher: fetcherFor(perQuery) });
}

function generate(overrides: Partial<ImageGenerationInput>): ImageGenerationInput {
  return {
    prompt: "A cinematic historical frame",
    style: "cinematic",
    sceneId: 1,
    projectSlug: `visual-relevance-${count}`,
    searchKeywords: ["placeholder subject 1453"],
    ...overrides,
  };
}

function trackedProvider(
  name: "real" | "openai" | "mock",
  calls: number[],
  gen: (i: ImageGenerationInput) => ImageGenerationResult | Promise<ImageGenerationResult>,
): ConfiguredImageProvider {
  const provider: ConfiguredImageProvider = {
    name,
    async generateImage(i) {
      calls.push(i.sceneId);
      return gen(i);
    },
    createImmutableImageDispatchAdapter() {
      return createProviderDispatchAdapter(provider, {
        metadata: { name: provider.name }, requiredMethods: ["generateImage"],
      });
    },
  };
  return provider;
}

function fakeAi(calls: number[]): ConfiguredImageProvider {
  return trackedProvider("openai", calls, (i) => ({
    success: true, sceneId: i.sceneId, provider: "openai", model: "fake-openai",
    filePath: `data/projects/${i.projectSlug}/assets/images/scene-${i.sceneId}.png`,
    url: `https://img.test/${i.sceneId}.png`, mimeType: "image/png", createdAt: now,
  }));
}

function patchRouter(fake: ConfiguredImageProvider): () => void {
  const original = ImageProviderRouter.getProvider;
  ImageProviderRouter.getProvider = (n?: string) => (n === "openai" ? fake : original(n));
  return () => { ImageProviderRouter.getProvider = original; };
}

function scene(overrides: Partial<VisualScene> & { sceneId: number }): VisualScene {
  return {
    visualPrompt: "A cinematic historical frame",
    animationPrompt: "Slow push-in",
    style: "cinematic",
    ...overrides,
  };
}

function visual(scenes: VisualScene[]): VisualData {
  return {
    projectId: "visual-relevance-project",
    scenes,
    thumbnail: { title: "T", prompt: "P", composition: "C", mood: "M" },
    createdAt: now,
  };
}

function candidate(overrides: Partial<ResearchMediaCandidate> & { id: string; title: string }): ResearchMediaCandidate {
  return {
    mediaType: "photo",
    provider: "wikimedia-commons",
    sourceUrl: `https://commons.wikimedia.org/wiki/File:${overrides.id}.jpg`,
    license: "Public domain",
    rightsStatus: "public-domain",
    admissible: true,
    width: 2000,
    height: 1500,
    queryTerms: ["Ottoman Empire"],
    association: "topic",
    confidence: 0.5,
    discoveredAt: now,
    ...overrides,
  };
}

async function run() {
  // ── 1. exact person ACCEPT ─────────────────────────────────────────────────
  await scenario("exact-person portrait for a Fatih scene is accepted", async () => {
    const provider = makeProvider(() => [page("File:Portrait of Sultan Mehmed II by Gentile Bellini")]);
    const result = await provider.generateImage(generate({
      searchKeywords: ["Sultan Mehmed II portrait 1453"],
      prompt: "Young determined Mehmed II seated on the Ottoman throne in the palace",
    }));
    assert.equal(result.success, true, JSON.stringify(result));
    assert.equal(result.success && result.provider, "real");
  });

  // ── 2. generic soldiers REJECT ─────────────────────────────────────────────
  await scenario("a generic 'Ottoman soldiers' photo is rejected for a specific scene", async () => {
    const provider = makeProvider(() => [page("File:Ottoman soldiers marching")]);
    const result = await provider.generateImage(generate({
      searchKeywords: ["Mehmed II army review Edirne 1453", "Ottoman army"],
      prompt: "Mehmed reviews his great army massing at Edirne before the march on Constantinople",
    }));
    assert.equal(result.success, false, `generic soldiers must not ship, got ${JSON.stringify(result)}`);
  });

  // ── 3. wrong person REJECT ─────────────────────────────────────────────────
  await scenario("the wrong sultan (Suleiman) is rejected for a Fatih scene", async () => {
    const provider = makeProvider(() => [page("File:Portrait of Suleiman the Magnificent")]);
    const result = await provider.generateImage(generate({
      searchKeywords: ["Sultan Mehmed II portrait"],
      prompt: "Mehmed II studies a map of Constantinople with his commanders",
    }));
    assert.equal(result.success, false, `wrong-person portrait must not ship, got ${JSON.stringify(result)}`);
  });

  // ── 4. exact event ACCEPT ──────────────────────────────────────────────────
  await scenario("a 1453 conquest miniature is accepted for a conquest scene", async () => {
    const provider = makeProvider(() => [page("File:Ottoman miniature of the 1453 siege of Constantinople")]);
    const result = await provider.generateImage(generate({
      searchKeywords: ["Ottoman siege of Constantinople 1453"],
      prompt: "The Ottoman army storms the breached walls of Constantinople in 1453",
    }));
    assert.equal(result.success, true, JSON.stringify(result));
    assert.equal(result.success && result.provider, "real");
  });

  // ── 5. generic medieval battle REJECT ──────────────────────────────────────
  await scenario("a generic 'medieval battle' image is rejected", async () => {
    const provider = makeProvider(() => [page("File:Medieval battle between armies")]);
    const result = await provider.generateImage(generate({
      searchKeywords: ["Ottoman assault on the walls of Constantinople 1453", "medieval battle"],
      prompt: "The Ottoman army storms the breached walls of Constantinople in 1453",
    }));
    assert.equal(result.success, false, `generic battle must not ship, got ${JSON.stringify(result)}`);
  });

  // ── 6. no relevant candidate → no asset (never a generic fallback here) ─────
  await scenario("a pool of only off-topic hits yields success:false, not a generic pick", async () => {
    const provider = makeProvider(() => [
      page("File:Fatih Sultan Mehmet Bridge at sunset"),
      page("File:New Mosque Istanbul from the Bosphorus"),
      page("File:Ottoman Empire population chart"),
      page("File:Edirne Saraclar Caddesi 2"),
    ]);
    const result = await provider.generateImage(generate({
      searchKeywords: ["Ottoman navy sails the Bosphorus 1453"],
      prompt: "The Ottoman fleet sails up the Bosphorus toward the besieged city",
    }));
    assert.equal(result.success, false, JSON.stringify(result));
    assert.ok(!result.success && typeof result.error === "string" && result.error.length > 0);
  });

  // ── 7. era enforcement: modern-dated photo REJECT / self-adjusting ─────────
  await scenario("a modern-dated (2019) photo is rejected for a pre-modern scene", async () => {
    const provider = makeProvider(() => [page("File:Walls of Constantinople 2019 photograph")]);
    const result = await provider.generateImage(generate({
      searchKeywords: ["Theodosian walls of Constantinople 1453"],
      prompt: "Cannonballs strike the ancient Theodosian walls of Constantinople",
    }));
    assert.equal(result.success, false, JSON.stringify(result));
  });
  await scenario("the era gate is self-adjusting: a query that asks for a modern year allows it", async () => {
    const provider = makeProvider(() => [page("File:Gallipoli landing 1915 photograph")]);
    const result = await provider.generateImage(generate({
      searchKeywords: ["Gallipoli landing 1915"],
      prompt: "Troops wade ashore under fire at Gallipoli in 1915",
    }));
    assert.equal(result.success, true, JSON.stringify(result));
  });

  // ── 8. modern restaging REJECT ────────────────────────────────────────────
  await scenario("a battle reenactment is rejected", async () => {
    const provider = makeProvider(() => [page("File:Siege of Constantinople reenactment")]);
    const result = await provider.generateImage(generate({
      searchKeywords: ["Ottoman siege of Constantinople 1453"],
      prompt: "The Ottoman army storms the walls of Constantinople in 1453",
    }));
    assert.equal(result.success, false, JSON.stringify(result));
  });

  // ── 9. low-specificity keyword set (the 302ce03f trigger) ──────────────────
  await scenario("a bare-namesake keyword set cannot ship a namesake photo on title match alone", async () => {
    const provider = makeProvider(() => [page("File:Edirne main street")]);
    const result = await provider.generateImage(generate({
      searchKeywords: ["Edirne", "Bosphorus", "Urban"],
      prompt: "Ottoman engineers oversee the casting of a great bombard cannon",
    }));
    assert.equal(result.success, false, JSON.stringify(result));
  });
  await scenario("a bare-namesake keyword set still accepts a genuine period-art hit", async () => {
    const provider = makeProvider(() => [page("File:Edirne Ottoman palace miniature painting")]);
    const result = await provider.generateImage(generate({
      searchKeywords: ["Edirne"],
      prompt: "The Ottoman court gathers in the palace at Edirne",
    }));
    assert.equal(result.success, true, JSON.stringify(result));
  });

  // ── 10. production-path enforcement: pipeline runs the gate ────────────────
  await scenario("VisualAssetPipeline falls back to AI when the gate rejects every real hit", async () => {
    const realProvider = makeProvider(() => [page("File:Fatih Sultan Mehmet Bridge")]);
    const aiCalls: number[] = [];
    const restore = patchRouter(fakeAi(aiCalls));
    try {
      const assets = await VisualAssetPipeline.generateAssets({
        projectId: "vr-enforce",
        projectSlug: "visual-relevance-enforce",
        visualData: visual([scene({
          sceneId: 1,
          visualPrompt: "Ottoman cannon foundry casting the great bombard, 1453",
          searchKeywords: ["Fatih Sultan Mehmet"],
        })]),
        provider: realProvider,
      });
      const asset = assets.assets.find((a) => a.sceneId === 1);
      assert.equal(asset?.provider, "openai", "a rejected real hit must not become the scene asset");
      assert.equal(asset?.selectionReason, "no-suitable-real-media-found");
      assert.deepEqual(aiCalls, [1], "exactly one AI fallback dispatch");
    } finally {
      restore();
    }
  });

  // ── 11. fallback safety: force-real scene fails rather than shipping junk ──
  await scenario("a force-real scene fails closed when only off-topic hits exist (no junk asset)", async () => {
    const realProvider = makeProvider(() => [page("File:Ottoman Empire population chart")]);
    await assert.rejects(
      VisualAssetPipeline.generateAssets({
        projectId: "vr-forcereal",
        projectSlug: "visual-relevance-forcereal",
        visualData: visual([scene({
          sceneId: 1,
          visualPrompt: "The besieging Ottoman army before the walls of Constantinople",
          searchKeywords: ["Ottoman army Constantinople 1453"],
        })]),
        provider: realProvider,
        overrides: { 1: "real" },
      }),
      (error) => error instanceof VisualAssetGenerationError,
    );
  });

  // ── 12. scene isolation: a candidate cannot be reused across scenes ───────
  await scenario("scene isolation: the one good hit binds to scene 1, scene 2 falls through", async () => {
    const pool = [
      page("File:Ottoman miniature of the siege of Constantinople 1453"),
      page("File:Fatih Sultan Mehmet Bridge at night"),
    ];
    const realProvider = makeProvider(() => pool);
    const aiCalls: number[] = [];
    const restore = patchRouter(fakeAi(aiCalls));
    try {
      const assets = await VisualAssetPipeline.generateAssets({
        projectId: "vr-isolation",
        projectSlug: "visual-relevance-isolation",
        visualData: visual([
          scene({ sceneId: 1, visualPrompt: "The Ottoman assault on the walls of Constantinople in 1453", searchKeywords: ["Ottoman siege of Constantinople 1453"] }),
          scene({ sceneId: 2, visualPrompt: "The Ottoman assault on the walls of Constantinople in 1453", searchKeywords: ["Ottoman siege of Constantinople 1453"] }),
        ]),
        provider: realProvider,
      });
      const s1 = assets.assets.find((a) => a.sceneId === 1);
      const s2 = assets.assets.find((a) => a.sceneId === 2);
      assert.equal(s1?.provider, "real", "scene 1 keeps the real hit");
      assert.equal(s2?.provider, "openai", "scene 2 must not re-bind scene 1's candidate or drop to the bridge");
      assert.deepEqual(aiCalls, [2]);
    } finally {
      restore();
    }
  });

  // ── 13. asset identity: a wrong-sceneId provider result is never bound ────
  await scenario("asset identity: a real result echoing the wrong sceneId is rejected", async () => {
    const misbindingProvider = trackedProvider("real", [], (i) => ({
      success: true,
      sceneId: i.sceneId === 1 ? 2 : i.sceneId, // lie: claim scene 2 for a scene-1 request
      provider: "real",
      model: "wikimedia-commons",
      filePath: `data/projects/${i.projectSlug}/assets/images/scene-${i.sceneId}.png`,
      url: `/api/assets/images/${i.projectSlug}/scene-${i.sceneId}.png`,
      mimeType: "image/jpeg",
      sourceName: "wikimedia-commons",
      sourceUrl: "https://commons.wikimedia.org/wiki/File:X.jpg",
      license: "Public domain",
      selectionScore: 1, selectionRank: 1, candidateCount: 1,
      width: 1920, height: 1080, createdAt: now,
    }));
    await assert.rejects(
      VisualAssetPipeline.generateAssets({
        projectId: "vr-identity",
        projectSlug: "visual-relevance-identity",
        visualData: visual([scene({ sceneId: 1, visualPrompt: "p", searchKeywords: ["Constantinople 1453"] })]),
        provider: misbindingProvider,
      }),
      (error) => error instanceof VisualAssetGenerationError,
    );
  });

  // ── 14. research → scene binding threshold ───────────────────────────────
  await scenario(`matchResearchMediaToScenes needs >= ${MIN_SCENE_MEDIA_OVERLAP} shared terms to bind`, () => {
    const scenes: VisualScene[] = [scene({
      sceneId: 1,
      visualPrompt: "The Ottoman fleet sails the Bosphorus",
      searchKeywords: ["Ottoman fleet Bosphorus 1453"],
    })];
    const oneTokenOverlap = candidate({
      id: "one", title: "Ottoman market scene", queryTerms: ["Ottoman bazaar"],
    });
    const twoTokenOverlap = candidate({
      id: "two", title: "Ottoman fleet in the Bosphorus engraving", queryTerms: ["Ottoman fleet"],
    });
    assert.equal(matchResearchMediaToScenes([oneTokenOverlap], scenes).size, 0,
      "a single shared token must not bind");
    assert.equal(matchResearchMediaToScenes([twoTokenOverlap], scenes).get(1)?.id, "two",
      "two shared terms bind");
  });

  await scenario("applyResearchMediaCandidatesToVisualData never injects a bare-token discovery term", () => {
    const data = visual([scene({
      sceneId: 1,
      visualPrompt: "Ottoman cannon foundry casting the great bombard",
      searchKeywords: ["Ottoman bombard cannon foundry 1453"],
    })]);
    const research = {
      topic: "Fall of Constantinople",
      mediaCandidates: [candidate({
        id: "bare", title: "Ottoman bombard cannon foundry illustration",
        queryTerms: ["Urban"], // bare surname — the namesake trap
      })],
    } as never;
    const applied = applyResearchMediaCandidatesToVisualData(data, research);
    assert.ok(
      !(applied.scenes[0].searchKeywords ?? []).some((k) => k.toLowerCase() === "urban"),
      `bare 'Urban' must not be prepended, got ${JSON.stringify(applied.scenes[0].searchKeywords)}`,
    );
  });

  await scenario("applyResearchMediaCandidatesToVisualData does prepend a specific multi-word term", () => {
    const data = visual([scene({
      sceneId: 1,
      visualPrompt: "Ottoman cannon foundry casting the great bombard",
      searchKeywords: ["Ottoman bombard cannon foundry 1453"],
    })]);
    const research = {
      topic: "Fall of Constantinople",
      mediaCandidates: [candidate({
        id: "phrase", title: "Ottoman bombard cannon foundry illustration",
        queryTerms: ["Ottoman siege cannon"],
      })],
    } as never;
    const applied = applyResearchMediaCandidatesToVisualData(data, research);
    assert.equal(applied.scenes[0].searchKeywords?.[0], "Ottoman siege cannon");
  });

  emitSmokeResult("visual-relevance-hardening", count);
  console.log(`Visual relevance hardening smoke: PASS (${count} scenarios)`);
}

async function main() {
  await withCanonicalSmokeRuntime({ name: "visual-relevance-hardening", now }, async () => {
    await run();
  });
}

void main();
