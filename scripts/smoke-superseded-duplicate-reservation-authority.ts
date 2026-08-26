import assert from "node:assert/strict";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import crypto from "node:crypto";
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
import {
  buildProductionSupersededDuplicateReservationAuthorityBody,
  evaluateAndPublishSupersededDuplicateReservationDecision,
  findExistingSupersededDuplicateReservationDecision,
  supersededDuplicateReservationPolicyVersion,
  supersededDuplicateReservationSchemaVersion,
  writeProductionSupersededDuplicateReservationAuthority,
} from "../src/lib/production/ProductionSupersededDuplicateReservationAuthority";
import { buildProductionPipelineExecutionIdentity } from
  "../src/lib/production/ProductionPipelineExecutionFactory";
import { regenerationDirectory as pipelineRegenerationDirectory } from
  "../src/lib/pipeline/PipelineStageRegenerationStore";
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
import type { PipelineRegenerationIntent } from "../src/types/pipelineRegeneration";

const projectSlug = "superseded-duplicate-project";
const stage = "assembly" as const;
const timestamp = "2026-08-25T00:00:00.000Z";
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
    reason: "trusted superseded-duplicate fixture", evaluatedAt: timestamp,
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
    reasonCode: "CONFIRMATION_VALID" as const, reason: "trusted superseded-duplicate fixture",
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

function plannedFor(ordinal: number, regeneration: ProductionRegenerationBinding | undefined) {
  return buildProductionPipelineExecutionIdentity(
    { projectSlug, stage, runType: "resume", regeneration },
    { id: `${projectSlug}-${stage}`, attempts: ordinal - 1 },
  );
}

function canonicalRecord(ordinal: number, regeneration: ProductionRegenerationBinding | undefined,
  overrides: { result?: unknown; failure?: unknown; recordId?: string } = {}): ProductionExecutionDurableRecord {
  const planned = plannedFor(ordinal, regeneration);
  const { identity } = identityFor("pipeline.stage.resume", planned);
  return {
    schemaVersion: "1", recordId: overrides.recordId ?? planned.recordId,
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
    ...(overrides.result ? { result: overrides.result } : {}),
    ...(overrides.failure ? { failure: overrides.failure } : {}),
  } as ProductionExecutionDurableRecord;
}

function canonicalReservation(ordinal: number, regeneration: ProductionRegenerationBinding | undefined):
  ProductionExecutionIdempotencyReservationRequest {
  const planned = plannedFor(ordinal, regeneration);
  const { identity, authorization, confirmation } = identityFor("pipeline.stage.resume", planned);
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

function canonicalAttempt(ordinal: number, regeneration: ProductionRegenerationBinding | undefined,
  record: ProductionExecutionIdempotencyRecord): ProductionExecutionDurableAttemptRecord {
  const planned = plannedFor(ordinal, regeneration);
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
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `atolye-superseded-dup-${name}-`));
  const storageContext = createIsolatedRuntimeStorageContext({
    workspaceRoot: root,
    environment: { ATOLYE_RUNTIME_ROOT: path.join(root, "runtime") },
  });
  const adapter = new ProductionExecutionFilePersistenceAdapter({
    trustedRootDirectory: path.join(getProjectRoot(projectSlug, storageContext), "production-execution"),
    trustedAttemptIdFactory: () => "superseded-duplicate-fixture",
  });
  return { root, adapter, storageContext };
}

function randomRegenerationId(): string {
  return `pipeline-regen-${crypto.randomBytes(24).toString("hex")}`;
}

/** Writes a real, on-disk, discoverable pipeline regeneration (intent.json +
 * optionally completed.json) — NOT a fabricated in-memory binding — so
 * listRegenerationExecutionBindingCandidates()/listRegenerationExecutionBindings()/
 * PipelineStageRegenerationStore.isRegenerationCompleted() all genuinely see it. */
