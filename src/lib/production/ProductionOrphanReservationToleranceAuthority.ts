import fs from "node:fs";
import path from "node:path";
import type { ProductionStepKey } from "@/types/project";
import type { ProductionExecutionIdempotencyReservationRequest } from
  "@/types/productionExecutionIdempotency";
import type { ProductionExecutionPersistenceAdapter } from "@/types/productionExecutionPersistence";
import { stableProductionId } from "./ProductionDeterminism";
import {
  type RuntimeStorageInput,
  getProjectRoot,
} from "@/lib/runtime/RuntimeStoragePaths";

/**
 * A narrow, purpose-built sibling of
 * `ProductionPipelineRegenerationRetryBudgetExtension.ts` — same write-once /
 * replay-safe / conflict-safe / immutable-authority shape, applied to a
 * structurally different problem: a durable `reservation` entry
 * (`production-execution/reservations/<identityFingerprint>.json`) whose
 * corresponding idempotency record was never written (e.g. a crash between
 * `AdapterBackedProductionExecutionDurableStorage.createReservation()` and
 * `.createRecord()` inside `prepareProductionPipelineExecution` — see
 * ProductionPipelineExecutionFactory.ts:449-484), leaving
 * `loadReservationAuthority` permanently unable to link it to anything and
 * classifying it "active" forever (its TTL is measured in years).
 *
 * Deliberately NOT a receipt/consumption lifecycle like the retry-budget-
 * extension mechanisms: this authority is not "spent" by a single admitted
 * action — it is a standing, per-reservation exemption that
 * `loadReservationAuthority` consults on every evaluation for as long as
 * the underlying (immutable, never rewritten) reservation file exists. Once
 * written, the authority never needs a second state.
 *
 * Deliberately NOT wired into any automatic startup/recovery path. Every
 * invocation is expected to be an explicit, operator-approved, one-off call
 * against a specific, already-identified reservationId — never a
 * scan-and-tolerate-everything sweep. `loadReservationAuthority`'s own
 * consultation of this store (see ProductionExecutionRecoveryBootstrap.ts)
 * only ever narrows an existing "active" classification to "terminal" for
 * the one exact reservation an authority names — it can never widen
 * anything, and a reservation with no matching authority behaves exactly as
 * before this mechanism existed.
 */

export const orphanReservationToleranceSchemaVersion = "1" as const;
export const orphanReservationTolerancePolicyVersion =
  "orphan-reservation-tolerance-v1" as const;

export interface ProductionOrphanReservationToleranceAuthorityBody {
  readonly schemaVersion: typeof orphanReservationToleranceSchemaVersion;
  readonly policyVersion: typeof orphanReservationTolerancePolicyVersion;
  readonly authorityId: string;
  readonly issuedAt: string;
  readonly projectSlug: string;
  readonly stage: ProductionStepKey;
  readonly jobId: string;
  /** The reservation's own identity.identityFingerprint — the key under reservations/. */
  readonly reservationId: string;
  readonly operation: string;
  readonly attempt: number;
  readonly reason: string;
  /** CAS pin: stableProductionId over the reservation's full, exact content
   * at authority-creation time. Any drift in the reservation file (which
   * should never happen, since it is otherwise immutable) invalidates the
   * authority's applicability rather than being silently tolerated. */
  readonly reservationContentFingerprint: string;
  readonly integrity: {
    readonly algorithm: "stable-production-id-v1";
    readonly fingerprint: string;
  };
}

export interface OrphanReservationToleranceStoreResult<T> {
  readonly ok: boolean;
  readonly status: "created" | "found" | "replayed" | "not-found" | "conflict" | "failed";
  readonly writeFree: boolean;
  readonly value?: T;
  readonly reasonCode: string;
  readonly evidence: readonly string[];
}

export function reservationContentFingerprint(
  reservation: ProductionExecutionIdempotencyReservationRequest,
): string {
  return stableProductionId("orphan-reservation-tolerance-content",
    JSON.parse(JSON.stringify(reservation)) as ProductionExecutionIdempotencyReservationRequest);
}

export function buildProductionOrphanReservationToleranceAuthorityBody(
  input: Omit<ProductionOrphanReservationToleranceAuthorityBody, "integrity">,
): ProductionOrphanReservationToleranceAuthorityBody {
  const withoutIntegrity = { ...input };
  const fingerprint = stableProductionId(
    "orphan-reservation-tolerance-authority", withoutIntegrity,
  );
  return Object.freeze({
    ...withoutIntegrity,
    integrity: { algorithm: "stable-production-id-v1" as const, fingerprint },
  });
}

