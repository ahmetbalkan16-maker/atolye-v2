import { execFileSync } from "node:child_process";
import path from "node:path";

import { createAyasApprovalInboxStore, isAyasProposalApprovalReady, type AyasApprovalInboxHandle } from "./AyasApprovalInboxStore";
import { createAyasAutonomyDaemon } from "./AyasAutonomyDaemon";
import { resolveAyasMutation, AyasMutationRegistryError, type AyasMutationImplementation } from "./AyasMutationRegistry";

/**
 * The one real Package C execution entrypoint (M15), factored out of the
 * "use server" action file so it can be exercised directly against
 * isolated fixtures (a temp git repo, a temp approval inbox, a temp gate
 * root) instead of the real repository and the real durable state — no
 * test of this logic may ever touch `data/brain` or the real working tree.
 *
 * Accepts only a `proposalId` from the action layer above (which itself
 * accepts only that from the client) — never a callback, filesystem path,
 * gateRoot, or mutation content. Every other input is re-derived here from
 * durable state immediately before delegating to
 * `AyasAutonomyDaemon.executeApproved()`, which remains the sole authority
 * for reservation, the execution journal, the isolated gate, revalidation,
 * mutation-scope verification, and finalization.
 */
export class AyasProposalExecutionError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "AyasProposalExecutionError";
    this.stack = undefined;
  }
}

export interface AyasProposalExecutionDeps {
  readonly repoRoot: string;
  readonly gateRoot: string;
  readonly inbox: AyasApprovalInboxHandle;
  /** Test-only override — omitted in production, where `resolveAyasMutation` uses the one real, closed registry. */
  readonly registry?: ReadonlyMap<string, AyasMutationImplementation>;
}

export function defaultAyasProposalExecutionDeps(): AyasProposalExecutionDeps {
  const repoRoot = process.cwd();
  return { repoRoot, gateRoot: path.join(repoRoot, "data", "brain", "self-improvement"), inbox: createAyasApprovalInboxStore() };
}

function git(repoRoot: string, args: readonly string[]): string {
  return execFileSync("git", [...args], { cwd: repoRoot, encoding: "utf8", windowsHide: true }).trim();
}

export async function executeAyasApprovedProposalWith(proposalId: string, deps: AyasProposalExecutionDeps): Promise<void> {
  if (typeof proposalId !== "string" || !proposalId.trim()) throw new AyasProposalExecutionError("INVALID_INPUT", "proposalId is required");

  const proposal = deps.inbox.load().proposals.find((entry) => entry.proposalId === proposalId);
  if (!proposal) throw new AyasProposalExecutionError("NOT_FOUND", "proposal not found");
  if (proposal.status !== "APPROVED") throw new AyasProposalExecutionError("NOT_APPROVED", `proposal status is ${proposal.status}`);
  if (proposal.safetyClassification !== "SAFE" || !isAyasProposalApprovalReady(proposal)) throw new AyasProposalExecutionError("NOT_READY", "proposal is not SAFE/approval-ready");

  let mutation;
  try {
    mutation = deps.registry ? resolveAyasMutation(proposal.mutationKind ?? "", proposal.exactFiles, deps.registry) : resolveAyasMutation(proposal.mutationKind ?? "", proposal.exactFiles);
  } catch (error) {
    throw new AyasProposalExecutionError(error instanceof AyasMutationRegistryError ? error.code : "MUTATION_BINDING_UNRESOLVED", error instanceof Error ? error.message : String(error));
  }

  const currentHead = git(deps.repoRoot, ["rev-parse", "HEAD"]);
  const repoClean = git(deps.repoRoot, ["status", "--porcelain"]).length === 0;

  // Fresh re-read, immediately before executing — never trust the lookup above.
  const freshProposal = deps.inbox.load().proposals.find((entry) => entry.proposalId === proposalId);
  if (!freshProposal || freshProposal.status !== "APPROVED") throw new AyasProposalExecutionError("STALE_APPROVAL", "proposal state changed since lookup");

  const daemon = createAyasAutonomyDaemon({ inbox: deps.inbox, gateRoot: deps.gateRoot, repoRoot: deps.repoRoot });
  await daemon.executeApproved({
    proposalId: proposal.proposalId,
    proposalHash: proposal.proposalHash,
    baseHead: proposal.baseHead,
    currentHead,
    exactFiles: proposal.exactFiles,
    currentExactFiles: freshProposal.exactFiles,
    repoClean,
    applyWhileExecuting: async () => {
      const run = await mutation.run(deps.repoRoot);
      return { changedFiles: run.changedFiles, diffFingerprint: "", testsRun: run.testsRun, testResults: run.testResults };
    },
  });
}
