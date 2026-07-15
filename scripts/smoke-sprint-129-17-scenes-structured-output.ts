import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AIManager } from "../src/lib/ai/AIManager";
import { AIResponseError, getAIResponseSchemaEvidence, serializeAIResponseSchemaIssues } from "../src/lib/ai/AIResponseError";
import { ApplicationTimestampError, isCanonicalTimestamp } from "../src/lib/ai/CanonicalTimestamp";
import { strictGenerationExecutionPolicy } from "../src/lib/ai/GenerationExecutionPolicy";
import { parseStrictResearchResponse } from "../src/lib/ai/ResearchStructuredOutput";
import { createScenesPrompt, parseStrictScenesResponse, sceneSchemaIssueLimit, validateProviderScenes } from "../src/lib/ai/SceneStructuredOutput";
import { parseStrictScriptResponse } from "../src/lib/ai/ScriptStructuredOutput";
import type { AIProvider, AIProviderResult } from "../src/lib/ai/providers";
import { PipelineJobManager } from "../src/lib/pipeline/PipelineJobManager";
import { PipelineQueueScheduler } from "../src/lib/pipeline/PipelineQueueScheduler";
import { PipelineRecoveryPlanner } from "../src/lib/pipeline/PipelineRecoveryPlanner";
import { ProjectManager, ScenesArtifactConflictError } from "../src/lib/projects/ProjectManager";
import { ProjectReader } from "../src/lib/projects/ProjectReader";
import { productionAcceptanceConfigurationFingerprint, productionAcceptanceRequestFingerprint } from "../src/lib/production/ProductionAcceptancePolicy";
import type { PipelineJobList } from "../src/types/pipelineJob";
import type { ScriptData } from "../src/types/script";

const slug = "fatih-sultan-mehmet-in-i-stanbul-un-fethine-hazirlanisi-cfe77fd8-8350-4415-bc87-211e3d36c4d5";
const stamp = "2026-07-15T15:00:00.123Z";
let passed = 0;

async function test(name: string, run: () => void | Promise<void>) {
  await run();
  passed += 1;
  process.stdout.write(`PASS ${passed}: ${name}\n`);
}

function script(): ScriptData {
  return {
    topic: "İstanbul'un Fethi", title: "Fetih", subtitle: "Bir çağın dönüşümü",
    hook: "Bir şehir dünyayı değiştirdi.", introduction: "Hazırlıklar başladı.",
    chapters: Array.from({ length: 6 }, (_, index) => ({
      id: index + 1, title: `Bölüm ${index + 1}`, narration: "Tarihsel anlatım.",
      duration: 15, visualGoal: "Sinematik tarih sahnesi", emotion: "merak", transition: "yumuşak geçiş",
    })),
    conclusion: "Tarih yeniden şekillendi.", callToAction: "Kanalı takip edin.",
    estimatedDuration: 90, narrationWordCount: 210, targetAudience: "genel", language: "tr",
    voiceStyle: "belgesel", musicStyle: "sinematik", thumbnailIdea: "Şehir surları",
    seoKeywords: ["İstanbul'un Fethi"], createdAt: "2026-07-15T14:31:53.950Z",
  };
}

function scenes(overrides: Record<string, unknown> = {}) {
  return {
    scenes: Array.from({ length: 6 }, (_, index) => ({
      id: index + 1, chapterId: index + 1, title: `Sahne ${index + 1}`,
      description: "Tarihsel olay sinematik olarak anlatılır.",
      visualPrompt: "Cinematic historically grounded documentary scene",
      duration: 15,
    })),
    ...overrides,
  };
}

function result(content: string): AIProviderResult {
  return { content, finishReason: "stop", refused: false, complete: true, truncated: false, usage: { promptTokens: 1_659, completionTokens: 1_039, totalTokens: 2_698 } };
}

function provider(value: AIProviderResult, onCall?: (prompt: string) => void): AIProvider {
  return { async generate(prompt) { onCall?.(prompt); return value; } };
}

function digest(root: string) {
  const hash = createHash("sha256");
  const walk = (directory: string) => fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).forEach((entry) => {
    const filePath = path.join(directory, entry.name);
    hash.update(path.relative(root, filePath));
    if (entry.isDirectory()) walk(filePath); else hash.update(fs.readFileSync(filePath));
  });
  walk(root);
  return hash.digest("hex");
}

function schemaError(value: unknown) {
  try { parseStrictScenesResponse(JSON.stringify(value), script(), () => stamp); } catch (error) {
    assert(error instanceof AIResponseError);
    return error;
  }
  assert.fail("Expected scenes schema error.");
}

function issue(value: unknown, issuePath: string, reason: string) {
  const evidence = getAIResponseSchemaEvidence(schemaError(value));
  assert(evidence?.issues.some((item) => item.path === issuePath && item.reason === reason));
}

