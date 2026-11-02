import { resolveOllamaConfig } from "../../ai/OllamaConfig";
import type { AIProvider } from "../../ai/providers/AIProvider";
import { OllamaProvider } from "../../ai/providers/OllamaProvider";
import { OpenAIProvider } from "../../ai/providers/OpenAIProvider";
import { V3Budget, type V3ModelChoice } from "../script/V3Budget";
import { coolGpuProvider, V3_OLLAMA_THERMAL } from "../util/Gpu";
import { type V3Paths, v3Secret } from "../V3Paths";

/**
 * The models the brains think with outside a production (reference study, the idle self-improvement loop): the same
 * choice as the production's — OpenAI when chosen (the key borrowed for this process only), gemma4 through Ollama as
 * the free fallback the budget falls back to near its cap — every local call waits for a cool GPU.
 */
export function brainBudget(paths: V3Paths, capUsd: number, provider = process.env.ATOLYE_V3_SCRIPT_PROVIDER ?? "openai"): { readonly budget: V3Budget; readonly critic: V3ModelChoice; readonly director: V3ModelChoice } {
  const openai = provider === "openai" && !!v3Secret("OPENAI_API_KEY", paths.repoRoot);
  if (openai) {
    process.env.OPENAI_API_KEY = v3Secret("OPENAI_API_KEY", paths.repoRoot);
    process.env.AI_PROVIDER = "openai";
  }
  const ollama = coolGpuProvider(new OllamaProvider(fetch, () => ({ ...resolveOllamaConfig(), model: process.env.ATOLYE_V3_OLLAMA_MODEL ?? "gemma4:12b", timeoutMs: 1_200_000, numCtx: 16_384, format: "json" as const, think: false }), V3_OLLAMA_THERMAL), (s) => console.log(s));
  const budget = new V3Budget({ providers: { openai: new OpenAIProvider(), ollama }, fallback: { provider: "ollama" }, capUsd });
  return {
    budget,
    critic: openai ? { provider: "openai", model: process.env.ATOLYE_V3_CRITIC_MODEL ?? "gpt-4.1-mini" } : { provider: "ollama" },
    director: openai ? { provider: "openai", model: process.env.ATOLYE_V3_DIRECTOR_MODEL ?? "gpt-4.1" } : { provider: "ollama" },
  };
}

/** The free local eye (gemma4 through Ollama), waiting for a cool GPU before every call. */
export function brainVision(): AIProvider {
  return coolGpuProvider(new OllamaProvider(fetch, () => ({ ...resolveOllamaConfig(), model: process.env.ATOLYE_V3_VISION_MODEL ?? "gemma4:12b", timeoutMs: 180_000, numCtx: 8_192, format: "json" as const, think: false }), V3_OLLAMA_THERMAL), (s) => console.log(s));
}
