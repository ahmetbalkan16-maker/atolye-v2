import crypto from "node:crypto";

import type { AyasExecutionAuthorizationRecord } from "../execution/AyasExecutionAuthorization";
import type { AyasTraceSnapshot } from "../trace/AyasUnifiedTrace";

/**
 * Stage 15F — one durable, privacy-bounded record of an operation.
 *
 * Two sources produce it: a finished Unified Trace (a chat turn, an owner
 * approval, a research improvement cycle) and a capability lease from the
 * authorization store (a tool dispatch, a discovery run, a durable read).
 * Both become the same shape, so telemetry and the reliability checks read
 * one stream.
 *
 * It holds identifiers, closed enums, counts, durations and digests: task,
 * agent, model version, tool or action, approval binding, retries, duration,
 * outcome, error code, evidence digest. It never holds a message, a prompt,
 * a tool input, a path outside the repository or a secret. Every string is
 * checked against a closed pattern when a record is built and again when it
 * is read back.
 *
 * Pure: no filesystem, no clock. Observability only: nothing here is an
 * approval, a lease or a gate input.
 */
export const AYAS_OPERATION_EVIDENCE_SCHEMA_VERSION = "1" as const;

export type AyasOperationOutcome = "ok" | "error" | "denied" | "fallback" | "cancelled" | "expired" | "revoked" | "unsettled";
export const AYAS_OPERATION_OUTCOMES: readonly AyasOperationOutcome[] = Object.freeze(["ok", "error", "denied", "fallback", "cancelled", "expired", "revoked", "unsettled"]);

export interface AyasOperationActionEvidence {
  /** The tool or capability id. */
  readonly action: string;
  readonly outcome: AyasOperationOutcome;
  readonly errorCode: string | null;
  readonly durationMs: number | null;
  readonly attempt: number;
  /** The lease that admitted it, when one is known. */
  readonly binding: string | null;
}

export interface AyasOperationEvidence {
  readonly schemaVersion: typeof AYAS_OPERATION_EVIDENCE_SCHEMA_VERSION;
  readonly source: "trace" | "lease";
  /** The trace id or the authorization id. With `source` it identifies the record. */
  readonly id: string;
  /** Low-cardinality operation name: a trace root kind, `tool:<action>`, or a run action. */
  readonly task: string;
  readonly agent: string;
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly durationMs: number | null;
  readonly outcome: AyasOperationOutcome;
  readonly errorCode: string | null;
  /** The lifecycle registry entry of the model that answered, and whether its served bytes were the pinned ones. */
  readonly model: { readonly entryId: string | null; readonly state: string; readonly pin: string } | null;
  readonly actions: readonly AyasOperationActionEvidence[];
  /** The approval or reservation an execution was bound to. */
  readonly approvalBinding: string | null;
  readonly retries: number;
  /** SHA-256 of the sanitized source record this was derived from. */
  readonly evidenceDigest: string;
}

const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const AUTHORIZATION_ID = /^authz-[a-f0-9-]{36}$/;
const TASK = /^[a-z][a-z0-9.:-]{1,79}$/;
const AGENT = /^[a-z][a-z0-9-]{1,63}$/;
const ACTION = /^[a-z][a-z0-9.-]{1,63}$/;
const CODE = /^[A-Z][A-Z0-9_]{1,63}$/;
const BINDING = /^[a-z0-9][a-z0-9:._-]{7,119}$/;
const LIFECYCLE_ID = /^[a-z0-9][a-z0-9._-]{2,119}$/;
const LIFECYCLE_STATES = new Set(["DISCOVERED", "PINNED", "QUALIFIED", "SHADOW", "CANARY", "ACTIVE", "DEGRADED", "RETIRED", "UNREGISTERED"]);
const PIN_STATES = new Set(["MATCH", "MISMATCH", "NOT_OBSERVED", "UNREGISTERED"]);
const MAX_ACTIONS = 16;
const MAX_DURATION_MS = 24 * 60 * 60 * 1000;

const sha256 = (value: string): string => crypto.createHash("sha256").update(value, "utf8").digest("hex");
const iso = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const duration = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= MAX_DURATION_MS ? Math.round(value) : null;
const code = (value: unknown): string | null => typeof value === "string" && CODE.test(value) && !/(SECRET|PASSWORD|PRIVATE|TOKEN|API_KEY)/.test(value) ? value : null;
const between = (start: string, end: string | null): number | null => end === null ? null : duration(Date.parse(end) - Date.parse(start));

