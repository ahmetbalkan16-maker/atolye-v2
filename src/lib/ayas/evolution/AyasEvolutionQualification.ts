import {
  AYAS_DEFAULT_IMPROVEMENT_REGISTRY, findAyasImprovementBenchmark, selectAyasImprovementStrategy, type AyasImprovementRegistry,
} from "../../brain/autonomy/AyasResearchExperimentRegistry";
import {
  AYAS_RESEARCH_SEMANTIC_DUPLICATE_JACCARD, AYAS_RESEARCH_STALE_DAYS, ayasResearchTokenSimilarity, buildAyasImprovementHypothesis,
  type AyasImprovementHypothesis, type AyasLocalGapSnapshot, type AyasResearchGapMapping,
} from "../../brain/autonomy/AyasResearchImprovementLoop";
import { classifyPatchSet, type BrainPatchSafetyLevel } from "../../brain/selfheal/BrainPatchSafety";
import { collectAyasChangeAreas, type AyasChangeArea } from "../developer/AyasDeveloperTaskModel";
import { evaluateAyasZeroCost, type AyasCostClass, type AyasCostDecision } from "../policy/AyasZeroCostPolicy";
import type { AyasCapability } from "../routing/AyasAgenticRouting";
import {
  AYAS_EVOLUTION_AUTHORITY_CLASSES, AYAS_EVOLUTION_AUTHORITY_PATHS, AYAS_EVOLUTION_HANDOFF_PROPOSAL_REFERENCE, AYAS_EVOLUTION_TERMINAL_STATES,
  AyasEvolutionError, applyAyasEvolutionTransition, isAyasEvolutionBlockingIssue, updateAyasEvolutionOpportunity,
  type AyasEvolutionAuthorityClass, type AyasEvolutionCapabilityClass, type AyasEvolutionOpportunity, type AyasEvolutionPrerequisite, type AyasEvolutionRegister,
  type AyasEvolutionResourceKind, type AyasEvolutionRisk, type AyasEvolutionRiskDimension, type AyasEvolutionRiskLevel, type AyasEvolutionSideEffect,
  type AyasEvolutionTransitionRequest,
} from "./AyasEvolutionOpportunity";

/**
 * Stage 13 — the bounded evolution decision engine. Pure and deterministic:
 * given a register and caller-supplied environment FACTS, it decides how
 * ready each opportunity is. The strongest possible result is
 * EXPERIMENT_READY (a Stage 8 hypothesis exists) or PROPOSAL_READY (it may
 * enter the existing non-executable design-review proposal path). It can
 * never answer "approved" or "execute": every result carries
 * `executionAuthority: "NONE"`, and the required authorities it lists are
 * owned by existing owner/policy paths.
 *
 * Facts it does not have stay unknown: a missing environment entry is
 * UNKNOWN, never AVAILABLE; an undeclared cost is `unknown-cost`, never
 * free; an undeclared risk dimension is UNKNOWN, never NONE.
 */
export type AyasEvolutionFact = "AVAILABLE" | "UNAVAILABLE" | "UNKNOWN";

export interface AyasEvolutionEnvironment {
  readonly now: string;
  readonly currentHead: string | null;
  /** Stage 7 `inventoryAyasCapabilities` snapshot — the existing tool/skill/model/agent registry. */
  readonly capabilities: readonly AyasCapability[];
  /** Known AYAS/Atölye capability keys and their state; absent means not known to exist. */
  readonly capabilityKeys?: Readonly<Record<string, "AVAILABLE" | "UNAVAILABLE" | "RETIRED">>;
  readonly hostBinaries?: Readonly<Record<string, AyasEvolutionFact>>;
  readonly dataSets?: Readonly<Record<string, AyasEvolutionFact>>;
  readonly providerCapabilities?: Readonly<Record<string, AyasEvolutionFact>>;
  readonly externalServices?: Readonly<Record<string, AyasEvolutionFact>>;
  readonly externalAccounts?: Readonly<Record<string, AyasEvolutionFact>>;
  readonly operatingMode?: "OFFLINE" | "ONLINE" | "UNKNOWN";
  /** Stage 8 closed registry; defaults to the production one (zero registered strategies). */
  readonly improvementRegistry?: AyasImprovementRegistry;
  /** Stage 8 benchmark measurements; only a snapshot at `currentHead` counts. */
  readonly gapSnapshots?: readonly AyasLocalGapSnapshot[];
}

/** Ordered: the first (lowest) level among all blockers is the readiness. */
export const AYAS_EVOLUTION_READINESS = [
  "CLOSED", "DEFERRED", "BLOCKED", "DUPLICATE", "INSUFFICIENT_EVIDENCE", "RESEARCH_REQUIRED", "NEEDS_INVESTIGATION",
  "PREREQUISITES_MISSING", "SECURITY_REVIEW_REQUIRED", "OWNER_DECISION_REQUIRED", "EXPERIMENT_READY", "PROPOSAL_READY",
] as const;
export type AyasEvolutionReadiness = typeof AYAS_EVOLUTION_READINESS[number];
type BlockerLevel = Exclude<AyasEvolutionReadiness, "EXPERIMENT_READY" | "PROPOSAL_READY">;
export interface AyasEvolutionBlocker { readonly level: BlockerLevel; readonly code: string; readonly reference: string | null }

export type AyasEvolutionPrerequisiteStatus = "SATISFIED" | "MISSING" | "UNAVAILABLE" | "UNKNOWN" | "PENDING_OPPORTUNITY" | "RETIRED" | "OWNER_DECISION_REQUIRED";
export interface AyasEvolutionPrerequisiteResolution {
  readonly prerequisite: AyasEvolutionPrerequisite;
  readonly status: AyasEvolutionPrerequisiteStatus;
  readonly providers: readonly string[];
  readonly costClass: AyasCostClass | null;
  readonly external: boolean;
}

export type AyasEvolutionRelation = "DUPLICATE" | "OVERLAPPING" | "RELATED" | "INDEPENDENT";
export interface AyasEvolutionComparison { readonly relation: AyasEvolutionRelation; readonly reasons: readonly string[] }

export type AyasEvolutionStage8Outcome = "HYPOTHESIS" | "NEEDS_EXPERIMENT_DESIGN" | "NO_LOCAL_BENCHMARK" | "NO_CAPABILITY_MAPPING" | "GAP_NOT_MEASURED" | "NO_LOCAL_GAP" | "NOT_APPLICABLE";

export interface AyasEvolutionQualification {
  readonly opportunityId: string;
  readonly lifecycleState: AyasEvolutionOpportunity["lifecycle"]["state"];
  readonly readiness: AyasEvolutionReadiness;
  readonly primaryReason: string;
  readonly blockers: readonly AyasEvolutionBlocker[];
  readonly evidence: {
    readonly sufficient: boolean;
    readonly strength: 0 | 1 | 2 | 3;
    readonly byClass: Readonly<Record<string, number>>;
    readonly staleFacts: number;
    readonly contradicted: number;
  };
  readonly prerequisites: readonly AyasEvolutionPrerequisiteResolution[];
  readonly cycle: readonly string[] | null;
  readonly relations: {
    readonly duplicateOf: string | null;
    readonly overlapping: readonly string[];
    readonly related: readonly string[];
    readonly conflictsWith: readonly string[];
    readonly replacedBy: readonly string[];
  };
  readonly risk: AyasEvolutionRisk;
  readonly cost: { readonly aggregate: AyasCostClass; readonly unknownResources: number; readonly decision: AyasCostDecision };
  readonly authority: {
    readonly required: readonly AyasEvolutionAuthorityClass[];
    readonly paths: readonly { readonly authority: AyasEvolutionAuthorityClass; readonly path: string }[];
    readonly granted: "NONE";
  };
  readonly impact: { readonly patchSafety: BrainPatchSafetyLevel; readonly areas: readonly AyasChangeArea[]; readonly migration: boolean };
  readonly evaluation: { readonly adequate: boolean; readonly issues: readonly string[] };
  readonly stage8: { readonly outcome: AyasEvolutionStage8Outcome; readonly benchmarkId: string | null; readonly hypothesis: AyasImprovementHypothesis | null };
  readonly executionAuthority: "NONE";
  readonly mayExecute: false;
  readonly mayInstall: false;
  readonly maySpend: false;
  readonly mayPublish: false;
}

