import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { AnimationAssetPipeline } from "../src/lib/animation/AnimationAssetPipeline";
import { AnimationStorage } from "../src/lib/animation/AnimationStorage";
import { AnimationPromptGenerator } from "../src/lib/animation/prompts/AnimationPromptGenerator";
import { MockAnimationProvider } from "../src/lib/animation/providers/MockAnimationProvider";
import { OpenAIAnimationProvider } from "../src/lib/animation/providers/OpenAIAnimationProvider";
import type { AnimationGenerationInput, AnimationProvider } from "../src/lib/animation/providers/AnimationProvider";
import type { OpenAIAnimationProviderConfig } from "../src/lib/animation/providers/AnimationProviderConfig";
import { getOpenAIAnimationProviderConfig } from "../src/lib/animation/providers/AnimationProviderConfig";
import { AssetManager } from "../src/lib/assets/AssetManager";
import { AudioStorage } from "../src/lib/assets/storage/AudioStorage";
import { ImageStorage } from "../src/lib/assets/storage/ImageStorage";
import { VideoStorage } from "../src/lib/assets/storage/VideoStorage";
import { VideoAssemblyManager } from "../src/lib/assembly/VideoAssemblyManager";
import type { VideoAssemblyProvider } from "../src/lib/assembly/providers/VideoAssemblyProvider";
import { PipelineJobManager } from "../src/lib/pipeline/PipelineJobManager";
import { PipelineRunner } from "../src/lib/pipeline/PipelineRunner";
import { PipelineStageExecutor } from "../src/lib/pipeline/PipelineStageExecutor";
import { ProductionAcceptanceBlockedError, ProductionAcceptanceOrchestrator } from "../src/lib/production/ProductionAcceptanceOrchestrator";
import { productionAcceptanceConfigurationFingerprint } from "../src/lib/production/ProductionAcceptancePolicy";
import { ProductionReadinessService } from "../src/lib/production/ProductionReadinessService";
import { ProjectManager } from "../src/lib/projects/ProjectManager";
import { VideoPipeline } from "../src/lib/video/VideoPipeline";
import type { VideoProvider } from "../src/lib/video/providers/VideoProvider";
import type { AnimationData, AnimationScene } from "../src/types/animation";
import type { AssemblyPlanData } from "../src/types/assembly";
import type { AudioData } from "../src/types/audio";
import type { SceneData } from "../src/types/scene";
import type { VisualData } from "../src/types/visual";

const prefix = `sprint-127-animation-${process.pid}`;
const projectsRoot = path.join(process.cwd(), "data", "projects");
const endpoint = "https://api.openai.com/v1/chat/completions";
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
let scenarios = 0;