function writeRegenerationFixture(fixture: Fixture, options: {
  readonly generationOrdinal: number;
  readonly firstGlobalExecutionOrdinal: number;
  readonly completed: boolean;
}): ProductionRegenerationBinding {
  const regenerationId = randomRegenerationId();
  const planFingerprint = `plan-fingerprint-${regenerationId.slice(-12)}`;
  const dir = pipelineRegenerationDirectory(projectSlug, regenerationId, fixture.storageContext);
  fsSync.mkdirSync(dir, { recursive: true });
  const jobsPayload = { jobs: [{ id: `${projectSlug}-${stage}`, projectSlug, stage,
    status: "queued", attempts: options.firstGlobalExecutionOrdinal }] };
  const postBase64 = Buffer.from(JSON.stringify(jobsPayload), "utf8").toString("base64");
  const intent: PipelineRegenerationIntent = {
    schemaVersion: "pipeline-regeneration-v1", regenerationId, projectSlug,
    projectId: projectSlug, fromStage: stage, generationOrdinal: options.generationOrdinal,
    planFingerprint, reasonCode: "TEST_FIXTURE_REGENERATION", backupId: "backup-test-fixture",
    backupManifestFingerprint: "backup-manifest-test-fixture",
    exactPrestateFingerprint: "prestate-test-fixture",
    preservedStages: [], affectedStages: [stage], createdAt: timestamp,
    mutations: [{ relativePath: "pipeline-jobs.json", preSha256: null,
      postSha256: `sha256-${regenerationId.slice(-12)}`, postBase64, writeOnce: false }],
  };
  fsSync.writeFileSync(path.join(dir, "intent.json"), JSON.stringify(intent, null, 2) + "\n", "utf8");
  if (options.completed) {
    fsSync.writeFileSync(path.join(dir, "completed.json"), JSON.stringify({ completedAt: timestamp }) + "\n", "utf8");
  }
  return Object.freeze({ regenerationId, generationOrdinal: options.generationOrdinal, planFingerprint,
    fromStage: stage, reasonCode: "TEST_FIXTURE_REGENERATION" });
}

async function writeFullyPaired(fixture: Fixture, ordinal: number, regeneration: ProductionRegenerationBinding | undefined):
  Promise<ProductionExecutionDurableRecord> {
  const record = canonicalRecord(ordinal, regeneration);
  const attempt = canonicalAttempt(ordinal, regeneration, record);
  const claim = canonicalClaim(record, attempt);
  const reservation = canonicalReservation(ordinal, regeneration);
  assert.equal((await fixture.adapter.write("idempotency", `${record.recordId}-v1`, record)).ok, true);
  assert.equal((await fixture.adapter.write("attempt", `${attempt.identity.attemptId}-v1`, attempt)).ok, true);
  assert.equal((await fixture.adapter.write("claim", `${claim.identity.claimId}-v1`, claim)).ok, true);
  assert.equal((await fixture.adapter.write("reservation", record.identityFingerprint, reservation)).ok, true);
  return record;
}

async function writeUnclaimedOrphan(fixture: Fixture, ordinal: number, regeneration: ProductionRegenerationBinding | undefined):
  Promise<{ record: ProductionExecutionDurableRecord; reservation: ProductionExecutionIdempotencyReservationRequest }> {
  const record = canonicalRecord(ordinal, regeneration);
  const reservation = canonicalReservation(ordinal, regeneration);
  assert.equal((await fixture.adapter.write("idempotency", `${record.recordId}-v1`, record)).ok, true);
  assert.equal((await fixture.adapter.write("reservation", record.identityFingerprint, reservation)).ok, true);
  return { record, reservation };
}

function writeMatchingToleranceAuthority(
  fixture: Fixture, record: ProductionExecutionDurableRecord,
  reservation: ProductionExecutionIdempotencyReservationRequest,
): void {
  const body = buildProductionOrphanReservationToleranceAuthorityBody({
    schemaVersion: orphanReservationToleranceSchemaVersion,
    policyVersion: orphanReservationTolerancePolicyVersion,
    authorityId: `test-authority-${record.recordId}`,
    issuedAt: timestamp, projectSlug, stage, jobId: `${projectSlug}-${stage}`,
    reservationId: record.identityFingerprint, operation: record.operation,
    attempt: record.attempt, reason: "smoke-fixture: candidate orphan reservation",
    reservationContentFingerprint: reservationContentFingerprint(reservation),
  });
  const written = writeProductionOrphanReservationToleranceAuthority(projectSlug, body, fixture.storageContext);
  assert.equal(written.ok, true, `tolerance authority must write cleanly: ${written.reasonCode}`);
}

