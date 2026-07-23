import { types as utilTypes } from "node:util";

export function stableProductionValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableProductionValue).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableProductionValue(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

export function stableProductionId(prefix: string, value: unknown) {
  const text = stableProductionValue(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

/** Collision-safe canonical encoding for security fingerprints; not legacy ID compatibility. */
export function canonicalProductionSecurityValue(value: unknown): string {
  const active = new WeakSet<object>();
  const encode = (input: unknown): string => {
    if (input === null) return "n:null";
    if (input === undefined) return "u:undefined";
    if (typeof input === "string") return `s:${JSON.stringify(input)}`;
    if (typeof input === "boolean") return input ? "b:true" : "b:false";
    if (typeof input === "number") {
      if (!Number.isFinite(input) || Object.is(input, -0)) {
        throw new TypeError("Unsupported canonical security number.");
      }
      return `d:${JSON.stringify(input)}`;
    }
    if (typeof input === "bigint" || typeof input === "function" || typeof input === "symbol") {
      throw new TypeError("Unsupported canonical security value.");
    }
    if (!input || typeof input !== "object") throw new TypeError("Unsupported canonical security value.");
    if (utilTypes.isProxy(input)) throw new TypeError("Unsupported canonical security proxy.");
    if (active.has(input)) throw new TypeError("Cyclic canonical security value.");
    active.add(input);
    try {
      if (Array.isArray(input)) {
        if (Object.getPrototypeOf(input) !== Array.prototype) {
          throw new TypeError("Unsupported canonical array prototype.");
        }
        const descriptors = Object.getOwnPropertyDescriptors(input) as
          Record<string, PropertyDescriptor>;
        const lengthDescriptor = descriptors.length;
        if (!lengthDescriptor || !("value" in lengthDescriptor) ||
          lengthDescriptor.value !== input.length) {
          throw new TypeError("Unsupported canonical array length descriptor.");
        }
        for (const key of Reflect.ownKeys(input)) {
          if (typeof key !== "string") throw new TypeError("Unsupported canonical array symbol key.");
          if (key === "length") continue;
          const index = Number(key);
          const descriptor = descriptors[key];
          if (!Number.isSafeInteger(index) || index < 0 || index >= input.length ||
            String(index) !== key || !descriptor?.enumerable || !("value" in descriptor)) {
            throw new TypeError("Unsupported canonical array property.");
          }
        }
        const values: string[] = [];
        for (let index = 0; index < input.length; index += 1) {
          const descriptor = descriptors[String(index)];
          values.push(descriptor ? `v:${encode(descriptor.value)}` : "h:hole");
        }
        return `a:${input.length}:[${values.join(",")}]`;
      }
      const prototype = Object.getPrototypeOf(input);
      if (prototype !== Object.prototype && prototype !== null) {
        throw new TypeError("Unsupported canonical object prototype.");
      }
      if (Object.getOwnPropertySymbols(input).length > 0) {
        throw new TypeError("Unsupported canonical symbol key.");
      }
      const descriptors = Object.getOwnPropertyDescriptors(input);
      const keys = Object.keys(descriptors).sort();
      return `o:{${keys.map((key) => {
        const descriptor = descriptors[key];
        if (!descriptor.enumerable || !("value" in descriptor)) {
          throw new TypeError("Unsupported canonical object descriptor.");
        }
        return `${JSON.stringify(key)}:${encode(descriptor.value)}`;
      }).join(",")}}`;
    } finally {
      active.delete(input);
    }
  };
  return `canonical-production-security-v1|${encode(value)}`;
}
