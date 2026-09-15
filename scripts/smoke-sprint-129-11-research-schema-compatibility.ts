import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AIManager } from "../src/lib/ai/AIManager";
import {
  AIResponseError,
  getAIResponseSchemaEvidence,
  serializeAIResponseSchemaIssues,
} from "../src/lib/ai/AIResponseError";
import { strictGenerationExecutionPolicy } from "../src/lib/ai/GenerationExecutionPolicy";
import {
  createResearchPrompt,
  parseStrictResearchResponse,
  researchSchemaIssueLimit,
} from "../src/lib/ai/ResearchStructuredOutput";
import type { AIProvider, AIProviderResult } from "../src/lib/ai/providers";
import { PipelineJobManager } from "../src/lib/pipeline/PipelineJobManager";
import { PipelineRecoveryPlanner } from "../src/lib/pipeline/PipelineRecoveryPlanner";
import { ProjectReader } from "../src/lib/projects/ProjectReader";
import { ProjectManager } from "../src/lib/projects/ProjectManager";
import type { Project } from "../src/types/project";
import { withCanonicalSmokeRuntime } from "./lib/CanonicalSmokeRuntime";

const productionSlug = `sprint-129-11-research-schema-${process.pid}`;
const topic = "Canonical production research compatibility fixture";
const timestamp = "2026-07-15T14:00:00.000Z";
let passed = 0;

async function test(name: string, action: () => void | Promise<void>) {
  await action();
  passed += 1;
  process.stdout.write(`PASS ${passed}: ${name}\n`);
}

function fixture(overrides: Record<string, unknown> = {}) {
  return {
    topic,
    summary: "Evidence-grounded summary.",
    historicalContext: "Concise historical context.",
    timeline: ["1453: Canonical event."],
    characters: ["Historical figure"],
    locations: ["Historical location"],
    keyEvents: ["Canonical key event"],
    strategies: [],
    controversies: [],
    interestingFacts: [],
    documentaryFlow: ["Opening", "Development", "Conclusion"],
    sceneIdeas: ["Historically grounded scene"],
    imagePrompts: ["Cinematic historically grounded image"],
    animationPrompts: [],
    musicIdeas: [],
    soundEffects: [],
    thumbnailIdeas: [],
    youtubeTitles: [],
    sources: ["https://example.org/source"],
    ...overrides,
  };
}

function providerResult(content: string, overrides: Partial<AIProviderResult> = {}): AIProviderResult {
  return {
    content,
    finishReason: "stop",
    refused: false,
    complete: true,
    truncated: false,
    usage: { promptTokens: 330, completionTokens: 1_623, totalTokens: 1_953 },
    ...overrides,
  };
}

function provider(result: AIProviderResult, onCall?: () => void): AIProvider {
  return { async generate() { onCall?.(); return result; } };
}

function schemaError(value: unknown): AIResponseError {
  try {
    parseStrictResearchResponse(JSON.stringify(value), () => timestamp);
  } catch (error) {
    assert(error instanceof AIResponseError);
    return error;
  }
  assert.fail("Expected schema failure.");
}

function issue(value: unknown, path: string, reason: string) {
  const evidence = getAIResponseSchemaEvidence(schemaError(value));
  assert(evidence);
  assert(evidence.issues.some((item) => item.path === path && item.reason === reason));
}

async function expectCode(action: () => Promise<unknown>, code: string) {
  await assert.rejects(action, (error) => error instanceof AIResponseError && error.code === code);
}

