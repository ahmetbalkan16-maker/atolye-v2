/**
 * Stage 11 — AYAS Brain Control Center: the server-only fact collector.
 *
 * Reads the sources the Brain page does not already load, each through its
 * existing read-only collector or store, and returns sanitised facts for
 * `AyasControlCenterModel.ts`:
 *
 *  - health / autonomy  → `AyasSelfImprovementHealthCollector` (M26)
 *  - development        → `AyasRepositoryStateCollector` + `recoverAyasRepositoryState` (Stage 10)
 *  - graphify           → `collectAyasGraphifyFacts` + `evaluateAyasGraphifyState` (Stage 10A)
 *  - experiments        → `AyasResearchExperimentStore` read methods (Stage 8)
 *  - memory             → `AyasMemoryStore.snapshot()`, reduced to counts here
 *  - capabilities       → `inventoryAyasCapabilities` + the Ollama provider's own health probe (Stage 7)
 *  - security           → `resolveAccessGate` mode + `AYAS_LAST_SECURITY_REVIEW` (Stage 9)
 *  - atolye             → `loadAyasProjectCatalog` (read-only, runtime-relative paths only)
 *  - roadmap            → the committed `ROADMAP.md` "Next roadmap stage" line
 *
 * Every source is independent and fail-soft: one failure or timeout becomes
 * an `unavailable` fact with a closed code, never a thrown page. Nothing here
 * writes, fetches the real remote, runs a scanner, decides, approves or
 * reaches the execution gate. Raw memory text, absolute paths, env values
 * and error messages never leave this module.
 */

import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { collectAyasSelfImprovementHealthInput } from "../autonomy/AyasSelfImprovementHealthCollector";
import { evaluateAyasSelfImprovementHealth } from "../autonomy/AyasSelfImprovementHealth";
import { createAyasResearchExperimentStore, resolveAyasResearchImprovementRoot, type AyasExperimentRecord } from "../autonomy/AyasResearchExperimentStore";
import { AYAS_DEFAULT_IMPROVEMENT_REGISTRY } from "../autonomy/AyasResearchExperimentRegistry";
import type { AyasExperimentEvidence } from "../autonomy/AyasResearchExperimentEvaluation";
import { collectAyasRepositoryState } from "../../ayas/developer/AyasRepositoryStateCollector";
import { recoverAyasRepositoryState } from "../../ayas/developer/AyasRepositoryRecovery";
import { classifyAyasChangeAreas } from "../../ayas/developer/AyasDeveloperTaskModel";
import { AYAS_KNOWN_UNSAFE_TESTS } from "../../ayas/developer/AyasDeveloperTestIntelligence";
import { collectAyasGraphifyFacts } from "../../ayas/developer/AyasGraphifyStateCollector";
import { evaluateAyasGraphifyState } from "../../ayas/developer/AyasGraphifyState";
import { AYAS_MEMORY_MAX_RECORDS, createAyasMemoryStore } from "../../ayas/memory/AyasMemoryStore";
import { ayasMemoryRecordFact, currentAyasMemoryFactRecords } from "../../ayas/memory/AyasMemoryTemporal";
import { inventoryAyasCapabilities } from "../../ayas/routing/AyasAgenticRouting";
import { createOllamaAyasProvider } from "../../ayas/model/OllamaAyasProvider";
import { AYAS_LAST_SECURITY_REVIEW } from "../../ayas/security/AyasSecurityReviewRecord";
import { loadAyasProjectCatalog, summarizeAyasProductionProjects, type AyasProjectCatalogView } from "../../ayas/AyasProjectCatalog";
import { resolveAccessGate } from "../../auth/accessGate";
import {
  AYAS_CONTROL_CENTER_SCHEMA_VERSION,
  ayasCcText,
  type AyasCcAtolyeFacts,
  type AyasCcCapabilityFacts,
  type AyasCcCommit,
  type AyasCcDevelopmentFacts,
  type AyasCcExperimentFacts,
  type AyasCcExperimentRow,
  type AyasCcFact,
  type AyasCcGraphifyFacts,
  type AyasCcHealthFacts,
  type AyasCcMemoryFacts,
  type AyasCcSecurityFacts,
  type AyasControlCenterServerFacts,
} from "./AyasControlCenterModel";

