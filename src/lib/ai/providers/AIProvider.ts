export interface AIProviderGenerateOptions {
  readonly maxTokens?: number;
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
