import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { emitSmokeResult } from "./lib/SmokeResult";
import { PipelineJobManager } from "../src/lib/pipeline/PipelineJobManager";
import {
  createProductionRuntimeOperationContext,
  initialRuntimeAuthorityGeneration,
} from "../src/lib/runtime/ProductionRuntimeOperationContext";
import { runWithProductionRuntimeOperationContext } from "../src/lib/runtime/RuntimeOperationScope";
import { createRuntimeStorageContext } from "../src/lib/runtime/RuntimeStoragePaths";
import { fingerprintPipelineJob } from "../src/lib/pipeline/PipelineRetryAdmission";
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
import type { PipelineJob, PipelineJobHistoryEvent, PipelineJobList } from
  "../src/types/pipelineJob";
import type { ProductionStepKey } from "../src/types/project";
import type { ProductionExecutionDurableAttemptRecord } from
  "../src/types/productionExecutionDurableAttempt";
import type { ProductionExecutionDurableClaimRecord } from
  "../src/types/productionExecutionDurableClaim";
import type { ProductionExecutionDurableRecord } from
  "../src/types/productionExecutionDurableStorage";
import type { ProductionExecutionIdempotencyRecord } from
  "../src/types/productionExecutionIdempotency";

/**
 * reconcilePipelineJobAttemptDriftFromHistory smoke suite.
 *
 * Proves the new PipelineJobManager.reconcilePipelineJobAttemptDriftFromHistory
 * mechanism against the exact real-world drift pattern found in the real
 * i-stanbul-un-fethi-1453 project (job.attempts=3/attemptWithinGeneration=0/
 * status="queued" vs. canonical attempts=5/attemptWithinGeneration=2, derived
 * from manifest.packages.assembly.attempts.total=6 and 6 matching terminal
 * history events) — reproduced here ONLY as a synthetic, isolated fixture.
 * Real project data is never read or written by this suite.
 *
 * Isolation mirrors smoke-compensate-prepared-retry-monotonic-guard.ts: a
 * fresh createRuntimeStorageContext bound via
 * runWithProductionRuntimeOperationContext(), which every ambient-resolving
 * call this function makes (readJobList/writeJobList/readHistory,
 * ProjectReader/ProjectWriter/ProjectManager, and
 * resolveRuntimeStorageContext({}) for listRegenerationExecutionBindings)
 * picks up automatically. No ATOLYE_WORKSPACE_ROOT env mutation.
 */

const stage: ProductionStepKey = "assembly";
const otherStage: ProductionStepKey = "thumbnail";
const timestamp0 = "2026-08-20T00:00:00.000Z";

let scenarios = 0;
async function scenario(name: string, action: () => Promise<void> | void): Promise<void> {
  await action();
  scenarios += 1;
  process.stdout.write(`PASS ${scenarios}: ${name}\n`);
}

function buildJob(overrides: Partial<PipelineJob> & { id: string; projectSlug: string }): PipelineJob {
  return {
    stage, title: "Video Editing", status: "queued", attempts: 0,
    createdAt: timestamp0, updatedAt: timestamp0,
    ...overrides,
  };
}

function historyEvent(overrides: Partial<PipelineJobHistoryEvent> &
  { id: string; jobId: string; stage: ProductionStepKey }): PipelineJobHistoryEvent {
  return {
    status: "failed", jobCreatedAt: timestamp0, jobUpdatedAt: timestamp0,
    recordedAt: timestamp0,
    ...overrides,
  };
}

function regenId(seed: string): string {
  return `pipeline-regen-${crypto.createHash("sha256").update(seed).digest("hex").slice(0, 48)}`;
}

// ─────────────────────── durable "real attempt" fixture (mirrors
// scripts/smoke-durable-attempt-lineage-orphan-tolerance.ts's canonicalRecord/
// canonicalAttempt/canonicalClaim exactly, parameterized per-fixture) ───────

function identityFor(
  projectSlug: string, operation: string, ts: string,
  planned: ReturnType<typeof buildProductionPipelineExecutionIdentity>,
) {
  const authorization = {
    schemaVersion: "1" as const, decisionId: `authorization-${planned.recordId}`,
    decision: "allow" as const, authorized: true as const, reasonCode: "AUTHORIZED" as const,
    reason: "trusted drift-reconciliation fixture", evaluatedAt: ts,
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
    reasonCode: "CONFIRMATION_VALID" as const, reason: "trusted drift-reconciliation fixture",
    evaluatedAt: ts, confirmationId: `confirmation-${planned.recordId}`,
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
    evaluatedAt: ts,
    policy: { ...defaultProductionExecutionIdempotencyPolicy, enabled: true,
      maximumAttemptsByAction: {
        ...defaultProductionExecutionIdempotencyPolicy.maximumAttemptsByAction,
        "retry-stage": 10,
      } },
  });
  assert.equal(result.ok, true);
  assert.ok(result.identity);
  return result.identity!;
}

