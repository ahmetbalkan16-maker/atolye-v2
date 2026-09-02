import {
  estimateImageCost,
  estimateTokenCost,
  estimateTtsCost,
} from "@/lib/ai/AiPricing";
import { resolveAiCostBudgetUsd } from "@/lib/ai/AiCostBudget";
import { thumbnailProviderConfig } from "@/lib/thumbnail/ThumbnailProviderConfig";
import { QUALITY_PRESETS, type QualityPresetName } from "./QualityPreset";

/**
 * Documentary media effort — Faz 5: deterministic *pre-run* cost estimate for a
 * production render, so the acceptance preflight (Faz 6) can BLOCK before a
 * single paid call when the projected spend would exceed the `$1` budget.
 *
 * The estimate is intentionally conservative (over-estimates): the planning-LLM
 * token assumptions and the "mix re-synthesises all narration" TTS assumption
 * are upper bounds. If any component's model has no price row the whole estimate
 * is `status: "unknown"` and the preflight must fail closed.
 *
 * Provider-aware: each component is priced against the provider actually
 * selected for it (`AI_PROVIDER`, `ANIMATION_PROVIDER`, `YOUTUBE_PROVIDER`,
 * `AUDIO_PROVIDER`, `IMAGE_PROVIDER`, `THUMBNAIL_PROVIDER`). A `$0` local backend
 * (`ollama` / `piper`) or an archival-photo image provider (`real` / `local`)
 * zeroes that line — it is not silently priced as OpenAI. Providers default to
 * `openai` when not supplied (unchanged conservative behaviour).
 */

/** Text planning-stage LLM calls every render makes (research → seo). */
const TEXT_PLANNING_CALLS = 6; // research, script, scenes, audio-plan, assembly-plan, seo

/** Conservative token assumptions per call type. */
const LLM_ASSUMPTIONS = Object.freeze({
  planningInputTokens: 2500,
  planningOutputTokens: 4000,
  animationInputTokens: 900,
  animationOutputTokens: 500,
});

/** Image providers that never bill a per-image API cost. */
const NON_BILLING_IMAGE_PROVIDERS = new Set(["real", "local", "mock", "ollama", "piper", "music-library"]);

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
  /**
   * Provider selections. Each defaults to `openai`; a `$0` backend
   * (`ollama` / `piper`) or an archival-photo image provider (`real` / `local`)
   * zeroes that component instead of being priced as OpenAI.
   */
  readonly textProvider?: string;
  readonly animationProvider?: string;
  readonly youtubeProvider?: string;
  readonly ttsProvider?: string;
  readonly imageProvider?: string;
  readonly thumbnailProvider?: string;
}

