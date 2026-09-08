/**
 * AYAS — read-only autonomous-loop view for the Brain Core UI (Sprint 186).
 *
 * Loads the persisted `AyasAutonomousState` (if any) and flattens it to a small
 * UI shape. Read-only: it never starts, advances or persists the loop. A corrupt
 * checkpoint surfaces as `error`, not a crash.
 */

import {
  createAyasAutonomousStore,
  AyasAutonomousStoreError,
} from "./AyasAutonomousStore";
import type { AyasCyclePhase } from "./AyasAutonomousLoop";

export interface AyasAutonomousView {
  readonly connected: boolean;
  readonly executionGate: "CLOSED";
  readonly phase: AyasCyclePhase | "not-started";
  readonly cycleCount: number;
  readonly heartbeatCount: number;
  readonly lastHeartbeatAt?: string;
  readonly lastCycleAt?: string;
  readonly pendingCount: number;
  readonly completedCount: number;
  readonly awaitingApprovalCount: number;
  readonly pending: readonly { readonly id: string; readonly title: string; readonly status: string }[];
  readonly gaps: readonly string[];
  readonly nextSingleStep: string;
  readonly error?: string;
}

export interface LoadAyasAutonomousViewOptions {
  readonly rootDir?: string;
}

export function loadAyasAutonomousView(
  options: LoadAyasAutonomousViewOptions = {},
): AyasAutonomousView {
  const store = createAyasAutonomousStore(options.rootDir ? { rootDir: options.rootDir } : {});
  const empty: AyasAutonomousView = {
    connected: false,
    executionGate: "CLOSED",
    phase: "not-started",
    cycleCount: 0,
    heartbeatCount: 0,
    pendingCount: 0,
    completedCount: 0,
    awaitingApprovalCount: 0,
    pending: [],
    gaps: [],
    nextSingleStep: "AYAS otonom döngüsü henüz başlatılmadı.",
  };

  let state;
  try {
    state = store.load();
  } catch (error) {
    return {
      ...empty,
      error:
        error instanceof AyasAutonomousStoreError
          ? `${error.code} — ${error.message}`
          : error instanceof Error
            ? error.message
            : String(error),
    };
  }
  if (!state) return empty;

  return {
    connected: true,
    executionGate: "CLOSED",
    phase: state.phase,
    cycleCount: state.cycleCount,
    heartbeatCount: state.heartbeatCount,
    ...(state.lastHeartbeatAt ? { lastHeartbeatAt: state.lastHeartbeatAt } : {}),
    ...(state.lastCycleAt ? { lastCycleAt: state.lastCycleAt } : {}),
    pendingCount: state.pendingImprovements.length,
    completedCount: state.completedImprovements.length,
    awaitingApprovalCount: state.pendingImprovements.filter((r) => r.status === "awaiting-approval").length,
    pending: state.pendingImprovements.slice(0, 12).map((r) => ({ id: r.id, title: r.title, status: r.status })),
    gaps: state.observation?.gaps.slice(0, 8) ?? [],
    nextSingleStep: state.nextSingleStep,
  };
}
