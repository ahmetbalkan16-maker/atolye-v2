/** Stage 16.2: immutable, digest-only observations. This contract confers no action or spend authority. */
import { createHash } from "node:crypto";
import { AYAS_REVENUE_CURRENCIES, AYAS_REVENUE_MAX_MINOR_UNITS } from "./AyasRevenueSpendPolicy";
import type { AyasRevenuePlatform } from "./AyasRevenuePlatformTypes";
import { deepFreezeAyasRevenueValue, hasExactAyasRevenueKeys, isAyasRevenueExternalId, isAyasRevenuePlainRecord,
  isAyasRevenuePlatform, isAyasRevenueSensitiveText, isAyasRevenueTimestamp } from "./AyasRevenueRedaction";

export const AYAS_REVENUE_LEDGER_MAX_ENTRIES = 10_000;
export const AYAS_REVENUE_LEDGER_MAX_BYTES = 16 * 1024 * 1024;
export const AYAS_REVENUE_ECONOMIC_EVENTS = Object.freeze(["GROSS_REVENUE", "PLATFORM_FEE", "PAYMENT_PROCESSING_FEE", "REFUND", "TAX_WITHHELD",
  "VARIABLE_DELIVERY_COST", "AD_SPEND", "OTHER_COST", "PAYOUT_OBSERVED", "REVERSAL"] as const);
export type AyasRevenueEconomicEvent = typeof AYAS_REVENUE_ECONOMIC_EVENTS[number];
export const AYAS_REVENUE_LEDGER_SOURCES = Object.freeze(["PLATFORM_ADAPTER", "OWNER_IMPORT", "SYSTEM_DERIVED"] as const);
export const AYAS_REVENUE_LEDGER_NOTES = Object.freeze(["IMPORTED", "CORRECTION", "RECONCILED"] as const);
export interface AyasRevenueLedgerEntry {
  readonly schemaVersion: "1"; readonly entryId: string; readonly platform: AyasRevenuePlatform; readonly event: AyasRevenueEconomicEvent;
  readonly amount: { readonly valueMinor: number; readonly currency: string }; readonly occurredAt: string; readonly recordedAt: string;
  readonly externalEventDigest: string; readonly orderDigest: string | null; readonly offerDigest: string | null; readonly activityDigest: string | null;
  readonly evidence: { readonly source: typeof AYAS_REVENUE_LEDGER_SOURCES[number]; readonly adapterId: string | null; readonly adapterVersion: number | null;
    readonly observedAt: string; readonly evidenceDigest: string };
  readonly reversesEntryId: string | null; readonly notesCode: typeof AYAS_REVENUE_LEDGER_NOTES[number] | null;
}
export type AyasRevenueLedgerInput = Omit<AyasRevenueLedgerEntry, "entryId" | "recordedAt">;
export interface AyasRevenueLedgerState { readonly schemaVersion: "1"; readonly revision: number; readonly entries: readonly AyasRevenueLedgerEntry[] }
export type AyasRevenueLedgerErrorCode = "INVALID_INPUT" | "INVALID_LEDGER" | "CONFLICT" | "INVALID_REVERSAL" | "CAPACITY" | "AGGREGATE_OVERFLOW"
  | "STORAGE_UNSAFE" | "STORAGE_IO" | "REVISION_CONFLICT" | "LOCK_BUSY";
