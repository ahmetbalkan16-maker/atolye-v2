/**
 * Documentary pipeline V2 (Faz 2a): per-scene image resilience in
 * VisualAssetPipeline.
 *
 * No real API - the image provider is a stub. Verifies that a RETRYABLE image
 * failure gets exactly one controlled retry, that a NON-retryable failure
 * (content policy / 4xx) gets none, that the retry count is hard-capped at 1,
 * that a mid-batch failure still fails the whole stage closed (no silent
 * missing asset), and that the plain success path is unchanged. (Asset reuse
 * across re-runs is covered by smoke-sprint-131-visuals-artifact-reuse.)
 */
import assert from "node:assert/strict";
import path from "node:path";
import { promises as fs } from "node:fs";
import { withCanonicalSmokeRuntime } from "./lib/CanonicalSmokeRuntime";
import {
  VisualAssetGenerationError,
  VisualAssetPipeline,
} from "../src/lib/assets/VisualAssetPipeline";
import { createProviderDispatchAdapter } from "../src/lib/providers/ProviderDispatchAdapterAuthority";
import { ImageStorage } from "../src/lib/assets/storage/ImageStorage";
import type {
  ConfiguredImageProvider,
  ImageGenerationInput,
} from "../src/lib/assets/providers/ImageProvider";
import type { ImageGenerationResult, ProjectAssets } from "../src/types/asset";
import type { VisualData } from "../src/types/visual";

const now = "2026-08-29T00:00:00.000Z";
let count = 0;
let projectsRoot = "";
let prefix = "";

function scenario(name: string, fn: () => Promise<void>) {
  return fn().then(() => {
    count += 1;
    if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
  });
}

function visualData(sceneCount: number): VisualData {
  return {
    projectId: "retry-smoke-project",
    scenes: Array.from({ length: sceneCount }, (_, i) => ({
      sceneId: i + 1,
      visualPrompt: `Sahne ${i + 1} tek kare`,
      animationPrompt: "slow push in",
      style: "cinematic",
    })),
    thumbnail: { title: "t", prompt: "p", composition: "c", mood: "m" },
    createdAt: now,
  };
}

