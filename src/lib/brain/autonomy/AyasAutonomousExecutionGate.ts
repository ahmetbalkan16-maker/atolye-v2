/**
 * The final policy decision before real mutation — deliberately separate
 * from `AyasInternalDecision`'s classification-time judgment. Corrected
 * authority model: AYAS reviews and recommends, the owner gives exactly one
 * APPROVE/REJECT, and only then does this gate run, re-checking everything
 * fresh immediately before delegating to the real execution service. This
 * is the module the brief calls "AUTONOMOUS_EXECUTION_ELIGIBLE" — it is not
 * "if classification === SAFE then execute"; a SAFE classification is only
 * one of several independently-checked preconditions.
 *
 * Reuses, never duplicates, the existing end-to-end execute→test→commit→
 * push pipeline (`AyasProposalApprovalService.approveAndExecuteAyasProposal`)
 * — that service already re-validates proposalHash/safetyClassification/
 * mutationKind itself and re-derives content from the frozen patch artifact
 * (`AyasPatchArtifactMutation`) at execution time, so this gate's own
 * revalidation is defense in depth against the TOCTOU window between the
 * owner's click and this call, not a replacement for it.
 *
 * Fails closed by default: `isAyasAutonomousExecutionEnabled()` must return
 * true (env-var opt-in, off by default) before ANY approve path can reach
 * real execution — REJECT always works regardless of the flag, since
 * recording a rejection is not a mutation.
 *
 * Durable one-click correction: the owner's APPROVE click is a decision, not
 * a request to execute — the two must not be conflated. So APPROVE is
 * durably recorded via the SAME `AyasApprovalInboxHandle.decide()` primitive
 * REJECT already used, in EVERY case (not only when the flag happens to be
 * on): a `PENDING` proposal always becomes `APPROVED` here. Only what
 * happens AFTER that differs — enabled, this reuses the exact
 * `AyasProposalApprovalService.approveAndExecuteAyasProposal` mutation
 * primitive to execute/test/commit/push immediately; disabled, execution is
 * simply deferred, and `AyasOwnerApprovalResume.ts` is the narrow worker
 * that later reuses the SAME primitive (via
 * `publishAlreadyOwnerApprovedAyasProposal`) once the flag is turned on —
 * never a second owner click, never a parallel authority store. A hard
 * reload or process restart reads this durable status back exactly as
 * written, because it lives in `approval-inbox.json`, not React state.
 */

import { approveAndExecuteAyasProposal, type AyasProposalApprovalDeps, type AyasProposalApprovalOutcome } from "./AyasProposalApprovalService";
import { reevaluateAyasApprovalBinding, type AyasApprovalBindingInvalidReason, type AyasApprovalBindingSnapshot } from "./AyasApprovalBinding";
import { AYAS_OWNER_APPROVED_PENDING_EXECUTION_REASON } from "./AyasOwnerApprovalProvenance";
import type { AyasApprovalInboxHandle } from "./AyasApprovalInboxStore";

/** Off unless explicitly set to "1" — no existing repo-wide convention for a boolean autonomy kill switch was found (the provider-router env vars are select-one-of-N, a different shape), so this introduces the narrowest new one rather than reusing a mismatched pattern. */
export const AYAS_AUTONOMOUS_EXECUTION_ENV_VAR = "AYAS_AUTONOMOUS_EXECUTION_ENABLED";

export function isAyasAutonomousExecutionEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env[AYAS_AUTONOMOUS_EXECUTION_ENV_VAR] === "1";
}

export type AyasOwnerDecision = "APPROVE" | "REJECT";

export type AyasAutonomousGateDenialReason = "AUTONOMOUS_EXECUTION_DISABLED" | "NOT_EXECUTABLE_CLASSIFICATION" | AyasApprovalBindingInvalidReason;

