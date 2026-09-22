import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createAyasAutonomyDaemon } from "../src/lib/brain/autonomy/AyasAutonomyDaemon";
import { createAyasApprovalInboxStore } from "../src/lib/brain/autonomy/AyasApprovalInboxStore";
import { AyasExecutionGateStore } from "../src/lib/ayas/execution/AyasExecutionGateStore";

let count = 0;
function scenario(name: string, fn: () => void | Promise<void>) { return Promise.resolve(fn()).then(() => { count += 1; if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`); }); }
function root() { return fs.mkdtempSync(path.join(os.tmpdir(), "ayas-daemon-")); }
function git(rootDir: string, ...args: string[]) { return execFileSync("git", ["-C", rootDir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(); }
function candidate() { return { objective: "test-only bounded observability", currentProblem: "fixture misses one deterministic assertion", selectionReason: "the fixture evidence identifies this bounded gap", expectedUserBenefit: "the regression is caught before it reaches the user", expectedBehaviorChange: "the smoke test checks one additional invariant", unchangedBehavior: "production execution and user data do not change", riskIfNotDone: "the regression could remain unnoticed", technicalRisk: "low; one reversible assertion", productionImpact: "none until a separately authorized execution", rationale: "a deterministic smoke gap is visible", evidence: ["fixture evidence"], graphifyEvidence: ["fresh structural graph"], exactFiles: ["scripts/smoke-fixture.ts"], expectedDiffScope: "+1 assertion", testsPlanned: ["smoke-ayas-autonomy-daemon"], risk: "low and reversible", rank: 1, mutationKind: "test-fixture-mutation" }; }

async function main() {
  await scenario("default observation is read-only and dirty repositories pause", () => {
    const inbox = createAyasApprovalInboxStore({ rootDir: root() });
    const daemon = createAyasAutonomyDaemon({ inbox, now: () => "2026-09-15T12:00:00.000Z" });
    assert.equal(daemon.state.phase, "STARTING");
    daemon.observe({ now: "2026-09-15T12:00:00.000Z", branch: "wip/test", head: "abc", repoClean: false, graphifyFresh: true, machineAction: "ALLOW", gaps: [] });
    assert.equal(daemon.state.phase, "PAUSED_DIRTY_REPO");
    assert.equal(inbox.load().proposals.length, 0);
  });
  await scenario("machine pause prevents discovery", () => {
    const daemon = createAyasAutonomyDaemon({ inbox: createAyasApprovalInboxStore({ rootDir: root() }) });
    const observation = { now: "2026-09-15T12:00:00.000Z", branch: "wip/test", head: "abc", repoClean: true, graphifyFresh: true, machineAction: "PAUSE" as const, gaps: [] };
    daemon.observe(observation);
    assert.equal(daemon.discover(observation, [candidate()]).length, 0);
  });
  await scenario("stale Graphify never promotes a candidate into a new owner-actionable PENDING proposal", () => {
    const inbox = createAyasApprovalInboxStore({ rootDir: root() });
    const daemon = createAyasAutonomyDaemon({ inbox });
    const staleObservation = { now: "2026-09-15T12:00:00.000Z", branch: "wip/test", head: "new-head", repoClean: true, graphifyFresh: false, machineAction: "ALLOW" as const, gaps: [] };
    assert.deepEqual(daemon.discover(staleObservation, [candidate()]), []);
    assert.equal(inbox.load().proposals.length, 0, "artifact discovery is not proposal promotion while Graphify is stale");
    const freshObservation = { ...staleObservation, graphifyFresh: true };
    assert.equal(daemon.discover(freshObservation, [candidate()])[0]?.status, "PENDING");
  });
  await scenario("safe candidate becomes one durable pending proposal", () => {
    const daemon = createAyasAutonomyDaemon({ inbox: createAyasApprovalInboxStore({ rootDir: root() }) });
    const observation = { now: "2026-09-15T12:00:00.000Z", branch: "wip/test", head: "abc", repoClean: true, graphifyFresh: true, machineAction: "ALLOW" as const, gaps: [] };
    const proposals = daemon.discover(observation, [candidate(), candidate()]);
    assert.equal(proposals.length, 1);
    assert.equal(proposals[0]?.status, "PENDING");
  });
  await scenario("reject and defer persist distinct decisions", () => {
    const inbox = createAyasApprovalInboxStore({ rootDir: root() });
    const daemon = createAyasAutonomyDaemon({ inbox });
    const observation = { now: "2026-09-15T12:00:00.000Z", branch: "wip/test", head: "abc", repoClean: true, graphifyFresh: true, machineAction: "ALLOW" as const, gaps: [] };
    const [proposal] = daemon.discover(observation, [candidate()]);
    assert.ok(proposal);
    daemon.decide(proposal.proposalId, "REJECT", "not now");
    assert.equal(inbox.load().proposals[0]?.status, "REJECTED");
    const later = inbox.createProposal({ ...candidate(), objective: "another bounded observation", createdAt: observation.now, baseBranch: observation.branch, baseHead: observation.head, estimatedCost: "zero-cost", safetyClassification: "SAFE", candidateRank: 2 });
    daemon.decide(later.proposalId, "LATER");
    assert.equal(inbox.load().proposals.find((p) => p.proposalId === later.proposalId)?.status, "DEFERRED");
  });
  await scenario("approval binds hash, HEAD and exact files and is one-shot", () => {
    const inbox = createAyasApprovalInboxStore({ rootDir: root() });
    const daemon = createAyasAutonomyDaemon({ inbox });
    const observation = { now: "2026-09-15T12:00:00.000Z", branch: "wip/test", head: "abc", repoClean: true, graphifyFresh: true, machineAction: "ALLOW" as const, gaps: [] };
    const [proposal] = daemon.discover(observation, [candidate()]);
    assert.ok(proposal);
    daemon.decide(proposal.proposalId, "APPROVE");
    assert.throws(() => inbox.consumeApproval(proposal.proposalId, proposal.proposalHash, "wrong", proposal.exactFiles, observation.now));
    assert.throws(() => inbox.consumeApproval(proposal.proposalId, proposal.proposalHash, proposal.baseHead, ["scripts/other.ts"], observation.now));
    const consumed = inbox.consumeApproval(proposal.proposalId, proposal.proposalHash, proposal.baseHead, proposal.exactFiles, observation.now);
    assert.ok(consumed.authorizationConsumedAt);
    assert.throws(() => inbox.consumeApproval(proposal.proposalId, proposal.proposalHash, proposal.baseHead, proposal.exactFiles, observation.now));
  });
  await scenario("actual approved mutation runs only while isolated development gate is EXECUTING", async () => {
    const workspace = root();
    git(workspace, "init", "-q"); git(workspace, "config", "user.email", "smoke@example.invalid"); git(workspace, "config", "user.name", "Smoke");
    fs.mkdirSync(path.join(workspace, "scripts")); const changed = path.join(workspace, "scripts", "smoke-fixture.ts"); fs.writeFileSync(changed, "export const base = true;\n"); git(workspace, "add", "scripts/smoke-fixture.ts"); git(workspace, "commit", "-qm", "base");
    const gateRoot = root();
    const inbox = createAyasApprovalInboxStore({ rootDir: root() });
    const daemon = createAyasAutonomyDaemon({ inbox, gateRoot, repoRoot: workspace, now: () => "2026-09-15T12:00:00.000Z" });
    const observation = { now: "2026-09-15T12:00:00.000Z", branch: "wip/test", head: git(workspace, "rev-parse", "HEAD"), repoClean: true, graphifyFresh: true, machineAction: "ALLOW" as const, gaps: [] };
    const [proposal] = daemon.discover(observation, [candidate()]);
    assert.ok(proposal);
    daemon.decide(proposal.proposalId, "APPROVE");
    const result = await daemon.executeApproved({ proposalId: proposal.proposalId, proposalHash: proposal.proposalHash, baseHead: proposal.baseHead, currentHead: proposal.baseHead, exactFiles: proposal.exactFiles, currentExactFiles: proposal.exactFiles, repoClean: true, applyWhileExecuting: async () => { assert.equal(new AyasExecutionGateStore({ rootDir: gateRoot }).read().state, "EXECUTING"); fs.writeFileSync(changed, "approved\n"); return { changedFiles: proposal.exactFiles, diffFingerprint: "fixture-diff", testsRun: ["fixture"], testResults: ["PASS"] }; } });
    assert.equal(result.status, "COMPLETED");
    assert.equal(fs.readFileSync(changed, "utf8"), "approved\n");
    assert.equal(new AyasExecutionGateStore({ rootDir: gateRoot }).read().state, "CLOSED");
    assert.equal(inbox.load().results[0]?.outcome, "COMPLETED");
  });
  await scenario("restart preserves pending approval and corrupt daemon state fails loudly", () => {
    const workspace = root();
    const inbox = createAyasApprovalInboxStore({ rootDir: workspace });
    const stateFile = path.join(workspace, "daemon-state.json");
    const daemon = createAyasAutonomyDaemon({ inbox, stateFile, now: () => "2026-09-15T12:00:00.000Z" });
    const observation = { now: "2026-09-15T12:00:00.000Z", branch: "wip/test", head: "abc", repoClean: true, graphifyFresh: true, machineAction: "ALLOW" as const, gaps: [] };
    const [proposal] = daemon.discover(observation, [candidate()]);
    assert.ok(proposal);
    assert.equal(createAyasAutonomyDaemon({ inbox, stateFile }).state.phase, "WAITING_APPROVAL");
    fs.writeFileSync(stateFile, "broken");
    assert.throws(() => createAyasAutonomyDaemon({ inbox, stateFile }));
  });
  await scenario("no approval or production authority path is hidden in the daemon runner", () => {
    const runner = fs.readFileSync(path.join(process.cwd(), "scripts", "ayas-autonomy-daemon.ts"), "utf8");
    assert.doesNotMatch(runner, /git\s+(add|commit|push)|production:acceptance:(execute|resume)|writeFileSync\([^)]*data[\\/]projects/i);
    assert.equal(new AyasExecutionGateStore().readStateFailClosed().state, "CLOSED");
  });
  console.log(`AYAS autonomy daemon smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-autonomy-daemon", scenarios: count }));
}
main().catch((error) => { console.error("AYAS autonomy daemon smoke FAILED:", error); process.exitCode = 1; });