async function scenario(name: string, action: () => void | Promise<void>) {
  await action();
  scenarios += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${scenarios}: ${name}`);
}

function config(overrides: Partial<OpenAIAnimationProviderConfig> = {}): OpenAIAnimationProviderConfig {
  return {
    model: "gpt-4.1-mini",
    endpoint,
    timeoutMs: 50,
    retryCount: 1,
    maximumResponseBytes: 64 * 1024,
    ...overrides,
  };
}

function frame(scale: number) {
  return {
    crop: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
    transform: { scale, translateX: 0, translateY: 0 },
  };
}

function plan(input: AnimationGenerationInput) {
  void input;
  return {
    motionType: "zoom-in",
    start: frame(1),
    end: frame(1.2),
    transition: "fade",
  };
}

function openAIResponse(input: AnimationGenerationInput, mutate: (value: ReturnType<typeof plan>) => unknown = (value) => value) {
  return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(mutate(plan(input))) } }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function input(): AnimationGenerationInput {
  return { sceneId: 1, sourceImageAssetId: "image-1", animationPrompt: "Slow zoom", durationSeconds: 2 };
}

function productionProvider(): AnimationProvider {
  return {
    name: "openai",
    getRequestIdentity(value) {
      const requestIdentity = createHash("sha256").update(JSON.stringify({
        model: "gpt-4.1-mini",
        sceneId: value.sceneId,
        sourceImageAssetId: value.sourceImageAssetId,
        animationPrompt: value.animationPrompt.trim(),
        durationSeconds: value.durationSeconds,
      })).digest("hex");
      return {
        assetId: `animation-${requestIdentity}`,
        requestIdentity,
        promptDigest: createHash("sha256").update(value.animationPrompt.trim()).digest("hex"),
        model: "gpt-4.1-mini",
      };
    },
    async generateAnimation(value) {
      const motion = plan(value);
      const identity = this.getRequestIdentity?.(value);
      return {
        success: true,
        sceneId: value.sceneId,
        sourceImageAssetId: value.sourceImageAssetId,
        provider: "openai",
        model: "gpt-4.1-mini",
        generationMode: "production",
        requestIdentity: identity?.requestIdentity,
        artifactType: "motion-plan",
        status: "generated",
        durationSeconds: value.durationSeconds,
        motionType: "zoom-in",
        start: motion.start,
        end: motion.end,
        transition: "fade",
      };
    },
  };
}

async function readiness(environment: Record<string, string | undefined>) {
  return new ProductionReadinessService({ environment: environment as NodeJS.ProcessEnv }).evaluate();
}

function animationCheck(report: Awaited<ReturnType<typeof readiness>>) {
  return report.checks.find((item) => item.id === "animation-provider")!;
}

function animationEnvironment(overrides: Record<string, string | undefined> = {}) {
  return {
    NODE_ENV: process.env.NODE_ENV ?? "test",
    ANIMATION_PROVIDER: "openai",
    OPENAI_API_KEY: "configured-for-smoke",
    ANIMATION_OPENAI_MODEL: "gpt-4.1-mini",
    ANIMATION_OPENAI_ENDPOINT: endpoint,
    ...overrides,
  };
}

async function fixture(suffix: string) {
  const slug = `${prefix}-${suffix}`;
  const project = await ProjectManager.createProject(slug);
  const imageId = `${slug}-image-1`;
  const image = ImageStorage.saveImage({ projectSlug: slug, assetId: imageId, data: png, mimeType: "image/png" });
  const now = new Date().toISOString();
  AssetManager.saveProjectAssets(slug, {
    projectId: project.id,
    projectSlug: slug,
    assets: [AssetManager.createAsset({
      id: imageId,
      projectId: project.id,
      projectSlug: slug,
      sceneId: 1,
      type: "image",
      status: "generated",
      provider: "openai",
      model: "gpt-image-1",
      prompt: "image",
      filePath: image.filePath,
      url: image.url,
      mimeType: "image/png",
    })],
    createdAt: now,
    updatedAt: now,
  });
  const scenes: AnimationScene[] = [{ sceneId: 1, animationPrompt: "Slow zoom", durationSeconds: 2, status: "planned" }];
  return { slug, project, imageId, scenes };
}

async function createProductionAnimation(suffix: string) {
  const value = await fixture(suffix);
  const generated = await AnimationAssetPipeline.generateAnimationAssets({
    projectId: value.project.id,
    projectSlug: value.slug,
    scenes: value.scenes,
    provider: productionProvider(),
  });
  const animation: AnimationData = {
    projectId: value.project.id,
    schemaVersion: "2",
    artifactType: "motion-plan",
    scenes: generated.updatedScenes,
    createdAt: new Date().toISOString(),
  };
  return { ...value, generated, animation };
}

async function main() {
  const originalKey = process.env.OPENAI_API_KEY;
  try {
    process.env.OPENAI_API_KEY = "configured-for-smoke";
    await scenario("OpenAI provider creates deterministic request and valid production plan", async () => {
      const requests: Array<{ body: string; key: string | null }> = [];
      const provider = new OpenAIAnimationProvider(async (_url, init) => {
        assert.equal(init?.redirect, "error");
        requests.push({ body: init?.body as string, key: new Headers(init?.headers).get("Idempotency-Key") });
        return openAIResponse(input());
      }, () => config({ retryCount: 0 }));
      const result = await provider.generateAnimation(input());
      assert.equal(result.success, true);
      assert.equal(result.generationMode, "production");
      assert.equal(requests.length, 1);
      assert.match(requests[0].key ?? "", /^[a-f0-9]{64}$/);
      assert.equal(JSON.parse(requests[0].body).temperature, 0);
    });

    await scenario("endpoint allowlist rejects suffix, subdomain, userinfo, port, query and fragment tricks", () => {
      for (const invalidEndpoint of [
        "http://api.openai.com/v1/chat/completions",
        "https://api.openai.com.evil.test/v1/chat/completions",
        "https://evil.api.openai.com/v1/chat/completions",
        "https://user@api.openai.com/v1/chat/completions",
        "https://api.openai.com:443/v1/chat/completions",
        `${endpoint}?redirect=evil`,
        `${endpoint}#fragment`,
      ]) {
        assert.throws(() => getOpenAIAnimationProviderConfig({
          ...animationEnvironment(),
          ANIMATION_OPENAI_ENDPOINT: invalidEndpoint,
        } as NodeJS.ProcessEnv));
      }
    });

    await scenario("oversize response is cut off and never retried", async () => {
      let calls = 0;
      const provider = new OpenAIAnimationProvider(async () => {
        calls += 1;
        return new Response("x".repeat(2048), { status: 200 });
      }, () => config({ maximumResponseBytes: 1024, retryCount: 2 }));
      const result = await provider.generateAnimation(input());
      assert.equal(result.success, false);
      if (!result.success) assert.equal(result.error, "ANIMATION_RESPONSE_TOO_LARGE");
      assert.equal(calls, 1);
    });

    await scenario("deep JSON, prototype keys and nested unexpected fields fail closed", async () => {
      const payloads = [
        '{"sceneId":1,"sourceImageAssetId":"image-1","durationSeconds":2,"motionType":"zoom-in","start":{"crop":{"x":0.1,"y":0.1,"width":0.8,"height":0.8,"__proto__":{}},"transform":{"scale":1,"translateX":0,"translateY":0}},"end":{"crop":{"x":0.1,"y":0.1,"width":0.8,"height":0.8},"transform":{"scale":1.2,"translateX":0,"translateY":0}},"transition":"fade"}',
        JSON.stringify({ ...plan(input()), start: { ...frame(1), unexpected: { nested: { too: { deep: true } } } } }),
      ];
      for (const content of payloads) {
        const provider = new OpenAIAnimationProvider(async () => new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content } }] })), () => config({ retryCount: 0 }));
        const result = await provider.generateAnimation(input());
        assert.equal(result.success, false);
        if (!result.success) assert.equal(result.error, "ANIMATION_RESPONSE_SCHEMA_INVALID");
      }
    });

    await scenario("NaN, negative and excessive input duration never reaches provider", async () => {
      let calls = 0;
      const provider = new OpenAIAnimationProvider(async () => { calls += 1; return openAIResponse(input()); }, () => config());
      for (const durationSeconds of [Number.NaN, -1, 301]) {
        assert.equal((await provider.generateAnimation({ ...input(), durationSeconds })).success, false);
      }
      assert.equal(calls, 0);
    });

    await scenario("timeout wins over late response and late body cannot become success", async () => {
      const provider = new OpenAIAnimationProvider(async () => {
        await new Promise((resolve) => setTimeout(resolve, 60));
        return openAIResponse(input());
      }, () => config({ timeoutMs: 10, retryCount: 0 }));
      const started = Date.now();
      const result = await provider.generateAnimation(input());
      assert.equal(result.success, false);
      if (!result.success) assert.equal(result.error, "ANIMATION_PROVIDER_TIMEOUT");
      assert(Date.now() - started < 50);
      await new Promise((resolve) => setTimeout(resolve, 70));
    });

    await scenario("first successful attempt prevents any later attempt", async () => {
      let calls = 0;
      const provider = new OpenAIAnimationProvider(async () => { calls += 1; return openAIResponse(input()); }, () => config({ retryCount: 2 }));
      assert.equal((await provider.generateAnimation(input())).success, true);
      assert.equal(calls, 1);
    });

    await scenario("bounded retry reuses identical request and idempotency key", async () => {
      const calls: Array<{ body: string; key: string | null }> = [];
      const provider = new OpenAIAnimationProvider(async (_url, init) => {
        calls.push({ body: init?.body as string, key: new Headers(init?.headers).get("Idempotency-Key") });
        return calls.length === 1 ? new Response("", { status: 503 }) : openAIResponse(input());
      }, () => config({ retryCount: 1 }));
      assert.equal((await provider.generateAnimation(input())).success, true);
      assert.equal(calls.length, 2);
      assert.deepEqual(calls[0], calls[1]);
    });

    await scenario("timeout is bounded and returns stable safe code", async () => {
      let calls = 0;
      const provider = new OpenAIAnimationProvider((_url, init) => new Promise((_resolve, reject) => {
        calls += 1;
        init?.signal?.addEventListener("abort", () => reject(new DOMException("hidden", "AbortError")), { once: true });
      }), () => config({ timeoutMs: 10, retryCount: 1 }));
      const result = await provider.generateAnimation(input());
      assert.equal(result.success, false);
      if (result.success) throw new Error("expected failure");
      assert.equal(result.error, "ANIMATION_PROVIDER_RETRY_EXHAUSTED");
      assert.equal(calls, 2);
    });

    await scenario("malformed JSON and invalid motion schema fail closed without retry", async () => {
      let malformedCalls = 0;
      const malformed = new OpenAIAnimationProvider(async () => {
        malformedCalls += 1;
        return new Response("not-json", { status: 200 });
      }, () => config());
      const malformedResult = await malformed.generateAnimation(input());
      assert.equal(malformedResult.success, false);
      if (!malformedResult.success) assert.equal(malformedResult.error, "ANIMATION_RESPONSE_INVALID_JSON");
      assert.equal(malformedCalls, 1);
      const invalid = new OpenAIAnimationProvider(async () => openAIResponse(input(), (value) => ({ ...value, sceneId: 2 })), () => config());
      const invalidResult = await invalid.generateAnimation(input());
      assert.equal(invalidResult.success, false);
      if (!invalidResult.success) assert.equal(invalidResult.error, "ANIMATION_RESPONSE_SCHEMA_INVALID");
    });

    await scenario("readiness distinguishes READY, missing, mock and unknown", async () => {
      const originalGenerate = OpenAIAnimationProvider.prototype.generateAnimation;
      let providerCalls = 0;
      OpenAIAnimationProvider.prototype.generateAnimation = async function (...args) {
        providerCalls += 1;
        return originalGenerate.apply(this, args);
      };
      try {
        assert.equal(animationCheck(await readiness(animationEnvironment())).status, "READY");
      } finally {
        OpenAIAnimationProvider.prototype.generateAnimation = originalGenerate;
      }
      assert.equal(providerCalls, 0);
      assert.equal(animationCheck(await readiness({})).status, "NOT_CONFIGURED");
      assert.equal(animationCheck(await readiness({ ANIMATION_PROVIDER: "mock" })).status, "BLOCKED");
      assert.equal(animationCheck(await readiness({ ANIMATION_PROVIDER: "unknown" })).status, "INVALID");
    });

    await scenario("missing key, model and endpoint remain NOT_CONFIGURED", async () => {
      for (const name of ["OPENAI_API_KEY", "ANIMATION_OPENAI_MODEL", "ANIMATION_OPENAI_ENDPOINT"] as const) {
        const environment = animationEnvironment();
        delete environment[name];
        assert.equal(animationCheck(await readiness(environment)).status, "NOT_CONFIGURED");
      }
    });

    await scenario("invalid timeout, retry and response limits remain INVALID", async () => {
      for (const override of [
        { ANIMATION_OPENAI_TIMEOUT_MS: "99" },
        { ANIMATION_OPENAI_RETRY_COUNT: "3" },
        { ANIMATION_OPENAI_MAX_RESPONSE_BYTES: "100" },
      ]) {
        assert.equal(animationCheck(await readiness(animationEnvironment(override))).status, "INVALID");
      }
    });

    const value = await createProductionAnimation("storage");
    const motion = value.generated.updatedScenes[0];
    const asset = value.generated.projectAssets.assets.find((item) => item.id === motion.animationAssetId)!;

    await scenario("production motion plan is atomically stored with complete asset metadata", () => {
      assert.equal(asset.sceneId, 1);
      assert.equal(asset.sourceAssetId, value.imageId);
      assert.equal(asset.provider, "openai");
      assert.equal(asset.model, "gpt-4.1-mini");
      assert.equal(asset.generationMode, "production");
      assert.equal(asset.mimeType, "application/vnd.atolye.motion-plan+json");
      assert.equal(typeof asset.filePath, "string");
      assert.ok((asset.byteLength ?? 0) > 0);
      const inspection = AnimationStorage.inspectStoredMotionPlan(value.slug, asset.filePath as string);
      assert.equal(inspection.artifact.assetId, asset.id);
      const files = fs.readdirSync(path.join(projectsRoot, value.slug, "assets", "animations"));
      assert(files.includes(".atolye-animation-storage-v1"));
      assert(!files.some((file) => file.endsWith(".tmp")));
    });

    await scenario("exact replay is provider, storage and registry write-free", async () => {
      const replay = await fixture("replay");
      const base = productionProvider();
      let calls = 0;
      const provider: AnimationProvider = {
        ...base,
        async generateAnimation(request) {
          calls += 1;
          return base.generateAnimation(request);
        },
      };
      const first = await AnimationAssetPipeline.generateAnimationAssets({
        projectId: replay.project.id, projectSlug: replay.slug, scenes: replay.scenes, provider,
      });
      const firstAsset = first.projectAssets.assets.find((item) => item.type === "animation")!;
      const registryPath = path.join(process.cwd(), AssetManager.getAssetsPath(replay.slug));
      const artifactPath = path.join(process.cwd(), firstAsset.filePath as string);
      const registryBefore = fs.readFileSync(registryPath);
      const artifactBefore = fs.readFileSync(artifactPath);
      const artifactMtime = fs.statSync(artifactPath).mtimeMs;
      calls = 0;
      const second = await AnimationAssetPipeline.generateAnimationAssets({
        projectId: replay.project.id, projectSlug: replay.slug, scenes: replay.scenes, provider,
      });
      assert.equal(calls, 0);
      assert.equal(second.updatedScenes[0].animationAssetId, firstAsset.id);
      assert.deepEqual(fs.readFileSync(registryPath), registryBefore);
      assert.deepEqual(fs.readFileSync(artifactPath), artifactBefore);
      assert.equal(fs.statSync(artifactPath).mtimeMs, artifactMtime);
    });

    await scenario("same identity with conflicting prompt fails before paid call", async () => {
      const conflict = await fixture("identity-conflict");
      const base = productionProvider();
      const identity = base.getRequestIdentity!({
        sceneId: 1,
        sourceImageAssetId: conflict.imageId,
        animationPrompt: conflict.scenes[0].animationPrompt,
        durationSeconds: 2,
      });
      await AnimationAssetPipeline.generateAnimationAssets({
        projectId: conflict.project.id, projectSlug: conflict.slug, scenes: conflict.scenes, provider: base,
      });
      let calls = 0;
      const conflictingProvider: AnimationProvider = {
        ...base,
        getRequestIdentity: () => identity,
        async generateAnimation(request) { calls += 1; return base.generateAnimation(request); },
      };
      await assert.rejects(() => AnimationAssetPipeline.generateAnimationAssets({
        projectId: conflict.project.id,
        projectSlug: conflict.slug,
        scenes: [{ ...conflict.scenes[0], animationPrompt: "Different prompt" }],
        provider: conflictingProvider,
      }));
      assert.equal(calls, 0);
    });

    await scenario("registry persistence failure compensates only the new batch artifact", async () => {
      const isolatedExisting = await createProductionAnimation("compensation-existing");
      const existingAsset = isolatedExisting.generated.projectAssets.assets.find((item) => item.type === "animation")!;
      const existingPath = path.join(process.cwd(), existingAsset.filePath as string);
      const failing = await fixture("compensation-failing");
      const identity = productionProvider().getRequestIdentity!({
        sceneId: 1,
        sourceImageAssetId: failing.imageId,
        animationPrompt: failing.scenes[0].animationPrompt,
        durationSeconds: 2,
      });
      const targetPath = path.join(process.cwd(), AnimationStorage.getMotionPlanPath(failing.slug, identity.assetId));
      const originalSave = AssetManager.saveProjectAssetsAtomically;
      AssetManager.saveProjectAssetsAtomically = () => { throw new Error("injected persistence failure"); };
      try {
        await assert.rejects(() => AnimationAssetPipeline.generateAnimationAssets({
          projectId: failing.project.id, projectSlug: failing.slug, scenes: failing.scenes, provider: productionProvider(),
        }));
      } finally {
        AssetManager.saveProjectAssetsAtomically = originalSave;
      }
      assert.equal(fs.existsSync(targetPath), false);
      assert.equal(fs.existsSync(existingPath), true);
    });

    await scenario("existing storage target is never overwritten", () => {
      const inspection = AnimationStorage.inspectStoredMotionPlan(value.slug, asset.filePath as string);
      const before = fs.readFileSync(path.join(process.cwd(), asset.filePath as string));
      assert.throws(() => AnimationStorage.saveMotionPlan(value.slug, inspection.artifact));
      assert.deepEqual(fs.readFileSync(path.join(process.cwd(), asset.filePath as string)), before);
    });

    await scenario("atomic publish race preserves a concurrently-created target", async () => {
      const race = await fixture("atomic-race");
      const inspection = AnimationStorage.inspectStoredMotionPlan(value.slug, asset.filePath as string);
      const raceAssetId = `animation-${"a".repeat(64)}`;
      const target = path.join(process.cwd(), AnimationStorage.getMotionPlanPath(race.slug, raceAssetId));
      const originalLink = fs.linkSync;
      fs.linkSync = ((source, destination) => {
        fs.writeFileSync(destination, "concurrent-owner", { flag: "wx" });
        const error = new Error("target exists") as NodeJS.ErrnoException;
        error.code = "EEXIST";
        throw error;
      }) as typeof fs.linkSync;
      try {
        assert.throws(() => AnimationStorage.saveMotionPlan(race.slug, {
          ...inspection.artifact,
          assetId: raceAssetId,
        }));
      } finally {
        fs.linkSync = originalLink;
      }
      assert.equal(fs.readFileSync(target, "utf8"), "concurrent-owner");
    });

    await scenario("duplicate scene/source identities and traversal locators fail closed", async () => {
      const duplicate = await fixture("duplicate");
      await assert.rejects(() => AnimationAssetPipeline.generateAnimationAssets({
        projectId: duplicate.project.id,
        projectSlug: duplicate.slug,
        scenes: [...duplicate.scenes, ...duplicate.scenes],
        provider: productionProvider(),
      }));
      assert.throws(() => AnimationStorage.inspectStoredMotionPlan(value.slug, "data/projects/outside.json"));
    });

    await scenario("scene-video pipeline requires stored production motion-plan locator", async () => {
      const video = await VideoPipeline.generateVideo({
        projectId: value.project.id,
        projectSlug: value.slug,
        animation: value.animation,
        provider: sceneVideoProvider(),
      });
      assert.equal(video.video.scenes[0].animationAssetId, motion.animationAssetId);
      const registry = AssetManager.getProjectAssets(value.slug, value.project.id);
      AssetManager.saveProjectAssets(value.slug, {
        ...registry,
        assets: registry.assets.map((item) => item.id === asset.id ? { ...item, filePath: undefined } : item),
      });
      await assert.rejects(() => VideoPipeline.generateVideo({
        projectId: value.project.id,
        projectSlug: value.slug,
        animation: value.animation,
        provider: sceneVideoProvider(),
      }));
      AssetManager.saveProjectAssets(value.slug, registry);
      await verifyAssembly(value, video.video);
    });

    await scenario("artifact content mismatch and cross-project locator fail closed", async () => {
      const registry = AssetManager.getProjectAssets(value.slug, value.project.id);
      const artifactPath = path.join(process.cwd(), asset.filePath as string);
      const originalArtifact = fs.readFileSync(artifactPath);
      const parsed = JSON.parse(originalArtifact.toString("utf8"));
      fs.writeFileSync(artifactPath, `${JSON.stringify({ ...parsed, durationSeconds: 3 }, null, 2)}\n`);
      await assert.rejects(() => VideoPipeline.generateVideo({
        projectId: value.project.id, projectSlug: value.slug, animation: value.animation, provider: sceneVideoProvider(),
      }));
      fs.writeFileSync(artifactPath, originalArtifact);
      const other = await createProductionAnimation("cross-project");
      const otherAsset = other.generated.projectAssets.assets.find((item) => item.type === "animation")!;
      AssetManager.saveProjectAssets(value.slug, {
        ...registry,
        assets: registry.assets.map((item) => item.id === asset.id ? {
          ...item,
          filePath: otherAsset.filePath,
          byteLength: otherAsset.byteLength,
        } : item),
      });
      await assert.rejects(() => VideoPipeline.generateVideo({
        projectId: value.project.id, projectSlug: value.slug, animation: value.animation, provider: sceneVideoProvider(),
      }));
      AssetManager.saveProjectAssets(value.slug, registry);
    });

    await scenario("new prompt creates a new active identity while obsolete artifact remains isolated", async () => {
      const previousId = value.animation.scenes[0].animationAssetId;
      const regenerated = await AnimationAssetPipeline.generateAnimationAssets({
        projectId: value.project.id,
        projectSlug: value.slug,
        scenes: [{ ...value.scenes[0], animationPrompt: "Regenerated motion prompt" }],
        provider: productionProvider(),
      });
      const activeId = regenerated.updatedScenes[0].animationAssetId;
      assert.notEqual(activeId, previousId);
      const animationAssets = regenerated.projectAssets.assets.filter((item) => item.type === "animation");
      assert.equal(animationAssets.filter((item) => item.id === previousId).length, 1);
      assert.equal(animationAssets.filter((item) => item.id === activeId).length, 1);
      const activeAnimation: AnimationData = {
        projectId: value.project.id,
        schemaVersion: "2",
        artifactType: "motion-plan",
        scenes: regenerated.updatedScenes,
        createdAt: new Date().toISOString(),
      };
      assert.equal((await VideoPipeline.generateVideo({
        projectId: value.project.id, projectSlug: value.slug, animation: activeAnimation, provider: sceneVideoProvider(),
      })).video.scenes[0].animationAssetId, activeId);
    });

    await scenario("sentinel loss fails stored artifact read closed", () => {
      const sentinel = path.join(projectsRoot, value.slug, "assets", "animations", ".atolye-animation-storage-v1");
      const original = fs.readFileSync(sentinel, "utf8");
      fs.rmSync(sentinel);
      assert.throws(() => AnimationStorage.inspectStoredMotionPlan(value.slug, asset.filePath as string));
      assert.equal(fs.existsSync(sentinel), false);
      fs.writeFileSync(sentinel, original, "utf8");
      fs.writeFileSync(sentinel, "wrong-version", "utf8");
      assert.throws(() => AnimationStorage.inspectStoredMotionPlan(value.slug, asset.filePath as string));
      fs.writeFileSync(sentinel, original, "utf8");
    });

    await scenario("animation storage root junction swap cannot escape project storage", () => {
      const animationDir = path.join(projectsRoot, value.slug, "assets", "animations");
      const backup = `${animationDir}-backup`;
      const outside = path.join(process.cwd(), "data", `${prefix}-junction-target`);
      fs.mkdirSync(outside, { recursive: true });
      fs.writeFileSync(path.join(outside, "outside-marker"), "preserve");
      fs.renameSync(animationDir, backup);
      fs.symlinkSync(outside, animationDir, "junction");
      try {
        assert.throws(() => AnimationStorage.inspectStoredMotionPlan(value.slug, asset.filePath as string));
        assert.equal(fs.readFileSync(path.join(outside, "outside-marker"), "utf8"), "preserve");
      } finally {
        fs.unlinkSync(animationDir);
        fs.renameSync(backup, animationDir);
        fs.rmSync(outside, { recursive: true, force: true });
      }
    });

    await scenario("pipeline manifest binds completed animation stage to stored plan", async () => {
      const pipeline = await fixture("manifest");
      const sceneData: SceneData = { scenes: [{ id: 1, title: "One", description: "One", duration: 2 }], createdAt: new Date().toISOString() };
      const visualData: VisualData = { projectId: pipeline.project.id, scenes: [{ sceneId: 1, visualPrompt: "One", animationPrompt: "Slow zoom", style: "cinematic" }], thumbnail: { title: "T", prompt: "P", composition: "C", mood: "M" }, createdAt: new Date().toISOString() };
      await ProjectManager.saveScenes(pipeline.slug, sceneData);
      await ProjectManager.saveVisuals(pipeline.slug, visualData);
      await PipelineJobManager.listJobs(pipeline.slug);
      const state = { ...PipelineStageExecutor.createInitialState(pipeline.project), scenes: sceneData, visuals: visualData };
      const original = AnimationPromptGenerator.generateAnimationData;
      AnimationPromptGenerator.generateAnimationData = async () => ({ projectId: pipeline.project.id, scenes: pipeline.scenes, createdAt: new Date().toISOString() });
      try {
        const runner = PipelineRunner as unknown as { runStage(slug: string, stage: "animation", action: () => Promise<boolean>, runType: "initial"): Promise<boolean> };
        assert.equal(await runner.runStage(pipeline.slug, "animation", () => PipelineStageExecutor.execute(pipeline.slug, "animation", state, { animationProvider: productionProvider() }), "initial"), true);
        assert.equal((await ProjectManager.getManifest(pipeline.slug))?.packages.animation.status, "completed");
        const stored = await ProjectManager.getAnimation(pipeline.slug) as AnimationData;
        assert.equal(stored.scenes[0].sourceImageAssetId, pipeline.imageId);
      } finally {
        AnimationPromptGenerator.generateAnimationData = original;
      }
    });

    await scenario("failed production batch leaves manifest failed and no active artifact", async () => {
      const failed = await fixture("manifest-failure");
      const sceneData: SceneData = { scenes: [{ id: 1, title: "One", description: "One", duration: 2 }], createdAt: new Date().toISOString() };
      const visualData: VisualData = { projectId: failed.project.id, scenes: [{ sceneId: 1, visualPrompt: "One", animationPrompt: "Slow zoom", style: "cinematic" }], thumbnail: { title: "T", prompt: "P", composition: "C", mood: "M" }, createdAt: new Date().toISOString() };
      await ProjectManager.saveScenes(failed.slug, sceneData);
      await ProjectManager.saveVisuals(failed.slug, visualData);
      await PipelineJobManager.listJobs(failed.slug);
      const state = { ...PipelineStageExecutor.createInitialState(failed.project), scenes: sceneData, visuals: visualData };
      const original = AnimationPromptGenerator.generateAnimationData;
      AnimationPromptGenerator.generateAnimationData = async () => ({ projectId: failed.project.id, scenes: failed.scenes, createdAt: new Date().toISOString() });
      const base = productionProvider();
      const invalid: AnimationProvider = {
        ...base,
        async generateAnimation(request) {
          const result = await base.generateAnimation(request);
          return result.success ? { ...result, motionType: "spin" as never } : result;
        },
      };
      try {
        const runner = PipelineRunner as unknown as { runStage(slug: string, stage: "animation", action: () => Promise<boolean>, runType: "initial"): Promise<boolean> };
        await assert.rejects(() => runner.runStage(failed.slug, "animation", () => PipelineStageExecutor.execute(failed.slug, "animation", state, { animationProvider: invalid }), "initial"));
        assert.equal((await ProjectManager.getManifest(failed.slug))?.packages.animation.status, "failed");
        assert.equal(AssetManager.getProjectAssets(failed.slug, failed.project.id).assets.some((item) => item.type === "animation"), false);
        assert.equal(await ProjectManager.getAnimation(failed.slug), null);
      } finally {
        AnimationPromptGenerator.generateAnimationData = original;
      }
    });

    await scenario("acceptance fingerprint covers animation config without raw key material", () => {
      const first = animationEnvironment({ ANIMATION_OPENAI_TIMEOUT_MS: "30000", ANIMATION_OPENAI_RETRY_COUNT: "1" });
      const changed = { ...first, ANIMATION_OPENAI_MODEL: "gpt-4.1" };
      assert.notEqual(productionAcceptanceConfigurationFingerprint(first), productionAcceptanceConfigurationFingerprint(changed));
      assert.notEqual(
        productionAcceptanceConfigurationFingerprint(first),
        productionAcceptanceConfigurationFingerprint({ ...first, ANIMATION_OPENAI_TIMEOUT_MS: "31000" }),
      );
      assert.notEqual(
        productionAcceptanceConfigurationFingerprint(first),
        productionAcceptanceConfigurationFingerprint({ ...first, ANIMATION_OPENAI_RETRY_COUNT: "2" }),
      );
      assert.notEqual(
        productionAcceptanceConfigurationFingerprint(first),
        productionAcceptanceConfigurationFingerprint({ ...first, OPENAI_API_KEY: "different-secret" }),
      );
    });

    await scenario("acceptance readiness gate blocks mock before pipeline execution", async () => {
      const originalRun = PipelineRunner.run;
      const originalProvider = process.env.ANIMATION_PROVIDER;
      let calls = 0;
      PipelineRunner.run = async (...args: Parameters<typeof PipelineRunner.run>) => { calls += 1; return originalRun(...args); };
      process.env.ANIMATION_PROVIDER = "mock";
      try {
        await assert.rejects(() => ProductionAcceptanceOrchestrator.run({ topic: "Animation readiness acceptance" }), (error) => error instanceof ProductionAcceptanceBlockedError);
        assert.equal(calls, 0);
      } finally {
        PipelineRunner.run = originalRun;
        if (originalProvider === undefined) delete process.env.ANIMATION_PROVIDER; else process.env.ANIMATION_PROVIDER = originalProvider;
      }
    });

    await scenario("normal mock-first animation behavior remains locator-free", async () => {
      const mockInput = input();
      const result = await new MockAnimationProvider().generateAnimation(mockInput);
      assert.equal(result.success, true);
      assert.equal(result.generationMode, "mock");
      assert.equal((result as { filePath?: unknown }).filePath, undefined);
    });

    console.log(`Sprint 127 production animation provider smoke: PASS (${scenarios} scenarios)`);
  } finally {
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = originalKey;
    for (const directory of fs.readdirSync(projectsRoot, { withFileTypes: true })) {
      if (directory.isDirectory() && directory.name.startsWith(prefix)) {
        fs.rmSync(path.join(projectsRoot, directory.name), { recursive: true, force: true });
      }
    }
  }
}

