/**
 * Phase 6 — production real-media wiring (integration).
 *
 * NO real network / paid API. Verifies the acceptance rights gate, the
 * deterministic scene-media selection ladder -> per-scene overrides, the
 * cap-before-dispatch behaviour, and cross-scene reuse prevention.
 *
 *   A  auditProductionMediaRights: real+admissible pass, AI-only pass, no-media pass
 *   B  real asset with restricted / unknown / missing-source / drift -> rejected
 *   C  assertProductionMediaRights throws on any rejection
 *   D  sceneMediaSelectionOverrides: real -> "real", no-match -> "ai", explicit wins
 *   E  16 scenes, 12 real + 4 AI -> plan within cap, overrides deterministic
 *   F  16 scenes, 11 real + 5 AI -> VISUAL_AI_IMAGE_BUDGET_EXCEEDED (before dispatch)
 *   G  cross-scene reuse forbidden: one candidate -> one scene
 *   H  RealMediaProductionFlags default off; selection is a no-op without the flag
 */
import assert from "node:assert/strict";
import { emitSmokeResult } from "./lib/SmokeResult";
import {
  auditProductionMediaRights,
  assertProductionMediaRights,
  ProductionMediaRightsError,
} from "../src/lib/production/ProductionMediaRightsAudit";
import {
  selectSceneMedia,
  sceneMediaSelectionOverrides,
} from "../src/lib/assets/SceneMediaSelection";
import { VisualMediaAiBudgetExceededError } from "../src/lib/assets/VisualMediaAdmissionPolicy";
import { isRealMediaSelectionEnabled } from "../src/lib/assets/RealMediaProductionFlags";
import type { Asset, MediaType, MediaRightsStatus } from "../src/types/asset";
import type { ResearchMediaCandidate } from "../src/types/research";
import type { VisualScene } from "../src/types/visual";

let count = 0;
function scenario(name: string, fn: () => void) {
  fn();
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}

function asset(over: Partial<Asset>): Asset {
  return {
    id: `a-${Math.random().toString(36).slice(2)}`,
    projectId: "p",
    type: "image",
    status: "generated",
    provider: "real",
    prompt: "x",
    createdAt: "2026-08-30T00:00:00.000Z",
    ...over,
  };
}

function realAsset(rightsStatus: MediaRightsStatus, license: string, over: Partial<Asset> = {}): Asset {
  return asset({
    mediaOrigin: "real",
    mediaType: "photo",
    rightsStatus,
    license,
    sourceUrl: "https://commons.wikimedia.org/wiki/File:X.jpg",
    ...over,
  });
}

let seq = 0;
function candidate(mediaType: MediaType, terms: string[]): ResearchMediaCandidate {
  seq += 1;
  const id = `wikimedia-commons:c-${String(seq).padStart(3, "0")}`;
  return {
    id, mediaType, title: terms.join(" "), provider: "wikimedia-commons",
    sourceUrl: `https://commons.wikimedia.org/wiki/File:${id}.jpg`,
    mediaUrl: `https://upload.wikimedia.org/${id}.jpg`,
    license: "CC BY-SA 4.0", attribution: "A", rightsStatus: "open-license", admissible: true,
    queryTerms: terms, association: "event", confidence: 0.8, discoveredAt: "2026-08-30T00:00:00.000Z",
  };
}
function scene(id: number, keywords: string[]): VisualScene {
  return { sceneId: id, visualPrompt: keywords.join(" "), animationPrompt: "x", style: "documentary", searchKeywords: keywords };
}

