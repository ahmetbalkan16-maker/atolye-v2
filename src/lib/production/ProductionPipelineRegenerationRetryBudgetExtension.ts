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
 * A narrow, purpose-built sibling of `ProductionPipelineRetryBudgetExtension*`
 * (which is hard-coded, end to end, to the single non-regeneration
 * `currentDurableOrdinal:3 -> authorizedDurableOrdinal:4` case via literal
 * TypeScript types). Reopening an orphan-recovered attempt inside an active
 * regeneration needs the same *shape* of one-time, narrowly-bound budget
 * exception, but for an arbitrary (regeneration, ordinal) pair — so this is
 * a separate, smaller mechanism rather than a widening of that literal-typed
 * schema. It shares only the storage directory
 * (`getRetryBudgetExtensionDirectory`) and uses a distinct filename prefix
 * (`regen-authority-` / `regen-receipt-`) so the two mechanisms can never
 * collide or be confused with one another on disk.
 *
 * Deliberately narrower than the ordinal-4 mechanism: no multi-phase
 * issued/consuming/consumed/aborted/settled receipt lifecycle, no
 * "manifestAudio"/"acceptanceMarkerHash"-style domain challenge fields.
 * Those were specific to the historical incident that mechanism was built
 * for and don't generalize; this one only proves single-use, CAS-bound
 * authorization for exactly one (project, stage, job, regeneration,
 * ordinal) tuple. If this pattern is needed repeatedly, it should be
 * generalized deliberately, not by widening either mechanism silently.
 */

export const regenerationRetryBudgetExtensionSchemaVersion = "1" as const;
export const regenerationRetryBudgetExtensionPolicyVersion =
  "regeneration-retry-budget-extension-v1" as const;

export interface ProductionPipelineRegenerationRetryBudgetExtensionBody {
  readonly schemaVersion: typeof regenerationRetryBudgetExtensionSchemaVersion;
  readonly policyVersion: typeof regenerationRetryBudgetExtensionPolicyVersion;
  readonly authorityId: string;
  readonly issuedAt: string;
  readonly projectSlug: string;
  readonly stage: ProductionStepKey;
  readonly jobId: string;
  readonly regenerationId: string;
  readonly generationOrdinal: number;
  readonly currentDurableOrdinal: number;
  readonly authorizedDurableOrdinal: number;
  readonly reason: string;
  readonly priorJob: {
    readonly id: string;
    readonly status: "failed";
    readonly attempts: number;
    readonly attemptWithinGeneration: number;
    readonly updatedAt: string;
    readonly fingerprint: string;
  };
  readonly integrity: {
    readonly algorithm: "stable-production-id-v1";
    readonly fingerprint: string;
  };
}

export type RegenerationRetryBudgetExtensionReceiptState = "consumed" | "aborted";

export interface ProductionPipelineRegenerationRetryBudgetExtensionReceipt {
  readonly schemaVersion: typeof regenerationRetryBudgetExtensionSchemaVersion;
  readonly authorityId: string;
  readonly state: RegenerationRetryBudgetExtensionReceiptState;
  readonly timestamp: string;
  readonly jobVersion: string;
  readonly evidence: readonly string[];
  readonly integrity: {
    readonly algorithm: "stable-production-id-v1";
    readonly fingerprint: string;
  };
}

export interface RegenerationRetryBudgetExtensionStoreResult<T> {
  readonly ok: boolean;
  readonly status: "created" | "found" | "replayed" | "not-found" | "conflict" | "failed";
  readonly writeFree: boolean;
  readonly value?: T;
  readonly reasonCode: string;
  readonly evidence: readonly string[];
}

export function buildProductionPipelineRegenerationRetryBudgetExtensionBody(
  input: Omit<ProductionPipelineRegenerationRetryBudgetExtensionBody, "integrity">,
): ProductionPipelineRegenerationRetryBudgetExtensionBody {
  const withoutIntegrity = { ...input };
  const fingerprint = stableProductionId(
    "regeneration-retry-budget-extension-authority", withoutIntegrity,
  );
  return Object.freeze({
    ...withoutIntegrity,
    integrity: { algorithm: "stable-production-id-v1" as const, fingerprint },
  });
}

