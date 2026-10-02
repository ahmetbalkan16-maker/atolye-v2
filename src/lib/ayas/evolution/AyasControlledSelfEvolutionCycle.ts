import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import type { AyasDaemonCandidate, AyasDaemonObservation } from "../../brain/autonomy/AyasAutonomyDaemon";
import type { AyasApprovalInboxHandle } from "../../brain/autonomy/AyasApprovalInboxStore";
import { AYAS_PATCH_ARTIFACT_MUTATION_KIND } from "../../brain/autonomy/AyasNovelPatchDiscovery";
import { createAyasPatchArtifactStore, type AyasPatchArtifactStore } from "../../brain/autonomy/AyasPatchArtifact";
import { experimentInputsDigest, measureAyasLocalGapSnapshot } from "../../brain/autonomy/AyasResearchImprovementCycle";
import { AYAS_DEFAULT_IMPROVEMENT_REGISTRY, type AyasImprovementRegistry } from "../../brain/autonomy/AyasResearchExperimentRegistry";
import { AYAS_RESEARCH_EXPERIMENT_BUDGET, createAyasResearchExperimentStore, decideAyasExperimentAdmission,
  reconcileAyasInterruptedExperiments, resolveAyasResearchImprovementRoot, type AyasExperimentRecord, type AyasResearchExperimentStore } from "../../brain/autonomy/AyasResearchExperimentStore";
import { AYAS_RESEARCH_IMPROVEMENT_SCHEMA_VERSION } from "../../brain/autonomy/AyasResearchImprovementLoop";
import { runAyasRegisteredImprovementExperiment } from "../../brain/autonomy/AyasRegisteredImprovementExperiment";
import { verifyAyasReviewedExactPatch } from "../../brain/selfheal/AyasExactPatchSafety";
import { classifyPatchSet } from "../../brain/selfheal/BrainPatchSafety";
import { readProcessStartEpochMs } from "../../brain/autonomy/AyasProcessLiveness";
import type { AyasGoldenVault } from "../golden/AyasGoldenVault";
import { inventoryAyasCapabilities } from "../routing/AyasAgenticRouting";
import { parseAyasEvolutionRegister, type AyasEvolutionRegister } from "./AyasEvolutionOpportunity";
import { type AyasEvolutionEnvironment } from "./AyasEvolutionQualification";
import { planAyasControlledSelfEvolution, type AyasControlledEvolutionCandidate } from "./AyasControlledSelfEvolution";
import { freezeAyasControlledEvolutionArtifact } from "./AyasControlledSelfEvolutionArtifact";
import { buildAyasControlledEvolutionProposalCandidate } from "./AyasControlledSelfEvolutionBridge";

const MAX_REGISTER_BYTES = 2 * 1024 * 1024;
const HEX64 = /^[0-9a-f]{64}$/;
const sha256 = (value: string): string => crypto.createHash("sha256").update(value, "utf8").digest("hex");

/** REVIEW_REQUIRED remains the path default; only the exact reviewed output can enter TEMP. */
function currentReviewedPatchMatches(repoRoot: string, head: string, strategy: AyasControlledEvolutionCandidate["strategy"]): boolean {
  if (classifyPatchSet(strategy.exactFiles).level === "SAFE") return true;
  const manifest = strategy.reviewedExactPatch;
  if (!manifest || strategy.exactFiles.length !== 1) return false;
  try {
    const git = (...args: string[]) => execFileSync("git", ["--no-optional-locks", ...args],
      { cwd: repoRoot, encoding: "utf8", windowsHide: true, timeout: 30_000, maxBuffer: 1_000_000 }).trim();
    if (git("rev-parse", "HEAD") !== head || git("status", "--porcelain") !== "") return false;
    const file = strategy.exactFiles[0]!;
    const before = execFileSync("git", ["show", `${head}:${file}`],
      { cwd: repoRoot, encoding: "utf8", windowsHide: true, timeout: 30_000, maxBuffer: 1_000_000 });
    if (fs.readFileSync(path.join(repoRoot, file), "utf8") !== before) return false;
    const generated = strategy.generate({ readFile: (requested) => requested === file ? before : null });
    return generated.length === 1 && generated[0]?.filePath === file
      && verifyAyasReviewedExactPatch(manifest, file, before, generated[0].content) !== null;
  } catch { return false; }
}

/** The Stage 13 CLI's validated JSON shape is the only optional daemon input; no parallel register is created. */
export function readAyasControlledEvolutionRegister(file: string): AyasEvolutionRegister {
  const size = fs.statSync(file).size;
  if (size > MAX_REGISTER_BYTES || size === 0) throw new Error("AYAS_EVOLUTION_REGISTER_SIZE_INVALID");
  const raw: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("AYAS_EVOLUTION_REGISTER_SHAPE_INVALID");
  const value = raw as Record<string, unknown>;
  if (Object.keys(value).some((key) => !["schemaVersion", "opportunities"].includes(key))) throw new Error("AYAS_EVOLUTION_REGISTER_FIELDS_INVALID");
  return parseAyasEvolutionRegister(value);
}

