/**
 * AYAS chat model profile (spec §3).
 *
 * AYAS conversational replies benefit from a stronger instruction-follower than
 * the pipeline default (`OLLAMA_MODEL`, tuned small for a 4 GB GPU). Rather than
 * change `OLLAMA_MODEL` globally — which would move every `AI_PROVIDER=ollama`
 * pipeline stage — AYAS reads an **optional** `AYAS_OLLAMA_MODEL` override that
 * applies ONLY to the `askAyas` chat path.
 *
 *   AYAS_OLLAMA_MODEL   e.g. `qwen2.5:7b` — overrides the model for AYAS chat only.
 *                       Unset → AYAS uses the same model as the pipeline.
 *
 * Everything else (host, timeout, format, num_ctx, retries) stays exactly as
 * `resolveOllamaConfig()` resolves it. The value is validated the same way
 * `OllamaConfig` validates `OLLAMA_MODEL`; an invalid value falls back to the
 * pipeline model rather than throwing (AYAS chat must not hard-fail on config).
 */

import { OllamaProvider } from "@/lib/ai/providers/OllamaProvider";
import { resolveOllamaConfig, type OllamaConfig } from "@/lib/ai/OllamaConfig";

export const AYAS_MODEL_ENV = "AYAS_OLLAMA_MODEL";

const SAFE_MODEL = /^[a-zA-Z0-9._:\/-]{1,200}$/;

export interface AyasChatModelProfile {
  /** The model AYAS chat will actually use. */
  readonly model: string;
  /** `true` when `AYAS_OLLAMA_MODEL` supplied it (vs the pipeline default). */
  readonly overridden: boolean;
  /** Set when an `AYAS_OLLAMA_MODEL` value was present but rejected. */
  readonly ignoredInvalidOverride?: string;
}

export function resolveAyasChatModelProfile(
  env: NodeJS.ProcessEnv = process.env,
  base: OllamaConfig = resolveOllamaConfig(env),
): AyasChatModelProfile {
  const raw = env[AYAS_MODEL_ENV]?.trim();
  if (!raw) return { model: base.model, overridden: false };
  if (!SAFE_MODEL.test(raw)) {
    return { model: base.model, overridden: false, ignoredInvalidOverride: raw };
  }
  return { model: raw, overridden: true };
}

/**
 * An `OllamaProvider` bound to the AYAS chat model profile. Identical to the
 * pipeline provider except for the model tag when `AYAS_OLLAMA_MODEL` is set.
 */
export function createAyasChatProvider(env: NodeJS.ProcessEnv = process.env): OllamaProvider {
  return new OllamaProvider(undefined, () => {
    const base = resolveOllamaConfig(env);
    const profile = resolveAyasChatModelProfile(env, base);
    return profile.overridden ? { ...base, model: profile.model } : base;
  });
}
