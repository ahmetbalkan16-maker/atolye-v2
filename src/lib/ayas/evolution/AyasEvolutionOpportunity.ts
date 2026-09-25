import crypto from "node:crypto";

import { isAyasCapabilityCategory, type AyasCapabilityCategory } from "../../brain/autonomy/AyasCapabilityTaxonomy";
import { neutralizeAyasUntrustedText } from "../../brain/autonomy/AyasDeepAnalysis";
import {
  ayasResearchClaimTokenHashes, detectAyasResearchInstructionSignals, type AyasResearchInstructionSignal,
} from "../../brain/autonomy/AyasResearchImprovementLoop";
import { parseAyasCostClass, type AyasCostClass } from "../policy/AyasZeroCostPolicy";

/**
 * Stage 13 — the ONE canonical representation of an open-ended evolution
 * opportunity: a capability gap, improvement, new capability, extension,
 * replacement or retirement that AYAS can reason about without the feature
 * being known when this code was written.
 *
 * Open-ended does not mean unbounded. Capabilities are described with
 * machine keys plus closed descriptor vocabularies (class, IO kind, side
 * effect, resource kind, trust); no free-text field is ever read as a path,
 * command, tool, approval or authority. Every text field is neutralized,
 * bounded DATA, and the opportunity itself carries `authority: "NONE"`.
 * This module is pure: no I/O, no process, no network, no store.
 */
export const AYAS_EVOLUTION_SCHEMA_VERSION = "1" as const;

export const AYAS_EVOLUTION_LIMITS = Object.freeze({
  opportunities: 500, evidence: 24, prerequisites: 32, constraints: 24, modules: 40, flows: 16,
  criteria: 16, suites: 16, nonGoals: 12, consequences: 12, io: 12, resources: 16, relations: 16,
  history: 64, reopen: 8, shortText: 160, longText: 600,
});

export const AYAS_EVOLUTION_KINDS = ["CAPABILITY_GAP", "IMPROVEMENT", "NEW_CAPABILITY", "EXTENSION", "REPLACEMENT", "RETIREMENT"] as const;
export type AyasEvolutionKind = typeof AYAS_EVOLUTION_KINDS[number];

/** Which code path produced the record. Set by the producer, never parsed from text. */
export const AYAS_EVOLUTION_ORIGINS = ["OWNER", "LOCAL_EVALUATOR", "LOCAL_RUNTIME", "DEVELOPER_REVIEW", "SECURITY_REVIEW", "RESEARCH_LOOP", "AYAS_REFLECTION"] as const;
export type AyasEvolutionOrigin = typeof AYAS_EVOLUTION_ORIGINS[number];

export const AYAS_EVOLUTION_EVIDENCE_SOURCES = [
  "EVALUATION_FAILURE", "USER_CORRECTION", "REPEATED_TASK_FAILURE", "RESEARCH_RESULT", "DEVELOPER_FINDING",
  "SECURITY_FINDING", "CAPABILITY_ABSENCE", "RUNTIME_LIMITATION", "PRODUCTION_QUALITY_GAP", "BENCHMARK_REGRESSION",
  "OWNER_REQUEST", "AYAS_SUGGESTION",
] as const;
export type AyasEvolutionEvidenceSource = typeof AYAS_EVOLUTION_EVIDENCE_SOURCES[number];

/** Epistemic class is DERIVED from source, structure and origin — a caller cannot declare a fact. */
export type AyasEvolutionEpistemicClass = "OBSERVED_FACT" | "INFERENCE" | "RESEARCH_CLAIM" | "OWNER_REQUEST" | "HYPOTHESIS";
export type AyasEvolutionEvidenceTrust = "LOCAL_MEASUREMENT" | "LOCAL_OBSERVATION" | "OWNER_STATEMENT" | "UNTRUSTED_EXTERNAL" | "SELF_GENERATED";

export const AYAS_EVOLUTION_CAPABILITY_CLASSES = ["TOOL", "SKILL", "MODEL", "AGENT", "STORAGE_ADAPTER", "EVALUATOR", "PIPELINE_EXTENSION", "LIBRARY", "SERVICE_INTEGRATION", "UI_SURFACE", "POLICY", "OTHER"] as const;
export type AyasEvolutionCapabilityClass = typeof AYAS_EVOLUTION_CAPABILITY_CLASSES[number];

export const AYAS_EVOLUTION_IO_KINDS = ["TEXT", "AUDIO", "VIDEO", "IMAGE", "STRUCTURED_DATA", "SOURCE_CODE", "PROJECT_MANIFEST", "MEDIA_METADATA", "METRIC", "DOCUMENT", "OTHER"] as const;
export type AyasEvolutionIoKind = typeof AYAS_EVOLUTION_IO_KINDS[number];

export const AYAS_EVOLUTION_SIDE_EFFECTS = [
  "NONE", "READS_LOCAL_FILES", "WRITES_LOCAL_FILES", "WRITES_RUNTIME_STORAGE", "WRITES_SOURCE", "NETWORK_READ", "NETWORK_WRITE",
  "SPAWNS_PROCESS", "INSTALLS_DEPENDENCY", "SPENDS_MONEY", "PUBLISHES", "MODIFIES_POLICY", "UNKNOWN",
] as const;
export type AyasEvolutionSideEffect = typeof AYAS_EVOLUTION_SIDE_EFFECTS[number];

export const AYAS_EVOLUTION_RESOURCE_KINDS = ["FREE_LOCAL", "PAID_MODEL", "PAID_API", "EXTERNAL_ACCOUNT", "GPU_REQUIRED", "HOST_BINARY", "NETWORK_REQUIRED", "LOCAL_MODEL_WEIGHTS", "DISK_SPACE", "UNKNOWN"] as const;
export type AyasEvolutionResourceKind = typeof AYAS_EVOLUTION_RESOURCE_KINDS[number];

export const AYAS_EVOLUTION_TRUST_LEVELS = ["FIRST_PARTY_REVIEWED", "LOCAL_UNREVIEWED", "THIRD_PARTY", "UNKNOWN"] as const;
export type AyasEvolutionTrustLevel = typeof AYAS_EVOLUTION_TRUST_LEVELS[number];

export const AYAS_EVOLUTION_PREREQUISITE_KINDS = [
  "CAPABILITY", "TOOL", "SKILL", "MODEL", "AGENT", "HOST_BINARY", "DATA", "PROVIDER_CAPABILITY",
  "EXTERNAL_SERVICE", "EXTERNAL_ACCOUNT", "OWNER_PERMISSION", "OPPORTUNITY",
] as const;
export type AyasEvolutionPrerequisiteKind = typeof AYAS_EVOLUTION_PREREQUISITE_KINDS[number];

export const AYAS_EVOLUTION_CONSTRAINT_KINDS = [
  "REQUIRES_STORAGE_MIGRATION", "INCOMPATIBLE_WITH_STORAGE_SCHEMA", "CONFLICTS_WITH_APPROVAL_POLICY",
  "CONFLICTS_WITH_EXECUTION_POLICY", "CONFLICTS_WITH_SECURITY_POLICY", "INVALID_OFFLINE", "MUTUALLY_EXCLUSIVE_WITH",
  "BREAKS_BACKWARD_COMPATIBILITY",
] as const;
export type AyasEvolutionConstraintKind = typeof AYAS_EVOLUTION_CONSTRAINT_KINDS[number];

export const AYAS_EVOLUTION_COMPATIBILITY = ["BACKWARD_COMPATIBLE", "REQUIRES_MIGRATION", "BREAKING", "UNKNOWN"] as const;
export type AyasEvolutionCompatibility = typeof AYAS_EVOLUTION_COMPATIBILITY[number];

