/** Durable observations, never commands. Money is referenced by ledger identity, never copied here. */
import { createHash } from "node:crypto";
import { canonicalAyasJson } from "../../provenance/AyasReleaseProvenance";
import { snapshotAyasRevenuePilotData } from "../pilot/AyasRevenuePilot";
import { isAyasRevenueDigest } from "../AyasRevenueOpportunity";
import { AYAS_REVENUE_CURRENCIES, AYAS_REVENUE_MAX_MINOR_UNITS } from "../AyasRevenueSpendPolicy";
import { AYAS_REVENUE_OPERATION_EFFECT, type AyasRevenueOperation, type AyasRevenuePlatform } from "../AyasRevenuePlatformTypes";
import { deepFreezeAyasRevenueValue, hasExactAyasRevenueKeys, isAyasRevenueOperation, isAyasRevenuePlainRecord, isAyasRevenuePlatform, isAyasRevenueTimestamp } from "../AyasRevenueRedaction";

export const AYAS_REVENUE_ACTIVITY_MAX_BYTES = 4 * 1024 * 1024;
export const AYAS_REVENUE_ACTIVITY_MAX_RECORDS = 2000;
export const AYAS_REVENUE_ACTIVITY_PHASES = Object.freeze(["STARTED", "DRAFTED", "BLOCKED_OWNER", "COMPLETED", "FAILED", "CANCELLED"] as const);
export const AYAS_REVENUE_ACTIVITY_REASONS = Object.freeze(["RELEVANCE_FILTER", "PROFITABILITY_CHECK", "OWNER_REQUEST", "SCHEDULED_READ", "ZERO_COST_DENIED", "OWNER_GATE", "SECURITY_HOLD", "TERMS_HOLD", "CANONICAL_RECONCILIATION", "DELIVERY_CHECK", "UNKNOWN_COST"] as const);
export const AYAS_REVENUE_ACTIVITY_NEXT = Object.freeze(["NONE", "WAIT_OWNER_REVIEW", "RECONCILE_CANONICAL", "PREPARE_LOCAL_DRAFT", "NEW_FREE_FIRST_VALIDATION", "RESOLVE_SECURITY", "QUALIFY_SOURCE"] as const);
export const AYAS_REVENUE_ACTIVITY_EFFECTS = Object.freeze(["READ_FACTS", "PREPARE_DRAFT", "PUBLISH", "SEND_MESSAGE", "DELIVER", "CHANGE_PRICE", "REFUND", "SPEND", "CHANGE_SCOPE"] as const);
export const AYAS_REVENUE_ACTIVITY_RULES = Object.freeze(["ADAPTER_STANDARD", "SPEND_GATE", "FREE_FIRST", "SECURITY", "COMPLIANCE", "PILOT", "SCALING", "OWNER_HANDOFF"] as const);
export type AyasRevenueActivityCost = { readonly state: "UNKNOWN"; readonly amount: null } | { readonly state: "KNOWN"; readonly amount: { readonly valueMinor: number; readonly currency: string } };
export interface AyasRevenueActivityInput {
  readonly schemaVersion: "1"; readonly eventDigest: string; readonly actionDigest: string;
  readonly platform: AyasRevenuePlatform; readonly accountDigest: string; readonly occurredAt: string;
  readonly operation: AyasRevenueOperation; readonly phase: typeof AYAS_REVENUE_ACTIVITY_PHASES[number];
  readonly reasonCode: typeof AYAS_REVENUE_ACTIVITY_REASONS[number]; readonly ruleCode: typeof AYAS_REVENUE_ACTIVITY_RULES[number]; readonly evidenceDigest: string;
  readonly expectedCost: AyasRevenueActivityCost; readonly expectedEffect: typeof AYAS_REVENUE_ACTIVITY_EFFECTS[number];
  readonly risk: "INFO" | "CAUTION" | "BLOCKING"; readonly requestedDecision: "REVIEW_EXACT_ACTION" | null;
  readonly nextAction: typeof AYAS_REVENUE_ACTIVITY_NEXT[number];
  /** Full current ledger identity at observation time, not a monetary claim. */
  readonly ledgerRef: { readonly digest: string; readonly revision: number } | null;
  /** Canonical inventory at this observation; absent coverage remains unknown. */
  readonly inventory: { readonly opportunities: number; readonly drafts: number; readonly activeWork: number } | null;
}
export interface AyasRevenueActivityRecord extends AyasRevenueActivityInput { readonly sequence: number; readonly recordedAt: string; readonly previousDigest: string | null; readonly recordDigest: string }
export interface AyasRevenueActivityState { readonly schemaVersion: "1"; readonly revision: number; readonly records: readonly AyasRevenueActivityRecord[] }
export class AyasRevenueActivityError extends Error { constructor(readonly code: string) { super("AYAS_REVENUE_ACTIVITY_" + code); this.stack = undefined; } }
const KEYS = ["schemaVersion", "eventDigest", "actionDigest", "platform", "accountDigest", "occurredAt", "operation", "phase", "reasonCode", "ruleCode", "evidenceDigest", "expectedCost", "expectedEffect", "risk", "requestedDecision", "nextAction", "ledgerRef", "inventory"];
const integer = (n: unknown, max = 1000000): n is number => Number.isSafeInteger(n) && !Object.is(n, -0) && (n as number) >= 0 && (n as number) <= max;
const member = (v: unknown, choices: readonly unknown[]) => choices.includes(v);
export function isAyasRevenueActivityCost(v: unknown): v is AyasRevenueActivityCost {
  if (!isAyasRevenuePlainRecord(v) || !hasExactAyasRevenueKeys(v, ["state", "amount"])) return false;
  if (v.state === "UNKNOWN") return v.amount === null;
  return v.state === "KNOWN" && isAyasRevenuePlainRecord(v.amount) && hasExactAyasRevenueKeys(v.amount, ["valueMinor", "currency"])
    && integer(v.amount.valueMinor, AYAS_REVENUE_MAX_MINOR_UNITS) && member(v.amount.currency, AYAS_REVENUE_CURRENCIES);
}
function fields(v: Record<string, unknown>): boolean {
  if (v.schemaVersion !== "1" || ![v.eventDigest, v.actionDigest, v.accountDigest, v.evidenceDigest].every(isAyasRevenueDigest)
    || !isAyasRevenuePlatform(v.platform) || !isAyasRevenueTimestamp(v.occurredAt) || !isAyasRevenueOperation(v.operation)
    || !member(v.phase, AYAS_REVENUE_ACTIVITY_PHASES) || !member(v.reasonCode, AYAS_REVENUE_ACTIVITY_REASONS) || !member(v.ruleCode, AYAS_REVENUE_ACTIVITY_RULES)
    || !isAyasRevenueActivityCost(v.expectedCost) || !member(v.expectedEffect, AYAS_REVENUE_ACTIVITY_EFFECTS) || !member(v.risk, ["INFO", "CAUTION", "BLOCKING"])
    || !member(v.nextAction, AYAS_REVENUE_ACTIVITY_NEXT)) return false;
  if (v.phase === "BLOCKED_OWNER") {
    if (v.requestedDecision !== "REVIEW_EXACT_ACTION" || v.nextAction !== "WAIT_OWNER_REVIEW") return false;
  } else if (v.requestedDecision !== null || v.nextAction === "WAIT_OWNER_REVIEW") return false;
  const effect = AYAS_REVENUE_OPERATION_EFFECT[v.operation];
  if (v.phase === "DRAFTED" && effect !== "LOCAL_DRAFT") return false;
  if (v.ledgerRef !== null && (!isAyasRevenuePlainRecord(v.ledgerRef) || !hasExactAyasRevenueKeys(v.ledgerRef, ["digest", "revision"])
    || !isAyasRevenueDigest(v.ledgerRef.digest) || !integer(v.ledgerRef.revision, 10000))) return false;
  return v.inventory === null || isAyasRevenuePlainRecord(v.inventory) && hasExactAyasRevenueKeys(v.inventory, ["opportunities", "drafts", "activeWork"])
    && [v.inventory.opportunities, v.inventory.drafts, v.inventory.activeWork].every(n => integer(n));
}
function hash(v: unknown): string { return createHash("sha256").update(canonicalAyasJson(v)).digest("hex"); }
export function snapshotAyasRevenueActivityInput(raw: unknown): AyasRevenueActivityInput | null {
  const v = snapshotAyasRevenuePilotData(raw, 16384);
  return isAyasRevenuePlainRecord(v) && hasExactAyasRevenueKeys(v, KEYS) && fields(v) ? v as unknown as AyasRevenueActivityInput : null;
}
export function emptyAyasRevenueActivity(): AyasRevenueActivityState { return deepFreezeAyasRevenueValue({ schemaVersion: "1", revision: 0, records: [] }); }
export function validateAyasRevenueActivity(raw: unknown): AyasRevenueActivityState {
  const v = snapshotAyasRevenuePilotData(raw, AYAS_REVENUE_ACTIVITY_MAX_BYTES, 200000);
  if (!isAyasRevenuePlainRecord(v) || !hasExactAyasRevenueKeys(v, ["schemaVersion", "revision", "records"]) || v.schemaVersion !== "1" || !Array.isArray(v.records)
    || v.records.length > AYAS_REVENUE_ACTIVITY_MAX_RECORDS || !integer(v.revision, AYAS_REVENUE_ACTIVITY_MAX_RECORDS) || v.revision !== v.records.length) throw new AyasRevenueActivityError("INVALID_HISTORY");
  let prior: string | null = null, recorded = 0; const seen = new Set<string>();
  for (let i = 0; i < v.records.length; i++) {
    const r = v.records[i];
    if (!isAyasRevenuePlainRecord(r) || !hasExactAyasRevenueKeys(r, [...KEYS, "sequence", "recordedAt", "previousDigest", "recordDigest"]) || !fields(r)
      || r.sequence !== i + 1 || r.previousDigest !== prior || !isAyasRevenueTimestamp(r.recordedAt) || Date.parse(r.recordedAt) < recorded
      || Date.parse(r.recordedAt) < Date.parse(r.occurredAt as string) || seen.has(r.eventDigest as string)) throw new AyasRevenueActivityError("INVALID_HISTORY");
    const { recordDigest, ...material } = r;
    if (recordDigest !== hash(material)) throw new AyasRevenueActivityError("INVALID_HISTORY");
    prior = recordDigest as string; recorded = Date.parse(r.recordedAt); seen.add(r.eventDigest as string);
  }
  return v as unknown as AyasRevenueActivityState;
}
export function planAyasRevenueActivityAppend(raw: unknown, input: unknown, recordedAt: string) {
  const state = validateAyasRevenueActivity(raw), v = snapshotAyasRevenueActivityInput(input);
  if (!v || !isAyasRevenueTimestamp(recordedAt) || Date.parse(recordedAt) < Date.parse(v.occurredAt)) throw new AyasRevenueActivityError("INVALID_INPUT");
  const existing = state.records.find(r => r.eventDigest === v.eventDigest);
  if (existing) {
    if (canonicalAyasJson(Object.fromEntries(KEYS.map(k => [k, existing[k as keyof AyasRevenueActivityInput]]))) !== canonicalAyasJson(v)) throw new AyasRevenueActivityError("CONFLICT");
    return deepFreezeAyasRevenueValue({ kind: "REPLAY" as const, state, record: existing, grantsAuthority: false as const });
  }
  if (state.revision >= AYAS_REVENUE_ACTIVITY_MAX_RECORDS) throw new AyasRevenueActivityError("CAPACITY");
  const material = { ...v, sequence: state.revision + 1, recordedAt, previousDigest: state.records.at(-1)?.recordDigest ?? null };
  const record = { ...material, recordDigest: hash(material) }, next = validateAyasRevenueActivity({ schemaVersion: "1", revision: record.sequence, records: [...state.records, record] });
  return deepFreezeAyasRevenueValue({ kind: "APPEND" as const, state: next, record, grantsAuthority: false as const });
}
