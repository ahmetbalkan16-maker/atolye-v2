import fs from "node:fs";
import path from "node:path";
import type { ProductionStepKey } from "@/types/project";
import { stableProductionId } from "./ProductionDeterminism";
import {
  type RuntimeStorageInput,
} from "@/lib/runtime/RuntimeStoragePaths";
import { getRetryBudgetExtensionDirectory } from
  "./ProductionPipelineRetryBudgetExtensionStore";

/**
 * A third narrow, purpose-built sibling of `ProductionPipelineRetryBudgetExtension*`
 * (literal-typed `currentDurableOrdinal:3 -> authorizedDurableOrdinal:4`) and
 * `ProductionPipelineRegenerationRetryBudgetExtension` (regeneration ordinal pairs).
 *
 * This one authorizes exactly ONE additional non-regeneration durable ordinal
 * (`currentDurableOrdinal + 1`) after the ordinal-4 retry-budget-extension slot
 * was itself consumed by a *proven external provider credential failure*
 * (an invalid / revoked / rotated API key, a provider auth rejection, or a
 * provider rate-limit rejection) rather than a genuine generation failure of the
 * stage's own logic. Without this, a stage whose ordinal-2..4 attempts all failed
 * only because the environment's provider credential was broken can never run
 * again once the credential is fixed -- there is no ordinal 5.
 *
 * Deliberately NOT a widening of either existing mechanism's literal-typed
 * schema. It shares only the storage directory
 * (`getRetryBudgetExtensionDirectory`) and uses a distinct filename prefix
 * (`envfail-authority-` / `envfail-receipt-`) so the three mechanisms can never
 * collide or be confused on disk.
 *
 * Fail-closed guarantees (enforced here and in ProductionEnvironmentalFailureRetryPlan.ts):
 *  - never automatic: eligibility requires an explicit, confirm-gated operator
 *    `apply-environmental-failure-retry` command;
 *  - single-use per stage: `job.attempts === currentDurableOrdinal - 1` is required
 *    to plan, so a consumed extension (which advances job.attempts) can never be
 *    re-planned, and `findMatching*` refuses once a consumed/aborted receipt exists;
 *  - never generic: the terminal ordinal's own durable `failure` block must be
 *    `category: "provider"` AND `retryable: true`, and its `failureCode` must be in
 *    the closed credential-sensitive allowlist below. A bare
 *    `THUMBNAIL_ASSET_GENERATION_FAILED` with no such durable evidence is refused;
 *  - never a skip / never unbounded: `authorizedDurableOrdinal === currentDurableOrdinal + 1`
 *    exactly, and `PipelineRetryAdmission` independently hard-rejects
 *    `admittedDurableOrdinal >= 6` for any non-regeneration retry.
 */

export const environmentalFailureRetryExtensionSchemaVersion = "1" as const;
export const environmentalFailureRetryExtensionPolicyVersion =
  "environmental-failure-retry-extension-v1" as const;

/**
 * The only `failureClass` value this mechanism accepts. A closed enum with a
 * single member: adding another class is a deliberate, separately-reviewed
 * change, never an incidental widening.
 */
export const environmentalFailureRetryClasses = [
  "external-provider-credential-invalid",
] as const;
export type EnvironmentalFailureRetryClass =
  typeof environmentalFailureRetryClasses[number];

/**
 * Closed allowlist of the ONLY generic stage failure codes for which an
 * environmental credential failure can be attested. Every one of these is
 * produced by a stage that makes a directly authenticated outbound provider
 * call (OpenAI text / image / audio / SEO / YouTube-package). Codes outside
 * this set are refused -- an FFmpeg render failure, a schema-validation
 * failure, a storage failure, etc. are never "credential" failures.
 */
export const credentialSensitiveStageFailureCodes = [
  "THUMBNAIL_ASSET_GENERATION_FAILED",
  "AUDIO_ASSET_GENERATION_FAILED",
  "IMAGE_ASSET_GENERATION_FAILED",
  "VISUAL_ASSET_GENERATION_FAILED",
  "ANIMATION_ASSET_GENERATION_FAILED",
  "AI_PROVIDER_REQUEST_FAILED",
  "SEO_ASSET_GENERATION_FAILED",
  "YOUTUBE_PACKAGE_GENERATION_FAILED",
] as const;
export type CredentialSensitiveStageFailureCode =
  typeof credentialSensitiveStageFailureCodes[number];

