import { AYAS_DEFAULT_IMPROVEMENT_REGISTRY, ayasImprovementRegistryDigest, validateAyasImprovementStrategy, type AyasImprovementBenchmark, type AyasImprovementStrategy } from "../../brain/autonomy/AyasResearchExperimentRegistry";
import type { AyasImprovementHypothesis } from "../../brain/autonomy/AyasResearchImprovementLoop";
import type { AyasExperimentSourceBinding } from "../../brain/autonomy/AyasResearchExperimentEvaluation";
import { classifyPatchSet } from "../../brain/selfheal/BrainPatchSafety";
import { qualifyAyasEvolutionRegister, type AyasEvolutionEnvironment, type AyasEvolutionQualification } from "./AyasEvolutionQualification";
import type { AyasEvolutionOpportunity, AyasEvolutionRegister } from "./AyasEvolutionOpportunity";

export interface AyasControlledEvolutionCandidate {
  readonly opportunityId: string;
  readonly baseHead: string;
  readonly registryDigest: string;
  readonly dedupeKey: string;
  readonly hypothesis: AyasImprovementHypothesis;
  readonly strategy: AyasImprovementStrategy;
  readonly benchmark: AyasImprovementBenchmark;
  readonly sourceBindings: readonly AyasExperimentSourceBinding[];
  readonly qualification: AyasEvolutionQualification;
}

export interface AyasControlledEvolutionPlan {
  readonly candidate: AyasControlledEvolutionCandidate | null;
  readonly qualifiedCount: number;
  readonly readyCount: number;
}

const FULL_HEAD = /^[0-9a-f]{40}$/;
const FORBIDDEN_EFFECTS = new Set(["NETWORK_READ", "NETWORK_WRITE", "INSTALLS_DEPENDENCY", "SPENDS_MONEY", "WRITES_RUNTIME_STORAGE", "PUBLISHES", "MODIFIES_POLICY", "UNKNOWN"]);
const FORBIDDEN_RESOURCES = new Set(["PAID_API", "PAID_MODEL", "EXTERNAL_ACCOUNT", "NETWORK_REQUIRED", "LOCAL_MODEL_WEIGHTS", "HOST_BINARY", "UNKNOWN"]);
const FORBIDDEN_AUTHORITIES = new Set(["DEPENDENCY_INSTALL_APPROVAL", "EXTERNAL_SERVICE_APPROVAL", "PAID_PROVIDER_APPROVAL", "PRODUCTION_APPROVAL", "PUBLISH_APPROVAL", "SECURITY_POLICY_APPROVAL"]);
const RISK_DIMENSIONS = ["authorityWidening", "security", "privacy", "dataMutation", "cost", "irreversibility", "execution", "externalDependency"] as const;

/** A stable tuple for the caller's durable dedupe store; no store or I/O belongs to planning. */
export function ayasControlledEvolutionDedupeKey(input: { readonly opportunityId: string; readonly hypothesisId: string; readonly baseHead: string; readonly registryDigest: string }): string {
  return JSON.stringify([input.opportunityId, input.hypothesisId, input.baseHead, input.registryDigest]);
}

function sourceBindings(opportunity: AyasEvolutionOpportunity, hypothesis: AyasImprovementHypothesis): readonly AyasExperimentSourceBinding[] | null {
  const realFindings = [...new Set(opportunity.evidence.map((item) => item.researchFindingId).filter((id): id is string => id !== null))].sort();
  if (realFindings.length !== hypothesis.findingIds.length || realFindings.some((id) => !hypothesis.findingIds.includes(id))) return null;
  return [{ kind: "EVOLUTION_OPPORTUNITY", id: opportunity.opportunityId }, ...realFindings.map((id) => ({ kind: "RESEARCH_FINDING" as const, id }))];
}

