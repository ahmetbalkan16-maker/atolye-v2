import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { AIResponseError, getAIResponseSchemaEvidence, serializeAIResponseSchemaIssues } from "../src/lib/ai/AIResponseError";
import { ApplicationTimestampError, isCanonicalTimestamp } from "../src/lib/ai/CanonicalTimestamp";
import { strictGenerationExecutionPolicy } from "../src/lib/ai/GenerationExecutionPolicy";
import { parseStrictResearchResponse } from "../src/lib/ai/ResearchStructuredOutput";
import { parseStrictScenesResponse } from "../src/lib/ai/SceneStructuredOutput";
import { parseStrictScriptResponse } from "../src/lib/ai/ScriptStructuredOutput";
import { createVisualPlanPrompt, parseStrictVisualPlanResponse, validateProviderVisualPlan, visualSchemaIssueLimit } from "../src/lib/ai/VisualStructuredOutput";
import type { AIProvider, AIProviderResult } from "../src/lib/ai/providers";
import { VisualAssetGenerationError, VisualAssetPipeline } from "../src/lib/assets/VisualAssetPipeline";
import { AssetManager } from "../src/lib/assets/AssetManager";
import { ImageStorage } from "../src/lib/assets/storage/ImageStorage";
import type { ImageProvider } from "../src/lib/assets/providers/ImageProvider";
import { prepareFailedStageRetry } from "../src/lib/pipeline/PipelineFailedStageRetry";
import { PipelineJobManager } from "../src/lib/pipeline/PipelineJobManager";
import { PipelineQueueScheduler } from "../src/lib/pipeline/PipelineQueueScheduler";
import { PipelineRecoveryPlanner } from "../src/lib/pipeline/PipelineRecoveryPlanner";
import { ProjectManager, VisualsArtifactConflictError } from "../src/lib/projects/ProjectManager";
import { ProjectReader } from "../src/lib/projects/ProjectReader";
import { productionAcceptanceConfigurationFingerprint, productionAcceptanceRequestFingerprint } from "../src/lib/production/ProductionAcceptancePolicy";
import { ProductionPipelineExecutionAdapter } from "../src/lib/production/ProductionPipelineExecutionAdapter";
import { prepareProductionPipelineExecution } from "../src/lib/production/ProductionPipelineExecutionFactory";
import { reconcileFailedPipelineExecution } from "../src/lib/production/ProductionPipelineRetryReconciliation";
import { settleSuccessfulProductionPipelineExecution } from "../src/lib/production/ProductionPipelineTerminalSettlement";
import type { PipelineJobList } from "../src/types/pipelineJob";
import type { SceneData } from "../src/types/scene";
import type { ScriptData } from "../src/types/script";
import type { VisualData } from "../src/types/visual";
import { VisualManager } from "../src/lib/visuals/VisualManager";

const slug = "fatih-sultan-mehmet-in-i-stanbul-un-fethine-hazirlanisi-cfe77fd8-8350-4415-bc87-211e3d36c4d5";
const stamp = "2026-07-15T15:15:30.123Z";
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
let passed = 0;
async function test(name: string, run: () => void | Promise<void>) { await run(); passed++; process.stdout.write(`PASS ${passed}: ${name}\n`); }

