/**
 * Deterministic Stage 10A Graphify integration evaluation. No network, no paid
 * provider, never refreshes the repository's graph, never touches a Scheduled
 * Task. The only writes are disposable fixtures under an OS TEMP directory.
 * On the 4cc7503 baseline (a TEMP `git archive` with this file copied in) the
 * Stage 10A modules are absent and those cases score MISSING; the cases that
 * exercise pre-existing code (per-file AST check, Stage 10 collector and
 * recovery, daemon/discovery gates, tracked instruction files) score that code
 * as it was.
 *
 *   npx tsx scripts/smoke-ayas-graphify-integration.ts [--gate] [--json]
 */
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import type { AyasGraphifyFacts, AyasGraphifyStatus } from "../src/lib/ayas/developer/AyasGraphifyState";
import type { AyasDaemonCandidate, AyasDaemonObservation } from "../src/lib/brain/autonomy/AyasAutonomyDaemon";
import type { AyasSandboxUnvalidatableStore } from "../src/lib/brain/autonomy/AyasSandboxUnvalidatableStore";

type GS = typeof import("../src/lib/ayas/developer/AyasGraphifyState");
type GC = typeof import("../src/lib/ayas/developer/AyasGraphifyStateCollector");
type BC = typeof import("../src/lib/brain/autonomy/AyasBatchGraphifyCheck");
type PD = typeof import("../src/lib/brain/autonomy/AyasPatchDetectors");
type RSC = typeof import("../src/lib/ayas/developer/AyasRepositoryStateCollector");
type RR = typeof import("../src/lib/ayas/developer/AyasRepositoryRecovery");
type TM = typeof import("../src/lib/ayas/developer/AyasDeveloperTaskModel");
type DM = typeof import("../src/lib/brain/autonomy/AyasAutonomyDaemon");
type IB = typeof import("../src/lib/brain/autonomy/AyasApprovalInboxStore");
type NPD = typeof import("../src/lib/brain/autonomy/AyasNovelPatchDiscovery");
type MBA = typeof import("../src/lib/brain/autonomy/AyasMicroBatchAccumulator");
type MB = typeof import("../src/lib/brain/autonomy/AyasMicroBatch");
type MI = typeof import("../src/lib/brain/autonomy/AyasMicroItem");
type PA = typeof import("../src/lib/brain/autonomy/AyasPatchArtifact");

const REPO = process.cwd();
async function load<T>(rel: string): Promise<T | null> {
  const file = path.join(REPO, rel);
  return fs.existsSync(file) ? await import(pathToFileURL(file).href) as T : null;
}

// ---- fixture identities (never valid for the real repository) ----------------
const HEAD = "a1".repeat(20); const OLD = "b2".repeat(20); const OTHER = "c3".repeat(20);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-graphify-integration-"));
const tmp = (name: string): string => { const dir = path.join(TMP, name); fs.mkdirSync(dir, { recursive: true }); return dir; };
const write = (root: string, rel: string, text: string): void => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text, "utf8"); };
const git = (cwd: string, ...args: string[]): string => execFileSync("git", ["-c", "core.autocrlf=false", ...args], { cwd, encoding: "utf8", windowsHide: true }).trim();
const md5 = (text: string): string => crypto.createHash("md5").update(text).digest("hex");

