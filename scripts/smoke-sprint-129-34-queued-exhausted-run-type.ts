import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { ProjectWriter } from "../src/lib/projects/ProjectWriter";
import { prepareProductionPipelineExecution } from
  "../src/lib/production/ProductionPipelineExecutionFactory";
import { ProductionExecutionWorkerExecutionService } from
  "../src/lib/production/ProductionExecutionWorker";
import { reconcileFailedPipelineExecution } from
  "../src/lib/production/ProductionPipelineRetryReconciliation";
import { classifyQueuedExhaustedPipelineJobDrift } from
  "../src/lib/production/ProductionQueuedExhaustedDriftClassifier";
import { ProductionExecutionFilePersistenceAdapter } from
  "../src/lib/production/ProductionExecutionPersistence";
import { AdapterBackedProductionExecutionDurableStorage } from
  "../src/lib/production/ProductionExecutionDurableStorage";
import { buildProductionPipelineExecutionIdentity } from
  "../src/lib/production/ProductionPipelineExecutionIdentity";
import { readProductionCanonicalTerminalDurableLineage } from
  "../src/lib/production/ProductionCanonicalDurableLineage";
import { stableProductionId } from "../src/lib/production/ProductionDeterminism";
import { buildProductionExecutionAttemptBindingFingerprint,
  buildProductionExecutionDurableAttemptIntegrity } from
  "../src/lib/production/ProductionExecutionDurableAttemptIntegrity";
import { validateProductionExecutionDurableAttempt } from
  "../src/lib/production/ProductionExecutionDurableAttempt";
import { validateProductionExecutionDurableClaim } from
  "../src/lib/production/ProductionExecutionDurableClaim";
import { buildProductionExecutionIdempotencyIdentity,
  defaultProductionExecutionIdempotencyPolicy,
  validateProductionExecutionIdempotencyReservation } from
  "../src/lib/production/ProductionExecutionIdempotency";
import { validateProductionExecutionPersistencePayload } from
  "../src/lib/production/ProductionExecutionPersistence";
import { validateProductionExecutionDurableLease } from
  "../src/lib/production/ProductionExecutionDurableLease";
import { classifyProductionDurableAttemptLineage } from
  "../src/lib/production/ProductionDurableAttemptLineageClassifier";
import type { PipelineJob, PipelineJobHistory, PipelineJobList } from
  "../src/types/pipelineJob";
import type { ProductionExecutionDurableClaimRecord } from
  "../src/types/productionExecutionDurableClaim";
import type { ProductionExecutionDurableAttemptRecord } from
  "../src/types/productionExecutionDurableAttempt";
import type { ProductionExecutionDurableRecord } from
  "../src/types/productionExecutionDurableStorage";
import type { ProductionExecutionIdempotencyReservationRequest } from
  "../src/types/productionExecutionIdempotency";
import type { ProductionExecutionPersistenceAdapter,
  ProductionExecutionPersistenceRecordKind } from
  "../src/types/productionExecutionPersistence";
import type { ProjectManifest, ProjectPackageRunType, ProductionStepKey } from
  "../src/types/project";
import { withCanonicalSmokeRuntime } from "./lib/CanonicalSmokeRuntime";
import { emitSmokeResult } from "./lib/SmokeResult";

const anchor = "2026-08-02T10:00:00.000Z";
const stage: ProductionStepKey = "audio";
const failureCode = "AUDIO_ASSET_GENERATION_FAILED";
let passed = 0;

async function test(name: string, action: () => Promise<void>) {
  await action();
  passed += 1;
  process.stdout.write(`PASS ${passed}: ${name}\n`);
}

