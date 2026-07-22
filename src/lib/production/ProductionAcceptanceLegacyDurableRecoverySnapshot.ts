import path from "node:path";
import { validateProductionExecutionPersistencePayload } from "./ProductionExecutionPersistence";
import { ProductionExecutionDescriptorBoundReadAdapter } from
  "./ProductionExecutionDescriptorBoundReadAdapter";
import { readProductionExecutionRecoverySemanticAuthority } from
  "./ProductionExecutionRecoveryBootstrap";
import type { ProductionExecutionRecoveryStorePolicyEntry } from
  "./ProductionExecutionRecoveryBootstrap";
import { validateProductionExecutionDurableClaim } from "./ProductionExecutionDurableClaim";
import { validateProductionExecutionDurableAttempt } from "./ProductionExecutionDurableAttempt";
import { evaluateProductionExecutionDurableLeaseLifecycle,
  validateProductionExecutionDurableLease } from "./ProductionExecutionDurableLease";
import type { ProductionExecutionDurableClaimRecord } from "@/types/productionExecutionDurableClaim";
import type { ProductionExecutionDurableAttemptRecord } from "@/types/productionExecutionDurableAttempt";
import type { ProductionExecutionDurableRecord } from "@/types/productionExecutionDurableStorage";
import type { ProductionExecutionIdempotencyReservationRequest } from
  "@/types/productionExecutionIdempotency";
import type { ProductionExecutionPersistenceAdapter,
  ProductionExecutionPersistenceRecordKind } from "@/types/productionExecutionPersistence";
import { getProductionAcceptanceLegacyAdmittedExecution } from
  "./ProductionAcceptanceLegacyAdmissionContext";
import { canonicalJson, ProductionAcceptanceLegacyReauthorizationError, sha256Bytes } from
  "./ProductionAcceptanceLegacyReauthorization";

const MAX_RECORDS = 512;
const terminalAttemptStates = new Set(["succeeded", "failed", "cancelled", "abandoned"]);
const terminalExecutionStates = new Set(["succeeded", "failed", "cancelled", "partially-succeeded"]);

export interface LegacyDurableRecoveryAuthoritySnapshot {
  readonly policyVersion: "production-acceptance-durable-recovery-authority-v1";
  readonly projectSlug: string;
  readonly expectedBindings: { readonly runId: string; readonly markerState: "prepared";
    readonly startStage: "audio"; readonly operationPolicyVersion: "production-acceptance-no-active-operation-v1" };
  readonly claims: readonly unknown[];
  readonly leases: readonly unknown[];
  readonly attempts: readonly unknown[];
  readonly reservations: readonly unknown[];
  readonly journalChains: readonly unknown[];
  readonly recoveryBootstrap: { readonly policyVersion: "production-execution-recovery-semantic-authority-v1";
    readonly decision: "ready"; readonly attempts: readonly unknown[];
    readonly counts: Readonly<Record<string, number>>; readonly chainFingerprint: string;
    readonly activeReservationCount: number; readonly storeStates: Readonly<Record<string, string>>;
    readonly storePolicyMatrix: readonly ProductionExecutionRecoveryStorePolicyEntry[];
    readonly storePolicyFingerprint: string };
  readonly activeExecutions: boolean;
  readonly conflictingClaimOrLease: boolean;
}

