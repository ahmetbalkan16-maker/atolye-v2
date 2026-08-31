import {
  resolveAiCostBudgetUsd,
  resolveRecordCost,
  summarizeObservedCost,
} from "@/lib/ai/AiCostBudget";
import { estimateImageCost } from "@/lib/ai/AiPricing";
import { FileStorage } from "@/lib/storage/FileStorage";
import type { RuntimeStorageInput } from "@/lib/runtime/RuntimeStoragePaths";
import type { AIUsageLog, AIUsageRecord } from "@/types/aiUsage";
import { estimateProductionCostForPreset } from "./ProductionCostEstimate";
import {
  DEFAULT_QUALITY_PRESET,
  QUALITY_PRESETS,
  QUALITY_PRESET_NAMES,
  resolveQualityPresetName,
  type QualityPresetName,
} from "./QualityPreset";

/**
 * Documentary pipeline revision — P1: the human-readable production cost report.
 *
 * Folds `ai-usage.json` + a few render facts (from the manifest / scenes /
 * assembly) into the fixed `=== ATÖLYE DOCUMENTARY PRODUCTION COST ===` report:
 * per-category spend (LLM / IMAGE / VIDEO / TTS / MUSIC-SFX / OTHER), retry cost,
 * an *estimated* cache-savings figure, cost per minute / per scene, and a
 * per-preset comparison for this render's script.
 *
 * The USD figures for what actually ran are labelled `actual` — they are the
 * metered token / character / image counts from the real calls priced against
 * the `AiPricing` list table (a deterministic estimate of list price, not a
 * billing pull). The preset-comparison rows are labelled `estimated` — they use
 * assumed token counts. A render with any `pricingStatus: "unknown"` record is
 * reported `status: "unknown-pricing"`, never silently as a number.
 */

const REPORT_FILE = "production-cost-report.json";

export type ProductionCostCategory =
  | "llm"
  | "image"
  | "video"
  | "tts"
  | "music-sfx"
  | "other";

export const PRODUCTION_COST_CATEGORIES: readonly ProductionCostCategory[] = Object.freeze([
  "llm",
  "image",
  "video",
  "tts",
  "music-sfx",
  "other",
]);

/**
 * Which cost bucket a usage record belongs to — derived from what was metered
 * (`costUnitKind`) first, then the stage / operation. `costUnitKind` is
 * authoritative because the visuals stage emits both a token-metered plan call
 * (`llm`) and an image-metered generation call (`image`).
 */
export function categorizeUsageRecord(record: AIUsageRecord): ProductionCostCategory {
  const stage = typeof record.stage === "string" ? record.stage.toLowerCase() : "";
  const op = typeof record.operation === "string" ? record.operation.toLowerCase() : "";
  const unit = record.costUnitKind;

  if (unit === "images" || /(^|[^a-z])image|thumbnail/.test(op) || stage === "thumbnail") {
    return "image";
  }
  if (unit === "characters" || /tts|narrat|speech|synth|voice/.test(op)) return "tts";
  if (stage === "video" || /(^|[^a-z])video|t2v|text-to-video/.test(op)) return "video";
  if (/music|sfx|ambien|sound-?effect|score/.test(`${stage} ${op}`)) return "music-sfx";
  if (
    unit === "tokens" ||
    /research|script|scene|visual|animation|audio|assembly|seo|youtube|plan|prompt/.test(
      `${stage} ${op}`,
    )
  ) {
    return "llm";
  }
  return "other";
}

export interface ProductionRenderFacts {
  /** Finished-video length, seconds (from the validated MP4 / assembly). */
  readonly durationSeconds: number;
  readonly sceneCount: number;
  readonly chapterCount: number;
  /** Total characters of narration across every chapter (drives the TTS projection). */
  readonly narrationCharacters: number;
  /** AI images actually generated this render. */
  readonly aiImageCount: number;
  /** Real AI text-to-video clips generated this render (0 until P6). */
  readonly aiVideoCount: number;
  /** Assets served from cache / reused instead of regenerated. */
  readonly cachedAssetCount: number;
  /** Total stage attempts beyond the first (from the job records). */
  readonly retryCount: number;
}

export interface PresetCostProjection {
  readonly preset: QualityPresetName;
  readonly status: "known" | "unknown";
  /** USD, or `NaN` when `status === "unknown"`. */
  readonly totalUsd: number;
  readonly withinCeiling: boolean;
}