const own = <T>(record: Readonly<Record<string, T>> | undefined, key: string): T | undefined =>
  record && Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;
const factStatus = (fact: AyasEvolutionFact | undefined): AyasEvolutionPrerequisiteStatus =>
  fact === "AVAILABLE" ? "SATISFIED" : fact === "UNAVAILABLE" ? "UNAVAILABLE" : "UNKNOWN";
const isActive = (opportunity: AyasEvolutionOpportunity) => !AYAS_EVOLUTION_TERMINAL_STATES.has(opportunity.lifecycle.state);
const DAY_MS = 24 * 60 * 60_000;

const RISK_RANK: Readonly<Record<AyasEvolutionRiskLevel, number>> = { NONE: 0, LOW: 1, MEDIUM: 2, UNKNOWN: 3, HIGH: 4 };
/** HIGH dominates; UNKNOWN dominates every known level below HIGH, so a derivation can never make a risk look known. */
function raise(current: AyasEvolutionRiskLevel, floor: AyasEvolutionRiskLevel): AyasEvolutionRiskLevel {
  return RISK_RANK[floor] > RISK_RANK[current] ? floor : current;
}

// ---------------------------------------------------------------- prerequisites

function providersOf(register: AyasEvolutionRegister, key: string, selfId: string): AyasEvolutionOpportunity[] {
  return register.opportunities.filter((item) => item.opportunityId !== selfId && item.target.capability.key === key);
}

function successorOf(register: AyasEvolutionRegister, id: string): AyasEvolutionOpportunity | null {
  const seen = new Set<string>();
  let cursor = register.opportunities.find((item) => item.opportunityId === id) ?? null;
  while (cursor && cursor.lifecycle.state === "SUPERSEDED" && cursor.relations.supersededBy && !seen.has(cursor.opportunityId)) {
    seen.add(cursor.opportunityId);
    const next = cursor.relations.supersededBy;
    cursor = register.opportunities.find((item) => item.opportunityId === next) ?? null;
  }
  return cursor;
}

/** Phase 5 — resolve each prerequisite against facts only. Nothing is installed, probed or enabled. */
export function resolveAyasEvolutionPrerequisites(opportunity: AyasEvolutionOpportunity, register: AyasEvolutionRegister, env: AyasEvolutionEnvironment): readonly AyasEvolutionPrerequisiteResolution[] {
  return opportunity.prerequisites.map((prerequisite): AyasEvolutionPrerequisiteResolution => {
    const base = { prerequisite, providers: [] as string[], costClass: null as AyasCostClass | null, external: false };
    switch (prerequisite.kind) {
      case "TOOL": case "SKILL": case "MODEL": case "AGENT": {
        const type = prerequisite.kind.toLowerCase();
        const capability = env.capabilities.find((item) => item.type === type && item.id === prerequisite.key);
        if (!capability) return { ...base, status: "MISSING" };
        return {
          ...base, status: capability.available ? "SATISFIED" : "UNAVAILABLE",
          costClass: capability.costClass === "zero" ? "local-zero-cost" : "unknown-cost", external: capability.locality === "external",
        };
      }
      case "CAPABILITY": {
        const known = own(env.capabilityKeys, prerequisite.key);
        if (known === "AVAILABLE") return { ...base, status: "SATISFIED" };
        if (known === "RETIRED") return { ...base, status: "RETIRED" };
        const providers = providersOf(register, prerequisite.key, opportunity.opportunityId);
        const active = providers.filter(isActive).map((item) => item.opportunityId).sort();
        if (active.length > 0) return { ...base, status: "PENDING_OPPORTUNITY", providers: active };
        if (providers.some((item) => item.lifecycle.state === "RETIRED")) return { ...base, status: "RETIRED" };
        return { ...base, status: known === "UNAVAILABLE" || providers.length > 0 ? "UNAVAILABLE" : "MISSING" };
      }
      case "OPPORTUNITY": {
        const target = successorOf(register, prerequisite.key);
        if (!target) return { ...base, status: "MISSING" };
        if (target.lifecycle.state === "REJECTED") return { ...base, status: "UNAVAILABLE", providers: [target.opportunityId] };
        if (target.lifecycle.state === "RETIRED") return { ...base, status: "RETIRED", providers: [target.opportunityId] };
        return { ...base, status: "PENDING_OPPORTUNITY", providers: [target.opportunityId] };
      }
      case "HOST_BINARY": return { ...base, status: factStatus(own(env.hostBinaries, prerequisite.key)) };
      case "DATA": return { ...base, status: factStatus(own(env.dataSets, prerequisite.key)) };
      case "PROVIDER_CAPABILITY": return { ...base, status: factStatus(own(env.providerCapabilities, prerequisite.key)), external: true, costClass: "unknown-cost" };
      case "EXTERNAL_SERVICE": return { ...base, status: factStatus(own(env.externalServices, prerequisite.key)), external: true, costClass: "unknown-cost" };
      case "EXTERNAL_ACCOUNT": return { ...base, status: factStatus(own(env.externalAccounts, prerequisite.key)), external: true, costClass: "unknown-cost" };
      case "OWNER_PERMISSION": return { ...base, status: "OWNER_DECISION_REQUIRED" };
    }
  });
}

/** Tarjan SCC over active opportunities; edges come from CAPABILITY providers and OPPORTUNITY links. */
export function findAyasEvolutionPrerequisiteCycles(register: AyasEvolutionRegister): readonly (readonly string[])[] {
  const active = register.opportunities.filter(isActive);
  const ids = new Set(active.map((item) => item.opportunityId));
  const edges = new Map<string, string[]>();
  for (const item of active) {
    const out = new Set<string>();
    for (const prerequisite of item.prerequisites) {
      if (prerequisite.kind === "CAPABILITY") {
        for (const provider of active) if (provider.target.capability.key === prerequisite.key) out.add(provider.opportunityId);
      } else if (prerequisite.kind === "OPPORTUNITY" && ids.has(prerequisite.key)) out.add(prerequisite.key);
    }
    edges.set(item.opportunityId, [...out].sort());
  }
  let index = 0;
  const indexOf = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const cycles: string[][] = [];
  const visit = (node: string): void => {
    indexOf.set(node, index); low.set(node, index); index += 1;
    stack.push(node); onStack.add(node);
    for (const next of edges.get(node) ?? []) {
      if (!indexOf.has(next)) { visit(next); low.set(node, Math.min(low.get(node)!, low.get(next)!)); }
      else if (onStack.has(next)) low.set(node, Math.min(low.get(node)!, indexOf.get(next)!));
    }
    if (low.get(node) === indexOf.get(node)) {
      const component: string[] = [];
      let member: string;
      do { member = stack.pop()!; onStack.delete(member); component.push(member); } while (member !== node);
      if (component.length > 1 || (edges.get(node) ?? []).includes(node)) cycles.push(component.sort());
    }
  };
  for (const id of [...ids].sort()) if (!indexOf.has(id)) visit(id);
  return cycles.sort((a, b) => a[0]!.localeCompare(b[0]!));
}