const execFileAsync = promisify(execFile);

export const AYAS_CC_SOURCE_TIMEOUT_MS = 8_000;
const RECENT_COMMITS = 5;
let inflight: Promise<AyasControlCenterServerFacts> | null = null;
const EXPERIMENT_ROWS = 10;
const LIST_LIMIT = 12;
const CODE = /^[A-Z0-9_]{3,64}$/;

/** Mirrors `isAyasAutonomousExecutionEnabled` (`AyasAutonomousExecutionGate.ts`) without importing that authority module into this read-only chain; a test pins the two equal. */
export function readAyasAutonomousExecutionFlag(env: Readonly<Record<string, string | undefined>>): boolean {
  return env.AYAS_AUTONOMOUS_EXECUTION_ENABLED === "1";
}

export interface AyasControlCenterCollectOptions {
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly now?: () => string;
  readonly timeoutMs?: number;
  /** Test seam for the Ollama `/api/tags` probe; production uses global `fetch` with the provider's own 2.5 s bound. */
  readonly fetcher?: typeof fetch;
  /** Test seam: the Atölye catalog reads the configured runtime root. */
  readonly loadProjectCatalog?: () => Promise<AyasProjectCatalogView>;
}

function errorCode(error: unknown, fallback: string): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && CODE.test(code) ? code : fallback;
}

async function source<T>(now: () => string, timeoutMs: number, read: () => Promise<AyasCcFact<T>> | AyasCcFact<T>, fallback: string): Promise<AyasCcFact<T>> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<AyasCcFact<T>>((resolve) => {
    // Deliberately not unref'd: a hung source must still resolve to TIMEOUT rather than let a
    // script's event loop drain and exit mid-read. `finally` always clears it.
    timer = setTimeout(() => resolve({ kind: "unavailable", observedAt: now(), code: "TIMEOUT" }), timeoutMs);
  });
  try {
    return await Promise.race([Promise.resolve().then(read), timeout]);
  } catch (error) {
    return { kind: "unavailable", observedAt: now(), code: errorCode(error, fallback) };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Local, fixed-argument, read-only Git: no optional locks, no fsmonitor, no prompt. */
async function git(cwd: string, args: readonly string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", ["-c", "core.fsmonitor=false", "-c", "core.quotePath=false", ...args], {
      cwd, timeout: 10_000, windowsHide: true, maxBuffer: 1_000_000, encoding: "utf8", env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" },
    });
    return stdout;
  } catch { return null; }
}

async function readHealth(cwd: string, env: NodeJS.ProcessEnv, now: () => string): Promise<AyasCcFact<AyasCcHealthFacts>> {
  const input = await collectAyasSelfImprovementHealthInput({ repoRoot: cwd, env, now });
  const health = evaluateAyasSelfImprovementHealth(input);
  const observer = input.observer.state.kind === "ok" ? input.observer.state.value : null;
  const research = input.research.state.kind === "ok" ? input.research.state.value : null;
  return {
    kind: "ok",
    observedAt: now(),
    value: {
      verdict: health.verdict,
      ownerActionRecommended: health.ownerActionRecommended,
      // Closed-vocabulary findings (pinned by the health module's own test); evidence maps are not carried.
      findings: health.findings.map((finding) => ({ code: finding.code, severity: finding.severity, subject: finding.subject, message: ayasCcText(finding.message, 240) })),
      observer: { phase: observer ? ayasCcText(observer.phase, 40) : null, heartbeatAt: observer?.updatedAt ?? null, heartbeatCount: observer?.heartbeatCount ?? null },
      research: { enabled: input.research.enabled, nextLightAt: research?.nextLightAt ?? null, nextDeepAt: research?.nextDeepAt ?? null },
      autonomousExecutionEnabled: readAyasAutonomousExecutionFlag(env),
    },
  };
}

