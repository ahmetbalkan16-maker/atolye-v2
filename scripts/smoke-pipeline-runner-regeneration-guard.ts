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
import { classifyProductionDurableAttemptLineage } from
  "../src/lib/production/ProductionDurableAttemptLineageClassifier";
import { stableProductionId } from "../src/lib/production/ProductionDeterminism";
import {
  createProductionRuntimeOperationContext,
  initialRuntimeAuthorityGeneration,
} from "../src/lib/runtime/ProductionRuntimeOperationContext";
import { runWithProductionRuntimeOperationContext } from "../src/lib/runtime/RuntimeOperationScope";
import { createRuntimeStorageContext } from "../src/lib/runtime/RuntimeStoragePaths";
import { prepareFailedStageRetry } from "../src/lib/pipeline/PipelineFailedStageRetry";
import {
  buildProductionPipelineRegenerationRetryBudgetExtensionBody,
  buildProductionPipelineRegenerationRetryBudgetExtensionReceipt,
  findConsumedRegenerationRetryBudgetExtension,
  readRegenerationRetryBudgetExtensionReceipt,
  regenerationRetryBudgetExtensionPolicyVersion,
  regenerationRetryBudgetExtensionSchemaVersion,
  writeRegenerationRetryBudgetExtensionAuthority,
  writeRegenerationRetryBudgetExtensionReceipt,
} from "../src/lib/production/ProductionPipelineRegenerationRetryBudgetExtension";
import type { PipelineJob, PipelineJobList } from "../src/types/pipelineJob";
import type { ProductionExecutionDurableAttemptRecord } from
  "../src/types/productionExecutionDurableAttempt";
import type { ProductionExecutionDurableClaimRecord } from
  "../src/types/productionExecutionDurableClaim";
import type { ProductionExecutionDurableRecord } from
  "../src/types/productionExecutionDurableStorage";
import type { ProductionExecutionIdempotencyRecord } from
  "../src/types/productionExecutionIdempotency";

/**
 * Coverage for the new PipelineRunner.ts generation-2/P3 sibling guard and
 * its supporting ProductionPipelineRegenerationRetryBudgetExtension.ts
 * helper, findConsumedRegenerationRetryBudgetExtension().
 *
 * Section A: direct, isolated unit tests of the helper against a plain temp
 * P3-store directory -- no PipelineJobManager/durable-lineage fixture
 * needed, since the helper only reads the regen-authority- and
 * regen-receipt- files.
 *
 * Section B: a real, fixture-driven integration test that calls the ACTUAL
 * prepareFailedStageRetry(...) (fixture pattern mirrors
 * smoke-regeneration-retry-budget-extension-e2e.ts's proven buildFixture)
 * to produce a genuine post-admission "queued" job + consumed P3 receipt +
 * real durable store on disk, then verifies -- against that real, non-
 * synthetic state -- both halves of what PipelineRunner.ts's new branch
 * actually does: findConsumedRegenerationRetryBudgetExtension() matching,
 * and classifyProductionDurableAttemptLineage(..., priorJob.attempts,
 * "exact") returning "valid". This is the exact integration contract that a
 * prior turn's wrong assumption (job.attempts instead of
 * priorJob.attempts) got wrong against real production data -- so it is
 * re-proven here against a controlled, disposable fixture before touching
 * anything real again.
 */

const stage = "assembly" as const;
const timestamp = "2026-08-22T00:00:00.000Z";
let scenarios = 0;

async function scenario(name: string, action: () => Promise<void> | void): Promise<void> {
  await action();
  scenarios += 1;
  process.stdout.write(`PASS ${scenarios}: ${name}\n`);
}

// ───────────────────────── Section A: direct helper unit tests ─────────────────────────

const baseJob = {
  id: "proj-a-assembly",
  regenerationId: "pipeline-regen-a" + "0".repeat(48),
  generationOrdinal: 2,
  attempts: 6,
  updatedAt: "2026-08-23T08:04:45.556Z",
};

async function withTempDir<T>(fn: (workspaceRoot: string) => Promise<T> | T): Promise<T> {
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "atolye-runner-guard-unit-"));
  try { return await fn(tempRoot); } finally { await fsp.rm(tempRoot, { recursive: true, force: true }); }
}

