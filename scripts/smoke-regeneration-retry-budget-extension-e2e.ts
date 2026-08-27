import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { emitSmokeResult } from "./lib/SmokeResult";
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
import { regenerationBindingForExecution } from
  "../src/lib/production/ProductionCompletedStageRegenerationStore";
import { ProductionExecutionFilePersistenceAdapter } from
  "../src/lib/production/ProductionExecutionPersistence";
import { stableProductionId } from "../src/lib/production/ProductionDeterminism";
import {
  createProductionRuntimeOperationContext,
  initialRuntimeAuthorityGeneration,
} from "../src/lib/runtime/ProductionRuntimeOperationContext";
import { runWithProductionRuntimeOperationContext } from "../src/lib/runtime/RuntimeOperationScope";
import { createRuntimeStorageContext } from "../src/lib/runtime/RuntimeStoragePaths";
import { prepareFailedStageRetry } from "../src/lib/pipeline/PipelineFailedStageRetry";
import { assertCanonicalPipelineRetryAdmission } from "../src/lib/pipeline/PipelineRetryAdmission";
import {
  buildProductionPipelineRegenerationRetryBudgetExtensionBody,
  readRegenerationRetryBudgetExtensionReceipt,
  regenerationRetryBudgetExtensionPolicyVersion,
  regenerationRetryBudgetExtensionSchemaVersion,
  writeRegenerationRetryBudgetExtensionAuthority,
} from "../src/lib/production/ProductionPipelineRegenerationRetryBudgetExtension";
import type { PipelineJobList } from "../src/types/pipelineJob";
import type { ProductionExecutionDurableAttemptRecord } from
  "../src/types/productionExecutionDurableAttempt";
import type { ProductionExecutionDurableClaimRecord } from
  "../src/types/productionExecutionDurableClaim";
import type { ProductionExecutionDurableRecord } from
  "../src/types/productionExecutionDurableStorage";
import type { ProductionExecutionIdempotencyRecord } from
  "../src/types/productionExecutionIdempotency";

/**
 * P3 E2E: exercises the REAL prepareFailedStageRetry(...) call chain (no
 * mocking of its decision logic) against an isolated, operation-scoped
 * temp fixture — never real project data.
 *
 * Isolation mirrors the existing ordinal-4 harness's
 * runRealOrdinalFourProductionWriterTest() (smoke-sprint-129-36-retry-
 * budget-extension.ts): a fresh createRuntimeStorageContext bound via
 * runWithProductionRuntimeOperationContext(), which every ambient
 * resolveRuntimeStorageContext()/createRuntimeStorageContext() call inside
 * PipelineJobManager, regenerationBindingForExecution, and the durable
 * lineage classifier picks up automatically (AsyncLocalStorage-backed —
 * see RuntimeOperationScope.ts) — no ATOLYE_WORKSPACE_ROOT env mutation.
 * Deliberately narrower than that harness: no ProductionWorkerLifecycle /
 * acceptance-marker / configuration-fingerprint apparatus is bootstrapped,
 * since prepareFailedStageRetry's own call chain (PipelineJobManager,
 * regenerationBindingForExecution, reconcileFailedPipelineExecution,
 * findMatchingRegenerationRetryBudgetExtension) never touches any of that.
 */

const stage = "assembly" as const;
const timestamp = "2026-08-22T00:00:00.000Z";
let scenarios = 0;

async function scenario(name: string, action: () => Promise<void> | void): Promise<void> {
  await action();
  scenarios += 1;
  process.stdout.write(`PASS ${scenarios}: ${name}\n`);
}

// ───────────────────────── durable-lineage fixture helpers ─────────────────────────
// Mirrors canonicalRecord/canonicalAttempt/canonicalClaim from
// smoke-production-durable-attempt-lineage-compatibility.ts and
// smoke-durable-attempt-lineage-orphan-tolerance.ts — genuinely
// validation-passing records, never hand-crafted JSON.

