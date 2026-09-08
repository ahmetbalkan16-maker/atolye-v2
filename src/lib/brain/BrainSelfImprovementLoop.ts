/**
 * Atölye Brain — self-improvement loop (pure state machine).
 *
 * "Kontrolsüz self-modifying AI yapma." The loop the emir specifies:
 *
 *   OBSERVE → ANALYZE → PROPOSE → TEST → VERIFY → REPORT → USER APPROVAL →
 *   APPLY → REGRESSION TEST → AUDIT
 *
 * The Brain can drive the loop up to and including REPORT on its own (all
 * read-only / sandboxed / draft work). The transition out of `report` is
 * `user-approval`, and only an explicit approval event takes it there. `apply`
 * can only follow `user-approval`. Every stage is recorded.
 *
 * This complements `BrainImprovementProposal.ts`: the proposal is the artifact,
 * this is the process around it.
 */

import { stableProductionId } from "@/lib/production/ProductionDeterminism";

export type BrainImprovementLoopStage =
  | "observe"
  | "analyze"
  | "propose"
  | "test"
  | "verify"
  | "report"
  | "user-approval"
  | "apply"
  | "regression-test"
  | "audit"
  | "kept"
  | "rolled-back";

export const BRAIN_IMPROVEMENT_LOOP_ORDER: readonly BrainImprovementLoopStage[] = Object.freeze([
  "observe",
  "analyze",
  "propose",
  "test",
  "verify",
  "report",
  "user-approval",
  "apply",
  "regression-test",
  "audit",
]);

export type BrainImprovementLoopEvent =
  | "advance"
  | "user-approve"
  | "user-reject"
  | "regression-failed"
  | "audit-passed";

/** Stages the Brain may reach unattended. `user-approval` onward needs a human. */
export const BRAIN_UNATTENDED_LOOP_STAGES: readonly BrainImprovementLoopStage[] = Object.freeze([
  "observe",
  "analyze",
  "propose",
  "test",
  "verify",
  "report",
]);

export interface BrainImprovementLoopTransition {
  readonly event: BrainImprovementLoopEvent;
  readonly from: BrainImprovementLoopStage;
  readonly to: BrainImprovementLoopStage;
  readonly occurredAt: string;
  readonly note?: string;
}

export interface BrainImprovementLoopState {
  readonly loopId: string;
  readonly proposalId: string;
  readonly stage: BrainImprovementLoopStage;
  readonly history: readonly BrainImprovementLoopTransition[];
  /** `true` once the user has approved — gates every write from here on. */
  readonly userApproved: boolean;
}

const NEXT: Readonly<
  Record<BrainImprovementLoopStage, Partial<Record<BrainImprovementLoopEvent, BrainImprovementLoopStage>>>
> = Object.freeze({
  observe: { advance: "analyze" },
  analyze: { advance: "propose" },
  propose: { advance: "test" },
  test: { advance: "verify" },
  verify: { advance: "report" },
  report: { "user-approve": "apply", "user-reject": "rolled-back" },
  "user-approval": { advance: "apply" },
  apply: { advance: "regression-test" },
  "regression-test": { advance: "audit", "regression-failed": "rolled-back" },
  audit: { "audit-passed": "kept", "regression-failed": "rolled-back" },
  kept: {},
  "rolled-back": {},
});

function isIsoInstant(value: string): boolean {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

export function startBrainImprovementLoop(
  proposalId: string,
  startedAt: string,
): BrainImprovementLoopState {
  return {
    loopId: stableProductionId("brain-improvement-loop", { proposalId, startedAt }),
    proposalId,
    stage: "observe",
    history: [],
    userApproved: false,
  };
}

export interface BrainImprovementLoopResult {
  readonly ok: boolean;
  readonly reasonCode:
    | "BRAIN_LOOP_OK"
    | "BRAIN_LOOP_ILLEGAL_TRANSITION"
    | "BRAIN_LOOP_TIMESTAMP_REGRESSION"
    | "BRAIN_LOOP_APPROVAL_REQUIRED";
  readonly state: BrainImprovementLoopState;
}

/**
 * Advance the loop. Fail-closed:
 *  - an illegal transition is rejected;
 *  - a timestamp before the last one is rejected;
 *  - `advance` past `report` without `userApproved` is rejected
 *    (`BRAIN_LOOP_APPROVAL_REQUIRED`).
 */
export function advanceBrainImprovementLoop(
  state: BrainImprovementLoopState,
  event: BrainImprovementLoopEvent,
  occurredAt: string,
  note?: string,
): BrainImprovementLoopResult {
  if (!isIsoInstant(occurredAt)) {
    return { ok: false, reasonCode: "BRAIN_LOOP_TIMESTAMP_REGRESSION", state };
  }
  const last = state.history.at(-1);
  if (last && Date.parse(occurredAt) < Date.parse(last.occurredAt)) {
    return { ok: false, reasonCode: "BRAIN_LOOP_TIMESTAMP_REGRESSION", state };
  }

  // The hard gate: nothing that writes (apply / regression-test / audit) may be
  // reached without an explicit user approval on record.
  const writeStages: readonly BrainImprovementLoopStage[] = ["apply", "regression-test", "audit"];
  const tentativeNext = NEXT[state.stage][event];
  if (tentativeNext && writeStages.includes(tentativeNext) && !state.userApproved && event !== "user-approve") {
    return { ok: false, reasonCode: "BRAIN_LOOP_APPROVAL_REQUIRED", state };
  }

  const next = NEXT[state.stage][event];
  if (!next) {
    return { ok: false, reasonCode: "BRAIN_LOOP_ILLEGAL_TRANSITION", state };
  }

  const transition: BrainImprovementLoopTransition = {
    event,
    from: state.stage,
    to: next,
    occurredAt,
    ...(note ? { note } : {}),
  };

  return {
    ok: true,
    reasonCode: "BRAIN_LOOP_OK",
    state: {
      ...state,
      stage: next,
      userApproved: state.userApproved || event === "user-approve",
      history: [...state.history, transition],
    },
  };
}

/** `true` while the Brain may keep working without a human. */
export function isBrainLoopUnattended(state: BrainImprovementLoopState): boolean {
  return BRAIN_UNATTENDED_LOOP_STAGES.includes(state.stage);
}