/** HTTP statuses an operator may attest for a credential/auth/rate-limit failure. */
export const environmentalFailureHttpStatuses = [401, 403, 429] as const;
export type EnvironmentalFailureHttpStatus =
  typeof environmentalFailureHttpStatuses[number];

export interface EnvironmentalFailureRetryOperatorEvidence {
  readonly observedHttpStatus: EnvironmentalFailureHttpStatus;
  /** Sanitized provider error code, e.g. "invalid_api_key". `[a-z0-9_.-]{1,64}`. */
  readonly observedProviderErrorCode: string;
  /** Short, sanitized operator note that the credential now re-verifies. */
  readonly remediationVerified: string;
}

export interface EnvironmentalFailureRetryTerminalAttemptBinding {
  readonly recordId: string;
  readonly recordState: string;
  readonly recordAttempt: number;
  readonly recordMaxAttempts: number;
  readonly recordIntegrityFingerprint: string;
  readonly failureCategory: "provider";
  readonly failureRetryable: true;
  readonly failureCode: string;
  readonly attemptId: string;
  readonly attemptState: string;
  readonly attemptIntegrityFingerprint: string;
  readonly leaseId: string;
  readonly leaseState: string;
  readonly leaseIntegrityFingerprint: string;
  readonly claimId: string;
  readonly claimState: string;
  readonly claimIntegrityFingerprint: string;
  readonly reservationId: string;
}

export interface EnvironmentalFailureRetryChallengePayload {
  readonly schemaVersion: typeof environmentalFailureRetryExtensionSchemaVersion;
  readonly policyVersion: typeof environmentalFailureRetryExtensionPolicyVersion;
  readonly authorizedRunType: "resume";
  readonly authorizedOperation: "pipeline.stage.resume";
  readonly failureClass: EnvironmentalFailureRetryClass;
  readonly currentDurableOrdinal: number;
  readonly authorizedDurableOrdinal: number;
  readonly baseMaxAttempts: number;
  readonly effectiveMaxAttempts: number;
  readonly projectSlug: string;
  readonly stage: ProductionStepKey;
  readonly jobId: string;
  readonly reason: string;
  readonly observedFailureCode: string;
  readonly priorJob: {
    readonly id: string;
    readonly status: "failed";
    readonly attempts: number;
    readonly updatedAt: string;
    readonly fingerprint: string;
  };
  readonly manifestPackage: {
    readonly status: "failed";
    readonly failureCode: string;
  };
  readonly latestHistory: {
    readonly eventId: string;
    readonly eventFingerprint: string;
  };
  readonly terminalDurableAttempt: EnvironmentalFailureRetryTerminalAttemptBinding;
  readonly operatorEvidence: EnvironmentalFailureRetryOperatorEvidence;
  readonly acceptanceMarkerHash: string;
  readonly configurationFingerprint: string;
  readonly authorityFingerprint: string;
}

export interface ProductionPipelineEnvironmentalFailureRetryExtensionBody
  extends EnvironmentalFailureRetryChallengePayload {
  readonly authorityId: string;
  readonly issuedAt: string;
  readonly integrity: {
    readonly algorithm: "stable-production-id-v1";
    readonly fingerprint: string;
  };
}

export type EnvironmentalFailureRetryReceiptState = "consumed" | "aborted";

export interface ProductionPipelineEnvironmentalFailureRetryExtensionReceipt {
  readonly schemaVersion: typeof environmentalFailureRetryExtensionSchemaVersion;
  readonly authorityId: string;
  readonly state: EnvironmentalFailureRetryReceiptState;
  readonly timestamp: string;
  readonly jobVersion: string;
  readonly evidence: readonly string[];
  readonly integrity: {
    readonly algorithm: "stable-production-id-v1";
    readonly fingerprint: string;
  };
}

export interface EnvironmentalFailureRetryStoreResult<T> {
  readonly ok: boolean;
  readonly status: "created" | "found" | "replayed" | "not-found" | "conflict" | "failed";
  readonly writeFree: boolean;
  readonly value?: T;
  readonly reasonCode: string;
  readonly evidence: readonly string[];
}

