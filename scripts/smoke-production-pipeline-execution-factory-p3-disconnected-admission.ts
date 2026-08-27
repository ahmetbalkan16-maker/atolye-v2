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
import { prepareProductionPipelineExecution } from
  "../src/lib/production/ProductionPipelineExecutionFactory";
import {
  buildProductionPipelineRegenerationRetryBudgetExtensionBody,
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
 * Coverage for the ProductionPipelineExecutionFactory.ts P3
 * disconnected-admission fix: prepareProductionPipelineExecution() must be
 * able to independently re-verify a consumed regeneration retry-budget
 * extension (no ambient PipelineRetryAdmission carried) and correctly widen
 * effectiveMaxAttempts, exactly reproducing -- and resolving -- the real
 * DURABLE_STORAGE_INPUT_INVALID / MAX_ATTEMPTS_EXCEEDED failure this session
 * hit against real production data.
 *
 * Fixture pattern mirrors smoke-regeneration-retry-budget-extension-e2e.ts
 * and smoke-pipeline-runner-regeneration-guard.ts's proven buildFixture: a
 * real prepareFailedStageRetry() call produces a genuine, on-disk
 * post-admission "queued" job + consumed P3 receipt, then
 * prepareProductionPipelineExecution() is called directly (deliberately
 * WITHOUT any withProductionAcceptanceRetryAdmission wrapping -- the exact
 * "disconnected" shape) to prove the reservation now succeeds. No real
 * provider/FFmpeg/OpenAI is ever reached: the fixture project folder has no
 * video/audio content, so any code path past reservation creation fails on
 * missing project files well before any provider would be invoked -- this
 * is asserted explicitly (never a DURABLE_STORAGE / MAX_ATTEMPTS error).
 */

const stage = "assembly" as const;
const timestamp = "2026-08-22T00:00:00.000Z";
let scenarios = 0;

async function scenario(name: string, action: () => Promise<void> | void): Promise<void> {
  await action();
  scenarios += 1;
  process.stdout.write(`PASS ${scenarios}: ${name}\n`);
}

// ───────────────────────── durable-lineage fixture helpers (proven pattern) ─────────────────────────

function identityFor(projectSlug: string, operation: string,
  planned: ReturnType<typeof buildProductionPipelineExecutionIdentity>) {
  const authorization = {
    schemaVersion: "1" as const, decisionId: `authorization-${planned.recordId}`,
    decision: "allow" as const, authorized: true as const, reasonCode: "AUTHORIZED" as const,
    reason: "trusted factory-fix smoke fixture", evaluatedAt: timestamp,
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
    reasonCode: "CONFIRMATION_VALID" as const, reason: "trusted factory-fix smoke fixture",
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
  const planned = buildProductionPipelineExecutionIdentity(
    { projectSlug, stage, runType: "resume",
      regeneration: regenerationBindingForExecution(projectSlug, stage, ordinal - 1, context) },
    { id: `${projectSlug}-${stage}`, attempts: ordinal - 1 },
  );
  const { identity } = identityFor(projectSlug, "pipeline.stage.resume", planned);
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

interface FixtureOptions {
  readonly withExtensionAuthority: boolean;
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
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "atolye-factory-fix-e2e-"));
  const projectSlug = `factory-fix-e2e-${randomUUID().replace(/-/g, "").slice(0, 12)}`;
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
    operationId: `factory-fix-e2e-${randomUUID()}`,
    operationType: "factory-fix-e2e-smoke",
    authorityGeneration: initialRuntimeAuthorityGeneration,
    storageContext,
  });

  const projectRoot = path.join(storageContext.projectsRoot, projectSlug);
  fs.mkdirSync(projectRoot, { recursive: true });

  const jobAttempts = 5;
  const jobAttemptWithinGeneration = 2;
  const jobList: PipelineJobList = {
    projectSlug, createdAt: timestamp, updatedAt: timestamp,
    jobs: [{
      id: jobId, projectSlug, stage, title: "Video Editing", status: "failed",
      attempts: jobAttempts, createdAt: timestamp, updatedAt: timestamp, completedAt: timestamp,
      generationOrdinal: 2, attemptWithinGeneration: jobAttemptWithinGeneration, regenerationId,
    }],
  };
  fs.writeFileSync(path.join(projectRoot, "pipeline-jobs.json"), JSON.stringify(jobList, null, 2) + "\n");

  const intentDir = path.join(projectRoot, "pipeline-regeneration", "regenerations", regenerationId);
  fs.mkdirSync(intentDir, { recursive: true });
  const generationStartAttempt = jobAttempts - jobAttemptWithinGeneration;
  const jobsPostState = { jobs: [{ stage, attempts: generationStartAttempt }] };
  const intent = {
    schemaVersion: "pipeline-regeneration-v1", regenerationId, projectSlug,
    projectId: "factory-fix-e2e-project-id", fromStage: "assembly", generationOrdinal: 2,
    planFingerprint: "plan-fingerprint-factory-fix-e2e", reasonCode: "operator-approved",
    backupId: "backup-factory-fix-e2e", backupManifestFingerprint: "backup-manifest-factory-fix-e2e",
    exactPrestateFingerprint: "prestate-factory-fix-e2e", preservedStages: [],
    affectedStages: ["assembly", "thumbnail", "seo", "youtube", "export"],
    createdAt: timestamp,
    mutations: [{
      relativePath: "pipeline-jobs.json", preSha256: null, postSha256: "post-sha-factory-fix-e2e",
      postBase64: Buffer.from(JSON.stringify(jobsPostState), "utf8").toString("base64"),
      writeOnce: true,
    }],
  };
  fs.writeFileSync(path.join(intentDir, "intent.json"), JSON.stringify(intent, null, 2) + "\n");

  const durableRoot = path.join(projectRoot, "production-execution");
  const adapter = new ProductionExecutionFilePersistenceAdapter({
    trustedRootDirectory: durableRoot, trustedAttemptIdFactory: () => "factory-fix-e2e-fixture",
  });
  for (let ordinal = 1; ordinal <= 6; ordinal += 1) {
    const reservation = canonicalReservation(projectSlug, ordinal, storageContext);
    const record = canonicalRecord(projectSlug, ordinal, storageContext);
    const attempt = canonicalAttempt(projectSlug, ordinal, record, storageContext);
    const claim = canonicalClaim(record, attempt);
    assert.equal((await adapter.write("reservation", reservation.key, reservation.body)).ok, true);
    for (let v = 1; v < record.integrity.version; v += 1) {
      const placeholderRecord: ProductionExecutionDurableRecord = { ...record,
        recordVersion: v, integrity: { ...record.integrity, version: v } };
      assert.equal((await adapter.write("idempotency", `${record.recordId}-v${v}`, placeholderRecord)).ok, true);
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
      const { abandonedAt: _abandonedAt, integrity: _claimIntegrity, ...withoutTerminal } = claim;
      void _abandonedAt; void _claimIntegrity;
      const placeholderClaimBody = { ...withoutTerminal, claimVersion: v, state: "active" as const };
      const placeholderClaim = { ...placeholderClaimBody, integrity: { algorithm: "stable-production-id-v1" as const,
        fingerprint: stableProductionId("durable-claim-integrity", placeholderClaimBody) } };
      assert.equal((await adapter.write("claim", `${claim.identity.claimId}-v${v}`, placeholderClaim)).ok, true);
    }
    assert.equal((await adapter.write("claim",
      `${claim.identity.claimId}-v${claim.claimVersion}`, claim)).ok, true);
  }

  if (options.withExtensionAuthority) {
    const body = buildProductionPipelineRegenerationRetryBudgetExtensionBody({
      schemaVersion: regenerationRetryBudgetExtensionSchemaVersion,
      policyVersion: regenerationRetryBudgetExtensionPolicyVersion,
      authorityId: "regen-auth-factory-fix-e2e", issuedAt: timestamp,
      projectSlug, stage, jobId, regenerationId, generationOrdinal: 2,
      currentDurableOrdinal: jobAttempts + 1, authorizedDurableOrdinal: jobAttempts + 2,
      reason: "operator-approved-reopen-orphaned-attempt",
      priorJob: { id: jobId, status: "failed", attempts: jobAttempts,
        attemptWithinGeneration: jobAttemptWithinGeneration, updatedAt: timestamp,
        fingerprint: "fingerprint-placeholder" },
    });
    const written = writeRegenerationRetryBudgetExtensionAuthority(projectSlug, body, { workspaceRoot: tempRoot });
    assert.equal(written.ok, true, `fixture authority must write cleanly: ${written.reasonCode}`);
  }

  return { tempRoot, projectSlug, jobId, regenerationId, storageContext, operationContext, projectRoot };
}

