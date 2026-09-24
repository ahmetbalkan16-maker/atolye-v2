/**
 * Runs the internal AYAS review (`AyasInternalDecision`) over every PENDING
 * proposal and durably records REJECT/DEFER so they never need re-review
 * every tick — mirrors how staleness reconciliation
 * (`AyasProposalStaleness.reconcileAyasStaleProposals`) durably persists
 * its own verdict rather than recomputing it lazily on every read.
 * `RECOMMEND_FOR_APPROVAL` proposals are left untouched (still PENDING) and
 * returned as owner-approval-request objects — this is the only thing that
 * ever reaches an owner-facing surface.
 *
 * `DEFER` maps onto the existing `"LATER"` store decision (24h
 * `nextEligibleAt`, per `AyasApprovalInboxStore.decide`) — there is no
 * separate "DEFER" value in the store's own `AyasInboxDecision` union
 * (`"APPROVE" | "REJECT" | "LATER"`), so this reuses that existing
 * vocabulary rather than inventing a parallel status.
 */

import type { AyasApprovalInboxHandle } from "./AyasApprovalInboxStore";
import { evaluateAyasInternalDecision, type AyasInternalDecisionResult } from "./AyasInternalDecision";
import { buildAyasOwnerApprovalRequest, type AyasOwnerApprovalRequest } from "./AyasOwnerApprovalRequest";
import { bindAyasOwnerApproval, type AyasApprovalBindingSnapshot } from "./AyasApprovalBinding";
import { AYAS_INTERNAL_REVIEW_REASON_PREFIX } from "./AyasOwnerApprovalProvenance";

export interface AyasAutonomousReviewOutcome {
  readonly rejected: readonly { readonly proposalId: string; readonly decision: AyasInternalDecisionResult }[];
  readonly deferred: readonly { readonly proposalId: string; readonly decision: AyasInternalDecisionResult }[];
  readonly recommended: readonly { readonly request: AyasOwnerApprovalRequest; readonly binding: AyasApprovalBindingSnapshot }[];
}

export function reviewAyasPendingProposals(inbox: AyasApprovalInboxHandle, now: () => string = () => new Date().toISOString()): AyasAutonomousReviewOutcome {
  const state = inbox.load();
  const pending = state.proposals.filter((p) => p.status === "PENDING");

  const rejected: { proposalId: string; decision: AyasInternalDecisionResult }[] = [];
  const deferred: { proposalId: string; decision: AyasInternalDecisionResult }[] = [];
  const recommended: { request: AyasOwnerApprovalRequest; binding: AyasApprovalBindingSnapshot }[] = [];

  for (const proposal of pending) {
    const decision = evaluateAyasInternalDecision(proposal);
    if (decision.decision === "REJECT") {
      // Prefixed so a REJECTED record's own `reason` durably distinguishes
      // "AYAS rejected this before any owner ever saw it" from an owner's
      // explicit REJECT click (see `AyasAutonomousExecutionGate`'s
      // `decideAyasOwnerApproval`, which prefixes its own reason
      // "owner-rejected:") — both currently land on the same
      // `AyasInboxProposalStatus = "REJECTED"`, so this is the one durable
      // field that tells them apart without inventing a parallel status.
      inbox.decide(proposal.proposalId, "REJECT", now(), `${AYAS_INTERNAL_REVIEW_REASON_PREFIX} ${decision.reasons.join("; ")}`);
      rejected.push({ proposalId: proposal.proposalId, decision });
    } else if (decision.decision === "DEFER") {
      // Same provenance rationale as above, plus Step 7's "a deferred item
      // should contain or derive: reason for defer" — `reason` here already
      // is that reason, and `nextEligibleAt` (set by `decide()` itself,
      // `isAyasDeferredEligibleNow`-gated) is the bounded reconsideration
      // trigger, so no new field is needed to satisfy either requirement.
      inbox.decide(proposal.proposalId, "LATER", now(), `${AYAS_INTERNAL_REVIEW_REASON_PREFIX} ${decision.reasons.join("; ")}`);
      deferred.push({ proposalId: proposal.proposalId, decision });
    } else {
      recommended.push({ request: buildAyasOwnerApprovalRequest(proposal, decision), binding: bindAyasOwnerApproval(proposal, now()) });
    }
  }

  return { rejected, deferred, recommended };
}