const SANITIZED_CODE = /^[a-z0-9_.-]{1,64}$/;
const SANITIZED_NOTE = /^[\x20-\x7E]{1,240}$/;
const SAFE_AUTHORITY_ID = /^[a-z0-9-]{16,128}$/i;

export function isCredentialSensitiveStageFailureCode(
  value: unknown,
): value is CredentialSensitiveStageFailureCode {
  return typeof value === "string" &&
    (credentialSensitiveStageFailureCodes as readonly string[]).includes(value);
}

export function isEnvironmentalFailureRetryClass(
  value: unknown,
): value is EnvironmentalFailureRetryClass {
  return typeof value === "string" &&
    (environmentalFailureRetryClasses as readonly string[]).includes(value);
}

export function isEnvironmentalFailureHttpStatus(
  value: unknown,
): value is EnvironmentalFailureHttpStatus {
  return typeof value === "number" &&
    (environmentalFailureHttpStatuses as readonly number[]).includes(value);
}

export function validateEnvironmentalFailureRetryOperatorEvidence(
  value: EnvironmentalFailureRetryOperatorEvidence,
): boolean {
  return Boolean(value) && typeof value === "object" &&
    isEnvironmentalFailureHttpStatus(value.observedHttpStatus) &&
    typeof value.observedProviderErrorCode === "string" &&
    SANITIZED_CODE.test(value.observedProviderErrorCode) &&
    typeof value.remediationVerified === "string" &&
    SANITIZED_NOTE.test(value.remediationVerified);
}

export function computeEnvironmentalFailureRetryAuthorityId(
  challengePayload: EnvironmentalFailureRetryChallengePayload,
): string {
  return stableProductionId(
    "environmental-failure-retry-extension-authority", challengePayload,
  );
}

export function computeEnvironmentalFailureRetryChallengePayload(
  input: Omit<EnvironmentalFailureRetryChallengePayload,
    "schemaVersion" | "policyVersion" | "authorizedRunType" | "authorizedOperation" |
    "baseMaxAttempts" | "effectiveMaxAttempts" | "authorizedDurableOrdinal">
    & { readonly currentDurableOrdinal: number },
): EnvironmentalFailureRetryChallengePayload {
  return {
    schemaVersion: environmentalFailureRetryExtensionSchemaVersion,
    policyVersion: environmentalFailureRetryExtensionPolicyVersion,
    authorizedRunType: "resume",
    authorizedOperation: "pipeline.stage.resume",
    baseMaxAttempts: input.currentDurableOrdinal,
    effectiveMaxAttempts: input.currentDurableOrdinal + 1,
    authorizedDurableOrdinal: input.currentDurableOrdinal + 1,
    ...input,
  };
}

export function buildProductionPipelineEnvironmentalFailureRetryExtensionBody(
  challengePayload: EnvironmentalFailureRetryChallengePayload,
  issuedAt: string,
): ProductionPipelineEnvironmentalFailureRetryExtensionBody {
  const authorityId = computeEnvironmentalFailureRetryAuthorityId(challengePayload);
  const core = { ...challengePayload, authorityId, issuedAt };
  const fingerprint = stableProductionId(
    "environmental-failure-retry-extension-body-integrity", core,
  );
  return Object.freeze({
    ...core,
    integrity: { algorithm: "stable-production-id-v1" as const, fingerprint },
  });
}

