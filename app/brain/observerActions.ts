"use server";

/**
 * Stage 7A — read-only observer/inbox Server Actions.
 *
 * `refreshAyasApprovalInbox` re-reads the durable approval-inbox file
 * (read-only) for display. This module's import chain never reaches a
 * mutating authority module — it cannot mint or consume authorization and
 * cannot reach the execution gate. The Package B decision action lives in a
 * separate module and is deliberately NOT re-exported or imported here — it
 * stays out of the Stage 7A dependency closure.
 */

import { loadAyasApprovalInboxView, type AyasApprovalInboxView } from "@/lib/brain/autonomy/AyasApprovalInboxView";
import { loadAyasMicroBatchDevelopmentView, type AyasMicroBatchDevelopmentView } from "@/lib/brain/autonomy/AyasMicroBatchDevelopmentView";
import { loadAyasGoalDevelopmentView, type AyasGoalDevelopmentView } from "@/lib/brain/autonomy/AyasGoalDevelopmentView";
import { loadAyasResearchEngineStatusView, type AyasResearchEngineStatusView } from "@/lib/brain/autonomy/AyasResearchEngineStatusView";
import { loadAyasOwnerRecommendationsView, type AyasOwnerRecommendationsView } from "@/lib/brain/autonomy/AyasOwnerRecommendationsView";

export async function refreshAyasApprovalInbox(): Promise<AyasApprovalInboxView> {
  return loadAyasApprovalInboxView();
}

// Owner-approval model — read-only, same posture as the refresh above: no
// mutating authority module in this file's import chain. Only ever surfaces
// proposals AYAS has already internally filtered to RECOMMEND_FOR_APPROVAL
// + executable; REJECT/DEFER are durably recorded by the daemon
// (`AyasAutonomousReview.reviewAyasPendingProposals`), never by this refresh.
export async function refreshAyasOwnerRecommendations(): Promise<AyasOwnerRecommendationsView> {
  return loadAyasOwnerRecommendationsView();
}

// M18 — read-only micro-batch refresh, same posture as the proposal inbox
// refresh above: no mutating authority module in this file's import chain.
export async function refreshAyasMicroBatch(): Promise<AyasMicroBatchDevelopmentView> {
  return loadAyasMicroBatchDevelopmentView();
}

// M22.14 — read-only goal + external-research refresh, same posture as
// every other refresh in this file: no mutating authority module in this
// file's import chain (AyasGoalStore/AyasExternalResearchStore expose no
// execute/approve/gate method at all — see their own smoke tests).
export async function refreshAyasGoalDevelopment(): Promise<AyasGoalDevelopmentView> {
  return loadAyasGoalDevelopmentView();
}

// AYAS CONTINUOUS EXTERNAL INTELLIGENCE sprint, Part O — read-only research
// engine (scheduler + source registry) status refresh, same posture as
// every other refresh in this file: no mutating authority module in this
// file's import chain.
export async function refreshAyasResearchEngineStatus(): Promise<AyasResearchEngineStatusView> {
  return loadAyasResearchEngineStatusView();
}