// ---------------------------------------------------------------- duplicate / overlap

const DUPLICATE_KIND_GROUP = (kind: AyasEvolutionOpportunity["kind"]) => kind === "CAPABILITY_GAP" || kind === "NEW_CAPABILITY" ? "NEW" : kind;
const prerequisiteSignature = (item: AyasEvolutionOpportunity) => item.prerequisites.filter((p) => !p.optional).map((p) => `${p.kind}:${p.key}`).join("|");
const references = (item: AyasEvolutionOpportunity) => new Set(item.evidence.map((e) => e.reference).filter((r): r is string => r !== null));
const intersects = <T>(a: ReadonlySet<T> | readonly T[], b: ReadonlySet<T> | readonly T[]) => { const right = new Set(b); for (const x of a) if (right.has(x)) return true; return false; };

/**
 * Phase 8 — structural comparison. DUPLICATE needs the same target, domain
 * and kind group PLUS a structural match (shared evidence reference, equal
 * prerequisite signature or equal module set). Wording similarity alone can
 * never produce DUPLICATE or OVERLAPPING; it is reported as a reason only.
 */
export function compareAyasEvolutionOpportunities(a: AyasEvolutionOpportunity, b: AyasEvolutionOpportunity): AyasEvolutionComparison {
  const reasons: string[] = [];
  const sameTarget = a.target.capability.key === b.target.capability.key;
  const sameDomain = a.target.capability.domain === b.target.capability.domain;
  const sameGroup = DUPLICATE_KIND_GROUP(a.kind) === DUPLICATE_KIND_GROUP(b.kind);
  const refOverlap = intersects(references(a), references(b));
  const sigA = prerequisiteSignature(a);
  const sameSignature = sigA !== "" && sigA === prerequisiteSignature(b);
  const moduleOverlap = intersects(a.impact.affectedModules, b.impact.affectedModules);
  const sameModules = a.impact.affectedModules.length > 0 && a.impact.affectedModules.join("|") === b.impact.affectedModules.join("|");
  const dependency = a.prerequisites.some((p) => (p.kind === "CAPABILITY" && p.key === b.target.capability.key) || (p.kind === "OPPORTUNITY" && p.key === b.opportunityId))
    || b.prerequisites.some((p) => (p.kind === "CAPABILITY" && p.key === a.target.capability.key) || (p.kind === "OPPORTUNITY" && p.key === a.opportunityId));
  const succession = a.relations.supersedes.includes(b.opportunityId) || b.relations.supersedes.includes(a.opportunityId)
    || a.relations.replacesCapabilities.includes(b.target.capability.key) || b.relations.replacesCapabilities.includes(a.target.capability.key);
  const textSimilar = ayasResearchTokenSimilarity(a.needTokenHashes, b.needTokenHashes) >= AYAS_RESEARCH_SEMANTIC_DUPLICATE_JACCARD;
  if (sameTarget) reasons.push("SAME_TARGET");
  if (sameDomain) reasons.push("SAME_DOMAIN");
  if (refOverlap) reasons.push("SHARED_EVIDENCE_REFERENCE");
  if (sameSignature) reasons.push("SAME_PREREQUISITE_SIGNATURE");
  if (moduleOverlap) reasons.push("SHARED_AFFECTED_MODULE");
  if (dependency) reasons.push("PREREQUISITE_LINK");
  if (succession) reasons.push("SUCCESSION_LINK");
  if (textSimilar) reasons.push("TEXT_SIMILAR");
  if (sameTarget && sameDomain && sameGroup && (refOverlap || sameSignature || sameModules)) return { relation: "DUPLICATE", reasons };
  if (sameTarget || (sameDomain && moduleOverlap && refOverlap)) return { relation: "OVERLAPPING", reasons };
  if (sameDomain || moduleOverlap || refOverlap || dependency || succession) return { relation: "RELATED", reasons };
  return { relation: "INDEPENDENT", reasons: textSimilar ? ["TEXT_SIMILAR_ONLY"] : [] };
}

// ---------------------------------------------------------------- evidence

function capabilityPresent(key: string, env: AyasEvolutionEnvironment): boolean {
  return own(env.capabilityKeys, key) === "AVAILABLE" || env.capabilities.some((item) => item.id === key && item.available);
}

function summarizeEvidence(opportunity: AyasEvolutionOpportunity, env: AyasEvolutionEnvironment): AyasEvolutionQualification["evidence"] {
  const now = Date.parse(env.now);
  const byClass: Record<string, number> = {};
  let current = 0; let research = 0; let stale = 0; let contradicted = 0; let measuredAtHead = false;
  for (const item of opportunity.evidence) {
    byClass[item.epistemicClass] = (byClass[item.epistemicClass] ?? 0) + 1;
    if (item.source === "CAPABILITY_ABSENCE" && item.reference?.startsWith("capability:") && capabilityPresent(item.reference.slice("capability:".length), env)) {
      contradicted += 1;
      continue;
    }
    if (item.epistemicClass === "OBSERVED_FACT") {
      const age = item.observedAt ? (now - Date.parse(item.observedAt)) / DAY_MS : null;
      // An observation with no time (or a future time) cannot be shown fresh; a measurement is current only at the current HEAD, as in Stage 8.
      const fresh = item.benchmark !== null ? env.currentHead !== null && item.benchmark.measuredAtHead === env.currentHead : age !== null && age >= -1 && age <= AYAS_RESEARCH_STALE_DAYS;
      if (!fresh) { stale += 1; continue; }
      if (item.benchmark !== null) measuredAtHead = true;
      current += 1;
    } else if (item.epistemicClass === "OWNER_REQUEST") current += 1;
    else if (item.epistemicClass === "RESEARCH_CLAIM") research += 1;
  }
  const strength = measuredAtHead ? 3 : current > 0 ? 2 : research > 0 ? 1 : 0;
  return { sufficient: current > 0, strength, byClass, staleFacts: stale, contradicted };
}

// ---------------------------------------------------------------- risk, cost, authority

const POLICY_CONFLICTS = new Set(["CONFLICTS_WITH_APPROVAL_POLICY", "CONFLICTS_WITH_EXECUTION_POLICY", "CONFLICTS_WITH_SECURITY_POLICY"]);
const MIGRATION_CONSTRAINTS = new Set(["REQUIRES_STORAGE_MIGRATION", "INCOMPATIBLE_WITH_STORAGE_SCHEMA", "BREAKS_BACKWARD_COMPATIBILITY"]);
const SENSITIVE_AREAS: ReadonlySet<AyasChangeArea> = new Set(["authority", "execution-gate", "security", "secret"]);
const COST_ORDER: readonly AyasCostClass[] = ["local-zero-cost", "free-public", "metered-free-tier", "subscription", "paid"];

