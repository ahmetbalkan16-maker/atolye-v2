import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildProductionExecutionAttemptBindingFingerprint,
  buildProductionExecutionAttemptJournalEntryIntegrity,
  buildProductionExecutionDurableAttemptIntegrity,
} from "../src/lib/production/ProductionExecutionDurableAttemptIntegrity";
import {
  buildProductionExecutionIdempotencyIdentity,
  defaultProductionExecutionIdempotencyPolicy,
} from "../src/lib/production/ProductionExecutionIdempotency";
import {
  buildProductionOrphanReservationToleranceAuthorityBody,
  orphanReservationTolerancePolicyVersion,
  orphanReservationToleranceSchemaVersion,
  reservationContentFingerprint,
  writeProductionOrphanReservationToleranceAuthority,
} from "../src/lib/production/ProductionOrphanReservationToleranceAuthority";
import { buildProductionPipelineExecutionIdentity } from
  "../src/lib/production/ProductionPipelineExecutionFactory";
import { classifyProductionDurableAttemptLineage } from
  "../src/lib/production/ProductionDurableAttemptLineageClassifier";
import { ProductionExecutionFilePersistenceAdapter } from
  "../src/lib/production/ProductionExecutionPersistence";
import { stableProductionId } from "../src/lib/production/ProductionDeterminism";
import {
  createIsolatedRuntimeStorageContext,
  getProjectRoot,
} from "../src/lib/runtime/RuntimeStoragePaths";
import { emitSmokeResult } from "./lib/SmokeResult";
import type { ProductionExecutionDurableAttemptRecord } from
  "../src/types/productionExecutionDurableAttempt";
import type { ProductionExecutionDurableClaimRecord } from
  "../src/types/productionExecutionDurableClaim";
import type { ProductionExecutionDurableRecord } from
  "../src/types/productionExecutionDurableStorage";
import type {
  ProductionExecutionIdempotencyRecord,
  ProductionExecutionIdempotencyReservationRequest,
} from "../src/types/productionExecutionIdempotency";
import type { ProductionRegenerationBinding } from "../src/types/productionRegeneration";

/**
 * P1 (ProductionDurableAttemptLineageClassifier.ts) + Remediation C smoke:
 * a "trailing orphan" is a reservation that reconcileOrphanedReservationWithoutClaim()
 * cancelled before it ever became a real attempt (no claim, no attempt record). As of
 * Remediation C, an orphan ANYWHERE in the attempt range (not just the literal top of
 * the range) may be excluded from the claim/attempt pairing requirement, but ONLY when
 * an explicit, content-fingerprint-CAS-pinned ProductionOrphanReservationToleranceAuthority
 * record exists for its exact (project, stage, job, reservation, operation, attempt)
 * tuple. "cancelled + claimless + attemptless" is never sufficient by itself.
 *
 * Authority tolerance NEVER relaxes the pre-exclusion cardinality/topology proof: that
 * proof runs on the RAW record set, before any exclusion is even considered, and requires
 * exactly one record per ordinal (see sections 2c/2d below). A genuine duplicate ordinal
 * (two different recordIds both claiming the same `attempt`) is rejected unconditionally
 * — whether or not one of the two copies happens to also be an authority-tolerated orphan.
 *
 * Every fixture here mirrors the exact canonicalRecord/canonicalAttempt/canonicalClaim
 * pattern used by smoke-production-durable-attempt-lineage-compatibility.ts, so it
 * produces genuinely validation-passing records — never hand-crafted JSON that silently
 * fails to persist.
 */

const projectSlug = "orphan-tolerance-project";
const stage = "assembly" as const;
const timestamp = "2026-08-22T00:00:00.000Z";
let scenarios = 0;

async function scenario(name: string, action: () => Promise<void>): Promise<void> {
  await action();
  scenarios += 1;
  process.stdout.write(`PASS ${scenarios}: ${name}\n`);
}