export function validateEnvironmentalFailureRetryExtensionBody(
  body: ProductionPipelineEnvironmentalFailureRetryExtensionBody,
): boolean {
  if (
    !body || typeof body !== "object" ||
    body.schemaVersion !== environmentalFailureRetryExtensionSchemaVersion ||
    body.policyVersion !== environmentalFailureRetryExtensionPolicyVersion ||
    body.authorizedRunType !== "resume" ||
    body.authorizedOperation !== "pipeline.stage.resume" ||
    !isEnvironmentalFailureRetryClass(body.failureClass) ||
    !Number.isSafeInteger(body.currentDurableOrdinal) || body.currentDurableOrdinal < 3 ||
    !Number.isSafeInteger(body.authorizedDurableOrdinal) ||
    // Exactly the next ordinal past the stuck one -- never a skip.
    body.authorizedDurableOrdinal !== body.currentDurableOrdinal + 1 ||
    body.baseMaxAttempts !== body.currentDurableOrdinal ||
    body.effectiveMaxAttempts !== body.authorizedDurableOrdinal ||
    typeof body.projectSlug !== "string" || !body.projectSlug ||
    typeof body.stage !== "string" || !body.stage ||
    body.jobId !== `${body.projectSlug}-${body.stage}` ||
    typeof body.reason !== "string" || !body.reason.trim() ||
    !isCredentialSensitiveStageFailureCode(body.observedFailureCode) ||
    body.priorJob.status !== "failed" ||
    !Number.isSafeInteger(body.priorJob.attempts) ||
    body.priorJob.attempts !== body.currentDurableOrdinal - 1 ||
    typeof body.priorJob.updatedAt !== "string" || !body.priorJob.updatedAt ||
    typeof body.priorJob.fingerprint !== "string" || !body.priorJob.fingerprint ||
    body.manifestPackage.status !== "failed" ||
    body.manifestPackage.failureCode !== body.observedFailureCode ||
    typeof body.latestHistory.eventId !== "string" || !body.latestHistory.eventId ||
    typeof body.latestHistory.eventFingerprint !== "string" ||
    !body.latestHistory.eventFingerprint ||
    !validateEnvironmentalFailureRetryTerminalAttemptBinding(
      body.terminalDurableAttempt, body.currentDurableOrdinal, body.observedFailureCode,
    ) ||
    !validateEnvironmentalFailureRetryOperatorEvidence(body.operatorEvidence) ||
    typeof body.acceptanceMarkerHash !== "string" || !body.acceptanceMarkerHash ||
    typeof body.configurationFingerprint !== "string" || !body.configurationFingerprint ||
    typeof body.authorityFingerprint !== "string" || !body.authorityFingerprint ||
    typeof body.authorityId !== "string" || !SAFE_AUTHORITY_ID.test(body.authorityId) ||
    typeof body.issuedAt !== "string" || !body.issuedAt ||
    !body.integrity || body.integrity.algorithm !== "stable-production-id-v1"
  ) return false;

  const { integrity, authorityId, issuedAt, ...payload } = body;
  const expectedFingerprint = stableProductionId(
    "environmental-failure-retry-extension-body-integrity",
    { ...payload, authorityId, issuedAt },
  );
  if (integrity.fingerprint !== expectedFingerprint) return false;
  const computedAuthorityId = computeEnvironmentalFailureRetryAuthorityId(
    payload as EnvironmentalFailureRetryChallengePayload,
  );
  return computedAuthorityId === authorityId;
}

function validateEnvironmentalFailureRetryTerminalAttemptBinding(
  binding: EnvironmentalFailureRetryTerminalAttemptBinding,
  currentDurableOrdinal: number,
  observedFailureCode: string,
): boolean {
  return Boolean(binding) && typeof binding === "object" &&
    typeof binding.recordId === "string" && binding.recordId.length > 0 &&
    binding.recordState === "cancelled" &&
    binding.recordAttempt === currentDurableOrdinal &&
    binding.recordMaxAttempts === currentDurableOrdinal &&
    typeof binding.recordIntegrityFingerprint === "string" &&
    binding.recordIntegrityFingerprint.length > 0 &&
    binding.failureCategory === "provider" &&
    binding.failureRetryable === true &&
    binding.failureCode === observedFailureCode &&
    typeof binding.attemptId === "string" && binding.attemptId.length > 0 &&
    binding.attemptState === "failed" &&
    typeof binding.attemptIntegrityFingerprint === "string" &&
    binding.attemptIntegrityFingerprint.length > 0 &&
    typeof binding.leaseId === "string" && binding.leaseId.length > 0 &&
    binding.leaseState === "released" &&
    typeof binding.leaseIntegrityFingerprint === "string" &&
    binding.leaseIntegrityFingerprint.length > 0 &&
    typeof binding.claimId === "string" && binding.claimId.length > 0 &&
    binding.claimState === "abandoned" &&
    typeof binding.claimIntegrityFingerprint === "string" &&
    binding.claimIntegrityFingerprint.length > 0 &&
    typeof binding.reservationId === "string" && binding.reservationId.length > 0;
}