function existingArtifact(store: AyasPatchArtifactStore, candidate: AyasControlledEvolutionCandidate, record: AyasExperimentRecord): string | null {
  if (!record.evidenceHash || !fs.existsSync(store.dir)) return null;
  const names = fs.readdirSync(store.dir).filter((name) => name.startsWith("ayas-controlled-evolution-") && name.endsWith(".json"));
  if (names.length > 1_000) throw new Error("AYAS_EVOLUTION_ARTIFACT_SCAN_LIMIT");
  for (const name of names) {
    const id = name.slice(0, -5);
    try {
      const artifact = store.loadVerified(id);
      const binding = artifact.controlledEvolutionBinding;
      if (artifact.baseHead === candidate.baseHead && binding?.opportunityId === candidate.opportunityId
        && binding.experimentId === record.experimentId && binding.evidenceHash === record.evidenceHash) return id;
    } catch { /* an invalid artifact is never a recovery candidate */ }
  }
  return null;
}

export interface AyasControlledEvolutionCycleInput {
  readonly repoRoot: string;
  readonly observation: AyasDaemonObservation;
  readonly register: AyasEvolutionRegister;
  readonly inbox: AyasApprovalInboxHandle;
  readonly remainingMs: () => number;
  readonly registry?: AyasImprovementRegistry;
  readonly experimentStore?: AyasResearchExperimentStore;
  readonly artifactStore?: AyasPatchArtifactStore;
  readonly nodeModulesDir?: string;
  readonly now?: () => string;
  /** Stage 15O. Production callers leave it out: the vault of record. */
  readonly goldenVault?: AyasGoldenVault;
}