async function createFixture(
  runtimeRoot: string,
  projectSlug: string,
  terminalRunType: Extract<ProjectPackageRunType, "resume" | "retry">,
) {
  const jobId = `${projectSlug}-${stage}`;
  let terminalJob: PipelineJob | undefined;
  let terminalIdentity: ReturnType<typeof buildProductionPipelineExecutionIdentity> | undefined;
  const runTypes: ProjectPackageRunType[] = ["initial", "retry", terminalRunType];

  for (let attempt = 0; attempt < runTypes.length; attempt += 1) {
    const createdAt = new Date(Date.parse(anchor) + attempt * 20_000).toISOString();
    const queued: PipelineJob = {
      id: jobId, projectSlug, stage, title: stage, status: "queued", attempts: attempt,
      createdAt, updatedAt: createdAt,
    };
    await writeJob(projectSlug, queued);
    const prepared = await prepareProductionPipelineExecution({
      projectSlug, stage, runType: runTypes[attempt],
    });
    const execution = await new ProductionExecutionWorkerExecutionService(
      prepared.executionAdapter,
    ).execute(prepared.request, async () => {
      throw Object.assign(new Error("controlled audio failure"), { code: failureCode });
    }, { isCancellationRequested: () => false });
    assert.equal(execution.status, "failed");
    const failedAt = new Date(Date.parse(createdAt) + 5_000).toISOString();
    const failed: PipelineJob = {
      ...queued, status: "failed", updatedAt: failedAt, completedAt: failedAt,
      error: failureCode,
    };
    await writeJob(projectSlug, failed);
    const reconciled = await reconcileFailedPipelineExecution(
      failed, () => new Date(Date.parse(failedAt) + 1_000).toISOString(),
    );
    assert.equal(reconciled.ok, true, JSON.stringify(reconciled));
    terminalJob = failed;
    terminalIdentity = buildProductionPipelineExecutionIdentity(
      { projectSlug, stage, runType: runTypes[attempt] }, { id: jobId, attempts: attempt },
    );
  }

  assert.ok(terminalJob && terminalIdentity);
  const drift: PipelineJob = {
    ...terminalJob, status: "queued", attempts: 3,
    updatedAt: new Date(Date.parse(terminalJob.updatedAt) + 2_000).toISOString(),
    startedAt: undefined, completedAt: undefined, error: undefined, errorEvidence: undefined,
  };
  const jobs: PipelineJobList = {
    projectSlug, jobs: [drift], createdAt: anchor, updatedAt: drift.updatedAt,
  };
  const history: PipelineJobHistory = {
    projectSlug,
    events: [{
      id: `${jobId}-failed-3`, jobId, stage, status: "failed",
      jobCreatedAt: terminalJob.createdAt, jobUpdatedAt: terminalJob.updatedAt,
      completedAt: terminalJob.completedAt, recordedAt: terminalJob.updatedAt,
      errorCode: failureCode,
    }],
    createdAt: anchor, updatedAt: terminalJob.updatedAt,
  };
  const packages = Object.fromEntries([
    "research", "script", "scenes", "visuals", "animation", "video", "audio",
    "assembly", "thumbnail", "seo", "youtube", "export",
  ].map((key) => [key, {
    key, status: key === stage ? "failed" : "pending", fileName: `${key}.json`,
    ...(key === stage ? { error: failureCode } : {}),
  }])) as ProjectManifest["packages"];
  const manifest: ProjectManifest = {
    project: { id: `project-${projectSlug}`, slug: projectSlug, title: projectSlug,
      status: "audio", createdAt: anchor, updatedAt: anchor },
    projectId: `project-${projectSlug}`, slug: projectSlug, version: 1, packages,
    createdAt: anchor, updatedAt: anchor,
  };
  const executionRoot = path.join(runtimeRoot, "projects", projectSlug, "production-execution");
  const adapter = new ProductionExecutionFilePersistenceAdapter({
    trustedRootDirectory: executionRoot, createRootDirectory: false,
  });
  return { projectSlug, jobId, jobs, history, manifest, adapter, executionRoot,
    terminalJob, terminalIdentity };
}

async function writeJob(projectSlug: string, job: PipelineJob) {
  await ProjectWriter.writeJSON(projectSlug, "pipeline-jobs.json", {
    projectSlug, jobs: [job], createdAt: job.createdAt, updatedAt: job.updatedAt,
  } satisfies PipelineJobList);
}

async function classify(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  adapter: ProductionExecutionPersistenceAdapter = fixture.adapter,
) {
  return classifyQueuedExhaustedPipelineJobDrift({
    projectSlug: fixture.projectSlug, stage, jobs: fixture.jobs, history: fixture.history,
    manifest: fixture.manifest, adapter,
  });
}

function adapterWithReadMutation(
  base: ProductionExecutionPersistenceAdapter,
  mutate: (kind: ProductionExecutionPersistenceRecordKind, key: string, value: unknown) => unknown,
): ProductionExecutionPersistenceAdapter {
  return {
    write: base.write.bind(base),
    listKeys: base.listKeys.bind(base),
    read: async (kind, key) => {
      const read = await base.read(kind, key);
      if (read.status !== "found") return read;
      return { ...read, value: mutate(kind, key, structuredClone(read.value)) } as never;
    },
  };
}

