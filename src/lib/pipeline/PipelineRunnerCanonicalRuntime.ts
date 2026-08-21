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

/**
 * Process-global mutable registration slot, shared (via globalThis + Symbol.for) across every module
 * instance of this file that may be loaded in the same OS process — e.g. one instance reached through
 * instrumentation.ts's boot-time registration, another reached independently through a Next.js route
 * handler's own module graph, when a bundler compiles shared `src/lib` code separately per entry/layer
 * instead of deduplicating it into one shared chunk. Write access here still requires
 * `ownsProcessCanonicalLock` (below, unchanged), so only the one module instance that first claimed the
 * process lock may install or restore a registration. Reads must not depend on that per-instance
 * ownership flag, though: a non-owning instance still needs to observe the one true registration the
 * owning instance installed — otherwise it wrongly concludes no registration exists at all, which is
 * the exact false-positive RUNTIME_OPERATION_CONTEXT_MISMATCH this slot exists to eliminate.
 */
const processCanonicalRegistrationBoxKey = Symbol.for(
  "@atolye/pipeline-runner-canonical-runtime-registration-box/v1",
);
const processCanonicalRegistrationBox = claimProcessCanonicalRegistrationBox();

/** @internal Opaque process-state token for scoped test/runtime composition. */
export interface PipelineRunnerProductionRuntimeSnapshot {
  readonly registration: CanonicalPipelineRuntimeRegistration | undefined;
}

export function snapshotPipelineRunnerProductionRuntime(): PipelineRunnerProductionRuntimeSnapshot {
  return Object.freeze({ registration: processCanonicalRegistrationBox.value });
}

export function restorePipelineRunnerProductionRuntime(
  snapshot: PipelineRunnerProductionRuntimeSnapshot,
  expectedCurrent: PipelineRunnerProductionRuntimeSnapshot,
): void {
  assertProcessCanonicalLockOwnership();
  if (processCanonicalRegistrationBox.value !== expectedCurrent.registration) {
    throw new ProductionRuntimeOperationContextError("RUNTIME_OPERATION_CONTEXT_MISMATCH");
  }
  processCanonicalRegistrationBox.value = snapshot.registration;
}

export function installPipelineRunnerProductionRuntime(
  lifecycle: ProductionWorkerLifecycle,
  parent: ProductionRuntimeOperationContext,
): void {
  assertProcessCanonicalLockOwnership();
  const existing = processCanonicalRegistrationBox.value;
  if (existing) {
    if (
      existing.lifecycle === lifecycle &&
      existing.parent === parent
    ) {
      return;
    }
    throw new ProductionRuntimeOperationContextError("RUNTIME_OPERATION_CONTEXT_MISMATCH");
  }

  const executeWithRuntimeOperationContext =
    captureCanonicalProductionWorkerLifecycleExecution(lifecycle);
  assertProductionRuntimeOperationContext(parent);
  lifecycle.bindRuntimeOperationContext(parent);
  processCanonicalRegistrationBox.value = Object.freeze({
    lifecycle,
    parent,
    executeWithRuntimeOperationContext,
  });
}

export async function executePipelineRunnerProductionRuntimeOperation<T>(
  operationType: string,
  operation: () => Promise<T>,
): Promise<T> {
  const registration = processCanonicalRegistrationBox.value;
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

export function assertPipelineRunnerProductionRuntimeOperationActive(): void {
  const registration = processCanonicalRegistrationBox.value;
  if (!registration) {
    throw new ProductionRuntimeOperationContextError("RUNTIME_OPERATION_CONTEXT_MISSING");
  }
  const active = getActiveProductionRuntimeOperationContext();
  if (!active) {
    throw new ProductionRuntimeOperationContextError("RUNTIME_OPERATION_CONTEXT_MISSING");
  }
  assertProductionRuntimeOperationAuthority(registration.parent, active);
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

interface CanonicalRegistrationBox {
  value: CanonicalPipelineRuntimeRegistration | undefined;
}

function claimProcessCanonicalRegistrationBox(): CanonicalRegistrationBox {
  const existing = Object.getOwnPropertyDescriptor(
    globalThis,
    processCanonicalRegistrationBoxKey,
  );
  if (existing) {
    // Adopt the real, already-claimed shared box if a prior module instance created it; never adopt a
    // foreign, non-Atölye value that happens to occupy this exact process-global slot.
    return isCanonicalRegistrationBox(existing.value) ? existing.value : { value: undefined };
  }

  const box: CanonicalRegistrationBox = { value: undefined };
  Object.defineProperty(globalThis, processCanonicalRegistrationBoxKey, {
    configurable: false,
    enumerable: false,
    value: box,
    writable: false,
  });
  const claimed = Object.getOwnPropertyDescriptor(globalThis, processCanonicalRegistrationBoxKey)?.value;
  return claimed === box ? box : { value: undefined };
}

function isCanonicalRegistrationBox(value: unknown): value is CanonicalRegistrationBox {
  return typeof value === "object" && value !== null && "value" in value;
}

interface CanonicalPipelineRuntimeRegistration {
  readonly lifecycle: ProductionWorkerLifecycle;
  readonly parent: ProductionRuntimeOperationContext;
  readonly executeWithRuntimeOperationContext: ProductionWorkerLifecycle["executeWithRuntimeOperationContext"];
}
