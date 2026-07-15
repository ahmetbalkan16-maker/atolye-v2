export class ApplicationTimestampError extends Error {
  readonly code = "AI_APPLICATION_TIMESTAMP_INVALID";

  constructor() {
    super("Application timestamp generation failed.");
    this.name = "ApplicationTimestampError";
    this.stack = undefined;
  }
}

export function createCanonicalApplicationTimestamp(
  now: () => string = () => new Date().toISOString(),
): string {
  let value: unknown;
  try {
    value = now();
  } catch {
    throw new ApplicationTimestampError();
  }
  if (!isCanonicalTimestamp(value)) throw new ApplicationTimestampError();
  return value;
}

export function isCanonicalTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}
