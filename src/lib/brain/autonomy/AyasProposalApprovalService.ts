import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { createAyasApprovalInboxStore, isAyasProposalApprovalReady, type AyasApprovalInboxHandle, type AyasInboxProposal } from "./AyasApprovalInboxStore";
import { executeAyasApprovedProposalWith, AyasProposalExecutionError } from "./AyasProposalExecutionService";
import { createAyasPatchArtifactStore, type AyasPatchArtifactStore } from "./AyasPatchArtifact";
import { AyasBatchGraphifyCheckError } from "./AyasBatchGraphifyCheck";
import { createAyasGraphifyEvidenceStore, checkAyasItemWithGraphifyEvidenced, type AyasGraphifyEvidenceStore } from "./AyasGraphifyEvidenceStore";
import { AYAS_PATCH_ARTIFACT_MUTATION_KIND } from "./AyasNovelPatchDiscovery";

/**
 * M20.7 — "ONAYLA VE UYGULA": the individual-PRIORITY_SAFE-proposal
 * equivalent of M18.1's "BATCH ONAYLA VE UYGULA". Before this module, an
 * individual proposal's ONLY path was the older two-step "ONAYLA" (decide)
 * → "YÜRÜT" (execute) flow (`decideAyasApproval` / `executeAyasApprovedProposal`
 * in `app/brain/actions.ts`) — and even after YÜRÜT, NOTHING staged,
 * committed, or pushed the resulting real-repo mutation; that was left to a
 * human doing it manually outside this system entirely. This module closes
 * that gap the same way M18.1 closed it for batches: ONE human action,
 * bound to the exact reviewed `proposalId` + `proposalHash` (which itself
 * already transitively binds baseHead/patchArtifactId/patchHash/exactFiles —
 * see `AyasApprovalInboxStore`'s own `AYAS_PROPOSAL_HASH_VOLATILE_FIELDS`),
 * collapses decide → Package C execution (unmodified
 * `AyasAutonomyDaemon.executeApproved`, via the existing, untouched
 * `AyasProposalExecutionService`) → per-file Graphify structural check
 * (durably evidenced) → post-execution validation (project TypeScript +
 * `git diff --check`) → exact-scope Git staging → ONE commit → push →
 * local==remote verification.
 *
 * Scope, deliberately narrow for this first rollout: only proposals whose
 * `mutationKind` is the patch-artifact kind (`AYAS_PATCH_ARTIFACT_MUTATION_KIND`)
 * are accepted — every currently-generator-backed PRIORITY_SAFE proposal
 * (M19's `error-code-contract-drift` / `diagnostic-quality-gap`) is exactly
 * this kind. A static-registry (`AyasMutationRegistry`) proposal has no
 * `graphifyImportCounts` contract to check against and is refused here,
 * left to the pre-existing manual ONAYLA→YÜRÜT path unchanged.
 */
export class AyasProposalApprovalError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "AyasProposalApprovalError";
    this.stack = undefined;
  }
}

export function defaultAyasProposalApprovalDeps(): AyasProposalApprovalDeps {
  const repoRoot = process.cwd();
  return { repoRoot, gateRoot: path.join(repoRoot, "data", "brain", "self-improvement"), inbox: createAyasApprovalInboxStore() };
}

export interface AyasProposalApprovalDeps {
  readonly repoRoot: string;
  readonly gateRoot: string;
  readonly remoteName?: string;
  readonly inbox: AyasApprovalInboxHandle;
  readonly artifactStore?: AyasPatchArtifactStore;
  readonly graphifyEvidenceStore?: AyasGraphifyEvidenceStore;
}

export type AyasProposalApprovalOutcome =
  | { readonly ok: true; readonly commitSha: string; readonly pushed: true; readonly changedFiles: readonly string[]; readonly graphifyEvidenceItemIds: readonly string[] }
  | { readonly ok: false; readonly code: string; readonly stage: "APPROVAL" | "EXECUTION" | "POST_VALIDATION" | "STAGING" | "COMMIT" | "PUSH"; readonly message: string; readonly graphifyEvidenceItemIds: readonly string[] };

function git(repoRoot: string, args: readonly string[]): string {
  return execFileSync("git", [...args], { cwd: repoRoot, encoding: "utf8", windowsHide: true }).trim();
}

/** Reverts every file in `files` to its state at HEAD — see the identical, independently-derived helper in `AyasMicroBatchApprovalService.ts` for the full rationale (nothing is committed yet at the point this runs, so HEAD still reflects the pre-mutation state; a genuinely new file has no HEAD blob and is deleted instead). */
function revertToHead(repoRoot: string, files: readonly string[]): void {
  for (const f of files) {
    try {
      execFileSync("git", ["checkout", "HEAD", "--", f], { cwd: repoRoot, encoding: "utf8", windowsHide: true });
    } catch {
      const abs = path.join(repoRoot, f);
      if (fs.existsSync(abs)) fs.rmSync(abs, { force: true });
    }
  }
}

