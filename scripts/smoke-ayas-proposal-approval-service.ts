import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { approveAndExecuteAyasProposal, publishAlreadyOwnerApprovedAyasProposal, AyasProposalApprovalError } from "../src/lib/brain/autonomy/AyasProposalApprovalService";
import { createAyasApprovalInboxStore, type AyasApprovalInboxHandle, type AyasInboxProposal } from "../src/lib/brain/autonomy/AyasApprovalInboxStore";
import { createAyasPatchArtifactStore, type AyasPatchArtifactStore } from "../src/lib/brain/autonomy/AyasPatchArtifact";
import { AYAS_PATCH_ARTIFACT_MUTATION_KIND } from "../src/lib/brain/autonomy/AyasNovelPatchDiscovery";

/**
 * M20.7 — "ONAYLA VE UYGULA" for an individual patch-artifact-backed
 * proposal. Same real-fixture-repo + real-bare-remote posture as
 * `smoke-ayas-micro-batch-approval-service.ts` (never the real Atölye repo,
 * never a network remote, push behavior exercised against real Git).
 */
let count = 0;
function scenario(name: string, fn: () => void | Promise<void>) { return Promise.resolve(fn()).then(() => { count += 1; if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`); }); }
function root() { return fs.mkdtempSync(path.join(os.tmpdir(), "ayas-proposal-approval-")); }
function git(cwd: string, ...args: string[]) { return execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true }).trim(); }

interface Fixture {
  readonly repoRoot: string;
  readonly remoteDir: string;
  readonly gateRoot: string;
  readonly inbox: AyasApprovalInboxHandle;
  readonly artifactStore: AyasPatchArtifactStore;
}

function makeFixture(): Fixture {
  const remoteDir = root();
  git(remoteDir, "init", "-q", "--bare");

  const repoRoot = root();
  git(repoRoot, "init", "-q");
  git(repoRoot, "config", "user.email", "f@example.com");
  git(repoRoot, "config", "user.name", "f");
  fs.mkdirSync(path.join(repoRoot, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, "scripts", "existing.ts"), "export const existing = 1;\n");
  fs.writeFileSync(path.join(repoRoot, ".gitignore"), "node_modules/\n.graphify/\nscripts/.graphify/\n");
  fs.writeFileSync(
    path.join(repoRoot, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { target: "ES2020", module: "commonjs", moduleResolution: "node", esModuleInterop: true, strict: true, skipLibCheck: true, noEmit: true, types: ["node"] }, include: ["src/**/*.ts", "scripts/**/*.ts"], exclude: ["node_modules"] }, null, 2),
    "utf8",
  );
  git(repoRoot, "add", "-A"); git(repoRoot, "commit", "-q", "-m", "initial");
  git(repoRoot, "remote", "add", "origin", remoteDir);
  git(repoRoot, "push", "-q", "-u", "origin", "master");

  fs.mkdirSync(path.join(repoRoot, "node_modules"), { recursive: true });
  fs.symlinkSync(path.join(process.cwd(), "node_modules", "tsx"), path.join(repoRoot, "node_modules", "tsx"), process.platform === "win32" ? "junction" : "dir");
  fs.symlinkSync(path.join(process.cwd(), "node_modules", "typescript"), path.join(repoRoot, "node_modules", "typescript"), process.platform === "win32" ? "junction" : "dir");
  fs.symlinkSync(path.join(process.cwd(), "node_modules", "@types"), path.join(repoRoot, "node_modules", "@types"), process.platform === "win32" ? "junction" : "dir");

  return {
    repoRoot, remoteDir,
    gateRoot: fs.mkdtempSync(path.join(os.tmpdir(), "ayas-proposal-approval-gate-")),
    inbox: createAyasApprovalInboxStore({ rootDir: fs.mkdtempSync(path.join(os.tmpdir(), "ayas-proposal-approval-inbox-")) }),
    artifactStore: createAyasPatchArtifactStore({ rootDir: fs.mkdtempSync(path.join(os.tmpdir(), "ayas-proposal-approval-artifacts-")) }),
  };
}

function proposalInput(overrides: Partial<Omit<AyasInboxProposal, "schemaVersion" | "proposalId" | "lastUpdatedAt" | "proposalHash" | "status" | "createdBy">> = {}) {
  return {
    createdAt: "2026-09-16T09:00:00.000Z",
    baseBranch: "master",
    baseHead: "will-be-overridden",
    objective: "AYAS-generated patch artifact fixture",
    currentProblem: "fixture problem",
    selectionReason: "fixture selection reason",
    expectedUserBenefit: "fixture benefit",
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
    exactFiles: ["scripts/smoke-fixture-generated.ts"],
    expectedDiffScope: "+1 file",
    testsPlanned: ["smoke-fixture-generated"],
    estimatedCost: "zero-cost" as const,
    mutationKind: AYAS_PATCH_ARTIFACT_MUTATION_KIND,
    ...overrides,
  };
}

/** A brand-new-file proposal (allowCreate: true) — the common case (mirrors error-code-contract-gap/-drift). */
function seedNewFileProposal(f: Fixture) {
  const head = git(f.repoRoot, "rev-parse", "HEAD");
  const content = 'console.log(JSON.stringify({ status: "PASS", suite: "fixture-generated", scenarios: 1 }));\n';
  const artifact = f.artifactStore.freeze({
    artifactId: `ayas-patch-artifact-${Math.random().toString(36).slice(2)}`,
    candidateId: "ayas-novel-fixture", generatorIdentity: "ayas-detector:diagnostic-quality-gap-v1",
    baseBranch: "master", baseHead: head, exactFiles: ["scripts/smoke-fixture-generated.ts"], allowedRoots: ["scripts/"],
    replacements: [{ filePath: "scripts/smoke-fixture-generated.ts", expectedHash: null, content, allowCreate: true }],
    validatorScripts: [], graphifyEvidence: ["fixture"], graphifyImportCounts: { "scripts/smoke-fixture-generated.ts": 0 },
    safetyClassification: "SAFE", problemStatement: "p", rationale: "r", expectedUserBenefit: "b", expectedBehaviorChange: "c",
    unchangedBehavior: "u", risk: "low", productionImpact: "none", sandboxValidationSummary: ["PASS"], generatedAt: "2026-09-16T00:00:00.000Z",
  } as never);
  const proposal = f.inbox.createProposal(proposalInput({ baseHead: head, exactFiles: artifact.exactFiles, patchArtifactId: artifact.artifactId, patchHash: artifact.patchHash } as never));
  return { proposal, artifact, head };
}

/** An EDIT proposal against a pre-existing, already-committed file — exercises the M19 `revertToHead` fix (a genuinely new file has no HEAD blob to restore; an edited one does). */
function seedEditProposal(f: Fixture, opts: { readonly newContent: string }) {
  const targetFile = "scripts/existing-editable.ts";
  const originalContent = "export const value = 1;\n";
  fs.writeFileSync(path.join(f.repoRoot, targetFile), originalContent, "utf8");
  git(f.repoRoot, "add", "--", targetFile);
  git(f.repoRoot, "commit", "-q", "-m", "add editable file");
  const head = git(f.repoRoot, "rev-parse", "HEAD");
  const expectedHash = crypto.createHash("sha256").update(originalContent, "utf8").digest("hex");
  const artifact = f.artifactStore.freeze({
    artifactId: `ayas-patch-artifact-${Math.random().toString(36).slice(2)}`,
    candidateId: "ayas-diagnostic-fixture", generatorIdentity: "ayas-detector:diagnostic-quality-gap-v1",
    baseBranch: "master", baseHead: head, exactFiles: [targetFile], allowedRoots: ["scripts/"],
    replacements: [{ filePath: targetFile, expectedHash, content: opts.newContent, allowCreate: false }],
    validatorScripts: [], graphifyEvidence: ["fixture"], graphifyImportCounts: { [targetFile]: 0 },
    safetyClassification: "SAFE", problemStatement: "p", rationale: "r", expectedUserBenefit: "b", expectedBehaviorChange: "c",
    unchangedBehavior: "u", risk: "low", productionImpact: "none", sandboxValidationSummary: ["PASS"], generatedAt: "2026-09-16T00:00:00.000Z",
  } as never);
  const proposal = f.inbox.createProposal(proposalInput({ baseHead: head, exactFiles: [targetFile], patchArtifactId: artifact.artifactId, patchHash: artifact.patchHash } as never));
  return { proposal, artifact, head, targetFile, originalContent };
}

/** A new-file proposal whose DECLARED graphifyImportCounts deliberately does not match what Graphify's own AST extraction will find in the real written content — proves the Graphify check actually blocks publication on mismatch for the individual-proposal lane (the batch lane's equivalent is already proven in smoke-ayas-micro-batch-approval-service.ts). */
function seedGraphifyMismatchProposal(f: Fixture) {
  const head = git(f.repoRoot, "rev-parse", "HEAD");
  // Real content has exactly ONE import (node:path) — but the artifact declares TWO, a contract the real file will never satisfy.
  const content = 'import path from "node:path";\nconsole.log(JSON.stringify({ status: "PASS", suite: "fixture-generated", scenarios: 1, sep: path.sep }));\n';
  const artifact = f.artifactStore.freeze({
    artifactId: `ayas-patch-artifact-${Math.random().toString(36).slice(2)}`,
    candidateId: "ayas-novel-mismatch-fixture", generatorIdentity: "ayas-detector:diagnostic-quality-gap-v1",
    baseBranch: "master", baseHead: head, exactFiles: ["scripts/smoke-fixture-generated.ts"], allowedRoots: ["scripts/"],
    replacements: [{ filePath: "scripts/smoke-fixture-generated.ts", expectedHash: null, content, allowCreate: true }],
    validatorScripts: [], graphifyEvidence: ["fixture"], graphifyImportCounts: { "scripts/smoke-fixture-generated.ts": 2 },
    safetyClassification: "SAFE", problemStatement: "p", rationale: "r", expectedUserBenefit: "b", expectedBehaviorChange: "c",
    unchangedBehavior: "u", risk: "low", productionImpact: "none", sandboxValidationSummary: ["PASS"], generatedAt: "2026-09-16T00:00:00.000Z",
  } as never);
  const proposal = f.inbox.createProposal(proposalInput({ baseHead: head, exactFiles: artifact.exactFiles, patchArtifactId: artifact.artifactId, patchHash: artifact.patchHash } as never));
  return { proposal, artifact, head };
}

async function main(): Promise<void> {
  await scenario("one authorization binds decide + Package C execution + Git publication: a single call produces ONE pushed commit", async () => {
    const f = makeFixture();
    const { proposal } = seedNewFileProposal(f);
    const result = await approveAndExecuteAyasProposal(proposal.proposalId, proposal.proposalHash, f);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.ok(fs.existsSync(path.join(f.repoRoot, "scripts/smoke-fixture-generated.ts")));
    const localHead = git(f.repoRoot, "rev-parse", "HEAD");
    const remoteHead = git(f.remoteDir, "rev-parse", "master");
    assert.equal(localHead, remoteHead, "local must equal the real bare remote after one call");
    assert.equal(localHead, result.commitSha);
    assert.equal(git(f.repoRoot, "status", "--short"), "");
    assert.equal(f.inbox.load().proposals.find((p) => p.proposalId === proposal.proposalId)!.status, "COMPLETED");
  });

  await scenario("a proposalHash that no longer matches the current proposal is refused before any decision or mutation", async () => {
    const f = makeFixture();
    const { proposal } = seedNewFileProposal(f);
    await assert.rejects(
      approveAndExecuteAyasProposal(proposal.proposalId, "stale-hash-value", f),
      (e: unknown) => e instanceof AyasProposalApprovalError && e.code === "PROPOSAL_HASH_MISMATCH",
    );
    assert.equal(f.inbox.load().proposals.find((p) => p.proposalId === proposal.proposalId)!.status, "PENDING", "no decision must be recorded");
    assert.equal(git(f.repoRoot, "status", "--short"), "");
  });

  await scenario("a REVIEW_REQUIRED proposal is refused before any decision — never eligible for single-approval execution", async () => {
    const f = makeFixture();
    const head = git(f.repoRoot, "rev-parse", "HEAD");
    const proposal = f.inbox.createProposal(proposalInput({ baseHead: head, safetyClassification: "REVIEW_REQUIRED", mutationKind: undefined, exactFiles: ["src/lib/ayas/whatever.ts"] } as never));
    await assert.rejects(
      approveAndExecuteAyasProposal(proposal.proposalId, proposal.proposalHash, f),
      (e: unknown) => e instanceof AyasProposalApprovalError && e.code === "NOT_SAFE",
    );
    assert.equal(f.inbox.load().proposals.find((p) => p.proposalId === proposal.proposalId)!.status, "PENDING");
  });

  await scenario("a non-patch-artifact mutationKind is refused — single-approval execution is only wired for patch-artifact-backed proposals", async () => {
    const f = makeFixture();
    const head = git(f.repoRoot, "rev-parse", "HEAD");
    const proposal = f.inbox.createProposal(proposalInput({ baseHead: head, mutationKind: "some-static-registry-kind" } as never));
    await assert.rejects(
      approveAndExecuteAyasProposal(proposal.proposalId, proposal.proposalHash, f),
      (e: unknown) => e instanceof AyasProposalApprovalError && e.code === "NOT_PATCH_ARTIFACT",
    );
  });

  await scenario("HEAD drift since the proposal's baseHead invalidates the authorization — refused, proposal reconciled to STALE", async () => {
    const f = makeFixture();
    const { proposal } = seedNewFileProposal(f);
    fs.writeFileSync(path.join(f.repoRoot, "scripts", "existing.ts"), "export const existing = 2;\n");
    git(f.repoRoot, "add", "-A"); git(f.repoRoot, "commit", "-q", "-m", "moved on");
    const result = await approveAndExecuteAyasProposal(proposal.proposalId, proposal.proposalHash, f);
    assert.equal(result.ok, false);
    assert.equal(f.inbox.load().proposals.find((p) => p.proposalId === proposal.proposalId)!.status, "STALE");
  });

  await scenario("M21.4 — a real import-count mismatch (Graphify's own AST extraction disagrees with the artifact's declared contract) blocks publication: no commit, no push, write rolled back", async () => {
    const f = makeFixture();
    const { proposal } = seedGraphifyMismatchProposal(f);
    const beforeCount = Number(git(f.repoRoot, "rev-list", "--count", "HEAD"));
    const result = await approveAndExecuteAyasProposal(proposal.proposalId, proposal.proposalHash, f);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "AYAS_GRAPHIFY_UNEXPECTED_DEPENDENCY");
    const afterCount = Number(git(f.repoRoot, "rev-list", "--count", "HEAD"));
    assert.equal(afterCount, beforeCount, "no commit must be created when Graphify's real check disagrees with the declared contract");
    assert.equal(fs.existsSync(path.join(f.repoRoot, "scripts/smoke-fixture-generated.ts")), false, "the write must be rolled back, not left half-applied");
    assert.equal(git(f.repoRoot, "status", "--short"), "");
  });

  await scenario("an edit to a pre-existing file that fails post-execution validation is reverted to its ORIGINAL content, never deleted (the M19 revertToHead fix)", async () => {
    const f = makeFixture();
    // Valid JS, but a real TypeScript type error — passes Package C (no declared validators) but fails the post-execution project-wide tsc --noEmit.
    const { proposal, targetFile } = seedEditProposal(f, { newContent: 'export const value: number = "not a number";\n' });
    const headBefore = git(f.repoRoot, "show", `HEAD:${targetFile}`); // ground truth: what git itself considers this file's content at HEAD (accounts for this machine's own autocrlf normalization)
    const result = await approveAndExecuteAyasProposal(proposal.proposalId, proposal.proposalHash, f);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.stage, "POST_VALIDATION");
    assert.ok(fs.existsSync(path.join(f.repoRoot, targetFile)), "the file must still exist — a pre-existing file must be RESTORED, never deleted");
    assert.equal(git(f.repoRoot, "show", `HEAD:${targetFile}`), headBefore, "HEAD itself must be untouched (no commit happened)");
    assert.equal(git(f.repoRoot, "status", "--short"), "", "working tree must be clean after the revert — restored content must exactly match HEAD, not just 'exist'");
  });

  await scenario("replay is refused: a second approval call on an already-COMPLETED proposal is rejected, never re-executed or re-pushed", async () => {
    const f = makeFixture();
    const { proposal } = seedNewFileProposal(f);
    const first = await approveAndExecuteAyasProposal(proposal.proposalId, proposal.proposalHash, f);
    assert.equal(first.ok, true);
    await assert.rejects(
      approveAndExecuteAyasProposal(proposal.proposalId, proposal.proposalHash, f),
      (e: unknown) => e instanceof AyasProposalApprovalError && e.code === "NOT_READY",
    );
  });

  await scenario("push failure (remote already moved on) is a distinct PUSH-stage failure — local commit preserved, never reset/rewritten", async () => {
    const f = makeFixture();
    const otherClone = root();
    git(otherClone, "clone", "-q", f.remoteDir, ".");
    git(otherClone, "config", "user.email", "g@example.com"); git(otherClone, "config", "user.name", "g");
    fs.writeFileSync(path.join(otherClone, "elsewhere.ts"), "export const elsewhere = 1;\n");
    git(otherClone, "add", "-A"); git(otherClone, "commit", "-q", "-m", "elsewhere");
    git(otherClone, "push", "-q", "origin", "master");

    const { proposal } = seedNewFileProposal(f);
    const beforeLocalHead = git(f.repoRoot, "rev-parse", "HEAD");
    const result = await approveAndExecuteAyasProposal(proposal.proposalId, proposal.proposalHash, f);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.stage, "PUSH");
    const afterLocalHead = git(f.repoRoot, "rev-parse", "HEAD");
    assert.notEqual(afterLocalHead, beforeLocalHead, "the local commit must still exist even though the push failed");
    assert.ok(fs.existsSync(path.join(f.repoRoot, "scripts/smoke-fixture-generated.ts")));
  });

  await scenario("exact-scope staging only: the commit contains ONLY the approved proposal's exactFiles", async () => {
    const f = makeFixture();
    const { proposal } = seedNewFileProposal(f);
    const result = await approveAndExecuteAyasProposal(proposal.proposalId, proposal.proposalHash, f);
    assert.equal(result.ok, true);
    const changedInCommit = git(f.repoRoot, "diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD").split("\n").filter(Boolean);
    assert.deepEqual(changedInCommit, ["scripts/smoke-fixture-generated.ts"]);
  });

  // --- publishAlreadyOwnerApprovedAyasProposal (Step 6 resume entrypoint) ---
  // Exercises the shared publish pipeline (`publishAyasApprovedProposal`)
  // through its SECOND entrypoint — the one `AyasOwnerApprovalResume.ts`
  // calls for a proposal that is already durably APPROVED, never PENDING.
  // `approveAndExecuteAyasProposal`'s own scenarios above already prove the
  // pipeline's mutation/Graphify/staging/commit/push behavior in depth; this
  // section only proves the two entrypoints share that ONE pipeline and
  // differ correctly on their precondition.

  await scenario("publishAlreadyOwnerApprovedAyasProposal refuses a still-PENDING proposal — it is only for an already-approved one", async () => {
    const f = makeFixture();
    const { proposal } = seedNewFileProposal(f);
    await assert.rejects(
      publishAlreadyOwnerApprovedAyasProposal(proposal.proposalId, proposal.proposalHash, f),
      (e: unknown) => e instanceof AyasProposalApprovalError && e.code === "NOT_READY",
    );
    assert.equal(f.inbox.load().proposals.find((p) => p.proposalId === proposal.proposalId)!.status, "PENDING", "must not have decided anything");
  });

  await scenario("publishAlreadyOwnerApprovedAyasProposal publishes an already-APPROVED proposal through the SAME one-commit pipeline, without deciding again", async () => {
    const f = makeFixture();
    const { proposal } = seedNewFileProposal(f);
    f.inbox.decide(proposal.proposalId, "APPROVE", new Date().toISOString());
    const decisionsBefore = f.inbox.load().decisions.filter((d) => d.proposalId === proposal.proposalId && d.decision === "APPROVE").length;
    const result = await publishAlreadyOwnerApprovedAyasProposal(proposal.proposalId, proposal.proposalHash, f);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const localHead = git(f.repoRoot, "rev-parse", "HEAD");
    const remoteHead = git(f.remoteDir, "rev-parse", "master");
    assert.equal(localHead, remoteHead);
    assert.equal(localHead, result.commitSha);
    assert.equal(f.inbox.load().proposals.find((p) => p.proposalId === proposal.proposalId)!.status, "COMPLETED");
    const decisionsAfter = f.inbox.load().decisions.filter((d) => d.proposalId === proposal.proposalId && d.decision === "APPROVE").length;
    assert.equal(decisionsAfter, decisionsBefore, "must not create a second APPROVE decision record — the approval already existed");
  });

  await scenario("publishAlreadyOwnerApprovedAyasProposal refuses a stale proposalHash exactly like the PENDING entrypoint does", async () => {
    const f = makeFixture();
    const { proposal } = seedNewFileProposal(f);
    f.inbox.decide(proposal.proposalId, "APPROVE", new Date().toISOString());
    await assert.rejects(
      publishAlreadyOwnerApprovedAyasProposal(proposal.proposalId, "stale-hash-value", f),
      (e: unknown) => e instanceof AyasProposalApprovalError && e.code === "PROPOSAL_HASH_MISMATCH",
    );
  });

  await scenario("publishAlreadyOwnerApprovedAyasProposal refuses to replay an already-COMPLETED proposal", async () => {
    const f = makeFixture();
    const { proposal } = seedNewFileProposal(f);
    f.inbox.decide(proposal.proposalId, "APPROVE", new Date().toISOString());
    const first = await publishAlreadyOwnerApprovedAyasProposal(proposal.proposalId, proposal.proposalHash, f);
    assert.equal(first.ok, true);
    await assert.rejects(
      publishAlreadyOwnerApprovedAyasProposal(proposal.proposalId, proposal.proposalHash, f),
      (e: unknown) => e instanceof AyasProposalApprovalError && e.code === "NOT_READY",
    );
  });

  await scenario("the module never stages via broad commands — source inspection proves no `add .` / `add -A` / `commit -a`", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src", "lib", "brain", "autonomy", "AyasProposalApprovalService.ts"), "utf8");
    assert.doesNotMatch(src, /git\(deps\.repoRoot,\s*\["add",\s*"-A"|git\(deps\.repoRoot,\s*\["add",\s*"\."|"commit",\s*"-a"/);
  });

  console.log(`AYAS proposal approval service smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-proposal-approval-service", scenarios: count }));
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