export function buildProductionPipelineEnvironmentalFailureRetryExtensionReceipt(
  authorityId: string,
  state: EnvironmentalFailureRetryReceiptState,
  timestamp: string,
  jobVersion: string,
  evidence: readonly string[],
): ProductionPipelineEnvironmentalFailureRetryExtensionReceipt {
  const withoutIntegrity = {
    schemaVersion: environmentalFailureRetryExtensionSchemaVersion,
    authorityId, state, timestamp, jobVersion, evidence: [...evidence],
  };
  return Object.freeze({
    ...withoutIntegrity,
    integrity: {
      algorithm: "stable-production-id-v1" as const,
      fingerprint: stableProductionId(
        "environmental-failure-retry-extension-receipt-integrity", withoutIntegrity,
      ),
    },
  });
}

export function validateEnvironmentalFailureRetryExtensionReceipt(
  receipt: ProductionPipelineEnvironmentalFailureRetryExtensionReceipt,
): boolean {
  if (
    !receipt || typeof receipt !== "object" ||
    receipt.schemaVersion !== environmentalFailureRetryExtensionSchemaVersion ||
    (receipt.state !== "consumed" && receipt.state !== "aborted") ||
    typeof receipt.authorityId !== "string" || !receipt.authorityId ||
    typeof receipt.timestamp !== "string" || !receipt.timestamp ||
    typeof receipt.jobVersion !== "string" || !receipt.jobVersion ||
    !Array.isArray(receipt.evidence) ||
    !receipt.integrity || receipt.integrity.algorithm !== "stable-production-id-v1"
  ) return false;
  const { integrity, ...core } = receipt;
  return integrity.fingerprint === stableProductionId(
    "environmental-failure-retry-extension-receipt-integrity", core,
  );
}

// --- storage (shares the retry-budget-extensions directory, distinct prefix) ---

function directory(projectSlug: string, input: RuntimeStorageInput = {}): string {
  return getRetryBudgetExtensionDirectory(projectSlug, input);
}

function assertContained(projectSlug: string, targetPath: string, input: RuntimeStorageInput = {}) {
  const root = directory(projectSlug, input);
  const rel = path.relative(root, targetPath);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`CANONICAL_CONTAINMENT_VIOLATION: ${targetPath} is outside ${root}`);
  }
}

export function writeEnvironmentalFailureRetryExtensionAuthority(
  projectSlug: string,
  body: ProductionPipelineEnvironmentalFailureRetryExtensionBody,
  input: RuntimeStorageInput = {},
): EnvironmentalFailureRetryStoreResult<ProductionPipelineEnvironmentalFailureRetryExtensionBody> {
  if (!validateEnvironmentalFailureRetryExtensionBody(body)) {
    return { ok: false, status: "failed", writeFree: true,
      reasonCode: "ENVIRONMENTAL_FAILURE_RETRY_EXTENSION_INTEGRITY_MISMATCH",
      evidence: ["body:integrity-invalid"] };
  }
  const dir = directory(projectSlug, input);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const authorityPath = path.join(dir, `envfail-authority-${body.authorityId}.json`);
  assertContained(projectSlug, authorityPath, input);
  if (fs.existsSync(authorityPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(authorityPath, "utf8")) as
        ProductionPipelineEnvironmentalFailureRetryExtensionBody;
      if (existing.authorityId === body.authorityId &&
        validateEnvironmentalFailureRetryExtensionBody(existing)) {
        return { ok: true, status: "replayed", writeFree: true, value: existing,
          reasonCode: "ENVIRONMENTAL_FAILURE_RETRY_EXTENSION_REPLAYED",
          evidence: ["store:authority-replayed"] };
      }
      return { ok: false, status: "conflict", writeFree: true,
        reasonCode: "ENVIRONMENTAL_FAILURE_RETRY_EXTENSION_CORRUPT",
        evidence: ["store:existing-authority-corrupt"] };
    } catch {
      return { ok: false, status: "conflict", writeFree: true,
        reasonCode: "ENVIRONMENTAL_FAILURE_RETRY_EXTENSION_CORRUPT",
        evidence: ["store:existing-authority-unreadable"] };
    }
  }
  const tempPath = path.join(dir,
    `envfail-authority-${body.authorityId}.${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`);
  try {
    fs.writeFileSync(tempPath, JSON.stringify(body, null, 2) + "\n", { encoding: "utf8", flag: "wx" });
    fs.renameSync(tempPath, authorityPath);
    return { ok: true, status: "created", writeFree: false, value: body,
      reasonCode: "ENVIRONMENTAL_FAILURE_RETRY_EXTENSION_PUBLISHED",
      evidence: ["store:authority-published"] };
  } catch (error) {
    if (fs.existsSync(tempPath)) { try { fs.unlinkSync(tempPath); } catch { /* ignore */ } }
    if (fs.existsSync(authorityPath)) {
      try {
        const existing = JSON.parse(fs.readFileSync(authorityPath, "utf8")) as
          ProductionPipelineEnvironmentalFailureRetryExtensionBody;
        if (existing.authorityId === body.authorityId &&
          validateEnvironmentalFailureRetryExtensionBody(existing)) {
          return { ok: true, status: "replayed", writeFree: false, value: existing,
            reasonCode: "ENVIRONMENTAL_FAILURE_RETRY_EXTENSION_REPLAYED",
            evidence: ["store:authority-replayed-after-commit"] };
        }
      } catch { /* ignore */ }
    }
    return { ok: false, status: "failed", writeFree: false,
      reasonCode: "ENVIRONMENTAL_FAILURE_RETRY_EXTENSION_PUBLICATION_FAILED",
      evidence: [`store:write-error:${error}`] };
  }
}