function identityFor(projectSlug: string, operation: string,
  planned: ReturnType<typeof buildProductionPipelineExecutionIdentity>) {
  const authorization = {
    schemaVersion: "1" as const, decisionId: `authorization-${planned.recordId}`,
    decision: "allow" as const, authorized: true as const, reasonCode: "AUTHORIZED" as const,
    reason: "trusted e2e fixture", evaluatedAt: timestamp,
    requestId: planned.requestId, idempotencyKey: planned.idempotencyKey,
    executionFingerprint: planned.executionFingerprint, actorId: "pipeline-system",
    actorType: "system" as const, projectSlug, operation, action: "retry-stage", stage,
    requiredCapabilities: [], grantedCapabilities: [], missingCapabilities: [],
    policyVersion: defaultProductionExecutionIdempotencyPolicy.policyVersion,
    risk: "high" as const, requiresConfirmation: true,
    requiredConfirmationLevel: "high" as const, evidence: ["source:test"],
  };
  const confirmation = {
    schemaVersion: "1" as const, decision: "valid" as const, valid: true as const,
    reasonCode: "CONFIRMATION_VALID" as const, reason: "trusted e2e fixture",
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
  return { identity: result.identity!, authorization, confirmation };
}

function canonicalRecord(projectSlug: string, ordinal: number,
  context: ReturnType<typeof createRuntimeStorageContext>): ProductionExecutionDurableRecord {
  // Must match classifyProductionDurableAttemptLineage's own per-record
  // identity exactly: whichever regeneration binding (if any) covers this
  // ordinal changes the record/claim/attempt id (a regeneration-bound
  // identity hashes differently from a plain one) — building fixture
  // records without this produces IDs the real verification never expects,
  // which is a fixture bug, not a product bug. `context` is passed
  // EXPLICITLY (not resolved ambiently) because fixture assembly runs
  // before any runWithProductionRuntimeOperationContext scope is active.
  const planned = buildProductionPipelineExecutionIdentity(
    { projectSlug, stage, runType: "resume",
      regeneration: regenerationBindingForExecution(projectSlug, stage, ordinal - 1, context) },
    { id: `${projectSlug}-${stage}`, attempts: ordinal - 1 },
  );
  const { identity } = identityFor(projectSlug, "pipeline.stage.resume", planned);
  // reconcileFailedPipelineExecution requires a terminal, released lease on
  // the record (and attempt.finalizedAt) before it will reconcile a
  // "failed" attempt at all — a record with no durableLease at all reads as
  // "durable:terminal-binding-missing", distinct from a lineage/pairing
  // problem. A real closed-out attempt always has one (see the durable
  // storage the real project's own attempts 1-6 carry).
  const leaseIdentity = {
    leaseId: planned.leaseId, workerId: "pipeline-worker", workerSessionId: "pipeline-session-v1",
    recordId: planned.recordId, idempotencyKey: identity.idempotencyKey,
    requestId: identity.requestId, executionFingerprint: identity.executionFingerprint,
  };
  const leaseBody = {
    schemaVersion: "1" as const, identity: leaseIdentity, status: "released" as const,
    acquiredAt: timestamp, heartbeatAt: timestamp, expiresAt: "2027-08-22T00:00:00.000Z",
    releasedAt: timestamp, version: 2,
    ownership: { ownerFingerprint: `lease-owner-${planned.recordId}`,
      workerEvidence: `worker-${planned.recordId}`, sessionEvidence: `session-${planned.recordId}` },
  };
  const durableLease = { ...leaseBody, integrity: { algorithm: "stable-production-id-v1" as const,
    fingerprint: stableProductionId("durable-lease-integrity", leaseBody) } };
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
    evidence: ["source:pipeline-composition"], durableLease,
    integrity: { algorithm: "stable-production-id-v1", fingerprint: identity.identityFingerprint,
      version: 4 }, storageVersion: "1", lifecycleState: "cancelled", recordVersion: 4,
  };
}

