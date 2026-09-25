import crypto from "node:crypto";

import { isAyasCapabilityCategory, type AyasCapabilityCategory } from "../../brain/autonomy/AyasCapabilityTaxonomy";
import { neutralizeAyasUntrustedText } from "../../brain/autonomy/AyasDeepAnalysis";
import { detectAyasResearchInstructionSignals, type AyasResearchInstructionSignal } from "../../brain/autonomy/AyasResearchImprovementLoop";
import { normalizeAyasResearchUrl } from "../../brain/autonomy/AyasResearchNoveltyStore";

/**
 * Stage 14 — the ONE canonical representation of a discovered technology
 * (model, provider, MCP server, protocol, tool, library, skill, technique or a
 * category nobody has named yet) and of everything AYAS has been told about it.
 *
 * A candidate is identity + a bounded, append-only list of source CLAIMS +
 * a bounded watch record. Nothing about readiness, freshness, cost or risk is
 * stored: it is derived at assessment time (`AyasTechnologyWatch.ts`), so a
 * round trip can never carry a stale or forged verdict. External text is DATA:
 * it is neutralized, bounded and scanned for directives; no field is ever read
 * as a command, path, approval or authority, and every record carries
 * `authority: "NONE"`. This module is pure: no I/O, no process, no network.
 *
 * PRESENT + MALFORMED is never ABSENT. An absent field takes its documented
 * default; a present value of the wrong shape or outside its closed vocabulary
 * is a closed-vocabulary issue that blocks, and a restrictive claim with a
 * malformed value is kept at its most restrictive value rather than dropped.
 */
export const AYAS_TECHNOLOGY_SCHEMA_VERSION = "1" as const;

export const AYAS_TECHNOLOGY_LIMITS = Object.freeze({
  candidates: 400, observationEvidence: 24, candidateEvidence: 48, anchorsPerKind: 4, history: 16,
  nameText: 120, statementText: 480, urlLength: 400, scanText: 65_536,
});
export const AYAS_TECHNOLOGY_COOLDOWN_DAYS = 30;
export const AYAS_TECHNOLOGY_REOPEN_LIMIT = 8;
export const AYAS_TECHNOLOGY_SURFACE_LIMIT = 6;

/** Which code path produced an observation. Set by the producer, never parsed from the observation. */
export const AYAS_TECHNOLOGY_ORIGINS = ["RESEARCH_FINDING", "OPERATOR_ENTRY", "AYAS_SUGGESTION"] as const;
export type AyasTechnologyOrigin = typeof AYAS_TECHNOLOGY_ORIGINS[number];

/** What the technology is. There is deliberately no harmless OTHER bucket: an unrecognized category is UNKNOWN and needs research. */
export const AYAS_TECHNOLOGY_CATEGORIES = [
  "MODEL", "MODEL_PROVIDER_API", "LOCAL_MODEL_RUNTIME", "MCP_SERVER", "AGENT_PROTOCOL", "DEVELOPER_TOOL", "LIBRARY_FRAMEWORK", "SKILL",
  "RESEARCH_TECHNIQUE", "MEDIA_GENERATION", "SPEECH_AUDIO", "VIDEO", "IMAGE", "RETRIEVAL_MEMORY", "EVALUATION_OBSERVABILITY",
  "AUTOMATION_INTEGRATION", "SECURITY_SAFETY", "UNKNOWN",
] as const;
export type AyasTechnologyCategory = typeof AYAS_TECHNOLOGY_CATEGORIES[number];

/** How AYAS would consume it. This drives the supply-chain posture, so an unrecognized value blocks. */
export const AYAS_TECHNOLOGY_DELIVERIES = [
  "HOSTED_API", "PACKAGE_LIBRARY", "MODEL_WEIGHTS", "HOST_BINARY", "CONTAINER_IMAGE", "MCP_SERVER", "EDITOR_EXTENSION", "BROWSER_EXTENSION",
  "AGENT_SKILL", "SPECIFICATION_ONLY", "UNKNOWN",
] as const;
export type AyasTechnologyDelivery = typeof AYAS_TECHNOLOGY_DELIVERIES[number];
/** Deliveries whose code or artifacts would run on the owner's machine. */
export const AYAS_TECHNOLOGY_LOCAL_DELIVERIES: ReadonlySet<AyasTechnologyDelivery> = new Set([
  "PACKAGE_LIBRARY", "MODEL_WEIGHTS", "HOST_BINARY", "CONTAINER_IMAGE", "MCP_SERVER", "EDITOR_EXTENSION", "BROWSER_EXTENSION", "AGENT_SKILL",
]);

export const AYAS_TECHNOLOGY_SOURCE_CLASSES = [
  "OFFICIAL_DOCUMENTATION", "OFFICIAL_RELEASE_NOTES", "SOURCE_REPOSITORY", "PACKAGE_REGISTRY", "MODEL_CARD", "SECURITY_ADVISORY_DATABASE",
  "RESEARCH_PAPER", "NEWS_ARTICLE", "TECHNICAL_BLOG",
  "VENDOR_MARKETING", "FORUM_POST", "ISSUE_TRACKER", "SOCIAL_MEDIA", "AGGREGATOR", "UNKNOWN_SOURCE",
] as const;
export type AyasTechnologySourceClass = typeof AYAS_TECHNOLOGY_SOURCE_CLASSES[number];
export type AyasTechnologySourceTier = "PRIMARY" | "SECONDARY" | "WEAK";
/** Vendor marketing is never better than WEAK: it can add a restriction, never resolve an uncertainty. */
export const AYAS_TECHNOLOGY_SOURCE_TIER: Readonly<Record<AyasTechnologySourceClass, AyasTechnologySourceTier>> = Object.freeze({
  OFFICIAL_DOCUMENTATION: "PRIMARY", OFFICIAL_RELEASE_NOTES: "PRIMARY", SOURCE_REPOSITORY: "PRIMARY", PACKAGE_REGISTRY: "PRIMARY", MODEL_CARD: "PRIMARY",
  SECURITY_ADVISORY_DATABASE: "PRIMARY", RESEARCH_PAPER: "SECONDARY", NEWS_ARTICLE: "SECONDARY", TECHNICAL_BLOG: "SECONDARY",
  VENDOR_MARKETING: "WEAK", FORUM_POST: "WEAK", ISSUE_TRACKER: "WEAK", SOCIAL_MEDIA: "WEAK", AGGREGATOR: "WEAK", UNKNOWN_SOURCE: "WEAK",
});

/** Whether the producer read the source directly or summarized it with a model. An undeclared extraction is treated like a summary. */
export const AYAS_TECHNOLOGY_EXTRACTIONS = ["DIRECT_SOURCE", "MODEL_SUMMARY", "UNDECLARED"] as const;
export type AyasTechnologyExtraction = typeof AYAS_TECHNOLOGY_EXTRACTIONS[number];

export const AYAS_TECHNOLOGY_CLAIM_KINDS = [
  "EXISTS", "RELEASE", "WITHDRAWN", "CAPABILITY", "DELIVERY", "REQUIREMENT", "PRICING", "LICENSE", "PROVENANCE", "MAINTENANCE", "SECURITY_ADVISORY", "COMPROMISE",
] as const;
export type AyasTechnologyClaimKind = typeof AYAS_TECHNOLOGY_CLAIM_KINDS[number];

export const AYAS_TECHNOLOGY_PRICING_MODELS = ["FREE_LOCAL", "OPEN_SOURCE_SELF_HOSTED", "FREE_PUBLIC", "FREE_TIER", "USAGE_PRICED", "SUBSCRIPTION", "PAID"] as const;
export type AyasTechnologyPricingModel = typeof AYAS_TECHNOLOGY_PRICING_MODELS[number];
/** Ordered by how much it can cost. Rank 2 and above is never zero cost. */
export const AYAS_TECHNOLOGY_PRICING_RANK: Readonly<Record<AyasTechnologyPricingModel, number>> = Object.freeze({
  FREE_LOCAL: 0, OPEN_SOURCE_SELF_HOSTED: 0, FREE_PUBLIC: 1, FREE_TIER: 2, USAGE_PRICED: 3, SUBSCRIPTION: 4, PAID: 5,
});
export const AYAS_TECHNOLOGY_SPEND_REQUIREMENTS = ["CREDIT_CARD", "CREDITS", "PAID_PLAN_REQUIRED", "LISTING_FEE", "CONNECTS", "ADS_PURCHASE", "TRIAL_EXPIRES"] as const;
export type AyasTechnologySpendRequirement = typeof AYAS_TECHNOLOGY_SPEND_REQUIREMENTS[number];

export const AYAS_TECHNOLOGY_REQUIREMENTS = [
  "NETWORK_REQUIRED", "SENDS_DATA_EXTERNALLY", "SECRET_OR_API_KEY", "EXTERNAL_ACCOUNT", "ELEVATED_PRIVILEGE", "INSTALL_SCRIPTS", "NATIVE_BINARY",
  "EXECUTES_CODE", "BROAD_PERMISSIONS", "GPU", "PYTHON_RUNTIME", "NODE_RUNTIME", "CONTAINER_RUNTIME", "NATIVE_TOOLCHAIN", "OS_SPECIFIC",
] as const;
export type AyasTechnologyRequirement = typeof AYAS_TECHNOLOGY_REQUIREMENTS[number];

export const AYAS_TECHNOLOGY_LICENSE_CLASSES = ["PERMISSIVE_OSS", "COPYLEFT_OSS", "OPEN_SOURCE_UNSPECIFIED", "PROPRIETARY_TERMS", "SOURCE_AVAILABLE", "NON_COMMERCIAL"] as const;
export type AyasTechnologyLicenseClass = typeof AYAS_TECHNOLOGY_LICENSE_CLASSES[number];
/** Rank 2 and above restricts, or leaves the terms open. */
export const AYAS_TECHNOLOGY_LICENSE_RANK: Readonly<Record<AyasTechnologyLicenseClass, number>> = Object.freeze({
  PERMISSIVE_OSS: 0, COPYLEFT_OSS: 1, OPEN_SOURCE_UNSPECIFIED: 2, PROPRIETARY_TERMS: 2, SOURCE_AVAILABLE: 3, NON_COMMERCIAL: 4,
});
export const AYAS_TECHNOLOGY_PROVENANCE = ["VERIFIED_PUBLISHER", "UNVERIFIED_PUBLISHER"] as const;
export type AyasTechnologyProvenanceStatus = typeof AYAS_TECHNOLOGY_PROVENANCE[number];
export const AYAS_TECHNOLOGY_MAINTENANCE = ["ACTIVE", "SLOW", "ABANDONED", "ARCHIVED"] as const;
export type AyasTechnologyMaintenanceStatus = typeof AYAS_TECHNOLOGY_MAINTENANCE[number];
export const AYAS_TECHNOLOGY_MAINTENANCE_RANK: Readonly<Record<AyasTechnologyMaintenanceStatus, number>> = Object.freeze({ ACTIVE: 0, SLOW: 1, ABANDONED: 2, ARCHIVED: 3 });
export const AYAS_TECHNOLOGY_ADVISORY_SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL", "UNKNOWN"] as const;
export type AyasTechnologyAdvisorySeverity = typeof AYAS_TECHNOLOGY_ADVISORY_SEVERITIES[number];
export const AYAS_TECHNOLOGY_PACKAGE_ECOSYSTEMS = ["NPM", "PYPI", "CRATES", "GO", "MAVEN", "NUGET", "RUBYGEMS", "CONTAINER", "MODEL_HUB"] as const;
export type AyasTechnologyPackageEcosystem = typeof AYAS_TECHNOLOGY_PACKAGE_ECOSYSTEMS[number];
/** Registries whose pages can vouch for a package anchor: the page must be on the ecosystem's registry and name the package. */
export const AYAS_TECHNOLOGY_PACKAGE_REGISTRY_HOSTS: Readonly<Record<AyasTechnologyPackageEcosystem, readonly string[]>> = Object.freeze({
  NPM: ["npmjs.com", "registry.npmjs.org"], PYPI: ["pypi.org"], CRATES: ["crates.io"], GO: ["pkg.go.dev"], MAVEN: ["central.sonatype.com", "mvnrepository.com"],
  NUGET: ["nuget.org"], RUBYGEMS: ["rubygems.org"], CONTAINER: ["hub.docker.com"], MODEL_HUB: ["huggingface.co"],
});

