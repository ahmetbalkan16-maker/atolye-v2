import { aiProviderConfig } from "./AIProviderConfig";
import { AIUsageManager } from "./AIUsageManager";
import { AIRouter } from "./router/AIRouter";
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
  let response = "";
  let result: AIProviderResult | undefined;
  let errorCode: AIResponseErrorCode | undefined;

  try {
    result = normalizeProviderOutput(await selectedProvider.generate(prompt, { maxTokens }));
    response = result.content;
    if (result.refused) errorCode = "AI_PROVIDER_REFUSAL";
    else if (result.truncated || result.finishReason === "length") errorCode = "AI_RESPONSE_TRUNCATED";
    else if (!result.complete) errorCode = "AI_RESPONSE_INCOMPLETE";
  } catch {
    errorCode = "AI_PROVIDER_REQUEST_FAILED";
  }

  const fallbackUsed = Boolean(errorCode) || !response.trim();
  const durationMs = Date.now() - startedAt;
  const record: AIUsageRecord = {
    id: crypto.randomUUID(),
    projectSlug,
    stage: context.stage ?? "unknown",
    operation: context.operation,
    provider: providerName,
    model: context.model ?? getModelName(providerName),
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
