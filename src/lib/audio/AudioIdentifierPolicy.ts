export const AUDIO_IDENTIFIER_MAX_LENGTH = 80;

const SAFE_AUDIO_IDENTIFIER =
  /^[a-zA-Z0-9](?:[a-zA-Z0-9._:-]{0,78}[a-zA-Z0-9])?$/;
const RESERVED_SAFE_EVIDENCE_TERMS = [
  "apikey",
  "authorization",
  "bearer",
  "secret",
  "token",
  "password",
  "credential",
  "stack",
  "providerresponse",
] as const;

export class AudioIdentifierPolicyError extends Error {
  constructor() {
    super("Audio provider configuration is invalid.");
    this.name = "AudioIdentifierPolicyError";
    this.stack = undefined;
  }
}

export function containsReservedSafeEvidenceTerm(value: string): boolean {
  const comparisonValue = value.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  return RESERVED_SAFE_EVIDENCE_TERMS.some((term) =>
    comparisonValue.includes(term)
  );
}

export function isSafeAudioIdentifier(value: unknown): value is string {
  return typeof value === "string" &&
    value.length <= AUDIO_IDENTIFIER_MAX_LENGTH &&
    SAFE_AUDIO_IDENTIFIER.test(value) &&
    !containsReservedSafeEvidenceTerm(value);
}

export function requireSafeAudioIdentifier(value: unknown): string {
  if (!isSafeAudioIdentifier(value)) {
    throw new AudioIdentifierPolicyError();
  }

  return value;
}
