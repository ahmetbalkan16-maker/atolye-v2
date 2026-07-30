import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { PipelineJobManager } from "../src/lib/pipeline/PipelineJobManager";
import { ProjectWriter } from "../src/lib/projects/ProjectWriter";
import { prepareProductionPipelineExecution } from
  "../src/lib/production/ProductionPipelineExecutionFactory";
import { buildProductionPipelineExecutionIdentity } from
  "../src/lib/production/ProductionPipelineExecutionIdentity";
import { reconcileFailedPipelineExecution } from
  "../src/lib/production/ProductionPipelineRetryReconciliation";
import { ProductionExecutionWorkerExecutionService } from
  "../src/lib/production/ProductionExecutionWorker";
import { ProductionExecutionFilePersistenceAdapter } from
  "../src/lib/production/ProductionExecutionPersistence";
import type {
  ProductionExecutionPersistenceAdapter,
  ProductionExecutionPersistenceListResult,
  ProductionExecutionPersistencePayloadByKind,
  ProductionExecutionPersistenceReadResult,
  ProductionExecutionPersistenceRecordKind,
  ProductionExecutionPersistenceWriteResult,
} from "../src/types/productionExecutionPersistence";
import type { PipelineJob, PipelineJobList } from "../src/types/pipelineJob";
import type { ProductionStepKey } from "../src/types/project";
import { withCanonicalSmokeRuntime } from "./lib/CanonicalSmokeRuntime";
import { emitSmokeResult } from "./lib/SmokeResult";

const anchor = "2026-07-01T22:00:00.000Z";
let passed = 0;

type FaultOperation = "write" | "read" | "listKeys";
interface FaultSpec {
  readonly operation: FaultOperation;
  readonly kind: ProductionExecutionPersistenceRecordKind;
  readonly key?: string;
  readonly version?: number;
  readonly occurrence: number;
}

class OneShotPersistenceFaultAdapter implements ProductionExecutionPersistenceAdapter {
  matchingCalls = 0;
  injectedFaults = 0;
  readonly evidence: string[] = [];

  constructor(
    private readonly delegate: ProductionExecutionPersistenceAdapter,
    private readonly fault: FaultSpec,
  ) {}

  async write<K extends ProductionExecutionPersistenceRecordKind>(
    kind: K,
    key: string,
    value: ProductionExecutionPersistencePayloadByKind[K],
  ): Promise<ProductionExecutionPersistenceWriteResult<K>> {
    if (this.matches("write", kind, key, persistenceVersion(value))) {
      return { ok: false, status: "failed", kind, key,
        errorCode: "PERSISTENCE_COMMIT_FAILED" };
    }
    return this.delegate.write(kind, key, value);
  }

  async read<K extends ProductionExecutionPersistenceRecordKind>(
    kind: K,
    key: string,
  ): Promise<ProductionExecutionPersistenceReadResult<K>> {
    if (this.matches("read", kind, key)) {
      return { ok: false, status: "failed", kind, key,
        errorCode: "PERSISTENCE_READ_FAILED" };
    }
    return this.delegate.read(kind, key);
  }

  async listKeys<K extends ProductionExecutionPersistenceRecordKind>(
    kind: K,
  ): Promise<ProductionExecutionPersistenceListResult<K>> {
    if (this.matches("listKeys", kind)) {
      return { ok: false, status: "failed", kind, errorCode: "PERSISTENCE_READ_FAILED" };
    }
    return this.delegate.listKeys(kind);
  }

  private matches(operation: FaultOperation, kind: ProductionExecutionPersistenceRecordKind,
    key?: string, version?: number) {
    if (operation !== this.fault.operation || kind !== this.fault.kind ||
      this.fault.key !== undefined && key !== this.fault.key ||
      this.fault.version !== undefined && version !== this.fault.version) return false;
    this.matchingCalls += 1;
    this.evidence.push(`${operation}:${kind}:${key ? "exact-key" : "no-key"}:` +
      `${version ?? "no-version"}:match-${this.matchingCalls}`);
    if (this.matchingCalls !== this.fault.occurrence || this.injectedFaults !== 0) return false;
    this.injectedFaults = 1;
    return true;
  }
}

function persistenceVersion(value: unknown): number | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as { recordVersion?: unknown; claimVersion?: unknown;
    attemptVersion?: unknown };
  for (const version of [candidate.recordVersion, candidate.claimVersion,
    candidate.attemptVersion]) {
    if (typeof version === "number") return version;
  }
  return undefined;
}

async function test(name: string, action: () => Promise<void>) {
  await action();
  passed += 1;
  process.stdout.write(`PASS ${passed}: ${name}\n`);
}

function controlledFailure() {
  return Object.assign(new Error("controlled failure"), { code: "CONTROLLED_STAGE_FAILURE" });
}