export const AYAS_TECHNOLOGY_WATCH_STATES = ["WATCHING", "SURFACED", "HANDED_OFF", "DISMISSED"] as const;
export type AyasTechnologyWatchState = typeof AYAS_TECHNOLOGY_WATCH_STATES[number];

/**
 * The closed issue vocabulary with a fixed severity. BLOCKING: something that
 * may carry safety-relevant information was malformed, truncated or dropped,
 * so judging what remains would fail open. REVIEW: an identity concern for a
 * security review. RESEARCH: representable but not yet understood. A carried
 * code outside the vocabulary is itself BLOCKING.
 */
export const AYAS_TECHNOLOGY_ISSUE_SEVERITY = Object.freeze({
  UNKNOWN_FIELD: "BLOCKING",
  IDENTITY_MALFORMED: "BLOCKING",
  PACKAGE_INVALID: "BLOCKING",
  URL_INVALID: "BLOCKING",
  ANCHORS_TRUNCATED: "BLOCKING",
  EVIDENCE_MALFORMED: "BLOCKING",
  EVIDENCE_ITEM_MALFORMED: "BLOCKING",
  EVIDENCE_TRUNCATED: "BLOCKING",
  EVIDENCE_CAPACITY_REACHED: "BLOCKING",
  SOURCE_MALFORMED: "BLOCKING",
  SOURCE_URL_INVALID: "BLOCKING",
  SOURCE_CLASS_INVALID: "BLOCKING",
  EXTRACTION_INVALID: "BLOCKING",
  TIME_MALFORMED: "BLOCKING",
  CLAIM_MALFORMED: "BLOCKING",
  CLAIM_KIND_INVALID: "BLOCKING",
  CLAIM_VALUE_INVALID: "BLOCKING",
  TEXT_MALFORMED: "BLOCKING",
  TEXT_OVERSIZED: "BLOCKING",
  EVIDENCE_FIELD_INVALID: "BLOCKING",
  ISSUE_UNRECOGNIZED: "BLOCKING",
  SIGNAL_UNRECOGNIZED: "BLOCKING",
  /** A claim that looked security-relevant (advisory, compromise, withdrawal) was dropped: the security answer must say so, not look clean. */
  SECURITY_EVIDENCE_UNREADABLE: "BLOCKING",
  IDENTITY_ANCHOR_CONFLICT: "REVIEW",
  IDENTITY_AMBIGUOUS: "REVIEW",
  /** Derived for BOTH records from the current register at assessment time; still accepted when carried by an older register, where it can only add review. */
  IDENTITY_CONFLICT_WITH_EXISTING: "REVIEW",
  CATEGORY_UNRECOGNIZED: "RESEARCH",
  CATEGORY_CONFLICT: "RESEARCH",
  CAPABILITY_DOMAIN_UNRECOGNIZED: "RESEARCH",
} as const);
export type AyasTechnologyIssue = keyof typeof AYAS_TECHNOLOGY_ISSUE_SEVERITY;
export type AyasTechnologyIssueSeverity = typeof AYAS_TECHNOLOGY_ISSUE_SEVERITY[AyasTechnologyIssue];
type Issues = AyasTechnologyIssue[];

const isIssue = (value: unknown): value is AyasTechnologyIssue => typeof value === "string" && Object.prototype.hasOwnProperty.call(AYAS_TECHNOLOGY_ISSUE_SEVERITY, value);
/** Fail closed: a code outside the closed vocabulary counts as blocking. */
export function ayasTechnologyIssueSeverity(code: string): AyasTechnologyIssueSeverity {
  return isIssue(code) ? AYAS_TECHNOLOGY_ISSUE_SEVERITY[code] : "BLOCKING";
}
export function isAyasTechnologyBlockingIssue(code: string): boolean {
  return ayasTechnologyIssueSeverity(code) === "BLOCKING";
}
const INSTRUCTION_SIGNALS: readonly AyasResearchInstructionSignal[] = ["OVERRIDE_RULES", "APPROVAL_DIRECTIVE", "COMMAND_DIRECTIVE", "FILE_EDIT_DIRECTIVE", "PATH_REFERENCE", "TOOL_DIRECTIVE"];

export type AyasTechnologyClaim =
  | { readonly kind: "EXISTS" }
  | { readonly kind: "RELEASE"; readonly version: string; readonly releasedAt: string | null }
  | { readonly kind: "WITHDRAWN"; readonly version: string | null }
  | { readonly kind: "CAPABILITY"; readonly domain: AyasCapabilityCategory | null; readonly unknownDomain: string | null; readonly capabilityKey: string | null }
  | { readonly kind: "DELIVERY"; readonly delivery: AyasTechnologyDelivery }
  | { readonly kind: "REQUIREMENT"; readonly requirement: AyasTechnologyRequirement; readonly present: boolean }
  | { readonly kind: "PRICING"; readonly model: AyasTechnologyPricingModel; readonly requirements: readonly AyasTechnologySpendRequirement[] }
  | { readonly kind: "LICENSE"; readonly licenseClass: AyasTechnologyLicenseClass; readonly identifier: string | null }
  | { readonly kind: "PROVENANCE"; readonly status: AyasTechnologyProvenanceStatus }
  | { readonly kind: "MAINTENANCE"; readonly status: AyasTechnologyMaintenanceStatus }
  | { readonly kind: "SECURITY_ADVISORY"; readonly severity: AyasTechnologyAdvisorySeverity; readonly advisoryId: string | null; readonly fixedInVersion: string | null }
  | { readonly kind: "COMPROMISE"; readonly version: string | null };

export interface AyasTechnologySource {
  /** Normalized http(s) URL. A reference only: never fetched, resolved as a path or executed here. */
  readonly url: string;
  readonly sourceClass: AyasTechnologySourceClass;
  readonly publishedAt: string | null;
}

export interface AyasTechnologyEvidence {
  readonly evidenceId: string;
  readonly origin: AyasTechnologyOrigin;
  readonly extraction: AyasTechnologyExtraction;
  readonly source: AyasTechnologySource;
  readonly claim: AyasTechnologyClaim;
  /** Neutralized, bounded DATA. */
  readonly statement: string;
  readonly researchFindingId: string | null;
  /** Temporal history of the claim: when AYAS first and last saw this exact claim from this exact source. */
  readonly firstObservedAt: string;
  readonly lastObservedAt: string;
}

export interface AyasTechnologyAnchors {
  /** `<vendor-slug or ->/<name-slug>`: weak, only ever matched exactly. */
  readonly names: readonly string[];
  /** `<ecosystem>:<name>`: strong. */
  readonly packages: readonly string[];
  /** `<host>/<owner>/<repo>`: strong. */
  readonly repositories: readonly string[];
  /** Official hostnames: they can vouch for a source, never merge two candidates. */
  readonly hosts: readonly string[];
}

export interface AyasTechnologyIdentity {
  readonly displayName: string;
  readonly nameSlug: string;
  readonly vendor: string | null;
  readonly category: AyasTechnologyCategory;
  /** The recorded key of an unrecognized category: representable, never folded into a known one. */
  readonly categoryKey: string | null;
  /** Optional open-ended namespaced domain key for technologies no category describes yet. */
  readonly domainKey: string | null;
  readonly anchors: AyasTechnologyAnchors;
}

export interface AyasTechnologyWatchEntry { readonly at: string; readonly to: Exclude<AyasTechnologyWatchState, "WATCHING">; readonly reasonCode: string; readonly fingerprint: string }
export interface AyasTechnologyWatchRecord {
  readonly state: AyasTechnologyWatchState;
  readonly surfaced: { readonly at: string; readonly fingerprint: string; readonly until: string } | null;
  readonly surfaceCount: number;
  readonly handoff: { readonly at: string; readonly fingerprint: string; readonly opportunityId: string } | null;
  readonly dismissed: { readonly at: string; readonly fingerprint: string } | null;
  readonly reopenCount: number;
  /** Bounded: the oldest entries are counted in `historyCompacted`; safety state lives in the dedicated fields above, never only in history. */
  readonly history: readonly AyasTechnologyWatchEntry[];
  readonly historyCompacted: number;
}

export interface AyasTechnologyCandidate {
  readonly technologyKey: string;
  readonly createdAt: string;
  readonly identity: AyasTechnologyIdentity;
  readonly evidence: readonly AyasTechnologyEvidence[];
  /** Superseded same-source releases and repeated same-source existence claims removed to stay bounded; restrictive claims are never compacted. */
  readonly compaction: { readonly removed: number; readonly lastAt: string | null };
  readonly watch: AyasTechnologyWatchRecord;
  readonly issues: readonly AyasTechnologyIssue[];
  readonly instructionSignals: readonly AyasResearchInstructionSignal[];
  readonly authority: "NONE";
}

export interface AyasTechnologyObservation {
  readonly origin: AyasTechnologyOrigin;
  readonly observedAt: string;
  readonly identity: AyasTechnologyIdentity;
  readonly evidence: readonly AyasTechnologyEvidence[];
  readonly issues: readonly AyasTechnologyIssue[];
  readonly instructionSignals: readonly AyasResearchInstructionSignal[];
}

export interface AyasTechnologyRegister {
  readonly schemaVersion: typeof AYAS_TECHNOLOGY_SCHEMA_VERSION;
  readonly candidates: readonly AyasTechnologyCandidate[];
}

export interface AyasTechnologySerializedRegister {
  readonly schemaVersion: typeof AYAS_TECHNOLOGY_SCHEMA_VERSION;
  readonly candidates: readonly unknown[];
  /** Detects corruption, truncation and naive edits. It is a content digest, not an authentication: an actor who can rewrite the file can recompute it. */
  readonly integrity: { readonly algorithm: "sha256"; readonly digest: string };
}

export class AyasTechnologyError extends Error {
  constructor(readonly code:
    | "AYAS_TECHNOLOGY_INVALID_OBSERVATION" | "AYAS_TECHNOLOGY_INVALID_TIME" | "AYAS_TECHNOLOGY_INVALID_IDENTITY" | "AYAS_TECHNOLOGY_SCHEMA_MISMATCH"
    | "AYAS_TECHNOLOGY_REGISTER_INVALID" | "AYAS_TECHNOLOGY_REGISTER_LIMIT" | "AYAS_TECHNOLOGY_INTEGRITY_MISMATCH" | "AYAS_TECHNOLOGY_ENVIRONMENT_INVALID"
    | "AYAS_TECHNOLOGY_TRANSITION_REFUSED" | "AYAS_TECHNOLOGY_HANDOFF_REFUSED", message: string) {
    super(message);
    this.name = "AyasTechnologyError";
    this.stack = undefined;
  }
}

