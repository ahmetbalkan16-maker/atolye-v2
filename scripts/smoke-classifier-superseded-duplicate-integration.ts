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
  findSupersessionDecisionForCandidate,
  supersededDuplicateReservationPolicyVersion,
  supersededDuplicateReservationSchemaVersion,
  writeProductionSupersededDuplicateReservationAuthority,
} from "../src/lib/production/ProductionSupersededDuplicateReservationAuthority";
import { classifyProductionDurableAttemptLineage } from
  "../src/lib/production/ProductionDurableAttemptLineageClassifier";
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

const projectSlug = "classifier-superseded-integration-project";
const stage = "assembly" as const;
const timestamp = "2026-08-26T00:00:00.000Z";
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
    reason: "trusted classifier-integration fixture", evaluatedAt: timestamp,
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
    reasonCode: "CONFIRMATION_VALID" as const, reason: "trusted classifier-integration fixture",
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

function canonicalRecord(ordinal: number, regeneration: ProductionRegenerationBinding | undefined):
  ProductionExecutionDurableRecord {
  const planned = plannedFor(ordinal, regeneration);
  const { identity } = identityFor("pipeline.stage.resume", planned);
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
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `atolye-classifier-superseded-${name}-`));
  // Deliberately mutates the REAL process.env.ATOLYE_RUNTIME_ROOT (restored
  // once, at the very end of main()) rather than passing an `environment`
  // override object to createIsolatedRuntimeStorageContext(): several
  // classifier internals this integration exercises (`resolveHistoricalRecordIdentity`,
  // an existing, untouched function this change must not modify) call the
  // regeneration store with NO explicit context at all, so they only ever
  // see the real process.env's default resolution -- never an override
  // object passed to some other, unrelated call. Setting the real env var
  // is what makes those context-less internal calls agree with this
  // fixture's own explicit-context calls (the new pre-filter always threads
  // `runtimeInput` through), so both resolve to the SAME isolated root.
  process.env.ATOLYE_RUNTIME_ROOT = path.join(root, "runtime");
  const storageContext = createIsolatedRuntimeStorageContext({ workspaceRoot: root });
  const adapter = new ProductionExecutionFilePersistenceAdapter({
    trustedRootDirectory: path.join(getProjectRoot(projectSlug, storageContext), "production-execution"),
    trustedAttemptIdFactory: () => "classifier-superseded-fixture",
  });
  return { root, adapter, storageContext };
}

function randomRegenerationId(): string {
  return `pipeline-regen-${crypto.randomBytes(24).toString("hex")}`;
}

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

/** Publishes a supersession decision through the REAL, unmodified evaluation
 * gate (evaluateAndPublishSupersededDuplicateReservationDecision) -- the
 * normal, honest path. */
async function publishRealDecision(fixture: Fixture, candidateRecordId: string, canonicalRecordId: string) {
  const result = await evaluateAndPublishSupersededDuplicateReservationDecision(
    fixture.adapter, { projectSlug, stage, candidateRecordId, canonicalRecordId }, fixture.storageContext,
  );
  assert.equal(result.ok, true, `evidence=${JSON.stringify(result.evidence)}`);
  return result;
}

/** Writes a HAND-CRAFTED decision directly via the low-level builder/writer,
 * bypassing evaluateAndPublishSupersededDuplicateReservationDecision's own
 * gate entirely -- used ONLY to prove the classifier's OWN fresh re-
 * verification defends against a decision that should never have existed
 * (a stale/buggy/tampered publish), not merely against the classifier
 * trusting its own evaluation function's guarantees. */
