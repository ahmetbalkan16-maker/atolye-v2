/** Strict bounded request schema: external/model fields cannot choose evidence readers or approval authority. */
import { AYAS_REVENUE_CURRENCIES, AYAS_REVENUE_MAX_MINOR_UNITS } from "../AyasRevenueSpendPolicy";
import { isAyasRevenueDigest, isAyasRevenueNeutralCode, isAyasRevenueScenarioMoney } from "../AyasRevenueOpportunity";
import { hasExactAyasRevenueKeys, isAyasRevenuePlainRecord, isAyasRevenuePlatform } from "../AyasRevenueRedaction";
import { snapshotAyasRevenuePilotData } from "../pilot/AyasRevenuePilot";
import { AYAS_SCALING_DIMENSIONS, AYAS_SCALING_ROLLBACK_CODES, type AyasRevenueScalingRequest } from "./AyasRevenueScalingPlan";

export const scalingInteger = (v: unknown, max = AYAS_REVENUE_MAX_MINOR_UNITS): v is number => Number.isSafeInteger(v) && !Object.is(v, -0) && (v as number) >= 0 && (v as number) <= max;
export function snapshotAyasRevenueScalingRequest(raw: unknown): AyasRevenueScalingRequest | null {
  const v = snapshotAyasRevenuePilotData(raw, 16384);
  if (!isAyasRevenuePlainRecord(v) || !hasExactAyasRevenueKeys(v, ["schemaVersion", "planId", "platform", "accountDigest", "offerDigest", "currency", "scalingDimension", "currentLevel", "proposedLevel", "intent", "requiredBudget", "maxDownside", "priceExperiment", "rollback"])
    || v.schemaVersion !== "1" || !isAyasRevenueNeutralCode(v.planId) || !isAyasRevenuePlatform(v.platform) || !isAyasRevenueDigest(v.accountDigest) || !isAyasRevenueDigest(v.offerDigest)
    || !(AYAS_REVENUE_CURRENCIES as readonly unknown[]).includes(v.currency) || !(AYAS_SCALING_DIMENSIONS as readonly unknown[]).includes(v.scalingDimension)
    || !["BOUNDED_REPETITION", "MATERIAL_SCALE", "BROADER_CHANNEL"].includes(v.intent as string) || !scalingInteger(v.currentLevel) || !scalingInteger(v.proposedLevel) || v.currentLevel === 0
    || v.proposedLevel === 0 || v.proposedLevel === v.currentLevel || BigInt(v.proposedLevel) > BigInt(v.currentLevel) * BigInt(2)) return null;
  if (v.requiredBudget === null ? v.maxDownside !== null : !isAyasRevenueScenarioMoney(v.requiredBudget) || v.requiredBudget.valueMinor <= 0 || v.requiredBudget.currency !== v.currency
    || !isAyasRevenueScenarioMoney(v.maxDownside) || v.maxDownside.currency !== v.currency || v.maxDownside.valueMinor !== v.requiredBudget.valueMinor) return null;
  if (v.scalingDimension === "PAID_ACQUISITION" && (!isAyasRevenueScenarioMoney(v.requiredBudget) || v.requiredBudget.valueMinor !== v.proposedLevel)) return null;
  if (v.scalingDimension !== "PRICE_EXPERIMENT" && v.proposedLevel < v.currentLevel) return null;
  const price = v.priceExperiment;
  if (v.scalingDimension === "PRICE_EXPERIMENT" ? !isAyasRevenuePlainRecord(price) || !hasExactAyasRevenueKeys(price, ["currentMinor", "proposedMinor", "currency"])
    || price.currency !== v.currency || price.currentMinor !== v.currentLevel || price.proposedMinor !== v.proposedLevel : price !== null) return null;
  const r = v.rollback;
  if (!isAyasRevenuePlainRecord(r) || !hasExactAyasRevenueKeys(r, ["codes", "maxRefundRevenueBps", "maxSupportBacklog", "metricFloorBps"])
    || !Array.isArray(r.codes) || r.codes.length !== AYAS_SCALING_ROLLBACK_CODES.length || new Set(r.codes).size !== r.codes.length
    || !AYAS_SCALING_ROLLBACK_CODES.every(code => (r.codes as unknown[]).includes(code)) || !scalingInteger(r.maxRefundRevenueBps, 10000) || !scalingInteger(r.maxSupportBacklog, 1000000)
    || !scalingInteger(r.metricFloorBps, 10000) || r.metricFloorBps === 0) return null;
  return v as unknown as AyasRevenueScalingRequest;
}
