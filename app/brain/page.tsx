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
import { askAyas, ayasModelConfigured, refreshBrainConsole } from "./actions";

export const dynamic = "force-dynamic";

export default async function BrainCorePage() {
  const [snapshot, modelConfigured, autonomous] = await Promise.all([
    loadBrainConsoleSnapshot(),
    ayasModelConfigured(),
    loadAyasAutonomousView(),
  ]);
  return (
    <>
      <BrainCoreConsole
        initialSnapshot={snapshot}
        initialAutonomous={autonomous}
        modelConfigured={modelConfigured}
        refresh={refreshBrainConsole}
        askAyas={askAyas}
      />
      {/* Operator diagnostics only — the user-facing voice experience is the
          AYAS card above ("AYAS ile sesli konuş"), not these labs. The installed
          PWA has no URL bar, so keep them reachable but clearly secondary. */}
      <p style={{ textAlign: "center", padding: "8px 0 24px", fontSize: 11, opacity: 0.45 }}>
        Operatör araçları:{" "}
        <a href="/brain/voice-lab" style={{ color: "inherit" }}>
          Audio Lab
        </a>
        {"  ·  "}
        <a href="/brain/voice-lab/wake" style={{ color: "inherit" }}>
          Wake Lab (diagnostics)
        </a>
      </p>
    </>
  );
}
