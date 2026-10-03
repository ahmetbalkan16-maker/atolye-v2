/**
 * Stage 16.0 — pure revenue action policy. No IO, no adapter call, no authority.
 *
 * The operation is chosen by trusted application code and arrives as a typed request; text from a
 * prompt, a platform or research never selects it. The decision is one of four:
 *   ALLOW_READ         READ_ONLY operation, declared by the adapter, zero-cost transport
 *   ALLOW_LOCAL_DRAFT  LOCAL_DRAFT operation, same conditions; nothing leaves the machine
 *   REQUIRE_OWNER      EXTERNAL_WRITE; Stage 16.0 has no executor, a later owner-authorized bridge decides
 *   DENY               everything else, including every FINANCIAL_COMMITMENT (never autonomous)
 * The zero-cost policy is a decision input: an unknown or paid cost is DENY, never zero.
 */
import { evaluateAyasZeroCost, type AyasCostDecision } from "../policy/AyasZeroCostPolicy";
import {
  AYAS_REVENUE_EFFECT_MODE, AYAS_REVENUE_LIMITS, AYAS_REVENUE_MODES, AYAS_REVENUE_OPERATION_EFFECT, AYAS_REVENUE_SCHEMA_VERSION,
  type AyasRevenueAdapterManifest, type AyasRevenueAdapterRequest, type AyasRevenueEffect, type AyasRevenueMode, type AyasRevenueOperation, type AyasRevenuePlatform,
} from "./AyasRevenuePlatformTypes";
import {
  containsAyasRevenueSensitiveData, hasExactAyasRevenueKeys, isAyasRevenueBoundedJson, isAyasRevenueExternalId, isAyasRevenueOperation, isAyasRevenuePlainRecord,
  isAyasRevenuePlatform, isAyasRevenueRequestId, isAyasRevenueSensitiveText, isAyasRevenueTimestamp, readAyasRevenueCursor,
} from "./AyasRevenueRedaction";

export type AyasRevenueDecision = "ALLOW_READ" | "ALLOW_LOCAL_DRAFT" | "REQUIRE_OWNER" | "DENY";
export type AyasRevenueReason =
  | "READ_ELIGIBLE" | "LOCAL_DRAFT_ELIGIBLE" | "EXTERNAL_WRITE_REQUIRES_OWNER" | "FINANCIAL_NOT_AUTONOMOUS"
  | "REQUEST_INVALID" | "UNKNOWN_PLATFORM" | "UNKNOWN_OPERATION" | "ADAPTER_NOT_REGISTERED" | "PLATFORM_MISMATCH"
  | "MODE_MISMATCH" | "OPERATION_NOT_SUPPORTED" | "CURSOR_SCOPE_MISMATCH" | "COST_DENIED";
export interface AyasRevenuePlan {
  readonly schemaVersion: typeof AYAS_REVENUE_SCHEMA_VERSION;
  readonly requestId: string | null;
  readonly platform: AyasRevenuePlatform | null;
  readonly operation: AyasRevenueOperation | null;
  readonly effect: AyasRevenueEffect | null;
  readonly decision: AyasRevenueDecision;
  readonly reason: AyasRevenueReason;
  readonly cost: AyasCostDecision["reasonCode"] | null;
  /** True only for ALLOW_READ / ALLOW_LOCAL_DRAFT. An owner-required write is not executable here. */
  readonly executable: boolean;
  readonly grantsAuthority: false;
  readonly monetaryAuthority: "NONE";
}

export const ayasRevenueEffect = (operation: AyasRevenueOperation): AyasRevenueEffect => AYAS_REVENUE_OPERATION_EFFECT[operation];
export const ayasRevenueModeFor = (operation: AyasRevenueOperation): AyasRevenueMode => AYAS_REVENUE_EFFECT_MODE[ayasRevenueEffect(operation)];