export const AYAS_EVOLUTION_RISK_LEVELS = ["NONE", "LOW", "MEDIUM", "HIGH", "UNKNOWN"] as const;
export type AyasEvolutionRiskLevel = typeof AYAS_EVOLUTION_RISK_LEVELS[number];
export const AYAS_EVOLUTION_RISK_DIMENSIONS = ["security", "privacy", "dataMutation", "execution", "externalDependency", "cost", "irreversibility", "authorityWidening"] as const;
export type AyasEvolutionRiskDimension = typeof AYAS_EVOLUTION_RISK_DIMENSIONS[number];
export type AyasEvolutionRisk = Readonly<Record<AyasEvolutionRiskDimension, AyasEvolutionRiskLevel>>;

export const AYAS_EVOLUTION_BASELINE_STRATEGIES = ["EXISTING_BENCHMARK", "NEW_DETERMINISTIC_EVALUATOR", "MANUAL_OWNER_REVIEW", "NONE"] as const;
export type AyasEvolutionBaselineStrategy = typeof AYAS_EVOLUTION_BASELINE_STRATEGIES[number];

/**
 * Authority an evolution would NEED. Each class names an existing owner or
 * policy path (see `AYAS_EVOLUTION_AUTHORITY_PATHS`); Stage 13 grants none
 * of them and adds no approval semantics of its own.
 */
export const AYAS_EVOLUTION_AUTHORITY_CLASSES = [
  "READ_ONLY", "EXPERIMENT_APPROVAL", "SOURCE_MUTATION_APPROVAL", "DEPENDENCY_INSTALL_APPROVAL", "EXTERNAL_SERVICE_APPROVAL",
  "PAID_PROVIDER_APPROVAL", "PRODUCTION_APPROVAL", "PUBLISH_APPROVAL", "SECURITY_POLICY_APPROVAL",
] as const;
export type AyasEvolutionAuthorityClass = typeof AYAS_EVOLUTION_AUTHORITY_CLASSES[number];

export const AYAS_EVOLUTION_AUTHORITY_PATHS: Readonly<Record<AyasEvolutionAuthorityClass, string>> = Object.freeze({
  READ_ONLY: "Stage 13 qualification itself; no owner action",
  EXPERIMENT_APPROVAL: "Stage 8: strategy registered by a reviewed commit in AyasResearchExperimentRegistry + research experiment admission",
  SOURCE_MUTATION_APPROVAL: "existing owner approval inbox (AyasApprovalInboxStore) + execution gate + registered mutation kind",
  DEPENDENCY_INSTALL_APPROVAL: "no AYAS path: owner-controlled install reviewed under the Stage 9 supply-chain rules",
  EXTERNAL_SERVICE_APPROVAL: "no AYAS path: owner decision outside AYAS; runtime still limited to registered sources",
  PAID_PROVIDER_APPROVAL: "AyasZeroCostPolicy denies; only an explicit owner policy change outside AYAS can allow spend",
  PRODUCTION_APPROVAL: "existing production acceptance gate (npm run production:acceptance:*)",
  PUBLISH_APPROVAL: "existing owner-driven YouTube publish path",
  SECURITY_POLICY_APPROVAL: "reviewed owner commit to the policy module; AYAS cannot alter security or execution policy",
});

export const AYAS_EVOLUTION_LIFECYCLE_STATES = [
  "OBSERVED", "INVESTIGATING", "QUALIFIED", "EXPERIMENT_READY", "PROPOSAL_READY", "HANDED_OFF",
  "DEFERRED", "REJECTED", "SUPERSEDED", "RETIRED",
] as const;
export type AyasEvolutionLifecycleState = typeof AYAS_EVOLUTION_LIFECYCLE_STATES[number];
export const AYAS_EVOLUTION_TERMINAL_STATES: ReadonlySet<AyasEvolutionLifecycleState> = new Set(["REJECTED", "SUPERSEDED", "RETIRED"]);

/**
 * Bounded lifecycle. There is deliberately no APPROVED or EXECUTED state:
 * approval and execution live in the existing inbox and gate. Terminal
 * states have no outgoing edge; every other state can reach a terminal one.
 */
export const AYAS_EVOLUTION_TRANSITIONS: Readonly<Record<AyasEvolutionLifecycleState, readonly AyasEvolutionLifecycleState[]>> = Object.freeze({
  OBSERVED: ["INVESTIGATING", "QUALIFIED", "DEFERRED", "REJECTED", "SUPERSEDED", "RETIRED"],
  INVESTIGATING: ["QUALIFIED", "DEFERRED", "REJECTED", "SUPERSEDED", "RETIRED"],
  QUALIFIED: ["EXPERIMENT_READY", "PROPOSAL_READY", "INVESTIGATING", "DEFERRED", "REJECTED", "SUPERSEDED", "RETIRED"],
  EXPERIMENT_READY: ["HANDED_OFF", "INVESTIGATING", "DEFERRED", "REJECTED", "SUPERSEDED", "RETIRED"],
  PROPOSAL_READY: ["HANDED_OFF", "INVESTIGATING", "DEFERRED", "REJECTED", "SUPERSEDED", "RETIRED"],
  HANDED_OFF: ["INVESTIGATING", "REJECTED", "SUPERSEDED", "RETIRED"],
  DEFERRED: ["INVESTIGATING", "REJECTED", "SUPERSEDED", "RETIRED"],
  REJECTED: [],
  SUPERSEDED: [],
  RETIRED: [],
});

export interface AyasEvolutionBenchmarkRef {
  readonly benchmarkId: string;
  readonly dimension: string;
  readonly caseIds: readonly string[];
  readonly measuredAtHead: string;
  readonly evaluatorSha256: string;
}

export interface AyasEvolutionEvidence {
  readonly evidenceId: string;
  readonly source: AyasEvolutionEvidenceSource;
  readonly epistemicClass: AyasEvolutionEpistemicClass;
  readonly trust: AyasEvolutionEvidenceTrust;
  /** A local identifier such as `benchmark:<id>#<case>` or `finding:<id>`. Never resolved as a path or command. */
  readonly reference: string | null;
  readonly observedAt: string | null;
  /** Neutralized, bounded DATA. */
  readonly statement: string;
  readonly benchmark: AyasEvolutionBenchmarkRef | null;
  readonly occurrences: number | null;
  readonly researchFindingId: string | null;
}

export interface AyasEvolutionIo { readonly kind: AyasEvolutionIoKind; readonly key: string | null }
export interface AyasEvolutionResource { readonly kind: AyasEvolutionResourceKind; readonly costClass: AyasCostClass; readonly key: string | null }

export interface AyasEvolutionCapabilityDescriptor {
  /** Extensible dotted machine key (`<area>.<capability>`), not an enum entry. */
  readonly key: string;
  /** Extensible namespaced domain key (`<domain>` or `<domain>.<subdomain>`). */
  readonly domain: string;
  /** Optional link to the closed Stage 8 taxonomy; `null` for domains it does not know. */
  readonly knownCategory: AyasCapabilityCategory | null;
  readonly capabilityClass: AyasEvolutionCapabilityClass;
  readonly inputs: readonly AyasEvolutionIo[];
  readonly outputs: readonly AyasEvolutionIo[];
  /** Empty or absent declarations become `["UNKNOWN"]`, never `["NONE"]`. */
  readonly sideEffects: readonly AyasEvolutionSideEffect[];
  readonly resources: readonly AyasEvolutionResource[];
  readonly trustLevel: AyasEvolutionTrustLevel;
}

export interface AyasEvolutionPrerequisite { readonly kind: AyasEvolutionPrerequisiteKind; readonly key: string; readonly optional: boolean }
export interface AyasEvolutionConstraint { readonly kind: AyasEvolutionConstraintKind; readonly key: string | null }

export interface AyasEvolutionEvaluationPlan {
  readonly baselineStrategy: AyasEvolutionBaselineStrategy;
  readonly benchmarkId: string | null;
  readonly acceptanceCriteria: readonly string[];
  readonly heldOutCriteria: readonly string[];
  readonly regressionSuites: readonly string[];
}

