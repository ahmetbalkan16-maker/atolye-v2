/** Existing source readers + diagnostic metadata. No alternate execution/approval path. */
import { loadAyasControlCenterFacts } from "../../brain/ui/AyasControlCenterCollector";
import { loadAyasApprovalInboxView } from "../../brain/autonomy/AyasApprovalInboxView";
import { loadAyasMicroBatchDevelopmentView } from "../../brain/autonomy/AyasMicroBatchDevelopmentView";
import { loadAyasOwnerRecommendationsView } from "../../brain/autonomy/AyasOwnerRecommendationsView";
import { loadAyasResearchEngineStatusView } from "../../brain/autonomy/AyasResearchEngineStatusView";
import { loadAyasGoalDevelopmentView } from "../../brain/autonomy/AyasGoalDevelopmentView";
import { loadAyasAutonomousView } from "../../brain/autonomy/AyasAutonomousView";
import { loadBrainSelfHealSnapshot } from "../../brain/ui/BrainSelfHealConsoleSnapshot";
import { readAyasReliabilityState } from "../observability/AyasReliabilityState";
import { buildAyasExecutiveBriefing, type AyasBriefingReliabilityFact } from "./AyasExecutiveBriefing";
import { projectAyasExecutiveOwnerView, type AyasExecutiveOwnerView } from "./AyasExecutiveOwnerView";
export type { AyasExecutiveOwnerView, AyasExecutiveAlertView } from "./AyasExecutiveOwnerView";
export async function loadAyasExecutiveOwnerView(input: { readonly synchronize: boolean; readonly ownerAuthenticated: boolean }): Promise<AyasExecutiveOwnerView> {
  const [server,approvalInbox,microBatch,ownerRecommendations,researchEngineStatus,goalDevelopment,autonomous] = await Promise.all([
    // Same last resort as /brain: a failed read model renders every server domain unavailable.
    loadAyasControlCenterFacts().catch(() => null),loadAyasApprovalInboxView(),loadAyasMicroBatchDevelopmentView(),loadAyasOwnerRecommendationsView(),
    loadAyasResearchEngineStatusView(),loadAyasGoalDevelopmentView(),loadAyasAutonomousView(),
  ]);
  let reliability: AyasBriefingReliabilityFact;
  try { reliability = { kind: "ok", value: readAyasReliabilityState() }; } catch { reliability = { kind: "unavailable" }; }
  const selfHeal = loadBrainSelfHealSnapshot(), briefing = buildAyasExecutiveBriefing({server,approvalInbox,microBatch,ownerRecommendations,researchEngineStatus,goalDevelopment,autonomous,
    reportCenter:selfHeal.error ? null : selfHeal.reportCenter, reportCenterUnavailable:selfHeal.error !== null, reliability});
  return projectAyasExecutiveOwnerView({ briefing, repoRoot: process.cwd(), now: new Date().toISOString(), synchronize: input.synchronize, ownerAuthenticated: input.ownerAuthenticated });
}
