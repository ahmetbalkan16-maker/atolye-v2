import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

import type { ProductionExecutionAuthorizationResult } from
  "@/types/productionExecutionAuthorization";
import type { ProductionExecutionConfirmationValidationResult } from
  "@/types/productionExecutionConfirmation";
import type { RetryBudgetExtensionDurableBinding } from
  "@/types/productionPipelineRetryBudgetExtension";
import { buildProductionExecutionIdempotencyIdentity,
  defaultProductionExecutionIdempotencyPolicy } from
  "@/lib/production/ProductionExecutionIdempotency";
import { validateProductionExecutionPersistencePayload } from
  "@/lib/production/ProductionExecutionPersistence";
import { buildProductionPipelineExecutionIdentity } from
  "@/lib/production/ProductionPipelineExecutionIdentity";
import { stableProductionId } from "@/lib/production/ProductionDeterminism";
import { buildProductionExecutionAttemptBindingFingerprint,
  buildProductionExecutionAttemptJournalEntryIntegrity,
  buildProductionExecutionDurableAttemptIntegrity } from
  "@/lib/production/ProductionExecutionDurableAttemptIntegrity";
import { buildRetryBudgetExtensionDurableBinding } from
  "@/lib/production/ProductionPipelineRetryBudgetExtensionSchema";

const durableOrdinal = 4;
const attemptNumber = durableOrdinal - 1;
const ttlSeconds = 31_536_000;
const workerId = "pipeline-worker";
const workerSessionId = "pipeline-session-v1";

type JsonObject = Record<string, unknown>;

export interface HistoricalAudioAuthority {
  readonly authorityId: string;
  readonly integrity: { readonly fingerprint: string };
  readonly projectSlug: string;
  readonly stage: string;
  readonly jobId: string;
  readonly authorizedOperation: string;
  readonly authorizedRunType: string;
  readonly authorizedDurableOrdinal: number;
  readonly effectiveMaxAttempts: number;
}

export interface HistoricalAudioConsumedReceipt {
  readonly jobVersion: string;
  readonly integrity: { readonly fingerprint: string };
}

export interface HistoricalAudioOrdinalFourPreflight {
  readonly binding: RetryBudgetExtensionDurableBinding;
  readonly executionIdentity: ReturnType<typeof buildProductionPipelineExecutionIdentity>;
  readonly reservationIdentity: NonNullable<ReturnType<
    typeof buildProductionExecutionIdempotencyIdentity>["identity"]>;
  readonly reservationPath: string;
  readonly recordPaths: readonly string[];
  readonly claimPaths: readonly string[];
  readonly attemptPaths: readonly string[];
  readonly deletionTargets: readonly string[];
}

function exactVersionPaths(root: string, directory: string, id: string, count: number) {
  return Array.from({ length: count }, (_, index) =>
    path.join(root, directory, `${id}-v${index + 1}.json`));
}

function readValidated(target: string, kind: "reservation" | "idempotency" | "claim" | "attempt",
  code: string): JsonObject {
  let value: unknown;
  try {
    value = JSON.parse(fs.readFileSync(target, "utf8"));
  } catch {
    throw new Error(code);
  }
  if (!validateProductionExecutionPersistencePayload(kind, value)) throw new Error(code);
  return value as JsonObject;
}

function same(left: unknown, right: unknown) {
  return isDeepStrictEqual(left, right);
}

function withLeaseIntegrity(value: JsonObject) {
  const body = bodyWithoutIntegrity(value);
  return { ...body, integrity: { algorithm: "stable-production-id-v1",
    fingerprint: stableProductionId("durable-lease-integrity", body) } };
}

function withClaimIntegrity(value: JsonObject) {
  const body = bodyWithoutIntegrity(value);
  return { ...body, integrity: { algorithm: "stable-production-id-v1",
    fingerprint: stableProductionId("durable-claim-integrity", body) } };
}

function supportedRetryBindings(value: JsonObject) {
  const bindings: unknown[] = [];
  if (Object.hasOwn(value, "retryBudgetExtension")) bindings.push(value.retryBudgetExtension);
  const lease = value.durableLease;
  if (lease && typeof lease === "object" && !Array.isArray(lease) &&
    Object.hasOwn(lease, "retryBudgetExtension")) {
    bindings.push((lease as JsonObject).retryBudgetExtension);
  }
  return bindings;
}

