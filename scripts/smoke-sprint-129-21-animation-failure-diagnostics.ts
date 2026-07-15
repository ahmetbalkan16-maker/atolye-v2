import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { AnimationAssetPipeline, AnimationMotionPlanError } from "../src/lib/animation/AnimationAssetPipeline";
import { getAnimationMotionPlanErrorEvidence } from "../src/lib/animation/AnimationMotionPlanError";
import { OpenAIAnimationProvider } from "../src/lib/animation/providers/OpenAIAnimationProvider";
import { AIUsageManager } from "../src/lib/ai/AIUsageManager";
import type { AnimationGenerationInput, AnimationGenerationResult, AnimationProvider } from "../src/lib/animation/providers/AnimationProvider";
import type { OpenAIAnimationProviderConfig } from "../src/lib/animation/providers/AnimationProviderConfig";
import { PipelineJobManager } from "../src/lib/pipeline/PipelineJobManager";
import { PipelineRecoveryPlanner } from "../src/lib/pipeline/PipelineRecoveryPlanner";
import { ProjectManager } from "../src/lib/projects/ProjectManager";
import { ProjectReader } from "../src/lib/projects/ProjectReader";
import { ProductionPipelineExecutionAdapter } from "../src/lib/production/ProductionPipelineExecutionAdapter";
import { prepareProductionPipelineExecution } from "../src/lib/production/ProductionPipelineExecutionFactory";
import { reconcileFailedPipelineExecution } from "../src/lib/production/ProductionPipelineRetryReconciliation";
import type { AnimationScene } from "../src/types/animation";
import type { AnimationMotionPlanErrorCode } from "../src/types/animationError";
import type { SceneData } from "../src/types/scene";
import type { VisualData } from "../src/types/visual";

const productionSlug = "fatih-sultan-mehmet-in-i-stanbul-un-fethine-hazirlanisi-cfe77fd8-8350-4415-bc87-211e3d36c4d5";
const endpoint = "https://api.openai.com/v1/chat/completions";
let passed = 0;

async function test(name: string, run: () => void | Promise<void>) {
  await run();
  passed += 1;
  process.stdout.write(`PASS ${passed}: ${name}\n`);
}

function config(overrides: Partial<OpenAIAnimationProviderConfig> = {}): OpenAIAnimationProviderConfig {
  return { model: "gpt-4.1-mini", endpoint, timeoutMs: 100, retryCount: 0, maximumResponseBytes: 256 * 1024, ...overrides };
}

function input(sceneId = 1): AnimationGenerationInput {
  return { sceneId, animationPrompt: "Slow cinematic camera movement", sourceImageAssetId: `image-${sceneId}`, durationSeconds: 15 };
}

function frame(scale: number) {
  return { crop: { x: 0, y: 0, width: 1, height: 1 }, transform: { scale, translateX: 0, translateY: 0 } };
}

function plan(value: AnimationGenerationInput) {
  return { sceneId: value.sceneId, sourceImageAssetId: value.sourceImageAssetId, durationSeconds: value.durationSeconds, motionType: "zoom-in", start: frame(1), end: frame(1.2), transition: "fade" };
}

function response(content: string) {
  return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content } }], usage: { prompt_tokens: 20, completion_tokens: 30, total_tokens: 50 } }), { status: 200 });
}

async function expectProviderCode(
  code: AnimationMotionPlanErrorCode,
  fetcher: typeof fetch,
  options: Partial<OpenAIAnimationProviderConfig> = {},
) {
  const result = await new OpenAIAnimationProvider(fetcher, () => config(options)).generateAnimation(input());
  assert.equal(result.success, false);
  if (result.success) assert.fail("Expected provider failure.");
  assert.equal(result.error, code);
  assert.equal(result.diagnostic?.sceneId, 1);
  assert.equal(result.diagnostic?.provider, "openai");
  assert(Number.isSafeInteger(result.diagnostic?.durationMs));
  return result;
}

