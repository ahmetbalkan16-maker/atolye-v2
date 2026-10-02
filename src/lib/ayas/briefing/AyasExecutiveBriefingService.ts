/** Existing source readers + diagnostic metadata. No alternate execution/approval path. */
import { loadAyasControlCenterFacts } from "../../brain/ui/AyasControlCenterCollector";
import { loadAyasApprovalInboxView } from "../../brain/autonomy/AyasApprovalInboxView";
import { loadAyasMicroBatchDevelopmentView } from "../../brain/autonomy/AyasMicroBatchDevelopmentView";
import { loadAyasOwnerRecommendationsView } from "../../brain/autonomy/AyasOwnerRecommendationsView";
import { loadAyasResearchEngineStatusView } from "../../brain/autonomy/AyasResearchEngineStatusView";
import { loadAyasGoalDevelopmentView } from "../../brain/autonomy/AyasGoalDevelopmentView";
import { loadAyasAutonomousView } from "../../brain/autonomy/AyasAutonomousView";
import { loadBrainSelfHealSnapshot } from "../../brain/ui/BrainSelfHealConsoleSnapshot";
import { ayasSafeModeHold } from "../safety/AyasSafeModeReader";
import { buildAyasExecutiveBriefing } from "./AyasExecutiveBriefing";
import { observeDurableAyasExecutiveSignals, readAyasExecutiveAlerts } from "./AyasExecutiveAlertStore";
import { emptyAyasExecutiveAlerts, observeAyasExecutiveSignals, executiveNotificationEligible, type AyasExecutiveAlert } from "./AyasExecutiveAlerts";
export interface AyasExecutiveAlertView extends AyasExecutiveAlert { readonly notificationEligible: boolean }
export type AyasExecutiveOwnerView = ReturnType<typeof buildAyasExecutiveBriefing> & {
  readonly persistence: "VERIFIED" | "PREVIEW" | "UNAVAILABLE" | "HELD_BY_SAFE_MODE";
  readonly alerts: readonly AyasExecutiveAlertView[]; readonly ownerAuthenticated: boolean;
};
export async function loadAyasExecutiveOwnerView(input: { readonly synchronize: boolean; readonly ownerAuthenticated: boolean }): Promise<AyasExecutiveOwnerView> {
  const [server,approvalInbox,microBatch,ownerRecommendations,researchEngineStatus,goalDevelopment,autonomous] = await Promise.all([
    loadAyasControlCenterFacts(),loadAyasApprovalInboxView(),loadAyasMicroBatchDevelopmentView(),loadAyasOwnerRecommendationsView(),
    loadAyasResearchEngineStatusView(),loadAyasGoalDevelopmentView(),loadAyasAutonomousView(),
  ]);
  const selfHeal = loadBrainSelfHealSnapshot(), briefing = buildAyasExecutiveBriefing({server,approvalInbox,microBatch,ownerRecommendations,researchEngineStatus,goalDevelopment,autonomous,
    reportCenter:selfHeal.error ? null : selfHeal.reportCenter});
  const now = new Date().toISOString(), root = process.cwd(), read = readAyasExecutiveAlerts(root);
  let persistence: AyasExecutiveOwnerView["persistence"] = read.status === "UNAVAILABLE" ? "UNAVAILABLE" : "PREVIEW";
  let state = observeAyasExecutiveSignals(read.status === "UNAVAILABLE" ? emptyAyasExecutiveAlerts() : read.state,briefing.signals,briefing.covered,now);
  if (ayasSafeModeHold(root)) persistence = "HELD_BY_SAFE_MODE";
  else if (input.synchronize && input.ownerAuthenticated && read.status !== "UNAVAILABLE") {
    try { const saved = observeDurableAyasExecutiveSignals({repoRoot:root,signals:briefing.signals,covered:briefing.covered,at:now}); state = saved.state; persistence = "VERIFIED"; }
    catch { persistence = "UNAVAILABLE"; }
  }
  return { ...briefing,persistence,ownerAuthenticated:input.ownerAuthenticated,
    alerts:state.alerts.filter(a => a.active).map(a => ({...a,notificationEligible:persistence === "VERIFIED" && executiveNotificationEligible(a,now)})) };
}
