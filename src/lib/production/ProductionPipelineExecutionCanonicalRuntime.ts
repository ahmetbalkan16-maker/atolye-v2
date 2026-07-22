import { randomUUID } from "node:crypto";
import { ProjectReader } from "@/lib/projects/ProjectReader";
import {
  assertProductionRuntimeOperationAuthority,
  assertProductionRuntimeOperationContext,
  deriveProductionRuntimeOperationContext,
  getActiveProductionRuntimeOperationContext,
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
let canonicalRegistration: CanonicalProductionPipelineExecutionRegistration | undefined;

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
  if (canonicalRegistration) {
    if (
      canonicalRegistration.lifecycle === lifecycle &&
      canonicalRegistration.parent === parent
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
  canonicalRegistration = Object.freeze({
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
  assertProcessCanonicalLockOwnership();
  const registration = canonicalRegistration;
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
      prepared.adapter,
      () => prepared.request,
      (result) => settleSuccessfulProductionPipelineExecution(prepared.settlement, result),
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

interface CanonicalProductionPipelineExecutionRegistration {
  readonly executor: ProductionPipelineStageExecutor;
  readonly lifecycle: ProductionWorkerLifecycle;
  readonly parent: ProductionRuntimeOperationContext;
}
