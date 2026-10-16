import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createAyasApprovalInboxStore, type AyasApprovalInboxHandle, type AyasInboxProposal } from "../src/lib/brain/autonomy/AyasApprovalInboxStore";
import { createAyasExecutionJournal } from "../src/lib/brain/autonomy/AyasExecutionJournal";
import { ayasPublicationOperationName } from "../src/lib/brain/autonomy/AyasGuardedPublication";
import { createAyasPatchArtifactStore } from "../src/lib/brain/autonomy/AyasPatchArtifact";
import { ayasProposalPublicationOperation, reconcileAyasRecoveryRequiredProposals } from "../src/lib/brain/autonomy/AyasRecoveryReconciliation";

/**
 * Owner decision 2026-10-16: a RECOVERY_REQUIRED proposal closes itself once
 * durable evidence proves what its attempt left behind, and stays open (with a
 * reason) until then. Every scenario runs against a TEMP git repository with a
 * TEMP bare remote, TEMP inbox/journal/stability/artifact stores — never
 * `data/brain` or the real working tree.
 */
let count = 0;
async function scenario(name: string, fn: () => void | Promise<void>): Promise<void> {
  await fn();
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}

const base = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-recovery-reconciliation-"));
const BRANCH = "fixture";
const ORIGINAL = "export const fixture = 1;\n";
const APPROVED = "export const fixture = 2;\n";

function git(repo: string, args: readonly string[], env: Record<string, string> = {}): string {
  return execFileSync("git", ["-c", "user.name=AYAS Fixture", "-c", "user.email=fixture@example.invalid", "-c", "core.autocrlf=false", ...args],
    { cwd: repo, encoding: "utf8", windowsHide: true, env: { ...process.env, ...env } }).trim();
}

interface Fixture {
  readonly repo: string;
  readonly gateRoot: string;
  readonly inbox: AyasApprovalInboxHandle;
  readonly artifacts: ReturnType<typeof createAyasPatchArtifactStore>;
  readonly baseHead: string;
}

function fixture(name: string): Fixture {
  const root = path.join(base, name);
  const remote = path.join(root, "remote.git");
  const repo = path.join(root, "repo");
  fs.mkdirSync(root, { recursive: true });
  execFileSync("git", ["init", "--bare", "-q", "-b", BRANCH, remote], { windowsHide: true });
  fs.mkdirSync(path.join(repo, "scripts"), { recursive: true });
  git(repo, ["init", "-q", "-b", BRANCH]);
  for (const letter of ["a", "b", "c"]) fs.writeFileSync(path.join(repo, "scripts", `smoke-recovery-fixture-${letter}.ts`), ORIGINAL);
  git(repo, ["add", "--", "scripts"]);
  git(repo, ["commit", "-q", "-m", "fixture base"]);
  git(repo, ["remote", "add", "origin", remote]);
  git(repo, ["push", "-q", "origin", BRANCH]);
  return {
    repo,
    gateRoot: path.join(root, "gate"),
    inbox: createAyasApprovalInboxStore({ rootDir: path.join(root, "brain") }),
    artifacts: createAyasPatchArtifactStore({ rootDir: path.join(root, "artifacts") }),
    baseHead: git(repo, ["rev-parse", "HEAD"]),
  };
}

