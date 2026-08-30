/**
 * Documentary media effort — Faz 2: research-stage real media discovery.
 *
 * No network, no real API. A fixture MediaSearchClient stands in for Wikimedia
 * Commons. Verifies:
 *  1. research -> structured mediaCandidates
 *  2. a Wikimedia candidate is parsed correctly (title/url/license/size)
 *  3. sourceUrl / provenance preserved end to end
 *  4. public-domain candidate is admissible
 *  5. open-license candidate is admissible
 *  6. unknown / restricted candidate is NOT admissible (retained, not selected)
 *  7. an LLM-fabricated `sources[]` URL never becomes a production candidate
 *  8. duplicate candidates are deterministically deduped (by source url)
 *  9. scene <-> candidate matching is deterministic + no cross-scene reuse
 * 10. every scene gets a real candidate -> VisualAssetPipeline makes 0 AI calls
 * 11. no candidates -> Faz 1 AI fallback still works
 * 12. 16 scenes, AI cap = 4 still enforced
 * 13. mediaType "video" candidate metadata is retained (Faz 2 does not render it)
 */
import assert from "node:assert/strict";
import path from "node:path";
import { promises as fs } from "node:fs";
import { withCanonicalSmokeRuntime } from "./lib/CanonicalSmokeRuntime";
import {
  deriveDiscoveryQueries,
  discoverResearchMediaCandidates,
  enrichResearchWithMediaDiscovery,
  matchResearchMediaToScenes,
  applyResearchMediaCandidatesToVisualData,
  type MediaSearchClient,
} from "../src/lib/assets/ResearchMediaDiscovery";
import {
  VisualAssetPipeline,
  VisualMediaAiBudgetExceededError,
} from "../src/lib/assets/VisualAssetPipeline";
import { ImageProviderRouter } from "../src/lib/assets/providers/ImageProviderRouter";
import { ImageStorage } from "../src/lib/assets/storage/ImageStorage";
import { createProviderDispatchAdapter } from "../src/lib/providers/ProviderDispatchAdapterAuthority";
import type { ResearchData } from "../src/types/research";
import type { VisualData, VisualScene } from "../src/types/visual";
import type { WikimediaCommonsCandidate } from "../src/lib/assets/providers/sources/WikimediaCommonsClient";
import type {
  ConfiguredImageProvider,
  ImageGenerationInput,
} from "../src/lib/assets/providers/ImageProvider";
import type { ImageGenerationResult, ProjectAssets } from "../src/types/asset";

const now = "2026-08-29T00:00:00.000Z";
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
let projectsRoot = "";
let prefix = "";
let count = 0;

function scenario(name: string, fn: () => Promise<void> | void) {
  return Promise.resolve(fn()).then(() => {
    count += 1;
    if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
  });
}

function research(overrides: Partial<ResearchData> = {}): ResearchData {
  return {
    topic: "İstanbul'un Fethi",
    summary: "s", historicalContext: "h", timeline: [], characters: ["Fatih Sultan Mehmet"],
    locations: ["Walls of Constantinople", "Hagia Sophia"], keyEvents: ["Siege of 1453"],
    strategies: [], controversies: [], interestingFacts: [], documentaryFlow: [], sceneIdeas: [],
    imagePrompts: ["p"], animationPrompts: [], musicIdeas: [], soundEffects: [], thumbnailIdeas: [],
    youtubeTitles: [], sources: ["https://en.wikipedia.org/wiki/Fall_of_Constantinople"],
    createdAt: now, ...overrides,
  };
}

function wm(overrides: Partial<WikimediaCommonsCandidate> = {}): WikimediaCommonsCandidate {
  return {
    sourceName: "wikimedia-commons",
    title: overrides.title ?? "File:Walls of Constantinople.jpg",
    pageUrl: overrides.pageUrl ?? "https://commons.wikimedia.org/wiki/File:Walls_of_Constantinople.jpg",
    imageUrl: overrides.imageUrl ?? "https://upload.wikimedia.org/wikipedia/commons/a/walls.jpg",
    mimeType: overrides.mimeType ?? "image/jpeg",
    width: overrides.width ?? 1600,
    height: overrides.height ?? 1200,
    license: overrides.license ?? "CC BY-SA 4.0",
    attribution: overrides.attribution ?? "Photographer / Wikimedia Commons",
  };
}

