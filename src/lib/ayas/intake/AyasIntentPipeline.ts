/**
 * AYAS queued-intent authorization pipeline (Master Sprint §21–23).
 *
 * When the phone reconnects it syncs a batch of *intents* it recorded while the
 * PC was offline. Every intent runs the full chain before anything is allowed
 * to happen:
 *
 *     USER → AUTH → AUTHORIZATION → ACTION POLICY → EXECUTION GATE → (engine)
 *
 * The Execution Gate is the constant `"CLOSED"` — the same invariant the Brain
 * autonomy layer enforces (`src/lib/brain/**`). So a mobile intent classified
 * as *execution* (or *forbidden*) is DENIED here and never reaches an engine.
 * Only *reasoning* intents (chat / brainstorm / analyse / plan) pass — and even
 * those are only handed to the Brain to answer or to queue as an existing
 * `auto-safe` `BrainTask`; they do not execute anything on their own.
 *
 * Pure + deterministic. No fs, no crypto, no network — the digest function is
 * injected so the durable ledger owns hashing.
 */

export const ayasIntentSchemaVersion = "1" as const;

/** Mirror of the Brain-layer Execution Gate invariant. There is no "open". */
export const ayasExecutionGate = "CLOSED" as const;
export type AyasExecutionGate = typeof ayasExecutionGate;

export type AyasIntentClassification = "reasoning" | "execution" | "forbidden";

/**
 * Fixed table — a mobile intent kind → what the chain will let it do. Mirrors
 * `BrainAutonomyPolicy`'s posture: reasoning is free, everything with a side
 * effect needs the (closed) gate, a few things are never allowed at all.
 */
const INTENT_CLASSIFICATION: Readonly<
  Record<string, AyasIntentClassification>
> = Object.freeze({
  ask: "reasoning",
  brainstorm: "reasoning",
  note: "reasoning",
  analyze: "reasoning",
  plan: "reasoning",
  "decision-support": "reasoning",
  "challenge-me": "reasoning",
  "project-question": "reasoning",

  "run-pipeline": "execution",
  "approve-improvement": "execution",
  "render-video": "execution",
  publish: "execution",
  "modify-code": "execution",
  "git-push": "execution",
  "gpu-inference": "execution",
  "delete-data": "execution",

  "change-bios": "forbidden",
  "change-power-limit": "forbidden",
  "pull-model": "forbidden",
  "disable-security-control": "forbidden",
});

export interface AyasQueuedIntent {
  /** Client-generated id — the idempotency / dedup key across reconnects. */
  readonly clientIntentId: string;
  /** Monotonic per-client sequence — gives a stable order + a high-water mark. */
  readonly clientSeq: number;
  readonly kind: string;
  readonly text: string;
  /** Client clock, informational only. */
  readonly submittedAt: string;
  readonly payload?: Readonly<Record<string, unknown>>;
}

export type AyasIntentDecision =
  | "accepted-reasoning"
  | "denied-execution-gate-closed"
  | "denied-unauthenticated"
  | "duplicate"
  | "rejected";

export type AyasIntentPipelineStage =
  | "authentication"
  | "authorization"
  | "action-policy"
  | "execution-gate";

export interface AyasIntentPipelineStep {
  readonly stage: AyasIntentPipelineStage;
  readonly outcome: "pass" | "deny";
  readonly detail: string;
}

export interface AyasIntentEvaluation {
  readonly clientIntentId: string;
  readonly clientSeq: number;
  readonly kind: string;
  readonly decision: AyasIntentDecision;
  readonly classification: AyasIntentClassification | "unknown";
  readonly executionGate: AyasExecutionGate;
  readonly steps: readonly AyasIntentPipelineStep[];
  readonly reason: string;
}

export interface AyasIntentContext {
  readonly authenticated: boolean;
  readonly executionGate: AyasExecutionGate;
  readonly nowIso: string;
}

const MAX_TEXT = 4_000;
const MAX_PAYLOAD_BYTES = 4_096;
const MAX_KIND_LENGTH = 64;
const CLIENT_INTENT_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{7,127}$/;

export function classifyAyasIntent(
  kind: string,
): AyasIntentClassification | "unknown" {
  return INTENT_CLASSIFICATION[kind] ?? "unknown";
}

export function isValidAyasClientIntentId(value: unknown): value is string {
  return typeof value === "string" && CLIENT_INTENT_ID.test(value);
}

