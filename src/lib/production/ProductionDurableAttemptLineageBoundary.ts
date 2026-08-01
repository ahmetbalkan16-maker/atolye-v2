import { isAuthenticProductionPipelineDurableExecutionError,
  ProductionPipelineDurableExecutionError } from
  "./ProductionPipelineExecutionAdapter";

export const productionDurableAttemptLineageBindingInvalidCode =
  "PRODUCTION_DURABLE_ATTEMPT_LINEAGE_BINDING_INVALID" as const;

/** @internal Production-owned discriminator for durable-lineage admission decisions. */
export type ProductionDurableAttemptLineageBoundary =
  | "idempotency-list"
  | "record-read"
  | "record-integrity"
  | "record-ordinal-format"
  | "record-key-binding"
  | "no-applicable-lineage"
  | "version-contiguity"
  | "lineage-cardinality"
  | "record-ordinal-topology"
  | "record-operation-format"
  | "record-canonical-id"
  | "record-request-binding"
  | "record-idempotency-binding"
  | "record-execution-fingerprint"
  | "duplicate-attempt-plan"
  | "claim-list"
  | "claim-read"
  | "claim-integrity"
  | "claim-key-binding"
  | "claim-lineage-missing"
  | "claim-canonical-id"
  | "claim-record-binding"
  | "claim-reservation-binding"
  | "claim-request-binding"
  | "claim-idempotency-binding"
  | "claim-lease-binding"
  | "claim-execution-fingerprint"
  | "claim-record-operation-binding"
  | "attempt-list"
  | "attempt-read"
  | "attempt-integrity"
  | "attempt-key-binding"
  | "attempt-lineage-missing"
  | "attempt-canonical-id-topology"
  | "attempt-record-binding"
  | "attempt-claim-binding"
  | "attempt-lease-binding"
  | "attempt-reservation-binding"
  | "attempt-request-binding"
  | "attempt-idempotency-binding"
  | "attempt-execution-fingerprint"
  | "attempt-operation-presence"
  | "attempt-record-operation-binding"
  | "terminal-legacy-operation-compatibility"
  | "orphan-lineage"
  | "lineage-inventory"
  | "expected-attempt-ordinal";

const durableAttemptLineageBoundary = Symbol("production-durable-attempt-lineage-boundary");

type BoundaryCarrier = {
  readonly [durableAttemptLineageBoundary]?: ProductionDurableAttemptLineageBoundary;
};

/** @internal Creates the raw production error without widening its public serialized contract. */
export function createProductionDurableAttemptLineageBindingError(
  boundary: ProductionDurableAttemptLineageBoundary,
): ProductionPipelineDurableExecutionError {
  const error = new ProductionPipelineDurableExecutionError(
    "Production durable attempt lineage binding is invalid.",
    productionDurableAttemptLineageBindingInvalidCode,
  );
  Object.defineProperty(error, durableAttemptLineageBoundary, {
    value: boundary,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return error;
}

/** @internal Reads only production-attached raw boundary evidence. */
export function readProductionDurableAttemptLineageBoundary(
  error: unknown,
): ProductionDurableAttemptLineageBoundary | undefined {
  if (!isAuthenticProductionPipelineDurableExecutionError(error)) return undefined;
  return (error as ProductionPipelineDurableExecutionError & BoundaryCarrier)[
    durableAttemptLineageBoundary
  ];
}