function identityFor(operation: string, planned: ReturnType<typeof buildProductionPipelineExecutionIdentity>) {
  const authorization = {
    schemaVersion: "1" as const, decisionId: `authorization-${planned.recordId}`,
    decision: "allow" as const, authorized: true as const, reasonCode: "AUTHORIZED" as const,
    reason: "trusted orphan-tolerance fixture", evaluatedAt: timestamp,
    requestId: planned.requestId, idempotencyKey: planned.idempotencyKey,
    executionFingerprint: planned.executionFingerprint, actorId: "pipeline-system",
    actorType: "system" as const, projectSlug, operation,
    action: "retry-stage", stage,
    requiredCapabilities: [], grantedCapabilities: [], missingCapabilities: [],
    policyVersion: defaultProductionExecutionIdempotencyPolicy.policyVersion,
    risk: "high" as const, requiresConfirmation: true,
    requiredConfirmationLevel: "high" as const, evidence: ["source:test"],
  };
  const confirmation = {
    schemaVersion: "1" as const, decision: "valid" as const, valid: true as const,
    reasonCode: "CONFIRMATION_VALID" as const, reason: "trusted orphan-tolerance fixture",
    evaluatedAt: timestamp, confirmationId: `confirmation-${planned.recordId}`,
    confirmationRequestId: `confirmation-request-${planned.recordId}`,
    authorizationDecisionId: authorization.decisionId, requestId: planned.requestId,
    idempotencyKey: planned.idempotencyKey, actorId: "pipeline-system",
    projectSlug, operation, action: "retry-stage", stage, riskLevel: "high",
    requiredConfirmationLevel: "high" as const, providedConfirmationLevel: "high" as const,
    bindingMatches: true, bindingFingerprint: `binding-${planned.recordId}`,
    expired: false, singleUse: true, consumed: false,
    policyVersion: defaultProductionExecutionIdempotencyPolicy.policyVersion,
    evidence: ["source:test"],
  };
  const result = buildProductionExecutionIdempotencyIdentity({ authorization, confirmation }, {
    evaluatedAt: timestamp,
    policy: { ...defaultProductionExecutionIdempotencyPolicy, enabled: true,
      maximumAttemptsByAction: {
        ...defaultProductionExecutionIdempotencyPolicy.maximumAttemptsByAction,
        "retry-stage": 10,
      } },
  });
  assert.equal(result.ok, true);
  assert.ok(result.identity);
  return { identity: result.identity!, authorization, confirmation };
}

/** Deliberately synthetic — NOT registered in any regeneration store, and
 * this file never needs it to be discoverable there (see the comment on
 * canonicalRecordWithRegeneration). Its only job is to make `core` (inside
 * buildProductionPipelineExecutionIdentity) differ from the no-regeneration
 * case, which is what actually changes `recordId`/`claimId`/`attemptId` —
 * identity derivation is a pure function of (projectSlug, stage, jobId,
 * attemptNumber, regeneration); `runType` alone does NOT affect any of
 * those (see ProductionPipelineExecutionIdentity.ts) and cannot be used to
 * construct a duplicate-ordinal fixture. */
const duplicateOrdinalTestRegeneration: ProductionRegenerationBinding = {
  regenerationId: "pipeline-regen-test-duplicate-ordinal-fixture",
  generationOrdinal: 2,
  planFingerprint: "plan-fingerprint-test-duplicate-ordinal-fixture",
  fromStage: stage,
  reasonCode: "test-fixture-duplicate-ordinal",
};

function plannedForRegeneration(ordinal: number, regeneration: ProductionRegenerationBinding | undefined) {
  return buildProductionPipelineExecutionIdentity(
    { projectSlug, stage, runType: "resume", regeneration },
    { id: `${projectSlug}-${stage}`, attempts: ordinal - 1 },
  );
}

/** A cancelled idempotency record with no claim/attempt ever written for it
 * is exactly what reconcileOrphanedReservationWithoutClaim() produces. */
function canonicalRecord(ordinal: number): ProductionExecutionDurableRecord {
  return canonicalRecordWithRegeneration(ordinal, undefined);
}

/** Same shape as canonicalRecord(), but lets the caller supply a (possibly
 * synthetic) regeneration binding for the SAME ordinal — the only way to
 * construct two genuinely DIFFERENT recordIds both claiming the same
 * `attempt` value (a true duplicate-ordinal fixture). The duplicate-ordinal
 * scenarios below never rely on this binding being independently
 * discoverable via listRegenerationExecutionBindingCandidates() — the
 * pre-exclusion cardinality/topology gate rejects a raw record-count
 * mismatch before the classifier ever attempts to resolve either record's
 * historical identity, so this only needs to produce a distinct recordId at
 * write time, not a resolvable one. */
