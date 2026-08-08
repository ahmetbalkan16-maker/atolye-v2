import type { ProductionExecutionDurableAttemptRecord } from
  "@/types/productionExecutionDurableAttempt";
import type { ProductionExecutionDurableClaimRecord } from
  "@/types/productionExecutionDurableClaim";
import type { ProductionExecutionDurableLease } from
  "@/types/productionExecutionDurableLease";
import type { ProductionExecutionIdempotencyReservationRequest } from
  "@/types/productionExecutionIdempotency";
import type { ProductionExecutionPersistenceAdapter,
  ProductionExecutionPersistenceRecordKind } from
  "@/types/productionExecutionPersistence";
import type { ProductionExecutionDurableRecord } from
  "@/types/productionExecutionDurableStorage";
import { validateProductionExecutionDurableAttempt,
  isProductionExecutionTerminalAttemptState } from "./ProductionExecutionDurableAttempt";
import { validateProductionExecutionDurableClaim } from
  "./ProductionExecutionDurableClaim";
import { validateProductionExecutionDurableLease } from
  "./ProductionExecutionDurableLease";
import { isProductionExecutionTerminalDurableRecordState,
  validateProductionExecutionDurableRecord } from
  "./ProductionExecutionDurableStorage";
import { validateProductionExecutionPersistencePayload } from
  "./ProductionExecutionPersistence";
import { buildProductionPipelineExecutionIdentity } from
  "./ProductionPipelineExecutionIdentity";
import { validateProductionGlobalTerminalQuiescence } from
  "./ProductionGlobalTerminalQuiescence";

export interface ProductionCanonicalDurableLineage {
  readonly reservation: ProductionExecutionIdempotencyReservationRequest;
  readonly record: ProductionExecutionDurableRecord;
  readonly lease: ProductionExecutionDurableLease;
  readonly claim: ProductionExecutionDurableClaimRecord;
  readonly attempt: ProductionExecutionDurableAttemptRecord;
}

export interface ProductionCanonicalDurableLineageExpectedVersions {
  readonly recordVersion: number;
  readonly reservationVersion: number;
  readonly claimVersion: number;
  readonly attemptVersion: number;
  readonly leaseVersion: number;
  readonly workerId: string;
  readonly workerSessionId: string;
  readonly reservationIdentityFingerprint: string;
  readonly recordIntegrityFingerprint: string;
  readonly recordIntegrityVersion: number;
  readonly leaseIntegrityFingerprint: string;
  readonly claimIntegrityFingerprint: string;
  readonly attemptIntegrityFingerprint: string;
  readonly durableOrdinal: number;
  readonly maxAttempts: number;
  readonly operation: string;
}

export async function readProductionCanonicalTerminalDurableLineage(
  adapter: ProductionExecutionPersistenceAdapter,
  identity: ReturnType<typeof buildProductionPipelineExecutionIdentity>,
  reservationId: string,
  expected?: ProductionCanonicalDurableLineageExpectedVersions,
  operationOverride?: string,
  options: { readonly requireTerminal?: boolean } = {},
): Promise<ProductionCanonicalDurableLineage> {
  const reservationRead = await adapter.read("reservation", reservationId);
  if (reservationRead.status !== "found" ||
    !validateProductionExecutionPersistencePayload("reservation", reservationRead.value)) {
    throw new Error("CANONICAL_DURABLE_RESERVATION_INVALID");
  }
  const reservation = reservationRead.value as ProductionExecutionIdempotencyReservationRequest;
  const record = await readLatestVersioned<ProductionExecutionDurableRecord>(
    adapter, "idempotency", identity.recordId, (value) =>
      validateProductionExecutionPersistencePayload("idempotency", value),
    (value) => JSON.stringify(recordImmutableIdentity(value)),
  );
  const claim = await readLatestVersioned<ProductionExecutionDurableClaimRecord>(
    adapter, "claim", identity.claimId, (value) =>
      validateProductionExecutionPersistencePayload("claim", value) &&
      validateProductionExecutionDurableClaim(value),
    (value) => JSON.stringify({ identity: value.identity, binding: value.binding,
      ownership: value.ownership }),
  );
  const attempt = await readLatestVersioned<ProductionExecutionDurableAttemptRecord>(
    adapter, "attempt", identity.attemptId, (value) =>
      validateProductionExecutionPersistencePayload("attempt", value) &&
      validateProductionExecutionDurableAttempt(value),
    (value) => JSON.stringify({ identity: value.identity, binding: value.binding }),
  );
  const lease = record.durableLease;
  if (!validateProductionExecutionDurableRecord(record).ok || !lease ||
    !validateProductionExecutionDurableLease(lease)) {
    throw new Error("CANONICAL_DURABLE_RECORD_OR_LEASE_INVALID");
  }
  assertIdentity(identity, reservationId, operationOverride ?? expected?.operation ??
    `pipeline.stage.${identity.core.attemptNumber === 0 ? "initial" : "retry"}`,
  reservation, record, lease, claim, attempt);
  if (options.requireTerminal !== false) {
    assertTerminalConsistency(record, lease, claim, attempt);
  }
  if (expected) assertExpected(expected, reservation, record, lease, claim, attempt);
  return { reservation, record, lease, claim, attempt };
}