function run() {
  // A ----------------------------------------------------------------
  scenario("A: audit passes for admissible real media, AI-only, and no-media projects", () => {
    assert.equal(auditProductionMediaRights([realAsset("public-domain", "Public Domain"), realAsset("open-license", "CC BY 4.0")]).pass, true);
    assert.equal(auditProductionMediaRights([asset({ mediaOrigin: "ai", mediaType: "ai-image", provider: "openai" })]).pass, true);
    assert.equal(auditProductionMediaRights([asset({ provider: "mock" })]).pass, true);
    const summary = auditProductionMediaRights([realAsset("public-domain", "PD"), realAsset("open-license", "CC BY 4.0"), realAsset("verified", "Museum verified")]);
    assert.equal(summary.summary.publicDomain, 1);
    assert.equal(summary.summary.openLicense, 1);
    assert.equal(summary.summary.verified, 1);
    assert.equal(summary.realMediaAssetCount, 3);
  });

  // B ----------------------------------------------------------------
  scenario("B: restricted / unknown / missing-source / drift real assets are rejected", () => {
    const restricted = auditProductionMediaRights([realAsset("restricted", "CC BY-NC 4.0")]);
    assert.equal(restricted.pass, false);
    assert.equal(restricted.rejected[0].reason, "rights-not-admissible");

    const unknown = auditProductionMediaRights([asset({ mediaOrigin: "real", rightsStatus: undefined, license: "??", sourceUrl: "https://x/y" })]);
    assert.equal(unknown.rejected[0].reason, "missing-rights-metadata");

    const noSource = auditProductionMediaRights([realAsset("open-license", "CC BY 4.0", { sourceUrl: undefined })]);
    assert.equal(noSource.rejected[0].reason, "missing-source-url");

    // recorded status stronger than the licence text actually supports
    const drift = auditProductionMediaRights([realAsset("open-license", "All Rights Reserved")]);
    assert.equal(drift.rejected[0].reason, "rights-status-drift");

    // verified bypasses the drift check (out-of-band confirmation)
    assert.equal(auditProductionMediaRights([realAsset("verified", "All Rights Reserved but cleared")]).pass, true);
  });

  // C ----------------------------------------------------------------
  scenario("C: assertProductionMediaRights throws on any rejection", () => {
    assert.throws(
      () => assertProductionMediaRights([realAsset("restricted", "CC BY-ND 4.0")]),
      (e: unknown) => e instanceof ProductionMediaRightsError && e.code === "PRODUCTION_MEDIA_RIGHTS_INADMISSIBLE",
    );
    assert.doesNotThrow(() => assertProductionMediaRights([realAsset("public-domain", "CC0")]));
  });

  // D ----------------------------------------------------------------
  scenario("D: sceneMediaSelectionOverrides - real/ai mapping, explicit wins", () => {
    const scenes = [scene(1, ["romanus gate"]), scene(2, ["nothing here abcxyz"])];
    const cands = [candidate("photo", ["romanus gate"])];
    const plan = selectSceneMedia({ scenes, candidates: cands, maxAiImages: 4 });
    const overrides = sceneMediaSelectionOverrides(plan);
    assert.equal(overrides[1], "real");
    assert.equal(overrides[2], "ai");
    // explicit operator override is preserved
    const withExplicit = sceneMediaSelectionOverrides(plan, { 1: "ai" });
    assert.equal(withExplicit[1], "ai");
  });

  // E ----------------------------------------------------------------
  scenario("E: 16 scenes, 12 real + 4 AI -> within cap, deterministic overrides", () => {
    const terms = Array.from({ length: 12 }, (_, i) => [`distinct topic alpha${i}`, `distinct topic beta${i}`]);
    const cands = terms.map((t) => candidate("photo", t));
    const scenes = [
      ...terms.map((t, i) => scene(i + 1, t)),
      ...Array.from({ length: 4 }, (_, i) => scene(i + 13, [`void scene ${i}`])),
    ];
    const plan = selectSceneMedia({ scenes, candidates: cands, maxAiImages: 4 });
    assert.equal(plan.realPhotoScenes, 12);
    assert.equal(plan.aiImageScenes, 4);
    const a = sceneMediaSelectionOverrides(plan);
    const b = sceneMediaSelectionOverrides(selectSceneMedia({ scenes, candidates: cands, maxAiImages: 4 }));
    assert.deepEqual(a, b);
    assert.equal(Object.values(a).filter((v) => v === "ai").length, 4);
  });

  // F ----------------------------------------------------------------
  scenario("F: 16 scenes, 11 real + 5 AI -> VISUAL_AI_IMAGE_BUDGET_EXCEEDED before dispatch", () => {
    const terms = Array.from({ length: 11 }, (_, i) => [`unique topic one${i}`, `unique topic two${i}`]);
    const cands = terms.map((t) => candidate("photo", t));
    const scenes = [
      ...terms.map((t, i) => scene(i + 1, t)),
      ...Array.from({ length: 5 }, (_, i) => scene(i + 12, [`no match ${i}`])),
    ];
    assert.throws(
      () => selectSceneMedia({ scenes, candidates: cands, maxAiImages: 4 }),
      (e: unknown) => e instanceof VisualMediaAiBudgetExceededError && e.maxAiImages === 4 && e.sceneId === 16,
    );
  });

  // G ----------------------------------------------------------------
  scenario("G: cross-scene reuse forbidden - one candidate maps to one scene", () => {
    const cands = [candidate("photo", ["archival newsreel"])];
    const scenes = Array.from({ length: 6 }, (_, i) => scene(i + 1, ["archival newsreel"]));
    const plan = selectSceneMedia({ scenes, candidates: cands, maxAiImages: 100 });
    assert.equal(plan.realPhotoScenes, 1);
    assert.equal(plan.usedCandidateIds.length, 1);
    assert.equal(plan.aiImageScenes, 5);
  });

  // H ----------------------------------------------------------------
  scenario("H: RealMediaProductionFlags default off", () => {
    assert.equal(isRealMediaSelectionEnabled({} as unknown as NodeJS.ProcessEnv), false);
    assert.equal(isRealMediaSelectionEnabled({ ATOLYE_REAL_MEDIA_SELECTION: "on" } as unknown as NodeJS.ProcessEnv), true);
  });

  console.log(`Phase 6 production real-media wiring smoke: PASS (${count} scenarios)`);
  emitSmokeResult("phase6-production-real-media", count);
}

run();