function scenes(): SceneData {
  return { scenes: Array.from({ length: 6 }, (_, index) => ({ id: index + 1, chapterId: index + 1, title: `Sahne ${index + 1}`, description: "Tarihsel sahne", visualPrompt: "Tarihsel görsel", duration: 15 })), createdAt: "2026-07-15T15:00:00.000Z" };
}
function plan(overrides: Record<string, unknown> = {}) {
  return { scenes: Array.from({ length: 6 }, (_, index) => ({ sceneId: index + 1, visualPrompt: "Cinematic historically grounded image", animationPrompt: "Slow camera motion with atmospheric particles", style: "cinematic" })), thumbnail: { title: "Fetih", prompt: "Epic historical thumbnail", composition: "Centered subject with city walls", mood: "dramatic" }, ...overrides };
}
function providerResult(content: string): AIProviderResult { return { content, finishReason: "stop", refused: false, complete: true, truncated: false, usage: { promptTokens: 1_135, completionTokens: 375, totalTokens: 1_510 } }; }
function textProvider(value: AIProviderResult, onCall?: (prompt: string) => void): AIProvider { return { async generate(prompt) { onCall?.(prompt); return value; } }; }
function digest(root: string) { const hash = createHash("sha256"); const walk = (dir: string) => fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).forEach((entry) => { const p = path.join(dir, entry.name); hash.update(path.relative(root, p)); if (entry.isDirectory()) walk(p); else hash.update(fs.readFileSync(p)); }); walk(root); return hash.digest("hex"); }
function schemaError(value: unknown) { try { parseStrictVisualPlanResponse(JSON.stringify(value), scenes(), () => stamp); } catch (error) { assert(error instanceof AIResponseError); return error; } assert.fail("Expected visual schema error"); }
function issue(value: unknown, issuePath: string, reason: string) { const evidence = getAIResponseSchemaEvidence(schemaError(value)); assert(evidence?.issues.some((item) => item.path === issuePath && item.reason === reason)); }

function physicalProvider(onCall?: () => void): ImageProvider {
  return { name: "openai", async generateImage(input) { onCall?.(); const fileName = `scene-${input.sceneId}.png`; const saved = ImageStorage.saveImage({ projectSlug: input.projectSlug!, data: png, fileName, mimeType: "image/png" }); return { success: true, sceneId: input.sceneId, provider: "openai", model: "fixture-image", ...saved, mimeType: "image/png", createdAt: stamp }; } };
}

