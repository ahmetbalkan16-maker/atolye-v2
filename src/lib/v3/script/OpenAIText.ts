import { aiProviderConfig } from "../../ai/AIProviderConfig";
import type { AIProvider, AIProviderGenerateOptions, AIProviderResult } from "../../ai/providers/AIProvider";
import type { CachedUsage } from "./V3Budget";

const count = (v: unknown) => (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : undefined);

/**
 * OpenAI chat for text, the same request as the main app's OpenAIProvider (one user message, its temperature), kept
 * inside V3 so that provider does not change (as OpenAIVision); it adds the prompt tokens OpenAI read from its cache
 * to the usage (V3Budget prices them at the cached rate — the main app's provider does not report them).
 */
export class OpenAITextProvider implements AIProvider {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async generate(prompt: string, options?: AIProviderGenerateOptions): Promise<AIProviderResult> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OpenAI: OPENAI_API_KEY yok");
    const res = await this.fetchImpl("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: options?.model ?? aiProviderConfig.openai.model, messages: [{ role: "user", content: prompt }], max_tokens: options?.maxTokens ?? aiProviderConfig.openai.maxTokens, temperature: aiProviderConfig.openai.temperature }),
    });
    if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = (await res.json()) as {
      choices?: { finish_reason?: string | null; message?: { content?: string | null; refusal?: string | null } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
    };
    const choice = data.choices?.[0];
    const finish = choice?.finish_reason;
    const finishReason: AIProviderResult["finishReason"] = finish === "stop" || finish === "length" ? finish : finish === "content_filter" ? "content-filter" : finish === "tool_calls" || finish === "function_call" ? "tool-calls" : "unknown";
    const refused = Boolean(choice?.message?.refusal);
    const usage: CachedUsage | undefined = data.usage
      ? { promptTokens: count(data.usage.prompt_tokens), completionTokens: count(data.usage.completion_tokens), totalTokens: count(data.usage.total_tokens), cachedPromptTokens: count(data.usage.prompt_tokens_details?.cached_tokens) ?? 0 }
      : undefined;
    return { content: choice?.message?.content ?? "", finishReason, refused, complete: finishReason === "stop" && !refused, truncated: finishReason === "length", ...(usage ? { usage } : {}) };
  }
}