/** Fixture source client: maps query -> canned candidate list. */
function fixtureClient(byQuery: Record<string, WikimediaCommonsCandidate[]>, calls?: string[]): MediaSearchClient {
  return {
    async search(query: string) {
      calls?.push(query);
      return byQuery[query] ?? byQuery["*"] ?? [];
    },
  };
}

/**
 * Fixture client that returns `perQuery` distinct admissible candidates for
 * every query, each titled/urled from the query so keyword matching resolves.
 */
function generativeClient(perQuery: number, license = "CC0"): MediaSearchClient {
  return {
    async search(query: string, limit: number) {
      const n = Math.min(perQuery, limit);
      return Array.from({ length: n }, (_, i) =>
        wm({
          title: `File:${query} view ${i + 1}.jpg`,
          pageUrl: `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(query)}_${i + 1}.jpg`,
          imageUrl: `https://upload.wikimedia.org/wikipedia/commons/${i}/${encodeURIComponent(query)}.jpg`,
          license,
        }));
    },
  };
}

function visualScene(sceneId: number, keywords: string[], prompt = "sahne"): VisualScene {
  return { sceneId, visualPrompt: `${prompt} ${sceneId}`, animationPrompt: "push in", style: "cinematic", searchKeywords: keywords };
}

function visualData(scenes: VisualScene[]): VisualData {
  return { projectId: "faz2", scenes, thumbnail: { title: "t", prompt: "p", composition: "c", mood: "m" }, createdAt: now };
}

function aiImage(input: ImageGenerationInput): ImageGenerationResult {
  const saved = ImageStorage.saveImage({ projectSlug: input.projectSlug as string, data: PNG, mimeType: "image/png" });
  return { success: true, sceneId: input.sceneId, provider: "openai", model: "stub", filePath: saved.filePath, url: saved.url, mimeType: "image/png", createdAt: now };
}

function realPhoto(input: ImageGenerationInput): ImageGenerationResult {
  const saved = ImageStorage.saveImage({ projectSlug: input.projectSlug as string, data: PNG, mimeType: "image/png" });
  return {
    success: true, sceneId: input.sceneId, provider: "real", model: "wikimedia-commons",
    filePath: saved.filePath, url: saved.url, mimeType: "image/png",
    sourceName: "wikimedia-commons", sourceUrl: "https://commons.wikimedia.org/wiki/File:X.jpg",
    license: "CC BY-SA 4.0", attribution: "A / Wikimedia", selectionScore: 0.9, selectionRank: 1,
    candidateCount: 2, width: 1600, height: 1200, createdAt: now,
  };
}

/** real batch provider: returns a real photo only when a scene keyword includes a marker. */
function keywordAwareRealProvider(markers: string[], realCalls: number[], aiCalls: number[]): ConfiguredImageProvider {
  const lowered = markers.map((m) => m.toLowerCase());
  const provider: ConfiguredImageProvider = {
    name: "real",
    async generateImage(input) {
      const kws = (input.searchKeywords ?? []).map((k) => k.toLowerCase());
      if (kws.some((k) => lowered.some((m) => k.includes(m)))) { realCalls.push(input.sceneId); return realPhoto(input); }
      return { success: false, sceneId: input.sceneId, provider: "real", createdAt: now, error: "not found" };
    },
    createImmutableImageDispatchAdapter() {
      return createProviderDispatchAdapter(provider, { metadata: { name: provider.name }, requiredMethods: ["generateImage"] });
    },
  };
  const original = ImageProviderRouter.getProvider;
  ImageProviderRouter.getProvider = (name?: string) => {
    if (name === "openai") {
      const ai: ConfiguredImageProvider = {
        name: "openai",
        async generateImage(input) { aiCalls.push(input.sceneId); return aiImage(input); },
        createImmutableImageDispatchAdapter() {
          return createProviderDispatchAdapter(ai, { metadata: { name: "openai" }, requiredMethods: ["generateImage"] });
        },
      };
      return ai;
    }
    return original(name);
  };
  (provider as unknown as { restore: () => void }).restore = () => { ImageProviderRouter.getProvider = original; };
  return provider;
}

async function readAssets(slug: string): Promise<ProjectAssets> {
  return JSON.parse(await fs.readFile(path.join(projectsRoot, slug, "assets", "assets.json"), "utf8")) as ProjectAssets;
}

