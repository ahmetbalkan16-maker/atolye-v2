/**
 * Completion-token budget for the scenes stage.
 *
 * Before multi-shot, the scenes stage produced ~5-7 scenes and fit in the
 * generic OPENAI_MAX_TOKENS default (1200). Multi-shot asks for 10-18 short
 * scenes, so the scenes response needs a script-sized budget of its own -
 * otherwise the JSON is cut off mid-array (`finish_reason: length`) and the
 * strict parser fails closed with AI_RESPONSE_INVALID_JSON.
 *
 * Mirrors ScriptAIConfig / ResearchAIConfig. The env var is optional; when set
 * it also drifts the production-acceptance ENVIRONMENT_POLICY fingerprint (see
 * ProductionAcceptanceConfigurationFingerprint), exactly like
 * OPENAI_AUDIO_MAX_TOKENS / OPENAI_ASSEMBLY_MAX_TOKENS.
 */
export const sceneTokenBudget = Object.freeze({
  environmentName: "OPENAI_SCENES_MAX_TOKENS",
  defaultTokens: 4200,
  minimumTokens: 2000,
  maximumTokens: 8000,
});

export class SceneAIConfigError extends Error {
  readonly code = "AI_SCENES_MAX_TOKENS_INVALID";

  constructor() {
    super("Scenes AI token configuration is invalid.");
    this.name = "SceneAIConfigError";
    this.stack = undefined;
  }
}

export function getSceneMaxTokens(
  environment: NodeJS.ProcessEnv = process.env,
): number {
  const raw = environment[sceneTokenBudget.environmentName];
  if (raw === undefined) return sceneTokenBudget.defaultTokens;
  const normalized = raw.trim();
  if (!/^[0-9]+$/.test(normalized)) throw new SceneAIConfigError();
  const parsed = Number(normalized);
  if (
    !Number.isSafeInteger(parsed) ||
    parsed < sceneTokenBudget.minimumTokens ||
    parsed > sceneTokenBudget.maximumTokens
  ) {
    throw new SceneAIConfigError();
  }
  return parsed;
}
