export interface GenerationExecutionPolicy {
  readonly failClosed: boolean;
}

export const strictGenerationExecutionPolicy: GenerationExecutionPolicy =
  Object.freeze({ failClosed: true });

export class GenerationFallbackBlockedError extends Error {
  readonly code = "GENERATION_FALLBACK_BLOCKED";

  constructor() {
    super("Production generation failed closed.");
    this.name = "GenerationFallbackBlockedError";
    this.stack = undefined;
  }
}

export function failClosedOrReturn<T>(
  fallback: T,
  policy?: GenerationExecutionPolicy,
): T {
  if (policy?.failClosed) throw new GenerationFallbackBlockedError();
  return fallback;
}