function writeAuthorityAndReceipt(
  workspaceRoot: string,
  overrides: {
    authorityId?: string; projectSlug?: string; stage?: string; jobId?: string;
    regenerationId?: string; generationOrdinal?: number;
    priorJobAttempts?: number; currentDurableOrdinal?: number; authorizedDurableOrdinal?: number;
    receiptState?: "consumed" | "aborted" | "none"; receiptJobVersion?: string;
    corruptAuthority?: boolean; corruptReceipt?: boolean;
  } = {},
) {
  const authorityId = overrides.authorityId ?? "regen-auth-unit";
  const projectSlug = overrides.projectSlug ?? "proj-a";
  const currentDurableOrdinal = overrides.currentDurableOrdinal ?? baseJob.attempts;
  const body = buildProductionPipelineRegenerationRetryBudgetExtensionBody({
    schemaVersion: regenerationRetryBudgetExtensionSchemaVersion,
    policyVersion: regenerationRetryBudgetExtensionPolicyVersion,
    authorityId, issuedAt: timestamp,
    projectSlug, stage: (overrides.stage as typeof stage) ?? stage,
    jobId: overrides.jobId ?? baseJob.id,
    regenerationId: overrides.regenerationId ?? baseJob.regenerationId,
    generationOrdinal: overrides.generationOrdinal ?? baseJob.generationOrdinal,
    currentDurableOrdinal,
    authorizedDurableOrdinal: overrides.authorizedDurableOrdinal ?? currentDurableOrdinal + 1,
    reason: "unit-fixture",
    priorJob: {
      id: overrides.jobId ?? baseJob.id, status: "failed",
      attempts: overrides.priorJobAttempts ?? baseJob.attempts - 1,
      attemptWithinGeneration: 2, updatedAt: timestamp, fingerprint: "fp-unit",
    },
  });
  const written = writeRegenerationRetryBudgetExtensionAuthority(projectSlug, body, { workspaceRoot });
  assert.equal(written.ok, true, `fixture authority must write cleanly: ${written.reasonCode}`);
  if (overrides.corruptAuthority) {
    const dir = path.join(workspaceRoot, "data", "projects", projectSlug, "production-execution",
      "retry-budget-extensions");
    fs.writeFileSync(path.join(dir, `regen-authority-${authorityId}.json`), "{not json");
  }
  const receiptState = overrides.receiptState ?? "consumed";
  if (receiptState !== "none") {
    const receipt = buildProductionPipelineRegenerationRetryBudgetExtensionReceipt(
      authorityId, receiptState, timestamp,
      overrides.receiptJobVersion ?? baseJob.updatedAt, ["unit-fixture"],
    );
    const writtenReceipt = writeRegenerationRetryBudgetExtensionReceipt(projectSlug, receipt, { workspaceRoot });
    assert.equal(writtenReceipt.ok, true, `fixture receipt must write cleanly: ${writtenReceipt.reasonCode}`);
    if (overrides.corruptReceipt) {
      const dir = path.join(workspaceRoot, "data", "projects", projectSlug, "production-execution",
        "retry-budget-extensions");
      fs.writeFileSync(path.join(dir, `regen-receipt-${authorityId}-${receiptState}.json`), "{not json");
    }
  }
  return authorityId;
}

