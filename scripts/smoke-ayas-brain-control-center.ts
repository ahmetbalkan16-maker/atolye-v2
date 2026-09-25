/**
 * Stage 11 — AYAS Brain Control Center evaluator.
 *
 *   npx tsx scripts/smoke-ayas-brain-control-center.ts [--baseline]
 *
 * Deterministic. Pure-model scenarios use in-memory fixtures; collector
 * scenarios use a throw-away OS-TEMP Git repository with injected Ollama and
 * project-catalog seams, so no live runtime, authority, `data/brain`, memory
 * or network is touched. The access-gate scenario calls the real middleware
 * in-process with a temporary key and restores the environment afterwards.
 *
 * Storage: every collector root derives from the `mkdtempSync` OS-TEMP `cwd`
 * passed to `loadAyasControlCenterFacts`; the Atölye catalog and Ollama probe
 * are injected; the cross-origin check uses an RFC 5737 documentation address.
 *
 * The same file runs against a clean baseline archive: a scenario that needs
 * a Stage 11 module the baseline does not have is reported MISSING, not FAIL
 * (`--baseline` then exits 0 and prints the table).
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

type ModelModule = typeof import("../src/lib/brain/ui/AyasControlCenterModel");
type CollectorModule = typeof import("../src/lib/brain/ui/AyasControlCenterCollector");
type UiModule = typeof import("../src/components/brain/AyasControlCenter");
type ViewModule = typeof import("../src/components/brain/BrainConsoleView");
type Server = import("../src/lib/brain/ui/AyasControlCenterModel").AyasControlCenterServerFacts;
type Input = import("../src/lib/brain/ui/AyasControlCenterModel").AyasControlCenterInput;
type Proposal = import("../src/lib/brain/autonomy/AyasApprovalInboxView").AyasDevelopmentProposal;

const REPO_ROOT = path.resolve(__dirname, "..");
const BASELINE = process.argv.includes("--baseline");
const NOW = "2026-09-25T10:00:00.000Z";
const HEAD = "a".repeat(40);
const OLD_HEAD = "b".repeat(40);
const minutesAgo = (m: number) => new Date(Date.parse(NOW) - m * 60_000).toISOString();

class Missing extends Error {}
type Outcome = "PASS" | "FAIL" | "MISSING";
const results: { id: string; name: string; set: string; outcome: Outcome; detail?: string }[] = [];

async function scenario(set: "primary" | "held-out" | "integration", id: string, name: string, body: () => void | Promise<void>): Promise<void> {
  try {
    await body();
    results.push({ id, name, set, outcome: "PASS" });
  } catch (error) {
    if (error instanceof Missing) results.push({ id, name, set, outcome: "MISSING", detail: error.message });
    else results.push({ id, name, set, outcome: "FAIL", detail: error instanceof Error ? error.message.split("\n")[0] : String(error) });
  }
  if (process.env.SMOKE_TRACE === "1") console.log(`${results.at(-1)!.outcome} ${id}: ${name}`);
}

async function tryImport<T>(specifier: string): Promise<T | null> {
  try { return (await import(specifier)) as T; } catch { return null; }
}

function need<T>(value: T | null, what: string): T {
  if (value === null) throw new Missing(`${what} does not exist at this revision`);
  return value;
}

/* ------------------------------------------------------------ fixtures --- */

function ok<T>(value: T) { return { kind: "ok" as const, observedAt: NOW, value }; }
function valueOf<T>(fact: import("../src/lib/brain/ui/AyasControlCenterModel").AyasCcFact<T>): T {
  if (fact.kind !== "ok") throw new Error("fixture fact is not ok");
  return fact.value;
}

async function capabilityItems(ollamaAvailable: boolean) {
  const routing = await import("../src/lib/ayas/routing/AyasAgenticRouting");
  return routing.inventoryAyasCapabilities({ availableModelIds: ollamaAvailable ? ["ollama"] : [] });
}

async function healthyServer(): Promise<Server> {
  const security = need(await tryImport<typeof import("../src/lib/ayas/security/AyasSecurityReviewRecord")>("../src/lib/ayas/security/AyasSecurityReviewRecord"), "AyasSecurityReviewRecord");
  return {
    schemaVersion: "1",
    generatedAt: NOW,
    health: ok({ verdict: "HEALTHY", ownerActionRecommended: false, findings: [], observer: { phase: "OBSERVING", heartbeatAt: minutesAgo(2), heartbeatCount: 40 }, research: { enabled: true, nextLightAt: minutesAgo(-120), nextDeepAt: minutesAgo(-600) }, autonomousExecutionEnabled: false }),
    development: ok({ branch: "main", head: HEAD, upstream: "origin/main", upstreamHead: HEAD, ahead: 0, behind: 0, counts: { staged: 0, unstaged: 0, untracked: 0, unmerged: 0, total: 0 }, changedAreas: [], secretRiskPaths: 0, recovery: null, recentCommits: [{ hash: HEAD, committedAt: minutesAgo(60), subject: "feat: son iş" }], knownUnsafeTests: [{ scriptPath: "scripts/smoke-ayas-observer-autostart.ts", hazard: "SCHEDULED_TASK" }], errors: [] }),
    graphify: ok({ classification: "GRAPH_CURRENT", structuralStatus: "CURRENT", structuralReasons: [], semanticStatus: "CURRENT", sourceHead: HEAD, lastAnalyzedHead: HEAD, graphBuiltFromHead: HEAD, analyzedAt: minutesAgo(30), worktreeState: "CLEAN", dirtyUncoveredCount: 0, incompleteCodeFiles: [], criticalIncompleteFiles: [], localCli: "AVAILABLE", cliVersion: "0.17.1", localMcp: "AVAILABLE", remoteMcp: "NOT_CONFIGURED", consumers: [], graph: { nodes: 10, links: 20, anomalies: 0 }, recoveryCommand: null, nextAction: "Graph is current." }),
    experiments: ok({ experiments: [], hypothesesCount: 0, findingsIndexed: 3, findingOutcomes: { IGNORED: 3 }, admissionDeferredUntil: null, registeredStrategies: 0, benchmarks: 1 }),
    memory: ok({ total: 10, capacity: 500, revision: 3, byKind: { decision: 10 }, byImportance: { normal: 10 }, currentFacts: 1, historicalFacts: 0, expired: 0, lastObservedAt: minutesAgo(1440) }),
    capabilities: ok({ items: await capabilityItems(true), ollama: { configured: true, available: true, detail: "ollama: 2 model", checkedAt: NOW, model: "qwen-test" } }),
    security: ok({ accessGate: "enforced", autonomousExecutionEnabled: false, executionGate: "CLOSED", review: security.AYAS_LAST_SECURITY_REVIEW }),
    atolye: ok({ available: true, runtimeClassification: "explicit-external", external: true, totalProjects: 5, completed: 2, incomplete: 3, unreadable: 0, resumable: 1, withFinalVideo: 2, statusDistribution: [{ status: "completed", count: 2 }], latestUpdatedAt: minutesAgo(2880) }),
    roadmap: ok({ nextStage: "12 — ATÖLYE DIRECTOR & MEDIA INTELLIGENCE READINESS" }),
  } as Server;
}

