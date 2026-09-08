/**
 * Atölye Brain Core — `/brain`.
 *
 * A Server Component: it reads the Brain's real durable state (task queue, last
 * worker cycle, experience store, a conservative safety verdict) once, on the
 * server, and hands it to the client console. No production, model, GPU or
 * network call happens here — the execution gate is closed.
 */

import { BrainCoreConsole } from "@/components/brain/BrainCoreConsole";
import { loadBrainConsoleSnapshot } from "@/lib/brain/ui/BrainConsoleSnapshot";
import { refreshBrainConsole } from "./actions";

export const dynamic = "force-dynamic";

export default async function BrainCorePage() {
  const snapshot = await loadBrainConsoleSnapshot();
  return <BrainCoreConsole initialSnapshot={snapshot} refresh={refreshBrainConsole} />;
}