export interface AyasEvolutionRelations {
  readonly supersedes: readonly string[];
  readonly supersededBy: string | null;
  readonly replacesCapabilities: readonly string[];
  readonly retiresCapabilities: readonly string[];
  readonly migratesFrom: readonly string[];
}

export interface AyasEvolutionTransitionRecord {
  readonly from: AyasEvolutionLifecycleState | null;
  readonly to: AyasEvolutionLifecycleState;
  readonly at: string;
  readonly actor: "OWNER" | "AYAS";
  readonly reasonCode: string;
  readonly reference: string | null;
}

export interface AyasEvolutionLifecycle {
  readonly state: AyasEvolutionLifecycleState;
  readonly history: readonly AyasEvolutionTransitionRecord[];
  readonly reopenCount: number;
  readonly deferredUntil: string | null;
}

export interface AyasEvolutionOpportunity {
  readonly schemaVersion: typeof AYAS_EVOLUTION_SCHEMA_VERSION;
  readonly opportunityId: string;
  readonly createdAt: string;
  readonly origin: AyasEvolutionOrigin;
  readonly kind: AyasEvolutionKind;
  readonly need: { readonly summary: string; readonly affectedCapabilityKeys: readonly string[]; readonly consequences: readonly string[] };
  readonly evidence: readonly AyasEvolutionEvidence[];
  readonly target: { readonly capability: AyasEvolutionCapabilityDescriptor; readonly intendedOutcome: string; readonly nonGoals: readonly string[] };
  readonly prerequisites: readonly AyasEvolutionPrerequisite[];
  readonly constraints: readonly AyasEvolutionConstraint[];
  readonly impact: { readonly affectedModules: readonly string[]; readonly affectedFlows: readonly string[]; readonly compatibility: AyasEvolutionCompatibility };
  /** As declared; the qualification engine can only RAISE these. Undeclared dimensions are UNKNOWN. */
  readonly declaredRisk: AyasEvolutionRisk;
  readonly evaluation: AyasEvolutionEvaluationPlan;
  readonly declaredAuthority: readonly AyasEvolutionAuthorityClass[];
  readonly relations: AyasEvolutionRelations;
  readonly lifecycle: AyasEvolutionLifecycle;
  readonly instructionSignals: readonly AyasResearchInstructionSignal[];
  /** Hashed need tokens, as in Stage 8; the need text itself is never used as a key. */
  readonly needTokenHashes: readonly string[];
  readonly normalizationIssues: readonly string[];
  readonly authority: "NONE";
}

/** Loose, untrusted input shape. Everything is re-validated by `normalizeAyasEvolutionOpportunity`. */
export interface AyasEvolutionEvidenceInput {
  readonly source?: unknown; readonly reference?: unknown; readonly observedAt?: unknown; readonly statement?: unknown;
  readonly benchmark?: unknown; readonly occurrences?: unknown; readonly researchFindingId?: unknown;
}
export interface AyasEvolutionOpportunityInput {
  readonly schemaVersion?: unknown;
  readonly opportunityId?: unknown;
  readonly createdAt?: unknown;
  readonly origin?: unknown;
  readonly kind?: unknown;
  readonly need?: { readonly summary?: unknown; readonly affectedCapabilityKeys?: unknown; readonly consequences?: unknown };
  readonly evidence?: readonly AyasEvolutionEvidenceInput[];
  readonly target?: { readonly capability?: Record<string, unknown>; readonly intendedOutcome?: unknown; readonly nonGoals?: unknown };
  readonly prerequisites?: unknown;
  readonly constraints?: unknown;
  readonly impact?: { readonly affectedModules?: unknown; readonly affectedFlows?: unknown; readonly compatibility?: unknown };
  readonly risk?: Record<string, unknown>;
  readonly evaluation?: Record<string, unknown>;
  readonly requiredAuthority?: unknown;
  readonly relations?: Record<string, unknown>;
  readonly lifecycle?: Record<string, unknown>;
  /** Carried across serialization so a round trip can only ADD issues and signals, never clear them. */
  readonly normalizationIssues?: unknown;
  readonly instructionSignals?: unknown;
}

export class AyasEvolutionError extends Error {
  constructor(readonly code:
    | "AYAS_EVOLUTION_INVALID_ID" | "AYAS_EVOLUTION_INVALID_TIME" | "AYAS_EVOLUTION_INVALID_TARGET" | "AYAS_EVOLUTION_SCHEMA_MISMATCH"
    | "AYAS_EVOLUTION_INVALID_ENUM" | "AYAS_EVOLUTION_REGISTER_LIMIT" | "AYAS_EVOLUTION_DUPLICATE_ID" | "AYAS_EVOLUTION_HISTORY_REWRITE"
    | "AYAS_EVOLUTION_TRANSITION_REFUSED" | "AYAS_EVOLUTION_SUPERSESSION_INVALID" | "AYAS_EVOLUTION_REGISTER_INVALID", message: string) {
    super(message);
    this.name = "AyasEvolutionError";
    this.stack = undefined;
  }
}

const OPPORTUNITY_ID = /^ayas-evo-[0-9a-f]{16,64}$/;
const MACHINE_KEY = /^[a-z][a-z0-9-]{0,39}(\.[a-z0-9][a-z0-9-]{0,39}){0,5}$/;
const DOMAIN_KEY = /^[a-z][a-z0-9-]{0,39}(\.[a-z0-9][a-z0-9-]{0,39}){0,3}$/;
const GENERIC_KEY = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,119}$/;
const REFERENCE = /^[a-z][a-z0-9-]{1,31}:[A-Za-z0-9._#/@:+-]{1,160}$/;
const REASON_CODE = /^[A-Z][A-Z0-9_]{2,63}$/;
const INSTRUCTION_SIGNALS: readonly AyasResearchInstructionSignal[] = ["OVERRIDE_RULES", "APPROVAL_DIRECTIVE", "COMMAND_DIRECTIVE", "FILE_EDIT_DIRECTIVE", "PATH_REFERENCE", "TOOL_DIRECTIVE"];
const BENCHMARK_ID = /^[a-z][a-z0-9-]{1,63}$/;
const DIMENSION = /^[A-Z][A-Z0-9_]{1,63}$/;
const CASE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;
const HEAD = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const RESEARCH_FINDING_ID = /^ayas-research-[0-9a-f-]{36}$/i;
const REGRESSION_SUITE = /^scripts\/smoke-[a-z0-9-]+\.ts$/;
const MODULE_PATH = /^(src|app|scripts|docs)\/[A-Za-z0-9_.\-/[\]()]+$/;

const sha256 = (value: string): string => crypto.createHash("sha256").update(value, "utf8").digest("hex");
const oneOf = <T extends string>(values: readonly T[], value: unknown): value is T => typeof value === "string" && (values as readonly string[]).includes(value);

function canonicalIso(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 40) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

/** Over-limit lists are never silently truncated: the loss is recorded, and safety-relevant losses block qualification. */
function bounded<T>(value: readonly T[], max: number, issues: string[], issue: string): readonly T[] {
  if (value.length > max) issues.push(issue);
  return value.slice(0, max);
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? neutralizeAyasUntrustedText(value).slice(0, max).trim() : "";
}

function textList(value: unknown, maxItems: number, maxChars: number): string[] {
  return Array.isArray(value) ? value.map((item) => text(item, maxChars)).filter(Boolean).slice(0, maxItems) : [];
}

function patternList(value: unknown, pattern: RegExp, maxItems: number, issues: string[], issue: string): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item === "string" && pattern.test(item) && !item.includes("..")) out.push(item);
    else issues.push(issue);
  }
  const unique = [...new Set(out)].sort();
  if (unique.length > maxItems) issues.push(`${issue.replace(/_INVALID$/, "")}_TRUNCATED`);
  return unique.slice(0, maxItems);
}

