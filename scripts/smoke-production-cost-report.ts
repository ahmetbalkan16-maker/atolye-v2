/**
 * Documentary pipeline revision — P1: the production cost report.
 *
 * A. categorizeUsageRecord — llm / image / video / tts / music-sfx / other,
 *    driven by costUnitKind first (a visuals-stage plan call is still `llm`).
 * B. buildProductionCostReport — per-category rollup that sums to the total,
 *    cost per minute / scene, retry USD, within-budget verdict.
 * C. unknown-pricing and over-budget both flip status (never a silent number).
 * D. renderProductionCostReportText — the fixed report block carries every line.
 * E. per-preset projection — 4 presets, ordered economy <= documentary,
 *    active preset flagged, all priceable.
 * F. estimateProductionCostForPreset clamps AI images to the preset ceiling.
 * G. real-run proof — a real runObservedAIRequest call appends an ai-usage.json
 *    record with estimatedCost / pricingStatus:"known" / costUnitKind:"tokens",
 *    and a report built from that live ledger books it under LLM.
 */
import assert from "node:assert/strict";
import { emitSmokeResult } from "./lib/SmokeResult";
import { withCanonicalSmokeRuntime } from "./lib/CanonicalSmokeRuntime";
import { ProjectManager } from "../src/lib/projects/ProjectManager";
import { AIUsageManager } from "../src/lib/ai/AIUsageManager";
import { runObservedAIRequest } from "../src/lib/ai/runObservedAIRequest";
import {
  buildProductionCostReport,
  categorizeUsageRecord,
  PRODUCTION_COST_CATEGORIES,
  renderProductionCostReportText,
} from "../src/lib/production/ProductionCostReport";
import { estimateProductionCostForPreset } from "../src/lib/production/ProductionCostEstimate";
import { QUALITY_PRESETS } from "../src/lib/production/QualityPreset";
import type { AIProvider } from "../src/lib/ai/providers";
import type { AIUsageLog, AIUsageRecord } from "../src/types/aiUsage";

let scenarios = 0;
function pass(condition: unknown, label: string) {
  assert.ok(condition, label);
  scenarios += 1;
}

function rec(over: Partial<AIUsageRecord>): AIUsageRecord {
  return {
    id: `r-${Math.random().toString(36).slice(2)}`,
    projectSlug: "cost-report-fixture",
    stage: "research",
    operation: "research",
    provider: "openai",
    model: "gpt-4.1-mini",
    status: "success",
    fallbackUsed: false,
    durationMs: 10,
    promptLength: 100,
    createdAt: "2026-08-30T00:00:00.000Z",
    pricingStatus: "known",
    estimatedCost: 0.001,
    costUnitKind: "tokens",
    ...over,
  };
}
function log(records: AIUsageRecord[]): AIUsageLog {
  return { projectSlug: "cost-report-fixture", records } as AIUsageLog;
}
const facts = {
  durationSeconds: 780,
  sceneCount: 60,
  chapterCount: 6,
  narrationCharacters: 13_000,
  aiImageCount: 4,
  aiVideoCount: 0,
  cachedAssetCount: 50,
  retryCount: 2,
};

// A ---------------------------------------------------------------------------
function categorization() {
  pass(categorizeUsageRecord(rec({ stage: "research", costUnitKind: "tokens" })) === "llm", "token call -> llm");
  pass(
    categorizeUsageRecord(rec({ stage: "visuals", operation: "visuals", costUnitKind: "tokens" })) === "llm",
    "visuals-stage plan call is llm (not image)",
  );
  pass(
    categorizeUsageRecord(rec({ stage: "visuals", operation: "image-generate", costUnitKind: "images" })) === "image",
    "image-metered call -> image even on the visuals stage",
  );
  pass(categorizeUsageRecord(rec({ stage: "thumbnail", costUnitKind: "images" })) === "image", "thumbnail -> image");
  pass(
    categorizeUsageRecord(rec({ stage: "audio", operation: "tts-narration", costUnitKind: "characters" })) === "tts",
    "character-metered call -> tts",
  );
  pass(categorizeUsageRecord(rec({ stage: "video", operation: "scene-video" })) === "video", "video stage -> video");
  pass(
    categorizeUsageRecord(rec({ stage: "audio", operation: "background-music-select" })) === "music-sfx",
    "music op -> music-sfx",
  );
  pass(
    categorizeUsageRecord(rec({ stage: "unknown", operation: "mystery", costUnitKind: undefined })) === "other",
    "unclassifiable -> other",
  );
}

