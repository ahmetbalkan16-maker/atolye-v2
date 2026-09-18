import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createAyasApprovalInboxStore } from "../src/lib/brain/autonomy/AyasApprovalInboxStore";
import { AYAS_PATCH_ARTIFACT_MUTATION_KIND } from "../src/lib/brain/autonomy/AyasNovelPatchDiscovery";

/**
 * Owner-approval model — daemon wiring. `scripts/ayas-discovery-daemon.ts`
 * now calls `AyasAutonomousReview.reviewAyasPendingProposals` once per tick.
 * That function DOES call `AyasApprovalInboxStore.decide()` — intentionally,
 * per this sprint's own brief ("the daemon should... internally REJECT bad
 * proposals... internally DEFER insufficient proposals"). A pre-existing
 * test (`smoke-ayas-discovery-registry.ts`, "M16: ayas-discovery-daemon.ts
 * never decides...") only checks THIS FILE's own source text for the
 * literal substring `.decide(` — it still passes (the daemon script itself
 * never writes that substring), but it no longer proves what its own
 * comment claims ("no path to decide" is no longer quite true — there is
 * one, deliberately, for REJECT/LATER only). This suite makes the real,
 * current boundary explicit and verified: the daemon's only path to
 * `.decide()` goes through `reviewAyasPendingProposals`, and THAT function
 * can never call APPROVE — so the daemon still has zero path to execution
 * authority, which is the property that actually matters.
 */