function sceneVideoProvider(): VideoProvider {
  return {
    name: "ffmpeg",
    async generateVideo(request) {
      const scenes = request.scenes.map((item) => {
        const output = VideoStorage.createSceneRenderPaths(request.projectSlug, item.sceneId);
        fs.writeFileSync(output.temporaryAbsolutePath, mp4());
        VideoStorage.finalize(output.temporaryAbsolutePath, output.absolutePath);
        const bytes = fs.statSync(output.absolutePath).size;
        return {
          sceneId: item.sceneId,
          sourceImageAssetId: item.sourceImageAssetId,
          animationAssetId: item.animationAssetId,
          provider: "ffmpeg",
          model: "ffmpeg-zoompan-v1",
          generationMode: "production" as const,
          filePath: output.filePath,
          url: output.url,
          mimeType: "video/mp4" as const,
          byteLength: bytes,
          durationSeconds: item.motionPlan.durationSeconds,
          width: 1920,
          height: 1080,
          frameRate: 30,
          transition: item.motionPlan.transition,
          status: "generated" as const,
          createdAt: new Date().toISOString(),
        };
      });
      return { success: true, provider: "ffmpeg", generationMode: "production", scenes };
    },
  };
}

async function verifyAssembly(
  value: Awaited<ReturnType<typeof createProductionAnimation>>,
  video: Awaited<ReturnType<typeof VideoPipeline.generateVideo>>["video"],
) {
  const section = AudioStorage.saveAudio({ projectSlug: value.slug, assetId: "audio-1", data: wav() });
  const mix = AudioStorage.saveAudio({ projectSlug: value.slug, assetId: "audio-mix", data: wav() });
  for (const [id, saved, sceneId] of [["audio-1", section, 1], ["audio-mix", mix, undefined]] as const) {
    AssetManager.addAsset(value.slug, value.project.id, AssetManager.createAsset({
      id,
      projectId: value.project.id,
      projectSlug: value.slug,
      sceneId,
      type: "audio",
      status: "generated",
      provider: "openai",
      model: "tts-1",
      prompt: "audio",
      filePath: saved.filePath,
      url: saved.url,
      mimeType: "audio/wav",
      byteLength: saved.byteLength,
      durationSeconds: saved.durationSeconds,
    }));
  }
  const scenes: SceneData = { scenes: [{ id: 1, title: "One", description: "One", duration: 2 }], createdAt: new Date().toISOString() };
  const visuals: VisualData = { projectId: value.project.id, scenes: [{ sceneId: 1, visualPrompt: "One", animationPrompt: "Slow zoom", style: "cinematic" }], thumbnail: { title: "T", prompt: "P", composition: "C", mood: "M" }, createdAt: new Date().toISOString() };
  const audio: AudioData = {
    outputAssetId: "audio-mix", status: "generated", provider: "openai",
    narrator: { style: "documentary", tone: "calm", language: "tr" },
    sections: [{ chapterId: 1, title: "One", duration: "00:01", emotion: "calm", emphasis: [], narrationNotes: "", pacing: "medium", sourceText: "One", outputAssetId: "audio-1", status: "generated", provider: "openai" }],
    music: { mood: "none", suggestion: "none", intensity: "none" },
    production: { targetFormat: "wav", sampleRate: 8000, estimatedTotalDuration: "00:01", generationStatus: "generated" },
    createdAt: new Date().toISOString(),
  };
  const videoScene = video.scenes[0];
  const assembly: AssemblyPlanData = {
    projectId: value.project.id, slug: value.slug, status: "assembled",
    scenes: [{ sceneId: 1, duration: "00:01", visualReference: "visual-1", audioAssetId: "audio-1", audioReference: "section-1", animationAssetId: videoScene.animationAssetId, videoAssetId: videoScene.videoAssetId, transition: "fade", cameraMovement: "zoom-in", effects: [] }],
    totalDuration: "00:01", style: "documentary", render: { status: "planned", format: "mp4" }, createdAt: new Date().toISOString(),
  };
  const result = await VideoAssemblyManager.renderExistingAssets({
    projectId: value.project.id, projectSlug: value.slug, scenes, visuals, audio,
    assembly, animation: value.animation, video, provider: assemblyProvider(),
  });
  assert.equal(result.render?.status, "rendered");
}

