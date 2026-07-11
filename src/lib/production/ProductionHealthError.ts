export type ProductionHealthErrorCode =
  | "INVALID_PROJECT_SLUG"
  | "PROJECT_NOT_FOUND"
  | "SNAPSHOT_BUILD_FAILED"
  | "HEALTH_EVALUATION_FAILED"
  | "UNKNOWN_PRODUCTION_HEALTH_ERROR";

const publicMessages: Record<ProductionHealthErrorCode, string> = {
  INVALID_PROJECT_SLUG: "Invalid project slug.",
  PROJECT_NOT_FOUND: "Project not found.",
  SNAPSHOT_BUILD_FAILED: "Production snapshot could not be built.",
  HEALTH_EVALUATION_FAILED: "Production health could not be evaluated.",
  UNKNOWN_PRODUCTION_HEALTH_ERROR: "Production health could not be read.",
};

const httpStatuses: Record<ProductionHealthErrorCode, number> = {
  INVALID_PROJECT_SLUG: 400,
  PROJECT_NOT_FOUND: 404,
  SNAPSHOT_BUILD_FAILED: 500,
  HEALTH_EVALUATION_FAILED: 500,
  UNKNOWN_PRODUCTION_HEALTH_ERROR: 500,
};

export class ProductionHealthError extends Error {
  readonly message: string;
  readonly status: number;

  constructor(
    readonly code: ProductionHealthErrorCode,
    options?: { cause?: unknown },
  ) {
    const message = publicMessages[code];
    super(message, options);
    this.name = "ProductionHealthError";
    this.message = message;
    this.status = httpStatuses[code];
  }
}

export function isProductionHealthError(
  error: unknown,
): error is ProductionHealthError {
  return error instanceof ProductionHealthError;
}

export function toProductionHealthError(
  error: unknown,
): ProductionHealthError {
  return isProductionHealthError(error)
    ? error
    : new ProductionHealthError("UNKNOWN_PRODUCTION_HEALTH_ERROR", {
        cause: error,
      });
}