async function runUnitScenarios() {
  await scenario("no regenerationId on the job -> undefined (never engages for non-regeneration jobs)", async () => {
    await withTempDir(async (workspaceRoot) => {
      writeAuthorityAndReceipt(workspaceRoot);
      const result = findConsumedRegenerationRetryBudgetExtension(
        "proj-a", stage, { ...baseJob, regenerationId: undefined }, { workspaceRoot },
      );
      assert.equal(result, undefined);
    });
  });

  await scenario("invalid generationOrdinal on the job -> undefined", async () => {
    await withTempDir(async (workspaceRoot) => {
      writeAuthorityAndReceipt(workspaceRoot);
      const result = findConsumedRegenerationRetryBudgetExtension(
        "proj-a", stage, { ...baseJob, generationOrdinal: undefined }, { workspaceRoot },
      );
      assert.equal(result, undefined);
    });
  });

  await scenario("job.attempts < 1 -> undefined (fail-closed, cannot have a prior attempt)", async () => {
    await withTempDir((workspaceRoot) => {
      // No authority needs to exist on disk at all -- the attempts<1 guard
      // must reject before ever reading the store.
      const result = findConsumedRegenerationRetryBudgetExtension(
        "proj-a", stage, { ...baseJob, attempts: 0 }, { workspaceRoot },
      );
      assert.equal(result, undefined);
    });
  });

  await scenario("no authority file at all -> undefined", async () => {
    await withTempDir((workspaceRoot) => {
      const result = findConsumedRegenerationRetryBudgetExtension("proj-a", stage, baseJob, { workspaceRoot });
      assert.equal(result, undefined);
    });
  });

  await scenario("wrong projectSlug in authority -> undefined", async () => {
    await withTempDir(async (workspaceRoot) => {
      writeAuthorityAndReceipt(workspaceRoot, { projectSlug: "proj-b" });
      const result = findConsumedRegenerationRetryBudgetExtension("proj-a", stage, baseJob, { workspaceRoot });
      assert.equal(result, undefined);
    });
  });

  await scenario("wrong stage in authority -> undefined", async () => {
    await withTempDir(async (workspaceRoot) => {
      writeAuthorityAndReceipt(workspaceRoot, { stage: "thumbnail" });
      const result = findConsumedRegenerationRetryBudgetExtension("proj-a", stage, baseJob, { workspaceRoot });
      assert.equal(result, undefined);
    });
  });

  await scenario("wrong jobId in authority -> undefined", async () => {
    await withTempDir(async (workspaceRoot) => {
      writeAuthorityAndReceipt(workspaceRoot, { jobId: "proj-a-wrong-job" });
      const result = findConsumedRegenerationRetryBudgetExtension("proj-a", stage, baseJob, { workspaceRoot });
      assert.equal(result, undefined);
    });
  });

  await scenario("wrong generationOrdinal in authority -> undefined", async () => {
    await withTempDir(async (workspaceRoot) => {
      writeAuthorityAndReceipt(workspaceRoot, { generationOrdinal: 3 });
      const result = findConsumedRegenerationRetryBudgetExtension("proj-a", stage, baseJob, { workspaceRoot });
      assert.equal(result, undefined);
    });
  });

  await scenario("wrong priorJob.attempts in authority -> undefined", async () => {
    await withTempDir(async (workspaceRoot) => {
      writeAuthorityAndReceipt(workspaceRoot, { priorJobAttempts: 3 });
      const result = findConsumedRegenerationRetryBudgetExtension("proj-a", stage, baseJob, { workspaceRoot });
      assert.equal(result, undefined);
    });
  });

  await scenario("wrong authorizedDurableOrdinal in authority -> undefined", async () => {
    await withTempDir(async (workspaceRoot) => {
      // Self-consistent per the authority's OWN schema (authorizedDurableOrdinal
      // === currentDurableOrdinal + 1 = 4), but wrong relative to what
      // findConsumedRegenerationRetryBudgetExtension expects for this job
      // (job.attempts(6) + 1 = 7).
      writeAuthorityAndReceipt(workspaceRoot, { currentDurableOrdinal: 3, authorizedDurableOrdinal: 4 });
      const result = findConsumedRegenerationRetryBudgetExtension("proj-a", stage, baseJob, { workspaceRoot });
      assert.equal(result, undefined);
    });
  });

  await scenario("no receipt at all -> undefined (authority found but never consumed)", async () => {
    await withTempDir(async (workspaceRoot) => {
      writeAuthorityAndReceipt(workspaceRoot, { receiptState: "none" });
      const result = findConsumedRegenerationRetryBudgetExtension("proj-a", stage, baseJob, { workspaceRoot });
      assert.equal(result, undefined);
    });
  });

  await scenario("receipt state is 'aborted', not 'consumed' -> undefined", async () => {
    await withTempDir(async (workspaceRoot) => {
      writeAuthorityAndReceipt(workspaceRoot, { receiptState: "aborted" });
      const result = findConsumedRegenerationRetryBudgetExtension("proj-a", stage, baseJob, { workspaceRoot });
      assert.equal(result, undefined);
    });
  });

  await scenario("stale receipt.jobVersion (doesn't match current job.updatedAt) -> undefined", async () => {
    await withTempDir(async (workspaceRoot) => {
      writeAuthorityAndReceipt(workspaceRoot, { receiptJobVersion: "2020-01-01T00:00:00.000Z" });
      const result = findConsumedRegenerationRetryBudgetExtension("proj-a", stage, baseJob, { workspaceRoot });
      assert.equal(result, undefined);
    });
  });

  await scenario("corrupt authority JSON -> undefined (fail-closed, not a throw)", async () => {
    await withTempDir(async (workspaceRoot) => {
      writeAuthorityAndReceipt(workspaceRoot, { corruptAuthority: true });
      const result = findConsumedRegenerationRetryBudgetExtension("proj-a", stage, baseJob, { workspaceRoot });
      assert.equal(result, undefined);
    });
  });

  await scenario("corrupt receipt JSON -> undefined (fail-closed, not a throw)", async () => {
    await withTempDir(async (workspaceRoot) => {
      writeAuthorityAndReceipt(workspaceRoot, { corruptReceipt: true });
      const result = findConsumedRegenerationRetryBudgetExtension("proj-a", stage, baseJob, { workspaceRoot });
      assert.equal(result, undefined);
    });
  });

  await scenario("duplicate/stale retry: an OLDER job.updatedAt (pre-admission) never matches the newer consumed receipt", async () => {
    await withTempDir(async (workspaceRoot) => {
      writeAuthorityAndReceipt(workspaceRoot); // receipt bound to baseJob.updatedAt
      const staleJob = { ...baseJob, updatedAt: "2020-01-01T00:00:00.000Z" };
      const result = findConsumedRegenerationRetryBudgetExtension("proj-a", stage, staleJob, { workspaceRoot });
      assert.equal(result, undefined);
    });
  });

  await scenario("everything matches -> returns the authority, body, and consumed receipt", async () => {
    await withTempDir(async (workspaceRoot) => {
      const authorityId = writeAuthorityAndReceipt(workspaceRoot);
      const result = findConsumedRegenerationRetryBudgetExtension("proj-a", stage, baseJob, { workspaceRoot });
      assert.ok(result);
      assert.equal(result?.authorityId, authorityId);
      assert.equal(result?.body.priorJob.attempts, baseJob.attempts - 1);
      assert.equal(result?.body.authorizedDurableOrdinal, baseJob.attempts + 1);
      assert.equal(result?.receipt.state, "consumed");
      assert.equal(result?.receipt.jobVersion, baseJob.updatedAt);
    });
  });

  await scenario("findMatchingRegenerationRetryBudgetExtension (unchanged) still excludes the now-consumed authority", async () => {
    // Proves the two functions really are mirror-images and neither call
    // site could accidentally use the wrong one.
    await withTempDir(async (workspaceRoot) => {
      writeAuthorityAndReceipt(workspaceRoot);
      const { findMatchingRegenerationRetryBudgetExtension } = await import(
        "../src/lib/production/ProductionPipelineRegenerationRetryBudgetExtension");
      const matching = findMatchingRegenerationRetryBudgetExtension(
        "proj-a", stage, baseJob, baseJob.attempts + 1, { workspaceRoot },
      );
      assert.equal(matching, undefined, "a consumed authority must not match the pre-consumption finder");
      const consumedMatch = findConsumedRegenerationRetryBudgetExtension(
        "proj-a", stage, baseJob, { workspaceRoot },
      );
      assert.ok(consumedMatch, "but it must match the post-consumption finder");
    });
  });
}

