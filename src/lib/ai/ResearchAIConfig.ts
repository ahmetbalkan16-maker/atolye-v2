export const researchTokenBudget = Object.freeze({
  environmentName: "OPENAI_RESEARCH_MAX_TOKENS",
  defaultTokens: 3200,
  minimumTokens: 1600,
  maximumTokens: 6000,
});

export class ResearchAIConfigError extends Error {
  readonly code = "AI_RESEARCH_MAX_TOKENS_INVALID";

  constructor() {
    super("Research AI token configuration is invalid.");
    this.name = "ResearchAIConfigError";
    this.stack = undefined;
  }
}

export function getResearchMaxTokens(
  environment: NodeJS.ProcessEnv = process.env,
): number {
  const raw = environment[researchTokenBudget.environmentName];
  if (raw === undefined) return researchTokenBudget.defaultTokens;
  const normalized = raw.trim();
  if (!/^[0-9]+$/.test(normalized)) throw new ResearchAIConfigError();
  const parsed = Number(normalized);
  if (
    !Number.isSafeInteger(parsed) ||
    parsed < researchTokenBudget.minimumTokens ||
    parsed > researchTokenBudget.maximumTokens
  ) throw new ResearchAIConfigError();
  return parsed;
}