function buildCanonicalIdentities(projectSlug: string, jobId: string, anchor: string) {
  const context = { projectSlug, stage: "audio" as const, runType: "resume" as const };
  const executionIdentity = buildProductionPipelineExecutionIdentity(context,
    { id: jobId, attempts: attemptNumber });
  const operation = "pipeline.stage.resume";
  const authorization: ProductionExecutionAuthorizationResult = {
    schemaVersion: "1", decisionId: stableProductionId("pipeline-authorization", executionIdentity.core),
    decision: "allow", authorized: true, reasonCode: "AUTHORIZED",
    reason: "trusted pipeline composition", evaluatedAt: anchor,
    requestId: executionIdentity.requestId, idempotencyKey: executionIdentity.idempotencyKey,
    executionFingerprint: executionIdentity.executionFingerprint, actorId: "pipeline-system",
    actorType: "system", projectSlug, operation, action: "retry-stage", stage: "audio",
    requiredCapabilities: [], grantedCapabilities: [], missingCapabilities: [],
    policyVersion: "pipeline-durable-v1", risk: "high", requiresConfirmation: true,
    requiredConfirmationLevel: "high", evidence: ["source:pipeline-composition"],
  };
  const confirmation: ProductionExecutionConfirmationValidationResult = {
    schemaVersion: "1", decision: "valid", valid: true, reasonCode: "CONFIRMATION_VALID",
    reason: "trusted pipeline composition", evaluatedAt: anchor,
    confirmationId: stableProductionId("pipeline-confirmation", executionIdentity.core),
    confirmationRequestId: stableProductionId("pipeline-confirmation-request", executionIdentity.core),
    authorizationDecisionId: authorization.decisionId,
    requestId: executionIdentity.requestId, idempotencyKey: executionIdentity.idempotencyKey,
    actorId: "pipeline-system", projectSlug, operation, action: "retry-stage", stage: "audio",
    riskLevel: "high", requiredConfirmationLevel: "high", providedConfirmationLevel: "high",
    bindingMatches: true,
    bindingFingerprint: stableProductionId("pipeline-confirmation-binding", executionIdentity.core),
    expired: false, singleUse: true, consumed: false, policyVersion: "pipeline-durable-v1",
    evidence: ["source:pipeline-composition"],
  };
  const policy = { ...defaultProductionExecutionIdempotencyPolicy, enabled: true,
    reservationTtlSeconds: ttlSeconds,
    maximumAttemptsByAction: { ...defaultProductionExecutionIdempotencyPolicy.maximumAttemptsByAction,
      "retry-stage": durableOrdinal } };
  const built = buildProductionExecutionIdempotencyIdentity(
    { authorization, confirmation }, { evaluatedAt: anchor, policy });
  if (!built.ok || !built.identity) {
    throw new Error("CANONICAL_AUDIO_ORDINAL_FOUR_RESERVATION_IDENTITY_INVALID");
  }
  return { executionIdentity, reservationIdentity: built.identity };
}

/**
 * Builds canonical IDs before inventory enumeration. Enumeration is detection-only and can never
 * become a source for a trusted ID or deletion pathname.
 */
