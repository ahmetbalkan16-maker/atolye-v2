import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AIManager } from "../src/lib/ai/AIManager";
import { AIResponseError } from "../src/lib/ai/AIResponseError";
import {
  getResearchMaxTokens,
  researchTokenBudget,
} from "../src/lib/ai/ResearchAIConfig";
import {
  createResearchPrompt,
  isCanonicalResearchTimestamp,
  parseStrictResearchResponse,
} from "../src/lib/ai/ResearchStructuredOutput";
import { strictGenerationExecutionPolicy } from "../src/lib/ai/GenerationExecutionPolicy";
import { runObservedAIRequest } from "../src/lib/ai/runObservedAIRequest";
import type { AIProvider, AIProviderResult } from "../src/lib/ai/providers";
import { AIUsageManager } from "../src/lib/ai/AIUsageManager";
import { PipelineRecoveryPlanner } from "../src/lib/pipeline/PipelineRecoveryPlanner";
import { PipelineJobManager } from "../src/lib/pipeline/PipelineJobManager";
import {
  createProductionAcceptanceMarker,
  productionAcceptanceConfigurationFingerprint,
} from "../src/lib/production/ProductionAcceptancePolicy";
import { createProductionAcceptanceProjectSlug } from "../src/lib/production/ProductionAcceptanceTopic";
import { ProjectManager } from "../src/lib/projects/ProjectManager";

const productionSlug = "fatih-sultan-mehmet-in-i-stanbul-un-fethine-hazirlanisi-cfe77fd8-8350-4415-bc87-211e3d36c4d5";
const topic = "Fatih Sultan Mehmet’in İstanbul’un fethine hazırlanışı";
const timestamp = "2026-07-15T12:00:00.000Z";
let passed = 0;

async function test(name: string, action: () => void | Promise<void>) {
  await action();
  passed += 1;
  process.stdout.write(`PASS ${passed}: ${name}\n`);
}

function providerResearch(overrides: Record<string, unknown> = {}) {
  return {
    topic,
    summary: "Özet",
    historicalContext: "Bağlam",
    timeline: ["1453: Canonical event"], characters: [], locations: [], keyEvents: ["Canonical event"], strategies: [],
    controversies: [], interestingFacts: [], documentaryFlow: ["Opening"], sceneIdeas: ["Canonical scene"],
    imagePrompts: ["Canonical image"], animationPrompts: [], musicIdeas: [], soundEffects: [],
    thumbnailIdeas: [], youtubeTitles: [], sources: ["https://example.org/source"],
    ...overrides,
  };
}

function providerResult(
  content: string,
  overrides: Partial<AIProviderResult> = {},
): AIProviderResult {
  return {
    content,
    finishReason: "stop",
    refused: false,
    complete: true,
    truncated: false,
    ...overrides,
  };
}

function provider(result: AIProviderResult | string | Error, observe?: (maxTokens?: number) => void): AIProvider {
  return {
    async generate(_prompt, options) {
      observe?.(options?.maxTokens);
      if (result instanceof Error) throw result;
      return result;
    },
  };
}

async function expectCode(action: () => Promise<unknown>, code: string) {
  await assert.rejects(action, (error) => {
    assert(error instanceof AIResponseError);
    assert.equal(error.code, code);
    assert.equal(error.message, code);
    return true;
  });
}

