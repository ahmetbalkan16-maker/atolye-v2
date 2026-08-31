/**
 * Local-provider revision: which concrete provider each production stage uses.
 *
 * `ProductionAcceptanceOrchestrator.run` historically hard-coded
 * `getProvider("openai")` for the text LLM, TTS, thumbnail and YouTube-package
 * stages. This resolver replaces those literals with an env lookup that stays
 * **backward compatible**: an unset / `mock` / unrecognised value resolves to
 * `"openai"` (the audited legacy default), so an unchanged `.env.local` renders
 * exactly as before. Setting the domain's env var to a recognised local backend
 * switches that stage to the $0 local provider.
 *
 *   AI_PROVIDER=ollama          text LLM  (research…assembly-plan, seo)
 *   ANIMATION_PROVIDER=ollama   motion-plan LLM   (handled by AnimationProviderRouter directly)
 *   AUDIO_PROVIDER=piper        TTS narration
 *   THUMBNAIL_PROVIDER=local    FFmpeg frame + drawtext thumbnail
 *   YOUTUBE_PROVIDER=ollama     YouTube package draft
 */

export type ProductionProviderDomain = "ai" | "audio" | "thumbnail" | "youtube";

const LEGACY_DEFAULT = "openai";

const DOMAIN_ENV: Record<
  ProductionProviderDomain,
  { readonly envVar: string; readonly recognised: readonly string[] }
> = {
  ai: { envVar: "AI_PROVIDER", recognised: ["openai", "ollama", "openrouter"] },
  audio: { envVar: "AUDIO_PROVIDER", recognised: ["openai", "piper"] },
  thumbnail: { envVar: "THUMBNAIL_PROVIDER", recognised: ["openai", "local"] },
  youtube: { envVar: "YOUTUBE_PROVIDER", recognised: ["openai", "ollama"] },
};

/**
 * The provider name the production path should use for `domain`. Recognised
 * env value → that provider; anything else (unset, `mock`, unknown) →
 * `"openai"`. Never returns `"mock"` — a production render must not silently
 * fall back to the empty-output mock provider.
 */
export function resolveProductionProviderName(
  domain: ProductionProviderDomain,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const spec = DOMAIN_ENV[domain];
  const value = env[spec.envVar]?.trim().toLowerCase();
  if (value && spec.recognised.includes(value)) return value;
  return LEGACY_DEFAULT;
}

/** True when every production AI domain resolves to a $0 local backend. */
export function isFullyLocalProduction(env: NodeJS.ProcessEnv = process.env): boolean {
  const local = new Set(["ollama", "piper", "local"]);
  const animation = env.ANIMATION_PROVIDER?.trim().toLowerCase();
  return (
    local.has(resolveProductionProviderName("ai", env)) &&
    local.has(resolveProductionProviderName("audio", env)) &&
    local.has(resolveProductionProviderName("thumbnail", env)) &&
    local.has(resolveProductionProviderName("youtube", env)) &&
    (animation === "ollama" || animation === "mock") &&
    (env.IMAGE_PROVIDER?.trim().toLowerCase() === "real" ||
      env.IMAGE_PROVIDER?.trim().toLowerCase() === "mock")
  );
}
