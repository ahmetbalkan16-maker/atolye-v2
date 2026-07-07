import type { AIProvider } from "../providers";
import { OpenAIProvider } from "../providers";
import { OpenRouterProvider } from "../providers";

export type ProviderName =
  | "openai"
  | "openrouter";

export class AIRouter {
  private providers: Record<ProviderName, AIProvider>;

  constructor() {
    this.providers = {
      openai: new OpenAIProvider(),
      openrouter: new OpenRouterProvider(),
    };
  }

  getProvider(
    name: ProviderName = "openai"
  ): AIProvider {
    return this.providers[name];
  }
}