export function validateProductionOrphanReservationToleranceAuthorityBody(
  body: ProductionOrphanReservationToleranceAuthorityBody,
): boolean {
  if (
    body.schemaVersion !== orphanReservationToleranceSchemaVersion ||
    body.policyVersion !== orphanReservationTolerancePolicyVersion ||
    typeof body.authorityId !== "string" || !body.authorityId ||
    typeof body.projectSlug !== "string" || !body.projectSlug ||
    typeof body.stage !== "string" || !body.stage ||
    typeof body.jobId !== "string" || !body.jobId ||
    typeof body.reservationId !== "string" || !body.reservationId ||
    typeof body.operation !== "string" || !body.operation ||
    !Number.isSafeInteger(body.attempt) || body.attempt < 0 ||
    typeof body.reservationContentFingerprint !== "string" || !body.reservationContentFingerprint
  ) return false;
  const { integrity, ...withoutIntegrity } = body;
  return integrity.algorithm === "stable-production-id-v1" &&
    integrity.fingerprint === stableProductionId(
      "orphan-reservation-tolerance-authority", withoutIntegrity,
    );
}

function directory(projectSlug: string, input: RuntimeStorageInput = {}): string {
  // A dedicated sibling directory to retry-budget-extensions/ — physically
  // separate so the two authority families can never collide or be confused.
  return path.join(getProjectRoot(projectSlug, input), "production-execution",
    "orphan-reservation-tolerances");
}

function assertContained(projectSlug: string, targetPath: string, input: RuntimeStorageInput = {}) {
  const root = directory(projectSlug, input);
  const rel = path.relative(root, targetPath);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`CANONICAL_CONTAINMENT_VIOLATION: ${targetPath} is outside ${root}`);
  }
}

export function writeProductionOrphanReservationToleranceAuthority(
  projectSlug: string,
  body: ProductionOrphanReservationToleranceAuthorityBody,
  input: RuntimeStorageInput = {},
): OrphanReservationToleranceStoreResult<ProductionOrphanReservationToleranceAuthorityBody> {
  if (!validateProductionOrphanReservationToleranceAuthorityBody(body)) {
    return { ok: false, status: "failed", writeFree: true,
      reasonCode: "ORPHAN_RESERVATION_TOLERANCE_INTEGRITY_MISMATCH",
      evidence: ["body:integrity-invalid"] };
  }
  const dir = directory(projectSlug, input);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const authorityPath = path.join(dir, `tolerance-${body.authorityId}.json`);
  assertContained(projectSlug, authorityPath, input);
  if (fs.existsSync(authorityPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(authorityPath, "utf8")) as
        ProductionOrphanReservationToleranceAuthorityBody;
      if (existing.authorityId === body.authorityId &&
        validateProductionOrphanReservationToleranceAuthorityBody(existing) &&
        existing.integrity.fingerprint === body.integrity.fingerprint) {
        return { ok: true, status: "replayed", writeFree: true, value: existing,
          reasonCode: "ORPHAN_RESERVATION_TOLERANCE_REPLAYED",
          evidence: ["store:authority-replayed"] };
      }
      return { ok: false, status: "conflict", writeFree: true,
        reasonCode: "ORPHAN_RESERVATION_TOLERANCE_CORRUPT",
        evidence: ["store:existing-authority-conflict"] };
    } catch {
      return { ok: false, status: "conflict", writeFree: true,
        reasonCode: "ORPHAN_RESERVATION_TOLERANCE_CORRUPT",
        evidence: ["store:existing-authority-unreadable"] };
    }
  }
  const tempPath = path.join(dir,
    `tolerance-${body.authorityId}.${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`);
  try {
    fs.writeFileSync(tempPath, JSON.stringify(body, null, 2) + "\n", { encoding: "utf8", flag: "wx" });
    fs.renameSync(tempPath, authorityPath);
    return { ok: true, status: "created", writeFree: false, value: body,
      reasonCode: "ORPHAN_RESERVATION_TOLERANCE_PUBLISHED",
      evidence: ["store:authority-published"] };
  } catch (error) {
    if (fs.existsSync(tempPath)) { try { fs.unlinkSync(tempPath); } catch { /* ignore */ } }
    return { ok: false, status: "failed", writeFree: false,
      reasonCode: "ORPHAN_RESERVATION_TOLERANCE_PUBLICATION_FAILED",
      evidence: [`store:write-error:${error}`] };
  }
}

export function readProductionOrphanReservationToleranceAuthority(
  projectSlug: string,
  authorityId: string,
  input: RuntimeStorageInput = {},
): OrphanReservationToleranceStoreResult<ProductionOrphanReservationToleranceAuthorityBody> {
  const dir = directory(projectSlug, input);
  const authorityPath = path.join(dir, `tolerance-${authorityId}.json`);
  assertContained(projectSlug, authorityPath, input);
  if (!fs.existsSync(authorityPath)) {
    return { ok: false, status: "not-found", writeFree: true,
      reasonCode: "ORPHAN_RESERVATION_TOLERANCE_NOT_FOUND",
      evidence: ["store:authority-not-found"] };
  }
  try {
    const body = JSON.parse(fs.readFileSync(authorityPath, "utf8")) as
      ProductionOrphanReservationToleranceAuthorityBody;
    if (!validateProductionOrphanReservationToleranceAuthorityBody(body) || body.authorityId !== authorityId) {
      return { ok: false, status: "conflict", writeFree: true,
        reasonCode: "ORPHAN_RESERVATION_TOLERANCE_CORRUPT",
        evidence: ["store:authority-corrupt"] };
    }
    return { ok: true, status: "found", writeFree: true, value: body,
      reasonCode: "ORPHAN_RESERVATION_TOLERANCE_FOUND",
      evidence: ["store:authority-found"] };
  } catch {
    return { ok: false, status: "conflict", writeFree: true,
      reasonCode: "ORPHAN_RESERVATION_TOLERANCE_CORRUPT",
      evidence: ["store:authority-unreadable"] };
  }
}