function withClaimIntegrity(claim: ProductionExecutionDurableClaimRecord) {
  const { integrity: unused, ...body } = claim;
  void unused;
  return { ...body, integrity: { algorithm: "stable-production-id-v1" as const,
    fingerprint: stableProductionId("durable-claim-integrity", body) } };
}

interface DurablePhysicalSnapshot {
  readonly files: readonly { relativePath: string; byteLength: number; sha256: string }[];
  readonly aggregateSha256: string;
}

async function durablePhysicalSnapshot(executionRoot: string): Promise<DurablePhysicalSnapshot> {
  const files: Array<{ relativePath: string; byteLength: number; sha256: string }> = [];
  async function visit(directory: string) {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      const stat = await fs.lstat(absolute);
      assert.equal(stat.isSymbolicLink(), false, `durable symlink rejected: ${absolute}`);
      if (stat.isDirectory()) await visit(absolute);
      else {
        assert.equal(stat.isFile(), true, `durable special entry rejected: ${absolute}`);
        const bytes = await fs.readFile(absolute);
        files.push({
          relativePath: path.relative(executionRoot, absolute).split(path.sep).join("/"),
          byteLength: bytes.length,
          sha256: createHash("sha256").update(bytes).digest("hex"),
        });
      }
    }
  }
  await visit(executionRoot);
  files.sort((left, right) => left.relativePath < right.relativePath ? -1 :
    left.relativePath > right.relativePath ? 1 : 0);
  const material = files.map((file) =>
    `${file.relativePath}\t${file.byteLength}\t${file.sha256}`).join("\n");
  return { files, aggregateSha256: createHash("sha256").update(material, "utf8").digest("hex") };
}

function syntheticIdentity(
  record: ProductionExecutionDurableRecord,
  operation: string,
  executionFingerprint: string,
) {
  const authorization = {
    schemaVersion: "1" as const, decisionId: `sprint-129-34-${record.recordId}`,
    decision: "allow" as const, authorized: true as const, reasonCode: "AUTHORIZED" as const,
    reason: "isolated integrity-valid negative fixture", evaluatedAt: record.createdAt,
    requestId: record.requestId, idempotencyKey: record.idempotencyKey,
    executionFingerprint, actorId: "pipeline-system", actorType: "system" as const,
    projectSlug: record.projectSlug, operation, action: record.action, stage: record.stage,
    requiredCapabilities: [], grantedCapabilities: [], missingCapabilities: [],
    policyVersion: defaultProductionExecutionIdempotencyPolicy.policyVersion,
    risk: "high" as const, requiresConfirmation: true,
    requiredConfirmationLevel: "high" as const, evidence: ["source:sprint-129-34"],
  };
  const confirmation = {
    schemaVersion: "1" as const, decision: "valid" as const, valid: true as const,
    reasonCode: "CONFIRMATION_VALID" as const,
    reason: "isolated integrity-valid negative fixture", evaluatedAt: record.createdAt,
    confirmationId: `confirmation-${record.recordId}`,
    confirmationRequestId: `confirmation-request-${record.recordId}`,
    authorizationDecisionId: authorization.decisionId, requestId: record.requestId,
    idempotencyKey: record.idempotencyKey, actorId: authorization.actorId,
    projectSlug: record.projectSlug, operation, action: record.action, stage: record.stage,
    riskLevel: "high", requiredConfirmationLevel: "high" as const,
    providedConfirmationLevel: "high" as const, bindingMatches: true,
    bindingFingerprint: `binding-${record.recordId}`, expired: false,
    singleUse: true, consumed: false,
    policyVersion: defaultProductionExecutionIdempotencyPolicy.policyVersion,
    evidence: ["source:sprint-129-34"],
  };
  const policy = { ...defaultProductionExecutionIdempotencyPolicy, enabled: true,
    maximumAttemptsByAction: {
      ...defaultProductionExecutionIdempotencyPolicy.maximumAttemptsByAction,
      [record.action]: record.maxAttempts,
    } };
  const built = buildProductionExecutionIdempotencyIdentity({ authorization, confirmation }, {
    evaluatedAt: record.createdAt,
    policy,
  });
  assert.equal(built.ok, true);
  assert.ok(built.identity);
  return { identity: built.identity, authorization, confirmation, policy };
}

function withLeaseIntegrity(lease: NonNullable<ProductionExecutionDurableRecord["durableLease"]>) {
  const { integrity: unused, ...body } = lease;
  void unused;
  return { ...body, integrity: { algorithm: "stable-production-id-v1" as const,
    fingerprint: stableProductionId("durable-lease-integrity", body) } };
}