export async function createLegacyReauthorizationDurableRecoverySnapshot(input: {
  readonly projectFolder: string;
  readonly projectSlug: string;
  readonly runId: string;
  readonly evaluatedAt: string;
  readonly markerState: "prepared";
  readonly startStage: "audio";
}): Promise<LegacyDurableRecoveryAuthoritySnapshot> {
  const adapter = new ProductionExecutionDescriptorBoundReadAdapter(
    path.join(input.projectFolder, "production-execution"));
  try {
    const [idempotency, reservations, claims, attempts] = await Promise.all([
      readAll(adapter, "idempotency", input.projectSlug),
      readAll(adapter, "reservation", input.projectSlug),
      readAll(adapter, "claim", input.projectSlug), readAll(adapter, "attempt", input.projectSlug),
    ]);
    const admitted = getProductionAcceptanceLegacyAdmittedExecution();
    const excludesCurrent = admitted?.projectSlug === input.projectSlug;
    assertDurableCausalBindings(idempotency, reservations, claims, attempts,
      input.projectSlug, excludesCurrent ? admitted : undefined);
    const semantic = await readProductionExecutionRecoverySemanticAuthority(
      excludesCurrent ? excludingCurrentExecution(adapter, admitted) : adapter,
      input.evaluatedAt,
    );
    assertSemanticStoreStates(semantic.storePolicyMatrix, input.projectSlug);
    if (semantic.activeReservationCount > 0 && (excludesCurrent ||
      (idempotency.length === 0 && claims.length === 0 && attempts.length === 0))) {
      throw new ProductionAcceptanceLegacyReauthorizationError(
      "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_ACTIVE_RESERVATION_CONFLICT",
      input.projectSlug, "recovery");
    }
    if (!input.projectSlug.endsWith(`-${input.runId}`)) throw invalid(input.projectSlug);
    const records = idempotency.map(({ key, value }) => {
      const record = value as ProductionExecutionDurableRecord;
      if (record.projectSlug !== input.projectSlug) throw invalid(input.projectSlug);
      return { key, record };
    }).filter(({ record }) => !excludesCurrent || record.recordId !== admitted.recordId);
    const reservationValues = reservations.map(({ key, value }) => {
      const record = value as ProductionExecutionIdempotencyReservationRequest;
      if (record.identity.projectSlug !== input.projectSlug ||
        record.identity.identityFingerprint !== key) {
        throw new ProductionAcceptanceLegacyReauthorizationError(
          "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_DURABLE_RECORD_IDENTITY_CHANGED",
          input.projectSlug, "recovery");
      }
      return { key, record };
    }).filter(({ record }) => !excludesCurrent ||
      record.identity.identityFingerprint !== admitted.reservationId);
    const recordIds = new Set(records.map(({ record }) => record.recordId));
    const claimValues = claims.map(({ key, value }) => ({ key, record: value as ProductionExecutionDurableClaimRecord }))
      .filter(({ record }) => !excludesCurrent || record.identity.claimId !== admitted.claimId);
    const attemptValues = attempts.map(({ key, value }) => ({ key, record: value as ProductionExecutionDurableAttemptRecord }))
      .filter(({ record }) => !excludesCurrent || record.identity.attemptId !== admitted.attemptId);
    for (const { record } of claimValues) {
      if (!validateProductionExecutionDurableClaim(record) || !recordIds.has(record.identity.recordId)) throw invalid(input.projectSlug);
    }
    for (const { record } of attemptValues) {
      if (!validateProductionExecutionDurableAttempt(record) || !recordIds.has(record.identity.recordId)) throw invalid(input.projectSlug);
    }
    const latestClaims = latestExact(claimValues, (value) => value.identity.claimId,
      (value) => value.claimVersion, input.projectSlug,
      (value) => ({ identity: value.identity, binding: value.binding, ownership: value.ownership,
        acquiredAt: value.acquiredAt }));
    const latestAttempts = latestExact(attemptValues, (value) => value.identity.attemptId,
      (value) => value.attemptVersion, input.projectSlug,
      (value) => ({ identity: value.identity, binding: value.binding, openedAt: value.openedAt }),
      (previous, current) => canonicalJson(previous.journal) ===
        canonicalJson(current.journal.slice(0, previous.journal.length)));
    const latestRecords = latestExact(records, (value) => value.recordId,
      (value) => value.recordVersion, input.projectSlug,
      (value) => ({ recordId: value.recordId, identityFingerprint: value.identityFingerprint,
        idempotencyKey: value.idempotencyKey, requestId: value.requestId,
        executionFingerprint: value.executionFingerprint, bindingFingerprint: value.bindingFingerprint,
        projectSlug: value.projectSlug, operation: value.operation, action: value.action,
        stage: value.stage ?? null }));
    const activeClaims = latestClaims.filter(({ record }) => record.state === "active");
    const activeAttempts = latestAttempts.filter(({ record }) => !terminalAttemptStates.has(record.state));
    const activeRecords = latestRecords.filter(({ record }) => !terminalExecutionStates.has(record.state));
    const activeLeases = latestRecords.filter(({ record }) => {
      if (!record.durableLease) return false;
      if (!validateProductionExecutionDurableLease(record.durableLease)) throw invalid(input.projectSlug);
      const lifecycle = evaluateProductionExecutionDurableLeaseLifecycle(
        record.durableLease, input.evaluatedAt);
      if (lifecycle === "invalid") throw new ProductionAcceptanceLegacyReauthorizationError(
        "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_LEASE_STATE_INVALID", input.projectSlug, "recovery");
      return lifecycle === "active";
    });
    const conflictingClaimOrLease = activeClaims.length > 0 || activeLeases.length > 0;
    const activeExecutions = activeAttempts.length > 0 || activeRecords.length > 0;
    if (conflictingClaimOrLease) {
      throw new ProductionAcceptanceLegacyReauthorizationError(
        "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_ADMISSION_CLAIM_OR_LEASE_CONFLICT", input.projectSlug, "recovery");
    }
    if (activeExecutions) {
      throw new ProductionAcceptanceLegacyReauthorizationError(
        "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_ADMISSION_ACTIVE_EXECUTION", input.projectSlug, "recovery");
    }
    if (semantic.activeReservationCount > 0) throw new ProductionAcceptanceLegacyReauthorizationError(
      "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_ACTIVE_RESERVATION_CONFLICT",
      input.projectSlug, "recovery");
    const normalizedClaims = latestClaims.map(({ key, record }) => ({ key, claimId: record.identity.claimId,
      recordId: record.identity.recordId, state: record.state, claimVersion: record.claimVersion,
      leaseId: record.identity.leaseId, leaseVersion: record.binding.leaseVersion, integrity: record.integrity.fingerprint }));
    const normalizedLeases = latestRecords.filter(({ record }) => record.durableLease).map(({ key, record }) => {
      const lease = record.durableLease!;
      const state = evaluateProductionExecutionDurableLeaseLifecycle(lease, input.evaluatedAt);
      if (state === "invalid") throw new ProductionAcceptanceLegacyReauthorizationError(
        "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_LEASE_STATE_INVALID", input.projectSlug, "recovery");
      return { key, recordId: record.recordId, leaseId: lease.identity.leaseId, state,
        version: lease.version, ownerFingerprint: lease.ownership.ownerFingerprint,
      integrity: lease.integrity.fingerprint };
    });
    const normalizedReservations = reservationValues.map(({ key, record }) => ({
      key, reservationId: record.identity.identityFingerprint,
      projectSlug: record.identity.projectSlug, operation: record.identity.operation,
      stage: record.identity.stage ?? null, requestId: record.identity.requestId,
      idempotencyKey: record.identity.idempotencyKey,
      executionFingerprint: record.identity.executionFingerprint,
      bindingFingerprint: record.identity.bindingFingerprint,
      attempt: record.attempt, maxAttempts: record.maxAttempts,
    })).sort((left, right) => codeUnitCompare(left.key, right.key));
    const normalizedAttempts = latestAttempts.map(({ key, record }) => ({ key,
      attemptId: record.identity.attemptId, claimId: record.identity.claimId, recordId: record.identity.recordId,
      state: record.state, attemptVersion: record.attemptVersion, claimVersion: record.binding.claimVersion,
      leaseVersion: record.binding.leaseVersion, journalLength: record.journal.length,
      integrity: record.integrity.fingerprint }));
    const journalChains = latestAttempts.map(({ record }) => ({ attemptId: record.identity.attemptId,
      attemptVersion: record.attemptVersion, length: record.journal.length,
      headSequence: record.journal.at(-1)?.sequence ?? 0,
      headIntegrity: record.journal.at(-1)?.integrity.fingerprint ?? null,
      chainFingerprint: sha256Bytes(canonicalJson(record.journal)) }));
    if (semantic.decision !== "ready") throw new ProductionAcceptanceLegacyReauthorizationError(
      "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_RECOVERY_BOOTSTRAP_INVALID",
      input.projectSlug, "recovery");
    for (const attempt of semantic.attempts) {
      if (attempt.projectSlug !== undefined && attempt.projectSlug !== input.projectSlug) {
        throw invalid(input.projectSlug);
      }
      if (attempt.stage !== undefined && !normalizedAttempts.some((candidate) =>
        candidate.attemptId === attempt.attemptId)) throw invalid(input.projectSlug);
    }
    const chainFingerprint = sha256Bytes(canonicalJson({ storeState: semantic.storeStates, normalizedClaims,
      normalizedLeases, normalizedReservations, normalizedAttempts, journalChains,
      recoveryBootstrap: semantic }));
    return Object.freeze({ policyVersion: "production-acceptance-durable-recovery-authority-v1",
      projectSlug: input.projectSlug, claims: normalizedClaims, leases: normalizedLeases,
      expectedBindings: Object.freeze({ runId: input.runId, markerState: input.markerState,
        startStage: input.startStage,
        operationPolicyVersion: "production-acceptance-no-active-operation-v1" }),
      attempts: normalizedAttempts, reservations: normalizedReservations, journalChains,
      recoveryBootstrap: Object.freeze({ policyVersion: semantic.policyVersion,
        decision: "ready", attempts: semantic.attempts, counts: semantic.counts,
        activeReservationCount: semantic.activeReservationCount, storeStates: semantic.storeStates,
        storePolicyMatrix: semantic.storePolicyMatrix,
        storePolicyFingerprint: semantic.storePolicyFingerprint,
        chainFingerprint }), activeExecutions, conflictingClaimOrLease });
  } catch (error) {
    if (error instanceof ProductionAcceptanceLegacyReauthorizationError) throw error;
    throw invalid(input.projectSlug);
  }
}

