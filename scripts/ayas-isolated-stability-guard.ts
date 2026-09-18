import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createAyasStabilityTransactionStore } from "../src/lib/brain/autonomy/AyasRuntimeStabilityTransaction";
import { createAyasResearchSchedulerStateStore, ayasResearchSchedulerStateSchemaVersion } from "../src/lib/brain/autonomy/AyasResearchSchedulerStateStore";
import { createAyasApprovalInboxStore } from "../src/lib/brain/autonomy/AyasApprovalInboxStore";
import type { AyasGuardedPublicationGuardDeps } from "../src/lib/brain/autonomy/AyasGuardedPublication";

/**
 * Test-only wiring, shared by every smoke suite that publishes through
 * `runGuardedAyasPublication`.
 *
 * Since the Runtime Stability Guard is now part of the real mutation
 * lifecycle, a publication in a test would otherwise observe REAL runtime
 * state: the live research scheduler's cadence file and whatever is actually
 * listening on :3000. Those observations are read-only and harmless, but they
 * make a suite's verdict depend on live production state — a genuine research
 * tick recording a failure mid-run could fail an unrelated regression suite.
 *
 * This helper hands the guard an isolated transaction log, an isolated
 * scheduler state file seeded with a real cadence (so the scheduler health
 * check is genuinely ACTIVE rather than skipped), a fixed environment, and a
 * fake listener table. Nothing here is used in production, where the guard
 * deliberately binds to the real stores and the real ports.
 */
export function isolatedStabilityGuardDeps(options: {
  readonly listeners?: Map<number, number>;
  /**
   * Set only by a lane that does NOT hand the guard its own approval inbox —
   * the micro-batch lane, which has no inbox of its own. The individual
   * proposal lane must leave this off, because there the guard is deliberately
   * bound to the very inbox the publication mutates, and overriding it would
   * have the guard observe a different ledger than the one it is supervising.
   */
  readonly isolateApprovalInbox?: boolean;
} = {}): AyasGuardedPublicationGuardDeps & { readonly listeners: Map<number, number> } {
  const listeners = options.listeners ?? new Map<number, number>([[3000, 15844]]);

  const schedulerStore = createAyasResearchSchedulerStateStore({ rootDir: fs.mkdtempSync(path.join(os.tmpdir(), "ayas-guard-sched-")) });
  schedulerStore.write({
    schemaVersion: ayasResearchSchedulerStateSchemaVersion,
    nextLightAt: "2026-09-18T17:00:00.000Z",
    nextDeepAt: "2026-09-19T11:00:00.000Z",
    lastSuccessfulResearchAt: "2026-09-18T11:00:00.000Z",
    consecutiveFailures: 0,
  });

  return {
    listeners,
    store: createAyasStabilityTransactionStore({ rootDir: fs.mkdtempSync(path.join(os.tmpdir(), "ayas-guard-tx-")) }),
    observedPorts: [...listeners.keys()],
    snapshot: {
      schedulerStore,
      env: { AYAS_AUTONOMOUS_EXECUTION_ENABLED: "1", NODE_ENV: "test" },
      portProbe: (port: number) => listeners.get(port),
      commandProbe: () => "node fixture-server",
      ...(options.isolateApprovalInbox === true ? { inbox: createAyasApprovalInboxStore({ rootDir: fs.mkdtempSync(path.join(os.tmpdir(), "ayas-guard-inbox-")) }) } : {}),
    },
  };
}