type Obj = Record<string, unknown>;
const TECHNOLOGY_KEY = /^ayas-tech-[0-9a-f]{24}$/;
const EVIDENCE_ID = /^ayas-tech-evidence-[0-9a-f]{24}$/;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MACHINE_KEY = /^[a-z][a-z0-9-]{0,39}(\.[a-z0-9][a-z0-9-]{0,39}){0,5}$/;
const DOMAIN_KEY = /^[a-z][a-z0-9-]{0,39}(\.[a-z0-9][a-z0-9-]{0,39}){0,3}$/;
const VERSION = /^[0-9A-Za-z][0-9A-Za-z.+_-]{0,39}$/;
const SEMVER = /^(\d{1,9}(?:\.\d{1,9}){0,3})(?:-([0-9A-Za-z.-]{1,32}))?(?:\+[0-9A-Za-z.-]{1,32})?$/;
const ADVISORY_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const LICENSE_ID = /^[A-Za-z0-9][A-Za-z0-9.+-]{0,63}$/;
const PACKAGE_NAME = /^[a-z0-9@][a-z0-9@._/-]{0,159}$/;
const RESEARCH_FINDING_ID = /^ayas-research-[0-9a-f-]{36}$/i;
const REASON_CODE = /^[A-Z][A-Z0-9_]{2,63}$/;
const FINGERPRINT = /^[0-9a-f]{64}$/;
const OPPORTUNITY_ID = /^ayas-evo-[0-9a-f]{16,64}$/;
const ISO = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})?)?$/;
const ANCHOR_REPOSITORY = /^[a-z0-9.-]+(\/[^/\s]{1,100}){0,2}$/;
const ANCHOR_HOST = /^[a-z0-9.-]+\.[a-z0-9-]{2,}$/;
const DAY_MS = 86_400_000;

const sha256 = (value: string): string => crypto.createHash("sha256").update(value, "utf8").digest("hex");
const oneOf = <T extends string>(values: readonly T[], value: unknown): value is T => typeof value === "string" && (values as readonly string[]).includes(value);
const uniqueSorted = <T extends string>(values: Iterable<T>): T[] => [...new Set(values)].sort();

/** A JSON-style object map. Arrays, null and class instances never count as one. */
export function isAyasTechnologyPlainObject(value: unknown): value is Obj {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
const isPlainObject = isAyasTechnologyPlainObject;

/** A JSON-style list without holes. A sparse array would let `every`/`map` skip a malformed slot, so it is malformed itself. */
export function isAyasTechnologyDenseArray(value: unknown): value is unknown[] {
  if (!Array.isArray(value)) return false;
  for (let i = 0; i < value.length; i += 1) if (!(i in value)) return false;
  return true;
}
const isDenseArray = isAyasTechnologyDenseArray;

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (isPlainObject(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}
/** Key-sorted JSON: the one byte form hashed for identities, fingerprints and the register digest. */
export function ayasTechnologyCanonicalJson(value: unknown): string {
  return JSON.stringify(canonical(value)) ?? "null";
}

export function ayasTechnologyIso(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 40 || !ISO.test(value)) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}
export function ayasTechnologyAddDays(iso: string, days: number): string {
  return new Date(Date.parse(iso) + days * DAY_MS).toISOString();
}

const text = (value: string, max: number): string => neutralizeAyasUntrustedText(value).slice(0, max).trim();

/**
 * Version-free identity slug: diacritics folded (Turkish included), anything
 * but letters and digits collapsed to "-", and purely numeric or `v<digits>`
 * segments dropped, so "Tool 2.0" and "tool" are one technology.
 */
export function ayasTechnologySlug(value: string): string {
  const folded = String(value).toLocaleLowerCase("tr").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ı/g, "i");
  const segments = folded.replace(/[^a-z0-9]+/g, "-").split("-").filter((segment) => segment && !/^v?\d+$/.test(segment));
  let out = "";
  for (const segment of segments) {
    const next = out ? `${out}-${segment}` : segment;
    if (next.length > 48) break;
    out = next;
  }
  return out;
}

function normalizeVersion(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/^[vV](?=\d)/, "");
  return VERSION.test(trimmed) ? trimmed : null;
}

function parseVersion(value: string): { readonly parts: readonly number[]; readonly pre: readonly string[] } | null {
  const match = SEMVER.exec(value.trim().replace(/^[vV](?=\d)/, ""));
  if (!match) return null;
  return { parts: match[1]!.split(".").map(Number), pre: match[2] ? match[2].split(".") : [] };
}

/** Semver-aware comparison; `null` when either side is not a comparable version (never a guess). */
export function compareAyasTechnologyVersions(a: string, b: string): number | null {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return null;
  for (let i = 0; i < Math.max(left.parts.length, right.parts.length); i += 1) {
    const diff = (left.parts[i] ?? 0) - (right.parts[i] ?? 0);
    if (diff !== 0) return Math.sign(diff);
  }
  if (left.pre.length === 0 || right.pre.length === 0) return Math.sign(right.pre.length - left.pre.length);
  for (let i = 0; i < Math.max(left.pre.length, right.pre.length); i += 1) {
    const x = left.pre[i]; const y = right.pre[i];
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    const numeric = /^\d+$/.test(x) && /^\d+$/.test(y);
    const diff = numeric ? Number(x) - Number(y) : x < y ? -1 : x > y ? 1 : 0;
    if (diff !== 0) return Math.sign(diff);
  }
  return 0;
}

/** The highest comparable version; when none compare, the lexically last (deterministic, flagged as unordered by the caller). */
export function ayasTechnologyMaxVersion(versions: readonly string[]): string | null {
  const comparable = versions.filter((version) => parseVersion(version) !== null);
  if (comparable.length > 0) return comparable.reduce((best, version) => compareAyasTechnologyVersions(version, best)! > 0 ? version : best);
  return versions.length > 0 ? [...versions].sort().at(-1)! : null;
}
export function ayasTechnologyMajor(version: string): string {
  return String(parseVersion(version)?.parts[0] ?? version);
}

const CODE_HOSTS: ReadonlySet<string> = new Set(["github.com", "gitlab.com", "codeberg.org", "bitbucket.org"]);

export interface AyasTechnologySourceDescription { readonly url: string; readonly host: string; readonly path: string; readonly independenceKey: string }

/**
 * A source reference must be an http(s) URL with a public-looking hostname and
 * no embedded credentials (a credential is never stored). Volatile parts are
 * stripped with the Stage 8 URL normalizer. Independence is approximated by
 * owner on code hosts and by the last two host labels elsewhere, which can
 * only merge unrelated sources (stricter), never split one publisher.
 */
export function describeAyasTechnologySource(raw: unknown): AyasTechnologySourceDescription | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > AYAS_TECHNOLOGY_LIMITS.urlLength) return null;
  let parsed: URL;
  try { parsed = new URL(raw.trim()); } catch { return null; }
  if ((parsed.protocol !== "https:" && parsed.protocol !== "http:") || parsed.username || parsed.password || !/^[a-z0-9.-]+\.[a-z][a-z0-9-]*$/i.test(parsed.hostname)) return null;
  const url = normalizeAyasResearchUrl(parsed.toString());
  if (url.length > AYAS_TECHNOLOGY_LIMITS.urlLength) return null;
  let normalized: URL;
  try { normalized = new URL(url); } catch { return null; }
  const host = normalized.hostname.toLowerCase().replace(/^www\./, "");
  const path = normalized.pathname.toLowerCase();
  const first = path.split("/").filter(Boolean)[0];
  const independenceKey = CODE_HOSTS.has(host) && first ? `${host}/${first}` : host.split(".").slice(-2).join(".");
  return { url, host, path, independenceKey };
}

function repositoryAnchor(raw: unknown): string | null {
  const source = describeAyasTechnologySource(raw);
  if (!source) return null;
  const segments = source.path.split("/").filter(Boolean);
  if (CODE_HOSTS.has(source.host)) {
    if (segments.length < 2) return null;
    return `${source.host}/${segments[0]}/${segments[1]!.replace(/\.git$/, "")}`;
  }
  const anchor = [source.host, ...segments.slice(0, 2)].join("/");
  return ANCHOR_REPOSITORY.test(anchor) ? anchor : null;
}

/** `<ecosystem>:<normalized name>`; PyPI names are compared in their PEP 503 form. */
export function ayasTechnologyPackageAnchor(ecosystem: AyasTechnologyPackageEcosystem, name: string): string | null {
  const lowered = name.trim().toLowerCase();
  const normalized = ecosystem === "PYPI" ? lowered.replace(/[-_.]+/g, "-") : lowered;
  return PACKAGE_NAME.test(normalized) && !normalized.includes("..") ? `${ecosystem.toLowerCase()}:${normalized}` : null;
}

// ---------------------------------------------------------------- directive scanning

interface Scanner { readonly scan: (value: unknown) => void; readonly signals: () => AyasResearchInstructionSignal[]; readonly oversized: () => boolean }

/** What the scan reads: a string as is, any other present value as its JSON text — a directive cannot hide in a malformed shape. */
function makeScanner(): Scanner {
  const found = new Set<AyasResearchInstructionSignal>();
  let oversized = false;
  return {
    scan(value) {
      if (value === undefined) return;
      let raw: string;
      if (typeof value === "string") raw = value;
      else { try { raw = JSON.stringify(value) ?? ""; } catch { raw = ""; } }
      if (raw.length > AYAS_TECHNOLOGY_LIMITS.scanText) oversized = true;
      const bounded = raw.slice(0, AYAS_TECHNOLOGY_LIMITS.scanText);
      // The detector reads 4,000 characters; overlapping windows keep a directive from hiding past it.
      for (let start = 0; start === 0 || start < bounded.length; start += 3_500) {
        for (const signal of detectAyasResearchInstructionSignals(bounded.slice(start, start + 4_000))) found.add(signal);
      }
    },
    signals: () => uniqueSorted(found),
    oversized: () => oversized,
  };
}

/** A present field the schema does not know could be a misspelled safety declaration: it blocks, and its value is scanned. */
function closedFields(value: Obj, fields: readonly string[], issues: Issues, scan: (value: unknown) => void): void {
  for (const [field, item] of Object.entries(value)) {
    if (item === undefined || fields.includes(field)) continue;
    issues.push("UNKNOWN_FIELD");
    scan(item);
  }
}

// ---------------------------------------------------------------- claims

const CLAIM_FIELDS: Readonly<Record<AyasTechnologyClaimKind, readonly string[]>> = Object.freeze({
  EXISTS: [], RELEASE: ["version", "releasedAt"], WITHDRAWN: ["version"], CAPABILITY: ["domain", "capabilityKey"], DELIVERY: ["delivery"],
  REQUIREMENT: ["requirement", "present"], PRICING: ["model", "requirements"], LICENSE: ["licenseClass", "identifier"], PROVENANCE: ["status"],
  MAINTENANCE: ["status"], SECURITY_ADVISORY: ["severity", "advisoryId", "fixedInVersion"], COMPROMISE: ["version"],
});

/**
 * A claim of a restrictive kind that is malformed ANYWHERE — a bad value, a
 * bad list entry or an unknown (possibly misspelled) field — is KEPT at its
 * most restrictive value AND blocks: a malformed advisory stays an advisory
 * affecting the latest release, a malformed price is PAID, a malformed
 * delivery is UNKNOWN. A blocked record therefore never displays a permissive
 * answer taken from the claim that blocked it. A malformed claim that could
 * only have resolved an uncertainty (existence, release, capability, an
 * unknown requirement code) is dropped and blocks. Either way the loss is
 * recorded, never silent.
 */
function normalizeClaim(value: unknown, issues: Issues, scan: (value: unknown) => void): AyasTechnologyClaim | null {
  const before = issues.length;
  const claim = normalizeClaimValue(value, issues, scan);
  return claim !== null && issues.length > before ? mostRestrictive(claim) : claim;
}

function mostRestrictive(claim: AyasTechnologyClaim): AyasTechnologyClaim {
  switch (claim.kind) {
    case "WITHDRAWN": case "COMPROMISE": return { ...claim, version: null };
    case "DELIVERY": return { ...claim, delivery: "UNKNOWN" };
    case "REQUIREMENT": return { ...claim, present: true };
    case "PRICING": return { ...claim, model: "PAID" };
    case "LICENSE": return { ...claim, licenseClass: "NON_COMMERCIAL" };
    case "PROVENANCE": return { ...claim, status: "UNVERIFIED_PUBLISHER" };
    case "MAINTENANCE": return { ...claim, status: "ARCHIVED" };
    case "SECURITY_ADVISORY": return { ...claim, severity: "UNKNOWN", fixedInVersion: null };
    default: return claim;
  }
}