function publishHandCraftedDecision(fixture: Fixture, params: {
  candidateRecordId: string; canonicalRecordId: string; attempt: number;
}) {
  const body = buildProductionSupersededDuplicateReservationAuthorityBody({
    schemaVersion: supersededDuplicateReservationSchemaVersion,
    policyVersion: supersededDuplicateReservationPolicyVersion,
    projectSlug, stage, jobId: `${projectSlug}-${stage}`, attempt: params.attempt,
    candidateRecordId: params.candidateRecordId, canonicalRecordId: params.canonicalRecordId,
    reason: "later-regeneration-duplicate-ordinal",
    proof: {
      candidateReservationId: "hand-crafted-candidate-reservation",
      canonicalReservationId: "hand-crafted-canonical-reservation",
      candidateReservationContentFingerprint: "hand-crafted-fp-a",
      canonicalReservationContentFingerprint: "hand-crafted-fp-b",
      candidateRegenerationId: "hand-crafted-regen-a", candidateGenerationOrdinal: 2,
      canonicalRegenerationId: "hand-crafted-regen-b", canonicalGenerationOrdinal: 3,
      toleranceAuthorityId: "hand-crafted-tolerance",
    },
  });
  const written = writeProductionSupersededDuplicateReservationAuthority(projectSlug, body, fixture.storageContext);
  assert.equal(written.ok, true);
  return body;
}