async function identityValidAdapter(
  base: ProductionExecutionPersistenceAdapter,
  terminalIdentity: ReturnType<typeof buildProductionPipelineExecutionIdentity>,
  operation: string,
  executionFingerprint: string,
): Promise<ProductionExecutionPersistenceAdapter> {
  const canonicalRecordKey = `${terminalIdentity.recordId}-v1`;
  const listedRecords = await base.listKeys("idempotency");
  assert.equal(listedRecords.ok, true, "synthetic source record inventory missing");
  if (!listedRecords.ok) throw new Error("synthetic source record inventory missing");
  const sourceRecordKey = listedRecords.keys.filter((value) =>
    value.startsWith(`${terminalIdentity.recordId}-v`)).sort((left, right) =>
    Number(left.match(/-v(\d+)$/)?.[1]) - Number(right.match(/-v(\d+)$/)?.[1])).at(-1);
  assert.ok(sourceRecordKey, "synthetic source record missing");
  const sourceRecordRead = await base.read("idempotency", sourceRecordKey);
  assert.equal(sourceRecordRead.status, "found", "synthetic source record unreadable");
  if (sourceRecordRead.status !== "found") throw new Error("synthetic source record unreadable");
  const sourceRecord = sourceRecordRead.value as ProductionExecutionDurableRecord;
  const normalizedRecord = { ...sourceRecord, recordVersion: 1,
    integrity: { ...sourceRecord.integrity, version: 1 } };
  const synthetic = syntheticIdentity(normalizedRecord, operation, executionFingerprint);
  const replacementFingerprint = synthetic.identity.identityFingerprint;
  const sourceReservationRead = await base.read("reservation", sourceRecord.identityFingerprint);
  assert.equal(sourceReservationRead.status, "found", "synthetic source reservation unreadable");
  if (sourceReservationRead.status !== "found") {
    throw new Error("synthetic source reservation unreadable");
  }
  const replacementReservation: ProductionExecutionIdempotencyReservationRequest = {
    ...sourceReservationRead.value,
    identity: synthetic.identity,
    authorization: synthetic.authorization,
    confirmation: synthetic.confirmation,
    requestedAt: normalizedRecord.createdAt,
    attempt: normalizedRecord.attempt,
    maxAttempts: normalizedRecord.maxAttempts,
  };
  const durableLease = normalizedRecord.durableLease && withLeaseIntegrity({
    ...normalizedRecord.durableLease,
    identity: { ...normalizedRecord.durableLease.identity, executionFingerprint },
  });
  const replacementRecord: ProductionExecutionDurableRecord = {
    ...normalizedRecord, identityFingerprint: replacementFingerprint,
    idempotencyKey: synthetic.identity.idempotencyKey,
    requestId: synthetic.identity.requestId,
    executionFingerprint: synthetic.identity.executionFingerprint,
    bindingFingerprint: synthetic.identity.bindingFingerprint,
    actorId: synthetic.identity.actorId, operation: synthetic.identity.operation,
    action: synthetic.identity.action,
    authorizationDecisionId: synthetic.identity.authorizationDecisionId,
    confirmationRequestId: synthetic.identity.confirmationRequestId,
    confirmationId: synthetic.identity.confirmationId,
    policyVersion: synthetic.identity.policyVersion,
    riskLevel: synthetic.identity.riskLevel, durableLease,
    integrity: { ...normalizedRecord.integrity, fingerprint: replacementFingerprint },
  };
  const mutate = (kind: ProductionExecutionPersistenceRecordKind, key: string, value: unknown) => {
    if (kind === "idempotency" && key.startsWith(terminalIdentity.recordId)) {
      return replacementRecord;
    }
    if (kind === "claim" && key.startsWith(terminalIdentity.claimId)) {
      const claim = value as ProductionExecutionDurableClaimRecord;
      const identity = { ...claim.identity, reservationId: replacementFingerprint,
        operation, executionFingerprint };
      return withClaimIntegrity({ ...claim, identity,
        binding: { ...claim.binding, reservationVersion: 1, idempotencyVersion: 1,
          bindingFingerprint: stableProductionId("claim-binding", identity) } });
    }
    if (kind === "attempt" && key.startsWith(terminalIdentity.attemptId)) {
      const attempt = value as ProductionExecutionDurableAttemptRecord;
      const identity = { ...attempt.identity, reservationId: replacementFingerprint,
        operation, executionFingerprint };
      return buildProductionExecutionDurableAttemptIntegrity({ ...attempt, identity,
        binding: { ...attempt.binding, reservationVersion: 1,
          bindingFingerprint: buildProductionExecutionAttemptBindingFingerprint(identity) } });
    }
    return value;
  };
  return {
    write: base.write.bind(base),
    listKeys: async (kind) => {
      const listed = await base.listKeys(kind);
      if (!listed.ok) return listed;
      if (kind === "idempotency") return { ...listed,
        keys: [...listed.keys.filter((key) =>
          !key.startsWith(`${terminalIdentity.recordId}-v`)), canonicalRecordKey] } as never;
      if (kind === "reservation") return { ...listed,
        keys: [...listed.keys.filter((key) => key !== sourceRecord.identityFingerprint),
          replacementFingerprint] } as never;
      return listed;
    },
    read: async (kind, key) => {
      if (kind === "idempotency" && key === canonicalRecordKey) {
        return { ok: true, status: "found", kind, key, value: replacementRecord } as never;
      }
      if (kind === "reservation" && key === replacementFingerprint) {
        return { ok: true, status: "found", kind, key, value: replacementReservation } as never;
      }
      if (kind === "reservation" && key === sourceRecord.identityFingerprint) {
        return { ok: false, status: "not-found", kind, key,
          errorCode: "PERSISTENCE_NOT_FOUND" } as never;
      }
      const read = await base.read(kind, key);
      if (read.status !== "found") return read;
      return { ...read, value: mutate(kind, key, structuredClone(read.value)) } as never;
    },
  };
}

