import { isValidProductionProjectSlug } from "./ProductionProjectSlug";
import { productionHealthSchemaVersion } from "@/types/productionHealth";
import type { ProductionHealthErrorCode } from "./ProductionHealthError";
import type { ProductionHealthReport } from "./ProductionHealthService";

export type ProductionHealthApiConsumerErrorKind =
  | "invalid_slug"
  | "api_error"
  | "network_error"
  | "timeout"
  | "aborted"
  | "malformed_response";

export interface GetProductionHealthOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

const safeMessages: Record<ProductionHealthApiConsumerErrorKind, string> = {
  invalid_slug: "Invalid project slug.",
  api_error: "Production health could not be read.",
  network_error: "Production health request failed.",
  timeout: "Production health request timed out.",
  aborted: "Production health request was cancelled.",
  malformed_response: "Production health response was invalid.",
};

const defaultTimeoutMs = 10_000;

export class ProductionHealthApiConsumerError extends Error {
  constructor(
    readonly kind: ProductionHealthApiConsumerErrorKind,
    readonly details: {
      code?: ProductionHealthErrorCode;
      status?: number;
    } = {},
  ) {
    super(safeMessages[kind]);
    this.name = "ProductionHealthApiConsumerError";
  }

  get code() {
    return this.details.code;
  }

  get status() {
    return this.details.status;
  }
}

