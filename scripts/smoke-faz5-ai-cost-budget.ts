/**
 * Documentary media effort — Faz 5: deterministic AI pricing + the $1 per-video
 * cost budget guard.
 *
 * NO real network / paid API. The one integration scenario drives
 * `runObservedAIRequest` with an in-process stub provider and
 * `ATOLYE_AI_COST_GUARD=on`.
 *
 * Scenarios:
 *   A deterministic token / image / tts pricing
 *   B unknown model -> fail-closed (never 0)
 *   C free provider (mock) -> free, 0
 *   D summarizeObservedCost: totals, per-stage, retry + duplicate accounting
 *   E backward compat: legacy records (no pricingStatus) priced from tokens
 *   F evaluateAiCostBudget: within / observed-exceeds / projected-exceeds / unknown
 *   G isAiCostGuardEnabled: no key -> off; flag on/off overrides
 *   H estimateProductionCost: under-budget known / $1 boundary / over / unknown component
 *   I runObservedAIRequest guard: under budget dispatches; once over -> blocked,
 *     no dispatch, errorCode AI_COST_BUDGET_EXCEEDED
 *   J MediaGenerationCostGuard: assertImageBudget blocks over budget; recordImageUsage appends
 */
import assert from "node:assert/strict";
import { emitSmokeResult } from "./lib/SmokeResult";
import { withCanonicalSmokeRuntime } from "./lib/CanonicalSmokeRuntime";
import { ProjectManager } from "../src/lib/projects/ProjectManager";
import { AIUsageManager } from "../src/lib/ai/AIUsageManager";
import { runObservedAIRequest } from "../src/lib/ai/runObservedAIRequest";
import {
  estimateImageCost,
  estimateTokenCost,
  estimateTokenCallCeiling,
  estimateTtsCost,
  normalizePricingModel,
  toUsageCostFields,
} from "../src/lib/ai/AiPricing";
import {
  DEFAULT_AI_COST_BUDGET_USD,
  evaluateAiCostBudget,
  isAiCostGuardEnabled,
  resolveAiCostBudgetUsd,
  summarizeObservedCost,
} from "../src/lib/ai/AiCostBudget";
import {
  assertImageBudget,
  recordImageUsage,
} from "../src/lib/ai/MediaGenerationCostGuard";
import { AiCostBudgetExceededError } from "../src/lib/ai/AiCostBudget";
import { estimateProductionCost } from "../src/lib/production/ProductionCostEstimate";
import type { AIProvider } from "../src/lib/ai/providers";
import type { AIUsageRecord } from "../src/types/aiUsage";

function env(overrides: Record<string, string>): NodeJS.ProcessEnv {
  return overrides as unknown as NodeJS.ProcessEnv;
}

let count = 0;
async function scenario(name: string, fn: () => void | Promise<void>) {
  await fn();
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}

function record(over: Partial<AIUsageRecord>): AIUsageRecord {
  return {
    id: `r-${Math.random().toString(36).slice(2)}`,
    projectSlug: "p",
    stage: "research",
    operation: "op",
    provider: "openai",
    model: "gpt-4.1-mini",
    status: "success",
    fallbackUsed: false,
    durationMs: 10,
    promptLength: 100,
    createdAt: "2026-08-29T00:00:00.000Z",
    ...over,
  };
}

function stubProvider(usage: { promptTokens: number; completionTokens: number }): {
  provider: AIProvider;
  calls: number;
} {
  const box = { calls: 0 };
  const provider: AIProvider = {
    async generate() {
      box.calls += 1;
      return {
        content: JSON.stringify({ ok: true }),
        finishReason: "stop" as const,
        refused: false,
        complete: true,
        truncated: false,
        usage: {
          promptTokens: usage.promptTokens,
          completionTokens: usage.completionTokens,
          totalTokens: usage.promptTokens + usage.completionTokens,
        },
      };
    },
  };
  return { provider, get calls() { return box.calls; } } as { provider: AIProvider; calls: number };
}

