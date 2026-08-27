import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { emitSmokeResult } from "./lib/SmokeResult";
import {
  buildProductionExecutionIdempotencyIdentity,
  defaultProductionExecutionIdempotencyPolicy,
} from "../src/lib/production/ProductionExecutionIdempotency";
import {
  AdapterBackedProductionExecutionDurableStorage,
  defaultProductionExecutionDurableStoragePolicy,
} from "../src/lib/production/ProductionExecutionDurableStorage";
import { AdapterBackedProductionExecutionDurableLeaseService } from
  "../src/lib/production/ProductionExecutionDurableLease";
import {
  AdapterBackedProductionExecutionClaimService,
  defaultProductionExecutionClaimPolicy,
} from "../src/lib/production/ProductionExecutionDurableClaim";
import {
  AdapterBackedProductionExecutionAttemptService,
  defaultProductionExecutionAttemptPolicy,
} from "../src/lib/production/ProductionExecutionDurableAttempt";
import { ProductionExecutionFilePersistenceAdapter } from
  "../src/lib/production/ProductionExecutionPersistence";
import { reconcileOrphanedReservationWithoutClaim } from
  "../src/lib/production/ProductionPipelineRetryReconciliation";
import type { ProductionExecutionAuthorizationResult } from
  "../src/types/productionExecutionAuthorization";
import type { ProductionExecutionConfirmationValidationResult } from
  "../src/types/productionExecutionConfirmation";
import type {
  ProductionExecutionIdempotencyRecord,
  ProductionExecutionIdempotencyReservationRequest,
} from "../src/types/productionExecutionIdempotency";
import type {
  ProductionExecutionPersistenceAdapter,
  ProductionExecutionPersistenceListResult,
  ProductionExecutionPersistenceRecordKind,
} from "../src/types/productionExecutionPersistence";

/**
 * Sprint (attempt-7 orphan recovery) — smoke coverage for
 * `reconcileOrphanedReservationWithoutClaim` (ProductionPipelineRetryReconciliation.ts).
 *
 * Every scenario runs against an isolated temp-directory-backed
 * ProductionExecutionFilePersistenceAdapter (never real project data), following the
 * exact reservation/record/lease fixture pattern already used by
 * smoke-production-execution-durable-claim.ts / smoke-production-execution-durable-attempt.ts.
 */

const t0 = "2026-07-13T01:00:00.000Z";
const t1 = "2026-07-13T01:01:00.000Z";
const t2 = "2026-07-13T01:02:00.000Z";
const t3 = "2026-07-13T01:03:00.000Z";
const t4 = "2026-07-13T01:04:00.000Z";
const operation = "pipeline.stage.resume";

const idPolicy = { ...defaultProductionExecutionIdempotencyPolicy, enabled: true,
  policyVersion: "idempotency-policy-v1", reservationTtlSeconds: 600,
  maximumAttemptsByAction: { "retry-stage": 10, "resume-stage": 10 } };
const storagePolicy = { ...defaultProductionExecutionDurableStoragePolicy, enabled: true,
  reservationTtlSeconds: 600, idempotencyPolicy: idPolicy };
const leasePolicy = { policyVersion: "lease-policy-v1", reservationTtlSeconds: 600,
  minimumLeaseDurationSeconds: 1, maximumLeaseDurationSeconds: 31_536_000,
  maximumRenewalWindowSeconds: 31_536_000 };
const claimPolicy = { ...defaultProductionExecutionClaimPolicy, reservationTtlSeconds: 600 };
const attemptPolicy = { ...defaultProductionExecutionAttemptPolicy, reservationTtlSeconds: 600 };

