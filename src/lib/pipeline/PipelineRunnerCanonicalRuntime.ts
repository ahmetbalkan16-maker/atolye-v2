import { randomUUID } from "node:crypto";
import {
  assertProductionRuntimeOperationAuthority,
  assertProductionRuntimeOperationContext,
  deriveProductionRuntimeOperationContext,
  getActiveProductionRuntimeOperationContext,
  ProductionRuntimeOperationContextError,
  type ProductionRuntimeOperationContext,
} from "@/lib/runtime/ProductionRuntimeOperationContext";
import {
  captureCanonicalProductionWorkerLifecycleExecution,
  ProductionWorkerLifecycle,
} from "@/lib/production/ProductionWorkerLifecycle";

const processCanonicalLockKey = Symbol.for(
  "@atolye/pipeline-runner-canonical-runtime-authority-lock/v1",
);
const moduleProvenance = Object.freeze({});
const ownsProcessCanonicalLock = claimProcessCanonicalLock();
let canonicalRegistration: CanonicalPipelineRuntimeRegistration | undefined;

export function installPipelineRunnerProductionRuntime(
  lifecycle: ProductionWorkerLifecycle,
  parent: ProductionRuntimeOperationContext,
): void {
  assertProcessCanonicalLockOwnership();
  if (canonicalRegistration) {
    if (
      canonicalRegistration.lifecycle === lifecycle &&
      canonicalRegistration.parent === parent
    ) {
      return;
    }
    throw new ProductionRuntimeOperationContextError("RUNTIME_OPERATION_CONTEXT_MISMATCH");
  }

  const executeWithRuntimeOperationContext =
    captureCanonicalProductionWorkerLifecycleExecution(lifecycle);
  assertProductionRuntimeOperationContext(parent);
  lifecycle.bindRuntimeOperationContext(parent);
  canonicalRegistration = Object.freeze({
    lifecycle,
    parent,
    executeWithRuntimeOperationContext,
  });
}

export async function executePipelineRunnerProductionRuntimeOperation<T>(
  operationType: string,
  operation: () => Promise<T>,
): Promise<T> {
  assertProcessCanonicalLockOwnership();
  const registration = canonicalRegistration;
  if (!registration) {
    throw new ProductionRuntimeOperationContextError("RUNTIME_OPERATION_CONTEXT_MISSING");
  }

  const active = getActiveProductionRuntimeOperationContext();
  if (active) {
    assertProductionRuntimeOperationAuthority(registration.parent, active);
    return registration.executeWithRuntimeOperationContext(active, operation);
  }

  const context = deriveProductionRuntimeOperationContext(registration.parent, {
    operationId: `operation-${randomUUID()}`,
    operationType,
  });
  return registration.executeWithRuntimeOperationContext(context, operation);
}

function claimProcessCanonicalLock(): boolean {
  const existing = Object.getOwnPropertyDescriptor(
    globalThis,
    processCanonicalLockKey,
  );
  if (existing) return existing.value === moduleProvenance;

  Object.defineProperty(globalThis, processCanonicalLockKey, {
    configurable: false,
    enumerable: false,
    value: moduleProvenance,
    writable: false,
  });
  return Object.getOwnPropertyDescriptor(globalThis, processCanonicalLockKey)?.value ===
    moduleProvenance;
}

function assertProcessCanonicalLockOwnership(): void {
  if (!ownsProcessCanonicalLock) {
    throw new ProductionRuntimeOperationContextError(
      "RUNTIME_OPERATION_CONTEXT_MISMATCH",
    );
  }
}

interface CanonicalPipelineRuntimeRegistration {
  readonly lifecycle: ProductionWorkerLifecycle;
  readonly parent: ProductionRuntimeOperationContext;
  readonly executeWithRuntimeOperationContext: ProductionWorkerLifecycle["executeWithRuntimeOperationContext"];
}