function enumList<T extends string>(values: readonly T[], value: unknown, maxItems: number, issues: string[], issue: string): T[] {
  if (!Array.isArray(value)) return [];
  const out = new Set<T>();
  for (const item of value) {
    if (oneOf(values, item)) out.add(item);
    else issues.push(issue);
  }
  return [...out].sort().slice(0, maxItems);
}

function requireEnum<T extends string>(values: readonly T[], value: unknown, field: string): T {
  if (!oneOf(values, value)) throw new AyasEvolutionError("AYAS_EVOLUTION_INVALID_ENUM", `${field} is not a recognized value`);
  return value;
}

function normalizeBenchmark(value: unknown): AyasEvolutionBenchmarkRef | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const caseIds = Array.isArray(v.caseIds) ? [...new Set(v.caseIds.filter((id): id is string => typeof id === "string" && CASE_ID.test(id)))].sort().slice(0, 64) : [];
  if (typeof v.benchmarkId !== "string" || !BENCHMARK_ID.test(v.benchmarkId)) return null;
  if (typeof v.dimension !== "string" || !DIMENSION.test(v.dimension)) return null;
  if (typeof v.measuredAtHead !== "string" || !HEAD.test(v.measuredAtHead)) return null;
  if (typeof v.evaluatorSha256 !== "string" || !SHA256.test(v.evaluatorSha256)) return null;
  if (caseIds.length === 0) return null;
  return { benchmarkId: v.benchmarkId, dimension: v.dimension, caseIds, measuredAtHead: v.measuredAtHead, evaluatorSha256: v.evaluatorSha256 };
}

const LOCAL_ORIGINS: ReadonlySet<AyasEvolutionOrigin> = new Set(["OWNER", "LOCAL_EVALUATOR", "LOCAL_RUNTIME", "DEVELOPER_REVIEW", "SECURITY_REVIEW"]);

/**
 * Phase 3 — derive what an evidence item actually is. A research result is
 * always a claim; an AYAS suggestion is always a hypothesis; an owner request
 * counts only on an owner-originated record; a local observation needs a
 * reference; a benchmark failure is a fact only with a complete measurement.
 * Records produced by the research loop or by AYAS reflection cannot turn
 * their own statements into facts; only a complete local measurement can.
 */
function deriveEvidenceClass(source: AyasEvolutionEvidenceSource, origin: AyasEvolutionOrigin, reference: string | null, benchmark: AyasEvolutionBenchmarkRef | null, occurrences: number | null, issues: string[]): { epistemicClass: AyasEvolutionEpistemicClass; trust: AyasEvolutionEvidenceTrust } {
  if (source === "RESEARCH_RESULT") return { epistemicClass: "RESEARCH_CLAIM", trust: "UNTRUSTED_EXTERNAL" };
  if (source === "AYAS_SUGGESTION") return { epistemicClass: "HYPOTHESIS", trust: "SELF_GENERATED" };
  if (source === "OWNER_REQUEST") {
    if (origin === "OWNER") return { epistemicClass: "OWNER_REQUEST", trust: "OWNER_STATEMENT" };
    issues.push("OWNER_REQUEST_NOT_FROM_OWNER");
    return { epistemicClass: "HYPOTHESIS", trust: origin === "RESEARCH_LOOP" ? "UNTRUSTED_EXTERNAL" : "SELF_GENERATED" };
  }
  if (source === "EVALUATION_FAILURE" || source === "BENCHMARK_REGRESSION") {
    if (benchmark) return { epistemicClass: "OBSERVED_FACT", trust: "LOCAL_MEASUREMENT" };
    issues.push("BENCHMARK_EVIDENCE_INCOMPLETE");
  } else if (source === "REPEATED_TASK_FAILURE" && (occurrences === null || occurrences < 2)) {
    issues.push("REPEATED_FAILURE_NEEDS_TWO_OCCURRENCES");
    return { epistemicClass: "INFERENCE", trust: LOCAL_ORIGINS.has(origin) ? "LOCAL_OBSERVATION" : "SELF_GENERATED" };
  } else if (reference !== null && LOCAL_ORIGINS.has(origin)) {
    return { epistemicClass: "OBSERVED_FACT", trust: "LOCAL_OBSERVATION" };
  }
  if (origin === "RESEARCH_LOOP") return { epistemicClass: "RESEARCH_CLAIM", trust: "UNTRUSTED_EXTERNAL" };
  if (reference === null) issues.push("EVIDENCE_REFERENCE_MISSING");
  return { epistemicClass: "INFERENCE", trust: LOCAL_ORIGINS.has(origin) ? "LOCAL_OBSERVATION" : "SELF_GENERATED" };
}

export function normalizeAyasEvolutionEvidence(input: AyasEvolutionEvidenceInput, origin: AyasEvolutionOrigin, issues: string[]): AyasEvolutionEvidence | null {
  if (!oneOf(AYAS_EVOLUTION_EVIDENCE_SOURCES, input?.source)) {
    issues.push("EVIDENCE_SOURCE_INVALID");
    return null;
  }
  const source = input.source as AyasEvolutionEvidenceSource;
  const reference = typeof input.reference === "string" && REFERENCE.test(input.reference) ? input.reference : null;
  if (input.reference !== undefined && reference === null) issues.push("EVIDENCE_REFERENCE_INVALID");
  const benchmark = source === "EVALUATION_FAILURE" || source === "BENCHMARK_REGRESSION" ? normalizeBenchmark(input.benchmark) : null;
  const occurrences = typeof input.occurrences === "number" && Number.isSafeInteger(input.occurrences) && input.occurrences >= 0 ? Math.min(input.occurrences, 1_000_000) : null;
  const researchFindingId = typeof input.researchFindingId === "string" && RESEARCH_FINDING_ID.test(input.researchFindingId) ? input.researchFindingId : null;
  const statement = text(input.statement, AYAS_EVOLUTION_LIMITS.longText);
  const { epistemicClass, trust } = deriveEvidenceClass(source, origin, reference, benchmark, occurrences, issues);
  const evidenceId = `ayas-evo-evidence-${sha256(JSON.stringify([source, reference, benchmark, researchFindingId, statement])).slice(0, 24)}`;
  return Object.freeze({ evidenceId, source, epistemicClass, trust, reference, observedAt: canonicalIso(input.observedAt), statement, benchmark, occurrences, researchFindingId });
}

function normalizeIo(value: unknown, issues: string[]): AyasEvolutionIo[] {
  if (!Array.isArray(value)) return [];
  const out: AyasEvolutionIo[] = [];
  for (const item of value.slice(0, AYAS_EVOLUTION_LIMITS.io)) {
    const v = (item ?? {}) as Record<string, unknown>;
    if (!oneOf(AYAS_EVOLUTION_IO_KINDS, v.kind)) { issues.push("IO_KIND_INVALID"); continue; }
    out.push({ kind: v.kind, key: typeof v.key === "string" && MACHINE_KEY.test(v.key) ? v.key : null });
  }
  return out;
}

/** Phase 13 — cost is declared per resource; absence is `unknown-cost`, and a paid kind can never be declared free. */
function normalizeResources(value: unknown, issues: string[]): AyasEvolutionResource[] {
  if (!Array.isArray(value)) return [];
  const out: AyasEvolutionResource[] = [];
  for (const item of bounded(value, AYAS_EVOLUTION_LIMITS.resources, issues, "RESOURCES_TRUNCATED")) {
    const v = (item ?? {}) as Record<string, unknown>;
    if (!oneOf(AYAS_EVOLUTION_RESOURCE_KINDS, v.kind)) { issues.push("RESOURCE_KIND_INVALID"); out.push({ kind: "UNKNOWN", costClass: "unknown-cost", key: null }); continue; }
    let costClass = parseAyasCostClass(v.costClass);
    if ((v.kind === "PAID_MODEL" || v.kind === "PAID_API") && (costClass === "local-zero-cost" || costClass === "free-public" || costClass === "unknown-cost")) {
      if (costClass !== "unknown-cost") issues.push("PAID_RESOURCE_DECLARED_FREE");
      costClass = "paid";
    }
    out.push({ kind: v.kind, costClass, key: typeof v.key === "string" && GENERIC_KEY.test(v.key) ? v.key : null });
  }
  return out;
}

