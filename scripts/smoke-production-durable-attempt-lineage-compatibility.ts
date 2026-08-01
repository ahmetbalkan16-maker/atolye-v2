import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
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
  isProductionExecutionTerminalDurableRecordState,
  AdapterBackedProductionExecutionDurableStorage,
} from "../src/lib/production/ProductionExecutionDurableStorage";
import {
  isProductionExecutionTerminalAttemptState,
  validateProductionExecutionDurableAttempt,
} from "../src/lib/production/ProductionExecutionDurableAttempt";
import {
  buildProductionPipelineExecutionIdentity,
  productionDurableAttemptLineageBindingInvalidCode,
  resolveDurableAttemptOrdinal,
} from "../src/lib/production/ProductionPipelineExecutionFactory";
import { ProductionPipelineDurableExecutionError } from
  "../src/lib/production/ProductionPipelineExecutionAdapter";
import {
  readProductionDurableAttemptLineageBoundary,
  type ProductionDurableAttemptLineageBoundary,
} from "../src/lib/production/ProductionDurableAttemptLineageBoundary";
import { ProductionExecutionFilePersistenceAdapter } from
  "../src/lib/production/ProductionExecutionPersistence";
import { runProductionAcceptanceCommand } from
  "../src/lib/production/ProductionAcceptanceCommand";
import {
  createProductionRuntimeOperationContext,
  initialRuntimeAuthorityGeneration,
  runWithProductionRuntimeOperationContext,
} from "../src/lib/runtime/ProductionRuntimeOperationContext";
import { createRuntimeStorageContext } from "../src/lib/runtime/RuntimeStoragePaths";
import type { ProductionExecutionDurableAttemptRecord } from
  "../src/types/productionExecutionDurableAttempt";
import type { ProductionExecutionDurableClaimRecord } from
  "../src/types/productionExecutionDurableClaim";
import type { ProductionExecutionIdempotencyRecord } from
  "../src/types/productionExecutionIdempotency";
import type { ProductionExecutionDurableRecord } from
  "../src/types/productionExecutionDurableStorage";
import { stableProductionId } from "../src/lib/production/ProductionDeterminism";

const projectSlug = "legacy-lineage-project";
const stage = "audio" as const;
const resumeOperation = "pipeline.stage.resume";
const timestamp = "2026-07-30T18:00:00.000Z";
const expectedCode = productionDurableAttemptLineageBindingInvalidCode;
const preRefactorPhysicalAggregateSha256 =
  "29408d2d24283bb0f56c3fae22f2218638ad4bca01b0f6da5408f1c561c4f1d5";
let scenarios = 0;

type DeclaredBoundary =
  | "attempt-operation-presence"
  | "attempt-operation-format"
  | "attempt-record-operation-binding"
  | "terminal-legacy-operation-compatibility"
  | "record-operation-format"
  | "record-run-type-execution-binding"
  | "record-project-binding"
  | "record-stage-binding"
  | "record-ordinal-topology"
  | "attempt-request-binding"
  | "attempt-canonical-id-topology"
  | "record-canonical-id"
  | "record-execution-fingerprint"
  | "attempt-reservation-binding"
  | "attempt-idempotency-binding"
  | "attempt-claim-binding"
  | "attempt-lease-binding"
  | "attempt-integrity"
  | "record-integrity"
  | "version-contiguity"
  | "lineage-topology"
  | "runtime-operation-fallback";

