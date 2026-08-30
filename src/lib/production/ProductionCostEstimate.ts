import {
  estimateImageCost,
  estimateTokenCost,
  estimateTtsCost,
} from "@/lib/ai/AiPricing";
import { resolveAiCostBudgetUsd } from "@/lib/ai/AiCostBudget";

/**
 * Documentary media effort — Faz 5: deterministic *pre-run* cost estimate for a
 * production render, so the acceptance preflight (Faz 6) can BLOCK before a
 * single paid call when the projected spend would exceed the `$1` budget.
 *
 * The estimate is intentionally conservative (over-estimates): the planning-LLM
 * token assumptions and the "mix re-synthesises all narration" TTS assumption
 * are upper bounds. If any component's model has no price row the whole estimate
 * is `status: "unknown"` and the preflight must fail closed.
 */

/** Fixed planning-stage LLM calls every render makes (research → youtube package). */
const PLANNING_LLM_CALLS = ["research", "script", "scenes", "audio-plan", "assembly-plan", "seo", "youtube"] as const;

/** Conservative token assumptions per call type. */
const LLM_ASSUMPTIONS = Object.freeze({
  planningInputTokens: 2500,
  planningOutputTokens: 4000,
  animationInputTokens: 900,
  animationOutputTokens: 500,
});

export interface ProductionCostInputs {
  /** Script chapters — one narration section each. */
  readonly chapterCount: number;
  /** Total scenes — one animation motion-plan LLM call each. */
  readonly sceneCount: number;
  /** Total characters of narration across every chapter. */
  readonly narrationCharacters: number;
  /** Scenes that will fall back to an AI image (0..`visualMediaAdmissionPolicy.maxAiImages`). */
  readonly plannedAiImageCount: number;
  readonly textModel: string;
  readonly ttsModel: string;
  readonly imageModel: string;
  readonly imageSize: string;
  readonly imageQuality: string;
}

export interface ProductionCostEstimate {
  readonly status: "known" | "unknown";
  /** USD, or `NaN` when `status === "unknown"`. */
  readonly totalUsd: number;
  readonly budgetUsd: number;
  readonly withinBudget: boolean;
  readonly breakdown: {
    readonly llmUsd: number;
    readonly ttsUsd: number;
    readonly imageUsd: number;
    readonly unknownComponents: readonly string[];
  };
  readonly counts: {
    readonly chapters: number;
    readonly planningLlmCalls: number;
    readonly animationLlmCalls: number;
    readonly ttsCharacters: number;
    readonly aiImages: number;
  };
}

export function estimateProductionCost(
  inputs: ProductionCostInputs,
  options: { budgetUsd?: number; env?: NodeJS.ProcessEnv } = {},
): ProductionCostEstimate {
  const budgetUsd = options.budgetUsd ?? resolveAiCostBudgetUsd(options.env);
  const chapterCount = nonNegInt(inputs.chapterCount);
  const sceneCount = nonNegInt(inputs.sceneCount);
  const narrationCharacters = nonNegInt(inputs.narrationCharacters);
  const aiImages = nonNegInt(inputs.plannedAiImageCount);

  const unknown = new Set<string>();

  // --- LLM: fixed planning calls + one animation call per scene ---
  const planningCall = estimateTokenCost({
    provider: "openai",
    model: inputs.textModel,
    promptTokens: LLM_ASSUMPTIONS.planningInputTokens,
    completionTokens: LLM_ASSUMPTIONS.planningOutputTokens,
  });
  const animationCall = estimateTokenCost({
    provider: "openai",
    model: inputs.textModel,
    promptTokens: LLM_ASSUMPTIONS.animationInputTokens,
    completionTokens: LLM_ASSUMPTIONS.animationOutputTokens,
  });
  if (planningCall.status === "unknown" || animationCall.status === "unknown") unknown.add("llm");
  const llmUsd = round(
    safeCost(planningCall) * PLANNING_LLM_CALLS.length + safeCost(animationCall) * sceneCount,
  );

  // --- TTS: every chapter section + the full-narration mix ---
  const ttsCharacters = narrationCharacters * 2;
  const tts = estimateTtsCost({
    provider: "openai",
    model: inputs.ttsModel,
    characters: ttsCharacters,
  });
  if (tts.status === "unknown") unknown.add("tts");
  const ttsUsd = round(safeCost(tts));

  // --- Images: the capped AI fallbacks ---
  const image = estimateImageCost({
    provider: "openai",
    model: inputs.imageModel,
    size: inputs.imageSize,
    quality: inputs.imageQuality,
    count: aiImages,
  });
  if (image.status === "unknown" && aiImages > 0) unknown.add("image");
  const imageUsd = round(aiImages > 0 ? safeCost(image) : 0);

  const status: "known" | "unknown" = unknown.size > 0 ? "unknown" : "known";
  const totalUsd = status === "unknown" ? Number.NaN : round(llmUsd + ttsUsd + imageUsd);
  const withinBudget = status === "known" && totalUsd <= budgetUsd;

  return {
    status,
    totalUsd,
    budgetUsd,
    withinBudget,
    breakdown: {
      llmUsd,
      ttsUsd,
      imageUsd,
      unknownComponents: [...unknown].sort(),
    },
    counts: {
      chapters: chapterCount,
      planningLlmCalls: PLANNING_LLM_CALLS.length,
      animationLlmCalls: sceneCount,
      ttsCharacters,
      aiImages,
    },
  };
}

function safeCost(estimate: { status: string; costUsd: number }): number {
  return estimate.status === "known" && Number.isFinite(estimate.costUsd) ? estimate.costUsd : 0;
}

function nonNegInt(value: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
}

function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}