async function assertIntegrityValidRecord(
  adapter: ProductionExecutionPersistenceAdapter,
  recordId: string,
) {
  const storage = new AdapterBackedProductionExecutionDurableStorage(adapter);
  const listed = await adapter.listKeys("idempotency");
  assert.equal(listed.ok, true);
  if (!listed.ok) throw new Error("idempotency inventory missing");
  for (const key of listed.keys.filter((value) => value.startsWith(`${recordId}-v`))) {
    const version = await adapter.read("idempotency", key);
    assert.equal(version.status, "found");
    if (version.status === "found") {
      const validation = storage.validateRecord(version.value as ProductionExecutionDurableRecord);
      assert.equal(validation.ok, true, `${key}: ${JSON.stringify(validation)}`);
    }
  }
  const read = await storage.read(recordId);
  assert.equal(read.ok, true, JSON.stringify(read));
  assert.ok(read.record, JSON.stringify(read));
  return read.record;
}

async function assertCompleteSyntheticLineageValid(
  adapter: ProductionExecutionPersistenceAdapter,
  terminalIdentity: ReturnType<typeof buildProductionPipelineExecutionIdentity>,
  record: ProductionExecutionDurableRecord,
) {
  const reservations = await adapter.listKeys("reservation");
  assert.equal(reservations.ok, true, "replacement reservation inventory missing");
  if (!reservations.ok) throw new Error("replacement reservation inventory missing");
  assert.ok(reservations.keys.includes(record.identityFingerprint),
    "replacement reservation canonical key missing");
  assert.equal(reservations.keys.filter((key) => key === record.identityFingerprint).length, 1,
    "replacement reservation canonical key is ambiguous");
  const recordKeys = await adapter.listKeys("idempotency");
  assert.equal(recordKeys.ok, true, "synthetic record inventory missing");
  if (!recordKeys.ok) throw new Error("synthetic record inventory missing");
  const recordReservationIds = new Set<string>();
  for (const key of recordKeys.keys) {
    const read = await adapter.read("idempotency", key);
    assert.equal(read.status, "found", `synthetic record unreadable: ${key}`);
    if (read.status === "found") recordReservationIds.add(read.value.identityFingerprint);
  }
  assert.deepEqual([...reservations.keys].sort(), [...recordReservationIds].sort(),
    "reservation inventory does not exactly match record authority");
  const reservationRead = await adapter.read("reservation", record.identityFingerprint);
  assert.equal(reservationRead.status, "found", "replacement reservation missing");
  if (reservationRead.status !== "found") throw new Error("replacement reservation missing");
  const reservation = reservationRead.value;
  assert.equal(validateProductionExecutionPersistencePayload("reservation", reservation), true,
    "replacement reservation persistence validation failed");
  const policy = { ...defaultProductionExecutionIdempotencyPolicy, enabled: true,
    reservationTtlSeconds: reservation.reservationTtlSeconds,
    maximumAttemptsByAction: {
      ...defaultProductionExecutionIdempotencyPolicy.maximumAttemptsByAction,
      [record.action]: record.maxAttempts,
    } };
  const reservationValidation = validateProductionExecutionIdempotencyReservation(
    reservation, policy);
  assert.equal(reservationValidation.valid, true,
    `replacement reservation canonical validation failed: ${JSON.stringify(reservationValidation)}`);
  assert.equal(reservation.identity.identityFingerprint, record.identityFingerprint,
    "reservation/record fingerprint mismatch");
  assert.equal(reservation.identity.projectSlug, record.projectSlug,
    "reservation/record project mismatch");
  assert.equal(reservation.identity.stage, record.stage, "reservation/record stage mismatch");
  assert.equal(reservation.identity.operation, record.operation,
    "reservation/record operation mismatch");
  assert.equal(reservation.identity.requestId, record.requestId,
    "reservation/record request mismatch");
  assert.equal(reservation.identity.idempotencyKey, record.idempotencyKey,
    "reservation/record idempotency mismatch");
  assert.equal(reservation.identity.executionFingerprint, record.executionFingerprint,
    "reservation/record execution fingerprint mismatch");
  assert.equal(reservation.attempt, record.attempt, "reservation/record attempt mismatch");
  assert.equal(reservation.maxAttempts, record.maxAttempts, "reservation/record max mismatch");
  assert.ok(record.durableLease, "mapped record durable lease missing");
  assert.equal(validateProductionExecutionDurableLease(record.durableLease), true,
    "mapped record durable lease validation failed");
  assert.equal(record.durableLease.identity.recordId, record.recordId,
    "lease/record ID mismatch");
  assert.equal(record.durableLease.identity.requestId, record.requestId,
    "lease/record request mismatch");
  assert.equal(record.durableLease.identity.idempotencyKey, record.idempotencyKey,
    "lease/record idempotency mismatch");
  assert.equal(record.durableLease.identity.executionFingerprint, record.executionFingerprint,
    "lease/record execution fingerprint mismatch");
  const latest = new Map<"claim" | "attempt",
    ProductionExecutionDurableClaimRecord | ProductionExecutionDurableAttemptRecord>();
  for (const [kind, identity] of [
    ["claim", terminalIdentity.claimId], ["attempt", terminalIdentity.attemptId],
  ] as const) {
    const listed = await adapter.listKeys(kind);
    assert.equal(listed.ok, true);
    if (!listed.ok) throw new Error(`${kind} inventory missing`);
    const keys = listed.keys.filter((key) => key.startsWith(`${identity}-v`));
    assert.ok(keys.length > 0);
    let latestVersion = 0;
    for (const key of keys) {
      const read = await adapter.read(kind, key);
      assert.equal(read.status, "found");
      if (read.status !== "found") continue;
      assert.equal(kind === "claim"
        ? validateProductionExecutionDurableClaim(read.value)
        : validateProductionExecutionDurableAttempt(read.value), true, key);
      assert.equal(read.value.identity.recordId, record.recordId);
      assert.equal(read.value.identity.reservationId, record.identityFingerprint);
      assert.equal(read.value.identity.operation, record.operation);
      assert.equal(read.value.identity.executionFingerprint, record.executionFingerprint);
      assert.equal(read.value.binding.reservationVersion, 1,
        `${kind} reservation version mismatch`);
      assert.equal(read.value.binding.leaseVersion <= record.durableLease.version, true,
        `${kind} lease version exceeds record lease`);
      if (kind === "claim") {
        const claim = read.value as ProductionExecutionDurableClaimRecord;
        assert.equal(claim.binding.idempotencyVersion, record.recordVersion,
          "claim idempotency version mismatch");
        if (claim.claimVersion > latestVersion) {
          latestVersion = claim.claimVersion; latest.set(kind, claim);
        }
      } else {
        const attempt = read.value as ProductionExecutionDurableAttemptRecord;
        if (attempt.attemptVersion > latestVersion) {
          latestVersion = attempt.attemptVersion; latest.set(kind, attempt);
        }
      }
    }
  }
  const latestClaim = latest.get("claim") as ProductionExecutionDurableClaimRecord | undefined;
  const latestAttempt = latest.get("attempt") as ProductionExecutionDurableAttemptRecord | undefined;
  assert.ok(latestClaim && latestAttempt, "latest claim/attempt lineage missing");
  assert.equal(latestAttempt.binding.claimVersion <= latestClaim.claimVersion, true,
    "attempt claim version exceeds available claim lineage");
  assert.equal(latestAttempt.binding.leaseVersion, latestClaim.binding.leaseVersion,
    "attempt/claim lease version mismatch");
  assert.equal(latestAttempt.binding.reservationVersion, latestClaim.binding.reservationVersion,
    "attempt/claim reservation version mismatch");
  assert.equal(latestAttempt.identity.claimId, latestClaim.identity.claimId,
    "attempt/claim ID mismatch");
  assert.equal(latestAttempt.identity.leaseId, latestClaim.identity.leaseId,
    "attempt/claim lease ID mismatch");
}