interface Fixture {
  readonly root: string;
  readonly durableRoot: string;
  readonly adapter: ProductionExecutionFilePersistenceAdapter;
  readonly records: ProductionExecutionDurableRecord[];
  readonly claims: ProductionExecutionDurableClaimRecord[];
  readonly attempts: ProductionExecutionDurableAttemptRecord[];
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

interface TreeEntry {
  readonly relativePath: string;
  readonly type: "file" | "directory";
  readonly byteLength: number;
  readonly sha256?: string;
  readonly birthtimeMs: number;
  readonly mtimeMs: number;
}

interface TreeSnapshot {
  readonly fileCount: number;
  readonly directoryCount: number;
  readonly entries: readonly TreeEntry[];
  readonly aggregateSha256: string;
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

function identityFor(operation: string, planned: ReturnType<typeof buildProductionPipelineExecutionIdentity>,
  identityProject = projectSlug, identityStage: typeof stage | "video" = stage,
  executionFingerprint = planned.executionFingerprint) {
  const authorization = {
    schemaVersion: "1" as const, decisionId: `authorization-${planned.recordId}`,
    decision: "allow" as const, authorized: true as const, reasonCode: "AUTHORIZED" as const,
    reason: "trusted physical compatibility fixture", evaluatedAt: timestamp,
    requestId: planned.requestId, idempotencyKey: planned.idempotencyKey,
    executionFingerprint, actorId: "pipeline-system",
    actorType: "system" as const, projectSlug: identityProject, operation,
    action: "retry-stage", stage: identityStage,
    requiredCapabilities: [], grantedCapabilities: [], missingCapabilities: [],
    policyVersion: defaultProductionExecutionIdempotencyPolicy.policyVersion,
    risk: "high" as const, requiresConfirmation: true,
    requiredConfirmationLevel: "high" as const, evidence: ["source:test"],
  };
  const confirmation = {
    schemaVersion: "1" as const, decision: "valid" as const, valid: true as const,
    reasonCode: "CONFIRMATION_VALID" as const, reason: "trusted physical compatibility fixture",
    evaluatedAt: timestamp, confirmationId: `confirmation-${planned.recordId}`,
    confirmationRequestId: `confirmation-request-${planned.recordId}`,
    authorizationDecisionId: authorization.decisionId, requestId: planned.requestId,
    idempotencyKey: planned.idempotencyKey, actorId: "pipeline-system",
    projectSlug: identityProject, operation, action: "retry-stage", stage: identityStage,
    riskLevel: "high",
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
        "retry-stage": 3,
      } },
  });
  assert.equal(result.ok, true);
  assert.ok(result.identity);
  return result.identity;
}

function canonicalRecord(ordinal: number, options: {
  operation?: string;
  runType?: "initial" | "resume" | "retry";
  project?: string;
  recordStage?: typeof stage | "video";
  recordId?: string;
  attemptOrdinal?: number;
  executionFingerprint?: string;
} = {}): ProductionExecutionDurableRecord {
  const runType = options.runType ?? "resume";
  const recordProject = options.project ?? projectSlug;
  const recordStage = options.recordStage ?? stage;
  const planned = buildProductionPipelineExecutionIdentity(
    { projectSlug: recordProject, stage: recordStage, runType },
    { id: `${recordProject}-${recordStage}`, attempts: ordinal - 1 },
  );
  const operation = options.operation ?? `pipeline.stage.${runType}`;
  const identity = identityFor(operation, planned, recordProject, recordStage,
    options.executionFingerprint);
  return {
    schemaVersion: "1", recordId: options.recordId ?? planned.recordId,
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
    attempt: options.attemptOrdinal ?? ordinal, maxAttempts: 3,
    createdAt: timestamp, updatedAt: timestamp, reservedAt: timestamp, finishedAt: timestamp,
    evidence: ["source:pipeline-composition"],
    integrity: { algorithm: "stable-production-id-v1", fingerprint: identity.identityFingerprint,
      version: 1 }, storageVersion: "1", lifecycleState: "cancelled", recordVersion: 1,
  };
}

function canonicalAttempt(ordinal: number, record: ProductionExecutionIdempotencyRecord,
  operation: string | undefined = undefined): ProductionExecutionDurableAttemptRecord {
  const planned = buildProductionPipelineExecutionIdentity(
    { projectSlug, stage, runType: "resume" },
    { id: `${projectSlug}-${stage}`, attempts: ordinal - 1 },
  );
  const identity = {
    attemptId: planned.attemptId, claimId: planned.claimId,
    reservationId: record.identityFingerprint, recordId: planned.recordId,
    requestId: planned.requestId, idempotencyKey: planned.idempotencyKey,
    ...(operation !== undefined ? { operation } : {}),
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

async function createFixture(ordinals: readonly number[] = [1]): Promise<Fixture> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "atolye-lineage-physical-"));
  const durableRoot = path.join(root, "runtime", "projects", projectSlug, "production-execution");
  const adapter = new ProductionExecutionFilePersistenceAdapter({
    trustedRootDirectory: durableRoot, trustedAttemptIdFactory: () => "lineage-fixture",
  });
  const records: ProductionExecutionDurableRecord[] = [];
  const claims: ProductionExecutionDurableClaimRecord[] = [];
  const attempts: ProductionExecutionDurableAttemptRecord[] = [];
  for (const ordinal of ordinals) {
    const record = canonicalRecord(ordinal);
    const attempt = canonicalAttempt(ordinal, record);
    const claim = canonicalClaim(record, attempt);
    assert.equal((await adapter.write("idempotency", `${record.recordId}-v1`, record)).ok, true);
    assert.equal((await adapter.write("claim", `${claim.identity.claimId}-v1`, claim)).ok, true);
    assert.equal((await adapter.write("attempt", `${attempt.identity.attemptId}-v1`, attempt)).ok, true);
    records.push(record); claims.push(claim); attempts.push(attempt);
  }
  return { root, durableRoot, adapter, records, claims, attempts };
}