async function main() {
  // --- 1) Gen2 orphan + Gen3 claimed canonical -> only Gen2 (candidate) is
  // named as superseded; a decision is published.
  const happyPath = await setup("happy-path");
  try {
    const gen2 = writeRegenerationFixture(happyPath, { generationOrdinal: 2, firstGlobalExecutionOrdinal: 3, completed: true });
    const gen3 = writeRegenerationFixture(happyPath, { generationOrdinal: 3, firstGlobalExecutionOrdinal: 6, completed: false });
    const { record: candidate, reservation: candidateReservation } = await writeUnclaimedOrphan(happyPath, 7, gen2);
    writeMatchingToleranceAuthority(happyPath, candidate, candidateReservation);
    const canonical = await writeFullyPaired(happyPath, 7, gen3);

    let publishedAuthority: string | undefined;
    await scenario("Gen2 orphan + Gen3 claimed canonical -> published supersession decision", async () => {
      const result = await evaluateAndPublishSupersededDuplicateReservationDecision(
        happyPath.adapter, { projectSlug, stage, candidateRecordId: candidate.recordId, canonicalRecordId: canonical.recordId },
        happyPath.storageContext,
      );
      assert.equal(result.ok, true, `evidence=${JSON.stringify(result.evidence)}`);
      assert.equal(result.reasonCode, "SUPERSEDED_DUPLICATE_RESERVATION_PUBLISHED");
      assert.ok(result.authority);
      assert.equal(result.authority!.candidateRecordId, candidate.recordId);
      assert.equal(result.authority!.canonicalRecordId, canonical.recordId);
      assert.equal(result.authority!.proof.candidateRegenerationId, gen2.regenerationId);
      assert.equal(result.authority!.proof.canonicalRegenerationId, gen3.regenerationId);
      publishedAuthority = result.authority!.decisionId;
    });

    await scenario("published decision is independently discoverable by the structural tuple", async () => {
      const found = findExistingSupersededDuplicateReservationDecision(
        projectSlug, stage, 7, candidate.recordId, canonical.recordId, happyPath.storageContext,
      );
      assert.ok(found);
      assert.equal(found!.decisionId, publishedAuthority);
    });

    await scenario("reconciliation called a second time is idempotent (replayed, no re-write)", async () => {
      const result = await evaluateAndPublishSupersededDuplicateReservationDecision(
        happyPath.adapter, { projectSlug, stage, candidateRecordId: candidate.recordId, canonicalRecordId: canonical.recordId },
        happyPath.storageContext,
      );
      assert.equal(result.ok, true);
      assert.equal(result.reasonCode, "SUPERSEDED_DUPLICATE_RESERVATION_REPLAYED");
      assert.equal(result.writeFree, true);
    });

    await scenario("canonical record content is byte-identical after reconciliation", async () => {
      const readBack = await happyPath.adapter.read("idempotency", `${canonical.recordId}-v1`);
      assert.equal(readBack.status, "found");
      assert.deepEqual(readBack.status === "found" ? readBack.value : undefined, canonical);
    });

    await scenario("candidate record content is byte-identical after reconciliation", async () => {
      const readBack = await happyPath.adapter.read("idempotency", `${candidate.recordId}-v1`);
      assert.equal(readBack.status, "found");
      assert.deepEqual(readBack.status === "found" ? readBack.value : undefined, candidate);
    });
  } finally { await fs.rm(happyPath.root, { recursive: true, force: true }); }

  // --- 2) Both records genuinely claimed/attempted -> fail-closed.
  const bothClaimed = await setup("both-claimed");
  try {
    const gen2 = writeRegenerationFixture(bothClaimed, { generationOrdinal: 2, firstGlobalExecutionOrdinal: 3, completed: true });
    const gen3 = writeRegenerationFixture(bothClaimed, { generationOrdinal: 3, firstGlobalExecutionOrdinal: 6, completed: false });
    const candidate = await writeFullyPaired(bothClaimed, 7, gen2);
    const canonical = await writeFullyPaired(bothClaimed, 7, gen3);

    await scenario("two independently claimed+attempted records -> fail-closed (CANDIDATE_HAS_CLAIM)", async () => {
      const result = await evaluateAndPublishSupersededDuplicateReservationDecision(
        bothClaimed.adapter, { projectSlug, stage, candidateRecordId: candidate.recordId, canonicalRecordId: canonical.recordId },
        bothClaimed.storageContext,
      );
      assert.equal(result.ok, false);
      assert.equal(result.reasonCode, "CANDIDATE_HAS_CLAIM");
    });
  } finally { await fs.rm(bothClaimed.root, { recursive: true, force: true }); }

  // --- 3) Both executionless, no canonicality proof for either -> fail-closed
  // (canonical itself lacks claim/attempt, so it can never serve as "canonical").
  const bothOrphan = await setup("both-orphan");
  try {
    const gen2 = writeRegenerationFixture(bothOrphan, { generationOrdinal: 2, firstGlobalExecutionOrdinal: 3, completed: true });
    const gen3 = writeRegenerationFixture(bothOrphan, { generationOrdinal: 3, firstGlobalExecutionOrdinal: 6, completed: false });
    const { record: candidate, reservation: candidateReservation } = await writeUnclaimedOrphan(bothOrphan, 7, gen2);
    writeMatchingToleranceAuthority(bothOrphan, candidate, candidateReservation);
    const { record: canonical } = await writeUnclaimedOrphan(bothOrphan, 7, gen3);

    await scenario("two executionless records (neither has claim/attempt) -> fail-closed (CANONICAL_MISSING_CLAIM)", async () => {
      const result = await evaluateAndPublishSupersededDuplicateReservationDecision(
        bothOrphan.adapter, { projectSlug, stage, candidateRecordId: candidate.recordId, canonicalRecordId: canonical.recordId },
        bothOrphan.storageContext,
      );
      assert.equal(result.ok, false);
      assert.equal(result.reasonCode, "CANONICAL_MISSING_CLAIM");
    });
  } finally { await fs.rm(bothOrphan.root, { recursive: true, force: true }); }

  // --- 4) Same generation duplicate -> fail-closed (ordinal not strictly less).
  const sameGeneration = await setup("same-generation");
  try {
    const gen2 = writeRegenerationFixture(sameGeneration, { generationOrdinal: 2, firstGlobalExecutionOrdinal: 3, completed: true });
    // A second, DIFFERENT regenerationId but the SAME generationOrdinal (2) --
    // proves the check is on generationOrdinal equality, not regenerationId identity.
    const gen2b = writeRegenerationFixture(sameGeneration, { generationOrdinal: 2, firstGlobalExecutionOrdinal: 3, completed: true });
    const { record: candidate, reservation: candidateReservation } = await writeUnclaimedOrphan(sameGeneration, 7, gen2);
    writeMatchingToleranceAuthority(sameGeneration, candidate, candidateReservation);
    const canonical = await writeFullyPaired(sameGeneration, 7, gen2b);

    await scenario("duplicate resolves to the SAME generationOrdinal -> fail-closed (GENERATION_ORDINAL_NOT_STRICTLY_LESS)", async () => {
      const result = await evaluateAndPublishSupersededDuplicateReservationDecision(
        sameGeneration.adapter, { projectSlug, stage, candidateRecordId: candidate.recordId, canonicalRecordId: canonical.recordId },
        sameGeneration.storageContext,
      );
      assert.equal(result.ok, false);
      assert.equal(result.reasonCode, "GENERATION_ORDINAL_NOT_STRICTLY_LESS");
    });
  } finally { await fs.rm(sameGeneration.root, { recursive: true, force: true }); }

  // --- 5) Ambiguous / unresolvable identity -> fail-closed.
  const ambiguous = await setup("ambiguous-identity");
  try {
    const gen2 = writeRegenerationFixture(ambiguous, { generationOrdinal: 2, firstGlobalExecutionOrdinal: 3, completed: true });
    const gen3 = writeRegenerationFixture(ambiguous, { generationOrdinal: 3, firstGlobalExecutionOrdinal: 6, completed: false });
    // A candidate recordId that does not correspond to ANY historically
    // eligible regeneration binding -- zero-match, unresolvable.
    const { record: candidate, reservation: candidateReservation } = await writeUnclaimedOrphan(
      ambiguous, 7, gen2,
    );
    const foreignCandidate = { ...candidate, recordId: "pipeline-record-foreign-unresolvable" };
    assert.equal((await ambiguous.adapter.write("idempotency", `${foreignCandidate.recordId}-v1`, foreignCandidate)).ok, true);
    writeMatchingToleranceAuthority(ambiguous, candidate, candidateReservation);
    const canonical = await writeFullyPaired(ambiguous, 7, gen3);

    await scenario("candidate recordId does not resolve to any regeneration binding -> fail-closed (IDENTITY_RESOLUTION_AMBIGUOUS)", async () => {
      const result = await evaluateAndPublishSupersededDuplicateReservationDecision(
        ambiguous.adapter, { projectSlug, stage, candidateRecordId: foreignCandidate.recordId, canonicalRecordId: canonical.recordId },
        ambiguous.storageContext,
      );
      assert.equal(result.ok, false);
      assert.equal(result.reasonCode, "IDENTITY_RESOLUTION_AMBIGUOUS");
    });
  } finally { await fs.rm(ambiguous.root, { recursive: true, force: true }); }

  // --- 6) No tolerance authority for the candidate -> fail-closed.
  const noAuthority = await setup("no-authority");
  try {
    const gen2 = writeRegenerationFixture(noAuthority, { generationOrdinal: 2, firstGlobalExecutionOrdinal: 3, completed: true });
    const gen3 = writeRegenerationFixture(noAuthority, { generationOrdinal: 3, firstGlobalExecutionOrdinal: 6, completed: false });
    const { record: candidate } = await writeUnclaimedOrphan(noAuthority, 7, gen2);
    // Deliberately NOT publishing a tolerance authority for candidate.
    const canonical = await writeFullyPaired(noAuthority, 7, gen3);

    await scenario("candidate has no matching tolerance authority -> fail-closed (TOLERANCE_AUTHORITY_MISSING_OR_INVALID)", async () => {
      const result = await evaluateAndPublishSupersededDuplicateReservationDecision(
        noAuthority.adapter, { projectSlug, stage, candidateRecordId: candidate.recordId, canonicalRecordId: canonical.recordId },
        noAuthority.storageContext,
      );
      assert.equal(result.ok, false);
      assert.equal(result.reasonCode, "TOLERANCE_AUTHORITY_MISSING_OR_INVALID");
    });
  } finally { await fs.rm(noAuthority.root, { recursive: true, force: true }); }

  // --- 7) Candidate's own generation is NOT completed -> fail-closed.
  const notCompleted = await setup("candidate-not-completed");
  try {
    const gen2 = writeRegenerationFixture(notCompleted, { generationOrdinal: 2, firstGlobalExecutionOrdinal: 3, completed: false });
    const gen3 = writeRegenerationFixture(notCompleted, { generationOrdinal: 3, firstGlobalExecutionOrdinal: 6, completed: false });
    const { record: candidate, reservation: candidateReservation } = await writeUnclaimedOrphan(notCompleted, 7, gen2);
    writeMatchingToleranceAuthority(notCompleted, candidate, candidateReservation);
    const canonical = await writeFullyPaired(notCompleted, 7, gen3);

    await scenario("candidate's generation is not completed -> fail-closed (CANDIDATE_GENERATION_NOT_COMPLETED)", async () => {
      const result = await evaluateAndPublishSupersededDuplicateReservationDecision(
        notCompleted.adapter, { projectSlug, stage, candidateRecordId: candidate.recordId, canonicalRecordId: canonical.recordId },
        notCompleted.storageContext,
      );
      assert.equal(result.ok, false);
      assert.equal(result.reasonCode, "CANDIDATE_GENERATION_NOT_COMPLETED");
    });
  } finally { await fs.rm(notCompleted.root, { recursive: true, force: true }); }

  // --- 8) Canonical's generation is NOT the currently active max generation -> fail-closed.
  const canonicalNotMax = await setup("canonical-not-max");
  try {
    const gen2 = writeRegenerationFixture(canonicalNotMax, { generationOrdinal: 2, firstGlobalExecutionOrdinal: 3, completed: true });
    const gen3 = writeRegenerationFixture(canonicalNotMax, { generationOrdinal: 3, firstGlobalExecutionOrdinal: 6, completed: false });
    // A newer, gen 4 exists in the store -- so gen 3 is no longer the max.
    writeRegenerationFixture(canonicalNotMax, { generationOrdinal: 4, firstGlobalExecutionOrdinal: 9, completed: false });
    const { record: candidate, reservation: candidateReservation } = await writeUnclaimedOrphan(canonicalNotMax, 7, gen2);
    writeMatchingToleranceAuthority(canonicalNotMax, candidate, candidateReservation);
    const canonical = await writeFullyPaired(canonicalNotMax, 7, gen3);

    await scenario("canonical's generation is no longer the active max -> fail-closed (CANONICAL_GENERATION_NOT_ACTIVE_MAX)", async () => {
      const result = await evaluateAndPublishSupersededDuplicateReservationDecision(
        canonicalNotMax.adapter, { projectSlug, stage, candidateRecordId: candidate.recordId, canonicalRecordId: canonical.recordId },
        canonicalNotMax.storageContext,
      );
      assert.equal(result.ok, false);
      assert.equal(result.reasonCode, "CANONICAL_GENERATION_NOT_ACTIVE_MAX");
    });
  } finally { await fs.rm(canonicalNotMax.root, { recursive: true, force: true }); }

  // --- 9) Store-level write-once/crash-safety: a conflicting body under the
  // SAME deterministic decisionId is refused, never silently overwritten.
  const writeOnce = await setup("write-once");
  try {
    const base = {
      schemaVersion: supersededDuplicateReservationSchemaVersion,
      policyVersion: supersededDuplicateReservationPolicyVersion,
      projectSlug, stage, jobId: `${projectSlug}-${stage}`, attempt: 7,
      candidateRecordId: "pipeline-record-candidate-fixture",
      canonicalRecordId: "pipeline-record-canonical-fixture",
      reason: "later-regeneration-duplicate-ordinal" as const,
    };
    const bodyA = buildProductionSupersededDuplicateReservationAuthorityBody({
      ...base, proof: {
        candidateReservationId: "idempotency-identity-a", canonicalReservationId: "idempotency-identity-b",
        candidateReservationContentFingerprint: "fp-a", canonicalReservationContentFingerprint: "fp-b",
        candidateRegenerationId: "pipeline-regen-aaaa", candidateGenerationOrdinal: 2,
        canonicalRegenerationId: "pipeline-regen-bbbb", canonicalGenerationOrdinal: 3,
        toleranceAuthorityId: "tol-fixture-a",
      },
    });
    const bodyB = buildProductionSupersededDuplicateReservationAuthorityBody({
      ...base, proof: { ...bodyA.proof, toleranceAuthorityId: "tol-fixture-DIFFERENT" },
    });
    assert.equal(bodyA.decisionId, bodyB.decisionId, "decisionId must be deterministic from the 5 structural fields only");

    await scenario("first write publishes cleanly", async () => {
      const written = writeProductionSupersededDuplicateReservationAuthority(projectSlug, bodyA, writeOnce.storageContext);
      assert.equal(written.ok, true);
      assert.equal(written.status, "created");
    });
    await scenario("identical second write replays (idempotent, writeFree)", async () => {
      const written = writeProductionSupersededDuplicateReservationAuthority(projectSlug, bodyA, writeOnce.storageContext);
      assert.equal(written.ok, true);
      assert.equal(written.status, "replayed");
      assert.equal(written.writeFree, true);
    });
    await scenario("conflicting content under the same decisionId is refused, never overwritten", async () => {
      const written = writeProductionSupersededDuplicateReservationAuthority(projectSlug, bodyB, writeOnce.storageContext);
      assert.equal(written.ok, false);
      assert.equal(written.status, "conflict");
    });
  } finally { await fs.rm(writeOnce.root, { recursive: true, force: true }); }

  assert.ok(scenarios >= 15);
  process.stdout.write(`Superseded duplicate reservation authority smoke: PASS (${scenarios} scenarios)\n`);
  emitSmokeResult("superseded-duplicate-reservation-authority", scenarios);
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