function normalizeDescriptor(value: Record<string, unknown> | undefined, issues: string[]): AyasEvolutionCapabilityDescriptor {
  const v = value ?? {};
  if (typeof v.key !== "string" || !MACHINE_KEY.test(v.key)) throw new AyasEvolutionError("AYAS_EVOLUTION_INVALID_TARGET", "target capability key is not a bounded machine key");
  if (typeof v.domain !== "string" || !DOMAIN_KEY.test(v.domain)) throw new AyasEvolutionError("AYAS_EVOLUTION_INVALID_TARGET", "target capability domain is not a bounded domain key");
  const knownCategory = typeof v.knownCategory === "string" && isAyasCapabilityCategory(v.knownCategory) ? v.knownCategory : null;
  if (v.knownCategory !== undefined && v.knownCategory !== null && knownCategory === null) issues.push("KNOWN_CATEGORY_UNRECOGNIZED");
  const invalidBefore = issues.length;
  const declared = enumList(AYAS_EVOLUTION_SIDE_EFFECTS, v.sideEffects, AYAS_EVOLUTION_SIDE_EFFECTS.length, issues, "SIDE_EFFECT_INVALID");
  // An unrecognized side effect is an unknown one, never a dropped one.
  const sideEffects = issues.length > invalidBefore ? [...new Set([...declared, "UNKNOWN" as const])].sort() : declared;
  // NONE next to a real effect is contradictory; the real effect wins.
  const effective = sideEffects.length === 0 ? ["UNKNOWN" as const] : sideEffects.length > 1 ? sideEffects.filter((effect) => effect !== "NONE") : sideEffects;
  if (sideEffects.length === 0) issues.push("SIDE_EFFECTS_UNDECLARED");
  return Object.freeze({
    key: v.key,
    domain: v.domain,
    knownCategory,
    capabilityClass: oneOf(AYAS_EVOLUTION_CAPABILITY_CLASSES, v.capabilityClass) ? v.capabilityClass : "OTHER",
    inputs: normalizeIo(v.inputs, issues),
    outputs: normalizeIo(v.outputs, issues),
    sideEffects: effective,
    resources: normalizeResources(v.resources, issues),
    trustLevel: oneOf(AYAS_EVOLUTION_TRUST_LEVELS, v.trustLevel) ? v.trustLevel : "UNKNOWN",
  });
}

function normalizePrerequisites(value: unknown, issues: string[]): AyasEvolutionPrerequisite[] {
  if (!Array.isArray(value)) return [];
  const out = new Map<string, AyasEvolutionPrerequisite>();
  for (const item of bounded(value, AYAS_EVOLUTION_LIMITS.prerequisites, issues, "PREREQUISITES_TRUNCATED")) {
    const v = (item ?? {}) as Record<string, unknown>;
    if (!oneOf(AYAS_EVOLUTION_PREREQUISITE_KINDS, v.kind) || typeof v.key !== "string" || !GENERIC_KEY.test(v.key)) { issues.push("PREREQUISITE_INVALID"); continue; }
    const key = `${v.kind}:${v.key}`;
    const optional = v.optional === true;
    const prior = out.get(key);
    // A duplicate declaration is required if either copy is required.
    out.set(key, { kind: v.kind, key: v.key, optional: prior ? prior.optional && optional : optional });
  }
  return [...out.values()].sort((a, b) => `${a.kind}:${a.key}`.localeCompare(`${b.kind}:${b.key}`));
}

function normalizeConstraints(value: unknown, issues: string[]): AyasEvolutionConstraint[] {
  if (!Array.isArray(value)) return [];
  const out = new Map<string, AyasEvolutionConstraint>();
  for (const item of bounded(value, AYAS_EVOLUTION_LIMITS.constraints, issues, "CONSTRAINTS_TRUNCATED")) {
    const v = (item ?? {}) as Record<string, unknown>;
    if (!oneOf(AYAS_EVOLUTION_CONSTRAINT_KINDS, v.kind)) { issues.push("CONSTRAINT_INVALID"); continue; }
    const key = typeof v.key === "string" && GENERIC_KEY.test(v.key) ? v.key : null;
    if (v.kind === "MUTUALLY_EXCLUSIVE_WITH" && key === null) { issues.push("CONSTRAINT_KEY_REQUIRED"); continue; }
    out.set(`${v.kind}:${key ?? ""}`, { kind: v.kind, key });
  }
  return [...out.values()].sort((a, b) => `${a.kind}:${a.key ?? ""}`.localeCompare(`${b.kind}:${b.key ?? ""}`));
}

function normalizeRisk(value: Record<string, unknown> | undefined): AyasEvolutionRisk {
  const v = value ?? {};
  return Object.freeze(Object.fromEntries(AYAS_EVOLUTION_RISK_DIMENSIONS.map((dimension) => [dimension, oneOf(AYAS_EVOLUTION_RISK_LEVELS, v[dimension]) ? v[dimension] : "UNKNOWN"])) as Record<AyasEvolutionRiskDimension, AyasEvolutionRiskLevel>);
}

function normalizeEvaluation(value: Record<string, unknown> | undefined, issues: string[]): AyasEvolutionEvaluationPlan {
  const v = value ?? {};
  const benchmarkId = typeof v.benchmarkId === "string" && BENCHMARK_ID.test(v.benchmarkId) ? v.benchmarkId : null;
  if (v.benchmarkId !== undefined && v.benchmarkId !== null && benchmarkId === null) issues.push("EVALUATION_BENCHMARK_ID_INVALID");
  return Object.freeze({
    baselineStrategy: oneOf(AYAS_EVOLUTION_BASELINE_STRATEGIES, v.baselineStrategy) ? v.baselineStrategy : "NONE",
    benchmarkId,
    acceptanceCriteria: textList(v.acceptanceCriteria, AYAS_EVOLUTION_LIMITS.criteria, AYAS_EVOLUTION_LIMITS.shortText),
    heldOutCriteria: textList(v.heldOutCriteria, AYAS_EVOLUTION_LIMITS.criteria, AYAS_EVOLUTION_LIMITS.shortText),
    regressionSuites: patternList(v.regressionSuites, REGRESSION_SUITE, AYAS_EVOLUTION_LIMITS.suites, issues, "REGRESSION_SUITE_INVALID"),
  });
}

function normalizeRelations(value: Record<string, unknown> | undefined, issues: string[]): AyasEvolutionRelations {
  const v = value ?? {};
  const supersededBy = typeof v.supersededBy === "string" && OPPORTUNITY_ID.test(v.supersededBy) ? v.supersededBy : null;
  if (v.supersededBy !== undefined && v.supersededBy !== null && supersededBy === null) issues.push("SUPERSEDED_BY_INVALID");
  return Object.freeze({
    supersedes: patternList(v.supersedes, OPPORTUNITY_ID, AYAS_EVOLUTION_LIMITS.relations, issues, "SUPERSEDES_INVALID"),
    supersededBy,
    replacesCapabilities: patternList(v.replacesCapabilities, MACHINE_KEY, AYAS_EVOLUTION_LIMITS.relations, issues, "REPLACES_KEY_INVALID"),
    retiresCapabilities: patternList(v.retiresCapabilities, MACHINE_KEY, AYAS_EVOLUTION_LIMITS.relations, issues, "RETIRES_KEY_INVALID"),
    migratesFrom: patternList(v.migratesFrom, MACHINE_KEY, AYAS_EVOLUTION_LIMITS.relations, issues, "MIGRATES_FROM_KEY_INVALID"),
  });
}