async function main() {
  const originalCwd = process.cwd();
  const plan = await PipelineRecoveryPlanner.createResumePlan(productionSlug);
  const existingJobs = await PipelineJobManager.listJobsReadOnly(productionSlug);
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "atolye-sprint-129-7-"));
  fs.mkdirSync(path.join(workspace, "data", "projects", "smoke"), { recursive: true });
  process.chdir(workspace);
  try {
    await test("research prompt documents trusted canonical timestamp", () => {
      const prompt = createResearchPrompt(topic);
      assert.match(prompt, /UTC RFC 3339 \/ ISO 8601/);
      assert.match(prompt, /2026-07-15T12:00:00\.000Z/);
      assert.match(prompt, /Do not include createdAt/);
    });
    await test("canonical timestamp is accepted", () => assert.equal(isCanonicalResearchTimestamp(timestamp), true));
    await test("date-only timestamp is rejected", () => assert.equal(isCanonicalResearchTimestamp("2026-07-15"), false));
    await test("timezone-less timestamp is rejected", () => assert.equal(isCanonicalResearchTimestamp("2026-07-15T12:00:00.000"), false));
    await test("invalid date is rejected", () => assert.equal(isCanonicalResearchTimestamp("2026-02-30T12:00:00.000Z"), false));
    await test("trusted application timestamp is injected", () => {
      const parsed = parseStrictResearchResponse(JSON.stringify(providerResearch()), () => timestamp);
      assert.equal(parsed.createdAt, timestamp);
    });

    await test("stop finish reason with valid JSON succeeds", async () => {
      const result = await AIManager.runResearch(topic, { projectSlug: "smoke", operation: "research", stage: "research" }, provider(providerResult(JSON.stringify(providerResearch()))), strictGenerationExecutionPolicy);
      assert.equal(result.topic, topic);
    });
    await test("length finish reason is a truncation error", () => expectCode(
      () => AIManager.runResearch(topic, { projectSlug: "smoke", operation: "truncated", stage: "research" }, provider(providerResult("{", { finishReason: "length", complete: false, truncated: true })), strictGenerationExecutionPolicy),
      "AI_RESPONSE_TRUNCATED",
    ));
    await test("provider refusal has a distinct error", () => expectCode(
      () => AIManager.runResearch(topic, { projectSlug: "smoke", operation: "refusal", stage: "research" }, provider(providerResult("", { refused: true, complete: false })), strictGenerationExecutionPolicy),
      "AI_PROVIDER_REFUSAL",
    ));
    await test("provider usage metrics are normalized", async () => {
      const observed = await runObservedAIRequest({ prompt: "usage", context: { projectSlug: "smoke", operation: "usage", stage: "research" }, provider: provider(providerResult("{}", { usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 } })) });
      assert.deepEqual(observed.usage, { promptTokens: 10, completionTokens: 20, totalTokens: 30 });
    });
    await test("missing usage metrics remain optional", async () => {
      const observed = await runObservedAIRequest({ prompt: "no usage", context: { projectSlug: "smoke", operation: "no-usage", stage: "research" }, provider: provider(providerResult("{}")) });
      assert.equal(observed.usage, undefined);
    });
    await test("raw provider error body is not persisted or returned", async () => {
      const observed = await runObservedAIRequest({ prompt: "safe", context: { projectSlug: "smoke", operation: "safe-error", stage: "research" }, provider: provider(new Error("RAW_SECRET_PROVIDER_BODY")) });
      assert.equal(observed.errorCode, "AI_PROVIDER_REQUEST_FAILED");
      assert.equal(JSON.stringify(observed).includes("RAW_SECRET_PROVIDER_BODY"), false);
      const usage = await AIUsageManager.getUsageLog("smoke");
      assert.equal(JSON.stringify(usage).includes("RAW_SECRET_PROVIDER_BODY"), false);
    });

    await test("malformed JSON has a parse error", () => expectCode(
      () => AIManager.runResearch(topic, { projectSlug: "smoke", operation: "parse", stage: "research" }, provider(providerResult("{invalid")), strictGenerationExecutionPolicy),
      "AI_RESPONSE_INVALID_JSON",
    ));
    await test("model-provided invalid createdAt is a schema error", () => expectCode(
      () => AIManager.runResearch(topic, { projectSlug: "smoke", operation: "created-at", stage: "research" }, provider(providerResult(JSON.stringify(providerResearch({ createdAt: "2026-07-15" })))), strictGenerationExecutionPolicy),
      "AI_RESPONSE_SCHEMA_INVALID",
    ));
    await test("missing required field is a schema error", () => {
      const value = providerResearch(); delete (value as Partial<typeof value>).summary;
      return expectCode(() => AIManager.runResearch(topic, { projectSlug: "smoke", operation: "missing", stage: "research" }, provider(providerResult(JSON.stringify(value))), strictGenerationExecutionPolicy), "AI_RESPONSE_SCHEMA_INVALID");
    });
    await test("additional provider field is forbidden", () => expectCode(
      () => AIManager.runResearch(topic, { projectSlug: "smoke", operation: "extra", stage: "research" }, provider(providerResult(JSON.stringify(providerResearch({ unexpected: true })))), strictGenerationExecutionPolicy),
      "AI_RESPONSE_SCHEMA_INVALID",
    ));
    await test("strict fallback remains blocked", async () => {
      await assert.rejects(() => AIManager.runResearch(topic, { projectSlug: "smoke", operation: "fallback", stage: "research" }, provider(""), strictGenerationExecutionPolicy), (error: unknown) => (error as { code?: string }).code === "GENERATION_FALLBACK_BLOCKED");
    });
    await test("provider success with invalid artifact is not stage success", () => expectCode(
      () => AIManager.runResearch(topic, { projectSlug: "smoke", operation: "invalid-artifact", stage: "research" }, provider(providerResult("{}")), strictGenerationExecutionPolicy),
      "AI_RESPONSE_SCHEMA_INVALID",
    ));

    await test("research uses stage-specific default token budget", async () => {
      let observed: number | undefined;
      await AIManager.runResearch(topic, { projectSlug: "smoke", operation: "budget", stage: "research" }, provider(providerResult(JSON.stringify(providerResearch())), (value) => { observed = value; }), strictGenerationExecutionPolicy);
      assert.equal(observed, researchTokenBudget.defaultTokens);
    });
    await test("research budget below minimum is rejected", () => assert.throws(() => getResearchMaxTokens({ ...process.env, OPENAI_RESEARCH_MAX_TOKENS: String(researchTokenBudget.minimumTokens - 1) }), /invalid/i));
    await test("research budget above maximum is rejected", () => assert.throws(() => getResearchMaxTokens({ ...process.env, OPENAI_RESEARCH_MAX_TOKENS: String(researchTokenBudget.maximumTokens + 1) }), /invalid/i));
    await test("invalid research budget is fail-closed", () => assert.throws(() => getResearchMaxTokens({ ...process.env, OPENAI_RESEARCH_MAX_TOKENS: "not-a-number" }), /invalid/i));
    await test("research budget does not alter other observed AI calls", async () => {
      let observed: number | undefined = 1;
      await runObservedAIRequest({ prompt: "script", context: { projectSlug: "smoke", operation: "script", stage: "script" }, provider: provider("{}", (value) => { observed = value; }) });
      assert.equal(observed, undefined);
    });
    await test("research budget participates in acceptance configuration fingerprint", () => {
      const left = productionAcceptanceConfigurationFingerprint({ ...process.env, OPENAI_RESEARCH_MAX_TOKENS: "3200" });
      const right = productionAcceptanceConfigurationFingerprint({ ...process.env, OPENAI_RESEARCH_MAX_TOKENS: "3201" });
      assert.notEqual(left, right);
    });

    await test("completed production upstream stages are not rerun", () => {
      assert.equal(plan.blocked, false); assert.equal(plan.startStage, "visuals");
      assert.equal(plan.stagesToRun.includes("research"), false);
      assert.equal(plan.stagesToRun.includes("script"), false);
    });
    await test("visuals failure keeps downstream jobs queued", () => {
      assert.equal(existingJobs.jobs.find((job) => job.stage === "visuals")?.status, "failed");
      assert(existingJobs.jobs.filter((job) => !["research", "script", "scenes", "visuals"].includes(job.stage)).every((job) => job.status === "queued"));
    });
    await test("resume plan preserves the existing slug", () => assert.equal(plan.projectSlug, productionSlug));
    await test("second marker creation cannot overwrite an acceptance run", async () => {
      const runId = crypto.randomUUID();
      const slug = createProductionAcceptanceProjectSlug(topic, runId);
      const fingerprint = productionAcceptanceConfigurationFingerprint();
      await createProductionAcceptanceMarker(slug, runId, fingerprint, topic);
      await assert.rejects(() => createProductionAcceptanceMarker(slug, runId, fingerprint, topic));
    });
    await test("a controlled retry increments provider call count", async () => {
      let calls = 0;
      const retryProvider: AIProvider = { async generate() { calls += 1; return calls === 1 ? providerResult("{", { finishReason: "length", complete: false, truncated: true }) : providerResult(JSON.stringify(providerResearch())); } };
      await expectCode(() => AIManager.runResearch(topic, { projectSlug: "smoke", operation: "retry-1", stage: "research" }, retryProvider, strictGenerationExecutionPolicy), "AI_RESPONSE_TRUNCATED");
      await AIManager.runResearch(topic, { projectSlug: "smoke", operation: "retry-2", stage: "research" }, retryProvider, strictGenerationExecutionPolicy);
      assert.equal(calls, 2);
    });
    await test("invalid provider output creates no false research artifact", async () => {
      await expectCode(() => AIManager.runResearch(topic, { projectSlug: "smoke", operation: "no-artifact", stage: "research" }, provider(providerResult("{}")), strictGenerationExecutionPolicy), "AI_RESPONSE_SCHEMA_INVALID");
      assert.equal(await ProjectManager.getResearch("smoke"), null);
    });

    process.stdout.write(`Sprint 129.7 research structured output smoke PASS: ${passed} scenarios.\n`);
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}

void main().catch((error) => {
  process.stderr.write(`Sprint 129.7 research structured output smoke FAILED: ${error instanceof Error ? error.message : "unknown"}\n`);
  process.exitCode = 1;
});