async function readAll(adapter: ProductionExecutionPersistenceAdapter,
  kind: "idempotency" | "reservation" | "claim" | "attempt", projectSlug: string) {
  const listed = await adapter.listKeys(kind);
  if (!listed.ok) throw new ProductionAcceptanceLegacyReauthorizationError(
    listed.errorCode === "PERSISTENCE_IDENTITY_CHANGED"
      ? "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_DURABLE_STORE_IDENTITY_CHANGED"
      : listed.errorCode === "PERSISTENCE_RECORD_CORRUPT"
        ? "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_DURABLE_STORE_CORRUPT"
        : "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_DURABLE_STORE_UNAVAILABLE",
    projectSlug, "recovery");
  if (listed.keys.length > MAX_RECORDS) throw invalid(projectSlug);
  const output: Array<{ key: string; value: unknown }> = [];
  for (const key of listed.keys) {
    const read = await adapter.read(kind, key);
    if (!read.ok || read.status !== "found") throw new ProductionAcceptanceLegacyReauthorizationError(
      read.errorCode === "PERSISTENCE_IDENTITY_CHANGED"
        ? "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_DURABLE_STORE_IDENTITY_CHANGED"
        : read.errorCode === "PERSISTENCE_READ_FAILED"
          ? "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_DURABLE_STORE_UNAVAILABLE"
          : "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_DURABLE_RECORD_CORRUPT",
      projectSlug, "recovery");
    if (!validateProductionExecutionPersistencePayload(kind, read.value)) {
      throw new ProductionAcceptanceLegacyReauthorizationError(
        "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_DURABLE_RECORD_CORRUPT",
        projectSlug, "recovery");
    }
    output.push({ key, value: read.value });
  }
  return output;
}

