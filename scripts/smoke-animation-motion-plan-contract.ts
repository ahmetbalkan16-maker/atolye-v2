import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { AnimationAssetPipeline } from "../src/lib/animation/AnimationAssetPipeline";
import { isCompatibleAnimationData } from "../src/lib/animation/AnimationMotionPlanValidation";
import { mergeAnimationData } from "../src/lib/animation/animationMerge";
import { AnimationPromptGenerator } from "../src/lib/animation/prompts/AnimationPromptGenerator";
import type {
  AnimationGenerationInput,
  AnimationGenerationResult,
  AnimationProvider,
} from "../src/lib/animation/providers/AnimationProvider";
import { resolveAnimationProviderName } from "../src/lib/animation/providers/AnimationProviderConfig";
import { MockAnimationProvider } from "../src/lib/animation/providers/MockAnimationProvider";
import { AssetManager } from "../src/lib/assets/AssetManager";
import { PipelineJobManager } from "../src/lib/pipeline/PipelineJobManager";
import { PipelineQueueScheduler } from "../src/lib/pipeline/PipelineQueueScheduler";
import { PipelineRunner } from "../src/lib/pipeline/PipelineRunner";
import {
  PipelineStageExecutor,
  type PipelineExecutionState,
} from "../src/lib/pipeline/PipelineStageExecutor";
import { ProjectManager } from "../src/lib/projects/ProjectManager";
import type { AnimationData, AnimationScene } from "../src/types/animation";
import type { Asset } from "../src/types/asset";
import type { ProductionStepKey, ProjectPackageRunType } from "../src/types/project";

type RunnerHarness = {
  runStage(
    slug: string,
    stage: ProductionStepKey,
    action: () => Promise<boolean>,
    runType: ProjectPackageRunType,
  ): Promise<boolean>;
};

const prefix = `sprint-116-motion-plan-${process.pid}`;
const projectsRoot = path.join(process.cwd(), "data", "projects");
const originalPromptGenerator = AnimationPromptGenerator.generateAnimationData;
let scenarios = 0;

