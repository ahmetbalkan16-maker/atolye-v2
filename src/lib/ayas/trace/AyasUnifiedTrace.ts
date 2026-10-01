import crypto from "node:crypto";
import { performance } from "node:perf_hooks";

/** Observability only. Nothing in this module is an approval, gate, or authority input. */
export const AYAS_TRACE_SCHEMA_VERSION = 1 as const;
export const AYAS_TRACE_MAX_RECORDS = 128;
export const AYAS_TRACE_MAX_AGE_MS = 60 * 60 * 1000;
export const AYAS_TRACE_MAX_SPANS = 64;
export const AYAS_TRACE_MAX_EVENTS = 128;

export type AyasTraceRootKind = "chat-turn" | "owner-approval" | "research-improvement";
export type AyasTraceStatus = "running" | "ok" | "error" | "fallback" | "cancelled" | "denied";
export type AyasTraceSpanKind = "conversation" | "context" | "memory" | "retrieval" | "model" | "tool" | "approval" | "execution" | "persistence" | "outcome" | "research" | "experiment";
export type AyasTraceEventType = "started" | "completed" | "failed" | "fallback" | "retry" | "cancelled" | "gate-result" | "memory-query" | "retrieval-query";
export type AyasTraceMetadata = Readonly<Record<string, number | boolean | null>>;

export interface AyasTraceSpan {
  readonly spanId: string;
  readonly parentSpanId: string | null;
  readonly kind: AyasTraceSpanKind;
  readonly component: string;
  readonly operation: string;
  readonly attempt: number;
  readonly startedAt: string;
  readonly endedAt?: string;
  readonly durationMs?: number;
  readonly status: AyasTraceStatus;
  readonly errorCode?: string;
  readonly metadata?: AyasTraceMetadata;
}

export interface AyasTraceEvent {
  readonly traceId: string;
  readonly spanId: string | null;
  readonly at: string;
  readonly type: AyasTraceEventType;
  readonly status: AyasTraceStatus;
  readonly errorCode?: string;
  readonly metadata?: AyasTraceMetadata;
}

/**
 * Stage 15F — identifiers a trace may carry beside its counts: which model version answered, which tools were
 * dispatched under which lease, which approval an execution was bound to. Closed shapes only: every value is an id,
 * an enum or a digest, validated on write and again on read. Never text.
 */
export interface AyasTraceModelAttribute { readonly entryId: string | null; readonly state: string; readonly pin: string; }
export interface AyasTraceToolAttribute { readonly action: string; readonly authorizationId: string | null; }
export interface AyasTraceAttributes {
  readonly model?: AyasTraceModelAttribute;
  readonly tools?: readonly AyasTraceToolAttribute[];
  readonly approvalBinding?: string;
}
export const AYAS_TRACE_MAX_TOOL_ATTRIBUTES = 8;

export interface AyasTraceSnapshot {
  readonly schemaVersion: typeof AYAS_TRACE_SCHEMA_VERSION;
  readonly traceId: string;
  readonly rootKind: AyasTraceRootKind;
  readonly createdAt: string;
  readonly endedAt?: string;
  readonly status: AyasTraceStatus;
  readonly spans: readonly AyasTraceSpan[];
  readonly events: readonly AyasTraceEvent[];
  readonly attributes?: AyasTraceAttributes;
}

/** Receives a finished trace once. Best-effort: a sink that throws never changes a domain result. */
export interface AyasTraceEvidenceSink { record(snapshot: AyasTraceSnapshot): void; }

type MutableTrace = {
  schemaVersion: typeof AYAS_TRACE_SCHEMA_VERSION;
  traceId: string;
  rootKind: AyasTraceRootKind;
  createdAt: string;
  endedAt?: string;
  status: AyasTraceStatus;
  spans: AyasTraceSpan[];
  events: AyasTraceEvent[];
  attributes?: { model?: AyasTraceModelAttribute; tools?: AyasTraceToolAttribute[]; approvalBinding?: string };
};

const LIFECYCLE_ID = /^[a-z0-9][a-z0-9._-]{2,119}$/;
const LIFECYCLE_STATES = new Set(["DISCOVERED", "PINNED", "QUALIFIED", "SHADOW", "CANARY", "ACTIVE", "DEGRADED", "RETIRED", "UNREGISTERED"]);
const PIN_STATES = new Set(["MATCH", "MISMATCH", "NOT_OBSERVED", "UNREGISTERED"]);
const ACTION_ID = /^[a-z][a-z0-9.-]{1,63}$/;
const AUTHORIZATION_ID = /^authz-[a-f0-9-]{36}$/;
const BINDING_ID = /^[a-z0-9][a-z0-9:._-]{7,119}$/;

