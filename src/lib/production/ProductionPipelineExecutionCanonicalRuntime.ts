import { randomUUID } from "node:crypto";
import { ProjectReader } from "@/lib/projects/ProjectReader";
import {
  assertProductionRuntimeOperationAuthority,
  assertProductionRuntimeOperationContext,
  deriveProductionRuntimeOperationContext,
  getActiveProductionRuntimeOperationContext,
  requireProductionRuntimeStorageContext,
  ProductionRuntimeOperationContextError,
  type ProductionRuntimeOperationContext,
} from "@/lib/runtime/ProductionRuntimeOperationContext";
import {
  ProductionPipelineExecutionAdapter,
  type ProductionPipelineExecutionContext,
} from "./ProductionPipelineExecutionAdapter";
import { ProductionExecutionFilePersistenceAdapter } from "./ProductionExecutionPersistence";
import { prepareProductionPipelineExecution, readCompletedProductionPipelinePreparation,
  type ProductionPipelineCompletedPreparationAuthority } from
  "./ProductionPipelineExecutionFactory";
import { emitProductionPipelineExecutionEvent } from
  "./ProductionPipelineExecutionInstrumentation";
import {
  type ProductionAcceptanceStageCapability,
  type ProductionAcceptanceStageExecutionIdentity,
} from "./ProductionAcceptancePolicy";
import {
  settlePendingSuccessfulProductionPipelineExecutions,
  settleFailedProductionPipelineExecution,
  settleSuccessfulProductionPipelineExecution,
} from "./ProductionPipelineTerminalSettlement";
import {
  captureCanonicalProductionWorkerLifecycleExecution,
  ProductionWorkerLifecycle,
  runWithProductionWorkerLifecycleIdentity,
} from "./ProductionWorkerLifecycle";

const processCanonicalLockKey = Symbol.for(
  "@atolye/production-pipeline-execution-canonical-authority-lock/v1",
);
const moduleProvenance = Object.freeze({});
const ownsProcessCanonicalLock = claimProcessCanonicalLock();

/**
 * Process-global mutable registration slot, shared (via globalThis + Symbol.for) across every module
 * instance of this file that may be loaded in the same OS process — e.g. one instance reached through
 * instrumentation.ts's boot-time registration, another reached independently through a Next.js route
 * handler's own module graph. Write access still requires `ownsProcessCanonicalLock` (below,
 * unchanged), so only the one module instance that first claimed the process lock may install or
 * restore a registration. Reads must not depend on that per-instance ownership flag: a non-owning
 * instance still needs to observe the one true registration the owning instance installed, or it
 * wrongly concludes no registration exists at all.
 */
const processCanonicalRegistrationBoxKey = Symbol.for(
  "@atolye/production-pipeline-execution-canonical-runtime-registration-box/v1",
);
const processCanonicalRegistrationBox = claimProcessCanonicalRegistrationBox();

/** @internal Opaque process-state token for scoped canonical composition. */
export interface CanonicalProductionPipelineExecutionSnapshot {
  readonly registration: CanonicalProductionPipelineExecutionRegistration | undefined;
}

export function snapshotCanonicalProductionPipelineExecutionRuntime():
CanonicalProductionPipelineExecutionSnapshot {
  return Object.freeze({ registration: processCanonicalRegistrationBox.value });
}

export function restoreCanonicalProductionPipelineExecutionRuntime(
  snapshot: CanonicalProductionPipelineExecutionSnapshot,
  expectedCurrent: CanonicalProductionPipelineExecutionSnapshot,
): void {
  assertProcessCanonicalLockOwnership();
  if (processCanonicalRegistrationBox.value !== expectedCurrent.registration) {
    throw new ProductionRuntimeOperationContextError("RUNTIME_OPERATION_CONTEXT_MISMATCH");
  }
  processCanonicalRegistrationBox.value = snapshot.registration;
}

type ProductionPipelineStageExecutor = (
  context: ProductionPipelineExecutionContext,
  handler: (capability: ProductionAcceptanceStageCapability | undefined,
    identity: ProductionAcceptanceStageExecutionIdentity,
    authority: ProductionPipelineCompletedPreparationAuthority) => Promise<boolean>,
) => Promise<boolean>;

/** @internal Install-only process-wide durable execution composition. */
export function installCanonicalProductionPipelineExecutionRuntime(
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
    throw new ProductionRuntimeOperationContextError(
      "RUNTIME_OPERATION_CONTEXT_MISMATCH",
    );
  }

  assertProductionRuntimeOperationContext(parent);
  const executor = createCanonicalProductionPipelineExecutionExecutor(
    lifecycle,
    parent,
  );
  processCanonicalRegistrationBox.value = Object.freeze({
    executor,
    lifecycle,
    parent,
  });
}

/** @internal Execute only through the first canonical factory closure. */
export async function executeCanonicalProductionPipelineStage(
  context: ProductionPipelineExecutionContext,
  handler: (capability: ProductionAcceptanceStageCapability | undefined,
    identity: ProductionAcceptanceStageExecutionIdentity,
    authority: ProductionPipelineCompletedPreparationAuthority) => Promise<boolean>,
): Promise<boolean> {
  const registration = processCanonicalRegistrationBox.value;
  if (!registration) {
    throw new ProductionRuntimeOperationContextError(
      "RUNTIME_OPERATION_CONTEXT_MISSING",
    );
  }
  return registration.executor(context, handler);
}