export function preflightHistoricalAudioOrdinalFour(input: {
  readonly executionRoot: string;
  readonly ownedRoot: string;
  readonly authority: HistoricalAudioAuthority;
  readonly consumed: HistoricalAudioConsumedReceipt;
}): HistoricalAudioOrdinalFourPreflight {
  const { executionRoot, ownedRoot, authority, consumed } = input;
  const { executionIdentity, reservationIdentity } = buildCanonicalIdentities(
    authority.projectSlug, authority.jobId, consumed.jobVersion);
  const binding = buildRetryBudgetExtensionDurableBinding({
    authorityId: authority.authorityId,
    authorityIntegrityFingerprint: authority.integrity.fingerprint,
    consumptionReceiptFingerprint: consumed.integrity.fingerprint,
    projectSlug: authority.projectSlug, stage: "audio", jobId: authority.jobId,
    identityFingerprint: reservationIdentity.identityFingerprint,
    reservationBinding: reservationIdentity.identityFingerprint,
  });
  const reservationPath = path.join(executionRoot, "reservations",
    `${reservationIdentity.identityFingerprint}.json`);
  const recordPaths = exactVersionPaths(executionRoot, "idempotency", executionIdentity.recordId, 7);
  const claimPaths = exactVersionPaths(executionRoot, "claims", executionIdentity.claimId, 2);
  const attemptPaths = exactVersionPaths(executionRoot, "attempts", executionIdentity.attemptId, 3);
  const expectedPaths = [reservationPath, ...recordPaths, ...claimPaths, ...attemptPaths]
    .map((target) => path.resolve(target));
  for (const target of expectedPaths) {
    if (path.relative(ownedRoot, target).startsWith("..")) {
      throw new Error("CANONICAL_AUDIO_ORDINAL_FOUR_PATH_OUTSIDE_OWNED_ROOT");
    }
  }

  const reservation = readValidated(reservationPath, "reservation",
    "CANONICAL_AUDIO_ORDINAL_FOUR_RESERVATION_PERSISTENCE_INVALID");
  if (!same(reservation.identity, reservationIdentity) || reservation.attempt !== durableOrdinal ||
    reservation.maxAttempts !== durableOrdinal || !same(reservation.retryBudgetExtension, binding)) {
    throw new Error("CANONICAL_AUDIO_ORDINAL_FOUR_RESERVATION_LINEAGE_INVALID");
  }

  const expectedShared = {
    requestId: executionIdentity.requestId,
    idempotencyKey: executionIdentity.idempotencyKey,
    executionFingerprint: executionIdentity.executionFingerprint,
  };
  const expectedLeaseIdentity = { leaseId: executionIdentity.leaseId, workerId,
    workerSessionId, recordId: executionIdentity.recordId, ...expectedShared };
  const leaseAcquiredAt = consumed.jobVersion;
  const leaseOwnership = {
    ownerFingerprint: stableProductionId("lease-owner", expectedLeaseIdentity),
    workerEvidence: `worker:${stableProductionId("worker", {
      workerId, scope: ["pipeline.stage.resume"] })}`,
    sessionEvidence: `session:${stableProductionId("session", {
      workerSessionId, startedAt: leaseAcquiredAt })}`,
  };
  const activeLease = withLeaseIntegrity({
    schemaVersion: "1", identity: expectedLeaseIdentity, status: "active",
    acquiredAt: leaseAcquiredAt, heartbeatAt: leaseAcquiredAt,
    expiresAt: new Date(Date.parse(leaseAcquiredAt) + ttlSeconds * 1_000).toISOString(),
    version: 1, ownership: leaseOwnership, retryBudgetExtension: binding,
  });
  const recordStates = ["reserved", "reserved", "prepared", "queued", "running",
    "succeeded", "succeeded"] as const;
  for (const [index, target] of recordPaths.entries()) {
    const record = readValidated(target, "idempotency",
      "CANONICAL_AUDIO_ORDINAL_FOUR_RECORD_PERSISTENCE_INVALID");
    if (record.recordVersion !== index + 1 || record.recordId !== executionIdentity.recordId ||
      record.identityFingerprint !== reservationIdentity.identityFingerprint ||
      record.projectSlug !== authority.projectSlug || record.stage !== "audio" ||
      record.operation !== "pipeline.stage.resume" || record.attempt !== durableOrdinal ||
      record.maxAttempts !== durableOrdinal || !same(record.retryBudgetExtension, binding) ||
      record.requestId !== expectedShared.requestId ||
      record.idempotencyKey !== expectedShared.idempotencyKey ||
      record.executionFingerprint !== expectedShared.executionFingerprint) {
      throw new Error("CANONICAL_AUDIO_ORDINAL_FOUR_RECORD_LINEAGE_INVALID");
    }
    if (record.state !== recordStates[index]) {
      throw new Error("CANONICAL_AUDIO_ORDINAL_FOUR_RECORD_VERSION_STATE_INVALID");
    }
    const expectsLease = index > 0;
    if (Object.hasOwn(record, "durableLease") !== expectsLease) {
      throw new Error("CANONICAL_AUDIO_ORDINAL_FOUR_EMBEDDED_LEASE_PRESENCE_INVALID");
    }
    if (expectsLease) {
      const expectedLease = index < 6 ? activeLease : withLeaseIntegrity({
        ...bodyWithoutIntegrity(activeLease), status: "released", version: 2,
        releasedAt: record.updatedAt,
      });
      if (!same(record.durableLease, expectedLease)) {
        throw new Error("CANONICAL_AUDIO_ORDINAL_FOUR_EMBEDDED_LEASE_CANONICAL_INVALID");
      }
    }
  }

  const expectedClaimIdentity = { claimId: executionIdentity.claimId,
    recordId: executionIdentity.recordId, reservationId: reservationIdentity.identityFingerprint,
    ...expectedShared, operation: "pipeline.stage.resume", workerId, workerSessionId,
    leaseId: executionIdentity.leaseId };
  const expectedClaimBinding = { reservationVersion: 1, idempotencyVersion: 2,
    leaseVersion: 1,
    bindingFingerprint: stableProductionId("claim-binding", expectedClaimIdentity) };
  const expectedClaimOwnership = {
    ownerFingerprint: stableProductionId("claim-owner", {
      workerId, workerSessionId, leaseId: executionIdentity.leaseId }),
    reservationEvidence: `reservation:${stableProductionId("claim-reservation", {
      reservationId: reservationIdentity.identityFingerprint, version: 1 })}`,
    idempotencyEvidence: `idempotency:${stableProductionId("claim-idempotency", {
      recordId: executionIdentity.recordId, version: 2 })}`,
    leaseEvidence: `lease:${stableProductionId("claim-lease", {
      leaseId: executionIdentity.leaseId, version: 1 })}`,
  };
  for (const [index, target] of claimPaths.entries()) {
    const claim = readValidated(target, "claim",
      "CANONICAL_AUDIO_ORDINAL_FOUR_CLAIM_PERSISTENCE_INVALID");
    if (claim.claimVersion !== index + 1 || !same(claim.identity, expectedClaimIdentity) ||
      !same(claim.retryBudgetExtension, binding)) {
      throw new Error("CANONICAL_AUDIO_ORDINAL_FOUR_CLAIM_LINEAGE_INVALID");
    }
    if (!same(claim.binding, expectedClaimBinding)) {
      throw new Error("CANONICAL_AUDIO_ORDINAL_FOUR_CLAIM_BINDING_INVALID");
    }
    if (!same(claim.ownership, expectedClaimOwnership)) {
      throw new Error("CANONICAL_AUDIO_ORDINAL_FOUR_CLAIM_OWNERSHIP_INVALID");
    }
    const released = index === 1;
    if (claim.state !== (released ? "released" : "active") ||
      Object.hasOwn(claim, "releasedAt") !== released ||
      Object.hasOwn(claim, "abandonedAt")) {
      throw new Error("CANONICAL_AUDIO_ORDINAL_FOUR_CLAIM_VERSION_STATE_INVALID");
    }
  }

  const expectedAttemptIdentity = { attemptId: executionIdentity.attemptId,
    claimId: executionIdentity.claimId, reservationId: reservationIdentity.identityFingerprint,
    recordId: executionIdentity.recordId, ...expectedShared, operation: "pipeline.stage.resume",
    workerId, workerSessionId, leaseId: executionIdentity.leaseId };
  const expectedAttemptBinding = { claimVersion: 1, leaseVersion: 1,
    reservationVersion: 1,
    bindingFingerprint: buildProductionExecutionAttemptBindingFingerprint(
      expectedAttemptIdentity as never) };
  const attemptStates = ["opened", "active", "succeeded"] as const;
  for (const [index, target] of attemptPaths.entries()) {
    const attempt = readValidated(target, "attempt",
      "CANONICAL_AUDIO_ORDINAL_FOUR_ATTEMPT_PERSISTENCE_INVALID");
    if (attempt.attemptVersion !== index + 1 || !same(attempt.identity, expectedAttemptIdentity) ||
      !same(attempt.retryBudgetExtension, binding)) {
      throw new Error("CANONICAL_AUDIO_ORDINAL_FOUR_ATTEMPT_LINEAGE_INVALID");
    }
    if (!same(attempt.binding, expectedAttemptBinding)) {
      throw new Error("CANONICAL_AUDIO_ORDINAL_FOUR_ATTEMPT_BINDING_INVALID");
    }
    const finalized = index === 2;
    if (attempt.state !== attemptStates[index] ||
      Object.hasOwn(attempt, "finalizedAt") !== finalized) {
      throw new Error("CANONICAL_AUDIO_ORDINAL_FOUR_ATTEMPT_VERSION_STATE_INVALID");
    }
  }

  const expectedSet = new Set(expectedPaths.map((target) => path.normalize(target)));
  const visit = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "retry-budget-extensions") visit(target);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      let value: JsonObject;
      try { value = JSON.parse(fs.readFileSync(target, "utf8")) as JsonObject; }
      catch { continue; }
      for (const candidate of supportedRetryBindings(value)) {
        if (!candidate || typeof candidate !== "object" || Array.isArray(candidate) ||
          (candidate as JsonObject).authorityId !== authority.authorityId) continue;
        if (!same(candidate, binding) || !expectedSet.has(path.normalize(path.resolve(target)))) {
          throw new Error("CANONICAL_AUDIO_ORDINAL_FOUR_UNEXPECTED_SAME_BINDING_ARTIFACT");
        }
      }
    }
  };
  visit(executionRoot);

  const deletionTargets = [reservationPath, ...recordPaths, ...claimPaths, ...attemptPaths];
  assert.equal(deletionTargets.length, 13);
  return { binding, executionIdentity, reservationIdentity, reservationPath,
    recordPaths, claimPaths, attemptPaths, deletionTargets };
}