function normalizeClaimValue(value: unknown, issues: Issues, scan: (value: unknown) => void): AyasTechnologyClaim | null {
  if (!isPlainObject(value)) { issues.push("CLAIM_MALFORMED"); scan(value); return null; }
  if (!oneOf(AYAS_TECHNOLOGY_CLAIM_KINDS, value.kind)) { issues.push("CLAIM_KIND_INVALID"); scan(value); return null; }
  const kind = value.kind;
  closedFields(value, ["kind", ...CLAIM_FIELDS[kind]], issues, scan);
  const invalid = (): void => { issues.push("CLAIM_VALUE_INVALID"); };
  const optionalVersion = (field: unknown): string | null => {
    if (field === undefined || field === null) return null;
    const version = normalizeVersion(field);
    if (version === null) invalid();
    return version;
  };
  switch (kind) {
    case "EXISTS": return { kind };
    case "RELEASE": {
      const version = normalizeVersion(value.version);
      if (version === null) { invalid(); return null; }
      let releasedAt: string | null = null;
      if (value.releasedAt !== undefined && value.releasedAt !== null) {
        releasedAt = ayasTechnologyIso(value.releasedAt);
        if (releasedAt === null) issues.push("TIME_MALFORMED");
      }
      return { kind, version, releasedAt };
    }
    case "WITHDRAWN": return { kind, version: optionalVersion(value.version) };
    case "COMPROMISE": return { kind, version: optionalVersion(value.version) };
    case "CAPABILITY": {
      let domain: AyasCapabilityCategory | null = null;
      let unknownDomain: string | null = null;
      if (value.domain !== undefined && value.domain !== null) {
        if (typeof value.domain !== "string") invalid();
        else if (isAyasCapabilityCategory(value.domain)) domain = value.domain;
        else {
          // A domain the closed taxonomy does not know yet stays representable (and needs research); it is never folded into a known one.
          const slug = ayasTechnologySlug(value.domain);
          if (slug && slug.length <= 40) { unknownDomain = slug; issues.push("CAPABILITY_DOMAIN_UNRECOGNIZED"); } else invalid();
        }
      }
      let capabilityKey: string | null = null;
      if (value.capabilityKey !== undefined && value.capabilityKey !== null) {
        if (typeof value.capabilityKey === "string" && MACHINE_KEY.test(value.capabilityKey)) capabilityKey = value.capabilityKey;
        else invalid();
      }
      // A capability claim that names nothing is malformed, never an absent claim.
      if (domain === null && unknownDomain === null && capabilityKey === null) { invalid(); return null; }
      return { kind, domain, unknownDomain, capabilityKey };
    }
    case "DELIVERY":
      if (oneOf(AYAS_TECHNOLOGY_DELIVERIES, value.delivery)) return { kind, delivery: value.delivery };
      invalid();
      return { kind, delivery: "UNKNOWN" };
    case "REQUIREMENT": {
      if (!oneOf(AYAS_TECHNOLOGY_REQUIREMENTS, value.requirement)) { invalid(); return null; }
      if (typeof value.present !== "boolean") { invalid(); return { kind, requirement: value.requirement, present: true }; }
      return { kind, requirement: value.requirement, present: value.present };
    }
    case "PRICING": {
      let model: AyasTechnologyPricingModel = "PAID";
      if (oneOf(AYAS_TECHNOLOGY_PRICING_MODELS, value.model)) model = value.model; else invalid();
      const requirements: AyasTechnologySpendRequirement[] = [];
      if (value.requirements !== undefined) {
        if (!isDenseArray(value.requirements)) invalid();
        else for (const item of value.requirements) { if (oneOf(AYAS_TECHNOLOGY_SPEND_REQUIREMENTS, item)) requirements.push(item); else invalid(); }
      }
      return { kind, model, requirements: uniqueSorted(requirements) };
    }
    case "LICENSE": {
      let licenseClass: AyasTechnologyLicenseClass = "NON_COMMERCIAL";
      if (oneOf(AYAS_TECHNOLOGY_LICENSE_CLASSES, value.licenseClass)) licenseClass = value.licenseClass; else invalid();
      let identifier: string | null = null;
      if (value.identifier !== undefined && value.identifier !== null) {
        if (typeof value.identifier === "string" && LICENSE_ID.test(value.identifier)) identifier = value.identifier; else invalid();
      }
      return { kind, licenseClass, identifier };
    }
    case "PROVENANCE":
      if (oneOf(AYAS_TECHNOLOGY_PROVENANCE, value.status)) return { kind, status: value.status };
      invalid();
      return { kind, status: "UNVERIFIED_PUBLISHER" };
    case "MAINTENANCE":
      if (oneOf(AYAS_TECHNOLOGY_MAINTENANCE, value.status)) return { kind, status: value.status };
      invalid();
      return { kind, status: "ARCHIVED" };
    case "SECURITY_ADVISORY": {
      let severity: AyasTechnologyAdvisorySeverity = "UNKNOWN";
      if (oneOf(AYAS_TECHNOLOGY_ADVISORY_SEVERITIES, value.severity)) severity = value.severity; else invalid();
      let advisoryId: string | null = null;
      if (value.advisoryId !== undefined && value.advisoryId !== null) {
        if (typeof value.advisoryId === "string" && ADVISORY_ID.test(value.advisoryId)) advisoryId = value.advisoryId; else invalid();
      }
      return { kind, severity, advisoryId, fixedInVersion: optionalVersion(value.fixedInVersion) };
    }
  }
}

/** The persisted (input) form of a claim; normalizing it again yields the same claim. */
function claimInput(claim: AyasTechnologyClaim): Obj {
  if (claim.kind === "CAPABILITY") return { kind: claim.kind, domain: claim.domain ?? claim.unknownDomain, capabilityKey: claim.capabilityKey };
  return { ...claim };
}

// ---------------------------------------------------------------- evidence

const SECURITY_KINDS: ReadonlySet<string> = new Set(["SECURITY_ADVISORY", "COMPROMISE", "WITHDRAWN"]);
/**
 * Whether a raw evidence item that could not be kept looked security-relevant.
 * Read on untrusted input, but it can only ADD a restriction, so a loose match
 * (a misspelled kind included) is the safe direction.
 */
function looksSecurityRelevant(value: unknown): boolean {
  if (!isPlainObject(value) || !isPlainObject(value.claim)) return false;
  const kind = String(value.claim.kind ?? "");
  return SECURITY_KINDS.has(kind) || /secur|advis|vuln|compromis|withdraw|malic|cve/i.test(kind);
}

const EVIDENCE_FIELDS = ["source", "extraction", "claim", "statement", "researchFindingId"];
const PERSISTED_EVIDENCE_FIELDS = [...EVIDENCE_FIELDS, "origin", "firstObservedAt", "lastObservedAt"];

interface EvidenceContext {
  readonly origin: AyasTechnologyOrigin;
  readonly firstObservedAt: string;
  readonly lastObservedAt: string;
  readonly issues: Issues;
  readonly scanner: Scanner;
  readonly fields: readonly string[];
}

function normalizeEvidenceItem(value: unknown, context: EvidenceContext): AyasTechnologyEvidence | null {
  const { issues, scanner } = context;
  if (!isPlainObject(value)) { issues.push("EVIDENCE_ITEM_MALFORMED"); scanner.scan(value); return null; }
  closedFields(value, context.fields, issues, scanner.scan);
  const refuse = (issue: AyasTechnologyIssue): null => {
    issues.push(issue);
    if (looksSecurityRelevant(value)) issues.push("SECURITY_EVIDENCE_UNREADABLE");
    scanner.scan(value.statement); scanner.scan(value.claim);
    return null;
  };
  if (!isPlainObject(value.source)) return refuse("SOURCE_MALFORMED");
  const source = value.source;
  closedFields(source, ["url", "sourceClass", "publishedAt"], issues, scanner.scan);
  const described = describeAyasTechnologySource(source.url);
  if (!described) return refuse("SOURCE_URL_INVALID");
  let sourceClass: AyasTechnologySourceClass = "UNKNOWN_SOURCE";
  if (source.sourceClass !== undefined) {
    if (oneOf(AYAS_TECHNOLOGY_SOURCE_CLASSES, source.sourceClass)) sourceClass = source.sourceClass; else issues.push("SOURCE_CLASS_INVALID");
  }
  let publishedAt: string | null = null;
  if (source.publishedAt !== undefined && source.publishedAt !== null) {
    publishedAt = ayasTechnologyIso(source.publishedAt);
    if (publishedAt === null) issues.push("TIME_MALFORMED");
  }
  let extraction: AyasTechnologyExtraction = "UNDECLARED";
  if (value.extraction !== undefined) {
    if (oneOf(AYAS_TECHNOLOGY_EXTRACTIONS, value.extraction)) extraction = value.extraction; else issues.push("EXTRACTION_INVALID");
  }
  const claim = normalizeClaim(value.claim, issues, scanner.scan);
  let statement = "";
  if (value.statement !== undefined) {
    scanner.scan(value.statement);
    if (typeof value.statement === "string") statement = text(value.statement, AYAS_TECHNOLOGY_LIMITS.statementText);
    else issues.push("TEXT_MALFORMED");
  }
  if (!claim) { if (looksSecurityRelevant(value)) issues.push("SECURITY_EVIDENCE_UNREADABLE"); return null; }
  let researchFindingId: string | null = null;
  if (value.researchFindingId !== undefined && value.researchFindingId !== null) {
    if (typeof value.researchFindingId === "string" && RESEARCH_FINDING_ID.test(value.researchFindingId)) researchFindingId = value.researchFindingId.toLowerCase();
    else issues.push("EVIDENCE_FIELD_INVALID");
  }
  const normalizedSource = Object.freeze({ url: described.url, sourceClass, publishedAt });
  const evidenceId = `ayas-tech-evidence-${sha256(ayasTechnologyCanonicalJson([context.origin, normalizedSource.url, sourceClass, extraction, claim])).slice(0, 24)}`;
  return Object.freeze({
    evidenceId, origin: context.origin, extraction, source: normalizedSource, claim: Object.freeze(claim), statement, researchFindingId,
    firstObservedAt: context.firstObservedAt, lastObservedAt: context.lastObservedAt,
  });
}

// ---------------------------------------------------------------- identity

const IDENTITY_FIELDS = ["name", "vendor", "category", "domainKey", "packages", "repository", "homepage"];

function nameAnchor(vendor: string | null, nameSlug: string): string {
  return `${vendor ?? "-"}/${nameSlug}`;
}