async function main() {
  const run = await withCanonicalSmokeRuntime({
    name: "sprint-129-30-persistence-boundary-retry",
    now: anchor,
    operationType: "pipeline-stage-execution",
  }, async (runtime) => {
    const projectSlug = runtime.projectSlug;
    const executionRoot = path.join(runtime.runtimeRoot, "projects", projectSlug,
      "production-execution");
    let fixtureOrdinal = 0;

    async function createFailedFixture(stage: ProductionStepKey) {
      const attempts = 0;
      const createdAt = new Date(Date.parse(anchor) + fixtureOrdinal++ * 10_000).toISOString();
      const queued: PipelineJob = {
        id: `${projectSlug}-${stage}`,
        projectSlug,
        stage,
        title: stage,
        status: "queued",
        attempts,
        createdAt,
        updatedAt: createdAt,
      };
      const queuedList: PipelineJobList = {
        projectSlug,
        jobs: [queued],
        createdAt,
        updatedAt: createdAt,
      };
      await ProjectWriter.writeJSON(projectSlug, "pipeline-jobs.json", queuedList);
      const context = { projectSlug, stage, runType: attempts === 0 ? "initial" as const :
        "retry" as const };
      const prepared = await prepareProductionPipelineExecution(context);
      let handlerCalls = 0;
      const execution = await new ProductionExecutionWorkerExecutionService(
        prepared.executionAdapter).execute(prepared.request, async () => {
          handlerCalls += 1;
          throw controlledFailure();
        }, { isCancellationRequested: () => false });
      assert.equal(execution.status, "failed");
      const failedAt = new Date(Date.parse(createdAt) + 5_000).toISOString();
      const failedJob: PipelineJob = {
        ...queued,
        status: "failed",
        attempts: attempts + 1,
        updatedAt: failedAt,
        completedAt: failedAt,
        error: "CONTROLLED_STAGE_FAILURE",
      };
      await ProjectWriter.writeJSON(projectSlug, "pipeline-jobs.json", {
        ...queuedList, jobs: [failedJob], updatedAt: failedAt,
      });
      const identity = buildProductionPipelineExecutionIdentity(context, queued);
      return { failedJob, identity, handlerCalls: () => handlerCalls };
    }

    async function latest(kind: "idempotency" | "claim" | "attempt", id: string) {
      const directory = path.join(executionRoot, kind === "idempotency" ? "idempotency" :
        kind === "claim" ? "claims" : "attempts");
      const match = new RegExp(`^${id}-v([1-9][0-9]*)\\.json$`);
      const selected = (await fs.readdir(directory))
        .map((name) => ({ name, match: match.exec(name) }))
        .filter((entry): entry is { name: string; match: RegExpExecArray } => Boolean(entry.match))
        .sort((left, right) => Number(right.match[1]) - Number(left.match[1]))[0];
      assert.ok(selected);
      return JSON.parse(await fs.readFile(path.join(directory, selected.name), "utf8"));
    }

    async function tree() {
      const output: string[] = [];
      async function visit(directory: string) {
        for (const entry of (await fs.readdir(directory, { withFileTypes: true }))
          .sort((left, right) => left.name.localeCompare(right.name))) {
          const target = path.join(directory, entry.name);
          if (entry.isDirectory()) await visit(target);
          else output.push(`${path.relative(executionRoot, target).replaceAll("\\", "/")}:` +
            createHash("sha256").update(await fs.readFile(target)).digest("hex"));
        }
      }
      await visit(executionRoot);
      return output;
    }

    const cases = [
      {
        name: "lease release write failure maps to lease cleanup failure",
        stage: "visuals" as const,
        retryReason: "PIPELINE_RETRY_LEASE_CLEANUP_FAILED",
        settlementEvidence: "settlement:PIPELINE_FAILED_SETTLEMENT_LEASE_RELEASE_FAILED:" +
          "LEASE_ATOMIC_COMMIT_FAILED:lease-release",
        writeFree: true,
        fault(identity: ReturnType<typeof buildProductionPipelineExecutionIdentity>): FaultSpec {
          return { operation: "write", kind: "idempotency", key: `${identity.recordId}-v3`,
            version: 3, occurrence: 1 };
        },
        expected: { recordVersion: 2, lease: "active", claimVersion: 1, claim: "active" },
      },
      {
        name: "claim close write failure maps to claim cleanup failure",
        stage: "animation" as const,
        retryReason: "PIPELINE_RETRY_CLAIM_CLEANUP_FAILED",
        settlementEvidence: "settlement:PIPELINE_FAILED_SETTLEMENT_CLAIM_CLOSE_FAILED:" +
          "CLAIM_ATOMIC_COMMIT_FAILED:claim-close",
        writeFree: false,
        fault(identity: ReturnType<typeof buildProductionPipelineExecutionIdentity>): FaultSpec {
          return { operation: "write", kind: "claim", key: `${identity.claimId}-v2`,
            version: 2, occurrence: 1 };
        },
        expected: { recordVersion: 3, lease: "released", claimVersion: 1, claim: "active" },
      },
      {
        name: "record terminalization write failure maps to idempotency conflict",
        stage: "video" as const,
        retryReason: "PIPELINE_RETRY_IDEMPOTENCY_CONFLICT",
        settlementEvidence: "settlement:PIPELINE_FAILED_SETTLEMENT_RECORD_TERMINALIZATION_FAILED:" +
          "DURABLE_STORAGE_ATOMIC_WRITE_FAILED:record-terminalization",
        writeFree: false,
        fault(identity: ReturnType<typeof buildProductionPipelineExecutionIdentity>): FaultSpec {
          return { operation: "write", kind: "idempotency", key: `${identity.recordId}-v4`,
            version: 4, occurrence: 1 };
        },
        expected: { recordVersion: 3, lease: "released", claimVersion: 2,
          claim: "abandoned" },
      },
      {
        name: "final validation record read failure maps to compensation failure",
        stage: "assembly" as const,
        retryReason: "PIPELINE_RETRY_COMPENSATION_FAILED",
        settlementEvidence: "settlement:PIPELINE_FAILED_SETTLEMENT_VALIDATION_FAILED:" +
          "IDEMPOTENCY_READ_FAILED:final-validation",
        writeFree: false,
        fault(identity: ReturnType<typeof buildProductionPipelineExecutionIdentity>): FaultSpec {
          return { operation: "read", kind: "idempotency", key: `${identity.recordId}-v4`,
            occurrence: 2 };
        },
        expected: { recordVersion: 4, lease: "released", claimVersion: 2,
          claim: "abandoned" },
      },
    ] as const;

    for (const testCase of cases) {
      await test(testCase.name, async () => {
        const fixture = await createFailedFixture(testCase.stage);
        const fault = testCase.fault(fixture.identity);
        let faultAdapter: OneShotPersistenceFaultAdapter | undefined;
        const result = await reconcileFailedPipelineExecution(fixture.failedJob,
          () => new Date(Date.parse(fixture.failedJob.updatedAt) + 1_000).toISOString(), {
            createAdapter(trustedRootDirectory) {
              faultAdapter = new OneShotPersistenceFaultAdapter(
                new ProductionExecutionFilePersistenceAdapter({
                  trustedRootDirectory,
                  createRootDirectory: false,
                }), fault);
              return faultAdapter;
            },
          });
        assert.equal(result.ok, false, JSON.stringify({ result,
          matchingCalls: faultAdapter?.matchingCalls, evidence: faultAdapter?.evidence }));
        assert.equal(result.reasonCode, testCase.retryReason);
        assert.equal(result.writeFree, testCase.writeFree);
        assert.ok(result.evidence.includes(testCase.settlementEvidence),
          JSON.stringify(result.evidence));
        assert.equal(faultAdapter?.injectedFaults, 1);
        assert.ok((faultAdapter?.matchingCalls ?? 0) >= fault.occurrence);
        assert.equal(faultAdapter?.evidence.length, faultAdapter?.matchingCalls);

        const record = await latest("idempotency", fixture.identity.recordId);
        const claim = await latest("claim", fixture.identity.claimId);
        const attempt = await latest("attempt", fixture.identity.attemptId);
        assert.equal(record.recordVersion, testCase.expected.recordVersion);
        assert.equal(record.durableLease.status, testCase.expected.lease);
        assert.equal(claim.claimVersion, testCase.expected.claimVersion);
        assert.equal(claim.state, testCase.expected.claim);
        assert.equal(attempt.attemptVersion, 3);
        assert.equal(attempt.state, "failed");
        assert.equal(fixture.handlerCalls(), 1);
        assert.equal((await PipelineJobManager.getJobForStageReadOnly(
          projectSlug, testCase.stage))?.status, "failed");

        const completed = await reconcileFailedPipelineExecution(fixture.failedJob,
          () => new Date(Date.parse(fixture.failedJob.updatedAt) + 2_000).toISOString());
        assert.equal(completed.ok, true);
        const settledTree = await tree();
        const replay = await reconcileFailedPipelineExecution(fixture.failedJob,
          () => new Date(Date.parse(fixture.failedJob.updatedAt) + 3_000).toISOString());
        assert.equal(replay.ok, true);
        assert.equal(replay.reasonCode, "PIPELINE_RETRY_RECONCILIATION_REPLAYED");
        assert.equal(replay.writeFree, true);
        assert.deepEqual(await tree(), settledTree);
        assert.equal(fixture.handlerCalls(), 1);
        assert.equal((await PipelineJobManager.getJobForStageReadOnly(
          projectSlug, testCase.stage))?.status, "failed");
      });
    }
  });
  assert.equal(run.finalization.cleanupCompleted, true);
  assert.equal(run.finalization.runtimeRemainder, 0);
  assert.equal(run.finalization.authorityRemainder, 0);
  await test("isolated runtime and authority roots are fully cleaned", async () => undefined);
  emitSmokeResult("sprint-129-30-persistence-boundary-retry", passed);
}

void main().catch((error) => {
  process.stderr.write(`Sprint 129.30 persistence-boundary retry smoke FAILED: ${
    error instanceof Error ? error.stack ?? error.message : "unknown"}\n`);
  process.exitCode = 1;
});
