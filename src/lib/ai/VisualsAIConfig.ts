export const visualsTokenBudget = Object.freeze({
  environmentName: "OPENAI_VISUALS_MAX_TOKENS",
  defaultTokens: 3200,
  minimumTokens: 2000,
  maximumTokens: 6000,
});

export class VisualsAIConfigError extends Error {
  readonly code = "AI_VISUALS_MAX_TOKENS_INVALID";

  constructor() {
    super("Visuals AI token configuration is invalid.");
    this.name = "VisualsAIConfigError";
    this.stack = undefined;
  }
}

export function getVisualsMaxTokens(
  environment: NodeJS.ProcessEnv = process.env,
): number {
  const raw = environment[visualsTokenBudget.environmentName];
  if (raw === undefined) return visualsTokenBudget.defaultTokens;
  const normalized = raw.trim();
  if (!/^[0-9]+$/.test(normalized)) throw new VisualsAIConfigError();
  const parsed = Number(normalized);
  if (
    !Number.isSafeInteger(parsed) ||
    parsed < visualsTokenBudget.minimumTokens ||
    parsed > visualsTokenBudget.maximumTokens
  ) throw new VisualsAIConfigError();
  return parsed;
}
