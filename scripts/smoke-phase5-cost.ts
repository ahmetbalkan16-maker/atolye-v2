/**
 * Phase 5 — cost engine + $1 production gate (integration).
 *
 * NO real API. Verifies the deterministic budget boundary, the acceptance cost
 * receipt, per-category aggregation, retry/duplicate accounting, and the
 * fail-closed unknown-pricing behaviour.
 *
 *   A  $0.00 observed        -> within-budget
 *   B  $0.50 observed        -> within-budget
 *   C  $0.99 observed        -> within-budget
 *   D  exactly $1.00         -> within-budget (boundary is inclusive)
 *   E  $1.01 observed        -> budget-exceeded (FAIL)
 *   F  unknown pricing       -> unknown-pricing (FAIL)
 *   G  cost receipt: byCategory / byProvider-ish (byOperation) / retryUsd / duplicateUsd
 *   H  preflight decision: pass vs projected-exceeds vs unknown
 *   I  deterministic: same usage -> same receipt
 */
import assert from "node:assert/strict";
import { emitSmokeResult } from "./lib/SmokeResult";
import { withCanonicalSmokeRuntime } from "./lib/CanonicalSmokeRuntime";
import { ProjectManager } from "../src/lib/projects/ProjectManager";
import { AIUsageManager } from "../src/lib/ai/AIUsageManager";
import {
  buildProductionCostReceipt,
  persistProductionCostReceipt,
} from "../src/lib/production/ProductionCostReceipt";
import { buildProductionCostPreflight } from "../src/lib/production/ProductionCostPreflight";
import { summarizeObservedCost } from "../src/lib/ai/AiCostBudget";
import type { AIUsageRecord, AIUsageLog } from "../src/types/aiUsage";
import type { ScriptData } from "../src/types/script";
import type { SceneData } from "../src/types/scene";

let count = 0;
async function scenario(name: string, fn: () => void | Promise<void>) {
  await fn();
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}

function rec(over: Partial<AIUsageRecord>): AIUsageRecord {
  return {
    id: `r-${Math.random().toString(36).slice(2)}`,
    projectSlug: "p",
    stage: "research",
    operation: "research",
    provider: "openai",
    model: "gpt-4.1-mini",
    status: "success",
    fallbackUsed: false,
    durationMs: 5,
    promptLength: 10,
    pricingStatus: "known",
    costUnitKind: "tokens",
    costUnitCount: 100,
    createdAt: "2026-08-30T00:00:00.000Z",
    ...over,
  };
}

async function usageLog(projectSlug: string, records: AIUsageRecord[]): Promise<AIUsageLog> {
  for (const record of records) {
    await AIUsageManager.appendRecord({ ...record, projectSlug });
  }
  return AIUsageManager.getUsageLog(projectSlug);
}

function script(chapters: number, narrationChars: number): ScriptData {
  return {
    chapters: Array.from({ length: chapters }, (_, i) => ({
      id: i + 1, title: `B${i}`, narration: "x".repeat(Math.floor(narrationChars / chapters)),
      duration: 60, emotion: "serious", visualStyle: "historical", keyPoints: [],
    })),
    musicStyle: "historical", voiceStyle: "deep", createdAt: "2026-08-30T00:00:00.000Z",
  } as unknown as ScriptData;
}
function scenes(n: number): SceneData {
  return { scenes: Array.from({ length: n }, (_, i) => ({ id: i + 1, title: `S${i}`, description: "d" })), createdAt: "2026-08-30T00:00:00.000Z" };
}