export interface ProductionCostReport {
  readonly schemaVersion: "production-cost-report-v1";
  readonly projectSlug: string;
  readonly currency: "USD";
  readonly activePreset: QualityPresetName;
  readonly budgetUsd: number;
  readonly facts: ProductionRenderFacts;

  readonly llmCallCount: number;
  readonly billableCallCount: number;
  readonly freeCallCount: number;
  readonly unknownPricingCount: number;

  /** Metered spend by bucket (USD). Every category is present, 0 when unused. */
  readonly byCategory: Readonly<Record<ProductionCostCategory, number>>;
  readonly totalUsd: number;
  readonly retryUsd: number;
  readonly duplicateUsd: number;
  /** ESTIMATED: what regenerating the cached assets would have cost at the active preset's image price. */
  readonly cacheSavingsUsdEstimated: number;

  readonly costPerMinuteUsd: number;
  readonly costPerSceneUsd: number;

  readonly withinBudget: boolean;
  readonly status: "within-budget" | "budget-exceeded" | "unknown-pricing";

  /** ESTIMATED per-preset cost for THIS render's script / scene counts. */
  readonly presetProjections: readonly PresetCostProjection[];
  readonly generatedAt: string;
}

function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

export function buildProductionCostReport(input: {
  readonly projectSlug: string;
  readonly usage: AIUsageLog;
  readonly facts: ProductionRenderFacts;
  readonly budgetUsd?: number;
  readonly env?: NodeJS.ProcessEnv;
  readonly now?: () => string;
}): ProductionCostReport {
  const env = input.env ?? process.env;
  const budgetUsd = input.budgetUsd ?? resolveAiCostBudgetUsd(env);
  const activePreset = resolveActivePreset(env);
  const records = input.usage.records ?? [];
  const summary = summarizeObservedCost(records);

  const byCategory: Record<ProductionCostCategory, number> = {
    llm: 0, image: 0, video: 0, tts: 0, "music-sfx": 0, other: 0,
  };
  let llmCallCount = 0;
  for (const record of records) {
    const resolved = resolveRecordCost(record);
    const category = categorizeUsageRecord(record);
    if (category === "llm" && resolved.status !== "free") llmCallCount += 1;
    if (resolved.status !== "known") continue;
    byCategory[category] = round(byCategory[category] + resolved.costUsd);
  }

  const totalUsd = round(
    PRODUCTION_COST_CATEGORIES.reduce((sum, category) => sum + byCategory[category], 0),
  );
  const hasUnknown = summary.unknownPricingRecordCount > 0;
  const overBudget = totalUsd > budgetUsd;
  const status: ProductionCostReport["status"] = hasUnknown
    ? "unknown-pricing"
    : overBudget
      ? "budget-exceeded"
      : "within-budget";

  const minutes = input.facts.durationSeconds > 0 ? input.facts.durationSeconds / 60 : 0;
  const perImage = estimateImageCost({
    provider: "openai",
    model: QUALITY_PRESETS[activePreset].imageModel,
    size: QUALITY_PRESETS[activePreset].imageSize,
    quality: QUALITY_PRESETS[activePreset].imageQuality,
    count: 1,
  });
  const cacheSavingsUsdEstimated = round(
    Math.max(0, input.facts.cachedAssetCount) *
      (perImage.status === "known" ? perImage.costUsd : 0),
  );

  const presetProjections = QUALITY_PRESET_NAMES.map<PresetCostProjection>((preset) => {
    const estimate = estimateProductionCostForPreset(
      preset,
      {
        chapterCount: input.facts.chapterCount,
        sceneCount: input.facts.sceneCount,
        narrationCharacters: input.facts.narrationCharacters,
      },
      { env },
    );
    return {
      preset,
      status: estimate.status,
      totalUsd: estimate.totalUsd,
      withinCeiling:
        estimate.status === "known" && estimate.totalUsd <= QUALITY_PRESETS[preset].costCeilingUsd,
    };
  });

  return {
    schemaVersion: "production-cost-report-v1",
    projectSlug: input.projectSlug,
    currency: "USD",
    activePreset,
    budgetUsd,
    facts: input.facts,
    llmCallCount,
    billableCallCount: summary.knownRecordCount,
    freeCallCount: summary.freeRecordCount,
    unknownPricingCount: summary.unknownPricingRecordCount,
    byCategory,
    totalUsd,
    retryUsd: summary.retryUsd,
    duplicateUsd: summary.duplicateUsd,
    cacheSavingsUsdEstimated,
    costPerMinuteUsd: minutes > 0 ? round(totalUsd / minutes) : 0,
    costPerSceneUsd:
      input.facts.sceneCount > 0 ? round(totalUsd / input.facts.sceneCount) : 0,
    withinBudget: status === "within-budget",
    status,
    presetProjections,
    generatedAt: (input.now ?? (() => new Date().toISOString()))(),
  };
}