function excludingCurrentExecution(adapter: ProductionExecutionPersistenceAdapter,
  admitted: NonNullable<ReturnType<typeof getProductionAcceptanceLegacyAdmittedExecution>>):
ProductionExecutionPersistenceAdapter {
  const excluded: Partial<Record<ProductionExecutionPersistenceRecordKind, string>> = {
    idempotency: admitted.recordId, claim: admitted.claimId, attempt: admitted.attemptId,
    reservation: admitted.reservationId,
  };
  return {
    async write(kind, key) { return { ok: false, status: "failed", kind, key,
      errorCode: "PERSISTENCE_INVALID_INPUT" }; },
    async read(kind, key) {
      const identity = excluded[kind];
      if (identity && (key === identity || key.startsWith(`${identity}-v`))) {
        return { ok: false, status: "not-found", kind, key,
          errorCode: "PERSISTENCE_NOT_FOUND" };
      }
      return adapter.read(kind, key);
    },
    async listKeys(kind) {
      const listed = await adapter.listKeys(kind);
      if (!listed.ok) return listed;
      const identity = excluded[kind];
      if (!identity) return listed;
      const keys = listed.keys.filter((key) => key !== identity && !key.startsWith(`${identity}-v`));
      return { ...listed, keys, ...(keys.length === 0 ? { storeState: "not-created" as const } : {}) };
    },
  } as ProductionExecutionPersistenceAdapter;
}