function aggregateCost(opportunity: AyasEvolutionOpportunity, prerequisites: readonly AyasEvolutionPrerequisiteResolution[]): { aggregate: AyasCostClass; unknownResources: number } {
  const classes: AyasCostClass[] = opportunity.target.capability.resources.map((resource) => resource.costClass);
  for (const resolution of prerequisites) if (resolution.costClass !== null && !resolution.prerequisite.optional) classes.push(resolution.costClass);
  if (opportunity.target.capability.sideEffects.includes("SPENDS_MONEY")) classes.push("paid");
  if (opportunity.target.capability.sideEffects.includes("UNKNOWN")) classes.push("unknown-cost");
  const unknownResources = classes.filter((cls) => cls === "unknown-cost").length + (opportunity.target.capability.resources.length === 0 ? 1 : 0);
  // No declared resource means the cost is simply not known — availability never implies free.
  if (opportunity.target.capability.resources.length === 0) classes.push("unknown-cost");
  const known = classes.filter((cls) => cls !== "unknown-cost").map((cls) => COST_ORDER.indexOf(cls));
  const worstKnown = known.length ? COST_ORDER[Math.max(...known)]! : null;
  const nonZero = worstKnown !== null && worstKnown !== "local-zero-cost" && worstKnown !== "free-public";
  return { aggregate: nonZero ? worstKnown : unknownResources > 0 ? "unknown-cost" : worstKnown ?? "unknown-cost", unknownResources };
}

function deriveRisk(opportunity: AyasEvolutionOpportunity, areas: readonly AyasChangeArea[], patchSafety: BrainPatchSafetyLevel, cost: AyasCostClass, prerequisites: readonly AyasEvolutionPrerequisiteResolution[]): AyasEvolutionRisk {
  const risk: Record<AyasEvolutionRiskDimension, AyasEvolutionRiskLevel> = { ...opportunity.declaredRisk };
  const lift = (dimension: AyasEvolutionRiskDimension, floor: AyasEvolutionRiskLevel) => { risk[dimension] = raise(risk[dimension], floor); };
  const effects = new Set(opportunity.target.capability.sideEffects);
  if (effects.has("UNKNOWN")) for (const dimension of ["security", "execution", "dataMutation", "externalDependency"] as const) lift(dimension, "UNKNOWN");
  if (opportunity.target.capability.capabilityClass === "UNKNOWN") lift("security", "UNKNOWN");
  if (opportunity.target.capability.resources.some((resource) => resource.kind === "UNKNOWN")) lift("externalDependency", "UNKNOWN");
  if (effects.has("WRITES_SOURCE") || effects.has("SPAWNS_PROCESS")) { lift("execution", "MEDIUM"); lift("security", "MEDIUM"); }
  if (effects.has("INSTALLS_DEPENDENCY")) { lift("externalDependency", "HIGH"); lift("security", "HIGH"); }
  if (effects.has("NETWORK_READ")) { lift("externalDependency", "MEDIUM"); lift("privacy", "MEDIUM"); }
  if (effects.has("NETWORK_WRITE")) { lift("externalDependency", "HIGH"); lift("privacy", "HIGH"); }
  if (effects.has("WRITES_RUNTIME_STORAGE")) { lift("dataMutation", "HIGH"); lift("irreversibility", "MEDIUM"); }
  if (effects.has("WRITES_LOCAL_FILES")) lift("dataMutation", "MEDIUM");
  if (effects.has("PUBLISHES")) { lift("authorityWidening", "HIGH"); lift("irreversibility", "HIGH"); }
  if (effects.has("MODIFIES_POLICY")) { lift("authorityWidening", "HIGH"); lift("security", "HIGH"); }
  if (effects.has("SPENDS_MONEY")) lift("cost", "HIGH");
  if (cost === "unknown-cost") lift("cost", "UNKNOWN");
  else if (!evaluateAyasZeroCost(cost).allowed) lift("cost", "HIGH");
  if (prerequisites.some((p) => p.external && !p.prerequisite.optional)) { lift("externalDependency", "MEDIUM"); lift("privacy", "MEDIUM"); }
  if (areas.some((area) => SENSITIVE_AREAS.has(area)) || patchSafety === "FORBIDDEN_AUTONOMOUS") { lift("authorityWidening", "HIGH"); lift("security", "HIGH"); }
  if (areas.includes("storage") || areas.includes("data")) lift("dataMutation", "MEDIUM");
  if (opportunity.constraints.some((c) => MIGRATION_CONSTRAINTS.has(c.kind)) || opportunity.impact.compatibility === "REQUIRES_MIGRATION" || opportunity.impact.compatibility === "BREAKING") {
    lift("dataMutation", "HIGH"); lift("irreversibility", "HIGH");
  }
  if (opportunity.constraints.some((c) => POLICY_CONFLICTS.has(c.kind))) { lift("authorityWidening", "HIGH"); lift("security", "HIGH"); }
  if (opportunity.target.capability.trustLevel === "THIRD_PARTY" || opportunity.target.capability.trustLevel === "UNKNOWN") {
    if ([...effects].some((effect) => effect !== "NONE" && effect !== "READS_LOCAL_FILES")) lift("security", "MEDIUM");
  }
  return Object.freeze(risk);
}

/**
 * Authority each closed descriptor value implies. An explicit UNKNOWN value
 * implies the UNION of its whole vocabulary: an undeclared or unrecognized
 * class, side effect or resource can never look less demanding than any real
 * value it might stand for. The tables are typed exhaustively, so a new
 * vocabulary entry cannot be added without deciding its authority.
 */
type Known<T extends string> = Exclude<T, "UNKNOWN">;
const CLASS_AUTHORITY: Readonly<Record<Known<AyasEvolutionCapabilityClass>, readonly AyasEvolutionAuthorityClass[]>> = {
  TOOL: [], SKILL: [], MODEL: [], AGENT: [], STORAGE_ADAPTER: [], EVALUATOR: [], PIPELINE_EXTENSION: [], UI_SURFACE: [], OTHER: [],
  LIBRARY: ["DEPENDENCY_INSTALL_APPROVAL"], SERVICE_INTEGRATION: ["EXTERNAL_SERVICE_APPROVAL"], POLICY: ["SECURITY_POLICY_APPROVAL"],
};
const EFFECT_AUTHORITY: Readonly<Record<Known<AyasEvolutionSideEffect>, readonly AyasEvolutionAuthorityClass[]>> = {
  NONE: [], READS_LOCAL_FILES: [], WRITES_LOCAL_FILES: [], WRITES_SOURCE: [], SPAWNS_PROCESS: [], SPENDS_MONEY: [],
  INSTALLS_DEPENDENCY: ["DEPENDENCY_INSTALL_APPROVAL"], NETWORK_READ: ["EXTERNAL_SERVICE_APPROVAL"], NETWORK_WRITE: ["EXTERNAL_SERVICE_APPROVAL"],
  WRITES_RUNTIME_STORAGE: ["PRODUCTION_APPROVAL"], PUBLISHES: ["PUBLISH_APPROVAL"], MODIFIES_POLICY: ["SECURITY_POLICY_APPROVAL"],
};
/** HOST_BINARY needs install approval unless a HOST_BINARY prerequisite with the same key is satisfied. */
const RESOURCE_AUTHORITY: Readonly<Record<Known<AyasEvolutionResourceKind>, readonly AyasEvolutionAuthorityClass[]>> = {
  FREE_LOCAL: [], GPU_REQUIRED: [], DISK_SPACE: [],
  LOCAL_MODEL_WEIGHTS: ["DEPENDENCY_INSTALL_APPROVAL"], HOST_BINARY: ["DEPENDENCY_INSTALL_APPROVAL"],
  PAID_MODEL: ["EXTERNAL_SERVICE_APPROVAL"], PAID_API: ["EXTERNAL_SERVICE_APPROVAL"], NETWORK_REQUIRED: ["EXTERNAL_SERVICE_APPROVAL"], EXTERNAL_ACCOUNT: ["EXTERNAL_SERVICE_APPROVAL"],
};
function implied<T extends string>(table: Readonly<Record<Known<T>, readonly AyasEvolutionAuthorityClass[]>>, value: T): readonly AyasEvolutionAuthorityClass[] {
  return value === "UNKNOWN" ? Object.values<readonly AyasEvolutionAuthorityClass[]>(table).flat() : table[value as Known<T>];
}