function canonicalRecordWithRegeneration(ordinal: number,
  regeneration: ProductionRegenerationBinding | undefined): ProductionExecutionDurableRecord {
  const planned = plannedForRegeneration(ordinal, regeneration);
  const { identity } = identityFor(`pipeline.stage.resume`, planned);
  return {
    schemaVersion: "1", recordId: planned.recordId,
    identityFingerprint: identity.identityFingerprint,
    idempotencyKey: identity.idempotencyKey, requestId: identity.requestId,
    executionFingerprint: identity.executionFingerprint,
    bindingFingerprint: identity.bindingFingerprint, actorId: identity.actorId,
    projectSlug: identity.projectSlug, operation: identity.operation,
    action: identity.action, stage: identity.stage,
    authorizationDecisionId: identity.authorizationDecisionId,
    confirmationRequestId: identity.confirmationRequestId,
    confirmationId: identity.confirmationId, policyVersion: identity.policyVersion,
    riskLevel: identity.riskLevel, state: "cancelled",
    attempt: ordinal, maxAttempts: 10,
    createdAt: timestamp, updatedAt: timestamp, reservedAt: timestamp, finishedAt: timestamp,
    evidence: ["source:pipeline-composition"],
    integrity: { algorithm: "stable-production-id-v1", fingerprint: identity.identityFingerprint,
      version: 1 }, storageVersion: "1", lifecycleState: "cancelled", recordVersion: 1,
  };
}

/** The reservation an orphaned record was created from — same identity, same
 * ordinal, matching exactly what canonicalRecord(ordinal) derives its
 * identityFingerprint/operation from, so `record.identityFingerprint` keys
 * straight to this reservation in the adapter's "reservation" store. */
function canonicalReservationWithRegeneration(ordinal: number,
  regeneration: ProductionRegenerationBinding | undefined): ProductionExecutionIdempotencyReservationRequest {
  const planned = plannedForRegeneration(ordinal, regeneration);
  const { identity, authorization, confirmation } = identityFor(`pipeline.stage.resume`, planned);
  return {
    schemaVersion: "1", identity, authorization, confirmation,
    requestedAt: timestamp, expectedInitialState: "reserved",
    attempt: ordinal, maxAttempts: 10, reservationTtlSeconds: 300,
    policyContext: { source: "server", environment: "test" },
    metadata: { source: "server" },
  };
}

function journal(attemptId: string) {
  const body = {
    entryId: `${attemptId}-opened`, attemptId, sequence: 1,
    entryType: "ATTEMPT_OPENED" as const, recordedAt: timestamp,
    payload: { code: "ATTEMPT_OPENED", category: "lifecycle", summary: "Attempt opened." },
    evidence: ["attempt:opened"],
  };
  return buildProductionExecutionAttemptJournalEntryIntegrity(body);
}

function canonicalAttempt(ordinal: number, record: ProductionExecutionIdempotencyRecord):
  ProductionExecutionDurableAttemptRecord {
  return canonicalAttemptWithRegeneration(ordinal, undefined, record);
}

function canonicalAttemptWithRegeneration(ordinal: number, regeneration: ProductionRegenerationBinding | undefined,
  record: ProductionExecutionIdempotencyRecord): ProductionExecutionDurableAttemptRecord {
  const planned = plannedForRegeneration(ordinal, regeneration);
  const identity = {
    attemptId: planned.attemptId, claimId: planned.claimId,
    reservationId: record.identityFingerprint, recordId: planned.recordId,
    requestId: planned.requestId, idempotencyKey: planned.idempotencyKey,
    executionFingerprint: planned.executionFingerprint, workerId: "pipeline-worker",
    workerSessionId: "pipeline-session-v1", leaseId: planned.leaseId,
  };
  return buildProductionExecutionDurableAttemptIntegrity({
    schemaVersion: "1", storageVersion: "1", identity,
    binding: { claimVersion: 1, leaseVersion: 1, reservationVersion: 1,
      bindingFingerprint: buildProductionExecutionAttemptBindingFingerprint(identity) },
    state: "failed", attemptVersion: 1, openedAt: timestamp, updatedAt: timestamp,
    finalizedAt: timestamp, journal: [journal(planned.attemptId)],
    evidence: ["coordination:single-record", "transactional:false"],
  });
}

