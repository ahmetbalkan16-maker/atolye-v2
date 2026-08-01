import { AsyncLocalStorage } from "node:async_hooks";
import type { PipelineJob } from "@/types/pipelineJob";
import type { PipelineRetryAdmission } from "@/lib/pipeline/PipelineRetryAdmission";

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
const retryAdmissionStorage = new AsyncLocalStorage<PipelineRetryAdmission>();

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

export function withProductionAcceptanceRetryAdmission<T>(
  admission: PipelineRetryAdmission,
  previousJob: PipelineJob,
  operation: () => Promise<T>,
): Promise<T> {
  return retryAdmissionStorage.run(admission, () =>
    previousRetryJobStorage.run(Object.freeze({ ...previousJob }), operation));
}

export function getProductionAcceptanceRetryAdmission(): PipelineRetryAdmission | undefined {
  return retryAdmissionStorage.getStore();
}
