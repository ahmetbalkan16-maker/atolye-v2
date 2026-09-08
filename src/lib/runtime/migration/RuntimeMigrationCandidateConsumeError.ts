export type RuntimeMigrationCandidateConsumeErrorCode =
  | "CONSUME_INPUT_INVALID"
  | "CANDIDATE_NOT_VERIFIED"
  | "CANDIDATE_BINDING_MISMATCH"
  | "BACKUP_BINDING_MISMATCH"
  | "MANIFEST_BINDING_MISMATCH"
  | "CONSUME_ID_CANDIDATE_MISMATCH"
  | "CONSUME_STATE_CORRUPT"
  | "MIGRATION_TARGET_INVALID"
  | "MIGRATION_TARGET_NOT_EMPTY"
  | "MIGRATION_PROTECTED_ROOT_OVERLAP"
  | "MIGRATION_PATH_POLICY_VIOLATION"
  | "MIGRATION_UNSUPPORTED_FILE_TYPE"
  | "MATERIALIZATION_FAILED"
  | "POST_COPY_FILE_COUNT_MISMATCH"
  | "POST_COPY_BYTE_COUNT_MISMATCH"
  | "POST_COPY_DIGEST_MISMATCH"
  | "POST_COPY_INVENTORY_MISMATCH"
  | "DURABLE_BINDING_MISMATCH"
  | "DURABLE_RECOVERY_REQUIRED"
  | "CONSUME_INCOMPLETE";

const messages: Readonly<Record<RuntimeMigrationCandidateConsumeErrorCode, string>> = Object.freeze({
  CONSUME_INPUT_INVALID: "Migration candidate consume input is invalid.",
  CANDIDATE_NOT_VERIFIED: "Migration candidate did not pass verification before consume.",
  CANDIDATE_BINDING_MISMATCH: "Migration candidate identity does not match the consume request.",
  BACKUP_BINDING_MISMATCH: "Migration candidate is not bound to the supplied backup.",
  MANIFEST_BINDING_MISMATCH: "Migration candidate manifest does not match the expected manifest.",
  CONSUME_ID_CANDIDATE_MISMATCH: "consumeId is already bound to a different candidate.",
  CONSUME_STATE_CORRUPT: "Migration consume state metadata is unreadable or inconsistent.",
  MIGRATION_TARGET_INVALID: "Migration relocation target is not a safe real directory.",
  MIGRATION_TARGET_NOT_EMPTY: "Migration relocation target already holds runtime/project data.",
  MIGRATION_PROTECTED_ROOT_OVERLAP: "Migration roles (live/candidate/backup/target/quarantine) overlap.",
  MIGRATION_PATH_POLICY_VIOLATION: "Migration candidate file path violates the portable path policy.",
  MIGRATION_UNSUPPORTED_FILE_TYPE: "Migration candidate or target contains a symlink / junction / non-regular file.",
  MATERIALIZATION_FAILED: "Per-file materialization failed byte / digest verification.",
  POST_COPY_FILE_COUNT_MISMATCH: "Post-copy file count does not match the candidate.",
  POST_COPY_BYTE_COUNT_MISMATCH: "Post-copy byte count does not match the candidate.",
  POST_COPY_DIGEST_MISMATCH: "Post-copy content digest does not match the candidate payload.",
  POST_COPY_INVENTORY_MISMATCH: "Post-copy inventory does not match the candidate manifest.",
  DURABLE_BINDING_MISMATCH: "Post-copy durable-execution binding does not match the candidate.",
  DURABLE_RECOVERY_REQUIRED: "Post-copy durable-execution scan reports recovery-required.",
  CONSUME_INCOMPLETE: "Migration consume did not reach the consumed state.",
});

export class RuntimeMigrationCandidateConsumeError extends Error {
  constructor(readonly code: RuntimeMigrationCandidateConsumeErrorCode) {
    super(messages[code]);
    this.name = "RuntimeMigrationCandidateConsumeError";
    this.stack = undefined;
  }

  toJSON() {
    return Object.freeze({ name: this.name, code: this.code, message: this.message });
  }
}

export function migrationConsumeError(
  error: unknown,
  fallback: RuntimeMigrationCandidateConsumeErrorCode,
): RuntimeMigrationCandidateConsumeError {
  return error instanceof RuntimeMigrationCandidateConsumeError
    ? error
    : new RuntimeMigrationCandidateConsumeError(fallback);
}