function canonicalClaim(
  record: ProductionExecutionDurableRecord,
  attempt: ProductionExecutionDurableAttemptRecord,
): ProductionExecutionDurableClaimRecord {
  const body = {
    schemaVersion: "1" as const, storageVersion: "1" as const,
    identity: {
      claimId: attempt.identity.claimId, recordId: record.recordId,
      reservationId: record.identityFingerprint, requestId: record.requestId,
      idempotencyKey: record.idempotencyKey, operation: record.operation,
      executionFingerprint: record.executionFingerprint, workerId: attempt.identity.workerId,
      workerSessionId: attempt.identity.workerSessionId, leaseId: attempt.identity.leaseId,
    },
    binding: { reservationVersion: 1, idempotencyVersion: record.recordVersion,
      leaseVersion: 1, bindingFingerprint: `claim-binding-${record.recordId}` },
    ownership: { ownerFingerprint: `owner-${record.recordId}`,
      reservationEvidence: `reservation-${record.recordId}`,
      idempotencyEvidence: `idempotency-${record.recordId}`,
      leaseEvidence: `lease-${record.recordId}` },
    state: "abandoned" as const, claimVersion: 1, acquiredAt: timestamp,
    updatedAt: timestamp, abandonedAt: timestamp, evidence: ["fixture:terminal-claim"],
  };
  return { ...body, integrity: { algorithm: "stable-production-id-v1",
    fingerprint: stableProductionId("durable-claim-integrity", body) } };
}

interface Fixture {
  readonly root: string;
  readonly adapter: ProductionExecutionFilePersistenceAdapter;
  readonly storageContext: ReturnType<typeof createIsolatedRuntimeStorageContext>;
}

async function setup(name: string): Promise<Fixture> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `atolye-orphan-tolerance-${name}-`));
  // Isolated end-to-end: the adapter's own record/claim/attempt/reservation
  // root AND the tolerance-authority store root both derive from the SAME
  // storageContext, mirroring exactly how production derives both from one
  // shared RuntimeStorageContext (ProductionPipelineRetryReconciliation.ts /
  // ProductionOrphanReservationToleranceAuthority.ts) — never the real repo.
  const storageContext = createIsolatedRuntimeStorageContext({
    environment: { ATOLYE_RUNTIME_ROOT: path.join(root, "runtime") },
  });
  const adapter = new ProductionExecutionFilePersistenceAdapter({
    trustedRootDirectory: path.join(getProjectRoot(projectSlug, storageContext), "production-execution"),
    trustedAttemptIdFactory: () => "orphan-tolerance-fixture",
  });
  return { root, adapter, storageContext };
}

/** Writes a genuine, fully-paired real attempt (record + claim + attempt). */
async function writeRealAttempt(fixture: Fixture, ordinal: number): Promise<ProductionExecutionDurableRecord> {
  return writeRealAttemptWithRegeneration(fixture, ordinal, undefined);
}

/** Same as writeRealAttempt(), but under a specific (possibly synthetic)
 * regeneration binding — the only way to write a SECOND, genuinely valid
 * (claim+attempt-bearing) record at an ordinal that already has one, for
 * the duplicate-ordinal fixtures below. */
async function writeRealAttemptWithRegeneration(fixture: Fixture, ordinal: number,
  regeneration: ProductionRegenerationBinding | undefined): Promise<ProductionExecutionDurableRecord> {
  const record = canonicalRecordWithRegeneration(ordinal, regeneration);
  const attempt = canonicalAttemptWithRegeneration(ordinal, regeneration, record);
  const claim = canonicalClaim(record, attempt);
  assert.equal((await fixture.adapter.write("idempotency", `${record.recordId}-v1`, record)).ok, true);
  assert.equal((await fixture.adapter.write("attempt", `${attempt.identity.attemptId}-v1`, attempt)).ok, true);
  assert.equal((await fixture.adapter.write("claim", `${claim.identity.claimId}-v1`, claim)).ok, true);
  return record;
}

/** Writes an orphan reservation (idempotency record + its originating
 * reservation, no claim, no attempt — mirrors
 * reconcileOrphanedReservationWithoutClaim()'s output exactly, plus the
 * reservation artifact a tolerance-authority CAS check reads fresh). */
async function writeOrphanRecord(fixture: Fixture, ordinal: number):
  Promise<{ record: ProductionExecutionDurableRecord; reservation: ProductionExecutionIdempotencyReservationRequest }> {
  return writeOrphanRecordWithRegeneration(fixture, ordinal, undefined);
}

/** Same as writeOrphanRecord(), but under a specific (possibly synthetic)
 * regeneration binding — the only way to write an orphan at an ordinal that
 * already has a genuinely valid record, for the duplicate-ordinal fixtures
 * below. */
