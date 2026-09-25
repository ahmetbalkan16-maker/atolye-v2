import type { AyasInboxProposal } from "../../brain/autonomy/AyasApprovalInboxStore";
import type { AyasDaemonCandidate } from "../../brain/autonomy/AyasAutonomyDaemon";
import type { AyasImpactLevel, AyasProposalStructuredImpact } from "../../brain/autonomy/AyasProposalImpact";
import type { AyasImprovementHypothesis } from "../../brain/autonomy/AyasResearchImprovementLoop";
import { redactAyasHandoffText } from "../developer/AyasDeveloperHandoff";
import { describeAyasDeveloperTask, type AyasDeveloperTask } from "../developer/AyasDeveloperTaskModel";
import { isAyasEvolutionBlockingIssue, type AyasEvolutionOpportunity, type AyasEvolutionRiskLevel } from "./AyasEvolutionOpportunity";
import type { AyasEvolutionQualification } from "./AyasEvolutionQualification";

/**
 * Stage 13 → existing paths. Nothing here writes, dispatches or approves.
 *
 * - EXPERIMENT_READY hands over the Stage 8 hypothesis object itself; only
 *   Stage 8's own experiment admission can run it.
 * - PROPOSAL_READY becomes an ordinary `AyasDaemonCandidate` for the
 *   existing `AyasAutonomyDaemon.discover()` → inbox → owner review flow.
 *   Its mutation kind is deliberately UNREGISTERED (the same posture as
 *   Stage 8's `research-adaptation-plan:v1`), so even an owner approval
 *   records a decision but cannot execute anything.
 * - A bounded Stage 10 hand-off draft carries only what the developer
 *   handoff CLI already accepts; delivery stays a manual owner paste.
 */
export const AYAS_EVOLUTION_PLAN_MUTATION_KIND = "evolution-opportunity-plan:v1";
export const AYAS_EVOLUTION_PROPOSAL_EVIDENCE_PREFIX = "evolution-opportunity:";

/** Defense in depth: a record that lost or invalidated safety-relevant input never leaves Stage 13, whatever qualification object is supplied. */
const carriesBlockingIssue = (opportunity: AyasEvolutionOpportunity) => opportunity.normalizationIssues.some(isAyasEvolutionBlockingIssue);

const LEVEL: Readonly<Record<AyasEvolutionRiskLevel, AyasImpactLevel>> = { NONE: "none", LOW: "low", MEDIUM: "medium", HIGH: "high", UNKNOWN: "unresolved" };

/** Maps the qualification onto the existing structured-impact contract; anything unmodeled stays "unresolved". */
export function ayasEvolutionStructuredImpact(opportunity: AyasEvolutionOpportunity, q: AyasEvolutionQualification): AyasProposalStructuredImpact {
  const required = new Set(q.authority.required);
  const paid = q.cost.aggregate !== "unknown-cost" && !q.cost.decision.allowed;
  return {
    dependencyImpact: required.has("DEPENDENCY_INSTALL_APPROVAL") ? "new-package"
      : required.has("EXTERNAL_SERVICE_APPROVAL") ? (paid ? "external-paid-service" : q.cost.decision.allowed ? "external-free-service" : "unresolved")
      : q.cost.decision.allowed ? "local-free" : "unresolved",
    externalServiceImpact: required.has("EXTERNAL_SERVICE_APPROVAL") ? LEVEL[q.risk.externalDependency] : q.risk.externalDependency === "UNKNOWN" ? "unresolved" : "none",
    estimatedCost: q.cost.decision.allowed ? "zero-cost" : q.cost.aggregate === "unknown-cost" ? "unresolved" : "non-zero",
    paidCommitmentRequired: !q.cost.decision.allowed,
    // Stage 13 does not model licensing; it never claims a license verdict.
    licensingImpact: "unresolved",
    licensingStatus: "unresolved",
    securityImpact: LEVEL[q.risk.security],
    authorityImpact: LEVEL[q.risk.authorityWidening],
    storageImpact: LEVEL[q.risk.dataMutation],
    productionImpact: required.has("PRODUCTION_APPROVAL") ? "high" : "none",
    reversibility: q.risk.irreversibility === "UNKNOWN" ? "unresolved" : q.risk.irreversibility === "HIGH" ? "irreversible" : q.risk.irreversibility === "MEDIUM" ? "reversible-with-effort" : "fully-reversible",
    validationConfidence: opportunity.evaluation.baselineStrategy === "EXISTING_BENCHMARK" ? "high"
      : opportunity.evaluation.baselineStrategy === "NEW_DETERMINISTIC_EVALUATOR" ? "medium"
      : opportunity.evaluation.baselineStrategy === "MANUAL_OWNER_REVIEW" ? "low" : "unresolved",
  };
}