/**
 * Finds a tolerance authority matching this exact (project, stage, job,
 * reservationId, operation, attempt) tuple. Read-only — never writes.
 * Returns undefined if none matches, so callers fall through to the
 * ordinary (untolerated) classification.
 */
export function findMatchingOrphanReservationToleranceAuthority(
  projectSlug: string,
  stage: ProductionStepKey,
  jobId: string,
  reservationId: string,
  operation: string,
  attempt: number,
  input: RuntimeStorageInput = {},
): { readonly authorityId: string; readonly body: ProductionOrphanReservationToleranceAuthorityBody }
  | undefined {
  const dir = directory(projectSlug, input);
  if (!fs.existsSync(dir)) return undefined;
  let files: string[];
  try { files = fs.readdirSync(dir); } catch { return undefined; }
  for (const file of files) {
    if (!file.startsWith("tolerance-") || !file.endsWith(".json")) continue;
    const authorityId = file.slice("tolerance-".length, -".json".length);
    const read = readProductionOrphanReservationToleranceAuthority(projectSlug, authorityId, input);
    if (!read.ok || !read.value) continue;
    const body = read.value;
    if (
      body.projectSlug !== projectSlug || body.stage !== stage || body.jobId !== jobId ||
      body.reservationId !== reservationId || body.operation !== operation ||
      body.attempt !== attempt
    ) continue;
    return { authorityId, body };
  }
  return undefined;
}

/**
 * Read-only re-verification that a reservation is STILL genuinely
 * unclaimed: no claim and no attempt record anywhere references its
 * identityFingerprint as their reservationId. Mirrors
 * `anyDurableRecordReferencesRecordId` (ProductionPipelineRetryReconciliation.ts)
 * exactly, but keyed by `identity.reservationId` rather than
 * `identity.recordId` — that field is what claim/attempt records carry back
 * to the reservation that authorized them.
 */
export async function anyDurableRecordReferencesReservationId(
  adapter: ProductionExecutionPersistenceAdapter,
  kind: "claim" | "attempt",
  reservationId: string,
): Promise<boolean | "list-failed"> {
  const listed = await adapter.listKeys(kind);
  if (!listed.ok) return "list-failed";
  for (const key of listed.keys) {
    const read = await adapter.read(kind, key);
    if (read.status === "found") {
      const value = read.value as { identity?: { reservationId?: string } };
      if (value.identity?.reservationId === reservationId) return true;
    }
  }
  return false;
}

/**
 * The single, narrow check `loadReservationAuthority` consults for a
 * reservation that has NO linked idempotency record (candidates.length===0
 * in the caller) and would otherwise be classified "active". Read-only,
 * fail-closed: any missing authority, any content-fingerprint drift, any
 * claim/attempt reference anywhere, or any list failure results in `false`
 * (no tolerance — the reservation keeps its ordinary "active"
 * classification, exactly as if this mechanism did not exist).
 */
export async function resolveOrphanReservationTolerance(
  adapter: ProductionExecutionPersistenceAdapter,
  reservation: ProductionExecutionIdempotencyReservationRequest,
  toleranceContext: { readonly projectSlug: string; readonly stage: ProductionStepKey;
    readonly jobId: string; readonly runtimeInput?: RuntimeStorageInput },
): Promise<boolean> {
  const reservationId = reservation.identity.identityFingerprint;
  const match = findMatchingOrphanReservationToleranceAuthority(
    toleranceContext.projectSlug, toleranceContext.stage, toleranceContext.jobId,
    reservationId, reservation.identity.operation, reservation.attempt,
    toleranceContext.runtimeInput,
  );
  if (!match) return false;

  // Re-verify the reservation's exact content still matches what the
  // authority was created against (CAS) -- the reservation store is
  // otherwise immutable, but this is the same "never trust an earlier
  // snapshot" discipline every other reconciliation this session applies.
  if (reservationContentFingerprint(reservation) !== match.body.reservationContentFingerprint) {
    return false;
  }

  const claimExists = await anyDurableRecordReferencesReservationId(adapter, "claim", reservationId);
  if (claimExists === "list-failed" || claimExists) return false;
  const attemptExists = await anyDurableRecordReferencesReservationId(adapter, "attempt", reservationId);
  if (attemptExists === "list-failed" || attemptExists) return false;

  return true;
}
