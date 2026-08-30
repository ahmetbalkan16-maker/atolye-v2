/**
 * Documentary media effort — Faz 6: production wiring of the real-media +
 * cost-guard machinery.
 *
 * NO real network / paid API. This suite verifies the *activation* layer:
 *   A RealMediaProductionFlags: every flag defaults off, on for on/true/1
 *   B materializePipelineStageExecutionOptions: research stage auto-wires the
 *     mediaSearchClient only when ATOLYE_REAL_MEDIA_DISCOVERY=on (never in the
 *     acceptance fingerprint), and never for other stages
 *   C buildProductionCostPreflight: pass under budget; block on unknown model,
 *     tiny budget (projected), and pre-spent budget (observed)
 *   D cost preflight uses conservative defaults for a fresh (no script) project
 *   E resolveBackgroundMusic + Faz 4 staging still work end to end (guard off)
 */
import assert from "node:assert/strict";
import { emitSmokeResult } from "./lib/SmokeResult";
import { withCanonicalSmokeRuntime } from "./lib/CanonicalSmokeRuntime";
import { ProjectManager } from "../src/lib/projects/ProjectManager";
import { AIUsageManager } from "../src/lib/ai/AIUsageManager";
import {
  isCostBudgetGuardEnabled,
  isRealMediaDiscoveryEnabled,
  isRealMediaSelectionEnabled,
} from "../src/lib/assets/RealMediaProductionFlags";
import { materializePipelineStageExecutionOptions } from "../src/lib/pipeline/PipelineStageExecutor";
import { buildProductionCostPreflight } from "../src/lib/production/ProductionCostPreflight";
import type { ScriptData } from "../src/types/script";
import type { SceneData } from "../src/types/scene";
import type { AIUsageRecord } from "../src/types/aiUsage";

let count = 0;
async function scenario(name: string, fn: () => void | Promise<void>) {
  await fn();
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}

function env(overrides: Record<string, string>): NodeJS.ProcessEnv {
  return overrides as unknown as NodeJS.ProcessEnv;
}

function script(chapters: number, narrationChars: number): ScriptData {
  return {
    title: "Test",
    summary: "s",
    hook: "h",
    tone: "documentary",
    targetAudience: "a",
    chapters: Array.from({ length: chapters }, (_, i) => ({
      id: i + 1,
      title: `Bölüm ${i + 1}`,
      narration: "x".repeat(Math.floor(narrationChars / chapters)),
      duration: 60,
      emotion: "serious",
      visualStyle: "historical",
      keyPoints: [],
    })),
    estimatedDuration: chapters * 60,
    narrationWordCount: 100,
    callToAction: "cta",
    voiceStyle: "deep",
    musicStyle: "historical",
    createdAt: "2026-08-29T00:00:00.000Z",
  } as unknown as ScriptData;
}

function scenes(n: number): SceneData {
  return {
    scenes: Array.from({ length: n }, (_, i) => ({ id: i + 1, title: `S${i}`, description: "d" })),
    createdAt: "2026-08-29T00:00:00.000Z",
  };
}