export function validateRegenerationRetryBudgetExtensionBody(
  body: ProductionPipelineRegenerationRetryBudgetExtensionBody,
): boolean {
  if (
    body.schemaVersion !== regenerationRetryBudgetExtensionSchemaVersion ||
    body.policyVersion !== regenerationRetryBudgetExtensionPolicyVersion ||
    typeof body.authorityId !== "string" || !body.authorityId ||
    typeof body.projectSlug !== "string" || !body.projectSlug ||
    typeof body.stage !== "string" || !body.stage ||
    typeof body.jobId !== "string" || !body.jobId ||
    typeof body.regenerationId !== "string" || !body.regenerationId ||
    !Number.isSafeInteger(body.generationOrdinal) || body.generationOrdinal < 1 ||
    !Number.isSafeInteger(body.currentDurableOrdinal) || body.currentDurableOrdinal < 0 ||
    !Number.isSafeInteger(body.authorizedDurableOrdinal) ||
    // The whole point of this mechanism is to authorize exactly the next
    // ordinal past the one that's currently stuck — never a skip.
    body.authorizedDurableOrdinal !== body.currentDurableOrdinal + 1 ||
    body.priorJob.status !== "failed" ||
    !Number.isSafeInteger(body.priorJob.attempts) || body.priorJob.attempts < 0 ||
    !Number.isSafeInteger(body.priorJob.attemptWithinGeneration) ||
    body.priorJob.attemptWithinGeneration < 0
  ) return false;
  const { integrity, ...withoutIntegrity } = body;
  return integrity.algorithm === "stable-production-id-v1" &&
    integrity.fingerprint === stableProductionId(
      "regeneration-retry-budget-extension-authority", withoutIntegrity,
    );
}

export function buildProductionPipelineRegenerationRetryBudgetExtensionReceipt(
  authorityId: string,
  state: RegenerationRetryBudgetExtensionReceiptState,
  timestamp: string,
  jobVersion: string,
  evidence: readonly string[],
): ProductionPipelineRegenerationRetryBudgetExtensionReceipt {
  const withoutIntegrity = { schemaVersion: regenerationRetryBudgetExtensionSchemaVersion,
    authorityId, state, timestamp, jobVersion, evidence };
  return Object.freeze({
    ...withoutIntegrity,
    integrity: { algorithm: "stable-production-id-v1" as const,
      fingerprint: stableProductionId("regeneration-retry-budget-extension-receipt", withoutIntegrity) },
  });
}

function directory(projectSlug: string, input: RuntimeStorageInput = {}): string {
  // Deliberately the SAME directory as the ordinal-4 mechanism — only the
  // filename prefix differs (regen-authority- / regen-receipt- vs.
  // authority- / receipt-), so the two can never collide.
  return getRetryBudgetExtensionDirectory(projectSlug, input);
}

function assertContained(projectSlug: string, targetPath: string, input: RuntimeStorageInput = {}) {
  const root = directory(projectSlug, input);
  const rel = path.relative(root, targetPath);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`CANONICAL_CONTAINMENT_VIOLATION: ${targetPath} is outside ${root}`);
  }
}