async function readDevelopment(cwd: string, now: () => string): Promise<AyasCcFact<AyasCcDevelopmentFacts>> {
  // The baseline is the fork point with the tracking branch, never the tracking ref itself: when the branch is
  // behind or diverged the upstream tip is not an ancestor of HEAD, which Stage 10 (correctly) treats as fatal —
  // and a skipped recovery must not let a behind branch read as clean. Ahead/behind still come from the upstream.
  const forkPoint = (await git(cwd, ["merge-base", "HEAD", "@{upstream}"]))?.trim() || "";
  const baseline = /^[0-9a-f]{40}$/.test(forkPoint) ? forkPoint : "HEAD";
  const state = await collectAyasRepositoryState({ cwd, trustedBaseline: baseline, checkRealRemote: false });
  const { snapshot } = state;
  const live = snapshot.entries.filter((entry) => entry.kind !== "ignored");
  const staged = live.filter((entry) => entry.kind === "tracked" && entry.index !== "." && entry.index !== " ").length;
  const unstaged = live.filter((entry) => entry.kind === "tracked" && entry.worktree !== "." && entry.worktree !== " ").length;
  const areas = new Set<string>();
  let secretRiskPaths = 0;
  for (const entry of live) {
    const entryAreas = classifyAyasChangeAreas(entry.path);
    for (const area of entryAreas) areas.add(area);
    if (entryAreas.includes("secret")) secretRiskPaths += 1;
  }
  const inProgress = !state.fatal && (live.length > 0 || (snapshot.ahead ?? 0) > 0 || (snapshot.behind ?? 0) > 0);
  // The Control Center has no declared sprint scope, so every present change counts as in scope ("**");
  // secret-risk paths still classify first. There is no validation evidence on this surface, which Stage 10
  // reports honestly as an open VALIDATION gate for uncommitted source.
  const recovery = inProgress
    ? recoverAyasRepositoryState(snapshot, { trustedBaseline: baseline, expectedScope: ["**"], closureRequired: false }, {
      discoveryComplete: true, implementationComplete: null, validations: [], review: null, graphify: state.graphify, currentState: state.stateFingerprint,
    })
    : null;
  const log = await git(cwd, ["log", `-n${RECENT_COMMITS}`, "--format=%H%x1f%cI%x1f%s"]);
  const recentCommits: AyasCcCommit[] = (log ?? "").split("\n").map((line) => line.split("\u001f")).filter((parts) => parts.length === 3 && /^[0-9a-f]{40}$/.test(parts[0]!))
    .map(([hash, committedAt, subject]) => ({ hash: hash!, committedAt: new Date(Date.parse(committedAt!)).toISOString(), subject: ayasCcText(subject, 120) }));
  return {
    kind: "ok",
    observedAt: now(),
    value: {
      branch: snapshot.branch,
      head: snapshot.head,
      upstream: snapshot.upstream,
      upstreamHead: snapshot.upstreamHead,
      ahead: snapshot.ahead,
      behind: snapshot.behind,
      counts: { staged, unstaged, untracked: live.filter((entry) => entry.kind === "untracked").length, unmerged: live.filter((entry) => entry.kind === "unmerged").length, total: live.length },
      changedAreas: [...areas].sort(),
      secretRiskPaths,
      recovery: recovery ? { mode: recovery.mode, firstUnfinishedGate: recovery.firstUnfinishedGate, readiness: recovery.readiness, reasonCodes: recovery.reasonCodes.slice(0, LIST_LIMIT) } : null,
      recentCommits,
      knownUnsafeTests: AYAS_KNOWN_UNSAFE_TESTS.map((test) => ({ scriptPath: test.scriptPath, hazard: test.hazard })),
      errors: state.errors.filter((code) => CODE.test(code)).slice(0, LIST_LIMIT),
    },
  };
}

function readGraphifyAnalyzedAt(cwd: string): string | null {
  try {
    const doc = JSON.parse(fs.readFileSync(path.join(cwd, ".graphify", "branch.json"), "utf8")) as { updatedAt?: unknown };
    return typeof doc.updatedAt === "string" && Number.isFinite(Date.parse(doc.updatedAt)) ? doc.updatedAt : null;
  } catch { return null; }
}