/** Reads only the known keys and keeps only well-formed identifiers; anything else is dropped, never copied. */
function safeAttributes(value: unknown): AyasTraceAttributes | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const source = value as { model?: unknown; tools?: unknown; approvalBinding?: unknown };
  const out: { model?: AyasTraceModelAttribute; tools?: AyasTraceToolAttribute[]; approvalBinding?: string } = {};
  const model = source.model as { entryId?: unknown; state?: unknown; pin?: unknown } | null | undefined;
  if (model && typeof model === "object" && (model.entryId === null || (typeof model.entryId === "string" && LIFECYCLE_ID.test(model.entryId))) &&
      typeof model.state === "string" && LIFECYCLE_STATES.has(model.state) && typeof model.pin === "string" && PIN_STATES.has(model.pin)) {
    out.model = { entryId: model.entryId, state: model.state, pin: model.pin };
  }
  if (Array.isArray(source.tools)) {
    const tools: AyasTraceToolAttribute[] = [];
    for (const raw of source.tools.slice(0, AYAS_TRACE_MAX_TOOL_ATTRIBUTES)) {
      const tool = raw as { action?: unknown; authorizationId?: unknown } | null;
      if (!tool || typeof tool !== "object" || typeof tool.action !== "string" || !ACTION_ID.test(tool.action)) continue;
      tools.push({ action: tool.action, authorizationId: typeof tool.authorizationId === "string" && AUTHORIZATION_ID.test(tool.authorizationId) ? tool.authorizationId : null });
    }
    if (tools.length) out.tools = tools;
  }
  if (typeof source.approvalBinding === "string" && BINDING_ID.test(source.approvalBinding)) out.approvalBinding = source.approvalBinding;
  return Object.keys(out).length ? out : undefined;
}

const STATUS = new Set<AyasTraceStatus>(["running", "ok", "error", "fallback", "cancelled", "denied"]);
const KINDS = new Set<AyasTraceSpanKind>(["conversation", "context", "memory", "retrieval", "model", "tool", "approval", "execution", "persistence", "outcome", "research", "experiment"]);
const EVENTS = new Set<AyasTraceEventType>(["started", "completed", "failed", "fallback", "retry", "cancelled", "gate-result", "memory-query", "retrieval-query"]);
const METADATA_KEYS = new Set([
  "historyCount", "resolvedCount", "droppedCount", "candidateCount", "selectedCount", "identityCount", "storedCount", "attempted", "executed", "attempt",
  // Memory Temporal v2 — counts and flags only.
  "failedCount", "temporalAsOf", "temporalHistory", "currentCount", "historicalCount", "supersededCount", "conflictCount", "uncertainCount",
  // Research → improvement loop — counts and flags only; ids and text stay in the durable experiment record.
  "findingCount", "ignoredCount", "hypothesisCount", "experimentCount", "caseCount", "targetGain", "heldOutDelta", "regressionCount", "improved",
  // Post-freeze 15C context budget — window, reserve, estimate, measured prompt size, counts and one flag.
  "contextCeiling", "outputReserve", "contextEstimate", "promptTokens", "excludedCount", "protectedRetained",
]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function safeIso(value: unknown): string {
  if (typeof value !== "string") return new Date(0).toISOString();
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value ? value : new Date(0).toISOString();
}

function safeCode(value: unknown): string | undefined {
  return typeof value === "string" && /^[A-Z][A-Z0-9_]{1,63}$/.test(value) && !/(SECRET|PASSWORD|PRIVATE|TOKEN|API_KEY)/.test(value) ? value : undefined;
}

function safeMetadata(value: unknown): AyasTraceMetadata | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  const out: Record<string, number | boolean | null> = {};
  // Only allowlisted keys are ever read, so an arbitrary payload is never enumerated.
  for (const key of METADATA_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
    const item = source[key];
    if (item === null || typeof item === "boolean" || (typeof item === "number" && Number.isFinite(item))) out[key] = item;
  }
  return Object.keys(out).length ? out : undefined;
}

/** Spread-ready sanitized fields; each sanitizer runs once per write. */
function safeDetail(metadata: unknown, errorCode: unknown): { errorCode?: string; metadata?: AyasTraceMetadata } {
  const code = safeCode(errorCode);
  const meta = safeMetadata(metadata);
  return { ...(code ? { errorCode: code } : {}), ...(meta ? { metadata: meta } : {}) };
}