function healthyInputs(): Omit<Input, "server"> {
  return {
    approvalInbox: { connected: true, pending: [], today: [], history: [] },
    microBatch: { connected: true, active: null, history: [] },
    ownerRecommendations: { connected: true, recommendations: [], pendingExecution: [] },
    researchEngineStatus: { connected: true, consecutiveFailures: 0, sources: [], digest: { sourcesRegistered: 5, sourcesChangedLast24h: 1, sourcesFailingNow: 0, findingsLast24h: 2 }, lastSuccessfulResearchAt: minutesAgo(60), lastLightCompletedAt: minutesAgo(60), nextLightAt: minutesAgo(-300) },
    goalDevelopment: { connected: true, goals: [], research: [] },
    reportCenter: null,
    autonomous: undefined,
  };
}

function proposal(over: Partial<Proposal> = {}): Proposal {
  return {
    proposalId: "prop-0000000000001", proposalHash: "h".repeat(64), createdAt: minutesAgo(120), lastUpdatedAt: minutesAgo(90),
    objective: "Deterministic fixture improvement", currentProblem: "p", selectionReason: "s", expectedUserBenefit: "b", expectedBehaviorChange: "c",
    unchangedBehavior: "u", riskIfNotDone: "r", technicalRisk: "t", productionImpact: "none", rationale: "why",
    evidence: ["e1"], graphifyEvidence: ["g1", "g2"], exactFiles: ["scripts/smoke-x.ts"], expectedDiffScope: "one file", risk: "LOW",
    safetyClassification: "SAFE", testsPlanned: ["smoke-x"], status: "PENDING", baseHead: HEAD, mutationKind: "patch-artifact",
    discoverySource: "LOCAL_DISCOVERY", approvalReady: true, missingExplanation: [], valueClass: "TEST_QUALITY", displayState: "NORMAL",
    ownerApprovedPendingExecution: false,
    ...over,
  } as Proposal;
}

function withServer(server: Server, patch: Partial<Server>): Server { return { ...server, ...patch } as Server; }

/* ---------------------------------------------------- TEMP git fixture --- */

function git(cwd: string, args: readonly string[]): string {
  return execFileSync("git", ["-c", "user.email=fixture@example.invalid", "-c", "user.name=fixture", "-c", "commit.gpgsign=false", "-c", "core.autocrlf=false", ...args], { cwd, encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
}

const PRIVATE_MARKER = "PRIVATE-MEMORY-MARKER-7c1f";
const SECRET_MARKER = "SECRETKEYMARKER-9d2e-abcdefghij";

async function makeTempRepo(): Promise<string> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-cc-"));
  git(root, ["init", "-q", "-b", "main"]);
  fs.writeFileSync(path.join(root, "README.md"), "# fixture\n");
  fs.writeFileSync(path.join(root, "ROADMAP.md"), "**Next roadmap stage: 99 — Fixture Stage.**\n");
  git(root, ["add", "README.md", "ROADMAP.md"]);
  git(root, ["commit", "-q", "-m", "chore: fixture baseline"]);
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "dirty.ts"), "export const dirty = 1;\n");
  const model = await import("../src/lib/brain/BrainMemoryModel");
  const types = await import("../src/types/brainMemory");
  const records = [
    model.buildBrainMemoryRecord({ kind: "user-preference", title: `${PRIVATE_MARKER} başlık`, body: `${PRIVATE_MARKER} gövde`, importance: "normal", confidence: "observed", tags: ["fixture"], observedAt: minutesAgo(10), links: [] }),
    model.buildBrainMemoryRecord({ kind: "decision", title: "ikinci kayıt", body: `${PRIVATE_MARKER} ikinci`, importance: "durable", confidence: "reported", tags: [], observedAt: minutesAgo(5), links: [] }),
  ];
  // data/ is not committed: the fixture memory is untracked state, like the live store.
  fs.mkdirSync(path.join(root, "data", "brain", "memory"), { recursive: true });
  fs.writeFileSync(path.join(root, "data", "brain", "memory", "records.json"), `${JSON.stringify({ schemaVersion: types.brainMemorySchemaVersion, revision: 2, records }, null, 2)}\n`);
  fs.writeFileSync(path.join(root, ".gitignore"), "data/\n");
  return root;
}

function fingerprintTree(root: string): string {
  const hash = crypto.createHash("sha256");
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(root, full);
      if (entry.isDirectory()) { hash.update(`d:${rel}\n`); walk(full); }
      else { hash.update(`f:${rel}:`); hash.update(fs.readFileSync(full)); hash.update("\n"); }
    }
  };
  walk(root);
  return hash.digest("hex");
}

function removeTree(root: string): void {
  try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 }); } catch { /* TEMP cleanup is best effort */ }
}

