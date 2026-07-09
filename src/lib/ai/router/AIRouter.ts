import { aiProviderConfig } from "../AIProviderConfig";
import type { AIProvider } from "../providers";
import { MockAIProvider } from "../providers";
import { OpenAIProvider } from "../providers";
import { OpenRouterProvider } from "../providers";

export type ProviderName =
  | "mock"
  | "openai"
  | "openrouter";

export class AIRouter {
  private providers: Record<ProviderName, AIProvider>;

  constructor() {
    this.providers = {
      mock: new MockAIProvider(),
      openai: new OpenAIProvider(),
      openrouter: new OpenRouterProvider(),
    };
  }

  getProvider(
    name: ProviderName = aiProviderConfig.provider
  ): AIProvider {
    return this.providers[name] ?? this.providers.mock;
  }
}