async function createActiveAuthority(projectSlug: string, targetStage: ProductionStepKey) {
  const job: PipelineJob = {
    id: `${projectSlug}-${targetStage}`, projectSlug, stage: targetStage, title: targetStage,
    status: "queued", attempts: 0, createdAt: anchor, updatedAt: anchor,
  };
  await writeJob(projectSlug, job);
  const prepared = await prepareProductionPipelineExecution({
    projectSlug, stage: targetStage, runType: "initial",
  });
  let releaseHandler!: () => void;
  let handlerEntered!: () => void;
  const release = new Promise<void>((resolve) => { releaseHandler = resolve; });
  const entered = new Promise<void>((resolve) => { handlerEntered = resolve; });
  const completed = new ProductionExecutionWorkerExecutionService(prepared.executionAdapter)
    .execute(prepared.request, async () => {
      handlerEntered();
      await release;
      throw Object.assign(new Error("controlled competing authority settlement"), {
        code: "CONTROLLED_COMPETING_AUTHORITY_FAILURE",
      });
    }, { isCancellationRequested: () => false });
  await entered;
  const identity = buildProductionPipelineExecutionIdentity(
    { projectSlug, stage: targetStage, runType: "initial" }, { id: job.id, attempts: 0 },
  );
  const record = await new AdapterBackedProductionExecutionDurableStorage(prepared.adapter)
    .read(identity.recordId);
  assert.ok(record.record?.durableLease);
  assert.equal(record.record.state, "reserved");
  assert.equal(record.record.lifecycleState, "reserved");
  assert.equal(record.record.durableLease.status, "active");
  const claimKeys = await prepared.adapter.listKeys("claim");
  const attemptKeys = await prepared.adapter.listKeys("attempt");
  assert.equal(claimKeys.ok, true); assert.equal(attemptKeys.ok, true);
  if (!claimKeys.ok || !attemptKeys.ok) throw new Error("active authority inventory missing");
  const claimKey = claimKeys.keys.filter((key) => key.startsWith(`${identity.claimId}-v`)).at(-1);
  const attemptKey = attemptKeys.keys.filter((key) => key.startsWith(`${identity.attemptId}-v`)).at(-1);
  assert.ok(claimKey && attemptKey);
  const claim = await prepared.adapter.read("claim", claimKey);
  const attempt = await prepared.adapter.read("attempt", attemptKey);
  assert.equal(claim.status, "found"); assert.equal(attempt.status, "found");
  if (claim.status === "found") assert.equal(claim.value.state, "active");
  if (attempt.status === "found") assert.ok(["opened", "active"].includes(attempt.value.state));
  return { identity, complete: async () => {
    releaseHandler();
    const result = await completed;
    assert.equal(result.status, "failed");
  } };
}