const okFetch = (async () => new Response(JSON.stringify({ models: [{}, {}] }), { status: 200, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
const downFetch = (async () => { throw new TypeError("connect ECONNREFUSED"); }) as unknown as typeof fetch;
const catalog = async () => ({ available: true, runtimeClassification: "explicit-workspace" as const, external: false, projects: [], notes: [] });

/* ---------------------------------------------------------------- main --- */

async function main(): Promise<void> {
  // Fails unless the run reaches its report: an early event-loop exit must never read as PASS.
  process.exitCode = 1;
  const model = await tryImport<ModelModule>("../src/lib/brain/ui/AyasControlCenterModel");
  const collector = await tryImport<CollectorModule>("../src/lib/brain/ui/AyasControlCenterCollector");
  const ui = await tryImport<UiModule>("../src/components/brain/AyasControlCenter");
  const viewModule = await tryImport<ViewModule>("../src/components/brain/BrainConsoleView");
  const M = () => need(model, "AyasControlCenterModel");
  const C = () => need(collector, "AyasControlCenterCollector");
  const U = () => need(ui, "AyasControlCenter UI");
  const build = (server: Server | null, inputs: Omit<Input, "server"> = healthyInputs()) => M().buildAyasControlCenterView({ ...inputs, server });
  const renderAttention = (server: Server | null, inputs: Omit<Input, "server"> = healthyInputs()) => renderToStaticMarkup(createElement(U().AyasOwnerAttention, { sources: { override: server }, inputs, onOpenPanel: () => undefined }));
  const domain = (view: ReturnType<ModelModule["buildAyasControlCenterView"]>, id: string) => view.domains.find((entry) => entry.id === id)!;

  /* ------------------------------------------------------- primary --- */

  await scenario("primary", "P1", "healthy overview: every domain healthy/informational, nothing asks for the owner", async () => {
    const view = build(await healthyServer());
    assert.equal(view.overall.level, "HEALTHY");
    assert.equal(view.attention.length, 0);
    for (const entry of view.domains) assert.ok(entry.attention === "HEALTHY" || entry.attention === "INFORMATIONAL", `${entry.id} is ${entry.attention}`);
    const html = renderAttention(await healthyServer());
    assert.match(html, /Her şey yolunda/);
    assert.match(html, /data-testid="bc-cc-attention-empty"/);
    assert.match(html, /12 — ATÖLYE DIRECTOR/);
  });

  await scenario("primary", "P2", "degraded Graphify (GRAPH_STALE): WARNING with the recovery command shown, never run", async () => {
    const base = await healthyServer();
    const server = withServer(base, { graphify: ok({ ...valueOf(base.graphify), classification: "GRAPH_STALE", structuralStatus: "STALE", lastAnalyzedHead: OLD_HEAD, structuralReasons: ["HEAD_MOVED"], recoveryCommand: "graphify update --scope all --no-description --no-label .", nextAction: "Run the refresh." }) as Server["graphify"] });
    const view = build(server);
    assert.equal(domain(view, "graphify").attention, "WARNING");
    const item = view.attention.find((entry) => entry.domain === "graphify")!;
    assert.equal(item.next.kind, "SAFE_OPERATION");
    assert.equal(item.next.command, "graphify update --scope all --no-description --no-label .");
    assert.equal(item.next.panel, undefined, "a command is shown, not wired to a button");
    const html = renderAttention(server);
    assert.match(html, /<code class="bc-cc-command">graphify update/);
  });

  await scenario("primary", "P3", "GRAPH_PARTIAL is labelled partial, never 'current', and raises no false alarm", async () => {
    const base = await healthyServer();
    const server = withServer(base, { graphify: ok({ ...valueOf(base.graphify), classification: "GRAPH_PARTIAL", structuralStatus: "PARTIAL", structuralReasons: ["INCOMPLETE_CODE_FILES:2"], incompleteCodeFiles: ["scripts/a.ps1", "app/x/route.ts"], criticalIncompleteFiles: ["scripts/a.ps1"] }) as Server["graphify"] });
    const view = build(server);
    const g = domain(view, "graphify");
    assert.equal(g.attention, "INFORMATIONAL");
    assert.match(g.statusLabel, /GRAPH_PARTIAL/);
    assert.doesNotMatch(g.statusLabel, /GÜNCEL/);
    assert.match(g.summary, /2 dosya grafikte yok/);
    assert.equal(view.attention.filter((entry) => entry.domain === "graphify").length, 0);
    const system = renderToStaticMarkup(createElement(U().AyasSystemPanel, { sources: { override: server } }));
    assert.match(system, /scripts\/a\.ps1 — kritik, doğrudan incele/);
  });

  await scenario("primary", "P4", "pending SAFE approval-ready proposal → ACTION_REQUIRED routed to the existing Gelişim Merkezi controls", async () => {
    const inputs = { ...healthyInputs(), approvalInbox: { connected: true, pending: [proposal()], today: [], history: [] } };
    const view = build(await healthyServer(), inputs);
    const item = view.attention.find((entry) => entry.id === "approvals:actionable")!;
    assert.equal(item.level, "ACTION_REQUIRED");
    assert.equal(item.next.kind, "OWNER_APPROVAL");
    assert.equal(item.next.panel, "development");
    assert.equal(item.next.command, undefined);
    const line = item.details[0]!;
    for (const part of ["prop-0000000000", "SAFE", `baseHead ${HEAD.slice(0, 7)}`, "1 kanıt", "2 Graphify kanıtı", "patch-artifact", "LOCAL_DISCOVERY", "Karar bekliyor"]) assert.ok(line.includes(part), `detail shows ${part}`);
    assert.equal(view.overall.level, "ACTION_REQUIRED");
  });

  await scenario("primary", "P5", "stale / revalidating proposals are never shown as actionable", async () => {
    const inputs = { ...healthyInputs(), approvalInbox: { connected: true, pending: [proposal({ displayState: "REVALIDATING_FOR_NEW_HEAD", baseHead: OLD_HEAD })], today: [proposal({ proposalId: "prop-stale-000002", status: "STALE", displayState: "STALE_AWAITING_REDISCOVERY" })], history: [] } };
    const view = build(await healthyServer(), inputs);
    assert.equal(view.attention.filter((entry) => entry.level === "ACTION_REQUIRED" && entry.domain === "approvals").length, 0);
    const moving = view.attention.find((entry) => entry.id === "approvals:in-progress")!;
    assert.equal(moving.level, "IN_PROGRESS");
    assert.match(moving.details[0]!, /karar verilemez/);
    assert.match(domain(view, "approvals").summary, /1 bayat/);
    assert.equal(M().ayasCcApprovalRequirement(proposal({ status: "STALE" })).label, "Bayat — karar verilemez");
  });

  await scenario("primary", "P6", "interrupted development → IN_PROGRESS with the first unfinished Stage 10 gate and a read-only handoff command", async () => {
    const base = await healthyServer();
    const dev = { ...valueOf(base.development), counts: { staged: 0, unstaged: 1, untracked: 2, unmerged: 0, total: 3 }, recovery: { mode: "RESUME_UNCOMMITTED", firstUnfinishedGate: "VALIDATION", readiness: "NOT_READY", reasonCodes: ["NO_VALIDATION_EVIDENCE"] } };
    const view = build(withServer(base, { development: ok(dev) as Server["development"] }));
    const d = domain(view, "development");
    assert.equal(d.attention, "IN_PROGRESS");
    assert.match(d.statusLabel, /VALIDATION/);
    const item = view.attention.find((entry) => entry.domain === "development")!;
    assert.equal(item.next.kind, "SAFE_OPERATION");
    assert.match(item.next.command!, /scripts\/ayas-developer-handoff\.ts .*--baseline aaaaaaa/);
    assert.deepEqual(item.details, ["NO_VALIDATION_EVIDENCE"]);
    assert.equal(item.at, NOW, "uncommitted state is timestamped when observed, not at the last commit");
  });

  await scenario("primary", "P7", "research running → IN_PROGRESS, not healthy-idle and not an alarm", async () => {
    const inputs = { ...healthyInputs(), researchEngineStatus: { ...healthyInputs().researchEngineStatus!, runningGoalCount: 1 } };
    const view = build(await healthyServer(), inputs);
    const r = domain(view, "research");
    assert.equal(r.attention, "IN_PROGRESS");
    assert.equal(r.statusLabel, "ÇALIŞIYOR");
    assert.equal(view.attention.filter((entry) => entry.domain === "research").length, 0);
  });

  await scenario("primary", "P8", "experiment complete: verdict, baseline→experiment, regression state and linked proposal from real ids", async () => {
    const base = await healthyServer();
    const row = { experimentId: "exp-fixture-1", hypothesisId: "hyp-1", status: "COMPLETED", verdict: "IMPROVED", baseHead: HEAD, strategyId: "strat-1", reservedAt: minutesAgo(50), updatedAt: minutesAgo(20), completedAt: minutesAgo(20), reasonCodes: [], hypothesis: { capability: "retrieval", benchmarkId: "bench-1", targetDimension: "recall", statement: "fix two target cases", riskClass: "SAFE", regressionSuiteCount: 2 }, evidence: { baseline: "5/10", experiment: "8/10", newlyFailingCases: 0, heldOutDelta: 0, failingSuites: 0, targetGain: 3, remainingTargetFailures: 1 } };
    const server = withServer(base, { experiments: ok({ ...valueOf(base.experiments), experiments: [row], hypothesesCount: 1 }) as Server["experiments"] });
    const linked = proposal({ proposalId: "prop-exp-link-001", sourceReference: "exp-fixture-1", mutationKind: "research-experiment" });
    const inputs = { ...healthyInputs(), approvalInbox: { connected: true, pending: [linked], today: [], history: [] } };
    const view = build(server, inputs);
    assert.equal(domain(view, "experiments").statusLabel, "TAMAMLANANLAR VAR");
    assert.ok(view.activity.some((entry) => entry.title === "Deney tamamlandı: IMPROVED"));
    const html = renderToStaticMarkup(createElement(U().AyasExperimentsSection, { sources: { override: server }, approvalInbox: inputs.approvalInbox }));
    for (const part of ["5/10 → 8/10", "0 yeni hata", "IMPROVED", "prop-exp-link-001 · PENDING", "bench-1 · recall", "yetkisizdir"]) assert.ok(html.includes(part), `experiment card shows ${part}`);
  });

  await scenario("primary", "P9", "unavailable capability: Ollama down is a WARNING; agents are manual-handoff, never implied dispatch", async () => {
    const base = await healthyServer();
    const server = withServer(base, { capabilities: ok({ items: await capabilityItems(false), ollama: { configured: true, available: false, detail: "ollama: erişilemedi", checkedAt: NOW, model: "qwen-test" } }) as Server["capabilities"] });
    const view = build(server);
    assert.equal(domain(view, "capabilities").attention, "WARNING");
    const label = (id: string) => view.capabilities.find((row) => row.id === id)?.label;
    assert.equal(label("ollama"), "UNAVAILABLE");
    assert.equal(label("cloud"), "NOT CONFIGURED");
    assert.equal(label("claude"), "MANUAL-HANDOFF");
    assert.equal(label("codex"), "MANUAL-HANDOFF");
    assert.equal(label("web-research-lookup"), "UNAVAILABLE");
    assert.equal(label("graphify"), "UNAVAILABLE");
    assert.match(view.capabilities.find((row) => row.id === "graphify")!.note, /kayıtlı değil/);
    assert.ok(!view.capabilities.some((row) => (row.id === "claude" || row.id === "codex") && (row.label === "AVAILABLE" || row.label === "REGISTERED")));
  });

  await scenario("primary", "P10", "security: recorded Stage 9 review with deferred checks, pinned to the security doc; no scanner on load", async () => {
    const server = await healthyServer();
    const view = build(server);
    assert.equal(domain(view, "security").attention, "HEALTHY");
    assert.match(domain(view, "security").summary, /4 ertelenmiş kontrol/);
    const sec = await import("../src/lib/ayas/security/AyasSecurityReviewRecord");
    const doc = fs.readFileSync(path.join(REPO_ROOT, sec.AYAS_LAST_SECURITY_REVIEW.doc), "utf8");
    for (const check of sec.AYAS_LAST_SECURITY_REVIEW.deferredChecks) assert.ok(doc.includes(check.docPhrase), `doc still documents ${check.id}`);
    assert.match(doc, /BLOCKER: 0\. Unresolved verified MAJOR: 0\./);
    assert.equal(sec.AYAS_LAST_SECURITY_REVIEW.blockers, 0);
    assert.equal(sec.AYAS_LAST_SECURITY_REVIEW.unresolvedMajors, 0);
    const html = renderToStaticMarkup(createElement(U().AyasSystemPanel, { sources: { override: server } }));
    for (const check of sec.AYAS_LAST_SECURITY_REVIEW.deferredChecks) assert.ok(html.includes(check.label));
    assert.match(html, /canlı tarama değildir/);
    const dev = build(withServer(server, { security: ok({ ...valueOf(server.security), accessGate: "disabled-dev" }) as Server["security"] }));
    assert.equal(dev.attention.find((entry) => entry.domain === "security")?.level, "WARNING");
  });

  await scenario("primary", "P11", "no data: absent sources are NO_DATA, not warnings, and panels say so", async () => {
    const base = await healthyServer();
    const server = withServer(base, {
      experiments: { kind: "absent", observedAt: NOW, code: "EXPERIMENT_STORE_ABSENT" },
      memory: { kind: "absent", observedAt: NOW, code: "MEMORY_STORE_ABSENT" },
      roadmap: { kind: "absent", observedAt: NOW, code: "ROADMAP_ABSENT" },
      development: ok({ ...valueOf(base.development), recentCommits: [] }) as Server["development"],
      graphify: ok({ ...valueOf(base.graphify), analyzedAt: null }) as Server["graphify"],
    });
    const inputs = { ...healthyInputs(), researchEngineStatus: { connected: true, consecutiveFailures: 0, sources: [], digest: { sourcesRegistered: 0, sourcesChangedLast24h: 0, sourcesFailingNow: 0, findingsLast24h: 0 } } };
    const view = build(server, inputs);
    for (const id of ["experiments", "memory", "reports"]) {
      assert.equal(domain(view, id).availability, "NO_DATA", id);
      assert.equal(domain(view, id).attention, "INFORMATIONAL", id);
    }
    assert.equal(view.attention.length, 0);
    assert.equal(view.activity.length, 0);
    assert.equal(view.roadmapNextStage, null);
    const tiles = renderToStaticMarkup(createElement(U().AyasDomainTiles, { sources: { override: server }, inputs }));
    assert.match(tiles, /data-testid="bc-cc-activity-empty"/);
    const mem = renderToStaticMarkup(createElement(U().AyasMemoryStatsSection, { sources: { override: server } }));
    assert.match(mem, /data-testid="bc-cc-memory-absent"/);
  });

  await scenario("primary", "P12", "partial backend outage: failed sources are WARNING with their code; the rest stays real", async () => {
    const base = await healthyServer();
    const server = withServer(base, {
      graphify: { kind: "unavailable", observedAt: NOW, code: "TIMEOUT" },
      memory: { kind: "unavailable", observedAt: NOW, code: "AYAS_MEMORY_STORE_MALFORMED" },
    });
    const inputs = { ...healthyInputs(), approvalInbox: { connected: false, pending: [], today: [], history: [], error: "inbox unreadable" } };
    const view = build(server, inputs);
    for (const id of ["graphify", "memory", "approvals"]) {
      assert.equal(domain(view, id).availability, "UNAVAILABLE", id);
      assert.equal(domain(view, id).statusLabel, "OKUNAMADI", id);
      assert.ok(view.attention.some((entry) => entry.id === `${id}:unavailable`), `${id} raises an unreadable item`);
    }
    assert.equal(domain(view, "health").attention, "HEALTHY", "healthy sources still render as they are");
    const system = renderToStaticMarkup(createElement(U().AyasSystemPanel, { sources: { override: server } }));
    assert.match(system, /data-testid="bc-cc-graphify-unavailable"[^>]*>Okunamadı \(zaman aşımı\)/);
    const none = build(null);
    assert.ok(none.attention.some((entry) => entry.id === "server:unavailable"));
    for (const id of ["health", "development", "graphify", "memory", "security", "atolye"]) assert.equal(domain(none, id).availability, "UNAVAILABLE", `${id} without server`);
  });

  await scenario("primary", "P13", "unauthorized access: /brain and its Server Actions are behind the access gate", async () => {
    const gate = await import("../src/lib/auth/accessGate");
    const mw = await import("../middleware");
    const { NextRequest } = await import("next/server");
    assert.equal(gate.isProtectedPath("/brain"), true);
    const previous = process.env.AYAS_ACCESS_KEY;
    process.env.AYAS_ACCESS_KEY = "fixture-access-key-000000000000";
    try {
      const get = await mw.middleware(new NextRequest("http://localhost:3000/brain", { headers: { host: "localhost:3000" } }));
      assert.equal(get.status, 307);
      assert.match(get.headers.get("location") ?? "", /\/login\?next=%2Fbrain/);
      const action = await mw.middleware(new NextRequest("http://localhost:3000/brain", { method: "POST", headers: { host: "localhost:3000", origin: "http://localhost:3000", "next-action": "fixture" } }));
      assert.notEqual(action.status, 200);
      assert.ok(action.status === 307 || action.status === 401, `server action without session → ${action.status}`);
      const cross = await mw.middleware(new NextRequest("http://localhost:3000/brain", { method: "POST", headers: { host: "localhost:3000", origin: "http://192.0.2.1:3000" } }));
      assert.equal(cross.status, 403);
    } finally {
      if (previous === undefined) delete process.env.AYAS_ACCESS_KEY; else process.env.AYAS_ACCESS_KEY = previous;
    }
    const source = fs.readFileSync(path.join(REPO_ROOT, "app/brain/observerActions.ts"), "utf8");
    assert.match(source, /^"use server";/, "the refresh is a Server Action on the gated /brain route");
    assert.ok(!fs.existsSync(path.join(REPO_ROOT, "app/api/brain/control-center")), "no separate, ungated control-center API route");
  });

  const tempRoot: string | null = collector && model ? await makeTempRepo() : null;
  const collectTemp = async (extra: Partial<Parameters<CollectorModule["loadAyasControlCenterFacts"]>[0]> = {}) =>
    C().loadAyasControlCenterFacts({ cwd: tempRoot!, env: { ...process.env, AYAS_ACCESS_KEY: SECRET_MARKER, AYAS_FIXTURE_CREDENTIAL: `cred-${SECRET_MARKER}`, AYAS_AUTONOMOUS_EXECUTION_ENABLED: "0" }, now: () => NOW, fetcher: okFetch, loadProjectCatalog: catalog, ...extra });

  await scenario("primary", "P14", "raw secrets, env values and absolute paths never leave the server read model", async () => {
    C();
    const facts = await collectTemp();
    const json = JSON.stringify(facts);
    assert.ok(!json.includes(SECRET_MARKER), "access key / API key never serialised");
    assert.ok(!json.includes(tempRoot!), "no absolute workspace path");
    assert.ok(!json.includes(tempRoot!.replace(/\\/g, "/")), "no absolute workspace path (posix)");
    assert.ok(!json.includes(os.homedir()), "no home directory path");
    assert.equal(facts.security.kind, "ok");
    assert.equal((facts.security as { value: { accessGate: string } }).value.accessGate, "enforced");
  });

  await scenario("primary", "P15", "private memory: only counts leave the store; no title, body or value", async () => {
    C();
    const facts = await collectTemp();
    assert.ok(!JSON.stringify(facts).includes(PRIVATE_MARKER), "memory text not serialised");
    assert.equal(facts.memory.kind, "ok");
    const memory = (facts.memory as { value: { total: number; revision: number; byKind: Record<string, number> } }).value;
    assert.equal(memory.total, 2);
    assert.equal(memory.revision, 2);
    assert.deepEqual(memory.byKind, { "user-preference": 1, decision: 1 });
    const html = renderToStaticMarkup(createElement(U().AyasMemoryStatsSection, { sources: { override: facts } }));
    assert.ok(!html.includes(PRIVATE_MARKER));
    assert.match(html, /bellek içerikleri gösterilmez/);
  });

  await scenario("primary", "P16", "every action is classified; owner approvals route to existing panels; the Control Center imports no authority", async () => {
    const base = await healthyServer();
    const inputs = {
      ...healthyInputs(),
      approvalInbox: { connected: true, pending: [proposal(), proposal({ proposalId: "prop-review-00003", safetyClassification: "REVIEW_REQUIRED", approvalReady: false })], today: [], history: [proposal({ proposalId: "prop-approved-004", status: "APPROVED" })] },
      researchEngineStatus: { ...healthyInputs().researchEngineStatus!, awaitingOwnerGoalCount: 1 },
    };
    const view = build(withServer(base, { graphify: { kind: "unavailable", observedAt: NOW, code: "TIMEOUT" } }), inputs);
    const kinds = new Set(["READ_ONLY", "OWNER_APPROVAL", "SAFE_OPERATION", "MUTATING_GOVERNED", "UNAVAILABLE"]);
    for (const item of view.attention) {
      assert.ok(kinds.has(item.next.kind), `${item.id} action is classified`);
      assert.notEqual(item.next.kind, "MUTATING_GOVERNED", "the Control Center offers no mutation of its own");
      if (item.next.kind === "OWNER_APPROVAL") {
        assert.ok(["development", "research", "selfheal"].includes(item.next.panel!), `${item.id} opens an existing authority panel`);
        assert.equal(item.next.command, undefined);
      }
    }
    // Imports and code, not prose: a comment may name the module it deliberately avoids.
    const authorityModule = /(?:^|\/)actions$|AyasApprovalInboxStore|AyasAutonomousExecutionGate|AyasProposalApprovalService|AyasMicroBatchApprovalService|AyasExecutionGateStore|AyasProposalExecutionService|AyasGuardedPublication|AyasOwnerApprovalResume|AyasMutationRegistry/;
    const authorityCall = /decideAyasApproval|consumeApproval|createProposal|\.decide\(|approveAndExecute|dangerouslySetInnerHTML/;
    for (const file of ["src/components/brain/AyasControlCenter.tsx", "src/lib/brain/ui/AyasControlCenterModel.ts", "src/lib/brain/ui/AyasControlCenterCollector.ts"]) {
      const source = fs.readFileSync(path.join(REPO_ROOT, file), "utf8");
      for (const match of source.matchAll(/from\s+"([^"]+)"/g)) assert.doesNotMatch(match[1]!, authorityModule, `${file} imports ${match[1]}`);
      const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
      assert.doesNotMatch(code, authorityCall, `${file} calls no authority primitive`);
    }
    const observer = fs.readFileSync(path.join(REPO_ROOT, "app/brain/observerActions.ts"), "utf8");
    assert.doesNotMatch(observer, /AyasApprovalInboxStore|decideAyasApproval|\bfrom\s+"\.\/actions"|consumeApproval|createProposal|authorizationId|AyasExecutionGateStore/);
    assert.match(observer, /export async function refreshAyasControlCenter\(\): Promise<AyasControlCenterServerFacts> \{\s*return loadAyasControlCenterFacts\(\);\s*\}/);
    const html = renderAttention(base, inputs);
    assert.doesNotMatch(html, /<form|formAction|action="/, "no form submission from the Control Center");
  });

  await scenario("primary", "P17", "no direct mutation: collecting leaves the workspace byte-identical and uses read-only Git only", async () => {
    C();
    const before = fingerprintTree(tempRoot!);
    const status = git(tempRoot!, ["status", "--porcelain"]);
    await collectTemp();
    await collectTemp();
    assert.equal(fingerprintTree(tempRoot!), before, "TEMP workspace unchanged");
    assert.equal(git(tempRoot!, ["status", "--porcelain"]), status);
    const src = fs.readFileSync(path.join(REPO_ROOT, "src/lib/brain/ui/AyasControlCenterCollector.ts"), "utf8");
    assert.doesNotMatch(src, /writeFileSync|renameSync|mkdirSync|rmSync|unlinkSync|appendFileSync|copyFileSync|writeFile\(|ls-remote|"push"|"commit"|"add"|"fetch"|"pull"|"reset"|"checkout"/);
    const gitCalls = [...src.matchAll(/git\(cwd, \["([a-z-]+)"/g)].map((match) => match[1]);
    assert.deepEqual([...new Set(gitCalls)].sort(), ["log", "merge-base"], "read-only Git subcommands only");
  });

  await scenario("primary", "P18", "mobile: owner attention precedes the rest, tiles collapse to one column, tap targets ≥ 44px, no tables", async () => {
    const css = fs.readFileSync(path.join(REPO_ROOT, "src/components/brain/BrainCore.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    need(ui, "AyasControlCenter UI");
    const mobile = [...css.matchAll(/@media \(max-width: 640px\) \{([\s\S]*?)\n\}/g)].map((match) => match[1]).join("\n");
    assert.match(mobile, /\.bc-cc-tiles \{ grid-template-columns: 1fr; \}/);
    assert.match(mobile, /\.bc-cc-go \{[^}]*min-height: 44px/);
    const view = need(viewModule, "BrainConsoleView");
    const brainCore = await import("../src/components/brain/brainCore");
    const snapshot = { generatedAt: NOW, executionGate: "CLOSED", connected: { tasks: false, cycles: false, experience: false }, errors: [], tasks: { total: 0, byStatus: {}, pendingApproval: 0, skippedUnsafe: 0, items: [] }, cyclesRecorded: 0, experience: { total: 0 }, safety: { decision: "proceed-with-constraints", snapshotSource: "unavailable", reasons: [], hardwareProfileId: "x" } };
    const inputs = healthyInputs();
    const html = renderToStaticMarkup(createElement(view.BrainConsoleView, { snapshot: snapshot as never, coreState: "idle", activePanel: "chat", messages: [brainCore.brainWelcomeMessage(snapshot as never)], controlCenter: { override: await healthyServer() }, approvalInbox: inputs.approvalInbox, microBatch: inputs.microBatch, researchEngineStatus: inputs.researchEngineStatus, goalDevelopment: inputs.goalDevelopment } as never));
    const attention = html.indexOf('data-testid="bc-control-center"');
    const presence = html.indexOf("bc-presence");
    assert.ok(attention > 0 && presence > attention, "owner attention renders before the presence card");
    assert.ok(!/<table/.test(html), "no wide table on the home screen");
  });

  await scenario("primary", "P19", "freshness: data time, server read time and UI time are distinct and deterministic", async () => {
    const server = await healthyServer();
    const view = build(server);
    const g = domain(view, "graphify");
    assert.equal(g.dataAt, minutesAgo(30), "Graphify freshness is its analysis time");
    assert.equal(g.observedAt, NOW, "observedAt is when the server read it");
    assert.notEqual(g.dataAt, g.observedAt);
    assert.equal(domain(view, "approvals").observedAt, null, "client-loaded views claim no server read time");
    assert.equal(domain(view, "health").dataAtLabel, "son gözlemci kalp atışı");
    assert.equal(g.dataAtLabel, "son Graphify güncellemesi", "branch metadata time is not claimed as analysis time");
    assert.match(M().ayasCcFormatTime(minutesAgo(90), NOW), /2 sa önce$/);
    assert.match(M().ayasCcFormatTime(minutesAgo(-60), NOW), /1 sa sonra$/, "scheduled times read as 'in N', not as an anomaly");
    assert.equal(M().ayasCcFormatTime("not-a-date", NOW), "—");
    const html = renderAttention(server);
    assert.match(html, /Sunucu okuması: 25\.09 13:00/);
  });

  await scenario("primary", "P20", "activity feed: real transitions only, windowed, deduplicated, bounded and newest first", async () => {
    const base = await healthyServer();
    const commits = [
      ...Array.from({ length: 20 }, (_, i) => ({ hash: i.toString(16).padStart(40, "c"), committedAt: minutesAgo(100 + i), subject: `commit ${i}` })),
      { hash: "d".repeat(40), committedAt: minutesAgo(20 * 24 * 60), subject: "too old" },
      { hash: "e".repeat(40), committedAt: minutesAgo(-60), subject: "from the future" },
    ];
    const server = withServer(base, { development: ok({ ...valueOf(base.development), recentCommits: commits }) as Server["development"] });
    const p = proposal({ createdAt: minutesAgo(10) });
    const inputs = { ...healthyInputs(), approvalInbox: { connected: true, pending: [p], today: [p], history: [p] } };
    const view = build(server, inputs);
    assert.equal(view.activity.length, M().AYAS_CC_ACTIVITY_LIMIT);
    assert.ok(!view.activity.some((entry) => /too old|from the future/.test(entry.title)));
    assert.equal(view.activity.filter((entry) => entry.id === `proposal:${p.proposalId}:created`).length, 1);
    assert.ok(!view.activity.some((entry) => /kalp|heartbeat/i.test(entry.title)), "no heartbeat noise");
    const times = view.activity.map((entry) => Date.parse(entry.at));
    assert.deepEqual(times, [...times].sort((a, b) => b - a));
  });

  await scenario("primary", "P21", "no stale 'Not connected' status for research or production on the home screen or tabs", async () => {
    const view = need(viewModule, "BrainConsoleView");
    const brainCore = await import("../src/components/brain/brainCore");
    const snapshot = { generatedAt: NOW, executionGate: "CLOSED", connected: { tasks: false, cycles: false, experience: false }, errors: [], tasks: { total: 0, byStatus: {}, pendingApproval: 0, skippedUnsafe: 0, items: [] }, cyclesRecorded: 0, experience: { total: 0 }, safety: { decision: "proceed-with-constraints", snapshotSource: "unavailable", reasons: [], hardwareProfileId: "x" } };
    for (const activePanel of ["chat", "research", "production"]) {
      const html = renderToStaticMarkup(createElement(view.BrainConsoleView, { snapshot: snapshot as never, coreState: "idle", activePanel, messages: [brainCore.brainWelcomeMessage(snapshot as never)] } as never));
      assert.doesNotMatch(html, /Not connected|not connected — a later|Research role not connected/, `${activePanel}: no stale placeholder status`);
    }
  });

  /* ------------------------------------------------------ held-out --- */

  await scenario("held-out", "H1", "observer DOWN → ACTION_REQUIRED, opens the Autonomous panel", async () => {
    const base = await healthyServer();
    const view = build(withServer(base, { health: ok({ ...valueOf(base.health), verdict: "DOWN", ownerActionRecommended: true, findings: [{ code: "OBSERVER_OWNER_DEAD", severity: "CRITICAL", subject: "observer", message: "the observer lock names a process that is no longer running" }] }) as Server["health"] }));
    const item = view.attention[0]!;
    assert.equal(item.level, "ACTION_REQUIRED");
    assert.equal(item.next.panel, "autonomous");
    assert.equal(domain(view, "autonomy").statusLabel, "ÇALIŞMIYOR");
  });

  await scenario("held-out", "H2", "diverged branch → ACTION_REQUIRED, no force suggested", async () => {
    const base = await healthyServer();
    const view = build(withServer(base, { development: ok({ ...valueOf(base.development), ahead: 1, behind: 2, recovery: { mode: "DIVERGED", firstUnfinishedGate: "SYNC", readiness: "NOT_READY", reasonCodes: ["LOCAL_AND_REMOTE_DIVERGED_NO_FORCE"] } }) as Server["development"] }));
    const item = view.attention.find((entry) => entry.domain === "development")!;
    assert.equal(item.level, "ACTION_REQUIRED");
    assert.match(item.reason, /zorla itme yapılmaz/);
  });

  await scenario("held-out", "H3", "misconfigured access gate → ACTION_REQUIRED", async () => {
    const base = await healthyServer();
    const view = build(withServer(base, { security: ok({ ...valueOf(base.security), accessGate: "misconfigured" }) as Server["security"] }));
    assert.equal(domain(view, "security").attention, "ACTION_REQUIRED");
  });

  await scenario("held-out", "H4", "micro batch READY_FOR_REVIEW → owner approval via the existing BATCH ONAYLA control", async () => {
    const inputs = { ...healthyInputs(), microBatch: { connected: true, active: { batchId: "batch-1", batchVersion: 1, baseHead: HEAD, baseBranch: "main", items: [], exactFilesUnion: [], validatorUnion: [], batchHash: "x", createdAt: minutesAgo(30), lastUpdatedAt: minutesAgo(5), validationSummary: [], aggregateRisk: "LOW", status: "READY_FOR_REVIEW", displayState: "NORMAL" }, history: [] } } as Omit<Input, "server">;
    const item = build(await healthyServer(), inputs).attention.find((entry) => entry.id === "approvals:batch:batch-1")!;
    assert.equal(item.next.kind, "OWNER_APPROVAL");
    assert.match(item.next.label, /BATCH ONAYLA VE UYGULA/);
  });

  await scenario("held-out", "H5", "research catch-up awaiting the owner → OWNER_APPROVAL on the Research panel", async () => {
    const inputs = { ...healthyInputs(), researchEngineStatus: { ...healthyInputs().researchEngineStatus!, awaitingOwnerGoalCount: 2 } };
    const item = build(await healthyServer(), inputs).attention.find((entry) => entry.id === "research:awaiting-owner")!;
    assert.equal(item.level, "ACTION_REQUIRED");
    assert.equal(item.next.panel, "research");
  });

  await scenario("held-out", "H6", "REVIEW_REQUIRED proposal is a warning, never an approve prompt", async () => {
    const inputs = { ...healthyInputs(), approvalInbox: { connected: true, pending: [proposal({ safetyClassification: "REVIEW_REQUIRED", approvalReady: false })], today: [], history: [] } };
    const view = build(await healthyServer(), inputs);
    assert.ok(!view.attention.some((entry) => entry.id === "approvals:actionable"));
    assert.equal(view.attention.find((entry) => entry.id === "approvals:blocked")?.level, "WARNING");
  });

  await scenario("held-out", "H7", "untrusted text renders as escaped text only", async () => {
    const hostile = "<script>alert(1)</script><img src=x onerror=alert(2)>";
    const inputs = { ...healthyInputs(), approvalInbox: { connected: true, pending: [proposal({ objective: `${hostile}\nsatır` })], today: [], history: [] }, researchEngineStatus: { ...healthyInputs().researchEngineStatus!, connected: false, error: hostile } };
    const html = renderAttention(await healthyServer(), inputs);
    assert.ok(!html.includes("<script>") && !html.includes("<img"), "no live markup from data");
    assert.ok(html.includes("&lt;script&gt;"), "shown as text");
    assert.equal(M().ayasCcText("a\u0000b\nc\u001bd"), "a b c d");
  });

  await scenario("held-out", "H8", "autonomous-execution flag mirror matches the authority module's predicate", async () => {
    const gate = await import("../src/lib/brain/autonomy/AyasAutonomousExecutionGate");
    for (const value of ["1", "0", "true", "", " 1", undefined]) {
      assert.equal(C().readAyasAutonomousExecutionFlag({ AYAS_AUTONOMOUS_EXECUTION_ENABLED: value }), gate.isAyasAutonomousExecutionEnabled({ AYAS_AUTONOMOUS_EXECUTION_ENABLED: value }), `value ${JSON.stringify(value)}`);
    }
  });

  await scenario("held-out", "H9", "owner-approved-pending-execution waits (IN_PROGRESS); a legacy APPROVED proposal needs YÜRÜT", async () => {
    assert.equal(M().ayasCcApprovalRequirement(proposal({ status: "APPROVED", ownerApprovedPendingExecution: true })).level, "IN_PROGRESS");
    assert.equal(M().ayasCcApprovalRequirement(proposal({ status: "APPROVED" })).label, "Onaylandı — YÜRÜT bekliyor");
  });

  await scenario("held-out", "H10", "no polling and no client fetch in the Control Center UI", async () => {
    need(ui, "AyasControlCenter UI");
    for (const file of ["src/components/brain/AyasControlCenter.tsx", "src/components/brain/BrainCoreConsole.tsx", "src/components/brain/BrainConsoleView.tsx"]) {
      const code = fs.readFileSync(path.join(REPO_ROOT, file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
      for (const banned of ["fetch(", "setInterval(", "XMLHttpRequest", "EventSource", "WebSocket"]) assert.ok(!code.includes(banned), `${file} must not contain ${banned}`);
    }
    const ui2 = fs.readFileSync(path.join(REPO_ROOT, "src/components/brain/AyasControlCenter.tsx"), "utf8");
    assert.ok(!ui2.includes("setTimeout("), "no timer in the Control Center UI");
  });

  await scenario("held-out", "H11", "semantic-pending-only graph is informational and says so", async () => {
    const base = await healthyServer();
    const view = build(withServer(base, { graphify: ok({ ...valueOf(base.graphify), classification: "GRAPH_SEMANTIC_PENDING_ONLY", semanticStatus: "PENDING" }) as Server["graphify"] }));
    assert.equal(domain(view, "graphify").attention, "INFORMATIONAL");
    assert.match(domain(view, "graphify").statusLabel, /ANLAMSAL BEKLİYOR/);
  });

  await scenario("held-out", "H12", "attention folding never hides an ACTION_REQUIRED item and keeps the rest one tap away", async () => {
    const mk = (id: string, level: "ACTION_REQUIRED" | "WARNING" | "IN_PROGRESS") => ({ id, domain: "health" as const, level, title: id, reason: "r", source: "s", at: null, next: { kind: "READ_ONLY" as const, label: "x" }, details: [] });
    const five = ["a", "b", "c", "d", "e"].map((id) => mk(id, "ACTION_REQUIRED"));
    const split = M().ayasCcSplitAttention([...five, mk("w", "WARNING"), mk("p", "IN_PROGRESS")]);
    assert.equal(split.shown.length, 5);
    assert.deepEqual(split.folded.map((item) => item.id), ["w", "p"]);
    const mixed = M().ayasCcSplitAttention([mk("a", "ACTION_REQUIRED"), mk("w1", "WARNING"), mk("w2", "WARNING"), mk("w3", "WARNING"), mk("p1", "IN_PROGRESS")]);
    assert.deepEqual(mixed.shown.map((item) => item.id), ["a", "w1", "w2", "w3"]);
    assert.deepEqual(mixed.folded.map((item) => item.id), ["p1"]);
    const base = await healthyServer();
    const inputs = { ...healthyInputs(), approvalInbox: { connected: true, pending: [proposal(), proposal({ proposalId: "prop-review-00005", safetyClassification: "REVIEW_REQUIRED", approvalReady: false })], today: [], history: [] }, researchEngineStatus: { ...healthyInputs().researchEngineStatus!, uncertainOutcomePendingReview: true } };
    const server = withServer(base, { graphify: { kind: "unavailable", observedAt: NOW, code: "TIMEOUT" }, memory: { kind: "unavailable", observedAt: NOW, code: "READ_FAILED" } });
    const html = renderAttention(server, inputs);
    assert.match(html, /data-testid="bc-cc-attention-more"/);
    assert.match(html, /<details[^>]*data-testid="bc-cc-attention-more"><summary>Diğer \d+ madde/);
  });

  /* --------------------------------------------------- integration --- */

  await scenario("integration", "I1", "TEMP repo: real collectors produce the expected facts end to end", async () => {
    C();
    const facts = await collectTemp();
    const view = build(facts);
    const dev = facts.development.kind === "ok" ? facts.development.value : null;
    assert.ok(dev, `development ${facts.development.kind}`);
    assert.equal(dev!.branch, "main");
    assert.equal(dev!.counts.untracked, 2, "src/dirty.ts and .gitignore are untracked");
    assert.equal(dev!.recovery?.firstUnfinishedGate, "VALIDATION");
    assert.equal(facts.health.kind, "ok");
    assert.equal((facts.health as { value: { verdict: string } }).value.verdict, "DOWN", "no observer in the fixture");
    assert.equal(facts.graphify.kind, "ok");
    assert.equal((facts.graphify as { value: { classification: string } }).value.classification, "GRAPH_MISSING");
    assert.equal(facts.experiments.kind, "absent");
    assert.equal(facts.roadmap.kind, "ok");
    assert.equal((facts.roadmap as { value: { nextStage: string } }).value.nextStage, "99 — Fixture Stage");
    assert.equal((facts.capabilities as { value: { ollama: { available: boolean } } }).value.ollama.available, true);
    assert.equal(view.overall.level, "ACTION_REQUIRED");
    assert.ok(JSON.stringify(facts).length < 64_000, "bounded payload");
  });

  await scenario("integration", "I2", "a hanging source times out on its own; everything else still arrives", async () => {
    C();
    const started = Date.now();
    const facts = await collectTemp({ loadProjectCatalog: () => new Promise(() => undefined), fetcher: downFetch, timeoutMs: 400 });
    assert.ok(Date.now() - started < 6_000, "bounded by the per-source timeout");
    assert.equal(facts.atolye.kind, "unavailable");
    assert.equal((facts.atolye as { code: string }).code, "TIMEOUT");
    assert.equal(facts.development.kind, "ok");
    assert.equal((facts.capabilities as { value: { ollama: { available: boolean } } }).value.ollama.available, false);
  });

  await scenario("integration", "I4", "behind / diverged upstream is never reported as clean: Stage 10 SYNC / DIVERGED gates reach the owner", async () => {
    C();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-cc-remote-"));
    try {
      const remote = path.join(root, "remote.git");
      const local = path.join(root, "local");
      const other = path.join(root, "other");
      git(root, ["init", "-q", "--bare", "-b", "main", remote]);
      git(root, ["clone", "-q", remote, local]);
      fs.writeFileSync(path.join(local, "a.txt"), "a\n");
      git(local, ["add", "a.txt"]);
      git(local, ["commit", "-q", "-m", "chore: first"]);
      git(local, ["push", "-q", "origin", "main"]);
      git(root, ["clone", "-q", remote, other]);
      fs.writeFileSync(path.join(other, "b.txt"), "b\n");
      git(other, ["add", "b.txt"]);
      git(other, ["commit", "-q", "-m", "chore: remote moves on"]);
      git(other, ["push", "-q", "origin", "main"]);
      git(local, ["fetch", "-q", "origin"]);
      const collect = () => C().loadAyasControlCenterFacts({ cwd: local, env: { ...process.env }, now: () => NOW, fetcher: okFetch, loadProjectCatalog: catalog });
      const behind = await collect();
      const behindDev = valueOf(behind.development);
      assert.equal(behindDev.behind, 1);
      assert.equal(behindDev.recovery?.mode, "SYNC_REQUIRED");
      const behindView = domain(build(behind), "development");
      assert.equal(behindView.attention, "WARNING");
      assert.notEqual(behindView.statusLabel, "TEMİZ · EŞİT");
      fs.writeFileSync(path.join(local, "c.txt"), "c\n");
      git(local, ["add", "c.txt"]);
      git(local, ["commit", "-q", "-m", "chore: local moves on"]);
      const diverged = await collect();
      assert.equal(valueOf(diverged.development).recovery?.mode, "DIVERGED");
      assert.equal(domain(build(diverged), "development").attention, "ACTION_REQUIRED");
    } finally {
      removeTree(root);
    }
  });

  await scenario("held-out", "H13", "development never reads clean when recovery could not be computed", async () => {
    const base = await healthyServer();
    const view = build(withServer(base, { development: ok({ ...valueOf(base.development), counts: { staged: 0, unstaged: 2, untracked: 0, unmerged: 0, total: 2 }, recovery: null, errors: ["BASELINE_LOG_FAILED"] }) }));
    const d = domain(view, "development");
    assert.equal(d.attention, "WARNING");
    assert.notEqual(d.statusLabel, "TEMİZ · EŞİT");
  });

  await scenario("integration", "I3", "performance: pure build over a large fixture stays cheap", async () => {
    const base = await healthyServer();
    const many = Array.from({ length: 200 }, (_, i) => proposal({ proposalId: `prop-${String(i).padStart(12, "0")}`, createdAt: minutesAgo(i) }));
    const inputs = { ...healthyInputs(), approvalInbox: { connected: true, pending: many.slice(0, 20), today: many, history: many } };
    const started = performance.now();
    for (let i = 0; i < 20; i++) build(base, inputs);
    const perBuild = (performance.now() - started) / 20;
    assert.ok(perBuild < 50, `build ${perBuild.toFixed(2)} ms`);
  });

  if (tempRoot) removeTree(tempRoot);

  /* ---------------------------------------------------------- report --- */

  const count = (set: string, outcome: Outcome) => results.filter((r) => r.set === set && r.outcome === outcome).length;
  const total = (set: string) => results.filter((r) => r.set === set).length;
  for (const r of results) if (r.outcome !== "PASS") console.log(`${r.outcome} ${r.id} ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
  const summary = {
    suite: "ayas-brain-control-center",
    mode: BASELINE ? "baseline" : "final",
    primary: { pass: count("primary", "PASS"), fail: count("primary", "FAIL"), missing: count("primary", "MISSING"), total: total("primary") },
    heldOut: { pass: count("held-out", "PASS"), fail: count("held-out", "FAIL"), missing: count("held-out", "MISSING"), total: total("held-out") },
    integration: { pass: count("integration", "PASS"), fail: count("integration", "FAIL"), missing: count("integration", "MISSING"), total: total("integration") },
  };
  const allPass = results.every((r) => r.outcome === "PASS");
  console.log(`AYAS Brain Control Center smoke: ${allPass ? "PASS" : BASELINE ? "BASELINE" : "FAIL"} (${results.length} scenarios)`);
  console.log(JSON.stringify({ status: allPass ? "PASS" : BASELINE ? "BASELINE" : "FAIL", ...summary }));
  process.exitCode = allPass || BASELINE ? 0 : 1;
}

main().catch((error) => { console.error("AYAS Brain Control Center smoke FAILED:", error); process.exitCode = 1; });
