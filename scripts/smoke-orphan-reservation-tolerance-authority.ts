import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { emitSmokeResult } from "./lib/SmokeResult";
import { ProductionExecutionFilePersistenceAdapter } from
  "../src/lib/production/ProductionExecutionPersistence";
import {
  buildProductionExecutionAttemptBindingFingerprint,
  buildProductionExecutionAttemptJournalEntryIntegrity,
  buildProductionExecutionDurableAttemptIntegrity,
} from "../src/lib/production/ProductionExecutionDurableAttemptIntegrity";
import {
  buildProductionExecutionIdempotencyIdentity,
  defaultProductionExecutionIdempotencyPolicy,
} from "../src/lib/production/ProductionExecutionIdempotency";
import { buildProductionPipelineExecutionIdentity } from
  "../src/lib/production/ProductionPipelineExecutionIdentity";
import { stableProductionId } from "../src/lib/production/ProductionDeterminism";
import { readProductionExecutionRecoverySemanticAuthority,
  type ProductionOrphanReservationToleranceLookupContext } from
  "../src/lib/production/ProductionExecutionRecoveryBootstrap";
import {
  buildProductionOrphanReservationToleranceAuthorityBody,
  writeProductionOrphanReservationToleranceAuthority,
  reservationContentFingerprint,
  resolveOrphanReservationTolerance,
  findMatchingOrphanReservationToleranceAuthority,
} from "../src/lib/production/ProductionOrphanReservationToleranceAuthority";
import type { ProductionExecutionDurableAttemptRecord } from
  "../src/types/productionExecutionDurableAttempt";
import type { ProductionExecutionDurableClaimRecord } from
  "../src/types/productionExecutionDurableClaim";
import type { ProductionExecutionDurableRecord } from
  "../src/types/productionExecutionDurableStorage";
import type { ProductionExecutionIdempotencyReservationRequest } from
  "../src/types/productionExecutionIdempotency";

/**
 * ProductionOrphanReservationToleranceAuthority smoke suite.
 *
 * Proves the P3-sibling mechanism against a synthetic reproduction of the
 * exact real pattern found in i-stanbul-un-fethi-1453
 * (reservations/idempotency-identity-c1ca1524.json: an "active" reservation
 * with candidates.length===0 -- no linked idempotency record, no claim, no
 * attempt -- permanently blocking readProductionExecutionRecoverySemanticAuthority).
 * Real project data is never read or written by this suite.
 */

const stage = "assembly" as const;
const timestamp0 = "2026-08-20T00:00:00.000Z";

let scenarios = 0;
async function scenario(name: string, action: () => Promise<void> | void): Promise<void> {
  await action();
  scenarios += 1;
  process.stdout.write(`PASS ${scenarios}: ${name}\n`);
}