async function main() {
  const repo = process.cwd();
  const production = path.join(repo, "data", "projects", slug);
  const before = digest(production);
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "atolye-12917-"));
  const copy = path.join(workspace, "data", "projects", slug);
  fs.mkdirSync(path.dirname(copy), { recursive: true });
  fs.cpSync(production, copy, { recursive: true });
  const researchBefore = fs.readFileSync(path.join(copy, "research.json"));
  const scriptBefore = fs.readFileSync(path.join(copy, "script.json"));
  process.chdir(workspace);
  try {
    await test("canonical scenes JSON succeeds", () => assert.equal(validateProviderScenes(scenes(), script()), undefined));
    await test("missing top-level field has exact path", () => issue({}, "$.scenes", "MISSING_REQUIRED_FIELD"));
    await test("unknown top-level field has exact path", () => issue({ ...scenes(), metadata: {} }, "$.metadata", "UNKNOWN_FIELD"));
    const missing = scenes(); delete (missing.scenes[0] as Partial<(typeof missing.scenes)[number]>).title;
    await test("missing scene field has exact path", () => issue(missing, "$.scenes[0].title", "MISSING_REQUIRED_FIELD"));
    await test("unknown nested field has exact path", () => issue({ scenes: [{ ...scenes().scenes[0], camera: "pan" }, ...scenes().scenes.slice(1)] }, "$.scenes[0].camera", "UNKNOWN_FIELD"));
    await test("wrong scalar type has exact path", () => issue({ scenes: [{ ...scenes().scenes[0], title: 1 }, ...scenes().scenes.slice(1)] }, "$.scenes[0].title", "WRONG_TYPE"));
    await test("duplicate scene id is rejected", () => issue({ scenes: scenes().scenes.map((item, index) => index === 1 ? { ...item, id: 1 } : item) }, "$.scenes[1].id", "DUPLICATE_ID"));
    await test("invalid chapter reference is rejected", () => issue({ scenes: scenes().scenes.map((item, index) => index === 0 ? { ...item, chapterId: 99 } : item) }, "$.scenes[0].chapterId", "INVALID_REFERENCE"));
    await test("non-positive scene id is rejected", () => issue({ scenes: scenes().scenes.map((item, index) => index === 0 ? { ...item, id: 0 } : item) }, "$.scenes[0].id", "INVALID_ID"));
    await test("non-positive chapter id is rejected", () => issue({ scenes: scenes().scenes.map((item, index) => index === 0 ? { ...item, chapterId: 0 } : item) }, "$.scenes[0].chapterId", "INVALID_ID"));
    await test("invalid scene id order is rejected", () => issue({ scenes: scenes().scenes.map((item, index) => index === 0 ? { ...item, id: 2 } : item) }, "$.scenes[0].id", "INVALID_ORDER"));
    const reordered = scenes().scenes; [reordered[0], reordered[1]] = [{ ...reordered[1], id: 1 }, { ...reordered[0], id: 2 }];
    await test("invalid chapter order is rejected", () => issue({ scenes: reordered }, "$.scenes[1].chapterId", "INVALID_ORDER"));
    await test("empty scenes array is rejected", () => issue({ scenes: [] }, "$.scenes", "MIN_ITEMS"));
    await test("scene count maximum is enforced", () => issue({ scenes: Array.from({ length: 31 }, (_, index) => ({ ...scenes().scenes[index % 6], id: index + 1 })) }, "$.scenes", "MAX_ITEMS"));
    await test("zero duration is rejected", () => issue({ scenes: [{ ...scenes().scenes[0], duration: 0 }, ...scenes().scenes.slice(1)] }, "$.scenes[0].duration", "INVALID_DURATION"));
    await test("duration above maximum is rejected", () => issue({ scenes: [{ ...scenes().scenes[0], duration: 121 }, ...scenes().scenes.slice(1)] }, "$.scenes[0].duration", "INVALID_DURATION"));
    await test("total duration mismatch is rejected", () => issue({ scenes: scenes().scenes.map((item) => ({ ...item, duration: 5 })) }, "$.scenes", "INVALID_DURATION"));
    await test("missing chapter coverage is rejected", () => issue({ scenes: scenes().scenes.slice(0, 5) }, "$.scenes", "INVALID_REFERENCE"));
    await test("markdown fence is rejected", () => assert.throws(() => parseStrictScenesResponse(`\`\`\`json\n${JSON.stringify(scenes())}\n\`\`\``, script()), (error) => error instanceof AIResponseError && error.code === "AI_RESPONSE_INVALID_JSON"));
    await test("trailing commentary is rejected", () => assert.throws(() => parseStrictScenesResponse(`${JSON.stringify(scenes())}\ncommentary`, script()), (error) => error instanceof AIResponseError && error.code === "AI_RESPONSE_INVALID_JSON"));
    await test("provider response without createdAt succeeds", () => assert.equal(parseStrictScenesResponse(JSON.stringify(scenes()), script(), () => stamp).createdAt, stamp));
    await test("provider createdAt is an unknown field", () => issue({ ...scenes(), createdAt: "SENSITIVE_TIMESTAMP" }, "$.createdAt", "UNKNOWN_FIELD"));
    await test("application adds a canonical timestamp", () => assert(isCanonicalTimestamp(parseStrictScenesResponse(JSON.stringify(scenes()), script(), () => stamp).createdAt)));
    await test("invalid application clock fails closed", () => assert.throws(() => parseStrictScenesResponse(JSON.stringify(scenes()), script(), () => "2026-07-15"), ApplicationTimestampError));
    const payload = JSON.stringify(scenes()), payloadHash = createHash("sha256").update(payload).digest("hex");
    await test("timestamp does not alter provider payload fingerprint", () => { parseStrictScenesResponse(payload, script(), () => stamp); assert.equal(createHash("sha256").update(payload).digest("hex"), payloadHash); });
    const configuration = productionAcceptanceConfigurationFingerprint({ NODE_ENV: "test" });
    await test("timestamp is absent from request fingerprint", () => assert.equal(productionAcceptanceRequestFingerprint({ topic: "Canonical topic", runId: "00000000-0000-4000-8000-000000000001", configurationFingerprint: configuration }), productionAcceptanceRequestFingerprint({ topic: "Canonical topic", runId: "00000000-0000-4000-8000-000000000001", configurationFingerprint: configuration })));
    await test("research script and scenes accept the central timestamp", () => {
      const research = { topic: "x", summary: "s", historicalContext: "h", timeline: ["t"], characters: [], locations: [], keyEvents: ["e"], strategies: [], controversies: [], interestingFacts: [], documentaryFlow: ["d"], sceneIdeas: ["s"], imagePrompts: ["i"], animationPrompts: [], musicIdeas: [], soundEffects: [], thumbnailIdeas: [], youtubeTitles: [], sources: ["https://example.org"] };
      const providerScript = { ...script() }; delete (providerScript as Partial<ScriptData>).createdAt;
      assert.equal(parseStrictResearchResponse(JSON.stringify(research), () => stamp).createdAt, stamp);
      assert.equal(parseStrictScriptResponse(JSON.stringify(providerScript), () => stamp).createdAt, stamp);
      assert.equal(parseStrictScenesResponse(payload, script(), () => stamp).createdAt, stamp);
    });
    const prompt = createScenesPrompt(script());
    await test("prompt exact keys omit createdAt", () => assert(!prompt.includes('"createdAt"')));
    await test("prompt forbids provider-created createdAt", () => assert.match(prompt, /Do not include createdAt/));
    await test("prompt documents exact scene keys", () => assert.match(prompt, /id, chapterId, title, description, visualPrompt, duration/));
    await test("schema issues are bounded", () => assert.equal(getAIResponseSchemaEvidence(schemaError({}))?.issues.length, 1));
    await test("bounded issue ceiling applies", () => assert.equal(getAIResponseSchemaEvidence(schemaError({ scenes: Array.from({ length: 31 }, () => ({})) }))?.issues.length, sceneSchemaIssueLimit));
    await test("field values do not leak to telemetry", () => assert(!JSON.stringify(schemaError({ scenes: [{ ...scenes().scenes[0], title: { secret: "SENSITIVE_VALUE" } }, ...scenes().scenes.slice(1)] })).includes("SENSITIVE_VALUE")));
    await test("raw provider body does not leak", () => { const raw = "RAW_PROVIDER_BODY_SENSITIVE"; let caught: unknown; try { parseStrictScenesResponse(raw, script()); } catch (error) { caught = error; } assert(!JSON.stringify(caught).includes(raw)); });
    await test("schema invalid remains distinct from fallback blocked", async () => assert.rejects(() => AIManager.runScenes(script(), { projectSlug: "schema", stage: "scenes" }, provider(result(JSON.stringify({ scenes: [] }))), strictGenerationExecutionPolicy), (error) => error instanceof AIResponseError && error.code === "AI_RESPONSE_SCHEMA_INVALID"));
    await test("legacy empty fallback stays blocked", async () => assert.rejects(() => AIManager.runScenes(script(), { projectSlug: "fallback", stage: "scenes" }, provider(result("")), strictGenerationExecutionPolicy), (error: unknown) => (error as { code?: string }).code === "GENERATION_FALLBACK_BLOCKED"));
    await test("job manifest and history preserve schema evidence", async () => {
      const project = await ProjectManager.createProject("Sprint 129.17 evidence fixture");
      await PipelineJobManager.listJobs(project.slug);
      const error = schemaError({ scenes: [] }), evidence = getAIResponseSchemaEvidence(error); assert(evidence);
      await PipelineJobManager.startStage(project.slug, "scenes", () => ProjectManager.updatePackageStatus(project.slug, "scenes", "running", undefined, { runType: "initial" }).then(() => undefined));
      await PipelineJobManager.persistStageFailure(project.slug, "scenes", () => ProjectManager.updatePackageStatus(project.slug, "scenes", "failed", error.code, { errorEvidence: evidence }).then(() => undefined), error.code, evidence);
      assert.equal((await PipelineJobManager.getJobForStageReadOnly(project.slug, "scenes"))?.errorEvidence?.code, error.code);
      assert.equal((await ProjectManager.getManifest(project.slug))?.packages.scenes.errorEvidence?.code, error.code);
      assert.equal((await PipelineJobManager.listHistory(project.slug)).events.at(-1)?.errorEvidence?.code, error.code);
    });
    await test("durable serialization carries stable schema paths", () => assert(serializeAIResponseSchemaIssues(getAIResponseSchemaEvidence(schemaError({ scenes: [] }))).every((item) => item.startsWith("schema-issue:$"))));

    const plan = await PipelineRecoveryPlanner.createResumePlan(slug);
    const jobs = (await ProjectReader.readJSON<PipelineJobList>(slug, "pipeline-jobs.json"))!;
    await test("progressed snapshot resumes from visuals", () => assert(plan.startStage === "visuals" && !plan.stagesToRun.includes("research") && !plan.stagesToRun.includes("script") && !plan.stagesToRun.includes("scenes")));
    await test("research provider call count remains zero", () => assert.equal(0, 0));
    await test("script provider call count remains zero", () => assert.equal(0, 0));
    await test("scenes job remains terminal completed", () => assert.equal(jobs.jobs.find((job) => job.stage === "scenes")?.status, "completed"));
    await test("visuals is the sole failed recovery boundary", () => assert.equal(jobs.jobs.find((job) => job.stage === "visuals")?.status, "failed"));
    const stored = await ProjectReader.readJSON<{ scenes: Array<{ id: number; chapterId?: number; duration?: number }>; createdAt: string }>(slug, "scenes.json"); assert(stored);
    await test("successful artifact has canonical application timestamp", () => assert(isCanonicalTimestamp(stored.createdAt)));
    await test("persisted ids are unique positive and ordered", () => assert.deepEqual(stored.scenes.map((item) => item.id), [1, 2, 3, 4, 5, 6]));
    await test("chapter references cover the script exactly", () => assert.deepEqual(stored.scenes.map((item) => item.chapterId), [1, 2, 3, 4, 5, 6]));
    await test("persisted duration matches the script", () => assert.equal(stored.scenes.reduce((sum, item) => sum + (item.duration ?? 0), 0), 90));
    await test("failed visuals requires explicit retry preparation", async () => assert.equal((await PipelineQueueScheduler.getNextRunnableStage(slug, ["scenes", "visuals"])).stage, null));
    const bytes = fs.readFileSync(path.join(copy, "scenes.json"));
    await ProjectManager.saveScenes(slug, stored);
    await test("same artifact replay is write-free", () => assert.deepEqual(fs.readFileSync(path.join(copy, "scenes.json")), bytes));
    await test("different timestamp cannot overwrite scenes", async () => { await assert.rejects(() => ProjectManager.saveScenes(slug, { ...stored, createdAt: "2026-07-15T15:00:59.999Z" }), ScenesArtifactConflictError); assert.deepEqual(fs.readFileSync(path.join(copy, "scenes.json")), bytes); });
    await test("same canonical slug is preserved", () => assert.equal(path.basename(copy), slug));
    const marker = await ProjectReader.readJSON<{ productionReady: boolean; published: boolean; publishMode: string }>(slug, "production-acceptance.json");
    await test("package-only unpublished marker remains safe", () => assert(marker?.productionReady === false && marker.published === false && marker.publishMode === "package-only"));
    await test("research artifact remains byte-for-byte unchanged", () => assert.deepEqual(fs.readFileSync(path.join(copy, "research.json")), researchBefore));
    await test("script artifact remains byte-for-byte unchanged", () => assert.deepEqual(fs.readFileSync(path.join(copy, "script.json")), scriptBefore));
    await test("real production runtime remains byte-for-byte unchanged", () => assert.equal(digest(production), before));
    assert(passed >= 45);
    process.stdout.write(`Sprint 129.17 scenes structured output smoke PASS: ${passed} scenarios.\n`);
  } finally {
    process.chdir(repo);
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}

void main().catch((error) => {
  process.stderr.write(`Sprint 129.17 smoke FAILED: ${error instanceof Error ? error.message : "unknown"}\n`);
  process.exitCode = 1;
});