// B ---------------------------------------------------------------------------
function rollup() {
  const records = [
    rec({ stage: "research", estimatedCost: 0.02, costUnitKind: "tokens" }),
    rec({ stage: "script", estimatedCost: 0.03, costUnitKind: "tokens" }),
    rec({ stage: "scenes", estimatedCost: 0.01, costUnitKind: "tokens" }),
    rec({ stage: "animation", operation: "animation-motion-plan-scene-1", estimatedCost: 0.005, costUnitKind: "tokens" }),
    rec({ stage: "assembly", operation: "assembly-plan", estimatedCost: 0.04, costUnitKind: "tokens" }),
    rec({ stage: "visuals", operation: "image", estimatedCost: 0.016, costUnitKind: "images" }),
    rec({ stage: "visuals", operation: "image", estimatedCost: 0.016, costUnitKind: "images" }),
    rec({ stage: "audio", operation: "tts-narration", estimatedCost: 0.18, costUnitKind: "characters" }),
    rec({ stage: "audio", operation: "background-music", provider: "mock", pricingStatus: "free", estimatedCost: 0 }),
    rec({ stage: "script", operation: "script", estimatedCost: 0.03, costUnitKind: "tokens", retryCount: 1 }),
  ];
  const report = buildProductionCostReport({
    projectSlug: "cost-report-fixture", usage: log(records), facts, budgetUsd: 1.0, env: {} as NodeJS.ProcessEnv,
    now: () => "2026-08-30T00:00:00.000Z",
  });
  const catSum = PRODUCTION_COST_CATEGORIES.reduce((s, c) => s + report.byCategory[c], 0);
  pass(Math.abs(catSum - report.totalUsd) < 1e-9, "byCategory sums exactly to totalUsd");
  pass(
    report.byCategory.llm > 0 && report.byCategory.image > 0 && report.byCategory.tts > 0 &&
      report.byCategory.video === 0 && report.byCategory["music-sfx"] === 0,
    "spend lands in the right buckets; free music contributes 0",
  );
  pass(report.byCategory.image === 0.032, "two $0.016 images -> IMAGE $0.032");
  pass(report.retryUsd === 0.03, "the retried script call is booked as retry cost");
  pass(report.llmCallCount === 6, "llm call count excludes image/tts/free records");
  pass(report.status === "within-budget" && report.withinBudget, "under $1 -> within-budget");
  pass(
    report.costPerMinuteUsd === Math.round((report.totalUsd / (780 / 60)) * 1e6) / 1e6 &&
      report.costPerSceneUsd === Math.round((report.totalUsd / 60) * 1e6) / 1e6,
    "cost per minute / per scene derived from the facts",
  );
  pass(
    report.cacheSavingsUsdEstimated > 0,
    "cache savings is an estimated positive figure (50 assets x active-preset image price)",
  );
  // deterministic
  const again = buildProductionCostReport({
    projectSlug: "cost-report-fixture", usage: log(records), facts, budgetUsd: 1.0, env: {} as NodeJS.ProcessEnv,
    now: () => "2026-08-30T00:00:00.000Z",
  });
  pass(JSON.stringify(again) === JSON.stringify(report), "report is deterministic");
}

// C ---------------------------------------------------------------------------
function statusFlips() {
  const unknown = buildProductionCostReport({
    projectSlug: "x", usage: log([rec({ pricingStatus: "unknown", estimatedCost: undefined, model: "gpt-unreleased" })]),
    facts, budgetUsd: 1.0, env: {} as NodeJS.ProcessEnv,
  });
  pass(unknown.status === "unknown-pricing" && !unknown.withinBudget, "any unknown-priced record -> unknown-pricing");
  pass(
    renderProductionCostReportText(unknown).includes("UNKNOWN PRICING — FAIL CLOSED"),
    "renderer shows the fail-closed verdict",
  );
  const over = buildProductionCostReport({
    projectSlug: "x", usage: log([rec({ stage: "audio", operation: "tts", costUnitKind: "characters", estimatedCost: 2.5 })]),
    facts, budgetUsd: 1.0, env: {} as NodeJS.ProcessEnv,
  });
  pass(over.status === "budget-exceeded" && !over.withinBudget, "known spend over budget -> budget-exceeded");
  pass(renderProductionCostReportText(over).includes("OVER BUDGET"), "renderer shows OVER BUDGET");
}