function deriveAuthority(opportunity: AyasEvolutionOpportunity, areas: readonly AyasChangeArea[], cost: AyasCostDecision, prerequisites: readonly AyasEvolutionPrerequisiteResolution[]): AyasEvolutionAuthorityClass[] {
  const required = new Set<AyasEvolutionAuthorityClass>(["READ_ONLY", "SOURCE_MUTATION_APPROVAL", ...opportunity.declaredAuthority]);
  const capability = opportunity.target.capability;
  const add = (authorities: readonly AyasEvolutionAuthorityClass[]) => { for (const authority of authorities) required.add(authority); };
  if (opportunity.evaluation.baselineStrategy === "EXISTING_BENCHMARK" || opportunity.evaluation.baselineStrategy === "NEW_DETERMINISTIC_EVALUATOR") required.add("EXPERIMENT_APPROVAL");
  add(implied(CLASS_AUTHORITY, capability.capabilityClass));
  for (const effect of capability.sideEffects) add(implied(EFFECT_AUTHORITY, effect));
  const satisfiedBinaries = new Set(prerequisites.filter((p) => p.prerequisite.kind === "HOST_BINARY" && p.status === "SATISFIED").map((p) => p.prerequisite.key));
  for (const resource of capability.resources) {
    if (resource.kind === "HOST_BINARY" && resource.key !== null && satisfiedBinaries.has(resource.key)) continue;
    add(implied(RESOURCE_AUTHORITY, resource.kind));
  }
  const installable = new Set(["TOOL", "SKILL", "MODEL", "HOST_BINARY"]);
  if (prerequisites.some((p) => installable.has(p.prerequisite.kind) && p.status !== "SATISFIED" && !p.prerequisite.optional)) required.add("DEPENDENCY_INSTALL_APPROVAL");
  if (prerequisites.some((p) => p.external && !p.prerequisite.optional)) required.add("EXTERNAL_SERVICE_APPROVAL");
  if (!cost.allowed) required.add("PAID_PROVIDER_APPROVAL");
  if (areas.includes("production-pipeline")) required.add("PRODUCTION_APPROVAL");
  if (areas.includes("authority") || areas.includes("execution-gate") || opportunity.constraints.some((c) => POLICY_CONFLICTS.has(c.kind))) required.add("SECURITY_POLICY_APPROVAL");
  return AYAS_EVOLUTION_AUTHORITY_CLASSES.filter((authority) => required.has(authority));
}

// ---------------------------------------------------------------- Stage 8 integration

/**
 * Phase 10 — reuse Stage 8's own gap rule: a registered benchmark, a
 * capability mapping from the closed taxonomy, a snapshot measured at the
 * CURRENT head with the same evaluator digest, and failing non-held-out
 * target cases the opportunity's own evidence names. A registered strategy
 * turns that into a real Stage 8 hypothesis; otherwise it is Stage 8's
 * NEEDS_EXPERIMENT_DESIGN, which is the design-review proposal path.
 */
export function mapAyasEvolutionToStage8(opportunity: AyasEvolutionOpportunity, env: AyasEvolutionEnvironment): AyasEvolutionQualification["stage8"] {
  const registry = env.improvementRegistry ?? AYAS_DEFAULT_IMPROVEMENT_REGISTRY;
  const benchmarkId = opportunity.evaluation.benchmarkId;
  if (opportunity.evaluation.baselineStrategy !== "EXISTING_BENCHMARK") return { outcome: "NOT_APPLICABLE", benchmarkId, hypothesis: null };
  if (!benchmarkId || !findAyasImprovementBenchmark(registry, benchmarkId)) return { outcome: "NO_LOCAL_BENCHMARK", benchmarkId, hypothesis: null };
  const category = opportunity.target.capability.knownCategory;
  const target = category ? registry.capabilityMap[category] : null;
  const entry = target?.benchmarks.find((item) => item.benchmarkId === benchmarkId);
  if (!target || !entry) return { outcome: "NO_CAPABILITY_MAPPING", benchmarkId, hypothesis: null };
  const measurements = opportunity.evidence.filter((item) => item.epistemicClass === "OBSERVED_FACT" && item.benchmark?.benchmarkId === benchmarkId);
  const snapshot = env.currentHead ? (env.gapSnapshots ?? []).find((item) => item.benchmarkId === benchmarkId && item.measuredAtHead === env.currentHead) : undefined;
  if (!snapshot) return { outcome: "GAP_NOT_MEASURED", benchmarkId, hypothesis: null };
  for (const dimension of entry.dimensions) {
    const failing = new Set(snapshot.failing.filter((row) => row.dimension === dimension && !row.heldOut).map((row) => row.id));
    const named = measurements.filter((item) => item.benchmark!.dimension === dimension && item.benchmark!.evaluatorSha256 === snapshot.evaluatorSha256)
      .flatMap((item) => item.benchmark!.caseIds).filter((id) => failing.has(id));
    const targetCaseIds = [...new Set(named)].sort();
    if (targetCaseIds.length === 0) continue;
    const mapping: Extract<AyasResearchGapMapping, { status: "MAPPED" }> = { status: "MAPPED", capability: target.capability, component: target.component, benchmarkId, dimension, targetCaseIds, snapshot };
    const strategy = selectAyasImprovementStrategy(registry, target.capability, benchmarkId, dimension);
    if (!strategy) return { outcome: "NEEDS_EXPERIMENT_DESIGN", benchmarkId, hypothesis: null };
    const findingIds = opportunity.evidence.map((item) => item.researchFindingId).filter((id): id is string => id !== null);
    return { outcome: "HYPOTHESIS", benchmarkId, hypothesis: buildAyasImprovementHypothesis(mapping, strategy, findingIds) };
  }
  return { outcome: "NO_LOCAL_GAP", benchmarkId, hypothesis: null };
}

// ---------------------------------------------------------------- qualification

