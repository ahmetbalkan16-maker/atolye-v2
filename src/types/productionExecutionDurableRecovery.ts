import type { ProductionExecutionPersistenceDiagnostic } from "./productionExecutionPersistence";

export const productionExecutionDurableRecoverySchemaVersion = "1" as const;
export const productionExecutionDerivedIndexVersion = "1" as const;

export type ProductionExecutionRecoveryReasonCode =
  | "RECOVERY_STORAGE_CLEAN" | "RECOVERY_RECORD_VALID" | "RECOVERY_RECORD_MISSING"
  | "RECOVERY_RECORD_MALFORMED" | "RECOVERY_RECORD_UNREADABLE" | "RECOVERY_SCHEMA_UNSUPPORTED"
  | "RECOVERY_STORAGE_VERSION_UNSUPPORTED" | "RECOVERY_INTEGRITY_MISMATCH"
  | "RECOVERY_ORPHAN_TEMP" | "RECOVERY_PARTIAL_ARTIFACT" | "RECOVERY_ARTIFACT_AMBIGUOUS"
  | "RECOVERY_INDEX_MISSING" | "RECOVERY_INDEX_STALE" | "RECOVERY_INDEX_MALFORMED"
  | "RECOVERY_INDEX_INTEGRITY_MISMATCH" | "RECOVERY_REQUIRED" | "RECOVERY_PATH_INVALID"
  | "RECOVERY_TRAVERSAL_DENIED" | "RECOVERY_APPLY_NOT_ALLOWED" | "RECOVERY_APPLY_FAILED"
  | "RECOVERY_INDETERMINATE";

export type ProductionExecutionRecoveryArtifactKind = "canonical-record" | "orphan-temp" | "partial-artifact" | "derived-index";
export interface ProductionExecutionRecoveryFinding {
  artifactId: string;
  artifactKind: ProductionExecutionRecoveryArtifactKind;
  classification: "valid" | "missing" | "malformed" | "unreadable" | "unsupported-version" | "integrity-mismatch" | "orphan" | "partial" | "stale" | "ambiguous";
  reasonCode: ProductionExecutionRecoveryReasonCode;
  recoveryRequired: boolean;
  applyAllowed: boolean;
  canonicalTargetPresent: boolean;
  evidence: readonly string[];
}
export interface ProductionExecutionRecoveryScanResult {
  schemaVersion: typeof productionExecutionDurableRecoverySchemaVersion;
  decision: "clean" | "recovery-required" | "indeterminate";
  reasonCode: ProductionExecutionRecoveryReasonCode;
  writeFree: true;
  findings: readonly ProductionExecutionRecoveryFinding[];
  evidence: readonly string[];
  diagnostics?: readonly ProductionExecutionPersistenceDiagnostic[];
}

export interface ProductionExecutionDerivedLookupEntry {
  key: string;
  recordId: string;
  recordVersion: number;
  canonicalKey: string;
}
export interface ProductionExecutionDerivedLookupIndex {
  schemaVersion: typeof productionExecutionDurableRecoverySchemaVersion;
  indexVersion: typeof productionExecutionDerivedIndexVersion;
  sourceFingerprint: string;
  reservations: readonly ProductionExecutionDerivedLookupEntry[];
  idempotencyKeys: readonly ProductionExecutionDerivedLookupEntry[];
  requestIds: readonly ProductionExecutionDerivedLookupEntry[];
  integrity: { algorithm: "sha256"; fingerprint: string };
}
export interface ProductionExecutionIndexResult {
  ok: boolean;
  reasonCode: ProductionExecutionRecoveryReasonCode;
  index?: ProductionExecutionDerivedLookupIndex;
  match?: ProductionExecutionDerivedLookupEntry;
  created?: boolean;
  evidence: readonly string[];
  diagnostics?: readonly ProductionExecutionPersistenceDiagnostic[];
}
export interface ProductionExecutionRecoveryApplyRequest {
  artifactId: string;
  operation: "cleanup" | "quarantine";
  scan: ProductionExecutionRecoveryScanResult;
}
export interface ProductionExecutionRecoveryApplyResult {
  ok: boolean;
  reasonCode: ProductionExecutionRecoveryReasonCode;
  applied: boolean;
  evidence: readonly string[];
  diagnostics?: readonly ProductionExecutionPersistenceDiagnostic[];
}
export type ProductionExecutionDirectoryDurabilityStatus = "supported" | "unsupported" | "failed" | "indeterminate";
export interface ProductionExecutionDirectoryDurabilityResult {
  status: ProductionExecutionDirectoryDurabilityStatus;
  reasonCode: "DIRECTORY_DURABILITY_SUPPORTED" | "DIRECTORY_DURABILITY_UNSUPPORTED" | "DIRECTORY_DURABILITY_FAILED" | "DIRECTORY_DURABILITY_INDETERMINATE";
  durable: boolean;
  evidence: readonly string[];
}
