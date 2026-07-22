import { AsyncLocalStorage } from "node:async_hooks";

export interface ProductionAcceptanceLegacyAdmittedExecution {
  readonly projectSlug: string;
  readonly stage: string;
  readonly runType: string;
  readonly jobId: string;
  readonly attemptNumber: number;
  readonly recordId: string;
  readonly reservationId: string;
  readonly claimId: string;
  readonly attemptId: string;
  readonly leaseId: string;
  readonly requestId: string;
  readonly idempotencyKey: string;
  readonly operation: string;
  readonly executionFingerprint: string;
  readonly durableAttemptRequired?: true;
}

const admittedExecutionStorage =
  new AsyncLocalStorage<ProductionAcceptanceLegacyAdmittedExecution>();

export function withProductionAcceptanceLegacyAdmittedExecution<T>(
  identity: ProductionAcceptanceLegacyAdmittedExecution,
  operation: () => Promise<T>,
): Promise<T> {
  return admittedExecutionStorage.run(Object.freeze({ ...identity }), operation);
}

export function getProductionAcceptanceLegacyAdmittedExecution():
ProductionAcceptanceLegacyAdmittedExecution | undefined {
  return admittedExecutionStorage.getStore();
}