const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/** A real stored image (what the production provider produces) so re-runs can reuse it. */
function okResult(input: ImageGenerationInput): ImageGenerationResult {
  const saved = ImageStorage.saveImage({
    projectSlug: input.projectSlug as string,
    data: PNG,
    mimeType: "image/png",
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

function failResult(sceneId: number, retryable: boolean, code?: string): ImageGenerationResult {
  return {
    success: false,
    sceneId,
    provider: "openai",
    model: "stub-image-model",
    createdAt: now,
    error: "Image generation failed.",
    errorEvidence: {
      retryable,
      httpStatus: retryable ? 429 : 400,
      providerErrorCode: code,
      sceneId,
    },
  };
}

/** Stub provider driven by a per-call script. */
function stubProvider(
  script: (input: ImageGenerationInput, callForScene: number) => ImageGenerationResult,
  onCall?: (sceneId: number) => void,
): ConfiguredImageProvider {
  const perScene = new Map<number, number>();
  const provider: ConfiguredImageProvider = {
    name: "openai",
    async generateImage(input) {
      const n = (perScene.get(input.sceneId) ?? 0) + 1;
      perScene.set(input.sceneId, n);
      onCall?.(input.sceneId);
      return script(input, n);
    },
    createImmutableImageDispatchAdapter() {
      return createProviderDispatchAdapter(provider, {
        metadata: { name: provider.name }, requiredMethods: ["generateImage"],
      });
    },
  };
  return provider;
}

async function readAssets(slug: string): Promise<ProjectAssets> {
  return JSON.parse(
    await fs.readFile(path.join(projectsRoot, slug, "assets", "assets.json"), "utf8"),
  ) as ProjectAssets;
}

const noDelay = { retryDelayMs: 0, delayFn: async () => {} };

async function run() {
  await scenario("retryable failure -> exactly ONE retry -> success; asset stored", async () => {
    const calls: number[] = [];
    const provider = stubProvider(
      (input, n) => (n === 1 ? failResult(input.sceneId, true) : okResult(input)),
      (sceneId) => calls.push(sceneId),
    );
    const assets = await VisualAssetPipeline.generateAssets({
      projectId: "retry-smoke-project",
      projectSlug: `${prefix}-r1`,
      visualData: visualData(1),
      provider,
      resilience: noDelay,
    });
    assert.equal(calls.length, 2); // 1 attempt + 1 retry
    assert.equal(assets.assets.filter((a) => a.type === "image" && a.status === "generated").length, 1);
  });

  await scenario("non-retryable failure (content policy) -> NO retry -> stage fails closed", async () => {
    const calls: number[] = [];
    const provider = stubProvider(
      (input) => failResult(input.sceneId, false, "content_policy_violation"),
      (sceneId) => calls.push(sceneId),
    );
    await assert.rejects(
      VisualAssetPipeline.generateAssets({
        projectId: "retry-smoke-project",
        projectSlug: `${prefix}-r2`,
        visualData: visualData(1),
        provider,
        resilience: noDelay,
      }),
      (e) => e instanceof VisualAssetGenerationError,
    );
    assert.equal(calls.length, 1); // no retry
  });

  await scenario("retryable but retry also fails -> stage fails closed, called exactly twice", async () => {
    const calls: number[] = [];
    const provider = stubProvider(
      (input) => failResult(input.sceneId, true),
      (sceneId) => calls.push(sceneId),
    );
    await assert.rejects(
      VisualAssetPipeline.generateAssets({
        projectId: "retry-smoke-project",
        projectSlug: `${prefix}-r3`,
        visualData: visualData(1),
        provider,
        resilience: noDelay,
      }),
      (e) => e instanceof VisualAssetGenerationError,
    );
    assert.equal(calls.length, 2); // hard cap: 1 attempt + 1 retry, never more
  });

  await scenario("retry limit is 1 even if the provider keeps returning retryable", async () => {
    let total = 0;
    const provider = stubProvider(
      (input) => failResult(input.sceneId, true),
      () => { total += 1; },
    );
    await assert.rejects(
      VisualAssetPipeline.generateAssets({
        projectId: "retry-smoke-project",
        projectSlug: `${prefix}-r4`,
        visualData: visualData(3),
        provider,
        resilience: noDelay,
      }),
      (e) => e instanceof VisualAssetGenerationError,
    );
    // fails on the very first scene: 1 attempt + 1 retry = 2, then throw. Never 3+.
    assert.equal(total, 2);
  });

  await scenario("15 scenes, scene 8 fails non-retryable -> scenes 1-7 assets persisted, stage still fails closed", async () => {
    const provider = stubProvider((input) => {
      if (input.sceneId === 8) return failResult(8, false, "content_policy_violation");
      return okResult(input);
    });
    await assert.rejects(
      VisualAssetPipeline.generateAssets({
        projectId: "retry-smoke-project",
        projectSlug: `${prefix}-r5`,
        visualData: visualData(15),
        provider,
        resilience: noDelay,
      }),
      (e) => e instanceof VisualAssetGenerationError,
    );
    const assets = await readAssets(`${prefix}-r5`);
    const generated = assets.assets.filter((a) => a.type === "image" && a.status === "generated");
    const failed = assets.assets.filter((a) => a.type === "image" && a.status === "failed");
    assert.equal(generated.length, 7, "scenes 1-7 must be kept");
    assert.equal(failed.length, 1, "scene 8 marked failed");
    assert.deepEqual(generated.map((a) => a.sceneId).sort((x, y) => x! - y!), [1, 2, 3, 4, 5, 6, 7]);
  });

  await scenario("a successful first attempt is never retried (retry only fires on a retryable failure)", async () => {
    let calls = 0;
    await VisualAssetPipeline.generateAssets({
      projectId: "retry-smoke-project",
      projectSlug: `${prefix}-r6`,
      visualData: visualData(6),
      provider: stubProvider((input) => okResult(input), () => { calls += 1; }),
      resilience: noDelay,
    });
    assert.equal(calls, 6, "exactly one call per scene, no retries on success");
  });

  await scenario("delayFn is invoked once per retry with the configured retry delay", async () => {
    const waits: number[] = [];
    const provider = stubProvider((input, n) =>
      n === 1 ? failResult(input.sceneId, true) : okResult(input),
    );
    await VisualAssetPipeline.generateAssets({
      projectId: "retry-smoke-project",
      projectSlug: `${prefix}-r7`,
      visualData: visualData(1),
      provider,
      resilience: { retryDelayMs: 1234, delayFn: async (ms) => { waits.push(ms); } },
    });
    assert.deepEqual(waits, [1234]);
  });

  await scenario("single-scene-per-chapter / plain success path is unchanged", async () => {
    const provider = stubProvider((input) => okResult(input));
    const assets = await VisualAssetPipeline.generateAssets({
      projectId: "retry-smoke-project",
      projectSlug: `${prefix}-r8`,
      visualData: visualData(5),
      provider,
      // no resilience field at all -> real defaults, still works
    });
    assert.equal(assets.assets.filter((a) => a.type === "image" && a.status === "generated").length, 5);
  });

  console.log(`Visual asset pipeline per-scene retry smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "visual-asset-pipeline-per-scene-retry", scenarios: count }));
}

async function main() {
  await withCanonicalSmokeRuntime(
    { name: "visual-asset-per-scene-retry", now },
    async (runtime) => {
      projectsRoot = runtime.runtimeStorageContext.projectsRoot;
      prefix = `faz2a-retry-${runtime.runId.slice(0, 10)}`;
      await run();
    },
  );
}

main().catch((error) => {
  console.error("Visual asset pipeline per-scene retry smoke FAILED:", error);
  process.exitCode = 1;
});
