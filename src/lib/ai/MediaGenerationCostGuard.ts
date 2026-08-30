import { AIUsageManager } from "./AIUsageManager";
import {
  estimateImageCost,
  estimateTtsCost,
  toUsageCostFields,
  type AiCostEstimate,
} from "./AiPricing";
import {
  AiCostBudgetExceededError,
  evaluateAiCostBudget,
  isAiCostGuardEnabled,
} from "./AiCostBudget";
import type { AIUsageRecord, AIUsageStage } from "@/types/aiUsage";

/**
 * Documentary media effort — Faz 5: cost accounting + the `$1` budget guard for
 * the non-token providers (image + TTS). `runObservedAIRequest` covers every
 * token call; these two providers record and gate their spend here so the guard
 * sees the full picture.
 *
 *  - `assertImageBudget` / `assertTtsBudget` fail **closed** BEFORE a paid
 *    request when the projected spend would exceed the budget (or cannot be
 *    proven safe). They throw `AiCostBudgetExceededError`.
 *  - `recordImageUsage` / `recordTtsUsage` append a priced `AIUsageRecord`
 *    after the call, so the cumulative total stays accurate.
 *
 * The `"unknown"` project slug and a `mock` / free provider are always allowed
 * and recorded as free — the mock-only test suites are unaffected.
 */

export interface ImageDispatchDescriptor {
  readonly projectSlug: string;
  readonly provider: string;
  readonly model: string | null | undefined;
  readonly size: string | null | undefined;
  readonly quality?: string | null | undefined;
  readonly count: number;
}

export interface TtsDispatchDescriptor {
  readonly projectSlug: string;
  readonly provider: string;
  readonly model: string | null | undefined;
  readonly characters: number;
}

export async function assertImageBudget(descriptor: ImageDispatchDescriptor): Promise<void> {
  await assertBudget(
    descriptor.projectSlug,
    estimateImageCost({
      provider: descriptor.provider,
      model: descriptor.model,
      size: descriptor.size,
      quality: descriptor.quality,
      count: descriptor.count,
    }),
  );
}

export async function assertTtsBudget(descriptor: TtsDispatchDescriptor): Promise<void> {
  await assertBudget(
    descriptor.projectSlug,
    estimateTtsCost({
      provider: descriptor.provider,
      model: descriptor.model,
      characters: descriptor.characters,
    }),
  );
}

export async function recordImageUsage(input: {
  readonly projectSlug: string;
  readonly sceneId?: number;
  readonly provider: string;
  readonly model: string | null | undefined;
  readonly size: string | null | undefined;
  readonly quality?: string | null | undefined;
  readonly count: number;
  readonly status: AIUsageRecord["status"];
  readonly durationMs?: number;
  readonly error?: string;
}): Promise<void> {
  const cost = toUsageCostFields(
    estimateImageCost({
      provider: input.provider,
      model: input.model,
      size: input.size,
      quality: input.quality,
      count: input.count,
    }),
  );
  await safeAppend({
    projectSlug: input.projectSlug,
    stage: "visuals",
    operation: input.sceneId ? `image-scene-${input.sceneId}` : "image",
    provider: input.provider,
    model: typeof input.model === "string" ? input.model : undefined,
    status: input.status,
    durationMs: input.durationMs,
    error: input.error,
    sceneId: input.sceneId,
    cost,
  });
}

export async function recordTtsUsage(input: {
  readonly projectSlug: string;
  readonly chapterId?: number;
  readonly provider: string;
  readonly model: string | null | undefined;
  readonly characters: number;
  readonly status: AIUsageRecord["status"];
  readonly durationMs?: number;
  readonly error?: string;
}): Promise<void> {
  const cost = toUsageCostFields(
    estimateTtsCost({
      provider: input.provider,
      model: input.model,
      characters: input.characters,
    }),
  );
  await safeAppend({
    projectSlug: input.projectSlug,
    stage: "audio",
    operation: input.chapterId ? `tts-chapter-${input.chapterId}` : "tts-mix",
    provider: input.provider,
    model: typeof input.model === "string" ? input.model : undefined,
    status: input.status,
    durationMs: input.durationMs,
    error: input.error,
    cost,
  });
}

// --------------------------------------------------------------------------- internals

async function assertBudget(projectSlug: string, estimate: AiCostEstimate): Promise<void> {
  const slug = projectSlug?.trim() || "unknown";
  if (slug === "unknown" || estimate.status === "free" || !isAiCostGuardEnabled()) return;

  let records: readonly AIUsageRecord[] = [];
  try {
    records = (await AIUsageManager.getUsageLog(slug)).records;
  } catch {
    // Treat an unreadable log as "no prior spend": the pending-call estimate
    // below is still checked, and an unknown-priced pending call still blocks.
    records = [];
  }

  const decision = evaluateAiCostBudget({
    records,
    pendingUsd: estimate.status === "known" ? estimate.costUsd : 0,
    pendingPricingUnknown: estimate.status === "unknown",
  });
  if (!decision.allowed) throw new AiCostBudgetExceededError(decision);
}

async function safeAppend(input: {
  projectSlug: string;
  stage: AIUsageStage;
  operation: string;
  provider: string;
  model: string | undefined;
  status: AIUsageRecord["status"];
  durationMs: number | undefined;
  error: string | undefined;
  sceneId?: number;
  cost: ReturnType<typeof toUsageCostFields>;
}): Promise<void> {
  const slug = input.projectSlug?.trim() || "unknown";
  if (slug === "unknown" || !isAiCostGuardEnabled()) return;
  try {
    await AIUsageManager.appendRecord({
      id: crypto.randomUUID(),
      projectSlug: slug,
      stage: input.stage,
      operation: input.operation,
      provider: input.provider as AIUsageRecord["provider"],
      model: input.model,
      status: input.status,
      fallbackUsed: input.status !== "success",
      durationMs: input.durationMs ?? 0,
      promptLength: 0,
      estimatedCost: input.cost.estimatedCost,
      pricingStatus: input.cost.pricingStatus,
      costUnitKind: input.cost.costUnitKind,
      costUnitCount: input.cost.costUnitCount,
      ...(typeof input.sceneId === "number" ? { sceneId: input.sceneId } : {}),
      ...(input.error ? { error: input.error, errorCode: input.error } : {}),
      createdAt: new Date().toISOString(),
    });
  } catch {
    // Usage telemetry is best-effort; a persistence failure must not fail the stage.
  }
}