function hashFile(filePath: string) {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function hashVisualInputs(projectRoot: string) {
  const files = [
    path.join(projectRoot, "visuals.json"),
    ...fs.readdirSync(path.join(projectRoot, "assets", "images")).sort().map((name) => path.join(projectRoot, "assets", "images", name)),
  ];
  return files.map((filePath) => ({ filePath: path.relative(projectRoot, filePath), bytes: fs.statSync(filePath).size, hash: hashFile(filePath) }));
}

function diagnosticProvider(failureScene: number, unknown = false): AnimationProvider {
  return {
    name: "openai",
    getRequestIdentity(value) {
      return { assetId: `animation-${value.sceneId}`, requestIdentity: `request-${value.sceneId}`, promptDigest: `prompt-${value.sceneId}`, model: "gpt-4.1-mini" };
    },
    async generateAnimation(value): Promise<AnimationGenerationResult> {
      if (value.sceneId === failureScene) {
        if (unknown) throw new Error("unsafe raw provider detail");
        return { success: false, sceneId: value.sceneId, sourceImageAssetId: value.sourceImageAssetId, provider: "openai", model: "gpt-4.1-mini", generationMode: "production", error: "ANIMATION_RESPONSE_INVALID_JSON", diagnostic: { sceneId: value.sceneId, phase: "provider-response", provider: "openai", model: "gpt-4.1-mini", reason: "CONTENT_INVALID_JSON", finishReason: "stop", responseLength: 17, promptTokens: 20, completionTokens: 30, totalTokens: 50, durationMs: 4, retryCount: 0 } };
      }
      return { success: true, sceneId: value.sceneId, sourceImageAssetId: value.sourceImageAssetId, provider: "openai", model: "gpt-4.1-mini", generationMode: "production", requestIdentity: `request-${value.sceneId}`, artifactType: "motion-plan", status: "generated", durationSeconds: value.durationSeconds, motionType: "zoom-in", start: frame(1), end: frame(1.2), transition: "fade", diagnostic: { sceneId: value.sceneId, phase: "provider-response", provider: "openai", model: "gpt-4.1-mini", finishReason: "stop", responseLength: 100, durationMs: 3, retryCount: 0 } };
    },
  };
}

async function main() {
  const isolatedWorkspace = process.env.ATOLYE_12921_WORKSPACE;
  if (!isolatedWorkspace) {
    const repository = process.cwd();
    const realProduction = ProjectReader.getProjectFolder(productionSlug);
    const realBefore = hashVisualInputs(realProduction);
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "atolye-12921-"));
    const copiedProduction = path.join(workspace, "data", "projects", productionSlug);
    fs.mkdirSync(path.dirname(copiedProduction), { recursive: true });
    fs.cpSync(realProduction, copiedProduction, { recursive: true });
    try {
      const tsxCli = path.join(repository, "node_modules", "tsx", "dist", "cli.mjs");
      const child = spawnSync(process.execPath, [tsxCli, path.resolve(import.meta.filename)], {
        cwd: workspace,
        encoding: "utf8",
        env: {
          ...process.env,
          ATOLYE_12921_WORKSPACE: workspace,
          OPENAI_API_KEY: "configured-for-smoke",
          TSX_TSCONFIG_PATH: path.join(repository, "tsconfig.json"),
        },
      });
      process.stdout.write(child.stdout);
      process.stderr.write(child.stderr);
      assert.equal(child.status, 0, `Isolated smoke failed with status ${child.status}.`);
      assert.deepEqual(hashVisualInputs(realProduction), realBefore);
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
    return;
  }

  const copiedProduction = ProjectReader.getProjectFolder(productionSlug);
  const previousKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "configured-for-smoke";
  try {
    await test("empty response is classified", async () => { await expectProviderCode("ANIMATION_RESPONSE_EMPTY", async () => response("")); });
    await test("invalid JSON is classified", async () => { await expectProviderCode("ANIMATION_RESPONSE_INVALID_JSON", async () => response("not-json")); });
    await test("schema invalid is classified", async () => { await expectProviderCode("ANIMATION_RESPONSE_SCHEMA_INVALID", async () => response(JSON.stringify({ ...plan(input()), sceneId: 2 }))); });
    await test("HTTP failure is classified", async () => {
      const result = await expectProviderCode("ANIMATION_PROVIDER_HTTP_FAILED", async () => new Response("", { status: 400 }));
      assert.equal(result.diagnostic?.httpStatus, 400);
    });
    await test("timeout is classified", async () => { await expectProviderCode("ANIMATION_PROVIDER_TIMEOUT", (_url, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("hidden", "AbortError")), { once: true })), { timeoutMs: 5 }); });
    await test("retry exhaustion is classified", async () => {
      let calls = 0;
      const result = await expectProviderCode("ANIMATION_PROVIDER_RETRY_EXHAUSTED", async () => { calls += 1; return new Response("", { status: 503 }); }, { retryCount: 1 });
      assert.equal(calls, 2);
      assert.equal(result.diagnostic?.retryCount, 1);
      assert.equal(result.diagnostic?.reason, "ANIMATION_PROVIDER_HTTP_FAILED");
    });
    await test("response byte limit is classified", async () => { await expectProviderCode("ANIMATION_RESPONSE_TOO_LARGE", async () => new Response("x".repeat(2048), { status: 200 }), { maximumResponseBytes: 1024 }); });

    const project = await ProjectReader.readJSON<{ id: string }>(productionSlug, "project.json");
    const visuals = await ProjectReader.readJSON<VisualData>(productionSlug, "visuals.json");
    const scenes = await ProjectReader.readJSON<SceneData>(productionSlug, "scenes.json");
    assert(project && visuals && scenes);
    const animationScenes: AnimationScene[] = visuals.scenes.map((visual) => ({ sceneId: visual.sceneId, animationPrompt: visual.animationPrompt, durationSeconds: scenes.scenes.find((scene) => scene.id === visual.sceneId)?.duration ?? 15, status: "planned" }));
    const visualHashesBefore = hashVisualInputs(copiedProduction);
    const registryBefore = hashFile(path.join(copiedProduction, "assets", "assets.json"));
    let known!: AnimationMotionPlanError;
    try {
      await AnimationAssetPipeline.generateAnimationAssets({ projectId: project.id, projectSlug: productionSlug, scenes: animationScenes, provider: diagnosticProvider(3) });
    } catch (error) {
      assert(error instanceof AnimationMotionPlanError);
      known = error;
    }
    await test("known animation error is preserved exactly", () => {
      assert.equal(known.code, "ANIMATION_RESPONSE_INVALID_JSON", JSON.stringify(known.evidence));
      assert.equal(known.evidence.sceneId, 3);
      assert.equal(known.evidence.phase, "provider-response");
    });
    await test("known error contains no raw payload", () => assert.equal(JSON.stringify(known).includes("unsafe raw"), false));
    await test("failure is atomic before animation persistence", () => {
      assert.equal(fs.existsSync(path.join(copiedProduction, "animation.json")), false);
      assert.equal(hashFile(path.join(copiedProduction, "assets", "assets.json")), registryBefore);
      assert.equal(fs.existsSync(path.join(copiedProduction, "assets", "animations")), false);
    });
    await test("visuals and PNG hashes remain unchanged", () => assert.deepEqual(hashVisualInputs(copiedProduction), visualHashesBefore));
    const usage = await AIUsageManager.getUsageLog(productionSlug);
    const failedUsage = usage.records.findLast((record) => record.operation === "animation-motion-plan-scene-3");
    await test("failed scene telemetry contains only safe diagnostic metadata", () => {
      assert.equal(failedUsage?.status, "failed");
      assert.equal(failedUsage?.errorCode, "ANIMATION_RESPONSE_INVALID_JSON");
      assert.equal(failedUsage?.sceneId, 3);
      assert.equal(failedUsage?.phase, "provider-response");
      assert.equal(failedUsage?.responseLength, 17);
      assert.equal(failedUsage?.totalTokens, 50);
      assert.equal(JSON.stringify(failedUsage).includes("not-json"), false);
    });

    let unknown!: AnimationMotionPlanError;
    try {
      await AnimationAssetPipeline.generateAnimationAssets({ projectId: project.id, projectSlug: productionSlug, scenes: animationScenes, provider: diagnosticProvider(1, true) });
    } catch (error) {
      assert(error instanceof AnimationMotionPlanError);
      unknown = error;
    }
    await test("unknown exception becomes generic with scene and phase", () => {
      assert.equal(unknown.code, "ANIMATION_MOTION_PLAN_FAILED");
      assert.equal(unknown.evidence.sceneId, 1);
      assert.equal(unknown.evidence.phase, "provider-request");
    });

    const evidenceProject = await ProjectManager.createProject("Sprint 129.21 error evidence");
    await PipelineJobManager.listJobs(evidenceProject.slug);
    await PipelineJobManager.startStage(evidenceProject.slug, "animation", () => ProjectManager.updatePackageStatus(evidenceProject.slug, "animation", "running", undefined, { runType: "initial" }).then(() => undefined));
    const evidence = getAnimationMotionPlanErrorEvidence(known);
    assert(evidence);
    await PipelineJobManager.persistStageFailure(evidenceProject.slug, "animation", () => ProjectManager.updatePackageStatus(evidenceProject.slug, "animation", "failed", known.code, { errorEvidence: evidence }).then(() => undefined), known.code, evidence);
    const evidenceJob = await PipelineJobManager.getJobForStageReadOnly(evidenceProject.slug, "animation");
    const evidenceManifest = await ProjectManager.getManifest(evidenceProject.slug);
    const evidenceHistory = await PipelineJobManager.listHistory(evidenceProject.slug);
    await test("scene and phase reach job manifest and history", () => {
      assert(evidenceJob?.errorEvidence && "kind" in evidenceJob.errorEvidence && evidenceJob.errorEvidence.kind === "animation-motion-plan-error");
      const manifestEvidence = evidenceManifest?.packages.animation.errorEvidence;
      assert(manifestEvidence && "kind" in manifestEvidence && manifestEvidence.kind === "animation-motion-plan-error");
      const historyEvidence = evidenceHistory.events.at(-1)?.errorEvidence;
      assert(historyEvidence && "kind" in historyEvidence && historyEvidence.kind === "animation-motion-plan-error");
      assert.equal(evidenceHistory.events.at(-1)?.errorCode, known.code);
    });
    const missingDurableReconciliation = await reconcileFailedPipelineExecution(evidenceJob!);
    await test("failed retry reconciliation remains write-free when durable state is absent", () => {
      assert.equal(missingDurableReconciliation.ok, true);
      assert.equal(missingDurableReconciliation.reasonCode, "PIPELINE_RETRY_RECONCILIATION_REPLAYED");
      assert.equal(missingDurableReconciliation.writeFree, true);
    });

    const durableProject = await ProjectManager.createProject("Sprint 129.21 durable evidence");
    await PipelineJobManager.listJobs(durableProject.slug);
    const durableJob = await PipelineJobManager.getJobForStageReadOnly(durableProject.slug, "animation");
    assert(durableJob);
    const context = { projectSlug: durableProject.slug, stage: "animation" as const, runType: "initial" as const };
    const prepared = await prepareProductionPipelineExecution(context);
    const adapter = new ProductionPipelineExecutionAdapter(prepared.adapter, () => prepared.request);
    let durableFailure: unknown;
    try {
      await adapter.execute(context, async () => { throw known; });
    } catch (error) {
      durableFailure = error;
    }
    assert(durableFailure);
    const attemptKeys = await prepared.adapter.listKeys("attempt");
    const attemptId = prepared.request.coordinator.attempt.attemptId;
    const terminalKey = attemptKeys.ok
      ? attemptKeys.keys.filter((key) => key.startsWith(`${attemptId}-v`)).sort((left, right) => Number(right.split("-v").at(-1)) - Number(left.split("-v").at(-1)))[0]
      : undefined;
    const terminal = terminalKey ? await prepared.adapter.read("attempt", terminalKey) : undefined;
    await test("durable attempt carries code scene and phase", () => {
      assert(terminal?.status === "found", JSON.stringify({ attemptKeys, attemptId, terminalKey, terminal }));
      const journal = terminal.value.journal.at(-1);
      assert.equal(journal?.payload.code, known.code, JSON.stringify(durableFailure));
      assert(journal?.evidence.includes("animation-scene:3"));
      assert(journal?.evidence.includes("animation-phase:provider-result"));
    });
    const failedDurableJob = { ...durableJob, status: "failed" as const, error: known.code };
    const reconciliationAt = new Date(Date.parse(durableJob.updatedAt) + 1_000).toISOString();
    const reconciled = await reconcileFailedPipelineExecution(failedDurableJob, () => reconciliationAt);
    await test("failed durable animation attempt reconciles claim lease and idempotency", () => {
      assert.equal(reconciled.ok, true);
      assert.equal(reconciled.reasonCode, "PIPELINE_RETRY_RECONCILED");
      assert.equal(reconciled.writeFree, false);
    });
    const reconciliationReplay = await reconcileFailedPipelineExecution(failedDurableJob, () => reconciliationAt);
    await test("durable retry reconciliation replay is write-free", () => {
      assert.equal(reconciliationReplay.ok, true);
      assert.equal(reconciliationReplay.reasonCode, "PIPELINE_RETRY_RECONCILIATION_REPLAYED");
      assert.equal(reconciliationReplay.writeFree, true);
    });

    const recovery = await PipelineRecoveryPlanner.createResumePlan(productionSlug);
    await test("recovery remains unblocked at animation", () => {
      assert.equal(recovery.startStage, "animation");
      assert.equal(recovery.blocked, false);
      assert.equal(recovery.stagesToRun.some((stage) => ["research", "script", "scenes", "visuals"].includes(stage)), false);
    });
    assert.equal(passed, 19);
    process.stdout.write(`Sprint 129.21 animation failure diagnostics smoke PASS: ${passed} scenarios.\n`);
  } finally {
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
  }
}

void main().catch((error) => {
  process.stderr.write(`Sprint 129.21 smoke FAILED: ${error instanceof Error ? error.message : "unknown"}\n`);
  process.exitCode = 1;
});
