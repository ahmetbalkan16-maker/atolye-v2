import { AsyncLocalStorage } from "node:async_hooks";
import type { PipelineJob } from "@/types/pipelineJob";

export interface ProductionAcceptanceLegacyAdmittedExecution {
  readonly projectSlug: string;
  readonly stage: string;
  readonly runType: string;
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
const previousRetryJobStorage = new AsyncLocalStorage<PipelineJob>();

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

export function withProductionAcceptanceLegacyPreviousRetryJob<T>(
  job: PipelineJob,
  operation: () => Promise<T>,
): Promise<T> {
  return previousRetryJobStorage.run(Object.freeze({ ...job }), operation);
}

export function getProductionAcceptanceLegacyPreviousRetryJob(): PipelineJob | undefined {
  return previousRetryJobStorage.getStore();
}
