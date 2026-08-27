import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ProductionExecutionFilePersistenceAdapter } from
  "../src/lib/production/ProductionExecutionPersistence";
import { validateProductionGlobalTerminalQuiescence } from
  "../src/lib/production/ProductionGlobalTerminalQuiescence";
import {
  buildProductionExecutionIdempotencyIdentity,
  defaultProductionExecutionIdempotencyPolicy,
} from "../src/lib/production/ProductionExecutionIdempotency";
import {
  buildProductionOrphanReservationToleranceAuthorityBody,
  reservationContentFingerprint,
  writeProductionOrphanReservationToleranceAuthority,
} from "../src/lib/production/ProductionOrphanReservationToleranceAuthority";
import type { ProductionExecutionAuthorizationResult } from "../src/types/productionExecutionAuthorization";
import type { ProductionExecutionConfirmationValidationResult } from "../src/types/productionExecutionConfirmation";
import type {
  ProductionExecutionIdempotencyReservationRequest,
  ProductionExecutionIdempotencyState,
} from "../src/types/productionExecutionIdempotency";
import type { ProductionExecutionDurableRecord } from "../src/types/productionExecutionDurableStorage";
import type { ProductionStepKey } from "../src/types/project";

/**
 * Covers the c1ca1524 quiescence-tolerance remediation:
 * `ProductionGlobalTerminalQuiescence.ts`'s new `toleranceRuntimeInput` parameter.
 *
 * Runs entirely against a temp `production-execution/` directory built from
 * scratch (never a copy of, or pointer to, the real project) via
 * `ProductionExecutionFilePersistenceAdapter`. No `prepareProductionPipelineExecution`
 * call, no worker execution, no real stage generation of any kind — every
 * reservation/idempotency/claim/attempt record here is a hand-built, schema-valid
 * fixture.
 */

const projectSlug = "smoke-quiescence-tolerance-project";
let passed = 0;
function pass(label: string) {
  passed += 1;
  console.log(`PASS ${passed}: ${label}`);
}

/**
 * Lays out a temp tree matching the real, conventional
 * `<workspaceRoot>/data/projects/<slug>/production-execution/` shape, so
 * `writeProductionOrphanReservationToleranceAuthority`'s own `getProjectRoot()`
 * resolution (workspaceRoot + ATOLYE_RUNTIME_ROOT) and the durable-storage
 * adapter agree on the exact same directory -- both point at the tolerance
 * files and the reservation/idempotency/claim/attempt records this test writes.
 */
function withTempAdapter<T>(action: (
  adapter: ProductionExecutionFilePersistenceAdapter,
  toleranceInput: { workspaceRoot: string; environment: { ATOLYE_RUNTIME_ROOT: string } },
) => Promise<T>): Promise<T> {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "atolye-smoke-quiescence-tolerance-"));
  const runtimeRoot = path.join(workspaceRoot, "data");
  const executionRoot = path.join(runtimeRoot, "projects", projectSlug, "production-execution");
  fs.mkdirSync(executionRoot, { recursive: true });
  const adapter = new ProductionExecutionFilePersistenceAdapter({ trustedRootDirectory: executionRoot });
  const toleranceInput = { workspaceRoot, environment: { ATOLYE_RUNTIME_ROOT: runtimeRoot } };
  return action(adapter, toleranceInput).finally(() => fs.rmSync(workspaceRoot, { recursive: true, force: true }));
}

/**
 * Builds a real, schema-valid reservation for (stage, attempt) via the same
 * `buildProductionExecutionIdempotencyIdentity` the production code path uses --
 * guaranteeing `validateProductionExecutionPersistencePayload("reservation", ...)`
 * accepts it, without needing `prepareProductionPipelineExecution`'s full
 * authorization-action derivation.
 */