interface RegisterAnalysis {
  readonly cycles: Map<string, readonly string[]>;
  readonly duplicateOf: Map<string, string>;
  readonly closedDuplicate: Map<string, { readonly id: string; readonly state: string }>;
  readonly overlapping: Map<string, string[]>;
  readonly related: Map<string, string[]>;
  readonly conflicts: Map<string, Set<string>>;
  readonly replacedBy: Map<string, string[]>;
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void { const list = map.get(key) ?? []; list.push(value); map.set(key, list); }

function analyzeRegister(register: AyasEvolutionRegister, env: AyasEvolutionEnvironment): RegisterAnalysis {
  const cycles = new Map<string, readonly string[]>();
  for (const cycle of findAyasEvolutionPrerequisiteCycles(register)) for (const id of cycle) cycles.set(id, cycle);
  const active = register.opportunities.filter(isActive).sort((a, b) => a.opportunityId.localeCompare(b.opportunityId));
  const closed = register.opportunities.filter((item) => item.lifecycle.state === "REJECTED" || item.lifecycle.state === "RETIRED").sort((a, b) => a.opportunityId.localeCompare(b.opportunityId));
  const overlapping = new Map<string, string[]>();
  const related = new Map<string, string[]>();
  const conflicts = new Map<string, Set<string>>();
  const replacedBy = new Map<string, string[]>();
  const addConflict = (a: string, b: string) => { (conflicts.get(a) ?? conflicts.set(a, new Set()).get(a)!).add(b); (conflicts.get(b) ?? conflicts.set(b, new Set()).get(b)!).add(a); };

  // Union-find over DUPLICATE edges; the strongest-evidence member is canonical, so a weak early record never suppresses a strong later one.
  const parent = new Map(active.map((item) => [item.opportunityId, item.opportunityId]));
  const find = (id: string): string => { let root = id; while (parent.get(root) !== root) root = parent.get(root)!; parent.set(id, root); return root; };
  for (let i = 0; i < active.length; i += 1) {
    for (let j = i + 1; j < active.length; j += 1) {
      const a = active[i]!; const b = active[j]!;
      const comparison = compareAyasEvolutionOpportunities(a, b);
      if (comparison.relation === "DUPLICATE") parent.set(find(a.opportunityId), find(b.opportunityId));
      else if (comparison.relation === "OVERLAPPING") { push(overlapping, a.opportunityId, b.opportunityId); push(overlapping, b.opportunityId, a.opportunityId); }
      else if (comparison.relation === "RELATED") { push(related, a.opportunityId, b.opportunityId); push(related, b.opportunityId, a.opportunityId); }
      const exclusive = (x: AyasEvolutionOpportunity, y: AyasEvolutionOpportunity) => x.constraints.some((c) => c.kind === "MUTUALLY_EXCLUSIVE_WITH" && (c.key === y.target.capability.key || c.key === y.opportunityId));
      if (exclusive(a, b) || exclusive(b, a)) addConflict(a.opportunityId, b.opportunityId);
      const competing = a.relations.replacesCapabilities.some((key) => b.relations.replacesCapabilities.includes(key)) && a.target.capability.key !== b.target.capability.key;
      if (competing) addConflict(a.opportunityId, b.opportunityId);
      if (a.relations.replacesCapabilities.includes(b.target.capability.key)) push(replacedBy, b.opportunityId, a.opportunityId);
      if (b.relations.replacesCapabilities.includes(a.target.capability.key)) push(replacedBy, a.opportunityId, b.opportunityId);
    }
  }
  const clusters = new Map<string, AyasEvolutionOpportunity[]>();
  for (const item of active) push(clusters, find(item.opportunityId), item);
  const duplicateOf = new Map<string, string>();
  for (const members of clusters.values()) {
    if (members.length < 2) continue;
    const ranked = [...members].map((item) => ({ item, evidence: summarizeEvidence(item, env) }))
      .sort((x, y) => y.evidence.strength - x.evidence.strength || Number(y.evidence.sufficient) - Number(x.evidence.sufficient)
        || x.item.createdAt.localeCompare(y.item.createdAt) || x.item.opportunityId.localeCompare(y.item.opportunityId));
    const canonical = ranked[0]!.item.opportunityId;
    for (const { item } of ranked.slice(1)) duplicateOf.set(item.opportunityId, canonical);
  }
  const closedDuplicate = new Map<string, { id: string; state: string }>();
  for (const item of active) {
    const match = closed.find((prior) => compareAyasEvolutionOpportunities(item, prior).relation === "DUPLICATE");
    if (match) closedDuplicate.set(item.opportunityId, { id: match.opportunityId, state: match.lifecycle.state });
  }
  return { cycles, duplicateOf, closedDuplicate, overlapping, related, conflicts, replacedBy };
}

function qualifyWithAnalysis(opportunity: AyasEvolutionOpportunity, register: AyasEvolutionRegister, env: AyasEvolutionEnvironment, analysis: RegisterAnalysis): AyasEvolutionQualification {
  const blockers: AyasEvolutionBlocker[] = [];
  const block = (level: BlockerLevel, code: string, reference: string | null = null) => blockers.push({ level, code, reference });
  const id = opportunity.opportunityId;
  const capability = opportunity.target.capability;
  const state = opportunity.lifecycle.state;

  const prerequisites = resolveAyasEvolutionPrerequisites(opportunity, register, env);
  const evidence = summarizeEvidence(opportunity, env);
  const areas = collectAyasChangeAreas(opportunity.impact.affectedModules);
  const patchSafety = classifyPatchSet(opportunity.impact.affectedModules).level;
  const { aggregate, unknownResources } = aggregateCost(opportunity, prerequisites);
  const costDecision = evaluateAyasZeroCost(aggregate);
  const risk = deriveRisk(opportunity, areas, patchSafety, aggregate, prerequisites);
  const required = deriveAuthority(opportunity, areas, costDecision, prerequisites);
  const stage8 = mapAyasEvolutionToStage8(opportunity, env);
  const migration = opportunity.constraints.some((c) => MIGRATION_CONSTRAINTS.has(c.kind)) || opportunity.impact.compatibility === "REQUIRES_MIGRATION" || opportunity.impact.compatibility === "BREAKING";
  const effects = new Set(capability.sideEffects);
  const offline = env.operatingMode === "OFFLINE";
  const needsNetwork = effects.has("NETWORK_READ") || effects.has("NETWORK_WRITE") || capability.resources.some((r) => r.kind === "NETWORK_REQUIRED" || r.kind === "EXTERNAL_ACCOUNT" || r.kind === "PAID_API")
    || prerequisites.some((p) => p.external && !p.prerequisite.optional) || opportunity.constraints.some((c) => c.kind === "INVALID_OFFLINE");

  // Lifecycle
  if (AYAS_EVOLUTION_TERMINAL_STATES.has(state)) block("CLOSED", `LIFECYCLE_${state}`, state === "SUPERSEDED" ? opportunity.relations.supersededBy : null);
  if (state === "DEFERRED") {
    const due = opportunity.lifecycle.deferredUntil !== null && Date.parse(opportunity.lifecycle.deferredUntil) <= Date.parse(env.now);
    block("DEFERRED", due ? "DEFERRAL_REVIEW_DUE" : "LIFECYCLE_DEFERRED");
  }

  // Blocked: untrusted instructions, dropped safety declarations, policy conflicts, cycles, incompatible prerequisites, operating mode
  // A carried signal this build does not recognize is still instruction-shaped content.
  if (opportunity.instructionSignals.length > 0 || opportunity.normalizationIssues.includes("INSTRUCTION_SIGNAL_UNRECOGNIZED")) block("BLOCKED", "UNTRUSTED_INSTRUCTION_CONTENT");
  // Evidence, safety declarations or authority-driving descriptors may have been discarded or invalidated; judging the rest would fail open.
  for (const issue of opportunity.normalizationIssues) if (isAyasEvolutionBlockingIssue(issue)) block("BLOCKED", "INVALID_SAFETY_DECLARATION", issue);
  for (const constraint of opportunity.constraints) if (POLICY_CONFLICTS.has(constraint.kind)) block("BLOCKED", constraint.kind);
  const cycle = analysis.cycles.get(id) ?? null;
  if (cycle) block("BLOCKED", "CIRCULAR_PREREQUISITE", cycle.join(","));
  const exclusive = new Set(opportunity.constraints.filter((c) => c.kind === "MUTUALLY_EXCLUSIVE_WITH").map((c) => c.key!));
  const replaced = new Set([...opportunity.relations.replacesCapabilities, ...opportunity.relations.retiresCapabilities]);
  for (const resolution of prerequisites) {
    const key = resolution.prerequisite.key;
    if (resolution.prerequisite.kind === "CAPABILITY" && replaced.has(key)) block("BLOCKED", "PREREQUISITE_REPLACED_BY_SELF", key);
    if (exclusive.has(key)) block("BLOCKED", "PREREQUISITE_MUTUALLY_EXCLUSIVE", key);
    if (resolution.status === "RETIRED" && !resolution.prerequisite.optional) block("BLOCKED", "PREREQUISITE_RETIRED", key);
  }
  const providerSets = prerequisites.filter((p) => p.providers.length > 0).map((p) => p.providers);
  for (let i = 0; i < providerSets.length; i += 1) for (let j = i + 1; j < providerSets.length; j += 1) {
    if (providerSets[i]!.some((a) => providerSets[j]!.some((b) => a !== b && analysis.conflicts.get(a)?.has(b)))) block("BLOCKED", "INCOMPATIBLE_PREREQUISITES");
  }
  if (offline && needsNetwork) block("BLOCKED", "INCOMPATIBLE_WITH_OFFLINE_MODE");
  if (own(env.capabilityKeys, capability.key) === "RETIRED" && opportunity.kind !== "RETIREMENT") block("OWNER_DECISION_REQUIRED", "TARGET_PREVIOUSLY_RETIRED", capability.key);

  // Duplicate
  const duplicateOf = analysis.duplicateOf.get(id) ?? null;
  if (duplicateOf) block("DUPLICATE", "DUPLICATE_OF_CANONICAL", duplicateOf);
  const closedDuplicate = analysis.closedDuplicate.get(id);
  if (closedDuplicate) block("OWNER_DECISION_REQUIRED", closedDuplicate.state === "REJECTED" ? "PREVIOUSLY_REJECTED" : "PREVIOUSLY_RETIRED", closedDuplicate.id);

  // Evidence
  if (!evidence.sufficient) {
    if (evidence.byClass.RESEARCH_CLAIM) block("RESEARCH_REQUIRED", "RESEARCH_CLAIM_NEEDS_LOCAL_CORROBORATION");
    else if (evidence.staleFacts > 0) block("NEEDS_INVESTIGATION", "EVIDENCE_STALE_OR_UNDATED");
    else block("INSUFFICIENT_EVIDENCE", opportunity.evidence.length === 0 ? "NO_EVIDENCE" : evidence.contradicted > 0 ? "CAPABILITY_ALREADY_AVAILABLE" : "NO_OBSERVED_FACT_OR_OWNER_REQUEST");
  }
  const present = own(env.capabilityKeys, capability.key) === "AVAILABLE";
  if (present && (opportunity.kind === "NEW_CAPABILITY" || opportunity.kind === "CAPABILITY_GAP")) block("INSUFFICIENT_EVIDENCE", "TARGET_ALREADY_AVAILABLE", capability.key);
  if (!present && opportunity.kind === "RETIREMENT") block("INSUFFICIENT_EVIDENCE", "RETIREMENT_TARGET_NOT_PRESENT", capability.key);

  // Investigation: evaluation plan, impact, unknown execution/dependency risk, Stage 8 measurement
  const evaluationIssues: string[] = [];
  const plan = opportunity.evaluation;
  if (plan.baselineStrategy === "NONE") evaluationIssues.push("NO_BASELINE_STRATEGY");
  if (plan.acceptanceCriteria.length === 0) evaluationIssues.push("NO_ACCEPTANCE_CRITERIA");
  if (plan.heldOutCriteria.length === 0) evaluationIssues.push("NO_HELD_OUT_CRITERIA");
  if (plan.regressionSuites.length === 0) evaluationIssues.push("NO_REGRESSION_SUITES");
  if (stage8.outcome === "NO_LOCAL_BENCHMARK") evaluationIssues.push("BENCHMARK_NOT_REGISTERED");
  if (stage8.outcome === "GAP_NOT_MEASURED") evaluationIssues.push("MEASUREMENT_REQUIRED_AT_CURRENT_HEAD");
  if (stage8.outcome === "NO_LOCAL_GAP") evaluationIssues.push("GAP_NOT_REPRODUCED_AT_CURRENT_HEAD");
  for (const issue of evaluationIssues) block("NEEDS_INVESTIGATION", issue);
  if (opportunity.impact.affectedModules.length === 0) block("NEEDS_INVESTIGATION", "AFFECTED_MODULES_UNDECLARED");
  if (opportunity.impact.compatibility === "UNKNOWN") block("NEEDS_INVESTIGATION", "COMPATIBILITY_UNKNOWN");
  if (risk.execution === "UNKNOWN") block("NEEDS_INVESTIGATION", "EXECUTION_RISK_UNKNOWN");
  if (risk.externalDependency === "UNKNOWN") block("NEEDS_INVESTIGATION", "EXTERNAL_DEPENDENCY_RISK_UNKNOWN");

  // Prerequisites
  for (const resolution of prerequisites) {
    if (resolution.prerequisite.optional) continue;
    const ref = `${resolution.prerequisite.kind}:${resolution.prerequisite.key}`;
    if (resolution.status === "MISSING") block("PREREQUISITES_MISSING", "PREREQUISITE_MISSING", ref);
    else if (resolution.status === "UNAVAILABLE") block("PREREQUISITES_MISSING", "PREREQUISITE_UNAVAILABLE", ref);
    else if (resolution.status === "UNKNOWN") block("PREREQUISITES_MISSING", "PREREQUISITE_STATUS_UNKNOWN", ref);
    else if (resolution.status === "PENDING_OPPORTUNITY") block("PREREQUISITES_MISSING", "PREREQUISITE_PENDING_OPPORTUNITY", ref);
    else if (resolution.status === "OWNER_DECISION_REQUIRED") block("OWNER_DECISION_REQUIRED", "OWNER_PERMISSION_PREREQUISITE", ref);
  }

  // Security review
  if (opportunity.evidence.some((item) => item.source === "SECURITY_FINDING")) block("SECURITY_REVIEW_REQUIRED", "SECURITY_FINDING_EVIDENCE");
  for (const dimension of ["security", "privacy", "authorityWidening"] as const) {
    if (risk[dimension] === "HIGH" || risk[dimension] === "UNKNOWN") block("SECURITY_REVIEW_REQUIRED", `${dimension.toUpperCase()}_RISK_${risk[dimension]}`);
  }
  if (patchSafety === "FORBIDDEN_AUTONOMOUS") block("SECURITY_REVIEW_REQUIRED", "FORBIDDEN_AUTONOMOUS_TARGET");
  if (areas.some((area) => SENSITIVE_AREAS.has(area))) block("SECURITY_REVIEW_REQUIRED", "SENSITIVE_AREA_AFFECTED");
  if (effects.has("MODIFIES_POLICY")) block("SECURITY_REVIEW_REQUIRED", "POLICY_MODIFICATION_REQUIRES_REVIEWED_COMMIT");
  if (effects.has("SPAWNS_PROCESS")) block("SECURITY_REVIEW_REQUIRED", "PROCESS_EXECUTION_REQUIRES_REVIEW");
  // Its path is a reviewed owner commit to the policy module; a design-review proposal cannot stand in for it.
  if (required.includes("SECURITY_POLICY_APPROVAL")) block("SECURITY_REVIEW_REQUIRED", "SECURITY_POLICY_APPROVAL_REQUIRED");

  // Owner decision
  const ownerAuthorities: readonly AyasEvolutionAuthorityClass[] = ["DEPENDENCY_INSTALL_APPROVAL", "EXTERNAL_SERVICE_APPROVAL", "PAID_PROVIDER_APPROVAL", "PRODUCTION_APPROVAL", "PUBLISH_APPROVAL"];
  for (const authority of ownerAuthorities) if (required.includes(authority)) block("OWNER_DECISION_REQUIRED", `${authority}_REQUIRED`);
  if (!costDecision.allowed) block("OWNER_DECISION_REQUIRED", aggregate === "unknown-cost" ? "COST_UNKNOWN" : "COST_AUTHORIZATION_REQUIRED");
  for (const other of [...(analysis.conflicts.get(id) ?? [])].sort()) block("OWNER_DECISION_REQUIRED", "CONFLICTING_OPPORTUNITY", other);
  for (const key of exclusive) if (own(env.capabilityKeys, key) === "AVAILABLE" && !replaced.has(key)) block("OWNER_DECISION_REQUIRED", "CONFLICTS_WITH_EXISTING_CAPABILITY", key);
  if (migration) block("OWNER_DECISION_REQUIRED", "MIGRATION_REQUIRES_OWNER_DECISION");
  for (const dimension of ["dataMutation", "irreversibility"] as const) {
    if (risk[dimension] === "HIGH" || risk[dimension] === "UNKNOWN") block("OWNER_DECISION_REQUIRED", `${dimension.toUpperCase()}_RISK_${risk[dimension]}`);
  }
  if (opportunity.kind === "RETIREMENT" || opportunity.kind === "REPLACEMENT" || opportunity.relations.retiresCapabilities.length > 0) block("OWNER_DECISION_REQUIRED", "CAPABILITY_RETIREMENT_REQUIRES_OWNER");
  if (opportunity.constraints.some((c) => c.kind === "INVALID_OFFLINE") && (env.operatingMode ?? "UNKNOWN") === "UNKNOWN") block("OWNER_DECISION_REQUIRED", "OPERATING_MODE_UNKNOWN");

  const ordered = blockers
    .filter((item, index, all) => all.findIndex((other) => other.code === item.code && other.reference === item.reference) === index)
    .sort((a, b) => AYAS_EVOLUTION_READINESS.indexOf(a.level) - AYAS_EVOLUTION_READINESS.indexOf(b.level) || a.code.localeCompare(b.code) || String(a.reference).localeCompare(String(b.reference)));
  const readiness: AyasEvolutionReadiness = ordered[0]?.level ?? (stage8.outcome === "HYPOTHESIS" ? "EXPERIMENT_READY" : "PROPOSAL_READY");
  const primaryReason = ordered[0]?.code ?? (stage8.outcome === "HYPOTHESIS" ? "STAGE8_HYPOTHESIS_READY" : stage8.outcome === "NEEDS_EXPERIMENT_DESIGN" ? "NEEDS_EXPERIMENT_DESIGN" : "DESIGN_REVIEW_READY");

  return Object.freeze({
    opportunityId: id,
    lifecycleState: state,
    readiness,
    primaryReason,
    blockers: Object.freeze(ordered),
    evidence,
    prerequisites,
    cycle,
    relations: {
      duplicateOf,
      overlapping: [...new Set(analysis.overlapping.get(id) ?? [])].sort(),
      related: [...new Set(analysis.related.get(id) ?? [])].sort(),
      conflictsWith: [...(analysis.conflicts.get(id) ?? [])].sort(),
      replacedBy: [...new Set(analysis.replacedBy.get(id) ?? [])].sort(),
    },
    risk,
    cost: { aggregate, unknownResources, decision: costDecision },
    authority: { required, paths: required.map((authority) => ({ authority, path: AYAS_EVOLUTION_AUTHORITY_PATHS[authority] })), granted: "NONE" as const },
    impact: { patchSafety, areas, migration },
    evaluation: { adequate: evaluationIssues.length === 0, issues: evaluationIssues },
    stage8,
    executionAuthority: "NONE",
    mayExecute: false,
    mayInstall: false,
    maySpend: false,
    mayPublish: false,
  });
}

export function qualifyAyasEvolutionRegister(register: AyasEvolutionRegister, env: AyasEvolutionEnvironment): readonly AyasEvolutionQualification[] {
  if (!Number.isFinite(Date.parse(env.now))) throw new AyasEvolutionError("AYAS_EVOLUTION_INVALID_TIME", "environment time is invalid");
  const analysis = analyzeRegister(register, env);
  return Object.freeze(register.opportunities.map((opportunity) => qualifyWithAnalysis(opportunity, register, env, analysis)));
}

export function qualifyAyasEvolutionOpportunity(opportunityId: string, register: AyasEvolutionRegister, env: AyasEvolutionEnvironment): AyasEvolutionQualification {
  const found = qualifyAyasEvolutionRegister(register, env).find((item) => item.opportunityId === opportunityId);
  if (!found) throw new AyasEvolutionError("AYAS_EVOLUTION_REGISTER_INVALID", "unknown opportunity");
  return found;
}

const NOT_QUALIFIABLE: ReadonlySet<AyasEvolutionReadiness> = new Set(["CLOSED", "DEFERRED", "BLOCKED", "DUPLICATE", "INSUFFICIENT_EVIDENCE", "RESEARCH_REQUIRED"]);

/**
 * Lifecycle transition with the qualification gates. QUALIFIED needs
 * sufficient, non-duplicate, unblocked evidence; EXPERIMENT_READY and
 * PROPOSAL_READY need the CURRENT readiness to say so; HANDED_OFF needs a
 * reference into the existing Stage 8 path (the exact hypothesis id, or a
 * proposal id). SUPERSEDED goes only through `supersedeAyasEvolutionOpportunity`.
 */
export function transitionAyasEvolutionLifecycle(register: AyasEvolutionRegister, opportunityId: string, request: AyasEvolutionTransitionRequest, env: AyasEvolutionEnvironment): AyasEvolutionRegister {
  const opportunity = register.opportunities.find((item) => item.opportunityId === opportunityId);
  if (!opportunity) throw new AyasEvolutionError("AYAS_EVOLUTION_REGISTER_INVALID", "unknown opportunity");
  const refuse = (message: string) => { throw new AyasEvolutionError("AYAS_EVOLUTION_TRANSITION_REFUSED", message); };
  if (request.to === "SUPERSEDED") refuse("use supersedeAyasEvolutionOpportunity");
  const needsQualification = request.to === "QUALIFIED" || request.to === "EXPERIMENT_READY" || request.to === "PROPOSAL_READY" || request.to === "HANDED_OFF";
  if (needsQualification) {
    const q = qualifyAyasEvolutionOpportunity(opportunityId, register, env);
    if (request.to === "QUALIFIED" && NOT_QUALIFIABLE.has(q.readiness)) refuse(`readiness ${q.readiness} cannot be qualified`);
    if ((request.to === "EXPERIMENT_READY" || request.to === "PROPOSAL_READY") && q.readiness !== request.to) refuse(`current readiness is ${q.readiness}`);
    if (request.to === "HANDED_OFF") {
      const from = opportunity.lifecycle.state;
      if (q.readiness !== from) refuse(`readiness drifted to ${q.readiness}; re-qualify first`);
      const expected = from === "EXPERIMENT_READY" && q.stage8.hypothesis ? `hypothesis:${q.stage8.hypothesis.hypothesisId}` : null;
      if (expected ? request.reference !== expected : !AYAS_EVOLUTION_HANDOFF_PROPOSAL_REFERENCE.test(String(request.reference ?? ""))) refuse("hand-off reference must point into the existing Stage 8 path");
    }
  }
  return updateAyasEvolutionOpportunity(register, applyAyasEvolutionTransition(opportunity, request));
}
