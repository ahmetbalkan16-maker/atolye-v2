/** Synthetic cross-stage data. No credential, real account, authority or production path. */
import { createHash } from "node:crypto";
import { emptyAyasRevenueActivity, planAyasRevenueActivityAppend, type AyasRevenueActivityInput } from "../../src/lib/ayas/revenue/activity/AyasRevenueActivity";
import { AYAS_REVENUE_CLOSURE_SCOPES, AYAS_REVENUE_CLOSURE_REGRESSIONS, AYAS_REVENUE_DEFERRED_QUALIFICATIONS } from "../../src/lib/ayas/revenue/activity/AyasRevenueCenterClosure";
import { AYAS_REVENUE_PLATFORMS } from "../../src/lib/ayas/revenue/AyasRevenuePlatformTypes";
import { digestAyasRevenueLedgerData } from "../../src/lib/ayas/revenue/AyasRevenueDigest";
import { revenueLedgerFixtureFact as fact, revenueLedgerFixtureState as state, REVENUE_LEDGER_FIXTURE_AT } from "./ayas-revenue-ledger-fixture";
export const RC_NOW = "2026-10-03T13:00:00.000Z", RC_AT = REVENUE_LEDGER_FIXTURE_AT, RC_UNTIL = "2026-10-04T12:00:00.000Z", RC_HEAD = "a".repeat(40);
export const rcDigest = (v: string) => createHash("sha256").update("closure-fixture:" + v).digest("hex");
export const rcClone = <T>(v: T): RcMutable<T> => structuredClone(v) as RcMutable<T>;
export type RcMutable<T> = T extends string ? string : T extends readonly (infer E)[] ? RcMutable<E>[] : T extends object ? { -readonly [K in keyof T]: RcMutable<T[K]> } : T;
export function rcLedger() { return state(fact("rc-gross"), fact("rc-fee", "PLATFORM_FEE", 100), fact("rc-process", "PAYMENT_PROCESSING_FEE", 50), fact("rc-payout", "PAYOUT_OBSERVED", 850)); }
export function rcEvent(tag = "gate", patch: Partial<AyasRevenueActivityInput> = {}): AyasRevenueActivityInput {
  const ledger = rcLedger();
  return { schemaVersion: "1", eventDigest: rcDigest("event-" + tag), actionDigest: rcDigest("action-one"), platform: "etsy", accountDigest: rcDigest("account-one"), occurredAt: RC_AT,
    operation: "LISTING_CREATE", phase: "BLOCKED_OWNER", reasonCode: "OWNER_GATE", ruleCode: "OWNER_HANDOFF", evidenceDigest: rcDigest("evidence-one"),
    expectedCost: { state: "UNKNOWN", amount: null }, expectedEffect: "PUBLISH", risk: "CAUTION", requestedDecision: "REVIEW_EXACT_ACTION", nextAction: "WAIT_OWNER_REVIEW",
    ledgerRef: { digest: digestAyasRevenueLedgerData(ledger), revision: ledger.revision }, inventory: { opportunities: 3, drafts: 1, activeWork: 0 }, ...patch };
}
export function rcActivitySource() {
  const activity = planAyasRevenueActivityAppend(emptyAyasRevenueActivity(), rcEvent(), RC_AT).state;
  return rcClone({ schemaVersion: "1", observedAt: RC_AT, freshUntil: RC_UNTIL, ledger: rcLedger(), activity, accounts: [{ platform: "etsy", accountDigest: rcDigest("account-one"), connection: "CONNECTED", observedAt: RC_AT, evidenceDigest: rcDigest("connection"), activityHeadDigest: activity.records.at(-1)!.recordDigest }] }) as RcMutable<{schemaVersion:"1";observedAt:string;freshUntil:string;ledger:ReturnType<typeof rcLedger>;activity:typeof activity;accounts:{platform:string;accountDigest:string;connection:string;observedAt:string;evidenceDigest:string;activityHeadDigest:string|null}[]}>;
}
export function rcClosure() {
  const proof = (scope: string) => ({ scope, sourceHead: RC_HEAD, status: "PASS", evidenceDigest: rcDigest(scope) });
  return { sourceHead: RC_HEAD, now: RC_NOW, framework: AYAS_REVENUE_CLOSURE_SCOPES.map(proof), regressions: AYAS_REVENUE_CLOSURE_REGRESSIONS.map(proof),
    graphify: { sourceHead: RC_HEAD, lastAnalyzedHead: RC_HEAD, builtFromHead: RC_HEAD, stale: false, needsUpdate: false, integrityViolations: 0, structural: "PASS", semantic: "PASS" },
    findings: { blockers: 0, unresolvedMajors: 0 }, defaults: { autonomousSpend: 0, reinvestmentEnabled: false, financialAutonomous: false, externalWriteAuthority: "NONE" },
    debts: AYAS_REVENUE_DEFERRED_QUALIFICATIONS.map(s => ({ ...s, status: "UNBOUND", evidenceDigest: null as string | null, evidenceKind: null as string | null, sourceHead: null as string | null })),
    platformLevels: AYAS_REVENUE_PLATFORMS.map(platform => ({ platform: platform as string, level: "FRAMEWORK_VALIDATED", evidenceDigest: rcDigest(platform), evidenceKind: "DETERMINISTIC_TEST", sourceHead: RC_HEAD })),
    activitySource: rcActivitySource() as unknown };
}
