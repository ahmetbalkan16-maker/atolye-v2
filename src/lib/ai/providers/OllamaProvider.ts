import { createProviderDispatchAdapter } from "@/lib/providers/ProviderDispatchAdapterAuthority";
import { resolveOllamaConfig, type OllamaConfig } from "../OllamaConfig";
import type {
  AIProviderGenerateOptions,
  AIProviderResult,
  ConfiguredAIProvider,
} from "./AIProvider";

type Fetcher = typeof fetch;

/**
 * Local LLM provider. Talks to Ollama's native `POST {OLLAMA_HOST}/api/chat`
 * (no API key, no per-call cost) with `format: "json"` — or, when the caller
 * passes a JSON Schema, `format: <schema>` for grammar-constrained decoding so
 * even a small model produces schema-conforming output. Opt-in via
 * `AI_PROVIDER=ollama`. The response is normalised to the same
 * `AIProviderResult` shape as `OpenAIProvider`.
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
    const attempts = 1 + Math.max(0, config.maxRetries);

    let last: AIProviderResult | undefined;
    let lastError: unknown;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      // A small local model sometimes runs long and Ollama cuts it mid-JSON
      // (`done_reason: "length"`), or returns an empty message. Re-roll a few
      // times — and ease the temperature down each retry so the reply gets more
      // concise / deterministic and is more likely to close its JSON.
      const temperature = attempt === 0
        ? config.temperature
        : Math.max(0, config.temperature * (1 - attempt / attempts));
      try {
        last = await this.callOnce(prompt, options, config, temperature);
      } catch (error) {
        lastError = error;
        continue;
      }
      if (last.complete && !last.truncated) return last;
    }
    if (last) return last;
    throw lastError ?? new Error("Ollama request failed.");
  }

  private async callOnce(
    prompt: string,
    options: AIProviderGenerateOptions | undefined,
    config: OllamaConfig,
    temperature: number,
  ): Promise<AIProviderResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
      const format = options?.jsonSchema
        ? options.jsonSchema
        : config.format === "json"
          ? "json"
          : undefined;
      const response = await this.fetcher(`${config.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: config.model,
          messages: [{ role: "user", content: prompt }],
          stream: false,
          ...(format !== undefined ? { format } : {}),
          options: {
            temperature,
            num_predict: options?.maxTokens ?? config.maxTokens,
            ...(config.numCtx !== undefined ? { num_ctx: config.numCtx } : {}),
          },
        }),
        signal: controller.signal,
        redirect: "error",
      });

      if (!response.ok) {
        throw new Error(`Ollama request failed: ${response.status}`);
      }

      const payload = (await response.json()) as OllamaChatResponse;
      const content = typeof payload?.message?.content === "string"
        ? payload.message.content
        : "";
      const finishReason = normalizeFinishReason(payload?.done_reason, payload?.done);
      return {
        content,
        finishReason,
        refused: false,
        complete: finishReason === "stop" && content.trim().length > 0,
        truncated: finishReason === "length",
        ...(hasUsage(payload)
          ? {
              usage: {
                promptTokens: safeTokenCount(payload.prompt_eval_count),
                completionTokens: safeTokenCount(payload.eval_count),
                totalTokens: safeTokenCount(
                  (payload.prompt_eval_count ?? 0) + (payload.eval_count ?? 0),
                ),
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
  message?: { content?: string | null };
  done?: boolean;
  done_reason?: string | null;
  prompt_eval_count?: number;
  eval_count?: number;
}

function hasUsage(payload: OllamaChatResponse): boolean {
  return typeof payload?.prompt_eval_count === "number" ||
    typeof payload?.eval_count === "number";
}

function normalizeFinishReason(
  doneReason: string | null | undefined,
  done: boolean | undefined,
): AIProviderResult["finishReason"] {
  if (doneReason === "stop") return "stop";
  if (doneReason === "length") return "length";
  // Ollama emits done_reason: "stop" on a clean finish; older builds only set done.
  if (done === true && (doneReason === undefined || doneReason === null)) return "stop";
  if (doneReason === undefined || doneReason === null || doneReason === "") return "stop";
  return "unknown";
}

function safeTokenCount(value: number | undefined) {
  return Number.isSafeInteger(value) && (value as number) >= 0 ? value : undefined;
}
