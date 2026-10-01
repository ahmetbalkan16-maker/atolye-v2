import { isAyasOperationEvidence, type AyasOperationEvidence, type AyasOperationOutcome } from "./AyasOperationEvidence";

/**
 * Stage 15F — telemetry over the operation evidence.
 *
 * Success and failure counts, latency and retries per task and per action,
 * and which model version answered. Pure: it reads evidence records and
 * returns numbers. It never reads a message, a plan or a path, because the
 * evidence it is given does not hold any.
 *
 * One dispatch is counted once. A tool call appears twice in the evidence —
 * as an action inside the trace of the turn that made it, and as the lease
 * that admitted it. The lease is the durable outcome, so it is the one that
 * is counted; the trace action is used only when no lease record is present.
 * A lease that belongs to a trace is not a task of its own.
 *
 * Observability only: nothing here is an approval, a lease or a gate input.
 */
export const AYAS_TELEMETRY_MAX_ROWS = 64;
export const AYAS_TELEMETRY_MAX_ERROR_CODES = 8;

export interface AyasLatencySummary {
  readonly samples: number;
  readonly p50Ms: number | null;
  readonly p95Ms: number | null;
  readonly maxMs: number | null;
}

export interface AyasTelemetryRow {
  readonly name: string;
  readonly total: number;
  readonly ok: number;
  readonly failed: number;
  readonly denied: number;
  /** Admitted and never settled: still running, or lost. */
  readonly unsettled: number;
  /** fallback, cancelled, expired, revoked. */
  readonly other: number;
  /** ok / (ok + failed). Null when nothing settled either way. */
  readonly successRate: number | null;
  readonly latency: AyasLatencySummary;
  readonly retries: number;
  readonly retryDistribution: { readonly none: number; readonly one: number; readonly two: number; readonly threeOrMore: number };
  readonly errorCodes: Readonly<Record<string, number>>;
}

export interface AyasTelemetryModelRow {
  readonly entryId: string;
  readonly state: string;
  readonly turns: number;
  readonly pinMatch: number;
  readonly pinMismatch: number;
  readonly pinNotObserved: number;
}

export interface AyasOperationTelemetry {
  readonly records: number;
  /** Records that did not fit the evidence shape and were not counted. */
  readonly rejected: number;
  readonly tasks: readonly AyasTelemetryRow[];
  readonly actions: readonly AyasTelemetryRow[];
  readonly models: readonly AyasTelemetryModelRow[];
  readonly retries: number;
  readonly unsettled: number;
  /** True when more distinct names existed than rows are reported. */
  readonly truncated: boolean;
}

interface Sample { readonly outcome: AyasOperationOutcome; readonly durationMs: number | null; readonly errorCode: string | null; readonly retries: number; }

/** Nearest-rank percentile of an ascending list. */
function percentile(sorted: readonly number[], fraction: number): number | null {
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1))]!;
}

function row(name: string, samples: readonly Sample[]): AyasTelemetryRow {
  const count = (outcomes: readonly AyasOperationOutcome[]): number => samples.filter((sample) => outcomes.includes(sample.outcome)).length;
  const ok = count(["ok"]);
  const failed = count(["error"]);
  const durations = samples.flatMap((sample) => sample.durationMs === null ? [] : [sample.durationMs]).sort((a, b) => a - b);
  const codes = new Map<string, number>();
  for (const sample of samples) if (sample.errorCode !== null) codes.set(sample.errorCode, (codes.get(sample.errorCode) ?? 0) + 1);
  const errorCodes = Object.fromEntries([...codes.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, AYAS_TELEMETRY_MAX_ERROR_CODES));
  return {
    name, total: samples.length, ok, failed, denied: count(["denied"]), unsettled: count(["unsettled"]), other: count(["fallback", "cancelled", "expired", "revoked"]),
    successRate: ok + failed === 0 ? null : ok / (ok + failed),
    latency: { samples: durations.length, p50Ms: percentile(durations, 0.5), p95Ms: percentile(durations, 0.95), maxMs: durations.length ? durations[durations.length - 1]! : null },
    retries: samples.reduce((sum, sample) => sum + sample.retries, 0),
    retryDistribution: { none: samples.filter((s) => s.retries === 0).length, one: samples.filter((s) => s.retries === 1).length,
      two: samples.filter((s) => s.retries === 2).length, threeOrMore: samples.filter((s) => s.retries >= 3).length }, errorCodes,
  };
}