function commitMessageFor(proposal: AyasInboxProposal): string {
  const isPureTests = proposal.exactFiles.every((f) => f.startsWith("scripts/smoke-"));
  const kind = isPureTests ? "test" : "chore";
  const lines = [
    `${kind}(ayas): apply approved priority-safe improvement`,
    "",
    "AYAS-governed individual proposal, human-approved as one unit (ONAYLA VE",
    "UYGULA), executed through Package C, Graphify-verified, and validated",
    "before publication.",
    "",
    `proposalId: ${proposal.proposalId}`,
    `proposalHash: ${proposal.proposalHash}`,
    "",
    "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>",
  ];
  return lines.join("\n");
}

/**
 * The one entrypoint for "ONAYLA VE UYGULA". Accepts only a proposalId and
 * the exact proposalHash the human reviewed. Every other input is
 * re-derived from durable state.
 */
export async function approveAndExecuteAyasProposal(proposalId: string, approvedProposalHash: string, deps: AyasProposalApprovalDeps): Promise<AyasProposalApprovalOutcome> {
  if (typeof proposalId !== "string" || !proposalId.trim()) throw new AyasProposalApprovalError("INVALID_INPUT", "proposalId is required");
  if (typeof approvedProposalHash !== "string" || !approvedProposalHash.trim()) throw new AyasProposalApprovalError("INVALID_INPUT", "approvedProposalHash is required");

  const artifactStore = deps.artifactStore ?? createAyasPatchArtifactStore();
  const graphifyEvidenceStore = deps.graphifyEvidenceStore ?? createAyasGraphifyEvidenceStore({ rootDir: path.join(deps.gateRoot, "graphify-evidence") });
  const remoteName = deps.remoteName ?? "origin";
  const graphifyEvidenceItemIds = new Set<string>();

  // Deliberately NO pre-emptive staleness reconciliation here (unlike the
  // older two-step `decideAyasApproval` action, where decide and execute can
  // be arbitrarily far apart in time): decide and execute happen inside the
  // SAME call below, and `executeAyasApprovedProposalWith` already
  // reconciles staleness internally, immediately before executing — mirrors
  // `AyasMicroBatchApprovalService`, which likewise leaves HEAD-drift
  // detection to Package C's own execution-time revalidation rather than a
  // separate pre-check, so a HEAD-drift failure here is consistently
  // reported at the EXECUTION stage, not thrown before it.
  const proposalBefore = deps.inbox.load().proposals.find((p) => p.proposalId === proposalId);
  if (!proposalBefore) throw new AyasProposalApprovalError("NOT_FOUND", "proposal not found");
  if (proposalBefore.status !== "PENDING") throw new AyasProposalApprovalError("NOT_READY", `proposal status is ${proposalBefore.status}, not PENDING`);
  if (proposalBefore.proposalHash !== approvedProposalHash) throw new AyasProposalApprovalError("PROPOSAL_HASH_MISMATCH", "the proposal changed since it was shown for review — authorization refused");
  if (proposalBefore.safetyClassification !== "SAFE") throw new AyasProposalApprovalError("NOT_SAFE", "proposal is not SAFE-classified — never eligible for single-approval execution");
  if (proposalBefore.mutationKind !== AYAS_PATCH_ARTIFACT_MUTATION_KIND || !proposalBefore.patchArtifactId) {
    throw new AyasProposalApprovalError("NOT_PATCH_ARTIFACT", "single-approval execution is only wired for patch-artifact-backed proposals");
  }

  // --- decide: one durable APPROVE decision ---
  deps.inbox.decide(proposalId, "APPROVE", new Date().toISOString());
  const approved = deps.inbox.load().proposals.find((p) => p.proposalId === proposalId)!;
  if (!isAyasProposalApprovalReady(approved)) throw new AyasProposalApprovalError("NOT_READY", "proposal did not reach an approval-ready state after decide");

  // --- Package C execution (unmodified AyasAutonomyDaemon.executeApproved, via the existing AyasProposalExecutionService) ---
  try {
    await executeAyasApprovedProposalWith(proposalId, { repoRoot: deps.repoRoot, gateRoot: deps.gateRoot, inbox: deps.inbox, patchArtifactStore: artifactStore });
  } catch (error) {
    const code = error instanceof AyasProposalExecutionError ? error.code : error instanceof Error ? error.message : "EXECUTION_FAILED";
    return { ok: false, code, stage: "EXECUTION", message: error instanceof Error ? error.message : String(error), graphifyEvidenceItemIds: [] };
  }

  const artifact = artifactStore.loadVerified(approved.patchArtifactId!);
  const files = approved.exactFiles;

  // --- post-execution validation: per-file Graphify (evidenced) + project TypeScript + git diff --check ---
  try {
    for (const file of files) {
      const expected = artifact.graphifyImportCounts?.[file];
      if (expected === undefined) throw new AyasBatchGraphifyCheckError("AYAS_GRAPHIFY_UNEXPECTED_DEPENDENCY", `no declared Graphify import-count contract for generator "${artifact.generatorIdentity}" file "${file}" — refusing to guess`);
      checkAyasItemWithGraphifyEvidenced({ repoRoot: deps.repoRoot, evidenceStore: graphifyEvidenceStore, itemId: proposalId, file, expectedImportCount: expected });
      graphifyEvidenceItemIds.add(proposalId);
    }
    const tscEntry = path.join(deps.repoRoot, "node_modules", "typescript", "bin", "tsc");
    execFileSync(process.execPath, [tscEntry, "--noEmit"], { cwd: deps.repoRoot, encoding: "utf8", windowsHide: true, timeout: 180_000 });
    git(deps.repoRoot, ["add", "-N", "--", ...files]);
    git(deps.repoRoot, ["diff", "--check", "--", ...files]);
  } catch (error) {
    git(deps.repoRoot, ["reset", "--", ...files]);
    revertToHead(deps.repoRoot, files);
    const message = error instanceof Error ? error.message : String(error);
    const code = error instanceof AyasBatchGraphifyCheckError ? error.code : "POST_EXECUTION_VALIDATION_FAILED";
    return { ok: false, code, stage: "POST_VALIDATION", message, graphifyEvidenceItemIds: [...graphifyEvidenceItemIds] };
  }

  // --- exact-scope Git staging only — never `git add .` / `-A` / `commit -a` ---
  git(deps.repoRoot, ["add", "--", ...files]);
  const stagedFiles = git(deps.repoRoot, ["diff", "--cached", "--name-only"]).split("\n").filter(Boolean).sort();
  const expectedFiles = [...files].sort();
  if (JSON.stringify(stagedFiles) !== JSON.stringify(expectedFiles)) {
    git(deps.repoRoot, ["reset"]);
    revertToHead(deps.repoRoot, files);
    return { ok: false, code: "AYAS_PROPOSAL_STAGE_SCOPE_MISMATCH", stage: "STAGING", message: `staged scope ${JSON.stringify(stagedFiles)} did not exactly match the approved proposal's files ${JSON.stringify(expectedFiles)}`, graphifyEvidenceItemIds: [...graphifyEvidenceItemIds] };
  }
  try {
    git(deps.repoRoot, ["diff", "--cached", "--check"]);
  } catch (error) {
    git(deps.repoRoot, ["reset"]);
    revertToHead(deps.repoRoot, files);
    return { ok: false, code: "AYAS_PROPOSAL_WHITESPACE_ERROR", stage: "STAGING", message: error instanceof Error ? error.message : String(error), graphifyEvidenceItemIds: [...graphifyEvidenceItemIds] };
  }

  // --- ONE commit ---
  let commitSha: string;
  try {
    git(deps.repoRoot, ["commit", "-m", commitMessageFor(approved)]);
    commitSha = git(deps.repoRoot, ["rev-parse", "HEAD"]);
  } catch (error) {
    // A commit failure with content already staged is left exactly as-is for
    // human inspection — never auto-reset, never auto-retried.
    return { ok: false, code: "AYAS_PROPOSAL_COMMIT_FAILED", stage: "COMMIT", message: error instanceof Error ? error.message : String(error), graphifyEvidenceItemIds: [...graphifyEvidenceItemIds] };
  }

  // --- push, never force ---
  const branch = git(deps.repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"]);
  try {
    git(deps.repoRoot, ["push", remoteName, branch]);
  } catch (error) {
    return { ok: false, code: "AYAS_PROPOSAL_PUSH_FAILED", stage: "PUSH", message: error instanceof Error ? error.message : String(error), graphifyEvidenceItemIds: [...graphifyEvidenceItemIds] };
  }

  const localHead = git(deps.repoRoot, ["rev-parse", "HEAD"]);
  const remoteHead = git(deps.repoRoot, ["rev-parse", `${remoteName}/${branch}`]);
  if (localHead !== remoteHead) {
    return { ok: false, code: "AYAS_PROPOSAL_PUBLISH_UNVERIFIED", stage: "PUSH", message: `local HEAD ${localHead} does not match ${remoteName}/${branch} ${remoteHead} after push`, graphifyEvidenceItemIds: [...graphifyEvidenceItemIds] };
  }

  return { ok: true, commitSha, pushed: true, changedFiles: files, graphifyEvidenceItemIds: [...graphifyEvidenceItemIds] };
}
