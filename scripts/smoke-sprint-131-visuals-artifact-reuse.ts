import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { AssetManager } from "../src/lib/assets/AssetManager";
import { ProjectManager, VisualsArtifactConflictError } from "../src/lib/projects/ProjectManager";
import { PipelineStageExecutor } from "../src/lib/pipeline/PipelineStageExecutor";
import { PipelineJobManager } from "../src/lib/pipeline/PipelineJobManager";
import { createRuntimeStorageContext } from "../src/lib/runtime/RuntimeStoragePaths";
import { createProviderDispatchAdapter } from "../src/lib/providers/ProviderDispatchAdapterAuthority";
import type { ImageProvider, ImageGenerationInput } from "../src/lib/assets/providers/ImageProvider";
import type { ImageGenerationResult } from "../src/types/asset";
import type { SceneData } from "../src/types/scene";
import type { VisualData } from "../src/types/visual";

class MockCountedImageProvider implements ImageProvider {
  readonly name = "mock" as const;
  calls: ImageGenerationInput[] = [];

  createImmutableImageDispatchAdapter() {
    return createProviderDispatchAdapter(this, {
      metadata: { name: this.name },
      requiredMethods: ["generateImage"],
    });
  }

  async generateImage(input: ImageGenerationInput): Promise<ImageGenerationResult> {
    this.calls.push(input);
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
  console.log("=== STARTING SPRINT 131 VISUALS ARTIFACT REUSE SMOKE SUITE ===");

  const testId = `test-id-${Date.now()}`;

  const scenesData: SceneData = {
    scenes: [
      { id: 1, title: "Scene 1", description: "Desc 1", duration: 10, visualPrompt: "VP1" },
      { id: 2, title: "Scene 2", description: "Desc 2", duration: 10, visualPrompt: "VP2" },
      { id: 3, title: "Scene 3", description: "Desc 3", duration: 10, visualPrompt: "VP3" },
    ],
    createdAt: new Date().toISOString(),
  };

  const visualsData: VisualData = {
    scenes: [
      { sceneId: 1, visualPrompt: "VP1", animationPrompt: "AP1", style: "cinematic", searchKeywords: ["k1"] },
      { sceneId: 2, visualPrompt: "VP2", animationPrompt: "AP2", style: "cinematic", searchKeywords: ["k2"] },
      { sceneId: 3, visualPrompt: "VP3", animationPrompt: "AP3", style: "cinematic", searchKeywords: ["k3"] },
    ],
    thumbnail: { title: "Title", prompt: "Thumb", composition: "Comp", mood: "Mood" },
    createdAt: new Date().toISOString(),
    projectId: testId,
  };

  // TEST A: Resume with existing visuals artifact
  console.log("Running TEST A: Resume with existing visuals artifact...");
  const slugA = `sprint-131-artifact-reuse-a-${Date.now()}`;
  await ProjectManager.createProject(slugA, "Test Project A");
  await PipelineJobManager.listJobs(slugA);
  // Seed project slug with scenes and visuals.json
  await ProjectManager.saveScenes(slugA, scenesData);
  await ProjectManager.persistVisualsArtifact(slugA, visualsData);

  const loadedStateA = await PipelineStageExecutor.loadState(slugA);
  assert.ok(loadedStateA, "State should be loaded successfully");
  assert.ok(loadedStateA.visuals, "state.visuals should be populated from persisted visuals.json");
  assert.equal(loadedStateA.visuals.scenes.length, 3, "state.visuals scenes count should match");

  const providerA = new MockCountedImageProvider();
  const storageContextA = createRuntimeStorageContext();
  await PipelineStageExecutor.execute(
    slugA,
    "visuals",
    loadedStateA,
    { visualAssetProvider: providerA },
    undefined,
    undefined,
    undefined,
    undefined,
    storageContextA,
  );

  // Since no image assets exist yet for scenes 1, 2, 3, all 3 images are generated for the 3 scenes
  assert.equal(providerA.calls.length, 3, "Expected 3 provider calls for ungenerated scene images");
  console.log("✔ TEST A PASSED: Existing visuals.json artifact reused without VisualsArtifactConflictError.");

  // TEST B: Fresh initial execution (visuals.json absent)
  console.log("Running TEST B: Fresh initial execution without visuals.json...");
  const slugB = `sprint-131-artifact-reuse-b-${Date.now()}`;
  await ProjectManager.createProject(slugB, "Test Project B");
  await PipelineJobManager.listJobs(slugB);
  await ProjectManager.saveScenes(slugB, scenesData);

  const loadedStateB = await PipelineStageExecutor.loadState(slugB);
  assert.ok(loadedStateB, "State B loaded");
  assert.equal(loadedStateB.visuals, null, "state.visuals should be null initially");

  const providerB = new MockCountedImageProvider();
  const storageContextB = createRuntimeStorageContext();
  await PipelineStageExecutor.execute(
    slugB,
    "visuals",
    loadedStateB,
    { visualAssetProvider: providerB },
    undefined,
    undefined,
    undefined,
    undefined,
    storageContextB,
  );

  const finalStateB = await PipelineStageExecutor.loadState(slugB);
  assert.ok(finalStateB?.visuals, "visuals.json should be generated and persisted");
  console.log("✔ TEST B PASSED: Fresh initial execution generated visuals.json successfully.");

  // TEST C: Resume + Partial Image Recovery (Sprint 131 Canonical Recovery Pattern)
  console.log("Running TEST C: Resume + Partial Image Recovery...");
  const slugC = `sprint-131-artifact-reuse-c-${Date.now()}`;
  await ProjectManager.createProject(slugC, "Test Project C");
  await PipelineJobManager.listJobs(slugC);
  await ProjectManager.saveScenes(slugC, scenesData);
  await ProjectManager.persistVisualsArtifact(slugC, visualsData);

  // Seed Scene 1 and Scene 2 generated assets
  AssetManager.addAsset(slugC, testId, {
    id: "asset-c1",
    projectId: testId,
    projectSlug: slugC,
    sceneId: 1,
    type: "image",
    status: "generated",
    provider: "mock",
    prompt: "VP1",
    filePath: "",
    url: "",
    mimeType: "image/mock",
    createdAt: new Date().toISOString(),
  });

  AssetManager.addAsset(slugC, testId, {
    id: "asset-c2",
    projectId: testId,
    projectSlug: slugC,
    sceneId: 2,
    type: "image",
    status: "generated",
    provider: "mock",
    prompt: "VP2",
    filePath: "",
    url: "",
    mimeType: "image/mock",
    createdAt: new Date().toISOString(),
  });

  const loadedStateC = await PipelineStageExecutor.loadState(slugC);
  assert.ok(loadedStateC, "State C loaded");
  const providerC = new MockCountedImageProvider();
  const storageContextC = createRuntimeStorageContext();
  await PipelineStageExecutor.execute(
    slugC,
    "visuals",
    loadedStateC,
    { visualAssetProvider: providerC },
    undefined,
    undefined,
    undefined,
    undefined,
    storageContextC,
  );

  assert.equal(providerC.calls.length, 1, "Expected exactly 1 provider call for missing Scene 3");
  assert.equal(providerC.calls[0].sceneId, 3, "Provider call should target missing Scene 3");
  console.log("✔ TEST C PASSED: Visuals artifact reused, Scene 1/2 reused, Scene 3 generated (1 call).");

  // TEST D: Conflict Protection Maintained
  console.log("Running TEST D: Conflict Protection Maintained...");
  let threwD = false;
  try {
    const conflictingVisuals = { ...visualsData, thumbnail: { ...visualsData.thumbnail, title: "CONFLICT" } };
    await ProjectManager.persistVisualsArtifact(slugC, conflictingVisuals);
  } catch (err) {
    if (err instanceof VisualsArtifactConflictError) {
      threwD = true;
    }
  }
  assert.equal(threwD, true, "Persisting conflicting visuals artifact must throw VisualsArtifactConflictError");
  console.log("✔ TEST D PASSED: VisualsArtifactConflictError protection maintained.");

  // Clean up scratch test project directories
  await fs.rm(path.join(process.cwd(), "data", "projects", slugA), { recursive: true, force: true }).catch(() => {});
  await fs.rm(path.join(process.cwd(), "data", "projects", slugB), { recursive: true, force: true }).catch(() => {});
  await fs.rm(path.join(process.cwd(), "data", "projects", slugC), { recursive: true, force: true }).catch(() => {});

  console.log("ALL VISUALS ARTIFACT REUSE SMOKE TESTS PASSED 100% CLEANLY!");
}

runTests().catch((err) => {
  console.error("SMOKE TEST FAILED:", err);
  process.exit(1);
});