const REQUEST_REQUIRED = ["requestId", "platform", "operation", "mode", "accountRef", "requestedAt"] as const;
const REQUEST_OPTIONAL = ["cursor", "limit", "payload"] as const;
/** Shape only: exact keys, bounded identifiers, timestamp, limit and payload. Platform/operation membership is decided separately. */
export function isAyasRevenueRequestShape(raw: unknown): raw is AyasRevenueAdapterRequest {
  if (!isAyasRevenuePlainRecord(raw) || !hasExactAyasRevenueKeys(raw, REQUEST_REQUIRED, REQUEST_OPTIONAL)) return false;
  if (!isAyasRevenueRequestId(raw.requestId) || typeof raw.platform !== "string" || typeof raw.operation !== "string"
    || !(AYAS_REVENUE_MODES as readonly unknown[]).includes(raw.mode) || !isAyasRevenueTimestamp(raw.requestedAt)
    || (raw.accountRef !== null && !isAyasRevenueExternalId(raw.accountRef))) return false;
  if (Object.hasOwn(raw, "cursor") && raw.cursor !== null && (typeof raw.cursor !== "string" || raw.cursor.length > 600 || isAyasRevenueSensitiveText(raw.cursor))) return false;
  if (Object.hasOwn(raw, "limit") && (!Number.isSafeInteger(raw.limit) || (raw.limit as number) < 1 || (raw.limit as number) > AYAS_REVENUE_LIMITS.pageLimit)) return false;
  // A request is a task packet: no credential, contact detail or bank/card/tax identifier travels in it.
  return !Object.hasOwn(raw, "payload") || (isAyasRevenueBoundedJson(raw.payload, AYAS_REVENUE_LIMITS.payloadBytes) && !containsAyasRevenueSensitiveData(raw.payload));
}

function plan(request: Partial<AyasRevenueAdapterRequest> | null, decision: AyasRevenueDecision, reason: AyasRevenueReason, cost: AyasRevenuePlan["cost"] = null): AyasRevenuePlan {
  const operation = request && isAyasRevenueOperation(request.operation) ? request.operation : null;
  return Object.freeze({
    schemaVersion: AYAS_REVENUE_SCHEMA_VERSION,
    requestId: request && isAyasRevenueRequestId(request.requestId) ? request.requestId : null,
    platform: request && isAyasRevenuePlatform(request.platform) ? request.platform : null,
    operation, effect: operation ? ayasRevenueEffect(operation) : null,
    decision, reason, cost, executable: decision === "ALLOW_READ" || decision === "ALLOW_LOCAL_DRAFT",
    grantsAuthority: false as const, monetaryAuthority: "NONE" as const,
  });
}

/** `manifest` is the manifest of the adapter registered for the request's platform, or null when none is. */
export function decideAyasRevenueOperation(manifest: AyasRevenueAdapterManifest | null, raw: unknown): AyasRevenuePlan {
  if (!isAyasRevenueRequestShape(raw)) return plan(null, "DENY", "REQUEST_INVALID");
  const request = raw;
  if (!isAyasRevenuePlatform(request.platform)) return plan(request, "DENY", "UNKNOWN_PLATFORM");
  if (!isAyasRevenueOperation(request.operation)) return plan(request, "DENY", "UNKNOWN_OPERATION");
  const effect = ayasRevenueEffect(request.operation);
  // Money never moves autonomously, whatever the adapter, mode or cost says.
  if (effect === "FINANCIAL_COMMITMENT") return plan(request, "DENY", "FINANCIAL_NOT_AUTONOMOUS");
  if (manifest === null) return plan(request, "DENY", "ADAPTER_NOT_REGISTERED");
  if (manifest.platform !== request.platform) return plan(request, "DENY", "PLATFORM_MISMATCH");
  if (request.mode !== AYAS_REVENUE_EFFECT_MODE[effect]) return plan(request, "DENY", "MODE_MISMATCH");
  if (!manifest.supportedOperations.includes(request.operation)) return plan(request, "DENY", "OPERATION_NOT_SUPPORTED");
  if (request.cursor !== undefined && request.cursor !== null && readAyasRevenueCursor(request.cursor, request.platform, request.operation) === null)
    return plan(request, "DENY", "CURSOR_SCOPE_MISMATCH");
  const cost = evaluateAyasZeroCost(manifest.costClass);
  if (!cost.allowed) return plan(request, "DENY", "COST_DENIED", cost.reasonCode);
  if (effect === "EXTERNAL_WRITE") return plan(request, "REQUIRE_OWNER", "EXTERNAL_WRITE_REQUIRES_OWNER", cost.reasonCode);
  return effect === "READ_ONLY" ? plan(request, "ALLOW_READ", "READ_ELIGIBLE", cost.reasonCode) : plan(request, "ALLOW_LOCAL_DRAFT", "LOCAL_DRAFT_ELIGIBLE", cost.reasonCode);
}