function buildReservation(input: {
  stage: ProductionStepKey;
  attempt: number;
  action: string;
  seed: string;
  evaluatedAt: string;
}): ProductionExecutionIdempotencyReservationRequest {
  const { stage, attempt, action, seed, evaluatedAt } = input;
  const maxAttempts = Math.max(6, attempt);
  const authorization: ProductionExecutionAuthorizationResult = {
    schemaVersion: "1", decisionId: `pipeline-authorization-${seed}`, decision: "allow",
    authorized: true, reasonCode: "AUTHORIZED", reason: "smoke fixture", evaluatedAt,
    requestId: `pipeline-request-${seed}`, idempotencyKey: `pipeline-idempotency-${seed}`,
    executionFingerprint: `pipeline-execution-${seed}`, actorId: "pipeline-system",
    actorType: "system", projectSlug, operation: "pipeline.stage.resume", action, stage,
    requiredCapabilities: [], grantedCapabilities: [], missingCapabilities: [],
    policyVersion: "pipeline-durable-v1", risk: "high", requiresConfirmation: true,
    requiredConfirmationLevel: "high", evidence: ["source:smoke-fixture"],
  };
  const confirmation: ProductionExecutionConfirmationValidationResult = {
    schemaVersion: "1", decision: "valid", valid: true, reasonCode: "CONFIRMATION_VALID",
    reason: "smoke fixture", evaluatedAt, confirmationId: `pipeline-confirmation-${seed}`,
    confirmationRequestId: `pipeline-confirmation-request-${seed}`,
    authorizationDecisionId: `pipeline-authorization-${seed}`,
    requestId: `pipeline-request-${seed}`, idempotencyKey: `pipeline-idempotency-${seed}`,
    actorId: "pipeline-system", projectSlug, operation: "pipeline.stage.resume", action, stage,
    riskLevel: "high", requiredConfirmationLevel: "high", providedConfirmationLevel: "high",
    bindingMatches: true, bindingFingerprint: `pipeline-confirmation-binding-${seed}`,
    expired: false, singleUse: true, consumed: false, policyVersion: "pipeline-durable-v1",
    evidence: ["source:smoke-fixture"],
  };
  const policy = {
    ...defaultProductionExecutionIdempotencyPolicy,
    enabled: true,
    policyVersion: "production-execution-idempotency-v1",
    reservationTtlSeconds: 31_536_000,
    maximumAttemptsByAction: {
      ...defaultProductionExecutionIdempotencyPolicy.maximumAttemptsByAction, [action]: maxAttempts,
    },
  };
  const built = buildProductionExecutionIdempotencyIdentity({ authorization, confirmation }, { evaluatedAt, policy });
  assert.equal(built.ok, true, `identity build failed: ${JSON.stringify(built)}`);
  return {
    schemaVersion: "1", identity: built.identity!, authorization, confirmation,
    requestedAt: evaluatedAt, expectedInitialState: "reserved", attempt, maxAttempts,
    reservationTtlSeconds: 31_536_000,
    policyContext: { source: "server", environment: "hosted" },
    metadata: { source: "server" },
  };
}

/**
 * Builds one version of a schema-valid idempotency record bound to
 * `reservation` -- reusing its already-consistent identity fields (exactly
 * as `prepareProductionPipelineExecution` itself copies them from the same
 * `idempotencyIdentity` when constructing a record), with an arbitrary but
 * self-consistent `recordId` (Kayıt B/A remediation's own `recordId` ↔
 * claim/attempt derivation never requires `recordId` to match the
 * reservation's `identityFingerprint` -- confirmed via
 * `identityFromRecord`/`idempotencyRecordValid` not comparing `recordId` at
 * all). No claim/attempt files are ever created by this helper -- that
 * absence is exactly what these scenarios are testing.
 */
function buildIdempotencyRecordVersion(input: {
  reservation: ProductionExecutionIdempotencyReservationRequest;
  recordId: string;
  state: ProductionExecutionIdempotencyState;
  recordVersion: number;
  updatedAt: string;
}): ProductionExecutionDurableRecord {
  const { reservation, recordId, state, recordVersion, updatedAt } = input;
  const identity = reservation.identity;
  return {
    schemaVersion: "1", storageVersion: "1", recordId, recordVersion,
    identityFingerprint: identity.identityFingerprint,
    idempotencyKey: identity.idempotencyKey, requestId: identity.requestId,
    executionFingerprint: identity.executionFingerprint,
    bindingFingerprint: identity.bindingFingerprint, actorId: identity.actorId,
    projectSlug: identity.projectSlug, operation: identity.operation,
    action: identity.action, stage: identity.stage,
    authorizationDecisionId: identity.authorizationDecisionId,
    confirmationRequestId: identity.confirmationRequestId,
    confirmationId: identity.confirmationId, policyVersion: identity.policyVersion,
    riskLevel: identity.riskLevel, lifecycleState: state, state,
    attempt: reservation.attempt, maxAttempts: reservation.maxAttempts,
    createdAt: identity.createdAt, updatedAt, reservedAt: identity.createdAt,
    evidence: ["source:smoke-fixture"],
    integrity: {
      algorithm: "stable-production-id-v1", fingerprint: identity.identityFingerprint,
      version: recordVersion,
    },
  };
}