// reconcileFailedPipelineExecution's settlement-chain verification also
// requires a genuine "reservation" store entry for the attempt (keyed by
// identityFingerprint, per createReservation()'s own convention) — a real
// closed-out attempt always has one; a record with claim+attempt but no
// reservation reads as PIPELINE_FAILED_SETTLEMENT_CHAIN_MISSING.
function canonicalReservation(projectSlug: string, ordinal: number,
  context: ReturnType<typeof createRuntimeStorageContext>) {
  const planned = buildProductionPipelineExecutionIdentity(
    { projectSlug, stage, runType: "resume",
      regeneration: regenerationBindingForExecution(projectSlug, stage, ordinal - 1, context) },
    { id: `${projectSlug}-${stage}`, attempts: ordinal - 1 },
  );
  const { identity, authorization, confirmation } =
    identityFor(projectSlug, "pipeline.stage.resume", planned);
  return {
    key: identity.identityFingerprint,
    body: {
      schemaVersion: "1" as const, identity, authorization, confirmation,
      requestedAt: timestamp, expectedInitialState: "reserved" as const,
      attempt: ordinal, maxAttempts: 10, reservationTtlSeconds: 31_536_000,
      policyContext: { source: "server" as const, environment: "test" as const },
      metadata: { source: "server" as const },
    },
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

function canonicalAttempt(projectSlug: string, ordinal: number,
  record: ProductionExecutionIdempotencyRecord,
  context: ReturnType<typeof createRuntimeStorageContext>): ProductionExecutionDurableAttemptRecord {
  const planned = buildProductionPipelineExecutionIdentity(
    { projectSlug, stage, runType: "resume",
      regeneration: regenerationBindingForExecution(projectSlug, stage, ordinal - 1, context) },
    { id: `${projectSlug}-${stage}`, attempts: ordinal - 1 },
  );
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

function canonicalClaim(record: ProductionExecutionDurableRecord,
  attempt: ProductionExecutionDurableAttemptRecord): ProductionExecutionDurableClaimRecord {
  const body = {
    schemaVersion: "1" as const, storageVersion: "1" as const,
    identity: {
      claimId: attempt.identity.claimId, recordId: record.recordId,
      reservationId: record.identityFingerprint, requestId: record.requestId,
      idempotencyKey: record.idempotencyKey, operation: record.operation,
      executionFingerprint: record.executionFingerprint, workerId: attempt.identity.workerId,
      workerSessionId: attempt.identity.workerSessionId, leaseId: attempt.identity.leaseId,
    },
    // These version numbers must satisfy readAndVerifyFailedChain's
    // "third disjunct" (a closed-out failed/cancelled attempt):
    // record.recordVersion === base+2, lease.version === base+1,
    // claim.claimVersion === base+1, where base is this idempotencyVersion
    // (2) / attempt.binding.leaseVersion (1) / attempt.binding.claimVersion
    // (1) respectively — i.e. record 2->4, lease 1->2, claim 1->2.
    binding: { reservationVersion: 1, idempotencyVersion: 2,
      leaseVersion: 1, bindingFingerprint: `claim-binding-${record.recordId}` },
    ownership: { ownerFingerprint: `owner-${record.recordId}`,
      reservationEvidence: `reservation-${record.recordId}`,
      idempotencyEvidence: `idempotency-${record.recordId}`,
      leaseEvidence: `lease-${record.recordId}` },
    state: "abandoned" as const, claimVersion: 2, acquiredAt: timestamp,
    updatedAt: timestamp, abandonedAt: timestamp, evidence: ["fixture:terminal-claim"],
  };
  return { ...body, integrity: { algorithm: "stable-production-id-v1",
    fingerprint: stableProductionId("durable-claim-integrity", body) } };
}

// ───────────────────────────────── fixture assembly ─────────────────────────────────

interface FixtureOptions {
  readonly durableAttempts: number; // how many genuine, fully-paired attempts to seed
  readonly jobAttempts: number;
  readonly jobAttemptWithinGeneration: number;
  readonly extension?: {
    readonly authorityId?: string;
    readonly jobId?: string;
    readonly regenerationId?: string;
    readonly stage?: string;
    readonly currentDurableOrdinal?: number;
    readonly authorizedDurableOrdinal?: number;
    readonly priorJobAttempts?: number;
    readonly preConsumed?: boolean;
  };
}

interface Fixture {
  readonly tempRoot: string;
  readonly projectSlug: string;
  readonly jobId: string;
  readonly regenerationId: string;
  readonly storageContext: ReturnType<typeof createRuntimeStorageContext>;
  readonly operationContext: ReturnType<typeof createProductionRuntimeOperationContext>;
  readonly projectRoot: string;
}

async function buildFixture(options: FixtureOptions): Promise<Fixture> {
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "atolye-regen-e2e-"));
  const projectSlug = `regen-e2e-${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const jobId = `${projectSlug}-${stage}`;
  const regenerationId = `pipeline-regen-${randomUUID().replace(/-/g, "")}${"0".repeat(16)}`.slice(0, 63);

  const storageContext = createRuntimeStorageContext({
    workspaceRoot: tempRoot,
    environment: {
      ATOLYE_RUNTIME_ROOT: path.join(tempRoot, "data"),
      ATOLYE_RUNTIME_AUTHORITY_ROOT: path.join(tempRoot, "authority"),
    },
  });
  const operationContext = createProductionRuntimeOperationContext({
    operationId: `regen-e2e-${randomUUID()}`,
    operationType: "regen-e2e-smoke",
    authorityGeneration: initialRuntimeAuthorityGeneration,
    storageContext,
  });

  const projectRoot = path.join(storageContext.projectsRoot, projectSlug);
  fs.mkdirSync(projectRoot, { recursive: true });

  // 1) Job list — the job in the exact "failed" shape prepareFailedStageRetry accepts.
  const jobList: PipelineJobList = {
    projectSlug, createdAt: timestamp, updatedAt: timestamp,
    jobs: [{
      id: jobId, projectSlug, stage, title: "Video Editing", status: "failed",
      attempts: options.jobAttempts, createdAt: timestamp, updatedAt: timestamp,
      completedAt: timestamp,
      generationOrdinal: 2, attemptWithinGeneration: options.jobAttemptWithinGeneration,
      regenerationId,
    }],
  };
  fs.writeFileSync(path.join(projectRoot, "pipeline-jobs.json"),
    JSON.stringify(jobList, null, 2) + "\n");

  // 2) Pipeline-lineage regeneration intent — enough for
  // regenerationBindingForExecution() to resolve a binding. readJson() at
  // the reader layer does no schema validation beyond JSON.parse; the
  // fields below match PipelineRegenerationIntent's shape exactly.
  const intentDir = path.join(projectRoot, "pipeline-regeneration", "regenerations", regenerationId);
  fs.mkdirSync(intentDir, { recursive: true });
  const generationStartAttempt = options.jobAttempts - options.jobAttemptWithinGeneration;
  const jobsPostState = { jobs: [{ stage, attempts: generationStartAttempt }] };
  const intent = {
    schemaVersion: "pipeline-regeneration-v1", regenerationId, projectSlug,
    projectId: "e2e-project-id", fromStage: "assembly", generationOrdinal: 2,
    planFingerprint: "plan-fingerprint-e2e", reasonCode: "operator-approved",
    backupId: "backup-e2e", backupManifestFingerprint: "backup-manifest-e2e",
    exactPrestateFingerprint: "prestate-e2e", preservedStages: [],
    affectedStages: ["assembly", "thumbnail", "seo", "youtube", "export"],
    createdAt: timestamp,
    mutations: [{
      relativePath: "pipeline-jobs.json", preSha256: null, postSha256: "post-sha-e2e",
      postBase64: Buffer.from(JSON.stringify(jobsPostState), "utf8").toString("base64"),
      writeOnce: true,
    }],
  };
  fs.writeFileSync(path.join(intentDir, "intent.json"), JSON.stringify(intent, null, 2) + "\n");

  // 3) Durable lineage — N genuine, fully-paired attempts (1..N).
  const durableRoot = path.join(projectRoot, "production-execution");
  const adapter = new ProductionExecutionFilePersistenceAdapter({
    trustedRootDirectory: durableRoot, trustedAttemptIdFactory: () => "e2e-fixture",
  });
  for (let ordinal = 1; ordinal <= options.durableAttempts; ordinal += 1) {
    const reservation = canonicalReservation(projectSlug, ordinal, storageContext);
    const record = canonicalRecord(projectSlug, ordinal, storageContext);
    const attempt = canonicalAttempt(projectSlug, ordinal, record, storageContext);
    const claim = canonicalClaim(record, attempt);
    assert.equal((await adapter.write("reservation", reservation.key, reservation.body)).ok, true);
    // exactLatestLineageVersion requires a version-contiguous history
    // (1..N present, only the LATEST version's content is ever validated —
    // see classifyProductionDurableAttemptLineage) — write placeholder
    // earlier versions (version number changed only) so the real, final
    // version (the actual return value of canonicalRecord/canonicalClaim)
    // satisfies contiguity.
    for (let v = 1; v < record.integrity.version; v += 1) {
      const placeholderRecord: ProductionExecutionDurableRecord = { ...record,
        recordVersion: v, integrity: { ...record.integrity, version: v } };
      assert.equal((await adapter.write("idempotency", `${record.recordId}-v${v}`,
        placeholderRecord)).ok, true);
    }
    assert.equal((await adapter.write("idempotency",
      `${record.recordId}-v${record.integrity.version}`, record)).ok, true);
    for (let v = 1; v < attempt.attemptVersion; v += 1) {
      assert.equal((await adapter.write("attempt", `${attempt.identity.attemptId}-v${v}`,
        { ...attempt, attemptVersion: v })).ok, true);
    }
    assert.equal((await adapter.write("attempt",
      `${attempt.identity.attemptId}-v${attempt.attemptVersion}`, attempt)).ok, true);
    for (let v = 1; v < claim.claimVersion; v += 1) {
      // Placeholder only, to satisfy version-contiguity — a claim's earlier
      // versions are never validated for content (see readApplicableClaims),
      // but the write-time schema still requires an "active" claim to have
      // no terminal (abandonedAt) fields, so build a minimal active shape
      // rather than just relabeling the final abandoned claim's version.
      // Unlike the record fixture above (whose integrity.fingerprint is
      // always identityFingerprint regardless of version), a claim's
      // fingerprint hashes its full body — a changed claimVersion/state
      // needs a freshly recomputed fingerprint, not a copy of the final
      // version's.
      const { abandonedAt: _abandonedAt, integrity: _claimIntegrity, ...withoutTerminal } = claim;
      void _abandonedAt; void _claimIntegrity;
      const placeholderClaimBody = { ...withoutTerminal, claimVersion: v, state: "active" as const };
      const placeholderClaim = { ...placeholderClaimBody, integrity: { algorithm: "stable-production-id-v1" as const,
        fingerprint: stableProductionId("durable-claim-integrity", placeholderClaimBody) } };
      assert.equal((await adapter.write("claim", `${claim.identity.claimId}-v${v}`,
        placeholderClaim)).ok, true);
    }
    assert.equal((await adapter.write("claim",
      `${claim.identity.claimId}-v${claim.claimVersion}`, claim)).ok, true);
  }

  // 4) Optional regen-extension authority.
  if (options.extension) {
    const ext = options.extension;
    const body = buildProductionPipelineRegenerationRetryBudgetExtensionBody({
      schemaVersion: regenerationRetryBudgetExtensionSchemaVersion,
      policyVersion: regenerationRetryBudgetExtensionPolicyVersion,
      authorityId: ext.authorityId ?? "regen-auth-e2e",
      issuedAt: timestamp,
      projectSlug, stage: (ext.stage as typeof stage) ?? stage,
      jobId: ext.jobId ?? jobId,
      regenerationId: ext.regenerationId ?? regenerationId,
      generationOrdinal: 2,
      currentDurableOrdinal: ext.currentDurableOrdinal ?? options.jobAttempts + 1,
      authorizedDurableOrdinal: ext.authorizedDurableOrdinal ?? options.jobAttempts + 2,
      reason: "operator-approved-reopen-orphaned-attempt",
      priorJob: {
        id: jobId, status: "failed",
        attempts: ext.priorJobAttempts ?? options.jobAttempts,
        attemptWithinGeneration: options.jobAttemptWithinGeneration,
        updatedAt: timestamp, fingerprint: "fingerprint-placeholder",
      },
    });
    const written = writeRegenerationRetryBudgetExtensionAuthority(projectSlug, body, { workspaceRoot: tempRoot });
    assert.equal(written.ok, true, `fixture authority must write cleanly: ${written.reasonCode}`);
    if (ext.preConsumed) {
      const { buildProductionPipelineRegenerationRetryBudgetExtensionReceipt,
        writeRegenerationRetryBudgetExtensionReceipt } = await import(
        "../src/lib/production/ProductionPipelineRegenerationRetryBudgetExtension");
      const receipt = buildProductionPipelineRegenerationRetryBudgetExtensionReceipt(
        body.authorityId, "consumed", timestamp, timestamp, ["fixture:pre-consumed"],
      );
      writeRegenerationRetryBudgetExtensionReceipt(projectSlug, receipt, { workspaceRoot: tempRoot });
    }
  }

  return { tempRoot, projectSlug, jobId, regenerationId, storageContext, operationContext, projectRoot };
}

async function cleanup(fixture: Fixture): Promise<void> {
  await fsp.rm(fixture.tempRoot, { recursive: true, force: true });
}

async function main() {
  // ═══════════════ Positive E2E: full prepareFailedStageRetry chain ═══════════════
  const positive = await buildFixture({
    durableAttempts: 6, jobAttempts: 5, jobAttemptWithinGeneration: 2,
    extension: { currentDurableOrdinal: 6, authorizedDurableOrdinal: 7 },
  });
  let positiveResult: Awaited<ReturnType<typeof prepareFailedStageRetry>> | undefined;
  try {
    await scenario("prepareFailedStageRetry admits ordinal 7 via the regen-extension authority", async () => {
      positiveResult = await runWithProductionRuntimeOperationContext(
        positive.operationContext,
        () => prepareFailedStageRetry(positive.projectSlug, positive.jobId, "resume", positive.storageContext),
      );
      assert.equal(positiveResult.success, true,
        !positiveResult.success ? `unexpected failure: ${positiveResult.reasonCode}` : "");
    });

    await scenario("the admitted retry identity uses durable ordinal 7, not 8", async () => {
      assert.ok(positiveResult?.success);
      if (!positiveResult.success) return;
      assert.equal(positiveResult.admission.admittedDurableOrdinal, 7);
      assert.equal(positiveResult.admission.currentDurableOrdinal, 6);
      assert.equal(positiveResult.job.attempts, 6);
      assert.equal(positiveResult.job.status, "queued");
    });

    await scenario("the admission satisfies assertCanonicalPipelineRetryAdmission end to end", async () => {
      assert.ok(positiveResult?.success);
      if (!positiveResult?.success) return;
      const { admission, previousJob, job } = positiveResult;
      await runWithProductionRuntimeOperationContext(positive.operationContext, async () => {
        assertCanonicalPipelineRetryAdmission({
          admission, previousJob, currentJob: job,
          projectSlug: positive.projectSlug, stage, runType: "resume",
        });
      });
    });

    await scenario("the extension authority is consumed and a consumed receipt exists on disk", async () => {
      const receipt = readRegenerationRetryBudgetExtensionReceipt(
        positive.projectSlug, "regen-auth-e2e", "consumed", { workspaceRoot: positive.tempRoot },
      );
      assert.equal(receipt.ok, true);
      assert.equal(receipt.value?.state, "consumed");
    });

    await scenario("the admission's retryBudgetAuthorityProof references that authority", async () => {
      assert.ok(positiveResult?.success);
      if (!positiveResult.success) return;
      assert.equal(positiveResult.admission.retryBudgetAuthorityProof?.authorityId, "regen-auth-e2e");
      assert.equal(positiveResult.admission.effectiveMaxAttempts, 7);
      assert.equal(positiveResult.admission.authorizedDurableOrdinal, 7);
    });

    // ═══════════ Same authority, replayed against the pre-retry job state ═══════════
    await scenario("re-attempting with the SAME (now-consumed) authority is rejected — single use", async () => {
      // Roll the job list back to its pre-retry ("failed", attempts=5) state
      // directly on disk — simulating a second, independent retry attempt
      // for the exact same failure, without ever calling cancel/retry APIs.
      const jobListPath = path.join(positive.projectRoot, "pipeline-jobs.json");
      const rolledBack: PipelineJobList = {
        projectSlug: positive.projectSlug, createdAt: timestamp, updatedAt: timestamp,
        jobs: [{
          id: positive.jobId, projectSlug: positive.projectSlug, stage, title: "Video Editing",
          status: "failed", attempts: 5, createdAt: timestamp, updatedAt: timestamp,
          completedAt: timestamp, generationOrdinal: 2, attemptWithinGeneration: 2,
          regenerationId: positive.regenerationId,
        }],
      };
      fs.writeFileSync(jobListPath, JSON.stringify(rolledBack, null, 2) + "\n");

      const secondAttempt = await runWithProductionRuntimeOperationContext(
        positive.operationContext,
        () => prepareFailedStageRetry(positive.projectSlug, positive.jobId, "resume", positive.storageContext),
      );
      assert.equal(secondAttempt.success, false);
      if (!secondAttempt.success) {
        assert.equal(secondAttempt.reasonCode, "PIPELINE_RETRY_MAX_ATTEMPTS_EXCEEDED");
      }
    });
  } finally { await cleanup(positive); }

  // ═════════════════════════════ Negative scenarios ═════════════════════════════
  // Each rebuilds a fresh, isolated fixture with exactly one authority field
  // deliberately mismatched. In every case findMatchingRegenerationRetryBudgetExtension
  // must find nothing, so prepareFailedStageRetry falls back to the ordinary
  // (unextended) generationMaxAttempts(6) ceiling and rejects ordinal 7.
  const negativeCases: Array<[string, Partial<FixtureOptions["extension"]>]> = [
    ["wrong jobId", { jobId: "wrong-job-id" }],
    ["wrong regenerationId", { regenerationId: "pipeline-regen-wrong" + "0".repeat(48) }],
    ["wrong stage", { stage: "thumbnail" }],
    ["current ordinal doesn't match the authority's priorJob.attempts", { priorJobAttempts: 3 }],
    ["authority already consumed", { preConsumed: true }],
  ];

  for (const [label, extOverrides] of negativeCases) {
    await scenario(`prepare/retry chain refuses a regen-extension with ${label}`, async () => {
      const fixture = await buildFixture({
        durableAttempts: 6, jobAttempts: 5, jobAttemptWithinGeneration: 2,
        extension: { currentDurableOrdinal: 6, authorizedDurableOrdinal: 7, ...extOverrides },
      });
      try {
        const result = await runWithProductionRuntimeOperationContext(
          fixture.operationContext,
          () => prepareFailedStageRetry(fixture.projectSlug, fixture.jobId, "resume", fixture.storageContext),
        );
        assert.equal(result.success, false,
          `mismatched authority (${label}) must not be admitted`);
        if (!result.success) {
          assert.equal(result.reasonCode, "PIPELINE_RETRY_MAX_ATTEMPTS_EXCEEDED");
        }
      } finally { await cleanup(fixture); }
    });
  }

  // authorizedDurableOrdinal !== currentDurableOrdinal+1 ("skip to 8") is
  // refused even earlier than the retry chain — at authority-creation time,
  // by ProductionPipelineRegenerationRetryBudgetExtension's own validator
  // (never a durable-lineage/fixture concern at all). buildFixture's
  // extension step asserts a clean write, so this case is exercised
  // directly against the store instead of through the full fixture helper.
  await scenario("an authorizedDurableOrdinal that skips ahead (8, not 7) is refused at authority creation, before any retry chain", async () => {
    const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "atolye-regen-e2e-skip-"));
    try {
      const body = buildProductionPipelineRegenerationRetryBudgetExtensionBody({
        schemaVersion: regenerationRetryBudgetExtensionSchemaVersion,
        policyVersion: regenerationRetryBudgetExtensionPolicyVersion,
        authorityId: "regen-auth-skip", issuedAt: timestamp,
        projectSlug: "regen-e2e-skip-project", stage, jobId: "regen-e2e-skip-project-assembly",
        regenerationId: "pipeline-regen-skip" + "0".repeat(47),
        generationOrdinal: 2, currentDurableOrdinal: 6, authorizedDurableOrdinal: 8,
        reason: "operator-approved-reopen-orphaned-attempt",
        priorJob: { id: "regen-e2e-skip-project-assembly", status: "failed", attempts: 5,
          attemptWithinGeneration: 2, updatedAt: timestamp, fingerprint: "fingerprint-placeholder" },
      });
      const written = writeRegenerationRetryBudgetExtensionAuthority(
        "regen-e2e-skip-project", body, { workspaceRoot: tempRoot });
      assert.equal(written.ok, false);
      assert.equal(written.reasonCode, "PIPELINE_REGENERATION_RETRY_BUDGET_EXTENSION_INTEGRITY_MISMATCH");
    } finally { await fsp.rm(tempRoot, { recursive: true, force: true }); }
  });

  // ═══════════════════ Baseline: no authority at all, same job shape ═══════════════════
  await scenario("without any regen-extension authority, the same job shape is rejected too (baseline)", async () => {
    const fixture = await buildFixture({
      durableAttempts: 6, jobAttempts: 5, jobAttemptWithinGeneration: 2,
    });
    try {
      const result = await runWithProductionRuntimeOperationContext(
        fixture.operationContext,
        () => prepareFailedStageRetry(fixture.projectSlug, fixture.jobId, "resume", fixture.storageContext),
      );
      assert.equal(result.success, false);
      if (!result.success) assert.equal(result.reasonCode, "PIPELINE_RETRY_MAX_ATTEMPTS_EXCEEDED");
    } finally { await cleanup(fixture); }
  });

  assert.ok(scenarios >= 13);
  process.stdout.write(`Regeneration retry budget extension E2E smoke: PASS (${scenarios} scenarios)\n`);
  emitSmokeResult("regeneration-retry-budget-extension-e2e", scenarios);
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
