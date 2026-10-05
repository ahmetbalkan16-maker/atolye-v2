/** Ledger-reconciled owner views from a trusted SOURCE reader. No HTTP, command, approval or spend path. */
import { snapshotAyasRevenuePilotData } from "../pilot/AyasRevenuePilot";
import { digestAyasRevenueLedgerData } from "../AyasRevenueDigest";
import { validateAyasRevenueLedgerState } from "../AyasRevenueLedger";
import { groupAyasRevenueEconomics, summarizeAyasRevenueEconomics } from "../AyasRevenueEconomics";
import { AYAS_REVENUE_PLATFORMS, AYAS_REVENUE_OPERATION_EFFECT, type AyasRevenuePlatform } from "../AyasRevenuePlatformTypes";
import { isAyasRevenueDigest } from "../AyasRevenueOpportunity";
import { deepFreezeAyasRevenueValue, hasExactAyasRevenueKeys, isAyasRevenuePlainRecord, isAyasRevenuePlatform, isAyasRevenueTimestamp } from "../AyasRevenueRedaction";
import { validateAyasRevenueActivity, type AyasRevenueActivityRecord } from "./AyasRevenueActivity";
import { detectAyasRevenueRecall } from "../AyasRevenueRecall";
import { isAyasRevenueContextRelevant } from "../AyasRevenueContext";
export const AYAS_REVENUE_CONNECTION_STATES = Object.freeze(["UNBOUND", "CONNECTED", "EXPIRED", "REVOKED", "BLOCKED"] as const);
export interface AyasRevenueActivitySource {
  readonly schemaVersion: "1"; readonly observedAt: string; readonly freshUntil: string;
  readonly ledger: unknown; readonly activity: unknown;
  readonly accounts: readonly { readonly platform: AyasRevenuePlatform; readonly accountDigest: string;
    readonly connection: typeof AYAS_REVENUE_CONNECTION_STATES[number]; readonly observedAt: string;
    readonly evidenceDigest: string; readonly activityHeadDigest: string | null }[];
}
const defaults = (status: "UNBOUND" | "UNAVAILABLE") => deepFreezeAyasRevenueValue({ status, platforms: AYAS_REVENUE_PLATFORMS.map(platform => ({ platform, connection: "UNBOUND", accountLabel: null,
  liveActivity: null, opportunities: null, drafts: null, activeWork: null, approvalsPending: null, realized: null, todayRealized: null, nextAction: "QUALIFY_SOURCE" })),
  approvalQueue: [], timeline: [], realized: null, estimates: [], pendingUnsettled: null, productionReinvestmentTransfer: null, currentAllowedProductionAllowance: null,
  ledgerDigest: null, activityHeadDigest: null, observedAt: null, evidenceVerification: "NORMALIZED_UNVERIFIED_OBSERVATIONS", grantsAuthority: false, executionAuthority: "NONE", autonomousSpend: 0, warnings: [status] } as const);
