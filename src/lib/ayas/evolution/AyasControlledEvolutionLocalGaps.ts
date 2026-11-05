import fs from "node:fs";
import path from "node:path";

import type { AyasDaemonCandidate, AyasDaemonObservation } from "../../brain/autonomy/AyasAutonomyDaemon";
import { measureAyasLocalGapSnapshot } from "../../brain/autonomy/AyasResearchImprovementCycle";
import { AYAS_DEFAULT_IMPROVEMENT_REGISTRY, selectAyasImprovementStrategy, type AyasImprovementRegistry } from "../../brain/autonomy/AyasResearchExperimentRegistry";
import { AYAS_RESEARCH_EXPERIMENT_BUDGET, createAyasResearchExperimentStore, resolveAyasResearchImprovementRoot, type AyasResearchExperimentStore } from "../../brain/autonomy/AyasResearchExperimentStore";
import type { AyasLocalGapSnapshot } from "../../brain/autonomy/AyasResearchImprovementLoop";
import { inventoryAyasCapabilities } from "../routing/AyasAgenticRouting";
import { planAyasControlledSelfEvolution } from "./AyasControlledSelfEvolution";
import { currentReviewedPatchMatches } from "./AyasControlledSelfEvolutionCycle";
import { createAyasEvolutionRegister, normalizeAyasEvolutionOpportunity, type AyasEvolutionOpportunity, type AyasEvolutionRegister } from "./AyasEvolutionOpportunity";
import { qualifyAyasEvolutionRegister, type AyasEvolutionEnvironment } from "./AyasEvolutionQualification";

/**
 * Controlled self-evolution switched on (owner, 2026-11-05: "kontrollü evrimi yap"). Until now the Stage 15 cycle ran only
 * on a hand-written Stage 13 register file, which no one wrote — and could not usefully write: an opportunity's evidence
 * is bound to the HEAD and evaluator it was measured at, so a file goes stale with every commit.
 *
 * Here the register comes from the repository's own measurement instead: the registered benchmark is measured at the
 * current HEAD (once, in the research sandbox, the same Stage 8 gap snapshot), and every failing non-held-out case group
 * the capability map covers becomes one LOCAL_EVALUATOR opportunity with that measurement as its only evidence. Nothing
 * else changes: the existing cycle re-qualifies it, an experiment needs a registered owner-reviewed strategy for that
 * gap, a result is still only an Approval Inbox proposal, and the owner's click is still the only way it is applied.
 * A gap without a strategy is reported (status file), never turned into a guessed change.
 *
 * Mode (read from the discovery child's environment): AYAS_CONTROLLED_EVOLUTION=0 turns it off; an explicitly empty
 * AYAS_CONTROLLED_EVOLUTION_REGISTER_FILE keeps the old "no register" meaning (off); a path adds that file's opportunities.
 */

export type AyasControlledEvolutionMode = "OFF" | "AUTO";

export function ayasControlledEvolutionMode(env: Readonly<Record<string, string | undefined>>): AyasControlledEvolutionMode {
  if (env.AYAS_CONTROLLED_EVOLUTION === "0") return "OFF";
  const file = env.AYAS_CONTROLLED_EVOLUTION_REGISTER_FILE;
  return file !== undefined && !file.trim() ? "OFF" : "AUTO";
}

export function ayasControlledEvolutionStatusFile(repoRoot: string): string {
  return path.join(repoRoot, "data", "brain", "self-improvement", "evolution", "last-cycle.json");
}

const short = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/**
 * One opportunity per capability and dimension with failing, non-held-out cases in the snapshot. Its declared scope is the
 * registered strategy's exact files when one targets that gap; without one the opportunity can only reach
 * NEEDS_EXPERIMENT_DESIGN, which is what the status reports.
 */