function assemblyProvider(): VideoAssemblyProvider {
  return {
    name: "ffmpeg",
    async assemble(input) {
      assert.equal(input.scenes[0].inputType, "scene-video");
      const output = VideoStorage.createRenderPaths(input.projectSlug);
      fs.writeFileSync(output.temporaryAbsolutePath, mp4());
      VideoStorage.finalize(output.temporaryAbsolutePath, output.absolutePath);
      return {
        success: true, provider: "ffmpeg", model: "ffmpeg-h264-aac", status: "rendered",
        filePath: output.filePath, url: output.url, mimeType: "video/mp4",
        byteLength: fs.statSync(output.absolutePath).size, durationSeconds: 1,
        width: 1920, height: 1080, videoCodec: "h264", audioCodec: "aac",
        createdAt: new Date().toISOString(),
      };
    },
  };
}

function mp4() {
  const box = (type: string, payload = Buffer.alloc(0)) => {
    const header = Buffer.alloc(8);
    header.writeUInt32BE(8 + payload.length, 0);
    header.write(type, 4, 4, "ascii");
    return Buffer.concat([header, payload]);
  };
  return Buffer.concat([box("ftyp", Buffer.from("isom0000")), box("moov"), box("mdat", Buffer.from([1]))]);
}

function wav() {
  const dataLength = 16000;
  const buffer = Buffer.alloc(44 + dataLength);
  buffer.write("RIFF", 0); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write("WAVE", 8);
  buffer.write("fmt ", 12); buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22); buffer.writeUInt32LE(8000, 24); buffer.writeUInt32LE(16000, 28);
  buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34); buffer.write("data", 36);
  buffer.writeUInt32LE(dataLength, 40);
  return buffer;
}

void main();
