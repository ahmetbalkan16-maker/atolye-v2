import type { ProductionStepKey } from "@/types/project";
import { pipelineRetryMaxAttempts } from "./PipelineRetryAdmission";

const LOCAL_RESPONSE_ERRORS = new Set([
  "AI_PROVIDER_REQUEST_FAILED", "AI_RESPONSE_TRUNCATED", "AI_RESPONSE_INCOMPLETE",
  "AI_RESPONSE_INVALID_JSON", "AI_RESPONSE_SCHEMA_INVALID",
]);
export function isAutomaticRepairLocalBackend(config: { baseUrl: string; model: string }): boolean {
  try {
    const url = new URL(config.baseUrl);
    return ["http:", "https:"].includes(url.protocol) && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) &&
      !url.username && !url.password && !/cloud/i.test(config.model);
  } catch { return false; }
}
/** Admission only; the existing durable retry path still owns every write and final decision. */
export function planAutomaticLocalRepair(input: {
  stage: ProductionStepKey; provider: string; errorCode: string | undefined;
  status: string; attempts: number; enabled: boolean; freshRun: boolean; hasProviderOverrides: boolean; localBackend: boolean;
}): { allowed: boolean; delayMs: number } {
  const allowed = input.enabled && input.freshRun && !input.hasProviderOverrides && input.localBackend &&
    ["research", "script", "scenes"].includes(input.stage) && input.provider === "ollama" &&
    // job.attempts is the zero-based retry index; initial execution is index zero.
    input.status === "failed" && Number.isSafeInteger(input.attempts) && input.attempts >= 0 &&
    input.attempts + 1 < pipelineRetryMaxAttempts && LOCAL_RESPONSE_ERRORS.has(input.errorCode ?? "");
  return { allowed, delayMs: allowed ? 60_000 * 2 ** input.attempts : 0 };
}