function latestExact<T>(values: readonly { key: string; record: T }[], identity: (value: T) => string,
  version: (value: T) => number, projectSlug: string, immutable?: (value: T) => unknown,
  validPrefix?: (previous: T, current: T) => boolean) {
  const grouped = new Map<string, Array<{ key: string; record: T }>>();
  for (const value of values) grouped.set(identity(value.record), [...(grouped.get(identity(value.record)) ?? []), value]);
  return [...grouped.values()].map((chain) => {
    chain.sort((left, right) => version(left.record) - version(right.record));
    if (version(chain[0].record) !== 1) throw invalid(projectSlug);
    const expectedIdentity = identity(chain[0].record);
    const seenVersions = new Set<number>();
    for (const item of chain) {
      const itemVersion = version(item.record);
      if (seenVersions.has(itemVersion) || item.key !== `${expectedIdentity}-v${itemVersion}`) {
        throw invalid(projectSlug);
      }
      seenVersions.add(itemVersion);
    }
    for (let index = 1; index < chain.length; index += 1) {
      if (version(chain[index].record) !== version(chain[index - 1].record) + 1 ||
        (immutable && canonicalJson(immutable(chain[index].record)) !==
          canonicalJson(immutable(chain[index - 1].record))) ||
        (validPrefix && !validPrefix(chain[index - 1].record, chain[index].record))) throw invalid(projectSlug);
    }
    return chain.at(-1)!;
  }).sort((left, right) => codeUnitCompare(left.key, right.key));
}

function assertSemanticStoreStates(matrix: readonly ProductionExecutionRecoveryStorePolicyEntry[],
  projectSlug: string): void {
  const rejected = matrix.find((entry) => entry.normalizedOutcome.startsWith("rejected-"));
  const code = rejected?.normalizedOutcome === "rejected-required-missing"
    ? rejected.storeFamily === "reservation"
      ? "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_REQUIRED_RESERVATION_STORE_MISSING" as const
      : rejected.storeFamily === "idempotency"
        ? "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_REQUIRED_IDEMPOTENCY_STORE_MISSING" as const
        : rejected.storeFamily === "claim"
          ? "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_REQUIRED_CLAIM_STORE_MISSING" as const
          : "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_REQUIRED_ATTEMPT_STORE_MISSING" as const
    : rejected?.normalizedOutcome === "rejected-identity-changed"
      ? "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_DURABLE_STORE_IDENTITY_CHANGED" as const
      : rejected?.normalizedOutcome === "rejected-corrupt"
        ? "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_DURABLE_STORE_CORRUPT" as const
        : rejected?.normalizedOutcome === "rejected-unavailable"
          ? "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_DURABLE_STORE_UNAVAILABLE" as const
          : undefined;
  if (code) throw new ProductionAcceptanceLegacyReauthorizationError(code, projectSlug, "recovery");
}

