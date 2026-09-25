/**
 * Atölye Brain Core — `/brain` (AYAS).
 *
 * A Server Component: it reads the Brain's real durable state (task queue, last
 * worker cycle, experience store, a conservative safety verdict) once, on the
 * server, and hands it to the client console. The chat panel talks to the
 * existing local model through the `askAyas` Server Action. No production,
 * pipeline, GPU or paid-API call happens here — the execution gate is closed.
 */

import { BrainCoreConsole } from "@/components/brain/BrainCoreConsole";
import { loadBrainConsoleSnapshot } from "@/lib/brain/ui/BrainConsoleSnapshot";
import { loadAyasAutonomousView } from "@/lib/brain/autonomy/AyasAutonomousView";
import { loadAyasApprovalInboxView } from "@/lib/brain/autonomy/AyasApprovalInboxView";
import { loadAyasMicroBatchDevelopmentView } from "@/lib/brain/autonomy/AyasMicroBatchDevelopmentView";
import { loadAyasGoalDevelopmentView } from "@/lib/brain/autonomy/AyasGoalDevelopmentView";
import { loadAyasResearchEngineStatusView } from "@/lib/brain/autonomy/AyasResearchEngineStatusView";
import { loadBrainSelfHealSnapshot } from "@/lib/brain/ui/BrainSelfHealConsoleSnapshot";
import { loadAyasOwnerRecommendationsView } from "@/lib/brain/autonomy/AyasOwnerRecommendationsView";
import { reconcileAyasDevelopmentCenterFreshness } from "@/lib/brain/autonomy/AyasDevelopmentCenterReconciliation";
import { loadAyasControlCenterFacts } from "@/lib/brain/ui/AyasControlCenterCollector";
import {
  askAyas,
  ayasModelConfigured,
  batchOnaylaVeUygula,
  proposalOnaylaVeUygula,
  decideAyasApproval,
  executeAyasApprovedProposal,
  recordSelfHealDecision,
  refreshBrainConsole,
  refreshBrainSelfHeal,
  ayasOwnerApprovalDecision,
} from "./actions";
// Stage 7A: read-only inbox refresh comes from its own observer-only action
// module, independent of the Package B decision action above.
import { refreshAyasApprovalInbox, refreshAyasMicroBatch, refreshAyasGoalDevelopment, refreshAyasResearchEngineStatus, refreshAyasOwnerRecommendations, refreshAyasControlCenter } from "./observerActions";

export const dynamic = "force-dynamic";

export default async function BrainCorePage() {
  // Lifecycle-only reconciliation: a page read may retire HEAD-bound zombie
  // items to STALE, but can never approve, reserve, execute, or open a gate.
  // If it cannot complete, fail closed instead of rendering stale PENDING
  // state as actionable.
  reconcileAyasDevelopmentCenterFreshness();
  // Stage 11 — the Brain Control Center's server-side read (health, repository,
  // Graphify, experiments, memory counts, capabilities, security, Atölye). Not
  // awaited: it streams to the client, so the orb and chat render immediately.
  // The collector is fail-soft per source and never throws; the catch is a
  // last resort that renders every server domain as unavailable.
  const controlCenter = loadAyasControlCenterFacts().catch(() => null);
  const [snapshot, modelConfigured, autonomous, approvalInbox, microBatch] = await Promise.all([
    loadBrainConsoleSnapshot(),
    ayasModelConfigured(),
    loadAyasAutonomousView(),
    loadAyasApprovalInboxView(),
    loadAyasMicroBatchDevelopmentView(),
  ]);
  // Read-only self-healing state (incidents / repairs / learning). Fail-soft.
  const selfHeal = loadBrainSelfHealSnapshot();
  // Owner-approval model — read-only, AYAS's own already-filtered recommendations. Fail-soft (its own loader never throws).
  const ownerRecommendations = loadAyasOwnerRecommendationsView();
  // Read-only goal + external-research state (M22.14). Fail-soft (its own loader never throws).
  const goalDevelopment = loadAyasGoalDevelopmentView();
  // Read-only research-engine (scheduler + source registry) status. Fail-soft (its own loader never throws).
  const researchEngineStatus = loadAyasResearchEngineStatusView();
  // The operator-diagnostics links (Voice Lab / Audio Lab) live inside
  // `BrainConsoleView`'s `.bc-shell` footer now — a sibling <p> here inherited the
  // document colour scheme (dark-on-dark in iOS Light Mode) and sat below the
  // `min-height: 100dvh` console, so it read as "gone".
  return (
    <BrainCoreConsole
      initialSnapshot={snapshot}
      initialAutonomous={autonomous}
      initialApprovalInbox={approvalInbox}
      initialMicroBatch={microBatch}
      initialGoalDevelopment={goalDevelopment}
      initialResearchEngineStatus={researchEngineStatus}
      initialSelfHeal={selfHeal}
      initialOwnerRecommendations={ownerRecommendations}
      initialControlCenter={controlCenter}
      modelConfigured={modelConfigured}
      refresh={refreshBrainConsole}
      refreshSelfHeal={refreshBrainSelfHeal}
      refreshApprovalInbox={refreshAyasApprovalInbox}
      refreshMicroBatch={refreshAyasMicroBatch}
      refreshGoalDevelopment={refreshAyasGoalDevelopment}
      refreshResearchEngineStatus={refreshAyasResearchEngineStatus}
      refreshOwnerRecommendations={refreshAyasOwnerRecommendations}
      refreshControlCenter={refreshAyasControlCenter}
      decideApproval={decideAyasApproval}
      executeProposal={executeAyasApprovedProposal}
      batchOnaylaVeUygula={batchOnaylaVeUygula}
      proposalOnaylaVeUygula={proposalOnaylaVeUygula}
      ownerApprovalDecision={ayasOwnerApprovalDecision}
      recordSelfHealDecision={recordSelfHealDecision}
      askAyas={askAyas}
    />
  );
}