export function buildAyasLocalGapEvolutionRegister(snapshot: AyasLocalGapSnapshot, registry: AyasImprovementRegistry = AYAS_DEFAULT_IMPROVEMENT_REGISTRY): AyasEvolutionRegister {
  const seen = new Set<string>();
  const opportunities: AyasEvolutionOpportunity[] = [];
  const benchmark = registry.benchmarks.find((item) => item.benchmarkId === snapshot.benchmarkId);
  if (!benchmark) return createAyasEvolutionRegister([]);
  for (const [category, target] of Object.entries(registry.capabilityMap).sort(([a], [b]) => a.localeCompare(b))) {
    const entry = target?.benchmarks.find((item) => item.benchmarkId === snapshot.benchmarkId);
    if (!target || !entry) continue;
    for (const dimension of entry.dimensions) {
      const key = `${target.capability}|${dimension}`;
      if (seen.has(key)) continue;
      const caseIds = [...new Set(snapshot.failing.filter((row) => row.dimension === dimension && !row.heldOut).map((row) => row.id))].sort().slice(0, 20);
      if (!caseIds.length) continue;
      seen.add(key);
      const strategy = selectAyasImprovementStrategy(registry, target.capability, snapshot.benchmarkId, dimension);
      opportunities.push(normalizeAyasEvolutionOpportunity({
        createdAt: snapshot.measuredAt, origin: "LOCAL_EVALUATOR", kind: "IMPROVEMENT",
        need: { summary: short(`${caseIds.length} ${dimension} case(s) of ${snapshot.benchmarkId} fail at ${snapshot.measuredAtHead.slice(0, 12)}`, 200), consequences: [short(`${target.capability} misses ${dimension}`, 200)] },
        evidence: [{
          source: "EVALUATION_FAILURE", reference: short(`benchmark:${snapshot.benchmarkId}#${caseIds.join(",")}`, 200),
          statement: short(`Measured in the research sandbox at ${snapshot.measuredAtHead.slice(0, 12)}: ${caseIds.join(", ")} fail on ${dimension}.`, 400),
          benchmark: { benchmarkId: snapshot.benchmarkId, dimension, caseIds, measuredAtHead: snapshot.measuredAtHead, evaluatorSha256: snapshot.evaluatorSha256 },
        }],
        target: {
          capability: { key: `${target.capability}.${dimension.toLowerCase().replace(/_/g, "-")}`, domain: target.capability, knownCategory: category, capabilityClass: "OTHER",
            inputs: [{ kind: "TEXT" }], outputs: [{ kind: "TEXT" }], sideEffects: ["READS_LOCAL_FILES"], resources: [{ kind: "FREE_LOCAL", costClass: "local-zero-cost" }], trustLevel: "FIRST_PARTY_REVIEWED" },
          intendedOutcome: short(`the failing ${dimension} cases pass with no regression`, 200), nonGoals: ["No automatic publication", "No evaluator, fixture or policy change"],
        },
        prerequisites: [], impact: { affectedModules: strategy ? [...strategy.exactFiles] : [], compatibility: "BACKWARD_COMPATIBLE" },
        risk: Object.fromEntries(["security", "privacy", "dataMutation", "execution", "externalDependency", "cost", "irreversibility", "authorityWidening"].map((dim) => [dim, "LOW"])),
        evaluation: { baselineStrategy: "EXISTING_BENCHMARK", benchmarkId: snapshot.benchmarkId, acceptanceCriteria: ["Target cases pass"], heldOutCriteria: ["Held-out pass count does not drop"], regressionSuites: strategy ? [...strategy.regressionSuites] : [benchmark.script] },
      }));
    }
  }
  return createAyasEvolutionRegister(opportunities);
}

export interface AyasControlledEvolutionStatus {
  readonly at: string;
  readonly head: string;
  readonly mode: AyasControlledEvolutionMode;
  readonly measurement: "MEASURED" | "REUSED" | "NOT_MEASURED";
  readonly measureAttempts: number;
  readonly snapshot: { readonly benchmarkId: string; readonly passed: number; readonly caseCount: number; readonly failing: number } | null;
  readonly opportunities: readonly { readonly opportunityId: string; readonly origin: string; readonly need: string; readonly readiness: string; readonly reason: string; readonly stage8: string }[];
  /** The opportunity the cycle would experiment on, or why none. */
  readonly plan: { readonly candidate: string | null; readonly strategyApplies: boolean | null; readonly reason: string };
  readonly proposalCandidate?: string | null;
  readonly executionAuthority: "NONE";
}

function readStatus(repoRoot: string): AyasControlledEvolutionStatus | null {
  try { return JSON.parse(fs.readFileSync(ayasControlledEvolutionStatusFile(repoRoot), "utf8")) as AyasControlledEvolutionStatus; } catch { return null; }
}

