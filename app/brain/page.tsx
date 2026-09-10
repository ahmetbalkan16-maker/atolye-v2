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
import { loadBrainSelfHealSnapshot } from "@/lib/brain/ui/BrainSelfHealConsoleSnapshot";
import { askAyas, ayasModelConfigured, refreshBrainConsole } from "./actions";

export const dynamic = "force-dynamic";

export default async function BrainCorePage() {
  const [snapshot, modelConfigured, autonomous] = await Promise.all([
    loadBrainConsoleSnapshot(),
    ayasModelConfigured(),
    loadAyasAutonomousView(),
  ]);
  // Read-only self-healing state (incidents / repairs / learning). Fail-soft.
  const selfHeal = loadBrainSelfHealSnapshot();
  // The operator-diagnostics links (Voice Lab / Audio Lab) live inside
  // `BrainConsoleView`'s `.bc-shell` footer now — a sibling <p> here inherited the
  // document colour scheme (dark-on-dark in iOS Light Mode) and sat below the
  // `min-height: 100dvh` console, so it read as "gone".
  return (
    <BrainCoreConsole
      initialSnapshot={snapshot}
      initialAutonomous={autonomous}
      initialSelfHeal={selfHeal}
      modelConfigured={modelConfigured}
      refresh={refreshBrainConsole}
      askAyas={askAyas}
    />
  );
}