export function readEnvironmentalFailureRetryExtensionAuthority(
  projectSlug: string,
  authorityId: string,
  input: RuntimeStorageInput = {},
): EnvironmentalFailureRetryStoreResult<ProductionPipelineEnvironmentalFailureRetryExtensionBody> {
  const dir = directory(projectSlug, input);
  const authorityPath = path.join(dir, `envfail-authority-${authorityId}.json`);
  assertContained(projectSlug, authorityPath, input);
  if (!fs.existsSync(authorityPath)) {
    return { ok: false, status: "not-found", writeFree: true,
      reasonCode: "ENVIRONMENTAL_FAILURE_RETRY_EXTENSION_NOT_FOUND",
      evidence: ["store:authority-not-found"] };
  }
  try {
    const body = JSON.parse(fs.readFileSync(authorityPath, "utf8")) as
      ProductionPipelineEnvironmentalFailureRetryExtensionBody;
    if (!validateEnvironmentalFailureRetryExtensionBody(body) || body.authorityId !== authorityId) {
      return { ok: false, status: "conflict", writeFree: true,
        reasonCode: "ENVIRONMENTAL_FAILURE_RETRY_EXTENSION_CORRUPT",
        evidence: ["store:authority-corrupt"] };
    }
    return { ok: true, status: "found", writeFree: true, value: body,
      reasonCode: "ENVIRONMENTAL_FAILURE_RETRY_EXTENSION_FOUND",
      evidence: ["store:authority-found"] };
  } catch {
    return { ok: false, status: "conflict", writeFree: true,
      reasonCode: "ENVIRONMENTAL_FAILURE_RETRY_EXTENSION_CORRUPT",
      evidence: ["store:authority-unreadable"] };
  }
}