export class AyasRevenueLedgerError extends Error {
  constructor(readonly code: AyasRevenueLedgerErrorCode) { super(`AYAS_REVENUE_LEDGER_${code}`); this.name = "AyasRevenueLedgerError"; this.stack = undefined; }
}
const INPUT_KEYS = ["schemaVersion", "platform", "event", "amount", "occurredAt", "externalEventDigest", "orderDigest", "offerDigest", "activityDigest", "evidence", "reversesEntryId", "notesCode"];
const ENTRY_KEYS = [...INPUT_KEYS, "entryId", "recordedAt"];
const digest = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const entryId = (value: unknown): value is string => typeof value === "string" && /^revenue-[a-f0-9]{64}$/.test(value);
/** Only bounded opaque IDs can be normalized and hashed. Raw identifiers never enter an entry. */
export function digestAyasRevenueExternalId(raw: unknown): string {
  if (typeof raw !== "string" || raw.length > 256) throw new AyasRevenueLedgerError("INVALID_INPUT");
  const normalized = raw.normalize("NFC").trim();
  if (!isAyasRevenueExternalId(normalized)) throw new AyasRevenueLedgerError("INVALID_INPUT");
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}
function validFields(v: Record<string, unknown>): boolean {
  const a = v.amount, e = v.evidence;
  if (v.schemaVersion !== "1" || !isAyasRevenuePlatform(v.platform) || !(AYAS_REVENUE_ECONOMIC_EVENTS as readonly unknown[]).includes(v.event)
    || !isAyasRevenueTimestamp(v.occurredAt) || !digest(v.externalEventDigest)
    || ![v.orderDigest, v.offerDigest, v.activityDigest].every((d) => d === null || digest(d))
    || !isAyasRevenuePlainRecord(a) || !hasExactAyasRevenueKeys(a, ["valueMinor", "currency"])
    || !Number.isSafeInteger(a.valueMinor) || Object.is(a.valueMinor, -0) || (a.valueMinor as number) < 0 || (a.valueMinor as number) > AYAS_REVENUE_MAX_MINOR_UNITS
    || !(AYAS_REVENUE_CURRENCIES as readonly unknown[]).includes(a.currency)
    || !isAyasRevenuePlainRecord(e) || !hasExactAyasRevenueKeys(e, ["source", "adapterId", "adapterVersion", "observedAt", "evidenceDigest"])
    || !(AYAS_REVENUE_LEDGER_SOURCES as readonly unknown[]).includes(e.source) || !isAyasRevenueTimestamp(e.observedAt) || !digest(e.evidenceDigest)
    || !(v.notesCode === null || (AYAS_REVENUE_LEDGER_NOTES as readonly unknown[]).includes(v.notesCode))) return false;
  if (e.source === "PLATFORM_ADAPTER") {
    if (typeof e.adapterId !== "string" || !/^[a-z][a-z0-9-]{2,63}$/.test(e.adapterId) || isAyasRevenueSensitiveText(e.adapterId)
      || !Number.isSafeInteger(e.adapterVersion) || (e.adapterVersion as number) < 1 || (e.adapterVersion as number) > 10_000) return false;
  } else if (e.adapterId !== null || e.adapterVersion !== null) return false;
  return v.event === "REVERSAL" ? entryId(v.reversesEntryId) : v.reversesEntryId === null;
}
function validInput(raw: unknown): raw is AyasRevenueLedgerInput {
  return isAyasRevenuePlainRecord(raw) && hasExactAyasRevenueKeys(raw, INPUT_KEYS) && validFields(raw);
}
export function ayasRevenueLedgerEntryId(v: AyasRevenueLedgerInput): string {
  return `revenue-${createHash("sha256").update(JSON.stringify([v.platform, v.externalEventDigest, v.event, v.amount.valueMinor, v.amount.currency, v.occurredAt])).digest("hex")}`;
}
function validEntry(raw: unknown): raw is AyasRevenueLedgerEntry {
  return isAyasRevenuePlainRecord(raw) && hasExactAyasRevenueKeys(raw, ENTRY_KEYS) && validFields(raw) && entryId(raw.entryId)
    && isAyasRevenueTimestamp(raw.recordedAt) && raw.entryId === ayasRevenueLedgerEntryId(raw as unknown as AyasRevenueLedgerInput);
}
/** Preflight before structuredClone prevents getters from running; reflection/proxy exceptions fail closed. */
export function createAyasRevenueLedgerEntry(raw: unknown, recordedAt: string): AyasRevenueLedgerEntry {
  try {
    if (!validInput(raw) || !isAyasRevenueTimestamp(recordedAt)) throw new AyasRevenueLedgerError("INVALID_INPUT");
    const value: unknown = structuredClone(raw);
    if (!validInput(value)) throw new AyasRevenueLedgerError("INVALID_INPUT");
    return deepFreezeAyasRevenueValue({ ...value, entryId: ayasRevenueLedgerEntryId(value), recordedAt });
  } catch { throw new AyasRevenueLedgerError("INVALID_INPUT"); }
}
const externalKey = (v: AyasRevenueLedgerEntry): string => `${v.platform}:${v.externalEventDigest}`;
function sameMaterialFact(a: AyasRevenueLedgerEntry, b: AyasRevenueLedgerEntry): boolean {
  // Fixed field order: caller property order is immaterial. An evidence change is a conflict, never a trust upgrade.
  const fact = (v: AyasRevenueLedgerEntry) => [v.platform, v.event, v.amount.valueMinor, v.amount.currency, v.occurredAt, v.externalEventDigest,
    v.orderDigest, v.offerDigest, v.activityDigest, v.evidence.source, v.evidence.adapterId, v.evidence.adapterVersion, v.evidence.observedAt,
    v.evidence.evidenceDigest, v.reversesEntryId, v.notesCode];
  return JSON.stringify(fact(a)) === JSON.stringify(fact(b));
}
function validReversal(v: AyasRevenueLedgerEntry, byId: ReadonlyMap<string, AyasRevenueLedgerEntry>, reversed: ReadonlySet<string>): boolean {
  if (v.event !== "REVERSAL") return true;
  const target = byId.get(v.reversesEntryId!);
  return !!target && target.event !== "REVERSAL" && !reversed.has(target.entryId) && v.platform === target.platform
    && v.amount.currency === target.amount.currency && v.amount.valueMinor === target.amount.valueMinor
    && v.orderDigest === target.orderDigest && v.offerDigest === target.offerDigest && v.activityDigest === target.activityDigest
    && Date.parse(v.occurredAt) >= Date.parse(target.occurredAt);
}
/** Malformed history is never interpreted as an empty ledger. Validate identities and sequential reversal rules. */
export function validateAyasRevenueLedgerState(raw: unknown): AyasRevenueLedgerState {
  try {
    if (!isAyasRevenuePlainRecord(raw) || !hasExactAyasRevenueKeys(raw, ["schemaVersion", "revision", "entries"]) || raw.schemaVersion !== "1"
      || !Array.isArray(raw.entries) || Object.getPrototypeOf(raw.entries) !== Array.prototype || raw.entries.length > AYAS_REVENUE_LEDGER_MAX_ENTRIES
      || Reflect.ownKeys(raw.entries).length !== raw.entries.length + 1
      || !Object.values(Object.getOwnPropertyDescriptors(raw.entries)).every((d) => Object.hasOwn(d, "value"))
      || !Number.isSafeInteger(raw.revision) || raw.revision !== raw.entries.length) throw new Error();
    const byId = new Map<string, AyasRevenueLedgerEntry>(), externals = new Set<string>(), reversed = new Set<string>();
    for (const v of raw.entries) {
      if (!validEntry(v) || byId.has(v.entryId) || externals.has(externalKey(v)) || !validReversal(v, byId, reversed)) throw new Error();
      byId.set(v.entryId, v); externals.add(externalKey(v)); if (v.event === "REVERSAL") reversed.add(v.reversesEntryId!);
    }
    return deepFreezeAyasRevenueValue(structuredClone(raw) as unknown as AyasRevenueLedgerState);
  } catch { throw new AyasRevenueLedgerError("INVALID_LEDGER"); }
}
export function emptyAyasRevenueLedger(): AyasRevenueLedgerState { return deepFreezeAyasRevenueValue({ schemaVersion: "1", revision: 0, entries: [] }); }
/** Re-read under the writer lock before using this plan. Replays preserve the first entry, including its evidence. */
export function planAyasRevenueLedgerAppend(state: AyasRevenueLedgerState, candidate: AyasRevenueLedgerEntry):
  { readonly kind: "REPLAY" | "APPEND"; readonly entry: AyasRevenueLedgerEntry } {
  const existing = state.entries.find((v) => externalKey(v) === externalKey(candidate));
  if (existing) {
    if (!sameMaterialFact(existing, candidate)) throw new AyasRevenueLedgerError("CONFLICT");
    return Object.freeze({ kind: "REPLAY", entry: existing });
  }
  const byId = new Map(state.entries.map((v) => [v.entryId, v]));
  const reversed = new Set(state.entries.filter((v) => v.event === "REVERSAL").map((v) => v.reversesEntryId!));
  if (!validReversal(candidate, byId, reversed)) throw new AyasRevenueLedgerError("INVALID_REVERSAL");
  return Object.freeze({ kind: "APPEND", entry: candidate });
}