function writeJson(target: string, value: unknown) {
  fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
}

function bodyWithoutIntegrity(value: JsonObject) {
  const body = { ...value };
  delete body.integrity;
  return body;
}

function rewriteLease(lease: JsonObject, recordId: string, leaseId: string) {
  const identity = { ...(lease.identity as JsonObject), recordId, leaseId };
  const ownership = { ...(lease.ownership as JsonObject),
    ownerFingerprint: stableProductionId("lease-owner", identity) };
  return withLeaseIntegrity({ ...lease, identity, ownership });
}

function rewriteClaim(claim: JsonObject, ids: { recordId: string; claimId: string; leaseId: string }) {
  const identity: JsonObject = { ...(claim.identity as JsonObject), ...ids };
  const binding: JsonObject = { ...(claim.binding as JsonObject),
    bindingFingerprint: stableProductionId("claim-binding", identity) };
  const ownership = { ...(claim.ownership as JsonObject),
    ownerFingerprint: stableProductionId("claim-owner", {
      workerId: identity.workerId, workerSessionId: identity.workerSessionId, leaseId: ids.leaseId }),
    idempotencyEvidence: `idempotency:${stableProductionId("claim-idempotency", {
      recordId: ids.recordId, version: binding.idempotencyVersion })}`,
    leaseEvidence: `lease:${stableProductionId("claim-lease", {
      leaseId: ids.leaseId, version: binding.leaseVersion })}` };
  return withClaimIntegrity({ ...claim, identity, binding, ownership });
}

