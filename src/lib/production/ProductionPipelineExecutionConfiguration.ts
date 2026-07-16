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
  captureCanonicalProductionWorkerLifecycleExecution,
  ProductionWorkerLifecycle,
} from "./ProductionWorkerLifecycle";

export interface ConfigureProductionPipelineExecutionOptions {
  lifecycle?: ProductionWorkerLifecycle;
  runtimeOperationContext?: ProductionRuntimeOperationContext;
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