export async function getProductionHealth(
  slug: string,
  options: GetProductionHealthOptions = {},
): Promise<ProductionHealthReport> {
  if (!isValidProductionProjectSlug(slug)) {
    throw new ProductionHealthApiConsumerError("invalid_slug", {
      code: "INVALID_PROJECT_SLUG",
      status: 400,
    });
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = normalizeTimeout(options.timeoutMs);
  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = () => controller.abort(options.signal?.reason);

  if (options.signal?.aborted) {
    controller.abort(options.signal.reason);
  } else {
    options.signal?.addEventListener("abort", abortFromCaller, { once: true });
  }

  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const cleanup = () => {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abortFromCaller);
  };

  let response: Response;
  try {
    response = await fetchImpl(buildUrl(slug, options.baseUrl), {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
  } catch {
    cleanup();
    if (timedOut) {
      throw new ProductionHealthApiConsumerError("timeout");
    }
    if (controller.signal.aborted) {
      throw new ProductionHealthApiConsumerError("aborted");
    }
    throw new ProductionHealthApiConsumerError("network_error");
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    if (timedOut) {
      throw new ProductionHealthApiConsumerError("timeout");
    }
    if (controller.signal.aborted) {
      throw new ProductionHealthApiConsumerError("aborted");
    }
    throw new ProductionHealthApiConsumerError("malformed_response", {
      status: response.status,
    });
  } finally {
    cleanup();
  }

  if (!response.ok) {
    if (!isApiErrorPayload(payload)) {
      throw new ProductionHealthApiConsumerError("malformed_response", {
        status: response.status,
      });
    }

    throw new ProductionHealthApiConsumerError(
      payload.error.code === "INVALID_PROJECT_SLUG"
        ? "invalid_slug"
        : "api_error",
      {
        code: payload.error.code,
        status: response.status,
      },
    );
  }

  if (!isSuccessPayload(payload, slug)) {
    throw new ProductionHealthApiConsumerError("malformed_response", {
      status: response.status,
    });
  }

  return payload.data;
}

export function isProductionHealthApiConsumerError(
  error: unknown,
): error is ProductionHealthApiConsumerError {
  return error instanceof ProductionHealthApiConsumerError;
}

function normalizeTimeout(value?: number) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : defaultTimeoutMs;
}

function buildUrl(slug: string, baseUrl?: string) {
  const endpoint = `/api/production/health/${encodeURIComponent(slug)}`;
  return baseUrl ? new URL(endpoint, baseUrl).toString() : endpoint;
}

function isSuccessPayload(
  value: unknown,
  projectSlug: string,
): value is { success: true; data: ProductionHealthReport } {
  if (!isRecord(value) || value.success !== true || !isRecord(value.data)) {
    return false;
  }

  const report = value.data;
  return (
    report.schemaVersion === productionHealthSchemaVersion &&
    report.projectSlug === projectSlug &&
    typeof report.generatedAt === "string" &&
    isSnapshot(report.snapshot, projectSlug) &&
    isHealthResult(report.health, report.generatedAt) &&
    (report.intelligence === undefined || isProductionIntelligence(report.intelligence))
  );
}

function isProductionIntelligence(value: unknown) {
  if (!isRecord(value) || !Array.isArray(value.actions) || !isRecord(value.graph) || !isRecord(value.plan)) return false;
  return (
    value.actions.every((action) =>
      isRecord(action) &&
      typeof action.id === "string" &&
      typeof action.findingRef === "string" &&
      typeof action.actionType === "string" &&
      typeof action.title === "string" &&
      typeof action.reason === "string" &&
      typeof action.confirmationRequired === "boolean"
    ) &&
    Array.isArray(value.graph.nodes) &&
    Array.isArray(value.graph.edges) &&
    Array.isArray(value.graph.blockedStages) &&
    value.graph.blockedStages.every(isProductionStage) &&
    Array.isArray(value.plan.steps) &&
    (value.plan.status === "ready" || value.plan.status === "blocked" || value.plan.status === "complete" || value.plan.status === "unknown")
  );
}

function isApiErrorPayload(value: unknown): value is {
  success: false;
  error: { code: ProductionHealthErrorCode; message: string };
} {
  return (
    isRecord(value) &&
    value.success === false &&
    isRecord(value.error) &&
    isProductionHealthErrorCode(value.error.code) &&
    typeof value.error.message === "string"
  );
}

function isSnapshot(value: unknown, projectSlug: string) {
  return (
    isRecord(value) &&
    value.schemaVersion === 1 &&
    typeof value.generatedAt === "string" &&
    isRecord(value.project) &&
    value.project.projectSlug === projectSlug &&
    isRecord(value.pipeline) &&
    typeof value.pipeline.effectiveStatus === "string" &&
    Array.isArray(value.stages) &&
    value.stages.every(isSnapshotStage) &&
    isRecord(value.queue) &&
    isRecord(value.history) &&
    isRecord(value.usage) &&
    Array.isArray(value.findings) &&
    value.findings.every(isFinding) &&
    isSourceState(value.sourceState)
  );
}

function isHealthResult(value: unknown, evaluatedAt: string) {
  return (
    isRecord(value) &&
    value.schemaVersion === productionHealthSchemaVersion &&
    value.evaluatedAt === evaluatedAt &&
    isOverallSeverity(value.overallSeverity) &&
    isHealthStatus(value.status) &&
    Array.isArray(value.findings) &&
    value.findings.every(isFinding) &&
    isCounts(value.counts) &&
    Array.isArray(value.affectedStages) &&
    value.affectedStages.every(isProductionStage) &&
    isSourceConfidence(value.sourceConfidence) &&
    isSummary(value.summary)
  );
}

function isSnapshotStage(value: unknown) {
  return (
    isRecord(value) &&
    isProductionStage(value.stage) &&
    typeof value.effectiveStatus === "string" &&
    Array.isArray(value.consistency) &&
    value.consistency.every(isFinding)
  );
}

function isFinding(value: unknown) {
  return (
    isRecord(value) &&
    typeof value.code === "string" &&
    (value.severity === "info" ||
      value.severity === "warning" ||
      value.severity === "critical") &&
    typeof value.scope === "string" &&
    Array.isArray(value.sources) &&
    value.sources.every((source) => typeof source === "string") &&
    typeof value.message === "string" &&
    isRecord(value.evidence) &&
    typeof value.detectedAt === "string"
  );
}

function isSourceState(value: unknown) {
  if (!isRecord(value) || !isRecord(value.stageOutputs)) return false;
  const stageOutputs = value.stageOutputs;
  return (
    isSourceStatus(value.project) &&
    isSourceStatus(value.manifest) &&
    isSourceStatus(value.jobs) &&
    isSourceStatus(value.history) &&
    isSourceStatus(value.aiUsage) &&
    productionStages.every((stage) => isSourceStatus(stageOutputs[stage]))
  );
}

function isSourceStatus(value: unknown) {
  return (
    isRecord(value) &&
    (value.status === "available" ||
      value.status === "missing" ||
      value.status === "malformed" ||
      value.status === "unreadable" ||
      value.status === "partial" ||
      value.status === "stale")
  );
}

function isSummary(value: unknown) {
  return (
    isRecord(value) &&
    typeof value.headline === "string" &&
    isFiniteNumber(value.criticalIssueCount) &&
    isFiniteNumber(value.warningIssueCount) &&
    isFiniteNumber(value.healthyStageCount) &&
    isFiniteNumber(value.affectedStageCount) &&
    typeof value.hasBlockingIssue === "boolean"
  );
}

function isCounts(value: unknown) {
  return (
    isRecord(value) &&
    isFiniteNumber(value.total) &&
    isFiniteNumber(value.info) &&
    isFiniteNumber(value.warning) &&
    isFiniteNumber(value.critical)
  );
}

function isSourceConfidence(value: unknown) {
  return (
    isRecord(value) &&
    (value.level === "complete" ||
      value.level === "partial" ||
      value.level === "unreliable") &&
    isFiniteNumber(value.availableSourceCount) &&
    isFiniteNumber(value.missingSourceCount) &&
    isFiniteNumber(value.malformedSourceCount) &&
    isFiniteNumber(value.unreadableSourceCount) &&
    isFiniteNumber(value.partialSourceCount)
  );
}

function isProductionHealthErrorCode(
  value: unknown,
): value is ProductionHealthErrorCode {
  return (
    value === "INVALID_PROJECT_SLUG" ||
    value === "PROJECT_NOT_FOUND" ||
    value === "SNAPSHOT_BUILD_FAILED" ||
    value === "HEALTH_EVALUATION_FAILED" ||
    value === "UNKNOWN_PRODUCTION_HEALTH_ERROR"
  );
}

function isOverallSeverity(value: unknown) {
  return (
    value === "none" ||
    value === "info" ||
    value === "warning" ||
    value === "critical"
  );
}

function isHealthStatus(value: unknown) {
  return (
    value === "healthy" ||
    value === "warning" ||
    value === "critical" ||
    value === "unknown"
  );
}

const productionStages = [
  "research",
  "script",
  "scenes",
  "visuals",
  "animation",
  "video",
  "audio",
  "assembly",
  "thumbnail",
  "seo",
  "youtube",
  "export",
] as const;

function isProductionStage(value: unknown) {
  return typeof value === "string" && productionStages.includes(
    value as (typeof productionStages)[number],
  );
}

function isFiniteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