function projectRecord(r: AyasRevenueActivityRecord) {
  return { ...r, effect: AYAS_REVENUE_OPERATION_EFFECT[r.operation], ownerApprovalPending: r.phase === "BLOCKED_OWNER", observationQualification: "NORMALIZED_NOT_EXECUTION_RECEIPT" as const };
}
export function buildAyasRevenueActivityReport(raw: unknown, now: string) {
  if (raw === null || raw === undefined) return defaults("UNBOUND");
  try {
    const v = snapshotAyasRevenuePilotData(raw, 24 * 1024 * 1024, 500000);
    if (!isAyasRevenuePlainRecord(v) || !hasExactAyasRevenueKeys(v, ["schemaVersion", "observedAt", "freshUntil", "ledger", "activity", "accounts"]) || v.schemaVersion !== "1"
      || !isAyasRevenueTimestamp(now) || !isAyasRevenueTimestamp(v.observedAt) || !isAyasRevenueTimestamp(v.freshUntil) || Date.parse(v.observedAt) > Date.parse(now)
      || Date.parse(v.freshUntil) <= Date.parse(now) || Date.parse(v.freshUntil) - Date.parse(v.observedAt) > 86400000 || !Array.isArray(v.accounts) || v.accounts.length > 100) throw Error();
    const ledger = validateAyasRevenueLedgerState(v.ledger), activity = validateAyasRevenueActivity(v.activity), ledgerDigest = digestAyasRevenueLedgerData(ledger);
    if (ledger.entries.some(e => Date.parse(e.occurredAt) > Date.parse(e.evidence.observedAt) || Date.parse(e.evidence.observedAt) > Date.parse(e.recordedAt) || Date.parse(e.recordedAt) > Date.parse(v.observedAt as string))
      || activity.records.some(r => Date.parse(r.recordedAt) > Date.parse(v.observedAt as string))) throw Error();
    const accounts = new Map<string, AyasRevenueActivitySource["accounts"][number]>();
    for (const a of v.accounts) {
      if (!isAyasRevenuePlainRecord(a) || !hasExactAyasRevenueKeys(a, ["platform", "accountDigest", "connection", "observedAt", "evidenceDigest", "activityHeadDigest"])
        || !isAyasRevenuePlatform(a.platform) || !isAyasRevenueDigest(a.accountDigest) || !isAyasRevenueDigest(a.evidenceDigest)
        || !(AYAS_REVENUE_CONNECTION_STATES as readonly unknown[]).includes(a.connection) || !isAyasRevenueTimestamp(a.observedAt)
        || Date.parse(a.observedAt) > Date.parse(v.observedAt) || Date.parse(now) - Date.parse(a.observedAt) > 86400000
        || !(a.activityHeadDigest === null || isAyasRevenueDigest(a.activityHeadDigest))) throw Error();
      const key = a.platform + ":" + a.accountDigest;
      if (accounts.has(key)) throw Error();
      const records = activity.records.filter(r => r.platform === a.platform && r.accountDigest === a.accountDigest);
      if (a.activityHeadDigest !== (records.at(-1)?.recordDigest ?? null) || a.connection === "CONNECTED" && records.length === 0) throw Error();
      accounts.set(key, a as unknown as AyasRevenueActivitySource["accounts"][number]);
    }
    if (activity.records.some(r => !accounts.has(r.platform + ":" + r.accountDigest))) throw Error();
    const latest = new Map<string, AyasRevenueActivityRecord>();
    for (const r of activity.records.slice().sort((a,b)=>Date.parse(a.occurredAt)-Date.parse(b.occurredAt)||a.sequence-b.sequence)) latest.set(r.platform + ":" + r.accountDigest + ":" + r.actionDigest, r);
    const queue = [...latest.values()].filter(r => r.phase === "BLOCKED_OWNER").map(projectRecord);
    const perPlatform = groupAyasRevenueEconomics(ledger, ["platform"]), perDay = groupAyasRevenueEconomics(ledger, ["platform", "day"]), warnings: string[] = [];
    for (const r of activity.records) if (r.ledgerRef && (r.ledgerRef.revision === ledger.revision ? r.ledgerRef.digest !== ledgerDigest
      : r.ledgerRef.revision > ledger.revision || digestAyasRevenueLedgerData({ ...ledger, revision: r.ledgerRef.revision, entries: ledger.entries.slice(0, r.ledgerRef.revision) }) !== r.ledgerRef.digest)) throw Error();
    if (ledger.entries.some(e => ![...accounts.values()].some(a => a.platform === e.platform))) warnings.push("LEDGER_ACCOUNT_ALLOCATION_UNKNOWN");
    const platforms = AYAS_REVENUE_PLATFORMS.map(platform => {
      const rows = [...accounts.values()].filter(a => a.platform === platform), records = activity.records.filter(r => r.platform === platform), last = records.at(-1);
      const active = [...latest.values()].filter(r => r.platform === platform && r.phase === "STARTED" && Date.parse(now)-Date.parse(r.occurredAt)<=86400000
        && accounts.get(r.platform+":"+r.accountDigest)?.connection==="CONNECTED");
      // An inventory is one account snapshot. Never sum old inventories across actions or guess another account's inventory.
      const inventoryRows = rows.map(a => records.filter(r => r.accountDigest === a.accountDigest && r.inventory !== null).sort((a,b)=>Date.parse(a.occurredAt)-Date.parse(b.occurredAt)||a.sequence-b.sequence).at(-1));
      const inventoryCovered = rows.length > 0 && inventoryRows.every(r => r && Date.parse(now) - Date.parse(r.occurredAt) <= 86400000);
      const total = (k: "opportunities" | "drafts" | "activeWork") => inventoryCovered ? inventoryRows.reduce((n, r) => n + r!.inventory![k], 0) : null;
      return { platform, connection: rows.length === 0 ? "UNBOUND" : rows.every(r => r.connection === "CONNECTED") ? "CONNECTED" : "BLOCKED",
        accountLabel: rows.length ? rows.map(a => "account-" + a.accountDigest.slice(0, 12)).join(", ") : null,
        accounts: rows, liveActivity: active.map(projectRecord), opportunities: total("opportunities"), drafts: total("drafts"), activeWork: total("activeWork"),
        approvalsPending: rows.length ? queue.filter(r => r.platform === platform).length : null,
        realized: perPlatform.filter(g => g.key.platform === platform).map(g => g.economics),
        todayRealized: perDay.filter(g => g.key.platform === platform && g.key.day === now.slice(0, 10)).map(g => g.economics),
        nextAction: last?.nextAction ?? "QUALIFY_SOURCE" };
    });
    return deepFreezeAyasRevenueValue({ status: "OBSERVED" as const, platforms, approvalQueue: queue,
      timeline: activity.records.slice().sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt) || a.sequence - b.sequence).map(projectRecord),
      realized: summarizeAyasRevenueEconomics(ledger), estimates: [...latest.values()].filter(r => r.expectedCost.state === "KNOWN").map(r => ({ actionDigest: r.actionDigest, expectedCost: r.expectedCost, expectedEffect: r.expectedEffect })),
      pendingUnsettled: null, productionReinvestmentTransfer: null, currentAllowedProductionAllowance: null,
      ledgerDigest, activityHeadDigest: activity.records.at(-1)?.recordDigest ?? null, observedAt: v.observedAt,
      evidenceVerification: "NORMALIZED_UNVERIFIED_OBSERVATIONS" as const, grantsAuthority: false as const, executionAuthority: "NONE" as const, autonomousSpend: 0 as const,
      warnings: [...warnings, "ALLOWANCE_TRANSFER_SETTLEMENT_SOURCE_UNBOUND", "ESTIMATES_SEPARATE_FROM_REALIZED"] });
  } catch { return defaults("UNAVAILABLE"); }
}
/** Reader is code-supplied, not request/model/platform selected. No production source is installed. */
export function createAyasRevenueActivityReader(readSource: () => unknown = () => null) {
  if (typeof readSource !== "function") throw Error("AYAS_REVENUE_ACTIVITY_READER_INVALID");
  return (now: string) => { try { return buildAyasRevenueActivityReport(readSource(), now); } catch { return defaults("UNAVAILABLE"); } };
}
export const loadAyasRevenueActivityReport = createAyasRevenueActivityReader();
export function summarizeAyasRevenueActivity(raw: unknown, now: string, platform?: AyasRevenuePlatform, window?: {readonly at:string;readonly from:string|null;readonly until:string|null}) {
  const r = buildAyasRevenueActivityReport(raw, now);
  if (r.status !== "OBSERVED") return { status: r.status, lines: ["Gelir faaliyet kaynağı " + r.status + "; faaliyet, onay veya kazanç çıkarılamaz."], grantsAuthority: false };
  if(window&&(!isAyasRevenueTimestamp(window.at)||Date.parse(window.at)>Date.parse(now)||window.from!==null&&!isAyasRevenueTimestamp(window.from)||window.until!==null&&!isAyasRevenueTimestamp(window.until)))return {status:"UNAVAILABLE",lines:["Gelir faaliyet sorgusu UNAVAILABLE; tarih kanıtı çıkarılamaz."],grantsAuthority:false};
  let money=platform?r.platforms.find(v=>v.platform===platform)?.realized??[]:r.realized;
  if(window){const copy=snapshotAyasRevenuePilotData(raw,24*1024*1024,500000);if(!isAyasRevenuePlainRecord(copy))return {status:"UNAVAILABLE",lines:["Gelir tarih kanıtı UNAVAILABLE."],grantsAuthority:false};
    const ledger=validateAyasRevenueLedgerState(copy.ledger),visible=ledger.entries.filter(e=>Date.parse(e.occurredAt)<=Date.parse(window.at)),reversed=new Set(visible.filter(e=>e.event==="REVERSAL").map(e=>e.reversesEntryId));
    const entries=visible.filter(e=>e.event!=="REVERSAL"&&!reversed.has(e.entryId)&&(!platform||e.platform===platform)&&(window.from===null||Date.parse(e.occurredAt)>=Date.parse(window.from))&&(window.until===null||Date.parse(e.occurredAt)<Date.parse(window.until)));
    money=summarizeAyasRevenueEconomics({schemaVersion:"1",revision:entries.length,entries});}
  const queue = r.approvalQueue.filter(v => !platform || v.platform === platform), timeline = r.timeline.filter(v => (!platform || v.platform === platform)
    &&(!window||Date.parse(v.occurredAt)<=Date.parse(window.at)&&(window.from===null||Date.parse(v.occurredAt)>=Date.parse(window.from))&&(window.until===null||Date.parse(v.occurredAt)<Date.parse(window.until))));
  return { status: r.status, grantsAuthority: false, lines: ["Salt okunur gelir gözlemleri; yürütme/onay yetkisi NONE; spend 0. Para ledger kaynağından, tahminler ayrı.",
    "Güncel owner incelemesi bekleyen gözlem=" + queue.length + "; bu kuyruk onay vermez.",
    ...timeline.slice(-3).map(v => v.occurredAt + " " + v.platform + " " + v.operation + "/" + v.phase + ": " + v.reasonCode + "; rule=" + v.ruleCode + "; evidence=" + v.evidenceDigest),
    ...money.slice(0, 3).map(e => (window?"Window ledger ":"Current full ledger ")+e.currency + ": gross=" + e.grossRevenueMinor + "; fees=" + (e.platformFeesMinor + e.paymentProcessingFeesMinor) + "; refunds=" + e.refundsMinor + "; spend=" + (e.adSpendMinor + e.otherCostMinor + e.variableDeliveryCostMinor) + "; net profit=" + (e.contributionProfitMinor ?? "UNKNOWN") + " minor")].slice(0, 8) };
}
/** A separate observation projection at chat ingress preserves the existing business-memory dependency fence. */
export function buildAyasRevenueActivityChatContext(source:unknown,userText:string,now:string) {
  if(!isAyasRevenueContextRelevant(userText))return {status:"NOT_RELEVANT",lines:[],grantsAuthority:false};
  try{const q=detectAyasRevenueRecall(userText,now),today=/\bbugün\b|\bbugun\b/i.test(userText),window=today?{...q,from:now.slice(0,10)+"T00:00:00.000Z",until:new Date(Date.parse(now.slice(0,10)+"T00:00:00.000Z")+86400000).toISOString()}:q,r=summarizeAyasRevenueActivity(source,now,isAyasRevenuePlatform(q.platform)?q.platform:undefined,window);
    if(r.lines.length>8||r.lines.join("\n").length>3072)throw Error();return r;
  }catch{return {status:"UNAVAILABLE",lines:["Gelir faaliyet kanıtı UNAVAILABLE; faaliyet veya kazanç çıkarılamaz."],grantsAuthority:false};}
}
