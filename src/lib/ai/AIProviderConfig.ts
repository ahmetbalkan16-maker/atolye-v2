import type { ProviderName } from "./router/AIRouter";

export type AIProviderConfig = {
  provider: ProviderName;
  openai: {
    model: string;
    maxTokens: number;
    temperature: number;
  };
};

function getConfiguredProvider(): ProviderName {
  return process.env.AI_PROVIDER === "openai" ? "openai" : "mock";
}

export const aiProviderConfig: AIProviderConfig = {
  provider: getConfiguredProvider(),
  openai: {
    model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
    maxTokens: Number.parseInt(process.env.OPENAI_MAX_TOKENS || "1200", 10),
    temperature: Number.parseFloat(process.env.OPENAI_TEMPERATURE || "0.4"),
  },
};