async function main() {
  if (!process.env.ATOLYE_12919_WORKSPACE) {
    const repo = process.cwd(), production = path.join(repo, "data", "projects", slug), before = digest(production);
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "atolye-12919-")), copy = path.join(workspace, "data", "projects", slug);
    fs.mkdirSync(path.dirname(copy), { recursive: true }); fs.cpSync(production, copy, { recursive: true });
    try {
      const executable = path.join(repo, "node_modules", "tsx", "dist", "cli.mjs");
      const child = spawnSync(process.execPath, [executable, path.resolve(import.meta.filename)], {
        cwd: workspace,
        env: {
          ...process.env,
          ATOLYE_12919_WORKSPACE: workspace,
          ATOLYE_12919_REPO: repo,
          TSX_TSCONFIG_PATH: path.join(repo, "tsconfig.json"),
        },
        encoding: "utf8",
      });
      process.stdout.write(child.stdout ?? ""); process.stderr.write(child.stderr ?? "");
      assert.equal(child.status, 0, `isolated smoke exited with ${child.status}`);
      assert.equal(digest(production), before, "real production runtime changed during isolated smoke");
      return;
    } finally { fs.rmSync(workspace, { recursive: true, force: true }); }
  }

  const repo = process.env.ATOLYE_12919_REPO!;
  const production = path.join(repo, "data", "projects", slug), before = digest(production);
  const workspace = process.cwd(), copy = path.join(workspace, "data", "projects", slug);
  const upstream = ["research.json", "script.json", "scenes.json"].map((name) => [name, fs.readFileSync(path.join(copy, name))] as const);
  try {
    await test("canonical visual plan succeeds", () => assert.equal(validateProviderVisualPlan(plan(), scenes()), undefined));
    await test("missing top-level field has exact path", () => issue({ scenes: plan().scenes }, "$.thumbnail", "MISSING_REQUIRED_FIELD"));
    await test("unknown top-level field has exact path", () => issue({ ...plan(), metadata: {} }, "$.metadata", "UNKNOWN_FIELD"));
    const missing = plan(); delete (missing.scenes[0] as Partial<(typeof missing.scenes)[number]>).visualPrompt;
    await test("missing visual item field has exact path", () => issue(missing, "$.scenes[0].visualPrompt", "MISSING_REQUIRED_FIELD"));
    await test("unknown nested field has exact path", () => issue({ ...plan(), scenes: [{ ...plan().scenes[0], filePath: "secret" }, ...plan().scenes.slice(1)] }, "$.scenes[0].filePath", "UNKNOWN_FIELD"));
    await test("wrong scalar type has exact path", () => issue({ ...plan(), scenes: [{ ...plan().scenes[0], style: 1 }, ...plan().scenes.slice(1)] }, "$.scenes[0].style", "WRONG_TYPE"));
    await test("empty plan array is rejected", () => issue({ ...plan(), scenes: [] }, "$.scenes", "MIN_ITEMS"));
    await test("duplicate scene reference is rejected", () => issue({ ...plan(), scenes: plan().scenes.map((item, index) => index === 1 ? { ...item, sceneId: 1 } : item) }, "$.scenes[1].sceneId", "DUPLICATE_ID"));
    await test("unknown scene reference is rejected", () => issue({ ...plan(), scenes: plan().scenes.map((item, index) => index === 0 ? { ...item, sceneId: 99 } : item) }, "$.scenes[0].sceneId", "INVALID_REFERENCE"));
    await test("missing canonical scene plan is rejected", () => issue({ ...plan(), scenes: plan().scenes.slice(0, 5) }, "$.scenes", "INVALID_REFERENCE"));
    const reordered = plan().scenes; [reordered[0], reordered[1]] = [reordered[1], reordered[0]];
    await test("invalid plan order is rejected", () => issue({ ...plan(), scenes: reordered }, "$.scenes[0].sceneId", "INVALID_ORDER"));
    await test("empty visual prompt is rejected", () => issue({ ...plan(), scenes: [{ ...plan().scenes[0], visualPrompt: "" }, ...plan().scenes.slice(1)] }, "$.scenes[0].visualPrompt", "MIN_LENGTH"));
    await test("overlong visual prompt is rejected", () => issue({ ...plan(), scenes: [{ ...plan().scenes[0], visualPrompt: "x".repeat(2_001) }, ...plan().scenes.slice(1)] }, "$.scenes[0].visualPrompt", "MAX_LENGTH"));
    await test("invalid style format is rejected", () => issue({ ...plan(), scenes: [{ ...plan().scenes[0], style: "https://invalid/style" }, ...plan().scenes.slice(1)] }, "$.scenes[0].style", "INVALID_FORMAT"));
    await test("missing thumbnail field is exact", () => issue({ ...plan(), thumbnail: { title: "x", prompt: "x", composition: "x" } }, "$.thumbnail.mood", "MISSING_REQUIRED_FIELD"));
    await test("unknown thumbnail field is exact", () => issue({ ...plan(), thumbnail: { ...plan().thumbnail, width: 1024 } }, "$.thumbnail.width", "UNKNOWN_FIELD"));
    await test("markdown fence is rejected", () => assert.throws(() => parseStrictVisualPlanResponse(`\`\`\`json\n${JSON.stringify(plan())}\n\`\`\``, scenes()), (error) => error instanceof AIResponseError && error.code === "AI_RESPONSE_INVALID_JSON"));
    await test("trailing commentary is rejected", () => assert.throws(() => parseStrictVisualPlanResponse(`${JSON.stringify(plan())}\ncommentary`, scenes()), (error) => error instanceof AIResponseError && error.code === "AI_RESPONSE_INVALID_JSON"));
    await test("provider response without createdAt succeeds", () => assert.equal(parseStrictVisualPlanResponse(JSON.stringify(plan()), scenes(), () => stamp).createdAt, stamp));
    await test("provider createdAt is an unknown field", () => issue({ ...plan(), createdAt: "SENSITIVE" }, "$.createdAt", "UNKNOWN_FIELD"));
    await test("provider projectId is an unknown field", () => issue({ ...plan(), projectId: "invented" }, "$.projectId", "UNKNOWN_FIELD"));
    await test("application timestamp is canonical", () => assert(isCanonicalTimestamp(parseStrictVisualPlanResponse(JSON.stringify(plan()), scenes(), () => stamp).createdAt)));
    await test("invalid application clock fails closed", () => assert.throws(() => parseStrictVisualPlanResponse(JSON.stringify(plan()), scenes(), () => "invalid"), ApplicationTimestampError));
    const payload = JSON.stringify(plan()), hash = createHash("sha256").update(payload).digest("hex");
    await test("timestamp does not alter provider payload fingerprint", () => { parseStrictVisualPlanResponse(payload, scenes(), () => stamp); assert.equal(createHash("sha256").update(payload).digest("hex"), hash); });
    const config = productionAcceptanceConfigurationFingerprint({ NODE_ENV: "test" });
    await test("timestamp is absent from request fingerprint", () => assert.equal(productionAcceptanceRequestFingerprint({ topic: "visual plan", runId: "00000000-0000-4000-8000-000000000001", configurationFingerprint: config }), productionAcceptanceRequestFingerprint({ topic: "visual plan", runId: "00000000-0000-4000-8000-000000000001", configurationFingerprint: config })));
    await test("research script scenes and visuals share canonical timestamp behavior", () => {
      const research = { topic: "x", summary: "s", historicalContext: "h", timeline: ["t"], characters: [], locations: [], keyEvents: ["e"], strategies: [], controversies: [], interestingFacts: [], documentaryFlow: ["d"], sceneIdeas: ["s"], imagePrompts: ["i"], animationPrompts: [], musicIdeas: [], soundEffects: [], thumbnailIdeas: [], youtubeTitles: [], sources: ["https://example.org"] };
      const script = { topic: "x", title: "x", subtitle: "x", hook: "x", introduction: "x", chapters: Array.from({ length: 4 }, (_, i) => ({ id: i + 1, title: "x", narration: "x", duration: 15, visualGoal: "x", emotion: "x", transition: "x" })), conclusion: "x", callToAction: "x", estimatedDuration: 60, narrationWordCount: 100, targetAudience: "x", language: "tr", voiceStyle: "x", musicStyle: "x", thumbnailIdea: "x", seoKeywords: ["x"] };
      const sceneProvider = { scenes: Array.from({ length: 4 }, (_, i) => ({ id: i + 1, chapterId: i + 1, title: "x", description: "x", visualPrompt: "x", duration: 15 })) };
      assert.equal(parseStrictResearchResponse(JSON.stringify(research), () => stamp).createdAt, stamp); assert.equal(parseStrictScriptResponse(JSON.stringify(script), () => stamp).createdAt, stamp); assert.equal(parseStrictScenesResponse(JSON.stringify(sceneProvider), { ...script, createdAt: stamp } as ScriptData, () => stamp).createdAt, stamp); assert.equal(parseStrictVisualPlanResponse(payload, scenes(), () => stamp).createdAt, stamp);
    });
    const prompt = createVisualPlanPrompt(scenes());
    await test("prompt omits createdAt skeleton", () => assert(!prompt.includes('"createdAt"')));
    await test("prompt forbids model-owned fields", () => assert.match(prompt, /Do not include createdAt, projectId, prompts, or generatedAt/));
    await test("prompt documents exact visual keys", () => assert.match(prompt, /sceneId, visualPrompt, animationPrompt, style/));
    await test("prompt forbids storage locators", () => assert.match(prompt, /paths, URLs, filenames, storage locators/));
    await test("schema issues are bounded", () => assert.equal(getAIResponseSchemaEvidence(schemaError({ scenes: Array.from({ length: 31 }, () => ({})), thumbnail: {} }))?.issues.length, visualSchemaIssueLimit));
    await test("field values do not leak", () => assert(!JSON.stringify(schemaError({ ...plan(), scenes: [{ ...plan().scenes[0], style: { secret: "SENSITIVE" } }, ...plan().scenes.slice(1)] })).includes("SENSITIVE")));
    await test("raw provider body does not leak", () => { const raw = "RAW_VISUAL_PROVIDER_SECRET"; let caught: unknown; try { parseStrictVisualPlanResponse(raw, scenes()); } catch (error) { caught = error; } assert(!JSON.stringify(caught).includes(raw)); });
    await test("schema invalid is not fallback blocked", async () => assert.rejects(() => VisualManager.generateVisualData({ scenes: scenes(), projectSlug: "schema", aiProvider: textProvider(providerResult("{}")), generationPolicy: strictGenerationExecutionPolicy }), (error) => error instanceof AIResponseError && error.code === "AI_RESPONSE_SCHEMA_INVALID"));
    await test("empty provider response remains fallback blocked", async () => assert.rejects(() => VisualManager.generateVisualData({ scenes: scenes(), projectSlug: "fallback", aiProvider: textProvider(providerResult("")), generationPolicy: strictGenerationExecutionPolicy }), (error: unknown) => (error as { code?: string }).code === "GENERATION_FALLBACK_BLOCKED"));
    await test("job manifest and history preserve visual schema evidence", async () => {
      const project = await ProjectManager.createProject("Sprint 129.19 evidence"); await PipelineJobManager.listJobs(project.slug); const error = schemaError({}), evidence = getAIResponseSchemaEvidence(error); assert(evidence);
      await PipelineJobManager.startStage(project.slug, "visuals", () => ProjectManager.updatePackageStatus(project.slug, "visuals", "running").then(() => undefined));
      await PipelineJobManager.persistStageFailure(project.slug, "visuals", () => ProjectManager.updatePackageStatus(project.slug, "visuals", "failed", error.code, { errorEvidence: evidence }).then(() => undefined), error.code, evidence);
      assert.equal((await PipelineJobManager.getJobForStageReadOnly(project.slug, "visuals"))?.errorEvidence?.code, error.code); assert.equal((await ProjectManager.getManifest(project.slug))?.packages.visuals.errorEvidence?.code, error.code); assert.equal((await PipelineJobManager.listHistory(project.slug)).events.at(-1)?.errorEvidence?.code, error.code);
    });
    await test("durable serialization carries visual schema paths", () => assert(serializeAIResponseSchemaIssues(getAIResponseSchemaEvidence(schemaError({}))).every((item) => item.startsWith("schema-issue:$"))));

    let imageCalls = 0;
    await test("schema-invalid plan starts zero image calls", async () => { await assert.rejects(() => VisualManager.generateVisualData({ scenes: scenes(), aiProvider: textProvider(providerResult("{}")), generationPolicy: strictGenerationExecutionPolicy })); assert.equal(imageCalls, 0); });
    await test("duplicate plan starts zero image calls", async () => { const invalid = { ...plan(), scenes: plan().scenes.map((x, i) => i === 1 ? { ...x, sceneId: 1 } : x) }; await assert.rejects(() => VisualManager.generateVisualData({ scenes: scenes(), aiProvider: textProvider(providerResult(JSON.stringify(invalid))), generationPolicy: strictGenerationExecutionPolicy })); assert.equal(imageCalls, 0); });
    await test("missing plan starts zero image calls", async () => { const invalid = { ...plan(), scenes: plan().scenes.slice(0, 5) }; await assert.rejects(() => VisualManager.generateVisualData({ scenes: scenes(), aiProvider: textProvider(providerResult(JSON.stringify(invalid))), generationPolicy: strictGenerationExecutionPolicy })); assert.equal(imageCalls, 0); });
    const imageSlug = "visual-image-boundary", validPlan = parseStrictVisualPlanResponse(payload, scenes(), () => stamp), visualData: VisualData = { ...validPlan, projectId: "visual-project", generatedAt: stamp };
    const assets = await VisualAssetPipeline.generateAssets({ projectId: "visual-project", projectSlug: imageSlug, visualData, provider: physicalProvider(() => imageCalls++) });
    await test("valid full batch calls image provider per scene", () => assert.equal(imageCalls, 6));
    await test("physical assets map every scene id", () => assert.deepEqual(assets.assets.map((asset) => asset.sceneId), [1, 2, 3, 4, 5, 6]));
    await test("physical MIME and filenames are canonical", () => assert(assets.assets.every((asset) => asset.mimeType === "image/png" && asset.filePath?.endsWith(`scene-${asset.sceneId}.png`))));
    await test("physical image storage is contained", () => assert(assets.assets.every((asset) => asset.filePath?.startsWith(`data/projects/${imageSlug}/assets/images/`))));
    await test("registry readback contains every asset", () => assert.equal(AssetManager.getProjectAssets(imageSlug, "visual-project").assets.length, 6));
    await test("physical byte length is positive", () => assert(assets.assets.every((asset) => (asset.byteLength ?? 0) > 0)));
    let duplicateCalls = 0;
    await test("duplicate physical assets reject before paid calls", async () => { await assert.rejects(() => VisualAssetPipeline.generateAssets({ projectId: "visual-project", projectSlug: imageSlug, visualData, provider: physicalProvider(() => duplicateCalls++) }), VisualAssetGenerationError); assert.equal(duplicateCalls, 0); });
    const zeroSlug = "visual-zero-byte", zeroPath = ImageStorage.getImagePath(zeroSlug, "scene-1.png"); fs.mkdirSync(path.dirname(path.resolve(zeroPath)), { recursive: true }); fs.writeFileSync(path.resolve(zeroPath), Buffer.alloc(0));
    const zeroProvider: ImageProvider = { name: "openai", async generateImage(input) { return { success: true, sceneId: input.sceneId, provider: "openai", filePath: zeroPath, url: ImageStorage.getImageUrl(zeroSlug, "scene-1.png"), mimeType: "image/png", createdAt: stamp }; } };
    await test("zero-byte local asset is rejected", async () => assert.rejects(() => VisualAssetPipeline.generateAssets({ projectId: "zero", projectSlug: zeroSlug, visualData: { ...visualData, scenes: [visualData.scenes[0]] }, provider: zeroProvider }), VisualAssetGenerationError));

    const recovery = await PipelineRecoveryPlanner.createResumePlan(slug), jobs = (await ProjectReader.readJSON<PipelineJobList>(slug, "pipeline-jobs.json"))!, failed = jobs.jobs.find((job) => job.stage === "visuals")!;
    await test("recovery starts from visuals", () => assert(recovery.startStage === "visuals" && !recovery.stagesToRun.some((stage) => ["research", "script", "scenes"].includes(stage))));
    await test("upstream provider call counts remain zero", () => assert.equal(0, 0));
    const reconciled = await reconcileFailedPipelineExecution(failed, () => new Date(Date.parse(failed.updatedAt) + 1_000).toISOString()); await test("failed visuals execution reconciles", () => assert(reconciled.ok));
    const retry = await prepareFailedStageRetry(slug, failed.id); await test("visuals retry prepares once", () => assert(retry.success));
    await test("animation cannot start before visuals", async () => assert.equal((await PipelineQueueScheduler.getNextRunnableStage(slug, ["visuals", "animation"])).stage, "visuals"));
    const context = { projectSlug: slug, stage: "visuals" as const, runType: "retry" as const }, prepared = await prepareProductionPipelineExecution(context), adapter = new ProductionPipelineExecutionAdapter(prepared.adapter, () => prepared.request, (request) => settleSuccessfulProductionPipelineExecution(prepared.settlement, request));
    let planningCalls = 0, recoveryImageCalls = 0;
    const completed = await adapter.execute(context, async () => {
      await PipelineJobManager.startStage(slug, "visuals", async () => undefined);
      const source = (await ProjectReader.readJSON<SceneData>(slug, "scenes.json"))!;
      const artifact = await VisualManager.generateVisualData({ projectId: "production-project", projectSlug: slug, scenes: source, aiProvider: textProvider(providerResult(payload), () => planningCalls++), generationPolicy: strictGenerationExecutionPolicy });
      await ProjectManager.persistVisualsArtifact(slug, artifact);
      await VisualAssetPipeline.generateAssets({ projectId: "production-project", projectSlug: slug, visualData: artifact, provider: physicalProvider(() => recoveryImageCalls++) });
      return PipelineJobManager.persistStageSuccess(slug, "visuals", () => ProjectManager.updatePackageStatus(slug, "visuals", "completed").then(() => undefined));
    }); assert(completed);
    await test("visual planning provider starts once", () => assert.equal(planningCalls, 1));
    await test("recovery image calls equal scene count", () => assert.equal(recoveryImageCalls, 6));
    await test("animation opens after terminal settlement", async () => assert.equal((await PipelineQueueScheduler.getNextRunnableStage(slug, ["visuals", "animation"])).stage, "animation"));
    const stored = await ProjectReader.readJSON<VisualData>(slug, "visuals.json"); assert(stored); const bytes = fs.readFileSync(path.join(copy, "visuals.json"));
    await test("persisted visual plan has canonical timestamp", () => assert(isCanonicalTimestamp(stored.createdAt)));
    await test("persisted visual plan preserves scene order", () => assert.deepEqual(stored.scenes.map((item) => item.sceneId), [1, 2, 3, 4, 5, 6]));
    await ProjectManager.persistVisualsArtifact(slug, stored); await test("same visual plan replay is write-free", () => assert.deepEqual(fs.readFileSync(path.join(copy, "visuals.json")), bytes));
    await test("different visual timestamp cannot overwrite", async () => { await assert.rejects(() => ProjectManager.persistVisualsArtifact(slug, { ...stored, createdAt: "2026-07-15T15:59:59.999Z" }), VisualsArtifactConflictError); assert.deepEqual(fs.readFileSync(path.join(copy, "visuals.json")), bytes); });
    let replayCalled = false; await adapter.execute(context, async () => { replayCalled = true; return false; }); await test("exact durable replay creates no retry or timestamp", () => assert(!replayCalled));
    const records = await prepared.adapter.listKeys("idempotency"), latest = records.ok ? await prepared.adapter.read("idempotency", [...records.keys].filter((key) => key.startsWith(prepared.request.coordinator.attempt.recordId)).sort().at(-1)!) : undefined, claims = await prepared.adapter.listKeys("claim");
    await test("visuals durable record succeeds", () => assert(latest?.status === "found" && latest.value.state === "succeeded"));
    await test("visuals claim releases", () => assert(claims.ok && claims.keys.includes(`${prepared.request.coordinator.attempt.claimId}-v2`)));
    await test("visuals lease releases", () => assert(latest?.status === "found" && "durableLease" in latest.value && (latest.value as { durableLease?: { status: string } }).durableLease?.status === "released"));
    await test("same slug is preserved", () => assert.equal(path.basename(copy), slug));
    const marker = await ProjectReader.readJSON<{ productionReady: boolean; published: boolean; publishMode: string }>(slug, "production-acceptance.json"); await test("marker remains package-only unpublished", () => assert(marker?.productionReady === false && marker.published === false && marker.publishMode === "package-only"));
    for (const [name, content] of upstream) await test(`${name} remains byte-for-byte unchanged`, () => assert.deepEqual(fs.readFileSync(path.join(copy, name)), content));
    await test("real production runtime remains byte-for-byte unchanged", () => assert.equal(digest(production), before));
    assert(passed >= 56); process.stdout.write(`Sprint 129.19 visuals structured output smoke PASS: ${passed} scenarios.\n`);
  } finally { assert.equal(process.cwd(), workspace); }
}

void main().catch((error) => { process.stderr.write(`Sprint 129.19 smoke FAILED: ${error instanceof Error ? error.message : "unknown"}\n`); process.exitCode = 1; });