function normalizeIdentityInput(value: unknown, issues: Issues, scanner: Scanner): AyasTechnologyIdentity {
  if (!isPlainObject(value)) throw new AyasTechnologyError("AYAS_TECHNOLOGY_INVALID_IDENTITY", "identity must be an object");
  closedFields(value, IDENTITY_FIELDS, issues, scanner.scan);
  if (typeof value.name !== "string") throw new AyasTechnologyError("AYAS_TECHNOLOGY_INVALID_IDENTITY", "identity name must be a string");
  scanner.scan(value.name);
  const displayName = text(value.name, AYAS_TECHNOLOGY_LIMITS.nameText);
  const nameSlug = ayasTechnologySlug(displayName);
  if (!nameSlug) throw new AyasTechnologyError("AYAS_TECHNOLOGY_INVALID_IDENTITY", "identity name has no identifying characters");
  let vendor: string | null = null;
  if (value.vendor !== undefined) {
    scanner.scan(value.vendor);
    if (typeof value.vendor === "string") vendor = ayasTechnologySlug(text(value.vendor, AYAS_TECHNOLOGY_LIMITS.nameText)) || null;
    if (vendor === null) issues.push("IDENTITY_MALFORMED");
  }
  let category: AyasTechnologyCategory = "UNKNOWN";
  let categoryKey: string | null = null;
  if (value.category !== undefined) {
    if (typeof value.category !== "string") { issues.push("IDENTITY_MALFORMED"); scanner.scan(value.category); }
    else if (oneOf(AYAS_TECHNOLOGY_CATEGORIES, value.category)) category = value.category;
    else {
      // A category nobody named yet stays representable as UNKNOWN + its key, and needs research; it never becomes a known one.
      const slug = ayasTechnologySlug(value.category);
      if (slug) { categoryKey = slug; issues.push("CATEGORY_UNRECOGNIZED"); } else issues.push("IDENTITY_MALFORMED");
    }
  }
  let domainKey: string | null = null;
  if (value.domainKey !== undefined) {
    if (typeof value.domainKey === "string" && DOMAIN_KEY.test(value.domainKey)) domainKey = value.domainKey; else { issues.push("IDENTITY_MALFORMED"); scanner.scan(value.domainKey); }
  }
  const packages: string[] = [];
  if (value.packages !== undefined) {
    if (!isDenseArray(value.packages)) issues.push("PACKAGE_INVALID");
    else {
      for (const item of value.packages) {
        if (!isPlainObject(item) || !oneOf(AYAS_TECHNOLOGY_PACKAGE_ECOSYSTEMS, item.ecosystem) || typeof item.name !== "string") { issues.push("PACKAGE_INVALID"); scanner.scan(item); continue; }
        closedFields(item, ["ecosystem", "name"], issues, scanner.scan);
        const anchor = ayasTechnologyPackageAnchor(item.ecosystem, item.name);
        if (anchor) packages.push(anchor); else issues.push("PACKAGE_INVALID");
      }
    }
  }
  const repositories: string[] = [];
  if (value.repository !== undefined) {
    const anchor = repositoryAnchor(value.repository);
    if (anchor) repositories.push(anchor); else issues.push("URL_INVALID");
  }
  const hosts: string[] = [];
  if (value.homepage !== undefined) {
    const source = describeAyasTechnologySource(value.homepage);
    if (source && ANCHOR_HOST.test(source.host)) hosts.push(source.host); else issues.push("URL_INVALID");
  }
  const bound = (list: string[]): string[] => {
    const unique = uniqueSorted(list);
    if (unique.length > AYAS_TECHNOLOGY_LIMITS.anchorsPerKind) issues.push("ANCHORS_TRUNCATED");
    return unique.slice(0, AYAS_TECHNOLOGY_LIMITS.anchorsPerKind);
  };
  return Object.freeze({
    displayName, nameSlug, vendor, category, categoryKey, domainKey,
    anchors: Object.freeze({ names: [nameAnchor(vendor, nameSlug)], packages: bound(packages), repositories: bound(repositories), hosts: bound(hosts) }),
  });
}

// ---------------------------------------------------------------- observation

const OBSERVATION_FIELDS = ["schemaVersion", "observedAt", "identity", "evidence"];
const PRODUCED_OBSERVATIONS = new WeakSet<object>();

/**
 * One producer run's report about one technology. Invalid identity, time or
 * schema is refused (there is no record to block); everything else that is
 * present but malformed becomes a closed-vocabulary issue. Directive-shaped
 * text is detected on the RAW input, whatever its shape, before neutralization.
 */
export function normalizeAyasTechnologyObservation(input: unknown, origin: AyasTechnologyOrigin): AyasTechnologyObservation {
  if (!oneOf(AYAS_TECHNOLOGY_ORIGINS, origin)) throw new AyasTechnologyError("AYAS_TECHNOLOGY_INVALID_OBSERVATION", "origin is set by the producing code path and must be recognized");
  if (!isPlainObject(input)) throw new AyasTechnologyError("AYAS_TECHNOLOGY_INVALID_OBSERVATION", "an observation must be an object");
  if (input.schemaVersion !== undefined && input.schemaVersion !== AYAS_TECHNOLOGY_SCHEMA_VERSION) throw new AyasTechnologyError("AYAS_TECHNOLOGY_SCHEMA_MISMATCH", "unsupported observation schema version");
  const observedAt = ayasTechnologyIso(input.observedAt);
  if (observedAt === null) throw new AyasTechnologyError("AYAS_TECHNOLOGY_INVALID_TIME", "observedAt is not an ISO timestamp");
  const issues: Issues = [];
  const scanner = makeScanner();
  closedFields(input, OBSERVATION_FIELDS, issues, scanner.scan);
  const identity = normalizeIdentityInput(input.identity, issues, scanner);
  let items: readonly unknown[] = [];
  if (input.evidence !== undefined) {
    if (isDenseArray(input.evidence)) items = input.evidence; else { issues.push("EVIDENCE_MALFORMED"); scanner.scan(input.evidence); }
  }
  if (items.length > AYAS_TECHNOLOGY_LIMITS.observationEvidence) {
    // Never silently truncated: the loss blocks, and what was cut off is still read for directives.
    issues.push("EVIDENCE_TRUNCATED");
    for (const item of items.slice(AYAS_TECHNOLOGY_LIMITS.observationEvidence)) {
      scanner.scan(item);
      if (looksSecurityRelevant(item)) issues.push("SECURITY_EVIDENCE_UNREADABLE");
    }
  }
  const evidence = new Map<string, AyasTechnologyEvidence>();
  const context: EvidenceContext = { origin, firstObservedAt: observedAt, lastObservedAt: observedAt, issues, scanner, fields: EVIDENCE_FIELDS };
  for (let i = 0; i < Math.min(items.length, AYAS_TECHNOLOGY_LIMITS.observationEvidence); i += 1) {
    const item = normalizeEvidenceItem(items[i], context);
    if (item && !evidence.has(item.evidenceId)) evidence.set(item.evidenceId, item);
  }
  if (scanner.oversized()) issues.push("TEXT_OVERSIZED");
  const observation: AyasTechnologyObservation = Object.freeze({
    origin, observedAt, identity,
    evidence: Object.freeze([...evidence.values()].sort((a, b) => a.evidenceId.localeCompare(b.evidenceId))),
    issues: Object.freeze(uniqueSorted(issues)),
    instructionSignals: Object.freeze(scanner.signals()),
  });
  PRODUCED_OBSERVATIONS.add(observation);
  return observation;
}

// ---------------------------------------------------------------- claim semantics shared with the assessment

export type AyasTechnologyEpistemicClass = "RESEARCH_CLAIM" | "HYPOTHESIS";

/**
 * Stage 14 never produces a FACT. A directly read external source is a
 * SOURCE/RESEARCH CLAIM; a model summary, an undeclared extraction or an
 * AYAS suggestion is a HYPOTHESIS. Facts are Stage 13's to derive from local
 * measurements; owner requests go to Stage 13 directly.
 */
export function ayasTechnologyEpistemicClass(evidence: Pick<AyasTechnologyEvidence, "origin" | "extraction">): AyasTechnologyEpistemicClass {
  return evidence.origin === "AYAS_SUGGESTION" || evidence.extraction !== "DIRECT_SOURCE" ? "HYPOTHESIS" : "RESEARCH_CLAIM";
}

/** Existence, releases, capability and delivery may be claimed by secondary sources; everything that could remove a restriction needs a primary one. */
export function ayasTechnologyRequiredTier(kind: AyasTechnologyClaimKind): Exclude<AyasTechnologySourceTier, "WEAK"> {
  return kind === "EXISTS" || kind === "RELEASE" || kind === "CAPABILITY" || kind === "DELIVERY" ? "SECONDARY" : "PRIMARY";
}

/** Whether a claim may count in the permissive direction at all (time and verification are judged by the assessment). */
export function isAyasTechnologyTierEligible(evidence: AyasTechnologyEvidence): boolean {
  if (ayasTechnologyEpistemicClass(evidence) !== "RESEARCH_CLAIM") return false;
  const tier = AYAS_TECHNOLOGY_SOURCE_TIER[evidence.source.sourceClass];
  return tier === "PRIMARY" || (tier === "SECONDARY" && ayasTechnologyRequiredTier(evidence.claim.kind) === "SECONDARY");
}

/**
 * The material facts, time-independent: the latest major version, capability
 * domains and keys, deliveries, requirement states, pricing, licence,
 * provenance, maintenance, advisories, compromises and withdrawals. Restrictive
 * claims count from any source; permissive ones only from an eligible source.
 * A new URL repeating known facts, a minor release or the passage of time is
 * not material; a new major version or a changed capability, cost, risk or
 * compatibility fact is.
 */
export function computeAyasTechnologyMaterialFingerprint(candidate: Pick<AyasTechnologyCandidate, "evidence">): string {
  const eligible = candidate.evidence.filter(isAyasTechnologyTierEligible);
  const all = candidate.evidence;
  const pick = <K extends AyasTechnologyClaimKind>(list: readonly AyasTechnologyEvidence[], kind: K) => list.map((e) => e.claim).filter((c): c is Extract<AyasTechnologyClaim, { kind: K }> => c.kind === kind);
  const latest = ayasTechnologyMaxVersion(pick(eligible, "RELEASE").map((claim) => claim.version));
  const facts = {
    major: latest === null ? null : ayasTechnologyMajor(latest),
    domains: uniqueSorted(pick(eligible, "CAPABILITY").map((claim) => claim.domain ?? `?${claim.unknownDomain ?? ""}`)),
    keys: uniqueSorted(pick(eligible, "CAPABILITY").flatMap((claim) => claim.capabilityKey ? [claim.capabilityKey] : [])),
    deliveries: uniqueSorted(pick(all, "DELIVERY").map((claim) => claim.delivery)),
    present: uniqueSorted(pick(all, "REQUIREMENT").filter((claim) => claim.present).map((claim) => claim.requirement)),
    absent: uniqueSorted(pick(eligible, "REQUIREMENT").filter((claim) => !claim.present).map((claim) => claim.requirement)),
    pricing: uniqueSorted([...pick(all, "PRICING").filter((claim) => AYAS_TECHNOLOGY_PRICING_RANK[claim.model] >= 2), ...pick(eligible, "PRICING")].map((claim) => claim.model)),
    spend: uniqueSorted(pick(all, "PRICING").flatMap((claim) => claim.requirements)),
    license: uniqueSorted([...pick(all, "LICENSE").filter((claim) => AYAS_TECHNOLOGY_LICENSE_RANK[claim.licenseClass] >= 2), ...pick(eligible, "LICENSE")].map((claim) => claim.licenseClass)),
    provenance: uniqueSorted([...pick(all, "PROVENANCE").filter((claim) => claim.status === "UNVERIFIED_PUBLISHER"), ...pick(eligible, "PROVENANCE")].map((claim) => claim.status)),
    maintenance: uniqueSorted([...pick(all, "MAINTENANCE").filter((claim) => AYAS_TECHNOLOGY_MAINTENANCE_RANK[claim.status] >= 2), ...pick(eligible, "MAINTENANCE")].map((claim) => claim.status)),
    advisories: uniqueSorted(pick(all, "SECURITY_ADVISORY").map((claim) => `${claim.advisoryId ?? "?"}|${claim.severity}|${claim.fixedInVersion ?? "?"}`)),
    compromises: uniqueSorted(pick(all, "COMPROMISE").map((claim) => claim.version ?? "*")),
    withdrawn: uniqueSorted(pick(all, "WITHDRAWN").map((claim) => claim.version ?? "*")),
  };
  return sha256(ayasTechnologyCanonicalJson(facts));
}

// ---------------------------------------------------------------- register

const PRODUCED_REGISTERS = new WeakSet<object>();