async function runScenarios() {
  // --- 1) No authority at all -> existing lineage-cardinality behavior,
  // fully unaffected by the pre-filter's mere presence in the codebase.
  const noAuthority = await setup("no-authority");
  try {
    const gen2 = writeRegenerationFixture(noAuthority, { generationOrdinal: 2, firstGlobalExecutionOrdinal: 3, completed: true });
    const gen3 = writeRegenerationFixture(noAuthority, { generationOrdinal: 3, firstGlobalExecutionOrdinal: 6, completed: false });
    await writeFullyPaired(noAuthority, 1, undefined);
    await writeFullyPaired(noAuthority, 2, undefined);
    // ordinal(3-1=2) is below gen2's own firstGlobalExecutionOrdinal(3), so
    // it must resolve under "no regeneration" -- matching how the real
    // i-stanbul-un-fethi-1453 case has an earlier Gen1 boundary this
    // simplified two-generation fixture does not model.
    await writeFullyPaired(noAuthority, 3, undefined);
    await writeFullyPaired(noAuthority, 4, gen2);
    await writeFullyPaired(noAuthority, 5, gen2);
    await writeFullyPaired(noAuthority, 6, gen2);
    const { record: candidate, reservation: candidateReservation } = await writeUnclaimedOrphan(noAuthority, 7, gen2);
    writeMatchingToleranceAuthority(noAuthority, candidate, candidateReservation);
    const canonical = await writeFullyPaired(noAuthority, 7, gen3);
    const frontier = await writeFullyPaired(noAuthority, 8, gen3);

    await scenario("1: no supersession authority -> lineage-cardinality (unaffected baseline)", async () => {
      const result = await classifyProductionDurableAttemptLineage(
        noAuthority.adapter, projectSlug, stage, 8, "preparation", noAuthority.storageContext,
      );
      assert.equal(result.status, "invalid");
      if (result.status === "invalid") assert.equal(result.boundary, "lineage-cardinality");
    });

    // --- 14) same as (1), explicit label per the emir's own numbering.
    await scenario("14: authority not published -> classifier behavior identical to (1)", async () => {
      const result = await classifyProductionDurableAttemptLineage(
        noAuthority.adapter, projectSlug, stage, 8, "preparation", noAuthority.storageContext,
      );
      assert.equal(result.status, "invalid");
    });

    // --- Now publish the real decision through the honest gate, and confirm
    // the full-topology transformation (2, 3, 15, 16 all in one fixture).
    await publishRealDecision(noAuthority, candidate.recordId, canonical.recordId);

    await scenario("2/15/16: valid Gen2->Gen3 authority -> ONLY the candidate is excluded; canonical and all other 7 records retained; topology valid", async () => {
      const result = await classifyProductionDurableAttemptLineage(
        noAuthority.adapter, projectSlug, stage, 8, "preparation", noAuthority.storageContext,
      );
      assert.equal(result.status, "valid", `evidence: ${JSON.stringify(result)}`);
      if (result.status === "valid") {
        assert.equal(result.durableOrdinal, 8);
        assert.equal(result.maximumRecordAttempt, 8);
        // The frontier (ordinal 8) is the latestAttempt, as expected --
        // canonical (ordinal 7) is proven to have survived and correctly
        // paired by the SEPARATE exact-mode check just below, which can
        // only resolve `valid` if canonical's own claim/attempt/binding
        // proof all passed.
        assert.equal(result.latestAttempt.identity.recordId, frontier.recordId);
      }
      const exactResult = await classifyProductionDurableAttemptLineage(
        noAuthority.adapter, projectSlug, stage, 7, "exact", noAuthority.storageContext,
      );
      assert.equal(exactResult.status, "valid", `exact-mode evidence: ${JSON.stringify(exactResult)}`);
      if (exactResult.status === "valid") assert.equal(exactResult.durableOrdinal, 7);
    });

    await scenario("3: canonical is never itself excludable via the discovery API (candidateRecordId never matches canonical)", async () => {
      const discovery = findSupersessionDecisionForCandidate(
        projectSlug, stage, canonical.recordId, noAuthority.storageContext,
      );
      assert.equal(discovery.status, "none");
    });
  } finally { await fs.rm(noAuthority.root, { recursive: true, force: true }); }

  // --- 4) Candidate has since acquired a claim (race: record changed after
  // publish) -> fresh re-check refuses exclusion even though a decision
  // exists.
  const candidateClaimed = await setup("candidate-claimed");
  try {
    const gen2 = writeRegenerationFixture(candidateClaimed, { generationOrdinal: 2, firstGlobalExecutionOrdinal: 3, completed: true });
    const gen3 = writeRegenerationFixture(candidateClaimed, { generationOrdinal: 3, firstGlobalExecutionOrdinal: 6, completed: false });
    const candidate = await writeFullyPaired(candidateClaimed, 7, gen2); // claim+attempt -- NOT an orphan
    const canonical = await writeFullyPaired(candidateClaimed, 7, gen3);
    publishHandCraftedDecision(candidateClaimed, { candidateRecordId: candidate.recordId, canonicalRecordId: canonical.recordId, attempt: 7 });

    await scenario("4: candidate has a claim at consumption time -> exclusion refused (fresh re-check), duplicate stays lineage-cardinality", async () => {
      const result = await classifyProductionDurableAttemptLineage(
        candidateClaimed.adapter, projectSlug, stage, 8, "preparation", candidateClaimed.storageContext,
      );
      assert.equal(result.status, "invalid");
      if (result.status === "invalid") assert.equal(result.boundary, "lineage-cardinality");
    });
  } finally { await fs.rm(candidateClaimed.root, { recursive: true, force: true }); }

  // --- 5) Candidate has an attempt but the write happened not to include a
  // claim -- still execution evidence, still refused.
  const candidateAttempted = await setup("candidate-attempted");
  try {
    const gen2 = writeRegenerationFixture(candidateAttempted, { generationOrdinal: 2, firstGlobalExecutionOrdinal: 3, completed: true });
    const gen3 = writeRegenerationFixture(candidateAttempted, { generationOrdinal: 3, firstGlobalExecutionOrdinal: 6, completed: false });
    const candidateRecord = canonicalRecord(7, gen2);
    const candidateAttempt = canonicalAttempt(7, gen2, candidateRecord);
    assert.equal((await candidateAttempted.adapter.write("idempotency", `${candidateRecord.recordId}-v1`, candidateRecord)).ok, true);
    assert.equal((await candidateAttempted.adapter.write("attempt", `${candidateAttempt.identity.attemptId}-v1`, candidateAttempt)).ok, true);
    const canonical = await writeFullyPaired(candidateAttempted, 7, gen3);
    publishHandCraftedDecision(candidateAttempted, { candidateRecordId: candidateRecord.recordId, canonicalRecordId: canonical.recordId, attempt: 7 });

    await scenario("5: candidate has an attempt at consumption time -> exclusion refused", async () => {
      const result = await classifyProductionDurableAttemptLineage(
        candidateAttempted.adapter, projectSlug, stage, 8, "preparation", candidateAttempted.storageContext,
      );
      assert.equal(result.status, "invalid");
      if (result.status === "invalid") assert.equal(result.boundary, "lineage-cardinality");
    });
  } finally { await fs.rm(candidateAttempted.root, { recursive: true, force: true }); }

  // --- 6) Same-generation "decision" (hand-crafted, bypassing the honest
  // gate which would have refused to publish this) -> classifier's OWN
  // fresh generation-ordinal comparison still refuses.
  const sameGeneration = await setup("same-generation");
  try {
    const gen2 = writeRegenerationFixture(sameGeneration, { generationOrdinal: 2, firstGlobalExecutionOrdinal: 3, completed: true });
    const gen2b = writeRegenerationFixture(sameGeneration, { generationOrdinal: 2, firstGlobalExecutionOrdinal: 3, completed: true });
    const { record: candidate, reservation: candidateReservation } = await writeUnclaimedOrphan(sameGeneration, 7, gen2);
    writeMatchingToleranceAuthority(sameGeneration, candidate, candidateReservation);
    const canonical = await writeFullyPaired(sameGeneration, 7, gen2b);
    publishHandCraftedDecision(sameGeneration, { candidateRecordId: candidate.recordId, canonicalRecordId: canonical.recordId, attempt: 7 });

    await scenario("6: same-generation hand-crafted decision -> refused by fresh generationOrdinal<generationOrdinal check", async () => {
      const result = await classifyProductionDurableAttemptLineage(
        sameGeneration.adapter, projectSlug, stage, 7, "preparation", sameGeneration.storageContext,
      );
      assert.equal(result.status, "invalid");
      if (result.status === "invalid") assert.equal(result.boundary, "lineage-cardinality");
    });
  } finally { await fs.rm(sameGeneration.root, { recursive: true, force: true }); }

  // --- 7/9) Malformed/invalid decision file (structurally broken) -> exclusion refused.
  const malformed = await setup("malformed-authority");
  try {
    const gen2 = writeRegenerationFixture(malformed, { generationOrdinal: 2, firstGlobalExecutionOrdinal: 3, completed: true });
    const gen3 = writeRegenerationFixture(malformed, { generationOrdinal: 3, firstGlobalExecutionOrdinal: 6, completed: false });
    const { record: candidate, reservation: candidateReservation } = await writeUnclaimedOrphan(malformed, 7, gen2);
    writeMatchingToleranceAuthority(malformed, candidate, candidateReservation);
    const canonical = await writeFullyPaired(malformed, 7, gen3);
    const decisionsDir = path.join(getProjectRoot(projectSlug, malformed.storageContext), "production-execution", "superseded-duplicate-reservations");
    fsSync.mkdirSync(decisionsDir, { recursive: true });
    fsSync.writeFileSync(path.join(decisionsDir, "decision-tampered.json"), JSON.stringify({
      schemaVersion: "1", policyVersion: supersededDuplicateReservationPolicyVersion,
      decisionId: "tampered", projectSlug, stage, jobId: `${projectSlug}-${stage}`, attempt: 7,
      candidateRecordId: candidate.recordId, canonicalRecordId: canonical.recordId,
      reason: "later-regeneration-duplicate-ordinal",
      proof: { candidateReservationId: "x", canonicalReservationId: "y",
        candidateReservationContentFingerprint: "x", canonicalReservationContentFingerprint: "y",
        candidateRegenerationId: "x", candidateGenerationOrdinal: 2,
        canonicalRegenerationId: "y", canonicalGenerationOrdinal: 3, toleranceAuthorityId: "z" },
      integrity: { algorithm: "stable-production-id-v1", fingerprint: "deliberately-wrong-fingerprint" },
    }, null, 2) + "\n", "utf8");

    await scenario("7/9: malformed/integrity-invalid decision file -> exclusion refused", async () => {
      const result = await classifyProductionDurableAttemptLineage(
        malformed.adapter, projectSlug, stage, 8, "preparation", malformed.storageContext,
      );
      assert.equal(result.status, "invalid");
      if (result.status === "invalid") assert.equal(result.boundary, "lineage-cardinality");
    });
  } finally { await fs.rm(malformed.root, { recursive: true, force: true }); }

  // --- 8) Ambiguous: two decision files both naming the same candidate.
  const ambiguous = await setup("ambiguous-authority");
  try {
    const gen2 = writeRegenerationFixture(ambiguous, { generationOrdinal: 2, firstGlobalExecutionOrdinal: 3, completed: true });
    const gen3 = writeRegenerationFixture(ambiguous, { generationOrdinal: 3, firstGlobalExecutionOrdinal: 6, completed: false });
    const gen3b = writeRegenerationFixture(ambiguous, { generationOrdinal: 3, firstGlobalExecutionOrdinal: 6, completed: false });
    const { record: candidate, reservation: candidateReservation } = await writeUnclaimedOrphan(ambiguous, 7, gen2);
    writeMatchingToleranceAuthority(ambiguous, candidate, candidateReservation);
    const canonical = await writeFullyPaired(ambiguous, 7, gen3);
    // A second, DIFFERENT canonical (different regeneration binding, same
    // ordinal) also fully paired -- gives us a distinct recordId to name in
    // a SECOND decision for the exact same candidate.
    const otherCanonicalRecord = canonicalRecord(7, gen3b);
    // Deliberately not written to the adapter -- this second decision only
    // needs a distinct recordId string to prove ambiguity detection; it
    // does not need to be a fully valid, separately-paired record.
    publishHandCraftedDecision(ambiguous, { candidateRecordId: candidate.recordId, canonicalRecordId: canonical.recordId, attempt: 7 });
    publishHandCraftedDecision(ambiguous, { candidateRecordId: candidate.recordId, canonicalRecordId: otherCanonicalRecord.recordId, attempt: 7 });

    await scenario("8: two decisions naming the same candidate -> ambiguous, exclusion refused", async () => {
      const discovery = findSupersessionDecisionForCandidate(projectSlug, stage, candidate.recordId, ambiguous.storageContext);
      assert.equal(discovery.status, "ambiguous");
      const result = await classifyProductionDurableAttemptLineage(
        ambiguous.adapter, projectSlug, stage, 8, "preparation", ambiguous.storageContext,
      );
      assert.equal(result.status, "invalid");
      if (result.status === "invalid") assert.equal(result.boundary, "lineage-cardinality");
    });
  } finally { await fs.rm(ambiguous.root, { recursive: true, force: true }); }

  // --- 10/12) Decision's canonicalRecordId is not part of this scan at all
  // (foreign/nonexistent) -> exclusion refused.
  const canonicalMissing = await setup("canonical-missing");
  try {
    const gen2 = writeRegenerationFixture(canonicalMissing, { generationOrdinal: 2, firstGlobalExecutionOrdinal: 3, completed: true });
    await writeFullyPaired(canonicalMissing, 1, undefined);
    await writeFullyPaired(canonicalMissing, 2, undefined);
    await writeFullyPaired(canonicalMissing, 3, undefined);
    await writeFullyPaired(canonicalMissing, 4, gen2);
    await writeFullyPaired(canonicalMissing, 5, gen2);
    await writeFullyPaired(canonicalMissing, 6, gen2);
    const { record: candidate, reservation: candidateReservation } = await writeUnclaimedOrphan(canonicalMissing, 7, gen2);
    writeMatchingToleranceAuthority(canonicalMissing, candidate, candidateReservation);
    publishHandCraftedDecision(canonicalMissing, {
      candidateRecordId: candidate.recordId, canonicalRecordId: "pipeline-record-nonexistent-foreign", attempt: 7,
    });

    await scenario("10/12: decision's canonicalRecordId is not present in this scan -> exclusion refused", async () => {
      const result = await classifyProductionDurableAttemptLineage(
        canonicalMissing.adapter, projectSlug, stage, 6, "preparation", canonicalMissing.storageContext,
      );
      // With no canonical at all, ordinal 7 is a lone orphan (no duplicate) --
      // the EXISTING single-record orphan-tolerance path (unchanged) still
      // applies and correctly excludes it on its own terms.
      assert.equal(result.status, "valid");
      if (result.status === "valid") assert.equal(result.durableOrdinal, 6);
    });
  } finally { await fs.rm(canonicalMissing.root, { recursive: true, force: true }); }

  // --- 11) Decision's candidateRecordId does not match any real record ->
  // trivially "none" via discovery, never reached during classification.
  const candidateMismatch = await setup("candidate-mismatch");
  try {
    const gen2 = writeRegenerationFixture(candidateMismatch, { generationOrdinal: 2, firstGlobalExecutionOrdinal: 3, completed: true });
    const gen3 = writeRegenerationFixture(candidateMismatch, { generationOrdinal: 3, firstGlobalExecutionOrdinal: 6, completed: false });
    const { record: candidate, reservation: candidateReservation } = await writeUnclaimedOrphan(candidateMismatch, 7, gen2);
    writeMatchingToleranceAuthority(candidateMismatch, candidate, candidateReservation);
    const canonical = await writeFullyPaired(candidateMismatch, 7, gen3);
    publishHandCraftedDecision(candidateMismatch, {
      candidateRecordId: "pipeline-record-nonexistent-candidate", canonicalRecordId: canonical.recordId, attempt: 7,
    });

    await scenario("11: decision names a candidateRecordId that doesn't exist -> discovery finds nothing for the real candidate", async () => {
      const discovery = findSupersessionDecisionForCandidate(projectSlug, stage, candidate.recordId, candidateMismatch.storageContext);
      assert.equal(discovery.status, "none");
      const result = await classifyProductionDurableAttemptLineage(
        candidateMismatch.adapter, projectSlug, stage, 8, "preparation", candidateMismatch.storageContext,
      );
      assert.equal(result.status, "invalid");
      if (result.status === "invalid") assert.equal(result.boundary, "lineage-cardinality");
    });
  } finally { await fs.rm(candidateMismatch.root, { recursive: true, force: true }); }

  // --- 13) Canonical's generation is no longer the active max (a newer
  // Gen4 appeared after the decision was published) -> fresh re-check refuses.
  const canonicalStale = await setup("canonical-stale");
  try {
    const gen2 = writeRegenerationFixture(canonicalStale, { generationOrdinal: 2, firstGlobalExecutionOrdinal: 3, completed: true });
    const gen3 = writeRegenerationFixture(canonicalStale, { generationOrdinal: 3, firstGlobalExecutionOrdinal: 6, completed: false });
    const { record: candidate, reservation: candidateReservation } = await writeUnclaimedOrphan(canonicalStale, 7, gen2);
    writeMatchingToleranceAuthority(canonicalStale, candidate, candidateReservation);
    const canonical = await writeFullyPaired(canonicalStale, 7, gen3);
    await publishRealDecision(canonicalStale, candidate.recordId, canonical.recordId);
    // Gen4 appears AFTER the decision was published.
    writeRegenerationFixture(canonicalStale, { generationOrdinal: 4, firstGlobalExecutionOrdinal: 9, completed: false });

    await scenario("13: canonical's generation is no longer active/max at consumption time -> exclusion refused", async () => {
      const result = await classifyProductionDurableAttemptLineage(
        canonicalStale.adapter, projectSlug, stage, 8, "preparation", canonicalStale.storageContext,
      );
      assert.equal(result.status, "invalid");
      if (result.status === "invalid") assert.equal(result.boundary, "lineage-cardinality");
    });
  } finally { await fs.rm(canonicalStale.root, { recursive: true, force: true }); }

  assert.ok(scenarios >= 12);
  process.stdout.write(`Classifier superseded-duplicate integration smoke: PASS (${scenarios} scenarios)\n`);
  emitSmokeResult("classifier-superseded-duplicate-integration", scenarios);
}

async function main() {
  const previousRuntimeRoot = process.env.ATOLYE_RUNTIME_ROOT;
  try {
    await runScenarios();
  } finally {
    if (previousRuntimeRoot === undefined) delete process.env.ATOLYE_RUNTIME_ROOT;
    else process.env.ATOLYE_RUNTIME_ROOT = previousRuntimeRoot;
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
