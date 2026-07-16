export type RuntimeMigrationCandidateErrorCode =
  | "INVALID_ARGUMENT"
  | "DESTINATION_INVALID"
  | "CAPABILITY_UNSUPPORTED"
  | "BACKUP_REQUIRED"
  | "BACKUP_INVALID"
  | "SOURCE_STALE"
  | "CANDIDATE_INVALID"
  | "CANDIDATE_DIGEST_MISMATCH"
  | "CANDIDATE_ID_MISMATCH"
  | "INVENTORY_MISMATCH"
  | "AGGREGATE_MISMATCH"
  | "CRITICAL_STATE_MISMATCH"
  | "PATH_POLICY_VIOLATION"
  | "UNSUPPORTED_FILE_TYPE"
  | "CANDIDATE_TARGET_EXISTS"
  | "CANDIDATE_RECOVERY_REQUIRED"
  | "CANDIDATE_CREATE_FAILED";

const messages: Readonly<Record<RuntimeMigrationCandidateErrorCode, string>> = Object.freeze({
  INVALID_ARGUMENT: "Migration candidate input is invalid.",
  DESTINATION_INVALID: "Migration candidate destination is invalid.",
  CAPABILITY_UNSUPPORTED: "Migration candidate destination capability is unsupported.",
  BACKUP_REQUIRED: "An explicit verified runtime backup is required.",
  BACKUP_INVALID: "Runtime backup verification failed.",
  SOURCE_STALE: "Runtime backup is not current for the live runtime.",
  CANDIDATE_INVALID: "Migration candidate verification failed.",
  CANDIDATE_DIGEST_MISMATCH: "Migration candidate digest verification failed.",
  CANDIDATE_ID_MISMATCH: "Migration candidate identity verification failed.",
  INVENTORY_MISMATCH: "Migration candidate inventory verification failed.",
  AGGREGATE_MISMATCH: "Migration candidate aggregate verification failed.",
  CRITICAL_STATE_MISMATCH: "Migration candidate critical state verification failed.",
  PATH_POLICY_VIOLATION: "Migration candidate path policy verification failed.",
  UNSUPPORTED_FILE_TYPE: "Migration candidate contains an unsupported filesystem object.",
  CANDIDATE_TARGET_EXISTS: "Migration candidate target already exists.",
  CANDIDATE_RECOVERY_REQUIRED: "Migration candidate target requires operator recovery.",
  CANDIDATE_CREATE_FAILED: "Migration candidate creation failed.",
});

export class RuntimeMigrationCandidateError extends Error {
  constructor(readonly code: RuntimeMigrationCandidateErrorCode) {
    super(messages[code]);
    this.name = "RuntimeMigrationCandidateError";
    this.stack = undefined;
  }

  toJSON() {
    return Object.freeze({ name: this.name, code: this.code, message: this.message });
  }
}

export function migrationCandidateError(
  error: unknown,
  fallback: RuntimeMigrationCandidateErrorCode,
): RuntimeMigrationCandidateError {
  return error instanceof RuntimeMigrationCandidateError
    ? error
    : new RuntimeMigrationCandidateError(fallback);
}
