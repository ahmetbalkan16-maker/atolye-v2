/** Stage16.3: a bounded hypothesis, never a platform instruction or a realized economic fact. */
import type { AyasRevenuePlatform } from "./AyasRevenuePlatformTypes";
import { AYAS_REVENUE_CURRENCIES, AYAS_REVENUE_MAX_MINOR_UNITS } from "./AyasRevenueSpendPolicy";
import { deepFreezeAyasRevenueValue, hasExactAyasRevenueKeys, isAyasRevenueExternalId, isAyasRevenuePlainRecord,
  isAyasRevenuePlatform, isAyasRevenueSensitiveText, isAyasRevenueTimestamp } from "./AyasRevenueRedaction";
export const AYAS_REVENUE_OFFER_TYPES = Object.freeze(["DIGITAL_PRODUCT", "FREELANCE_SERVICE", "COURSE", "CONTENT_ASSET", "OTHER"] as const);
export type AyasRevenueOfferType = typeof AYAS_REVENUE_OFFER_TYPES[number];
export interface AyasRevenueScenarioMoney { readonly valueMinor: number; readonly currency: string }
export interface AyasRevenueOpportunity {
  readonly schemaVersion: "1"; readonly opportunityId: string; readonly platform: AyasRevenuePlatform | "MULTI"; readonly offerType: AyasRevenueOfferType;
  readonly capabilityKeys: readonly string[]; readonly deliverableClass: string; readonly targetMarketCode: string | null;
  readonly hypothesis: { readonly problemCode: string; readonly valuePropositionCode: string; readonly priceScenario: AyasRevenueScenarioMoney | null };
  readonly observedAt: string; readonly authority: "NONE";
}
export const isAyasRevenueDigest = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
export const isAyasRevenueNeutralCode = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z][A-Za-z0-9_.-]{1,63}$/.test(v)
  && !v.includes("..") && !isAyasRevenueSensitiveText(v);
export function isAyasRevenueScenarioMoney(v: unknown): v is AyasRevenueScenarioMoney {
  return isAyasRevenuePlainRecord(v) && hasExactAyasRevenueKeys(v, ["valueMinor", "currency"]) && Number.isSafeInteger(v.valueMinor)
    && !Object.is(v.valueMinor, -0) && (v.valueMinor as number) >= 0 && (v.valueMinor as number) <= AYAS_REVENUE_MAX_MINOR_UNITS
    && (AYAS_REVENUE_CURRENCIES as readonly unknown[]).includes(v.currency);
}
/** Dense descriptor-only arrays; no accessor/symbol/prototype side effects before a snapshot. */
export function isAyasRevenueDataArray(v: unknown, max: number): v is unknown[] {
  return Array.isArray(v) && Object.getPrototypeOf(v) === Array.prototype && v.length <= max && Reflect.ownKeys(v).length === v.length + 1
    && Object.values(Object.getOwnPropertyDescriptors(v)).every(d => Object.hasOwn(d, "value"));
}
function valid(v: unknown): v is AyasRevenueOpportunity {
  if (!isAyasRevenuePlainRecord(v) || !hasExactAyasRevenueKeys(v, ["schemaVersion", "opportunityId", "platform", "offerType", "capabilityKeys", "deliverableClass", "targetMarketCode", "hypothesis", "observedAt", "authority"])) return false;
  const h = v.hypothesis, keys = v.capabilityKeys;
  return v.schemaVersion === "1" && isAyasRevenueExternalId(v.opportunityId) && (v.platform === "MULTI" || isAyasRevenuePlatform(v.platform))
    && (AYAS_REVENUE_OFFER_TYPES as readonly unknown[]).includes(v.offerType) && isAyasRevenueDataArray(keys, 20) && keys.length > 0
    && keys.every(isAyasRevenueNeutralCode) && new Set(keys).size === keys.length && isAyasRevenueNeutralCode(v.deliverableClass)
    && (v.targetMarketCode === null || isAyasRevenueNeutralCode(v.targetMarketCode)) && isAyasRevenueTimestamp(v.observedAt) && v.authority === "NONE"
    && isAyasRevenuePlainRecord(h) && hasExactAyasRevenueKeys(h, ["problemCode", "valuePropositionCode", "priceScenario"])
    && isAyasRevenueNeutralCode(h.problemCode) && isAyasRevenueNeutralCode(h.valuePropositionCode)
    && (h.priceScenario === null || isAyasRevenueScenarioMoney(h.priceScenario));
}
export function snapshotAyasRevenueOpportunity(raw: unknown): AyasRevenueOpportunity | null {
  try { if (!valid(raw)) return null; const v: unknown = structuredClone(raw); return valid(v) ? deepFreezeAyasRevenueValue(v) : null; } catch { return null; }
}