async function run() {
  // A ---------------------------------------------------------------
  await scenario("A: deterministic token / image / tts pricing", () => {
    const t = estimateTokenCost({ provider: "openai", model: "gpt-4.1-mini", promptTokens: 1_000_000, completionTokens: 1_000_000 });
    assert.equal(t.status, "known");
    assert.equal(t.costUsd, 0.4 + 1.6);
    assert.deepEqual(
      estimateTokenCost({ provider: "openai", model: "GPT-4.1-Mini ", promptTokens: 1_000_000, completionTokens: 1_000_000 }),
      t,
      "model name is normalised",
    );

    const img = estimateImageCost({ provider: "openai", model: "gpt-image-1", size: "1536x1024", quality: "auto", count: 4 });
    assert.equal(img.status, "known");
    assert.equal(img.costUsd, 0.063 * 4);
    assert.equal(img.unitCount, 4);

    const tts = estimateTtsCost({ provider: "openai", model: "tts-1", characters: 1_000_000 });
    assert.equal(tts.status, "known");
    assert.equal(tts.costUsd, 15.0);

    assert.equal(normalizePricingModel(" GPT-4o "), "gpt-4o");
  });

  // B ---------------------------------------------------------------
  await scenario("B: unknown model -> fail-closed (never 0)", () => {
    const t = estimateTokenCost({ provider: "openai", model: "gpt-9-ultra", promptTokens: 100, completionTokens: 100 });
    assert.equal(t.status, "unknown");
    assert.ok(Number.isNaN(t.costUsd));
    assert.equal(toUsageCostFields(t).estimatedCost, undefined);
    assert.equal(toUsageCostFields(t).pricingStatus, "unknown");

    // missing token counts on a priced model is also unknown (cannot price)
    const missing = estimateTokenCost({ provider: "openai", model: "gpt-4.1-mini", promptTokens: null, completionTokens: null });
    assert.equal(missing.status, "unknown");

    const img = estimateImageCost({ provider: "openai", model: "gpt-image-1", size: "9999x9999", quality: "auto", count: 1 });
    assert.equal(img.status, "unknown");
  });

  // C ---------------------------------------------------------------
  await scenario("C: free provider (mock) -> free, 0", () => {
    const t = estimateTokenCost({ provider: "mock", model: "mock-ai-provider", promptTokens: 999999, completionTokens: 999999 });
    assert.equal(t.status, "free");
    assert.equal(t.costUsd, 0);
    assert.equal(estimateImageCost({ provider: "mock", model: "x", size: "y", count: 5 }).status, "free");
    assert.equal(estimateTtsCost({ provider: "mock", model: "x", characters: 5000 }).status, "free");
  });

  // D ---------------------------------------------------------------
  await scenario("D: summarizeObservedCost - totals, per-stage, retry + duplicate", () => {
    const records: AIUsageRecord[] = [
      record({ stage: "research", operation: "research", estimatedCost: 0.02, pricingStatus: "known" }),
      record({ stage: "visuals", operation: "image-scene-1", estimatedCost: 0.063, pricingStatus: "known" }),
      record({ stage: "visuals", operation: "image-scene-1", estimatedCost: 0.063, pricingStatus: "known", retryCount: 1 }),
      record({ stage: "audio", operation: "tts-mix", estimatedCost: 0.18, pricingStatus: "known" }),
      record({ provider: "mock", pricingStatus: "free", estimatedCost: 0 }),
    ];
    const s = summarizeObservedCost(records);
    assert.equal(s.knownUsd, 0.326);
    assert.equal(s.knownRecordCount, 4);
    assert.equal(s.freeRecordCount, 1);
    assert.equal(s.byStage.visuals, 0.126);
    assert.equal(s.retryUsd, 0.063);
    assert.equal(s.duplicateUsd, 0.063, "2nd visuals:image-scene-1 counts as duplicate spend");
  });

  // E ---------------------------------------------------------------
  await scenario("E: backward compat - legacy record (no pricingStatus) priced from tokens", () => {
    const legacy = record({
      pricingStatus: undefined,
      estimatedCost: undefined,
      model: "gpt-4.1-mini",
      promptTokens: 1_000_000,
      completionTokens: 500_000,
    });
    const s = summarizeObservedCost([legacy]);
    assert.equal(s.unknownPricingRecordCount, 0);
    assert.equal(s.knownUsd, 1.2);
    // legacy billable record with neither cost nor tokens -> unknown (fail-closed)
    const opaque = record({ pricingStatus: undefined, estimatedCost: undefined, promptTokens: undefined, completionTokens: undefined, model: "gpt-4.1-mini" });
    assert.equal(summarizeObservedCost([opaque]).unknownPricingRecordCount, 1);
  });

  // F ---------------------------------------------------------------
  await scenario("F: evaluateAiCostBudget - within / observed / projected / unknown", () => {
    const under = evaluateAiCostBudget({
      records: [record({ estimatedCost: 0.3, pricingStatus: "known" })],
      pendingUsd: 0.1,
      budgetUsd: 1.0,
    });
    assert.equal(under.allowed, true);
    assert.equal(under.reason, "within-budget");

    const observed = evaluateAiCostBudget({
      records: [record({ estimatedCost: 1.0, pricingStatus: "known" })],
      pendingUsd: 0,
      budgetUsd: 1.0,
    });
    assert.equal(observed.allowed, false);
    assert.equal(observed.reason, "observed-exceeds-budget");

    const projected = evaluateAiCostBudget({
      records: [record({ estimatedCost: 0.95, pricingStatus: "known" })],
      pendingUsd: 0.1,
      budgetUsd: 1.0,
    });
    assert.equal(projected.allowed, false);
    assert.equal(projected.reason, "projected-exceeds-budget");

    const unknown = evaluateAiCostBudget({
      records: [record({ pricingStatus: "unknown", estimatedCost: undefined })],
      budgetUsd: 1.0,
    });
    assert.equal(unknown.allowed, false);
    assert.equal(unknown.reason, "unknown-pricing-present");

    // exactly at budget with 0 pending -> observed >= budget -> blocked
    const boundary = evaluateAiCostBudget({ records: [record({ estimatedCost: 1.0, pricingStatus: "known" })], budgetUsd: 1.0 });
    assert.equal(boundary.allowed, false);
    // just under, projected lands exactly on budget -> allowed (<=)
    const exact = evaluateAiCostBudget({ records: [record({ estimatedCost: 0.9, pricingStatus: "known" })], pendingUsd: 0.1, budgetUsd: 1.0 });
    assert.equal(exact.allowed, true);
  });

  // G ---------------------------------------------------------------
  await scenario("G: isAiCostGuardEnabled - default-on for a real render, off in tests, flag wins", () => {
    assert.equal(isAiCostGuardEnabled(env({})), false, "no key -> off");
    assert.equal(isAiCostGuardEnabled(env({ OPENAI_API_KEY: "sk-x", NODE_ENV: "test" })), false, "test env -> off even with a key");
    assert.equal(isAiCostGuardEnabled(env({ OPENAI_API_KEY: "sk-x" })), true, "real key + non-test -> on by default");
    assert.equal(isAiCostGuardEnabled(env({ OPENAI_API_KEY: "sk-x", ATOLYE_AI_COST_GUARD: "off" })), false, "explicit off wins");
    assert.equal(isAiCostGuardEnabled(env({ ATOLYE_AI_COST_GUARD: "on" })), true, "explicit on wins with no key");
    assert.equal(isAiCostGuardEnabled(env({ ATOLYE_AI_COST_GUARD: "1" })), true);
    assert.equal(resolveAiCostBudgetUsd(env({})), DEFAULT_AI_COST_BUDGET_USD);
    assert.equal(resolveAiCostBudgetUsd(env({ ATOLYE_AI_COST_BUDGET_USD: "2.5" })), 2.5);
    assert.equal(resolveAiCostBudgetUsd(env({ ATOLYE_AI_COST_BUDGET_USD: "-1" })), DEFAULT_AI_COST_BUDGET_USD);
  });

  // H ---------------------------------------------------------------
  await scenario("H: estimateProductionCost - under / boundary / over / unknown", () => {
    const base = {
      chapterCount: 6, sceneCount: 16, narrationCharacters: 6000, plannedAiImageCount: 4,
      textModel: "gpt-4.1-mini", ttsModel: "tts-1",
      imageModel: "gpt-image-1", imageSize: "1536x1024", imageQuality: "auto",
    };
    const under = estimateProductionCost(base, { budgetUsd: 1.0 });
    assert.equal(under.status, "known");
    assert.ok(under.totalUsd > 0 && under.totalUsd < 1.0, `total ${under.totalUsd}`);
    assert.equal(under.withinBudget, true);
    assert.equal(under.breakdown.imageUsd, 0.063 * 4);

    const over = estimateProductionCost(
      { ...base, narrationCharacters: 40000, plannedAiImageCount: 4 },
      { budgetUsd: 1.0 },
    );
    assert.equal(over.status, "known");
    assert.equal(over.withinBudget, over.totalUsd <= 1.0);

    const unknownModel = estimateProductionCost({ ...base, textModel: "gpt-unreleased" }, { budgetUsd: 1.0 });
    assert.equal(unknownModel.status, "unknown");
    assert.ok(Number.isNaN(unknownModel.totalUsd));
    assert.equal(unknownModel.withinBudget, false);
    assert.deepEqual(unknownModel.breakdown.unknownComponents, ["llm"]);

    // deterministic
    assert.deepEqual(estimateProductionCost(base, { budgetUsd: 1.0 }), under);
  });

  // I ---------------------------------------------------------------
  await scenario("I: runObservedAIRequest guard blocks once budget is spent", async () => {
    process.env.ATOLYE_AI_COST_GUARD = "on";
    process.env.ATOLYE_AI_COST_BUDGET_USD = "0.10";
    try {
      const project = await ProjectManager.createProject(`faz5 guard ${Date.now()}`);
      const slug = project.slug;
      const first = stubProvider({ promptTokens: 100_000, completionTokens: 100_000 }); // ~0.04 + 0.16 = 0.20 > 0.10 ceiling
      // ceiling for this call already exceeds 0.10 -> blocked on the very first call
      const r1 = await runObservedAIRequest({
        prompt: "x".repeat(400),
        context: { projectSlug: slug, provider: "openai", operation: "research", stage: "research" },
        provider: first.provider,
        maxTokens: 200_000,
      });
      assert.equal(r1.errorCode, "AI_COST_BUDGET_EXCEEDED");
      assert.equal(first.calls, 0, "provider must NOT be dispatched when over budget");
      const log = await AIUsageManager.getUsageLog(slug);
      const blocked = log.records.find((rec) => rec.errorCode === "AI_COST_BUDGET_EXCEEDED");
      assert.ok(blocked);
      assert.equal(blocked?.estimatedCost, 0, "a blocked call cost nothing");

      // a small call is allowed and recorded with a real cost
      process.env.ATOLYE_AI_COST_BUDGET_USD = "1.00";
      const small = stubProvider({ promptTokens: 1000, completionTokens: 1000 });
      const r2 = await runObservedAIRequest({
        prompt: "hello",
        context: { projectSlug: slug, provider: "openai", operation: "scenes", stage: "scenes" },
        provider: small.provider,
        maxTokens: 2000,
      });
      assert.equal(r2.errorCode, undefined);
      assert.equal(small.calls, 1);
      const log2 = await AIUsageManager.getUsageLog(slug);
      const ok = log2.records.find((rec) => rec.stage === "scenes");
      assert.equal(ok?.pricingStatus, "known");
      assert.ok((ok?.estimatedCost ?? -1) > 0);
    } finally {
      delete process.env.ATOLYE_AI_COST_GUARD;
      delete process.env.ATOLYE_AI_COST_BUDGET_USD;
    }
  });

  // J ---------------------------------------------------------------
  await scenario("J: MediaGenerationCostGuard - assertImageBudget blocks, recordImageUsage appends", async () => {
    process.env.ATOLYE_AI_COST_GUARD = "on";
    process.env.ATOLYE_AI_COST_BUDGET_USD = "0.05";
    try {
      const project = await ProjectManager.createProject(`faz5 media ${Date.now()}`);
      const slug = project.slug;
      // one 1536x1024 medium image is $0.063 > $0.05 -> blocked
      await assert.rejects(
        assertImageBudget({ projectSlug: slug, provider: "openai", model: "gpt-image-1", size: "1536x1024", quality: "auto", count: 1 }),
        (e: unknown) => e instanceof AiCostBudgetExceededError && e.reasonCode === "projected-exceeds-budget",
      );

      process.env.ATOLYE_AI_COST_BUDGET_USD = "1.00";
      await recordImageUsage({
        projectSlug: slug, sceneId: 3, provider: "openai", model: "gpt-image-1",
        size: "1536x1024", quality: "auto", count: 1, status: "success",
      });
      const log = await AIUsageManager.getUsageLog(slug);
      const img = log.records.find((r) => r.operation === "image-scene-3");
      assert.ok(img);
      assert.equal(img?.pricingStatus, "known");
      assert.equal(img?.estimatedCost, 0.063);
      assert.equal(img?.costUnitKind, "images");
    } finally {
      delete process.env.ATOLYE_AI_COST_GUARD;
      delete process.env.ATOLYE_AI_COST_BUDGET_USD;
    }
  });

  // sanity: ceiling helper
  await scenario("K: estimateTokenCallCeiling is conservative", () => {
    const c = estimateTokenCallCeiling({ provider: "openai", model: "gpt-4.1-mini", promptChars: 4000, maxTokens: 4000 });
    assert.equal(c.status, "known");
    // 1000 prompt tokens * $0.4/M + 4000 completion tokens * $1.6/M = 0.0068
    assert.equal(c.costUsd, 0.0068);
    assert.equal(estimateTokenCallCeiling({ provider: "mock", model: "m", promptChars: 10 }).status, "free");
  });

  console.log(`Faz 5 AI cost budget smoke: PASS (${count} scenarios)`);
  emitSmokeResult("faz5-ai-cost-budget", count);
}

async function main() {
  await withCanonicalSmokeRuntime(
    { name: "faz5-ai-cost-budget", operationType: "faz5-cost-smoke" },
    async () => {
      await run();
    },
  );
}

void main();
