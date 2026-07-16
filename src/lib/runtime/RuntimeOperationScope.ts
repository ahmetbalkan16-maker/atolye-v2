import { AsyncLocalStorage } from "node:async_hooks";
import {
  assertProductionRuntimeOperationAuthority,
  assertProductionRuntimeOperationContext,
  ProductionRuntimeOperationContextError,
  requireProductionRuntimeStorageContext,
  type ProductionRuntimeOperationContext,
} from "./ProductionRuntimeOperationContext";
import type { RuntimeStorageContext } from "./RuntimeStoragePaths";

export interface RuntimeOperationScopeBinding {
  readonly operationContext: ProductionRuntimeOperationContext;
  readonly storageContext: RuntimeStorageContext;
}

interface RuntimeOperationScopeToken {
  active: boolean;
}

interface RuntimeOperationScopeStore extends RuntimeOperationScopeBinding {
  readonly token: RuntimeOperationScopeToken;
}

const operationScope = new AsyncLocalStorage<RuntimeOperationScopeStore>();

export function runWithProductionRuntimeOperationContext<T>(
  context: ProductionRuntimeOperationContext,
  operation: () => T,
): T {
  assertProductionRuntimeOperationContext(context);
  const active = activeStore();
  if (active) {
    assertProductionRuntimeOperationAuthority(active.operationContext, context);
    if (active.operationContext !== context) {
      throw new ProductionRuntimeOperationContextError("RUNTIME_OPERATION_CONTEXT_MISMATCH");
    }
    return operation();
  }

  const storageContext = requireProductionRuntimeStorageContext(context);
  const token: RuntimeOperationScopeToken = { active: true };
  const store = Object.freeze({ operationContext: context, storageContext, token });
  let result: T;
  try {
    result = operationScope.run(store, operation);
  } catch (error) {
    token.active = false;
    throw error;
  }
  if (isPromiseLike(result)) {
    return Promise.resolve(result).finally(() => {
      token.active = false;
    }) as T;
  }
  token.active = false;
  return result;
}

export function getActiveProductionRuntimeOperationContext(): ProductionRuntimeOperationContext | undefined {
  return activeStore()?.operationContext;
}

export function requireActiveProductionRuntimeOperationContext(
  expected?: ProductionRuntimeOperationContext,
): ProductionRuntimeOperationContext {
  const active = getActiveProductionRuntimeOperationContext();
  if (!active) {
    throw new ProductionRuntimeOperationContextError("RUNTIME_OPERATION_CONTEXT_MISSING");
  }
  if (expected) assertProductionRuntimeOperationAuthority(expected, active);
  return active;
}

export function requireExactActiveProductionRuntimeOperationContext(
  expected: unknown,
): ProductionRuntimeOperationContext {
  if (typeof expected !== "object" || expected === null) {
    throw new ProductionRuntimeOperationContextError("RUNTIME_OPERATION_CONTEXT_INVALID");
  }
  assertProductionRuntimeOperationContext(expected as ProductionRuntimeOperationContext);
  const active = getActiveProductionRuntimeOperationContext();
  if (!active) {
    throw new ProductionRuntimeOperationContextError("RUNTIME_OPERATION_CONTEXT_MISSING");
  }
  if (active !== expected) {
    throw new ProductionRuntimeOperationContextError("RUNTIME_OPERATION_CONTEXT_MISMATCH");
  }
  assertProductionRuntimeOperationAuthority(expected as ProductionRuntimeOperationContext, active);
  return active;
}

/** @internal Runtime storage resolution validates the trusted context on every use. */
export function getActiveRuntimeOperationScope(): RuntimeOperationScopeBinding | undefined {
  const active = activeStore();
  if (!active) return undefined;
  return {
    operationContext: active.operationContext,
    storageContext: active.storageContext,
  };
}

function activeStore(): RuntimeOperationScopeStore | undefined {
  const store = operationScope.getStore();
  if (!store) return undefined;
  if (!store.token.active) {
    throw new ProductionRuntimeOperationContextError("RUNTIME_OPERATION_CONTEXT_MISSING");
  }
  assertProductionRuntimeOperationContext(store.operationContext);
  return store;
}

function isPromiseLike<T>(value: T): value is T & PromiseLike<unknown> {
  return typeof value === "object" && value !== null && "then" in value;
}