let count = 0;
async function scenario(name: string, fn: () => void | Promise<void>) { await fn(); count += 1; if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`); }
function git(repoRoot: string, ...args: string[]) { return execFileSync("git", ["-C", repoRoot, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(); }

function fixtureRepo(): { readonly repoRoot: string; readonly head: string } {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-owner-approval-daemon-"));
  git(repoRoot, "init", "-q");
  git(repoRoot, "config", "user.email", "smoke@example.invalid");
  git(repoRoot, "config", "user.name", "Smoke");
  git(repoRoot, "config", "core.autocrlf", "false");
  fs.writeFileSync(path.join(repoRoot, "fixture.txt"), "fixture\n");
  fs.mkdirSync(path.join(repoRoot, ".graphify"), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, ".graphify", "graph.json"), "{}\n");
  git(repoRoot, "add", "-A");
  git(repoRoot, "commit", "-q", "-m", "initial");
  const head = git(repoRoot, "rev-parse", "HEAD");
  return { repoRoot, head };
}

function proposalInput(head: string, overrides: Record<string, unknown> = {}) {
  return {
    createdAt: "2026-09-18T00:00:00.000Z",
    baseBranch: "master",
    baseHead: head,
    objective: "fixture objective",
    currentProblem: "fixture problem",
    selectionReason: "fixture selection reason",
    expectedUserBenefit: "a regression that would otherwise go unnoticed is now caught",
    expectedBehaviorChange: "fixture change",
    unchangedBehavior: "fixture unchanged",
    riskIfNotDone: "fixture risk",
    technicalRisk: "low",
    productionImpact: "none",
    rationale: "fixture rationale",
    evidence: ["fixture evidence"],
    graphifyEvidence: ["fixture graphify evidence"],
    candidateRank: 1,
    risk: "low and reversible",
    safetyClassification: "SAFE" as const,
    exactFiles: ["scripts/smoke-fixture-generated-owner-approval.ts"],
    expectedDiffScope: "+1 file",
    testsPlanned: ["smoke-fixture-generated-owner-approval"],
    estimatedCost: "zero-cost" as const,
    mutationKind: AYAS_PATCH_ARTIFACT_MUTATION_KIND,
    patchArtifactId: "ayas-patch-artifact-fixture",
    patchHash: "fixture-hash",
    ...overrides,
  };
}

async function main(): Promise<void> {
  const stripComments = (raw: string) => raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

  await scenario("AyasAutonomousReview.ts never calls decide(...) with APPROVE — its only reachable decisions are REJECT and LATER, never execution authority", () => {
    const code = stripComments(fs.readFileSync(path.join(process.cwd(), "src/lib/brain/autonomy/AyasAutonomousReview.ts"), "utf8"));
    assert.doesNotMatch(code, /"APPROVE"/, "AyasAutonomousReview.ts must never construct an APPROVE decision");
    assert.match(code, /"REJECT"/);
    assert.match(code, /"LATER"/);
    assert.doesNotMatch(code, /reserveApproval\s*\(|executeApproved\s*\(|AyasExecutionGateStore|AyasMutationRegistry|resolveAyasMutation/, "AyasAutonomousReview.ts must have no path to reservation/execution/gate/mutation-run");
  });

  await scenario("the discovery daemon's new owner-review wiring is present and still has zero direct import of execution authority", () => {
    const code = stripComments(fs.readFileSync(path.join(process.cwd(), "scripts/ayas-discovery-daemon.ts"), "utf8"));
    assert.match(code, /reviewAyasPendingProposals/, "the daemon must call the owner-approval internal review each tick");
    assert.doesNotMatch(code, /reserveApproval\s*\(|executeApproved\s*\(|AyasExecutionGateStore|AyasMutationRegistry|resolveAyasMutation/, "the daemon script itself must still have zero direct path to reservation/execution/gate/mutation-run");
  });

  await scenario("integration: a real spawned daemon tick internally REJECTs a FORBIDDEN_AUTONOMOUS candidate and DEFERs an insufficient-evidence one — durably, without executing or reserving anything", () => {
    const { repoRoot, head } = fixtureRepo();
    const inbox = createAyasApprovalInboxStore({ rootDir: path.join(repoRoot, "data", "brain") });
    const badProposal = inbox.createProposal(proposalInput(head, { safetyClassification: "FORBIDDEN_AUTONOMOUS", exactFiles: ["src/lib/ayas/execution/AyasExecutionGateStore.ts"], mutationKind: undefined, patchArtifactId: undefined, patchHash: undefined }) as never);
    const insufficientProposal = inbox.createProposal(proposalInput(head, { evidence: [], graphifyEvidence: [], objective: "fixture objective 2" }) as never);

    const tsxCli = path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
    const script = path.join(process.cwd(), "scripts", "ayas-discovery-daemon.ts");
    const stdout = execFileSync(process.execPath, [tsxCli, script], { cwd: repoRoot, encoding: "utf8", windowsHide: true, timeout: 60_000, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, AYAS_RESEARCH_SCHEDULER_ENABLED: "0" } });
    const result = JSON.parse(stdout.trim().split("\n").pop()!) as { status: string; ownerReviewRejected: string[]; ownerReviewDeferred: string[]; ownerReviewRecommended: string[] };
    assert.equal(result.status, "OK");
    assert.ok(result.ownerReviewRejected.includes(badProposal.proposalId), "the FORBIDDEN_AUTONOMOUS candidate must be internally rejected");
    assert.ok(result.ownerReviewDeferred.includes(insufficientProposal.proposalId), "the insufficient-evidence candidate must be internally deferred");
    assert.ok(!result.ownerReviewRecommended.includes(badProposal.proposalId) && !result.ownerReviewRecommended.includes(insufficientProposal.proposalId));

    const finalState = inbox.load();
    assert.equal(finalState.proposals.find((p) => p.proposalId === badProposal.proposalId)?.status, "REJECTED");
    assert.equal(finalState.proposals.find((p) => p.proposalId === insufficientProposal.proposalId)?.status, "DEFERRED");
    assert.equal(finalState.decisions.length, 2, "exactly the 2 durable decisions above — nothing else was decided");
    assert.equal(finalState.results.length, 0, "no execution result was ever recorded — the daemon never executed anything");
  });

  await scenario("integration: a real, valid, useful SAFE candidate seeded directly into the inbox is surfaced as a recommendation by the same tick, never auto-approved", () => {
    const { repoRoot, head } = fixtureRepo();
    const inbox = createAyasApprovalInboxStore({ rootDir: path.join(repoRoot, "data", "brain") });
    const goodProposal = inbox.createProposal(proposalInput(head, { objective: "fixture objective 3", exactFiles: ["scripts/smoke-fixture-generated-owner-approval-3.ts"] }) as never);

    const tsxCli = path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
    const script = path.join(process.cwd(), "scripts", "ayas-discovery-daemon.ts");
    const stdout = execFileSync(process.execPath, [tsxCli, script], { cwd: repoRoot, encoding: "utf8", windowsHide: true, timeout: 60_000, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, AYAS_RESEARCH_SCHEDULER_ENABLED: "0" } });
    const result = JSON.parse(stdout.trim().split("\n").pop()!) as { status: string; ownerReviewRecommended: string[] };
    assert.equal(result.status, "OK");
    assert.ok(result.ownerReviewRecommended.includes(goodProposal.proposalId));

    const finalState = inbox.load();
    assert.equal(finalState.proposals.find((p) => p.proposalId === goodProposal.proposalId)?.status, "PENDING", "a recommended proposal stays PENDING — the daemon never auto-approves");
    assert.equal(finalState.decisions.length, 0, "no decision was recorded for the recommended proposal");
  });

  await scenario("31. a duplicate daemon tick is idempotent: re-running against already-REJECTED/DEFERRED proposals records no new decisions and does not flip them back to PENDING", () => {
    const { repoRoot, head } = fixtureRepo();
    const inbox = createAyasApprovalInboxStore({ rootDir: path.join(repoRoot, "data", "brain") });
    const badProposal = inbox.createProposal(proposalInput(head, { safetyClassification: "FORBIDDEN_AUTONOMOUS", exactFiles: ["src/lib/ayas/execution/AyasExecutionGateStore.ts"], mutationKind: undefined, patchArtifactId: undefined, patchHash: undefined }) as never);
    const insufficientProposal = inbox.createProposal(proposalInput(head, { evidence: [], graphifyEvidence: [], objective: "fixture objective 4" }) as never);

    const tsxCli = path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
    const script = path.join(process.cwd(), "scripts", "ayas-discovery-daemon.ts");
    const runTick = () => JSON.parse(execFileSync(process.execPath, [tsxCli, script], { cwd: repoRoot, encoding: "utf8", windowsHide: true, timeout: 60_000, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, AYAS_RESEARCH_SCHEDULER_ENABLED: "0" } }).trim().split("\n").pop()!) as { status: string };

    const first = runTick();
    assert.equal(first.status, "OK");
    const afterFirst = inbox.load();
    assert.equal(afterFirst.decisions.length, 2);

    const second = runTick();
    assert.equal(second.status, "OK");
    const afterSecond = inbox.load();
    // Both proposals are terminal (REJECTED/DEFERRED-but-not-yet-eligible) —
    // `AyasApprovalInboxStore.decide()`'s own `decidable` guard only accepts
    // a PENDING proposal (or an eligible DEFERRED one), so a second tick
    // re-evaluating the same durable state must produce zero new decisions,
    // not a duplicate REJECT/LATER record and not a flip back to PENDING.
    assert.equal(afterSecond.decisions.length, 2, "a second tick over unchanged, already-decided proposals must record no new decisions");
    assert.equal(afterSecond.proposals.find((p) => p.proposalId === badProposal.proposalId)?.status, "REJECTED");
    assert.equal(afterSecond.proposals.find((p) => p.proposalId === insufficientProposal.proposalId)?.status, "DEFERRED");
  });

  console.log(`AYAS owner-approval daemon integration smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-owner-approval-daemon-integration", scenarios: count }));
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
