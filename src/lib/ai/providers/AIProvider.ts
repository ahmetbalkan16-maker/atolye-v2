export interface AIProviderGenerateOptions {
  readonly maxTokens?: number;
  /**
   * Optional JSON Schema for the expected response. Providers that support
   * grammar-constrained / structured decoding (Ollama's `format`) use it to
   * force schema-conforming output; providers that don't simply ignore it.
   */
  readonly jsonSchema?: Record<string, unknown>;
  /**
   * Optional per-call model for providers that serve several (OpenAI); others
   * ignore it. Price it with `AiPricing` first — a model missing from the price
   * table must not be called.
   */
  readonly model?: string;
  /**
   * Optional base64 images for multimodal models (Ollama vision models such as
   * gemma4). Only Ollama sends them; do not route an image task to a provider
   * that ignores them.
   */
  readonly images?: readonly string[];
}

export interface AIProviderUsage {
  readonly promptTokens?: number;
  readonly completionTokens?: number;
  readonly totalTokens?: number;
}

export interface AIProviderResult {
  readonly content: string;
  readonly finishReason: "stop" | "length" | "content-filter" | "tool-calls" | "unknown";
  readonly refused: boolean;
  readonly complete: boolean;
  readonly truncated: boolean;
  readonly usage?: AIProviderUsage;
}

export type AIProviderOutput = string | AIProviderResult;

export interface AIProvider {
  generate(prompt: string, options?: AIProviderGenerateOptions): Promise<AIProviderOutput>;
}

export type ConfiguredAIProvider = AIProvider &
  ProviderDispatchAdapterAuthority<"createImmutableAiDispatchAdapter">;
import type { ProviderDispatchAdapterAuthority } from "@/lib/providers/ProviderDispatchAdapterAuthority";
