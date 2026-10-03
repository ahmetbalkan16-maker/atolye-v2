/**
 * Stage 16.0 — the adapter contract every revenue platform integration implements.
 *
 * An adapter is exactly `{ manifest, read, draft }`: a read for READ_ONLY operations and a local draft
 * for LOCAL_DRAFT operations. There is no method for an external write or a financial operation, so an
 * adapter cannot be handed one; an object with any other key is not an adapter. Manifests are
 * code-owned: write operations always require the owner and financial operations are never autonomous.
 * Results are DATA; a result that is forged, oversized or carries sensitive data is not passed on.
 */
import { evaluateAyasZeroCost, parseAyasCostClass, type AyasCostDecision } from "../policy/AyasZeroCostPolicy";
import {
  AYAS_REVENUE_CREDENTIAL_HANDLING, AYAS_REVENUE_EFFECTS, AYAS_REVENUE_LIMITS, AYAS_REVENUE_RESULT_STATUSES, AYAS_REVENUE_SCHEMA_VERSION, AYAS_REVENUE_TRANSPORTS,
  type AyasRevenueAdapterManifest, type AyasRevenueAdapterRequest, type AyasRevenueAdapterResult, type AyasRevenueEffect, type AyasRevenueOperation,
} from "./AyasRevenuePlatformTypes";
import { ayasRevenueEffect } from "./AyasRevenueActionPolicy";
import {
  containsAyasRevenueSensitiveData, deepFreezeAyasRevenueValue, hasExactAyasRevenueKeys, isAyasRevenueBoundedJson, isAyasRevenueErrorCode, isAyasRevenueOperation,
  isAyasRevenuePlainRecord, isAyasRevenuePlatform, isAyasRevenueSensitiveText, isAyasRevenueTimestamp, readAyasRevenueCursor, snapshotAyasRevenueValue,
} from "./AyasRevenueRedaction";

export interface AyasRevenuePlatformAdapter {
  readonly manifest: AyasRevenueAdapterManifest;
  /** READ_ONLY operations only; returns a raw result envelope that is validated before use. */
  read(request: AyasRevenueAdapterRequest): Promise<unknown>;
  /** LOCAL_DRAFT operations only; must not contact the platform. */
  draft(request: AyasRevenueAdapterRequest): Promise<unknown>;
}

const MANIFEST_KEYS = ["schemaVersion", "platform", "adapterId", "adapterVersion", "transport", "locality", "credentialHandling", "costClass",
  "supportedOperations", "writeOperationsRequireOwnerApproval", "financialOperationsAutonomous"] as const;
export function isAyasRevenueAdapterManifest(raw: unknown): raw is AyasRevenueAdapterManifest {
  if (!isAyasRevenuePlainRecord(raw) || !hasExactAyasRevenueKeys(raw, MANIFEST_KEYS)) return false;
  const ops = raw.supportedOperations;
  if (raw.schemaVersion !== AYAS_REVENUE_SCHEMA_VERSION || !isAyasRevenuePlatform(raw.platform)
    || typeof raw.adapterId !== "string" || !/^[a-z][a-z0-9-]{2,63}$/.test(raw.adapterId) || isAyasRevenueSensitiveText(raw.adapterId)
    || !Number.isSafeInteger(raw.adapterVersion) || (raw.adapterVersion as number) < 1 || (raw.adapterVersion as number) > AYAS_REVENUE_LIMITS.adapterVersionMax
    || !(AYAS_REVENUE_TRANSPORTS as readonly unknown[]).includes(raw.transport) || raw.locality !== "EXTERNAL"
    || !(AYAS_REVENUE_CREDENTIAL_HANDLING as readonly unknown[]).includes(raw.credentialHandling)
    || typeof raw.costClass !== "string" || parseAyasCostClass(raw.costClass) !== raw.costClass
    || raw.writeOperationsRequireOwnerApproval !== true || raw.financialOperationsAutonomous !== false
    || !Array.isArray(ops) || ops.length === 0 || new Set(ops).size !== ops.length || !ops.every(isAyasRevenueOperation)) return false;
  // A manual hand-off reaches no platform and holds no credential: local drafts only.
  if (raw.transport === "MANUAL_HANDOFF" && (raw.credentialHandling !== "NONE" || ops.some((op) => ayasRevenueEffect(op) !== "LOCAL_DRAFT"))) return false;
  return true;
}

/** Exactly `{ manifest, read, draft }`, a plain object, both methods functions, the manifest valid. */
export function isAyasRevenuePlatformAdapter(raw: unknown): raw is AyasRevenuePlatformAdapter {
  return isAyasRevenuePlainRecord(raw) && hasExactAyasRevenueKeys(raw, ["manifest", "read", "draft"])
    && typeof raw.read === "function" && typeof raw.draft === "function" && isAyasRevenueAdapterManifest(raw.manifest);
}