async function replaceRecord(item: Fixture, record: ProductionExecutionDurableRecord,
  index = 0, key = `${record.recordId}-v${record.integrity.version}`): Promise<void> {
  const previous = item.records[index];
  await fs.rm(path.join(item.durableRoot, "idempotency",
    `${previous.recordId}-v${previous.integrity.version}.json`));
  assert.equal((await item.adapter.write("idempotency", key, record)).ok, true);
  item.records[index] = record;
}

async function replaceAttempt(item: Fixture, attempt: ProductionExecutionDurableAttemptRecord,
  index = 0, key = `${attempt.identity.attemptId}-v${attempt.attemptVersion}`): Promise<void> {
  const previous = item.attempts[index];
  await fs.rm(path.join(item.durableRoot, "attempts",
    `${previous.identity.attemptId}-v${previous.attemptVersion}.json`));
  assert.equal((await item.adapter.write("attempt", key, attempt)).ok, true);
  item.attempts[index] = attempt;
}

async function tree(root: string): Promise<TreeSnapshot> {
  const entries: TreeEntry[] = [];
  const visit = async (directory: string): Promise<void> => {
    const names = await fs.readdir(directory);
    for (const name of names.sort()) {
      const target = path.join(directory, name);
      const stat = await fs.lstat(target);
      const relativePath = path.relative(root, target).replaceAll("\\", "/");
      assert.equal(stat.isSymbolicLink(), false);
      if (stat.isDirectory()) {
        entries.push({ relativePath, type: "directory", byteLength: 0,
          birthtimeMs: stat.birthtimeMs, mtimeMs: stat.mtimeMs });
        await visit(target);
      } else {
        assert.equal(stat.isFile(), true);
        const bytes = await fs.readFile(target);
        entries.push({ relativePath, type: "file", byteLength: bytes.byteLength,
          sha256: createHash("sha256").update(bytes).digest("hex"),
          birthtimeMs: stat.birthtimeMs, mtimeMs: stat.mtimeMs });
      }
    }
  };
  await visit(root);
  const material = entries.map(({ relativePath, type, byteLength, sha256 }) =>
    `${type}\0${relativePath}\0${byteLength}\0${sha256 ?? ""}`).join("\n");
  return {
    fileCount: entries.filter((entry) => entry.type === "file").length,
    directoryCount: entries.filter((entry) => entry.type === "directory").length,
    entries,
    aggregateSha256: createHash("sha256").update(material).digest("hex"),
  };
}

function byteIdentity(snapshot: TreeSnapshot) {
  return {
    fileCount: snapshot.fileCount, directoryCount: snapshot.directoryCount,
    paths: snapshot.entries.map((entry) => entry.relativePath),
    files: snapshot.entries.filter((entry) => entry.type === "file")
      .map(({ relativePath, byteLength, sha256 }) => ({ relativePath, byteLength, sha256 })),
    aggregateSha256: snapshot.aggregateSha256,
  };
}

async function scenario(name: string, action: () => Promise<void>): Promise<void> {
  await action(); scenarios += 1;
  process.stdout.write(`PASS ${scenarios}: ${name}\n`);
}