/**
 * PROPOSAL_READY only. Every text field is a server-owned template around
 * ids, keys and the neutralized, bounded need summary; the instruction scan
 * already blocked anything directive-shaped before this point.
 */
export function buildAyasEvolutionProposalCandidate(opportunity: AyasEvolutionOpportunity, q: AyasEvolutionQualification, rank = 30_000): AyasDaemonCandidate | null {
  if (q.opportunityId !== opportunity.opportunityId || q.readiness !== "PROPOSAL_READY" || q.executionAuthority !== "NONE" || opportunity.instructionSignals.length > 0 || carriesBlockingIssue(opportunity)) return null;
  const key = opportunity.target.capability.key;
  const planningFile = `docs/brain/proposals/evolution-${opportunity.opportunityId}.md`;
  const summary = opportunity.need.summary.slice(0, 300);
  return {
    objective: `${key} evrim fırsatını sahip incelemesi için bağımsız bir tasarım kaydına dönüştür`,
    currentProblem: summary || `${key} için kanıtlı bir yetenek boşluğu kaydedildi.`,
    selectionReason: `Stage 13 nitelendirmesi PROPOSAL_READY (${q.primaryReason}); kanıt, ön koşul, çatışma, maliyet ve yetki kontrolleri engel bulmadı.`,
    expectedUserBenefit: "Kanıtlı bir yetenek boşluğu dağınık not olarak kalmaz; kaynaklı, sınırlı ve sahip onayına bağlı bir tasarım kaydı olur.",
    expectedBehaviorChange: "Bu öneri yalnız bir tasarım incelemesi açar; üretim kodu veya çalışma zamanı davranışı değişmez.",
    unchangedBehavior: "Owner approval, execution gate, mutation registry, maliyet politikası ve yayın yolu değişmez; mutation kind kayıtlı değildir, onay bile yürütme başlatamaz.",
    riskIfNotDone: "Nitelendirilmiş bir evrim fırsatı yalnız Stage 13 kaydında kalır ve sahip görünürlüğüne ulaşmaz.",
    technicalRisk: `Düşük; non-executable planlama önerisi. Gereken yetkiler: ${q.authority.required.join(", ")} (hiçbiri verilmedi).`,
    productionImpact: "none — evolution planning record only",
    rationale: `Evolution opportunity ${opportunity.opportunityId} (${opportunity.kind}, ${opportunity.target.capability.domain}) qualified as PROPOSAL_READY; Stage 8 outcome ${q.stage8.outcome}.`,
    evidence: [
      `${AYAS_EVOLUTION_PROPOSAL_EVIDENCE_PREFIX}${opportunity.opportunityId}`,
      ...opportunity.evidence.slice(0, 12).map((item) => `evidence:${item.source}:${item.epistemicClass}:${item.reference ?? "none"}`),
      `readiness:${q.readiness}`,
      `cost:${q.cost.aggregate}`,
      `requiredAuthority:${q.authority.required.join(",")}`,
      "executionAuthority:NONE",
      "treatedSourceAsUntrusted:true",
    ],
    graphifyEvidence: [`target:${key}; modules:${opportunity.impact.affectedModules.slice(0, 8).join(",") || "none"}; planning record only, no authority or production edge is introduced`],
    exactFiles: [planningFile],
    expectedDiffScope: `Yalnız ${planningFile} plan kaydı; bu öneri kendi başına dosya yazamaz.`,
    testsPlanned: opportunity.evaluation.regressionSuites.length > 0 ? [...opportunity.evaluation.regressionSuites] : ["dedicated evaluator + validator required before execution eligibility"],
    risk: "low; non-executable evolution planning candidate",
    rank,
    mutationKind: AYAS_EVOLUTION_PLAN_MUTATION_KIND,
    structuredImpact: ayasEvolutionStructuredImpact(opportunity, q),
    discoverySource: "LOCAL_DISCOVERY",
    sourceReference: opportunity.opportunityId,
  };
}

/** EXPERIMENT_READY only: the Stage 8 hypothesis, untouched. Stage 8 admission decides whether and when it runs. */
export function ayasEvolutionExperimentHypothesis(q: AyasEvolutionQualification): AyasImprovementHypothesis | null {
  return q.readiness === "EXPERIMENT_READY" && q.stage8.outcome === "HYPOTHESIS" ? q.stage8.hypothesis : null;
}

export interface AyasEvolutionDeveloperHandoff {
  readonly opportunityId: string;
  readonly style: "IMPLEMENTATION" | "ANALYSIS";
  readonly mission: string;
  readonly task: AyasDeveloperTask;
  readonly expectedScope: readonly string[];
  readonly acceptance: readonly string[];
  readonly knownDeferred: readonly string[];
  /** Arguments for the existing `scripts/ayas-developer-handoff.ts`; printing a packet never dispatches. */
  readonly handoffCliArgs: readonly string[];
  readonly delivery: "MANUAL_OWNER_PASTE";
  readonly dispatch: "NONE";
  readonly startsMutation: false;
  readonly requiresOwnerApprovalBeforeMutation: true;
}

