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
import { prepareProductionPipelineExecution } from "./ProductionPipelineExecutionFactory";
import {
  settlePendingSuccessfulProductionPipelineExecutions,
  settleSuccessfulProductionPipelineExecution,
} from "./ProductionPipelineTerminalSettlement";
import {
  captureCanonicalProductionWorkerLifecycleExecution,
  ProductionWorkerLifecycle,
} from "./ProductionWorkerLifecycle";

const processCanonicalLockKey = Symbol.for(
  "@atolye/production-pipeline-execution-canonical-authority-lock/v1",
);
const moduleProvenance = Object.freeze({});
const ownsProcessCanonicalLock = claimProcessCanonicalLock();
let canonicalRegistration: CanonicalProductionPipelineExecutionRegistration | undefined;

type ProductionPipelineStageExecutor = (
  context: ProductionPipelineExecutionContext,
  handler: () => Promise<boolean>,
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
  handler: () => Promise<boolean>,
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
  handler: () => Promise<boolean>,
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
  return new ProductionPipelineExecutionAdapter(
    prepared.adapter,
    () => prepared.request,
    (result) => settleSuccessfulProductionPipelineExecution(prepared.settlement, result),
  ).execute(context, handler);
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
