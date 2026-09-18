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

export interface AyasOwnerRecommendation {
  readonly request: AyasOwnerApprovalRequest;
  readonly binding: AyasApprovalBindingSnapshot;
}

/**
 * A proposal the owner already durably APPROVED while live execution was
 * off — Step 3/4 of the durable one-click correction. Shown as a plain,
 * non-actionable "ONAYLANDI" card: no ONAYLA, no REJECT, no VAZGEÇ, because
 * the owner's decision already happened and is already durably recorded.
 * `AyasOwnerApprovalResume.ts` is what later turns this into a real
 * execution once `AYAS_AUTONOMOUS_EXECUTION_ENABLED` is set — never a second
 * click here.
 */
export interface AyasOwnerPendingExecutionEntry {
  readonly proposalId: string;
  readonly wantsTo: string;
  readonly approvedAt: string;
}

export interface AyasOwnerRecommendationsView {
  readonly connected: boolean;
  readonly error?: string;
  readonly recommendations: readonly AyasOwnerRecommendation[];
  readonly pendingExecution: readonly AyasOwnerPendingExecutionEntry[];
}

export function loadAyasOwnerRecommendationsView(inbox: AyasApprovalInboxHandle = createAyasApprovalInboxStore()): AyasOwnerRecommendationsView {
  try {
    const now = new Date().toISOString();
    const state = inbox.load();
    const recommendations: AyasOwnerRecommendation[] = [];
    const pendingExecution: AyasOwnerPendingExecutionEntry[] = [];
    for (const proposal of state.proposals) {
      if (proposal.status === "APPROVED") {
        const decision = [...state.decisions].reverse().find((d) => d.proposalId === proposal.proposalId && d.decision === "APPROVE");
        if (isAyasOwnerApprovedDecisionReason(decision?.reason)) {
          pendingExecution.push({ proposalId: proposal.proposalId, wantsTo: proposal.objective || "belirtilmemiş bir geliştirme", approvedAt: decision?.decidedAt ?? proposal.lastUpdatedAt });
        }
        continue;
      }
      if (proposal.status !== "PENDING") continue;
      const decision = evaluateAyasInternalDecision(proposal);
      if (decision.decision !== "RECOMMEND_FOR_APPROVAL" || !decision.executable) continue;
      recommendations.push({ request: buildAyasOwnerApprovalRequest(proposal, decision), binding: bindAyasOwnerApproval(proposal, now) });
    }
    return { connected: true, recommendations, pendingExecution };
  } catch (error) {
    return { connected: false, error: error instanceof Error ? error.message : String(error), recommendations: [], pendingExecution: [] };
  }
}
