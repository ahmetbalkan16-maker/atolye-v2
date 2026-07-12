import type { ProductionExecutionIdempotencyRecord, ProductionExecutionIdempotencyReservationRequest } from "./productionExecutionIdempotency";
import type { ProductionExecutionTransactionPlan } from "./productionExecutionTransaction";
import type { ProductionOperationJournalEvent } from "./productionOperationJournal";
import type { ProductionExecutionDurableClaimRecord } from "./productionExecutionDurableClaim";
import type { ProductionExecutionDurableAttemptRecord } from "./productionExecutionDurableAttempt";

export type ProductionExecutionPersistenceRecordKind = "transaction" | "journal" | "idempotency" | "reservation" | "claim" | "attempt";

export interface ProductionExecutionPersistencePayloadByKind {
  transaction: ProductionExecutionTransactionPlan;
  journal: readonly ProductionOperationJournalEvent[];
  idempotency: ProductionExecutionIdempotencyRecord;
  reservation: ProductionExecutionIdempotencyReservationRequest;
  claim: ProductionExecutionDurableClaimRecord;
  attempt: ProductionExecutionDurableAttemptRecord;
}

export type ProductionExecutionPersistenceErrorCode =
  | "PERSISTENCE_INVALID_INPUT" | "PERSISTENCE_SCHEMA_UNSUPPORTED" | "PERSISTENCE_SERIALIZATION_FAILED"
  | "PERSISTENCE_DIRECTORY_MISSING" | "PERSISTENCE_NOT_FOUND" | "PERSISTENCE_READ_FAILED" | "PERSISTENCE_RECORD_CORRUPT"
  | "PERSISTENCE_TEMP_WRITE_FAILED" | "PERSISTENCE_TEMP_VALIDATION_FAILED" | "PERSISTENCE_COMMIT_FAILED"
  | "PERSISTENCE_EXISTING_RECORD_CONFLICT";

export interface ProductionExecutionPersistenceDiagnostic {
  operation: "directory" | "read" | "temp-write" | "temp-read" | "commit" | "cleanup";
  causeCode: string;
  tempArtifactPossible: boolean;
}

export type ProductionExecutionPersistenceWriteResult<K extends ProductionExecutionPersistenceRecordKind> =
  | { ok: true; status: "created" | "idempotent-replay"; kind: K; key: string; diagnostics?: readonly ProductionExecutionPersistenceDiagnostic[] }
  | { ok: false; status: "failed"; kind: K; key: string; errorCode: ProductionExecutionPersistenceErrorCode; diagnostics?: readonly ProductionExecutionPersistenceDiagnostic[] };

export type ProductionExecutionPersistenceReadResult<K extends ProductionExecutionPersistenceRecordKind> =
  | { ok: true; status: "found"; kind: K; key: string; value: ProductionExecutionPersistencePayloadByKind[K] }
  | { ok: false; status: "not-found"; kind: K; key: string; errorCode: "PERSISTENCE_NOT_FOUND" }
  | { ok: false; status: "failed"; kind: K; key: string; errorCode: Exclude<ProductionExecutionPersistenceErrorCode, "PERSISTENCE_NOT_FOUND">; diagnostics?: readonly ProductionExecutionPersistenceDiagnostic[] };

export type ProductionExecutionPersistenceListResult<K extends ProductionExecutionPersistenceRecordKind> =
  | { ok: true; status: "listed"; kind: K; keys: readonly string[] }
  | { ok: false; status: "failed"; kind: K; errorCode: "PERSISTENCE_READ_FAILED"; diagnostics?: readonly ProductionExecutionPersistenceDiagnostic[] };

export interface ProductionExecutionPersistenceAdapter {
  write<K extends ProductionExecutionPersistenceRecordKind>(kind: K, key: string, value: ProductionExecutionPersistencePayloadByKind[K]): Promise<ProductionExecutionPersistenceWriteResult<K>>;
  read<K extends ProductionExecutionPersistenceRecordKind>(kind: K, key: string): Promise<ProductionExecutionPersistenceReadResult<K>>;
  listKeys<K extends ProductionExecutionPersistenceRecordKind>(kind: K): Promise<ProductionExecutionPersistenceListResult<K>>;
}
