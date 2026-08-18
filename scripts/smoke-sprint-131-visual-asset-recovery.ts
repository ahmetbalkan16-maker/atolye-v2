import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { AssetManager } from "../src/lib/assets/AssetManager";
import { VisualAssetPipeline, VisualAssetGenerationError } from "../src/lib/assets/VisualAssetPipeline";
import type { ImageProvider, ImageGenerationInput } from "../src/lib/assets/providers/ImageProvider";
import type { ImageGenerationResult } from "../src/types/asset";
import type { VisualData } from "../src/types/visual";

class MockCountedImageProvider implements ImageProvider {
  readonly name = "mock" as const;
  calls: ImageGenerationInput[] = [];
  shouldFailSceneId?: number;

  async generateImage(input: ImageGenerationInput): Promise<ImageGenerationResult> {
    this.calls.push(input);
    if (this.shouldFailSceneId !== undefined && input.sceneId === this.shouldFailSceneId) {
      throw new Error(`Mock provider error for scene ${input.sceneId}`);
    }
    return {
      success: true,
      provider: "mock",
      sceneId: input.sceneId,
      filePath: "",
      url: "",
      mimeType: "image/mock",
      createdAt: new Date().toISOString(),
    };
  }
}

async function runTests() {
  console.log("=== STARTING SPRINT 131 VISUAL ASSET RECOVERY SMOKE SUITE ===");

  const testSlug = `sprint-131-recovery-smoke-${Date.now()}`;
  const testId = `test-id-${Date.now()}`;

  const visualData: VisualData = {
    scenes: [
      { sceneId: 1, visualPrompt: "Prompt 1", animationPrompt: "Anim 1", style: "cinematic", searchKeywords: ["k1"] },
      { sceneId: 2, visualPrompt: "Prompt 2", animationPrompt: "Anim 2", style: "cinematic", searchKeywords: ["k2"] },
      { sceneId: 3, visualPrompt: "Prompt 3", animationPrompt: "Anim 3", style: "cinematic", searchKeywords: ["k3"] },
    ],
    thumbnail: { title: "Title", prompt: "Thumb Prompt", composition: "Comp", mood: "Mood" },
    createdAt: new Date().toISOString(),
    projectId: testId,
  };

  // Seed initial assets: Scene 1 and Scene 2 generated, Scene 3 missing
  AssetManager.addAsset(testSlug, testId, {
    id: "asset-1",
    projectId: testId,
    projectSlug: testSlug,
    sceneId: 1,
    type: "image",
    status: "generated",
    provider: "mock",
    prompt: "Prompt 1",
    filePath: "",
    url: "",
    mimeType: "image/mock",
    createdAt: new Date().toISOString(),
  });

  AssetManager.addAsset(testSlug, testId, {
    id: "asset-2",
    projectId: testId,
    projectSlug: testSlug,
    sceneId: 2,
    type: "image",
    status: "generated",
    provider: "mock",
    prompt: "Prompt 1",
    filePath: "",
    url: "",
    mimeType: "image/mock",
    createdAt: new Date().toISOString(),
  });

  // TEST A: Partial Recovery
  console.log("Running TEST A: Partial Recovery (Scene 1/2 generated, Scene 3 missing)...");
  const providerA = new MockCountedImageProvider();
  const assetsA = await VisualAssetPipeline.generateAssets({
    projectId: testId,
    projectSlug: testSlug,
    visualData,
    provider: providerA,
  });

  assert.equal(providerA.calls.length, 1, "Expected exactly 1 provider call for missing Scene 3");
  assert.equal(providerA.calls[0].sceneId, 3, "Expected provider call to target Scene 3");
  assert.equal(assetsA.assets.length, 3, "Expected 3 total assets in projectAssets after recovery");
  console.log("✔ TEST A PASSED: Scene 1/2 reused (0 calls), Scene 3 generated (1 call).");

  // TEST B: All Assets Generated (Completed Batch Guard)
  console.log("Running TEST B: All Assets Generated Guard...");
  const providerB = new MockCountedImageProvider();
  let threwB = false;
  try {
    await VisualAssetPipeline.generateAssets({
      projectId: testId,
      projectSlug: testSlug,
      visualData,
      provider: providerB,
    });
  } catch (err) {
    if (err instanceof VisualAssetGenerationError) {
      threwB = true;
    }
  }
  assert.equal(threwB, true, "Expected VisualAssetGenerationError when all scenes are already generated");
  assert.equal(providerB.calls.length, 0, "Expected 0 provider calls for fully generated batch");
  console.log("✔ TEST B PASSED: Completed batch duplicate execution prevented.");

  // TEST C: Scene 3 Failure Safety
  console.log("Running TEST C: Scene 3 Failure Safety...");
  const failSlug = `sprint-131-fail-smoke-${Date.now()}`;
  AssetManager.addAsset(failSlug, testId, {
    id: "asset-f1",
    projectId: testId,
    projectSlug: failSlug,
    sceneId: 1,
    type: "image",
    status: "generated",
    provider: "mock",
    prompt: "Prompt 1",
    filePath: "",
    url: "",
    mimeType: "image/mock",
    createdAt: new Date().toISOString(),
  });
  AssetManager.addAsset(failSlug, testId, {
    id: "asset-f2",
    projectId: testId,
    projectSlug: failSlug,
    sceneId: 2,
    type: "image",
    status: "generated",
    provider: "mock",
    prompt: "Prompt 2",
    filePath: "",
    url: "",
    mimeType: "image/mock",
    createdAt: new Date().toISOString(),
  });

  const providerC = new MockCountedImageProvider();
  providerC.shouldFailSceneId = 3;
  let threwC = false;

  try {
    await VisualAssetPipeline.generateAssets({
      projectId: testId,
      projectSlug: failSlug,
      visualData,
      provider: providerC,
    });
  } catch (err) {
    if (err instanceof VisualAssetGenerationError) {
      threwC = true;
    }
  }
  assert.equal(threwC, true, "Expected VisualAssetGenerationError on Scene 3 provider failure");
  const failAssets = AssetManager.getProjectAssets(failSlug, testId);
  const scene1Asset = failAssets.assets.find((a) => a.sceneId === 1);
  const scene2Asset = failAssets.assets.find((a) => a.sceneId === 2);
  const scene3Asset = failAssets.assets.find((a) => a.sceneId === 3);

  assert.equal(scene1Asset?.status, "generated", "Scene 1 asset must be preserved on failure");
  assert.equal(scene2Asset?.status, "generated", "Scene 2 asset must be preserved on failure");
  assert.equal(scene3Asset?.status, "failed", "Scene 3 asset must be recorded as failed");
  console.log("✔ TEST C PASSED: Scene 1/2 preserved, Scene 3 failed cleanly.");

  // Clean up scratch test directories
  await fs.rm(path.join(process.cwd(), "data", "projects", testSlug), { recursive: true, force: true }).catch(() => {});
  await fs.rm(path.join(process.cwd(), "data", "projects", failSlug), { recursive: true, force: true }).catch(() => {});

  console.log("ALL VISUAL ASSET RECOVERY SMOKE TESTS PASSED 100% CLEANLY!");
}

runTests().catch((err) => {
  console.error("SMOKE TEST FAILED:", err);
  process.exit(1);
});