const auth: ProductionExecutionAuthorizationResult = {
  schemaVersion: "1", decisionId: "authorization-1", decision: "allow", authorized: true,
  reasonCode: "AUTHORIZED", reason: "safe", evaluatedAt: t0, requestId: "request-1",
  idempotencyKey: "execution-1", executionFingerprint: "snapshot-1", actorId: "actor-1",
  actorType: "user", projectSlug: "project-orphan", operation, action: "retry-stage",
  stage: "assembly", requiredCapabilities: [], grantedCapabilities: [], missingCapabilities: [],
  policyVersion: "authorization-policy-v1", risk: "high", requiresConfirmation: true,
  requiredConfirmationLevel: "high", evidence: [],
};
const confirmation: ProductionExecutionConfirmationValidationResult = {
  schemaVersion: "1", decision: "valid", valid: true, reasonCode: "CONFIRMATION_VALID",
  reason: "safe", evaluatedAt: t0, confirmationId: "confirmation-1",
  confirmationRequestId: "confirmation-request-1", authorizationDecisionId: "authorization-1",
  requestId: "request-1", idempotencyKey: "execution-1", actorId: "actor-1",
  projectSlug: "project-orphan", operation, action: "retry-stage", stage: "assembly",
  riskLevel: "high", requiredConfirmationLevel: "high", providedConfirmationLevel: "high",
  bindingMatches: true, bindingFingerprint: "confirmation-binding-1", expired: false,
  singleUse: true, consumed: false, policyVersion: "authorization-policy-v1", evidence: [],
};
const identity = buildProductionExecutionIdempotencyIdentity(
  { authorization: auth, confirmation }, { evaluatedAt: t0, policy: idPolicy },
).identity!;
const worker = { schemaVersion: "1" as const, workerId: "worker-1", workerType: "server" as const,
  operationScope: [operation], identitySource: "trusted-server" as const };
const session = { schemaVersion: "1" as const, workerSessionId: "session-1", workerId: "worker-1",
  startedAt: t0, identitySource: "trusted-server" as const };

function reservation(): ProductionExecutionIdempotencyReservationRequest {
  return {
    schemaVersion: "1", identity, authorization: auth, confirmation, requestedAt: t0,
    expectedInitialState: "reserved", attempt: 7, maxAttempts: 10, reservationTtlSeconds: 600,
    policyContext: { source: "server", environment: "test" }, metadata: { source: "server" },
  };
}
function record(): ProductionExecutionIdempotencyRecord {
  return {
    schemaVersion: "1", recordId: "record-orphan", identityFingerprint: identity.identityFingerprint,
    idempotencyKey: identity.idempotencyKey, requestId: identity.requestId,
    executionFingerprint: identity.executionFingerprint, bindingFingerprint: identity.bindingFingerprint,
    actorId: identity.actorId, projectSlug: identity.projectSlug, operation: identity.operation,
    action: identity.action, stage: identity.stage,
    authorizationDecisionId: identity.authorizationDecisionId,
    confirmationRequestId: identity.confirmationRequestId, confirmationId: identity.confirmationId,
    policyVersion: identity.policyVersion, riskLevel: identity.riskLevel, state: "reserved",
    attempt: 7, maxAttempts: 10, createdAt: t0, updatedAt: t0, reservedAt: t0, evidence: [],
    integrity: { algorithm: "stable-production-id-v1", fingerprint: identity.identityFingerprint, version: 1 },
  };
}

