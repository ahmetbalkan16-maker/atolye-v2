/** Internal projection contract, NOT a claimed Upwork wire schema. Official projectors need owner OAuth qualification. */
import { digestAyasRevenueData } from "../../AyasRevenueDigest";
import { isAyasRevenueDataArray, isAyasRevenueScenarioMoney } from "../../AyasRevenueOpportunity";
import { containsAyasRevenueSensitiveData, hasExactAyasRevenueKeys, isAyasRevenueExternalId, isAyasRevenuePlainRecord, isAyasRevenueSensitiveText } from "../../AyasRevenueRedaction";
import { snapshotAyasUpworkData, type AyasUpworkKind } from "./AyasUpworkMcpPolicy";

const STATES: Readonly<Record<AyasUpworkKind, readonly string[]>> = Object.freeze({ ACCOUNT: ["ACTIVE", "RESTRICTED"], JOBS: ["OPEN", "CLOSED"],
  INVITATIONS: ["PENDING", "DECLINED", "EXPIRED"], PROPOSALS: ["SUBMITTED", "DECLINED", "WITHDRAWN", "ARCHIVED"], CONTRACTS: ["ACTIVE", "PAUSED", "ENDED"], EARNINGS: ["SETTLED", "PENDING"] });
export function normalizeAyasUpworkProjection(raw: unknown, kind: AyasUpworkKind, accountRef: string, limit: number): unknown | null {
  const value = snapshotAyasUpworkData(raw);
  if (!isAyasRevenuePlainRecord(value) || !hasExactAyasRevenueKeys(value, ["accountRef", "kind", "items", "attribution", "aiOrigin", "metering"])
    || value.accountRef !== accountRef || value.kind !== kind || value.attribution !== "Upwork" || typeof value.aiOrigin !== "boolean"
    || !isAyasRevenueDataArray(value.items, limit) || (kind === "ACCOUNT" && value.items.length !== 1)
    || !(value.metering === null || isAyasRevenuePlainRecord(value.metering) && hasExactAyasRevenueKeys(value.metering, ["remaining"])
      && Number.isSafeInteger(value.metering.remaining) && (value.metering.remaining as number) >= 0)) return null;
  const seen = new Set<string>();
  const items: Record<string, unknown>[] = [];
  for (const item of value.items) {
    if (!isAyasRevenuePlainRecord(item) || !hasExactAyasRevenueKeys(item, ["ref", "state"], ["title", "amounts"])
      || !isAyasRevenueExternalId(item.ref) || seen.has(item.ref) || !STATES[kind].includes(item.state as string)) return null;
    if (Object.hasOwn(item, "title") && (kind !== "JOBS" || typeof item.title !== "string" || !item.title.trim() || item.title.length > 160
      || isAyasRevenueSensitiveText(item.title) || /[\u0000-\u001f]/.test(item.title))) return null;
    if (kind === "EARNINGS") {
      const money = item.amounts;
      if (!isAyasRevenuePlainRecord(money) || !hasExactAyasRevenueKeys(money, ["gross", "fee", "payout"]) || !Object.values(money).every(m => m === null || isAyasRevenueScenarioMoney(m))) return null;
      const currencies = Object.values(money).filter(m => m !== null).map(m => (m as { currency: string }).currency);
      if (new Set(currencies).size > 1) return null;
    } else if (Object.hasOwn(item, "amounts")) return null;
    seen.add(item.ref); items.push({ ...item });
  }
  const projection = { kind, accountRef, items, attribution: "Upwork", aiOrigin: value.aiOrigin, metering: value.metering, authority: "NONE",
    storage: "EPHEMERAL_OWNER_TASK_ONLY", modelUse: "PROHIBITED", evidenceDigest: digestAyasRevenueData(value) };
  return containsAyasRevenueSensitiveData(projection) ? null : projection;
}