function normalizeHistory(value: unknown): AyasEvolutionTransitionRecord[] {
  if (!Array.isArray(value)) return [];
  if (value.length > AYAS_EVOLUTION_LIMITS.history) throw new AyasEvolutionError("AYAS_EVOLUTION_REGISTER_LIMIT", "lifecycle history exceeds its limit; history is never truncated");
  const out: AyasEvolutionTransitionRecord[] = [];
  for (const item of value) {
    const v = (item ?? {}) as Record<string, unknown>;
    const at = canonicalIso(v.at);
    if (!oneOf(AYAS_EVOLUTION_LIFECYCLE_STATES, v.to) || at === null || typeof v.reasonCode !== "string" || !REASON_CODE.test(v.reasonCode)) {
      throw new AyasEvolutionError("AYAS_EVOLUTION_REGISTER_INVALID", "lifecycle history entry is malformed");
    }
    out.push({
      from: oneOf(AYAS_EVOLUTION_LIFECYCLE_STATES, v.from) ? v.from : null,
      to: v.to, at, actor: v.actor === "OWNER" ? "OWNER" : "AYAS", reasonCode: v.reasonCode,
      reference: typeof v.reference === "string" && REFERENCE.test(v.reference) ? v.reference : null,
    });
  }
  return out;
}

/** Deterministic identity: the same producer, target and evidence always yield the same id. */
export function deriveAyasEvolutionOpportunityId(parts: { readonly origin: string; readonly kind: string; readonly targetKey: string; readonly domain: string; readonly createdAt: string; readonly evidenceIds: readonly string[] }): string {
  return `ayas-evo-${sha256(JSON.stringify([parts.origin, parts.kind, parts.targetKey, parts.domain, parts.createdAt, [...parts.evidenceIds].sort()])).slice(0, 32)}`;
}

/**
 * Phase 2 contract. Invalid identity, time, target, origin or kind fails
 * closed with an error; malformed list entries are dropped and recorded as
 * normalization issues. Instruction-shaped text is detected on the RAW input
 * and recorded, then every text field is neutralized and bounded.
 */
export function normalizeAyasEvolutionOpportunity(input: AyasEvolutionOpportunityInput): AyasEvolutionOpportunity {
  if (input?.schemaVersion !== undefined && input.schemaVersion !== AYAS_EVOLUTION_SCHEMA_VERSION) {
    throw new AyasEvolutionError("AYAS_EVOLUTION_SCHEMA_MISMATCH", "unsupported evolution opportunity schema version");
  }
  const issues: string[] = [];
  const createdAt = canonicalIso(input?.createdAt);
  if (createdAt === null) throw new AyasEvolutionError("AYAS_EVOLUTION_INVALID_TIME", "createdAt is not a valid timestamp");
  const origin = requireEnum(AYAS_EVOLUTION_ORIGINS, input.origin, "origin");
  const kind = requireEnum(AYAS_EVOLUTION_KINDS, input.kind, "kind");
  const capability = normalizeDescriptor(input.target?.capability, issues);

  const rawTexts: { value: unknown; trusted: boolean }[] = [];
  const localText = LOCAL_ORIGINS.has(origin);
  rawTexts.push({ value: input.need?.summary, trusted: localText }, { value: input.target?.intendedOutcome, trusted: localText });
  for (const list of [input.need?.consequences, input.target?.nonGoals, input.evaluation?.acceptanceCriteria, input.evaluation?.heldOutCriteria]) {
    if (Array.isArray(list)) for (const item of list) rawTexts.push({ value: item, trusted: localText });
  }
  const evidence: AyasEvolutionEvidence[] = [];
  for (const item of bounded(Array.isArray(input.evidence) ? input.evidence : [], AYAS_EVOLUTION_LIMITS.evidence, issues, "EVIDENCE_TRUNCATED")) {
    const normalized = normalizeAyasEvolutionEvidence(item, origin, issues);
    if (!normalized) continue;
    // Evidence text is trusted only for a local observation or measurement.
    rawTexts.push({ value: item.statement, trusted: normalized.trust === "LOCAL_OBSERVATION" || normalized.trust === "LOCAL_MEASUREMENT" || normalized.trust === "OWNER_STATEMENT" });
    if (!evidence.some((prior) => prior.evidenceId === normalized.evidenceId)) evidence.push(normalized);
  }
  // Local text may legitimately name a module; every directive signal still applies to it.
  const priorSignals = Array.isArray(input.instructionSignals) ? input.instructionSignals.filter((signal): signal is AyasResearchInstructionSignal => oneOf(INSTRUCTION_SIGNALS, signal)) : [];
  const instructionSignals = [...new Set([...priorSignals, ...rawTexts.flatMap(({ value, trusted }) => {
    const signals = detectAyasResearchInstructionSignals(typeof value === "string" ? value : "");
    return trusted ? signals.filter((signal) => signal !== "PATH_REFERENCE") : signals;
  })])].sort();
  if (Array.isArray(input.normalizationIssues)) for (const issue of input.normalizationIssues.slice(0, 64)) if (typeof issue === "string" && REASON_CODE.test(issue)) issues.push(issue);

  const summary = text(input.need?.summary, AYAS_EVOLUTION_LIMITS.longText);
  const opportunityId = input.opportunityId === undefined
    ? deriveAyasEvolutionOpportunityId({ origin, kind, targetKey: capability.key, domain: capability.domain, createdAt, evidenceIds: evidence.map((item) => item.evidenceId) })
    : typeof input.opportunityId === "string" && OPPORTUNITY_ID.test(input.opportunityId) ? input.opportunityId : null;
  if (opportunityId === null) throw new AyasEvolutionError("AYAS_EVOLUTION_INVALID_ID", "opportunity id is not a bounded evolution id");

  const lifecycleInput = input.lifecycle ?? {};
  const history = normalizeHistory(lifecycleInput.history);
  const state = oneOf(AYAS_EVOLUTION_LIFECYCLE_STATES, lifecycleInput.state) ? lifecycleInput.state : "OBSERVED";
  if (history.length > 0 && history[history.length - 1]!.to !== state) throw new AyasEvolutionError("AYAS_EVOLUTION_REGISTER_INVALID", "lifecycle state does not match its history");
  if (history.length === 0 && state !== "OBSERVED") throw new AyasEvolutionError("AYAS_EVOLUTION_REGISTER_INVALID", "a non-initial lifecycle state requires history");
  const reopenCount = typeof lifecycleInput.reopenCount === "number" && Number.isSafeInteger(lifecycleInput.reopenCount) && lifecycleInput.reopenCount >= 0 ? Math.min(lifecycleInput.reopenCount, AYAS_EVOLUTION_LIMITS.reopen) : 0;

  return Object.freeze({
    schemaVersion: AYAS_EVOLUTION_SCHEMA_VERSION,
    opportunityId,
    createdAt,
    origin,
    kind,
    need: Object.freeze({
      summary,
      affectedCapabilityKeys: patternList(input.need?.affectedCapabilityKeys, MACHINE_KEY, AYAS_EVOLUTION_LIMITS.relations, issues, "AFFECTED_CAPABILITY_KEY_INVALID"),
      consequences: textList(input.need?.consequences, AYAS_EVOLUTION_LIMITS.consequences, AYAS_EVOLUTION_LIMITS.shortText),
    }),
    evidence: Object.freeze(evidence),
    target: Object.freeze({
      capability,
      intendedOutcome: text(input.target?.intendedOutcome, AYAS_EVOLUTION_LIMITS.longText),
      nonGoals: textList(input.target?.nonGoals, AYAS_EVOLUTION_LIMITS.nonGoals, AYAS_EVOLUTION_LIMITS.shortText),
    }),
    prerequisites: Object.freeze(normalizePrerequisites(input.prerequisites, issues)),
    constraints: Object.freeze(normalizeConstraints(input.constraints, issues)),
    impact: Object.freeze({
      affectedModules: patternList(input.impact?.affectedModules, MODULE_PATH, AYAS_EVOLUTION_LIMITS.modules, issues, "AFFECTED_MODULE_INVALID"),
      affectedFlows: patternList(input.impact?.affectedFlows, MACHINE_KEY, AYAS_EVOLUTION_LIMITS.flows, issues, "AFFECTED_FLOW_INVALID"),
      compatibility: oneOf(AYAS_EVOLUTION_COMPATIBILITY, input.impact?.compatibility) ? input.impact.compatibility : "UNKNOWN",
    }),
    declaredRisk: normalizeRisk(input.risk),
    evaluation: normalizeEvaluation(input.evaluation, issues),
    declaredAuthority: enumList(AYAS_EVOLUTION_AUTHORITY_CLASSES, input.requiredAuthority, AYAS_EVOLUTION_AUTHORITY_CLASSES.length, issues, "AUTHORITY_CLASS_INVALID"),
    relations: normalizeRelations(input.relations, issues),
    lifecycle: Object.freeze({
      state,
      history: Object.freeze(history.length > 0 ? history : [{ from: null, to: "OBSERVED" as const, at: createdAt, actor: "AYAS" as const, reasonCode: "RECORDED", reference: null }]),
      reopenCount,
      deferredUntil: canonicalIso(lifecycleInput.deferredUntil),
    }),
    instructionSignals,
    needTokenHashes: ayasResearchClaimTokenHashes(`${summary} ${text(input.target?.intendedOutcome, AYAS_EVOLUTION_LIMITS.longText)}`),
    normalizationIssues: Object.freeze([...new Set(issues)].sort()),
    authority: "NONE",
  });
}