async function readGraphify(cwd: string, env: NodeJS.ProcessEnv, now: () => string): Promise<AyasCcFact<AyasCcGraphifyFacts>> {
  const facts = await collectAyasGraphifyFacts({ cwd, env, includeUserConsumers: false });
  const status = evaluateAyasGraphifyState(facts);
  const graph = typeof facts.graph === "object" ? facts.graph : null;
  return {
    kind: "ok",
    observedAt: now(),
    value: {
      classification: status.classification,
      structuralStatus: status.structuralStatus,
      structuralReasons: status.structuralReasons.slice(0, LIST_LIMIT).map((reason) => ayasCcText(reason, 160)),
      semanticStatus: status.semanticStatus,
      sourceHead: status.sourceHead,
      lastAnalyzedHead: status.lastAnalyzedHead,
      graphBuiltFromHead: status.graphBuiltFromHead,
      analyzedAt: readGraphifyAnalyzedAt(cwd),
      worktreeState: status.worktreeState,
      dirtyUncoveredCount: facts.dirtyUncoveredPaths.length,
      incompleteCodeFiles: status.incompleteCodeFiles.slice(0, LIST_LIMIT),
      criticalIncompleteFiles: status.criticalIncompleteFiles.slice(0, LIST_LIMIT),
      localCli: status.localCli,
      cliVersion: facts.cli.version,
      localMcp: status.localMcp,
      remoteMcp: status.remoteMcp,
      // Repo-relative locations only: user-level consumers are not collected here.
      consumers: status.consumers.map((consumer) => ({ host: consumer.host, mode: consumer.mode, location: consumer.location, status: consumer.status, findings: consumer.findings.slice(0, 4) })),
      graph: graph ? { nodes: graph.nodes, links: graph.links, anomalies: graph.duplicateIds + graph.duplicateEdges + graph.dangling + graph.selfLoops } : null,
      recoveryCommand: status.recoveryCommand,
      nextAction: ayasCcText(status.nextAction, 240),
    },
  };
}

function measurementLabel(value: AyasExperimentEvidence["baseline"]): string {
  if (!value) return "—";
  if ("error" in value) return "hata";
  return `${value.passed}/${value.caseCount}`;
}

function experimentRow(record: AyasExperimentRecord, evidence: AyasExperimentEvidence | undefined): AyasCcExperimentRow {
  const hypothesis = evidence?.hypothesis;
  return {
    experimentId: ayasCcText(record.experimentId, 80),
    hypothesisId: ayasCcText(record.hypothesisId, 80),
    status: record.status,
    verdict: record.verdict ?? null,
    baseHead: record.baseHead,
    strategyId: ayasCcText(record.strategyId, 60),
    reservedAt: record.reservedAt,
    updatedAt: record.updatedAt,
    completedAt: record.completedAt ?? null,
    reasonCodes: (record.reasonCodes ?? []).filter((code) => CODE.test(code)).slice(0, 6),
    hypothesis: hypothesis ? {
      capability: ayasCcText(hypothesis.capability, 60),
      benchmarkId: ayasCcText(hypothesis.benchmarkId, 60),
      targetDimension: ayasCcText(hypothesis.targetDimension, 60),
      statement: ayasCcText(hypothesis.expectedImprovement.statement, 160),
      riskClass: hypothesis.riskClass,
      regressionSuiteCount: hypothesis.regressionSuites.length,
    } : null,
    evidence: evidence ? {
      baseline: measurementLabel(evidence.baseline),
      experiment: measurementLabel(evidence.experiment),
      newlyFailingCases: evidence.regressions.newlyFailingCaseIds.length,
      heldOutDelta: evidence.regressions.heldOutDelta,
      failingSuites: evidence.regressions.suites.filter((suite) => suite.experimentPass === false).length,
      targetGain: evidence.targetGain,
      remainingTargetFailures: evidence.remainingTargetFailures,
    } : null,
  };
}