function assertDurableCausalBindings(
  idempotency: readonly { key: string; value: unknown }[],
  reservations: readonly { key: string; value: unknown }[],
  claims: readonly { key: string; value: unknown }[],
  attempts: readonly { key: string; value: unknown }[],
  projectSlug: string,
  admitted?: NonNullable<ReturnType<typeof getProductionAcceptanceLegacyAdmittedExecution>>,
): void {
  const records = latestValues(idempotency, (value) => (value as ProductionExecutionDurableRecord).recordId,
    (value) => (value as ProductionExecutionDurableRecord).recordVersion) as ProductionExecutionDurableRecord[];
  const reservationRecords = reservations.map(({ value }) => value as ProductionExecutionIdempotencyReservationRequest);
  const claimRecords = latestValues(claims, (value) => (value as ProductionExecutionDurableClaimRecord).identity.claimId,
    (value) => (value as ProductionExecutionDurableClaimRecord).claimVersion) as ProductionExecutionDurableClaimRecord[];
  const attemptRecords = latestValues(attempts, (value) => (value as ProductionExecutionDurableAttemptRecord).identity.attemptId,
    (value) => (value as ProductionExecutionDurableAttemptRecord).attemptVersion) as ProductionExecutionDurableAttemptRecord[];
  if ((claimRecords.length > 0 || attemptRecords.length > 0) && reservationRecords.length === 0) {
    throw causal("PRODUCTION_ACCEPTANCE_REAUTHORIZATION_REQUIRED_RESERVATION_STORE_MISSING", projectSlug);
  }
  if ((claimRecords.length > 0 || attemptRecords.length > 0) && records.length === 0) {
    throw causal("PRODUCTION_ACCEPTANCE_REAUTHORIZATION_REQUIRED_IDEMPOTENCY_STORE_MISSING", projectSlug);
  }
  if (attemptRecords.length > 0 && claimRecords.length === 0) {
    throw causal("PRODUCTION_ACCEPTANCE_REAUTHORIZATION_REQUIRED_CLAIM_STORE_MISSING", projectSlug);
  }
  if (claimRecords.some((record) => record.state === "active") && attemptRecords.length === 0) {
    throw causal("PRODUCTION_ACCEPTANCE_REAUTHORIZATION_REQUIRED_ATTEMPT_STORE_MISSING", projectSlug);
  }
  if (admitted?.durableAttemptRequired) {
    const admittedReservation = reservationRecords.find((record) =>
      record.identity.identityFingerprint === admitted.reservationId);
    if (!admittedReservation) {
      throw causal("PRODUCTION_ACCEPTANCE_REAUTHORIZATION_REQUIRED_RESERVATION_STORE_MISSING", projectSlug);
    }
    const admittedRecord = records.find((record) => record.recordId === admitted.recordId);
    if (!admittedRecord) {
      throw causal("PRODUCTION_ACCEPTANCE_REAUTHORIZATION_REQUIRED_IDEMPOTENCY_STORE_MISSING", projectSlug);
    }
    const admittedClaim = claimRecords.find((record) => record.identity.claimId === admitted.claimId);
    if (!admittedClaim) {
      throw causal("PRODUCTION_ACCEPTANCE_REAUTHORIZATION_REQUIRED_CLAIM_STORE_MISSING", projectSlug);
    }
    const admittedAttempt = attemptRecords.find((record) => record.identity.attemptId === admitted.attemptId);
    if (!admittedAttempt) {
      throw causal("PRODUCTION_ACCEPTANCE_REAUTHORIZATION_REQUIRED_ATTEMPT_STORE_MISSING", projectSlug);
    }
    assertAdmittedDurableBindings(admitted, admittedReservation, admittedRecord,
      admittedClaim, admittedAttempt, projectSlug);
  }
  for (const reservation of reservationRecords) {
    const linked = records.find((record) => record.identityFingerprint === reservation.identity.identityFingerprint);
    if (linked && !reservationMatchesIdempotency(reservation, linked)) {
      throw causal("PRODUCTION_ACCEPTANCE_REAUTHORIZATION_RESERVATION_IDEMPOTENCY_BINDING_MISMATCH", projectSlug);
    }
    if (!linked && ((admitted?.durableAttemptRequired === true &&
      reservation.identity.identityFingerprint === admitted.reservationId) ||
      records.some((record) => record.recordId !== admitted?.recordId))) {
      throw causal("PRODUCTION_ACCEPTANCE_REAUTHORIZATION_RESERVATION_IDEMPOTENCY_BINDING_MISMATCH", projectSlug);
    }
  }
  for (const claim of claimRecords) {
    const reservation = reservationRecords.find((record) =>
      record.identity.identityFingerprint === claim.identity.reservationId);
    if (!reservation || !reservationMatchesClaim(reservation, claim)) {
      throw causal("PRODUCTION_ACCEPTANCE_REAUTHORIZATION_RESERVATION_CLAIM_BINDING_MISMATCH", projectSlug);
    }
    const linkedAttempt = attemptRecords.find((record) => record.identity.claimId === claim.identity.claimId);
    if (!linkedAttempt && claim.state === "active") {
      throw causal("PRODUCTION_ACCEPTANCE_REAUTHORIZATION_REQUIRED_ATTEMPT_STORE_MISSING", projectSlug);
    }
  }
  for (const attempt of attemptRecords) {
    const reservation = reservationRecords.find((record) =>
      record.identity.identityFingerprint === attempt.identity.reservationId);
    if (!reservation || !reservationMatchesAttempt(reservation, attempt)) {
      throw causal("PRODUCTION_ACCEPTANCE_REAUTHORIZATION_RESERVATION_ATTEMPT_BINDING_MISMATCH", projectSlug);
    }
    const claim = claimRecords.find((record) => record.identity.claimId === attempt.identity.claimId);
    if (!claim || !claimMatchesAttempt(claim, attempt)) {
      throw causal("PRODUCTION_ACCEPTANCE_REAUTHORIZATION_CLAIM_ATTEMPT_BINDING_MISMATCH", projectSlug);
    }
  }
  if (admitted?.durableAttemptRequired) {
    assertAdmittedDurableIdentityBindings(admitted,
      reservationRecords.find((record) => record.identity.identityFingerprint === admitted.reservationId)!,
      records.find((record) => record.recordId === admitted.recordId)!,
      claimRecords.find((record) => record.identity.claimId === admitted.claimId)!,
      attemptRecords.find((record) => record.identity.attemptId === admitted.attemptId)!, projectSlug);
  }
}