function resolveActivePreset(env: NodeJS.ProcessEnv): QualityPresetName {
  try {
    return resolveQualityPresetName(env);
  } catch {
    return DEFAULT_QUALITY_PRESET;
  }
}

function usd(value: number): string {
  return Number.isFinite(value) ? `$${value.toFixed(4)}` : "$   —   ";
}

function clock(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(s / 60);
  return `${m}m ${String(s % 60).padStart(2, "0")}s (${s}s)`;
}

/** Render the fixed `=== ATÖLYE DOCUMENTARY PRODUCTION COST ===` text block. */
export function renderProductionCostReportText(report: ProductionCostReport): string {
  const f = report.facts;
  const actual = report.status === "unknown-pricing" ? "(partly unknown)" : "(actual)";
  const lines: string[] = [];
  lines.push("=== ATÖLYE DOCUMENTARY PRODUCTION COST ===");
  lines.push("");
  lines.push(`Duration:            ${clock(f.durationSeconds)}`);
  lines.push(`Scenes:              ${f.sceneCount}`);
  lines.push(`Images generated:    ${f.aiImageCount}`);
  lines.push(`AI videos generated: ${f.aiVideoCount}`);
  lines.push(`TTS characters:      ${f.narrationCharacters.toLocaleString("en-US")}`);
  lines.push(`LLM calls:           ${report.llmCallCount}`);
  lines.push(`Cached assets:       ${f.cachedAssetCount}`);
  lines.push(`Retries:             ${f.retryCount}`);
  lines.push("");
  lines.push(`LLM:                 ${usd(report.byCategory.llm)}  ${actual}`);
  lines.push(`IMAGE:               ${usd(report.byCategory.image)}  ${actual}`);
  lines.push(`VIDEO:               ${usd(report.byCategory.video)}`);
  lines.push(`TTS:                 ${usd(report.byCategory.tts)}  ${actual}`);
  lines.push(`MUSIC/SFX:           ${usd(report.byCategory["music-sfx"])}`);
  lines.push(`OTHER:               ${usd(report.byCategory.other)}`);
  lines.push(`RETRY COST:          ${usd(report.retryUsd)}`);
  lines.push(`CACHE SAVINGS:       ~${usd(report.cacheSavingsUsdEstimated)}  (estimated)`);
  lines.push("");
  lines.push(`TOTAL:               ${usd(report.totalUsd)}  ${actual}`);
  if (report.unknownPricingCount > 0) {
    lines.push(`  ! ${report.unknownPricingCount} call(s) have no price row — total is a lower bound.`);
  }
  lines.push("");
  lines.push(`Cost / minute:       ${usd(report.costPerMinuteUsd)}`);
  lines.push(`Cost / scene:        ${usd(report.costPerSceneUsd)}`);
  lines.push("");
  const verdict = report.status === "within-budget"
    ? "WITHIN BUDGET"
    : report.status === "budget-exceeded"
      ? "OVER BUDGET"
      : "UNKNOWN PRICING — FAIL CLOSED";
  lines.push(`Budget:              $${report.budgetUsd.toFixed(2)}  ->  ${verdict}`);
  lines.push("");
  lines.push("--- Preset comparison (estimated, this render's script/scenes) ---");
  for (const projection of report.presetProjections) {
    const tag = projection.preset === report.activePreset ? "  (active)" : "";
    const value = projection.status === "known" ? `~$${projection.totalUsd.toFixed(4)}` : "~   ?   ";
    lines.push(`${projection.preset.toUpperCase().padEnd(12)} ${value}${tag}`);
  }
  return `${lines.join("\n")}\n`;
}

/** Persist the report to `data/projects/<slug>/production-cost-report.json`. */
export function persistProductionCostReport(
  report: ProductionCostReport,
  input: RuntimeStorageInput = {},
): void {
  FileStorage.saveJson(
    `data/projects/${report.projectSlug}/${REPORT_FILE}`,
    report,
    input,
  );
}