async function main() {
  const run = await withCanonicalSmokeRuntime(
    { name: "sprint-129-34-queued-exhausted-run-type", now: anchor,
      operationType: "pipeline-stage-execution" },
    async (runtime) => {
      const resume = await createFixture(runtime.runtimeRoot, runtime.projectSlug, "resume");
      const before = await durablePhysicalSnapshot(resume.executionRoot);

      await test("resume-origin exact queued/exhausted production topology is exact drift", async () => {
        const result = await classify(resume);
        assert.equal(result.status, "exact-drift", JSON.stringify(result));
        if (result.status === "exact-drift") {
          assert.equal(result.identity.executionFingerprint,
            resume.terminalIdentity.executionFingerprint);
          assert.equal(result.job.status, "queued");
          assert.equal(result.job.attempts, 3);
        }
      });

      await test("retry-origin exact queued/exhausted topology remains exact drift", async () => {
        const retry = await createFixture(runtime.runtimeRoot, `${runtime.projectSlug}-retry`, "retry");
        const result = await classify(retry);
        assert.equal(result.status, "exact-drift", JSON.stringify(result));
      });

      await test("record/claim operation disagreement remains rejected", async () => {
        const mismatched = adapterWithReadMutation(resume.adapter, (kind, key, value) => {
          if (kind !== "claim" || !key.startsWith(resume.terminalIdentity.claimId)) return value;
          const claim = value as ProductionExecutionDurableClaimRecord;
          return withClaimIntegrity({ ...claim,
            identity: { ...claim.identity, operation: "pipeline.stage.retry" } });
        });
        assert.equal((await classify(resume, mismatched)).status, "rejected");
      });

      await test("integrity-valid retry fingerprint substitution hits exact lineage boundary", async () => {
        const storage = new AdapterBackedProductionExecutionDurableStorage(resume.adapter);
        const record = await storage.read(resume.terminalIdentity.recordId);
        assert.ok(record.record);
        const retryIdentity = buildProductionPipelineExecutionIdentity(
          { projectSlug: resume.projectSlug, stage, runType: "retry" },
          { id: resume.jobId, attempts: 2 },
        );
        const substituted = await identityValidAdapter(resume.adapter, resume.terminalIdentity,
          "pipeline.stage.resume", retryIdentity.executionFingerprint);
        const substitutedRecord = await assertIntegrityValidRecord(
          substituted, resume.terminalIdentity.recordId);
        await assertCompleteSyntheticLineageValid(
          substituted, resume.terminalIdentity, substitutedRecord);
        const boundary = await classifyProductionDurableAttemptLineage(
          substituted, resume.projectSlug, stage, 2, "exact",
        );
        assert.deepEqual(boundary, { status: "invalid", boundary: "record-execution-fingerprint" });
        const rejected = await classify(resume, substituted);
        assert.deepEqual(rejected, { status: "rejected", evidence: ["durable:lineage-invalid"] });
        await assert.rejects(() => readProductionCanonicalTerminalDurableLineage(
          resume.adapter, retryIdentity, record.record!.identityFingerprint, undefined,
          record.record!.operation,
        ), /CANONICAL_DURABLE_IDENTITY_BINDING_MISMATCH/);
      });

      await test("integrity-valid unsupported operation hits strict parser boundary", async () => {
        const unsupported = await identityValidAdapter(resume.adapter, resume.terminalIdentity,
          "pipeline.stage.recovery", resume.terminalIdentity.executionFingerprint);
        const unsupportedRecord = await assertIntegrityValidRecord(
          unsupported, resume.terminalIdentity.recordId);
        await assertCompleteSyntheticLineageValid(
          unsupported, resume.terminalIdentity, unsupportedRecord);
        const boundary = await classifyProductionDurableAttemptLineage(
          unsupported, resume.projectSlug, stage, 2, "exact",
        );
        assert.deepEqual(boundary, { status: "invalid", boundary: "record-operation-format" });
        const rejected = await classify(resume, unsupported);
        assert.deepEqual(rejected, { status: "rejected", evidence: ["durable:lineage-invalid"] });
      });

      await test("complete canonical active authority hits exact global-authority gate", async () => {
        const competing = await createFixture(runtime.runtimeRoot,
          `${runtime.projectSlug}-active-authority`, "resume");
        const active = await createActiveAuthority(competing.projectSlug, "research");
        const activeRecord = await new AdapterBackedProductionExecutionDurableStorage(competing.adapter)
          .read(active.identity.recordId);
        assert.ok(activeRecord.record);
        const activeBefore = await durablePhysicalSnapshot(competing.executionRoot);
        try {
          const rejected = await classify(competing);
          assert.deepEqual(rejected, { status: "rejected",
            evidence: ["durable:global-authority"] });
          assert.deepEqual(await durablePhysicalSnapshot(competing.executionRoot), activeBefore);
        } finally {
          await active.complete();
        }
      });

      await test("raw durable inventory bytes and aggregate SHA-256 remain exact", async () => {
        const after = await durablePhysicalSnapshot(resume.executionRoot);
        assert.deepEqual(after.files, before.files);
        assert.equal(after.aggregateSha256, before.aggregateSha256);
      });
    },
  );
  assert.equal(run.finalization.cleanupCompleted, true);
  assert.equal(run.finalization.runtimeRemainder, 0);
  assert.equal(run.finalization.authorityRemainder, 0);
  assert.equal(run.finalization.lockGateQuarantineRemainder, 0);
  assert.equal(run.finalization.newlyCreatedGlobalInventory.length, 0);
  emitSmokeResult("sprint-129-34-queued-exhausted-run-type", passed);
}

void main().catch((error) => {
  process.stderr.write(`Sprint 129.34 queued/exhausted run-type smoke FAILED: ${
    error instanceof Error ? error.stack ?? error.message : "unknown"}\n`);
  process.exitCode = 1;
});