function writeStatus(repoRoot: string, status: AyasControlledEvolutionStatus): void {
  const file = ayasControlledEvolutionStatusFile(repoRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.${process.pid}.tmp`, `${JSON.stringify(status, null, 2)}\n`);
  fs.renameSync(`${file}.${process.pid}.tmp`, file);
}

export interface AyasControlledEvolutionPrepareInput {
  readonly repoRoot: string;
  readonly observation: AyasDaemonObservation;
  /** The optional operator register (AYAS_CONTROLLED_EVOLUTION_REGISTER_FILE); its opportunities are kept beside the measured ones. */
  readonly fileRegister: AyasEvolutionRegister | null;
  readonly remainingMs: () => number;
  readonly registry?: AyasImprovementRegistry;
  readonly experimentStore?: AyasResearchExperimentStore;
  readonly nodeModulesDir?: string;
  readonly now?: () => string;
  /** Test seam; production measures in the research sandbox. */
  readonly measure?: typeof measureAyasLocalGapSnapshot;
}

/**
 * The register the cycle gets this tick: the measured gaps at HEAD (measuring once if no snapshot exists yet, at most
 * twice per HEAD, only when the evaluator is in the checkout and the time budget allows) plus the operator's file. It
 * writes the status; it starts no experiment.
 */
export async function prepareAyasControlledEvolutionRegister(input: AyasControlledEvolutionPrepareInput): Promise<AyasEvolutionRegister> {
  const registry = input.registry ?? AYAS_DEFAULT_IMPROVEMENT_REGISTRY;
  const now = input.now ?? (() => new Date().toISOString());
  const head = input.observation.head;
  const store = input.experimentStore ?? createAyasResearchExperimentStore({ rootDir: resolveAyasResearchImprovementRoot(input.repoRoot) });
  const benchmark = registry.benchmarks.find((item) => registry.strategies.some((strategy) => strategy.benchmarkId === item.benchmarkId)) ?? registry.benchmarks[0];
  const previous = readStatus(input.repoRoot);
  let attempts = previous?.head === head ? previous.measureAttempts : 0;
  let measurement: AyasControlledEvolutionStatus["measurement"] = "NOT_MEASURED";
  const atHead = () => (benchmark ? store.listGapSnapshots().find((item) => item.measuredAtHead === head && item.benchmarkId === benchmark.benchmarkId) : undefined);
  let snapshot = atHead();
  if (snapshot) measurement = "REUSED";
  else if (benchmark && fs.existsSync(path.join(input.repoRoot, benchmark.script)) && attempts < AYAS_RESEARCH_EXPERIMENT_BUDGET.maxMeasurementAttemptsPerHead
    && input.remainingMs() >= AYAS_RESEARCH_EXPERIMENT_BUDGET.minGapSnapshotTimeBudgetMs) {
    attempts += 1;
    const measured = await (input.measure ?? measureAyasLocalGapSnapshot)({ repoRoot: input.repoRoot, head, benchmark,
      timeoutMs: Math.max(1_000, Math.min(benchmark.timeoutMs, input.remainingMs() - 5_000)), nowIso: now(),
      ...(input.nodeModulesDir ? { nodeModulesDir: input.nodeModulesDir } : {}) });
    if (measured) {
      await store.withLock(async () => { if (!atHead()) store.writeGapSnapshot(measured, AYAS_RESEARCH_EXPERIMENT_BUDGET.maxGapSnapshots); });
      snapshot = atHead() ?? measured;
      measurement = "MEASURED";
    }
  }
  const local = snapshot ? buildAyasLocalGapEvolutionRegister(snapshot, registry).opportunities : [];
  const fileOpportunities = (input.fileRegister?.opportunities ?? []).filter((item) => !local.some((own) => own.opportunityId === item.opportunityId));
  const register = createAyasEvolutionRegister([...local, ...fileOpportunities]);

  const environment: AyasEvolutionEnvironment = {
    now: now(), currentHead: head, capabilities: inventoryAyasCapabilities({ availableModelIds: [], availableSkillIds: [], availableAgentIds: [] }),
    operatingMode: "UNKNOWN", improvementRegistry: registry, gapSnapshots: store.listGapSnapshots(),
  };
  const qualifications = qualifyAyasEvolutionRegister(register, environment);
  const plan = planAyasControlledSelfEvolution({ register, environment });
  const strategyApplies = plan.candidate ? currentReviewedPatchMatches(input.repoRoot, head, plan.candidate.strategy) : null;
  const reason = !snapshot ? (benchmark ? "benchmark not measured at this HEAD yet" : "no registered benchmark")
    : !register.opportunities.length ? `no failing non-held-out case at this HEAD (${snapshot.passed}/${snapshot.caseCount} pass) — nothing to evolve`
      : plan.candidate ? (strategyApplies ? "experiment candidate; the cycle runs it in the sandbox" : "strategy no longer applies to the current source (already applied or changed)")
        : "measured gap without a registered owner-reviewed strategy (NEEDS_EXPERIMENT_DESIGN)";
  writeStatus(input.repoRoot, {
    at: now(), head, mode: "AUTO", measurement, measureAttempts: attempts,
    snapshot: snapshot ? { benchmarkId: snapshot.benchmarkId, passed: snapshot.passed, caseCount: snapshot.caseCount, failing: snapshot.failing.length } : null,
    opportunities: register.opportunities.map((opportunity) => {
      const q = qualifications.find((item) => item.opportunityId === opportunity.opportunityId);
      return { opportunityId: opportunity.opportunityId, origin: opportunity.origin, need: opportunity.need.summary, readiness: q?.readiness ?? "UNKNOWN", reason: q?.primaryReason ?? "UNKNOWN", stage8: q?.stage8.outcome ?? "UNKNOWN" };
    }),
    plan: { candidate: plan.candidate?.opportunityId ?? null, strategyApplies, reason },
    executionAuthority: "NONE",
  });
  return register;
}

/** Adds the cycle's result (a proposal candidate for the inbox, or none) to this tick's status. */
export function recordAyasControlledEvolutionOutcome(repoRoot: string, candidate: AyasDaemonCandidate | null): void {
  const status = readStatus(repoRoot);
  if (status) writeStatus(repoRoot, { ...status, proposalCandidate: candidate ? candidate.sourceReference ?? "candidate" : null });
}