/** At most one Stage 15 sandbox experiment and one candidate. The existing daemon owns proposal creation. */
export async function runAyasControlledSelfEvolutionCycle(input: AyasControlledEvolutionCycleInput): Promise<AyasDaemonCandidate | null> {
  const { observation } = input;
  const registry = input.registry ?? AYAS_DEFAULT_IMPROVEMENT_REGISTRY;
  if (!observation.repoClean || !observation.graphifyFresh || observation.machineAction !== "ALLOW"
    || !/^[0-9a-f]{40}$/.test(observation.head) || registry.strategies.length === 0
    || input.remainingMs() < AYAS_RESEARCH_EXPERIMENT_BUDGET.minExperimentTimeBudgetMs) return null;
  const store = input.experimentStore ?? createAyasResearchExperimentStore({ rootDir: resolveAyasResearchImprovementRoot(input.repoRoot) });
  const artifacts = input.artifactStore ?? createAyasPatchArtifactStore({ rootDir: path.join(input.repoRoot, "data", "brain", "self-improvement", "patch-artifacts") });
  const now = input.now ?? (() => new Date().toISOString());
  let snapshots = store.listGapSnapshots();
  const benchmark = registry.benchmarks.find((item) => registry.strategies.some((strategy) => strategy.benchmarkId === item.benchmarkId));
  if (input.register.opportunities.length > 0 && benchmark
    && !snapshots.some((item) => item.measuredAtHead === observation.head && item.benchmarkId === benchmark.benchmarkId)) {
    if (input.remainingMs() < AYAS_RESEARCH_EXPERIMENT_BUDGET.minGapSnapshotTimeBudgetMs) return null;
    const measured = await measureAyasLocalGapSnapshot({ repoRoot: input.repoRoot, head: observation.head, benchmark,
      timeoutMs: Math.max(1_000, Math.min(benchmark.timeoutMs, input.remainingMs() - 5_000)), nowIso: now(),
      ...(input.nodeModulesDir ? { nodeModulesDir: input.nodeModulesDir } : {}) });
    if (!measured) return null;
    await store.withLock(async () => { if (!store.listGapSnapshots().some((item) => item.measuredAtHead === observation.head && item.benchmarkId === benchmark.benchmarkId))
      store.writeGapSnapshot(measured, AYAS_RESEARCH_EXPERIMENT_BUDGET.maxGapSnapshots); });
    snapshots = store.listGapSnapshots();
  }
  const environment: AyasEvolutionEnvironment = {
    now: now(), currentHead: observation.head,
    capabilities: inventoryAyasCapabilities({ availableModelIds: [], availableSkillIds: [], availableAgentIds: [] }),
    operatingMode: "UNKNOWN", improvementRegistry: registry, gapSnapshots: snapshots,
  };
  const plan = planAyasControlledSelfEvolution({ register: input.register, environment });
  const candidate = plan.candidate;
  if (!candidate) return null;
  if (!currentReviewedPatchMatches(input.repoRoot, observation.head, candidate.strategy)) return null;
  const prior = input.inbox.load().proposals.filter((proposal) => proposal.mutationKind === AYAS_PATCH_ARTIFACT_MUTATION_KIND
    && proposal.sourceReference === candidate.opportunityId && proposal.baseHead === candidate.baseHead);
  if (prior.length > 0) return null;
  const digest = await experimentInputsDigest(input.repoRoot, candidate.baseHead, candidate.benchmark, candidate.strategy);
  if (!HEX64.test(digest)) return null;
  const attemptKey = sha256(JSON.stringify([candidate.opportunityId, candidate.hypothesis.hypothesisId,
    candidate.strategy.strategyId, candidate.strategy.version, digest]));
  const existing = store.listExperiments().find((record) => record.attemptKey === attemptKey && record.baseHead === candidate.baseHead
    && record.status === "COMPLETED" && record.verdict === "IMPROVED");
  if (existing) {
    const artifactId = existingArtifact(artifacts, candidate, existing);
    return artifactId ? buildAyasControlledEvolutionProposalCandidate({ repoRoot: input.repoRoot, candidate, registry,
      experimentId: existing.experimentId, artifactId, experimentStore: store, artifactStore: artifacts,
      ...(input.goldenVault ? { goldenVault: input.goldenVault } : {}) }) : null;
  }
  if (input.remainingMs() < AYAS_RESEARCH_EXPERIMENT_BUDGET.minExperimentTimeBudgetMs) return null;
  const record = await store.withLock(async (): Promise<AyasExperimentRecord | null> => {
    await reconcileAyasInterruptedExperiments(store, now());
    const index = store.loadIndex();
    const decision = decideAyasExperimentAdmission({ attemptKey, baseHead: candidate.baseHead, records: store.listExperiments(),
      experimentStarts: index.experimentStarts, startedThisCycle: 0, nowIso: now(), budget: AYAS_RESEARCH_EXPERIMENT_BUDGET });
    if (!decision.admit) return null;
    const at = now();
    const reserved: AyasExperimentRecord = {
      schemaVersion: AYAS_RESEARCH_IMPROVEMENT_SCHEMA_VERSION,
      experimentId: `ayas-experiment-${crypto.randomUUID()}`, hypothesisId: candidate.hypothesis.hypothesisId,
      attemptKey, attempt: decision.attempt, baseHead: candidate.baseHead, strategyId: candidate.strategy.strategyId,
      strategyVersion: candidate.strategy.version, inputsDigest: digest, status: "RESERVED", reservedAt: at, updatedAt: at,
      owner: { pid: process.pid, processStartEpochMs: await readProcessStartEpochMs(process.pid).catch(() => Date.now() - Math.floor(process.uptime() * 1000)), runId: crypto.randomUUID() },
      leaseExpiresAt: new Date(Date.parse(at) + AYAS_RESEARCH_EXPERIMENT_BUDGET.experimentLeaseMs).toISOString(),
    };
    store.writeExperiment(reserved);
    store.saveIndex({ ...index, experimentStarts: [...index.experimentStarts, at] });
    return reserved;
  });
  if (!record) return null;
  const result = await runAyasRegisteredImprovementExperiment({ deps: { repoRoot: input.repoRoot,
    ...(input.nodeModulesDir ? { nodeModulesDir: input.nodeModulesDir } : {}), ...(input.goldenVault ? { goldenVault: input.goldenVault } : {}) }, observation,
    store, record, hypothesis: candidate.hypothesis, strategy: candidate.strategy, benchmark: candidate.benchmark,
    sourceIds: [], sourceBindings: candidate.sourceBindings, remainingMs: input.remainingMs, clock: now });
  if (result.verdict !== "IMPROVED") return null;
  const artifact = await freezeAyasControlledEvolutionArtifact({ repoRoot: input.repoRoot, candidate, registry, result,
    experimentStore: store, artifactStore: artifacts, now: now(), ...(input.goldenVault ? { goldenVault: input.goldenVault } : {}) });
  if (!artifact) return null;
  return buildAyasControlledEvolutionProposalCandidate({ repoRoot: input.repoRoot, candidate, registry,
    experimentId: result.record.experimentId, artifactId: artifact.artifactId, experimentStore: store, artifactStore: artifacts,
    ...(input.goldenVault ? { goldenVault: input.goldenVault } : {}) });
}

export function resolveAyasControlledEvolutionRegisterFile(repoRoot: string, configured: string | undefined): string | null {
  if (!configured || !configured.trim()) return null;
  return path.resolve(repoRoot, configured);
}
