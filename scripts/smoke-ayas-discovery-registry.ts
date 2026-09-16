import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { discoverAyasSafeCandidates, AYAS_DISCOVERY_SOURCES, type AyasDiscoverySource } from "../src/lib/brain/autonomy/AyasDiscoveryRegistry";
import { createAyasApprovalInboxStore } from "../src/lib/brain/autonomy/AyasApprovalInboxStore";
import type { AyasDaemonCandidate, AyasDaemonObservation } from "../src/lib/brain/autonomy/AyasAutonomyDaemon";
import type { AyasMutationImplementation } from "../src/lib/brain/autonomy/AyasMutationRegistry";

let count = 0;
function scenario(name: string, fn: () => void | Promise<void>) { return Promise.resolve(fn()).then(() => { count += 1; if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`); }); }
function read(relPath: string): string { return fs.readFileSync(path.join(process.cwd(), relPath), "utf8"); }

function observation(overrides: Partial<AyasDaemonObservation> = {}): AyasDaemonObservation {
  return { now: "2026-09-16T12:00:00.000Z", branch: "wip/test", head: "abc123", repoClean: true, graphifyFresh: true, machineAction: "ALLOW", gaps: [], ...overrides };
}

function candidate(overrides: Partial<AyasDaemonCandidate> = {}): AyasDaemonCandidate {
  return {
    objective: "fixture objective",
    currentProblem: "fixture problem",
    selectionReason: "fixture reason",
    expectedUserBenefit: "fixture benefit",
    expectedBehaviorChange: "fixture change",
    unchangedBehavior: "fixture unchanged",
    riskIfNotDone: "fixture risk",
    technicalRisk: "fixture technical risk",
    productionImpact: "none",
    rationale: "fixture rationale",
    evidence: ["fixture evidence"],
    graphifyEvidence: ["fixture graphify evidence"],
    exactFiles: ["scripts/smoke-fixture.ts"],
    expectedDiffScope: "+1 line",
    testsPlanned: ["fixture"],
    risk: "low",
    rank: 1,
    mutationKind: "fixture-registered-kind",
    ...overrides,
  };
}

const registeredRegistry = new Map<string, AyasMutationImplementation>([["fixture-registered-kind", { exactFiles: ["scripts/smoke-fixture.ts"], run: async () => ({ changedFiles: [], testsRun: [], testResults: [] }) }]]);

function git(repoRoot: string, ...args: string[]) { return execFileSync("git", ["-C", repoRoot, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(); }

function fixtureRepo(): { readonly repoRoot: string; readonly head: string } {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-discovery-daemon-"));
  git(repoRoot, "init", "-q");
  git(repoRoot, "config", "user.email", "smoke@example.invalid");
  git(repoRoot, "config", "user.name", "Smoke");
  fs.writeFileSync(path.join(repoRoot, "fixture.txt"), "fixture\n");
  git(repoRoot, "add", "fixture.txt");
  git(repoRoot, "commit", "-qm", "base");
  return { repoRoot, head: git(repoRoot, "rev-parse", "HEAD") };
}

function staleProposalInput(baseHead: string) {
  return {
    createdAt: "2026-09-16T09:00:00.000Z",
    baseBranch: "wip/test",
    baseHead,
    objective: "fixture objective",
    currentProblem: "fixture problem",
    selectionReason: "fixture reason",
    expectedUserBenefit: "fixture benefit",
    expectedBehaviorChange: "fixture change",
    unchangedBehavior: "fixture unchanged",
    riskIfNotDone: "fixture risk",
    technicalRisk: "fixture technical risk",
    productionImpact: "none",
    rationale: "fixture rationale",
    evidence: ["fixture evidence"],
    graphifyEvidence: ["fixture graphify evidence"],
    candidateRank: 1,
    risk: "low",
    safetyClassification: "SAFE" as const,
    exactFiles: ["scripts/smoke-fixture.ts"],
    expectedDiffScope: "+1 line",
    testsPlanned: ["fixture"],
    estimatedCost: "zero-cost" as const,
    mutationKind: "fixture-registered-kind",
  };
}

async function main() {
  await scenario("the real, production AYAS_DISCOVERY_SOURCES registry is empty at M16 (mechanism ships before any real candidate)", () => {
    assert.deepEqual(AYAS_DISCOVERY_SOURCES, []);
  });
  await scenario("an applicable source naming a registered mutationKind is returned", () => {
    const sources: readonly AyasDiscoverySource[] = [{ candidate: candidate(), isApplicable: () => true }];
    const result = discoverAyasSafeCandidates({ repoRoot: "/fixture", observation: observation() }, sources, registeredRegistry);
    assert.equal(result.length, 1);
    assert.equal(result[0]?.mutationKind, "fixture-registered-kind");
  });
  await scenario("a source whose detector returns false is excluded", () => {
    const sources: readonly AyasDiscoverySource[] = [{ candidate: candidate(), isApplicable: () => false }];
    const result = discoverAyasSafeCandidates({ repoRoot: "/fixture", observation: observation() }, sources, registeredRegistry);
    assert.deepEqual(result, []);
  });
  await scenario("a source whose detector throws is treated as not applicable (fail closed, not fail open)", () => {
    const sources: readonly AyasDiscoverySource[] = [{ candidate: candidate(), isApplicable: () => { throw new Error("boom"); } }];
    const result = discoverAyasSafeCandidates({ repoRoot: "/fixture", observation: observation() }, sources, registeredRegistry);
    assert.deepEqual(result, []);
  });
  await scenario("a source naming an unregistered mutationKind is excluded even if its detector returns true", () => {
    const sources: readonly AyasDiscoverySource[] = [{ candidate: candidate({ mutationKind: "does-not-exist-anywhere" }), isApplicable: () => true }];
    const result = discoverAyasSafeCandidates({ repoRoot: "/fixture", observation: observation() }, sources, registeredRegistry);
    assert.deepEqual(result, []);
  });
  await scenario("a detector receives the exact repoRoot/observation it was given, and nothing else", () => {
    let seen: unknown;
    const obs = observation({ head: "specific-head-xyz" });
    const sources: readonly AyasDiscoverySource[] = [{ candidate: candidate(), isApplicable: (context) => { seen = context; return true; } }];
    discoverAyasSafeCandidates({ repoRoot: "/fixture-root", observation: obs }, sources, registeredRegistry);
    assert.deepEqual(seen, { repoRoot: "/fixture-root", observation: obs });
  });
  await scenario("multiple applicable sources are all returned, in declaration order", () => {
    const sources: readonly AyasDiscoverySource[] = [
      { candidate: candidate({ mutationKind: "fixture-registered-kind", objective: "first" }), isApplicable: () => true },
      { candidate: candidate({ mutationKind: "fixture-registered-kind", objective: "second" }), isApplicable: () => true },
    ];
    const result = discoverAyasSafeCandidates({ repoRoot: "/fixture", observation: observation() }, sources, registeredRegistry);
    assert.deepEqual(result.map((c) => c.objective), ["first", "second"]);
  });
  await scenario("with no sources argument, the function defaults to the real (currently empty) AYAS_DISCOVERY_SOURCES", () => {
    const result = discoverAyasSafeCandidates({ repoRoot: "/fixture", observation: observation() });
    assert.deepEqual(result, []);
  });

  await scenario("M16: AyasDiscoveryRegistry.ts imports no execution/gate/authority module (structurally cannot reserve, execute, decide, or open a gate)", () => {
    const src = read("src/lib/brain/autonomy/AyasDiscoveryRegistry.ts");
    const importLines = src.split("\n").filter((line) => /^\s*import\b/.test(line)).join("\n");
    assert.doesNotMatch(importLines, /AyasApprovalInboxStore|AyasExecutionGateStore|AyasExecutionAuthorityLock/, "the discovery registry must import no approval/execution authority module");
    assert.doesNotMatch(src, /\.decide\(|\breserveApproval\s*\(|\bexecuteApproved\s*\(|\.run\s*\(/, "the discovery registry must never decide, reserve, execute, or invoke a mutation's run()");
  });
  await scenario("M16: ayas-discovery-daemon.ts never decides, reserves, executes, or invokes a mutation's run()", () => {
    const src = read("scripts/ayas-discovery-daemon.ts");
    assert.doesNotMatch(src, /\.decide\(|\breserveApproval\s*\(|\bexecuteApproved\s*\(|AyasExecutionGateStore|AyasMutationRegistry|resolveAyasMutation/, "the discovery daemon must have no path to decide/reserve/execute/gate/mutation-run");
    assert.match(src, /reconcileAyasStaleProposals/, "the discovery daemon must reconcile staleness");
    assert.match(src, /discoverAyasSafeCandidates/, "the discovery daemon must use the closed discovery registry, not an ad-hoc candidate list");
    assert.match(src, /daemon\.discover\(/, "the discovery daemon must mint proposals only through the existing, canonical AyasAutonomyDaemon.discover()");
  });
  await scenario("M16: the always-on observer entrypoint (ayas-autonomy-daemon.ts) still has zero import of any approval/execution authority module — discovery is invoked only as a child process", () => {
    const src = read("scripts/ayas-autonomy-daemon.ts");
    assert.doesNotMatch(src, /AyasApprovalInboxStore|AyasAutonomyDaemon["']|AyasExecutionGateStore|reserveApproval|finalizeApproval|consumeApproval|executeApproved|\.decide\(/, "the always-on observer entrypoint must remain structurally incapable of touching approval/execution authority");
    assert.match(src, /ayas-discovery-daemon\.ts/, "the observer must spawn the discovery daemon as a separate script/process");
    assert.match(src, /execFileSync/, "the discovery daemon must be invoked as an arm's-length child process, never imported in-process");
  });
  await scenario("M16: package.json defines no second startup script — discovery is reached only via the existing observer entrypoint's own child-process spawn", () => {
    const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
    assert.equal(pkg.scripts["ayas:autonomy"], "tsx scripts/ayas-autonomy-daemon.ts", "the one continuous startup script must stay exactly as registered");
  });

  await scenario("M16 integration: actually spawning ayas-discovery-daemon.ts against an isolated fixture repo durably reconciles a real stale proposal to STALE (canonical-path proof of the reconciliation mechanism, using an isolated fixture rather than production state)", () => {
    const { repoRoot, head } = fixtureRepo();
    const inbox = createAyasApprovalInboxStore({ rootDir: path.join(repoRoot, "data", "brain") });
    const proposal = inbox.createProposal(staleProposalInput("a-head-that-no-longer-exists"));
    inbox.decide(proposal.proposalId, "APPROVE", "2026-09-16T09:01:00.000Z");
    assert.equal(inbox.load().proposals.find((p) => p.proposalId === proposal.proposalId)?.status, "APPROVED");

    const tsxCli = path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
    const script = path.join(process.cwd(), "scripts", "ayas-discovery-daemon.ts");
    const stdout = execFileSync(process.execPath, [tsxCli, script], { cwd: repoRoot, encoding: "utf8", windowsHide: true, timeout: 60_000, stdio: ["ignore", "pipe", "pipe"] });
    const result = JSON.parse(stdout.trim().split("\n").pop()!) as { status: string; head: string; staleReconciled: string[]; discovered: string[] };
    assert.equal(result.status, "OK");
    assert.equal(result.head, head);
    assert.deepEqual(result.staleReconciled, [proposal.proposalId]);
    assert.deepEqual(result.discovered, [], "the production discovery registry is empty at M16 — nothing should be discovered");

    const finalState = inbox.load();
    assert.equal(finalState.proposals.find((p) => p.proposalId === proposal.proposalId)?.status, "STALE", "the real spawned process must durably reconcile the fixture proposal, not just report it");
    fs.rmSync(repoRoot, { recursive: true, force: true });
  });

  console.log(`AYAS discovery registry smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-discovery-registry", scenarios: count }));
}
main().catch((error) => { console.error("AYAS discovery registry smoke FAILED:", error); process.exitCode = 1; });