async function assertValidationPreconditions(item: Fixture,
  adapter: ProductionExecutionFilePersistenceAdapter,
  expectedObservedBoundary: ProductionDurableAttemptLineageBoundary): Promise<void> {
  const storage = new AdapterBackedProductionExecutionDurableStorage(adapter);
  const recordKeys = await adapter.listKeys("idempotency");
  assert.equal(recordKeys.ok, true);
  let recordReadFailure = false;
  if (recordKeys.ok) {
    for (const key of recordKeys.keys) {
      const read = await adapter.read("idempotency", key);
      if (read.status !== "found") { recordReadFailure = true; continue; }
      assert.equal(storage.validateRecord(read.value as ProductionExecutionDurableRecord).ok, true,
        `record validator precondition failed before ${expectedObservedBoundary}`);
    }
  }
  assert.equal(recordReadFailure, expectedObservedBoundary === "record-integrity");

  const attemptKeys = await adapter.listKeys("attempt");
  assert.equal(attemptKeys.ok, true);
  let attemptReadFailure = false;
  if (attemptKeys.ok) {
    for (const key of attemptKeys.keys) {
      const read = await adapter.read("attempt", key);
      if (read.status !== "found") { attemptReadFailure = true; continue; }
      assert.equal(validateProductionExecutionDurableAttempt(read.value), true,
        `attempt validator precondition failed before ${expectedObservedBoundary}`);
    }
  }
  assert.equal(attemptReadFailure, expectedObservedBoundary === "attempt-integrity");
  assert.equal(item.root.startsWith(os.tmpdir()), true);
}

async function expectRejected(name: string, declaredBoundary: DeclaredBoundary,
  expectedObservedBoundary: ProductionDurableAttemptLineageBoundary,
  mutate: (item: Fixture) => Promise<ProductionExecutionFilePersistenceAdapter | void>,
  expectedJobAttempt = 1,
  ordinals: readonly number[] = [1]): Promise<void> {
  await scenario(name, async () => {
    const item = await createFixture(ordinals);
    try {
      const resolverAdapter = await mutate(item) ?? item.adapter;
      await assertValidationPreconditions(item, resolverAdapter, expectedObservedBoundary);
      const before = await tree(item.durableRoot);
      let actualCode: string | undefined;
      let actualObservedBoundary: ProductionDurableAttemptLineageBoundary | undefined;
      await assert.rejects(
        resolveDurableAttemptOrdinal(resolverAdapter, projectSlug, stage, expectedJobAttempt),
        (error) => {
          actualCode = error instanceof ProductionPipelineDurableExecutionError ? error.code : undefined;
          actualObservedBoundary = readProductionDurableAttemptLineageBoundary(error);
          return error instanceof ProductionPipelineDurableExecutionError &&
            error.code === expectedCode && error.reasonCode === expectedCode;
        },
      );
      const after = await tree(item.durableRoot);
      assert.equal(actualCode, expectedCode);
      assert.equal(actualObservedBoundary, expectedObservedBoundary);
      assert.deepEqual(byteIdentity(after), byteIdentity(before));
      if (expectedObservedBoundary === "attempt-operation-presence") {
        process.stdout.write(`SEMANTIC_UNDEFINED_PHYSICAL_TREE ${JSON.stringify({
          before: byteIdentity(before), after: byteIdentity(after), semanticFixtureScenarioCount: 1,
        })}\n`);
      }
      process.stdout.write(`BOUNDARY ${JSON.stringify({ scenario: name, declaredBoundary,
        expectedObservedBoundary, actualObservedBoundary, publicErrorCode: actualCode })}\n`);
    } finally { await fs.rm(item.root, { recursive: true, force: true }); }
  });
}