let count = 0;
async function scenario(name: string, fn: () => void | Promise<void>) {
  await fn();
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "atolye-orphan-reservation-"));
  try {
    async function setup(name: string, options: { withLease?: boolean } = { withLease: true }) {
      const directory = path.join(root, name);
      const adapter = new ProductionExecutionFilePersistenceAdapter({
        trustedRootDirectory: directory, trustedAttemptIdFactory: () => "fixed",
      });
      const storage = new AdapterBackedProductionExecutionDurableStorage(adapter);
      const leases = new AdapterBackedProductionExecutionDurableLeaseService(adapter);
      const claims = new AdapterBackedProductionExecutionClaimService(adapter);
      const attempts = new AdapterBackedProductionExecutionAttemptService(adapter);
      await storage.createReservation(reservation(), { evaluatedAt: t1, policy: storagePolicy });
      await storage.createRecord(record(), { evaluatedAt: t1, policy: storagePolicy });
      if (options.withLease !== false) {
        await leases.acquire({
          recordId: "record-orphan", expectedVersion: 1, evaluatedAt: t1, worker, session,
          leaseId: "lease-orphan", acquiredAt: t1, heartbeatAt: t1, expiresAt: t4,
        }, leasePolicy);
      }
      return { directory, adapter, storage, leases, claims, attempts };
    }

    // --- 1) Happy path: reserved + active lease, no claim/attempt -> cancelled, lease released.
    const happy = await setup("happy");
    await scenario("orphan reservation with active lease is recovered to cancelled", async () => {
      const result = await reconcileOrphanedReservationWithoutClaim(happy.adapter, "record-orphan", () => t2);
      assert.equal(result.ok, true);
      assert.equal(result.reasonCode, "ORPHAN_RESERVATION_RECONCILED");
      assert.equal(result.writeFree, false);
      assert.equal(result.record?.state, "cancelled");
      const fresh = await happy.storage.read("record-orphan");
      assert.equal(fresh.record?.state, "cancelled");
      assert.equal(fresh.record?.durableLease?.status, "released");
    });

    // --- 2) Idempotent double invocation: second call is a replay-safe no-op.
    await scenario("second invocation after recovery is a replay-safe no-op", async () => {
      const before = await happy.storage.read("record-orphan");
      const result = await reconcileOrphanedReservationWithoutClaim(happy.adapter, "record-orphan", () => t3);
      assert.equal(result.ok, true);
      assert.equal(result.reasonCode, "ORPHAN_RESERVATION_RECONCILIATION_REPLAYED");
      assert.equal(result.writeFree, true);
      const after = await happy.storage.read("record-orphan");
      assert.equal(after.record?.recordVersion, before.record?.recordVersion, "no new version written on replay");
    });

    // --- 3) No lease at all (record created but lease never acquired) -> still cancels cleanly.
    const noLease = await setup("no-lease", { withLease: false });
    await scenario("orphan reservation with no lease at all is still recovered", async () => {
      const result = await reconcileOrphanedReservationWithoutClaim(noLease.adapter, "record-orphan", () => t2);
      assert.equal(result.ok, true);
      assert.equal(result.reasonCode, "ORPHAN_RESERVATION_RECONCILED");
      assert.equal(result.record?.state, "cancelled");
    });

    // --- 4) Lease already released (simulating a resumed partial prior run) -> skip lease step, still cancel.
    const partiallyDone = await setup("partial");
    await scenario("lease already released from a prior partial run is not re-released, record still cancels", async () => {
      await partiallyDone.leases.release({
        recordId: "record-orphan", expectedVersion: 2, evaluatedAt: t2, releasedAt: t2,
        worker, session, leaseId: "lease-orphan",
      }, leasePolicy);
      const result = await reconcileOrphanedReservationWithoutClaim(partiallyDone.adapter, "record-orphan", () => t3);
      assert.equal(result.ok, true);
      assert.equal(result.reasonCode, "ORPHAN_RESERVATION_RECONCILED");
      assert.equal(result.record?.state, "cancelled");
      assert.equal(result.record?.durableLease?.status, "released");
    });

    // A genuine claim request matching the fixture's reservation/record/lease exactly
    // (mirrors smoke-production-execution-durable-claim.ts's claim() helper).
    function claimRequest() {
      return {
        claimId: "claim-orphan", recordId: "record-orphan", reservationId: identity.identityFingerprint,
        requestId: "request-1", idempotencyKey: "execution-1", executionFingerprint: "snapshot-1",
        workerId: "worker-1", workerSessionId: "session-1", leaseId: "lease-orphan",
        expectedReservationVersion: 1, expectedIdempotencyVersion: 2, expectedLeaseVersion: 1,
        expectedClaimVersion: 0, evaluatedAt: t2,
      };
    }

    // --- 5) A claim exists for this record -> refuse, defer to existing claim-aware recovery
    // (abandonExecutionClaim / reconcileFailedPipelineExecution), never silently overridden.
    const withClaim = await setup("with-claim");
    await scenario("existing claim for the record is refused, not silently overridden", async () => {
      const acquired = await withClaim.claims.acquireExecutionClaim(claimRequest(), claimPolicy);
      assert.equal(acquired.ok, true, "fixture claim must acquire cleanly");
      const result = await reconcileOrphanedReservationWithoutClaim(withClaim.adapter, "record-orphan", () => t3);
      assert.equal(result.ok, false);
      assert.equal(result.reasonCode, "ORPHAN_RESERVATION_CLAIM_EXISTS");
      assert.equal(result.writeFree, true);
      const fresh = await withClaim.storage.read("record-orphan");
      assert.equal(fresh.record?.state, "reserved", "record must be untouched when a claim exists");
    });

    // --- 6) An attempt existing is refused independently of the claim-scan step. A real attempt
    // can never exist without a claim (openExecutionAttempt requires a linked, active claim), so
    // this scenario acquires both genuinely, then masks listKeys("claim") to isolate and prove the
    // attempt-existence check on its own — the claim-scan step alone is not the only thing standing
    // between an in-progress attempt and this function silently cancelling it.
    const withAttempt = await setup("with-attempt");
    await scenario("existing attempt for the record is refused (checked independently of the claim scan)", async () => {
      const acquired = await withAttempt.claims.acquireExecutionClaim(claimRequest(), claimPolicy);
      assert.equal(acquired.ok, true, "fixture claim must acquire cleanly");
      const opened = await withAttempt.attempts.openExecutionAttempt({
        attemptId: "attempt-orphan", claimId: "claim-orphan", recordId: "record-orphan",
        reservationId: identity.identityFingerprint, requestId: "request-1", idempotencyKey: "execution-1",
        executionFingerprint: "snapshot-1", workerId: "worker-1", workerSessionId: "session-1",
        leaseId: "lease-orphan", expectedClaimVersion: 1, expectedAttemptVersion: 0, evaluatedAt: t3,
      }, attemptPolicy);
      assert.equal(opened.ok, true, "fixture attempt must open cleanly");
      const maskedAdapter: ProductionExecutionPersistenceAdapter = {
        write: withAttempt.adapter.write.bind(withAttempt.adapter),
        read: withAttempt.adapter.read.bind(withAttempt.adapter),
        async listKeys<K extends ProductionExecutionPersistenceRecordKind>(kind: K) {
          if (kind === "claim") {
            return { ok: true, status: "listed", kind, keys: [] } as ProductionExecutionPersistenceListResult<K>;
          }
          return withAttempt.adapter.listKeys(kind);
        },
      };
      const result = await reconcileOrphanedReservationWithoutClaim(maskedAdapter, "record-orphan", () => t4);
      assert.equal(result.ok, false);
      assert.equal(result.reasonCode, "ORPHAN_RESERVATION_ATTEMPT_EXISTS");
      assert.equal(result.writeFree, true);
      const fresh = await withAttempt.storage.read("record-orphan");
      assert.equal(fresh.record?.state, "reserved", "record must be untouched when an attempt exists");
    });

    // --- 7) Record not in "reserved" state (e.g. already "succeeded") -> refuse.
    const succeeded = await setup("succeeded");
    await scenario("a record that is not 'reserved' (e.g. succeeded) is refused", async () => {
      const current = await succeeded.adapter.read("idempotency", "record-orphan-v2");
      assert.equal(current.status, "found");
      if (current.status === "found") {
        await succeeded.adapter.write("idempotency", "record-orphan-v3", {
          ...current.value, state: "succeeded", lifecycleState: "succeeded", recordVersion: 3,
          updatedAt: t2, finishedAt: t2, integrity: { ...current.value.integrity, version: 3 },
        } as never);
      }
      const result = await reconcileOrphanedReservationWithoutClaim(succeeded.adapter, "record-orphan", () => t3);
      assert.equal(result.ok, false);
      assert.equal(result.reasonCode, "ORPHAN_RESERVATION_NOT_RESERVED");
    });

    // --- 8) Record does not exist at all -> refuse.
    const empty = await setup("empty", { withLease: false });
    await scenario("a recordId that does not exist is refused", async () => {
      const result = await reconcileOrphanedReservationWithoutClaim(empty.adapter, "record-does-not-exist", () => t2);
      assert.equal(result.ok, false);
      assert.equal(result.reasonCode, "ORPHAN_RESERVATION_NOT_FOUND");
    });

    // --- 9) Not wired into any automatic bootstrap/recovery path.
    await scenario("reconcileOrphanedReservationWithoutClaim is not referenced by the recovery bootstrap", async () => {
      const bootstrapSource = await fs.readFile(
        "src/lib/production/ProductionExecutionRecoveryBootstrap.ts", "utf8");
      const compositionRootSource = await fs.readFile(
        "src/lib/runtime/ProductionRuntimeCompositionRoot.ts", "utf8");
      assert.ok(!bootstrapSource.includes("reconcileOrphanedReservationWithoutClaim"));
      assert.ok(!compositionRootSource.includes("reconcileOrphanedReservationWithoutClaim"));
    });

    // --- 10) No hidden inputs / no closed-boundary violations in the new source.
    const source = await fs.readFile(
      "src/lib/production/ProductionPipelineRetryReconciliation.ts", "utf8");
    await scenario("new recovery code has no hidden nondeterministic inputs", () => {
      const withoutDefaultNowParam = source.replace(
        /now: \(\) => string = \(\) => new Date\(\)\.toISOString\(\),/g, "");
      assert.ok(!/Math\.random|randomUUID|process\.env/.test(withoutDefaultNowParam));
    });
    await scenario("new recovery code has no runtime/network/process boundary crossings", () => {
      assert.ok(!/setInterval|setTimeout|fetch\(|enqueue\(|dispatch\(|worker_threads|child_process|NextResponse|POST\(/i
        .test(source));
    });

    assert.ok(count >= 11);
    console.log(`Attempt-7 orphan reservation recovery smoke: PASS (${count} scenarios)`);
    emitSmokeResult("orphan-reservation-recovery", count);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
