import { aiProviderConfig } from "@/lib/ai/AIProviderConfig";
import { imageProviderConfig } from "@/lib/assets/providers/ImageProviderConfig";
import { getOpenAIAudioProviderConfig } from "@/lib/audio/providers/AudioProviderConfig";
import { AIUsageManager } from "@/lib/ai/AIUsageManager";
import {
  resolveAiCostBudgetUsd,
  summarizeObservedCost,
} from "@/lib/ai/AiCostBudget";
import {
  estimateProductionCost,
  type ProductionCostEstimate,
} from "./ProductionCostEstimate";
import { visualMediaAdmissionPolicy } from "@/lib/assets/VisualMediaAdmissionPolicy";
import type { ScriptData } from "@/types/script";
import type { SceneData } from "@/types/scene";

/**
 * Documentary media effort — Faz 6: the deterministic, $0 pre-run cost preflight.
 *
 * It answers "will a controlled production render of this project stay under the
 * `$1` AI budget?" BEFORE any paid call is made, by combining:
 *  - the already-observed spend on this project (`ai-usage.json`), and
 *  - a conservative estimate of the remaining paid work (`estimateProductionCost`).
 *
 * `decision: "block"` when the projected total exceeds the budget, when a model
 * has no price row (`status: "unknown"`), or when the observed spend already
 * meets the budget. The render must not start on a `block`.
 *
 * When the project has no script/scenes yet (a fresh topic), conservative
 * documentary defaults are used so the estimate still errs high.
 */

const DEFAULT_CHAPTER_COUNT = 6;
const DEFAULT_SCENE_COUNT = 16;
const DEFAULT_NARRATION_CHARACTERS = 9_000;

export interface ProductionCostPreflightInput {
  readonly projectSlug: string;
  readonly script?: ScriptData | null;
  readonly scenes?: SceneData | null;
  /** Planned AI-image fallbacks; defaults to the hard cap (`maxAiImages`). */
  readonly plannedAiImageCount?: number;
  readonly budgetUsd?: number;
  readonly env?: NodeJS.ProcessEnv;
}

export interface ProductionCostPreflightReport {
  readonly projectSlug: string;
  readonly decision: "pass" | "block";
  readonly blockReason?:
    | "projected-exceeds-budget"
    | "observed-exceeds-budget"
    | "unknown-pricing";
  readonly budgetUsd: number;
  readonly observedUsd: number;
  readonly observedHasUnknownPricing: boolean;
  readonly remainingEstimate: ProductionCostEstimate;
  readonly projectedTotalUsd: number;
  readonly withinBudget: boolean;
  readonly models: {
    readonly text: string;
    readonly tts: string;
    readonly image: string;
    readonly imageSize: string;
    readonly imageQuality: string;
  };
  /**
   * The provider each cost component was priced against, read from the
   * environment (`AI_PROVIDER`, `ANIMATION_PROVIDER`, `YOUTUBE_PROVIDER`,
   * `AUDIO_PROVIDER`, `IMAGE_PROVIDER`, `THUMBNAIL_PROVIDER`, plus the always-$0
   * `VIDEO_PROVIDER` / `VIDEO_ASSEMBLY_PROVIDER`). An unset value is reported as
   * `openai` (the conservative default that was priced).
   */
  readonly providers: {
    readonly text: string;
    readonly animation: string;
    readonly youtube: string;
    readonly tts: string;
    readonly image: string;
    readonly thumbnail: string;
    readonly video: string;
    readonly assembly: string;
  };
  /**
   * OpenAI-billed components that are NOT part of the core provider chain the
   * operator asked to zero out — surfaced here so a remaining real cost is never
   * hidden. Empty when nothing extra bills.
   */
  readonly otherOpenAiCostsUsd: number;
  readonly inputs: {
    readonly chapterCount: number;
    readonly sceneCount: number;
    readonly narrationCharacters: number;
    readonly plannedAiImageCount: number;
    readonly source: "script+scenes" | "partial" | "defaults";
  };
}

