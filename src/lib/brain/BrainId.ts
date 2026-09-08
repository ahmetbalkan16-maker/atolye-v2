/**
 * Atölye Brain — deterministic id + canonical-value primitive.
 *
 * Same FNV-1a construction as `src/lib/production/ProductionDeterminism.ts`, but
 * kept **local to the Brain** on purpose: the Brain layer must be extractable on
 * its own (e.g. into the server-side Brain Worker) without dragging
 * `src/lib/production/` along. This is a leaf utility with no imports.
 *
 * Not a security fingerprint — it is a stable content id for records, plans and
 * decisions so a rebuild from the same inputs is byte-identical.
 */

export function stableBrainValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableBrainValue).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableBrainValue(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

export function stableBrainId(prefix: string, value: unknown): string {
  const text = stableBrainValue(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
