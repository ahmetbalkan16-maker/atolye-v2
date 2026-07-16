export type RuntimeMutationErrorCode =
  | "RUNTIME_MUTATION_PATH_INVALID"
  | "RUNTIME_MUTATION_PROTECTED_ROOT_OVERLAP"
  | "RUNTIME_MUTATION_CAPABILITY_UNAVAILABLE"
  | "RUNTIME_MUTATION_TARGET_EXISTS"
  | "RUNTIME_MUTATION_OWNERSHIP_MISMATCH"
  | "RUNTIME_MUTATION_SESSION_CLOSED"
  | "RUNTIME_MUTATION_FAILED";

export type RuntimeMutationCleanupStatus =
  | "not-required"
  | "completed"
  | "open-reservation"
  | "ownership-mismatch"
  | "orphan-suspect"
  | "failed";

export class RuntimeMutationError extends Error {
  readonly cause?: unknown;

  constructor(
    readonly code: RuntimeMutationErrorCode,
    readonly cleanupStatus: RuntimeMutationCleanupStatus = "not-required",
    cause?: unknown,
    readonly closeStatus: RuntimeMutationCleanupStatus = "not-required",
  ) {
    super(messageFor(code));
    this.name = "RuntimeMutationError";
    if (cause !== undefined) {
      Object.defineProperty(this, "cause", {
        configurable: false,
        enumerable: false,
        value: cause,
        writable: false,
      });
    }
    this.stack = undefined;
  }
}

export function normalizeRuntimeMutationError(
  error: unknown,
  cleanupStatus: RuntimeMutationCleanupStatus = "not-required",
  closeStatus: RuntimeMutationCleanupStatus = "not-required",
): RuntimeMutationError {
  if (error instanceof RuntimeMutationError) {
    if (cleanupStatus === "not-required" && closeStatus === "not-required") return error;
    return new RuntimeMutationError(
      error.code,
      cleanupStatus,
      error.cause ?? error,
      closeStatus,
    );
  }
  if (isTargetExists(error)) {
    return new RuntimeMutationError(
      "RUNTIME_MUTATION_TARGET_EXISTS",
      cleanupStatus,
      error,
      closeStatus,
    );
  }
  return new RuntimeMutationError("RUNTIME_MUTATION_FAILED", cleanupStatus, error, closeStatus);
}

function isTargetExists(error: unknown) {
  return error instanceof Error && "code" in error &&
    (error as NodeJS.ErrnoException).code === "EEXIST";
}

function messageFor(code: RuntimeMutationErrorCode) {
  switch (code) {
    case "RUNTIME_MUTATION_PROTECTED_ROOT_OVERLAP":
      return "Runtime mutation target overlaps a protected root.";
    case "RUNTIME_MUTATION_CAPABILITY_UNAVAILABLE":
      return "Required runtime filesystem capability is unavailable.";
    case "RUNTIME_MUTATION_TARGET_EXISTS":
      return "Runtime mutation target already exists.";
    case "RUNTIME_MUTATION_OWNERSHIP_MISMATCH":
      return "Runtime mutation ownership could not be verified.";
    case "RUNTIME_MUTATION_SESSION_CLOSED":
      return "Runtime mutation session is closed.";
    case "RUNTIME_MUTATION_FAILED":
      return "Runtime filesystem mutation failed.";
    default:
      return "Runtime mutation path is invalid.";
  }
}
