/**
 * The durable marker that distinguishes an owner-approval-model APPROVE
 * (`AyasAutonomousExecutionGate.decideAyasOwnerApproval`) from the older,
 * separate manual "ONAYLA" flow (`decideAyasApproval` in `app/brain/actions.ts`).
 * Both currently land on the exact same `AyasInboxProposalStatus = "APPROVED"`
 * — this module is the one place that says which path produced it, reusing
 * the SAME `AyasInboxDecisionRecord.reason` provenance-prefix convention
 * `AyasAutonomousExecutionGate` already uses for REJECT ("owner-rejected:")
 * and `AyasAutonomousReview` already uses for its own internal REJECT/DEFER
 * ("ayas-internal:") — no new store field, no schema bump.
 *
 * Unlike those two, THIS prefix is read back and machine-matched (by the
 * resume worker and by the view layer), not just shown to a human, so it is
 * centralized here as a real exported contract instead of being duplicated
 * as an inline string literal in every reader.
 */

export const AYAS_OWNER_APPROVED_REASON_PREFIX = "owner-approved:";

export const AYAS_OWNER_APPROVED_PENDING_EXECUTION_REASON = `${AYAS_OWNER_APPROVED_REASON_PREFIX} pending execution enablement`;

/** Prefix AYAS's own internal review (`AyasAutonomousReview`) puts on every REJECT/LATER it records. */
export const AYAS_INTERNAL_REVIEW_REASON_PREFIX = "ayas-internal:";

/** True for a decision AYAS recorded itself; every other decision came from a human path. */
export function isAyasInternalReviewDecisionReason(reason: string | undefined): boolean {
  return typeof reason === "string" && reason.startsWith(AYAS_INTERNAL_REVIEW_REASON_PREFIX);
}

/** True only for a decision `reason` written by the owner-approval model's own APPROVE path — never true for a legacy manual `decideAyasApproval` APPROVE (whose `reason` is either absent or operator-authored free text that was never asked to start with this exact prefix). */
export function isAyasOwnerApprovedDecisionReason(reason: string | undefined): boolean {
  return typeof reason === "string" && reason.startsWith(AYAS_OWNER_APPROVED_REASON_PREFIX);
}