function readExperiments(cwd: string, now: () => string): AyasCcFact<AyasCcExperimentFacts> {
  const root = resolveAyasResearchImprovementRoot(cwd);
  if (!fs.existsSync(root)) return { kind: "absent", observedAt: now(), code: "EXPERIMENT_STORE_ABSENT" };
  const store = createAyasResearchExperimentStore({ rootDir: root });
  const index = store.loadIndex();
  const records = store.listExperiments();
  const recent = [...records].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0)).slice(0, EXPERIMENT_ROWS);
  const outcomes: Record<string, number> = {};
  for (const finding of Object.values(index.findings)) outcomes[finding.outcome] = (outcomes[finding.outcome] ?? 0) + 1;
  return {
    kind: "ok",
    observedAt: now(),
    value: {
      experiments: recent.map((record) => experimentRow(record, record.evidenceHash ? store.readEvidence(record.evidenceHash) : undefined)),
      hypothesesCount: Object.keys(index.hypotheses).length,
      findingsIndexed: Object.keys(index.findings).length,
      findingOutcomes: outcomes,
      admissionDeferredUntil: index.admissionDeferredUntil ?? null,
      registeredStrategies: AYAS_DEFAULT_IMPROVEMENT_REGISTRY.strategies.length,
      benchmarks: AYAS_DEFAULT_IMPROVEMENT_REGISTRY.benchmarks.length,
    },
  };
}

/** Counts only: titles, bodies and values of private memory never leave this function. */
function readMemory(cwd: string, now: () => string): AyasCcFact<AyasCcMemoryFacts> {
  const rootDir = path.join(cwd, "data", "brain");
  if (!fs.existsSync(path.join(rootDir, "memory", "records.json"))) return { kind: "absent", observedAt: now(), code: "MEMORY_STORE_ABSENT" };
  const { revision, records } = createAyasMemoryStore({ rootDir }).snapshot();
  const nowIso = now();
  const nowMs = Date.parse(nowIso);
  const byKind: Record<string, number> = {};
  const byImportance: Record<string, number> = {};
  let expired = 0;
  let lastObservedMs = Number.NEGATIVE_INFINITY;
  for (const record of records) {
    byKind[record.kind] = (byKind[record.kind] ?? 0) + 1;
    byImportance[record.importance] = (byImportance[record.importance] ?? 0) + 1;
    if (record.expiresAt && Date.parse(record.expiresAt) < nowMs) expired += 1;
    const observed = Date.parse(record.observedAt);
    if (Number.isFinite(observed) && observed > lastObservedMs) lastObservedMs = observed;
  }
  const factRecords = records.filter((record) => ayasMemoryRecordFact(record) !== null).length;
  const currentFacts = currentAyasMemoryFactRecords(records, nowIso).length;
  return {
    kind: "ok",
    observedAt: nowIso,
    value: {
      total: records.length,
      capacity: AYAS_MEMORY_MAX_RECORDS,
      revision,
      byKind,
      byImportance,
      currentFacts,
      historicalFacts: Math.max(0, factRecords - currentFacts),
      expired,
      lastObservedAt: Number.isFinite(lastObservedMs) ? new Date(lastObservedMs).toISOString() : null,
    },
  };
}

async function readCapabilities(env: NodeJS.ProcessEnv, fetcher: typeof fetch | undefined, now: () => string): Promise<AyasCcFact<AyasCcCapabilityFacts>> {
  const ollama = createOllamaAyasProvider(env, fetcher ?? fetch);
  const health = ollama.configured ? await ollama.health() : { available: false, detail: "ollama: yapılandırılmamış", checkedAtMs: Date.parse(now()) };
  return {
    kind: "ok",
    observedAt: now(),
    value: {
      items: inventoryAyasCapabilities({ availableModelIds: health.available ? ["ollama"] : [] }),
      ollama: { configured: ollama.configured, available: health.available, detail: ayasCcText(health.detail, 60), checkedAt: new Date(health.checkedAtMs).toISOString(), model: ollama.model ? ayasCcText(ollama.model, 60) : null },
    },
  };
}

function readSecurity(env: NodeJS.ProcessEnv, now: () => string): AyasCcFact<AyasCcSecurityFacts> {
  // Only the mode crosses this boundary — never the key or its length.
  const { mode } = resolveAccessGate(env);
  return { kind: "ok", observedAt: now(), value: { accessGate: mode, autonomousExecutionEnabled: readAyasAutonomousExecutionFlag(env), executionGate: "CLOSED", review: AYAS_LAST_SECURITY_REVIEW } };
}

