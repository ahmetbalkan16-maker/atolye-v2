/**
 * AYAS Execution Gate — the state machine (AYAS MASTER FULL ACTIVATION sprint).
 *
 * A **separate** control plane from the Brain autonomy layer. `AyasAutonomousLoop`
 * / `AyasAutonomousStore` keep their own `executionGate: "CLOSED"` invariant and
 * are NOT touched — the autonomy loop still can never execute anything. This gate
 * governs a different path: a *deliberate, authorized* AYAS execution request
 * (`AyasExecutionBridge`) that a designed, reversible activation flow can move
 * from `CLOSED` toward `OPEN`.
 *
 * Design (spec §6, §21, §23):
 *
 *     CLOSED ──arm──▶ ARMED ──confirm-ready──▶ READY ──open*──▶ OPEN
 *                                                │                │
 *                                          (open needs an        begin-execution
 *                                           operator activation   │
 *                                           authorization id)     ▼
 *                                                │            EXECUTING
 *                                                │                │
 *                                                │         complete-execution
 *                                                │                ▼
 *                                                │            COMPLETED ──settle──▶ READY
 *                                                ▼
 *     any state ── fault / close ──▶ CLOSED   (fail-closed: the default, and every error)
 *
 * This module is PURE — no fs, no clock, no crypto. Durability + append-only
 * audit + monotonic sequence + restart/replay safety live in
 * `AyasExecutionGateStore.ts`.
 */

export const ayasExecutionGateSchemaVersion = "1" as const;

export type AyasExecutionGateState =
  | "CLOSED"
  | "ARMED"
  | "READY"
  | "OPEN"
  | "EXECUTING"
  | "COMPLETED";

/** The safe resting state and the default when nothing is persisted. */
export const AYAS_EXECUTION_GATE_DEFAULT: AyasExecutionGateState = "CLOSED";

export type AyasExecutionGateEvent =
  | "arm"
  | "confirm-ready"
  | "open"
  | "begin-execution"
  | "complete-execution"
  | "settle"
  | "close"
  | "fault";

export interface AyasExecutionGateTransitionContext {
  /**
   * Present only for the `open` event: the id of a durable operator activation
   * authorization. `open` without it is refused (→ stays, caller treats as deny).
   * The gate NEVER opens itself and an LLM can never supply this.
   */
  readonly activationAuthorizationId?: string;
}

export interface AyasExecutionGateTransition {
  readonly from: AyasExecutionGateState;
  readonly to: AyasExecutionGateState;
  readonly event: AyasExecutionGateEvent;
  /** `true` when the event was not allowed from `from` and the gate fell to CLOSED. */
  readonly faulted: boolean;
}

const ALLOWED: Readonly<Record<AyasExecutionGateState, Partial<Record<AyasExecutionGateEvent, AyasExecutionGateState>>>> =
  Object.freeze({
    CLOSED: { arm: "ARMED" },
    ARMED: { "confirm-ready": "READY", close: "CLOSED" },
    READY: { open: "OPEN", close: "CLOSED" },
    OPEN: { "begin-execution": "EXECUTING", close: "CLOSED" },
    EXECUTING: { "complete-execution": "COMPLETED", close: "CLOSED", fault: "CLOSED" },
    COMPLETED: { settle: "READY", close: "CLOSED" },
  });

/**
 * Deterministic transition. `fault` and `close` are always accepted and always
 * land on `CLOSED`. `open` additionally requires `ctx.activationAuthorizationId`
 * — without it the gate does not move (a refused open, not a fault).
 * Any other disallowed `(state, event)` pair FAULTS to `CLOSED`.
 */
export function nextAyasExecutionGateState(
  current: AyasExecutionGateState,
  event: AyasExecutionGateEvent,
  ctx: AyasExecutionGateTransitionContext = {},
): AyasExecutionGateTransition {
  if (event === "close" || event === "fault") {
    return { from: current, to: "CLOSED", event, faulted: event === "fault" };
  }
  if (event === "open") {
    const opensFrom = ALLOWED[current]?.open;
    if (opensFrom && typeof ctx.activationAuthorizationId === "string" && ctx.activationAuthorizationId.length > 0) {
      return { from: current, to: opensFrom, event, faulted: false };
    }
    // A refused open is NOT a fault — the gate simply stays put and the caller denies.
    return { from: current, to: current, event, faulted: false };
  }
  const to = ALLOWED[current]?.[event];
  if (to) return { from: current, to, event, faulted: false };
  // Unknown / disallowed → fail closed.
  return { from: current, to: "CLOSED", event, faulted: true };
}

/** Is the gate in a state where a validated + authorized execution may run? */
export function isAyasExecutionGateOpenState(state: AyasExecutionGateState): boolean {
  return state === "OPEN";
}

/** Is the gate mid-execution? (used to reject a second concurrent request) */
export function isAyasExecutionGateBusyState(state: AyasExecutionGateState): boolean {
  return state === "EXECUTING";
}

export function describeAyasExecutionGateState(state: AyasExecutionGateState): string {
  switch (state) {
    case "CLOSED": return "Kapalı — hiçbir AYAS yürütmesi kabul edilmez (güvenli varsayılan).";
    case "ARMED": return "Kuruldu — aktivasyon süreci başladı, henüz hazır değil.";
    case "READY": return "Hazır — yetkilendirme alınabilir; kapı hâlâ kapalı sayılır.";
    case "OPEN": return "Açık — yetkilendirilmiş bir yürütme isteği çalıştırılabilir.";
    case "EXECUTING": return "Yürütülüyor — allowlist'teki bir eylem çalışıyor.";
    case "COMPLETED": return "Tamamlandı — sonuç denetlendi; kapı READY'ye dönecek.";
    default: return String(state);
  }
}