async function main() {
  await scenario("legacy terminal missing-operation lineage is admitted through physical persistence write-free", async () => {
    const item = await createFixture([1, 2]);
    try {
      const before = await tree(item.durableRoot);
      assert.equal(Object.hasOwn(item.attempts[1].identity, "operation"), false);
      assert.equal(isProductionExecutionTerminalAttemptState(item.attempts[1].state), true);
      assert.equal(isProductionExecutionTerminalDurableRecordState(item.records[1].state), true);
      assert.equal(item.records[1].operation, resumeOperation);
      assert.equal(validateProductionExecutionDurableAttempt(item.attempts[1]), true);
      assert.equal(new AdapterBackedProductionExecutionDurableStorage(item.adapter)
        .validateRecord(item.records[1] as never).ok, true);
      assert.equal(await resolveDurableAttemptOrdinal(item.adapter, projectSlug, stage, 2), 2);
      const after = await tree(item.durableRoot);
      assert.equal(before.aggregateSha256, preRefactorPhysicalAggregateSha256);
      assert.equal(after.aggregateSha256, preRefactorPhysicalAggregateSha256);
      assert.deepEqual(after, before);
      assert.deepEqual(byteIdentity(after), byteIdentity(before));
      assert.equal(after.entries.some((entry) => /tmp|partial|quarantine|lock|journal/i
        .test(entry.relativePath)), false);
      process.stdout.write(`PHYSICAL_TREE ${JSON.stringify({ before: byteIdentity(before),
        after: byteIdentity(after), metadataExact: true })}\n`);
    } finally { await fs.rm(item.root, { recursive: true, force: true }); }
  });

  await expectRejected("attempt operation own-property present with undefined", "attempt-operation-presence",
    "attempt-operation-presence",
    async (item) => {
      const semanticReadAdapter = {
        listKeys: item.adapter.listKeys.bind(item.adapter),
        write: item.adapter.write.bind(item.adapter),
        read: async (...args: Parameters<ProductionExecutionFilePersistenceAdapter["read"]>) => {
          const read = await item.adapter.read(...args);
          if (args[0] !== "attempt" || read.status !== "found") return read;
          const next = structuredClone(read.value as ProductionExecutionDurableAttemptRecord);
          Object.defineProperty(next.identity, "operation", { value: undefined, enumerable: true,
            configurable: true, writable: true });
          return { ...read, value: buildProductionExecutionDurableAttemptIntegrity(next) } as typeof read;
        },
      } as ProductionExecutionFilePersistenceAdapter;
      const probe = await semanticReadAdapter.read("attempt", `${item.attempts[0].identity.attemptId}-v1`);
      assert.equal(probe.status, "found");
      assert.equal(Object.hasOwn((probe as { value: ProductionExecutionDurableAttemptRecord }).value.identity,
        "operation"), true);
      process.stdout.write("JSON cannot encode an enumerable own property whose value is undefined; " +
        "this single case validates the post-deserialization semantic boundary. " +
        "All other negative lineage fixtures are physically persisted.\n");
      return semanticReadAdapter;
    });
  await expectRejected("attempt operation empty string", "attempt-operation-format",
    "attempt-record-operation-binding", async (item) => {
    const next = structuredClone(item.attempts[0]); next.identity.operation = "";
    await replaceAttempt(item, buildProductionExecutionDurableAttemptIntegrity(next));
  });
  await expectRejected("attempt operation malformed", "attempt-operation-format",
    "attempt-record-operation-binding", async (item) => {
    const next = structuredClone(item.attempts[0]); next.identity.operation = "pipeline.stage.resume.foreign";
    await replaceAttempt(item, buildProductionExecutionDurableAttemptIntegrity(next));
  });
  await expectRejected("attempt operation differs from record operation",
    "attempt-record-operation-binding", "attempt-record-operation-binding", async (item) => {
      const next = structuredClone(item.attempts[0]); next.identity.operation = "pipeline.stage.retry";
      await replaceAttempt(item, buildProductionExecutionDurableAttemptIntegrity(next));
    });
  await expectRejected("non-terminal attempt cannot omit operation",
    "terminal-legacy-operation-compatibility", "terminal-legacy-operation-compatibility",
    async (item) => {
      const next = structuredClone(item.attempts[0]); next.state = "active"; delete next.finalizedAt;
      await replaceAttempt(item, buildProductionExecutionDurableAttemptIntegrity(next));
    });
  await expectRejected("non-terminal record cannot authorize missing attempt operation",
    "terminal-legacy-operation-compatibility", "terminal-legacy-operation-compatibility",
    async (item) => {
      const next = structuredClone(item.records[0]); next.state = "running";
      next.lifecycleState = "running"; delete next.finishedAt;
      await replaceRecord(item, next);
    });
  await expectRejected("record operation malformed", "record-operation-format",
    "record-operation-format", async (item) => {
    await replaceRecord(item, canonicalRecord(1, { operation: "resume" }));
  });
  await expectRejected("record operation safe but incompatible with bound run type",
    "record-run-type-execution-binding", "claim-reservation-binding", async (item) => {
      await replaceRecord(item, canonicalRecord(1, { operation: "pipeline.stage.initial",
        runType: "initial" }));
    });
  await expectRejected("foreign project", "record-project-binding", "orphan-lineage",
    async (item) => {
    await replaceRecord(item, canonicalRecord(1, { project: "foreign-project" }));
  });
  await expectRejected("foreign stage", "record-stage-binding", "orphan-lineage",
    async (item) => {
    await replaceRecord(item, canonicalRecord(1, { recordStage: "video" }));
  });
  await expectRejected("foreign run type", "record-run-type-execution-binding",
    "claim-reservation-binding", async (item) => {
    await replaceRecord(item, canonicalRecord(1, { runType: "retry" }));
  });
  await expectRejected("foreign ordinal", "record-ordinal-topology", "lineage-cardinality",
    async (item) => {
    const next = structuredClone(item.records[0]); next.attempt = 2;
    await replaceRecord(item, next);
  });
  await expectRejected("attempt requestId mismatch", "attempt-request-binding",
    "attempt-request-binding", async (item) => {
    const next = structuredClone(item.attempts[0]); next.identity.requestId = "pipeline-request-foreign";
    await replaceAttempt(item, buildProductionExecutionDurableAttemptIntegrity(next));
  });
  await expectRejected("canonical attempt ID mismatch", "attempt-canonical-id-topology",
    "attempt-lineage-missing", async (item) => {
    const next = structuredClone(item.attempts[0]); next.identity.attemptId = "pipeline-attempt-foreign";
    next.journal = [journal(next.identity.attemptId)];
    await replaceAttempt(item, buildProductionExecutionDurableAttemptIntegrity(next), 0,
      `${item.attempts[0].identity.attemptId}-v1`);
  });
  await expectRejected("record canonical ID mismatch", "record-canonical-id", "record-canonical-id",
    async (item) => {
    const next = canonicalRecord(1, { recordId: "pipeline-record-foreign" });
    await replaceRecord(item, next);
  });
  await expectRejected("execution fingerprint mismatch", "record-execution-fingerprint",
    "record-execution-fingerprint",
    async (item) => {
      await replaceRecord(item, canonicalRecord(1, {
        executionFingerprint: "pipeline-execution-foreign",
      }));
    });
  await expectRejected("reservation binding mismatch", "attempt-reservation-binding",
    "attempt-reservation-binding", async (item) => {
    const next = structuredClone(item.attempts[0]);
    next.identity.reservationId = "idempotency-identity-foreign";
    await replaceAttempt(item, buildProductionExecutionDurableAttemptIntegrity(next));
  });
  await expectRejected("idempotency binding mismatch", "attempt-idempotency-binding",
    "attempt-idempotency-binding", async (item) => {
    const next = structuredClone(item.attempts[0]);
    next.identity.idempotencyKey = "pipeline-idempotency-foreign";
    await replaceAttempt(item, buildProductionExecutionDurableAttemptIntegrity(next));
  });
  await expectRejected("claim binding mismatch", "attempt-claim-binding", "attempt-claim-binding",
    async (item) => {
    const next = structuredClone(item.attempts[0]); next.identity.claimId = "pipeline-claim-foreign";
    await replaceAttempt(item, buildProductionExecutionDurableAttemptIntegrity(next));
  });
  await expectRejected("lease binding mismatch remains integrity-valid", "attempt-lease-binding",
    "attempt-lease-binding",
    async (item) => {
      const next = structuredClone(item.attempts[0]); next.identity.leaseId = "pipeline-lease-foreign";
      const rebuilt = buildProductionExecutionDurableAttemptIntegrity(next);
      assert.equal(validateProductionExecutionDurableAttempt(rebuilt), true);
      await replaceAttempt(item, rebuilt);
    });
  await expectRejected("attempt integrity mismatch", "attempt-integrity", "attempt-integrity",
    async (item) => {
    const file = path.join(item.durableRoot, "attempts", `${item.attempts[0].identity.attemptId}-v1.json`);
    const value = JSON.parse(await fs.readFile(file, "utf8")) as ProductionExecutionDurableAttemptRecord;
    value.integrity.fingerprint = "durable-attempt-integrity-00000000";
    await fs.writeFile(file, `${JSON.stringify(value)}\n`);
  });
  await expectRejected("record integrity mismatch", "record-integrity", "record-integrity",
    async (item) => {
    const file = path.join(item.durableRoot, "idempotency", `${item.records[0].recordId}-v1.json`);
    const value = JSON.parse(await fs.readFile(file, "utf8")) as ProductionExecutionDurableRecord;
    value.identityFingerprint = "idempotency-identity-foreign";
    await fs.writeFile(file, `${JSON.stringify(value)}\n`);
  });
  await expectRejected("version gap", "version-contiguity", "version-contiguity", async (item) => {
    const next = structuredClone(item.records[0]); next.integrity.version = 3; next.recordVersion = 3;
    assert.equal((await item.adapter.write("idempotency", `${next.recordId}-v3`, next)).ok, true);
  });
  await expectRejected("topology gap", "lineage-topology", "lineage-cardinality", async (item) => {
    await fs.rm(path.join(item.durableRoot, "idempotency",
      `${item.records[0].recordId}-v1.json`));
  }, 2, [1, 2]);
  await scenario("runtime operation fallback cannot supply missing non-terminal operation", async () => {
    const item = await createFixture();
    const authorityRoot = path.join(item.root, "authority"); await fs.mkdir(authorityRoot);
    const context = createProductionRuntimeOperationContext({
      operationId: "foreign-active-operation", operationType: "pipeline-stage-execution",
      authorityGeneration: initialRuntimeAuthorityGeneration,
      storageContext: createRuntimeStorageContext({ workspaceRoot: item.root, authorityRoot,
        environment: { ATOLYE_RUNTIME_ROOT: path.join(item.root, "runtime") } }),
    });
    try {
      const next = structuredClone(item.attempts[0]); next.state = "active"; delete next.finalizedAt;
      await replaceAttempt(item, buildProductionExecutionDurableAttemptIntegrity(next));
      const before = await tree(item.durableRoot);
      let actualObservedBoundary: ProductionDurableAttemptLineageBoundary | undefined;
      await assert.rejects(runWithProductionRuntimeOperationContext(context, () =>
        resolveDurableAttemptOrdinal(item.adapter, projectSlug, stage, 1)),
      (error) => {
        actualObservedBoundary = readProductionDurableAttemptLineageBoundary(error);
        return error instanceof ProductionPipelineDurableExecutionError && error.code === expectedCode;
      });
      assert.equal(actualObservedBoundary, "terminal-legacy-operation-compatibility");
      assert.deepEqual(byteIdentity(await tree(item.durableRoot)), byteIdentity(before));
      process.stdout.write(`BOUNDARY ${JSON.stringify({
        scenario: "runtime operation fallback cannot supply missing non-terminal operation",
        declaredBoundary: "runtime-operation-fallback",
        expectedObservedBoundary: "terminal-legacy-operation-compatibility",
        actualObservedBoundary,
        publicErrorCode: expectedCode,
      })}\n`);
    } finally { await fs.rm(item.root, { recursive: true, force: true }); }
  });

  await scenario("real lineage error propagates through acceptance command normalization", async () => {
    const item = await createFixture();
    let resolverCalls = 0; let resumeDependencyCalls = 0;
    try {
      const next = structuredClone(item.attempts[0]); next.identity.leaseId = "pipeline-lease-foreign";
      await replaceAttempt(item, buildProductionExecutionDurableAttemptIntegrity(next));
      const before = await tree(item.durableRoot);
      const result = await runProductionAcceptanceCommand([
        "resume-finalize", `--project-slug=${projectSlug}`, "--confirm-production-acceptance",
      ], {
        readiness: async () => { throw new Error("unused"); },
        execute: async () => { throw new Error("unused"); },
        resume: async (slug) => {
          resumeDependencyCalls += 1;
          resolverCalls += 1; assert.equal(slug, projectSlug);
          await resolveDurableAttemptOrdinal(item.adapter, slug, stage, 1);
          throw new Error("unreachable");
        },
      });
      assert.equal(resumeDependencyCalls, 1); assert.equal(resolverCalls, 1);
      assert.equal(result.exitCode, 1);
      assert.deepEqual(result.report, { mode: "resume-finalize", success: false,
        errorCode: expectedCode, projectSlug });
      assert.doesNotMatch(JSON.stringify(result.report),
        /secret|[a-zA-Z]:[\\/]|identityFingerprint|payload|production-execution|lineage-boundary/i);
      assert.deepEqual(byteIdentity(await tree(item.durableRoot)), byteIdentity(before));
      process.stdout.write(`CLI_BOUNDARY_EVIDENCE ${JSON.stringify({ resumeDependencyCalls,
        resolverCalls, stageBoundary: "structurally-unavailable",
        providerBoundary: "structurally-unavailable",
        networkBoundary: "structurally-unavailable" })}\n`);
      process.stdout.write("Network invocation count is structurally unavailable from this command seam; " +
        "the test proves rejection before stage/provider construction but does not claim direct " +
        "network-boundary instrumentation.\n");
    } finally { await fs.rm(item.root, { recursive: true, force: true }); }
  });

  assert.equal(scenarios, 27);
  process.stdout.write(`Production durable attempt lineage compatibility smoke: PASS (${scenarios} scenarios)\n`);
}

void main();