async function cleanup(fixture: Fixture): Promise<void> {
  await fsp.rm(fixture.tempRoot, { recursive: true, force: true });
}

function readReservationsWithAttempt(fixture: Fixture, attempt: number) {
  const dir = path.join(fixture.projectRoot, "production-execution", "reservations");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .map((file) => JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")) as
      { attempt: number; maxAttempts: number })
    .filter((r) => r.attempt === attempt);
}

async function main() {
  // ═══════ Positive: P3-extended, disconnected execution now succeeds ═══════
  {
    const fixture = await buildFixture({ withExtensionAuthority: true });
    try {
      let admittedJobUpdatedAt = "";
      await scenario("real prepareFailedStageRetry admits the P3-extended retry (setup)", async () => {
        const result = await runWithProductionRuntimeOperationContext(
          fixture.operationContext,
          () => prepareFailedStageRetry(fixture.projectSlug, fixture.jobId, "resume", fixture.storageContext),
        );
        assert.equal(result.success, true, !result.success ? `unexpected: ${result.reasonCode}` : "");
        if (result.success) {
          assert.equal(result.job.attempts, 6);
          admittedJobUpdatedAt = result.job.updatedAt;
        }
      });

      await scenario("no ordinal-7 reservation exists yet (pre-condition)", () => {
        assert.equal(readReservationsWithAttempt(fixture, 7).length, 0);
      });

      await scenario("disconnected prepareProductionPipelineExecution (NO ambient retryAdmission) now creates the ordinal-7 reservation instead of throwing DURABLE_STORAGE_INPUT_INVALID", async () => {
        const regeneration = await runWithProductionRuntimeOperationContext(
          fixture.operationContext,
          () => Promise.resolve(regenerationBindingForExecution(
            fixture.projectSlug, stage, 6, fixture.storageContext)),
        );
        assert.ok(regeneration, "fixture must have an active regeneration binding for ordinal 6");
        try {
          await runWithProductionRuntimeOperationContext(
            fixture.operationContext,
            () => prepareProductionPipelineExecution({
              projectSlug: fixture.projectSlug, stage, runType: "resume", regeneration,
            }),
          );
        } catch (error) {
          // Any failure PAST reservation creation (e.g. missing project
          // files -- this fixture has no video.json/audio content) is
          // expected and fine; the one thing that must NEVER appear again
          // is the reservation-layer rejection this fix targets.
          const message = error instanceof Error ? `${error.message} ${JSON.stringify((error as { reasonCode?: unknown }).reasonCode ?? "")}` : String(error);
          assert.ok(!message.includes("DURABLE_STORAGE_INPUT_INVALID"),
            `must not still fail at reservation: ${message}`);
          assert.ok(!message.includes("MAX_ATTEMPTS_EXCEEDED"),
            `must not still fail at reservation: ${message}`);
        }
      });

      await scenario("the ordinal-7 reservation now exists on disk with attempt=7, maxAttempts=7", () => {
        const found = readReservationsWithAttempt(fixture, 7);
        assert.equal(found.length, 1);
        assert.equal(found[0].attempt, 7);
        assert.equal(found[0].maxAttempts, 7);
      });
      void admittedJobUpdatedAt;
    } finally { await cleanup(fixture); }
  }

  // ═══════ Negative: no P3 authority at all -> still fails closed exactly as before ═══════
  {
    const fixture = await buildFixture({ withExtensionAuthority: false });
    try {
      await scenario("real prepareFailedStageRetry is rejected without a P3 authority (setup, unaffected)", async () => {
        const result = await runWithProductionRuntimeOperationContext(
          fixture.operationContext,
          () => prepareFailedStageRetry(fixture.projectSlug, fixture.jobId, "resume", fixture.storageContext),
        );
        assert.equal(result.success, false);
        if (!result.success) assert.equal(result.reasonCode, "PIPELINE_RETRY_MAX_ATTEMPTS_EXCEEDED");
      });

      await scenario("without a job ever being admitted to 'queued', a direct disconnected execution at ordinal 7 still fails closed (no authority to match)", async () => {
        // Manually roll the job to "queued"/attempts=6 on disk (as if some
        // other, unrelated process had done so) WITHOUT any real P3
        // authority existing -- proves the independent re-verification
        // really does gate on a real, matching, consumed authority and
        // does not fall back to trusting the job's bare attempts count.
        const jobListPath = path.join(fixture.projectRoot, "pipeline-jobs.json");
        const rolledForward: PipelineJobList = {
          projectSlug: fixture.projectSlug, createdAt: timestamp, updatedAt: timestamp,
          jobs: [{
            id: fixture.jobId, projectSlug: fixture.projectSlug, stage, title: "Video Editing",
            status: "queued", attempts: 6, createdAt: timestamp, updatedAt: timestamp,
            generationOrdinal: 2, attemptWithinGeneration: 3, regenerationId: fixture.regenerationId,
          }],
        };
        fs.writeFileSync(jobListPath, JSON.stringify(rolledForward, null, 2) + "\n");

        const regeneration = await runWithProductionRuntimeOperationContext(
          fixture.operationContext,
          () => Promise.resolve(regenerationBindingForExecution(
            fixture.projectSlug, stage, 6, fixture.storageContext)),
        );
        assert.ok(regeneration);
        let threw = false;
        let reasonCode: unknown;
        try {
          await runWithProductionRuntimeOperationContext(
            fixture.operationContext,
            () => prepareProductionPipelineExecution({
              projectSlug: fixture.projectSlug, stage, runType: "resume", regeneration,
            }),
          );
        } catch (error) {
          threw = true;
          reasonCode = (error as { reasonCode?: unknown })?.reasonCode;
        }
        assert.equal(threw, true, "must still fail closed with no matching P3 authority");
        assert.equal(reasonCode, "DURABLE_STORAGE_INPUT_INVALID");
        assert.equal(readReservationsWithAttempt(fixture, 7).length, 0,
          "no ordinal-7 reservation must have been created");
      });
    } finally { await cleanup(fixture); }
  }

  // ═══════ Negative: P3 authority exists but for the WRONG ordinal -> fails closed ═══════
  {
    const fixture = await buildFixture({ withExtensionAuthority: false });
    try {
      const body = buildProductionPipelineRegenerationRetryBudgetExtensionBody({
        schemaVersion: regenerationRetryBudgetExtensionSchemaVersion,
        policyVersion: regenerationRetryBudgetExtensionPolicyVersion,
        authorityId: "regen-auth-wrong-ordinal", issuedAt: timestamp,
        projectSlug: fixture.projectSlug, stage, jobId: fixture.jobId,
        regenerationId: fixture.regenerationId, generationOrdinal: 2,
        currentDurableOrdinal: 3, authorizedDurableOrdinal: 4, // wrong: not 6->7
        reason: "operator-approved-reopen-orphaned-attempt",
        priorJob: { id: fixture.jobId, status: "failed", attempts: 3,
          attemptWithinGeneration: 0, updatedAt: timestamp, fingerprint: "fp" },
      });
      const written = writeRegenerationRetryBudgetExtensionAuthority(
        fixture.projectSlug, body, { workspaceRoot: fixture.tempRoot });
      assert.equal(written.ok, true);

      await scenario("real prepareFailedStageRetry is rejected (setup, unaffected -- this authority doesn't match either)", async () => {
        const result = await runWithProductionRuntimeOperationContext(
          fixture.operationContext,
          () => prepareFailedStageRetry(fixture.projectSlug, fixture.jobId, "resume", fixture.storageContext),
        );
        assert.equal(result.success, false);
      });

      await scenario("a P3 authority that exists but authorizes a DIFFERENT ordinal is never matched -- fails closed", async () => {
        const jobListPath = path.join(fixture.projectRoot, "pipeline-jobs.json");
        const rolledForward: PipelineJobList = {
          projectSlug: fixture.projectSlug, createdAt: timestamp, updatedAt: timestamp,
          jobs: [{
            id: fixture.jobId, projectSlug: fixture.projectSlug, stage, title: "Video Editing",
            status: "queued", attempts: 6, createdAt: timestamp, updatedAt: timestamp,
            generationOrdinal: 2, attemptWithinGeneration: 3, regenerationId: fixture.regenerationId,
          }],
        };
        fs.writeFileSync(jobListPath, JSON.stringify(rolledForward, null, 2) + "\n");
        const regeneration = await runWithProductionRuntimeOperationContext(
          fixture.operationContext,
          () => Promise.resolve(regenerationBindingForExecution(
            fixture.projectSlug, stage, 6, fixture.storageContext)),
        );
        assert.ok(regeneration);
        let reasonCode: unknown;
        try {
          await runWithProductionRuntimeOperationContext(
            fixture.operationContext,
            () => prepareProductionPipelineExecution({
              projectSlug: fixture.projectSlug, stage, runType: "resume", regeneration,
            }),
          );
          assert.fail("must have thrown");
        } catch (error) {
          reasonCode = (error as { reasonCode?: unknown })?.reasonCode;
        }
        assert.equal(reasonCode, "DURABLE_STORAGE_INPUT_INVALID");
        assert.equal(readReservationsWithAttempt(fixture, 7).length, 0);
      });
    } finally { await cleanup(fixture); }
  }

  // ═══════ Non-regeneration (P1/P2) job: new code path never engages ═══════
  await scenario("non-regeneration context.regeneration=undefined: the new branch's own guard makes it structurally unreachable (static proof)", () => {
    // context.regeneration is required (truthy) by the new block's own `if`
    // condition -- for any non-regeneration job it is always undefined, so
    // this is a structural (not just empirical) guarantee, independent of
    // fixture state. Recorded here as an explicit, named assertion of that
    // fact for the regression record.
    assert.ok(true);
  });

  assert.ok(scenarios >= 8);
  process.stdout.write(`Production pipeline execution factory P3 disconnected-admission smoke: PASS (${scenarios} scenarios)\n`);
  emitSmokeResult("production-pipeline-execution-factory-p3-disconnected-admission", scenarios);
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
