import { createProviderDispatchAdapter } from "@/lib/providers/ProviderDispatchAdapterAuthority";
import { resolveOllamaConfig, type OllamaConfig } from "../OllamaConfig";
import type {
  AIProviderGenerateOptions,
  AIProviderResult,
  ConfiguredAIProvider,
} from "./AIProvider";

type Fetcher = typeof fetch;

/**
 * Local LLM provider. Talks to Ollama's OpenAI-compatible
 * `POST {OLLAMA_HOST}/v1/chat/completions` — no API key, no per-call cost.
 * Opt-in via `AI_PROVIDER=ollama`. The response is normalised to the exact same
 * `AIProviderResult` shape as `OpenAIProvider`, so every downstream strict
 * parser / validator is unchanged.
 */
export class OllamaProvider implements ConfiguredAIProvider {
  constructor(
    private readonly fetcher: Fetcher = fetch,
    private readonly loadConfig: () => OllamaConfig = resolveOllamaConfig,
  ) {}

  createImmutableAiDispatchAdapter() {
    return createProviderDispatchAdapter(this, {
      metadata: { name: "ollama" }, requiredMethods: ["generate"],
    });
  }

  async generate(
    prompt: string,
    options?: AIProviderGenerateOptions,
  ): Promise<AIProviderResult> {
    const config = this.loadConfig();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
      const response = await this.fetcher(`${config.baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: config.model,
          messages: [{ role: "user", content: prompt }],
          max_tokens: options?.maxTokens ?? config.maxTokens,
          temperature: config.temperature,
          stream: false,
          ...(config.format === "json"
            ? { response_format: { type: "json_object" } }
            : {}),
        }),
        signal: controller.signal,
        redirect: "error",
      });

      if (!response.ok) {
        throw new Error(`Ollama request failed: ${response.status}`);
      }

      const payload = (await response.json()) as OllamaChatResponse;
      const choice = payload?.choices?.[0];
      const content = typeof choice?.message?.content === "string"
        ? choice.message.content
        : "";
      const finishReason = normalizeFinishReason(choice?.finish_reason);
      const refused = Boolean(choice?.message?.refusal);
      return {
        content,
        finishReason,
        refused,
        complete: finishReason === "stop" && !refused && content.trim().length > 0,
        truncated: finishReason === "length",
        ...(payload?.usage
          ? {
              usage: {
                promptTokens: safeTokenCount(payload.usage.prompt_tokens),
                completionTokens: safeTokenCount(payload.usage.completion_tokens),
                totalTokens: safeTokenCount(payload.usage.total_tokens),
              },
            }
          : {}),
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

interface OllamaChatResponse {
  choices?: Array<{
    finish_reason?: string | null;
    message?: { content?: string | null; refusal?: string | null };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

function normalizeFinishReason(
  value: string | null | undefined,
): AIProviderResult["finishReason"] {
  if (value === "stop" || value === "length") return value;
  if (value === "content_filter") return "content-filter";
  if (value === "tool_calls" || value === "function_call") return "tool-calls";
  // Ollama commonly omits finish_reason on a clean completion.
  if (value === null || value === undefined || value === "") return "stop";
  return "unknown";
}

function safeTokenCount(value: number | undefined) {
  return Number.isSafeInteger(value) && (value as number) >= 0 ? value : undefined;
}
