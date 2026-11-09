import { resolveOllamaConfig } from "../../ai/OllamaConfig";
import type { AIProvider } from "../../ai/providers/AIProvider";
import { OllamaProvider } from "../../ai/providers/OllamaProvider";
import { OpenAIProvider } from "../../ai/providers/OpenAIProvider";
import { OpenAITextProvider } from "../script/OpenAIText";
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

/**
 * The model the studio's own developer writes code with (DevWriter; owner, 6 Nov 2026: "Claude olmadan yazabilecek
 * duruma gelsin"): gpt-4.1 (`ATOLYE_V3_CIRAK_MODEL` overrides) under its own cap and WITHOUT the free fallback — code
 * written by the 12B local model failed the checks anyway and only heated the card, so at the cap it stops instead.
 * Undefined when OpenAI is not chosen or has no key.
 */
export function writerBudget(paths: V3Paths, capUsd: number, provider = process.env.ATOLYE_V3_SCRIPT_PROVIDER ?? "openai"): { readonly budget: V3Budget; readonly model: V3ModelChoice } | undefined {
  const key = provider === "openai" ? v3Secret("OPENAI_API_KEY", paths.repoRoot) : undefined;
  if (!key) return undefined;
  process.env.OPENAI_API_KEY = key;
  process.env.AI_PROVIDER = "openai";
  // Its own text provider: the same request, and the prompt tokens OpenAI read from its cache are reported and booked
  // at the cached rate (a writing round repeats the last round's long head) — 9 Nov 2026.
  return { budget: new V3Budget({ providers: { openai: new OpenAITextProvider() }, capUsd }), model: { provider: "openai", model: process.env.ATOLYE_V3_CIRAK_MODEL ?? "gpt-4.1" } };
}

/**
 * The quality judge without chance (owner approval, 2 Nov 2026): temperature 0 and a fixed seed, so the same frame
 * gets the same verdict. At the default 0.4 the same 8-question exam gave 90 % and 73 % minutes apart. Used only when
 * the quality brain's exam chose it (setting "kalite.sabit", decided by SelfImprovement) or ATOLYE_V3_QUALITY_STEADY=1.
 */
export const STEADY_JUDGE = { temperature: 0, seed: 42 } as const;

/** Whether the quality judge runs steady: the environment decides ("1"/"0"), else the brain's measured setting. */
export function steadyJudge(tuned: boolean | undefined, env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return env.ATOLYE_V3_QUALITY_STEADY === "1" || (env.ATOLYE_V3_QUALITY_STEADY !== "0" && tuned === true);
}

/** The free local eye (gemma4 through Ollama), waiting for a cool GPU before every call; `steady`: see STEADY_JUDGE. */
export function brainVision(steady = false): AIProvider {
  return coolGpuProvider(new OllamaProvider(fetch, () => ({ ...resolveOllamaConfig(), model: process.env.ATOLYE_V3_VISION_MODEL ?? "gemma4:12b", timeoutMs: 180_000, numCtx: 8_192, format: "json" as const, think: false, ...(steady ? STEADY_JUDGE : {}) }), V3_OLLAMA_THERMAL), (s) => console.log(s));
}