// ─────────────── Section B: real fixture (mirrors smoke-regeneration- ───────────────
// ─────────────── retry-budget-extension-e2e.ts's proven buildFixture) ───────────────

function identityFor(projectSlug: string, operation: string,
  planned: ReturnType<typeof buildProductionPipelineExecutionIdentity>) {
  const authorization = {
    schemaVersion: "1" as const, decisionId: `authorization-${planned.recordId}`,
    decision: "allow" as const, authorized: true as const, reasonCode: "AUTHORIZED" as const,
    reason: "trusted guard-smoke fixture", evaluatedAt: timestamp,
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
    reasonCode: "CONFIRMATION_VALID" as const, reason: "trusted guard-smoke fixture",
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

interface Fixture {
  readonly tempRoot: string;
  readonly projectSlug: string;
  readonly jobId: string;
  readonly regenerationId: string;
  readonly storageContext: ReturnType<typeof createRuntimeStorageContext>;
  readonly operationContext: ReturnType<typeof createProductionRuntimeOperationContext>;
  readonly projectRoot: string;
}

async function buildFixture(): Promise<Fixture> {
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "atolye-runner-guard-e2e-"));
  const projectSlug = `runner-guard-e2e-${randomUUID().replace(/-/g, "").slice(0, 12)}`;
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
    operationId: `runner-guard-e2e-${randomUUID()}`,
    operationType: "runner-guard-e2e-smoke",
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
    projectId: "guard-e2e-project-id", fromStage: "assembly", generationOrdinal: 2,
    planFingerprint: "plan-fingerprint-guard-e2e", reasonCode: "operator-approved",
    backupId: "backup-guard-e2e", backupManifestFingerprint: "backup-manifest-guard-e2e",
    exactPrestateFingerprint: "prestate-guard-e2e", preservedStages: [],
    affectedStages: ["assembly", "thumbnail", "seo", "youtube", "export"],
    createdAt: timestamp,
    mutations: [{
      relativePath: "pipeline-jobs.json", preSha256: null, postSha256: "post-sha-guard-e2e",
      postBase64: Buffer.from(JSON.stringify(jobsPostState), "utf8").toString("base64"),
      writeOnce: true,
    }],
  };
  fs.writeFileSync(path.join(intentDir, "intent.json"), JSON.stringify(intent, null, 2) + "\n");

  const durableRoot = path.join(projectRoot, "production-execution");
  const adapter = new ProductionExecutionFilePersistenceAdapter({
    trustedRootDirectory: durableRoot, trustedAttemptIdFactory: () => "guard-e2e-fixture",
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

  const body = buildProductionPipelineRegenerationRetryBudgetExtensionBody({
    schemaVersion: regenerationRetryBudgetExtensionSchemaVersion,
    policyVersion: regenerationRetryBudgetExtensionPolicyVersion,
    authorityId: "regen-auth-guard-e2e", issuedAt: timestamp,
    projectSlug, stage, jobId, regenerationId, generationOrdinal: 2,
    currentDurableOrdinal: jobAttempts + 1, authorizedDurableOrdinal: jobAttempts + 2,
    reason: "operator-approved-reopen-orphaned-attempt",
    priorJob: { id: jobId, status: "failed", attempts: jobAttempts,
      attemptWithinGeneration: jobAttemptWithinGeneration, updatedAt: timestamp,
      fingerprint: "fingerprint-placeholder" },
  });
  const written = writeRegenerationRetryBudgetExtensionAuthority(projectSlug, body, { workspaceRoot: tempRoot });
  assert.equal(written.ok, true, `fixture authority must write cleanly: ${written.reasonCode}`);

  return { tempRoot, projectSlug, jobId, regenerationId, storageContext, operationContext, projectRoot };
}

async function cleanup(fixture: Fixture): Promise<void> {
  await fsp.rm(fixture.tempRoot, { recursive: true, force: true });
}

/** Replicates exactly the computation PipelineRunner.ts's new branch performs,
 *  against the same real, on-disk post-admission state -- proving the actual
 *  integration contract, not a restatement of the unit tests above. */
async function simulateNewGuardBranch(fixture: Fixture, job: PipelineJob): Promise<boolean> {
  if (!job.regenerationId || !Number.isSafeInteger(job.generationOrdinal)) return false;
  const regenMatch = findConsumedRegenerationRetryBudgetExtension(
    fixture.projectSlug, stage, job, fixture.storageContext,
  );
  if (!regenMatch) return false;
  const adapter = new ProductionExecutionFilePersistenceAdapter({
    trustedRootDirectory: path.join(fixture.projectRoot, "production-execution"),
    createRootDirectory: false,
  });
  // regenerationBindingForExecution() is called internally, without an
  // explicit context, by classifyProductionDurableAttemptLineage -- so it
  // resolves the ambient RuntimeOperationScope (exactly like the real
  // PipelineRunner.resumeOnce() call site does; real production always runs
  // against the single real root regardless, so this scoping only matters
  // for this fixture's own isolated temp root).
  const lineage = await runWithProductionRuntimeOperationContext(
    fixture.operationContext,
    () => classifyProductionDurableAttemptLineage(
      adapter, fixture.projectSlug, stage, regenMatch.body.priorJob.attempts, "exact",
    ),
  );
  return lineage.status === "valid";
}

async function runIntegrationScenarios() {
  const fixture = await buildFixture();
  try {
    let admittedJob: PipelineJob | undefined;
    await scenario("real prepareFailedStageRetry admits the P3-extended generation-2 retry (setup)", async () => {
      const result = await runWithProductionRuntimeOperationContext(
        fixture.operationContext,
        () => prepareFailedStageRetry(fixture.projectSlug, fixture.jobId, "resume", fixture.storageContext),
      );
      assert.equal(result.success, true, !result.success ? `unexpected failure: ${result.reasonCode}` : "");
      if (result.success) {
        assert.equal(result.job.status, "queued");
        assert.equal(result.job.attempts, 6);
        admittedJob = result.job;
      }
    });

    await scenario("the P3 authority now has a real consumed receipt on disk", () => {
      const receipt = readRegenerationRetryBudgetExtensionReceipt(
        fixture.projectSlug, "regen-auth-guard-e2e", "consumed", { workspaceRoot: fixture.tempRoot },
      );
      assert.equal(receipt.ok, true);
      assert.equal(receipt.value?.state, "consumed");
    });

    await scenario("findConsumedRegenerationRetryBudgetExtension matches the REAL post-admission job", () => {
      assert.ok(admittedJob);
      if (!admittedJob) return;
      const match = findConsumedRegenerationRetryBudgetExtension(
        fixture.projectSlug, stage, admittedJob, fixture.storageContext,
      );
      assert.ok(match, "must match against the real disk state prepareFailedStageRetry produced");
      assert.equal(match?.body.priorJob.attempts, 5);
      assert.equal(match?.body.authorizedDurableOrdinal, 7);
    });

    await scenario('classifyProductionDurableAttemptLineage(..., priorJob.attempts=5, "exact") is "valid" against the real post-admission durable store', async () => {
      assert.ok(admittedJob);
      if (!admittedJob) return;
      const match = findConsumedRegenerationRetryBudgetExtension(
        fixture.projectSlug, stage, admittedJob, fixture.storageContext,
      );
      assert.ok(match);
      const adapter = new ProductionExecutionFilePersistenceAdapter({
        trustedRootDirectory: path.join(fixture.projectRoot, "production-execution"),
        createRootDirectory: false,
      });
      const lineage = await runWithProductionRuntimeOperationContext(
        fixture.operationContext,
        () => classifyProductionDurableAttemptLineage(
          adapter, fixture.projectSlug, stage, match!.body.priorJob.attempts, "exact",
        ),
      );
      assert.equal(lineage.status, "valid");
    });

    await scenario('the SAME call with job.attempts (6) instead of priorJob.attempts (5) is "invalid" -- proves the earlier wrong assumption really was wrong, and the fix is necessary', async () => {
      assert.ok(admittedJob);
      if (!admittedJob) return;
      const adapter = new ProductionExecutionFilePersistenceAdapter({
        trustedRootDirectory: path.join(fixture.projectRoot, "production-execution"),
        createRootDirectory: false,
      });
      const lineage = await runWithProductionRuntimeOperationContext(
        fixture.operationContext,
        () => classifyProductionDurableAttemptLineage(
          adapter, fixture.projectSlug, stage, admittedJob!.attempts, "exact",
        ),
      );
      assert.equal(lineage.status, "invalid");
    });

    await scenario("full simulated PipelineRunner.ts branch (regenMatch + exact lineage on priorJob.attempts) resolves isConsumedExtensionResume=true", async () => {
      assert.ok(admittedJob);
      if (!admittedJob) return;
      const resolved = await simulateNewGuardBranch(fixture, admittedJob);
      assert.equal(resolved, true);
    });

    await scenario("duplicate/stale retry: a hand-rolled OLDER job version (simulating a second, unrelated admission) does not resolve", async () => {
      assert.ok(admittedJob);
      if (!admittedJob) return;
      const staleJob: PipelineJob = { ...admittedJob, updatedAt: "2020-01-01T00:00:00.000Z" };
      const resolved = await simulateNewGuardBranch(fixture, staleJob);
      assert.equal(resolved, false);
    });

    await scenario("normal queued job (no regenerationId at all) never engages the new branch — behavior unchanged", async () => {
      const plainJob: PipelineJob = {
        id: "unrelated-project-assembly", projectSlug: "unrelated-project", stage,
        title: "Video Editing", status: "queued", attempts: 1,
        createdAt: timestamp, updatedAt: timestamp,
      };
      const resolved = await simulateNewGuardBranch(fixture, plainJob);
      assert.equal(resolved, false);
    });
  } finally { await cleanup(fixture); }
}

async function main() {
  await runUnitScenarios();
  await runIntegrationScenarios();
  assert.ok(scenarios >= 24);
  process.stdout.write(`PipelineRunner regeneration guard smoke: PASS (${scenarios} scenarios)\n`);
  emitSmokeResult("pipeline-runner-regeneration-guard", scenarios);
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