const IMPLEMENTATION_READY = new Set(["PROPOSAL_READY", "EXPERIMENT_READY"]);
const ANALYSIS_READY = new Set(["NEEDS_INVESTIGATION", "RESEARCH_REQUIRED", "PREREQUISITES_MISSING"]);

/**
 * Phase 11 — a bounded Stage 10 task draft. The mission names only the
 * opportunity id (a hex identifier), so external wording can never steer
 * the Stage 10 task classifier; target, criteria and blockers travel as
 * data lines. Blocked, duplicate, closed or evidence-poor opportunities get
 * no hand-off at all.
 */
export function buildAyasEvolutionDeveloperHandoff(opportunity: AyasEvolutionOpportunity, q: AyasEvolutionQualification, baselineHead: string | null): AyasEvolutionDeveloperHandoff | null {
  if (q.opportunityId !== opportunity.opportunityId || opportunity.instructionSignals.length > 0 || carriesBlockingIssue(opportunity)) return null;
  const style = IMPLEMENTATION_READY.has(q.readiness) ? "IMPLEMENTATION" : ANALYSIS_READY.has(q.readiness) ? "ANALYSIS" : null;
  if (!style) return null;
  const mission = redactAyasHandoffText(style === "IMPLEMENTATION"
    ? `Sahip onayı kaydedildikten sonra evrim fırsatı ${opportunity.opportunityId} için sınırlı değişikliği uygula; kabul, held-out ve regresyon ölçütlerini doğrula.`
    : `Evrim fırsatı ${opportunity.opportunityId} için kanıtı ve ön koşulları salt-okunur incele ve rapor ver.`);
  const expectedScope = [...opportunity.impact.affectedModules];
  const acceptance = [
    `target: ${opportunity.target.capability.key} (${opportunity.target.capability.domain})`,
    ...opportunity.evaluation.acceptanceCriteria.map((item) => `acceptance: ${redactAyasHandoffText(item, 200)}`),
    ...opportunity.evaluation.heldOutCriteria.map((item) => `held-out: ${redactAyasHandoffText(item, 200)}`),
    ...opportunity.evaluation.regressionSuites.map((suite) => `regression: ${suite}`),
    `required authority (not granted): ${q.authority.required.join(", ")}`,
  ];
  const knownDeferred = q.blockers.map((item) => `${item.level}:${item.code}${item.reference ? `:${item.reference}` : ""}`);
  return Object.freeze({
    opportunityId: opportunity.opportunityId,
    style,
    mission,
    task: describeAyasDeveloperTask({ text: mission, changedPaths: expectedScope }),
    expectedScope,
    acceptance,
    knownDeferred,
    handoffCliArgs: ["--task", mission, ...(baselineHead ? ["--baseline", baselineHead] : []), ...expectedScope.flatMap((scope) => ["--scope", scope]), ...knownDeferred.flatMap((item) => ["--deferred", item])],
    delivery: "MANUAL_OWNER_PASTE",
    dispatch: "NONE",
    startsMutation: false,
    requiresOwnerApprovalBeforeMutation: true,
  });
}

export type AyasEvolutionOwnerDecision = "NONE" | "PENDING" | "APPROVED_EXTERNALLY" | "REJECTED" | "DEFERRED" | "STALE";

/**
 * Reads the EXISTING inbox's decision for the proposal this opportunity
 * produced. Only a proposal bound to this opportunity by `sourceReference`
 * and the evolution mutation kind counts. Even `APPROVED_EXTERNALLY` grants
 * Stage 13 nothing: the mutation kind is unregistered, so the existing gate
 * refuses to execute it.
 */
export function readAyasEvolutionOwnerDecision(opportunityId: string, proposals: readonly Pick<AyasInboxProposal, "sourceReference" | "mutationKind" | "status" | "lastUpdatedAt">[]): AyasEvolutionOwnerDecision {
  const bound = proposals.filter((proposal) => proposal.sourceReference === opportunityId && proposal.mutationKind === AYAS_EVOLUTION_PLAN_MUTATION_KIND)
    .sort((a, b) => b.lastUpdatedAt.localeCompare(a.lastUpdatedAt))[0];
  if (!bound) return "NONE";
  switch (bound.status) {
    case "PENDING": return "PENDING";
    case "APPROVED": case "RESERVED": case "COMPLETED": return "APPROVED_EXTERNALLY";
    case "REJECTED": return "REJECTED";
    case "DEFERRED": return "DEFERRED";
    default: return "STALE";
  }
}