const COMPONENTS = new Set(["ayas-chat", "ayas-context", "ayas-memory", "ayas-model", "ayas-tool", "ayas-repair", "ayas-route", "ayas-approval", "ayas-publication", "ayas-research"]);
const OPERATIONS = new Set(["stream-turn", "assemble", "recall", "route", "reason", "correction", "dispatch", "persist", "stream", "route-turn", "guided-repair", "load-context", "decide", "resume", "guarded-publish", "improvement-cycle", "classify-findings", "measure-gap", "run-experiment"]);
function safeLabel(value: string, allowed: ReadonlySet<string>): string {
  return allowed.has(value) ? value : "unknown";
}

/** Trace IDs are random UUIDs used only as lookup keys; they never authorize anything. */
export function isAyasTraceId(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/** Private read scope for a browser session: the hash of its session cookie, never the cookie itself. */
export function ayasTraceSessionScope(sessionToken: string | undefined): string {
  return crypto.createHash("sha256").update(sessionToken ?? "dev-session").digest("hex");
}

/** Best-effort, sanitized domain code of a thrown value. Never throws, so it cannot replace the original error. */
export function ayasTraceErrorCode(error: unknown): string | undefined {
  try {
    return error && typeof error === "object" && "code" in error ? safeCode((error as { code: unknown }).code) : undefined;
  } catch {
    return undefined;
  }
}

export interface AyasTraceStore {
  put(trace: AyasTraceSnapshot, scope: string): void;
  get(traceId: string, scope: string): AyasTraceSnapshot | undefined;
  latest(scope: string): AyasTraceSnapshot | undefined;
}

/** Bounded, process-local storage. Scope is private and never appears in a trace response. */
export class BoundedAyasTraceStore implements AyasTraceStore {
  private readonly records = new Map<string, { trace: AyasTraceSnapshot; scope: string; createdAtMs: number }>();
  private readonly maxRecords: number;
  private readonly maxAgeMs: number;
  constructor(maxRecords = AYAS_TRACE_MAX_RECORDS, maxAgeMs = AYAS_TRACE_MAX_AGE_MS, private readonly now = () => Date.now()) {
    this.maxRecords = Number.isFinite(maxRecords) ? Math.max(1, Math.min(AYAS_TRACE_MAX_RECORDS, Math.floor(maxRecords))) : AYAS_TRACE_MAX_RECORDS;
    this.maxAgeMs = Number.isFinite(maxAgeMs) ? Math.max(1, Math.min(AYAS_TRACE_MAX_AGE_MS, Math.floor(maxAgeMs))) : AYAS_TRACE_MAX_AGE_MS;
  }

  private prune(): void {
    for (const [id, record] of this.records) if (this.now() - record.createdAtMs > this.maxAgeMs) this.records.delete(id);
  }

  put(trace: AyasTraceSnapshot, scope: string): void {
    this.prune();
    this.records.set(trace.traceId, { trace, scope, createdAtMs: this.now() });
    while (this.records.size > this.maxRecords) this.records.delete(this.records.keys().next().value!);
  }

  get(traceId: string, scope: string): AyasTraceSnapshot | undefined {
    this.prune();
    const record = this.records.get(traceId);
    return record?.scope === scope ? readAyasTraceSnapshot(record.trace) : undefined;
  }

  latest(scope: string): AyasTraceSnapshot | undefined {
    this.prune();
    for (const record of [...this.records.values()].reverse()) if (record.scope === scope) return readAyasTraceSnapshot(record.trace);
    return undefined;
  }
}

// Route handlers can load separate module instances (per-route bundles, dev
// reloads). Claim one process-wide store, as the canonical pipeline runtimes do,
// so the chat route and the trace read route always see the same records.
const processTraceStoreKey = Symbol.for("atolye.ayas.unified-trace.store.v1");

function isAyasTraceStore(value: unknown): value is AyasTraceStore {
  return !!value && typeof value === "object" && ["put", "get", "latest"].every((name) => typeof (value as Record<string, unknown>)[name] === "function");
}

function claimProcessTraceStore(): AyasTraceStore {
  const existing = Object.getOwnPropertyDescriptor(globalThis, processTraceStoreKey);
  if (existing) return isAyasTraceStore(existing.value) ? existing.value : new BoundedAyasTraceStore();
  const store = new BoundedAyasTraceStore();
  Object.defineProperty(globalThis, processTraceStoreKey, { configurable: false, enumerable: false, value: store, writable: false });
  const claimed = Object.getOwnPropertyDescriptor(globalThis, processTraceStoreKey)?.value;
  return isAyasTraceStore(claimed) ? claimed : store;
}

export const ayasTraceStore: AyasTraceStore = claimProcessTraceStore();

export interface AyasTraceSpanHandle {
  readonly spanId: string | null;
  event(type: AyasTraceEventType, status: AyasTraceStatus, metadata?: AyasTraceMetadata, errorCode?: string): void;
  end(status: AyasTraceStatus, metadata?: AyasTraceMetadata, errorCode?: string): void;
}

export interface AyasTraceHandle {
  readonly traceId: string;
  startSpan(kind: AyasTraceSpanKind, component: string, operation: string, parentSpanId?: string | null, attempt?: number): AyasTraceSpanHandle;
  event(type: AyasTraceEventType, status: AyasTraceStatus, metadata?: AyasTraceMetadata, errorCode?: string): void;
  /** Adds identifiers to the trace. The model and the approval binding are set once; tools accumulate up to a bound. */
  annotate(attributes: { readonly model?: AyasTraceModelAttribute; readonly tool?: AyasTraceToolAttribute; readonly approvalBinding?: string }): void;
  finish(status: AyasTraceStatus, errorCode?: string): void;
}

const NOOP_SPAN: AyasTraceSpanHandle = { spanId: null, event() {}, end() {} };

/** Every write is best-effort and catches store/clock/serialization failures. */
export function startAyasTrace(input: { rootKind: AyasTraceRootKind; scope?: string; store?: AyasTraceStore; enabled?: boolean; evidence?: AyasTraceEvidenceSink }): AyasTraceHandle {
  let traceId: string;
  try { traceId = crypto.randomUUID(); } catch { traceId = "unavailable"; }
  const store = input.store ?? ayasTraceStore;
  const scope = input.scope ?? "operator";
  let record: MutableTrace | undefined;
  try {
    if (input.enabled !== false) {
      record = { schemaVersion: AYAS_TRACE_SCHEMA_VERSION, traceId, rootKind: input.rootKind, createdAt: new Date().toISOString(), status: "running", spans: [], events: [] };
      store.put(record, scope);
    }
  } catch { record = undefined; }

  const addEvent = (spanId: string | null, type: AyasTraceEventType, status: AyasTraceStatus, metadata?: AyasTraceMetadata, errorCode?: string) => {
    try {
      if (!record || record.events.length >= AYAS_TRACE_MAX_EVENTS || !EVENTS.has(type) || !STATUS.has(status)) return;
      record.events.push({ traceId, spanId, at: new Date().toISOString(), type, status, ...safeDetail(metadata, errorCode) });
    } catch { /* observability failure never changes a domain result */ }
  };

  return {
    traceId,
    startSpan(kind, component, operation, parentSpanId = null, attempt = 1) {
      try {
        if (!record || record.status !== "running" || record.spans.length >= AYAS_TRACE_MAX_SPANS || !KINDS.has(kind)) return NOOP_SPAN;
        if (parentSpanId && !record.spans.some((span) => span.spanId === parentSpanId)) return NOOP_SPAN;
        const spanId = crypto.randomUUID();
        const start = performance.now();
        const span: AyasTraceSpan = { spanId, parentSpanId, kind, component: safeLabel(component, COMPONENTS), operation: safeLabel(operation, OPERATIONS), attempt: Number.isSafeInteger(attempt) && attempt > 0 ? attempt : 1, startedAt: new Date().toISOString(), status: "running" };
        record.spans.push(span);
        let ended = false;
        return {
          spanId,
          event(type, status, metadata, errorCode) { addEvent(spanId, type, status, metadata, errorCode); },
          end(status, metadata, errorCode) {
            try {
              if (ended || !STATUS.has(status)) return;
              ended = true;
              Object.assign(span, { endedAt: new Date().toISOString(), durationMs: Math.max(0, performance.now() - start), status, ...safeDetail(metadata, errorCode) });
            } catch { /* best effort */ }
          },
        };
      } catch { return NOOP_SPAN; }
    },
    event(type, status, metadata, errorCode) { addEvent(null, type, status, metadata, errorCode); },
    annotate(attributes) {
      try {
        if (!record || record.status !== "running") return;
        const safe = safeAttributes({ ...(attributes.model ? { model: attributes.model } : {}), ...(attributes.tool ? { tools: [attributes.tool] } : {}),
          ...(attributes.approvalBinding ? { approvalBinding: attributes.approvalBinding } : {}) });
        if (!safe) return;
        const current = record.attributes ?? (record.attributes = {});
        if (safe.model && !current.model) current.model = safe.model;
        if (safe.approvalBinding && !current.approvalBinding) current.approvalBinding = safe.approvalBinding;
        if (safe.tools && (current.tools?.length ?? 0) < AYAS_TRACE_MAX_TOOL_ATTRIBUTES) (current.tools ?? (current.tools = [])).push(safe.tools[0]!);
      } catch { /* best effort */ }
    },
    finish(status, errorCode) {
      try {
        if (!record || record.status !== "running" || !STATUS.has(status)) return;
        record.status = status;
        record.endedAt = new Date().toISOString();
        addEvent(null, status === "error" ? "failed" : status === "cancelled" ? "cancelled" : status === "fallback" ? "fallback" : "completed", status, undefined, errorCode);
      } catch { /* best effort */ }
      // Stage 15F — hand the finished, sanitized snapshot to the durable sink, once. A failing sink changes nothing.
      try {
        const snapshot = record && record.status !== "running" && input.evidence ? readAyasTraceSnapshot(record) : undefined;
        if (snapshot) input.evidence!.record(snapshot);
      } catch { /* best effort */ }
    },
  };
}

/** Unknown future kinds are readable as data; unsupported schemas are unavailable. */
export function readAyasTraceSnapshot(raw: unknown): AyasTraceSnapshot | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as Record<string, unknown>;
  if (value.schemaVersion !== AYAS_TRACE_SCHEMA_VERSION || !isAyasTraceId(value.traceId) || !Array.isArray(value.spans) || !Array.isArray(value.events)) return undefined;
  if (value.rootKind !== "chat-turn" && value.rootKind !== "owner-approval" && value.rootKind !== "research-improvement") return undefined;
  const spans: AyasTraceSpan[] = [];
  for (const rawSpan of value.spans.slice(0, AYAS_TRACE_MAX_SPANS)) {
    if (!rawSpan || typeof rawSpan !== "object") continue;
    const span = rawSpan as Record<string, unknown>;
    if (typeof span.spanId !== "string" || !UUID_RE.test(span.spanId)) continue;
    spans.push({
      spanId: span.spanId,
      parentSpanId: typeof span.parentSpanId === "string" && UUID_RE.test(span.parentSpanId) ? span.parentSpanId : null,
      kind: KINDS.has(span.kind as AyasTraceSpanKind) ? span.kind as AyasTraceSpanKind : "outcome",
      component: safeLabel(String(span.component), COMPONENTS),
      operation: safeLabel(String(span.operation), OPERATIONS),
      attempt: Number.isSafeInteger(span.attempt) && Number(span.attempt) > 0 ? Number(span.attempt) : 1,
      startedAt: safeIso(span.startedAt),
      ...(typeof span.endedAt === "string" ? { endedAt: safeIso(span.endedAt) } : {}),
      ...(typeof span.durationMs === "number" && Number.isFinite(span.durationMs) ? { durationMs: span.durationMs } : {}),
      status: STATUS.has(span.status as AyasTraceStatus) ? span.status as AyasTraceStatus : "error",
      ...safeDetail(span.metadata, span.errorCode),
    });
  }
  const events: AyasTraceEvent[] = [];
  for (const rawEvent of value.events.slice(0, AYAS_TRACE_MAX_EVENTS)) {
    if (!rawEvent || typeof rawEvent !== "object") continue;
    const event = rawEvent as Record<string, unknown>;
    events.push({ traceId: value.traceId, spanId: typeof event.spanId === "string" && UUID_RE.test(event.spanId) ? event.spanId : null, at: safeIso(event.at), type: EVENTS.has(event.type as AyasTraceEventType) ? event.type as AyasTraceEventType : "completed", status: STATUS.has(event.status as AyasTraceStatus) ? event.status as AyasTraceStatus : "error", ...safeDetail(event.metadata, event.errorCode) });
  }
  const attributes = safeAttributes(value.attributes);
  return { schemaVersion: AYAS_TRACE_SCHEMA_VERSION, traceId: value.traceId, rootKind: value.rootKind, createdAt: safeIso(value.createdAt), ...(typeof value.endedAt === "string" ? { endedAt: safeIso(value.endedAt) } : {}), status: STATUS.has(value.status as AyasTraceStatus) ? value.status as AyasTraceStatus : "error", spans, events,
    ...(attributes ? { attributes } : {}) };
}