export async function buildProductionCostPreflight(
  input: ProductionCostPreflightInput,
): Promise<ProductionCostPreflightReport> {
  const env = input.env ?? process.env;
  const budgetUsd = input.budgetUsd ?? resolveAiCostBudgetUsd(env);

  const chapterCount = input.script?.chapters?.length ?? DEFAULT_CHAPTER_COUNT;
  const sceneCount = countScenes(input.scenes) ?? DEFAULT_SCENE_COUNT;
  const narrationCharacters = sumNarrationCharacters(input.script) ?? DEFAULT_NARRATION_CHARACTERS;
  const plannedAiImageCount =
    typeof input.plannedAiImageCount === "number" && input.plannedAiImageCount >= 0
      ? Math.trunc(input.plannedAiImageCount)
      : visualMediaAdmissionPolicy.maxAiImages;
  const source: ProductionCostPreflightReport["inputs"]["source"] = input.script && input.scenes
    ? "script+scenes"
    : input.script || input.scenes
      ? "partial"
      : "defaults";

  const models = {
    text: env.OPENAI_MODEL || aiProviderConfig.openai.model,
    tts: getOpenAIAudioProviderConfig().model,
    image: imageProviderConfig.openai.model,
    imageSize: imageProviderConfig.openai.size,
    imageQuality: imageProviderConfig.openai.quality,
  };

  // Provider selections drive which lines actually bill. Unset / `mock` is
  // priced as `openai` (conservative) — the same behaviour as before the
  // provider-aware change.
  const providerOf = (raw: string | undefined): string => {
    const value = raw?.trim().toLowerCase();
    return value && value !== "mock" ? value : "openai";
  };
  const providers = {
    text: providerOf(env.AI_PROVIDER),
    animation: providerOf(env.ANIMATION_PROVIDER),
    youtube: providerOf(env.YOUTUBE_PROVIDER),
    tts: providerOf(env.AUDIO_PROVIDER),
    image: providerOf(env.IMAGE_PROVIDER),
    thumbnail: providerOf(env.THUMBNAIL_PROVIDER),
    video: providerOf(env.VIDEO_PROVIDER),
    assembly: providerOf(env.VIDEO_ASSEMBLY_PROVIDER),
  };

  const remainingEstimate = estimateProductionCost(
    {
      chapterCount,
      sceneCount,
      narrationCharacters,
      plannedAiImageCount,
      textModel: models.text,
      ttsModel: models.tts,
      imageModel: models.image,
      imageSize: models.imageSize,
      imageQuality: models.imageQuality,
      textProvider: providers.text,
      animationProvider: providers.animation,
      youtubeProvider: providers.youtube,
      ttsProvider: providers.tts,
      imageProvider: providers.image,
      thumbnailProvider: providers.thumbnail,
    },
    { budgetUsd, env },
  );

  // A remaining OpenAI cost outside the "$0" chain (currently: the AI thumbnail
  // when THUMBNAIL_PROVIDER=openai) — reported, never hidden.
  const otherOpenAiCostsUsd = round(
    remainingEstimate.status === "known" ? remainingEstimate.breakdown.thumbnailUsd : 0,
  );

  let observedUsd = 0;
  let observedHasUnknownPricing = false;
  try {
    const summary = summarizeObservedCost((await AIUsageManager.getUsageLog(input.projectSlug)).records);
    observedUsd = summary.knownUsd;
    observedHasUnknownPricing = summary.unknownPricingRecordCount > 0;
  } catch {
    // No usage log yet (fresh project) — observed spend is 0.
  }

  const projectedTotalUsd =
    remainingEstimate.status === "unknown"
      ? Number.NaN
      : round(observedUsd + remainingEstimate.totalUsd);

  let decision: "pass" | "block" = "pass";
  let blockReason: ProductionCostPreflightReport["blockReason"];
  if (observedHasUnknownPricing || remainingEstimate.status === "unknown") {
    decision = "block";
    blockReason = "unknown-pricing";
  } else if (observedUsd >= budgetUsd) {
    decision = "block";
    blockReason = "observed-exceeds-budget";
  } else if (projectedTotalUsd > budgetUsd) {
    decision = "block";
    blockReason = "projected-exceeds-budget";
  }

  return {
    projectSlug: input.projectSlug,
    decision,
    ...(blockReason ? { blockReason } : {}),
    budgetUsd,
    observedUsd: round(observedUsd),
    observedHasUnknownPricing,
    remainingEstimate,
    projectedTotalUsd,
    withinBudget: decision === "pass",
    models,
    providers,
    otherOpenAiCostsUsd,
    inputs: { chapterCount, sceneCount, narrationCharacters, plannedAiImageCount, source },
  };
}

// --------------------------------------------------------------------------- internals

function countScenes(scenes: SceneData | null | undefined): number | null {
  if (!scenes || typeof scenes !== "object") return null;
  const value = scenes as { scenes?: unknown; chapters?: Array<{ scenes?: unknown }> };
  if (Array.isArray(value.scenes)) return value.scenes.length;
  if (Array.isArray(value.chapters)) {
    return value.chapters.reduce(
      (total, chapter) => total + (Array.isArray(chapter?.scenes) ? chapter.scenes.length : 0),
      0,
    );
  }
  return null;
}

function sumNarrationCharacters(script: ScriptData | null | undefined): number | null {
  if (!script || !Array.isArray(script.chapters) || script.chapters.length === 0) return null;
  const total = script.chapters.reduce(
    (sum, chapter) => sum + (typeof chapter?.narration === "string" ? chapter.narration.length : 0),
    0,
  );
  return total > 0 ? total : null;
}

function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}