function canonicalRecord(projectSlug: string, ts: string, ordinal: number): ProductionExecutionDurableRecord {
  const planned = buildProductionPipelineExecutionIdentity(
    { projectSlug, stage, runType: "resume" },
    { id: `${projectSlug}-${stage}`, attempts: ordinal - 1 },
  );
  const identity = identityFor(projectSlug, "pipeline.stage.resume", ts, planned);
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
    createdAt: ts, updatedAt: ts, reservedAt: ts, finishedAt: ts,
    evidence: ["source:pipeline-composition"],
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

function canonicalAttempt(
  projectSlug: string, ts: string, ordinal: number, record: ProductionExecutionIdempotencyRecord,
): ProductionExecutionDurableAttemptRecord {
  const planned = buildProductionPipelineExecutionIdentity(
    { projectSlug, stage, runType: "resume" },
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
    state: "failed", attemptVersion: 1, openedAt: ts, updatedAt: ts,
    finalizedAt: ts, journal: [journal(planned.attemptId, ts)],
    evidence: ["coordination:single-record", "transactional:false"],
  });
}

function canonicalClaim(
  record: ProductionExecutionDurableRecord,
  attempt: ProductionExecutionDurableAttemptRecord,
  ts: string,
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
    state: "abandoned" as const, claimVersion: 1, acquiredAt: ts,
    updatedAt: ts, abandonedAt: ts, evidence: ["fixture:terminal-claim"],
  };
  return { ...body, integrity: { algorithm: "stable-production-id-v1",
    fingerprint: stableProductionId("durable-claim-integrity", body) } };
}

async function writeRealAttempt(
  adapter: ProductionExecutionFilePersistenceAdapter, projectSlug: string, ts: string, ordinal: number,
): Promise<void> {
  const record = canonicalRecord(projectSlug, ts, ordinal);
  const attempt = canonicalAttempt(projectSlug, ts, ordinal, record);
  const claim = canonicalClaim(record, attempt, ts);
  assert.equal((await adapter.write("idempotency", `${record.recordId}-v1`, record)).ok, true);
  assert.equal((await adapter.write("attempt", `${attempt.identity.attemptId}-v1`, attempt)).ok, true);
  assert.equal((await adapter.write("claim", `${claim.identity.claimId}-v1`, claim)).ok, true);
}

// ───────────────────────────── fixture builder ─────────────────────────────

interface RegenerationIntentSpec {
  readonly id: string;
  readonly generationOrdinal: number;
  readonly affectedStages: readonly ProductionStepKey[];
  readonly assemblyAttemptsAtPrep: number;
}

interface ManifestPackageSpec {
  readonly status: string;
  readonly attemptsTotal: number;
}

interface Fixture {
  readonly tempRoot: string;
  readonly projectSlug: string;
  readonly operationContext: ReturnType<typeof createProductionRuntimeOperationContext>;
  readonly projectRoot: string;
  readonly durableAdapter: ProductionExecutionFilePersistenceAdapter;
}

