import type { ProviderName } from "./router/AIRouter";

export type AIProviderConfig = {
  provider: ProviderName;
  openai: {
    model: string;
    maxTokens: number;
    temperature: number;
  };
};

/**
 * The configured text-AI provider. `AI_PROVIDER` selects it:
 *  - `openai`     — OpenAI chat completions (needs `OPENAI_API_KEY`)
 *  - `ollama`     — local Ollama server, $0 (see `OllamaConfig`)
 *  - `openrouter` — reserved
 *  - anything else / unset → `mock`
 *
 * Read at call time (not import time) so a process that sets `AI_PROVIDER`
 * after this module is first imported — a CLI with `--env-file`, a test
 * harness, `withCanonicalSmokeRuntime` — still switches provider.
 */
export function resolveAiProviderName(
  env: NodeJS.ProcessEnv = process.env,
): ProviderName {
  const value = env.AI_PROVIDER?.trim().toLowerCase();
  if (value === "openai" || value === "ollama" || value === "openrouter") return value;
  return "mock";
}

export const aiProviderConfig: AIProviderConfig = {
  // Live getter — see resolveAiProviderName's note on call-time resolution.
  get provider(): ProviderName {
    return resolveAiProviderName();
  },
  openai: {
    get model() {
      return process.env.OPENAI_MODEL || "gpt-4.1-mini";
    },
    get maxTokens() {
      return Number.parseInt(process.env.OPENAI_MAX_TOKENS || "1200", 10);
    },
    get temperature() {
      return Number.parseFloat(process.env.OPENAI_TEMPERATURE || "0.4");
    },
  },
};