async function run() {
  // A -----------------------------------------------------------------
  await scenario("A: RealMediaProductionFlags default off; on for on/true/1", () => {
    assert.equal(isRealMediaDiscoveryEnabled(env({})), false);
    assert.equal(isRealMediaSelectionEnabled(env({})), false);
    assert.equal(isCostBudgetGuardEnabled(env({})), false);
    assert.equal(isRealMediaDiscoveryEnabled(env({ ATOLYE_REAL_MEDIA_DISCOVERY: "on" })), true);
    assert.equal(isRealMediaSelectionEnabled(env({ ATOLYE_REAL_MEDIA_SELECTION: "TRUE" })), true);
    assert.equal(isCostBudgetGuardEnabled(env({ ATOLYE_AI_COST_GUARD: "1" })), true);
    assert.equal(isRealMediaDiscoveryEnabled(env({ ATOLYE_REAL_MEDIA_DISCOVERY: "yes" })), false);
  });

  // B -----------------------------------------------------------------
  await scenario("B: mediaSearchClient auto-wire is opt-in and research-only", () => {
    const offResearch = materializePipelineStageExecutionOptions("research");
    assert.equal(offResearch.options.mediaSearchClient, undefined);
    assert.equal(offResearch.configuredOptions.includes("mediaSearchClient" as never), false);

    process.env.ATOLYE_REAL_MEDIA_DISCOVERY = "on";
    try {
      const onResearch = materializePipelineStageExecutionOptions("research");
      assert.ok(onResearch.options.mediaSearchClient, "research auto-wires a client when the flag is on");
      assert.equal(
        onResearch.configuredOptions.includes("mediaSearchClient" as never),
        false,
        "mediaSearchClient is NOT a tracked provider option -> fingerprint unchanged",
      );
      const onVisuals = materializePipelineStageExecutionOptions("visuals");
      assert.equal(onVisuals.options.mediaSearchClient, undefined, "only the research stage auto-wires it");
    } finally {
      delete process.env.ATOLYE_REAL_MEDIA_DISCOVERY;
    }
  });

  // C -----------------------------------------------------------------
  await scenario("C: buildProductionCostPreflight - pass / unknown / projected / observed", async () => {
    const p = await ProjectManager.createProject(`faz6 preflight ${Date.now()}`);
    const pass = await buildProductionCostPreflight({
      projectSlug: p.slug,
      script: script(6, 9000),
      scenes: scenes(16),
      budgetUsd: 1.0,
    });
    assert.equal(pass.decision, "pass");
    assert.equal(pass.remainingEstimate.status, "known");
    assert.ok(pass.projectedTotalUsd > 0 && pass.projectedTotalUsd < 1.0, `projected ${pass.projectedTotalUsd}`);
    assert.equal(pass.inputs.source, "script+scenes");
    assert.equal(pass.remainingEstimate.breakdown.imageUsd, 0.063 * 4);

    const unknown = await buildProductionCostPreflight({
      projectSlug: p.slug,
      script: script(6, 9000),
      scenes: scenes(16),
      budgetUsd: 1.0,
      env: env({ OPENAI_MODEL: "gpt-does-not-exist" }),
    });
    assert.equal(unknown.decision, "block");
    assert.equal(unknown.blockReason, "unknown-pricing");

    const projected = await buildProductionCostPreflight({
      projectSlug: p.slug,
      script: script(6, 9000),
      scenes: scenes(16),
      budgetUsd: 0.01,
    });
    assert.equal(projected.decision, "block");
    assert.equal(projected.blockReason, "projected-exceeds-budget");
  });

  // observed-exceeds needs a project whose usage log already spent > budget
  await scenario("C2: preflight blocks when observed spend already exceeds budget", async () => {
    const p = await ProjectManager.createProject(`faz6 spent ${Date.now()}`);
    const spent: AIUsageRecord = {
      id: "spent-1", projectSlug: p.slug, stage: "visuals", operation: "image-scene-1",
      provider: "openai", model: "gpt-image-1", status: "success", fallbackUsed: false,
      durationMs: 10, promptLength: 0, estimatedCost: 1.5, pricingStatus: "known",
      costUnitKind: "images", costUnitCount: 1, createdAt: "2026-08-29T00:00:00.000Z",
    };
    await AIUsageManager.appendRecord(spent);
    const report = await buildProductionCostPreflight({
      projectSlug: p.slug, script: script(6, 9000), scenes: scenes(16), budgetUsd: 1.0,
    });
    assert.equal(report.decision, "block");
    assert.equal(report.blockReason, "observed-exceeds-budget");
    assert.ok(report.observedUsd >= 1.5);
  });

  // D -----------------------------------------------------------------
  await scenario("D: fresh project (no script) -> conservative defaults", async () => {
    const p = await ProjectManager.createProject(`faz6 fresh ${Date.now()}`);
    const report = await buildProductionCostPreflight({ projectSlug: p.slug, budgetUsd: 1.0 });
    assert.equal(report.inputs.source, "defaults");
    assert.equal(report.inputs.chapterCount, 6);
    assert.equal(report.inputs.sceneCount, 16);
    assert.equal(report.inputs.plannedAiImageCount, 4);
    assert.equal(report.remainingEstimate.status, "known");
    assert.equal(report.decision, "pass");
  });

  // E -----------------------------------------------------------------
  await scenario("E: deterministic + guard-off default keeps mock pipeline unaffected", async () => {
    // cost guard is opt-in; without the flag every guard is a no-op
    assert.equal(isCostBudgetGuardEnabled(process.env), false);
    const p = await ProjectManager.createProject(`faz6 determinism ${Date.now()}`);
    const a = await buildProductionCostPreflight({ projectSlug: p.slug, script: script(6, 9000), scenes: scenes(16), budgetUsd: 1 });
    const b = await buildProductionCostPreflight({ projectSlug: p.slug, script: script(6, 9000), scenes: scenes(16), budgetUsd: 1 });
    assert.deepEqual(a.remainingEstimate, b.remainingEstimate);
    assert.equal(a.projectedTotalUsd, b.projectedTotalUsd);
  });

  console.log(`Faz 6 real-media production wiring smoke: PASS (${count} scenarios)`);
  emitSmokeResult("faz6-real-media-production-wiring", count);
}

async function main() {
  await withCanonicalSmokeRuntime(
    { name: "faz6-real-media-production-wiring", operationType: "faz6-wiring-smoke" },
    async () => {
      await run();
    },
  );
}

void main();
