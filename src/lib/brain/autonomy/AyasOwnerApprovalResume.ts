/**
 * The narrow reconciler that gives a durably owner-approved proposal a real
 * path to execution once live autonomous execution is later enabled — Step
 * 6 of the durable one-click owner-approval correction. Deliberately the
 * smallest thing that can do this:
 *
 * - It discovers nothing (never calls `AyasDiscoveryRegistry`/`AyasNovelPatchDiscovery`).
 * - It approves nothing (never calls `inbox.decide()` — an owner APPROVE was
 *   already durably recorded earlier, by `AyasAutonomousExecutionGate.decideAyasOwnerApproval`'s
 *   `APPROVED_PENDING_EXECUTION` path; this module only ever CONSUMES that).
 * - It never reclassifies risk or expands scope.
 * - It only ever touches a proposal whose APPROVE decision carries the
 *   `AyasOwnerApprovalProvenance` marker — a proposal approved through the
 *   older, separate manual "ONAYLA" flow (`decideAyasApproval`) is left
 *   completely alone, exactly as before this module existed (that flow's own
 *   manual "YÜRÜT" button is still how a human resumes those).
 * - It reuses the SAME canonical execute→Graphify→validate→stage→commit→push
 *   pipeline every other single-click path already uses
 *   (`AyasProposalApprovalService.publishAlreadyOwnerApprovedAyasProposal`)
 *   — no parallel mutation engine.
 *
 * Deliberately kept OUT of `ayas-discovery-daemon.ts`'s tick (a daemon that
 * discovers/reviews candidates must never also be the thing that executes
 * them) — it has its own entrypoint, `scripts/ayas-owner-approval-resume.ts`.
 */

import { publishAlreadyOwnerApprovedAyasProposal, AyasProposalApprovalError, type AyasProposalApprovalDeps, type AyasProposalApprovalOutcome } from "./AyasProposalApprovalService";
import { isAyasAutonomousExecutionEnabled } from "./AyasAutonomousExecutionGate";
import { isAyasOwnerApprovedDecisionReason } from "./AyasOwnerApprovalProvenance";

export interface AyasOwnerApprovalResumeAttempt {
  readonly proposalId: string;
  readonly outcome: AyasProposalApprovalOutcome | { readonly ok: false; readonly code: string; readonly stage: "RESUME"; readonly message: string; readonly graphifyEvidenceItemIds: readonly [] };
}

export interface AyasOwnerApprovalResumeDeps extends AyasProposalApprovalDeps {
  readonly envOverride?: Record<string, string | undefined>;
}

/**
 * Finds every proposal that is durably `APPROVED` via the owner-approval
 * model and still awaiting execution, and publishes each one through the
 * canonical pipeline — in encounter order, sequentially (never
 * concurrently: each publish can move real HEAD, so the next one's own
 * fresh staleness check is what decides whether it can still proceed, not
 * this loop). Returns `[]` without reading or touching anything else when
 * live execution is not enabled — REJECT/DEFER/PENDING proposals are never
 * in scope here at all.
 */
export async function resumeAyasOwnerApprovedProposals(deps: AyasOwnerApprovalResumeDeps): Promise<readonly AyasOwnerApprovalResumeAttempt[]> {
  if (!isAyasAutonomousExecutionEnabled(deps.envOverride)) return [];

  const state = deps.inbox.load();
  const eligible = state.proposals.filter((proposal) => {
    if (proposal.status !== "APPROVED") return false;
    const decision = [...state.decisions].reverse().find((d) => d.proposalId === proposal.proposalId && d.decision === "APPROVE");
    return isAyasOwnerApprovedDecisionReason(decision?.reason);
  });

  const attempts: AyasOwnerApprovalResumeAttempt[] = [];
  for (const proposal of eligible) {
    try {
      const outcome = await publishAlreadyOwnerApprovedAyasProposal(proposal.proposalId, proposal.proposalHash, deps);
      attempts.push({ proposalId: proposal.proposalId, outcome });
    } catch (error) {
      const code = error instanceof AyasProposalApprovalError ? error.code : "RESUME_FAILED";
      attempts.push({
        proposalId: proposal.proposalId,
        outcome: { ok: false, code, stage: "RESUME", message: error instanceof Error ? error.message : String(error), graphifyEvidenceItemIds: [] },
      });
    }
  }
  return attempts;
}
