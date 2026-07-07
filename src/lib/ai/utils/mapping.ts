export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function getString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

export function getStringAllowEmpty(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

export function getOptionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function getNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function getStringArray(
  value: unknown,
  fallback: string[] = [],
): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : fallback;
}

export function getCreatedAt(value: unknown, fallback: string): string {
  return getString(value, fallback);
}
