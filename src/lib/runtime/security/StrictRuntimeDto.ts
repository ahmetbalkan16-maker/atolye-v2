import { types as utilTypes } from "node:util";

export function decodeStrictRuntimeDto<K extends string>(
  value: unknown,
  allowedKeys: readonly K[],
  invalid: () => Error,
): Readonly<Partial<Record<K, unknown>>> {
  try {
    if (
      typeof value !== "object" ||
      value === null ||
      utilTypes.isProxy(value) ||
      Object.getPrototypeOf(value) !== Object.prototype
    ) throw invalid();

    const allowed = new Set<string>(allowedKeys);
    const output: Partial<Record<K, unknown>> = {};
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string" || !allowed.has(key)) throw invalid();
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor) || descriptor.get || descriptor.set) {
        throw invalid();
      }
      output[key as K] = descriptor.value;
    }
    return Object.freeze(output);
  } catch (error) {
    const canonical = invalid();
    if (error instanceof Error && error.name === canonical.name && error.message === canonical.message) {
      throw error;
    }
    throw canonical;
  }
}