async function readAtolye(load: () => Promise<AyasProjectCatalogView>, now: () => string): Promise<AyasCcFact<AyasCcAtolyeFacts>> {
  const catalog = await load();
  const summary = summarizeAyasProductionProjects(catalog.projects);
  const latest = catalog.projects.map((project) => project.updatedAt).filter((value): value is string => typeof value === "string" && Number.isFinite(Date.parse(value))).sort().at(-1) ?? null;
  return {
    kind: "ok",
    observedAt: now(),
    value: {
      available: catalog.available,
      runtimeClassification: catalog.runtimeClassification,
      external: catalog.external,
      totalProjects: summary.totalProjects,
      completed: summary.completedCount,
      incomplete: summary.incompleteCount,
      unreadable: summary.unknownCount,
      resumable: summary.resumableCount,
      withFinalVideo: catalog.projects.filter((project) => project.hasFinalVideo).length,
      statusDistribution: summary.statusDistribution.slice(0, LIST_LIMIT),
      latestUpdatedAt: latest,
    },
  };
}

function readRoadmap(cwd: string, now: () => string): AyasCcFact<{ readonly nextStage: string }> {
  const file = path.join(cwd, "ROADMAP.md");
  if (!fs.existsSync(file)) return { kind: "absent", observedAt: now(), code: "ROADMAP_ABSENT" };
  const match = /\*\*Next roadmap stage:\s*([^*]+?)\.?\*\*/.exec(fs.readFileSync(file, "utf8"));
  return match ? { kind: "ok", observedAt: now(), value: { nextStage: ayasCcText(match[1], 120) } } : { kind: "absent", observedAt: now(), code: "ROADMAP_STAGE_NOT_FOUND" };
}

/**
 * One bounded, parallel read of every server-side source. Never throws.
 * Concurrent production reads (page load racing the refresh click, two open
 * tabs) share one in-flight read instead of repeating the Git, graph and model
 * probes; nothing is cached once it settles, so freshness stays exact.
 */
export function loadAyasControlCenterFacts(options: AyasControlCenterCollectOptions = {}): Promise<AyasControlCenterServerFacts> {
  if (Object.keys(options).length > 0) return collectAyasControlCenterFacts(options);
  inflight ??= collectAyasControlCenterFacts({}).finally(() => { inflight = null; });
  return inflight;
}

async function collectAyasControlCenterFacts(options: AyasControlCenterCollectOptions): Promise<AyasControlCenterServerFacts> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const env = options.env ?? process.env;
  const now = options.now ?? (() => new Date().toISOString());
  const timeoutMs = options.timeoutMs ?? AYAS_CC_SOURCE_TIMEOUT_MS;
  const generatedAt = now();
  const [health, development, graphify, experiments, memory, capabilities, security, atolye, roadmap] = await Promise.all([
    source(now, timeoutMs, () => readHealth(cwd, env, now), "HEALTH_READ_FAILED"),
    source(now, timeoutMs, () => readDevelopment(cwd, now), "REPOSITORY_READ_FAILED"),
    source(now, timeoutMs, () => readGraphify(cwd, env, now), "GRAPHIFY_READ_FAILED"),
    source(now, timeoutMs, () => readExperiments(cwd, now), "EXPERIMENT_READ_FAILED"),
    source(now, timeoutMs, () => readMemory(cwd, now), "MEMORY_READ_FAILED"),
    source(now, timeoutMs, () => readCapabilities(env, options.fetcher, now), "CAPABILITY_READ_FAILED"),
    source(now, timeoutMs, () => readSecurity(env, now), "SECURITY_READ_FAILED"),
    source(now, timeoutMs, () => readAtolye(options.loadProjectCatalog ?? loadAyasProjectCatalog, now), "ATOLYE_READ_FAILED"),
    source(now, timeoutMs, () => readRoadmap(cwd, now), "ROADMAP_READ_FAILED"),
  ]);
  return { schemaVersion: AYAS_CONTROL_CENTER_SCHEMA_VERSION, generatedAt, health, development, graphify, experiments, memory, capabilities, security, atolye, roadmap };
}
