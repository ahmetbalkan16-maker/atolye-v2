/** Manual-only resume of one exact durably approved proposal.
 * Historical consent never supplies a current session or execution action.
 * A fresh verified EXECUTE, its exact subject and an explicit server-side owner
 * action are required. The unattended CLI supplies none and returns no attempts.
 * Existing publication machinery and exact-patch exclusion remain unchanged.
 */

import { publishAlreadyOwnerApprovedAyasProposal, AyasProposalApprovalError, type AyasProposalApprovalDeps, type AyasProposalApprovalOutcome } from "./AyasProposalApprovalService";
import { isAyasAutonomousExecutionEnabled } from "./AyasAutonomousExecutionGate";
import { isAyasOwnerApprovedDecisionReason } from "./AyasOwnerApprovalProvenance";
import { isAyasApprovalDecisionOwnerAdmitted, checkAyasOwnerExecutionAdmission } from "./AyasOwnerApprovalAdmission";

export interface AyasOwnerApprovalResumeAttempt {
  readonly proposalId: string;
  readonly outcome: AyasProposalApprovalOutcome | { readonly ok: false; readonly code: string; readonly stage: "RESUME"; readonly message: string; readonly graphifyEvidenceItemIds: readonly [] };
}

export interface AyasOwnerApprovalResumeDeps extends AyasProposalApprovalDeps {
  readonly envOverride?: Record<string, string | undefined>;
  /** A server-side manual owner action, targeting exactly one subject. */
  readonly explicitManualOwnerAction?: boolean;
}

/** Returns no attempts before any state access unless manual session-bound execution is supplied. */
export async function resumeAyasOwnerApprovedProposals(deps: AyasOwnerApprovalResumeDeps): Promise<readonly AyasOwnerApprovalResumeAttempt[]> {
  if (!isAyasAutonomousExecutionEnabled(deps.envOverride)) return [];
  if (deps.explicitManualOwnerAction !== true || !deps.executionOwnerAdmission) return [];

  const state = deps.inbox.load();
  const eligible = state.proposals.filter((proposal) => {
    if (proposal.status !== "APPROVED") return false;
    if (proposal.exactPatchSafetyProof) return false; // local governed execution only; this worker publishes to the remote
    const decision = [...state.decisions].reverse().find((d) => d.proposalId === proposal.proposalId && d.decision === "APPROVE");
    // The reason prefix says which path recorded the APPROVE; only the
    // admission proves a verified owner session made it. Both are required, so
    // an unattributed APPROVE (older, or written outside an owner action) is
    // never published from here.
    return isAyasOwnerApprovedDecisionReason(decision?.reason) && isAyasApprovalDecisionOwnerAdmitted(decision, proposal) && !!decision && checkAyasOwnerExecutionAdmission(decision, deps.executionOwnerAdmission, { kind: "proposal", proposalId: proposal.proposalId, proposalHash: proposal.proposalHash, decision: "EXECUTE" }, new Date().toISOString(), new Set(state.decisions.flatMap(d => [d.ownerAdmission?.actionRef, d.executionOwnerAdmission?.actionRef]).filter((v): v is string => !!v)));
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