/** Append-only evidence: prior evidence is never removed or rewritten. */
export function addAyasEvolutionEvidence(opportunity: AyasEvolutionOpportunity, input: AyasEvolutionEvidenceInput): AyasEvolutionOpportunity {
  if (AYAS_EVOLUTION_TERMINAL_STATES.has(opportunity.lifecycle.state)) {
    throw new AyasEvolutionError("AYAS_EVOLUTION_TRANSITION_REFUSED", "a closed opportunity keeps its evidence as history; open a new one instead");
  }
  if (opportunity.evidence.length >= AYAS_EVOLUTION_LIMITS.evidence) throw new AyasEvolutionError("AYAS_EVOLUTION_REGISTER_LIMIT", "evidence limit reached");
  const issues = [...opportunity.normalizationIssues];
  const evidence = normalizeAyasEvolutionEvidence(input, opportunity.origin, issues);
  if (!evidence || opportunity.evidence.some((prior) => prior.evidenceId === evidence.evidenceId)) return opportunity;
  const trusted = evidence.trust === "LOCAL_OBSERVATION" || evidence.trust === "LOCAL_MEASUREMENT" || evidence.trust === "OWNER_STATEMENT";
  const signals = detectAyasResearchInstructionSignals(typeof input.statement === "string" ? input.statement : "").filter((signal) => !trusted || signal !== "PATH_REFERENCE");
  return Object.freeze({
    ...opportunity,
    evidence: Object.freeze([...opportunity.evidence, evidence]),
    instructionSignals: [...new Set([...opportunity.instructionSignals, ...signals])].sort(),
    normalizationIssues: Object.freeze([...new Set(issues)].sort()),
  });
}

export interface AyasEvolutionTransitionRequest {
  readonly to: AyasEvolutionLifecycleState;
  readonly at: string;
  readonly actor: "OWNER" | "AYAS";
  readonly reasonCode: string;
  readonly reference?: string;
  readonly deferredUntil?: string;
}

/**
 * Structural lifecycle transition. It checks the transition table, history
 * and reopen bounds; the qualification-dependent gates (QUALIFIED,
 * EXPERIMENT_READY, PROPOSAL_READY, HANDED_OFF) are enforced by
 * `transitionAyasEvolutionLifecycle` in the qualification module, and
 * SUPERSEDED only by `supersedeAyasEvolutionOpportunity`. A transition
 * records a state; it never approves or executes anything.
 */
export function applyAyasEvolutionTransition(opportunity: AyasEvolutionOpportunity, request: AyasEvolutionTransitionRequest): AyasEvolutionOpportunity {
  const from = opportunity.lifecycle.state;
  const at = canonicalIso(request.at);
  if (at === null) throw new AyasEvolutionError("AYAS_EVOLUTION_INVALID_TIME", "transition time is invalid");
  if (!oneOf(AYAS_EVOLUTION_LIFECYCLE_STATES, request.to) || !AYAS_EVOLUTION_TRANSITIONS[from].includes(request.to)) {
    throw new AyasEvolutionError("AYAS_EVOLUTION_TRANSITION_REFUSED", `transition ${from} -> ${String(request.to)} is not allowed`);
  }
  if (!REASON_CODE.test(String(request.reasonCode ?? ""))) throw new AyasEvolutionError("AYAS_EVOLUTION_TRANSITION_REFUSED", "a bounded reason code is required");
  if (opportunity.lifecycle.history.length >= AYAS_EVOLUTION_LIMITS.history) throw new AyasEvolutionError("AYAS_EVOLUTION_TRANSITION_REFUSED", "lifecycle history limit reached");
  const last = opportunity.lifecycle.history[opportunity.lifecycle.history.length - 1];
  if (last && Date.parse(at) < Date.parse(last.at)) throw new AyasEvolutionError("AYAS_EVOLUTION_TRANSITION_REFUSED", "transition time precedes history");
  // Returning to INVESTIGATING from anywhere but the initial state is a reopen; reopens are what bound every lifecycle loop.
  const reopening = from !== "OBSERVED" && request.to === "INVESTIGATING";
  if (reopening && opportunity.lifecycle.reopenCount >= AYAS_EVOLUTION_LIMITS.reopen) {
    throw new AyasEvolutionError("AYAS_EVOLUTION_TRANSITION_REFUSED", "reopen limit reached; reject, retire or supersede instead");
  }
  const reference = request.reference === undefined ? null : REFERENCE.test(request.reference) ? request.reference : undefined;
  if (reference === undefined) throw new AyasEvolutionError("AYAS_EVOLUTION_TRANSITION_REFUSED", "transition reference is malformed");
  return Object.freeze({
    ...opportunity,
    lifecycle: Object.freeze({
      state: request.to,
      history: Object.freeze([...opportunity.lifecycle.history, { from, to: request.to, at, actor: request.actor === "OWNER" ? "OWNER" as const : "AYAS" as const, reasonCode: request.reasonCode, reference }]),
      reopenCount: opportunity.lifecycle.reopenCount + (reopening ? 1 : 0),
      deferredUntil: request.to === "DEFERRED" ? canonicalIso(request.deferredUntil) : null,
    }),
  });
}

export interface AyasEvolutionRegister {
  readonly schemaVersion: typeof AYAS_EVOLUTION_SCHEMA_VERSION;
  readonly opportunities: readonly AyasEvolutionOpportunity[];
}