// D ---------------------------------------------------------------------------
function rendering() {
  const report = buildProductionCostReport({
    projectSlug: "x", usage: log([rec({ estimatedCost: 0.2, costUnitKind: "tokens" })]),
    facts, budgetUsd: 1.0, env: {} as NodeJS.ProcessEnv,
  });
  const text = renderProductionCostReportText(report);
  for (const needle of [
    "=== ATÖLYE DOCUMENTARY PRODUCTION COST ===",
    "Duration:", "Scenes:", "Images generated:", "AI videos generated:",
    "LLM calls:", "Cached assets:", "Retries:",
    "LLM:", "IMAGE:", "VIDEO:", "TTS:", "MUSIC/SFX:", "OTHER:",
    "RETRY COST:", "CACHE SAVINGS:", "TOTAL:", "Cost / minute:", "Cost / scene:",
    "Budget:", "Preset comparison",
    "ECONOMY", "BALANCED", "DOCUMENTARY", "CINEMATIC",
  ]) {
    pass(text.includes(needle), `report text contains "${needle}"`);
  }
  pass(text.includes("(active)"), "the active preset is flagged in the comparison");
  pass(text.includes("754s") === false && text.includes("780s"), "duration renders as m/s + seconds");
}

// E ---------------------------------------------------------------------------
function presetProjection() {
  const report = buildProductionCostReport({
    projectSlug: "x", usage: log([rec({})]), facts, budgetUsd: 1.0, env: {} as NodeJS.ProcessEnv,
  });
  pass(report.presetProjections.length === 4, "one projection per preset");
  pass(report.presetProjections.every((p) => p.status === "known"), "every preset projection is priceable");
  const by = Object.fromEntries(report.presetProjections.map((p) => [p.preset, p.totalUsd]));
  pass(by.economy <= by.documentary && by.documentary <= by.cinematic, "projected cost rises with preset tier");
  pass(
    report.presetProjections.find((p) => p.preset === "documentary")?.withinCeiling === true,
    "documentary projection is within its $1 ceiling for this script",
  );
  pass(report.activePreset === "documentary", "no env -> documentary is active");
}

// F ---------------------------------------------------------------------------
function presetClamp() {
  const eco = estimateProductionCostForPreset(
    "economy",
    { chapterCount: 6, sceneCount: 60, narrationCharacters: 13_000, plannedAiImageCount: 40 },
  );
  pass(eco.counts.aiImages === QUALITY_PRESETS.economy.maxAiImages, "economy clamps AI images to its ceiling (2)");
  const tiny = estimateProductionCostForPreset(
    "cinematic",
    { chapterCount: 2, sceneCount: 1, narrationCharacters: 500 },
  );
  pass(tiny.counts.aiImages === 1, "AI images also clamp to sceneCount");
}

// G ---------------------------------------------------------------------------
function stubTextProvider(usage: { promptTokens: number; completionTokens: number }): {
  provider: AIProvider;
  readonly calls: number;
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
  return { provider, get calls() { return box.calls; } } as {
    provider: AIProvider; readonly calls: number;
  };
}

async function realRunProof() {
  const project = await ProjectManager.createProject(`cost report proof ${Date.now()}`);
  const slug = project.slug;
  const stub = stubTextProvider({ promptTokens: 2000, completionTokens: 1500 });
  const result = await runObservedAIRequest({
    prompt: "y".repeat(600),
    context: { projectSlug: slug, provider: "openai", operation: "research", stage: "research" },
    provider: stub.provider,
    maxTokens: 800,
  });
  pass(result.errorCode === undefined && stub.calls === 1, "stub billable provider dispatched once");
  const usage = await AIUsageManager.getUsageLog(slug);
  const record = usage.records.find((r) => r.stage === "research");
  pass(
    record?.pricingStatus === "known" &&
      typeof record.estimatedCost === "number" && record.estimatedCost >= 0 &&
      record.costUnitKind === "tokens",
    "the live ai-usage.json record carries estimatedCost + pricingStatus:known + costUnitKind:tokens",
  );
  const report = buildProductionCostReport({
    projectSlug: slug,
    usage,
    facts: { ...facts, sceneCount: 1, chapterCount: 1 },
    env: {} as NodeJS.ProcessEnv,
  });
  pass(
    report.byCategory.llm >= 0 && report.totalUsd === report.byCategory.llm &&
      report.status === "within-budget",
    "a report built from the live ledger books the call under LLM and stays within budget",
  );
}

async function main() {
  categorization();
  rollup();
  statusFlips();
  rendering();
  presetProjection();
  presetClamp();
  await withCanonicalSmokeRuntime(
    { name: "production-cost-report", operationType: "cost-report-smoke" },
    async () => {
      await realRunProof();
    },
  );
  console.log(`production cost report smoke: PASS (${scenarios} scenarios)`);
  emitSmokeResult("production-cost-report", scenarios);
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
