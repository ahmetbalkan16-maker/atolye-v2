export const assemblyTokenBudget = Object.freeze({
  environmentName: "OPENAI_ASSEMBLY_MAX_TOKENS",
  // 3200 was calibrated for pre-multi-shot scripts (~5-8 scenes). A 16-scene
  // multi-shot assembly plan (each scene echoes long opaque asset ids + Turkish
  // notes) needs ~3700+ output tokens, so gpt-4.1-mini hit finish_reason=length
  // at exactly 3200 -> AI_RESPONSE_TRUNCATED. Same remediation shape as Sprint
  // 129.37 (1200 -> 3200) and Sprint 159's SceneAIConfig (1200 -> 4200).
  defaultTokens: 5200,
  minimumTokens: 1600,
  maximumTokens: 8000,
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
