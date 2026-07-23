import { AsyncLocalStorage } from "node:async_hooks";

export type ProductionPipelineExecutionEvent =
  | "durable-entry"
  | "durable-attempt-persisted"
  | "durable-readback-verified"
  | "canonical-identity-extracted"
  | "lifecycle-bound"
  | "capability-issuance-entered"
  | "capability-issued"
  | "physical-store-identity-verified"
  | "descriptor-root-opened"
  | "descriptor-parent-opening"
  | "descriptor-parent-opened"
  | "descriptor-file-opening"
  | "descriptor-file-opened"
  | "descriptor-directory-opening"
  | "descriptor-directory-opened"
  | "descriptor-path-verified"
  | "provider-dispatch-entered"
  | "revalidation-entered";

export interface ProductionPipelineExecutionPlanIdentity {
  requestId: string;
  idempotencyKey: string;
  operation: string;
  leaseId: string;
}

export interface ProductionPipelineExecutionEventDetail {
  readonly locator?: string;
  readonly capability?: object;
  readonly identity?: object;
  readonly executionScope?: object;
  readonly stage?: string;
  readonly slot?: string;
  readonly selectionId?: string;
  readonly adapterId?: string;
}

interface ProductionPipelineExecutionInstrumentation {
  readonly onEvent?: (event: ProductionPipelineExecutionEvent,
    detail?: Readonly<ProductionPipelineExecutionEventDetail>) => void | Promise<void>;
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
  detail?: Readonly<ProductionPipelineExecutionEventDetail>,
): Promise<void> {
  await instrumentationStorage.getStore()?.onEvent?.(event, detail);
}

export function poisonProductionPipelineExecutionPlanAfterDurableAttempt(
  identity: ProductionPipelineExecutionPlanIdentity,
): void {
  instrumentationStorage.getStore()?.poisonPlanAfterDurableAttempt?.(identity);
}
