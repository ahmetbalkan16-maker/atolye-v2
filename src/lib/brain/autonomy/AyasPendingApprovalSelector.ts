import type { AyasApprovalInboxView, AyasDevelopmentProposal } from "./AyasApprovalInboxView";

/** Read-only owner-approval projection shared by both Brain surfaces. The
 * inbox view has already applied the durable store's deferred eligibility rule. */
export function selectAyasPendingOwnerApprovals(inbox: AyasApprovalInboxView): readonly AyasDevelopmentProposal[] {
  if (!inbox.connected) return [];
  return inbox.pending.filter((proposal) =>
    (proposal.status === "PENDING" || proposal.status === "DEFERRED")
    && proposal.displayState === "NORMAL"
    && proposal.safetyClassification === "SAFE"
    && proposal.approvalReady,
  );
}