async function run() {
  // 1. Orphan reservation with NO matching tolerance authority -> false (fail-closed,
  //    the exact pre-existing default behaviour, unchanged by this remediation).
  await withTempAdapter(async (adapter, toleranceInput) => {
    const reservation = buildReservation({
      stage: "assembly", attempt: 4, action: "regenerate-stage",
      seed: "orphan1", evaluatedAt: "2026-08-21T22:49:32.026Z",
    });
    const write = await adapter.write("reservation", reservation.identity.identityFingerprint, reservation);
    assert.equal(write.ok, true, JSON.stringify(write));
    const result = await validateProductionGlobalTerminalQuiescence(adapter, projectSlug, undefined, toleranceInput);
    assert.equal(result, false);
    // Also confirm omitting the 4th argument behaves identically (the other 3 call
    // sites that never pass it stay exactly as before).
    const resultDefault = await validateProductionGlobalTerminalQuiescence(adapter, projectSlug);
    assert.equal(resultDefault, false);
  });
  pass("orphan reservation with no tolerance authority is refused with toleranceRuntimeInput provided or omitted (fail-closed unchanged)");

  // 2. Orphan reservation WITH a valid, matching, CAS-pinned tolerance authority ->
  //    true only when toleranceRuntimeInput is explicitly passed; false when omitted
  //    (proving the parameter is genuinely opt-in, not a global behavior change).
  await withTempAdapter(async (adapter, toleranceInput) => {
    const reservation = buildReservation({
      stage: "assembly", attempt: 4, action: "regenerate-stage",
      seed: "orphan2", evaluatedAt: "2026-08-21T22:49:32.026Z",
    });
    const write = await adapter.write("reservation", reservation.identity.identityFingerprint, reservation);
    assert.equal(write.ok, true, JSON.stringify(write));
    const jobId = `${projectSlug}-assembly`;
    const body = buildProductionOrphanReservationToleranceAuthorityBody({
      schemaVersion: "1", policyVersion: "orphan-reservation-tolerance-v1",
      authorityId: `orphan-tol-${reservation.identity.identityFingerprint.slice("idempotency-identity-".length)}-${projectSlug}`,
      issuedAt: "2026-08-23T00:00:00.000Z", projectSlug, stage: "assembly", jobId,
      reservationId: reservation.identity.identityFingerprint, operation: "pipeline.stage.resume",
      attempt: 4, reason: "smoke fixture: matches the real c1ca1524 crash-window shape",
      reservationContentFingerprint: reservationContentFingerprint(reservation),
    });
    const written = writeProductionOrphanReservationToleranceAuthority(projectSlug, body, toleranceInput);
    assert.equal(written.ok, true, JSON.stringify(written));
    const result = await validateProductionGlobalTerminalQuiescence(adapter, projectSlug, undefined, toleranceInput);
    assert.equal(result, true);
    const resultDefault = await validateProductionGlobalTerminalQuiescence(adapter, projectSlug);
    assert.equal(resultDefault, false, "toleranceRuntimeInput must be opt-in, not a global behavior change");
  });
  pass("orphan reservation with a valid matching tolerance authority resolves true only when toleranceRuntimeInput is provided");

  // 3. CAS mismatch: tolerance authority exists but reservation content fingerprint
  //    no longer matches (e.g. reservation content drifted) -> false.
  await withTempAdapter(async (adapter, toleranceInput) => {
    const reservation = buildReservation({
      stage: "assembly", attempt: 4, action: "regenerate-stage",
      seed: "orphan3", evaluatedAt: "2026-08-21T22:49:32.026Z",
    });
    const write = await adapter.write("reservation", reservation.identity.identityFingerprint, reservation);
    assert.equal(write.ok, true, JSON.stringify(write));
    const jobId = `${projectSlug}-assembly`;
    const body = buildProductionOrphanReservationToleranceAuthorityBody({
      schemaVersion: "1", policyVersion: "orphan-reservation-tolerance-v1",
      authorityId: `orphan-tol-${reservation.identity.identityFingerprint.slice("idempotency-identity-".length)}-${projectSlug}`,
      issuedAt: "2026-08-23T00:00:00.000Z", projectSlug, stage: "assembly", jobId,
      reservationId: reservation.identity.identityFingerprint, operation: "pipeline.stage.resume",
      attempt: 4, reason: "smoke fixture: deliberately stale CAS pin",
      reservationContentFingerprint: "stale-fingerprint-does-not-match",
    });
    const written = writeProductionOrphanReservationToleranceAuthority(projectSlug, body, toleranceInput);
    assert.equal(written.ok, true, JSON.stringify(written));
    const result = await validateProductionGlobalTerminalQuiescence(adapter, projectSlug, undefined, toleranceInput);
    assert.equal(result, false);
  });
  pass("tolerance authority with a stale/mismatched CAS content fingerprint is refused");

  // 4. Tolerance authority attribute mismatch (wrong attempt number) -> refused,
  //    same as "no matching authority" (findMatchingOrphanReservationToleranceAuthority
  //    requires an exact tuple match).
  await withTempAdapter(async (adapter, toleranceInput) => {
    const reservation = buildReservation({
      stage: "assembly", attempt: 4, action: "regenerate-stage",
      seed: "orphan4", evaluatedAt: "2026-08-21T22:49:32.026Z",
    });
    const write = await adapter.write("reservation", reservation.identity.identityFingerprint, reservation);
    assert.equal(write.ok, true, JSON.stringify(write));
    const jobId = `${projectSlug}-assembly`;
    const body = buildProductionOrphanReservationToleranceAuthorityBody({
      schemaVersion: "1", policyVersion: "orphan-reservation-tolerance-v1",
      authorityId: `orphan-tol-${reservation.identity.identityFingerprint.slice("idempotency-identity-".length)}-${projectSlug}`,
      issuedAt: "2026-08-23T00:00:00.000Z", projectSlug, stage: "assembly", jobId,
      reservationId: reservation.identity.identityFingerprint, operation: "pipeline.stage.resume",
      attempt: 5, // mismatched attempt number vs. reservation's actual attempt=4
      reason: "smoke fixture: deliberately wrong attempt binding",
      reservationContentFingerprint: reservationContentFingerprint(reservation),
    });
    const written = writeProductionOrphanReservationToleranceAuthority(projectSlug, body, toleranceInput);
    assert.equal(written.ok, true, JSON.stringify(written));
    const result = await validateProductionGlobalTerminalQuiescence(adapter, projectSlug, undefined, toleranceInput);
    assert.equal(result, false);
  });
  pass("tolerance authority with a mismatched attempt/stage/jobId tuple is refused (exact-tuple match required)");

  // Kayıt B (pipeline-record-ca987045.../idempotency-identity-40b371b3, assembly
  // attempt 7) remediation: a reservation WITH an idempotency record that failed
  // verifyTerminalLineageVersioned (because no claim/attempt exist at all) gets a
  // second, narrow chance -- but only when the record's own state history proves
  // it never actually ran.
  async function withCancelledOrphanRecord(
    seed: string,
    finalState: string,
    historyStates: ProductionExecutionIdempotencyState[],
  ) {
    return withTempAdapter(async (adapter, toleranceInput) => {
      const reservation = buildReservation({
        stage: "assembly", attempt: 7, action: "regenerate-stage",
        seed, evaluatedAt: "2026-08-21T22:49:32.026Z",
      });
      const resWrite = await adapter.write(
        "reservation", reservation.identity.identityFingerprint, reservation);
      assert.equal(resWrite.ok, true, JSON.stringify(resWrite));
      const recordId = `pipeline-record-${seed}`;
      for (const [index, state] of historyStates.entries()) {
        const record = buildIdempotencyRecordVersion({
          reservation, recordId, state, recordVersion: index + 1,
          updatedAt: index === historyStates.length - 1
            ? "2026-08-22T10:12:46.957Z" : "2026-08-21T22:49:32.026Z",
        });
        const write = await adapter.write("idempotency", `${recordId}-v${index + 1}`, record);
        assert.equal(write.ok, true, JSON.stringify(write));
      }
      void finalState;
      const jobId = `${reservation.identity.projectSlug}-assembly`;
      const body = buildProductionOrphanReservationToleranceAuthorityBody({
        schemaVersion: "1", policyVersion: "orphan-reservation-tolerance-v1",
        authorityId: `orphan-tol-${seed}-${reservation.identity.projectSlug}`,
        issuedAt: "2026-08-23T00:00:00.000Z", projectSlug: reservation.identity.projectSlug,
        stage: "assembly", jobId, reservationId: reservation.identity.identityFingerprint,
        operation: "pipeline.stage.resume", attempt: 7,
        reason: "smoke fixture: Kayıt B cancelled-orphan-with-idempotency-record shape",
        reservationContentFingerprint: reservationContentFingerprint(reservation),
      });
      const written = writeProductionOrphanReservationToleranceAuthority(
        reservation.identity.projectSlug, body, toleranceInput);
      assert.equal(written.ok, true, JSON.stringify(written));
      return validateProductionGlobalTerminalQuiescence(
        adapter, reservation.identity.projectSlug, undefined, toleranceInput);
    });
  }

  // 5. cancelled, never ran, no claim/attempt -> true.
  assert.equal(
    await withCancelledOrphanRecord("kbseed5", "cancelled", ["reserved", "reserved", "cancelled"]),
    true);
  pass("Kayıt B: cancelled orphan record with no running-history and no claim/attempt resolves true");

  // 6. succeeded (latest state) -> false, unconditionally.
  assert.equal(
    await withCancelledOrphanRecord("kbseed6", "succeeded",
      ["reserved", "running", "succeeded"]),
    false);
  pass("Kayıt B: succeeded record is never tolerated");

  // 7 & 8 (claim/attempt present -> false) are already exhaustively covered by
  // smoke-sprint-129-35-legacy-global-quiescence.ts's "negative matrix 16/17:
  // orphan claim/attempt is rejected" scenarios (unchanged, still PASS) --
  // duplicating full valid claim/attempt fixtures here would only re-test the
  // same, already-covered code path.

  // 9. CAS mismatch (reservation content fingerprint drift) -> false, verified
  //    directly against the per-record path (not just the sameSet path already
  //    covered above) by giving the tolerance authority a stale fingerprint.
  await withTempAdapter(async (adapter, toleranceInput) => {
    const reservation = buildReservation({
      stage: "assembly", attempt: 7, action: "regenerate-stage",
      seed: "kbseed9", evaluatedAt: "2026-08-21T22:49:32.026Z",
    });
    await adapter.write("reservation", reservation.identity.identityFingerprint, reservation);
    const recordId = "pipeline-record-kbseed9";
    const kbseed9States: ProductionExecutionIdempotencyState[] = ["reserved", "cancelled"];
    for (const [index, state] of kbseed9States.entries()) {
      const record = buildIdempotencyRecordVersion({
        reservation, recordId, state, recordVersion: index + 1,
        updatedAt: "2026-08-22T10:12:46.957Z",
      });
      await adapter.write("idempotency", `${recordId}-v${index + 1}`, record);
    }
    const jobId = `${reservation.identity.projectSlug}-assembly`;
    const body = buildProductionOrphanReservationToleranceAuthorityBody({
      schemaVersion: "1", policyVersion: "orphan-reservation-tolerance-v1",
      authorityId: `orphan-tol-kbseed9-${reservation.identity.projectSlug}`,
      issuedAt: "2026-08-23T00:00:00.000Z", projectSlug: reservation.identity.projectSlug,
      stage: "assembly", jobId, reservationId: reservation.identity.identityFingerprint,
      operation: "pipeline.stage.resume", attempt: 7,
      reason: "smoke fixture: stale CAS pin", reservationContentFingerprint: "stale-does-not-match",
    });
    writeProductionOrphanReservationToleranceAuthority(reservation.identity.projectSlug, body, toleranceInput);
    const result = await validateProductionGlobalTerminalQuiescence(
      adapter, reservation.identity.projectSlug, undefined, toleranceInput);
    assert.equal(result, false);
  });
  pass("Kayıt B: CAS mismatch on the per-record path is refused");

  // 10. cancelled latest state, but "running" appears earlier in version history
  //     -> false (this is the central discriminator the design adds).
  assert.equal(
    await withCancelledOrphanRecord("kbseed10", "cancelled",
      ["reserved", "running", "cancelled"]),
    false);
  pass("Kayıt B: cancelled record whose history includes \"running\" is never tolerated");

  console.log(`\nPASS (${passed} scenarios)`);
}

void run().catch((error) => {
  console.error("SMOKE_FAILED", error);
  process.exitCode = 1;
});
