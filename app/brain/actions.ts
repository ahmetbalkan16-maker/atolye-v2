"use server";

/**
 * Atölye Brain Core — server actions (Sprint 184).
 *
 * Read-only. `refreshBrainConsole` re-reads the Brain's durable state and
 * returns a fresh snapshot. There is no action here that runs a task, a model,
 * the pipeline, or the GPU — the execution gate stays closed.
 */

import {
  loadBrainConsoleSnapshot,
  type BrainConsoleSnapshot,
} from "@/lib/brain/ui/BrainConsoleSnapshot";

export async function refreshBrainConsole(): Promise<BrainConsoleSnapshot> {
  return loadBrainConsoleSnapshot();
}