function freshProjectSlug(): string {
  return `drift-reconcile-${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

async function buildFixture(options: {
  projectSlug: string;
  jobs: readonly PipelineJob[];
  events: readonly PipelineJobHistoryEvent[];
  manifestPackages: Partial<Record<ProductionStepKey, ManifestPackageSpec>>;
  regenerationIntents?: readonly RegenerationIntentSpec[];
  durableAttemptOrdinals?: readonly number[];
}): Promise<Fixture> {
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "atolye-drift-reconcile-"));
  const projectSlug = options.projectSlug;
  const projectId = `${projectSlug}-id`;

  const storageContext = createRuntimeStorageContext({
    workspaceRoot: tempRoot,
    environment: {
      ATOLYE_RUNTIME_ROOT: path.join(tempRoot, "data"),
      ATOLYE_RUNTIME_AUTHORITY_ROOT: path.join(tempRoot, "authority"),
    },
  });
  const operationContext = createProductionRuntimeOperationContext({
    operationId: `drift-reconcile-${crypto.randomUUID()}`,
    operationType: "drift-reconciliation-smoke",
    authorityGeneration: initialRuntimeAuthorityGeneration,
    storageContext,
  });

  const projectRoot = path.join(storageContext.projectsRoot, projectSlug);
  fs.mkdirSync(projectRoot, { recursive: true });

  fs.writeFileSync(path.join(projectRoot, "project.json"), JSON.stringify({
    id: projectId, slug: projectSlug, title: "Drift Reconciliation Fixture",
    status: "assembly", createdAt: timestamp0, updatedAt: timestamp0,
  }, null, 2) + "\n");

  const manifestPackages: Record<string, unknown> = {};
  for (const [key, spec] of Object.entries(options.manifestPackages)) {
    manifestPackages[key] = {
      key, status: spec.status, fileName: `${key}.json`, updatedAt: timestamp0,
      attempts: { total: spec.attemptsTotal, retry: 0 },
    };
  }
  fs.writeFileSync(path.join(projectRoot, "manifest.json"), JSON.stringify({
    project: { id: projectId, slug: projectSlug, title: "Drift Reconciliation Fixture",
      status: "assembly", createdAt: timestamp0, updatedAt: timestamp0 },
    projectId, slug: projectSlug, version: 1, packages: manifestPackages,
    createdAt: timestamp0, updatedAt: timestamp0,
  }, null, 2) + "\n");

  const jobList: PipelineJobList = {
    projectSlug, createdAt: timestamp0, updatedAt: timestamp0,
    jobs: options.jobs.map((job) => ({ ...job, projectSlug })),
  };
  fs.writeFileSync(path.join(projectRoot, "pipeline-jobs.json"), JSON.stringify(jobList, null, 2) + "\n");

  fs.writeFileSync(path.join(projectRoot, "pipeline-history.json"), JSON.stringify({
    projectSlug, createdAt: timestamp0, updatedAt: timestamp0,
    events: options.events,
  }, null, 2) + "\n");

  for (const intent of options.regenerationIntents ?? []) {
    const jobsSnapshot = {
      projectSlug, createdAt: timestamp0, updatedAt: timestamp0,
      jobs: [{ id: `${projectSlug}-assembly`, projectSlug, stage: "assembly",
        title: "Video Editing", status: "failed", attempts: intent.assemblyAttemptsAtPrep,
        createdAt: timestamp0, updatedAt: timestamp0 }],
    };
    const jobsSnapshotText = JSON.stringify(jobsSnapshot);
    const intentDir = path.join(
      projectRoot, "pipeline-regeneration", "regenerations", intent.id);
    fs.mkdirSync(intentDir, { recursive: true });
    fs.writeFileSync(path.join(intentDir, "intent.json"), JSON.stringify({
      schemaVersion: "pipeline-regeneration-v1",
      regenerationId: intent.id, projectSlug, projectId,
      fromStage: "video", generationOrdinal: intent.generationOrdinal,
      planFingerprint: `plan-${intent.id}`, reasonCode: "fixture",
      backupId: `backup-${intent.id}`, backupManifestFingerprint: `backup-manifest-${intent.id}`,
      exactPrestateFingerprint: `prestate-${intent.id}`,
      preservedStages: [], affectedStages: intent.affectedStages, createdAt: timestamp0,
      mutations: [{ relativePath: "pipeline-jobs.json", preSha256: null,
        postSha256: crypto.createHash("sha256").update(jobsSnapshotText).digest("hex"),
        postBase64: Buffer.from(jobsSnapshotText, "utf8").toString("base64"), writeOnce: true }],
    }, null, 2) + "\n");
  }

  const durableAdapter = new ProductionExecutionFilePersistenceAdapter({
    trustedRootDirectory: path.join(projectRoot, "production-execution"),
    createRootDirectory: true,
  });
  for (const ordinal of options.durableAttemptOrdinals ?? []) {
    await writeRealAttempt(durableAdapter, projectSlug, timestamp0, ordinal);
  }

  return { tempRoot, projectSlug, operationContext, projectRoot, durableAdapter };
}

async function cleanup(fixture: Fixture): Promise<void> {
  await fsp.rm(fixture.tempRoot, { recursive: true, force: true });
}

function jobsFileBytes(fixture: Fixture): Buffer {
  return fs.readFileSync(path.join(fixture.projectRoot, "pipeline-jobs.json"));
}

function readJob(fixture: Fixture, jobId: string): PipelineJob {
  const jobs = JSON.parse(fs.readFileSync(
    path.join(fixture.projectRoot, "pipeline-jobs.json"), "utf8")) as PipelineJobList;
  const job = jobs.jobs.find((item) => item.id === jobId);
  assert.ok(job, `expected job ${jobId} to exist`);
  return job!;
}

function run<T>(fixture: Fixture, action: () => Promise<T>): Promise<T> {
  return runWithProductionRuntimeOperationContext(fixture.operationContext, action);
}

// The exact real-drift shape: 6 lifetime terminal events split 3/3 across two
// generations, gen-2's own frozen prep-time snapshot showing assembly
// attempts=3 (generationStartAttempt=3) -> canonical attempts=5,
// canonical attemptWithinGeneration=5-3=2.
function realDriftEvents(jobId: string): PipelineJobHistoryEvent[] {
  return [1, 2, 3, 4, 5, 6].map((n) => historyEvent({
    id: `${jobId}-failed-${n}`, jobId, stage, status: "failed",
    recordedAt: `2026-08-20T00:0${n}:00.000Z`,
    generationOrdinal: n <= 3 ? 1 : 2, attemptWithinGeneration: n <= 3 ? n - 1 : n - 4,
  }));
}

function realDriftRegenerationIntents(): RegenerationIntentSpec[] {
  return [
    { id: regenId("gen1"), generationOrdinal: 1, affectedStages: ["assembly"], assemblyAttemptsAtPrep: 0 },
    { id: regenId("gen2"), generationOrdinal: 2, affectedStages: ["assembly"], assemblyAttemptsAtPrep: 3 },
  ];
}

const gen2Id = regenId("gen2");
const gen1Id = regenId("gen1");

async function main() {
  // ═══════════ 1) Exact real drift pattern → reconcile succeeds ═══════════
  await scenario("real drift pattern: attempts 3->5, attemptWithinGeneration 0->2, status queued->failed", async () => {
    const projectSlug = freshProjectSlug();
    const jobId = `${projectSlug}-assembly`;
    const job = buildJob({ id: jobId, projectSlug: "x", status: "queued",
      attempts: 3, generationOrdinal: 2, attemptWithinGeneration: 0, regenerationId: gen2Id });
    const fixture = await buildFixture({
      projectSlug, jobs: [job], events: realDriftEvents(jobId),
      manifestPackages: { assembly: { status: "failed", attemptsTotal: 6 } },
      regenerationIntents: realDriftRegenerationIntents(),
    });
    try {
      const expected = { updatedAt: job.updatedAt, attempts: job.attempts };
      const result = await run(fixture, () =>
        PipelineJobManager.reconcilePipelineJobAttemptDriftFromHistory(
          fixture.projectSlug, jobId, expected));
      assert.equal(result.ok, true);
      assert.equal(result.reasonCode, "PIPELINE_JOB_ATTEMPT_DRIFT_RECONCILED");
      assert.equal(result.writeFree, false);
      assert.equal(result.canonical?.attempts, 5);
      assert.equal(result.canonical?.attemptWithinGeneration, 2);
      const written = readJob(fixture, jobId);
      assert.equal(written.attempts, 5);
      assert.equal(written.attemptWithinGeneration, 2);
      assert.equal(written.status, "failed");
      assert.equal(written.error, undefined); // history events in this fixture never set errorCode
      assert.ok(written.completedAt);
    } finally { await cleanup(fixture); }
  });

  // ═══════════ 2) Already canonical → explicit no-op, write-free ═══════════
  await scenario("already canonical (attempts, attemptWithinGeneration, status all match): write-free no-op", async () => {
    const projectSlug = freshProjectSlug();
    const jobId = `${projectSlug}-assembly`;
    const job = buildJob({ id: jobId, projectSlug: "x", status: "failed",
      attempts: 5, generationOrdinal: 2, attemptWithinGeneration: 2, regenerationId: gen2Id });
    const fixture = await buildFixture({
      projectSlug, jobs: [job], events: realDriftEvents(jobId),
      manifestPackages: { assembly: { status: "failed", attemptsTotal: 6 } },
      regenerationIntents: realDriftRegenerationIntents(),
    });
    try {
      const before = jobsFileBytes(fixture);
      const expected = { updatedAt: job.updatedAt, attempts: job.attempts };
      const result = await run(fixture, () =>
        PipelineJobManager.reconcilePipelineJobAttemptDriftFromHistory(
          fixture.projectSlug, jobId, expected));
      assert.equal(result.ok, true);
      assert.equal(result.reasonCode, "PIPELINE_JOB_ATTEMPT_DRIFT_ALREADY_RECONCILED");
      assert.equal(result.writeFree, true);
      assert.deepEqual(jobsFileBytes(fixture), before);
    } finally { await cleanup(fixture); }
  });

  // ═══════════ 3) Current ahead of canonical → fail-closed, no write ═══════════
  await scenario("job.attempts already ahead of canonical: fail-closed, byte-identical", async () => {
    const projectSlug = freshProjectSlug();
    const jobId = `${projectSlug}-assembly`;
    const job = buildJob({ id: jobId, projectSlug: "x", status: "queued",
      attempts: 7, generationOrdinal: 2, attemptWithinGeneration: 4, regenerationId: gen2Id });
    const fixture = await buildFixture({
      projectSlug, jobs: [job], events: realDriftEvents(jobId),
      manifestPackages: { assembly: { status: "failed", attemptsTotal: 6 } },
      regenerationIntents: realDriftRegenerationIntents(),
    });
    try {
      const before = jobsFileBytes(fixture);
      const expected = { updatedAt: job.updatedAt, attempts: job.attempts };
      const result = await run(fixture, () =>
        PipelineJobManager.reconcilePipelineJobAttemptDriftFromHistory(
          fixture.projectSlug, jobId, expected));
      assert.equal(result.ok, false);
      assert.equal(result.reasonCode, "PIPELINE_JOB_ATTEMPT_DRIFT_AHEAD_OF_CANONICAL");
      assert.equal(result.writeFree, true);
      assert.deepEqual(jobsFileBytes(fixture), before);
    } finally { await cleanup(fixture); }
  });

  // ═══════════ 4) History count inconsistency vs manifest → fail-closed ═══════════
  await scenario("history terminal count disagrees with manifest.attempts.total: fail-closed, byte-identical", async () => {
    const projectSlug = freshProjectSlug();
    const jobId = `${projectSlug}-assembly`;
    const job = buildJob({ id: jobId, projectSlug: "x", status: "queued", attempts: 3 });
    // manifest claims 6 executions, but only 4 terminal events are on record.
    const events = [1, 2, 3, 4].map((n) => historyEvent({
      id: `${jobId}-failed-${n}`, jobId, stage, status: "failed",
      recordedAt: `2026-08-20T00:0${n}:00.000Z`,
    }));
    const fixture = await buildFixture({
      projectSlug, jobs: [job], events,
      manifestPackages: { assembly: { status: "failed", attemptsTotal: 6 } },
    });
    try {
      const before = jobsFileBytes(fixture);
      const expected = { updatedAt: job.updatedAt, attempts: job.attempts };
      const result = await run(fixture, () =>
        PipelineJobManager.reconcilePipelineJobAttemptDriftFromHistory(
          fixture.projectSlug, jobId, expected));
      assert.equal(result.ok, false);
      assert.equal(result.reasonCode, "PIPELINE_JOB_ATTEMPT_DRIFT_HISTORY_MANIFEST_MISMATCH");
      assert.equal(result.writeFree, true);
      assert.deepEqual(jobsFileBytes(fixture), before);
    } finally { await cleanup(fixture); }
  });

  // ═══════════ 5) Manifest status vs. latest history event status disagree → fail-closed ═══════════
  await scenario("manifest status disagrees with the latest terminal history event's status: fail-closed, byte-identical", async () => {
    const projectSlug = freshProjectSlug();
    const jobId = `${projectSlug}-assembly`;
    const job = buildJob({ id: jobId, projectSlug: "x", status: "queued", attempts: 3 });
    // 6 terminal events (count matches), but manifest claims "completed"
    // while the latest recorded event says "failed".
    const events = [1, 2, 3, 4, 5, 6].map((n) => historyEvent({
      id: `${jobId}-failed-${n}`, jobId, stage, status: "failed",
      recordedAt: `2026-08-20T00:0${n}:00.000Z`,
    }));
    const fixture = await buildFixture({
      projectSlug, jobs: [job], events,
      manifestPackages: { assembly: { status: "completed", attemptsTotal: 6 } },
    });
    try {
      const before = jobsFileBytes(fixture);
      const expected = { updatedAt: job.updatedAt, attempts: job.attempts };
      const result = await run(fixture, () =>
        PipelineJobManager.reconcilePipelineJobAttemptDriftFromHistory(
          fixture.projectSlug, jobId, expected));
      assert.equal(result.ok, false);
      assert.equal(result.reasonCode, "PIPELINE_JOB_ATTEMPT_DRIFT_HISTORY_MANIFEST_MISMATCH");
      assert.equal(result.writeFree, true);
      assert.deepEqual(jobsFileBytes(fixture), before);
    } finally { await cleanup(fixture); }
  });

  // ═══════════ 6) Durable lineage inconsistency → fail-closed ═══════════
  await scenario("durable execution store disagrees with canonical executionTotal: fail-closed, byte-identical", async () => {
    const projectSlug = freshProjectSlug();
    const jobId = `${projectSlug}-assembly`;
    const job = buildJob({ id: jobId, projectSlug: "x", status: "queued",
      attempts: 3, generationOrdinal: 2, attemptWithinGeneration: 0, regenerationId: gen2Id });
    const fixture = await buildFixture({
      projectSlug, jobs: [job], events: realDriftEvents(jobId),
      manifestPackages: { assembly: { status: "failed", attemptsTotal: 6 } },
      regenerationIntents: realDriftRegenerationIntents(),
      // Only a single real durable attempt exists, but manifest+history claim 6.
      durableAttemptOrdinals: [1],
    });
    try {
      const before = jobsFileBytes(fixture);
      const expected = { updatedAt: job.updatedAt, attempts: job.attempts };
      const result = await run(fixture, () =>
        PipelineJobManager.reconcilePipelineJobAttemptDriftFromHistory(
          fixture.projectSlug, jobId, expected));
      assert.equal(result.ok, false);
      assert.equal(result.reasonCode, "PIPELINE_JOB_ATTEMPT_DRIFT_DURABLE_LINEAGE_MISMATCH");
      assert.equal(result.writeFree, true);
      assert.deepEqual(jobsFileBytes(fixture), before);
    } finally { await cleanup(fixture); }
  });

  // ═══════════ 7) Wrong expected fingerprint/version → CAS rejection ═══════════
  await scenario("CAS conflict: stale expected.attempts / expected.updatedAt / wrong fingerprint each refuse, byte-identical", async () => {
    const projectSlug = freshProjectSlug();
    const jobId = `${projectSlug}-assembly`;
    const job = buildJob({ id: jobId, projectSlug: "x", status: "queued",
      attempts: 3, generationOrdinal: 2, attemptWithinGeneration: 0, regenerationId: gen2Id });
    const fixture = await buildFixture({
      projectSlug, jobs: [job], events: realDriftEvents(jobId),
      manifestPackages: { assembly: { status: "failed", attemptsTotal: 6 } },
      regenerationIntents: realDriftRegenerationIntents(),
    });
    try {
      const before = jobsFileBytes(fixture);
      const wrongAttempts = await run(fixture, () =>
        PipelineJobManager.reconcilePipelineJobAttemptDriftFromHistory(
          fixture.projectSlug, jobId, { updatedAt: job.updatedAt, attempts: 999 }));
      assert.equal(wrongAttempts.ok, false);
      assert.equal(wrongAttempts.reasonCode, "PIPELINE_JOB_ATTEMPT_DRIFT_CAS_CONFLICT");

      const wrongUpdatedAt = await run(fixture, () =>
        PipelineJobManager.reconcilePipelineJobAttemptDriftFromHistory(
          fixture.projectSlug, jobId, { updatedAt: "2099-01-01T00:00:00.000Z", attempts: job.attempts }));
      assert.equal(wrongUpdatedAt.ok, false);
      assert.equal(wrongUpdatedAt.reasonCode, "PIPELINE_JOB_ATTEMPT_DRIFT_CAS_CONFLICT");

      const wrongFingerprint = await run(fixture, () =>
        PipelineJobManager.reconcilePipelineJobAttemptDriftFromHistory(
          fixture.projectSlug, jobId,
          { updatedAt: job.updatedAt, attempts: job.attempts, fingerprint: "not-the-real-fingerprint" }));
      assert.equal(wrongFingerprint.ok, false);
      assert.equal(wrongFingerprint.reasonCode, "PIPELINE_JOB_ATTEMPT_DRIFT_CAS_CONFLICT");

      assert.deepEqual(jobsFileBytes(fixture), before);

      // Sanity: the CORRECT fingerprint is accepted (proves the mismatch
      // above was a genuine rejection, not an always-refuse bug).
      const correctFingerprint = fingerprintPipelineJob({ ...job, projectSlug: fixture.projectSlug });
      const accepted = await run(fixture, () =>
        PipelineJobManager.reconcilePipelineJobAttemptDriftFromHistory(
          fixture.projectSlug, jobId,
          { updatedAt: job.updatedAt, attempts: job.attempts, fingerprint: correctFingerprint }));
      assert.equal(accepted.ok, true);
    } finally { await cleanup(fixture); }
  });

  // ═══════════ 8) Multi-stage / non-regeneration isolation ═══════════
  await scenario("multi-stage isolation: reconciling assembly never touches an independently-drifted, non-regeneration thumbnail job", async () => {
    const projectSlug = freshProjectSlug();
    const assemblyJobId = `${projectSlug}-assembly`;
    const thumbnailJobId = `${projectSlug}-thumbnail`;
    const assemblyJob = buildJob({ id: assemblyJobId, projectSlug: "x", status: "queued",
      attempts: 3, generationOrdinal: 2, attemptWithinGeneration: 0, regenerationId: gen2Id });
    const thumbnailJob = buildJob({ id: thumbnailJobId, projectSlug: "x", stage: otherStage,
      status: "queued", attempts: 0 });
    const thumbnailEvents = [1, 2, 3].map((n) => historyEvent({
      id: `${thumbnailJobId}-failed-${n}`, jobId: thumbnailJobId, stage: otherStage, status: "failed",
      recordedAt: `2026-08-20T00:1${n}:00.000Z`,
    }));
    const fixture = await buildFixture({
      projectSlug, jobs: [assemblyJob, thumbnailJob],
      events: [...realDriftEvents(assemblyJobId), ...thumbnailEvents],
      manifestPackages: {
        assembly: { status: "failed", attemptsTotal: 6 },
        thumbnail: { status: "failed", attemptsTotal: 3 },
      },
      regenerationIntents: realDriftRegenerationIntents(),
    });
    try {
      const thumbnailBefore = JSON.stringify(readJob(fixture, thumbnailJobId));
      const result = await run(fixture, () =>
        PipelineJobManager.reconcilePipelineJobAttemptDriftFromHistory(
          fixture.projectSlug, assemblyJobId,
          { updatedAt: assemblyJob.updatedAt, attempts: assemblyJob.attempts }));
      assert.equal(result.ok, true);
      assert.equal(readJob(fixture, assemblyJobId).attempts, 5);
      assert.equal(JSON.stringify(readJob(fixture, thumbnailJobId)), thumbnailBefore,
        "thumbnail job (a plain, non-regeneration job) must be completely untouched");

      // Now reconcile the non-regeneration thumbnail job on its own — proves
      // the mechanism also works without any regenerationId/binding at all.
      const assemblyAfterFirst = JSON.stringify(readJob(fixture, assemblyJobId));
      const thumbResult = await run(fixture, () =>
        PipelineJobManager.reconcilePipelineJobAttemptDriftFromHistory(
          fixture.projectSlug, thumbnailJobId,
          { updatedAt: thumbnailJob.updatedAt, attempts: thumbnailJob.attempts }));
      assert.equal(thumbResult.ok, true);
      assert.equal(readJob(fixture, thumbnailJobId).attempts, 2);
      assert.equal(readJob(fixture, thumbnailJobId).attemptWithinGeneration, undefined);
      assert.equal(JSON.stringify(readJob(fixture, assemblyJobId)), assemblyAfterFirst,
        "assembly job must be completely untouched by the thumbnail reconciliation");
    } finally { await cleanup(fixture); }
  });

  // ═══════════ 9) Generation boundary: stale (superseded) generation binding fails closed ═══════════
  await scenario("job pinned to a superseded generation (gen-1) while gen-2 is active for the same stage: fail-closed, byte-identical", async () => {
    const projectSlug = freshProjectSlug();
    const jobId = `${projectSlug}-assembly`;
    // Job still carries gen-1's regenerationId, but gen-2 (which also
    // affects "assembly") is the active/max generation — gen-1's binding is
    // therefore no longer resolvable via listRegenerationExecutionBindings.
    const job = buildJob({ id: jobId, projectSlug: "x", status: "queued",
      attempts: 1, generationOrdinal: 1, attemptWithinGeneration: 1, regenerationId: gen1Id });
    const fixture = await buildFixture({
      projectSlug, jobs: [job], events: realDriftEvents(jobId),
      manifestPackages: { assembly: { status: "failed", attemptsTotal: 6 } },
      regenerationIntents: realDriftRegenerationIntents(),
    });
    try {
      const before = jobsFileBytes(fixture);
      const result = await run(fixture, () =>
        PipelineJobManager.reconcilePipelineJobAttemptDriftFromHistory(
          fixture.projectSlug, jobId, { updatedAt: job.updatedAt, attempts: job.attempts }));
      assert.equal(result.ok, false);
      assert.equal(result.reasonCode, "PIPELINE_JOB_ATTEMPT_DRIFT_REGENERATION_BINDING_MISSING");
      assert.equal(result.writeFree, true);
      assert.deepEqual(jobsFileBytes(fixture), before);
    } finally { await cleanup(fixture); }
  });

  // ═══════════ 10) Concurrent/stale update simulation ═══════════
  await scenario("concurrent modification between snapshot capture and reconciliation call: CAS rejects the now-stale snapshot", async () => {
    const projectSlug = freshProjectSlug();
    const jobId = `${projectSlug}-assembly`;
    const job = buildJob({ id: jobId, projectSlug: "x", status: "queued",
      attempts: 3, generationOrdinal: 2, attemptWithinGeneration: 0, regenerationId: gen2Id });
    const fixture = await buildFixture({
      projectSlug, jobs: [job], events: realDriftEvents(jobId),
      manifestPackages: { assembly: { status: "failed", attemptsTotal: 6 } },
      regenerationIntents: realDriftRegenerationIntents(),
    });
    try {
      // Caller captures `expected` here, at T0.
      const expected = { updatedAt: job.updatedAt, attempts: job.attempts };

      // A concurrent process mutates the job (e.g. a real retry admission)
      // before the reconciliation call actually runs.
      const concurrentlyModified: PipelineJobList = {
        projectSlug: fixture.projectSlug, createdAt: timestamp0,
        updatedAt: "2026-08-20T12:00:00.000Z",
        jobs: [{ ...job, projectSlug: fixture.projectSlug, status: "running",
          updatedAt: "2026-08-20T12:00:00.000Z" }],
      };
      fs.writeFileSync(path.join(fixture.projectRoot, "pipeline-jobs.json"),
        JSON.stringify(concurrentlyModified, null, 2) + "\n");
      const afterConcurrentWrite = jobsFileBytes(fixture);

      const result = await run(fixture, () =>
        PipelineJobManager.reconcilePipelineJobAttemptDriftFromHistory(
          fixture.projectSlug, jobId, expected));
      assert.equal(result.ok, false);
      assert.equal(result.reasonCode, "PIPELINE_JOB_ATTEMPT_DRIFT_CAS_CONFLICT");
      assert.deepEqual(jobsFileBytes(fixture), afterConcurrentWrite,
        "the concurrent writer's state must be preserved untouched, not overwritten by the stale caller");
    } finally { await cleanup(fixture); }
  });

  // ═══════════ 11) Status behavior — proves the chosen Design B ═══════════
  await scenario("status design: queued->failed on reconcile; already-failed-with-canonical-counters stays failed (no regression); counters-only-canonical still flips status", async () => {
    // (a) already covered end-to-end by scenario 1 (queued -> failed) and
    // scenario 2 (failed + canonical -> untouched, write-free). This adds
    // the missing third leg: counters ALREADY canonical but status still
    // "queued" must still be written (status is not incidentally skipped).
    const projectSlug = freshProjectSlug();
    const jobId = `${projectSlug}-assembly`;
    const job = buildJob({ id: jobId, projectSlug: "x", status: "queued",
      attempts: 5, generationOrdinal: 2, attemptWithinGeneration: 2, regenerationId: gen2Id });
    const fixture = await buildFixture({
      projectSlug, jobs: [job], events: realDriftEvents(jobId),
      manifestPackages: { assembly: { status: "failed", attemptsTotal: 6 } },
      regenerationIntents: realDriftRegenerationIntents(),
    });
    try {
      const result = await run(fixture, () =>
        PipelineJobManager.reconcilePipelineJobAttemptDriftFromHistory(
          fixture.projectSlug, jobId, { updatedAt: job.updatedAt, attempts: job.attempts }));
      assert.equal(result.ok, true);
      assert.equal(result.reasonCode, "PIPELINE_JOB_ATTEMPT_DRIFT_RECONCILED");
      assert.equal(result.writeFree, false);
      const written = readJob(fixture, jobId);
      assert.equal(written.status, "failed");
      assert.equal(written.attempts, 5);
      assert.equal(written.attemptWithinGeneration, 2);
    } finally { await cleanup(fixture); }
  });

  await scenario("status ineligibility: running/completed/cancelled jobs are never touched, regardless of counter drift", async () => {
    for (const status of ["running", "completed", "cancelled"] as const) {
      const projectSlug = freshProjectSlug();
      const jobId = `${projectSlug}-assembly`;
      const job = buildJob({ id: jobId, projectSlug: "x", status, attempts: 3 });
      const fixture = await buildFixture({
        projectSlug, jobs: [job], events: realDriftEvents(jobId),
        manifestPackages: { assembly: { status: "failed", attemptsTotal: 6 } },
      });
      try {
        const before = jobsFileBytes(fixture);
        const result = await run(fixture, () =>
          PipelineJobManager.reconcilePipelineJobAttemptDriftFromHistory(
            fixture.projectSlug, jobId, { updatedAt: job.updatedAt, attempts: job.attempts }));
        assert.equal(result.ok, false);
        assert.equal(result.reasonCode, "PIPELINE_JOB_ATTEMPT_DRIFT_STATUS_INELIGIBLE");
        assert.deepEqual(jobsFileBytes(fixture), before);
      } finally { await cleanup(fixture); }
    }
  });

  // ═══════════ 12) Byte-identical rejection across every fail-closed category ═══════════
  await scenario("byte-identical matrix: repeated, varied fail-closed calls against one fixture never accumulate any write", async () => {
    const projectSlug = freshProjectSlug();
    const jobId = `${projectSlug}-assembly`;
    const job = buildJob({ id: jobId, projectSlug: "x", status: "queued",
      attempts: 3, generationOrdinal: 2, attemptWithinGeneration: 0, regenerationId: gen2Id });
    const fixture = await buildFixture({
      projectSlug, jobs: [job], events: realDriftEvents(jobId),
      manifestPackages: { assembly: { status: "failed", attemptsTotal: 6 } },
      regenerationIntents: realDriftRegenerationIntents(),
    });
    try {
      const before = jobsFileBytes(fixture);
      const calls = [
        () => PipelineJobManager.reconcilePipelineJobAttemptDriftFromHistory(
          fixture.projectSlug, jobId, { updatedAt: job.updatedAt, attempts: 999 }), // CAS
        () => PipelineJobManager.reconcilePipelineJobAttemptDriftFromHistory(
          fixture.projectSlug, "no-such-job", { updatedAt: job.updatedAt, attempts: 0 }), // NOT_FOUND
        () => PipelineJobManager.reconcilePipelineJobAttemptDriftFromHistory(
          fixture.projectSlug, jobId, { updatedAt: "wrong", attempts: job.attempts }), // CAS
      ];
      for (const call of calls) {
        const result = await run(fixture, call);
        assert.equal(result.ok, false);
        assert.equal(result.writeFree, true);
        assert.deepEqual(jobsFileBytes(fixture), before,
          `must remain byte-identical after ${result.reasonCode}`);
      }
    } finally { await cleanup(fixture); }
  });

  assert.ok(scenarios >= 12);
  process.stdout.write(`Pipeline job attempt drift reconciliation smoke: PASS (${scenarios} scenarios)\n`);
  emitSmokeResult("pipeline-job-attempt-drift-reconciliation", scenarios);
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
