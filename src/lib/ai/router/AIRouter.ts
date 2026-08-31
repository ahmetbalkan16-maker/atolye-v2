import { aiProviderConfig } from "../AIProviderConfig";
import type { AIProvider } from "../providers";
import { MockAIProvider } from "../providers";
import { OpenAIProvider } from "../providers";
import { OpenRouterProvider } from "../providers";
import { OllamaProvider } from "../providers/OllamaProvider";

export type ProviderName =
  | "mock"
  | "openai"
  | "openrouter"
  // Local / self-hosted, $0. `ollama` = local LLM server; `local` = any
  // non-billable local backend (used by the local thumbnail compositor etc.).
  | "ollama"
  | "local"
  | "piper";

export class AIRouter {
  private providers: Record<ProviderName, AIProvider>;

  constructor() {
    const mock = new MockAIProvider();
    this.providers = {
      mock,
      openai: new OpenAIProvider(),
      openrouter: new OpenRouterProvider(),
      ollama: new OllamaProvider(),
      local: mock,
      piper: mock,
    };
  }

  getProvider(
    name: ProviderName = aiProviderConfig.provider
  ): AIProvider {
    return this.providers[name] ?? this.providers.mock;
  }
}