async function scenario(name: string, run: () => void | Promise<void>) {
  await run();
  scenarios += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${scenarios}: ${name}`);
}

function animationScene(sceneId: number, durationSeconds = 8): AnimationScene {
  return {
    sceneId,
    animationPrompt: `motion prompt ${sceneId}`,
    durationSeconds,
    status: "planned",
  };
}

function mockImage(
  projectId: string,
  slug: string,
  sceneId: number,
  id = `${slug}-image-${sceneId}`,
): Asset {
  return AssetManager.createAsset({
    id,
    projectId,
    projectSlug: slug,
    sceneId,
    type: "image",
    status: "generated",
    provider: "mock",
    model: "mock-image-model",
    prompt: `image ${sceneId}`,
    filePath: "",
    url: "",
    mimeType: "image/mock",
  });
}

async function fixture(
  suffix: string,
  sceneIds: number[] = [1, 2],
  assetsFactory?: (projectId: string, slug: string) => Asset[],
) {
  const slug = `${prefix}-${suffix}`;
  const project = await ProjectManager.createProject(slug);
  const assets = assetsFactory
    ? assetsFactory(project.id, slug)
    : sceneIds.map((sceneId) => mockImage(project.id, slug, sceneId));
  const now = new Date().toISOString();
  AssetManager.saveProjectAssets(slug, {
    projectId: project.id,
    projectSlug: slug,
    assets,
    createdAt: now,
    updatedAt: now,
  });
  return {
    slug,
    project,
    scenes: sceneIds.map((sceneId) => animationScene(sceneId)),
    assetsPath: AssetManager.getAssetsPath(slug),
  };
}

function provider(
  generate: (input: AnimationGenerationInput) => AnimationGenerationResult | Promise<AnimationGenerationResult>,
  name = "mock",
): AnimationProvider {
  return { name, generateAnimation: async (input) => generate(input) };
}

async function valid(input: AnimationGenerationInput) {
  return new MockAnimationProvider().generateAnimation(input);
}

async function expectRejectedWithoutAssetWrite(
  value: Awaited<ReturnType<typeof fixture>>,
  scenes: AnimationScene[],
  selectedProvider: AnimationProvider,
) {
  const before = await fs.readFile(value.assetsPath, "utf8");
  await assert.rejects(
    AnimationAssetPipeline.generateAnimationAssets({
      projectId: value.project.id,
      projectSlug: value.slug,
      scenes,
      provider: selectedProvider,
    }),
    /Animation motion plan generation failed/,
  );
  assert.equal(await fs.readFile(value.assetsPath, "utf8"), before);
}

async function pipelineFixture(suffix: string) {
  const value = await fixture(suffix, [1, 2]);
  const sceneData = {
    scenes: [
      { id: 1, title: "One", description: "One", duration: 8 },
      { id: 2, title: "Two", description: "Two", duration: 9 },
    ],
    createdAt: new Date().toISOString(),
  };
  const visualData = {
    projectId: value.project.id,
    scenes: [
      { sceneId: 1, visualPrompt: "one", animationPrompt: "move one", style: "cinematic" },
      { sceneId: 2, visualPrompt: "two", animationPrompt: "move two", style: "cinematic" },
    ],
    thumbnail: { title: "t", prompt: "p", composition: "c", mood: "m" },
    createdAt: new Date().toISOString(),
  };
  await ProjectManager.saveScenes(value.slug, sceneData);
  await ProjectManager.saveVisuals(value.slug, visualData);
  await PipelineJobManager.listJobs(value.slug);
  const state = {
    ...PipelineStageExecutor.createInitialState(value.project),
    scenes: sceneData,
    visuals: visualData,
  } as PipelineExecutionState;
  return { ...value, state };
}

async function main() {
  try {
    await scenario("provider config is mock-first and unknown values fail closed", () => {
      assert.equal(resolveAnimationProviderName(undefined), "mock");
      assert.equal(resolveAnimationProviderName("  mock "), "mock");
      assert.throws(() => resolveAnimationProviderName("external"));
    });

    await scenario("visual asset identity maps one-to-one into motion plans", async () => {
      const value = await fixture("identity");
      const result = await AnimationAssetPipeline.generateAnimationAssets({
        projectId: value.project.id,
        projectSlug: value.slug,
        scenes: value.scenes,
      });
      assert.equal(result.updatedScenes.length, 2);
      for (const scene of result.updatedScenes) {
        assert.equal(scene.sourceImageAssetId, `${value.slug}-image-${scene.sceneId}`);
        assert.equal(scene.animationAssetId, scene.outputAssetId);
        assert.equal(scene.artifactType, "motion-plan");
        assert.equal(scene.status, "generated");
      }
    });

    await scenario("visual retry history deterministically selects the latest registry version", async () => {
      const value = await fixture("visual-retry", [1], (projectId, slug) => [
        mockImage(projectId, slug, 1, "image-version-1"),
        mockImage(projectId, slug, 1, "image-version-2"),
      ]);
      const result = await AnimationAssetPipeline.generateAnimationAssets({
        projectId: value.project.id,
        projectSlug: value.slug,
        scenes: value.scenes,
      });
      assert.equal(result.updatedScenes[0].sourceImageAssetId, "image-version-2");
      assert.equal(
        result.projectAssets.assets.find(
          (asset) => asset.id === result.updatedScenes[0].animationAssetId,
        )?.sourceAssetId,
        "image-version-2",
      );
    });

    await scenario("mock plans are deterministic for multiple scenes", async () => {
      const mock = new MockAnimationProvider();
      for (const sceneId of [1, 2, 3]) {
        const input = { sceneId, animationPrompt: "x", sourceImageAssetId: `image-${sceneId}`, durationSeconds: 8 };
        assert.deepEqual(await mock.generateAnimation(input), await mock.generateAnimation(input));
      }
    });

    await scenario("duplicate scene ids fail before provider calls and writes", async () => {
      const value = await fixture("duplicate-scene", [1]);
      let calls = 0;
      await expectRejectedWithoutAssetWrite(
        value,
        [animationScene(1), animationScene(1)],
        provider(async (input) => { calls += 1; return valid(input); }),
      );
      assert.equal(calls, 0);
    });

    await scenario("duplicate source image ids fail before provider calls", async () => {
      const value = await fixture("duplicate-source", [1, 2], (projectId, slug) => [
        mockImage(projectId, slug, 1, "same-image"),
        mockImage(projectId, slug, 2, "same-image"),
      ]);
      let calls = 0;
      await expectRejectedWithoutAssetWrite(
        value,
        value.scenes,
        provider(async (input) => { calls += 1; return valid(input); }),
      );
      assert.equal(calls, 0);
    });

    await scenario("missing or wrong-scene visual assets fail before provider calls", async () => {
      const value = await fixture("missing-source", [1, 2], (projectId, slug) => [mockImage(projectId, slug, 1)]);
      let calls = 0;
      await expectRejectedWithoutAssetWrite(
        value,
        value.scenes,
        provider(async (input) => { calls += 1; return valid(input); }),
      );
      assert.equal(calls, 0);
    });

    for (const [name, mutate] of [
      ["unsupported motion", (result: AnimationGenerationResult) => ({ ...result, motionType: "spin" })],
      ["unsupported transition", (result: AnimationGenerationResult) => ({ ...result, transition: "wipe" })],
      ["NaN transform", (result: AnimationGenerationResult) => result.success ? ({ ...result, start: { ...result.start, transform: { ...result.start.transform, scale: Number.NaN } } }) : result],
      ["infinite transform", (result: AnimationGenerationResult) => result.success ? ({ ...result, end: { ...result.end, transform: { ...result.end.transform, translateX: Number.POSITIVE_INFINITY } } }) : result],
      ["out-of-range crop", (result: AnimationGenerationResult) => result.success ? ({ ...result, end: { ...result.end, crop: { ...result.end.crop, width: 1.1 } } }) : result],
    ] as const) {
      await scenario(`${name} fails closed without persistence`, async () => {
        const value = await fixture(`invalid-${name.replaceAll(" ", "-")}`, [1]);
        await expectRejectedWithoutAssetWrite(
          value,
          value.scenes,
          provider(async (input) => mutate(await valid(input)) as AnimationGenerationResult),
        );
      });
    }

    await scenario("invalid input duration fails before provider calls", async () => {
      const value = await fixture("invalid-duration", [1]);
      let calls = 0;
      await expectRejectedWithoutAssetWrite(
        value,
        [animationScene(1, 0)],
        provider(async (input) => { calls += 1; return valid(input); }),
      );
      assert.equal(calls, 0);
    });

    await scenario("provider duration mismatch fails closed", async () => {
      const value = await fixture("duration-mismatch", [1]);
      await expectRejectedWithoutAssetWrite(
        value,
        value.scenes,
        provider(async (input) => ({ ...(await valid(input)), durationSeconds: 301 })),
      );
    });

    await scenario("mock artifact invariant has no media locator", async () => {
      const value = await fixture("mock-invariant", [1]);
      const result = await AnimationAssetPipeline.generateAnimationAssets({
        projectId: value.project.id,
        projectSlug: value.slug,
        scenes: value.scenes,
      });
      const artifact = result.projectAssets.assets.find((asset) => asset.id === result.updatedScenes[0].animationAssetId);
      assert.equal(artifact?.mimeType, "application/vnd.atolye.motion-plan+json");
      assert.equal(artifact?.artifactType, "motion-plan");
      assert.equal(artifact?.generationMode, "mock");
      assert.equal(artifact?.sourceAssetId, result.updatedScenes[0].sourceImageAssetId);
      assert.equal(artifact?.filePath, undefined);
      assert.equal(artifact?.url, undefined);
    });

    await scenario("legacy placeholder records remain readable without false v2 labeling", async () => {
      const legacy: AnimationData = {
        projectId: "legacy-project",
        scenes: [{ sceneId: 1, animationPrompt: "legacy", outputAssetId: "legacy-asset", provider: "mock", status: "generated" }],
        createdAt: "2026-07-14T00:00:00.000Z",
      };
      const value = await fixture("legacy-merge", [2]);
      const generated = await AnimationAssetPipeline.generateAnimationAssets({
        projectId: value.project.id,
        projectSlug: value.slug,
        scenes: value.scenes,
      });
      const merged = mergeAnimationData(legacy, generated.updatedScenes, legacy.projectId);
      assert.equal(merged.scenes.length, 2);
      assert.equal(merged.scenes[0].outputAssetId, "legacy-asset");
      assert.equal(merged.schemaVersion, undefined);
      assert.equal(merged.artifactType, undefined);
      assert.equal(isCompatibleAnimationData(legacy), true);
      assert.equal(isCompatibleAnimationData(merged), true);
    });

    await scenario("incomplete or malformed v2 records fail closed on read and merge labeling", async () => {
      const value = await fixture("v2-validation", [1]);
      const generated = await AnimationAssetPipeline.generateAnimationAssets({
        projectId: value.project.id,
        projectSlug: value.slug,
        scenes: value.scenes,
      });
      const complete = mergeAnimationData(
        null,
        generated.updatedScenes,
        value.project.id,
      );
      assert.equal(isCompatibleAnimationData(complete), true);
      assert.equal(
        isCompatibleAnimationData({
          ...complete,
          scenes: [
            {
              ...complete.scenes[0],
              outputAssetId: "wrong-animation-asset",
            },
          ],
        }),
        false,
      );
      assert.equal(
        isCompatibleAnimationData({
          ...complete,
          scenes: [{ ...complete.scenes[0], start: undefined }],
        }),
        false,
      );
      assert.equal(
        isCompatibleAnimationData({ ...complete, artifactType: undefined }),
        false,
      );
      const malformedMerge = mergeAnimationData(
        null,
        [{ ...complete.scenes[0], durationSeconds: Number.NaN }],
        value.project.id,
      );
      assert.equal(malformedMerge.schemaVersion, undefined);
      assert.equal(malformedMerge.artifactType, undefined);
      assert.equal(isCompatibleAnimationData(malformedMerge), false);
    });

    await scenario("malformed provider identity fails closed", async () => {
      const value = await fixture("malformed", [1]);
      await expectRejectedWithoutAssetWrite(
        value,
        value.scenes,
        provider(async (input) => ({ ...(await valid(input)), sceneId: 99 })),
      );
    });

    await scenario("batch provider validation persists no partial artifacts", async () => {
      const value = await fixture("batch-atomic", [1, 2]);
      let calls = 0;
      await expectRejectedWithoutAssetWrite(
        value,
        value.scenes,
        provider(async (input) => {
          calls += 1;
          const result = await valid(input);
          return calls === 2 ? ({ ...result, sourceImageAssetId: "wrong" }) : result;
        }),
      );
      assert.equal(calls, 2);
    });

    AnimationPromptGenerator.generateAnimationData = async ({ projectId, scenes }) => ({
      projectId,
      scenes: scenes.scenes.map((scene) => animationScene(scene.id, scene.duration ?? 6)),
      createdAt: new Date().toISOString(),
    });

    await scenario("pipeline success keeps animation, registry, manifest, job and history consistent", async () => {
      const value = await pipelineFixture("pipeline-success");
      const runner = PipelineRunner as unknown as RunnerHarness;
      assert.equal(
        await runner.runStage(
          value.slug,
          "animation",
          () => PipelineStageExecutor.execute(value.slug, "animation", value.state, { animationProvider: new MockAnimationProvider() }),
          "initial",
        ),
        true,
      );
      const stored = await ProjectManager.getAnimation(value.slug) as AnimationData;
      const jobs = await PipelineJobManager.listJobsReadOnly(value.slug);
      const history = await PipelineJobManager.listHistory(value.slug);
      assert.equal(stored.schemaVersion, "2");
      assert.equal(stored.artifactType, "motion-plan");
      assert.equal(stored.scenes.length, 2);
      assert.equal((await ProjectManager.getManifest(value.slug))?.packages.animation.status, "completed");
      assert.equal(jobs.jobs.find((job) => job.stage === "animation")?.status, "completed");
      assert.ok(history.events.some((event) => event.stage === "animation" && event.status === "completed"));
      assert.equal(jobs.jobs.find((job) => job.stage === "video")?.status, "queued");

      const before = {
        animation: await fs.readFile(path.join(projectsRoot, value.slug, "animation.json"), "utf8"),
        assets: await fs.readFile(value.assetsPath, "utf8"),
        history: await fs.readFile(path.join(projectsRoot, value.slug, "pipeline-history.json"), "utf8"),
      };
      assert.equal(
        await runner.runStage(
          value.slug,
          "animation",
          () => PipelineStageExecutor.execute(value.slug, "animation", value.state, { animationProvider: new MockAnimationProvider() }),
          "initial",
        ),
        false,
      );
      assert.equal(await fs.readFile(path.join(projectsRoot, value.slug, "animation.json"), "utf8"), before.animation);
      assert.equal(await fs.readFile(value.assetsPath, "utf8"), before.assets);
      assert.equal(await fs.readFile(path.join(projectsRoot, value.slug, "pipeline-history.json"), "utf8"), before.history);
    });

    await scenario("animation failure persists terminal state and blocks video", async () => {
      const value = await pipelineFixture("pipeline-failure");
      const runner = PipelineRunner as unknown as RunnerHarness;
      await assert.rejects(
        runner.runStage(
          value.slug,
          "animation",
          () => PipelineStageExecutor.execute(value.slug, "animation", value.state, {
            animationProvider: provider(async (input) => ({ ...(await valid(input)), transition: "wipe" as never })),
          }),
          "initial",
        ),
        /Animation motion plan generation failed/,
      );
      const jobs = await PipelineJobManager.listJobsReadOnly(value.slug);
      const history = await PipelineJobManager.listHistory(value.slug);
      const scheduled = await PipelineQueueScheduler.getNextRunnableStage(
        value.slug,
        ["animation", "video"],
      );
      assert.equal(jobs.jobs.find((job) => job.stage === "animation")?.status, "failed");
      assert.notEqual(jobs.jobs.find((job) => job.stage === "video")?.status, "running");
      assert.notEqual(jobs.jobs.find((job) => job.stage === "video")?.status, "completed");
      assert.equal((await ProjectManager.getManifest(value.slug))?.packages.animation.status, "failed");
      assert.ok(history.events.some((event) => event.stage === "animation" && event.status === "failed"));
      assert.equal(scheduled.stage, null);
      assert.match(scheduled.reason ?? "", /animation.*failed/i);
    });

    console.log(`Sprint 116 animation motion plan contract smoke: PASS (${scenarios} scenarios)`);
  } finally {
    AnimationPromptGenerator.generateAnimationData = originalPromptGenerator;
    const entries = await fs.readdir(projectsRoot, { withFileTypes: true });
    await Promise.all(
      entries
        .filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix))
        .map((entry) => fs.rm(path.join(projectsRoot, entry.name), { recursive: true, force: true })),
    );
  }
}

void main();