async function run() {
  for (const [label, usd, expected] of [
    ["A", 0, "within-budget"],
    ["B", 0.5, "within-budget"],
    ["C", 0.99, "within-budget"],
    ["D", 1.0, "within-budget"],
    ["E", 1.01, "budget-exceeded"],
  ] as const) {
    await scenario(`${label}: observed $${usd} -> ${expected}`, async () => {
      const p = await ProjectManager.createProject(`p5 ${label} ${Date.now()}`);
      const log = await usageLog(p.slug, [rec({ estimatedCost: usd, stage: "visuals", operation: "image-scene-1", provider: "openai", model: "gpt-image-1" })]);
      const receipt = buildProductionCostReceipt({ projectSlug: p.slug, usage: log, budgetUsd: 1.0 });
      assert.equal(receipt.status, expected);
      assert.equal(receipt.withinBudget, expected === "within-budget");
      assert.equal(receipt.observedUsd, usd);
      persistProductionCostReceipt(receipt);
      const persisted = await ProjectManager.getProject(p.slug); // sanity: project still readable
      assert.ok(persisted);
    });
  }

  // F ------------------------------------------------------------------
  await scenario("F: unknown pricing -> unknown-pricing (FAIL closed)", async () => {
    const p = await ProjectManager.createProject(`p5 F ${Date.now()}`);
    const log = await usageLog(p.slug, [
      rec({ estimatedCost: 0.1, pricingStatus: "known" }),
      rec({ pricingStatus: "unknown", estimatedCost: undefined, model: "mystery-model", provider: "openai" }),
    ]);
    const receipt = buildProductionCostReceipt({ projectSlug: p.slug, usage: log, budgetUsd: 1.0 });
    assert.equal(receipt.status, "unknown-pricing");
    assert.equal(receipt.withinBudget, false);
    assert.equal(receipt.unknownCostCount, 1);
  });

  // G ------------------------------------------------------------------
  await scenario("G: receipt - byCategory + retry + duplicate accounting", async () => {
    const p = await ProjectManager.createProject(`p5 G ${Date.now()}`);
    const log = await usageLog(p.slug, [
      rec({ stage: "research", operation: "research", estimatedCost: 0.02 }),
      rec({ stage: "visuals", operation: "image-scene-1", estimatedCost: 0.06, provider: "openai", model: "gpt-image-1" }),
      rec({ stage: "visuals", operation: "image-scene-1", estimatedCost: 0.06, provider: "openai", model: "gpt-image-1", retryCount: 1 }),
      rec({ stage: "audio", operation: "tts-mix", estimatedCost: 0.18, provider: "openai", model: "tts-1" }),
      rec({ provider: "mock", pricingStatus: "free", estimatedCost: 0, model: "mock-ai-provider" }),
    ]);
    const receipt = buildProductionCostReceipt({ projectSlug: p.slug, usage: log, budgetUsd: 1.0 });
    assert.equal(receipt.observedUsd, 0.32);
    assert.equal(receipt.byCategory.visuals, 0.12);
    assert.equal(receipt.byCategory.audio, 0.18);
    assert.equal(receipt.retryUsd, 0.06);
    assert.equal(receipt.duplicateUsd, 0.06);
    assert.equal(receipt.freeCallCount, 1);
    assert.equal(receipt.billableCallCount, 4);
    // summarizeObservedCost agrees
    assert.equal(summarizeObservedCost(log.records).knownUsd, 0.32);
  });

  // H ------------------------------------------------------------------
  await scenario("H: preflight - pass vs projected-exceeds vs unknown", async () => {
    const p = await ProjectManager.createProject(`p5 H ${Date.now()}`);
    const pass = await buildProductionCostPreflight({ projectSlug: p.slug, script: script(6, 9000), scenes: scenes(16), budgetUsd: 1.0 });
    assert.equal(pass.decision, "pass");
    const tiny = await buildProductionCostPreflight({ projectSlug: p.slug, script: script(6, 9000), scenes: scenes(16), budgetUsd: 0.01 });
    assert.equal(tiny.decision, "block");
    assert.equal(tiny.blockReason, "projected-exceeds-budget");
    const unknown = await buildProductionCostPreflight({
      projectSlug: p.slug, script: script(6, 9000), scenes: scenes(16), budgetUsd: 1.0,
      env: { OPENAI_MODEL: "gpt-nonexistent" } as unknown as NodeJS.ProcessEnv,
    });
    assert.equal(unknown.decision, "block");
    assert.equal(unknown.blockReason, "unknown-pricing");
  });

  // I ------------------------------------------------------------------
  await scenario("I: deterministic - same usage -> same receipt", async () => {
    const p = await ProjectManager.createProject(`p5 I ${Date.now()}`);
    const log = await usageLog(p.slug, [rec({ estimatedCost: 0.4, stage: "scenes", operation: "scenes" })]);
    const a = buildProductionCostReceipt({ projectSlug: p.slug, usage: log, budgetUsd: 1.0, now: () => "2026-08-30T00:00:00.000Z" });
    const b = buildProductionCostReceipt({ projectSlug: p.slug, usage: log, budgetUsd: 1.0, now: () => "2026-08-30T00:00:00.000Z" });
    assert.deepEqual(a, b);
  });

  console.log(`Phase 5 cost engine + $1 gate smoke: PASS (${count} scenarios)`);
  emitSmokeResult("phase5-cost", count);
}

async function main() {
  await withCanonicalSmokeRuntime({ name: "phase5-cost", operationType: "phase5-cost-smoke" }, async () => {
    await run();
  });
}

void main();