export function writeRegenerationRetryBudgetExtensionAuthority(
  projectSlug: string,
  body: ProductionPipelineRegenerationRetryBudgetExtensionBody,
  input: RuntimeStorageInput = {},
): RegenerationRetryBudgetExtensionStoreResult<ProductionPipelineRegenerationRetryBudgetExtensionBody> {
  if (!validateRegenerationRetryBudgetExtensionBody(body)) {
    return { ok: false, status: "failed", writeFree: true,
      reasonCode: "PIPELINE_REGENERATION_RETRY_BUDGET_EXTENSION_INTEGRITY_MISMATCH",
      evidence: ["body:integrity-invalid"] };
  }
  const dir = directory(projectSlug, input);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const authorityPath = path.join(dir, `regen-authority-${body.authorityId}.json`);
  assertContained(projectSlug, authorityPath, input);
  if (fs.existsSync(authorityPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(authorityPath, "utf8")) as
        ProductionPipelineRegenerationRetryBudgetExtensionBody;
      if (existing.authorityId === body.authorityId && validateRegenerationRetryBudgetExtensionBody(existing)) {
        return { ok: true, status: "replayed", writeFree: true, value: existing,
          reasonCode: "PIPELINE_REGENERATION_RETRY_BUDGET_EXTENSION_REPLAYED",
          evidence: ["store:authority-replayed"] };
      }
      return { ok: false, status: "conflict", writeFree: true,
        reasonCode: "PIPELINE_REGENERATION_RETRY_BUDGET_EXTENSION_CORRUPT",
        evidence: ["store:existing-authority-corrupt"] };
    } catch {
      return { ok: false, status: "conflict", writeFree: true,
        reasonCode: "PIPELINE_REGENERATION_RETRY_BUDGET_EXTENSION_CORRUPT",
        evidence: ["store:existing-authority-unreadable"] };
    }
  }
  const tempPath = path.join(dir,
    `regen-authority-${body.authorityId}.${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`);
  try {
    fs.writeFileSync(tempPath, JSON.stringify(body, null, 2) + "\n", { encoding: "utf8", flag: "wx" });
    fs.renameSync(tempPath, authorityPath);
    return { ok: true, status: "created", writeFree: false, value: body,
      reasonCode: "PIPELINE_REGENERATION_RETRY_BUDGET_EXTENSION_PUBLISHED",
      evidence: ["store:authority-published"] };
  } catch (error) {
    if (fs.existsSync(tempPath)) { try { fs.unlinkSync(tempPath); } catch { /* ignore */ } }
    return { ok: false, status: "failed", writeFree: false,
      reasonCode: "PIPELINE_REGENERATION_RETRY_BUDGET_EXTENSION_PUBLICATION_FAILED",
      evidence: [`store:write-error:${error}`] };
  }
}

export function readRegenerationRetryBudgetExtensionAuthority(
  projectSlug: string,
  authorityId: string,
  input: RuntimeStorageInput = {},
): RegenerationRetryBudgetExtensionStoreResult<ProductionPipelineRegenerationRetryBudgetExtensionBody> {
  const dir = directory(projectSlug, input);
  const authorityPath = path.join(dir, `regen-authority-${authorityId}.json`);
  assertContained(projectSlug, authorityPath, input);
  if (!fs.existsSync(authorityPath)) {
    return { ok: false, status: "not-found", writeFree: true,
      reasonCode: "PIPELINE_REGENERATION_RETRY_BUDGET_EXTENSION_NOT_FOUND",
      evidence: ["store:authority-not-found"] };
  }
  try {
    const body = JSON.parse(fs.readFileSync(authorityPath, "utf8")) as
      ProductionPipelineRegenerationRetryBudgetExtensionBody;
    if (!validateRegenerationRetryBudgetExtensionBody(body) || body.authorityId !== authorityId) {
      return { ok: false, status: "conflict", writeFree: true,
        reasonCode: "PIPELINE_REGENERATION_RETRY_BUDGET_EXTENSION_CORRUPT",
        evidence: ["store:authority-corrupt"] };
    }
    return { ok: true, status: "found", writeFree: true, value: body,
      reasonCode: "PIPELINE_REGENERATION_RETRY_BUDGET_EXTENSION_FOUND",
      evidence: ["store:authority-found"] };
  } catch {
    return { ok: false, status: "conflict", writeFree: true,
      reasonCode: "PIPELINE_REGENERATION_RETRY_BUDGET_EXTENSION_CORRUPT",
      evidence: ["store:authority-unreadable"] };
  }
}