function rewriteAttempt(attempt: JsonObject,
  ids: { recordId: string; claimId: string; attemptId: string; leaseId: string }) {
  const originalAttemptId = (attempt.identity as JsonObject).attemptId as string;
  const identity = { ...(attempt.identity as JsonObject), ...ids };
  const binding = { ...(attempt.binding as JsonObject),
    bindingFingerprint: buildProductionExecutionAttemptBindingFingerprint(identity as never) };
  const journal = (attempt.journal as JsonObject[]).map((entry) => {
    const entryBody = { ...entry };
    delete entryBody.integrity;
    return buildProductionExecutionAttemptJournalEntryIntegrity({ ...entryBody,
      entryId: String(entry.entryId).replace(originalAttemptId, ids.attemptId),
      attemptId: ids.attemptId } as never);
  });
  const body = { ...attempt, identity, binding, journal };
  return buildProductionExecutionDurableAttemptIntegrity(bodyWithoutIntegrity(body) as never) as
    unknown as JsonObject;
}

/** Creates a validator-valid but production-constructor-noncanonical complete sibling chain. */
export function createAlternativeHistoricalAudioOrdinalFourChain(
  preflight: HistoricalAudioOrdinalFourPreflight,
) {
  const ids = { recordId: "pipeline-record-alternative-12938",
    claimId: "pipeline-claim-alternative-12938",
    attemptId: "pipeline-attempt-alternative-12938",
    leaseId: "pipeline-lease-alternative-12938" };
  for (const [index, source] of preflight.recordPaths.entries()) {
    const record = JSON.parse(fs.readFileSync(source, "utf8")) as JsonObject;
    record.recordId = ids.recordId;
    if (record.durableLease) record.durableLease = rewriteLease(
      record.durableLease as JsonObject, ids.recordId, ids.leaseId);
    const target = path.join(path.dirname(source), `${ids.recordId}-v${index + 1}.json`);
    if (!validateProductionExecutionPersistencePayload("idempotency", record)) {
      throw new Error("ALTERNATIVE_RECORD_PERSISTENCE_INVALID");
    }
    writeJson(target, record);
  }
  for (const [index, source] of preflight.claimPaths.entries()) {
    const claim = rewriteClaim(JSON.parse(fs.readFileSync(source, "utf8")) as JsonObject, ids);
    if (!validateProductionExecutionPersistencePayload("claim", claim)) {
      throw new Error("ALTERNATIVE_CLAIM_PERSISTENCE_INVALID");
    }
    writeJson(path.join(path.dirname(source), `${ids.claimId}-v${index + 1}.json`), claim);
  }
  for (const [index, source] of preflight.attemptPaths.entries()) {
    const attempt = rewriteAttempt(JSON.parse(fs.readFileSync(source, "utf8")) as JsonObject, ids);
    if (!validateProductionExecutionPersistencePayload("attempt", attempt)) {
      throw new Error("ALTERNATIVE_ATTEMPT_PERSISTENCE_INVALID");
    }
    writeJson(path.join(path.dirname(source), `${ids.attemptId}-v${index + 1}.json`), attempt);
  }
}

