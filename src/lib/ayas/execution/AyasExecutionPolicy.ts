/**
 * AYAS Execution Policy — deterministic allowlist + plan validation (spec §7, §17).
 *
 * The LLM can only ever produce an *intent* / a *structured plan*. It NEVER
 * decides that something runs. `validateAyasExecutionRequest` is the deterministic
 * gate between "AYAS suggested an action" and "the bridge may consider it":
 *
 *  - the action must be on `AYAS_EXECUTION_ALLOWLIST` (unknown → DENY);
 *  - the request must match that action's exact shape (malformed → DENY);
 *  - a project slug must be a plain slug — no traversal, no absolute path,
 *    no separators (`../`, `/etc`, `C:\`, drive letters) → DENY;
 *  - nothing that looks like a shell command / injection is accepted → DENY;
 *  - size caps → DENY.
 *
 * Pure — no fs, no network, no clock. The one currently-allowlisted action is
 * `inspect-project`, which is **read-only** (spec §9: first real execution is
 * `DESTRUCTIVE=FALSE, WRITE=FALSE`). `run-pipeline-stage` is listed as a
 * *reserved, not-yet-enabled* slot so the wiring shape is fixed without opening
 * a write path.
 */

export const ayasExecutionRequestSchemaVersion = "1" as const;

export type AyasExecutionActionId = "inspect-project" | "pipeline-recovery-plan";

/** Reserved ids that are intentionally NOT enabled yet (write / pipeline path). */
export const AYAS_EXECUTION_RESERVED_ACTIONS: readonly string[] = Object.freeze([
  "run-pipeline-stage",
  "resume-stage",
  "retry-stage",
  "regenerate-stage",
  "publish-youtube",
]);

export interface AyasExecutionActionSpec {
  readonly id: AyasExecutionActionId;
  readonly summary: string;
  /** `false` → the action performs no writes and starts no process. */
  readonly write: boolean;
  readonly destructive: boolean;
  /** Whether the action needs a `projectSlug`. */
  readonly requiresProject: boolean;
  /** Bounded execution budget (ms) the bridge enforces. */
  readonly maxDurationMs: number;
}

export const AYAS_EXECUTION_ALLOWLIST: Readonly<Record<AyasExecutionActionId, AyasExecutionActionSpec>> =
  Object.freeze({
    "inspect-project": {
      id: "inspect-project",
      summary: "Bir projenin project.json + pipeline durumunu SALT-OKUNUR olarak özetler.",
      write: false,
      destructive: false,
      requiresProject: true,
      maxDurationMs: 5_000,
    },
    "pipeline-recovery-plan": {
      id: "pipeline-recovery-plan",
      summary:
        "PipelineRecoveryPlanner ile bir projenin resume planını + başarısız/eksik aşamalarını SALT-OKUNUR hesaplar (hiçbir aşama çalıştırılmaz).",
      write: false,
      destructive: false,
      requiresProject: true,
      maxDurationMs: 10_000,
    },
  });

export interface AyasExecutionRequest {
  readonly schemaVersion: typeof ayasExecutionRequestSchemaVersion;
  readonly action: AyasExecutionActionId;
  /** Who asked — a session / user marker, never a secret. */
  readonly requestedBy: string;
  /** The model's short natural-language intent (kept for the audit trail only). */
  readonly intent: string;
  /** Deterministic structured plan the deterministic layer validated. */
  readonly plan: Readonly<Record<string, unknown>>;
  readonly projectSlug?: string;
}

export type AyasExecutionPolicyDenyReason =
  | "unknown-action"
  | "reserved-action-not-enabled"
  | "malformed-request"
  | "malformed-plan"
  | "missing-project"
  | "unsafe-project-slug"
  | "shell-like-content"
  | "oversize";

export type AyasExecutionValidation =
  | { readonly ok: true; readonly request: AyasExecutionRequest; readonly spec: AyasExecutionActionSpec }
  | { readonly ok: false; readonly reason: AyasExecutionPolicyDenyReason; readonly detail: string };

