import { AYAS_CAPABILITY_CATEGORY_RELATED_PATHS, isAyasCapabilityCategory, type AyasCapabilityCategory } from "../../brain/autonomy/AyasCapabilityTaxonomy";
import { AYAS_RESEARCH_FRESH_DAYS, AYAS_RESEARCH_STALE_DAYS } from "../../brain/autonomy/AyasResearchImprovementLoop";
import { resolveAyasResearchSourceRegistry } from "../../brain/autonomy/AyasResearchSourceRegistry";
import { evaluateAyasZeroCost, type AyasCostClass, type AyasCostDecision } from "../policy/AyasZeroCostPolicy";
import type { AyasCapability } from "../routing/AyasAgenticRouting";
import {
  AYAS_TECHNOLOGY_COOLDOWN_DAYS, AYAS_TECHNOLOGY_LICENSE_RANK, AYAS_TECHNOLOGY_LIMITS, AYAS_TECHNOLOGY_LOCAL_DELIVERIES, AYAS_TECHNOLOGY_MAINTENANCE_RANK,
  AYAS_TECHNOLOGY_PACKAGE_ECOSYSTEMS, AYAS_TECHNOLOGY_PACKAGE_REGISTRY_HOSTS, AYAS_TECHNOLOGY_PRICING_RANK, AYAS_TECHNOLOGY_REOPEN_LIMIT, AYAS_TECHNOLOGY_REQUIREMENTS,
  AYAS_TECHNOLOGY_SCHEMA_VERSION, AYAS_TECHNOLOGY_SURFACE_LIMIT, AyasTechnologyError, assertAyasTechnologyRegister, ayasTechnologyAddDays,
  ayasTechnologyAnchorsConflict, ayasTechnologyCanonicalJson, ayasTechnologyCanonicalOrder, ayasTechnologyEpistemicClass, ayasTechnologyIdentitiesConflict, ayasTechnologyIso, ayasTechnologyIssueSeverity, ayasTechnologyMaxVersion,
  ayasTechnologyPackageAnchor, ayasTechnologySlug, compareAyasTechnologyVersions, computeAyasTechnologyMaterialFingerprint, describeAyasTechnologySource,
  isAyasTechnologyDenseArray, isAyasTechnologyPlainObject, isAyasTechnologyTierEligible, updateAyasTechnologyWatchRecord,
  type AyasTechnologyAnchors, type AyasTechnologyCandidate, type AyasTechnologyCategory, type AyasTechnologyClaim, type AyasTechnologyClaimKind,
  type AyasTechnologyDelivery, type AyasTechnologyEvidence, type AyasTechnologyLicenseClass, type AyasTechnologyMaintenanceStatus, type AyasTechnologyPackageEcosystem,
  type AyasTechnologyPricingModel, type AyasTechnologyProvenanceStatus, type AyasTechnologyRegister, type AyasTechnologyRequirement, type AyasTechnologySpendRequirement,
  type AyasTechnologyWatchRecord, type AyasTechnologyWatchState,
} from "./AyasTechnologyCandidate";

export { AYAS_TECHNOLOGY_COOLDOWN_DAYS, AYAS_TECHNOLOGY_REOPEN_LIMIT, AYAS_TECHNOLOGY_SURFACE_LIMIT };

/**
 * Stage 14 — the technology watch engine. Pure and deterministic: given the
 * register and caller-supplied environment FACTS, it answers, for every
 * candidate, what it is, what supports it, how current that is, what it could
 * add, whether AYAS already has it, whether it is new, what it needs, what it
 * costs, what its terms and supply chain look like, what is missing — and
 * whether to watch it, research it, review its security, or hand it to Stage
 * 13. It never approves, installs, enables, spends or executes anything:
 * every assessment carries `executionAuthority: "NONE"` and `may*: false`.
 *
 * Facts it does not have stay unknown. Readiness is the LOWEST level among all
 * blockers, ordered so that corruption < uncertainty < known-but-not-worth-it <
 * known-security-concern < eligible: adding uncertainty or corruption can
 * never make a candidate more ready.
 */
export type AyasTechnologyCoverage = "PRESENT" | "PARTIAL" | "ABSENT" | "UNKNOWN";
export type AyasTechnologyFact = "AVAILABLE" | "UNAVAILABLE" | "UNKNOWN";

export interface AyasTechnologyWatchEnvironment {
  readonly now: string;
  /** Stage 7 `inventoryAyasCapabilities` snapshot — what AYAS already has. */
  readonly capabilities: readonly AyasCapability[];
  /** Owner-stated coverage of each Stage 8 capability domain; an absent domain is UNKNOWN, never ABSENT. */
  readonly domainCoverage?: Readonly<Partial<Record<AyasCapabilityCategory, AyasTechnologyCoverage>>>;
  /** Dependencies AYAS already ships with (from the lockfile, supplied by the caller). */
  readonly installedPackages?: readonly { readonly ecosystem: AyasTechnologyPackageEcosystem; readonly name: string }[];
  readonly hostBinaries?: Readonly<Record<string, AyasTechnologyFact>>;
  readonly externalAccounts?: Readonly<Record<string, AyasTechnologyFact>>;
}

export const AYAS_TECHNOLOGY_READINESS = ["BLOCKED", "RESEARCH_REQUIRED", "WATCH", "SECURITY_REVIEW_REQUIRED", "HANDOFF_ELIGIBLE"] as const;
export type AyasTechnologyReadiness = typeof AYAS_TECHNOLOGY_READINESS[number];
type BlockerLevel = Exclude<AyasTechnologyReadiness, "HANDOFF_ELIGIBLE">;
export interface AyasTechnologyBlocker { readonly level: BlockerLevel; readonly code: string; readonly reference: string | null }

export type AyasTechnologyFreshnessState = "CURRENTLY_VERIFIED" | "RECENTLY_OBSERVED" | "AGING" | "STALE" | "UNAVAILABLE" | "UNKNOWN";
export type AyasTechnologyReleaseState = "LATEST" | "SUPERSEDED" | "WITHDRAWN" | "UNVERIFIED" | "UNORDERED";
export type AyasTechnologyRelation = "GENUINE_GAP" | "COMPLEMENTARY" | "OVERLAP_ONLY" | "SAME_TECHNOLOGY" | "UNKNOWN" | "UNMAPPED";
export type AyasTechnologyRequirementState = "PRESENT" | "ABSENT" | "UNKNOWN";
export type AyasTechnologySourceVerification = "REGISTERED_OFFICIAL" | "IDENTITY_HOST" | "DECLARED";
export type AyasTechnologySuppressionCode = "DUPLICATE_OF_CANONICAL" | "ALREADY_HANDED_OFF" | "DISMISSED_BY_OWNER" | "COOLDOWN_ACTIVE" | "SURFACE_LIMIT_REACHED" | "REOPEN_LIMIT_REACHED";