export type AyasAutonomousGateOutcome =
  | { readonly executed: true; readonly result: AyasProposalApprovalOutcome & { readonly ok: true } }
  | { readonly executed: false; readonly reason: "OWNER_REJECTED" }
  /** The owner's APPROVE was valid and is now durably recorded (`AyasInboxProposalStatus = "APPROVED"`); live execution is simply off right now. Not an error — `AyasOwnerApprovalResume.ts` will pick this proposal up automatically once `AYAS_AUTONOMOUS_EXECUTION_ENABLED` is set, with no further owner action. */
  | { readonly executed: false; readonly reason: "APPROVED_PENDING_EXECUTION" }
  | { readonly executed: false; readonly reason: AyasAutonomousGateDenialReason; readonly detail: string }
  | { readonly executed: false; readonly reason: "EXECUTION_FAILED"; readonly result: AyasProposalApprovalOutcome & { readonly ok: false } };

export interface AyasAutonomousGateDeps extends AyasProposalApprovalDeps {
  readonly inbox: AyasApprovalInboxHandle;
  readonly now?: () => string;
  readonly envOverride?: Record<string, string | undefined>;
}

/**
 * The single entry point a future owner-facing UI action calls. Never
 * called automatically by any daemon tick — only in direct response to an
 * owner's explicit APPROVE/REJECT on a specific binding.
 */
export async function decideAyasOwnerApproval(
  binding: AyasApprovalBindingSnapshot,
  ownerDecision: AyasOwnerDecision,
  deps: AyasAutonomousGateDeps,
): Promise<AyasAutonomousGateOutcome> {
  const now = deps.now ?? (() => new Date().toISOString());

  if (ownerDecision === "REJECT") {
    // Recording a rejection is never a mutation of product code — always
    // allowed, regardless of the autonomous-execution flag. The
    // "owner-rejected:" prefix is the durable signal that distinguishes this
    // from AYAS's own internal auto-reject (`AyasAutonomousReview`, which
    // prefixes "ayas-internal:") — both land on the same `REJECTED` status,
    // so `reason` is the one field that keeps the two provenances
    // distinguishable without a parallel status enum.
    deps.inbox.decide(binding.proposalId, "REJECT", now(), "owner-rejected: explicit REJECT via owner approval UI");
    return { executed: false, reason: "OWNER_REJECTED" };
  }

  // --- APPROVE path: revalidate everything fresh before touching anything ---
  const current = deps.inbox.load().proposals.find((p) => p.proposalId === binding.proposalId);
  const evaluation = reevaluateAyasApprovalBinding(binding, current);
  if (!evaluation.valid) {
    return { executed: false, reason: evaluation.reason, detail: evaluation.detail };
  }

  if (current!.safetyClassification !== "SAFE") {
    return {
      executed: false,
      reason: "NOT_EXECUTABLE_CLASSIFICATION",
      detail: `safetyClassification is ${current!.safetyClassification} — the existing approval-inbox invariant refuses to execute anything that is not SAFE, regardless of any recommendation`,
    };
  }

  if (!isAyasAutonomousExecutionEnabled(deps.envOverride)) {
    // Durably record the owner's APPROVE right now, even though live
    // execution is deferred — this is the fix for the prior client-only
    // (`useState<Set>`) approach: that hid the duplicate UI for the current
    // browser tab only, while the underlying proposal silently stayed
    // PENDING forever. `decide()` is the SAME durable primitive REJECT above
    // already uses; the "owner-approved:" reason prefix is what lets
    // `AyasOwnerApprovalResume.ts` and the view layer tell this apart from a
    // legacy manual `decideAyasApproval` APPROVE later.
    deps.inbox.decide(binding.proposalId, "APPROVE", now(), AYAS_OWNER_APPROVED_PENDING_EXECUTION_REASON);
    return { executed: false, reason: "APPROVED_PENDING_EXECUTION" };
  }

  const result = await approveAndExecuteAyasProposal(binding.proposalId, binding.proposalHash, deps);
  if (!result.ok) {
    return { executed: false, reason: "EXECUTION_FAILED", result };
  }
  return { executed: true, result };
}
