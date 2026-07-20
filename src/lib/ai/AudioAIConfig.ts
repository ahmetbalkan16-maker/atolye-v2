export const audioTokenBudget = Object.freeze({
  environmentName: "OPENAI_AUDIO_MAX_TOKENS",
  defaultTokens: 3200,
  minimumTokens: 2000,
  maximumTokens: 6000,
});

export class AudioAIConfigError extends Error {
  readonly code = "AI_AUDIO_MAX_TOKENS_INVALID";

  constructor() {
    super("Audio AI token configuration is invalid.");
    this.name = "AudioAIConfigError";
    this.stack = undefined;
  }
}

export function getAudioMaxTokens(
  environment: NodeJS.ProcessEnv = process.env,
): number {
  const raw = environment[audioTokenBudget.environmentName];
  if (raw === undefined) return audioTokenBudget.defaultTokens;
  const normalized = raw.trim();
  if (!/^[0-9]+$/.test(normalized)) throw new AudioAIConfigError();
  const parsed = Number(normalized);
  if (
    !Number.isSafeInteger(parsed) ||
    parsed < audioTokenBudget.minimumTokens ||
    parsed > audioTokenBudget.maximumTokens
  ) throw new AudioAIConfigError();
  return parsed;
}
