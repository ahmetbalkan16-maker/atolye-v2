/**
 * AYAS write-action policy (spec §13, §14, §15).
 *
 * `pipeline-recovery-plan` and `inspect-project` are read-only and already
 * allowlisted. This module designs the FIRST *write* action —
 * **`resume-stage`** — with a strict, deterministic schema, and it is
 * DELIBERATELY NOT on `AYAS_EXECUTION_ALLOWLIST`. `AyasExecutionBridge` keeps a
 * separate `writeActionsEnabled` switch (default `false`): while disabled every
 * write request is denied with `write-execution-disabled`. Enabling it is a
 * future gated step (operator + activation), not a code default.
 *
 * `resume-stage` rules (spec §14, §15):
 *  - exactly ONE project (`projectSlug`, a plain slug — no wildcard, no list);
 *  - exactly ONE stage (`stage`, a known `ProductionStepKey` — no wildcard);
 *  - the stage must be inside the project's current resume plan (`planStages`);
 *  - no arbitrary path, no command, no extra keys;
 *  - the request must carry the exact `authorizationId` it will consume.
 *
 * Pure — no fs, no `PipelineRunner`. The bridge binds the runtime authority and
 * the audit.
 */

import type { ProductionStepKey } from "@/types/project";
import {
  ayasExecutionRequestSchemaVersion,
  isUnsafeAyasProjectSlug,
  ayasExecutionRequestHasShellLikeContent,
} from "./AyasExecutionPolicy";

export type AyasWriteActionId = "resume-stage";

export const AYAS_WRITE_ACTION_IDS: readonly AyasWriteActionId[] = Object.freeze(["resume-stage"]);

/** The 12 canonical pipeline stages — a wildcard / unknown value is rejected. */
export const AYAS_RESUMABLE_STAGES: readonly ProductionStepKey[] = Object.freeze([
  "research", "script", "scenes", "visuals", "animation", "video",
  "audio", "assembly", "thumbnail", "seo", "youtube", "export",
]);

export interface AyasResumeStageRequest {
  readonly schemaVersion: typeof ayasExecutionRequestSchemaVersion;
  readonly action: "resume-stage";
  readonly requestedBy: string;
  readonly intent: string;
  readonly projectSlug: string;
  readonly stage: ProductionStepKey;
  /** The single-use grant this request will consume. */
  readonly authorizationId: string;
}

export type AyasWriteActionDenyReason =
  | "not-a-write-action"
  | "malformed-request"
  | "unsafe-project-slug"
  | "wildcard-project"
  | "wildcard-stage"
  | "unknown-stage"
  | "stage-not-in-plan"
  | "shell-like-content"
  | "missing-authorization-id"
  | "unexpected-keys";

export type AyasWriteActionValidation =
  | { readonly ok: true; readonly request: AyasResumeStageRequest }
  | { readonly ok: false; readonly reason: AyasWriteActionDenyReason; readonly detail: string };

const MAX_INTENT = 2_000;
const MAX_REQUESTED_BY = 200;
const AUTHZ_RE = /^authz-[a-zA-Z0-9-]{8,80}$/;
const ALLOWED_KEYS = new Set([
  "schemaVersion", "action", "requestedBy", "intent", "projectSlug", "stage", "authorizationId",
]);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function isAyasWriteActionId(value: unknown): value is AyasWriteActionId {
  return typeof value === "string" && (AYAS_WRITE_ACTION_IDS as readonly string[]).includes(value);
}

export interface ValidateAyasResumeStageOptions {
  /**
   * The stages currently inside the project's resume plan
   * (`PipelineRecoveryPlanner.createResumePlan(...).stagesToRun`). The requested
   * stage MUST be one of them — this is what stops AYAS asking to "resume" a
   * stage the plan would never run. Omit only in a pure schema test.
   */
  readonly planStages?: readonly string[];
}

export function validateAyasResumeStageRequest(
  raw: unknown,
  options: ValidateAyasResumeStageOptions = {},
): AyasWriteActionValidation {
  if (!isPlainObject(raw)) {
    return { ok: false, reason: "malformed-request", detail: "request is not an object" };
  }
  for (const key of Object.keys(raw)) {
    if (!ALLOWED_KEYS.has(key)) {
      return { ok: false, reason: "unexpected-keys", detail: `unexpected key "${key}"` };
    }
  }
  if (raw.action !== "resume-stage") {
    return { ok: false, reason: "not-a-write-action", detail: `action "${String(raw.action)}" is not resume-stage` };
  }
  if (raw.schemaVersion !== ayasExecutionRequestSchemaVersion) {
    return { ok: false, reason: "malformed-request", detail: "schemaVersion mismatch" };
  }
  if (typeof raw.requestedBy !== "string" || raw.requestedBy.length === 0 || raw.requestedBy.length > MAX_REQUESTED_BY) {
    return { ok: false, reason: "malformed-request", detail: "requestedBy is missing or too long" };
  }
  if (typeof raw.intent !== "string" || raw.intent.length > MAX_INTENT) {
    return { ok: false, reason: "malformed-request", detail: "intent is missing or too long" };
  }
  if (ayasExecutionRequestHasShellLikeContent(raw)) {
    return { ok: false, reason: "shell-like-content", detail: "request contains shell / traversal / injection-like content" };
  }

  // project — exactly one plain slug
  if (typeof raw.projectSlug !== "string") {
    return { ok: false, reason: "malformed-request", detail: "projectSlug is missing" };
  }
  if (raw.projectSlug === "*" || raw.projectSlug === "all" || raw.projectSlug.includes(",")) {
    return { ok: false, reason: "wildcard-project", detail: "a wildcard / multi-project resume is never allowed" };
  }
  if (isUnsafeAyasProjectSlug(raw.projectSlug)) {
    return { ok: false, reason: "unsafe-project-slug", detail: "projectSlug is not a plain slug" };
  }

  // stage — exactly one known stage
  if (typeof raw.stage !== "string") {
    return { ok: false, reason: "malformed-request", detail: "stage is missing" };
  }
  if (raw.stage === "*" || raw.stage === "all" || raw.stage.includes(",")) {
    return { ok: false, reason: "wildcard-stage", detail: "a wildcard / multi-stage resume is never allowed" };
  }
  if (!(AYAS_RESUMABLE_STAGES as readonly string[]).includes(raw.stage)) {
    return { ok: false, reason: "unknown-stage", detail: `"${raw.stage}" is not a pipeline stage` };
  }
  if (options.planStages && !options.planStages.includes(raw.stage)) {
    return {
      ok: false,
      reason: "stage-not-in-plan",
      detail: `stage "${raw.stage}" is not in this project's resume plan (${options.planStages.join(", ") || "empty"})`,
    };
  }

  if (typeof raw.authorizationId !== "string" || !AUTHZ_RE.test(raw.authorizationId)) {
    return { ok: false, reason: "missing-authorization-id", detail: "authorizationId is missing or malformed" };
  }

  return {
    ok: true,
    request: {
      schemaVersion: ayasExecutionRequestSchemaVersion,
      action: "resume-stage",
      requestedBy: raw.requestedBy,
      intent: raw.intent,
      projectSlug: raw.projectSlug,
      stage: raw.stage as ProductionStepKey,
      authorizationId: raw.authorizationId,
    },
  };
}

/** Canonical string of a resume-stage request — the authorization binding key. */
export function canonicalAyasResumeStageRequest(request: AyasResumeStageRequest): string {
  return JSON.stringify({
    schemaVersion: request.schemaVersion,
    action: request.action,
    requestedBy: request.requestedBy,
    projectSlug: request.projectSlug,
    stage: request.stage,
  });
}