async function run() {
  await scenario("research -> structured mediaCandidates (via enrichResearchWithMediaDiscovery)", async () => {
    const client = fixtureClient({ "*": [wm()] });
    const enriched = await enrichResearchWithMediaDiscovery(research(), { client, now: () => now });
    assert.ok(Array.isArray(enriched.mediaCandidates) && enriched.mediaCandidates.length > 0);
    const c = enriched.mediaCandidates![0];
    assert.equal(c.provider, "wikimedia-commons");
    assert.equal(c.discoveredAt, now);
    assert.ok(Array.isArray(c.queryTerms) && c.queryTerms.length > 0);
  });

  await scenario("deriveDiscoveryQueries: topic + locations + characters + events, bounded + deduped", () => {
    const q = deriveDiscoveryQueries(research({ locations: ["Hagia Sophia", "hagia sophia", ""] }));
    const terms = q.map((x) => x.term.toLowerCase());
    assert.ok(terms.includes("i̇stanbul'un fethi") || terms.includes("istanbul'un fethi"));
    assert.equal(new Set(terms).size, terms.length); // deduped
    assert.ok(q.some((x) => x.association === "location"));
    assert.ok(q.some((x) => x.association === "character"));
    assert.ok(q.some((x) => x.association === "event"));
    assert.ok(q.length <= 12);
  });

  await scenario("wikimedia candidate parsed correctly (title/url/license/size)", async () => {
    const client = fixtureClient({ "*": [wm({ title: "File:Hagia Sophia interior.jpg", width: 2048, height: 1536 })] });
    const [c] = await discoverResearchMediaCandidates({ research: research(), client, now: () => now });
    assert.equal(c.title, "File:Hagia Sophia interior.jpg");
    assert.equal(c.sourceUrl, "https://commons.wikimedia.org/wiki/File:Walls_of_Constantinople.jpg");
    assert.equal(c.license, "CC BY-SA 4.0");
    assert.equal(c.width, 2048);
    assert.equal(c.height, 1536);
    assert.equal(c.mediaType, "photo");
  });

  await scenario("sourceUrl + provenance preserved through discovery", async () => {
    const client = fixtureClient({ "*": [wm({ pageUrl: "https://commons.wikimedia.org/wiki/File:Y.jpg", attribution: "Jane Doe" })] });
    const [c] = await discoverResearchMediaCandidates({ research: research(), client, now: () => now });
    assert.equal(c.sourceUrl, "https://commons.wikimedia.org/wiki/File:Y.jpg");
    assert.equal(c.attribution, "Jane Doe");
    assert.match(c.id, /^wikimedia-commons:[0-9a-f]{24}$/);
  });

  await scenario("public-domain candidate is admissible", async () => {
    const client = fixtureClient({ "*": [wm({ license: "Public domain" })] });
    const [c] = await discoverResearchMediaCandidates({ research: research(), client, now: () => now });
    assert.equal(c.rightsStatus, "public-domain");
    assert.equal(c.admissible, true);
  });

  await scenario("open-license candidate is admissible", async () => {
    const client = fixtureClient({ "*": [wm({ license: "CC BY 2.0" })] });
    const [c] = await discoverResearchMediaCandidates({ research: research(), client, now: () => now });
    assert.equal(c.rightsStatus, "open-license");
    assert.equal(c.admissible, true);
  });

  await scenario("unknown / restricted candidate is retained but NOT admissible", async () => {
    const client = fixtureClient({
      "*": [wm({ pageUrl: "https://commons.wikimedia.org/wiki/File:R.jpg", license: "All rights reserved" }),
            wm({ pageUrl: "https://commons.wikimedia.org/wiki/File:U.jpg", license: "" })],
    });
    const cs = await discoverResearchMediaCandidates({ research: research(), client, now: () => now });
    const restricted = cs.find((c) => c.sourceUrl.endsWith("R.jpg"));
    const unknown = cs.find((c) => c.sourceUrl.endsWith("U.jpg"));
    assert.equal(restricted?.rightsStatus, "restricted");
    assert.equal(restricted?.admissible, false);
    assert.equal(unknown?.rightsStatus, "unknown");
    assert.equal(unknown?.admissible, false);
  });

  await scenario("an LLM-fabricated sources[] URL never becomes a production candidate", async () => {
    // sources carries a fabricated URL; discovery only trusts the source client's own results.
    const client = fixtureClient({ "*": [] }); // client finds nothing
    const enriched = await enrichResearchWithMediaDiscovery(
      research({ sources: ["https://totally-made-up.example/photo-of-1453.jpg"] }),
      { client, now: () => now },
    );
    assert.equal(enriched.mediaCandidates, undefined); // no candidates -> field stays absent
    assert.deepEqual(enriched.sources, ["https://totally-made-up.example/photo-of-1453.jpg"]); // sources untouched
  });

  await scenario("duplicate candidates deterministically deduped by source URL", async () => {
    const dup = wm({ pageUrl: "https://commons.wikimedia.org/wiki/File:Dup.jpg" });
    const client = fixtureClient({
      "İstanbul'un Fethi": [dup], "Walls of Constantinople": [dup], "*": [dup],
    });
    const cs = await discoverResearchMediaCandidates({ research: research(), client, now: () => now });
    const dups = cs.filter((c) => c.sourceUrl.endsWith("Dup.jpg"));
    assert.equal(dups.length, 1);
    assert.ok(dups[0].queryTerms.length >= 1);
    // deterministic: same input -> identical output
    const again = await discoverResearchMediaCandidates({ research: research(), client, now: () => now });
    assert.deepEqual(cs, again);
  });

  await scenario("scene <-> candidate matching is deterministic + no cross-scene reuse", () => {
    const cs = [
      { id: "a", admissible: true, queryTerms: ["walls of constantinople"], title: "Walls", sourceUrl: "u", provider: "wikimedia-commons", mediaType: "photo" as const, rightsStatus: "open-license" as const, confidence: 0.9, discoveredAt: now, association: "location" as const },
      { id: "b", admissible: true, queryTerms: ["hagia sophia"], title: "Hagia", sourceUrl: "u2", provider: "wikimedia-commons", mediaType: "photo" as const, rightsStatus: "open-license" as const, confidence: 0.9, discoveredAt: now, association: "location" as const },
    ];
    const scenes = [visualScene(1, ["walls of constantinople"]), visualScene(2, ["hagia sophia"]), visualScene(3, ["walls of constantinople"])];
    const m = matchResearchMediaToScenes(cs, scenes);
    assert.equal(m.get(1)?.id, "a");
    assert.equal(m.get(2)?.id, "b");
    assert.equal(m.get(3), undefined); // "a" already used, no other match -> no reuse
    // idempotent
    assert.deepEqual([...matchResearchMediaToScenes(cs, scenes)], [...m]);
  });

  await scenario("real candidate available for every scene -> VisualAssetPipeline makes 0 AI calls", async () => {
    const enriched = await enrichResearchWithMediaDiscovery(research(), { client: generativeClient(4), now: () => now });
    // 3 scenes all keyed to the "Siege of 1453" event query -> 3 distinct candidates
    const scenes = [1, 2, 3].map((id) => visualScene(id, ["Siege of 1453"]));
    const vd = applyResearchMediaCandidatesToVisualData(visualData(scenes), enriched);
    assert.ok(vd.scenes.every((s) => s.mediaCandidate?.admissible === true), "every scene matched a candidate");
    // no cross-scene reuse
    assert.equal(new Set(vd.scenes.map((s) => s.mediaCandidate!.id)).size, 3);
    assert.ok(vd.scenes.every((s) => (s.searchKeywords ?? []).some((k) => k.toLowerCase().includes("siege of 1453"))));

    const realCalls: number[] = [];
    const aiCalls: number[] = [];
    const provider = keywordAwareRealProvider(["siege of 1453"], realCalls, aiCalls);
    try {
      await VisualAssetPipeline.generateAssets({
        projectId: "faz2", projectSlug: `${prefix}-p10`, visualData: vd, provider, maxAiImages: 4,
      });
      const images = (await readAssets(`${prefix}-p10`)).assets.filter((a) => a.type === "image" && a.status === "generated");
      assert.equal(images.length, 3);
      assert.ok(images.every((a) => a.provider === "real" && a.mediaOrigin === "real"));
      assert.deepEqual(aiCalls, []);
    } finally { (provider as unknown as { restore: () => void }).restore(); }
  });

  await scenario("no matching candidate -> Faz 1 AI fallback still works", async () => {
    const enriched = await enrichResearchWithMediaDiscovery(research(), { client: generativeClient(4), now: () => now });
    const vd = applyResearchMediaCandidatesToVisualData(
      visualData([visualScene(1, ["a purely imagined dream moment"])]), enriched);
    assert.equal(vd.scenes[0].mediaCandidate, undefined); // nothing overlaps
    const realCalls: number[] = [];
    const aiCalls: number[] = [];
    const provider = keywordAwareRealProvider(["siege of 1453"], realCalls, aiCalls);
    try {
      await VisualAssetPipeline.generateAssets({
        projectId: "faz2", projectSlug: `${prefix}-p11`, visualData: vd, provider, maxAiImages: 4,
      });
      const image = (await readAssets(`${prefix}-p11`)).assets.find((a) => a.type === "image" && a.status === "generated");
      assert.equal(image?.provider, "openai");
      assert.equal(image?.mediaOrigin, "ai");
      assert.deepEqual(aiCalls, [1]);
    } finally { (provider as unknown as { restore: () => void }).restore(); }
  });

  await scenario("16 scenes, AI cap = 4 still enforced with discovery data present", async () => {
    const enriched = await enrichResearchWithMediaDiscovery(research(), { client: generativeClient(4), now: () => now });
    // 4 real query terms cycled across 12 scenes (4 candidates each -> 12 distinct matches);
    // scenes 13-16 key to nothing -> AI fallback, exactly at the cap of 4.
    const realTerms = ["Walls of Constantinople", "Hagia Sophia", "Siege of 1453", "Fatih Sultan Mehmet"];
    const scenes = Array.from({ length: 16 }, (_, i) =>
      visualScene(i + 1, i < 12 ? [realTerms[i % realTerms.length]] : ["an imagined vision"]));
    const vd = applyResearchMediaCandidatesToVisualData(visualData(scenes), enriched);
    assert.equal(vd.scenes.filter((s) => s.mediaCandidate).length, 12);
    const realCalls: number[] = [];
    const aiCalls: number[] = [];
    const provider = keywordAwareRealProvider(realTerms, realCalls, aiCalls);
    try {
      await VisualAssetPipeline.generateAssets({
        projectId: "faz2", projectSlug: `${prefix}-p12a`, visualData: vd, provider, maxAiImages: 4,
      });
      assert.equal(aiCalls.length, 4);
      assert.equal(realCalls.length, 12);

      const scenes2 = Array.from({ length: 16 }, (_, i) =>
        visualScene(i + 1, i < 11 ? [realTerms[i % realTerms.length]] : ["an imagined vision"]));
      const vd2 = applyResearchMediaCandidatesToVisualData(visualData(scenes2), enriched);
      await assert.rejects(
        VisualAssetPipeline.generateAssets({
          projectId: "faz2", projectSlug: `${prefix}-p12b`, visualData: vd2, provider, maxAiImages: 4,
        }),
        (e) => e instanceof VisualMediaAiBudgetExceededError,
      );
    } finally { (provider as unknown as { restore: () => void }).restore(); }
  });

  await scenario('mediaType "video" candidate metadata retained (Faz 2 does not render it)', async () => {
    const client = fixtureClient({
      "*": [wm({ pageUrl: "https://commons.wikimedia.org/wiki/File:Clip.webm", mimeType: "video/webm", license: "Public domain" })],
    });
    const [c] = await discoverResearchMediaCandidates({ research: research(), client, now: () => now });
    assert.equal(c.mediaType, "video");
    assert.equal(c.admissible, true);
    assert.equal(c.mediaUrl, "https://upload.wikimedia.org/wikipedia/commons/a/walls.jpg");
    // it is retained on research, but the matcher/visuals path does not fetch or render it
    const vd = applyResearchMediaCandidatesToVisualData(
      visualData([visualScene(1, ["walls"])]),
      { ...research(), mediaCandidates: [c] },
    );
    assert.equal(vd.mediaCandidates?.[0].mediaType, "video");
  });

  console.log(`Faz 2 research media discovery smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "faz2-research-media-discovery", scenarios: count }));
}

async function main() {
  await withCanonicalSmokeRuntime({ name: "faz2-research-media-discovery", now }, async (runtime) => {
    projectsRoot = runtime.runtimeStorageContext.projectsRoot;
    prefix = `faz2-${runtime.runId.slice(0, 10)}`;
    await run();
  });
}

main().catch((error) => {
  console.error("Faz 2 research media discovery smoke FAILED:", error);
  process.exitCode = 1;
});
