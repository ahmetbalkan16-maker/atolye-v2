import type { AyasApprovalInboxHandle, AyasInboxProposal } from "./AyasApprovalInboxStore";

/**
 * M16 — pure staleness reconciliation. Transitions every PENDING/APPROVED
 * proposal whose immutable `baseHead` no longer matches `currentHead` to
 * `STALE` via the store's own guarded `markStale`. This module imports
 * nothing from `AyasAutonomyDaemon`, `AyasExecutionGateStore`,
 * `AyasMutationRegistry`, or any other execution/authority module — it can
 * never reserve, execute, open a gate, or write source, which is what makes
 * it safe to call from both write-capable Server Actions (before honoring a
 * decision or execution attempt) and the continuously-running observer
 * daemon (before/alongside proposal discovery).
 */
export function reconcileAyasStaleProposals(inbox: AyasApprovalInboxHandle, currentHead: string, now: string): readonly AyasInboxProposal[] {
  const state = inbox.load();
  const stale = state.proposals.filter((proposal) => (proposal.status === "PENDING" || proposal.status === "APPROVED") && proposal.baseHead !== currentHead);
  return stale.map((proposal) => inbox.markStale(proposal.proposalId, now));
}
