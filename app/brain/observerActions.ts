"use server";

/**
 * Stage 7A — display-oriented observer/inbox Server Actions.
 *
 * Before reading, this module may perform the one lifecycle-only mutation
 * permitted on a display boundary: PENDING/APPROVED/DEFERRED proposals and
 * ACCUMULATING/READY/APPROVED batches whose baseHead is obsolete become
 * STALE. It still cannot decide, approve, reserve, execute, mint/consume
 * authorization, touch source, or reach the execution gate.
 */

import { loadAyasApprovalInboxView, type AyasApprovalInboxView } from "@/lib/brain/autonomy/AyasApprovalInboxView";
import { loadAyasMicroBatchDevelopmentView, type AyasMicroBatchDevelopmentView } from "@/lib/brain/autonomy/AyasMicroBatchDevelopmentView";
import { loadAyasGoalDevelopmentView, type AyasGoalDevelopmentView } from "@/lib/brain/autonomy/AyasGoalDevelopmentView";
import { loadAyasResearchEngineStatusView, type AyasResearchEngineStatusView } from "@/lib/brain/autonomy/AyasResearchEngineStatusView";
import { loadAyasOwnerRecommendationsView, type AyasOwnerRecommendationsView } from "@/lib/brain/autonomy/AyasOwnerRecommendationsView";
import { reconcileAyasDevelopmentCenterFreshness } from "@/lib/brain/autonomy/AyasDevelopmentCenterReconciliation";
import { loadAyasControlCenterFacts } from "@/lib/brain/ui/AyasControlCenterCollector";
import type { AyasControlCenterServerFacts } from "@/lib/brain/ui/AyasControlCenterModel";

function reconcileForDisplay(): void {
  // Fail closed for presentation too: if HEAD or durable state cannot be
  // reconciled, do not return a possibly-zombie actionable projection.
  reconcileAyasDevelopmentCenterFreshness();
}

export async function refreshAyasApprovalInbox(): Promise<AyasApprovalInboxView> {
  reconcileForDisplay();
  return loadAyasApprovalInboxView();
}

// Owner-approval model — read-only, same posture as the refresh above: no
// mutating authority module in this file's import chain. Only ever surfaces
// proposals AYAS has already internally filtered to RECOMMEND_FOR_APPROVAL
// + executable; REJECT/DEFER are durably recorded by the daemon
// (`AyasAutonomousReview.reviewAyasPendingProposals`), never by this refresh.
export async function refreshAyasOwnerRecommendations(): Promise<AyasOwnerRecommendationsView> {
  reconcileForDisplay();
  return loadAyasOwnerRecommendationsView();
}

// M18 — read-only micro-batch refresh, same posture as the proposal inbox
// refresh above: no mutating authority module in this file's import chain.
export async function refreshAyasMicroBatch(): Promise<AyasMicroBatchDevelopmentView> {
  reconcileForDisplay();
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

// Stage 11 — Brain Control Center refresh. Read-only like every other action
// in this file: health, repository, Graphify, experiments, memory counts,
// capabilities, security and Atölye inventory, each through its existing
// read-only collector. It performs no reconciliation write of its own (the
// approval views above keep theirs) and cannot decide, approve or execute.
export async function refreshAyasControlCenter(): Promise<AyasControlCenterServerFacts> {
  return loadAyasControlCenterFacts();
}