/**
 * Validates the complete project store and rejects every orphan or ambiguous terminal object.
 * Legacy compatibility is strictly terminal-only and used solely to prove global quiescence.
 */
export async function validateProductionCanonicalTerminalAuthority(
  adapter: ProductionExecutionPersistenceAdapter,
  projectSlug: string,
): Promise<boolean> {
  return validateProductionGlobalTerminalQuiescence(adapter, projectSlug);
}

async function readLatestVersioned<T>(
  adapter: ProductionExecutionPersistenceAdapter,
  kind: Extract<ProductionExecutionPersistenceRecordKind, "idempotency" | "claim" | "attempt">,
  identity: string,
  validate: (value: unknown) => boolean,
  immutableIdentity: (value: T) => string,
): Promise<T> {
  const listed = await adapter.listKeys(kind);
  if (!listed.ok) throw new Error("CANONICAL_DURABLE_LIST_FAILED");
  const expression = new RegExp(`^${escapeRegularExpression(identity)}-v([1-9][0-9]*)$`);
  const versions = listed.keys.map((key) => ({ key, match: expression.exec(key) }))
    .filter((item): item is { key: string; match: RegExpExecArray } => item.match !== null)
    .map((item) => ({ key: item.key, version: Number(item.match[1]) }))
    .sort((left, right) => left.version - right.version);
  if (versions.length === 0) throw new Error("CANONICAL_DURABLE_LINEAGE_MISSING");
  let latest: T | undefined;
  let immutable: string | undefined;
  for (let index = 0; index < versions.length; index += 1) {
    if (versions[index].version !== index + 1) {
      throw new Error("CANONICAL_DURABLE_VERSION_GAP");
    }
    const read = await adapter.read(kind, versions[index].key);
    if (read.status !== "found" || !validate(read.value)) {
      throw new Error("CANONICAL_DURABLE_VERSION_INVALID");
    }
    const value = read.value as T;
    const durableVersion = kind === "idempotency"
      ? (value as ProductionExecutionDurableRecord).recordVersion
      : kind === "claim"
        ? (value as ProductionExecutionDurableClaimRecord).claimVersion
        : (value as ProductionExecutionDurableAttemptRecord).attemptVersion;
    if (durableVersion !== versions[index].version) {
      throw new Error("CANONICAL_DURABLE_KEY_VERSION_MISMATCH");
    }
    const currentImmutable = immutableIdentity(value);
    if (immutable !== undefined && currentImmutable !== immutable) {
      throw new Error("CANONICAL_DURABLE_IMMUTABLE_IDENTITY_CHANGED");
    }
    immutable = currentImmutable;
    latest = value;
  }
  if (!latest) throw new Error("CANONICAL_DURABLE_LINEAGE_MISSING");
  return latest;
}

function recordImmutableIdentity(record: ProductionExecutionDurableRecord) {
  return {
    schemaVersion: record.schemaVersion, storageVersion: record.storageVersion,
    recordId: record.recordId, identityFingerprint: record.identityFingerprint,
    idempotencyKey: record.idempotencyKey, requestId: record.requestId,
    executionFingerprint: record.executionFingerprint,
    bindingFingerprint: record.bindingFingerprint, actorId: record.actorId,
    projectSlug: record.projectSlug, operation: record.operation, action: record.action,
    stage: record.stage, authorizationDecisionId: record.authorizationDecisionId,
    confirmationRequestId: record.confirmationRequestId,
    confirmationId: record.confirmationId, policyVersion: record.policyVersion,
    riskLevel: record.riskLevel, attempt: record.attempt, maxAttempts: record.maxAttempts,
    createdAt: record.createdAt,
  };
}

