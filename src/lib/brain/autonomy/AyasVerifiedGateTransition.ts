import type { AyasExecutionGateStore, AyasExecutionGateRecord } from "../../ayas/execution/AyasExecutionGateStore";
import type { AyasExecutionGateEvent, AyasExecutionGateState } from "../../ayas/execution/AyasExecutionGate";

/**
 * Safe, non-secret diagnostic: which event was attempted, what state it was
 * expected to reach, and what state the gate actually reported. Never a
 * proposal, a raw authorization payload, or a filesystem path.
 */
export class AyasExecutionAuthorityError extends Error {
  constructor(
    message: string,
    readonly detail: { readonly event: AyasExecutionGateEvent; readonly expectedState: AyasExecutionGateState; readonly actualState: AyasExecutionGateState },
  ) {
    super(message);
    this.name = "AyasExecutionAuthorityError";
    this.stack = undefined;
  }
}

/**
 * `AyasExecutionGateStore.transition()` never throws for a disallowed or
 * refused transition — it silently persists a fault (or, for a refused
 * `open`, a same-state no-op) and returns normally. Without this check, a
 * caller that blindly proceeds after each `gate.transition()` call can run
 * a mutation callback even though the gate never genuinely reached the
 * intended state. This verifies the returned record actually reached
 * `expectedState` — and, for `open`, that the returned
 * `activationAuthorizationId` matches what was requested — before letting
 * execution continue; any mismatch throws instead of silently proceeding.
 * Every fault in this state machine lands on `CLOSED` (see
 * `AyasExecutionGate.ts`'s `nextAyasExecutionGateState`), so comparing the
 * resulting state against a non-`CLOSED` expectation is equivalent to
 * checking the transition's internal `faulted` flag, which the store's
 * public return type does not expose.
 *
 * This module depends only on the pre-existing `AyasExecutionGateStore`/
 * `AyasExecutionGate` contract — it never invokes a mutation callback
 * itself and has no dependency on proposal, approval, or orchestration
 * logic.
 */
export function applyVerifiedGateTransition(
  gate: AyasExecutionGateStore,
  input: { readonly event: AyasExecutionGateEvent; readonly activationAuthorizationId?: string; readonly reason?: string },
  expectedState: AyasExecutionGateState,
): AyasExecutionGateRecord {
  const record = gate.transition(input);
  const stateMismatch = record.state !== expectedState;
  const activationMismatch = expectedState === "OPEN" && record.activationAuthorizationId !== input.activationAuthorizationId;
  if (stateMismatch || activationMismatch) {
    throw new AyasExecutionAuthorityError(
      `AYAS_EXECUTION_GATE_TRANSITION_UNVERIFIED: "${input.event}" expected ${expectedState}, gate reports ${record.state}`,
      { event: input.event, expectedState, actualState: record.state },
    );
  }
  return record;
}