export interface AyasTechnologyAssessment {
  readonly schemaVersion: typeof AYAS_TECHNOLOGY_SCHEMA_VERSION;
  readonly technologyKey: string;
  readonly assessedAt: string;
  readonly readiness: AyasTechnologyReadiness;
  readonly recommendation: AyasTechnologyReadiness | "DUPLICATE" | "COOLDOWN";
  readonly suppression: { readonly state: "NONE" | "DUPLICATE" | "COOLDOWN"; readonly code: AyasTechnologySuppressionCode | null; readonly reference: string | null };
  readonly primaryReason: string;
  readonly blockers: readonly AyasTechnologyBlocker[];
  /** May be shown to the owner now (not suppressed). Attention, not authority. */
  readonly surfaceable: boolean;
  /** Readiness HANDOFF_ELIGIBLE and not suppressed: Stage 13 may be given it. Stage 13 still decides everything. */
  readonly handoffEligible: boolean;
  readonly materialFingerprint: string;
  /** Q1 — what is this? */
  readonly identity: { readonly displayName: string; readonly category: AyasTechnologyCategory; readonly categoryKey: string | null; readonly domainKey: string | null; readonly vendor: string | null; readonly anchors: AyasTechnologyAnchors };
  /** Q2 — what says it exists? */
  readonly evidence: {
    readonly total: number; readonly adequate: number; readonly byEpistemicClass: Readonly<Record<string, number>>; readonly independentSources: number;
    readonly existenceCorroborated: boolean; readonly registeredOfficial: number; readonly verified: number; readonly compacted: number;
  };
  /** Q3 — is it current? */
  readonly freshness: {
    readonly state: AyasTechnologyFreshnessState; readonly latestClaimAt: string | null; readonly ageDays: number | null; readonly futureEvidence: number;
    readonly latestVersion: string | null; readonly verifiedLatestVersion: string | null;
    readonly releases: readonly { readonly version: string; readonly state: AyasTechnologyReleaseState; readonly claimAt: string }[];
  };
  /** Q4–Q6 — what it could add, what AYAS already has, and how they relate. */
  readonly capability: {
    readonly claimedDomains: readonly AyasCapabilityCategory[]; readonly corroboratedDomains: readonly AyasCapabilityCategory[]; readonly uncorroboratedDomains: readonly AyasCapabilityCategory[];
    readonly unknownDomainKeys: readonly string[]; readonly claimedKeys: readonly string[]; readonly relation: AyasTechnologyRelation;
    readonly existing: readonly string[]; readonly overlap: readonly AyasCapabilityCategory[]; readonly partial: readonly AyasCapabilityCategory[];
    readonly gaps: readonly AyasCapabilityCategory[]; readonly unknown: readonly string[]; readonly replacementPossible: boolean;
  };
  /** Q7 — compatibility requirements. */
  readonly compatibility: { readonly deliveries: readonly AyasTechnologyDelivery[]; readonly deliveryKnown: boolean; readonly locallyExecuted: boolean; readonly requirements: Readonly<Record<AyasTechnologyRequirement, AyasTechnologyRequirementState>> };
  /** Q8 — cost. UNKNOWN is never free, and a free tier is never guaranteed zero cost. */
  readonly cost: { readonly model: AyasTechnologyPricingModel | "UNKNOWN"; readonly spendRequirements: readonly AyasTechnologySpendRequirement[]; readonly costClass: AyasCostClass; readonly decision: AyasCostDecision; readonly conflict: boolean; readonly deliveryMismatch: boolean };
  /** Q9 — licensing, terms and provenance. */
  readonly licensing: { readonly licenseClass: AyasTechnologyLicenseClass | "UNKNOWN"; readonly identifiers: readonly string[]; readonly conflict: boolean; readonly uncertainties: readonly string[] };
  /** Q10 — security and supply chain. */
  readonly security: {
    readonly provenance: AyasTechnologyProvenanceStatus | "UNKNOWN"; readonly provenanceBasis: "CLAIM" | "REGISTERED_SOURCE" | "NONE"; readonly maintenance: AyasTechnologyMaintenanceStatus | "UNKNOWN";
    readonly advisoriesAffectingLatest: number; readonly historicalAdvisories: number; readonly compromised: "LATEST" | "HISTORICAL" | "NONE";
    readonly concerns: readonly string[]; readonly unknowns: readonly string[];
  };
  /** Q11 — prerequisites, resolved against environment facts only. */
  readonly prerequisites: readonly { readonly requirement: AyasTechnologyRequirement; readonly kind: "HOST_BINARY" | "EXTERNAL_ACCOUNT" | "EXTERNAL_SERVICE"; readonly key: string; readonly status: "SATISFIED" | "MISSING" | "UNKNOWN" }[];
  /** Q6 — novelty, dedup and cooldown. */
  readonly novelty: {
    readonly watchState: AyasTechnologyWatchState; readonly materialChange: boolean; readonly reopenCount: number; readonly surfaceCount: number;
    readonly duplicateOf: string | null; readonly duplicates: readonly string[]; readonly sourceOverlapWith: readonly string[]; readonly identityConflicts: readonly string[];
  };
  /** Q12 — what to do next. */
  readonly next: "NONE" | "RESEARCH" | "WATCH" | "SECURITY_REVIEW" | "STAGE13_HANDOFF";
  readonly executionAuthority: "NONE";
  readonly authority: "NONE";
  readonly mayExecute: false;
  readonly mayInstall: false;
  readonly maySpend: false;
  readonly mayPublish: false;
  readonly mayApprove: false;
  readonly mayEnable: false;
  readonly mayDeploy: false;
  readonly mayModifyPolicy: false;
}

const DAY_MS = 86_400_000;
const FACT_KEY = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,119}$/;
const OPPORTUNITY_ID = /^ayas-evo-[0-9a-f]{16,64}$/;
const uniqueSorted = <T extends string>(values: Iterable<T>): T[] => [...new Set(values)].sort();
const PRODUCED_ASSESSMENTS = new WeakSet<object>();
/** Only an assessment this engine produced can drive a transition or a hand-off; a hand-built or edited object cannot. */
export function isAyasTechnologyAssessmentProduced(value: unknown): value is AyasTechnologyAssessment {
  return typeof value === "object" && value !== null && PRODUCED_ASSESSMENTS.has(value);
}
const own = <T>(record: Readonly<Record<string, T>> | undefined, key: string): T | undefined =>
  record && Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;

// ---------------------------------------------------------------- environment

const ENVIRONMENT_FIELDS = ["now", "capabilities", "domainCoverage", "installedPackages", "hostBinaries", "externalAccounts"];
const COVERAGE_VALUES: readonly string[] = ["PRESENT", "PARTIAL", "ABSENT", "UNKNOWN"];
const FACT_VALUES: readonly string[] = ["AVAILABLE", "UNAVAILABLE", "UNKNOWN"];

/**
 * Environment FACTS fail closed: a fact map of the wrong shape, a value
 * outside its vocabulary or an unknown field would otherwise read as "no
 * facts". The environment is refused, never read as UNKNOWN.
 */
export function assertAyasTechnologyEnvironment(env: AyasTechnologyWatchEnvironment): void {
  const fail = (field: string): never => { throw new AyasTechnologyError("AYAS_TECHNOLOGY_ENVIRONMENT_INVALID", `environment ${field} is malformed`); };
  const e: unknown = env;
  if (!isAyasTechnologyPlainObject(e)) return fail("shape");
  for (const [field, value] of Object.entries(e)) if (value !== undefined && !ENVIRONMENT_FIELDS.includes(field)) fail(field);
  if (ayasTechnologyIso(e.now) === null) throw new AyasTechnologyError("AYAS_TECHNOLOGY_ENVIRONMENT_INVALID", "environment time is not an ISO timestamp");
  if (!isAyasTechnologyDenseArray(e.capabilities) || !e.capabilities.every((item: unknown) => isAyasTechnologyPlainObject(item) && typeof item.id === "string" && typeof item.type === "string"
    && typeof item.available === "boolean" && (item.costClass === "zero" || item.costClass === "unknown") && (item.locality === "local" || item.locality === "external"))) fail("capabilities");
  if (e.domainCoverage !== undefined && (!isAyasTechnologyPlainObject(e.domainCoverage)
    || !Object.entries(e.domainCoverage).every(([domain, coverage]) => isAyasCapabilityCategory(domain) && typeof coverage === "string" && COVERAGE_VALUES.includes(coverage)))) fail("domainCoverage");
  if (e.installedPackages !== undefined && (!isAyasTechnologyDenseArray(e.installedPackages) || e.installedPackages.length > 5_000
    || !e.installedPackages.every((item: unknown) => isAyasTechnologyPlainObject(item) && Object.keys(item).every((key) => key === "ecosystem" || key === "name")
      && (AYAS_TECHNOLOGY_PACKAGE_ECOSYSTEMS as readonly unknown[]).includes(item.ecosystem) && typeof item.name === "string"
      && ayasTechnologyPackageAnchor(item.ecosystem as AyasTechnologyPackageEcosystem, item.name) !== null))) fail("installedPackages");
  for (const field of ["hostBinaries", "externalAccounts"]) {
    const facts = e[field];
    if (facts !== undefined && (!isAyasTechnologyPlainObject(facts) || Object.keys(facts).length > 500
      || !Object.entries(facts).every(([key, fact]) => FACT_KEY.test(key) && typeof fact === "string" && FACT_VALUES.includes(fact)))) fail(field);
  }
}

// ---------------------------------------------------------------- source verification

let officialRoots: readonly string[] | null = null;
/** Stage 8's registered official sources: a URL under one of their repository roots is REGISTERED_OFFICIAL. */
function registeredOfficialRoots(): readonly string[] {
  if (officialRoots === null) {
    officialRoots = Object.freeze(resolveAyasResearchSourceRegistry().filter((source) => source.officialSource).flatMap((source) => {
      const root = describeAyasTechnologySource(source.kind === "github-releases-atom" ? source.url.replace(/\/releases\.atom$/i, "") : source.url);
      return root ? [`${root.host}${root.path.replace(/\/+$/, "")}`] : [];
    }));
  }
  return officialRoots;
}

