import { aiProviderConfig } from "./AIProviderConfig";
import { AIUsageManager } from "./AIUsageManager";
import { AIRouter } from "./router/AIRouter";
import {
  estimateTokenCallCeiling,
  estimateTokenCost,
  toUsageCostFields,
} from "./AiPricing";
import { evaluateAiCostBudget, isAiCostGuardEnabled } from "./AiCostBudget";
import type { AIProvider, AIProviderOutput, AIProviderResult } from "./providers";
import type { AIResponseErrorCode } from "./AIResponseError";
import type {
  AIRequestContext,
  AIUsageProvider,
  AIUsageRecord,
} from "@/types/aiUsage";

export type ObservedAIRequestInput = {
  prompt: string;
  context: AIRequestContext;
  provider?: AIProvider;
  maxTokens?: number;
};

export type ObservedAIRequestResult = {
  response: string;
  fallbackUsed: boolean;
  errorCode?: AIResponseErrorCode;
  finishReason?: AIProviderResult["finishReason"];
  refused: boolean;
  responseComplete: boolean;
  truncated: boolean;
  usage?: AIProviderResult["usage"];
  telemetryPersisted: boolean;
};

export async function runObservedAIRequest({
  prompt,
  context,
  provider,
  maxTokens,
}: ObservedAIRequestInput): Promise<ObservedAIRequestResult> {
  const startedAt = Date.now();
  const providerName = context.provider ?? aiProviderConfig.provider;
  const selectedProvider = provider ?? new AIRouter().getProvider(providerName);
  const projectSlug = context.projectSlug?.trim() || "unknown";
  const resolvedModel = context.model ?? getModelName(providerName);
  let response = "";
  let result: AIProviderResult | undefined;
  let errorCode: AIResponseErrorCode | undefined;

  // Faz 5: fail closed BEFORE the paid call when the $1 budget would be blown.
  // `unknown` project or a free (mock) provider never trips this.
  const budgetBlock = await checkCostBudgetBeforeDispatch({
    projectSlug,
    providerName,
    model: resolvedModel,
    promptChars: prompt.length,
    maxTokens,
  });
  if (budgetBlock) {
    errorCode = "AI_COST_BUDGET_EXCEEDED";
  } else {
    try {
      result = normalizeProviderOutput(await selectedProvider.generate(prompt, { maxTokens }));
      response = result.content;
      if (result.refused) errorCode = "AI_PROVIDER_REFUSAL";
      else if (result.truncated || result.finishReason === "length") errorCode = "AI_RESPONSE_TRUNCATED";
      else if (!result.complete) errorCode = "AI_RESPONSE_INCOMPLETE";
    } catch {
      errorCode = "AI_PROVIDER_REQUEST_FAILED";
    }
  }

  const fallbackUsed = Boolean(errorCode) || !response.trim();
  const durationMs = Date.now() - startedAt;
  const cost = toUsageCostFields(
    estimateTokenCost({
      provider: providerName,
      model: resolvedModel,
      promptTokens: result?.usage?.promptTokens,
      completionTokens: result?.usage?.completionTokens,
    }),
  );
  const record: AIUsageRecord = {
    id: crypto.randomUUID(),
    projectSlug,
    stage: context.stage ?? "unknown",
    operation: context.operation,
    provider: providerName,
    model: resolvedModel,
    status: errorCode ? "failed" : fallbackUsed ? "fallback" : "success",
    fallbackUsed,
    durationMs,
    promptLength: prompt.length,
    responseLength: response.length,
    finishReason: result?.finishReason,
    refused: result?.refused ?? false,
    responseComplete: result?.complete ?? false,
    truncated: result?.truncated ?? false,
    promptTokens: result?.usage?.promptTokens,
    completionTokens: result?.usage?.completionTokens,
    totalTokens: result?.usage?.totalTokens,
    // A blocked call made no request, so it cost nothing.
    estimatedCost: budgetBlock ? 0 : cost.estimatedCost,
    pricingStatus: budgetBlock ? "free" : cost.pricingStatus,
    costUnitKind: cost.costUnitKind,
    costUnitCount: budgetBlock ? 0 : cost.costUnitCount,
    error: errorCode,
    errorCode,
    createdAt: new Date().toISOString(),
  };

  let telemetryPersisted = true;
  try {
    await AIUsageManager.appendRecord(record);
  } catch {
    telemetryPersisted = false;
  }

  return {
    response,
    fallbackUsed,
    errorCode: errorCode ?? (!telemetryPersisted ? "AI_USAGE_PERSISTENCE_FAILED" : undefined),
    finishReason: result?.finishReason,
    refused: result?.refused ?? false,
    responseComplete: result?.complete ?? false,
    truncated: result?.truncated ?? false,
    usage: result?.usage,
    telemetryPersisted,
  };
}

/**
 * Faz 5 pre-dispatch cost guard. Returns `true` when the paid request must NOT
 * be made because the `$1` per-video budget would be exceeded (or cannot be
 * proven safe). A free provider (mock) and the context-less `"unknown"` project
 * always return `false`.
 */
async function checkCostBudgetBeforeDispatch(input: {
  projectSlug: string;
  providerName: AIUsageProvider;
  model: string | undefined;
  promptChars: number;
  maxTokens: number | undefined;
}): Promise<boolean> {
  if (input.projectSlug === "unknown" || !isAiCostGuardEnabled()) return false;

  const ceiling = estimateTokenCallCeiling({
    provider: input.providerName,
    model: input.model,
    promptChars: input.promptChars,
    maxTokens: input.maxTokens ?? null,
  });
  if (ceiling.status === "free") return false;

  let records: readonly AIUsageRecord[] = [];
  try {
    records = (await AIUsageManager.getUsageLog(input.projectSlug)).records;
  } catch {
    // Treat an unreadable log as "no prior spend": the pending-call ceiling
    // below is still checked (an unknown-priced pending call still blocks).
    records = [];
  }

  const decision = evaluateAiCostBudget({
    records,
    pendingUsd: ceiling.status === "known" ? ceiling.costUsd : 0,
    pendingPricingUnknown: ceiling.status === "unknown",
  });
  return !decision.allowed;
}

function normalizeProviderOutput(output: AIProviderOutput): AIProviderResult {
  if (typeof output === "string") {
    return {
      content: output,
      finishReason: "unknown",
      refused: false,
      complete: true,
      truncated: false,
    };
  }
  return output;
}

function getModelName(provider: AIUsageProvider): string | undefined {
  if (provider === "openai") {
    return aiProviderConfig.openai.model;
  }

  if (provider === "mock") {
    return "mock-ai-provider";
  }

  return undefined;
}
