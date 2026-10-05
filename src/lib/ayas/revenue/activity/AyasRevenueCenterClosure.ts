/** Current-HEAD qualification audit. A closure verdict never promotes source or grants authority. */
import { snapshotAyasRevenuePilotData } from "../pilot/AyasRevenuePilot";
import { isAyasRevenueDigest } from "../AyasRevenueOpportunity";
import { AYAS_REVENUE_PLATFORMS } from "../AyasRevenuePlatformTypes";
import { deepFreezeAyasRevenueValue, hasExactAyasRevenueKeys, isAyasRevenuePlainRecord, isAyasRevenueTimestamp } from "../AyasRevenueRedaction";
import { buildAyasRevenueActivityReport } from "./AyasRevenueActivityReport";
export const AYAS_REVENUE_CLOSURE_SCOPES = Object.freeze(["16.0", "16.1", "16.2", "16.3", "16.3A", "16.3B", "16.4", "16.5", "16.6", "16.7", "16.8", "16.9", "16.10", "16.11", "16.11A", "16.12", "16.13", "ACTIVITY_DASHBOARD"] as const);
export const AYAS_REVENUE_CLOSURE_REGRESSIONS = Object.freeze(["TYPESCRIPT", "FULL_LINT", "STAGE9_SECURITY", "ZERO_COST", "MEMORY_TEMPORAL", "MEMORY_RETRIEVAL", "COGNITIVE_QUALITY", "ALL_STAGE16", "GRAPHIFY", "AUTHORITY_APPROVAL_EXECUTION", "DIFF_CHECK"] as const);
export const AYAS_REVENUE_DEFERRED_QUALIFICATIONS = deepFreezeAyasRevenueValue([
  { id: "UPWORK_OFFICIAL_OAUTH_CATALOG_SCHEMA", stage: "16.5" },
  { id: "UDEMY_REVIEWS_QA_MESSAGE_ROUTES", stage: "16.7" },
  { id: "LEMON_TEST_KEY_CONNECTION_DURABLE_INGRESS", stage: "16.8" },
  { id: "SECURITY_ACCOUNT_WEBHOOK_JOURNAL_EXECUTOR", stage: "16.11" },
  { id: "CURRENT_TERMS_ACCOUNT_PERMISSION_REVIEW", stage: "16.11A" },
  { id: "AUTHENTICATED_PILOT_PLATFORM_STORE_JOURNAL", stage: "16.12" },
] as const);
export type AyasRevenueCenterClosureStatus = "OPEN" | "BLOCKED" | "FRAMEWORK_CLOSED" | "LIVE_READ_CLOSED" | "OWNER_WRITE_PATHS_SEPARATELY_VALIDATED";
const head = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{40}$/.test(v);
const integer = (v: unknown) => Number.isSafeInteger(v) && !Object.is(v, -0) && (v as number) >= 0;
const STATES = ["PASS", "FAIL", "BLOCKED", "NOT_RUN", "STALE", "UNKNOWN"];
function proof(v: unknown): v is {scope: string; sourceHead: string; status: string; evidenceDigest: string} {
  return isAyasRevenuePlainRecord(v) && hasExactAyasRevenueKeys(v, ["scope", "sourceHead", "status", "evidenceDigest"]) && typeof v.scope === "string" && head(v.sourceHead)
    && STATES.includes(v.status as string) && isAyasRevenueDigest(v.evidenceDigest);
}
export function evaluateAyasRevenueCenterClosure(raw: unknown) {
  const out = (status: AyasRevenueCenterClosureStatus, reasons: string[], debts: readonly unknown[] = [], levels: readonly unknown[] = [], sourceHead: string | null = null) =>
    deepFreezeAyasRevenueValue({ status, reasons, deferredQualifications: debts, platformLevels: levels, sourceHead,
      stage16Complete: false as const, evidenceVerification: "NORMALIZED_EVIDENCE_METADATA_NOT_ATTESTATION" as const, ownerPromotion: "REQUIRED_NOT_GRANTED" as const, grantsAuthority: false as const, executionAuthority: "NONE" as const, autonomousSpend: 0 as const });
  const v = snapshotAyasRevenuePilotData(raw, 32 * 1024 * 1024, 600000);
  if (!isAyasRevenuePlainRecord(v) || !hasExactAyasRevenueKeys(v, ["sourceHead", "now", "framework", "regressions", "graphify", "findings", "defaults", "debts", "platformLevels", "activitySource"])
    || !head(v.sourceHead) || !isAyasRevenueTimestamp(v.now) || !Array.isArray(v.framework) || !Array.isArray(v.regressions) || !Array.isArray(v.debts) || !Array.isArray(v.platformLevels)) return out("BLOCKED", ["INVALID_CLOSURE_INPUT"]);
  const reasons: string[] = [];
  for (const [rows, expected, label] of [[v.framework, AYAS_REVENUE_CLOSURE_SCOPES, "FRAMEWORK"], [v.regressions, AYAS_REVENUE_CLOSURE_REGRESSIONS, "REGRESSION"]] as const) {
    if (rows.length !== expected.length || !rows.every(proof) || new Set(rows.map(r => r.scope)).size !== rows.length || rows.some(r => !(expected as readonly string[]).includes(r.scope))) reasons.push(label + "_COVERAGE_INVALID");
    else for (const r of rows) if (r.sourceHead !== v.sourceHead) reasons.push(label + "_STALE:" + r.scope); else if (r.status !== "PASS") reasons.push(label + "_" + r.status + ":" + r.scope);
  }
  const g = v.graphify;
  if (!isAyasRevenuePlainRecord(g) || !hasExactAyasRevenueKeys(g, ["sourceHead", "lastAnalyzedHead", "builtFromHead", "stale", "needsUpdate", "integrityViolations", "structural", "semantic"])
    || g.sourceHead !== v.sourceHead || g.lastAnalyzedHead !== v.sourceHead || g.builtFromHead !== v.sourceHead || g.stale !== false || g.needsUpdate !== false
    || g.integrityViolations !== 0 || !["PASS", "PARTIAL"].includes(g.structural as string) || !["PASS", "PENDING"].includes(g.semantic as string)) reasons.push("GRAPHIFY_NOT_CURRENT_OR_CORRUPT");
  const f = v.findings, d = v.defaults;
  if (!isAyasRevenuePlainRecord(f) || !hasExactAyasRevenueKeys(f, ["blockers", "unresolvedMajors"]) || !integer(f.blockers) || !integer(f.unresolvedMajors) || f.blockers !== 0 || f.unresolvedMajors !== 0) reasons.push("UNRESOLVED_BLOCKER_OR_MAJOR");
  if (!isAyasRevenuePlainRecord(d) || !hasExactAyasRevenueKeys(d, ["autonomousSpend", "reinvestmentEnabled", "financialAutonomous", "externalWriteAuthority"])
    || d.autonomousSpend !== 0 || Object.is(d.autonomousSpend, -0) || d.reinvestmentEnabled !== false || d.financialAutonomous !== false || d.externalWriteAuthority !== "NONE") reasons.push("UNSAFE_DEFAULTS");
  const debtRows: {id: string; stage: string; status: string; evidenceDigest: string | null; evidenceKind: string | null; sourceHead: string | null}[] = [];
  for (const seed of AYAS_REVENUE_DEFERRED_QUALIFICATIONS) {
    const matches = v.debts.filter(r => isAyasRevenuePlainRecord(r) && r.id === seed.id), r = matches[0];
    if (matches.length !== 1 || !isAyasRevenuePlainRecord(r) || !hasExactAyasRevenueKeys(r, ["id", "stage", "status", "evidenceDigest", "evidenceKind", "sourceHead"]) || r.stage !== seed.stage
      || !["UNBOUND", "NOT_RUN", "UNKNOWN", "PENDING_LIVE", "PASS"].includes(r.status as string)
      || !(r.evidenceDigest === null || isAyasRevenueDigest(r.evidenceDigest)) || !(r.sourceHead === null || head(r.sourceHead))
      || !(r.evidenceKind === null || ["DETERMINISTIC_TEST", "LIVE_READ_ONLY", "OWNER_WRITE_VALIDATION"].includes(r.evidenceKind as string))) { reasons.push("QUALIFICATION_DEBT_INVALID:" + seed.id); continue; }
    if (r.status === "PASS" && (r.sourceHead !== v.sourceHead || !isAyasRevenueDigest(r.evidenceDigest) || !["LIVE_READ_ONLY", "OWNER_WRITE_VALIDATION"].includes(r.evidenceKind as string))) reasons.push("FIXTURE_CANNOT_DISCHARGE_LIVE_DEBT:" + seed.id);
    debtRows.push(r as unknown as typeof debtRows[number]);
  }
  if (v.debts.length !== AYAS_REVENUE_DEFERRED_QUALIFICATIONS.length) reasons.push("DEBT_ROSTER_INVALID");
  const levels: {platform: string; level: string; evidenceDigest: string | null; evidenceKind: string | null; sourceHead: string | null}[] = [];
  for (const platform of AYAS_REVENUE_PLATFORMS) {
    const matches = v.platformLevels.filter(r => isAyasRevenuePlainRecord(r) && r.platform === platform), r = matches[0];
    if (matches.length !== 1 || !isAyasRevenuePlainRecord(r) || !hasExactAyasRevenueKeys(r, ["platform", "level", "evidenceDigest", "evidenceKind", "sourceHead"])
      || !["FRAMEWORK_VALIDATED", "LIVE_READ_VALIDATED", "LIVE_WRITE_OWNER_VALIDATED"].includes(r.level as string)
      || !isAyasRevenueDigest(r.evidenceDigest) || r.sourceHead !== v.sourceHead || !["DETERMINISTIC_TEST", "LIVE_READ_ONLY", "OWNER_WRITE_VALIDATION"].includes(r.evidenceKind as string)
      || r.level === "FRAMEWORK_VALIDATED" && r.evidenceKind !== "DETERMINISTIC_TEST" || r.level === "LIVE_READ_VALIDATED" && r.evidenceKind !== "LIVE_READ_ONLY"
      || r.level === "LIVE_WRITE_OWNER_VALIDATED" && r.evidenceKind !== "OWNER_WRITE_VALIDATION") { reasons.push("PLATFORM_LEVEL_UNPROVEN:" + platform); continue; }
    levels.push(r as unknown as typeof levels[number]);
  }
  if (v.platformLevels.length !== AYAS_REVENUE_PLATFORMS.length) reasons.push("PLATFORM_ROSTER_INVALID");
  const activity = buildAyasRevenueActivityReport(v.activitySource, v.now);
  if (activity.status === "UNAVAILABLE") reasons.push("ACTIVITY_SOURCE_INVALID");
  if (levels.some(l => l.level !== "FRAMEWORK_VALIDATED") && activity.status !== "OBSERVED") reasons.push("LIVE_ACTIVITY_SOURCE_UNBOUND");
  if (g && isAyasRevenuePlainRecord(g) && g.structural === "PARTIAL") reasons.push("GRAPHIFY_PARTIAL_DISCLOSED");
  if (g && isAyasRevenuePlainRecord(g) && g.semantic === "PENDING") reasons.push("GRAPHIFY_SEMANTIC_PENDING_DISCLOSED");
  const blocking = reasons.filter(r => !r.endsWith("_DISCLOSED"));
  if (blocking.length) return out("BLOCKED", reasons, debtRows, levels, v.sourceHead);
  const liveQualified = debtRows.every(r => r.status === "PASS");
  const status = liveQualified && levels.every(l => l.level === "LIVE_WRITE_OWNER_VALIDATED") ? "OWNER_WRITE_PATHS_SEPARATELY_VALIDATED"
    : liveQualified && levels.every(l => l.level !== "FRAMEWORK_VALIDATED") ? "LIVE_READ_CLOSED" : "FRAMEWORK_CLOSED";
  return out(status, [...reasons, ...(liveQualified ? [] : ["LIVE_QUALIFICATION_DEBTS_OPEN"]), "OWNER_REVIEW_AND_PROMOTION_REQUIRED"], debtRows, levels, v.sourceHead);
}