const under = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`);

/**
 * A declared source class is only a label. A source is VERIFIED when it sits
 * under a Stage 8 registered official repository, or on the technology's own
 * anchors (its repository, its official host, or its package page on the
 * ecosystem registry). Everything else is DECLARED: it can add restrictions,
 * and it can resolve an uncertainty only when an independent source agrees.
 */
export function verifyAyasTechnologySource(url: string, anchors: AyasTechnologyAnchors): AyasTechnologySourceVerification {
  const source = describeAyasTechnologySource(url);
  if (!source) return "DECLARED";
  const hostPath = `${source.host}${source.path.replace(/\/+$/, "")}`;
  if (registeredOfficialRoots().some((root) => under(hostPath, root))) return "REGISTERED_OFFICIAL";
  for (const repository of anchors.repositories) if (under(hostPath, repository)) return "IDENTITY_HOST";
  for (const host of anchors.hosts) if (source.host === host || source.host.endsWith(`.${host}`)) return "IDENTITY_HOST";
  for (const anchor of anchors.packages) {
    const separator = anchor.indexOf(":");
    const ecosystem = anchor.slice(0, separator).toUpperCase() as AyasTechnologyPackageEcosystem;
    const name = anchor.slice(separator + 1);
    if ((AYAS_TECHNOLOGY_PACKAGE_REGISTRY_HOSTS[ecosystem] ?? []).includes(source.host) && `${source.path}/`.includes(`/${name}/`)) return "IDENTITY_HOST";
  }
  return "DECLARED";
}

interface Classified {
  readonly e: AyasTechnologyEvidence;
  readonly claim: AyasTechnologyClaim;
  readonly epistemic: "RESEARCH_CLAIM" | "HYPOTHESIS";
  /** May count in the permissive direction (eligible source tier, direct extraction, not an AYAS suggestion). */
  readonly tierOk: boolean;
  readonly claimTime: number;
  readonly future: boolean;
  readonly current: boolean;
  readonly fresh: boolean;
  readonly verification: AyasTechnologySourceVerification;
  readonly independenceKey: string;
}

/**
 * When a claim was true: its publication time when stated, else when AYAS last
 * saw it. A publication after the observation, or any time in the future, is
 * not current evidence — it only ever counts in the restrictive direction.
 */
function classify(e: AyasTechnologyEvidence, anchors: AyasTechnologyAnchors, now: number): Classified {
  const claimTime = Date.parse(e.source.publishedAt ?? e.lastObservedAt);
  const future = claimTime > now + DAY_MS || Date.parse(e.firstObservedAt) > now + DAY_MS
    || (e.source.publishedAt !== null && Date.parse(e.source.publishedAt) > Date.parse(e.lastObservedAt) + DAY_MS);
  const age = (now - claimTime) / DAY_MS;
  return {
    e, claim: e.claim, epistemic: ayasTechnologyEpistemicClass(e), tierOk: isAyasTechnologyTierEligible(e), claimTime, future,
    current: !future && age <= AYAS_RESEARCH_STALE_DAYS, fresh: !future && age <= AYAS_RESEARCH_FRESH_DAYS,
    verification: verifyAyasTechnologySource(e.source.url, anchors), independenceKey: describeAyasTechnologySource(e.source.url)?.independenceKey ?? e.source.url,
  };
}

/** Verified by the technology's own or a registered official source, or corroborated by two independent publishers. */
const confirmed = (list: readonly Classified[]) => list.length > 0 && (list.some((c) => c.verification !== "DECLARED") || new Set(list.map((c) => c.independenceKey)).size >= 2);

// ---------------------------------------------------------------- register analysis

interface RegisterAnalysis {
  readonly duplicateOf: ReadonlyMap<string, string>;
  readonly duplicates: ReadonlyMap<string, readonly string[]>;
  readonly identityConflicts: ReadonlyMap<string, readonly string[]>;
  readonly sourceOverlap: ReadonlyMap<string, readonly string[]>;
}

const shares = (a: readonly string[], b: readonly string[]) => a.some((item) => b.includes(item));
function push(map: Map<string, string[]>, key: string, value: string): void { const list = map.get(key) ?? []; list.push(value); map.set(key, list); }

/**
 * Two records of one technology (a shared package or repository, or the same
 * name with no contradicting anchor) are one cluster; its canonical record is
 * the one furthest along the watch, then the earliest. The same name with a
 * contradicting anchor is an identity conflict, recorded for BOTH records from
 * the register as it is now, so arrival order cannot decide which one is held.
 * A shared source URL between different technologies is overlap — reported,
 * never merged.
 */
function analyzeRegister(register: AyasTechnologyRegister): RegisterAnalysis {
  const candidates = register.candidates;
  const parent = new Map(candidates.map((c) => [c.technologyKey, c.technologyKey]));
  const find = (key: string): string => { let root = key; while (parent.get(root) !== root) root = parent.get(root)!; parent.set(key, root); return root; };
  const identityConflicts = new Map<string, string[]>();
  for (let i = 0; i < candidates.length; i += 1) {
    for (let j = i + 1; j < candidates.length; j += 1) {
      const a = candidates[i]!.identity.anchors; const b = candidates[j]!.identity.anchors;
      const strong = shares(a.packages, b.packages) || shares(a.repositories, b.repositories);
      if (strong || (shares(a.names, b.names) && !ayasTechnologyAnchorsConflict(a, b))) parent.set(find(candidates[i]!.technologyKey), find(candidates[j]!.technologyKey));
      else if (ayasTechnologyIdentitiesConflict(a, b)) { push(identityConflicts, candidates[i]!.technologyKey, candidates[j]!.technologyKey); push(identityConflicts, candidates[j]!.technologyKey, candidates[i]!.technologyKey); }
    }
  }
  const clusters = new Map<string, AyasTechnologyCandidate[]>();
  for (const candidate of candidates) { const root = find(candidate.technologyKey); clusters.set(root, [...(clusters.get(root) ?? []), candidate]); }
  const duplicateOf = new Map<string, string>();
  const duplicates = new Map<string, string[]>();
  for (const members of clusters.values()) {
    if (members.length < 2) continue;
    const [canonical, ...rest] = [...members].sort(ayasTechnologyCanonicalOrder);
    for (const member of rest) { duplicateOf.set(member.technologyKey, canonical!.technologyKey); push(duplicates, canonical!.technologyKey, member.technologyKey); }
  }
  const sourceOverlap = new Map<string, string[]>();
  const urls = candidates.map((c) => new Set(c.evidence.map((e) => e.source.url)));
  for (let i = 0; i < candidates.length; i += 1) {
    for (let j = i + 1; j < candidates.length; j += 1) {
      if (find(candidates[i]!.technologyKey) === find(candidates[j]!.technologyKey)) continue;
      if ([...urls[i]!].some((url) => urls[j]!.has(url))) { push(sourceOverlap, candidates[i]!.technologyKey, candidates[j]!.technologyKey); push(sourceOverlap, candidates[j]!.technologyKey, candidates[i]!.technologyKey); }
    }
  }
  return { duplicateOf, duplicates, identityConflicts, sourceOverlap };
}

/** How one record stands in the register NOW: the canonical record it duplicates, and every record it is in identity conflict with. */
export function ayasTechnologyRegisterRelations(register: AyasTechnologyRegister, technologyKey: string): { readonly duplicateOf: string | null; readonly identityConflicts: readonly string[] } {
  const analysis = analyzeRegister(assertAyasTechnologyRegister(register));
  return { duplicateOf: analysis.duplicateOf.get(technologyKey) ?? null, identityConflicts: [...(analysis.identityConflicts.get(technologyKey) ?? [])].sort() };
}

// ---------------------------------------------------------------- watch suppression

/**
 * Suppression is about ATTENTION, never authority: a technology already handed
 * off, dismissed by the owner, or surfaced within its cooldown is not surfaced
 * again until a material fact changes. Reopening is bounded.
 */
export function ayasTechnologyWatchSuppression(watch: AyasTechnologyWatchRecord, fingerprint: string, now: number): { readonly code: AyasTechnologySuppressionCode | null; readonly materialChange: boolean } {
  const last = watch.history.at(-1);
  const materialChange = watch.state !== "WATCHING" && last !== undefined && last.fingerprint !== fingerprint;
  if (watch.handoff && watch.handoff.fingerprint === fingerprint) return { code: "ALREADY_HANDED_OFF", materialChange };
  if (watch.dismissed && watch.dismissed.fingerprint === fingerprint) return { code: "DISMISSED_BY_OWNER", materialChange };
  if (watch.surfaced && watch.surfaced.fingerprint === fingerprint) {
    if (now < Date.parse(watch.surfaced.until)) return { code: "COOLDOWN_ACTIVE", materialChange };
    if (watch.surfaceCount >= AYAS_TECHNOLOGY_SURFACE_LIMIT) return { code: "SURFACE_LIMIT_REACHED", materialChange };
  }
  if (materialChange && watch.reopenCount >= AYAS_TECHNOLOGY_REOPEN_LIMIT) return { code: "REOPEN_LIMIT_REACHED", materialChange };
  return { code: null, materialChange };
}

// ---------------------------------------------------------------- assessment

/** What a delivery implies, whatever any source says: a source cannot talk away a tool server's permissions. */
const IMPLIED: Readonly<Record<AyasTechnologyDelivery, readonly AyasTechnologyRequirement[]>> = Object.freeze({
  HOSTED_API: ["NETWORK_REQUIRED", "SENDS_DATA_EXTERNALLY"], PACKAGE_LIBRARY: ["EXECUTES_CODE"], MODEL_WEIGHTS: ["EXECUTES_CODE"], HOST_BINARY: ["EXECUTES_CODE", "NATIVE_BINARY"],
  CONTAINER_IMAGE: ["EXECUTES_CODE", "CONTAINER_RUNTIME"], MCP_SERVER: ["EXECUTES_CODE", "BROAD_PERMISSIONS"], EDITOR_EXTENSION: ["EXECUTES_CODE", "BROAD_PERMISSIONS"],
  BROWSER_EXTENSION: ["EXECUTES_CODE", "BROAD_PERMISSIONS"], AGENT_SKILL: ["EXECUTES_CODE"], SPECIFICATION_ONLY: [], UNKNOWN: [],
});
const SECURITY_SENSITIVE: readonly AyasTechnologyRequirement[] = ["ELEVATED_PRIVILEGE", "INSTALL_SCRIPTS", "BROAD_PERMISSIONS"];
const LOCAL_MUST_KNOW: readonly AyasTechnologyRequirement[] = [...SECURITY_SENSITIVE, "NATIVE_BINARY", "NETWORK_REQUIRED", "SENDS_DATA_EXTERNALLY"];
const HOSTED_MUST_KNOW: readonly AyasTechnologyRequirement[] = ["SECRET_OR_API_KEY", "EXTERNAL_ACCOUNT"];
const HOST_PREREQUISITE: Readonly<Partial<Record<AyasTechnologyRequirement, string>>> = Object.freeze({
  GPU: "gpu", PYTHON_RUNTIME: "python-runtime", NODE_RUNTIME: "node-runtime", CONTAINER_RUNTIME: "container-runtime", NATIVE_TOOLCHAIN: "native-toolchain",
});
const LEVEL_ORDER: readonly BlockerLevel[] = ["BLOCKED", "RESEARCH_REQUIRED", "WATCH", "SECURITY_REVIEW_REQUIRED"];

function pickClaims<K extends AyasTechnologyClaimKind>(list: readonly Classified[], kind: K): (Classified & { readonly claim: Extract<AyasTechnologyClaim, { kind: K }> })[] {
  return list.filter((c): c is Classified & { readonly claim: Extract<AyasTechnologyClaim, { kind: K }> } => c.claim.kind === kind);
}
const sameVersion = (a: string, b: string) => a === b || compareAyasTechnologyVersions(a, b) === 0;
const factStatus = (fact: AyasTechnologyFact | undefined): "SATISFIED" | "MISSING" | "UNKNOWN" => fact === "AVAILABLE" ? "SATISFIED" : fact === "UNAVAILABLE" ? "MISSING" : "UNKNOWN";

function assessCandidate(candidate: AyasTechnologyCandidate, env: AyasTechnologyWatchEnvironment, analysis: RegisterAnalysis): AyasTechnologyAssessment {
  const now = Date.parse(env.now);
  const identity = candidate.identity;
  const all = candidate.evidence.map((e) => classify(e, identity.anchors, now));
  const blockers: AyasTechnologyBlocker[] = [];
  const block = (level: BlockerLevel, code: string, reference: string | null = null) => { blockers.push({ level, code, reference }); };

  // Carried state: directive-shaped content and closed-vocabulary issues.
  if (candidate.instructionSignals.length > 0 || candidate.issues.includes("SIGNAL_UNRECOGNIZED")) block("BLOCKED", "UNTRUSTED_INSTRUCTION_CONTENT");
  for (const issue of candidate.issues) {
    const severity = ayasTechnologyIssueSeverity(issue);
    block(severity === "BLOCKING" ? "BLOCKED" : severity === "REVIEW" ? "SECURITY_REVIEW_REQUIRED" : "RESEARCH_REQUIRED", issue);
  }
  if (identity.category === "UNKNOWN") block("RESEARCH_REQUIRED", "CATEGORY_UNKNOWN", identity.categoryKey);

  // Releases: only an eligible source sets the latest version; only a verified, current one can retire an advisory.
  const releases = pickClaims(all, "RELEASE").filter((c) => !c.future);
  const eligibleReleases = releases.filter((c) => c.tierOk);
  const latestVersion = ayasTechnologyMaxVersion(eligibleReleases.map((c) => c.claim.version));
  const currentReleases = eligibleReleases.filter((c) => c.current);
  const verifiedLatestVersion = ayasTechnologyMaxVersion(uniqueSorted(currentReleases.map((c) => c.claim.version))
    .filter((version) => confirmed(currentReleases.filter((c) => sameVersion(c.claim.version, version)))));
  const withdrawals = pickClaims(all, "WITHDRAWN");
  const releaseRows = new Map<string, { version: string; claimAt: number; eligible: boolean }>();
  for (const c of releases) {
    const row = releaseRows.get(c.claim.version) ?? { version: c.claim.version, claimAt: c.claimTime, eligible: false };
    releaseRows.set(c.claim.version, { version: c.claim.version, claimAt: Math.max(row.claimAt, c.claimTime), eligible: row.eligible || c.tierOk });
  }
  const releaseList = [...releaseRows.values()].map((row) => {
    const withdrawn = withdrawals.some((c) => c.claim.version !== null && sameVersion(c.claim.version, row.version));
    const order = latestVersion === null ? null : compareAyasTechnologyVersions(row.version, latestVersion);
    const state: AyasTechnologyReleaseState = withdrawn ? "WITHDRAWN" : !row.eligible ? "UNVERIFIED" : latestVersion !== null && sameVersion(row.version, latestVersion) ? "LATEST" : order !== null && order < 0 ? "SUPERSEDED" : "UNORDERED";
    return { version: row.version, state, claimAt: new Date(row.claimAt).toISOString() };
  }).sort((a, b) => (compareAyasTechnologyVersions(b.version, a.version) ?? 0) || a.version.localeCompare(b.version)).slice(0, 16);

  // Existence and freshness. Any source can show it was seen; only adequate sources corroborate it.
  const positive = all.filter((c) => (c.claim.kind === "EXISTS" || c.claim.kind === "RELEASE") && !c.future);
  const adequatePositive = positive.filter((c) => c.tierOk && c.current);
  const existenceCorroborated = confirmed(adequatePositive);
  const latestPositive = positive.length > 0 ? Math.max(...positive.map((c) => c.claimTime)) : null;
  const unavailable = withdrawals.some((c) => (c.claim.version === null || (latestVersion !== null && sameVersion(c.claim.version, latestVersion))) && c.claimTime >= (latestPositive ?? Number.NEGATIVE_INFINITY));
  const futureEvidence = all.filter((c) => c.future).length;
  const ageDays = latestPositive === null ? null : Math.max(0, (now - latestPositive) / DAY_MS);
  let observed: Exclude<AyasTechnologyFreshnessState, "UNAVAILABLE">;
  if (ageDays === null) observed = "UNKNOWN";
  else if (ageDays > AYAS_RESEARCH_STALE_DAYS) observed = "STALE";
  else if (ageDays > AYAS_RESEARCH_FRESH_DAYS) observed = "AGING";
  else observed = confirmed(adequatePositive.filter((c) => c.fresh)) ? "CURRENTLY_VERIFIED" : "RECENTLY_OBSERVED";
  // A withdrawal from any source adds a restriction; it never answers what the positive evidence left open.
  const freshness: AyasTechnologyFreshnessState = unavailable ? "UNAVAILABLE" : observed;
  if (unavailable) block("WATCH", "TECHNOLOGY_UNAVAILABLE");
  if (observed === "UNKNOWN") block("RESEARCH_REQUIRED", "FRESHNESS_UNKNOWN");
  if (observed === "STALE") block("RESEARCH_REQUIRED", "EVIDENCE_STALE");
  if (observed === "AGING") block("RESEARCH_REQUIRED", "EVIDENCE_AGING");
  if (observed === "RECENTLY_OBSERVED") block("RESEARCH_REQUIRED", "EXISTENCE_UNCORROBORATED");
  if (futureEvidence > 0) block("RESEARCH_REQUIRED", "FUTURE_DATED_EVIDENCE");

  // Capability and gap mapping: what it would add if the claims are true, against local facts only.
  // Every claim adds to what is CLAIMED (a future-dated one included); only current, adequate, confirmed ones corroborate.
  const capabilities = pickClaims(all, "CAPABILITY");
  const claimedDomains = uniqueSorted(capabilities.flatMap((c) => c.claim.domain ? [c.claim.domain] : []));
  const unknownDomainKeys = uniqueSorted(capabilities.flatMap((c) => c.claim.unknownDomain ? [c.claim.unknownDomain] : []));
  const claimedKeys = uniqueSorted(capabilities.flatMap((c) => c.claim.capabilityKey ? [c.claim.capabilityKey] : []));
  const corroboratedDomains = claimedDomains.filter((domain) => confirmed(capabilities.filter((c) => c.tierOk && c.current && c.claim.domain === domain)));
  const uncorroboratedDomains = claimedDomains.filter((domain) => !corroboratedDomains.includes(domain));
  const installed = new Set((env.installedPackages ?? []).map((item) => ayasTechnologyPackageAnchor(item.ecosystem, item.name)).filter((anchor): anchor is string => anchor !== null));
  const sameTechnology = [
    ...identity.anchors.packages.filter((anchor) => installed.has(anchor)).map((anchor) => `package:${anchor}`),
    ...env.capabilities.filter((item) => ayasTechnologySlug(item.id) === identity.nameSlug).map((item) => `inventory:${item.type}:${item.id}`),
  ].sort();
  const coverage = (domain: AyasCapabilityCategory): AyasTechnologyCoverage => own(env.domainCoverage as Readonly<Record<string, AyasTechnologyCoverage>> | undefined, domain) ?? "UNKNOWN";
  const overlap = claimedDomains.filter((d) => coverage(d) === "PRESENT");
  const partial = claimedDomains.filter((d) => coverage(d) === "PARTIAL");
  const gaps = claimedDomains.filter((d) => coverage(d) === "ABSENT");
  const unknown = [...claimedDomains.filter((d) => coverage(d) === "UNKNOWN"), ...unknownDomainKeys];
  let relation: AyasTechnologyRelation;
  if (sameTechnology.length > 0) relation = "SAME_TECHNOLOGY";
  else if (claimedDomains.length === 0 && unknownDomainKeys.length === 0) relation = "UNMAPPED";
  else if (unknown.length > 0) relation = "UNKNOWN";
  else if (gaps.length > 0) relation = "GENUINE_GAP";
  else if (partial.length > 0) relation = "COMPLEMENTARY";
  else relation = "OVERLAP_ONLY";
  const existing = [
    ...sameTechnology,
    ...[...overlap, ...partial].map((domain) => `domain:${domain}:${coverage(domain)}`),
    ...uniqueSorted([...overlap, ...partial].flatMap((domain) => AYAS_CAPABILITY_CATEGORY_RELATED_PATHS[domain].map((modulePath) => `module:${modulePath}`))),
  ];
  if (relation === "SAME_TECHNOLOGY") block("WATCH", "EXISTING_TECHNOLOGY", sameTechnology[0]!);
  if (relation === "OVERLAP_ONLY") block("WATCH", "CAPABILITY_ALREADY_PRESENT");
  if (relation === "UNKNOWN") block("RESEARCH_REQUIRED", "CAPABILITY_COVERAGE_UNKNOWN", unknown[0]!);
  if (relation === "UNMAPPED") block("RESEARCH_REQUIRED", "CAPABILITY_UNMAPPED");
  if (uncorroboratedDomains.length > 0) block("RESEARCH_REQUIRED", "CAPABILITY_UNCORROBORATED", uncorroboratedDomains[0]!);

  // Delivery and requirements: any source may add a delivery or a requirement; only adequate, confirmed sources resolve an unknown.
  // Every dimension below keeps two answers apart: its most restrictive VALUE (any source can worsen it) and whether it is
  // ESTABLISHED (a current, adequate, confirmed claim settles it). A weak claim can never turn an open question into a settled one.
  const adequateConfirmed = (list: readonly Classified[]) => confirmed(list.filter((c) => c.tierOk && c.current));
  const deliveryClaims = pickClaims(all, "DELIVERY");
  // A source that says the delivery is UNKNOWN has not answered the question.
  const deliveryKnown = adequateConfirmed(deliveryClaims.filter((c) => c.claim.delivery !== "UNKNOWN"));
  const deliveries = uniqueSorted<AyasTechnologyDelivery>([...deliveryClaims.map((c) => c.claim.delivery), ...(deliveryKnown ? [] : ["UNKNOWN" as const])]);
  if (!deliveryKnown) block("RESEARCH_REQUIRED", "DELIVERY_UNKNOWN");
  const implied = new Set(deliveries.flatMap((delivery) => IMPLIED[delivery]));
  const requirementClaims = pickClaims(all, "REQUIREMENT");
  const requirements = Object.fromEntries(AYAS_TECHNOLOGY_REQUIREMENTS.map((requirement) => {
    if (implied.has(requirement) || requirementClaims.some((c) => c.claim.requirement === requirement && c.claim.present)) return [requirement, "PRESENT"];
    return [requirement, adequateConfirmed(requirementClaims.filter((c) => c.claim.requirement === requirement && !c.claim.present)) ? "ABSENT" : "UNKNOWN"];
  })) as Record<AyasTechnologyRequirement, AyasTechnologyRequirementState>;
  const establishedRequirements = new Set<AyasTechnologyRequirement>([
    ...deliveries.filter((delivery) => adequateConfirmed(deliveryClaims.filter((c) => c.claim.delivery === delivery))).flatMap((delivery) => IMPLIED[delivery]),
    ...AYAS_TECHNOLOGY_REQUIREMENTS.filter((requirement) => adequateConfirmed(requirementClaims.filter((c) => c.claim.requirement === requirement))),
  ]);
  const requirementOpen = (requirement: AyasTechnologyRequirement) => establishedRequirements.has(requirement) ? null
    : requirements[requirement] === "UNKNOWN" ? `${requirement}_UNKNOWN` : `${requirement}_UNCORROBORATED`;
  const locallyExecuted = deliveries.some((delivery) => delivery === "UNKNOWN" || AYAS_TECHNOLOGY_LOCAL_DELIVERIES.has(delivery)) || requirements.EXECUTES_CODE === "PRESENT";
  const hosted = deliveries.includes("HOSTED_API");

  // Cost: a price that can cost money counts from any source at any age; a zero-cost price needs a current, confirmed primary source.
  const pricing = pickClaims(all, "PRICING");
  const countedPricing = pricing.filter((c) => AYAS_TECHNOLOGY_PRICING_RANK[c.claim.model] >= 2
    || (c.tierOk && c.current && confirmed(pricing.filter((other) => other.claim.model === c.claim.model && other.tierOk && other.current))));
  const models = uniqueSorted(countedPricing.map((c) => c.claim.model));
  const model: AyasTechnologyPricingModel | "UNKNOWN" = models.length === 0 ? "UNKNOWN" : [...models].sort((a, b) => AYAS_TECHNOLOGY_PRICING_RANK[b] - AYAS_TECHNOLOGY_PRICING_RANK[a] || a.localeCompare(b))[0]!;
  const spendRequirements = uniqueSorted(pricing.flatMap((c) => c.claim.requirements));
  const costConflict = models.some((m) => AYAS_TECHNOLOGY_PRICING_RANK[m] < 2) && models.some((m) => AYAS_TECHNOLOGY_PRICING_RANK[m] >= 2);
  let costClass: AyasCostClass;
  let deliveryMismatch = false;
  switch (model) {
    case "UNKNOWN": costClass = "unknown-cost"; break;
    case "FREE_LOCAL": case "OPEN_SOURCE_SELF_HOSTED":
      // "Free to run locally" says nothing about what a hosted service costs.
      deliveryMismatch = hosted;
      costClass = hosted ? "unknown-cost" : "local-zero-cost";
      break;
    case "FREE_PUBLIC": costClass = "free-public"; break;
    case "FREE_TIER": costClass = "metered-free-tier"; break;
    case "SUBSCRIPTION": costClass = "subscription"; break;
    default: costClass = "paid";
  }
  // A card on file, credits, a listing fee or any other spend requirement is never zero cost.
  if (spendRequirements.length > 0 && (costClass === "local-zero-cost" || costClass === "free-public")) costClass = "metered-free-tier";
  const decision = evaluateAyasZeroCost(costClass);
  if (model === "UNKNOWN") block("RESEARCH_REQUIRED", "COST_UNKNOWN");
  else if (!adequateConfirmed(pricing)) block("RESEARCH_REQUIRED", "COST_UNCORROBORATED");
  if (costConflict) block("RESEARCH_REQUIRED", "COST_CLAIMS_CONFLICT");
  if (deliveryMismatch) block("RESEARCH_REQUIRED", "COST_DELIVERY_MISMATCH");

  // Licensing: restrictive or open-ended terms count from any source; permissive ones need a current, confirmed primary source.
  const licenses = pickClaims(all, "LICENSE");
  const countedLicenses = licenses.filter((c) => AYAS_TECHNOLOGY_LICENSE_RANK[c.claim.licenseClass] >= 2
    || (c.tierOk && c.current && confirmed(licenses.filter((other) => other.claim.licenseClass === c.claim.licenseClass && other.tierOk && other.current))));
  const specific = uniqueSorted(countedLicenses.map((c) => c.claim.licenseClass).filter((licenseClass) => licenseClass !== "OPEN_SOURCE_UNSPECIFIED"));
  const licenseClass: AyasTechnologyLicenseClass | "UNKNOWN" = specific.length > 0
    ? [...specific].sort((a, b) => AYAS_TECHNOLOGY_LICENSE_RANK[b] - AYAS_TECHNOLOGY_LICENSE_RANK[a] || a.localeCompare(b))[0]!
    : countedLicenses.length > 0 ? "OPEN_SOURCE_UNSPECIFIED" : "UNKNOWN";
  const licenseConflict = specific.length > 1;
  const licenseUncertainties: string[] = [];
  if (licenseClass === "UNKNOWN") { block("RESEARCH_REQUIRED", "LICENSE_UNKNOWN"); licenseUncertainties.push("LICENSE_UNKNOWN"); }
  else if (!adequateConfirmed(licenses)) { block("RESEARCH_REQUIRED", "LICENSE_UNCORROBORATED"); licenseUncertainties.push("LICENSE_UNCORROBORATED"); }
  if (licenseClass === "OPEN_SOURCE_UNSPECIFIED") { block("RESEARCH_REQUIRED", "LICENSE_UNSPECIFIED"); licenseUncertainties.push("LICENSE_UNSPECIFIED"); }
  if (licenseClass === "SOURCE_AVAILABLE" || licenseClass === "NON_COMMERCIAL") { block("RESEARCH_REQUIRED", "LICENSE_TERMS_RESTRICTIVE", licenseClass); licenseUncertainties.push("LICENSE_TERMS_RESTRICTIVE"); }
  if (licenseConflict) { block("RESEARCH_REQUIRED", "LICENSE_CONFLICT"); licenseUncertainties.push("LICENSE_CONFLICT"); }
  if (licenseClass === "PROPRIETARY_TERMS" || licenseClass === "COPYLEFT_OSS") licenseUncertainties.push("TERMS_REVIEW");

  // Provenance and maintenance.
  const provenanceClaims = pickClaims(all, "PROVENANCE");
  let provenance: AyasTechnologyProvenanceStatus | "UNKNOWN" = "UNKNOWN";
  let provenanceBasis: "CLAIM" | "REGISTERED_SOURCE" | "NONE" = "NONE";
  if (provenanceClaims.some((c) => c.claim.status === "UNVERIFIED_PUBLISHER")) { provenance = "UNVERIFIED_PUBLISHER"; provenanceBasis = "CLAIM"; }
  else if (adequateConfirmed(provenanceClaims.filter((c) => c.claim.status === "VERIFIED_PUBLISHER"))) { provenance = "VERIFIED_PUBLISHER"; provenanceBasis = "CLAIM"; }
  else if (adequatePositive.some((c) => c.verification === "REGISTERED_OFFICIAL")) { provenance = "VERIFIED_PUBLISHER"; provenanceBasis = "REGISTERED_SOURCE"; }
  const provenanceEstablished = adequateConfirmed(provenanceClaims) || adequatePositive.some((c) => c.verification === "REGISTERED_OFFICIAL");
  const maintenanceClaims = pickClaims(all, "MAINTENANCE");
  const countedMaintenance = maintenanceClaims.filter((c) => AYAS_TECHNOLOGY_MAINTENANCE_RANK[c.claim.status] >= 2
    || (c.tierOk && c.current && confirmed(maintenanceClaims.filter((other) => other.claim.status === c.claim.status && other.tierOk && other.current))));
  const maintenance: AyasTechnologyMaintenanceStatus | "UNKNOWN" = countedMaintenance.length === 0 ? "UNKNOWN"
    : [...countedMaintenance].sort((a, b) => AYAS_TECHNOLOGY_MAINTENANCE_RANK[b.claim.status] - AYAS_TECHNOLOGY_MAINTENANCE_RANK[a.claim.status])[0]!.claim.status;
  const maintenanceEstablished = adequateConfirmed(maintenanceClaims);

  // Security: advisories and compromises count from any source at any age and never expire.
  const advisories = pickClaims(all, "SECURITY_ADVISORY");
  const affectsLatest = (fixedIn: string | null) => {
    if (fixedIn === null || verifiedLatestVersion === null) return true;
    const order = compareAyasTechnologyVersions(verifiedLatestVersion, fixedIn);
    return order === null || order < 0;
  };
  const advisoryKey = (c: (typeof advisories)[number]) => c.claim.advisoryId ?? c.e.evidenceId;
  const affecting = uniqueSorted(advisories.filter((c) => affectsLatest(c.claim.fixedInVersion)).map(advisoryKey));
  const historical = uniqueSorted(advisories.map(advisoryKey)).filter((key) => !affecting.includes(key));
  const compromises = pickClaims(all, "COMPROMISE");
  const compromisedLatest = compromises.some((c) => {
    if (c.claim.version === null || verifiedLatestVersion === null) return true;
    const order = compareAyasTechnologyVersions(c.claim.version, verifiedLatestVersion);
    return order === null || order >= 0 || (latestVersion !== null && sameVersion(c.claim.version, latestVersion));
  });
  const compromised: "LATEST" | "HISTORICAL" | "NONE" = compromisedLatest ? "LATEST" : compromises.length > 0 ? "HISTORICAL" : "NONE";
  if (compromised === "LATEST") block("BLOCKED", "KNOWN_COMPROMISED");
  if (compromised === "HISTORICAL") block("SECURITY_REVIEW_REQUIRED", "PAST_COMPROMISE");
  if (affecting.length > 0) block("SECURITY_REVIEW_REQUIRED", "ACTIVE_SECURITY_ADVISORY", affecting[0]!);
  if (maintenance === "ABANDONED" || maintenance === "ARCHIVED") block("WATCH", "PROJECT_NOT_MAINTAINED", maintenance);
  if (provenance === "UNVERIFIED_PUBLISHER") block("SECURITY_REVIEW_REQUIRED", "PROVENANCE_UNVERIFIED");
  for (const requirement of SECURITY_SENSITIVE) if (requirements[requirement] === "PRESENT") block("SECURITY_REVIEW_REQUIRED", `${requirement}_PRESENT`);
  const unknowns: string[] = [];
  if (!deliveryKnown) unknowns.push("DELIVERY");
  if (locallyExecuted) {
    if (!provenanceEstablished) { block("RESEARCH_REQUIRED", provenance === "UNKNOWN" ? "PROVENANCE_UNKNOWN" : "PROVENANCE_UNCORROBORATED"); unknowns.push("PROVENANCE"); }
    if (!maintenanceEstablished) { block("RESEARCH_REQUIRED", maintenance === "UNKNOWN" ? "MAINTENANCE_UNKNOWN" : "MAINTENANCE_UNCORROBORATED"); unknowns.push("MAINTENANCE"); }
    for (const requirement of LOCAL_MUST_KNOW) { const open = requirementOpen(requirement); if (open) { block("RESEARCH_REQUIRED", open); unknowns.push(requirement); } }
    if (identity.anchors.packages.length === 0 && identity.anchors.repositories.length === 0) { block("RESEARCH_REQUIRED", "PACKAGE_IDENTITY_UNKNOWN"); unknowns.push("PACKAGE_IDENTITY"); }
  }
  if (hosted) for (const requirement of HOSTED_MUST_KNOW) { const open = requirementOpen(requirement); if (open) { block("RESEARCH_REQUIRED", open); unknowns.push(requirement); } }
  const identityConflicts = [...(analysis.identityConflicts.get(candidate.technologyKey) ?? [])].sort();
  // Either record of a conflicting pair may be the impersonation: both are held, whatever arrived first.
  if (identityConflicts.length > 0) block("SECURITY_REVIEW_REQUIRED", "IDENTITY_CONFLICT_WITH_EXISTING");
  const concerns = uniqueSorted([
    ...(["NATIVE_BINARY", "EXECUTES_CODE", "NETWORK_REQUIRED", "SENDS_DATA_EXTERNALLY", "SECRET_OR_API_KEY", "EXTERNAL_ACCOUNT", ...SECURITY_SENSITIVE] as const).filter((r) => requirements[r] === "PRESENT"),
    ...(affecting.length > 0 ? ["ACTIVE_SECURITY_ADVISORY"] : []), ...(historical.length > 0 ? ["HISTORICAL_SECURITY_ADVISORY"] : []),
    ...(compromised !== "NONE" ? [`COMPROMISE_${compromised}`] : []), ...(provenance === "UNVERIFIED_PUBLISHER" ? ["PROVENANCE_UNVERIFIED"] : []),
    ...(maintenance === "ABANDONED" || maintenance === "ARCHIVED" ? ["PROJECT_NOT_MAINTAINED"] : []), ...(identityConflicts.length > 0 ? ["IDENTITY_CONFLICT"] : []),
    ...(candidate.issues.includes("SECURITY_EVIDENCE_UNREADABLE") ? ["SECURITY_EVIDENCE_UNREADABLE"] : []),
  ]);

  // Prerequisites: resolved against environment facts only; nothing is installed, probed or enabled.
  const accountKey = identity.vendor ?? identity.nameSlug;
  const prerequisites: AyasTechnologyAssessment["prerequisites"][number][] = [];
  for (const requirement of AYAS_TECHNOLOGY_REQUIREMENTS) {
    if (requirements[requirement] !== "PRESENT") continue;
    const hostKey = HOST_PREREQUISITE[requirement];
    if (hostKey) prerequisites.push({ requirement, kind: "HOST_BINARY", key: hostKey, status: factStatus(own(env.hostBinaries, hostKey)) });
    if (requirement === "EXTERNAL_ACCOUNT" || requirement === "SECRET_OR_API_KEY") prerequisites.push({ requirement, kind: "EXTERNAL_ACCOUNT", key: accountKey, status: factStatus(own(env.externalAccounts, accountKey)) });
  }
  if (hosted) prerequisites.push({ requirement: "NETWORK_REQUIRED", kind: "EXTERNAL_SERVICE", key: accountKey, status: "UNKNOWN" });
  prerequisites.sort((a, b) => `${a.kind}:${a.key}:${a.requirement}`.localeCompare(`${b.kind}:${b.key}:${b.requirement}`));

  // Suppression and readiness.
  const materialFingerprint = computeAyasTechnologyMaterialFingerprint(candidate);
  const watchSuppression = ayasTechnologyWatchSuppression(candidate.watch, materialFingerprint, now);
  const duplicateOf = analysis.duplicateOf.get(candidate.technologyKey) ?? null;
  const suppression: AyasTechnologyAssessment["suppression"] = duplicateOf
    ? { state: "DUPLICATE", code: "DUPLICATE_OF_CANONICAL", reference: duplicateOf }
    : watchSuppression.code ? { state: "COOLDOWN", code: watchSuppression.code, reference: null } : { state: "NONE", code: null, reference: null };
  const ordered = blockers
    .filter((item, index, list) => list.findIndex((other) => other.level === item.level && other.code === item.code && other.reference === item.reference) === index)
    .sort((a, b) => LEVEL_ORDER.indexOf(a.level) - LEVEL_ORDER.indexOf(b.level) || a.code.localeCompare(b.code) || String(a.reference).localeCompare(String(b.reference)));
  const readiness: AyasTechnologyReadiness = ordered.length > 0 ? ordered[0]!.level : "HANDOFF_ELIGIBLE";
  // A blocked record's input is corrupt or instruction-shaped: its cost answer never claims zero cost or an allowed decision.
  const shownCost = readiness === "BLOCKED" && decision.allowed ? { costClass: "unknown-cost" as const, decision: evaluateAyasZeroCost("unknown-cost") } : { costClass, decision };
  const recommendation: AyasTechnologyAssessment["recommendation"] = readiness === "BLOCKED" ? "BLOCKED" : suppression.state === "NONE" ? readiness : suppression.state;
  const handoffEligible = readiness === "HANDOFF_ELIGIBLE" && suppression.state === "NONE";
  const next: AyasTechnologyAssessment["next"] = recommendation === "HANDOFF_ELIGIBLE" ? "STAGE13_HANDOFF" : recommendation === "RESEARCH_REQUIRED" ? "RESEARCH"
    : recommendation === "WATCH" ? "WATCH" : recommendation === "SECURITY_REVIEW_REQUIRED" ? "SECURITY_REVIEW" : "NONE";
  const byEpistemicClass: Record<string, number> = {};
  for (const c of all) byEpistemicClass[c.epistemic] = (byEpistemicClass[c.epistemic] ?? 0) + 1;

  const assessment: AyasTechnologyAssessment = Object.freeze({
    schemaVersion: AYAS_TECHNOLOGY_SCHEMA_VERSION,
    technologyKey: candidate.technologyKey,
    assessedAt: new Date(now).toISOString(),
    readiness,
    recommendation,
    suppression,
    primaryReason: ordered.length > 0 ? ordered[0]!.code : suppression.code ?? "HANDOFF_ELIGIBLE",
    blockers: Object.freeze(ordered),
    surfaceable: suppression.state === "NONE",
    handoffEligible,
    materialFingerprint,
    identity: { displayName: identity.displayName, category: identity.category, categoryKey: identity.categoryKey, domainKey: identity.domainKey, vendor: identity.vendor, anchors: identity.anchors },
    evidence: {
      total: all.length, adequate: all.filter((c) => c.tierOk && c.current).length, byEpistemicClass, independentSources: new Set(all.map((c) => c.independenceKey)).size,
      existenceCorroborated, registeredOfficial: all.filter((c) => c.verification === "REGISTERED_OFFICIAL").length,
      verified: all.filter((c) => c.verification !== "DECLARED").length, compacted: candidate.compaction.removed,
    },
    freshness: {
      state: freshness, latestClaimAt: latestPositive === null ? null : new Date(latestPositive).toISOString(), ageDays: ageDays === null ? null : Math.round(ageDays * 100) / 100,
      futureEvidence, latestVersion, verifiedLatestVersion, releases: releaseList,
    },
    capability: {
      claimedDomains, corroboratedDomains, uncorroboratedDomains, unknownDomainKeys, claimedKeys, relation, existing,
      overlap, partial, gaps, unknown, replacementPossible: relation === "OVERLAP_ONLY",
    },
    compatibility: { deliveries, deliveryKnown, locallyExecuted, requirements },
    cost: { model, spendRequirements, costClass: shownCost.costClass, decision: shownCost.decision, conflict: costConflict, deliveryMismatch },
    licensing: { licenseClass, identifiers: uniqueSorted(countedLicenses.flatMap((c) => c.claim.identifier ? [c.claim.identifier] : [])), conflict: licenseConflict, uncertainties: uniqueSorted(licenseUncertainties) },
    security: { provenance, provenanceBasis, maintenance, advisoriesAffectingLatest: affecting.length, historicalAdvisories: historical.length, compromised, concerns, unknowns: uniqueSorted(unknowns) },
    prerequisites,
    novelty: {
      watchState: candidate.watch.state, materialChange: watchSuppression.materialChange, reopenCount: candidate.watch.reopenCount, surfaceCount: candidate.watch.surfaceCount,
      duplicateOf, duplicates: [...(analysis.duplicates.get(candidate.technologyKey) ?? [])].sort(), sourceOverlapWith: [...(analysis.sourceOverlap.get(candidate.technologyKey) ?? [])].sort(), identityConflicts,
    },
    next,
    executionAuthority: "NONE",
    authority: "NONE",
    mayExecute: false,
    mayInstall: false,
    maySpend: false,
    mayPublish: false,
    mayApprove: false,
    mayEnable: false,
    mayDeploy: false,
    mayModifyPolicy: false,
  });
  PRODUCED_ASSESSMENTS.add(assessment);
  return assessment;
}

export function assessAyasTechnologyRegister(register: AyasTechnologyRegister, env: AyasTechnologyWatchEnvironment): readonly AyasTechnologyAssessment[] {
  assertAyasTechnologyEnvironment(env);
  const checked = assertAyasTechnologyRegister(register);
  const analysis = analyzeRegister(checked);
  return Object.freeze(checked.candidates.map((candidate) => assessCandidate(candidate, env, analysis)));
}

export function assessAyasTechnologyCandidate(technologyKey: string, register: AyasTechnologyRegister, env: AyasTechnologyWatchEnvironment): AyasTechnologyAssessment {
  const found = assessAyasTechnologyRegister(register, env).find((item) => item.technologyKey === technologyKey);
  if (!found) throw new AyasTechnologyError("AYAS_TECHNOLOGY_REGISTER_INVALID", "unknown technology");
  return found;
}

// ---------------------------------------------------------------- watch transitions

type TransitionKind = "SURFACE" | "HANDOFF" | "DISMISS";

/**
 * A transition records ATTENTION: that the owner was shown a technology, that
 * it was handed to Stage 13, or that the owner dismissed it. It grants nothing.
 * The assessment must be current (same material fingerprint), time only moves
 * forward, and surfacing or handing off is refused while the watch suppresses it.
 * A hand-off also needs the current environment: its eligibility depends on
 * time and environment facts, not only on the register.
 */
function transition(register: AyasTechnologyRegister, assessment: AyasTechnologyAssessment, at: string, kind: TransitionKind, opportunityId?: string, env?: AyasTechnologyWatchEnvironment): AyasTechnologyRegister {
  const refuse = (reason: string): never => { throw new AyasTechnologyError("AYAS_TECHNOLOGY_TRANSITION_REFUSED", reason); };
  const checked = assertAyasTechnologyRegister(register);
  if (!isAyasTechnologyAssessmentProduced(assessment)) return refuse("an assessment produced by this engine is required");
  const candidate = checked.candidates.find((c) => c.technologyKey === assessment.technologyKey) ?? refuse("unknown technology");
  const time = ayasTechnologyIso(at) ?? refuse("transition time is not an ISO timestamp");
  const fingerprint = computeAyasTechnologyMaterialFingerprint(candidate);
  if (assessment.materialFingerprint !== fingerprint) refuse("the assessment is stale; re-assess first");
  // The register may have changed around an unchanged record: a record that arrived since can make it a duplicate or an identity conflict.
  const relations = ayasTechnologyRegisterRelations(checked, candidate.technologyKey);
  if (relations.duplicateOf !== assessment.novelty.duplicateOf || ayasTechnologyCanonicalJson(relations.identityConflicts) !== ayasTechnologyCanonicalJson(assessment.novelty.identityConflicts)) {
    refuse("the register changed since the assessment; re-assess first");
  }
  const watch = candidate.watch;
  const last = watch.history.at(-1);
  if (last && time < last.at) refuse("transition time precedes history");
  const suppression = ayasTechnologyWatchSuppression(watch, fingerprint, Date.parse(time));
  if (kind === "SURFACE" && (!assessment.surfaceable || assessment.suppression.state !== "NONE" || suppression.code !== null)) refuse("the technology is suppressed");
  if (kind === "HANDOFF") {
    if (!assessment.handoffEligible || assessment.readiness !== "HANDOFF_ELIGIBLE" || assessment.suppression.state !== "NONE" || suppression.code !== null) refuse("the technology is not eligible for hand-off");
    if (relations.identityConflicts.length > 0 || relations.duplicateOf !== null) refuse("an unresolved identity conflict or duplicate is never handed off");
    if (typeof opportunityId !== "string" || !OPPORTUNITY_ID.test(opportunityId)) refuse("hand-off must name the Stage 13 opportunity");
    // An assessment made earlier or under other facts is a request, not permission: eligibility is re-derived at the hand-off moment.
    if (!isAyasTechnologyPlainObject(env)) return refuse("recording a hand-off needs the current environment");
    assertAyasTechnologyEnvironment(env);
    if (ayasTechnologyIso(env.now) !== time) refuse("the environment must describe the moment of the hand-off");
    if (!assessCandidate(candidate, env, analyzeRegister(checked)).handoffEligible) refuse("the technology is not eligible for hand-off now; re-assess first");
  }
  const reopening = kind !== "DISMISS" && watch.state !== "WATCHING" && last !== undefined && last.fingerprint !== fingerprint;
  if (reopening && watch.reopenCount >= AYAS_TECHNOLOGY_REOPEN_LIMIT) refuse("reopen limit reached");
  const state: AyasTechnologyWatchState = kind === "SURFACE" ? "SURFACED" : kind === "HANDOFF" ? "HANDED_OFF" : "DISMISSED";
  const reasonCode = kind === "DISMISS" ? "DISMISSED_BY_OWNER" : `${reopening ? "REOPENED_AND_" : ""}${kind === "SURFACE" ? "SURFACED" : "HANDED_OFF"}`;
  const history = [...watch.history, { at: time, to: state as Exclude<AyasTechnologyWatchState, "WATCHING">, reasonCode, fingerprint }];
  const overflow = Math.max(0, history.length - AYAS_TECHNOLOGY_LIMITS.history);
  const next: AyasTechnologyWatchRecord = {
    state,
    surfaced: kind === "SURFACE" ? { at: time, fingerprint, until: ayasTechnologyAddDays(time, AYAS_TECHNOLOGY_COOLDOWN_DAYS) } : watch.surfaced,
    surfaceCount: kind === "SURFACE" ? (watch.surfaced && watch.surfaced.fingerprint === fingerprint ? watch.surfaceCount + 1 : 1) : watch.surfaceCount,
    handoff: kind === "HANDOFF" ? { at: time, fingerprint, opportunityId: opportunityId! } : watch.handoff,
    dismissed: kind === "DISMISS" ? { at: time, fingerprint } : watch.dismissed,
    reopenCount: watch.reopenCount + (reopening ? 1 : 0),
    history: history.slice(overflow),
    historyCompacted: watch.historyCompacted + overflow,
  };
  return updateAyasTechnologyWatchRecord(checked, candidate.technologyKey, next);
}

/** The owner was shown this technology; it will not be surfaced again for the cooldown unless a material fact changes. */
export function markAyasTechnologySurfaced(register: AyasTechnologyRegister, assessment: AyasTechnologyAssessment, at: string): AyasTechnologyRegister {
  return transition(register, assessment, at, "SURFACE");
}

/**
 * The technology was given to Stage 13 as `opportunityId`; the same facts are never handed off twice. `env` is the
 * environment at `handoff.at` (its `now`): the technology must still be eligible there, whatever the assessment says.
 */
export function recordAyasTechnologyHandoff(register: AyasTechnologyRegister, assessment: AyasTechnologyAssessment, handoff: { readonly opportunityId: string; readonly at: string }, env: AyasTechnologyWatchEnvironment): AyasTechnologyRegister {
  if (!isAyasTechnologyPlainObject(handoff)) throw new AyasTechnologyError("AYAS_TECHNOLOGY_TRANSITION_REFUSED", "hand-off record is malformed");
  return transition(register, assessment, handoff.at, "HANDOFF", handoff.opportunityId, env);
}

/** The owner is not interested in these facts; only a material change brings the technology back. It suppresses; it never authorizes. */
export function dismissAyasTechnologyCandidate(register: AyasTechnologyRegister, assessment: AyasTechnologyAssessment, at: string): AyasTechnologyRegister {
  return transition(register, assessment, at, "DISMISS");
}