async function writeOrphanRecordWithRegeneration(fixture: Fixture, ordinal: number,
  regeneration: ProductionRegenerationBinding | undefined):
  Promise<{ record: ProductionExecutionDurableRecord; reservation: ProductionExecutionIdempotencyReservationRequest }> {
  const record = canonicalRecordWithRegeneration(ordinal, regeneration);
  const reservation = canonicalReservationWithRegeneration(ordinal, regeneration);
  assert.equal((await fixture.adapter.write("idempotency", `${record.recordId}-v1`, record)).ok, true);
  assert.equal((await fixture.adapter.write("reservation", record.identityFingerprint, reservation)).ok, true);
  return { record, reservation };
}

/** Publishes a matching, CAS-valid tolerance authority for an already-written
 * orphan record/reservation pair. `fingerprintOverride` lets a test
 * deliberately mint a stale/mismatched CAS pin. */
function writeMatchingAuthority(
  fixture: Fixture, ordinal: number, record: ProductionExecutionDurableRecord,
  reservation: ProductionExecutionIdempotencyReservationRequest,
  fingerprintOverride?: string,
): void {
  const body = buildProductionOrphanReservationToleranceAuthorityBody({
    schemaVersion: orphanReservationToleranceSchemaVersion,
    policyVersion: orphanReservationTolerancePolicyVersion,
    authorityId: `test-authority-${record.recordId}`,
    issuedAt: timestamp,
    projectSlug, stage, jobId: `${projectSlug}-${stage}`,
    reservationId: record.identityFingerprint,
    operation: record.operation,
    attempt: ordinal,
    reason: "smoke-fixture: matching authority for a trailing orphan reservation",
    reservationContentFingerprint: fingerprintOverride ?? reservationContentFingerprint(reservation),
  });
  const written = writeProductionOrphanReservationToleranceAuthority(projectSlug, body, fixture.storageContext);
  assert.equal(written.ok, true, `tolerance authority must write cleanly: ${written.reasonCode}`);
}

/** Writes a record with a claim but deliberately no attempt — a malformed,
 * partial orphan that must never be tolerated. */
async function writeClaimOnlyRecord(fixture: Fixture, ordinal: number): Promise<void> {
  const record = canonicalRecord(ordinal);
  const attempt = canonicalAttempt(ordinal, record); // built in-memory only, never written
  const claim = canonicalClaim(record, attempt);
  assert.equal((await fixture.adapter.write("idempotency", `${record.recordId}-v1`, record)).ok, true);
  assert.equal((await fixture.adapter.write("claim", `${claim.identity.claimId}-v1`, claim)).ok, true);
}

/** Writes a record with an attempt but deliberately no claim — the mirror
 * malformed case. */
async function writeAttemptOnlyRecord(fixture: Fixture, ordinal: number): Promise<void> {
  const record = canonicalRecord(ordinal);
  const attempt = canonicalAttempt(ordinal, record);
  assert.equal((await fixture.adapter.write("idempotency", `${record.recordId}-v1`, record)).ok, true);
  assert.equal((await fixture.adapter.write("attempt", `${attempt.identity.attemptId}-v1`, attempt)).ok, true);
}

