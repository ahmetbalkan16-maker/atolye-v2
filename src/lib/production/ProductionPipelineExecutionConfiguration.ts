import {
  installPipelineRunnerProductionRuntime,
  PipelineRunner,
} from "@/lib/pipeline/PipelineRunner";
import {
  assertProductionRuntimeOperationAuthority,
  deriveProductionRuntimeOperationContext,
  getActiveProductionRuntimeOperationContext,
  ProductionRuntimeOperationContextError,
  type ProductionRuntimeOperationContext,
} from "@/lib/runtime/ProductionRuntimeOperationContext";
import { randomUUID } from "node:crypto";
import {
  installCanonicalProductionPipelineExecution,
} from "./ProductionPipelineExecutionFactory";
import {
  restoreCanonicalProductionPipelineExecutionRuntime,
  snapshotCanonicalProductionPipelineExecutionRuntime,
  type CanonicalProductionPipelineExecutionSnapshot,
} from "./ProductionPipelineExecutionCanonicalRuntime";
import {
  restorePipelineRunnerProductionRuntime,
  snapshotPipelineRunnerProductionRuntime,
  type PipelineRunnerProductionRuntimeSnapshot,
} from "@/lib/pipeline/PipelineRunnerCanonicalRuntime";
import {
  captureCanonicalProductionWorkerLifecycleExecution,
  ProductionWorkerLifecycle,
} from "./ProductionWorkerLifecycle";

export interface ConfigureProductionPipelineExecutionOptions {
  lifecycle?: ProductionWorkerLifecycle;
  runtimeOperationContext?: ProductionRuntimeOperationContext;
}

export interface ProductionPipelineExecutionConfigurationSnapshot {
  readonly runnerRuntime: PipelineRunnerProductionRuntimeSnapshot;
  readonly continuationAdmission: ReturnType<typeof PipelineRunner.snapshotContinuationAdmission>;
  readonly pipelineExecution: CanonicalProductionPipelineExecutionSnapshot;
}

export interface ScopedProductionPipelineExecutionRegistration {
  readonly fingerprint: string;
  restore(): void;
}

export function snapshotProductionPipelineExecutionConfiguration():
ProductionPipelineExecutionConfigurationSnapshot {
  return Object.freeze({
    runnerRuntime: snapshotPipelineRunnerProductionRuntime(),
    continuationAdmission: PipelineRunner.snapshotContinuationAdmission(),
    pipelineExecution: snapshotCanonicalProductionPipelineExecutionRuntime(),
  });
}

export function configureScopedProductionPipelineExecution(
  options: ConfigureProductionPipelineExecutionOptions,
): ScopedProductionPipelineExecutionRegistration {
  const previous = snapshotProductionPipelineExecutionConfiguration();
  const empty = Object.freeze({
    runnerRuntime: Object.freeze({ registration: undefined }),
    continuationAdmission: undefined,
    pipelineExecution: Object.freeze({ registration: undefined }),
  }) satisfies ProductionPipelineExecutionConfigurationSnapshot;
  restoreProductionPipelineExecutionConfiguration(empty, previous);
  try {
    configureProductionPipelineExecution(options);
  } catch (primaryError) {
    const partial = snapshotProductionPipelineExecutionConfiguration();
    try { restoreProductionPipelineExecutionConfiguration(previous, partial); }
    catch (restoreError) {
      throw new AggregateError([primaryError, restoreError],
        "Scoped production pipeline registration failed.");
    }
    throw primaryError;
  }
  const installed = snapshotProductionPipelineExecutionConfiguration();
  let restored = false;
  return Object.freeze({
    fingerprint: configurationFingerprint(installed),
    restore() {
      if (restored) throw new ProductionRuntimeOperationContextError("RUNTIME_OPERATION_CONTEXT_MISMATCH");
      restoreProductionPipelineExecutionConfiguration(previous, installed);
      restored = true;
    },
  });
}

function restoreProductionPipelineExecutionConfiguration(
  target: ProductionPipelineExecutionConfigurationSnapshot,
  expectedCurrent: ProductionPipelineExecutionConfigurationSnapshot,
): void {
  const current = snapshotProductionPipelineExecutionConfiguration();
  if (current.runnerRuntime.registration !== expectedCurrent.runnerRuntime.registration ||
    current.continuationAdmission !== expectedCurrent.continuationAdmission ||
    current.pipelineExecution.registration !== expectedCurrent.pipelineExecution.registration) {
    throw new ProductionRuntimeOperationContextError("RUNTIME_OPERATION_CONTEXT_MISMATCH");
  }
  PipelineRunner.restoreContinuationAdmission(target.continuationAdmission,
    expectedCurrent.continuationAdmission);
  restoreCanonicalProductionPipelineExecutionRuntime(target.pipelineExecution,
    expectedCurrent.pipelineExecution);
  restorePipelineRunnerProductionRuntime(target.runnerRuntime, expectedCurrent.runnerRuntime);
}

function configurationFingerprint(value: ProductionPipelineExecutionConfigurationSnapshot): string {
  return [value.runnerRuntime.registration, value.continuationAdmission,
    value.pipelineExecution.registration].map((item) => item ? "configured" : "empty").join(":");
}

export function configureProductionPipelineExecution(
  options: ConfigureProductionPipelineExecutionOptions = {},
): boolean {
  if (!options.lifecycle || !options.runtimeOperationContext) {
    throw new ProductionRuntimeOperationContextError("RUNTIME_OPERATION_CONTEXT_MISSING");
  }

  const { lifecycle, runtimeOperationContext: parent } = options;
  installPipelineRunnerProductionRuntime(lifecycle, parent);
  PipelineRunner.configureContinuationAdmission(
    createCanonicalContinuationAdmission(lifecycle, parent),
  );

  installCanonicalProductionPipelineExecution(lifecycle, parent);
  return true;
}

function createCanonicalContinuationAdmission(
  lifecycle: ProductionWorkerLifecycle,
  parent: ProductionRuntimeOperationContext,
) {
  const executeWithRuntimeOperationContext =
    captureCanonicalProductionWorkerLifecycleExecution(lifecycle);
  return {
    async execute<T>(operation: () => T | Promise<T>): Promise<T> {
      const active = getActiveProductionRuntimeOperationContext();
      if (active) {
        assertProductionRuntimeOperationAuthority(parent, active);
        return executeWithRuntimeOperationContext(active, operation);
      }
      const context = deriveProductionRuntimeOperationContext(parent, {
        operationId: `operation-${randomUUID()}`,
        operationType: "pipeline-continuation",
      });
      return executeWithRuntimeOperationContext(context, operation);
    },
  };
}
