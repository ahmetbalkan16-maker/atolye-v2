export type PipelineStateKind = "jobs" | "history";
export type PipelineStateFailure = "malformed" | "invalid" | "read-failed";

export type PipelineStateErrorCode =
  | "PIPELINE_JOBS_STATE_MALFORMED"
  | "PIPELINE_JOBS_STATE_INVALID"
  | "PIPELINE_JOBS_STATE_READ_FAILED"
  | "PIPELINE_HISTORY_STATE_MALFORMED"
  | "PIPELINE_HISTORY_STATE_INVALID"
  | "PIPELINE_HISTORY_STATE_READ_FAILED";

const pipelineStateErrorRegistryKey = Symbol.for(
  "atolye.pipeline-state-error-registry",
);
const pipelineStateErrorRegistry = getPipelineStateErrorRegistry();

export class PipelineStateError extends Error {
  readonly code: PipelineStateErrorCode;

  constructor(
    readonly state: PipelineStateKind,
    readonly failure: PipelineStateFailure,
    readonly fileName: string,
    options?: { cause?: unknown },
  ) {
    super(`Pipeline state file "${fileName}" failed ${failure}.`, options);
    this.name = "PipelineStateError";
    this.code = getPipelineStateErrorCode(state, failure);
    pipelineStateErrorRegistry.add(this);
  }
}

export function getPipelineStatePublicError(error: unknown): {
  code: PipelineStateErrorCode;
  message: string;
} | null {
  if (!isPipelineStateError(error)) {
    return null;
  }

  return {
    code: error.code,
    message:
      error.state === "jobs"
        ? "Pipeline jobs state could not be read."
        : "Pipeline history state could not be read.",
  };
}

export function isPipelineStateError(
  error: unknown,
): error is PipelineStateError {
  if (
    !error ||
    typeof error !== "object" ||
    !pipelineStateErrorRegistry.has(error)
  ) {
    return false;
  }

  const candidate = error as PipelineStateError;

  return (
    isPipelineStateKind(candidate.state) &&
    isPipelineStateFailure(candidate.failure) &&
    candidate.fileName === getPipelineStateFileName(candidate.state) &&
    candidate.code ===
      getPipelineStateErrorCode(candidate.state, candidate.failure)
  );
}

function getPipelineStateErrorCode(
  state: PipelineStateKind,
  failure: PipelineStateFailure,
): PipelineStateErrorCode {
  const prefix =
    state === "jobs" ? "PIPELINE_JOBS_STATE" : "PIPELINE_HISTORY_STATE";

  if (failure === "malformed") {
    return `${prefix}_MALFORMED`;
  }

  if (failure === "invalid") {
    return `${prefix}_INVALID`;
  }

  return `${prefix}_READ_FAILED`;
}

function getPipelineStateFileName(state: PipelineStateKind) {
  return state === "jobs" ? "pipeline-jobs.json" : "pipeline-history.json";
}

function isPipelineStateKind(value: unknown): value is PipelineStateKind {
  return value === "jobs" || value === "history";
}

function isPipelineStateFailure(value: unknown): value is PipelineStateFailure {
  return (
    value === "malformed" || value === "invalid" || value === "read-failed"
  );
}

function getPipelineStateErrorRegistry() {
  const globalRegistry = globalThis as typeof globalThis & {
    [pipelineStateErrorRegistryKey]?: WeakSet<object>;
  };

  globalRegistry[pipelineStateErrorRegistryKey] ??= new WeakSet<object>();

  return globalRegistry[pipelineStateErrorRegistryKey];
}