export function writeRegenerationRetryBudgetExtensionReceipt(
  projectSlug: string,
  receipt: ProductionPipelineRegenerationRetryBudgetExtensionReceipt,
  input: RuntimeStorageInput = {},
): RegenerationRetryBudgetExtensionStoreResult<ProductionPipelineRegenerationRetryBudgetExtensionReceipt> {
  const dir = directory(projectSlug, input);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const receiptPath = path.join(dir, `regen-receipt-${receipt.authorityId}-${receipt.state}.json`);
  assertContained(projectSlug, receiptPath, input);
  if (fs.existsSync(receiptPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(receiptPath, "utf8")) as
        ProductionPipelineRegenerationRetryBudgetExtensionReceipt;
      if (existing.authorityId === receipt.authorityId &&
        existing.jobVersion === receipt.jobVersion &&
        existing.integrity.fingerprint === receipt.integrity.fingerprint) {
        return { ok: true, status: "replayed", writeFree: true, value: existing,
          reasonCode: "PIPELINE_REGENERATION_RETRY_BUDGET_EXTENSION_RECEIPT_REPLAYED",
          evidence: [`store:receipt-${receipt.state}-replayed`] };
      }
      return { ok: false, status: "conflict", writeFree: true,
        reasonCode: "PIPELINE_REGENERATION_RETRY_BUDGET_EXTENSION_ALREADY_CONSUMED",
        evidence: [`store:receipt-${receipt.state}-already-exists-conflict`] };
    } catch {
      return { ok: false, status: "conflict", writeFree: true,
        reasonCode: "PIPELINE_REGENERATION_RETRY_BUDGET_EXTENSION_RECEIPT_CORRUPT",
        evidence: [`store:receipt-${receipt.state}-corrupt`] };
    }
  }
  try {
    fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + "\n", { encoding: "utf8", flag: "wx" });
    return { ok: true, status: "created", writeFree: false, value: receipt,
      reasonCode: "PIPELINE_REGENERATION_RETRY_BUDGET_EXTENSION_RECEIPT_WRITTEN",
      evidence: [`store:receipt-${receipt.state}-written`] };
  } catch (error) {
    return { ok: false, status: "failed", writeFree: false,
      reasonCode: "PIPELINE_REGENERATION_RETRY_BUDGET_EXTENSION_RECEIPT_WRITE_FAILED",
      evidence: [`store:receipt-write-error:${error}`] };
  }
}

export function readRegenerationRetryBudgetExtensionReceipt(
  projectSlug: string,
  authorityId: string,
  state: RegenerationRetryBudgetExtensionReceiptState,
  input: RuntimeStorageInput = {},
): RegenerationRetryBudgetExtensionStoreResult<ProductionPipelineRegenerationRetryBudgetExtensionReceipt> {
  const dir = directory(projectSlug, input);
  const receiptPath = path.join(dir, `regen-receipt-${authorityId}-${state}.json`);
  assertContained(projectSlug, receiptPath, input);
  if (!fs.existsSync(receiptPath)) {
    return { ok: false, status: "not-found", writeFree: true,
      reasonCode: "PIPELINE_REGENERATION_RETRY_BUDGET_EXTENSION_RECEIPT_NOT_FOUND",
      evidence: [`store:receipt-${state}-not-found`] };
  }
  try {
    const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8")) as
      ProductionPipelineRegenerationRetryBudgetExtensionReceipt;
    if (receipt.authorityId !== authorityId || receipt.state !== state) {
      return { ok: false, status: "conflict", writeFree: true,
        reasonCode: "PIPELINE_REGENERATION_RETRY_BUDGET_EXTENSION_RECEIPT_CORRUPT",
        evidence: [`store:receipt-${state}-corrupt`] };
    }
    return { ok: true, status: "found", writeFree: true, value: receipt,
      reasonCode: "PIPELINE_REGENERATION_RETRY_BUDGET_EXTENSION_RECEIPT_FOUND",
      evidence: [`store:receipt-${state}-found`] };
  } catch {
    return { ok: false, status: "conflict", writeFree: true,
      reasonCode: "PIPELINE_REGENERATION_RETRY_BUDGET_EXTENSION_RECEIPT_CORRUPT",
      evidence: [`store:receipt-${state}-unreadable`] };
  }
}

/**
 * Finds a regeneration-retry-budget-extension authority matching this exact
 * (project, stage, job, regeneration, ordinal) tuple and not yet consumed
 * or aborted. Read-only — never writes. Returns undefined if none matches,
 * so callers fall through to the ordinary (unextended) budget check.
 */