/** An agent name the audit trail may carry: a known code-authored label, else `unknown`. */
function agentOf(value: unknown): string {
  return typeof value === "string" && AGENT.test(value) ? value : "unknown";
}

/** A finished trace as an evidence record. Returns undefined for a trace that is still running or malformed. */
export function deriveAyasTraceEvidence(snapshot: AyasTraceSnapshot): AyasOperationEvidence | undefined {
  if (!snapshot || snapshot.status === "running" || !UUID.test(String(snapshot.traceId)) || !iso(snapshot.createdAt) || !TASK.test(String(snapshot.rootKind))) return undefined;
  const endedAt = iso(snapshot.endedAt) ? snapshot.endedAt : null;
  const failed = snapshot.events.find((event) => event.spanId === null && event.errorCode !== undefined);
  const leases = [...(snapshot.attributes?.tools ?? [])];
  const actions: AyasOperationActionEvidence[] = [];
  for (const span of snapshot.spans) {
    if (span.kind !== "tool" || span.component !== "ayas-tool" || actions.length >= MAX_ACTIONS) continue;
    // Tool spans and tool attributes are recorded in the same order: one dispatch, one lease.
    const lease = leases.shift();
    actions.push({ action: lease && ACTION.test(lease.action) ? lease.action : "unknown", outcome: span.status === "running" ? "unsettled" : span.status, errorCode: code(span.errorCode),
      durationMs: duration(span.durationMs), attempt: Number.isSafeInteger(span.attempt) && span.attempt > 0 ? span.attempt : 1,
      binding: lease && typeof lease.authorizationId === "string" && AUTHORIZATION_ID.test(lease.authorizationId) ? lease.authorizationId : null });
  }
  const model = snapshot.attributes?.model;
  // A retry is written twice in a trace: as the span of the later attempt and as that span's own retry event.
  // It is one retry. A retry event with no later-attempt span of its own is counted by itself.
  const retriedSpans = new Set(snapshot.spans.filter((span) => span.attempt > 1).map((span) => span.spanId));
  const loneRetryEvents = snapshot.events.filter((event) => event.type === "retry" && (event.spanId === null || !retriedSpans.has(event.spanId))).length;
  const record: Omit<AyasOperationEvidence, "evidenceDigest"> = {
    schemaVersion: AYAS_OPERATION_EVIDENCE_SCHEMA_VERSION, source: "trace", id: snapshot.traceId, task: snapshot.rootKind, agent: "ayas-server",
    startedAt: snapshot.createdAt, endedAt, durationMs: between(snapshot.createdAt, endedAt), outcome: snapshot.status, errorCode: code(failed?.errorCode),
    model: model ? { entryId: model.entryId, state: model.state, pin: model.pin } : null, actions,
    approvalBinding: typeof snapshot.attributes?.approvalBinding === "string" && BINDING.test(snapshot.attributes.approvalBinding) ? snapshot.attributes.approvalBinding : null,
    retries: retriedSpans.size + loneRetryEvents,
  };
  return finish(record, JSON.stringify(snapshot));
}

/** A capability lease as an evidence record. The record's plan and intent are not read: only its identity, times and state. */
export function deriveAyasLeaseEvidence(record: AyasExecutionAuthorizationRecord, nowMs: number): AyasOperationEvidence | undefined {
  if (!record || !AUTHORIZATION_ID.test(String(record.authorizationId)) || !iso(record.createdAt) || !iso(record.expiresAt) || typeof record.action !== "string" || !ACTION.test(record.action)) return undefined;
  const expired = Number.isFinite(nowMs) && nowMs >= Date.parse(record.expiresAt);
  const outcome: AyasOperationOutcome = record.state === "completed" ? "ok" : record.state === "failed" ? "error" : record.state === "revoked" ? "revoked" : record.state === "expired" ? "expired"
    // A grant never consumed, or consumed and never settled, is unsettled while it can still be used and expired afterwards.
    : expired ? (record.state === "consumed" ? "unsettled" : "expired") : "unsettled";
  const endedAt = iso(record.settledAt) ? record.settledAt : iso(record.revokedAt) ? record.revokedAt : record.state === "expired" || (expired && record.state === "granted") ? record.expiresAt : null;
  const started = iso(record.consumedAt) ? record.consumedAt : record.createdAt;
  const errorCode = code(record.failureReason);
  // A run lease carries its own task name; a tool lease is named after its tool.
  const task = record.capabilityScope ? `tool:${record.action}` : record.action;
  const evidence: Omit<AyasOperationEvidence, "evidenceDigest"> = {
    schemaVersion: AYAS_OPERATION_EVIDENCE_SCHEMA_VERSION, source: "lease", id: record.authorizationId, task: TASK.test(task) ? task : "unknown-task",
    agent: record.capabilityScope ? agentOf(record.capabilityScope.agentId) : agentOf(record.requestedBy),
    startedAt: record.createdAt, endedAt, durationMs: endedAt ? between(started, endedAt) : null, outcome, errorCode, model: null,
    actions: [{ action: record.action, outcome, errorCode, durationMs: endedAt ? between(started, endedAt) : null, attempt: 1, binding: record.authorizationId }],
    approvalBinding: null, retries: 0,
  };
  // The digest covers identity and lifecycle fields only, so it never depends on the bounded plan or intent.
  return finish(evidence, JSON.stringify([record.authorizationId, record.executionId, record.requestDigest, record.action, record.createdAt, record.expiresAt, record.state,
    record.consumedAt ?? null, record.settledAt ?? null, record.revokedAt ?? null, record.resultDigest ?? null, record.failureReason ?? null, record.capabilityScopeDigest ?? null]));
}