function createCanonicalProductionPipelineExecutionExecutor(
  lifecycle: ProductionWorkerLifecycle,
  parent: ProductionRuntimeOperationContext,
): ProductionPipelineStageExecutor {
  const executeWithRuntimeOperationContext =
    captureCanonicalProductionWorkerLifecycleExecution(lifecycle);
  lifecycle.bindRuntimeOperationContext(parent);

  return async (context, handler) => {
    const operation = () => executeDurableProductionPipelineStage(context, handler);
    const active = getActiveProductionRuntimeOperationContext();
    if (active) {
      assertProductionRuntimeOperationAuthority(parent, active);
      return executeWithRuntimeOperationContext(active, operation);
    }

    const operationContext = deriveProductionRuntimeOperationContext(parent, {
      operationId: `operation-${randomUUID()}`,
      operationType: "pipeline-stage-execution",
    });
    return executeWithRuntimeOperationContext(operationContext, operation);
  };
}

async function executeDurableProductionPipelineStage(
  context: ProductionPipelineExecutionContext,
  handler: (capability: ProductionAcceptanceStageCapability | undefined,
    identity: ProductionAcceptanceStageExecutionIdentity,
    authority: ProductionPipelineCompletedPreparationAuthority) => Promise<boolean>,
): Promise<boolean> {
  const active = getActiveProductionRuntimeOperationContext();
  if (!active) throw new ProductionRuntimeOperationContextError("RUNTIME_OPERATION_CONTEXT_MISSING");
  return executePreparedDurableProductionPipelineStage(context, handler, active);
}

async function executePreparedDurableProductionPipelineStage(
  context: ProductionPipelineExecutionContext,
  handler: (capability: ProductionAcceptanceStageCapability | undefined,
    identity: ProductionAcceptanceStageExecutionIdentity,
    authority: ProductionPipelineCompletedPreparationAuthority) => Promise<boolean>,
  active: ProductionRuntimeOperationContext,
): Promise<boolean> {
  const predecessorAdapter = new ProductionExecutionFilePersistenceAdapter({
    trustedRootDirectory: `${ProjectReader.getProjectFolder(context.projectSlug)}/production-execution`,
  });
  const predecessors = await settlePendingSuccessfulProductionPipelineExecutions(
    predecessorAdapter,
  );
  if (!predecessors.ok) {
    throw new Error(
      `Pipeline predecessor terminal settlement failed: ${predecessors.reasonCode}`,
    );
  }

  const prepared = await prepareProductionPipelineExecution(context);
  const completion = readCompletedProductionPipelinePreparation(
    prepared.authority,
  );
  const identity = completion.canonicalIdentity;
  const attempt = prepared.request.coordinator.attempt;
  if (attempt.attemptId !== identity.attemptId || attempt.recordId !== identity.recordId ||
    attempt.reservationId !== identity.reservationId || attempt.claimId !== identity.claimId ||
    attempt.leaseId !== identity.leaseId || completion.leaseId !== identity.leaseId ||
    attempt.executionFingerprint !== identity.executionFingerprint) {
    throw new ProductionRuntimeOperationContextError("RUNTIME_OPERATION_CONTEXT_MISMATCH");
  }
  return runWithProductionWorkerLifecycleIdentity(active, {
    projectSlug: identity.projectSlug,
    stage: identity.stage,
    operation: identity.operation,
    leaseId: identity.leaseId,
    executionFingerprint: identity.executionFingerprint,
  }, async () => {
    await emitProductionPipelineExecutionEvent("lifecycle-bound");
    return new ProductionPipelineExecutionAdapter(
      prepared.executionAdapter,
      () => prepared.request,
      (result) => settleSuccessfulProductionPipelineExecution(prepared.settlement, result),
      (result) => settleFailedProductionPipelineExecution({
        ...prepared.settlement,
        expectedProjectSlug: context.projectSlug,
        expectedStage: context.stage,
        storageContext: requireProductionRuntimeStorageContext(active),
      }, result),
    ).execute(context, () => handler(undefined, identity, prepared.authority));
  });
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

interface CanonicalProductionPipelineExecutionRegistrationBox {
  value: CanonicalProductionPipelineExecutionRegistration | undefined;
}

function claimProcessCanonicalRegistrationBox(): CanonicalProductionPipelineExecutionRegistrationBox {
  const existing = Object.getOwnPropertyDescriptor(
    globalThis,
    processCanonicalRegistrationBoxKey,
  );
  if (existing) {
    // Adopt the real, already-claimed shared box if a prior module instance created it; never adopt a
    // foreign, non-Atölye value that happens to occupy this exact process-global slot.
    return isCanonicalRegistrationBox(existing.value) ? existing.value : { value: undefined };
  }

  const box: CanonicalProductionPipelineExecutionRegistrationBox = { value: undefined };
  Object.defineProperty(globalThis, processCanonicalRegistrationBoxKey, {
    configurable: false,
    enumerable: false,
    value: box,
    writable: false,
  });
  const claimed = Object.getOwnPropertyDescriptor(globalThis, processCanonicalRegistrationBoxKey)?.value;
  return claimed === box ? box : { value: undefined };
}

function isCanonicalRegistrationBox(
  value: unknown,
): value is CanonicalProductionPipelineExecutionRegistrationBox {
  return typeof value === "object" && value !== null && "value" in value;
}

interface CanonicalProductionPipelineExecutionRegistration {
  readonly executor: ProductionPipelineStageExecutor;
  readonly lifecycle: ProductionWorkerLifecycle;
  readonly parent: ProductionRuntimeOperationContext;
}