export function poisonHistoricalAudioOrdinalFourClaimV1(
  preflight: HistoricalAudioOrdinalFourPreflight,
) {
  const target = preflight.claimPaths[0];
  const claim = rewriteClaim(JSON.parse(fs.readFileSync(target, "utf8")) as JsonObject, {
    recordId: "pipeline-record-poisoned-parent-12938",
    claimId: preflight.executionIdentity.claimId, leaseId: preflight.executionIdentity.leaseId });
  if (!validateProductionExecutionPersistencePayload("claim", claim)) {
    throw new Error("POISONED_CLAIM_PERSISTENCE_INVALID");
  }
  fs.writeFileSync(target, `${JSON.stringify(claim, null, 2)}\n`, "utf8");
}

export function poisonHistoricalAudioOrdinalFourAttemptV1(
  preflight: HistoricalAudioOrdinalFourPreflight,
) {
  const target = preflight.attemptPaths[0];
  const attempt = rewriteAttempt(JSON.parse(fs.readFileSync(target, "utf8")) as JsonObject, {
    recordId: preflight.executionIdentity.recordId,
    claimId: "pipeline-claim-poisoned-parent-12938",
    attemptId: preflight.executionIdentity.attemptId,
    leaseId: preflight.executionIdentity.leaseId });
  if (!validateProductionExecutionPersistencePayload("attempt", attempt)) {
    throw new Error("POISONED_ATTEMPT_PERSISTENCE_INVALID");
  }
  fs.writeFileSync(target, `${JSON.stringify(attempt, null, 2)}\n`, "utf8");
}

