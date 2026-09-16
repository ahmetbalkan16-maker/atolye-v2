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
 *
 * M17 fix: DEFERRED is included in the reconciled set too, not just
 * PENDING/APPROVED. A DEFERRED proposal ("not now, ask again in 24h") whose
 * baseHead has since gone stale must not regain ordinary approval
 * eligibility once `nextEligibleAt` passes — its content is bound to a HEAD
 * that no longer exists, so "ask again later" no longer makes sense; it
 * needs the SAME terminal, non-executable, no-authorization-reuse handling
 * every other stale proposal gets. Discovered via a real live proposal
 * (deferred by an explicit human LATER decision, then superseded by a
 * later push) that stayed re-approvable-looking in the UI after
 * `nextEligibleAt` despite being permanently unexecutable — fail-closed at
 * execution time either way, but the lifecycle state itself was
 * inconsistent with every other stale proposal's terminal handling.
 */
export function reconcileAyasStaleProposals(inbox: AyasApprovalInboxHandle, currentHead: string, now: string): readonly AyasInboxProposal[] {
  const state = inbox.load();
  const RECONCILABLE_STATUSES: ReadonlySet<AyasInboxProposal["status"]> = new Set(["PENDING", "APPROVED", "DEFERRED"]);
  const stale = state.proposals.filter((proposal) => RECONCILABLE_STATUSES.has(proposal.status) && proposal.baseHead !== currentHead);
  return stale.map((proposal) => inbox.markStale(proposal.proposalId, now));
}
