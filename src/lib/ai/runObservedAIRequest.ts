import { aiProviderConfig } from "./AIProviderConfig";
import { AIUsageManager } from "./AIUsageManager";
import { AIRouter } from "./router/AIRouter";
import type { AIProvider } from "./providers";
import type {
  AIRequestContext,
  AIUsageProvider,
  AIUsageRecord,
} from "@/types/aiUsage";

export type ObservedAIRequestInput = {
  prompt: string;
  context: AIRequestContext;
  provider?: AIProvider;
};

export type ObservedAIRequestResult = {
  response: string;
  fallbackUsed: boolean;
  error?: string;
};

export async function runObservedAIRequest({
  prompt,
  context,
  provider,
}: ObservedAIRequestInput): Promise<ObservedAIRequestResult> {
  const startedAt = Date.now();
  const providerName = context.provider ?? aiProviderConfig.provider;
  const selectedProvider = provider ?? new AIRouter().getProvider(providerName);
  const projectSlug = context.projectSlug?.trim() || "unknown";
  let response = "";
  let error: string | undefined;

  try {
    response = await selectedProvider.generate(prompt);
  } catch (caughtError) {
    error =
      caughtError instanceof Error
        ? caughtError.message
        : "AI provider request failed.";
  }

  const fallbackUsed = Boolean(error) || !response.trim();
  const durationMs = Date.now() - startedAt;
  const record: AIUsageRecord = {
    id: crypto.randomUUID(),
    projectSlug,
    stage: context.stage ?? "unknown",
    operation: context.operation,
    provider: providerName,
    model: context.model ?? getModelName(providerName),
    status: error ? "failed" : fallbackUsed ? "fallback" : "success",
    fallbackUsed,
    durationMs,
    promptLength: prompt.length,
    responseLength: response.length,
    error,
    createdAt: new Date().toISOString(),
  };

  try {
    await AIUsageManager.appendRecord(record);
  } catch (usageError) {
    console.error("[AIUsage] Usage record could not be written:", usageError);
  }

  return {
    response,
    fallbackUsed,
    error,
  };
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