function emptyWatch(): AyasTechnologyWatchRecord {
  return Object.freeze({ state: "WATCHING", surfaced: null, surfaceCount: 0, handoff: null, dismissed: null, reopenCount: 0, history: Object.freeze([]), historyCompacted: 0 });
}

function deriveKey(anchors: AyasTechnologyAnchors): string {
  const anchor = anchors.packages[0] ?? anchors.repositories[0] ?? anchors.names[0]!;
  return `ayas-tech-${sha256(anchor).slice(0, 24)}`;
}

function produce(candidates: readonly AyasTechnologyCandidate[]): AyasTechnologyRegister {
  if (candidates.length > AYAS_TECHNOLOGY_LIMITS.candidates) throw new AyasTechnologyError("AYAS_TECHNOLOGY_REGISTER_LIMIT", "register holds too many candidates; none is evicted");
  const sorted = [...candidates].sort((a, b) => a.technologyKey.localeCompare(b.technologyKey));
  for (let i = 1; i < sorted.length; i += 1) if (sorted[i]!.technologyKey === sorted[i - 1]!.technologyKey) throw new AyasTechnologyError("AYAS_TECHNOLOGY_REGISTER_INVALID", "duplicate technology key");
  const register: AyasTechnologyRegister = Object.freeze({ schemaVersion: AYAS_TECHNOLOGY_SCHEMA_VERSION, candidates: Object.freeze(sorted) });
  PRODUCED_REGISTERS.add(register);
  return register;
}

/**
 * Register boundary for candidates that did not come from this module: each
 * one must be exactly what normalization produces (it is serialized and
 * parsed back and must compare equal), or it is refused — never coerced.
 */
export function createAyasTechnologyRegister(candidates: readonly AyasTechnologyCandidate[] = []): AyasTechnologyRegister {
  if (!isDenseArray(candidates)) throw new AyasTechnologyError("AYAS_TECHNOLOGY_REGISTER_INVALID", "candidates must be a list");
  const checked = candidates.map((candidate) => {
    let parsed: AyasTechnologyCandidate;
    try { parsed = parseCandidate(candidateToPersisted(candidate)); } catch (error) {
      if (error instanceof AyasTechnologyError) throw error;
      throw new AyasTechnologyError("AYAS_TECHNOLOGY_REGISTER_INVALID", "candidate is malformed");
    }
    if (ayasTechnologyCanonicalJson(parsed) !== ayasTechnologyCanonicalJson(candidate)) throw new AyasTechnologyError("AYAS_TECHNOLOGY_REGISTER_INVALID", "candidate is not in normalized form");
    return parsed;
  });
  return produce(checked);
}

/** Internal fast path: a register this module produced is trusted; anything else is re-checked at the boundary. */
export function assertAyasTechnologyRegister(register: AyasTechnologyRegister): AyasTechnologyRegister {
  if (isPlainObject(register) && PRODUCED_REGISTERS.has(register)) return register;
  if (!isPlainObject(register) || register.schemaVersion !== AYAS_TECHNOLOGY_SCHEMA_VERSION) throw new AyasTechnologyError("AYAS_TECHNOLOGY_REGISTER_INVALID", "register is malformed");
  return createAyasTechnologyRegister(register.candidates);
}

const shares = (a: readonly string[], b: readonly string[]) => a.some((item) => b.includes(item));
const ecosystemOf = (anchor: string) => anchor.slice(0, anchor.indexOf(":"));
/** Two identities contradict each other on a strong anchor: different repositories, or different packages in the same ecosystem. */
export function ayasTechnologyAnchorsConflict(a: AyasTechnologyAnchors, b: AyasTechnologyAnchors): boolean {
  if (a.repositories.length > 0 && b.repositories.length > 0 && !shares(a.repositories, b.repositories)) return true;
  return a.packages.some((left) => !b.packages.includes(left) && b.packages.some((right) => ecosystemOf(right) === ecosystemOf(left)))
    && !shares(a.packages, b.packages);
}
/**
 * Two records are in identity conflict when they share a name but no strong
 * anchor and contradict each other on one: a possible impersonation. Nothing
 * tells which one is genuine, so the relation is symmetric and depends only on
 * the two records as they are now, never on which one arrived first.
 */
export function ayasTechnologyIdentitiesConflict(a: AyasTechnologyAnchors, b: AyasTechnologyAnchors): boolean {
  return shares(a.names, b.names) && !shares(a.packages, b.packages) && !shares(a.repositories, b.repositories) && ayasTechnologyAnchorsConflict(a, b);
}
const WATCH_RANK: Readonly<Record<AyasTechnologyWatchState, number>> = { HANDED_OFF: 3, DISMISSED: 2, SURFACED: 1, WATCHING: 0 };
/** The established record of a technology: the one furthest along in the watch, then the earliest, then the lowest key. */
export function ayasTechnologyCanonicalOrder(a: AyasTechnologyCandidate, b: AyasTechnologyCandidate): number {
  return WATCH_RANK[b.watch.state] - WATCH_RANK[a.watch.state] || a.createdAt.localeCompare(b.createdAt) || a.technologyKey.localeCompare(b.technologyKey);
}

function boundedUnion(prior: readonly string[], added: readonly string[], issues: Issues): string[] {
  const merged = uniqueSorted([...prior, ...added]);
  if (merged.length > AYAS_TECHNOLOGY_LIMITS.anchorsPerKind) {
    issues.push("ANCHORS_TRUNCATED");
    return uniqueSorted([...prior, ...merged.filter((item) => !prior.includes(item))].slice(0, AYAS_TECHNOLOGY_LIMITS.anchorsPerKind));
  }
  return merged;
}

function mergeIdentity(target: AyasTechnologyIdentity, incoming: AyasTechnologyIdentity, issues: Issues): AyasTechnologyIdentity {
  let { category, categoryKey } = target;
  if (target.category === "UNKNOWN" && incoming.category !== "UNKNOWN") { category = incoming.category; categoryKey = null; }
  else if (target.category !== "UNKNOWN" && incoming.category !== "UNKNOWN" && target.category !== incoming.category) issues.push("CATEGORY_CONFLICT");
  else if (target.category === "UNKNOWN" && target.categoryKey === null && incoming.categoryKey !== null) categoryKey = incoming.categoryKey;
  const packages: string[] = [...target.anchors.packages];
  for (const anchor of incoming.anchors.packages) {
    if (packages.includes(anchor)) continue;
    // A second package in an ecosystem the technology already has an identity in is a contradiction, never adopted.
    if (packages.some((existing) => ecosystemOf(existing) === ecosystemOf(anchor))) { issues.push("IDENTITY_ANCHOR_CONFLICT"); continue; }
    packages.push(anchor);
  }
  const repositories: string[] = [...target.anchors.repositories];
  for (const anchor of incoming.anchors.repositories) {
    if (repositories.includes(anchor)) continue;
    if (repositories.length > 0) { issues.push("IDENTITY_ANCHOR_CONFLICT"); continue; }
    repositories.push(anchor);
  }
  return Object.freeze({
    displayName: target.displayName, nameSlug: target.nameSlug, vendor: target.vendor ?? incoming.vendor, category, categoryKey,
    domainKey: target.domainKey ?? incoming.domainKey,
    anchors: Object.freeze({
      names: boundedUnion(target.anchors.names, incoming.anchors.names, issues),
      packages: boundedUnion(target.anchors.packages, packages, issues),
      repositories: boundedUnion(target.anchors.repositories, repositories, issues),
      hosts: boundedUnion(target.anchors.hosts, incoming.anchors.hosts, issues),
    }),
  });
}

/**
 * Bounded evidence. Only claims that are superseded BY THE SAME SOURCE are
 * compacted: a release older than a newer release from the same publisher,
 * and an existence claim repeated by the same publisher. No restrictive claim
 * is ever compacted. When that is not enough, the new claims are not stored
 * and EVIDENCE_CAPACITY_REACHED blocks the candidate: bounded, never laxer.
 */
function boundEvidence(evidence: AyasTechnologyEvidence[], issues: Issues, at: string, prior: AyasTechnologyCandidate["compaction"], added: ReadonlySet<string>): { evidence: AyasTechnologyEvidence[]; compaction: AyasTechnologyCandidate["compaction"] } {
  const limit = AYAS_TECHNOLOGY_LIMITS.candidateEvidence;
  if (evidence.length <= limit) return { evidence, compaction: prior };
  const keyOf = (e: AyasTechnologyEvidence) => describeAyasTechnologySource(e.source.url)?.independenceKey ?? e.source.url;
  const sameClass = (a: AyasTechnologyEvidence, b: AyasTechnologyEvidence) => keyOf(a) === keyOf(b) && a.source.sourceClass === b.source.sourceClass && a.extraction === b.extraction && a.origin === b.origin;
  const compactable = evidence.filter((e) => {
    const claim = e.claim;
    if (claim.kind === "RELEASE") return evidence.some((other) => other !== e && other.claim.kind === "RELEASE" && sameClass(other, e) && (compareAyasTechnologyVersions(other.claim.version, claim.version) ?? 0) > 0);
    if (claim.kind === "EXISTS") return evidence.some((other) => other !== e && other.claim.kind === "EXISTS" && sameClass(other, e) && other.lastObservedAt > e.lastObservedAt);
    return false;
  }).sort((a, b) => {
    if (a.claim.kind === "RELEASE" && b.claim.kind === "RELEASE") return (compareAyasTechnologyVersions(a.claim.version, b.claim.version) ?? 0) || a.evidenceId.localeCompare(b.evidenceId);
    return a.lastObservedAt.localeCompare(b.lastObservedAt) || a.evidenceId.localeCompare(b.evidenceId);
  });
  const remove = new Set(compactable.slice(0, evidence.length - limit).map((e) => e.evidenceId));
  let kept = evidence.filter((e) => !remove.has(e.evidenceId));
  const compaction = remove.size > 0 ? Object.freeze({ removed: prior.removed + remove.size, lastAt: at }) : prior;
  if (kept.length > limit) {
    issues.push("EVIDENCE_CAPACITY_REACHED");
    const overflow = kept.length - limit;
    // New claims that could only resolve an uncertainty go first; a dropped security claim is reported, never silent.
    const security = (e: AyasTechnologyEvidence) => SECURITY_KINDS.has(e.claim.kind) ? 1 : 0;
    const dropped = kept.filter((e) => added.has(e.evidenceId)).sort((a, b) => security(a) - security(b) || b.evidenceId.localeCompare(a.evidenceId)).slice(0, overflow);
    if (dropped.some((e) => security(e) === 1)) issues.push("SECURITY_EVIDENCE_UNREADABLE");
    const drop = new Set(dropped.map((e) => e.evidenceId));
    kept = kept.filter((e) => !drop.has(e.evidenceId));
    if (kept.length > limit) kept = kept.slice(0, limit);
  }
  return { evidence: kept, compaction };
}

export interface AyasTechnologyIngestResult {
  readonly register: AyasTechnologyRegister;
  readonly technologyKey: string;
  readonly outcome: "CREATED" | "UPDATED" | "REOBSERVED";
  readonly added: number;
  readonly reobserved: number;
}

/**
 * Routes an observation to the technology it is about. A shared package or
 * repository anchor is the same technology, whatever the URL or wording; a
 * name match merges only when no strong anchor contradicts it. A name match
 * WITH a contradicting anchor is a possible impersonation: it becomes its own
 * candidate. The conflict is NOT recorded here — that would mark whichever
 * record arrived second — but derived from the whole register at assessment
 * time (`ayasTechnologyIdentitiesConflict`), for both records alike. Evidence is append-only
 * (a re-seen claim only extends its observation window), issues and signals
 * only accumulate, and nothing is ever deleted except bounded same-source
 * compaction.
 */
