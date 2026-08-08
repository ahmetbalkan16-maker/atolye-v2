export const assemblyTokenBudget = Object.freeze({
  environmentName: "OPENAI_ASSEMBLY_MAX_TOKENS",
  defaultTokens: 3200,
  minimumTokens: 1600,
  maximumTokens: 6000,
});

export class AssemblyAIConfigError extends Error {
  readonly code = "AI_ASSEMBLY_MAX_TOKENS_INVALID";

  constructor() {
    super("Assembly AI token configuration is invalid.");
    this.name = "AssemblyAIConfigError";
    this.stack = undefined;
  }
}

export function getAssemblyMaxTokens(
  environment: NodeJS.ProcessEnv = process.env,
): number {
  const raw = environment[assemblyTokenBudget.environmentName];
  if (raw === undefined) return assemblyTokenBudget.defaultTokens;
  const normalized = raw.trim();
  if (!/^[0-9]+$/.test(normalized)) throw new AssemblyAIConfigError();
  const parsed = Number(normalized);
  if (
    !Number.isSafeInteger(parsed) ||
    parsed < assemblyTokenBudget.minimumTokens ||
    parsed > assemblyTokenBudget.maximumTokens
  ) throw new AssemblyAIConfigError();
  return parsed;
}