export interface AyasRevenueAdapterInspection {
  readonly valid: boolean;
  readonly platform: AyasRevenueAdapterManifest["platform"] | null;
  readonly adapterId: string | null;
  readonly adapterVersion: number | null;
  readonly transport: AyasRevenueAdapterManifest["transport"] | null;
  readonly credentialHandling: AyasRevenueAdapterManifest["credentialHandling"] | null;
  readonly cost: AyasCostDecision["reasonCode"] | null;
  readonly operations: Readonly<Record<AyasRevenueEffect, readonly AyasRevenueOperation[]>>;
  readonly writeOperationsRequireOwnerApproval: true;
  readonly financialOperationsAutonomous: false;
  readonly grantsAuthority: false;
}
/** A description only: what the adapter declares and which effect class each declared operation falls in. */
export function inspectRevenueAdapter(adapter: unknown): AyasRevenueAdapterInspection {
  const valid = isAyasRevenuePlatformAdapter(adapter), m = valid ? adapter.manifest : null;
  const operations = Object.fromEntries(AYAS_REVENUE_EFFECTS.map((effect) => [effect, Object.freeze(m ? m.supportedOperations.filter((op) => ayasRevenueEffect(op) === effect) : [])]));
  return Object.freeze({ valid, platform: m?.platform ?? null, adapterId: m?.adapterId ?? null, adapterVersion: m?.adapterVersion ?? null,
    transport: m?.transport ?? null, credentialHandling: m?.credentialHandling ?? null, cost: m ? evaluateAyasZeroCost(m.costClass).reasonCode : null,
    operations: Object.freeze(operations) as AyasRevenueAdapterInspection["operations"],
    writeOperationsRequireOwnerApproval: true as const, financialOperationsAutonomous: false as const, grantsAuthority: false as const });
}

const RESULT_REQUIRED = ["schemaVersion", "requestId", "platform", "operation", "status", "observedAt", "data", "nextCursor", "evidence"] as const;
export type AyasRevenueResultRefusal = "AYAS_REVENUE_RESULT_INVALID" | "AYAS_REVENUE_RESULT_SENSITIVE_REFUSED";
/**
 * Validates a raw adapter result against the request and the manifest and returns a fresh copy, or the refusal code.
 * Read and draft results can never report an external or monetary mutation.
 */
export function normalizeAyasRevenueResult(manifest: AyasRevenueAdapterManifest, request: AyasRevenueAdapterRequest, answer: unknown):
  { readonly ok: true; readonly result: AyasRevenueAdapterResult } | { readonly ok: false; readonly code: AyasRevenueResultRefusal } {
  const invalid = { ok: false as const, code: "AYAS_REVENUE_RESULT_INVALID" as const };
  // Read the answer once: what is validated and scanned is exactly what is passed on.
  const snapshot = snapshotAyasRevenueValue(answer);
  if (!snapshot.ok) return invalid;
  const raw = snapshot.value;
  if (!isAyasRevenuePlainRecord(raw) || !hasExactAyasRevenueKeys(raw, RESULT_REQUIRED, ["errorCode"])) return invalid;
  const evidence = raw.evidence;
  if (raw.schemaVersion !== AYAS_REVENUE_SCHEMA_VERSION || raw.requestId !== request.requestId || raw.platform !== request.platform || raw.operation !== request.operation
    || !(AYAS_REVENUE_RESULT_STATUSES as readonly unknown[]).includes(raw.status) || !isAyasRevenueTimestamp(raw.observedAt)
    || !isAyasRevenuePlainRecord(evidence) || !hasExactAyasRevenueKeys(evidence, ["transport", "externalMutation", "monetaryMutation"])
    || evidence.transport !== manifest.transport || evidence.externalMutation !== false || evidence.monetaryMutation !== false) return invalid;
  const status = raw.status as AyasRevenueAdapterResult["status"];
  if (Object.hasOwn(raw, "errorCode") !== (status === "BLOCKED" || status === "UNAVAILABLE" || status === "ERROR") || (Object.hasOwn(raw, "errorCode") && !isAyasRevenueErrorCode(raw.errorCode))) return invalid;
  if (status === "OK" ? raw.data === null || !isAyasRevenueBoundedJson(raw.data, AYAS_REVENUE_LIMITS.resultDataBytes)
    : status === "EMPTY" ? raw.data !== null && !(Array.isArray(raw.data) && raw.data.length === 0) : raw.data !== null) return invalid;
  // A next page is only meaningful with data, and only for the same platform and operation.
  if (raw.nextCursor !== null && (status !== "OK" || readAyasRevenueCursor(raw.nextCursor, request.platform, request.operation) === null)) return invalid;
  if (containsAyasRevenueSensitiveData(raw.data)) return { ok: false, code: "AYAS_REVENUE_RESULT_SENSITIVE_REFUSED" };
  const result: AyasRevenueAdapterResult = {
    schemaVersion: AYAS_REVENUE_SCHEMA_VERSION, requestId: request.requestId, platform: request.platform, operation: request.operation, status,
    observedAt: raw.observedAt as string, data: status === "OK" ? raw.data : null, nextCursor: raw.nextCursor as string | null,
    evidence: { transport: manifest.transport, externalMutation: false, monetaryMutation: false },
    ...(Object.hasOwn(raw, "errorCode") ? { errorCode: raw.errorCode as string } : {}),
  };
  return { ok: true, result: deepFreezeAyasRevenueValue(result) };
}

/** A result made here, never by the adapter: the request was not sent, or its answer was refused. */
export function ayasRevenueLocalResult(manifest: AyasRevenueAdapterManifest, request: AyasRevenueAdapterRequest, status: "BLOCKED" | "UNAVAILABLE" | "ERROR", errorCode: string, observedAt: string): AyasRevenueAdapterResult {
  return Object.freeze({ schemaVersion: AYAS_REVENUE_SCHEMA_VERSION, requestId: request.requestId, platform: request.platform, operation: request.operation, status, observedAt,
    data: null, nextCursor: null, evidence: Object.freeze({ transport: manifest.transport, externalMutation: false, monetaryMutation: false }), errorCode });
}