export function ingestAyasTechnologyObservation(register: AyasTechnologyRegister, observation: AyasTechnologyObservation): AyasTechnologyIngestResult {
  const checked = assertAyasTechnologyRegister(register);
  if (!isPlainObject(observation) || !PRODUCED_OBSERVATIONS.has(observation)) throw new AyasTechnologyError("AYAS_TECHNOLOGY_INVALID_OBSERVATION", "observations must come from normalizeAyasTechnologyObservation");
  const incoming = observation.identity;
  const byOrder = (list: AyasTechnologyCandidate[]) => [...list].sort(ayasTechnologyCanonicalOrder);
  const strong = byOrder(checked.candidates.filter((c) => shares(c.identity.anchors.packages, incoming.anchors.packages) || shares(c.identity.anchors.repositories, incoming.anchors.repositories)));
  const named = byOrder(checked.candidates.filter((c) => shares(c.identity.anchors.names, incoming.anchors.names)));
  const compatible = named.filter((c) => !ayasTechnologyAnchorsConflict(c.identity.anchors, incoming.anchors));
  const issues: Issues = [...observation.issues];
  let target: AyasTechnologyCandidate | undefined = strong[0] ?? compatible[0];
  if (strong.length > 1 || (strong.length === 0 && compatible.length > 1)) issues.push("IDENTITY_AMBIGUOUS");

  if (!target) {
    const technologyKey = deriveKey(incoming.anchors);
    if (checked.candidates.some((c) => c.technologyKey === technologyKey)) throw new AyasTechnologyError("AYAS_TECHNOLOGY_REGISTER_INVALID", "technology key collision");
    if (checked.candidates.length >= AYAS_TECHNOLOGY_LIMITS.candidates) throw new AyasTechnologyError("AYAS_TECHNOLOGY_REGISTER_LIMIT", "register is full; no candidate is evicted");
    const bounded = boundEvidence([...observation.evidence], issues, observation.observedAt, Object.freeze({ removed: 0, lastAt: null }), new Set(observation.evidence.map((e) => e.evidenceId)));
    target = Object.freeze({
      technologyKey, createdAt: observation.observedAt, identity: incoming, evidence: Object.freeze(bounded.evidence), compaction: bounded.compaction, watch: emptyWatch(),
      issues: Object.freeze(uniqueSorted(issues)), instructionSignals: observation.instructionSignals, authority: "NONE" as const,
    });
    return { register: produce([...checked.candidates, target]), technologyKey, outcome: "CREATED", added: bounded.evidence.length, reobserved: 0 };
  }

  const prior = target;
  const identity = mergeIdentity(prior.identity, incoming, issues);
  const merged = new Map(prior.evidence.map((e) => [e.evidenceId, e]));
  const addedIds = new Set<string>();
  let reobserved = 0;
  for (const item of observation.evidence) {
    const existing = merged.get(item.evidenceId);
    if (!existing) { merged.set(item.evidenceId, item); addedIds.add(item.evidenceId); continue; }
    reobserved += 1;
    merged.set(item.evidenceId, Object.freeze({
      ...existing,
      firstObservedAt: item.firstObservedAt < existing.firstObservedAt ? item.firstObservedAt : existing.firstObservedAt,
      lastObservedAt: item.lastObservedAt > existing.lastObservedAt ? item.lastObservedAt : existing.lastObservedAt,
    }));
  }
  const bounded = boundEvidence([...merged.values()].sort((a, b) => a.evidenceId.localeCompare(b.evidenceId)), issues, observation.observedAt, prior.compaction, addedIds);
  const next: AyasTechnologyCandidate = Object.freeze({
    ...prior,
    createdAt: observation.observedAt < prior.createdAt ? observation.observedAt : prior.createdAt,
    identity,
    evidence: Object.freeze(bounded.evidence),
    compaction: bounded.compaction,
    issues: Object.freeze(uniqueSorted([...prior.issues, ...issues])),
    instructionSignals: Object.freeze(uniqueSorted([...prior.instructionSignals, ...observation.instructionSignals])),
  });
  const added = bounded.evidence.filter((e) => addedIds.has(e.evidenceId)).length;
  const changed = added > 0 || ayasTechnologyCanonicalJson([next.identity, next.issues, next.instructionSignals, next.createdAt, next.compaction]) !== ayasTechnologyCanonicalJson([prior.identity, prior.issues, prior.instructionSignals, prior.createdAt, prior.compaction]);
  return {
    register: produce(checked.candidates.map((c) => c.technologyKey === prior.technologyKey ? next : c)),
    technologyKey: prior.technologyKey, outcome: changed ? "UPDATED" : "REOBSERVED", added, reobserved,
  };
}

// ---------------------------------------------------------------- watch record

const refuseRecord = (reason: string): never => { throw new AyasTechnologyError("AYAS_TECHNOLOGY_REGISTER_INVALID", `watch record is invalid: ${reason}`); };

function parseWatch(value: unknown): AyasTechnologyWatchRecord {
  if (!isPlainObject(value)) return refuseRecord("not an object");
  const fields = ["state", "surfaced", "surfaceCount", "handoff", "dismissed", "reopenCount", "history", "historyCompacted"];
  if (Object.keys(value).some((field) => !fields.includes(field)) || fields.some((field) => !(field in value))) refuseRecord("fields");
  const state: AyasTechnologyWatchState = oneOf(AYAS_TECHNOLOGY_WATCH_STATES, value.state) ? value.state : refuseRecord("state");
  const count = (field: unknown, max: number) => typeof field === "number" && Number.isSafeInteger(field) && field >= 0 && field <= max;
  if (!count(value.surfaceCount, AYAS_TECHNOLOGY_SURFACE_LIMIT) || !count(value.reopenCount, AYAS_TECHNOLOGY_REOPEN_LIMIT) || !count(value.historyCompacted, Number.MAX_SAFE_INTEGER)) refuseRecord("counts");
  const iso = (field: unknown) => typeof field === "string" && ayasTechnologyIso(field) === field;
  const fingerprint = (field: unknown) => typeof field === "string" && FINGERPRINT.test(field);
  const record = <T>(field: unknown, keys: readonly string[], valid: (item: Obj) => boolean): T | null => {
    if (field === null) return null;
    if (!isPlainObject(field) || Object.keys(field).length !== keys.length || !keys.every((key) => key in field) || !valid(field)) return refuseRecord("record");
    return Object.freeze({ ...field }) as T;
  };
  const surfaced = record<AyasTechnologyWatchRecord["surfaced"]>(value.surfaced, ["at", "fingerprint", "until"], (r) => iso(r.at) && fingerprint(r.fingerprint) && r.until === ayasTechnologyAddDays(r.at as string, AYAS_TECHNOLOGY_COOLDOWN_DAYS));
  const handoff = record<AyasTechnologyWatchRecord["handoff"]>(value.handoff, ["at", "fingerprint", "opportunityId"], (r) => iso(r.at) && fingerprint(r.fingerprint) && typeof r.opportunityId === "string" && OPPORTUNITY_ID.test(r.opportunityId));
  const dismissed = record<AyasTechnologyWatchRecord["dismissed"]>(value.dismissed, ["at", "fingerprint"], (r) => iso(r.at) && fingerprint(r.fingerprint));
  if (!isDenseArray(value.history)) return refuseRecord("history");
  if (value.history.length > AYAS_TECHNOLOGY_LIMITS.history) refuseRecord("history exceeds its limit; it is never truncated on load");
  const history: AyasTechnologyWatchEntry[] = value.history.map((entry: unknown) => {
    if (!isPlainObject(entry) || Object.keys(entry).length !== 4 || !iso(entry.at) || !oneOf(["SURFACED", "HANDED_OFF", "DISMISSED"] as const, entry.to)
      || typeof entry.reasonCode !== "string" || !REASON_CODE.test(entry.reasonCode) || !fingerprint(entry.fingerprint)) return refuseRecord("history entry");
    return Object.freeze({ at: entry.at as string, to: entry.to, reasonCode: entry.reasonCode, fingerprint: entry.fingerprint as string });
  });
  for (let i = 1; i < history.length; i += 1) if (history[i]!.at < history[i - 1]!.at) refuseRecord("history goes backwards");
  const last = history.at(-1);
  if (state === "WATCHING") {
    if (surfaced || handoff || dismissed || history.length > 0 || value.historyCompacted !== 0 || value.surfaceCount !== 0 || value.reopenCount !== 0) refuseRecord("a watching record carries no transitions");
  } else {
    if (!last || last.to !== state) refuseRecord("state does not match its history");
    const current = state === "SURFACED" ? surfaced : state === "HANDED_OFF" ? handoff : dismissed;
    if (!current || current.at !== last!.at || current.fingerprint !== last!.fingerprint) refuseRecord("state is missing its record");
  }
  if ((surfaced === null) !== (value.surfaceCount === 0)) refuseRecord("surface count");
  return Object.freeze({ state, surfaced, surfaceCount: value.surfaceCount as number, handoff, dismissed, reopenCount: value.reopenCount as number, history: Object.freeze(history), historyCompacted: value.historyCompacted as number });
}

/**
 * The only way a watch record changes (used by the transitions in
 * `AyasTechnologyWatch.ts`). The new record must be valid, keep the prior
 * history as its prefix (modulo bounded compaction), and never lower a count
 * or roll a record back.
 */
export function updateAyasTechnologyWatchRecord(register: AyasTechnologyRegister, technologyKey: string, watch: AyasTechnologyWatchRecord): AyasTechnologyRegister {
  const checked = assertAyasTechnologyRegister(register);
  const prior = checked.candidates.find((c) => c.technologyKey === technologyKey);
  if (!prior) throw new AyasTechnologyError("AYAS_TECHNOLOGY_TRANSITION_REFUSED", "unknown technology");
  const next = parseWatch(JSON.parse(JSON.stringify(watch)) as unknown);
  const was = prior.watch;
  const dropped = next.historyCompacted - was.historyCompacted;
  const expected = [...was.history, next.history.at(-1)].slice(Math.max(0, dropped));
  if (dropped < 0 || next.history.length !== expected.length || ayasTechnologyCanonicalJson(next.history) !== ayasTechnologyCanonicalJson(expected)
    || next.reopenCount < was.reopenCount || (was.handoff && (!next.handoff || next.handoff.at < was.handoff.at)) || (was.dismissed && (!next.dismissed || next.dismissed.at < was.dismissed.at))
    || (was.surfaced && (!next.surfaced || next.surfaced.at < was.surfaced.at))) {
    throw new AyasTechnologyError("AYAS_TECHNOLOGY_TRANSITION_REFUSED", "the watch record is append-only");
  }
  const candidate: AyasTechnologyCandidate = Object.freeze({ ...prior, watch: next });
  return produce(checked.candidates.map((c) => c.technologyKey === technologyKey ? candidate : c));
}

// ---------------------------------------------------------------- persistence

const CANDIDATE_FIELDS = ["technologyKey", "createdAt", "identity", "evidence", "compaction", "watch", "issues", "instructionSignals"];
const PERSISTED_IDENTITY_FIELDS = ["displayName", "vendor", "category", "categoryKey", "domainKey", "anchors"];

function candidateToPersisted(candidate: AyasTechnologyCandidate): Obj {
  return {
    technologyKey: candidate.technologyKey,
    createdAt: candidate.createdAt,
    identity: {
      displayName: candidate.identity.displayName, vendor: candidate.identity.vendor, category: candidate.identity.category,
      categoryKey: candidate.identity.categoryKey, domainKey: candidate.identity.domainKey,
      anchors: { names: [...candidate.identity.anchors.names], packages: [...candidate.identity.anchors.packages], repositories: [...candidate.identity.anchors.repositories], hosts: [...candidate.identity.anchors.hosts] },
    },
    evidence: candidate.evidence.map((e) => ({
      origin: e.origin, extraction: e.extraction, source: { ...e.source }, claim: claimInput(e.claim), statement: e.statement, researchFindingId: e.researchFindingId,
      firstObservedAt: e.firstObservedAt, lastObservedAt: e.lastObservedAt,
    })),
    compaction: { ...candidate.compaction },
    watch: JSON.parse(JSON.stringify(candidate.watch)) as unknown,
    issues: [...candidate.issues],
    instructionSignals: [...candidate.instructionSignals],
  };
}