function freshProjectSlug(): string {
  return `orphan-tolerance-${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

function toleranceAuthorityId(seed: string): string {
  return `orphan-tol-${crypto.createHash("sha256").update(seed).digest("hex").slice(0, 16)}`;
}

// ─────────────────────── identity + reservation construction (mirrors
// scripts/smoke-durable-attempt-lineage-orphan-tolerance.ts's identityFor,
// extended to also return authorization/confirmation so a full
// ProductionExecutionIdempotencyReservationRequest can be built) ───────────

function identityFor(projectSlug: string, ts: string, seed: string) {
  const planned = buildProductionPipelineExecutionIdentity(
    { projectSlug, stage, runType: "resume" },
    { id: `${projectSlug}-${stage}`, attempts: 0 },
  );
  const authorization = {
    schemaVersion: "1" as const, decisionId: `authorization-${seed}`,
    decision: "allow" as const, authorized: true as const, reasonCode: "AUTHORIZED" as const,
    reason: "trusted orphan-tolerance-authority fixture", evaluatedAt: ts,
    requestId: `pipeline-request-${seed}`, idempotencyKey: `pipeline-idempotency-${seed}`,
    executionFingerprint: `pipeline-execution-${seed}`, actorId: "pipeline-system",
    actorType: "system" as const, projectSlug, operation: "pipeline.stage.resume",
    action: "retry-stage", stage,
    requiredCapabilities: [], grantedCapabilities: [], missingCapabilities: [],
    policyVersion: defaultProductionExecutionIdempotencyPolicy.policyVersion,
    risk: "high" as const, requiresConfirmation: true,
    requiredConfirmationLevel: "high" as const, evidence: ["source:test"],
  };
  const confirmation = {
    schemaVersion: "1" as const, decision: "valid" as const, valid: true as const,
    reasonCode: "CONFIRMATION_VALID" as const, reason: "trusted orphan-tolerance-authority fixture",
    evaluatedAt: ts, confirmationId: `confirmation-${seed}`,
    confirmationRequestId: `confirmation-request-${seed}`,
    authorizationDecisionId: authorization.decisionId, requestId: authorization.requestId,
    idempotencyKey: authorization.idempotencyKey, actorId: "pipeline-system",
    projectSlug, operation: "pipeline.stage.resume", action: "retry-stage", stage, riskLevel: "high",
    requiredConfirmationLevel: "high" as const, providedConfirmationLevel: "high" as const,
    bindingMatches: true, bindingFingerprint: `binding-${seed}`,
    expired: false, singleUse: true, consumed: false,
    policyVersion: defaultProductionExecutionIdempotencyPolicy.policyVersion,
    evidence: ["source:test"],
  };
  const result = buildProductionExecutionIdempotencyIdentity({ authorization, confirmation }, {
    evaluatedAt: ts,
    policy: { ...defaultProductionExecutionIdempotencyPolicy, enabled: true,
      maximumAttemptsByAction: {
        ...defaultProductionExecutionIdempotencyPolicy.maximumAttemptsByAction,
        "retry-stage": 10,
      } },
  });
  assert.equal(result.ok, true);
  assert.ok(result.identity);
  return { identity: result.identity!, authorization, confirmation, planned };
}

function buildReservation(
  identityResult: ReturnType<typeof identityFor>, ts: string, attempt: number,
): ProductionExecutionIdempotencyReservationRequest {
  return {
    schemaVersion: "1", identity: identityResult.identity,
    authorization: identityResult.authorization, confirmation: identityResult.confirmation,
    requestedAt: ts, expectedInitialState: "reserved", attempt, maxAttempts: 6,
    reservationTtlSeconds: 31_536_000,
    policyContext: { source: "server", environment: "hosted" }, metadata: { source: "server" },
  };
}

function buildLinkedRecord(
  identityResult: ReturnType<typeof identityFor>, ts: string, attempt: number,
): ProductionExecutionDurableRecord {
  const identity = identityResult.identity;
  return {
    schemaVersion: "1", recordId: identityResult.planned.recordId,
    identityFingerprint: identity.identityFingerprint,
    idempotencyKey: identity.idempotencyKey, requestId: identity.requestId,
    executionFingerprint: identity.executionFingerprint,
    bindingFingerprint: identity.bindingFingerprint, actorId: identity.actorId,
    projectSlug: identity.projectSlug, operation: identity.operation,
    action: identity.action, stage: identity.stage,
    authorizationDecisionId: identity.authorizationDecisionId,
    confirmationRequestId: identity.confirmationRequestId,
    confirmationId: identity.confirmationId, policyVersion: identity.policyVersion,
    riskLevel: identity.riskLevel, state: "cancelled", attempt, maxAttempts: 6,
    createdAt: ts, updatedAt: ts, reservedAt: ts, finishedAt: ts,
    evidence: ["source:test"],
    integrity: { algorithm: "stable-production-id-v1", fingerprint: identity.identityFingerprint,
      version: 1 }, storageVersion: "1", lifecycleState: "cancelled", recordVersion: 1,
  };
}

function journal(attemptId: string, ts: string) {
  const body = {
    entryId: `${attemptId}-opened`, attemptId, sequence: 1,
    entryType: "ATTEMPT_OPENED" as const, recordedAt: ts,
    payload: { code: "ATTEMPT_OPENED", category: "lifecycle", summary: "Attempt opened." },
    evidence: ["attempt:opened"],
  };
  return buildProductionExecutionAttemptJournalEntryIntegrity(body);
}

function buildAttempt(
  identityResult: ReturnType<typeof identityFor>, ts: string,
): ProductionExecutionDurableAttemptRecord {
  const planned = identityResult.planned;
  const identity = {
    attemptId: planned.attemptId, claimId: planned.claimId,
    reservationId: identityResult.identity.identityFingerprint, recordId: planned.recordId,
    requestId: planned.requestId, idempotencyKey: planned.idempotencyKey,
    executionFingerprint: planned.executionFingerprint, workerId: "pipeline-worker",
    workerSessionId: "pipeline-session-v1", leaseId: planned.leaseId,
  };
  return buildProductionExecutionDurableAttemptIntegrity({
    schemaVersion: "1", storageVersion: "1", identity,
    binding: { claimVersion: 1, leaseVersion: 1, reservationVersion: 1,
      bindingFingerprint: buildProductionExecutionAttemptBindingFingerprint(identity) },
    state: "active", attemptVersion: 1, openedAt: ts, updatedAt: ts,
    journal: [journal(planned.attemptId, ts)],
    evidence: ["coordination:single-record", "transactional:false"],
  });
}

function buildClaim(
  identityResult: ReturnType<typeof identityFor>, attempt: ProductionExecutionDurableAttemptRecord, ts: string,
): ProductionExecutionDurableClaimRecord {
  const planned = identityResult.planned;
  const body = {
    schemaVersion: "1" as const, storageVersion: "1" as const,
    identity: {
      claimId: attempt.identity.claimId, recordId: planned.recordId,
      reservationId: identityResult.identity.identityFingerprint, requestId: planned.requestId,
      idempotencyKey: planned.idempotencyKey, operation: identityResult.identity.operation,
      executionFingerprint: planned.executionFingerprint, workerId: attempt.identity.workerId,
      workerSessionId: attempt.identity.workerSessionId, leaseId: attempt.identity.leaseId,
    },
    binding: { reservationVersion: 1, idempotencyVersion: 1,
      leaseVersion: 1, bindingFingerprint: `claim-binding-${planned.recordId}` },
    ownership: { ownerFingerprint: `owner-${planned.recordId}`,
      reservationEvidence: `reservation-${planned.recordId}`,
      idempotencyEvidence: `idempotency-${planned.recordId}`,
      leaseEvidence: `lease-${planned.recordId}` },
    state: "active" as const, claimVersion: 1, acquiredAt: ts,
    updatedAt: ts, evidence: ["fixture:active-claim"],
  };
  return { ...body, integrity: { algorithm: "stable-production-id-v1",
    fingerprint: stableProductionId("durable-claim-integrity", body) } };
}

// ───────────────────────────── fixture ─────────────────────────────

interface Fixture {
  readonly tempRoot: string;
  readonly projectSlug: string;
  readonly adapter: ProductionExecutionFilePersistenceAdapter;
}

async function setup(): Promise<Fixture> {
  const projectSlug = freshProjectSlug();
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "atolye-orphan-tolerance-authority-"));
  const adapter = new ProductionExecutionFilePersistenceAdapter({
    trustedRootDirectory: path.join(tempRoot, "production-execution"),
  });
  // Mirrors the real project's topology: the idempotency/claim/attempt
  // stores already exist (many unrelated records) even though none of them
  // happen to reference THIS specific orphaned reservation. Without this,
  // an empty (never-created) idempotency directory makes
  // deriveStorePolicy's own "required-missing" gate report "indeterminate"
  // instead of "recovery-required" -- a fixture-topology artifact unrelated
  // to the mechanism under test.
  for (const kind of ["idempotency", "claims", "attempts", "reservations"]) {
    fs.mkdirSync(path.join(tempRoot, "production-execution", kind), { recursive: true });
  }
  return { tempRoot, projectSlug, adapter };
}

async function cleanup(fixture: Fixture): Promise<void> {
  await fsp.rm(fixture.tempRoot, { recursive: true, force: true });
}

function toleranceContextFor(fixture: Fixture): ProductionOrphanReservationToleranceLookupContext {
  return {
    projectSlug: fixture.projectSlug, stage,
    jobId: `${fixture.projectSlug}-${stage}`,
    runtimeInput: { workspaceRoot: fixture.tempRoot,
      environment: { ATOLYE_RUNTIME_ROOT: path.join(fixture.tempRoot, "data") } },
  };
}

async function writeAuthority(
  fixture: Fixture, identityResult: ReturnType<typeof identityFor>,
  reservation: ProductionExecutionIdempotencyReservationRequest, attempt: number,
) {
  const body = buildProductionOrphanReservationToleranceAuthorityBody({
    schemaVersion: "1", policyVersion: "orphan-reservation-tolerance-v1",
    authorityId: toleranceAuthorityId(identityResult.identity.identityFingerprint),
    issuedAt: timestamp0, projectSlug: fixture.projectSlug, stage,
    jobId: `${fixture.projectSlug}-${stage}`,
    reservationId: identityResult.identity.identityFingerprint,
    operation: identityResult.identity.operation, attempt,
    reason: "synthetic orphan reservation fixture",
    reservationContentFingerprint: reservationContentFingerprint(reservation),
  });
  const context = toleranceContextFor(fixture);
  return writeProductionOrphanReservationToleranceAuthority(fixture.projectSlug, body, context.runtimeInput);
}

async function main() {
  // ═══════════ 1) Real orphan pattern → tolerance authority works, semantic authority becomes ready ═══════════
  await scenario("real orphan pattern: no linked record/claim/attempt -> tolerance authority makes semantic authority 'ready'", async () => {
    const fixture = await setup();
    try {
      const idr = identityFor(fixture.projectSlug, timestamp0, "orphan-1");
      const reservation = buildReservation(idr, timestamp0, 4);
      assert.equal((await fixture.adapter.write("reservation", idr.identity.identityFingerprint, reservation)).ok, true);

      const before = await readProductionExecutionRecoverySemanticAuthority(
        fixture.adapter, "2026-08-21T00:00:00.000Z", undefined, toleranceContextFor(fixture));
      assert.equal(before.decision, "recovery-required");
      assert.equal(before.activeReservationCount, 1);

      const written = await writeAuthority(fixture, idr, reservation, 4);
      assert.equal(written.ok, true);
      assert.equal(written.status, "created");

      const after = await readProductionExecutionRecoverySemanticAuthority(
        fixture.adapter, "2026-08-21T00:00:00.000Z", undefined, toleranceContextFor(fixture));
      assert.equal(after.decision, "ready");
      assert.equal(after.activeReservationCount, 0);
    } finally { await cleanup(fixture); }
  });

  // ═══════════ 2) Matching idempotency record exists → tolerance never applies (correctly linked) ═══════════
  await scenario("linked idempotency record present: tolerance resolution never even considered, reservation classified terminal already", async () => {
    const fixture = await setup();
    try {
      const idr = identityFor(fixture.projectSlug, timestamp0, "linked-1");
      const reservation = buildReservation(idr, timestamp0, 1);
      const record = buildLinkedRecord(idr, timestamp0, 1);
      assert.equal((await fixture.adapter.write("reservation", idr.identity.identityFingerprint, reservation)).ok, true);
      assert.equal((await fixture.adapter.write("idempotency", `${idr.planned.recordId}-v1`, record)).ok, true);

      const semantic = await readProductionExecutionRecoverySemanticAuthority(
        fixture.adapter, "2026-08-21T00:00:00.000Z", undefined, toleranceContextFor(fixture));
      assert.equal(semantic.decision, "ready");
      assert.equal(semantic.activeReservationCount, 0);

      const tolerated = await resolveOrphanReservationTolerance(fixture.adapter, reservation, toleranceContextFor(fixture));
      assert.equal(tolerated, false, "no authority exists, and none is needed -- already linked/terminal");
    } finally { await cleanup(fixture); }
  });

  // ═══════════ 3) Active claim referencing the reservation → reject ═══════════
  await scenario("active claim references the reservation: tolerance refused even with a matching authority", async () => {
    const fixture = await setup();
    try {
      const idr = identityFor(fixture.projectSlug, timestamp0, "activeclaim-1");
      const reservation = buildReservation(idr, timestamp0, 4);
      const attempt = buildAttempt(idr, timestamp0);
      const claim = buildClaim(idr, attempt, timestamp0);
      assert.equal((await fixture.adapter.write("reservation", idr.identity.identityFingerprint, reservation)).ok, true);
      assert.equal((await fixture.adapter.write("claim", `${claim.identity.claimId}-v1`, claim)).ok, true);
      // Deliberately NO idempotency record and NO attempt written -- isolates
      // the claim-existence check specifically.

      const written = await writeAuthority(fixture, idr, reservation, 4);
      assert.equal(written.ok, true);

      const tolerated = await resolveOrphanReservationTolerance(fixture.adapter, reservation, toleranceContextFor(fixture));
      assert.equal(tolerated, false, "an active claim referencing this reservation must block tolerance");

      const semantic = await readProductionExecutionRecoverySemanticAuthority(
        fixture.adapter, "2026-08-21T00:00:00.000Z", undefined, toleranceContextFor(fixture));
      assert.equal(semantic.decision, "recovery-required");
    } finally { await cleanup(fixture); }
  });

  // ═══════════ 4) Active attempt/execution referencing the reservation → reject ═══════════
  await scenario("active attempt references the reservation: tolerance refused even with a matching authority", async () => {
    const fixture = await setup();
    try {
      const idr = identityFor(fixture.projectSlug, timestamp0, "activeattempt-1");
      const reservation = buildReservation(idr, timestamp0, 4);
      const attempt = buildAttempt(idr, timestamp0);
      assert.equal((await fixture.adapter.write("reservation", idr.identity.identityFingerprint, reservation)).ok, true);
      assert.equal((await fixture.adapter.write("attempt", `${attempt.identity.attemptId}-v1`, attempt)).ok, true);

      const written = await writeAuthority(fixture, idr, reservation, 4);
      assert.equal(written.ok, true);

      const tolerated = await resolveOrphanReservationTolerance(fixture.adapter, reservation, toleranceContextFor(fixture));
      assert.equal(tolerated, false, "an active attempt referencing this reservation must block tolerance");
    } finally { await cleanup(fixture); }
  });

  // ═══════════ 5) Reservation content fingerprint mismatch (CAS) → reject, zero writes ═══════════
  await scenario("reservation content drifted from what the authority pinned: CAS rejects, zero writes", async () => {
    const fixture = await setup();
    try {
      const idr = identityFor(fixture.projectSlug, timestamp0, "castmismatch-1");
      const reservationAtAuthorityTime = buildReservation(idr, timestamp0, 4);
      assert.equal((await fixture.adapter.write("reservation", idr.identity.identityFingerprint, reservationAtAuthorityTime)).ok, true);
      const written = await writeAuthority(fixture, idr, reservationAtAuthorityTime, 4);
      assert.equal(written.ok, true);

      // A DIFFERENT reservation body (different attempt) presented at
      // resolution time -- simulates the authority no longer matching the
      // real on-disk content precisely (defensive; the store is otherwise
      // immutable, so this proves the CAS guard exists and works).
      const driftedReservation = buildReservation(idr, timestamp0, 5);
      const tolerated = await resolveOrphanReservationTolerance(fixture.adapter, driftedReservation, toleranceContextFor(fixture));
      assert.equal(tolerated, false);
    } finally { await cleanup(fixture); }
  });

  // ═══════════ 6) Idempotency record appears between authority creation and consumption → reject ═══════════
  await scenario("idempotency record appears after authority creation: second check at resolution time refuses", async () => {
    const fixture = await setup();
    try {
      const idr = identityFor(fixture.projectSlug, timestamp0, "raceappears-1");
      const reservation = buildReservation(idr, timestamp0, 4);
      assert.equal((await fixture.adapter.write("reservation", idr.identity.identityFingerprint, reservation)).ok, true);
      const written = await writeAuthority(fixture, idr, reservation, 4);
      assert.equal(written.ok, true);

      // Concurrently, a real idempotency record shows up for this exact
      // identityFingerprint (e.g. a delayed retry of the original
      // createRecord() call finally lands).
      const record = buildLinkedRecord(idr, timestamp0, 4);
      const recordWrite = await fixture.adapter.write("idempotency", `${idr.planned.recordId}-v1`, record);
      assert.equal(recordWrite.ok, true);

      // loadReservationAuthority's OWN candidates.length===0 gate (computed
      // fresh from the idempotency map on every evaluation) now finds a
      // linked record and never even calls resolveOrphanReservationTolerance
      // -- proving the authority cannot resurrect a now-answered orphan.
      const semantic = await readProductionExecutionRecoverySemanticAuthority(
        fixture.adapter, "2026-08-21T00:00:00.000Z", undefined, toleranceContextFor(fixture));
      assert.equal(semantic.decision, "ready");
      assert.equal(semantic.activeReservationCount, 0);
    } finally { await cleanup(fixture); }
  });

  // ═══════════ 7) Replay: creating the same authority twice is a safe no-op ═══════════
  await scenario("replay: writing the identical authority twice is a safe, write-free no-op", async () => {
    const fixture = await setup();
    try {
      const idr = identityFor(fixture.projectSlug, timestamp0, "replay-1");
      const reservation = buildReservation(idr, timestamp0, 4);
      assert.equal((await fixture.adapter.write("reservation", idr.identity.identityFingerprint, reservation)).ok, true);

      const first = await writeAuthority(fixture, idr, reservation, 4);
      assert.equal(first.ok, true);
      assert.equal(first.status, "created");
      assert.equal(first.writeFree, false);

      const second = await writeAuthority(fixture, idr, reservation, 4);
      assert.equal(second.ok, true);
      assert.equal(second.status, "replayed");
      assert.equal(second.writeFree, true);
    } finally { await cleanup(fixture); }
  });

  // ═══════════ 8) Wrong project/job/stage tuple → isolation preserved ═══════════
  await scenario("wrong project/stage tuple in the authority: isolation preserved, tolerance refused", async () => {
    const fixture = await setup();
    try {
      const idr = identityFor(fixture.projectSlug, timestamp0, "wrongtuple-1");
      const reservation = buildReservation(idr, timestamp0, 4);
      assert.equal((await fixture.adapter.write("reservation", idr.identity.identityFingerprint, reservation)).ok, true);

      // Authority created for a DIFFERENT project.
      const body = buildProductionOrphanReservationToleranceAuthorityBody({
        schemaVersion: "1", policyVersion: "orphan-reservation-tolerance-v1",
        authorityId: toleranceAuthorityId(idr.identity.identityFingerprint),
        issuedAt: timestamp0, projectSlug: "a-completely-different-project", stage,
        jobId: `a-completely-different-project-${stage}`,
        reservationId: idr.identity.identityFingerprint,
        operation: idr.identity.operation, attempt: 4,
        reason: "wrong-tuple fixture",
        reservationContentFingerprint: reservationContentFingerprint(reservation),
      });
      const context = toleranceContextFor(fixture);
      // Write it into THIS fixture's own store directly (bypassing the
      // per-project directory helper's natural isolation) purely to prove
      // the LOOKUP itself, not just the directory, enforces isolation.
      const wrongProjectWrite = writeProductionOrphanReservationToleranceAuthority(
        fixture.projectSlug, body, context.runtimeInput);
      assert.equal(wrongProjectWrite.ok, true);

      const match = findMatchingOrphanReservationToleranceAuthority(
        fixture.projectSlug, stage, `${fixture.projectSlug}-${stage}`,
        idr.identity.identityFingerprint, idr.identity.operation, 4, context.runtimeInput);
      assert.equal(match, undefined, "authority body's own projectSlug mismatch must refuse the match");

      const tolerated = await resolveOrphanReservationTolerance(fixture.adapter, reservation, context);
      assert.equal(tolerated, false);
    } finally { await cleanup(fixture); }
  });

  // ═══════════ 9) Normal, linked, terminal reservation → completely unaffected ═══════════
  await scenario("ordinary linked-and-terminal reservation: behavior is bit-for-bit identical whether toleranceContext is passed or not", async () => {
    const fixture = await setup();
    try {
      const idr = identityFor(fixture.projectSlug, timestamp0, "ordinary-1");
      const reservation = buildReservation(idr, timestamp0, 1);
      const record = buildLinkedRecord(idr, timestamp0, 1);
      assert.equal((await fixture.adapter.write("reservation", idr.identity.identityFingerprint, reservation)).ok, true);
      assert.equal((await fixture.adapter.write("idempotency", `${idr.planned.recordId}-v1`, record)).ok, true);

      const withTolerance = await readProductionExecutionRecoverySemanticAuthority(
        fixture.adapter, "2026-08-21T00:00:00.000Z", undefined, toleranceContextFor(fixture));
      const withoutTolerance = await readProductionExecutionRecoverySemanticAuthority(
        fixture.adapter, "2026-08-21T00:00:00.000Z");
      assert.deepEqual(withTolerance, withoutTolerance);
      assert.equal(withTolerance.decision, "ready");
    } finally { await cleanup(fixture); }
  });

  // ═══════════ 10) Tolerance sufficiency: after granting, semantic authority is 'ready' (repeat, explicit) ═══════════
  await scenario("after a valid tolerance authority exists, readProductionExecutionRecoverySemanticAuthority reports ready deterministically across repeated calls", async () => {
    const fixture = await setup();
    try {
      const idr = identityFor(fixture.projectSlug, timestamp0, "readycheck-1");
      const reservation = buildReservation(idr, timestamp0, 4);
      assert.equal((await fixture.adapter.write("reservation", idr.identity.identityFingerprint, reservation)).ok, true);
      assert.equal((await writeAuthority(fixture, idr, reservation, 4)).ok, true);

      for (let i = 0; i < 3; i += 1) {
        const semantic = await readProductionExecutionRecoverySemanticAuthority(
          fixture.adapter, "2026-08-21T00:00:00.000Z", undefined, toleranceContextFor(fixture));
        assert.equal(semantic.decision, "ready");
      }
    } finally { await cleanup(fixture); }
  });

  // ═══════════ 11) No toleranceContext passed at all: legacy behavior fully preserved ═══════════
  await scenario("no toleranceContext argument at all (legacy call shape): orphan stays 'active', matches pre-mechanism behavior exactly", async () => {
    const fixture = await setup();
    try {
      const idr = identityFor(fixture.projectSlug, timestamp0, "legacy-1");
      const reservation = buildReservation(idr, timestamp0, 4);
      assert.equal((await fixture.adapter.write("reservation", idr.identity.identityFingerprint, reservation)).ok, true);
      assert.equal((await writeAuthority(fixture, idr, reservation, 4)).ok, true);

      // Legacy 2-arg call (no toleranceContext) -- must behave exactly as
      // if ProductionOrphanReservationToleranceAuthority.ts never existed,
      // regardless of any authority present on disk.
      const semantic = await readProductionExecutionRecoverySemanticAuthority(
        fixture.adapter, "2026-08-21T00:00:00.000Z");
      assert.equal(semantic.decision, "recovery-required");
      assert.equal(semantic.activeReservationCount, 1);
    } finally { await cleanup(fixture); }
  });

  assert.ok(scenarios >= 11);
  process.stdout.write(`Orphan reservation tolerance authority smoke: PASS (${scenarios} scenarios)\n`);
  emitSmokeResult("orphan-reservation-tolerance-authority", scenarios);
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