function rows(groups: ReadonlyMap<string, readonly Sample[]>): { readonly rows: readonly AyasTelemetryRow[]; readonly truncated: boolean } {
  const all = [...groups.entries()].map(([name, samples]) => row(name, samples)).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  return { rows: all.slice(0, AYAS_TELEMETRY_MAX_ROWS), truncated: all.length > AYAS_TELEMETRY_MAX_ROWS };
}

const push = (groups: Map<string, Sample[]>, name: string, sample: Sample): void => { const list = groups.get(name); if (list) list.push(sample); else groups.set(name, [sample]); };
const endOf = (record: AyasOperationEvidence): number => Date.parse(record.endedAt ?? record.startedAt);

/**
 * Summarizes evidence. `sinceMs` and `untilMs` bound the window by the time
 * an operation ended (or started, while it has not ended).
 */
export function summarizeAyasOperationTelemetry(input: readonly unknown[], options: { readonly sinceMs?: number; readonly untilMs?: number } = {}): AyasOperationTelemetry {
  if ((options.sinceMs !== undefined && !Number.isFinite(options.sinceMs)) || (options.untilMs !== undefined && !Number.isFinite(options.untilMs)) ||
      (options.sinceMs !== undefined && options.untilMs !== undefined && options.sinceMs > options.untilMs)) throw new Error("AYAS_TELEMETRY_WINDOW_INVALID");
  const seen = new Set<string>();
  const records: AyasOperationEvidence[] = [];
  let rejected = 0;
  for (const raw of input) {
    if (!isAyasOperationEvidence(raw)) { rejected += 1; continue; }
    const key = `${raw.source}\n${raw.id}`;
    // The first record for a source and id stands, as it does in the store.
    if (seen.has(key)) continue;
    seen.add(key);
    const at = endOf(raw);
    if ((options.sinceMs !== undefined && at < options.sinceMs) || (options.untilMs !== undefined && at > options.untilMs)) continue;
    records.push(raw);
  }

  const leases = new Map<string, AyasOperationEvidence>();
  for (const record of records) if (record.source === "lease") leases.set(record.id, record);
  const boundByTrace = new Set<string>();
  const boundRetries = new Map<string, number>();
  const tasks = new Map<string, Sample[]>();
  const actions = new Map<string, Sample[]>();
  const models = new Map<string, { entryId: string; state: string; turns: number; pinMatch: number; pinMismatch: number; pinNotObserved: number }>();

  for (const record of records) {
    if (record.source !== "trace") continue;
    push(tasks, record.task, { outcome: record.outcome, durationMs: record.durationMs, errorCode: record.errorCode, retries: record.retries });
    if (record.model) {
      const entryId = record.model.entryId ?? "unregistered";
      const key = `${entryId}\n${record.model.state}`;
      const current = models.get(key) ?? { entryId, state: record.model.state, turns: 0, pinMatch: 0, pinMismatch: 0, pinNotObserved: 0 };
      current.turns += 1;
      if (record.model.pin === "MATCH") current.pinMatch += 1; else if (record.model.pin === "MISMATCH") current.pinMismatch += 1; else current.pinNotObserved += 1;
      models.set(key, current);
    }
    for (const action of record.actions) {
      if (action.binding !== null) {
        if (boundByTrace.has(action.binding)) continue;
        boundByTrace.add(action.binding);
        boundRetries.set(action.binding, Math.max(0, action.attempt - 1));
        // The lease is counted below, once, with its durable outcome.
        if (leases.has(action.binding)) continue;
      }
      push(actions, action.action, { outcome: action.outcome, durationMs: action.durationMs, errorCode: action.errorCode, retries: Math.max(0, action.attempt - 1) });
    }
  }
  for (const record of leases.values()) {
    const sample: Sample = { outcome: record.outcome, durationMs: record.durationMs, errorCode: record.errorCode, retries: Math.max(record.retries, boundRetries.get(record.id) ?? 0) };
    push(actions, record.actions[0]?.action ?? "unknown", sample);
    if (!boundByTrace.has(record.id)) push(tasks, record.task, sample);
  }

  const taskRows = rows(tasks);
  const actionRows = rows(actions);
  return {
    records: records.length, rejected, tasks: taskRows.rows, actions: actionRows.rows,
    models: [...models.values()].sort((a, b) => b.turns - a.turns || a.entryId.localeCompare(b.entryId)).slice(0, AYAS_TELEMETRY_MAX_ROWS),
    retries: [...tasks.values()].flat().reduce((sum, sample) => sum + sample.retries, 0),
    unsettled: [...actions.values()].flat().filter((sample) => sample.outcome === "unsettled").length,
    truncated: taskRows.truncated || actionRows.truncated || models.size > AYAS_TELEMETRY_MAX_ROWS,
  };
}