export function writeEnvironmentalFailureRetryExtensionReceipt(
  projectSlug: string,
  receipt: ProductionPipelineEnvironmentalFailureRetryExtensionReceipt,
  input: RuntimeStorageInput = {},
): EnvironmentalFailureRetryStoreResult<ProductionPipelineEnvironmentalFailureRetryExtensionReceipt> {
  if (!validateEnvironmentalFailureRetryExtensionReceipt(receipt)) {
    return { ok: false, status: "failed", writeFree: true,
      reasonCode: "ENVIRONMENTAL_FAILURE_RETRY_EXTENSION_RECEIPT_CORRUPT",
      evidence: ["receipt:integrity-invalid"] };
  }
  const dir = directory(projectSlug, input);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const receiptPath = path.join(dir, `envfail-receipt-${receipt.authorityId}-${receipt.state}.json`);
  assertContained(projectSlug, receiptPath, input);
  if (fs.existsSync(receiptPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(receiptPath, "utf8")) as
        ProductionPipelineEnvironmentalFailureRetryExtensionReceipt;
      if (existing.authorityId === receipt.authorityId &&
        existing.jobVersion === receipt.jobVersion &&
        existing.integrity.fingerprint === receipt.integrity.fingerprint) {
        return { ok: true, status: "replayed", writeFree: true, value: existing,
          reasonCode: "ENVIRONMENTAL_FAILURE_RETRY_EXTENSION_RECEIPT_REPLAYED",
          evidence: [`store:receipt-${receipt.state}-replayed`] };
      }
      return { ok: false, status: "conflict", writeFree: true,
        reasonCode: "ENVIRONMENTAL_FAILURE_RETRY_EXTENSION_ALREADY_CONSUMED",
        evidence: [`store:receipt-${receipt.state}-already-exists-conflict`] };
    } catch {
      return { ok: false, status: "conflict", writeFree: true,
        reasonCode: "ENVIRONMENTAL_FAILURE_RETRY_EXTENSION_RECEIPT_CORRUPT",
        evidence: [`store:receipt-${receipt.state}-corrupt`] };
    }
  }
  try {
    fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + "\n", { encoding: "utf8", flag: "wx" });
    return { ok: true, status: "created", writeFree: false, value: receipt,
      reasonCode: "ENVIRONMENTAL_FAILURE_RETRY_EXTENSION_RECEIPT_WRITTEN",
      evidence: [`store:receipt-${receipt.state}-written`] };
  } catch (error) {
    if (fs.existsSync(receiptPath)) {
      try {
        const existing = JSON.parse(fs.readFileSync(receiptPath, "utf8")) as
          ProductionPipelineEnvironmentalFailureRetryExtensionReceipt;
        if (existing.authorityId === receipt.authorityId &&
          existing.jobVersion === receipt.jobVersion &&
          existing.integrity.fingerprint === receipt.integrity.fingerprint) {
          return { ok: true, status: "replayed", writeFree: false, value: existing,
            reasonCode: "ENVIRONMENTAL_FAILURE_RETRY_EXTENSION_RECEIPT_REPLAYED",
            evidence: [`store:receipt-${receipt.state}-replayed-after-commit`] };
        }
      } catch { /* ignore */ }
    }
    return { ok: false, status: "failed", writeFree: false,
      reasonCode: "ENVIRONMENTAL_FAILURE_RETRY_EXTENSION_RECEIPT_WRITE_FAILED",
      evidence: [`store:receipt-write-error:${error}`] };
  }
}

export function readEnvironmentalFailureRetryExtensionReceipt(
  projectSlug: string,
  authorityId: string,
  state: EnvironmentalFailureRetryReceiptState,
  input: RuntimeStorageInput = {},
): EnvironmentalFailureRetryStoreResult<ProductionPipelineEnvironmentalFailureRetryExtensionReceipt> {
  const dir = directory(projectSlug, input);
  const receiptPath = path.join(dir, `envfail-receipt-${authorityId}-${state}.json`);
  assertContained(projectSlug, receiptPath, input);
  if (!fs.existsSync(receiptPath)) {
    return { ok: false, status: "not-found", writeFree: true,
      reasonCode: "ENVIRONMENTAL_FAILURE_RETRY_EXTENSION_RECEIPT_NOT_FOUND",
      evidence: [`store:receipt-${state}-not-found`] };
  }
  try {
    const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8")) as
      ProductionPipelineEnvironmentalFailureRetryExtensionReceipt;
    if (!validateEnvironmentalFailureRetryExtensionReceipt(receipt) ||
      receipt.authorityId !== authorityId || receipt.state !== state) {
      return { ok: false, status: "conflict", writeFree: true,
        reasonCode: "ENVIRONMENTAL_FAILURE_RETRY_EXTENSION_RECEIPT_CORRUPT",
        evidence: [`store:receipt-${state}-corrupt`] };
    }
    return { ok: true, status: "found", writeFree: true, value: receipt,
      reasonCode: "ENVIRONMENTAL_FAILURE_RETRY_EXTENSION_RECEIPT_FOUND",
      evidence: [`store:receipt-${state}-found`] };
  } catch {
    return { ok: false, status: "conflict", writeFree: true,
      reasonCode: "ENVIRONMENTAL_FAILURE_RETRY_EXTENSION_RECEIPT_CORRUPT",
      evidence: [`store:receipt-${state}-unreadable`] };
  }
}

/**
 * Pre-consumption lookup: an authority matching this exact (project, stage, job,
 * priorAttempts, ordinal) tuple that has NOT yet been consumed or aborted.
 * Read-only. Returns undefined so callers fall through to the ordinary
 * (unextended) budget check.
 */
