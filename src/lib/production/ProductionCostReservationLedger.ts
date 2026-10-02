/**
 * Stage 15K — the cost reservation ledger.
 *
 * An approved project cap is reserved before execution, settled with what was
 * actually spent when the project completes, and the unused part is released.
 * The ledger is the list of those events in order; everything else is derived
 * from it. Two projects cannot hold more than the allowance between them.
 *
 * Pure: this module reads a list of events and says what it means and what may
 * be added. Where the events are kept is the store's concern.
 */
export const PRODUCTION_COST_LEDGER_SCHEMA_VERSION = "1" as const;

export type CostLedgerEvent =
  | { readonly type: "RESERVE"; readonly reservationId: string; readonly projectId: string; readonly capUsd: number; readonly at: string }
  /** The project completed: what it actually cost. The rest of its cap is released. */
  | { readonly type: "SETTLE"; readonly reservationId: string; readonly actualUsd: number; readonly at: string }
  /** The project did not run: its whole cap is released and nothing was spent. */
  | { readonly type: "RELEASE"; readonly reservationId: string; readonly at: string };

export interface CostReservation { readonly reservationId: string; readonly projectId: string; readonly capUsd: number; readonly at: string }
export interface CostLedgerSummary {
  readonly events: number;
  /** Reservations that are neither settled nor released. */
  readonly active: readonly CostReservation[];
  readonly reservedUsd: number;
  readonly settledUsd: number;
  /** Settlements that cost more than their reservation, by reservation id. The whole amount is counted as spent. */
  readonly overruns: readonly string[];
  /** Why the list cannot be trusted. Any problem makes every admission fail closed. */
  readonly problems: readonly string[];
}

const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const round = (value: number) => Math.round(value * 1e6) / 1e6;
const money = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
const time = (value: unknown) => typeof value === "string" && !Number.isNaN(Date.parse(value));

/** What the events add up to. A malformed event, a reservation made twice, or a settlement of nothing is a problem, never skipped. */
export function summarizeCostLedger(events: readonly unknown[]): CostLedgerSummary {
  const problems: string[] = [];
  const active = new Map<string, CostReservation>();
  const closed = new Set<string>();
  const overruns: string[] = [];
  let settledUsd = 0;
  for (const [index, raw] of events.entries()) {
    const event = raw as Partial<CostLedgerEvent> & Record<string, unknown> | null;
    const where = `EVENT:${index}`;
    if (!event || typeof event !== "object" || Array.isArray(event) || typeof event.reservationId !== "string" || !ID.test(event.reservationId) || !time(event.at)) { problems.push(where); continue; }
    if (event.type === "RESERVE") {
      if (typeof event.projectId !== "string" || !ID.test(event.projectId) || !money(event.capUsd) || event.capUsd === 0 || active.has(event.reservationId) || closed.has(event.reservationId) || [...active.values()].some((item) => item.projectId === event.projectId)) { problems.push(where); continue; }
      active.set(event.reservationId, { reservationId: event.reservationId, projectId: event.projectId, capUsd: event.capUsd, at: event.at as string });
    } else if (event.type === "SETTLE") {
      const reservation = active.get(event.reservationId);
      if (!reservation || !money(event.actualUsd)) { problems.push(where); continue; }
      if (event.actualUsd > reservation.capUsd) overruns.push(reservation.reservationId);
      settledUsd = round(settledUsd + event.actualUsd);
      active.delete(event.reservationId); closed.add(event.reservationId);
    } else if (event.type === "RELEASE") {
      if (!active.has(event.reservationId)) { problems.push(where); continue; }
      active.delete(event.reservationId); closed.add(event.reservationId);
    } else problems.push(where);
  }
  const list = [...active.values()];
  return { events: events.length, active: list, reservedUsd: round(list.reduce((sum, item) => sum + item.capUsd, 0)), settledUsd, overruns, problems };
}

export type CostReservationRefusal = "LEDGER_UNTRUSTED" | "ALLOWANCE_NOT_DECLARED" | "CAP_INVALID" | "ID_INVALID" | "RESERVATION_EXISTS" | "PROJECT_ALREADY_RESERVED" | "ALLOWANCE_OVERSUBSCRIBED";

/**
 * Whether a cap may be reserved for a project, given the ledger as it stands. The allowance is what the owner
 * declared; without one nothing is reserved. Settled spend and every active cap count against it.
 */
export function admitCostReservation(summary: CostLedgerSummary, request: { readonly reservationId: string; readonly projectId: string; readonly capUsd: number }, allowanceUsd: number | null): { readonly ok: true; readonly remainingAfterUsd: number } | { readonly ok: false; readonly reason: CostReservationRefusal } {
  if (summary.problems.length > 0) return { ok: false, reason: "LEDGER_UNTRUSTED" };
  if (!money(allowanceUsd)) return { ok: false, reason: "ALLOWANCE_NOT_DECLARED" };
  if (!ID.test(String(request.reservationId)) || !ID.test(String(request.projectId))) return { ok: false, reason: "ID_INVALID" };
  if (!money(request.capUsd) || request.capUsd === 0) return { ok: false, reason: "CAP_INVALID" };
  if (summary.active.some((item) => item.reservationId === request.reservationId)) return { ok: false, reason: "RESERVATION_EXISTS" };
  if (summary.active.some((item) => item.projectId === request.projectId)) return { ok: false, reason: "PROJECT_ALREADY_RESERVED" };
  const remainingAfterUsd = round(allowanceUsd - summary.settledUsd - summary.reservedUsd - request.capUsd);
  return remainingAfterUsd < 0 ? { ok: false, reason: "ALLOWANCE_OVERSUBSCRIBED" } : { ok: true, remainingAfterUsd };
}

/** What is already spoken for, in the shape the governor's allowance takes. */
export function committedCostUsd(summary: CostLedgerSummary): number {
  return round(summary.settledUsd + summary.reservedUsd);
}