async function runScenarios() {
  const planBefore = await PipelineRecoveryPlanner.createResumePlan(productionSlug);
  const planReplay = await PipelineRecoveryPlanner.createResumePlan(productionSlug);
  const marker = await ProjectReader.readJSON<{ publishMode?: string; published?: boolean }>(productionSlug, "production-acceptance.json");
  const originalCwd = process.cwd();
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "atolye-sprint-129-11-"));
  process.chdir(workspace);
  try {
    await test("canonical research JSON succeeds", () => {
      assert.equal(parseStrictResearchResponse(JSON.stringify(fixture()), () => timestamp).createdAt, timestamp);
    });
    await test("missing top-level field has exact path", () => {
      const value = fixture(); delete (value as Partial<typeof value>).summary;
      issue(value, "$.summary", "MISSING_REQUIRED_FIELD");
    });
    await test("extra top-level field has exact path", () => issue(fixture({ title: "forbidden" }), "$.title", "UNKNOWN_FIELD"));
    await test("nested object missing canonical scalar shape is rejected at item path", () => issue(fixture({ sources: [{}] }), "$.sources[0]", "WRONG_TYPE"));
    await test("wrong scalar type has exact path", () => issue(fixture({ summary: 1 }), "$.summary", "WRONG_TYPE"));
    await test("invalid array item has exact path", () => issue(fixture({ timeline: [1] }), "$.timeline[0]", "WRONG_TYPE"));
    await test("empty required array is rejected", () => issue(fixture({ keyEvents: [] }), "$.keyEvents", "MIN_ITEMS"));
    await test("overlong string is rejected", () => issue(fixture({ summary: "x".repeat(4_001) }), "$.summary", "MAX_LENGTH"));
    await test("invalid source URL is rejected", () => issue(fixture({ sources: ["not-a-url"] }), "$.sources[0]", "INVALID_URL"));
    await test("markdown fenced JSON is rejected", () => assert.throws(() => parseStrictResearchResponse(`\`\`\`json\n${JSON.stringify(fixture())}\n\`\`\``), (error) => error instanceof AIResponseError && error.code === "AI_RESPONSE_INVALID_JSON"));
    await test("trailing commentary is rejected", () => assert.throws(() => parseStrictResearchResponse(`${JSON.stringify(fixture())}\ncommentary`), (error) => error instanceof AIResponseError && error.code === "AI_RESPONSE_INVALID_JSON"));
    await test("unknown nested key is not silently discarded", () => issue(fixture({ sources: [{ url: "https://example.org", label: "extra" }] }), "$.sources[0]", "WRONG_TYPE"));
    await test("issue telemetry contains no field values", () => {
      const secret = "SENSITIVE_FIELD_VALUE";
      const error = schemaError(fixture({ summary: secret, sources: [secret] }));
      assert.equal(JSON.stringify(error).includes(secret), false);
    });
    await test("issue count is bounded", () => {
      assert.equal(getAIResponseSchemaEvidence(schemaError({}))?.issues.length, researchSchemaIssueLimit);
    });
    await test("raw response does not enter error", () => {
      const raw = `RAW_PROVIDER_RESPONSE_${"x".repeat(100)}`;
      let caught: unknown;
      try { parseStrictResearchResponse(raw); } catch (error) { caught = error; }
      assert.equal(JSON.stringify(caught).includes(raw), false);
    });
    await test("application injects createdAt after valid response", () => {
      assert.equal(parseStrictResearchResponse(JSON.stringify(fixture()), () => timestamp).createdAt, timestamp);
    });
    await test("model createdAt is rejected as extra field", () => issue(fixture({ createdAt: timestamp }), "$.createdAt", "UNKNOWN_FIELD"));
    await test("finish stop remains distinct from schema invalid", () => expectCode(
      () => AIManager.runResearch(topic, { projectSlug: "smoke", stage: "research" }, provider(providerResult(JSON.stringify(fixture({ summary: 1 })))), strictGenerationExecutionPolicy),
      "AI_RESPONSE_SCHEMA_INVALID",
    ));
    await test("finish length is handled before schema validation", () => expectCode(
      () => AIManager.runResearch(topic, { projectSlug: "smoke", stage: "research" }, provider(providerResult("{}", { finishReason: "length", complete: false, truncated: true })), strictGenerationExecutionPolicy),
      "AI_RESPONSE_TRUNCATED",
    ));
    await test("refusal is handled before schema validation", () => expectCode(
      () => AIManager.runResearch(topic, { projectSlug: "smoke", stage: "research" }, provider(providerResult("{}", { refused: true, complete: false })), strictGenerationExecutionPolicy),
      "AI_PROVIDER_REFUSAL",
    ));
    await test("provider success plus schema invalid is not stage success", () => expectCode(
      () => AIManager.runResearch(topic, { projectSlug: "smoke", stage: "research" }, provider(providerResult(JSON.stringify(fixture({ sources: [] })))), strictGenerationExecutionPolicy),
      "AI_RESPONSE_SCHEMA_INVALID",
    ));
    await test("job manifest history and durable evidence share the stable schema issue code", async () => {
      await ProjectManager.updatePackageStatus(productionSlug, "research", "pending");
      await PipelineJobManager.listJobs(productionSlug);
      const error = schemaError(fixture({ sources: ["invalid"] }));
      const evidence = getAIResponseSchemaEvidence(error);
      assert(evidence);
      await PipelineJobManager.startStage(productionSlug, "research", () => ProjectManager.updatePackageStatus(productionSlug, "research", "running", undefined, { runType: "initial" }).then(() => undefined));
      await PipelineJobManager.persistStageFailure(productionSlug, "research", () => ProjectManager.updatePackageStatus(productionSlug, "research", "failed", error.code, { errorEvidence: evidence }).then(() => undefined), error.code, evidence);
      const job = await PipelineJobManager.getJobForStageReadOnly(productionSlug, "research");
      const manifest = await ProjectManager.getManifest(productionSlug);
      const history = await PipelineJobManager.listHistory(productionSlug);
      assert.equal(job?.errorEvidence?.code, error.code);
      assert.equal(manifest?.packages.research.errorEvidence?.code, error.code);
      assert.equal(history.events.at(-1)?.errorEvidence?.code, error.code);
      assert(serializeAIResponseSchemaIssues(evidence).every((item) => item.includes("schema-issue:")));
    });
    await test("completed upstream stages are preserved while recovery starts from visuals", async () => {
      assert.equal(planBefore.startStage, "visuals");
      assert.equal(planBefore.stagesToRun.includes("research"), false);
      assert.equal(planBefore.stagesToRun.includes("script"), false);
      let calls = 0;
      await expectCode(() => AIManager.runResearch(topic, { projectSlug: "smoke", stage: "research" }, provider(providerResult(JSON.stringify(fixture({ summary: 1 }))), () => { calls += 1; }), strictGenerationExecutionPolicy), "AI_RESPONSE_SCHEMA_INVALID");
      assert.equal(calls, 1);
    });
    await test("downstream provider call count stays zero in schema-invalid fixture", async () => {
      const downstreamCalls = 0;
      await expectCode(() => AIManager.runResearch(topic, { projectSlug: "smoke", stage: "research" }, provider(providerResult(JSON.stringify(fixture({ keyEvents: [] })))), strictGenerationExecutionPolicy), "AI_RESPONSE_SCHEMA_INVALID");
      assert.equal(downstreamCalls, 0);
    });
    await test("read-only exact replay does not create a second retry plan", () => {
      assert.equal(planReplay.startStage, planBefore.startStage);
      assert.deepEqual(planReplay.stagesToRun, planBefore.stagesToRun);
      assert.deepEqual(planReplay.dependencies, planBefore.dependencies);
      assert.equal(planReplay.blocked, planBefore.blocked);
    });
    await test("package-only and published false remain unchanged", () => {
      assert.equal(marker?.publishMode, "package-only");
      assert.equal(marker?.published, false);
    });
    await test("production-sized complete response fixture remains valid", async () => {
      const large = fixture({ summary: "A".repeat(3_500), historicalContext: "B".repeat(1_000) });
      const response = JSON.stringify(large);
      assert(response.length > 4_500);
      const prompt = createResearchPrompt(topic);
      assert.match(prompt, /exactly these top-level keys/);
      assert.match(prompt, /Additional top-level or nested keys are forbidden/);
      assert.match(prompt, /Do not include createdAt/);
      const result = await AIManager.runResearch(topic, { projectSlug: "smoke", stage: "research" }, provider(providerResult(response)), strictGenerationExecutionPolicy);
      assert.equal(result.summary.length, 3_500);
    });
    process.stdout.write(`Sprint 129.11 research schema compatibility smoke PASS: ${passed} scenarios.\n`);
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}

