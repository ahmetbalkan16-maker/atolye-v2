/**
 * Read-only view model for the owner-facing recommendation surface —
 * same posture as `AyasApprovalInboxView.ts` / `AyasMicroBatchDevelopmentView.ts`:
 * no mutating authority in this file's import chain, safe to call from a
 * plain page-render refresh. Never calls `AyasApprovalInboxHandle.decide()` —
 * durably recording REJECT/DEFER is the daemon's job
 * (`AyasAutonomousReview.reviewAyasPendingProposals`), not a page load's.
 *
 * Only ever returns `RECOMMEND_FOR_APPROVAL` + `executable: true` proposals —
 * exactly what Step 3 of the owner-approval model requires: the owner sees
 * nothing AYAS hasn't already internally filtered, and nothing the real
 * execution authority (`AyasApprovalInboxStore.decide`, SAFE-only) would
 * refuse anyway.
 */

import { createAyasApprovalInboxStore, type AyasApprovalInboxHandle } from "./AyasApprovalInboxStore";
import { evaluateAyasInternalDecision } from "./AyasInternalDecision";
import { buildAyasOwnerApprovalRequest, type AyasOwnerApprovalRequest } from "./AyasOwnerApprovalRequest";
import { bindAyasOwnerApproval, type AyasApprovalBindingSnapshot } from "./AyasApprovalBinding";
import { isAyasOwnerApprovedDecisionReason } from "./AyasOwnerApprovalProvenance";
import { isAyasApprovalDecisionOwnerAdmitted } from "./AyasOwnerApprovalAdmission";

/**
 * What the owner's ONAYLA will actually do, so the confirmation text never
 * promises more than happens. Mirrors the branch order of
 * `AyasAutonomousExecutionGate.decideAyasOwnerApproval`: an exact reviewed
 * patch is only ever recorded for local governed execution, and with live
 * execution off every APPROVE is only recorded. Display only — the gate
 * re-decides on the click and remains the authority.
 */
export type AyasOwnerAfterApproval = "EXECUTES_AND_PUBLISHES" | "WAITS_FOR_MANUAL_EXECUTE";

export interface AyasOwnerRecommendation {
  readonly request: AyasOwnerApprovalRequest;
  readonly binding: AyasApprovalBindingSnapshot;
  readonly afterApproval: AyasOwnerAfterApproval;
}

/**
 * Same test as `AyasAutonomousExecutionGate.isAyasAutonomousExecutionEnabled`,
 * kept local so this read-only view does not import the gate and, through
 * it, the execution/publication services. A smoke compares the two.
 */
export function isAyasLiveExecutionEnabledForDisplay(env: Record<string, string | undefined> = process.env): boolean {
  return env.AYAS_AUTONOMOUS_EXECUTION_ENABLED === "1";
}

export function ayasOwnerAfterApproval(proposal: { readonly exactPatchSafetyProof?: unknown }, env: Record<string, string | undefined> = process.env): AyasOwnerAfterApproval {
  return !proposal.exactPatchSafetyProof && isAyasLiveExecutionEnabledForDisplay(env) ? "EXECUTES_AND_PUBLISHES" : "WAITS_FOR_MANUAL_EXECUTE";
}

/**
 * A proposal the owner durably APPROVED through the owner-approval model that
 * has not run yet: an exact reviewed patch (always local governed execution),
 * or any APPROVE recorded while live execution was off. Nothing resumes it
 * automatically (owner policy 2026-10-08: no automatic resume, a fresh manual
 * EXECUTE is required). The card offers the manual YÜRÜT only when
 * `manualExecution` is `AVAILABLE`, i.e. the APPROVE carries a sealed owner
 * admission for exactly this proposal and hash — the same check
 * `executeAyasApprovedProposal` makes before executing. An older or
 * unattributed APPROVE is `OWNER_ADMISSION_MISSING` and is never offered.
 */
export interface AyasOwnerPendingExecutionEntry {
  readonly proposalId: string;
  readonly wantsTo: string;
  readonly approvedAt: string;
  readonly manualExecution: "AVAILABLE" | "OWNER_ADMISSION_MISSING";
}

export interface AyasOwnerRecommendationsView {
  readonly connected: boolean;
  readonly error?: string;
  readonly recommendations: readonly AyasOwnerRecommendation[];
  readonly pendingExecution: readonly AyasOwnerPendingExecutionEntry[];
}

/** A verification error must not disconnect the whole view; it only withholds YÜRÜT. */
function ownerAdmittedForDisplay(...args: Parameters<typeof isAyasApprovalDecisionOwnerAdmitted>): boolean {
  try { return isAyasApprovalDecisionOwnerAdmitted(...args); } catch { return false; }
}

export function loadAyasOwnerRecommendationsView(inbox: AyasApprovalInboxHandle = createAyasApprovalInboxStore(), env: Record<string, string | undefined> = process.env): AyasOwnerRecommendationsView {
  try {
    const now = new Date().toISOString();
    const state = inbox.load();
    const recommendations: AyasOwnerRecommendation[] = [];
    const pendingExecution: AyasOwnerPendingExecutionEntry[] = [];
    for (const proposal of state.proposals) {
      if (proposal.status === "APPROVED") {
        const decision = [...state.decisions].reverse().find((d) => d.proposalId === proposal.proposalId && d.decision === "APPROVE");
        if (isAyasOwnerApprovedDecisionReason(decision?.reason)) {
          pendingExecution.push({
            proposalId: proposal.proposalId,
            wantsTo: proposal.objective || "belirtilmemiş bir geliştirme",
            approvedAt: decision?.decidedAt ?? proposal.lastUpdatedAt,
            manualExecution: ownerAdmittedForDisplay(decision, proposal) ? "AVAILABLE" : "OWNER_ADMISSION_MISSING",
          });
        }
        continue;
      }
      if (proposal.status !== "PENDING") continue;
      const decision = evaluateAyasInternalDecision(proposal);
      if (decision.decision !== "RECOMMEND_FOR_APPROVAL" || !decision.executable) continue;
      recommendations.push({ request: buildAyasOwnerApprovalRequest(proposal, decision), binding: bindAyasOwnerApproval(proposal, now), afterApproval: ayasOwnerAfterApproval(proposal, env) });
    }
    return { connected: true, recommendations, pendingExecution };
  } catch (error) {
    return { connected: false, error: error instanceof Error ? error.message : String(error), recommendations: [], pendingExecution: [] };
  }
}
