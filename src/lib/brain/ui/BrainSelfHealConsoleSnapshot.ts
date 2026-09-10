/**
 * Atölye Brain — Self-Healing / AYAS Report Center snapshot loader (Node, server-only).
 *
 * Reads the durable self-heal store and folds it into the read-only view models
 * for the `AYAS Raporları` Brain panel + the home status card. Fail-soft: a
 * missing store → the empty snapshot; a CORRUPT store → the empty snapshot with
 * an `error` note (the panel shows "store needs review" rather than crashing the
 * whole Brain page).
 */

import {
  buildBrainSelfHealSnapshot,
  EMPTY_BRAIN_SELFHEAL_SNAPSHOT,
  type BrainSelfHealSnapshot,
} from "@/lib/brain/selfheal/BrainSelfHealSnapshot";
import {
  buildBrainReportCenterView,
  EMPTY_BRAIN_REPORT_CENTER_VIEW,
  type BrainReportCenterView,
} from "@/lib/brain/selfheal/BrainReportCenter";
import { createBrainSelfHealStore } from "@/lib/brain/selfheal/BrainSelfHealStore";

export interface LoadBrainSelfHealSnapshotOptions {
  readonly rootDir?: string;
  readonly now?: () => string;
}

export interface BrainSelfHealConsoleSnapshot extends BrainSelfHealSnapshot {
  readonly error: string | null;
  /** The operator-facing AYAS Report Center view (§7–§15). */
  readonly reportCenter: BrainReportCenterView;
}

export function loadBrainSelfHealSnapshot(options: LoadBrainSelfHealSnapshotOptions = {}): BrainSelfHealConsoleSnapshot {
  const now = (options.now ?? (() => new Date().toISOString()))();
  try {
    const store = createBrainSelfHealStore({ rootDir: options.rootDir });
    const incidents = store.listIncidents();
    const learned = store.listLearnedPatterns();
    const decisions = store.listSelfHealDecisions();
    const optimizations = store
      .listOptimizationRuns()
      .filter((r) => r.stage === "accepted" || r.stage === "rejected")
      .slice(0, 12)
      .map((r) => ({
        id: r.id,
        headline: r.verdict?.headline ?? r.disposition,
        verdict: r.stage === "accepted" ? ("ACCEPT" as const) : ("REJECT" as const),
        at: r.updatedAt,
      }));
    return {
      ...buildBrainSelfHealSnapshot({ incidents, learned, optimizations, now }),
      reportCenter: buildBrainReportCenterView({ incidents, learned, decisions, optimizations, now }),
      error: null,
    };
  } catch (error) {
    return {
      ...EMPTY_BRAIN_SELFHEAL_SNAPSHOT,
      reportCenter: { ...EMPTY_BRAIN_REPORT_CENTER_VIEW, generatedAt: now },
      generatedAt: now,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