export interface ProductionCostEstimate {
  readonly status: "known" | "unknown";
  /** USD, or `NaN` when `status === "unknown"`. */
  readonly totalUsd: number;
  readonly budgetUsd: number;
  readonly withinBudget: boolean;
  readonly breakdown: {
    /** Text planning stages: research / script / scenes / audio-plan / assembly-plan / seo. */
    readonly llmUsd: number;
    /** Per-scene motion-plan LLM. */
    readonly animationUsd: number;
    /** YouTube publishing-package LLM. */
    readonly youtubeUsd: number;
    readonly ttsUsd: number;
    /** Per-scene AI image fallback. `$0` when `IMAGE_PROVIDER` is `real` / `local`. */
    readonly imageUsd: number;
    /** AI thumbnail generation. `$0` when `THUMBNAIL_PROVIDER` is `local` / `mock`. */
    readonly thumbnailUsd: number;
    readonly unknownComponents: readonly string[];
  };
  /** The provider each component was priced against. */
  readonly providers: {
    readonly text: string;
    readonly animation: string;
    readonly youtube: string;
    readonly tts: string;
    readonly image: string;
    readonly thumbnail: string;
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

  const textProvider = provider(inputs.textProvider);
  const animationProvider = provider(inputs.animationProvider);
  const youtubeProvider = provider(inputs.youtubeProvider);
  const ttsProvider = provider(inputs.ttsProvider);
  const imageProvider = provider(inputs.imageProvider);
  const thumbnailProvider = provider(inputs.thumbnailProvider);

  const unknown = new Set<string>();

  // --- LLM: text planning stages, the YouTube package call, one animation call per scene ---
  const planningCall = estimateTokenCost({
    provider: textProvider,
    model: inputs.textModel,
    promptTokens: LLM_ASSUMPTIONS.planningInputTokens,
    completionTokens: LLM_ASSUMPTIONS.planningOutputTokens,
  });
  const youtubeCall = estimateTokenCost({
    provider: youtubeProvider,
    model: inputs.textModel,
    promptTokens: LLM_ASSUMPTIONS.planningInputTokens,
    completionTokens: LLM_ASSUMPTIONS.planningOutputTokens,
  });
  const animationCall = estimateTokenCost({
    provider: animationProvider,
    model: inputs.textModel,
    promptTokens: LLM_ASSUMPTIONS.animationInputTokens,
    completionTokens: LLM_ASSUMPTIONS.animationOutputTokens,
  });
  if (
    planningCall.status === "unknown" ||
    youtubeCall.status === "unknown" ||
    animationCall.status === "unknown"
  ) unknown.add("llm");
  const llmUsd = round(safeCost(planningCall) * TEXT_PLANNING_CALLS);
  const youtubeUsd = round(safeCost(youtubeCall));
  const animationUsd = round(safeCost(animationCall) * sceneCount);

  // --- TTS: every chapter section + the full-narration mix ---
  const ttsCharacters = narrationCharacters * 2;
  const tts = estimateTtsCost({
    provider: ttsProvider,
    model: inputs.ttsModel,
    characters: ttsCharacters,
  });
  if (tts.status === "unknown") unknown.add("tts");
  const ttsUsd = round(safeCost(tts));

  // --- Images: the capped AI fallbacks. Only OpenAI bills; archival-photo
  //     ("real" / "local") image providers are $0. ---
  const imageBills = !NON_BILLING_IMAGE_PROVIDERS.has(imageProvider);
  let imageUsd = 0;
  if (imageBills && aiImages > 0) {
    const image = estimateImageCost({
      provider: imageProvider,
      model: inputs.imageModel,
      size: inputs.imageSize,
      quality: inputs.imageQuality,
      count: aiImages,
    });
    if (image.status === "unknown") unknown.add("image");
    imageUsd = round(safeCost(image));
  }

  // --- Thumbnail: one AI image generation when THUMBNAIL_PROVIDER=openai. ---
  const thumbnailBills = thumbnailProvider === "openai";
  let thumbnailUsd = 0;
  if (thumbnailBills) {
    const thumb = estimateImageCost({
      provider: thumbnailProvider,
      model: thumbnailProviderConfig.openai.model,
      size: thumbnailProviderConfig.openai.size,
      quality: "medium",
      count: 1,
    });
    if (thumb.status === "unknown") unknown.add("thumbnail");
    thumbnailUsd = round(safeCost(thumb));
  }

  const status: "known" | "unknown" = unknown.size > 0 ? "unknown" : "known";
  const totalUsd =
    status === "unknown"
      ? Number.NaN
      : round(llmUsd + animationUsd + youtubeUsd + ttsUsd + imageUsd + thumbnailUsd);
  const withinBudget = status === "known" && totalUsd <= budgetUsd;

  return {
    status,
    totalUsd,
    budgetUsd,
    withinBudget,
    breakdown: {
      llmUsd,
      animationUsd,
      youtubeUsd,
      ttsUsd,
      imageUsd,
      thumbnailUsd,
      unknownComponents: [...unknown].sort(),
    },
    providers: {
      text: textProvider,
      animation: animationProvider,
      youtube: youtubeProvider,
      tts: ttsProvider,
      image: imageProvider,
      thumbnail: thumbnailProvider,
    },
    counts: {
      chapters: chapterCount,
      planningLlmCalls: TEXT_PLANNING_CALLS + 1,
      animationLlmCalls: sceneCount,
      ttsCharacters,
      aiImages,
    },
  };
}

/**
 * P1: the same conservative pre-run estimate, but with the model / image / TTS
 * parameters taken from a {@link QualityPresetName} instead of passed in. The
 * planned AI-image count is clamped to the preset's `maxAiImages` ceiling (and
 * to `sceneCount`). Used by the cost report's per-preset comparison table.
 * Presets carry no provider choice, so this always prices against OpenAI.
 */
export function estimateProductionCostForPreset(
  preset: QualityPresetName,
  render: {
    readonly chapterCount: number;
    readonly sceneCount: number;
    readonly narrationCharacters: number;
    /** Defaults to the preset's `maxAiImages` ceiling (clamped to `sceneCount`). */
    readonly plannedAiImageCount?: number;
  },
  options: { budgetUsd?: number; env?: NodeJS.ProcessEnv } = {},
): ProductionCostEstimate {
  const spec = QUALITY_PRESETS[preset];
  const cappedAiImages = Math.max(
    0,
    Math.min(
      render.sceneCount,
      render.plannedAiImageCount ?? spec.maxAiImages,
      spec.maxAiImages,
    ),
  );
  return estimateProductionCost(
    {
      chapterCount: render.chapterCount,
      sceneCount: render.sceneCount,
      narrationCharacters: render.narrationCharacters,
      plannedAiImageCount: cappedAiImages,
      textModel: spec.textModel,
      ttsModel: spec.ttsModel,
      imageModel: spec.imageModel,
      imageSize: spec.imageSize,
      imageQuality: spec.imageQuality,
    },
    options,
  );
}

function safeCost(estimate: { status: string; costUsd: number }): number {
  return (estimate.status === "known" || estimate.status === "free") && Number.isFinite(estimate.costUsd)
    ? estimate.costUsd
    : 0;
}

/** Normalise a provider selection; absent / `mock` -> `openai` (conservative). */
function provider(value: string | undefined): string {
  const normalized = value?.trim().toLowerCase();
  return normalized && normalized !== "mock" ? normalized : "openai";
}

function nonNegInt(value: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
}

function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}