async function main() {
  // --- 1) A single trailing orphan on top of real attempts is tolerated
  // ONLY once a matching, CAS-valid tolerance authority exists for it.
  // Without one, "cancelled + claimless + attemptless" is not, by itself,
  // sufficient (Remediation C's core invariant) — even at the literal top
  // of the range, where the pre-Remediation-C code tolerated it by position
  // alone.
  const trailing = await setup("trailing");
  try {
    await writeRealAttempt(trailing, 1);
    await writeRealAttempt(trailing, 2);
    await writeRealAttempt(trailing, 3);
    const { record: orphanRecord, reservation: orphanReservation } = await writeOrphanRecord(trailing, 4);

    await scenario("trailing orphan WITHOUT a matching authority is not tolerated (fails closed)", async () => {
      const result = await classifyProductionDurableAttemptLineage(
        trailing.adapter, projectSlug, stage, 3, "preparation", trailing.storageContext,
      );
      assert.equal(result.status, "invalid");
      if (result.status === "invalid") assert.equal(result.boundary, "claim-lineage-missing");
    });

    writeMatchingAuthority(trailing, 4, orphanRecord, orphanReservation);

    await scenario(
      "trailing orphan WITH a matching, CAS-valid authority is excluded from maximum/cardinality (preparation mode)",
      async () => {
        const result = await classifyProductionDurableAttemptLineage(
          trailing.adapter, projectSlug, stage, 3, "preparation", trailing.storageContext,
        );
        assert.equal(result.status, "valid");
        if (result.status === "valid") {
          assert.equal(result.durableOrdinal, 3);
          assert.equal(result.maximumRecordAttempt, 3);
        }
      },
    );

    await scenario(
      "trailing orphan WITH a matching, CAS-valid authority is excluded from maximum/cardinality (exact mode)",
      async () => {
        const result = await classifyProductionDurableAttemptLineage(
          trailing.adapter, projectSlug, stage, 2, "exact", trailing.storageContext,
        );
        assert.equal(result.status, "valid");
        if (result.status === "valid") assert.equal(result.durableOrdinal, 2);
      },
    );

    await scenario("the resolved ordinal reopens the orphan's own ordinal, not past it", async () => {
      const result = await classifyProductionDurableAttemptLineage(
        trailing.adapter, projectSlug, stage, 3, "preparation", trailing.storageContext,
      );
      assert.equal(result.status, "valid");
      if (result.status !== "valid") return;
      const identity = buildProductionPipelineExecutionIdentity(
        { projectSlug, stage, runType: "resume" },
        { id: `${projectSlug}-${stage}`, attempts: result.durableOrdinal },
      );
      // attempts:3 -> record.attempt:4, matching the orphan's own attempt
      // number exactly (never 5 — attempt-8-equivalent would be the bug).
      assert.equal(identity.recordId, orphanRecord.recordId);
    });

    await scenario("an authority CAS mismatch (reservation content drift) is not tolerated", async () => {
      // Exercised in its own fresh fixture (rather than reusing `trailing`,
      // which already has a VALID authority published for record 4 — since
      // findMatchingOrphanReservationToleranceAuthority matches on
      // (reservationId, operation, attempt) alone, a second authority for
      // that same tuple would just be a redundant, unreachable duplicate,
      // not an isolated CAS-mismatch proof) so the only authority present
      // for this ordinal is the deliberately-wrong one.
      const casFixture = await setup("cas-mismatch");
      try {
        await writeRealAttempt(casFixture, 1);
        await writeRealAttempt(casFixture, 2);
        await writeRealAttempt(casFixture, 3);
        const { record, reservation } = await writeOrphanRecord(casFixture, 4);
        writeMatchingAuthority(casFixture, 4, record, reservation, "orphan-reservation-tolerance-content-deliberately-wrong");
        const result = await classifyProductionDurableAttemptLineage(
          casFixture.adapter, projectSlug, stage, 3, "preparation", casFixture.storageContext,
        );
        assert.equal(result.status, "invalid");
        if (result.status === "invalid") assert.equal(result.boundary, "claim-lineage-missing");
      } finally { await fs.rm(casFixture.root, { recursive: true, force: true }); }
    });
  } finally { await fs.rm(trailing.root, { recursive: true, force: true }); }

  // --- 2) An orphan in the MIDDLE of the range (not trailing), with no
  // authority published for it, is never tolerated — proves the exclusion
  // is authority-gated, not merely position-independent.
  const middle = await setup("middle");
  try {
    await writeRealAttempt(middle, 1);
    await writeOrphanRecord(middle, 2);
    await writeRealAttempt(middle, 3);

    await scenario("an orphan gap in the middle of the range, without authority, still invalidates the lineage", async () => {
      const result = await classifyProductionDurableAttemptLineage(
        middle.adapter, projectSlug, stage, 2, "preparation", middle.storageContext,
      );
      assert.equal(result.status, "invalid");
      if (result.status === "invalid") {
        assert.ok(result.boundary === "claim-lineage-missing" || result.boundary === "attempt-lineage-missing");
      }
    });
  } finally { await fs.rm(middle.root, { recursive: true, force: true }); }

  // --- 2b) The SAME middle-of-range orphan, now WITH a matching, CAS-valid
  // authority, IS tolerated — proves the exclusion is genuinely
  // position-independent once properly authorized (Remediation C's whole
  // point: an orphan buried underneath a later, genuinely valid attempt).
  const middleAuthorized = await setup("middle-authorized");
  try {
    await writeRealAttempt(middleAuthorized, 1);
    const { record, reservation } = await writeOrphanRecord(middleAuthorized, 2);
    await writeRealAttempt(middleAuthorized, 3);
    writeMatchingAuthority(middleAuthorized, 2, record, reservation);

    await scenario("an orphan gap in the middle of the range, WITH matching authority, resolves around it", async () => {
      const result = await classifyProductionDurableAttemptLineage(
        middleAuthorized.adapter, projectSlug, stage, 3, "preparation", middleAuthorized.storageContext,
      );
      assert.equal(result.status, "valid");
      if (result.status === "valid") {
        // ordinal 3's own attempt is the real frontier; latest state is
        // "failed" (canonicalAttempt's fixture state), so preparation mode
        // resolves to the frontier itself, ready for the NEXT fresh attempt.
        assert.equal(result.maximumRecordAttempt, 3);
        assert.equal(result.durableOrdinal, 3);
      }
    });
  } finally { await fs.rm(middleAuthorized.root, { recursive: true, force: true }); }

  // --- 2c) A genuine DUPLICATE ordinal (two different recordIds, via two
  // different regeneration bindings, both claiming attempt 7) where ONE
  // copy is a matching, CAS-valid, authority-tolerated orphan and the OTHER
  // is a fully real, claim+attempt-bearing record. Authority tolerance
  // NEVER relaxes the pre-exclusion cardinality/topology proof — this must
  // fail exactly like any other duplicate, because resolving which of two
  // identities is canonical is a distinct, explicit reconciliation decision
  // an orphan-reservation-tolerance authority is not scoped to make. This is
  // the exact shape the real i-stanbul-un-fethi-1453 project's assembly
  // stage durable history has at ordinal 7 (two recordIds, one real, one an
  // authority-tolerated orphan) — see smoke-attempt7-lineage-reopen-verification.ts.
  const duplicateAuthorized = await setup("duplicate-authorized");
  try {
    await writeRealAttempt(duplicateAuthorized, 1);
    await writeRealAttempt(duplicateAuthorized, 2);
    await writeRealAttempt(duplicateAuthorized, 3);
    await writeRealAttempt(duplicateAuthorized, 4);
    await writeRealAttempt(duplicateAuthorized, 5);
    await writeRealAttempt(duplicateAuthorized, 6);
    await writeRealAttempt(duplicateAuthorized, 7);
    const { record: orphanSeven, reservation: orphanSevenReservation } = await writeOrphanRecordWithRegeneration(
      duplicateAuthorized, 7, duplicateOrdinalTestRegeneration,
    );
    await writeRealAttempt(duplicateAuthorized, 8);
    writeMatchingAuthority(duplicateAuthorized, 7, orphanSeven, orphanSevenReservation);

    await scenario(
      "duplicate ordinal (one valid, one authority-tolerated orphan) is rejected — authority never relaxes cardinality",
      async () => {
        const result = await classifyProductionDurableAttemptLineage(
          duplicateAuthorized.adapter, projectSlug, stage, 8, "preparation", duplicateAuthorized.storageContext,
        );
        assert.equal(result.status, "invalid");
        if (result.status === "invalid") assert.equal(result.boundary, "lineage-cardinality");
      },
    );
  } finally { await fs.rm(duplicateAuthorized.root, { recursive: true, force: true }); }

  // --- 2d) The plain baseline this all rests on: two independently valid
  // (claim+attempt-bearing) records at the same ordinal, no orphan and no
  // authority involved at all. Must reject identically to 2c) — proves the
  // cardinality gate itself, not merely the authority-interaction path.
  const duplicateValid = await setup("duplicate-valid");
  try {
    await writeRealAttempt(duplicateValid, 1);
    await writeRealAttempt(duplicateValid, 2);
    await writeRealAttempt(duplicateValid, 3);
    await writeRealAttempt(duplicateValid, 4);
    await writeRealAttempt(duplicateValid, 5);
    await writeRealAttempt(duplicateValid, 6);
    await writeRealAttempt(duplicateValid, 7);
    await writeRealAttemptWithRegeneration(duplicateValid, 7, duplicateOrdinalTestRegeneration);
    await writeRealAttempt(duplicateValid, 8);

    await scenario("two independently valid records at the same ordinal (no orphan involved) are rejected", async () => {
      const result = await classifyProductionDurableAttemptLineage(
        duplicateValid.adapter, projectSlug, stage, 8, "preparation", duplicateValid.storageContext,
      );
      assert.equal(result.status, "invalid");
      if (result.status === "invalid") assert.equal(result.boundary, "lineage-cardinality");
    });
  } finally { await fs.rm(duplicateValid.root, { recursive: true, force: true }); }

  // --- 2e) The 1..8 counterpart WITHOUT a duplicate at all — a single
  // authority-tolerated orphan at ordinal 7, nothing else contending for
  // that ordinal. This is the exact shape Remediation C is scoped to
  // resolve (contrast directly with 2c above, which differs ONLY by the
  // presence of a second, competing record at ordinal 7).
  const singleOrphanSeven = await setup("single-orphan-seven");
  try {
    await writeRealAttempt(singleOrphanSeven, 1);
    await writeRealAttempt(singleOrphanSeven, 2);
    await writeRealAttempt(singleOrphanSeven, 3);
    await writeRealAttempt(singleOrphanSeven, 4);
    await writeRealAttempt(singleOrphanSeven, 5);
    await writeRealAttempt(singleOrphanSeven, 6);
    const { record: orphanSeven, reservation: orphanSevenReservation } =
      await writeOrphanRecord(singleOrphanSeven, 7);
    await writeRealAttempt(singleOrphanSeven, 8);
    writeMatchingAuthority(singleOrphanSeven, 7, orphanSeven, orphanSevenReservation);

    await scenario(
      "1..8 with a single authority-tolerated orphan at ordinal 7 (no duplicate) resolves valid",
      async () => {
        const result = await classifyProductionDurableAttemptLineage(
          singleOrphanSeven.adapter, projectSlug, stage, 8, "preparation", singleOrphanSeven.storageContext,
        );
        assert.equal(result.status, "valid");
        if (result.status === "valid") {
          assert.equal(result.durableOrdinal, 8);
          assert.equal(result.maximumRecordAttempt, 8);
        }
      },
    );
  } finally { await fs.rm(singleOrphanSeven.root, { recursive: true, force: true }); }

  // --- 3) A trailing record with a claim but no attempt is NOT tolerated —
  // only "neither exists" counts as an orphan reservation, and this shape
  // never even reaches the authority check (claims.has(...) short-circuits it).
  const claimOnly = await setup("claim-only");
  try {
    await writeRealAttempt(claimOnly, 1);
    await writeRealAttempt(claimOnly, 2);
    await writeClaimOnlyRecord(claimOnly, 3);

    await scenario("trailing record with a claim but no attempt is not treated as an orphan", async () => {
      const result = await classifyProductionDurableAttemptLineage(
        claimOnly.adapter, projectSlug, stage, 2, "preparation", claimOnly.storageContext,
      );
      assert.equal(result.status, "invalid");
      if (result.status === "invalid") assert.equal(result.boundary, "attempt-lineage-missing");
    });
  } finally { await fs.rm(claimOnly.root, { recursive: true, force: true }); }

  // --- 4) The mirror case: trailing record with an attempt but no claim.
  const attemptOnly = await setup("attempt-only");
  try {
    await writeRealAttempt(attemptOnly, 1);
    await writeRealAttempt(attemptOnly, 2);
    await writeAttemptOnlyRecord(attemptOnly, 3);

    await scenario("trailing record with an attempt but no claim is not treated as an orphan", async () => {
      const result = await classifyProductionDurableAttemptLineage(
        attemptOnly.adapter, projectSlug, stage, 2, "preparation", attemptOnly.storageContext,
      );
      assert.equal(result.status, "invalid");
      if (result.status === "invalid") assert.equal(result.boundary, "claim-lineage-missing");
    });
  } finally { await fs.rm(attemptOnly.root, { recursive: true, force: true }); }

  // --- 5) The trim never collapses below one record, even in a pathological
  // all-orphan fixture — a defensive floor, not a real-world scenario.
  const allOrphan = await setup("all-orphan");
  try {
    await writeOrphanRecord(allOrphan, 1);
    await writeOrphanRecord(allOrphan, 2);

    await scenario("an all-orphan lineage still fails closed rather than resolving to nothing", async () => {
      const result = await classifyProductionDurableAttemptLineage(
        allOrphan.adapter, projectSlug, stage, 1, "preparation", allOrphan.storageContext,
      );
      assert.equal(result.status, "invalid");
    });
  } finally { await fs.rm(allOrphan.root, { recursive: true, force: true }); }

  assert.ok(scenarios >= 13);
  process.stdout.write(`Durable attempt lineage orphan tolerance smoke: PASS (${scenarios} scenarios)\n`);
  emitSmokeResult("durable-attempt-lineage-orphan-tolerance", scenarios);
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
