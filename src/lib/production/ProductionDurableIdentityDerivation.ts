import type { ProductionExecutionIdempotencyRecord } from "@/types/productionExecutionIdempotency";
import type { ProductionStepKey } from "@/types/project";
import { buildProductionPipelineExecutionIdentity } from "./ProductionPipelineExecutionIdentity";

/**
 * Derives a durable execution's sibling identity (claimId/attemptId/leaseId/
 * runningEventId/terminalEventId) directly from an already-persisted record's
 * own stable fields — never by recomputing `buildProductionPipelineExecutionIdentity()`
 * against the CURRENT regeneration roster.
 *
 * Not "trusting the record blindly": `requestId`/`idempotencyKey`/
 * `executionFingerprint` are read directly from already-integrity-validated
 * fields already present on `record` itself. `claimId`/`leaseId`/`attemptId`/
 * `runningEventId`/`terminalEventId` are not separate persisted fields, but
 * `buildProductionPipelineExecutionIdentity` proves they share the exact same
 * hash suffix as `recordId` by construction — `stableProductionId`/`secureId`
 * hash only the shared `core` value, never the prefix label — so deriving
 * them via prefix substitution on the already-trusted `recordId` is an exact,
 * mathematically guaranteed relationship, not a heuristic.
 *
 * Safe against `regenerationBindingForExecution()`'s current-roster-dependent
 * `maxGen` filter (`ProductionCompletedStageRegenerationStore.ts`): a record
 * created under an older generation keeps resolving to its own claim/attempt/
 * lease siblings even after a newer generation is created for the same stage
 * later. See this session's forensic reports on pipeline-record-507fb8ec and,
 * later, ca987045.../86bdc950 for the exact time-dependency mechanism this
 * avoids.
 *
 * NOT valid for verifying that a record's OWN `recordId` was legitimately
 * derived from an authorized regeneration lineage in the first place — that
 * would be circular (the record trivially "matches itself"). For that
 * integrity check, see `resolveHistoricalRecordIdentity()` in
 * `ProductionDurableAttemptLineageClassifier.ts`, which searches every
 * historically-eligible regeneration candidate instead.
 */
export function deriveCanonicalIdentityFromRecord(
  record: ProductionExecutionIdempotencyRecord,
  projectSlug: string,
): ReturnType<typeof buildProductionPipelineExecutionIdentity> | undefined {
  const match = /^pipeline-record-(.+)$/.exec(record.recordId);
  if (!match) return undefined;
  const suffix = match[1];
  return {
    core: {
      projectSlug,
      stage: record.stage as ProductionStepKey,
      jobId: `${projectSlug}-${record.stage}`,
      attemptNumber: record.attempt - 1,
    },
    requestId: record.requestId,
    idempotencyKey: record.idempotencyKey,
    executionFingerprint: record.executionFingerprint,
    claimId: `pipeline-claim-${suffix}`,
    leaseId: `pipeline-lease-${suffix}`,
    attemptId: `pipeline-attempt-${suffix}`,
    recordId: record.recordId,
    runningEventId: `pipeline-running-${suffix}`,
    terminalEventId: `pipeline-terminal-${suffix}`,
  };
}