function safeCurrentCandidate(opportunity: AyasEvolutionOpportunity, qualification: AyasEvolutionQualification, env: AyasEvolutionEnvironment): AyasControlledEvolutionCandidate | null {
  const head = env.currentHead;
  const registry = env.improvementRegistry ?? AYAS_DEFAULT_IMPROVEMENT_REGISTRY;
  const hypothesis = qualification.stage8.hypothesis;
  if (!head || !FULL_HEAD.test(head) || qualification.readiness !== "EXPERIMENT_READY" || qualification.blockers.length > 0
    || qualification.executionAuthority !== "NONE" || qualification.authority.granted !== "NONE"
    || qualification.mayExecute || qualification.mayInstall || qualification.maySpend || qualification.mayPublish
    || qualification.stage8.outcome !== "HYPOTHESIS" || !hypothesis || qualification.impact.patchSafety !== "SAFE"
    || !qualification.cost.decision.allowed || qualification.cost.unknownResources > 0
    || qualification.authority.required.some((authority) => FORBIDDEN_AUTHORITIES.has(authority))
    || RISK_DIMENSIONS.some((dimension) => ["HIGH", "UNKNOWN"].includes(qualification.risk[dimension]))
    || opportunity.normalizationIssues.length > 0 || opportunity.instructionSignals.length > 0
    || opportunity.target.capability.sideEffects.some((effect) => FORBIDDEN_EFFECTS.has(effect))
    || opportunity.target.capability.resources.some((resource) => FORBIDDEN_RESOURCES.has(resource.kind) || !["local-zero-cost", "free-public"].includes(resource.costClass))
    || opportunity.prerequisites.some((prerequisite) => ["EXTERNAL_SERVICE", "EXTERNAL_ACCOUNT", "OWNER_PERMISSION", "HOST_BINARY", "MODEL"].includes(prerequisite.kind))
    || opportunity.constraints.some((constraint) => ["CONFLICTS_WITH_APPROVAL_POLICY", "CONFLICTS_WITH_EXECUTION_POLICY", "CONFLICTS_WITH_SECURITY_POLICY", "REQUIRES_STORAGE_MIGRATION", "INCOMPATIBLE_WITH_STORAGE_SCHEMA", "BREAKS_BACKWARD_COMPATIBILITY"].includes(constraint.kind))) return null;
  const strategy = registry.strategies.find((item) => item.strategyId === hypothesis.strategyId && item.version === hypothesis.strategyVersion);
  const benchmark = registry.benchmarks.find((item) => item.benchmarkId === hypothesis.benchmarkId);
  const snapshot = env.gapSnapshots?.find((item) => item.benchmarkId === hypothesis.benchmarkId && item.measuredAtHead === head && item.evaluatorSha256 === hypothesis.gapEvidence.evaluatorSha256);
  if (!strategy || !benchmark || !snapshot || validateAyasImprovementStrategy(strategy).length > 0
    || classifyPatchSet(strategy.exactFiles).level !== "SAFE" || hypothesis.riskClass !== "SAFE"
    || JSON.stringify([...new Set(opportunity.impact.affectedModules)].sort()) !== JSON.stringify([...new Set(strategy.exactFiles)].sort())
    || hypothesis.gapEvidence.measuredAtHead !== head || hypothesis.gapEvidence.failingTargetCount < 1
    || hypothesis.strategyId !== strategy.strategyId || hypothesis.strategyVersion !== strategy.version
    || hypothesis.benchmarkId !== strategy.benchmarkId || hypothesis.benchmarkId !== benchmark.benchmarkId
    || hypothesis.capability !== strategy.capability || hypothesis.component !== strategy.component
    || !strategy.dimensions.includes(hypothesis.targetDimension) || !benchmark.dimensions.includes(hypothesis.targetDimension)
    || JSON.stringify([hypothesis.exactFiles, hypothesis.regressionSuites, hypothesis.maxChangedLines]) !== JSON.stringify([strategy.exactFiles, strategy.regressionSuites, strategy.maxChangedLines])
    || hypothesis.targetCaseIds.length === 0 || hypothesis.targetCaseIds.some((id) => !snapshot.failing.some((row) => row.id === id && row.dimension === hypothesis.targetDimension && !row.heldOut))) return null;
  const bindings = sourceBindings(opportunity, hypothesis);
  if (!bindings) return null;
  const registryDigest = ayasImprovementRegistryDigest(registry);
  return { opportunityId: opportunity.opportunityId, baseHead: head, registryDigest,
    dedupeKey: ayasControlledEvolutionDedupeKey({ opportunityId: opportunity.opportunityId, hypothesisId: hypothesis.hypothesisId, baseHead: head, registryDigest }),
    hypothesis, strategy, benchmark, sourceBindings: bindings, qualification };
}

/** Re-qualifies current truth and selects at most one advisory sandbox candidate. Never runs one. */
export function planAyasControlledSelfEvolution(input: { readonly register: AyasEvolutionRegister; readonly environment: AyasEvolutionEnvironment; readonly seenDedupeKeys?: ReadonlySet<string> }): AyasControlledEvolutionPlan {
  const qualifications = qualifyAyasEvolutionRegister(input.register, input.environment);
  if (input.environment.currentHead === null) return { candidate: null, qualifiedCount: qualifications.length, readyCount: 0 };
  const byId = new Map(qualifications.map((item) => [item.opportunityId, item]));
  const ready = input.register.opportunities
    .map((opportunity) => safeCurrentCandidate(opportunity, byId.get(opportunity.opportunityId)!, input.environment))
    .filter((candidate): candidate is AyasControlledEvolutionCandidate => candidate !== null)
    .sort((a, b) => a.opportunityId.localeCompare(b.opportunityId));
  return { candidate: ready.find((candidate) => !input.seenDedupeKeys?.has(candidate.dedupeKey)) ?? null, qualifiedCount: qualifications.length, readyCount: ready.length };
}