export function findMatchingEnvironmentalFailureRetryExtension(
  projectSlug: string,
  stage: ProductionStepKey,
  job: { readonly id: string; readonly attempts: number },
  admittedDurableOrdinal: number,
  input: RuntimeStorageInput = {},
): { readonly authorityId: string;
  readonly body: ProductionPipelineEnvironmentalFailureRetryExtensionBody } | undefined {
  if (!Number.isSafeInteger(job.attempts) || job.attempts < 2) return undefined;
  const dir = directory(projectSlug, input);
  if (!fs.existsSync(dir)) return undefined;
  let files: string[];
  try { files = fs.readdirSync(dir); } catch { return undefined; }
  for (const file of files) {
    if (!file.startsWith("envfail-authority-") || !file.endsWith(".json")) continue;
    const authorityId = file.slice("envfail-authority-".length, -".json".length);
    const read = readEnvironmentalFailureRetryExtensionAuthority(projectSlug, authorityId, input);
    if (!read.ok || !read.value) continue;
    const body = read.value;
    if (
      body.projectSlug !== projectSlug || body.stage !== stage || body.jobId !== job.id ||
      body.priorJob.attempts !== job.attempts ||
      body.authorizedDurableOrdinal !== admittedDurableOrdinal ||
      body.currentDurableOrdinal !== job.attempts + 1
    ) continue;
    if (readEnvironmentalFailureRetryExtensionReceipt(projectSlug, authorityId, "consumed", input).ok) continue;
    if (readEnvironmentalFailureRetryExtensionReceipt(projectSlug, authorityId, "aborted", input).ok) continue;
    return { authorityId, body };
  }
  return undefined;
}

/**
 * Execution-time proof (mirror of `findMatching*`): an authority that matched
 * this exact tuple AND was already legitimately consumed for exactly this job
 * version -- i.e. the current queued job is the genuine product of that one
 * admission. `job.attempts` here is the CURRENT (post-admission) counter, so the
 * prior value and the authorized ordinal are derived with the exact arithmetic
 * `prepareFailedStageRetry` used (`admittedJobAttemptIndex = priorAttempts + 1`,
 * `admittedDurableOrdinal = admittedJobAttemptIndex + 1`). Read-only; fails
 * closed on any mismatch or stale jobVersion.
 */
export function findConsumedEnvironmentalFailureRetryExtension(
  projectSlug: string,
  stage: ProductionStepKey,
  job: { readonly id: string; readonly attempts: number; readonly updatedAt: string },
  input: RuntimeStorageInput = {},
): { readonly authorityId: string;
  readonly body: ProductionPipelineEnvironmentalFailureRetryExtensionBody;
  readonly receipt: ProductionPipelineEnvironmentalFailureRetryExtensionReceipt } | undefined {
  if (!Number.isSafeInteger(job.attempts) || job.attempts < 3) return undefined;
  const dir = directory(projectSlug, input);
  if (!fs.existsSync(dir)) return undefined;
  let files: string[];
  try { files = fs.readdirSync(dir); } catch { return undefined; }
  const priorAttempts = job.attempts - 1;
  const admittedDurableOrdinal = job.attempts + 1;
  for (const file of files) {
    if (!file.startsWith("envfail-authority-") || !file.endsWith(".json")) continue;
    const authorityId = file.slice("envfail-authority-".length, -".json".length);
    const read = readEnvironmentalFailureRetryExtensionAuthority(projectSlug, authorityId, input);
    if (!read.ok || !read.value) continue;
    const body = read.value;
    if (
      body.projectSlug !== projectSlug || body.stage !== stage || body.jobId !== job.id ||
      body.priorJob.attempts !== priorAttempts ||
      body.authorizedDurableOrdinal !== admittedDurableOrdinal ||
      body.currentDurableOrdinal !== priorAttempts + 1
    ) continue;
    if (readEnvironmentalFailureRetryExtensionReceipt(projectSlug, authorityId, "aborted", input).ok) continue;
    const consumed = readEnvironmentalFailureRetryExtensionReceipt(projectSlug, authorityId, "consumed", input);
    if (!consumed.ok || !consumed.value) continue;
    if (consumed.value.authorityId !== authorityId || consumed.value.state !== "consumed") continue;
    if (consumed.value.jobVersion !== job.updatedAt) continue;
    return { authorityId, body, receipt: consumed.value };
  }
  return undefined;
}