export function findMatchingRegenerationRetryBudgetExtension(
  projectSlug: string,
  stage: ProductionStepKey,
  job: { readonly id: string; readonly regenerationId?: string; readonly generationOrdinal?: number;
    readonly attempts: number },
  admittedDurableOrdinal: number,
  input: RuntimeStorageInput = {},
): { readonly authorityId: string; readonly body: ProductionPipelineRegenerationRetryBudgetExtensionBody }
  | undefined {
  if (!job.regenerationId || !Number.isSafeInteger(job.generationOrdinal)) return undefined;
  const dir = directory(projectSlug, input);
  if (!fs.existsSync(dir)) return undefined;
  let files: string[];
  try { files = fs.readdirSync(dir); } catch { return undefined; }
  for (const file of files) {
    if (!file.startsWith("regen-authority-") || !file.endsWith(".json")) continue;
    const authorityId = file.slice("regen-authority-".length, -".json".length);
    const read = readRegenerationRetryBudgetExtensionAuthority(projectSlug, authorityId, input);
    if (!read.ok || !read.value) continue;
    const body = read.value;
    if (
      body.projectSlug !== projectSlug || body.stage !== stage || body.jobId !== job.id ||
      body.regenerationId !== job.regenerationId || body.generationOrdinal !== job.generationOrdinal ||
      body.priorJob.attempts !== job.attempts || body.authorizedDurableOrdinal !== admittedDurableOrdinal
    ) continue;
    const consumed = readRegenerationRetryBudgetExtensionReceipt(projectSlug, authorityId, "consumed", input);
    if (consumed.ok) continue;
    const aborted = readRegenerationRetryBudgetExtensionReceipt(projectSlug, authorityId, "aborted", input);
    if (aborted.ok) continue;
    return { authorityId, body };
  }
  return undefined;
}

/**
 * Execution-time counterpart to `findMatchingRegenerationRetryBudgetExtension`
 * above. That function is deliberately "not yet consumed" -- so once
 * `prepareFailedStageRetry` has actually consumed an authority and admitted
 * the retry (job now "queued"), it can no longer be used to recognize the
 * admission on a *later*, separate resume attempt. This is the mirror image:
 * it proves an authority was found, matched this exact (project, stage, job,
 * regeneration, ordinal) tuple, AND was already legitimately consumed for
 * exactly this job version -- i.e. that the current queued job is the
 * genuine product of that one admission, not a stale or replayed one.
 *
 * Read-only -- never writes, never re-consumes, never mutates any authority
 * or receipt. Fails closed (returns undefined) on any missing file, corrupt
 * JSON, tuple mismatch, non-"consumed" receipt state, or stale jobVersion.
 * `job.attempts` here is the CURRENT (post-admission) job attempts counter;
 * the prior (pre-admission) value and the authorized durable ordinal are
 * derived from it using the exact same arithmetic `prepareFailedStageRetry`
 * used to admit the retry (`admittedJobAttemptIndex = priorAttempts + 1`,
 * `admittedDurableOrdinal = admittedJobAttemptIndex + 1`).
 */
export function findConsumedRegenerationRetryBudgetExtension(
  projectSlug: string,
  stage: ProductionStepKey,
  job: { readonly id: string; readonly regenerationId?: string; readonly generationOrdinal?: number;
    readonly attempts: number; readonly updatedAt: string },
  input: RuntimeStorageInput = {},
): { readonly authorityId: string; readonly body: ProductionPipelineRegenerationRetryBudgetExtensionBody;
    readonly receipt: ProductionPipelineRegenerationRetryBudgetExtensionReceipt }
  | undefined {
  if (!job.regenerationId || !Number.isSafeInteger(job.generationOrdinal)) return undefined;
  if (!Number.isSafeInteger(job.attempts) || job.attempts < 1) return undefined;
  const dir = directory(projectSlug, input);
  if (!fs.existsSync(dir)) return undefined;
  let files: string[];
  try { files = fs.readdirSync(dir); } catch { return undefined; }
  const priorAttempts = job.attempts - 1;
  const admittedDurableOrdinal = job.attempts + 1;
  for (const file of files) {
    if (!file.startsWith("regen-authority-") || !file.endsWith(".json")) continue;
    const authorityId = file.slice("regen-authority-".length, -".json".length);
    const read = readRegenerationRetryBudgetExtensionAuthority(projectSlug, authorityId, input);
    if (!read.ok || !read.value) continue;
    const body = read.value;
    if (
      body.projectSlug !== projectSlug || body.stage !== stage || body.jobId !== job.id ||
      body.regenerationId !== job.regenerationId || body.generationOrdinal !== job.generationOrdinal ||
      body.priorJob.attempts !== priorAttempts || body.authorizedDurableOrdinal !== admittedDurableOrdinal
    ) continue;
    const consumed = readRegenerationRetryBudgetExtensionReceipt(projectSlug, authorityId, "consumed", input);
    if (!consumed.ok || !consumed.value) continue;
    if (consumed.value.authorityId !== authorityId || consumed.value.state !== "consumed") continue;
    if (consumed.value.jobVersion !== job.updatedAt) continue;
    return { authorityId, body, receipt: consumed.value };
  }
  return undefined;
}