function finish(record: Omit<AyasOperationEvidence, "evidenceDigest">, source: string): AyasOperationEvidence | undefined {
  const evidence: AyasOperationEvidence = { ...record, evidenceDigest: sha256(source) };
  return isAyasOperationEvidence(evidence) ? evidence : undefined;
}

/** The read-side check: a stored line is used only if every field still fits the closed shape. */
export function isAyasOperationEvidence(raw: unknown): raw is AyasOperationEvidence {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const r = raw as Record<string, unknown>;
  const keys = ["schemaVersion", "source", "id", "task", "agent", "startedAt", "endedAt", "durationMs", "outcome", "errorCode", "model", "actions", "approvalBinding", "retries", "evidenceDigest"];
  if (Object.keys(r).length !== keys.length || !keys.every((key) => Object.hasOwn(r, key))) return false;
  if (r.schemaVersion !== AYAS_OPERATION_EVIDENCE_SCHEMA_VERSION || (r.source !== "trace" && r.source !== "lease") || typeof r.id !== "string" ||
      !(r.source === "trace" ? UUID.test(r.id) : AUTHORIZATION_ID.test(r.id)) || typeof r.task !== "string" || !TASK.test(r.task) || typeof r.agent !== "string" || !AGENT.test(r.agent) ||
      !iso(r.startedAt) || !(r.endedAt === null || (iso(r.endedAt) && r.endedAt >= r.startedAt)) || !(r.durationMs === null || duration(r.durationMs) === r.durationMs) ||
      !AYAS_OPERATION_OUTCOMES.includes(r.outcome as AyasOperationOutcome) || !(r.errorCode === null || code(r.errorCode) === r.errorCode) ||
      !(r.approvalBinding === null || (typeof r.approvalBinding === "string" && BINDING.test(r.approvalBinding))) ||
      !Number.isSafeInteger(r.retries) || Number(r.retries) < 0 || Number(r.retries) > 1000 || typeof r.evidenceDigest !== "string" || !HASH.test(r.evidenceDigest) ||
      !Array.isArray(r.actions) || r.actions.length > MAX_ACTIONS) return false;
  if (r.model !== null) {
    const m = r.model as Record<string, unknown> | undefined;
    if (!m || typeof m !== "object" || Object.keys(m).length !== 3 || !(m.entryId === null || (typeof m.entryId === "string" && LIFECYCLE_ID.test(m.entryId))) ||
        typeof m.state !== "string" || !LIFECYCLE_STATES.has(m.state) || typeof m.pin !== "string" || !PIN_STATES.has(m.pin)) return false;
  }
  return r.actions.every((item) => {
    const a = item as Record<string, unknown> | null;
    return !!a && typeof a === "object" && Object.keys(a).length === 6 && typeof a.action === "string" && ACTION.test(a.action) && AYAS_OPERATION_OUTCOMES.includes(a.outcome as AyasOperationOutcome) &&
      (a.errorCode === null || code(a.errorCode) === a.errorCode) && (a.durationMs === null || duration(a.durationMs) === a.durationMs) &&
      Number.isSafeInteger(a.attempt) && Number(a.attempt) > 0 && Number(a.attempt) <= 100 && (a.binding === null || (typeof a.binding === "string" && AUTHORIZATION_ID.test(a.binding)));
  });
}