const MAX_INTENT = 2_000;
const MAX_REQUESTED_BY = 200;
const MAX_PLAN_BYTES = 4_096;
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,126}[a-z0-9])?$/i;
/** Windows reserved device names — invalid as a path segment even with a valid shape. */
const WINDOWS_RESERVED_RE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
// deny anything that smells like a path escape, an absolute path, or a shell op
const SHELL_LIKE_RE =
  /(\.\.[\/\\]|[;&|`$]|\$\(|\|\||&&|\brm\s+-rf\b|\bpowershell\b|\bcmd(?:\.exe)?\b|\bbash\b|\bsh\s+-c\b|>\s*\/|<\s*\/|\bcurl\b|\bwget\b|\bInvoke-Expression\b|\biex\b)/i;
const PATHISH_RE = /^(?:[a-zA-Z]:[\\/]|[\\/]|~[\\/])/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** True when a string contains an unsafe project-slug shape. */
export function isUnsafeAyasProjectSlug(value: unknown): boolean {
  if (typeof value !== "string" || value.length === 0 || value.length > 128) return true;
  if (PATHISH_RE.test(value)) return true;
  if (value.includes("/") || value.includes("\\") || value.includes("..")) return true;
  if (value.includes("\0") || value.includes("%2e") || value.includes("%2f") || value.includes("%5c")) return true;
  if (WINDOWS_RESERVED_RE.test(value)) return true;
  return !SLUG_RE.test(value);
}

/** Deterministic scan for shell / injection / traversal content anywhere in the request. */
export function ayasExecutionRequestHasShellLikeContent(request: unknown): boolean {
  let serialized: string;
  try {
    serialized = JSON.stringify(request);
  } catch {
    return true;
  }
  return SHELL_LIKE_RE.test(serialized);
}

export function validateAyasExecutionRequest(raw: unknown): AyasExecutionValidation {
  if (!isPlainObject(raw)) {
    return { ok: false, reason: "malformed-request", detail: "request is not an object" };
  }

  const action = raw.action;
  if (typeof action !== "string" || action.length === 0) {
    return { ok: false, reason: "malformed-request", detail: "action is missing" };
  }
  if (AYAS_EXECUTION_RESERVED_ACTIONS.includes(action)) {
    return {
      ok: false,
      reason: "reserved-action-not-enabled",
      detail: `"${action}" is reserved and not enabled — needs its own gated sprint`,
    };
  }
  if (!(action in AYAS_EXECUTION_ALLOWLIST)) {
    return { ok: false, reason: "unknown-action", detail: `"${action}" is not on the allowlist` };
  }
  const spec = AYAS_EXECUTION_ALLOWLIST[action as AyasExecutionActionId];

  if (raw.schemaVersion !== ayasExecutionRequestSchemaVersion) {
    return { ok: false, reason: "malformed-request", detail: "schemaVersion mismatch" };
  }
  if (typeof raw.requestedBy !== "string" || raw.requestedBy.length === 0 || raw.requestedBy.length > MAX_REQUESTED_BY) {
    return { ok: false, reason: "malformed-request", detail: "requestedBy is missing or too long" };
  }
  if (typeof raw.intent !== "string" || raw.intent.length > MAX_INTENT) {
    return { ok: false, reason: "malformed-request", detail: "intent is missing or too long" };
  }
  if (!isPlainObject(raw.plan)) {
    return { ok: false, reason: "malformed-plan", detail: "plan is not an object" };
  }
  let planBytes: number;
  try {
    planBytes = Buffer.byteLength(JSON.stringify(raw.plan), "utf8");
  } catch {
    return { ok: false, reason: "malformed-plan", detail: "plan is not serializable" };
  }
  if (planBytes > MAX_PLAN_BYTES) {
    return { ok: false, reason: "oversize", detail: `plan is ${planBytes} bytes (> ${MAX_PLAN_BYTES})` };
  }

  if (ayasExecutionRequestHasShellLikeContent(raw)) {
    return { ok: false, reason: "shell-like-content", detail: "request contains shell / traversal / injection-like content" };
  }

  let projectSlug: string | undefined;
  if (spec.requiresProject) {
    if (raw.projectSlug === undefined) {
      return { ok: false, reason: "missing-project", detail: `"${action}" requires projectSlug` };
    }
    if (isUnsafeAyasProjectSlug(raw.projectSlug)) {
      return { ok: false, reason: "unsafe-project-slug", detail: "projectSlug is not a plain slug" };
    }
    projectSlug = raw.projectSlug as string;
  } else if (raw.projectSlug !== undefined && isUnsafeAyasProjectSlug(raw.projectSlug)) {
    return { ok: false, reason: "unsafe-project-slug", detail: "projectSlug is not a plain slug" };
  }

  return {
    ok: true,
    spec,
    request: {
      schemaVersion: ayasExecutionRequestSchemaVersion,
      action: action as AyasExecutionActionId,
      requestedBy: raw.requestedBy,
      intent: raw.intent,
      plan: raw.plan as Record<string, unknown>,
      ...(projectSlug ? { projectSlug } : {}),
    },
  };
}

/** Stable canonical string of a request — the authorization + audit binding key. */
export function canonicalAyasExecutionRequest(request: AyasExecutionRequest): string {
  return JSON.stringify({
    schemaVersion: request.schemaVersion,
    action: request.action,
    requestedBy: request.requestedBy,
    projectSlug: request.projectSlug ?? null,
    plan: sortValue(request.plan),
  });
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((k) => [k, sortValue((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}