function assertRegisterIntegrity(opportunities: readonly AyasEvolutionOpportunity[]): void {
  if (opportunities.length > AYAS_EVOLUTION_LIMITS.opportunities) throw new AyasEvolutionError("AYAS_EVOLUTION_REGISTER_LIMIT", "register holds too many opportunities");
  const byId = new Map<string, AyasEvolutionOpportunity>();
  for (const opportunity of opportunities) {
    if (byId.has(opportunity.opportunityId)) throw new AyasEvolutionError("AYAS_EVOLUTION_DUPLICATE_ID", "duplicate opportunity id");
    byId.set(opportunity.opportunityId, opportunity);
  }
  for (const opportunity of opportunities) {
    const next = opportunity.relations.supersededBy;
    if ((opportunity.lifecycle.state === "SUPERSEDED") !== (next !== null)) throw new AyasEvolutionError("AYAS_EVOLUTION_SUPERSESSION_INVALID", "SUPERSEDED state and supersededBy must agree");
    if (next !== null && !byId.get(next)?.relations.supersedes.includes(opportunity.opportunityId)) throw new AyasEvolutionError("AYAS_EVOLUTION_SUPERSESSION_INVALID", "supersession link is dangling or one-sided");
    // Bounded walk: a supersession chain can never revisit a record.
    const seen = new Set<string>([opportunity.opportunityId]);
    for (let cursor = next; cursor !== null; cursor = byId.get(cursor)?.relations.supersededBy ?? null) {
      if (seen.has(cursor)) throw new AyasEvolutionError("AYAS_EVOLUTION_SUPERSESSION_INVALID", "supersession cycle");
      seen.add(cursor);
    }
  }
}

export function createAyasEvolutionRegister(opportunities: readonly AyasEvolutionOpportunity[] = []): AyasEvolutionRegister {
  assertRegisterIntegrity(opportunities);
  return Object.freeze({ schemaVersion: AYAS_EVOLUTION_SCHEMA_VERSION, opportunities: Object.freeze([...opportunities]) });
}

export function appendAyasEvolutionOpportunity(register: AyasEvolutionRegister, opportunity: AyasEvolutionOpportunity): AyasEvolutionRegister {
  return createAyasEvolutionRegister([...register.opportunities, opportunity]);
}

/**
 * Replacing a record may only advance its lifecycle and APPEND evidence,
 * instruction signals and issues. Identity and every declaration
 * (target, prerequisites, constraints, impact, risk, evaluation, authority,
 * relations) are immutable; a changed declaration is a new opportunity that
 * supersedes this one.
 */
export function updateAyasEvolutionOpportunity(register: AyasEvolutionRegister, updated: AyasEvolutionOpportunity): AyasEvolutionRegister {
  const index = register.opportunities.findIndex((item) => item.opportunityId === updated.opportunityId);
  if (index < 0) throw new AyasEvolutionError("AYAS_EVOLUTION_REGISTER_INVALID", "unknown opportunity");
  const prior = register.opportunities[index]!;
  const prefix = <T>(a: readonly T[], b: readonly T[]) => a.length <= b.length && a.every((item, i) => JSON.stringify(item) === JSON.stringify(b[i]));
  const superset = (a: readonly string[], b: readonly string[]) => a.every((item) => b.includes(item));
  const declarations = (item: AyasEvolutionOpportunity) => JSON.stringify({ ...item, lifecycle: null, evidence: null, instructionSignals: null, normalizationIssues: null, needTokenHashes: null });
  if (!prefix(prior.lifecycle.history, updated.lifecycle.history) || !prefix(prior.evidence, updated.evidence)
    || !superset(prior.instructionSignals, updated.instructionSignals) || !superset(prior.normalizationIssues, updated.normalizationIssues)
    || declarations(prior) !== declarations(updated)) {
    throw new AyasEvolutionError("AYAS_EVOLUTION_HISTORY_REWRITE", "history, evidence, signals and declarations are append-only");
  }
  const next = [...register.opportunities];
  next[index] = updated;
  return createAyasEvolutionRegister(next);
}

/** Phase 7 — supersession keeps both records; the older one becomes SUPERSEDED with a two-way link. */
export function supersedeAyasEvolutionOpportunity(register: AyasEvolutionRegister, oldId: string, newId: string, at: string, actor: "OWNER" | "AYAS", reasonCode: string): AyasEvolutionRegister {
  const older = register.opportunities.find((item) => item.opportunityId === oldId);
  const newer = register.opportunities.find((item) => item.opportunityId === newId);
  if (!older || !newer || oldId === newId) throw new AyasEvolutionError("AYAS_EVOLUTION_SUPERSESSION_INVALID", "both opportunities must exist and differ");
  if (AYAS_EVOLUTION_TERMINAL_STATES.has(older.lifecycle.state) || AYAS_EVOLUTION_TERMINAL_STATES.has(newer.lifecycle.state)) {
    throw new AyasEvolutionError("AYAS_EVOLUTION_SUPERSESSION_INVALID", "a closed opportunity cannot supersede or be superseded");
  }
  const transitioned = applyAyasEvolutionTransition(older, { to: "SUPERSEDED", at, actor, reasonCode, reference: `evolution:${newId}` });
  const olderNext = Object.freeze({ ...transitioned, relations: Object.freeze({ ...older.relations, supersededBy: newId }) });
  const newerNext = Object.freeze({ ...newer, relations: Object.freeze({ ...newer.relations, supersedes: [...new Set([...newer.relations.supersedes, oldId])].sort() }) });
  // Built directly: integrity (including cycles) is re-checked on the whole result.
  return createAyasEvolutionRegister(register.opportunities.map((item) => item.opportunityId === oldId ? olderNext : item.opportunityId === newId ? newerNext : item));
}

/** Versioned, bounded, fail-closed parse of a serialized register (e.g. an operator's JSON input). */
export function parseAyasEvolutionRegister(value: unknown): AyasEvolutionRegister {
  if (!value || typeof value !== "object") throw new AyasEvolutionError("AYAS_EVOLUTION_REGISTER_INVALID", "register must be an object");
  const v = value as Record<string, unknown>;
  if (v.schemaVersion !== AYAS_EVOLUTION_SCHEMA_VERSION) throw new AyasEvolutionError("AYAS_EVOLUTION_SCHEMA_MISMATCH", "unsupported register schema version");
  if (!Array.isArray(v.opportunities)) throw new AyasEvolutionError("AYAS_EVOLUTION_REGISTER_INVALID", "opportunities must be an array");
  if (v.opportunities.length > AYAS_EVOLUTION_LIMITS.opportunities) throw new AyasEvolutionError("AYAS_EVOLUTION_REGISTER_LIMIT", "register holds too many opportunities");
  return createAyasEvolutionRegister(v.opportunities.map((item) => normalizeAyasEvolutionOpportunity(item as AyasEvolutionOpportunityInput)));
}

/** Inverse of normalization for persistence or operator hand-off: `parse(serialize(r))` yields an equivalent register. */
export function serializeAyasEvolutionRegister(register: AyasEvolutionRegister): { readonly schemaVersion: typeof AYAS_EVOLUTION_SCHEMA_VERSION; readonly opportunities: readonly AyasEvolutionOpportunityInput[] } {
  return {
    schemaVersion: AYAS_EVOLUTION_SCHEMA_VERSION,
    opportunities: register.opportunities.map((item) => ({
      schemaVersion: item.schemaVersion,
      opportunityId: item.opportunityId,
      createdAt: item.createdAt,
      origin: item.origin,
      kind: item.kind,
      need: item.need,
      evidence: item.evidence.map((e) => ({ source: e.source, reference: e.reference ?? undefined, observedAt: e.observedAt ?? undefined, statement: e.statement, benchmark: e.benchmark ?? undefined, occurrences: e.occurrences ?? undefined, researchFindingId: e.researchFindingId ?? undefined })),
      target: { capability: { ...item.target.capability }, intendedOutcome: item.target.intendedOutcome, nonGoals: item.target.nonGoals },
      prerequisites: item.prerequisites,
      constraints: item.constraints,
      impact: item.impact,
      risk: { ...item.declaredRisk },
      evaluation: { ...item.evaluation },
      requiredAuthority: item.declaredAuthority,
      relations: { ...item.relations },
      lifecycle: { ...item.lifecycle },
      normalizationIssues: item.normalizationIssues,
      instructionSignals: item.instructionSignals,
    })),
  };
}