/** The whole chain for a single intent. Never throws — every outcome is a value. */
export function evaluateAyasIntent(
  intent: AyasQueuedIntent,
  context: AyasIntentContext,
): AyasIntentEvaluation {
  const steps: AyasIntentPipelineStep[] = [];
  const clientIntentId = typeof intent?.clientIntentId === "string"
    ? intent.clientIntentId
    : "";
  const clientSeq = Number.isSafeInteger(intent?.clientSeq)
    ? (intent.clientSeq as number)
    : Number.NaN;
  const kind = typeof intent?.kind === "string" ? intent.kind : "";
  const base = {
    clientIntentId,
    clientSeq,
    kind,
    executionGate: context.executionGate,
  } as const;

  // 1 — AUTH
  if (!context.authenticated) {
    steps.push({
      stage: "authentication",
      outcome: "deny",
      detail: "request carries no valid AYAS session",
    });
    return {
      ...base,
      decision: "denied-unauthenticated",
      classification: "unknown",
      steps,
      reason: "request is not authenticated",
    };
  }
  steps.push({
    stage: "authentication",
    outcome: "pass",
    detail: "valid AYAS session",
  });

  // 2 — AUTHORIZATION (shape / bounds)
  const shape = validateIntentShape(intent);
  if (!shape.ok) {
    steps.push({ stage: "authorization", outcome: "deny", detail: shape.reason });
    return {
      ...base,
      decision: "rejected",
      classification: "unknown",
      steps,
      reason: shape.reason,
    };
  }
  steps.push({
    stage: "authorization",
    outcome: "pass",
    detail: "intent shape and bounds valid",
  });

  // 3 — ACTION POLICY
  const classification = classifyAyasIntent(kind);
  if (classification === "unknown") {
    steps.push({
      stage: "action-policy",
      outcome: "deny",
      detail: `unknown intent kind "${kind}"`,
    });
    return {
      ...base,
      decision: "rejected",
      classification: "unknown",
      steps,
      reason: `unknown intent kind "${kind}"`,
    };
  }
  steps.push({
    stage: "action-policy",
    outcome: "pass",
    detail: `classified as ${classification}`,
  });

  // 4 — EXECUTION GATE
  if (classification === "reasoning") {
    steps.push({
      stage: "execution-gate",
      outcome: "pass",
      detail: "reasoning intent — no execution is requested",
    });
    return {
      ...base,
      decision: "accepted-reasoning",
      classification,
      steps,
      reason:
        "reasoning intent accepted — handed to the Brain to answer or queue as an auto-safe task",
    };
  }

  steps.push({
    stage: "execution-gate",
    outcome: "deny",
    detail: `execution gate is ${context.executionGate}; a ${classification} intent cannot pass`,
  });
  return {
    ...base,
    decision: "denied-execution-gate-closed",
    classification,
    steps,
    reason:
      `Execution Gate is ${context.executionGate} — a mobile ${classification} intent is denied and never runs`,
  };
}

/* ------------------------------------------------------------------ ledger --- */

export interface AyasIntentLedgerEntry {
  readonly schemaVersion: typeof ayasIntentSchemaVersion;
  readonly clientIntentId: string;
  readonly clientSeq: number;
  readonly kind: string;
  readonly classification: AyasIntentClassification | "unknown";
  readonly decision: AyasIntentDecision;
  readonly executionGate: AyasExecutionGate;
  /** sha256 of the intent text — the raw utterance is NEVER stored. */
  readonly textDigest: string;
  readonly submittedAt: string;
  readonly admittedAt: string;
  readonly reason: string;
}

export interface AyasIntentAdmissionOutcome {
  readonly clientIntentId: string;
  readonly clientSeq: number;
  readonly decision: AyasIntentDecision;
  readonly duplicate: boolean;
  readonly stored: boolean;
  readonly evaluation: AyasIntentEvaluation | null;
  readonly entry: AyasIntentLedgerEntry | null;
}

export interface AyasIntentAdmissionResult {
  readonly entries: readonly AyasIntentLedgerEntry[];
  readonly outcomes: readonly AyasIntentAdmissionOutcome[];
  readonly highWaterSeq: number;
  readonly ledgerChanged: boolean;
}

export interface AyasIntentAdmissionContext extends AyasIntentContext {
  readonly textDigest: (text: string) => string;
}

/**
 * Idempotent, order-stable admission of a reconnect batch.
 *
 *  - dedup: an already-seen `clientIntentId` returns its stored decision and
 *    leaves the ledger untouched (safe to replay a whole batch);
 *  - order: the ledger is kept sorted by `(clientSeq, clientIntentId)`;
 *  - `highWaterSeq`: the max `clientSeq` the server has admitted — the client's
 *    reconnect cursor.
 */
