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
import { loadBrainSelfHealSnapshot } from "@/lib/brain/ui/BrainSelfHealConsoleSnapshot";
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
} from "./actions";
// Stage 7A: read-only inbox refresh comes from its own observer-only action
// module, independent of the Package B decision action above.
import { refreshAyasApprovalInbox, refreshAyasMicroBatch, refreshAyasGoalDevelopment } from "./observerActions";

export const dynamic = "force-dynamic";

export default async function BrainCorePage() {
  const [snapshot, modelConfigured, autonomous, approvalInbox, microBatch] = await Promise.all([
    loadBrainConsoleSnapshot(),
    ayasModelConfigured(),
    loadAyasAutonomousView(),
    loadAyasApprovalInboxView(),
    loadAyasMicroBatchDevelopmentView(),
  ]);
  // Read-only self-healing state (incidents / repairs / learning). Fail-soft.
  const selfHeal = loadBrainSelfHealSnapshot();
  // Read-only goal + external-research state (M22.14). Fail-soft (its own loader never throws).
  const goalDevelopment = loadAyasGoalDevelopmentView();
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
      initialSelfHeal={selfHeal}
      modelConfigured={modelConfigured}
      refresh={refreshBrainConsole}
      refreshSelfHeal={refreshBrainSelfHeal}
      refreshApprovalInbox={refreshAyasApprovalInbox}
      refreshMicroBatch={refreshAyasMicroBatch}
      refreshGoalDevelopment={refreshAyasGoalDevelopment}
      decideApproval={decideAyasApproval}
      executeProposal={executeAyasApprovedProposal}
      batchOnaylaVeUygula={batchOnaylaVeUygula}
      proposalOnaylaVeUygula={proposalOnaylaVeUygula}
      recordSelfHealDecision={recordSelfHealDecision}
      askAyas={askAyas}
    />
  );
}