function parseIdentity(value: unknown, scanner: Scanner): AyasTechnologyIdentity {
  const fail = (reason: string): never => { throw new AyasTechnologyError("AYAS_TECHNOLOGY_REGISTER_INVALID", `identity is invalid: ${reason}`); };
  if (!isPlainObject(value) || Object.keys(value).length !== PERSISTED_IDENTITY_FIELDS.length || !PERSISTED_IDENTITY_FIELDS.every((field) => field in value)) return fail("fields");
  if (typeof value.displayName !== "string" || text(value.displayName, AYAS_TECHNOLOGY_LIMITS.nameText) !== value.displayName) fail("display name");
  scanner.scan(value.displayName);
  const nameSlug = ayasTechnologySlug(value.displayName as string);
  if (!nameSlug) fail("display name");
  if (value.vendor !== null && (typeof value.vendor !== "string" || !SLUG.test(value.vendor))) fail("vendor");
  if (!oneOf(AYAS_TECHNOLOGY_CATEGORIES, value.category)) fail("category");
  if (value.categoryKey !== null && (typeof value.categoryKey !== "string" || !SLUG.test(value.categoryKey) || value.category !== "UNKNOWN")) fail("category key");
  if (value.domainKey !== null && (typeof value.domainKey !== "string" || !DOMAIN_KEY.test(value.domainKey))) fail("domain key");
  const anchors = value.anchors;
  if (!isPlainObject(anchors) || Object.keys(anchors).length !== 4) return fail("anchors");
  const list = (field: string, valid: (item: string) => boolean): string[] => {
    const items = anchors[field];
    if (!isDenseArray(items) || items.length > AYAS_TECHNOLOGY_LIMITS.anchorsPerKind || !items.every((item) => typeof item === "string" && valid(item))) return fail(`anchors.${field}`);
    const sorted = uniqueSorted(items as string[]);
    if (sorted.length !== items.length || sorted.some((item, i) => item !== items[i])) fail(`anchors.${field} order`);
    return sorted;
  };
  const names = list("names", (item) => /^(-|[a-z0-9]+(-[a-z0-9]+)*)\/[a-z0-9]+(-[a-z0-9]+)*$/.test(item));
  if (names.length === 0) fail("anchors.names");
  const packages = list("packages", (item) => { const [ecosystem, ...rest] = item.split(":"); const name = rest.join(":"); return oneOf(AYAS_TECHNOLOGY_PACKAGE_ECOSYSTEMS, ecosystem?.toUpperCase()) && ecosystem === ecosystem!.toLowerCase() && ayasTechnologyPackageAnchor(ecosystem!.toUpperCase() as AyasTechnologyPackageEcosystem, name) === item; });
  const repositories = list("repositories", (item) => ANCHOR_REPOSITORY.test(item));
  const hosts = list("hosts", (item) => ANCHOR_HOST.test(item));
  return Object.freeze({
    displayName: value.displayName as string, nameSlug, vendor: value.vendor as string | null, category: value.category as AyasTechnologyCategory,
    categoryKey: value.categoryKey as string | null, domainKey: value.domainKey as string | null,
    anchors: Object.freeze({ names, packages, repositories, hosts }),
  });
}

/**
 * Persisted records are never fresh input: every field must be present and
 * well-formed. Carried issues and signals only ADD; re-normalizing the stored
 * evidence must not surface anything the record did not already carry
 * (otherwise the record was edited or corrupted and is refused). A carried
 * issue or signal outside the vocabulary becomes a BLOCKING issue.
 */
function parseCandidate(value: unknown): AyasTechnologyCandidate {
  const fail = (reason: string): never => { throw new AyasTechnologyError("AYAS_TECHNOLOGY_REGISTER_INVALID", `candidate is invalid: ${reason}`); };
  if (!isPlainObject(value)) return fail("not an object");
  if (Object.keys(value).length !== CANDIDATE_FIELDS.length || !CANDIDATE_FIELDS.every((field) => field in value)) fail("fields");
  if (typeof value.technologyKey !== "string" || !TECHNOLOGY_KEY.test(value.technologyKey)) fail("key");
  if (typeof value.createdAt !== "string" || ayasTechnologyIso(value.createdAt) !== value.createdAt) fail("createdAt");
  const scanner = makeScanner();
  const identity = parseIdentity(value.identity, scanner);
  const carriedList = (field: unknown, max: number, name: string): unknown[] => {
    if (!isDenseArray(field)) return fail(`${name} must be a list`);
    if (field.length > max) fail(`${name} exceed their closed vocabulary; they are never truncated`);
    return field;
  };
  const carried: Issues = carriedList(value.issues, Object.keys(AYAS_TECHNOLOGY_ISSUE_SEVERITY).length, "issues").map((code) => isIssue(code) ? code : "ISSUE_UNRECOGNIZED");
  const signals: AyasResearchInstructionSignal[] = [];
  for (const signal of carriedList(value.instructionSignals, INSTRUCTION_SIGNALS.length, "instruction signals")) {
    if (oneOf(INSTRUCTION_SIGNALS, signal)) signals.push(signal); else carried.push("SIGNAL_UNRECOGNIZED");
  }
  if (!isDenseArray(value.evidence) || value.evidence.length > AYAS_TECHNOLOGY_LIMITS.candidateEvidence) return fail("evidence");
  const rederived: Issues = [];
  const evidence = new Map<string, AyasTechnologyEvidence>();
  for (const item of value.evidence as unknown[]) {
    if (!isPlainObject(item) || !oneOf(AYAS_TECHNOLOGY_ORIGINS, item.origin)) return fail("evidence item");
    const first = ayasTechnologyIso(item.firstObservedAt); const last = ayasTechnologyIso(item.lastObservedAt);
    if (first === null || last === null || first !== item.firstObservedAt || last !== item.lastObservedAt || first > last) return fail("evidence observation window");
    // Persisted evidence is never fresh input: a deleted field would otherwise read as its default.
    for (const field of PERSISTED_EVIDENCE_FIELDS) if (!(field in item)) fail("evidence item fields");
    if (!isPlainObject(item.source) || !["url", "sourceClass", "publishedAt"].every((field) => field in (item.source as Obj))) fail("evidence source fields");
    const normalized = normalizeEvidenceItem(item, { origin: item.origin, firstObservedAt: first, lastObservedAt: last, issues: rederived, scanner, fields: PERSISTED_EVIDENCE_FIELDS });
    if (!normalized || evidence.has(normalized.evidenceId) || normalized.statement !== item.statement) return fail("evidence item");
    if (ayasTechnologyCanonicalJson(claimInput(normalized.claim)) !== ayasTechnologyCanonicalJson(item.claim)) fail("evidence claim is not in normalized form");
    if (normalized.source.url !== (item.source as Obj).url) fail("evidence source is not in normalized form");
    evidence.set(normalized.evidenceId, normalized);
  }
  if (rederived.some((issue) => !carried.includes(issue))) fail("stored evidence no longer normalizes cleanly");
  if (scanner.oversized()) fail("stored text is oversized");
  const compaction = value.compaction;
  if (!isPlainObject(compaction) || Object.keys(compaction).length !== 2 || typeof compaction.removed !== "number" || !Number.isSafeInteger(compaction.removed) || compaction.removed < 0
    || (compaction.lastAt === null ? compaction.removed !== 0 : typeof compaction.lastAt !== "string" || ayasTechnologyIso(compaction.lastAt) !== compaction.lastAt || compaction.removed === 0)) return fail("compaction");
  const list = [...evidence.values()].sort((a, b) => a.evidenceId.localeCompare(b.evidenceId));
  if (list.some((e) => e.firstObservedAt < (value.createdAt as string))) fail("evidence precedes the record");
  for (const e of list) if (!EVIDENCE_ID.test(e.evidenceId)) fail("evidence id");
  return Object.freeze({
    technologyKey: value.technologyKey as string,
    createdAt: value.createdAt as string,
    identity,
    evidence: Object.freeze(list),
    compaction: Object.freeze({ removed: compaction.removed as number, lastAt: compaction.lastAt as string | null }),
    watch: parseWatch(value.watch),
    issues: Object.freeze(uniqueSorted(carried)),
    // Re-scanned on load as well: a signal can be added by a round trip, never removed.
    instructionSignals: Object.freeze(uniqueSorted([...signals, ...scanner.signals()])),
    authority: "NONE" as const,
  });
}

/** The content digest of a serialized register body (key-sorted JSON of `{schemaVersion, candidates}`). */
export function computeAyasTechnologyRegisterDigest(body: { readonly schemaVersion: unknown; readonly candidates: unknown }): string {
  return sha256(ayasTechnologyCanonicalJson({ schemaVersion: body.schemaVersion, candidates: body.candidates }));
}

export function serializeAyasTechnologyRegister(register: AyasTechnologyRegister): AyasTechnologySerializedRegister {
  const checked = assertAyasTechnologyRegister(register);
  const candidates = checked.candidates.map(candidateToPersisted);
  return { schemaVersion: AYAS_TECHNOLOGY_SCHEMA_VERSION, candidates, integrity: { algorithm: "sha256", digest: computeAyasTechnologyRegisterDigest({ schemaVersion: AYAS_TECHNOLOGY_SCHEMA_VERSION, candidates }) } };
}

/** Versioned, bounded, fail-closed load. The digest is checked before anything is interpreted; `parse(serialize(r))` equals `r`. */
export function parseAyasTechnologyRegister(value: unknown): AyasTechnologyRegister {
  if (!isPlainObject(value)) throw new AyasTechnologyError("AYAS_TECHNOLOGY_REGISTER_INVALID", "register must be an object");
  if (Object.keys(value).some((field) => !["schemaVersion", "candidates", "integrity"].includes(field))) throw new AyasTechnologyError("AYAS_TECHNOLOGY_REGISTER_INVALID", "register holds an unknown field");
  const integrity = value.integrity;
  if (!isPlainObject(integrity) || Object.keys(integrity).length !== 2 || integrity.algorithm !== "sha256" || typeof integrity.digest !== "string" || !FINGERPRINT.test(integrity.digest)) {
    throw new AyasTechnologyError("AYAS_TECHNOLOGY_INTEGRITY_MISMATCH", "register integrity record is missing or malformed");
  }
  if (computeAyasTechnologyRegisterDigest({ schemaVersion: value.schemaVersion, candidates: value.candidates }) !== integrity.digest) {
    throw new AyasTechnologyError("AYAS_TECHNOLOGY_INTEGRITY_MISMATCH", "register content does not match its digest");
  }
  if (value.schemaVersion !== AYAS_TECHNOLOGY_SCHEMA_VERSION) throw new AyasTechnologyError("AYAS_TECHNOLOGY_SCHEMA_MISMATCH", "unsupported register schema version");
  if (!isDenseArray(value.candidates)) throw new AyasTechnologyError("AYAS_TECHNOLOGY_REGISTER_INVALID", "candidates must be a list");
  if (value.candidates.length > AYAS_TECHNOLOGY_LIMITS.candidates) throw new AyasTechnologyError("AYAS_TECHNOLOGY_REGISTER_LIMIT", "register holds too many candidates");
  const candidates: AyasTechnologyCandidate[] = [];
  for (let i = 0; i < value.candidates.length; i += 1) candidates.push(parseCandidate(value.candidates[i]));
  return produce(candidates);
}