function latestValues(values: readonly { value: unknown }[], identity: (value: unknown) => string,
  version: (value: unknown) => number): unknown[] {
  const latest = new Map<string, { value: unknown; version: number }>();
  for (const item of values) {
    const key = identity(item.value), candidateVersion = version(item.value);
    if (!latest.has(key) || latest.get(key)!.version < candidateVersion) {
      latest.set(key, { value: item.value, version: candidateVersion });
    }
  }
  return [...latest.values()].map((item) => item.value);
}

function reservationMatchesIdempotency(reservation: ProductionExecutionIdempotencyReservationRequest,
  record: ProductionExecutionDurableRecord): boolean {
  return record.projectSlug === reservation.identity.projectSlug && record.operation === reservation.identity.operation &&
    (record.stage ?? null) === (reservation.identity.stage ?? null) && record.requestId === reservation.identity.requestId &&
    record.idempotencyKey === reservation.identity.idempotencyKey &&
    record.executionFingerprint === reservation.identity.executionFingerprint &&
    record.bindingFingerprint === reservation.identity.bindingFingerprint;
}

function reservationMatchesClaim(reservation: ProductionExecutionIdempotencyReservationRequest,
  claim: ProductionExecutionDurableClaimRecord): boolean {
  return claim.identity.reservationId === reservation.identity.identityFingerprint &&
    claim.identity.requestId === reservation.identity.requestId &&
    claim.identity.idempotencyKey === reservation.identity.idempotencyKey &&
    (claim.identity.operation === undefined ||
      claim.identity.operation === reservation.identity.operation) &&
    claim.identity.executionFingerprint === reservation.identity.executionFingerprint;
}

function reservationMatchesAttempt(reservation: ProductionExecutionIdempotencyReservationRequest,
  attempt: ProductionExecutionDurableAttemptRecord): boolean {
  return attempt.identity.reservationId === reservation.identity.identityFingerprint &&
    attempt.identity.requestId === reservation.identity.requestId &&
    attempt.identity.idempotencyKey === reservation.identity.idempotencyKey &&
    (attempt.identity.operation === undefined ||
      attempt.identity.operation === reservation.identity.operation) &&
    attempt.identity.executionFingerprint === reservation.identity.executionFingerprint;
}

function claimMatchesAttempt(claim: ProductionExecutionDurableClaimRecord,
  attempt: ProductionExecutionDurableAttemptRecord): boolean {
  return attempt.identity.claimId === claim.identity.claimId && attempt.identity.recordId === claim.identity.recordId &&
    attempt.identity.reservationId === claim.identity.reservationId &&
    attempt.identity.requestId === claim.identity.requestId &&
    attempt.identity.idempotencyKey === claim.identity.idempotencyKey &&
    (attempt.identity.operation === undefined || claim.identity.operation === undefined ||
      attempt.identity.operation === claim.identity.operation) &&
    attempt.identity.executionFingerprint === claim.identity.executionFingerprint;
}