function assertIdentity(
  identity: ReturnType<typeof buildProductionPipelineExecutionIdentity>,
  reservationId: string,
  operation: string,
  reservation: ProductionExecutionIdempotencyReservationRequest,
  record: ProductionExecutionDurableRecord,
  lease: ProductionExecutionDurableLease,
  claim: ProductionExecutionDurableClaimRecord,
  attempt: ProductionExecutionDurableAttemptRecord,
): void {
  const ordinal = identity.core.attemptNumber + 1;
  const exact = reservation.schemaVersion === "1" &&
    reservation.identity.schemaVersion === "1" &&
    reservation.identity.identityFingerprint === reservationId &&
    reservation.identity.projectSlug === identity.core.projectSlug &&
    reservation.identity.stage === identity.core.stage &&
    reservation.identity.operation === operation &&
    reservation.identity.requestId === identity.requestId &&
    reservation.identity.idempotencyKey === identity.idempotencyKey &&
    reservation.identity.executionFingerprint === identity.executionFingerprint &&
    reservation.attempt === ordinal &&
    record.schemaVersion === "1" && record.storageVersion === "1" &&
    record.projectSlug === identity.core.projectSlug && record.stage === identity.core.stage &&
    record.recordId === identity.recordId && record.identityFingerprint === reservationId &&
    record.operation === operation && record.requestId === identity.requestId &&
    record.idempotencyKey === identity.idempotencyKey &&
    record.executionFingerprint === identity.executionFingerprint && record.attempt === ordinal &&
    lease.schemaVersion === "1" && lease.identity.leaseId === identity.leaseId &&
    lease.identity.recordId === identity.recordId &&
    lease.identity.requestId === identity.requestId &&
    lease.identity.idempotencyKey === identity.idempotencyKey &&
    lease.identity.executionFingerprint === identity.executionFingerprint &&
    claim.schemaVersion === "1" && claim.storageVersion === "1" &&
    claim.identity.claimId === identity.claimId && claim.identity.recordId === identity.recordId &&
    claim.identity.reservationId === reservationId &&
    claim.identity.requestId === identity.requestId &&
    claim.identity.idempotencyKey === identity.idempotencyKey &&
    claim.identity.operation === operation && claim.identity.leaseId === identity.leaseId &&
    claim.identity.executionFingerprint === identity.executionFingerprint &&
    attempt.schemaVersion === "1" && attempt.storageVersion === "1" &&
    attempt.identity.attemptId === identity.attemptId &&
    attempt.identity.claimId === identity.claimId &&
    attempt.identity.recordId === identity.recordId &&
    attempt.identity.reservationId === reservationId &&
    attempt.identity.requestId === identity.requestId &&
    attempt.identity.idempotencyKey === identity.idempotencyKey &&
    attempt.identity.operation === operation && attempt.identity.leaseId === identity.leaseId &&
    attempt.identity.executionFingerprint === identity.executionFingerprint &&
    claim.identity.workerId === attempt.identity.workerId &&
    claim.identity.workerSessionId === attempt.identity.workerSessionId &&
    lease.identity.workerId === claim.identity.workerId &&
    lease.identity.workerSessionId === claim.identity.workerSessionId &&
    claim.binding.reservationVersion === attempt.binding.reservationVersion &&
    claim.binding.leaseVersion === attempt.binding.leaseVersion &&
    attempt.binding.claimVersion <= claim.claimVersion;
  if (!exact) throw new Error("CANONICAL_DURABLE_IDENTITY_BINDING_MISMATCH");
}

function assertTerminalConsistency(
  record: ProductionExecutionDurableRecord,
  lease: ProductionExecutionDurableLease,
  claim: ProductionExecutionDurableClaimRecord,
  attempt: ProductionExecutionDurableAttemptRecord,
): void {
  if (!isProductionExecutionTerminalDurableRecordState(record.state) ||
    lease.status !== "released" ||
    !["released", "abandoned"].includes(claim.state) ||
    !isProductionExecutionTerminalAttemptState(attempt.state)) {
    throw new Error("CANONICAL_DURABLE_TERMINAL_STATE_INVALID");
  }
  const consistent =
    (attempt.state === "succeeded" && record.state === "succeeded" && claim.state === "released") ||
    (["failed", "cancelled", "abandoned"].includes(attempt.state) &&
      ["failed", "cancelled", "partially-succeeded"].includes(record.state) &&
      claim.state === "abandoned");
  if (!consistent) throw new Error("CANONICAL_DURABLE_TERMINAL_STATE_MISMATCH");
}

function assertExpected(
  expected: ProductionCanonicalDurableLineageExpectedVersions,
  reservation: ProductionExecutionIdempotencyReservationRequest,
  record: ProductionExecutionDurableRecord,
  lease: ProductionExecutionDurableLease,
  claim: ProductionExecutionDurableClaimRecord,
  attempt: ProductionExecutionDurableAttemptRecord,
): void {
  if (expected.operation !== record.operation || expected.durableOrdinal !== record.attempt ||
    expected.maxAttempts !== record.maxAttempts || expected.recordVersion !== record.recordVersion ||
    expected.reservationVersion !== attempt.binding.reservationVersion ||
    expected.claimVersion !== claim.claimVersion ||
    expected.attemptVersion !== attempt.attemptVersion || expected.leaseVersion !== lease.version ||
    expected.workerId !== attempt.identity.workerId ||
    expected.workerSessionId !== attempt.identity.workerSessionId ||
    expected.reservationIdentityFingerprint !== reservation.identity.identityFingerprint ||
    expected.recordIntegrityFingerprint !== record.integrity.fingerprint ||
    expected.recordIntegrityVersion !== record.integrity.version ||
    expected.leaseIntegrityFingerprint !== lease.integrity.fingerprint ||
    expected.claimIntegrityFingerprint !== claim.integrity.fingerprint ||
    expected.attemptIntegrityFingerprint !== attempt.integrity.fingerprint ||
    reservation.maxAttempts !== expected.maxAttempts) {
    throw new Error("CANONICAL_DURABLE_ADMISSION_BINDING_MISMATCH");
  }
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
