import { AsyncLocalStorage } from "node:async_hooks";

export type ProductionPipelineExecutionEvent =
  | "durable-entry"
  | "durable-attempt-persisted"
  | "durable-readback-verified"
  | "canonical-identity-extracted"
  | "lifecycle-bound"
  | "capability-issued"
  | "revalidation-entered";

export interface ProductionPipelineExecutionPlanIdentity {
  requestId: string;
  idempotencyKey: string;
  operation: string;
  leaseId: string;
}

interface ProductionPipelineExecutionInstrumentation {
  readonly onEvent?: (event: ProductionPipelineExecutionEvent) => void | Promise<void>;
  readonly poisonPlanAfterDurableAttempt?: (
    identity: ProductionPipelineExecutionPlanIdentity,
  ) => void;
}

const instrumentationStorage =
  new AsyncLocalStorage<ProductionPipelineExecutionInstrumentation>();

/** @internal Test-scoped observation only; it is not installed by production composition. */
export function runWithProductionPipelineExecutionInstrumentation<T>(
  instrumentation: ProductionPipelineExecutionInstrumentation,
  operation: () => T | Promise<T>,
): Promise<T> {
  return Promise.resolve(instrumentationStorage.run(instrumentation, operation));
}

export async function emitProductionPipelineExecutionEvent(
  event: ProductionPipelineExecutionEvent,
): Promise<void> {
  await instrumentationStorage.getStore()?.onEvent?.(event);
}

export function poisonProductionPipelineExecutionPlanAfterDurableAttempt(
  identity: ProductionPipelineExecutionPlanIdentity,
): void {
  instrumentationStorage.getStore()?.poisonPlanAfterDurableAttempt?.(identity);
}