async function prepareCanonicalFixture(projectFolder: string) {
  const project: Project = {
    id: "sprint-129-11-research-schema-compatibility",
    slug: productionSlug,
    title: topic,
    status: "draft",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  fs.writeFileSync(
    path.join(projectFolder, "project.json"),
    JSON.stringify(project, null, 2),
    "utf8",
  );
  await ProjectManager.createManifest(project);
  for (const stage of ["research", "script", "scenes"] as const) {
    fs.writeFileSync(
      path.join(projectFolder, `${stage}.json`),
      JSON.stringify({ stage }),
      "utf8",
    );
    await ProjectManager.updatePackageStatus(productionSlug, stage, "completed");
  }
  fs.writeFileSync(
    path.join(projectFolder, "production-acceptance.json"),
    JSON.stringify({ publishMode: "package-only", published: false }),
    "utf8",
  );
}

async function main() {
  await withCanonicalSmokeRuntime(
    {
      name: "sprint-129-11-research-schema-compatibility",
      projectSlug: productionSlug,
      configureProductionExecution: false,
    },
    async (runtime) => {
      const projectFolder = path.join(
        runtime.runtimeStorageContext.projectsRoot,
        productionSlug,
      );
      await prepareCanonicalFixture(projectFolder);
      await runScenarios();
    },
  );
}

void main().catch((error) => {
  process.stderr.write(`Sprint 129.11 research schema compatibility smoke FAILED: ${error instanceof Error ? error.message : "unknown"}\n`);
  process.exitCode = 1;
});