function assertAdmittedDurableBindings(
  admitted: NonNullable<ReturnType<typeof getProductionAcceptanceLegacyAdmittedExecution>>,
  reservation: ProductionExecutionIdempotencyReservationRequest,
  record: ProductionExecutionDurableRecord,
  claim: ProductionExecutionDurableClaimRecord,
  attempt: ProductionExecutionDurableAttemptRecord,
  projectSlug: string,
): void {
  if ([reservation.identity.requestId, record.requestId, claim.identity.requestId,
    attempt.identity.requestId].some((value) => value !== admitted.requestId)) {
    throw causal("PRODUCTION_ACCEPTANCE_REAUTHORIZATION_LEGACY_CAPABILITY_REQUEST_ID_MISMATCH", projectSlug);
  }
  if ([reservation.identity.idempotencyKey, record.idempotencyKey, claim.identity.idempotencyKey,
    attempt.identity.idempotencyKey].some((value) => value !== admitted.idempotencyKey)) {
    throw causal("PRODUCTION_ACCEPTANCE_REAUTHORIZATION_LEGACY_CAPABILITY_IDEMPOTENCY_KEY_MISMATCH", projectSlug);
  }
  if ([reservation.identity.operation, record.operation, claim.identity.operation,
    attempt.identity.operation].some((value) => value !== admitted.operation)) {
    throw causal("PRODUCTION_ACCEPTANCE_REAUTHORIZATION_LEGACY_CAPABILITY_OPERATION_MISMATCH", projectSlug);
  }
}

function assertAdmittedDurableIdentityBindings(
  admitted: NonNullable<ReturnType<typeof getProductionAcceptanceLegacyAdmittedExecution>>,
  reservation: ProductionExecutionIdempotencyReservationRequest,
  record: ProductionExecutionDurableRecord,
  claim: ProductionExecutionDurableClaimRecord,
  attempt: ProductionExecutionDurableAttemptRecord,
  projectSlug: string,
): void {
  const lease = record.durableLease?.identity;
  if (lease && (lease.leaseId !== admitted.leaseId ||
    claim.identity.leaseId !== admitted.leaseId || attempt.identity.leaseId !== admitted.leaseId)) {
    throw causal("PRODUCTION_ACCEPTANCE_REAUTHORIZATION_LEGACY_CAPABILITY_LEASE_ID_MISMATCH", projectSlug);
  }
  if (reservation.identity.projectSlug !== admitted.projectSlug ||
    reservation.identity.stage !== admitted.stage ||
    reservation.identity.executionFingerprint !== admitted.executionFingerprint ||
    record.projectSlug !== admitted.projectSlug || record.stage !== admitted.stage ||
    record.recordId !== admitted.recordId || record.identityFingerprint !== admitted.reservationId ||
    record.attempt !== admitted.attemptNumber + 1 ||
    record.executionFingerprint !== admitted.executionFingerprint ||
    claim.identity.claimId !== admitted.claimId || claim.identity.recordId !== admitted.recordId ||
    claim.identity.reservationId !== admitted.reservationId ||
    claim.identity.executionFingerprint !== admitted.executionFingerprint ||
    attempt.identity.attemptId !== admitted.attemptId || attempt.identity.claimId !== admitted.claimId ||
    attempt.identity.recordId !== admitted.recordId || attempt.identity.reservationId !== admitted.reservationId ||
    attempt.identity.executionFingerprint !== admitted.executionFingerprint || !lease ||
    lease.recordId !== admitted.recordId || lease.requestId !== admitted.requestId ||
    lease.idempotencyKey !== admitted.idempotencyKey ||
    lease.executionFingerprint !== admitted.executionFingerprint ||
    claim.identity.leaseId !== lease.leaseId || attempt.identity.leaseId !== lease.leaseId ||
    claim.identity.workerId !== lease.workerId || attempt.identity.workerId !== lease.workerId ||
    claim.identity.workerSessionId !== lease.workerSessionId ||
    attempt.identity.workerSessionId !== lease.workerSessionId) {
    throw causal("PRODUCTION_ACCEPTANCE_REAUTHORIZATION_LEGACY_CAPABILITY_IDENTITY_MISMATCH", projectSlug);
  }
}

function causal(code: ConstructorParameters<typeof ProductionAcceptanceLegacyReauthorizationError>[0],
  projectSlug: string) {
  return new ProductionAcceptanceLegacyReauthorizationError(code, projectSlug, "recovery");
}

function codeUnitCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function invalid(projectSlug: string) {
  return new ProductionAcceptanceLegacyReauthorizationError(
    "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_ADMISSION_DURABLE_RECOVERY_INVALID", projectSlug, "recovery");
}