/** A real proposal driven through APPROVE -> reserve -> finalize(RECOVERY_REQUIRED), with its frozen artifact. */
function recoveryProposal(f: Fixture, file: string, at: string): AyasInboxProposal {
  const artifactId = `ayas-patch-artifact-${crypto.randomUUID()}`;
  const artifact = f.artifacts.freeze({
    artifactId, candidateId: `fixture-${file}`, generatorIdentity: "fixture-generator", baseBranch: BRANCH, baseHead: f.baseHead,
    exactFiles: [file], allowedRoots: ["scripts"], replacements: [{ filePath: file, expectedHash: null, content: APPROVED, allowCreate: false }],
    validatorScripts: [], graphifyEvidence: ["fixture witness"], safetyClassification: "SAFE", problemStatement: "fixture", rationale: "fixture",
    expectedUserBenefit: "fixture", expectedBehaviorChange: "fixture", unchangedBehavior: "fixture", risk: "low", productionImpact: "none",
    sandboxValidationSummary: [], generatedAt: at,
  });
  const proposal = f.inbox.createProposal({
    createdAt: at, baseBranch: BRANCH, baseHead: f.baseHead, objective: `fixture change for ${file}`, currentProblem: "fixture problem",
    selectionReason: "fixture selection", expectedUserBenefit: "fixture benefit", expectedBehaviorChange: "one constant changes",
    unchangedBehavior: "everything else", riskIfNotDone: "fixture risk", technicalRisk: "low", productionImpact: "none", rationale: "fixture rationale",
    evidence: ["fixture evidence"], graphifyEvidence: ["fixture witness"], candidateRank: 1, risk: "low", safetyClassification: "SAFE",
    exactFiles: [file], expectedDiffScope: "one line", testsPlanned: ["fixture"], estimatedCost: "zero-cost",
    mutationKind: "patch-artifact:v1", patchArtifactId: artifact.artifactId, patchHash: artifact.patchHash,
  });
  f.inbox.decide(proposal.proposalId, "APPROVE", at, "synthetic test only");
  const reservation = f.inbox.reserveApproval(proposal.proposalId, proposal.proposalHash, proposal.baseHead, proposal.exactFiles, at);
  f.inbox.finalizeApproval(reservation.reservationId, "RECOVERY_REQUIRED", at);
  return f.inbox.load().proposals.find((p) => p.proposalId === proposal.proposalId)!;
}

function journal(f: Fixture, proposal: AyasInboxProposal, window: { readonly startedAt: string; readonly updatedAt: string }, mutationCompleted: boolean): string {
  const executionId = `ayas-exec-${crypto.randomUUID()}`;
  createAyasExecutionJournal({ rootDir: f.gateRoot }).record({
    schemaVersion: "1", executionId, proposalId: proposal.proposalId, proposalHash: proposal.proposalHash, baseHead: proposal.baseHead,
    exactFiles: proposal.exactFiles, phase: "RECOVERY_REQUIRED", startedAt: window.startedAt, updatedAt: window.updatedAt,
    ...(mutationCompleted ? { mutationFingerprint: "fixture-fingerprint", mutationCompletedAt: window.startedAt } : {}), lastError: "fixture failure",
  });
  return executionId;
}

function stability(f: Fixture, rows: readonly { readonly operation: string; readonly state: string; readonly at: string }[]): string[] {
  const transactions = rows.map((row) => ({ schemaVersion: "1", transactionId: `ayas-stability-${crypto.randomUUID()}`, operation: row.operation, state: row.state, createdAt: row.at, lastUpdatedAt: row.at, ownerPid: 1, history: [] }));
  fs.mkdirSync(path.join(f.gateRoot, "stability"), { recursive: true });
  fs.writeFileSync(path.join(f.gateRoot, "stability", "stability-transactions.json"), JSON.stringify({ schemaVersion: "1", transactions }));
  return transactions.map((t) => t.transactionId);
}

/** Commits the approved content with Git's committer date pinned to `at`. */
function commitApproved(f: Fixture, file: string, at: string): string {
  fs.writeFileSync(path.join(f.repo, file), APPROVED);
  git(f.repo, ["add", "--", file]);
  git(f.repo, ["commit", "-q", "-m", "test(ayas): apply approved priority-safe improvement"], { GIT_COMMITTER_DATE: at, GIT_AUTHOR_DATE: at });
  return git(f.repo, ["rev-parse", "HEAD"]);
}

const reconcile = (f: Fixture, now: string) => reconcileAyasRecoveryRequiredProposals({ repoRoot: f.repo, inbox: f.inbox, now, gateRoot: f.gateRoot, artifactStore: f.artifacts });
const statusOf = (f: Fixture, id: string) => f.inbox.load().proposals.find((p) => p.proposalId === id)!.status;
const T0 = "2026-10-16T08:00:00.000Z";
const ATTEMPT = { startedAt: "2026-10-16T08:00:00.500Z", updatedAt: "2026-10-16T08:01:00.000Z" };
const NOW = "2026-10-16T09:00:00.000Z";

