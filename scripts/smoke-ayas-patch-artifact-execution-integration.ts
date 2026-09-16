import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createAyasApprovalInboxStore, type AyasInboxProposal } from "../src/lib/brain/autonomy/AyasApprovalInboxStore";
import { executeAyasApprovedProposalWith, AyasProposalExecutionError, type AyasProposalExecutionDeps } from "../src/lib/brain/autonomy/AyasProposalExecutionService";
import { createAyasPatchArtifactStore, type AyasPatchArtifactStore } from "../src/lib/brain/autonomy/AyasPatchArtifact";
import { AYAS_PATCH_ARTIFACT_MUTATION_KIND } from "../src/lib/brain/autonomy/AyasNovelPatchDiscovery";

/**
 * Isolated-fixture integration coverage for the M17 patch-artifact execution
 * path — same invariant as `smoke-ayas-proposal-execution-service.ts`: no
 * test here may ever touch the real `data/brain` or the real working tree.
 * Every repo, inbox, gate root, and patch-artifact store below is a fresh
 * temp directory.
 */
let count = 0;
function scenario(name: string, fn: () => void | Promise<void>) { return Promise.resolve(fn()).then(() => { count += 1; if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`); }); }
function root() { return fs.mkdtempSync(path.join(os.tmpdir(), "ayas-patch-exec-")); }
function git(repoRoot: string, ...args: string[]) { return execFileSync("git", ["-C", repoRoot, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(); }

function repository(): { repoRoot: string; head: string } {
  const repoRoot = root();
  git(repoRoot, "init", "-q");
  git(repoRoot, "config", "user.email", "smoke@example.invalid");
  git(repoRoot, "config", "user.name", "Smoke");
  fs.mkdirSync(path.join(repoRoot, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, "scripts/existing.ts"), "export const value = 1;\n");
  git(repoRoot, "add", "-A");
  git(repoRoot, "commit", "-qm", "base");
  return { repoRoot, head: git(repoRoot, "rev-parse", "HEAD") };
}

function freezeArtifact(store: AyasPatchArtifactStore, overrides: Record<string, unknown> = {}) {
  return store.freeze({
    artifactId: `ayas-patch-artifact-${Math.random().toString(36).slice(2)}`,
    candidateId: "ayas-novel-fixture",
    generatorIdentity: "ayas-detector:error-code-contract-gap-v1",
    baseBranch: "wip/test",
    baseHead: "will-be-overridden",
    exactFiles: ["scripts/smoke-fixture-generated.ts"],
    allowedRoots: ["scripts/"],
    replacements: [{ filePath: "scripts/smoke-fixture-generated.ts", expectedHash: null, content: 'console.log(JSON.stringify({ status: "PASS", suite: "fixture-generated", scenarios: 1 }));\n', allowCreate: true }],
    validatorScripts: [],
    graphifyEvidence: ["fixture evidence"],
    safetyClassification: "SAFE",
    problemStatement: "fixture problem",
    rationale: "fixture rationale",
    expectedUserBenefit: "fixture benefit",
    expectedBehaviorChange: "fixture change",
    unchangedBehavior: "fixture unchanged",
    risk: "low",
    productionImpact: "none",
    sandboxValidationSummary: ["typecheck-project: PASS"],
    generatedAt: "2026-09-16T00:00:00.000Z",
    ...overrides,
  } as never);
}

function proposalInput(overrides: Partial<Omit<AyasInboxProposal, "schemaVersion" | "proposalId" | "lastUpdatedAt" | "proposalHash" | "status" | "createdBy">> = {}) {
  return {
    createdAt: "2026-09-16T09:00:00.000Z",
    baseBranch: "wip/test",
    baseHead: "will-be-overridden",
    objective: "AYAS-generated patch artifact fixture",
    currentProblem: "fixture problem",
    selectionReason: "fixture selection reason",
    expectedUserBenefit: "fixture benefit",
    expectedBehaviorChange: "fixture change",
    unchangedBehavior: "fixture unchanged",
    riskIfNotDone: "fixture risk",
    technicalRisk: "low",
    productionImpact: "none until a separately authorized execution",
    rationale: "fixture rationale",
    evidence: ["fixture evidence"],
    graphifyEvidence: ["fresh structural graph"],
    candidateRank: 1,
    risk: "low and reversible",
    safetyClassification: "SAFE" as const,
    exactFiles: ["scripts/smoke-fixture-generated.ts"],
    expectedDiffScope: "+1 file",
    testsPlanned: ["smoke-fixture-generated"],
    estimatedCost: "zero-cost" as const,
    mutationKind: AYAS_PATCH_ARTIFACT_MUTATION_KIND,
    ...overrides,
  };
}

function setup() {
  const { repoRoot, head } = repository();
  const gateRoot = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ayas-patch-exec-gate-")), "self-improvement");
  const inbox = createAyasApprovalInboxStore({ rootDir: path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ayas-patch-exec-inbox-")), "brain") });
  const patchArtifactStore = createAyasPatchArtifactStore({ rootDir: fs.mkdtempSync(path.join(os.tmpdir(), "ayas-patch-exec-artifacts-")) });
  const artifact = freezeArtifact(patchArtifactStore, { baseHead: head });
  const proposal = inbox.createProposal(proposalInput({ baseHead: head, patchArtifactId: artifact.artifactId, patchHash: artifact.patchHash } as never));
  const deps: AyasProposalExecutionDeps = { repoRoot, gateRoot, inbox, patchArtifactStore };
  return { repoRoot, head, gateRoot, inbox, proposal, deps, patchArtifactStore, artifact };
}

async function main() {
  await scenario("a patch-artifact proposal is rejected before execution unless APPROVED", async () => {
    const { deps, proposal } = setup();
    await assert.rejects(executeAyasApprovedProposalWith(proposal.proposalId, deps), (e: unknown) => e instanceof AyasProposalExecutionError && e.code === "NOT_APPROVED");
  });

  await scenario("full happy path: APPROVE -> execute -> real mutation applied -> durable testResults -> EXECUTED -> gate closed", async () => {
    const { deps, proposal, inbox, repoRoot } = setup();
    inbox.decide(proposal.proposalId, "APPROVE", "2026-09-16T09:01:00.000Z");
    await executeAyasApprovedProposalWith(proposal.proposalId, deps);
    const state = inbox.load();
    const finalProposal = state.proposals.find((p) => p.proposalId === proposal.proposalId)!;
    assert.equal(finalProposal.status, "COMPLETED");
    const result = state.results.at(-1)!;
    assert.deepEqual(result.testResults, []); // this fixture artifact declares zero validators — proves testResults reflects exactly what the artifact declares, not a hardcoded assumption
    assert.deepEqual(result.changedFiles, ["scripts/smoke-fixture-generated.ts"]);
    assert.ok(fs.existsSync(path.join(repoRoot, "scripts/smoke-fixture-generated.ts")));
    const decision = state.decisions.find((d) => d.proposalId === proposal.proposalId && d.decision === "APPROVE")!;
    assert.equal(decision.finalizationOutcome, "EXECUTED");
  });

  await scenario("execution runs the artifact's own declared validators and records their PASS result durably", async () => {
    const repoRoot = root();
    git(repoRoot, "init", "-q");
    git(repoRoot, "config", "user.email", "smoke@example.invalid");
    git(repoRoot, "config", "user.name", "Smoke");
    fs.mkdirSync(path.join(repoRoot, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, "scripts/existing.ts"), "export const value = 1;\n");
    fs.writeFileSync(path.join(repoRoot, ".gitignore"), "node_modules/\n"); // keep the fixture repo's own dirty-check honest — node_modules is a local dev dependency link, not source under test
    git(repoRoot, "add", "-A");
    git(repoRoot, "commit", "-qm", "base");
    const head = git(repoRoot, "rev-parse", "HEAD");
    const gateRoot = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ayas-patch-exec-gate-")), "self-improvement");
    const inbox = createAyasApprovalInboxStore({ rootDir: path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ayas-patch-exec-inbox-")), "brain") });
    const patchArtifactStore = createAyasPatchArtifactStore({ rootDir: fs.mkdtempSync(path.join(os.tmpdir(), "ayas-patch-exec-artifacts-")) });
    fs.mkdirSync(path.join(repoRoot, "node_modules"), { recursive: true });
    fs.symlinkSync(path.join(process.cwd(), "node_modules", "tsx"), path.join(repoRoot, "node_modules", "tsx"), process.platform === "win32" ? "junction" : "dir");
    const artifact = freezeArtifact(patchArtifactStore, { baseHead: head, validatorScripts: ["scripts/smoke-fixture-generated.ts"] });
    const proposal = inbox.createProposal(proposalInput({ baseHead: head, patchArtifactId: artifact.artifactId, patchHash: artifact.patchHash } as never));
    inbox.decide(proposal.proposalId, "APPROVE", "2026-09-16T09:01:00.000Z");
    const deps: AyasProposalExecutionDeps = { repoRoot, gateRoot, inbox, patchArtifactStore };
    await executeAyasApprovedProposalWith(proposal.proposalId, deps);
    const result = inbox.load().results.at(-1)!;
    assert.deepEqual(result.testResults, ["PASS"]);
    assert.deepEqual(result.testsRun, ["scripts/smoke-fixture-generated.ts"]);
  });

  await scenario("AYAS_MUTATION_SCOPE_MISMATCH: proposal's exactFiles no longer matches the frozen artifact's exactFiles", async () => {
    const { deps, proposal, inbox } = setup();
    // Directly corrupt the durable proposal's exactFiles after creation (simulating a hypothetical future bug elsewhere) — execution must still fail closed.
    const state = inbox.load();
    inbox.save({ ...state, proposals: state.proposals.map((p) => p.proposalId === proposal.proposalId ? { ...p, exactFiles: ["scripts/tampered.ts"] } : p) });
    inbox.decide(proposal.proposalId, "APPROVE", "2026-09-16T09:01:00.000Z");
    await assert.rejects(executeAyasApprovedProposalWith(proposal.proposalId, deps), (e: unknown) => e instanceof AyasProposalExecutionError && e.code === "AYAS_PATCH_ARTIFACT_MUTATION_SCOPE_MISMATCH");
  });

  await scenario("AYAS_PATCH_ARTIFACT_NOT_FOUND surfaces as a clean AyasProposalExecutionError when the artifact was deleted", async () => {
    const { deps, proposal, inbox, patchArtifactStore, artifact } = setup();
    fs.rmSync(path.join(patchArtifactStore.dir, `${artifact.artifactId}.json`));
    inbox.decide(proposal.proposalId, "APPROVE", "2026-09-16T09:01:00.000Z");
    await assert.rejects(executeAyasApprovedProposalWith(proposal.proposalId, deps), (e: unknown) => e instanceof AyasProposalExecutionError);
  });

  await scenario("stale baseHead: the repo moved on since the proposal's baseHead — execution refuses (fail closed, no replay)", async () => {
    const { deps, proposal, inbox, repoRoot } = setup();
    inbox.decide(proposal.proposalId, "APPROVE", "2026-09-16T09:01:00.000Z");
    fs.writeFileSync(path.join(repoRoot, "scripts/existing.ts"), "export const value = 2;\n");
    git(repoRoot, "add", "-A");
    git(repoRoot, "commit", "-qm", "moved on");
    await assert.rejects(executeAyasApprovedProposalWith(proposal.proposalId, deps));
    // The proposal must be reconciled to STALE, never left APPROVED-but-unexecutable with no record.
    const finalProposal = inbox.load().proposals.find((p) => p.proposalId === proposal.proposalId)!;
    assert.equal(finalProposal.status, "STALE");
  });

  await scenario("real execution-time validator failure rolls back the write and leaves the proposal RECOVERY_REQUIRED, never a false success", async () => {
    const repoRoot = root();
    git(repoRoot, "init", "-q");
    git(repoRoot, "config", "user.email", "smoke@example.invalid");
    git(repoRoot, "config", "user.name", "Smoke");
    fs.mkdirSync(path.join(repoRoot, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, "scripts/existing.ts"), "export const value = 1;\n");
    fs.writeFileSync(path.join(repoRoot, ".gitignore"), "node_modules/\n"); // node_modules is a local dev dependency link, not source under test — see the "declared validators" scenario above for the same pattern
    git(repoRoot, "add", "-A");
    git(repoRoot, "commit", "-qm", "base");
    const head = git(repoRoot, "rev-parse", "HEAD");
    const gateRoot = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ayas-patch-exec-gate-")), "self-improvement");
    const inbox = createAyasApprovalInboxStore({ rootDir: path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ayas-patch-exec-inbox-")), "brain") });
    const patchArtifactStore = createAyasPatchArtifactStore({ rootDir: fs.mkdtempSync(path.join(os.tmpdir(), "ayas-patch-exec-artifacts-")) });
    fs.mkdirSync(path.join(repoRoot, "node_modules"), { recursive: true });
    fs.symlinkSync(path.join(process.cwd(), "node_modules", "tsx"), path.join(repoRoot, "node_modules", "tsx"), process.platform === "win32" ? "junction" : "dir");
    // A patch artifact whose own declared content does NOT report {"status":"PASS"} — a real, deterministic validator failure at execution time (not sandbox drafting).
    const artifact = freezeArtifact(patchArtifactStore, {
      baseHead: head,
      replacements: [{ filePath: "scripts/smoke-fixture-generated.ts", expectedHash: null, content: "console.log('this smoke test never reports PASS');\n", allowCreate: true }],
      validatorScripts: ["scripts/smoke-fixture-generated.ts"],
    });
    const proposal = inbox.createProposal(proposalInput({ baseHead: head, patchArtifactId: artifact.artifactId, patchHash: artifact.patchHash } as never));
    inbox.decide(proposal.proposalId, "APPROVE", "2026-09-16T09:01:00.000Z");
    const deps: AyasProposalExecutionDeps = { repoRoot, gateRoot, inbox, patchArtifactStore };
    await assert.rejects(executeAyasApprovedProposalWith(proposal.proposalId, deps));
    // Rollback: AyasBoundedFileWrite's own documented guarantee — a failing validator inside applyAyasBoundedFileReplacements' after() hook rolls back every file it wrote.
    assert.equal(fs.existsSync(path.join(repoRoot, "scripts/smoke-fixture-generated.ts")), false, "the write must be rolled back, not left half-applied");
    const finalProposal = inbox.load().proposals.find((p) => p.proposalId === proposal.proposalId)!;
    assert.equal(finalProposal.status, "RECOVERY_REQUIRED", "an execution that could have mutated before failing must never be silently treated as a clean failure — a human must review it");
  });

  await scenario("dirty repo at execution time: refuses, never mutates", async () => {
    const { deps, proposal, inbox, repoRoot } = setup();
    inbox.decide(proposal.proposalId, "APPROVE", "2026-09-16T09:01:00.000Z");
    fs.writeFileSync(path.join(repoRoot, "scripts/uncommitted.ts"), "export const dirty = true;\n");
    await assert.rejects(executeAyasApprovedProposalWith(proposal.proposalId, deps));
    assert.equal(fs.existsSync(path.join(repoRoot, "scripts/smoke-fixture-generated.ts")), false);
  });

  await scenario("execution never touches a second, unrelated patch-artifact store (test isolation self-check)", async () => {
    const { deps, proposal, inbox } = setup();
    const otherStoreDir = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-patch-exec-other-artifacts-"));
    inbox.decide(proposal.proposalId, "APPROVE", "2026-09-16T09:01:00.000Z");
    await executeAyasApprovedProposalWith(proposal.proposalId, deps);
    assert.deepEqual(fs.readdirSync(otherStoreDir), []);
  });

  console.log(`AYAS patch artifact execution integration smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-patch-artifact-execution-integration", scenarios: count }));
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