/** Installed Graphify CLI command names, read the same way regardless of which revision is under test. */
function installedGraphifyCommands(): ReadonlySet<string> | null {
  const modules = process.env.AYAS_GRAPHIFY_GLOBAL_MODULES ?? (process.env.APPDATA ? path.join(process.env.APPDATA, "npm", "node_modules") : path.join(path.dirname(path.dirname(process.execPath)), "lib", "node_modules"));
  try { return new Set([...fs.readFileSync(path.join(modules, "@sentropic", "graphify", "dist", "cli.js"), "utf8").matchAll(/\.command\("([a-z][a-z-]*)/g)].map((m) => m[1]!)); }
  catch { return null; }
}
const CLI_COMMANDS = installedGraphifyCommands();

// ---- scoring --------------------------------------------------------------------
type Outcome = "PASS" | "FAIL" | "MISSING";
const results: { id: string; set: "primary" | "held-out"; name: string; outcome: Outcome; detail: string }[] = [];
async function run(id: string, set: "primary" | "held-out", name: string, available: boolean, fn: () => boolean | string | Promise<boolean | string>): Promise<void> {
  if (!available) { results.push({ id, set, name, outcome: "MISSING", detail: "capability absent at this revision" }); return; }
  try {
    const r = await fn();
    results.push({ id, set, name, outcome: r === true ? "PASS" : "FAIL", detail: r === true ? "" : r === false ? "assertion false" : r });
  } catch (error) {
    results.push({ id, set, name, outcome: "FAIL", detail: `threw: ${error instanceof Error ? `${(error as { code?: string }).code ?? error.name}: ${error.message.slice(0, 160)}` : String(error)}` });
  }
}

function facts(o: Partial<AyasGraphifyFacts> = {}): AyasGraphifyFacts {
  return {
    sourceHead: HEAD, dirtyPaths: [], dirtyUncoveredPaths: [],
    branch: { lastSeenHead: HEAD, lastAnalyzedHead: HEAD, stale: false, staleReason: null },
    graph: { builtFromHead: HEAD, nodes: 40, links: 55, duplicateIds: 0, duplicateEdges: 0, dangling: 0, selfLoops: 0 },
    needsUpdateFlag: false, semanticPendingMarker: false, extractionGaps: [], projectConfig: "ABSENT",
    cli: { available: true, version: "fixture" }, localMcpServerAvailable: true, consumers: [], ...o,
  };
}
const graphWith = (o: Partial<Exclude<AyasGraphifyFacts["graph"], string>>) => ({ builtFromHead: HEAD, nodes: 40, links: 55, duplicateIds: 0, duplicateEdges: 0, dangling: 0, selfLoops: 0, ...o });

const CANDIDATE: AyasDaemonCandidate = {
  objective: "fixture objective", currentProblem: "fixture problem", selectionReason: "fixture", expectedUserBenefit: "fixture", expectedBehaviorChange: "fixture",
  unchangedBehavior: "fixture", riskIfNotDone: "fixture", technicalRisk: "low", productionImpact: "none", rationale: "fixture", evidence: ["fixture"], graphifyEvidence: ["fixture"],
  exactFiles: ["scripts/smoke-fixture-gate.ts"], expectedDiffScope: "one new file", testsPlanned: ["smoke-fixture-gate"], risk: "low", rank: 1, mutationKind: "first-safe-smoke-coverage-v1",
};
const observation = (o: Partial<AyasDaemonObservation> = {}): AyasDaemonObservation => ({ now: "2026-01-01T00:00:00.000Z", branch: "wip/fixture", head: HEAD, repoClean: true, graphifyFresh: true, machineAction: "ALLOW", gaps: [], ...o });

async function main(): Promise<void> {
  const gs = await load<GS>("src/lib/ayas/developer/AyasGraphifyState.ts");
  const gc = await load<GC>("src/lib/ayas/developer/AyasGraphifyStateCollector.ts");
  const bc = await load<BC>("src/lib/brain/autonomy/AyasBatchGraphifyCheck.ts");
  const pd = await load<PD>("src/lib/brain/autonomy/AyasPatchDetectors.ts");
  const rsc = await load<RSC>("src/lib/ayas/developer/AyasRepositoryStateCollector.ts");
  const rr = await load<RR>("src/lib/ayas/developer/AyasRepositoryRecovery.ts");
  const tm = await load<TM>("src/lib/ayas/developer/AyasDeveloperTaskModel.ts");
  const dm = await load<DM>("src/lib/brain/autonomy/AyasAutonomyDaemon.ts");
  const ib = await load<IB>("src/lib/brain/autonomy/AyasApprovalInboxStore.ts");
  const npd = await load<NPD>("src/lib/brain/autonomy/AyasNovelPatchDiscovery.ts");
  const mba = await load<MBA>("src/lib/brain/autonomy/AyasMicroBatchAccumulator.ts");
  const mb = await load<MB>("src/lib/brain/autonomy/AyasMicroBatch.ts");
  const mi = await load<MI>("src/lib/brain/autonomy/AyasMicroItem.ts");
  const pa = await load<PA>("src/lib/brain/autonomy/AyasPatchArtifact.ts");
  const S = (f: AyasGraphifyFacts, consumer?: "local" | "mcp"): AyasGraphifyStatus => gs!.evaluateAyasGraphifyState(f, { consumer });
  const hasGs = Boolean(gs); const hasGc = Boolean(gc && gs); const extractor = Boolean(bc && CLI_COMMANDS);

  // ---- real per-file extraction fixture ------------------------------------------
  const ext = tmp("extract");
  const MULTI = 'import assert from "node:assert/strict";\nimport {\n  alpha,\n  beta,\n} from "./fixture-a";\nexport { gamma } from "./fixture-b";\nassert.ok(alpha && beta);\n';
  const REEXPORT = 'export { delta } from "./fixture-a";\n';
  write(ext, "scripts/multi-line-imports.ts", MULTI);
  write(ext, "scripts/reexport-only.ts", REEXPORT);
  write(ext, "scripts/launcher.ps1", '$ErrorActionPreference = "Stop"\nWrite-Output "fixture"\n');
  const declared = (content: string): number => pd!.countDeclaredImportStatements(content);
  const check = bc?.checkAyasBatchItemWithGraphify as ((root: string, file: string, n: number, o?: { approvedContent?: string }) => { importEdgeCount: number; verdict?: string }) | undefined;

  // ---- Stage 10 collector fixture: a real TEMP git repo with a hand-built .graphify ----
  const repo = tmp("repo");
  git(repo, "init", "-q"); git(repo, "config", "user.email", "f@example.invalid"); git(repo, "config", "user.name", "fixture");
  const A_TS = "export const a = 1;\n";
  write(repo, "src/a.ts", A_TS); write(repo, "app/globals.css", "body { margin: 0; }\n"); write(repo, "scripts/start.ps1", "Write-Output 1\n");
  write(repo, "app/api/x/[id]/route.ts", "export function GET() { return 1; }\n"); write(repo, "docs/notes.md", "# notes\n"); write(repo, ".gitignore", ".graphify/\ngraphify-out/\n");
  git(repo, "add", "-A"); git(repo, "commit", "-q", "-m", "fixture");
  const repoHead = git(repo, "rev-parse", "HEAD");
  const abs = (rel: string): string => path.join(repo, rel).replace(/\\/g, "/");
  const writeGraphify = (o: { analyzed?: string; stale?: boolean; built?: string } = {}): void => {
    write(repo, ".graphify/branch.json", JSON.stringify({ lastSeenHead: repoHead, lastAnalyzedHead: o.analyzed ?? repoHead, stale: o.stale ?? false, staleReason: o.stale ? "fixture-lifecycle" : null }));
    write(repo, ".graphify/manifest.json", JSON.stringify({ [abs("src/a.ts")]: { hash: md5(A_TS) }, [abs("scripts/start.ps1")]: { hash: "x" }, [abs("app/api/x/[id]/route.ts")]: { hash: "y" }, [abs("docs/notes.md")]: { hash: "z" } }));
    write(repo, ".graphify/graph.json", JSON.stringify({ graph: { built_from_commit: o.built ?? repoHead }, nodes: [{ id: "a", source_file: "src/a.ts" }, { id: "a_x", source_file: "src/a.ts" }], links: [{ source: "a", target: "a_x", relation: "contains" }] }));
  };
  writeGraphify();
  // A legacy graph beside the canonical one, deliberately describing another commit.
  write(repo, "graphify-out/graph.json", JSON.stringify({ graph: { built_from_commit: OTHER }, nodes: [{ id: "z", source_file: "src/a.ts" }], links: [] }));
  const stage10 = async () => (await rsc!.collectAyasRepositoryState({ cwd: repo, trustedBaseline: repoHead })).graphify;
  const reset = (): void => { git(repo, "checkout", "-q", "--", "."); git(repo, "clean", "-fdq", "-e", ".graphify", "-e", "graphify-out"); fs.rmSync(path.join(repo, ".graphify", "needs_update"), { force: true }); writeGraphify(); };

  // ======================= PRIMARY =======================
  await run("P01", "primary", "graph current at HEAD", hasGs, () => { const s = S(facts()); return s.classification === "GRAPH_CURRENT" && s.structuralStatus === "CURRENT" && s.recoveryCommand === null; });
  await run("P02", "primary", "graph stale after source change", hasGs, () => { const s = S(facts({ dirtyPaths: ["src/a.ts"], dirtyUncoveredPaths: ["src/a.ts"] })); return s.classification === "GRAPH_STALE" && s.recoveryCommand === gs!.AYAS_GRAPHIFY_REFRESH_COMMAND; });
  await run("P03", "primary", "docs-only commit: stale by contract, docs work never blocked", hasGs, () => {
    const s = S(facts({ sourceHead: OTHER }));
    return s.classification === "GRAPH_STALE" && gs!.decideAyasGraphifyRequirement(s, { kind: "docs-only" }).decision === "PROCEED" && gs!.decideAyasGraphifyRequirement(s, { kind: "architecture-change" }).decision === "REFRESH_REQUIRED";
  });
  await run("P04", "primary", "dirty source worktree detected from real manifest hashes", hasGc, async () => {
    reset(); write(repo, "src/a.ts", "export const a = 2;\n");
    const f = await gc!.collectAyasGraphifyFacts({ cwd: repo });
    return f.dirtyUncoveredPaths.includes("src/a.ts") && S(f).structuralReasons.some((r) => r.startsWith("WORKTREE_NOT_COVERED"));
  });
  await run("P05", "primary", "semantic pending only never reads as structural stale", hasGs, () => {
    const s = S(facts({ semanticPendingMarker: true }));
    return s.structuralStatus === "CURRENT" && s.semanticStatus === "PENDING" && s.classification === "GRAPH_SEMANTIC_PENDING_ONLY" && gs!.decideAyasGraphifyRequirement(s, { kind: "architecture-change" }).decision === "PROCEED";
  });
  await run("P06", "primary", "structural anomaly (self-loop) is invalid, not current", hasGs, () => S(facts({ graph: graphWith({ selfLoops: 1 }) })).classification === "GRAPH_EXTRACTION_FAILED");
  await run("P07", "primary", "duplicate IDs are invalid", hasGs, () => S(facts({ graph: graphWith({ duplicateIds: 2 }) })).structuralStatus === "INVALID");
  await run("P08", "primary", "dangling edge is invalid", hasGs, () => S(facts({ graph: graphWith({ dangling: 1 }) })).structuralStatus === "INVALID");
  await run("P09", "primary", "parser partial failure: PARTIAL, critical, not refreshable, no loop", hasGs, () => {
    const s = S(facts({ extractionGaps: [{ path: "scripts/register-fixture-autostart.ps1", kind: "LANGUAGE_NOT_EXTRACTED" }] }));
    return s.classification === "GRAPH_PARTIAL" && s.criticalIncompleteFiles.length === 1 && s.recoveryCommand === null && gs!.planAyasGraphifyRecovery(s, []).step === "NONE"
      && gs!.decideAyasGraphifyRequirement(s, { kind: "authority-change", files: ["src/lib/x.ts"] }).decision === "PROCEED_WITH_LIMITATIONS"
      && gs!.decideAyasGraphifyRequirement(s, { kind: "architecture-change", files: ["scripts/register-fixture-autostart.ps1"] }).decision === "BLOCKED";
  });
  await run("P10", "primary", "stale expected dependency: byte-approved multi-line import is not a failure", extractor && Boolean(pd), () => {
    const d = declared(MULTI);
    const r = check!(ext, "scripts/multi-line-imports.ts", d, { approvedContent: MULTI });
    return r.importEdgeCount !== d && r.verdict === "STALE_EXPECTATION" ? true : `declared ${d}, measured ${r.importEdgeCount}, verdict ${r.verdict}`;
  });
  await run("P11", "primary", "fresh AST contradicts old expectation: result carries the AST count", extractor && Boolean(pd), () => {
    const d = declared(MULTI);
    const r = check!(ext, "scripts/multi-line-imports.ts", d, { approvedContent: MULTI });
    const again = check!(ext, "scripts/multi-line-imports.ts", r.importEdgeCount, { approvedContent: MULTI });
    return again.verdict === "EXPECTED_CHANGE" && again.importEdgeCount === r.importEdgeCount;
  });
  await run("P12", "primary", "recovery does not loop (dependency + graph refresh)", extractor && hasGs && Boolean(pd), () => {
    const d = declared(MULTI);
    const verdicts = [1, 2, 3].map(() => check!(ext, "scripts/multi-line-imports.ts", d, { approvedContent: MULTI }).verdict);
    const stale = S(facts({ sourceHead: OTHER }));
    const first = gs!.planAyasGraphifyRecovery(stale, []);
    const second = gs!.planAyasGraphifyRecovery(stale, [{ sourceHead: OTHER, classification: "GRAPH_STALE" }]);
    return verdicts.every((v) => v === "STALE_EXPECTATION") && first.step === "REFRESH" && second.step === "STOP";
  });
  await run("P13", "primary", "PC-off startup: HEAD moved while off → proposal lanes pause, runtime work proceeds", hasGs, () => {
    const s = S(facts({ sourceHead: OTHER, branch: { lastSeenHead: HEAD, lastAnalyzedHead: HEAD, stale: false, staleReason: null } }));
    return s.classification === "GRAPH_STALE" && gs!.decideAyasGraphifyRequirement(s, { kind: "blast-radius-approval" }).decision === "REFRESH_REQUIRED" && gs!.decideAyasGraphifyRequirement(s, { kind: "runtime-operation" }).decision === "PROCEED";
  });
  await run("P14", "primary", "daemon starts before a graph exists: discover() creates nothing; a fresh graph does", Boolean(dm && ib), () => {
    const inbox = ib!.createAyasApprovalInboxStore({ rootDir: tmp("inbox-p14") });
    const daemon = dm!.createAyasAutonomyDaemon({ inbox, now: () => "2026-01-01T00:00:00.000Z", repoRoot: tmp("daemon-p14") });
    daemon.observe(observation({ graphifyFresh: false }));
    const stale = daemon.discover(observation({ graphifyFresh: false }), [CANDIDATE]);
    const fresh = daemon.discover(observation(), [CANDIDATE]);
    return stale.length === 0 && fresh.length === 1 && (hasGs ? S(facts({ graph: "ABSENT", branch: "ABSENT" })).classification === "GRAPH_MISSING" : true);
  });
  // Novel discovery must not draft/sandbox/freeze while the graph is stale; a spy suppression store counts loop entries.
  const novelRepo = tmp("novel");
  git(novelRepo, "init", "-q"); git(novelRepo, "config", "user.email", "f@example.invalid"); git(novelRepo, "config", "user.name", "fixture");
  write(novelRepo, "scripts/smoke-fixture-bare.ts", 'import assert from "node:assert/strict";\nassert.ok(true);\n');
  git(novelRepo, "add", "-A"); git(novelRepo, "commit", "-q", "-m", "fixture");
  const novelTick = async (graphifyFresh: boolean): Promise<number> => {
    let entered = 0;
    const spy: AyasSandboxUnvalidatableStore = { dir: tmp(`spy-${graphifyFresh}`), record: () => { throw new Error("fixture spy never records"); }, shouldSkip: () => { entered += 1; return true; }, load: () => undefined, list: () => [], clear: () => undefined };
    await npd!.discoverAyasNovelPatchCandidates({ repoRoot: novelRepo, observation: observation({ head: git(novelRepo, "rev-parse", "HEAD"), graphifyFresh }), artifactStore: pa!.createAyasPatchArtifactStore({ rootDir: tmp(`art-${graphifyFresh}`) }), sandboxUnvalidatableStore: spy, maxAttemptsPerTick: 1 });
    return entered;
  };
  await run("P15", "primary", "catch-up waits safely: stale graph pauses novel drafting and micro accumulation", Boolean(npd && pa && mba && mb && mi), async () => {
    const whileStale = await novelTick(false);
    const whileFresh = await novelTick(true);
    const micro = await mba!.accumulateAyasMicroBatchCandidates({ repoRoot: novelRepo, observation: observation({ graphifyFresh: false }), itemStore: mi!.createAyasMicroItemStore({ rootDir: tmp("mi") }), batchStore: mb!.createAyasMicroBatchStore({ rootDir: tmp("mb") }), artifactStore: pa!.createAyasPatchArtifactStore({ rootDir: tmp("mart") }) });
    return whileStale === 0 && whileFresh >= 1 && micro.itemsAdded.length === 0 ? true : `novel loop entries while stale=${whileStale}, fresh=${whileFresh}; micro items=${micro.itemsAdded.length}`;
  });
  await run("P16", "primary", "IDE closed: structural status does not depend on any IDE/consumer config", hasGs, () => {
    const base = S(facts({ sourceHead: OTHER }));
    const withIde = S(facts({ sourceHead: OTHER, consumers: [{ id: "vscode", host: "vscode", location: ".vscode/mcp.json", mode: "remote-mcp", findings: [] }] }));
    return base.classification === withIde.classification && base.structuralStatus === withIde.structuralStatus && base.recoveryCommand === withIde.recoveryCommand;
  });
  await run("P17", "primary", "IDE open with MCP consumer: MCP unavailability is its own classification", hasGs, () => {
    const f = facts({ localMcpServerAvailable: false });
    return S(f, "mcp").classification === "GRAPH_MCP_UNAVAILABLE" && S(f, "local").classification === "GRAPH_CURRENT";
  });
  await run("P18", "primary", "canonical path selected: .graphify wins over a legacy graphify-out graph", hasGc, async () => {
    reset();
    const f = await gc!.collectAyasGraphifyFacts({ cwd: repo });
    return typeof f.graph === "object" && f.graph.builtFromHead === repoHead && S(f).graphSource === ".graphify/graph.json";
  });
  await run("P19", "primary", "legacy path references are rejected (fixture + tracked instruction files)", hasGs && Boolean(CLI_COMMANDS), () => {
    const flagged = gs!.assessAyasGraphifyInstructions("Graph at graphify-out/graph.json", CLI_COMMANDS!).includes("LEGACY_GRAPH_PATH");
    const tracked = ["CLAUDE.md", ".cursor/rules/graphify.mdc"].filter((f) => fs.existsSync(path.join(REPO, f)));
    const dirty = tracked.filter((f) => gs!.assessAyasGraphifyInstructions(fs.readFileSync(path.join(REPO, f), "utf8"), CLI_COMMANDS!).length > 0);
    return flagged && dirty.length === 0 ? true : `still flagged: ${dirty.join(", ")}`;
  });
  await run("P20", "primary", "VS Code `servers` is valid for VS Code (not renamed to mcpServers)", hasGs, () => {
    const cfg = gs!.interpretAyasMcpConfig("vscode", { servers: { graphify: { type: "http", url: "https://mcp.example.invalid/mcp" } }, inputs: [] });
    const tracked = JSON.parse(fs.readFileSync(path.join(REPO, ".vscode", "mcp.json"), "utf8")) as Record<string, unknown>;
    return cfg.validForHost && !cfg.graphifyIngestReadable && "servers" in tracked && !("mcpServers" in tracked);
  });
  await run("P21", "primary", "host expecting mcpServers: its own schema, not VS Code's", hasGs, () => {
    const wrong = gs!.interpretAyasMcpConfig("claude", { servers: { graphify: { command: "graphify" } } });
    const right = gs!.interpretAyasMcpConfig("claude", { mcpServers: { graphify: { command: "graphify", args: ["serve", ".graphify/graph.json"] } } });
    return !wrong.validForHost && right.validForHost && right.graphifyIngestReadable && gs!.assessAyasGraphifyMcpServer(right.servers[0]!).length === 0;
  });
  await run("P22", "primary", "remote MCP unavailable/unverified never changes local structural truth", hasGs, () => {
    const remote = [{ id: "r", host: "vscode" as const, location: ".vscode/mcp.json", mode: "remote-mcp" as const, findings: ["REMOTE_ENDPOINT_NOT_LOCAL_SOURCE_TRUTH"] }];
    const s = S(facts({ consumers: remote }));
    return s.remoteMcp === "CONFIGURED_UNVERIFIED" && s.classification === "GRAPH_CURRENT" && gs!.decideAyasGraphifyRequirement(s, { kind: "architecture-change" }).decision === "PROCEED";
  });
  await run("P23", "primary", "local CLI available → refresh offered; unavailable → blocked, never assumed", hasGs, () => {
    const up = S(facts({ sourceHead: OTHER })); const down = S(facts({ sourceHead: OTHER, cli: { available: false, version: null } }));
    return up.recoveryCommand !== null && down.recoveryCommand === null && gs!.decideAyasGraphifyRequirement(down, { kind: "architecture-change" }).decision === "BLOCKED" && gs!.decideAyasGraphifyRequirement(down, { kind: "dependency-validation" }).decision === "BLOCKED";
  });
  await run("P24", "primary", "remote/local freshness mismatch: local STALE stays STALE whatever remote says", hasGs, () => {
    const remote = [{ id: "r", host: "vscode" as const, location: ".vscode/mcp.json", mode: "remote-mcp" as const, findings: [] }];
    return S(facts({ sourceHead: OTHER, consumers: remote })).classification === "GRAPH_STALE";
  });
  await run("P25", "primary", "precise status: structural, semantic, MCP are separate fields", hasGs, () => {
    const s = S(facts({ semanticPendingMarker: true, localMcpServerAvailable: false }));
    return s.structuralStatus === "CURRENT" && s.semanticStatus === "PENDING" && s.localMcp === "UNAVAILABLE" && s.lastAnalyzedHead === HEAD && s.graphBuiltFromHead === HEAD;
  });
  await run("P26", "primary", "Stage 10 recovery: needs_update is stale; a never-indexed dirty file does not loop GRAPHIFY_REFRESH", Boolean(rsc && rr), async () => {
    reset(); fs.writeFileSync(path.join(repo, ".graphify", "needs_update"), "1");
    const flagged = await stage10();
    reset(); write(repo, "app/globals.css", "body { margin: 1px; }\n");
    const state = await rsc!.collectAyasRepositoryState({ cwd: repo, trustedBaseline: repoHead });
    const recovery = rr!.recoverAyasRepositoryState(state.snapshot, { trustedBaseline: repoHead, expectedScope: ["app/", "src/"], closureRequired: false }, {
      discoveryComplete: true, implementationComplete: true, review: null, currentState: state.stateFingerprint, graphify: state.graphify,
      validations: [{ id: "typescript", required: true, outcome: "PASS", source: "this-session", observedAtState: state.stateFingerprint, rerunThisSession: true, safetyCritical: false }],
    });
    return flagged?.stale === true && state.graphify?.coversWorktree === true && recovery.firstUnfinishedGate !== "GRAPHIFY_REFRESH" ? true : `needs_update stale=${flagged?.stale}; css coversWorktree=${state.graphify?.coversWorktree}; gate=${recovery.firstUnfinishedGate}`;
  });
  await run("P27", "primary", "docs closure flow: refresh once, then CURRENT; plan names only real CLI commands", hasGs && Boolean(tm && CLI_COMMANDS), () => {
    const before = S(facts({ sourceHead: OTHER }));
    const after = S(facts({ sourceHead: OTHER, branch: { lastSeenHead: OTHER, lastAnalyzedHead: OTHER, stale: false, staleReason: null }, graph: graphWith({ builtFromHead: OTHER }) }));
    const task = tm!.describeAyasDeveloperTask({ text: "AyasGraphifyState modülüne yeni sınıflandırma ekle", changedPaths: [] });
    const plan = tm!.planAyasDeveloperChange(task, { current: false, targetSymbols: ["evaluateAyasGraphifyState"], candidateFiles: ["src/lib/ayas/developer/AyasGraphifyState.ts"], affectedFiles: [] });
    const named = plan.steps.flatMap((s) => [...s.detail.matchAll(/graphify ([a-z][a-z-]*)/g)].map((m) => m[1]!));
    const unknown = named.filter((c) => !CLI_COMMANDS!.has(c));
    return gs!.planAyasGraphifyRecovery(before, []).step === "REFRESH" && after.classification === "GRAPH_CURRENT" && unknown.length === 0 ? true : `unknown commands in plan: ${unknown.join(", ")}`;
  });
  await run("P28", "primary", "no authority widening: Graphify modules import no approval/execution authority; strict check without provenance", extractor && hasGs && hasGc, () => {
    const imports = ["src/lib/ayas/developer/AyasGraphifyState.ts", "src/lib/ayas/developer/AyasGraphifyStateCollector.ts"].flatMap((f) => [...fs.readFileSync(path.join(REPO, f), "utf8").matchAll(/from "([^"]+)"/g)].map((m) => m[1]!));
    const authority = imports.filter((i) => /Approval|Execution|Inbox|Publication|Daemon|Mutation|Gate/.test(i));
    const observer = fs.readFileSync(path.join(REPO, "scripts", "ayas-autonomy-daemon.ts"), "utf8");
    let strict = false;
    try { check!(ext, "scripts/multi-line-imports.ts", declared(MULTI)); } catch (error) { strict = (error as { code?: string }).code === "AYAS_GRAPHIFY_UNEXPECTED_DEPENDENCY"; }
    const allowAll = (["architecture-change", "authority-change", "blast-radius-approval", "graph-recovery"] as const).every((kind) => gs!.decideAyasGraphifyRequirement(S(facts({ sourceHead: OTHER })), { kind }).decision !== "PROCEED");
    return authority.length === 0 && !/AyasGraphifyState/.test(observer) && strict && allowAll ? true : `authority imports=${authority.join(",")}; strict=${strict}; allowAll=${allowAll}`;
  });
  await run("P29", "primary", "empty extraction (no parser) is a failure, never zero imports", extractor, () => {
    try { check!(ext, "scripts/launcher.ps1", 0); return "empty .ps1 extraction passed as 0 imports"; }
    catch (error) { return (error as { code?: string }).code === "AYAS_GRAPHIFY_EXTRACT_FAILED"; }
  });
  await run("P30", "primary", "real structural regression: landed ≠ approved still fails closed", extractor && Boolean(pd), () => {
    try { check!(ext, "scripts/multi-line-imports.ts", declared(MULTI), { approvedContent: `${MULTI}// different\n` }); return "passed"; }
    catch (error) { return (error as { code?: string }).code === "AYAS_GRAPHIFY_UNEXPECTED_DEPENDENCY" && /REAL_STRUCTURAL_REGRESSION/.test((error as Error).message); }
  });
  await run("P31", "primary", "extraction gaps classified from real graph + manifest", hasGc, async () => {
    reset();
    const kinds = Object.fromEntries((await gc!.collectAyasGraphifyFacts({ cwd: repo })).extractionGaps.map((g) => [g.path, g.kind]));
    return kinds["scripts/start.ps1"] === "LANGUAGE_NOT_EXTRACTED" && kinds["app/api/x/[id]/route.ts"] === "CODE_FILE_UNATTRIBUTED" && kinds["docs/notes.md"] === "DOCUMENT_WITHOUT_NODES" ? true : JSON.stringify(kinds);
  });
  await run("P32", "primary", "anti-hardcoding: production Graphify logic carries no fixture/machine literals", true, () => {
    const files = ["src/lib/brain/autonomy/AyasBatchGraphifyCheck.ts", "src/lib/brain/autonomy/AyasGraphifyEvidenceStore.ts", "src/lib/brain/autonomy/AyasNovelPatchDiscovery.ts",
      "src/lib/ayas/developer/AyasRepositoryStateCollector.ts", "src/lib/ayas/developer/AyasGraphifyState.ts", "src/lib/ayas/developer/AyasGraphifyStateCollector.ts"].filter((f) => fs.existsSync(path.join(REPO, f)));
    const bad = files.flatMap((f) => {
      const text = fs.readFileSync(path.join(REPO, f), "utf8");
      return [/\b[0-9a-f]{40}\b/, /[A-Za-z]:\\\\Users\\\\|\/Users\/[A-Za-z]+\//, new RegExp(`\\b${os.userInfo().username.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`),/\b(?:14625|42457|1348|1369)\b/, /multi-line-imports|reexport-only|launcher\.ps1|fixture-a|(?:a1){20}/, /=== ?7\b|\bseven\b/i]
        .filter((re) => re.test(text)).map((re) => `${f}: ${re.source.slice(0, 30)}`);
    });
    return bad.length === 0 ? true : bad.join(" | ");
  });
  await run("P33", "primary", "Stage 10 boundary kept: developer modules import only one another and Node built-ins; status and execution resolve the same Graphify install", hasGc && Boolean(bc), () => {
    const dir = path.join(REPO, "src", "lib", "ayas", "developer");
    // Real module specifiers only: comments are stripped, and only import/export statements and import() calls count.
    const specifiers = (source: string): string[] => [...source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
      .matchAll(/^\s*(?:import|export)\b[^;]*?\bfrom\s*"([^"]+)"|^\s*import\s*"([^"]+)"|\bimport\(\s*"([^"]+)"\s*\)/gm)].map((m) => (m[1] ?? m[2] ?? m[3])!);
    const outside = fs.readdirSync(dir).filter((f) => f.endsWith(".ts")).flatMap((f) =>
      specifiers(fs.readFileSync(path.join(dir, f), "utf8")).filter((s) => !s.startsWith("./") && !s.startsWith("node:")).map((s) => `${f} -> ${s}`));
    const probe = specifiers('/** from "not-a-module" */\nimport {\n  a,\n} from "../elsewhere";\nexport { b } from "./sibling";\n').join(",");
    if (probe !== "../elsewhere,./sibling") return `specifier scan self-check failed: ${probe}`;
    const envs = [{ AYAS_GRAPHIFY_GLOBAL_MODULES: path.join(TMP, "override") }, { APPDATA: path.join(TMP, "appdata") }, {}] as NodeJS.ProcessEnv[];
    const disagree = envs.filter((env) => gc!.resolveAyasGraphifyModulesForStatus(env) !== bc!.resolveAyasGraphifyGlobalModules(env)).length;
    return outside.length === 0 && disagree === 0 ? true : `outside imports: ${outside.join(", ") || "none"}; resolver disagreements: ${disagree}`;
  });

  // ======================= HELD-OUT =======================
  await run("H01", "held-out", "alternate stale metadata: lifecycle stale flag at the analyzed HEAD", hasGs, () => S(facts({ branch: { lastSeenHead: HEAD, lastAnalyzedHead: HEAD, stale: true, staleReason: "post-checkout" } })).structuralReasons.some((r) => r.startsWith("BRANCH_MARKED_STALE")));
  await run("H02", "held-out", "different IDE config: Cursor serving a legacy graphify-out graph is broken", hasGs, () => {
    const cfg = gs!.interpretAyasMcpConfig("cursor", { mcpServers: { graph: { command: "npx", args: ["graphify", "serve", "graphify-out/graph.json"] } } });
    return gs!.assessAyasGraphifyMcpServer(cfg.servers[0]!).includes("LEGACY_GRAPH_PATH") && S(facts({ consumers: [{ id: "c", host: "cursor", location: "~/.cursor/mcp.json", mode: "local-mcp", findings: ["LEGACY_GRAPH_PATH"] }] })).consumers[0]!.status === "BROKEN";
  });
  await run("H03", "held-out", "HEAD changed while IDE closed: graph built from another commit though branch.json agrees", hasGs, () => S(facts({ graph: graphWith({ builtFromHead: OLD }) })).structuralReasons.includes("GRAPH_BUILT_FROM_OTHER_COMMIT"));
  await run("H04", "held-out", "remote MCP stale while CLI current: local CURRENT, remote unverified", hasGs, () => { const s = S(facts({ consumers: [{ id: "r", host: "claude", location: "~/.claude.json", mode: "remote-mcp", findings: [] }] })); return s.classification === "GRAPH_CURRENT" && s.remoteMcp === "CONFIGURED_UNVERIFIED"; });
  await run("H05", "held-out", "docs-only post-push closure: second refresh at same HEAD stops instead of looping", hasGs, () => {
    const s = S(facts({ sourceHead: OTHER, needsUpdateFlag: true }));
    return gs!.planAyasGraphifyRecovery(s, [{ sourceHead: OTHER, classification: "GRAPH_STALE" }, { sourceHead: HEAD, classification: "GRAPH_STALE" }]).step === "STOP";
  });
  await run("H06", "held-out", "parser warning on an unrelated language does not block unrelated work", hasGs, () => {
    const s = S(facts({ extractionGaps: [{ path: "tools/legacy/Converter.cs", kind: "LANGUAGE_NOT_EXTRACTED" }] }));
    return s.criticalIncompleteFiles.length === 0 && gs!.decideAyasGraphifyRequirement(s, { kind: "architecture-change", files: ["src/lib/ayas/x.ts"] }).decision === "PROCEED";
  });
  await run("H07", "held-out", "unexpected Graphify config key is reported, host schema still valid", hasGs, () => { const c = gs!.interpretAyasMcpConfig("vscode", { servers: {}, mcpServers2: {} }); return c.validForHost && c.unexpectedKeys.includes("mcpServers2"); });
  await run("H08", "held-out", "re-export-only file: text count 0, AST count differs; provenance decides", extractor && Boolean(pd), () => {
    const d = declared(REEXPORT);
    const ok = check!(ext, "scripts/reexport-only.ts", d, { approvedContent: REEXPORT });
    let strict = false;
    try { check!(ext, "scripts/reexport-only.ts", d); } catch (error) { strict = /UNEXPECTED_CHANGE/.test((error as Error).message); }
    return ok.verdict === "STALE_EXPECTATION" && strict;
  });
  await run("H09", "held-out", "new untracked non-indexed file (.json) keeps Stage 10 coverage", Boolean(rsc), async () => { reset(); write(repo, "scripts/fixture-data.json", "{}\n"); return (await stage10())?.coversWorktree === true; });
  await run("H10", "held-out", "unpinned on-demand MCP package without a graph path is flagged", hasGs, () => {
    const cfg = gs!.interpretAyasMcpConfig("antigravity", { mcpServers: { graphify: { command: "uv", args: ["run", "--with", "some-graphify", "python", "-m", "graphify.serve"] } } });
    const f = gs!.assessAyasGraphifyMcpServer(cfg.servers[0]!);
    return f.includes("UNPINNED_ON_DEMAND_PACKAGE") && f.includes("NO_GRAPH_PATH_ARGUMENT");
  });
  await run("H11", "held-out", "hook with a quoted binary path containing spaces is parsed, not reported missing", hasGc, async () => {
    reset();
    const binDir = path.join(TMP, "tool dir");
    fs.mkdirSync(binDir, { recursive: true });
    const present = path.join(binDir, "graphify.cmd");
    fs.writeFileSync(present, "@echo off\n");
    write(repo, ".claude/settings.local.json", JSON.stringify({ hooks: { PreToolUse: [{ hooks: [{ type: "command", command: `"${present}" hook-check` }, { type: "command", command: `"${path.join(binDir, "gone", "graphify.exe")}" hook-check` }] }] } }));
    const hooks = (await gc!.collectAyasGraphifyFacts({ cwd: repo })).consumers.filter((c) => c.id.startsWith("claude-local-hooks"));
    return hooks.length === 2 && hooks[0]!.findings.length === 0 && hooks[1]!.findings.includes("HOOK_BINARY_MISSING") ? true : JSON.stringify(hooks.map((h) => h.findings));
  });
  await run("H12", "held-out", "a non-git provenance hash is never read as the commit the graph was built from", hasGc, () => {
    const doc = (hash: string) => ({ graph: { provenance: { source_owner: "other-adapter", source_hash: hash } }, nodes: [{ id: "n", source_file: "src/a.ts" }], links: [] });
    return gc!.summarizeAyasGraphifyGraph(doc("d4".repeat(32)))?.fact.builtFromHead === null && gc!.summarizeAyasGraphifyGraph(doc(OLD))?.fact.builtFromHead === OLD;
  });
  await run("H13", "held-out", "dirty session at one HEAD: unchanged state after a refresh stops, a new edit may refresh again", hasGc, async () => {
    reset(); write(repo, "src/a.ts", "export const a = 3;\n");
    const first = S(await gc!.collectAyasGraphifyFacts({ cwd: repo }));
    const history = [{ sourceHead: first.sourceHead, classification: first.classification, worktreeFingerprint: first.worktreeFingerprint }];
    const unchanged = gs!.planAyasGraphifyRecovery(S(await gc!.collectAyasGraphifyFacts({ cwd: repo })), history).step;
    write(repo, "src/a.ts", "export const a = 4;\n");
    const edited = S(await gc!.collectAyasGraphifyFacts({ cwd: repo }));
    const afterEdit = gs!.planAyasGraphifyRecovery(edited, history).step;
    return first.classification === "GRAPH_STALE" && first.worktreeFingerprint !== null && unchanged === "STOP" && edited.worktreeFingerprint !== first.worktreeFingerprint && afterEdit === "REFRESH"
      ? true : `unchanged=${unchanged}, afterEdit=${afterEdit}, fingerprints ${first.worktreeFingerprint?.slice(0, 8)} -> ${edited.worktreeFingerprint?.slice(0, 8)}`;
  });

  fs.rmSync(TMP, { recursive: true, force: true });

  // ---- report ---------------------------------------------------------------------------
  const tally = (set: string) => { const r = results.filter((x) => x.set === set); return { total: r.length, pass: r.filter((x) => x.outcome === "PASS").length, fail: r.filter((x) => x.outcome === "FAIL").length, missing: r.filter((x) => x.outcome === "MISSING").length }; };
  const summary = { suite: "ayas-graphify-integration", graphifyCli: CLI_COMMANDS ? "available" : "unavailable", primary: tally("primary"), heldOut: tally("held-out") };
  if (process.argv.includes("--json")) console.log(JSON.stringify({ ...summary, results }, null, 1));
  else {
    for (const r of results) console.log(`${r.outcome.padEnd(7)} ${r.id} ${r.name}${r.detail ? `  — ${r.detail}` : ""}`);
    console.log(JSON.stringify(summary));
  }
  const allPass = results.every((r) => r.outcome === "PASS");
  if (allPass) console.log(`AYAS Graphify integration evaluation: PASS (${results.length} scenarios)`);
  if (process.argv.includes("--gate") && !allPass) process.exit(1);
}

main().catch((error: unknown) => { fs.rmSync(TMP, { recursive: true, force: true }); console.error(error); process.exit(1); });