async function main(): Promise<void> {
  try {
    await scenario("the operation name read here is the one the guarded publication writes", () => {
      assert.equal(ayasProposalPublicationOperation("ayas-proposal-x"), ayasPublicationOperationName("proposal", "ayas-proposal-x"));
    });

    await scenario("ROLLBACK_VERIFIED: a guard-proven rollback closes as FAILED; the forensic ledgers stay byte-identical", () => {
      const f = fixture("rollback");
      const p = recoveryProposal(f, "scripts/smoke-recovery-fixture-a.ts", T0);
      const executionId = journal(f, p, ATTEMPT, true);
      const [tx] = stability(f, [{ operation: ayasProposalPublicationOperation(p.proposalId), state: "ROLLED_BACK", at: ATTEMPT.updatedAt }]);
      const ledger = fs.readFileSync(path.join(f.gateRoot, "stability", "stability-transactions.json"));
      const entry = fs.readFileSync(path.join(f.gateRoot, "execution", "journal", `${executionId}.json`));
      const result = reconcile(f, NOW);
      assert.deepEqual(result, { resolved: [{ proposalId: p.proposalId, kind: "ROLLBACK_VERIFIED", evidence: tx }], unresolved: [] });
      const state = f.inbox.load();
      assert.equal(statusOf(f, p.proposalId), "FAILED");
      const record = state.results.at(-1)!;
      assert.equal(record.outcome, "ROLLED_BACK");
      assert.deepEqual(record.recoveryResolution, { kind: "ROLLBACK_VERIFIED", evidence: tx, resolvedAt: NOW, resolvedBy: "ayas-recovery-reconciliation" });
      assert.deepEqual(record.changedFiles, []);
      assert.equal(state.decisions.find((d) => d.proposalId === p.proposalId)!.finalizationOutcome, "RECOVERY_REQUIRED", "the spent reservation keeps its original finalization");
      assert.deepEqual(fs.readFileSync(path.join(f.gateRoot, "stability", "stability-transactions.json")), ledger);
      assert.deepEqual(fs.readFileSync(path.join(f.gateRoot, "execution", "journal", `${executionId}.json`)), entry);
      assert.deepEqual(reconcile(f, NOW), { resolved: [], unresolved: [] }, "a second pass finds nothing left to do");
    });

    await scenario("PUBLISHED_VERIFIED: the attempt's own commit on the remote branch closes it as COMPLETED", () => {
      const f = fixture("published");
      const file = "scripts/smoke-recovery-fixture-a.ts";
      const p = recoveryProposal(f, file, T0);
      journal(f, p, ATTEMPT, true);
      stability(f, [{ operation: ayasProposalPublicationOperation(p.proposalId), state: "RECOVERY_REQUIRED", at: ATTEMPT.updatedAt }]);
      const sha = commitApproved(f, file, "2026-10-16T08:00:30Z");
      git(f.repo, ["push", "-q", "origin", BRANCH]);
      assert.deepEqual(reconcile(f, NOW).resolved, [{ proposalId: p.proposalId, kind: "PUBLISHED_VERIFIED", evidence: sha }]);
      assert.equal(statusOf(f, p.proposalId), "COMPLETED");
      const record = f.inbox.load().results.at(-1)!;
      assert.equal(record.outcome, "COMPLETED");
      assert.deepEqual(record.changedFiles, [file]);
    });

    await scenario("an own commit that only exists locally stays open until it is pushed, then closes by itself", () => {
      const f = fixture("unpushed");
      const file = "scripts/smoke-recovery-fixture-a.ts";
      const p = recoveryProposal(f, file, T0);
      journal(f, p, ATTEMPT, true);
      const sha = commitApproved(f, file, "2026-10-16T08:00:30Z");
      assert.deepEqual(reconcile(f, NOW), { resolved: [], unresolved: [{ proposalId: p.proposalId, reason: "MUTATION_NOT_PUBLISHED" }] });
      assert.equal(statusOf(f, p.proposalId), "RECOVERY_REQUIRED");
      git(f.repo, ["push", "-q", "origin", BRANCH]);
      assert.deepEqual(reconcile(f, NOW).resolved, [{ proposalId: p.proposalId, kind: "PUBLISHED_VERIFIED", evidence: sha }]);
    });

    await scenario("someone else's later commit with the same content is not this attempt's publication", () => {
      const f = fixture("foreign-commit");
      const file = "scripts/smoke-recovery-fixture-a.ts";
      const p = recoveryProposal(f, file, T0);
      journal(f, p, ATTEMPT, true);
      commitApproved(f, file, "2026-10-17T10:00:00Z");
      git(f.repo, ["push", "-q", "origin", BRANCH]);
      assert.deepEqual(reconcile(f, NOW).unresolved, [{ proposalId: p.proposalId, reason: "MUTATION_NOT_PUBLISHED" }]);
      assert.equal(statusOf(f, p.proposalId), "RECOVERY_REQUIRED");
    });

    await scenario("a commit in the window with different content is not the approved change", () => {
      const f = fixture("other-content");
      const file = "scripts/smoke-recovery-fixture-a.ts";
      const p = recoveryProposal(f, file, T0);
      journal(f, p, ATTEMPT, true);
      fs.writeFileSync(path.join(f.repo, file), "export const fixture = 3;\n");
      git(f.repo, ["commit", "-q", "-am", "other"], { GIT_COMMITTER_DATE: "2026-10-16T08:00:30Z", GIT_AUTHOR_DATE: "2026-10-16T08:00:30Z" });
      git(f.repo, ["push", "-q", "origin", BRANCH]);
      assert.deepEqual(reconcile(f, NOW).unresolved, [{ proposalId: p.proposalId, reason: "MUTATION_NOT_PUBLISHED" }]);
    });

    await scenario("NO_MUTATION_REMAINS: a mutation that never completed, with clean files, closes as FAILED", () => {
      const f = fixture("no-mutation");
      const p = recoveryProposal(f, "scripts/smoke-recovery-fixture-b.ts", T0);
      const executionId = journal(f, p, ATTEMPT, false);
      assert.deepEqual(reconcile(f, NOW).resolved, [{ proposalId: p.proposalId, kind: "NO_MUTATION_REMAINS", evidence: executionId }]);
      assert.equal(statusOf(f, p.proposalId), "FAILED");
      assert.equal(f.inbox.load().results.at(-1)!.outcome, "FAILED");
    });

    await scenario("uncommitted changes to an exact file keep it open; reverting them closes it on the next pass", () => {
      const f = fixture("dirty");
      const file = "scripts/smoke-recovery-fixture-b.ts";
      const p = recoveryProposal(f, file, T0);
      journal(f, p, ATTEMPT, false);
      fs.writeFileSync(path.join(f.repo, file), APPROVED);
      assert.deepEqual(reconcile(f, NOW).unresolved, [{ proposalId: p.proposalId, reason: "UNCOMMITTED_CHANGES" }]);
      git(f.repo, ["checkout", "--", file]);
      assert.equal(reconcile(f, NOW).resolved[0]?.kind, "NO_MUTATION_REMAINS");
    });

    await scenario("a row the inbox refuses to close stays open with STORE_REFUSED and does not hold back the others", () => {
      const f = fixture("store-refused");
      const legacy = recoveryProposal(f, "scripts/smoke-recovery-fixture-a.ts", T0);
      const next = recoveryProposal(f, "scripts/smoke-recovery-fixture-b.ts", T0);
      journal(f, legacy, ATTEMPT, false);
      journal(f, next, ATTEMPT, false);
      // A legacy row whose reservation never recorded RECOVERY_REQUIRED.
      const state = f.inbox.load();
      f.inbox.save({ ...state, decisions: state.decisions.map((d) => d.proposalId === legacy.proposalId ? { ...d, finalizationOutcome: undefined } : d) });
      const result = reconcile(f, NOW);
      assert.deepEqual(result.unresolved, [{ proposalId: legacy.proposalId, reason: "STORE_REFUSED" }]);
      assert.deepEqual(result.resolved.map((r) => r.proposalId), [next.proposalId]);
      assert.equal(statusOf(f, legacy.proposalId), "RECOVERY_REQUIRED");
    });

    await scenario("no journal and no guard record: nothing proves anything, so it stays open", () => {
      const f = fixture("no-journal");
      const p = recoveryProposal(f, "scripts/smoke-recovery-fixture-c.ts", T0);
      assert.deepEqual(reconcile(f, NOW), { resolved: [], unresolved: [{ proposalId: p.proposalId, reason: "NO_JOURNAL" }] });
    });

    await scenario("a publication in flight (recent open stability transaction or open gate) holds the whole pass; stale leftovers do not", () => {
      const f = fixture("in-flight");
      const p = recoveryProposal(f, "scripts/smoke-recovery-fixture-b.ts", T0);
      journal(f, p, ATTEMPT, false);
      stability(f, [{ operation: "ayas-publication:proposal:someone-else", state: "APPLYING", at: "2026-10-16T08:30:00.000Z" }]);
      const inboxBytes = fs.readFileSync(f.inbox.stateFile);
      assert.deepEqual(reconcile(f, NOW), { skipped: "PUBLICATION_ACTIVE", resolved: [], unresolved: [] });
      assert.deepEqual(fs.readFileSync(f.inbox.stateFile), inboxBytes, "a held pass writes nothing");
      fs.mkdirSync(path.join(f.gateRoot, "execution"), { recursive: true });
      fs.writeFileSync(path.join(f.gateRoot, "execution", "gate.json"), JSON.stringify({ schemaVersion: "1", sequence: 3, state: "OPEN", updatedAt: "2026-10-16T08:59:00.000Z" }));
      stability(f, []);
      assert.equal(reconcile(f, NOW).skipped, "PUBLICATION_ACTIVE");
      const later = "2026-10-16T12:00:00.000Z";
      stability(f, [{ operation: "ayas-publication:proposal:someone-else", state: "APPLYING", at: "2026-10-16T08:30:00.000Z" }]);
      assert.equal(reconcile(f, later).resolved[0]?.kind, "NO_MUTATION_REMAINS", "a crashed leftover older than the active window no longer holds the pass");
    });

    await scenario("a corrupt stability ledger fails the pass closed instead of reading as no history", () => {
      const f = fixture("corrupt");
      recoveryProposal(f, "scripts/smoke-recovery-fixture-a.ts", T0);
      fs.mkdirSync(path.join(f.gateRoot, "stability"), { recursive: true });
      fs.writeFileSync(path.join(f.gateRoot, "stability", "stability-transactions.json"), "{not json");
      assert.throws(() => reconcile(f, NOW));
    });

    await scenario("the store closes only RECOVERY_REQUIRED, with a known kind and record-shaped evidence", () => {
      const f = fixture("store-guards");
      const p = recoveryProposal(f, "scripts/smoke-recovery-fixture-a.ts", T0);
      assert.throws(() => f.inbox.resolveRecovery(p.proposalId, { kind: "ROLLBACK_VERIFIED", evidence: "free text with spaces" }, NOW), /record id or commit SHA/);
      assert.throws(() => f.inbox.resolveRecovery(p.proposalId, { kind: "WHATEVER" as never, evidence: "ayas-stability-x1234" }, NOW), /unknown recovery resolution kind/);
      assert.throws(() => f.inbox.resolveRecovery("missing", { kind: "ROLLBACK_VERIFIED", evidence: "ayas-stability-x1234" }, NOW), /proposal not found/);
      f.inbox.resolveRecovery(p.proposalId, { kind: "ROLLBACK_VERIFIED", evidence: "ayas-stability-x1234" }, NOW);
      assert.throws(() => f.inbox.resolveRecovery(p.proposalId, { kind: "ROLLBACK_VERIFIED", evidence: "ayas-stability-x1234" }, NOW), /not RECOVERY_REQUIRED: FAILED/);
      assert.throws(() => f.inbox.decide(p.proposalId, "APPROVE", NOW), /not pending/, "a closed recovery is never re-decidable");
    });

    await scenario("once closed, the same improvement can be proposed again as a fresh PENDING proposal", () => {
      const f = fixture("re-propose");
      const p = recoveryProposal(f, "scripts/smoke-recovery-fixture-b.ts", T0);
      const storeOwned = new Set(["proposalId", "proposalHash", "lastUpdatedAt", "status", "schemaVersion", "createdBy"]);
      const input = Object.fromEntries(Object.entries(p).filter(([key]) => !storeOwned.has(key))) as Parameters<AyasApprovalInboxHandle["createProposal"]>[0];
      assert.equal(f.inbox.createProposal(input).proposalId, p.proposalId, "still deduped while RECOVERY_REQUIRED");
      journal(f, p, ATTEMPT, false);
      reconcile(f, NOW);
      const again = f.inbox.createProposal(input);
      assert.notEqual(again.proposalId, p.proposalId);
      assert.equal(again.status, "PENDING");
    });

    console.log(`PASS (${count} scenarios)`);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
