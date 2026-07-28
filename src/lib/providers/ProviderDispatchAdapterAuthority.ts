import { types as utilTypes } from "node:util";

export type ProviderAdapterPrimitive = string | number | boolean | bigint | symbol | null | undefined;

export type ProviderDispatchAdapterAuthority<FactoryName extends string> = {
  readonly [Key in FactoryName]: () => object;
};

export function createProviderDispatchAdapter<T extends object>(
  source: T,
  input: {
    readonly metadata: Readonly<Record<string, ProviderAdapterPrimitive>>;
    readonly requiredMethods: readonly (keyof T & string)[];
    readonly optionalMethods?: readonly string[];
  },
): object {
  if (utilTypes.isProxy(source)) throw new TypeError("Provider authority proxies are unsupported.");
  const adapter: Record<string, unknown> = { ...input.metadata };
  for (const method of input.requiredMethods) {
    adapter[method] = bindOwnDataMethod(source, method, true);
  }
  for (const method of input.optionalMethods ?? []) {
    const bound = bindOwnDataMethod(source, method, false);
    if (bound) adapter[method] = bound;
  }
  return Object.freeze(adapter);
}

function bindOwnDataMethod<T extends object>(
  source: T,
  method: string,
  required: boolean,
): ((...args: unknown[]) => unknown) | undefined {
  let owner: object | null = source;
  while (owner) {
    if (utilTypes.isProxy(owner)) throw new TypeError("Provider authority proxies are unsupported.");
    const descriptor = Object.getOwnPropertyDescriptor(owner, method);
    if (descriptor) {
      if (!("value" in descriptor) || typeof descriptor.value !== "function") {
        throw new TypeError(`Provider method ${method} must be an own-data function.`);
      }
      const implementation = descriptor.value as (...args: unknown[]) => unknown;
      return (...args: unknown[]) => Reflect.apply(implementation, source, args);
    }
    owner = Object.getPrototypeOf(owner);
  }
  if (required) throw new TypeError(`Provider method ${method} is unavailable.`);
  return undefined;
}