export function admitAyasIntents(
  batch: readonly AyasQueuedIntent[],
  existing: readonly AyasIntentLedgerEntry[],
  context: AyasIntentAdmissionContext,
): AyasIntentAdmissionResult {
  const byId = new Map<string, AyasIntentLedgerEntry>();
  for (const entry of existing) byId.set(entry.clientIntentId, entry);

  const outcomes: AyasIntentAdmissionOutcome[] = [];
  let changed = false;

  for (const intent of batch) {
    const rawId = typeof intent?.clientIntentId === "string"
      ? intent.clientIntentId
      : "";

    const seen = byId.get(rawId);
    if (seen) {
      outcomes.push({
        clientIntentId: rawId,
        clientSeq: seen.clientSeq,
        decision: "duplicate",
        duplicate: true,
        stored: true,
        evaluation: null,
        entry: seen,
      });
      continue;
    }

    const evaluation = evaluateAyasIntent(intent, context);

    // Nothing safe to key on — report the rejection but do not persist it.
    if (!isValidAyasClientIntentId(rawId)) {
      outcomes.push({
        clientIntentId: rawId,
        clientSeq: evaluation.clientSeq,
        decision: evaluation.decision === "duplicate" ? "rejected" : evaluation.decision,
        duplicate: false,
        stored: false,
        evaluation,
        entry: null,
      });
      continue;
    }

    const entry: AyasIntentLedgerEntry = Object.freeze({
      schemaVersion: ayasIntentSchemaVersion,
      clientIntentId: rawId,
      clientSeq: Number.isSafeInteger(intent.clientSeq) ? intent.clientSeq : 0,
      kind: typeof intent.kind === "string" ? intent.kind.slice(0, MAX_KIND_LENGTH) : "",
      classification: evaluation.classification,
      decision: evaluation.decision,
      executionGate: context.executionGate,
      textDigest: context.textDigest(
        typeof intent.text === "string" ? intent.text : "",
      ),
      submittedAt: typeof intent.submittedAt === "string" ? intent.submittedAt : context.nowIso,
      admittedAt: context.nowIso,
      reason: evaluation.reason,
    });
    byId.set(rawId, entry);
    changed = true;
    outcomes.push({
      clientIntentId: rawId,
      clientSeq: entry.clientSeq,
      decision: entry.decision,
      duplicate: false,
      stored: true,
      evaluation,
      entry,
    });
  }

  const entries = [...byId.values()].sort(
    (left, right) =>
      left.clientSeq - right.clientSeq ||
      left.clientIntentId.localeCompare(right.clientIntentId),
  );
  const highWaterSeq = entries.reduce(
    (max, entry) => Math.max(max, entry.clientSeq),
    0,
  );
  return { entries, outcomes, highWaterSeq, ledgerChanged: changed };
}

/* --------------------------------------------------------------- internals --- */

function validateIntentShape(
  intent: AyasQueuedIntent,
): { ok: true } | { ok: false; reason: string } {
  if (!intent || typeof intent !== "object") {
    return { ok: false, reason: "intent is not an object" };
  }
  if (!isValidAyasClientIntentId(intent.clientIntentId)) {
    return { ok: false, reason: "clientIntentId is missing or malformed" };
  }
  if (!Number.isSafeInteger(intent.clientSeq) || (intent.clientSeq as number) < 0) {
    return { ok: false, reason: "clientSeq must be a non-negative integer" };
  }
  if (typeof intent.kind !== "string" || intent.kind.length === 0 ||
      intent.kind.length > MAX_KIND_LENGTH) {
    return { ok: false, reason: "kind is missing or too long" };
  }
  if (typeof intent.text !== "string" || intent.text.trim().length === 0) {
    return { ok: false, reason: "text is empty" };
  }
  if (intent.text.length > MAX_TEXT) {
    return { ok: false, reason: `text exceeds ${MAX_TEXT} characters` };
  }
  if (typeof intent.submittedAt !== "string" ||
      Number.isNaN(Date.parse(intent.submittedAt))) {
    return { ok: false, reason: "submittedAt is not an ISO timestamp" };
  }
  if (intent.payload !== undefined) {
    if (typeof intent.payload !== "object" || intent.payload === null ||
        Array.isArray(intent.payload)) {
      return { ok: false, reason: "payload must be a plain object" };
    }
    let serialized: string;
    try {
      serialized = JSON.stringify(intent.payload);
    } catch {
      return { ok: false, reason: "payload is not serializable" };
    }
    if (Buffer.byteLength(serialized, "utf8") > MAX_PAYLOAD_BYTES) {
      return { ok: false, reason: `payload exceeds ${MAX_PAYLOAD_BYTES} bytes` };
    }
  }
  return { ok: true };
}
