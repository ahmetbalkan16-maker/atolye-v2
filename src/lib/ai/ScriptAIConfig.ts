export const scriptTokenBudget = Object.freeze({
  environmentName: "OPENAI_SCRIPT_MAX_TOKENS",
  defaultTokens: 3200,
  minimumTokens: 2000,
  maximumTokens: 4800,
});

export class ScriptAIConfigError extends Error {
  readonly code = "AI_SCRIPT_MAX_TOKENS_INVALID";

  constructor() {
    super("Script AI token configuration is invalid.");
    this.name = "ScriptAIConfigError";
    this.stack = undefined;
  }
}

export function getScriptMaxTokens(
  environment: NodeJS.ProcessEnv = process.env,
): number {
  const raw = environment[scriptTokenBudget.environmentName];
  if (raw === undefined) return scriptTokenBudget.defaultTokens;
  const normalized = raw.trim();
  if (!/^[0-9]+$/.test(normalized)) throw new ScriptAIConfigError();
  const parsed = Number(normalized);
  if (
    !Number.isSafeInteger(parsed) ||
    parsed < scriptTokenBudget.minimumTokens ||
    parsed > scriptTokenBudget.maximumTokens
  ) throw new ScriptAIConfigError();
  return parsed;
}