/** Keeps claim-v2 canonical while making claim-v1 internally valid but canonically misbound. */
export function poisonHistoricalAudioOrdinalFourClaimV1Binding(
  preflight: HistoricalAudioOrdinalFourPreflight,
) {
  const target = preflight.claimPaths[0];
  const claim = JSON.parse(fs.readFileSync(target, "utf8")) as JsonObject;
  const binding = { ...(claim.binding as JsonObject), idempotencyVersion: 99 };
  const identity = claim.identity as JsonObject;
  const ownership = { ...(claim.ownership as JsonObject),
    idempotencyEvidence: `idempotency:${stableProductionId("claim-idempotency", {
      recordId: identity.recordId, version: binding.idempotencyVersion })}` };
  const poisoned = withClaimIntegrity({ ...claim, binding, ownership });
  if (!validateProductionExecutionPersistencePayload("claim", poisoned)) {
    throw new Error("POISONED_CLAIM_BINDING_PERSISTENCE_INVALID");
  }
  fs.writeFileSync(target, `${JSON.stringify(poisoned, null, 2)}\n`, "utf8");
}

/** Keeps attempt-v3 canonical while making attempt-v1 internally valid but canonically misbound. */
export function poisonHistoricalAudioOrdinalFourAttemptV1Binding(
  preflight: HistoricalAudioOrdinalFourPreflight,
) {
  const target = preflight.attemptPaths[0];
  const attempt = JSON.parse(fs.readFileSync(target, "utf8")) as JsonObject;
  const binding = { ...(attempt.binding as JsonObject), claimVersion: 99 };
  const poisoned = buildProductionExecutionDurableAttemptIntegrity(
    { ...bodyWithoutIntegrity(attempt), binding } as never) as unknown as JsonObject;
  if (!validateProductionExecutionPersistencePayload("attempt", poisoned)) {
    throw new Error("POISONED_ATTEMPT_BINDING_PERSISTENCE_INVALID");
  }
  fs.writeFileSync(target, `${JSON.stringify(poisoned, null, 2)}\n`, "utf8");
}

function poisonHistoricalAudioOrdinalFourLease(
  preflight: HistoricalAudioOrdinalFourPreflight,
  transform: (lease: JsonObject) => JsonObject,
) {
  const target = preflight.recordPaths[1];
  const record = JSON.parse(fs.readFileSync(target, "utf8")) as JsonObject;
  const lease = transform(record.durableLease as JsonObject);
  const poisoned = { ...record, durableLease: withLeaseIntegrity(lease) };
  if (!validateProductionExecutionPersistencePayload("idempotency", poisoned)) {
    throw new Error("POISONED_EMBEDDED_LEASE_PERSISTENCE_INVALID");
  }
  fs.writeFileSync(target, `${JSON.stringify(poisoned, null, 2)}\n`, "utf8");
}

export function poisonHistoricalAudioOrdinalFourLeaseV2Ownership(
  preflight: HistoricalAudioOrdinalFourPreflight,
) {
  poisonHistoricalAudioOrdinalFourLease(preflight, (lease) => ({ ...lease,
    ownership: { ...(lease.ownership as JsonObject),
      ownerFingerprint: "lease-owner-persistence-valid-but-noncanonical" } }));
}

export function poisonHistoricalAudioOrdinalFourLeaseV2Version(
  preflight: HistoricalAudioOrdinalFourPreflight,
) {
  poisonHistoricalAudioOrdinalFourLease(preflight, (lease) => ({ ...lease, version: 99 }));
}

/** Adds an outside-allowlist record whose current authority exists only in the embedded lease. */
export function createEmbeddedOnlyUnexpectedHistoricalAudioOrdinalFourRecord(
  preflight: HistoricalAudioOrdinalFourPreflight,
) {
  const source = preflight.recordPaths[1];
  const record = JSON.parse(fs.readFileSync(source, "utf8")) as JsonObject;
  delete record.retryBudgetExtension;
  if (!validateProductionExecutionPersistencePayload("idempotency", record)) {
    throw new Error("EMBEDDED_ONLY_UNEXPECTED_RECORD_PERSISTENCE_INVALID");
  }
  writeJson(path.join(path.dirname(source), "embedded-only-unexpected-record.json"), record);
}
