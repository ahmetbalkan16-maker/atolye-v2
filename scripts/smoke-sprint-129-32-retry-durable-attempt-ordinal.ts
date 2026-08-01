import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { ProjectWriter } from "../src/lib/projects/ProjectWriter";
import { prepareProductionPipelineExecution } from
  "../src/lib/production/ProductionPipelineExecutionFactory";
import { buildProductionPipelineExecutionIdentity } from
  "../src/lib/production/ProductionPipelineExecutionIdentity";
import { reconcileFailedPipelineExecution } from
  "../src/lib/production/ProductionPipelineRetryReconciliation";
import { ProductionExecutionWorkerExecutionService } from
  "../src/lib/production/ProductionExecutionWorker";
import { readProductionExecutionRecoverySemanticAuthority } from
  "../src/lib/production/ProductionExecutionRecoveryBootstrap";
import { ProductionExecutionFilePersistenceAdapter } from
  "../src/lib/production/ProductionExecutionPersistence";
import type { PipelineJob, PipelineJobList } from "../src/types/pipelineJob";
import type { ProductionStepKey } from "../src/types/project";
import { withCanonicalSmokeRuntime } from "./lib/CanonicalSmokeRuntime";
import { emitSmokeResult } from "./lib/SmokeResult";

const anchor = "2026-07-01T23:00:00.000Z";
let passed = 0;

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
    name: "sprint-129-32-retry-durable-attempt-ordinal",
    now: anchor,
    operationType: "pipeline-stage-execution",
  }, async (runtime) => {
    const projectSlug = runtime.projectSlug;
    const executionRoot = path.join(runtime.runtimeRoot, "projects", projectSlug,
      "production-execution");
    let fixtureOrdinal = 0;

    async function writeJob(job: PipelineJob) {
      const list: PipelineJobList = {
        projectSlug,
        jobs: [job],
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
      };
      await ProjectWriter.writeJSON(projectSlug, "pipeline-jobs.json", list);
    }

    async function executionFixture(stage: ProductionStepKey, attempts: number,
      terminal: "failed" | "settled") {
      const createdAt = new Date(Date.parse(anchor) + fixtureOrdinal++ * 20_000).toISOString();
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
      await writeJob(queued);
      const context = { projectSlug, stage, runType: attempts === 0 ? "initial" as const :
        "retry" as const };
      const expectedIdentity = buildProductionPipelineExecutionIdentity(context, queued);
      const previousIdentity = attempts > 0 ? buildProductionPipelineExecutionIdentity(
        { projectSlug, stage, runType: "retry" },
        { id: queued.id, attempts: attempts - 1 },
      ) : undefined;
      const prepared = await prepareProductionPipelineExecution(context);
      assert.equal(prepared.request.coordinator.attempt.attemptId, expectedIdentity.attemptId);
      assert.equal(prepared.request.coordinator.attempt.recordId, expectedIdentity.recordId);
      assert.equal(prepared.request.coordinator.attempt.claimId, expectedIdentity.claimId);
      if (previousIdentity) {
        assert.notEqual(prepared.request.coordinator.attempt.attemptId,
          previousIdentity.attemptId);
        assert.notEqual(prepared.request.coordinator.attempt.recordId,
          previousIdentity.recordId);
        assert.notEqual(prepared.request.coordinator.attempt.claimId,
          previousIdentity.claimId);
      }
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
        attempts,
        updatedAt: failedAt,
        completedAt: failedAt,
        error: "CONTROLLED_STAGE_FAILURE",
      };
      await writeJob(failedJob);
      if (terminal === "settled") {
        const reconciled = await reconcileFailedPipelineExecution(failedJob,
          () => new Date(Date.parse(failedAt) + 1_000).toISOString());
        assert.equal(reconciled.ok, true, JSON.stringify(reconciled));
        assert.equal(reconciled.reasonCode, "PIPELINE_RETRY_RECONCILED");
      }
      return { failedJob, expectedIdentity, previousIdentity, handlerCalls: () => handlerCalls };
    }

    async function failedFixture(stage: ProductionStepKey, attempts: number) {
      for (let ordinal = 0; ordinal < attempts; ordinal += 1) {
        await executionFixture(stage, ordinal, "settled");
      }
      return executionFixture(stage, attempts, "failed");
    }

    async function latest(kind: "idempotency" | "claim" | "attempt", id: string) {
      const file = await latestPath(kind, id);
      assert.ok(file, `${kind}:${id} missing`);
      return JSON.parse(await fs.readFile(file, "utf8"));
    }

    async function latestPath(kind: "idempotency" | "claim" | "attempt", id: string) {
      const directory = path.join(executionRoot, kind === "idempotency" ? "idempotency" :
        kind === "claim" ? "claims" : "attempts");
      const match = new RegExp(`^${id}-v([1-9][0-9]*)\\.json$`);
      const selected = (await fs.readdir(directory))
        .map((name) => ({ name, match: match.exec(name) }))
        .filter((entry): entry is { name: string; match: RegExpExecArray } => Boolean(entry.match))
        .sort((left, right) => Number(right.match[1]) - Number(left.match[1]))[0];
      return selected ? path.join(directory, selected.name) : undefined;
    }

    async function removeLatest(kind: "idempotency" | "claim" | "attempt", id: string) {
      const file = await latestPath(kind, id);
      assert.ok(file, `${kind}:${id} missing`);
      const raw = await fs.readFile(file, "utf8");
      await fs.rm(file);
      return { file, raw };
    }

    async function removeAll(kind: "idempotency" | "claim" | "attempt", id: string) {
      const directory = path.join(executionRoot, kind === "idempotency" ? "idempotency" :
        kind === "claim" ? "claims" : "attempts");
      const match = new RegExp(`^${id}-v([1-9][0-9]*)\\.json$`);
      const removed = [];
      for (const name of await fs.readdir(directory)) {
        if (!match.test(name)) continue;
        const file = path.join(directory, name);
        removed.push({ file, raw: await fs.readFile(file, "utf8") });
        await fs.rm(file);
      }
      assert.ok(removed.length > 0, `${kind}:${id} missing`);
      return removed;
    }

    async function restoreAll(removed: readonly { file: string; raw: string }[]) {
      for (const item of removed) await fs.writeFile(item.file, item.raw, "utf8");
    }

    function failedJob(stage: ProductionStepKey, attempts: number, offsetMs: number): PipelineJob {
      const updatedAt = new Date(Date.parse(anchor) + offsetMs).toISOString();
      return {
        id: `${projectSlug}-${stage}`,
        projectSlug,
        stage,
        title: stage,
        status: "failed",
        attempts,
        createdAt: updatedAt,
        updatedAt,
        completedAt: updatedAt,
        error: "CONTROLLED_STAGE_FAILURE",
      };
    }

    async function chainSnapshot(identity: ReturnType<typeof buildProductionPipelineExecutionIdentity>) {
      return {
        record: await latest("idempotency", identity.recordId),
        claim: await latest("claim", identity.claimId),
        attempt: await latest("attempt", identity.attemptId),
      };
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

    async function assertSettled(identity: ReturnType<typeof buildProductionPipelineExecutionIdentity>) {
      const snapshot = await chainSnapshot(identity);
      assert.equal(snapshot.attempt.identity.attemptId, identity.attemptId);
      assert.equal(snapshot.attempt.identity.recordId, identity.recordId);
      assert.equal(snapshot.attempt.identity.claimId, identity.claimId);
      assert.equal(snapshot.attempt.state, "failed");
      assert.equal(snapshot.attempt.attemptVersion, 3);
      assert.equal(snapshot.claim.identity.claimId, identity.claimId);
      assert.ok(["abandoned", "released"].includes(snapshot.claim.state));
      assert.equal(snapshot.record.recordId, identity.recordId);
      assert.equal(snapshot.record.durableLease.status, "released");
      assert.ok(["cancelled", "failed"].includes(snapshot.record.state));
    }

    async function reconcileAndAssert(fixture: Awaited<ReturnType<typeof failedFixture>>) {
      const result = await reconcileFailedPipelineExecution(fixture.failedJob,
        () => new Date(Date.parse(fixture.failedJob.updatedAt) + 1_000).toISOString());
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.equal(result.reasonCode, "PIPELINE_RETRY_RECONCILED");
      assert.equal(fixture.handlerCalls(), 1);
      await assertSettled(fixture.expectedIdentity);
      if (fixture.previousIdentity) {
        assert.notEqual((await latest("attempt", fixture.expectedIdentity.attemptId))
          .identity.attemptId, fixture.previousIdentity.attemptId);
        assert.notEqual((await latest("claim", fixture.expectedIdentity.claimId))
          .identity.claimId, fixture.previousIdentity.claimId);
        assert.notEqual((await latest("idempotency", fixture.expectedIdentity.recordId))
          .recordId, fixture.previousIdentity.recordId);
      }
      const settledTree = await tree();
      const replay = await reconcileFailedPipelineExecution(fixture.failedJob,
        () => new Date(Date.parse(fixture.failedJob.updatedAt) + 2_000).toISOString());
      assert.equal(replay.ok, true);
      assert.equal(replay.reasonCode, "PIPELINE_RETRY_RECONCILIATION_REPLAYED");
      assert.equal(replay.writeFree, true);
      assert.deepEqual(await tree(), settledTree);
      assert.equal(fixture.handlerCalls(), 1);
    }

    let orphanFixture: Awaited<ReturnType<typeof failedFixture>> | undefined;

    async function getOrphanFixture() {
      orphanFixture ??= await failedFixture("video", 0);
      return orphanFixture;
    }

    await test("initial failed job attempts zero targets durable attempt zero", async () => {
      const fixture = await failedFixture("visuals", 0);
      assert.equal(fixture.expectedIdentity.core.attemptNumber, 0);
      await reconcileAndAssert(fixture);
    });

    await test("attempts two with completely empty durable store fails closed", async () => {
      const job = failedJob("research", 2, 100);
      const result = await reconcileFailedPipelineExecution(job,
        () => new Date(Date.parse(job.updatedAt) + 1_000).toISOString());
      assert.equal(result.ok, false, JSON.stringify(result));
      assert.equal(result.reasonCode, "PIPELINE_RETRY_DURABLE_STATE_MISSING");
      assert.ok(result.evidence.includes("durable:no-applicable-lineage"));
    });

    await test("attempts zero with genuinely empty durable store preserves durable none", async () => {
      const job = failedJob("script", 0, 200);
      const result = await reconcileFailedPipelineExecution(job,
        () => new Date(Date.parse(job.updatedAt) + 1_000).toISOString());
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.equal(result.reasonCode, "PIPELINE_RETRY_RECONCILIATION_REPLAYED");
      assert.equal(result.writeFree, true);
      assert.ok(result.evidence.includes("durable:none"));
    });

    await test("retry failed job attempts two targets durable attempt two", async () => {
      const fixture = await failedFixture("animation", 2);
      assert.equal(fixture.expectedIdentity.core.attemptNumber, 2);
      assert.equal(fixture.previousIdentity?.core.attemptNumber, 1);
      await reconcileAndAssert(fixture);
    });

    await test("previous settled chain remains byte-identical while latest retry is reconciled", async () => {
      const previous = await failedFixture("audio", 1);
      await reconcileAndAssert(previous);
      const previousSnapshot = await chainSnapshot(previous.expectedIdentity);
      const beforeCurrent = await tree();
      const current = await executionFixture("audio", 2, "failed");
      assert.deepEqual(await chainSnapshot(previous.expectedIdentity), previousSnapshot);
      assert.notDeepEqual(await tree(), beforeCurrent);
      const failedSemantic = await readProductionExecutionRecoverySemanticAuthority(
        new ProductionExecutionFilePersistenceAdapter({ trustedRootDirectory: executionRoot,
          createRootDirectory: false }),
        new Date(Date.parse(current.failedJob.updatedAt) + 500).toISOString(),
      );
      assert.notEqual(failedSemantic.decision, "ready");
      const currentResult = await reconcileFailedPipelineExecution(current.failedJob,
        () => new Date(Date.parse(current.failedJob.updatedAt) + 1_000).toISOString());
      assert.equal(currentResult.ok, true, JSON.stringify(currentResult));
      assert.equal(currentResult.reasonCode, "PIPELINE_RETRY_RECONCILED");
      assert.equal(previous.handlerCalls(), 1);
      assert.equal(current.handlerCalls(), 1);
      assert.deepEqual(await chainSnapshot(previous.expectedIdentity), previousSnapshot);
      await assertSettled(current.expectedIdentity);
      const readySemantic = await readProductionExecutionRecoverySemanticAuthority(
        new ProductionExecutionFilePersistenceAdapter({ trustedRootDirectory: executionRoot,
          createRootDirectory: false }),
        new Date(Date.parse(current.failedJob.updatedAt) + 2_000).toISOString(),
      );
      assert.equal(readySemantic.decision, "ready");
      assert.equal(readySemantic.counts.active, 0);
      assert.equal(readySemantic.counts.running, 0);
      const settledTree = await tree();
      const replay = await reconcileFailedPipelineExecution(current.failedJob,
        () => new Date(Date.parse(current.failedJob.updatedAt) + 3_000).toISOString());
      assert.equal(replay.ok, true);
      assert.equal(replay.reasonCode, "PIPELINE_RETRY_RECONCILIATION_REPLAYED");
      assert.equal(replay.writeFree, true);
      assert.deepEqual(await tree(), settledTree);
      assert.deepEqual(await chainSnapshot(previous.expectedIdentity), previousSnapshot);
      assert.equal(previous.handlerCalls(), 1);
      assert.equal(current.handlerCalls(), 1);
    });

    await test("retry attempts two with only attempt one lineage fails closed", async () => {
      const previous = await failedFixture("assembly", 1);
      await reconcileAndAssert(previous);
      const missingLatestJob = { ...previous.failedJob, attempts: 2,
        updatedAt: new Date(Date.parse(previous.failedJob.updatedAt) + 10_000).toISOString() };
      const result = await reconcileFailedPipelineExecution(missingLatestJob,
        () => new Date(Date.parse(missingLatestJob.updatedAt) + 1_000).toISOString());
      assert.equal(result.ok, false, JSON.stringify(result));
      assert.equal(result.reasonCode, "PIPELINE_RETRY_DURABLE_STATE_MISSING");
      assert.ok(result.evidence.includes("durable:expected-attempt-ordinal"));
      assert.equal(previous.handlerCalls(), 1);
    });

    await test("missing exact attempt two record fails closed", async () => {
      const fixture = await failedFixture("thumbnail", 2);
      const removed = await removeLatest("idempotency", fixture.expectedIdentity.recordId);
      try {
        const result = await reconcileFailedPipelineExecution(fixture.failedJob,
          () => new Date(Date.parse(fixture.failedJob.updatedAt) + 1_000).toISOString());
        assert.equal(result.ok, false, JSON.stringify(result));
        assert.equal(result.reasonCode, "PIPELINE_RETRY_DURABLE_STATE_MISSING");
        assert.ok(result.evidence.some((entry) => entry.startsWith("durable:")));
        assert.equal(fixture.handlerCalls(), 1);
      } finally {
        await fs.writeFile(removed.file, removed.raw, "utf8");
      }
      await reconcileAndAssert(fixture);
    });

    await test("missing exact attempt two claim fails closed", async () => {
      const fixture = await failedFixture("seo", 2);
      const removed = await removeLatest("claim", fixture.expectedIdentity.claimId);
      try {
        const result = await reconcileFailedPipelineExecution(fixture.failedJob,
          () => new Date(Date.parse(fixture.failedJob.updatedAt) + 1_000).toISOString());
        assert.equal(result.ok, false, JSON.stringify(result));
        assert.equal(result.reasonCode, "PIPELINE_RETRY_DURABLE_STATE_MISSING");
        assert.ok(result.evidence.includes("durable:claim-lineage-missing"));
        assert.equal(fixture.handlerCalls(), 1);
      } finally {
        await fs.writeFile(removed.file, removed.raw, "utf8");
      }
      await reconcileAndAssert(fixture);
    });

    await test("missing exact attempt two attempt evidence fails closed", async () => {
      const fixture = await failedFixture("youtube", 2);
      const removed = await removeAll("attempt", fixture.expectedIdentity.attemptId);
      try {
        const result = await reconcileFailedPipelineExecution(fixture.failedJob,
          () => new Date(Date.parse(fixture.failedJob.updatedAt) + 1_000).toISOString());
        assert.equal(result.ok, false, JSON.stringify(result));
        assert.equal(result.reasonCode, "PIPELINE_RETRY_DURABLE_STATE_MISSING");
        assert.ok(result.evidence.includes("durable:attempt-lineage-missing"));
        assert.equal(fixture.handlerCalls(), 1);
      } finally {
        await restoreAll(removed);
      }
      await reconcileAndAssert(fixture);
    });

    await test("claim-only orphan lineage fails closed before durable none", async () => {
      const fixture = await getOrphanFixture();
      const removedRecord = await removeAll("idempotency", fixture.expectedIdentity.recordId);
      const removedAttempt = await removeAll("attempt", fixture.expectedIdentity.attemptId);
      try {
        const result = await reconcileFailedPipelineExecution(fixture.failedJob,
          () => new Date(Date.parse(fixture.failedJob.updatedAt) + 1_000).toISOString());
        assert.equal(result.ok, false, JSON.stringify(result));
        assert.equal(result.reasonCode, "PIPELINE_RETRY_DURABLE_STATE_MISSING");
        assert.ok(result.evidence.includes("durable:orphan-lineage"));
      } finally {
        await restoreAll(removedRecord);
        await restoreAll(removedAttempt);
      }
    });

    await test("attempt-only orphan lineage fails closed before durable none", async () => {
      const fixture = await getOrphanFixture();
      const removedRecord = await removeAll("idempotency", fixture.expectedIdentity.recordId);
      const removedClaim = await removeAll("claim", fixture.expectedIdentity.claimId);
      try {
        const result = await reconcileFailedPipelineExecution(fixture.failedJob,
          () => new Date(Date.parse(fixture.failedJob.updatedAt) + 1_000).toISOString());
        assert.equal(result.ok, false, JSON.stringify(result));
        assert.equal(result.reasonCode, "PIPELINE_RETRY_DURABLE_STATE_MISSING");
        assert.ok(result.evidence.includes("durable:orphan-lineage"));
      } finally {
        await restoreAll(removedRecord);
        await restoreAll(removedClaim);
      }
    });

    await test("idempotency-only partial lineage fails closed", async () => {
      const fixture = await getOrphanFixture();
      const removedClaim = await removeAll("claim", fixture.expectedIdentity.claimId);
      const removedAttempt = await removeAll("attempt", fixture.expectedIdentity.attemptId);
      try {
        const result = await reconcileFailedPipelineExecution(fixture.failedJob,
          () => new Date(Date.parse(fixture.failedJob.updatedAt) + 1_000).toISOString());
        assert.equal(result.ok, false, JSON.stringify(result));
        assert.equal(result.reasonCode, "PIPELINE_RETRY_DURABLE_STATE_MISSING");
        assert.ok(result.evidence.includes("durable:claim-lineage-missing"));
      } finally {
        await restoreAll(removedClaim);
        await restoreAll(removedAttempt);
      }
      await reconcileAndAssert(fixture);
    });

    await test("corrupt applicable latest evidence fails closed before durable none", async () => {
      const previous = await failedFixture("research", 1);
      await reconcileAndAssert(previous);
      const recordPath = await latestPath("idempotency", previous.expectedIdentity.recordId);
      assert.ok(recordPath);
      const raw = await fs.readFile(recordPath, "utf8");
      try {
        await fs.writeFile(recordPath, "{", "utf8");
        const missingLatestJob = { ...previous.failedJob, attempts: 2,
          updatedAt: new Date(Date.parse(previous.failedJob.updatedAt) + 10_000).toISOString() };
        const result = await reconcileFailedPipelineExecution(missingLatestJob,
          () => new Date(Date.parse(missingLatestJob.updatedAt) + 1_000).toISOString());
        assert.equal(result.ok, false, JSON.stringify(result));
        assert.equal(result.reasonCode, "PIPELINE_RETRY_DURABLE_STATE_MISSING");
        assert.ok(result.evidence.includes("durable:record-integrity"));
        assert.equal(previous.handlerCalls(), 1);
      } finally {
        await fs.writeFile(recordPath, raw, "utf8");
      }
    });

    await test("mismatched applicable identity fails closed before durable none", async () => {
      const previous = await failedFixture("script", 1);
      await reconcileAndAssert(previous);
      const recordPath = await latestPath("idempotency", previous.expectedIdentity.recordId);
      assert.ok(recordPath);
      const directory = path.dirname(recordPath);
      const originalRecordId = previous.expectedIdentity.recordId;
      const prefix = `${originalRecordId}-v`;
      const originals = (await fs.readdir(directory))
        .filter((name) => name.startsWith(prefix) && name.endsWith(".json"))
        .map((name) => ({
          name,
          version: Number(name.slice(prefix.length, -".json".length)),
        }))
        .filter((entry) => Number.isSafeInteger(entry.version) && entry.version >= 1)
        .sort((left, right) => left.version - right.version);
      assert.ok(originals.length > 0);

      const forgedRecordId = `${originalRecordId}-x`;
      const moved: Array<{
        originalPath: string;
        forgedPath: string;
        raw: string;
      }> = [];

      try {
        for (const entry of originals) {
          const originalPath = path.join(directory, entry.name);
          const raw = await fs.readFile(originalPath, "utf8");
          const record = JSON.parse(raw);
          assert.equal(record.recordId, originalRecordId);
          assert.equal(record.integrity.version, entry.version);

          const forgedPath = path.join(
            directory,
            `${forgedRecordId}-v${entry.version}.json`,
          );
          await fs.rm(forgedPath, { force: true });
          await fs.rename(originalPath, forgedPath);
          moved.push({ originalPath, forgedPath, raw });
          await fs.writeFile(
            forgedPath,
            JSON.stringify({ ...record, recordId: forgedRecordId }),
            "utf8",
          );
        }

        const missingLatestJob = {
          ...previous.failedJob,
          attempts: 2,
          updatedAt: new Date(
            Date.parse(previous.failedJob.updatedAt) + 10_000,
          ).toISOString(),
        };
        const result = await reconcileFailedPipelineExecution(
          missingLatestJob,
          () => new Date(Date.parse(missingLatestJob.updatedAt) + 1_000).toISOString(),
        );
        assert.equal(result.ok, false, JSON.stringify(result));
        assert.equal(result.reasonCode, "PIPELINE_RETRY_DURABLE_STATE_MISSING");
        assert.ok(
          result.evidence.includes("durable:record-canonical-id"),
          JSON.stringify(result.evidence),
        );
        assert.equal(previous.handlerCalls(), 1);
      } finally {
        for (const mutation of [...moved].reverse()) {
          await fs.rm(mutation.forgedPath, { force: true });
          await fs.writeFile(mutation.originalPath, mutation.raw, "utf8");
        }
      }
    });
    await test("concurrent exact reconciliation has one settlement and deterministic replay", async () => {
      const fixture = await failedFixture("scenes", 2);
      const beforeCalls = fixture.handlerCalls();
      const [left, right] = await Promise.all([
        reconcileFailedPipelineExecution(fixture.failedJob,
          () => new Date(Date.parse(fixture.failedJob.updatedAt) + 1_000).toISOString()),
        reconcileFailedPipelineExecution(fixture.failedJob,
          () => new Date(Date.parse(fixture.failedJob.updatedAt) + 1_000).toISOString()),
      ]);
      assert.deepEqual([left.ok, right.ok].sort(), [true, true]);
      assert.equal([left.reasonCode, right.reasonCode]
        .filter((code) => code === "PIPELINE_RETRY_RECONCILED").length, 1);
      assert.equal([left.reasonCode, right.reasonCode]
        .filter((code) => code === "PIPELINE_RETRY_RECONCILIATION_REPLAYED").length, 1);
      await assertSettled(fixture.expectedIdentity);
      const settledTree = await tree();
      const replay = await reconcileFailedPipelineExecution(fixture.failedJob,
        () => new Date(Date.parse(fixture.failedJob.updatedAt) + 2_000).toISOString());
      assert.equal(replay.ok, true);
      assert.equal(replay.reasonCode, "PIPELINE_RETRY_RECONCILIATION_REPLAYED");
      assert.deepEqual(await tree(), settledTree);
      assert.equal(fixture.handlerCalls(), beforeCalls);
    });

    await test("public retry preparation rejects exhausted attempt index before provider admission", async () => {
      const fixture = await failedFixture("export", 2);
      await removeLatest("idempotency", fixture.expectedIdentity.recordId);
      const beforeCalls = fixture.handlerCalls();
      const { prepareFailedStageRetry } = await import("../src/lib/pipeline/PipelineFailedStageRetry");
      const prepared = await prepareFailedStageRetry(projectSlug, fixture.failedJob.id);
      assert.equal(prepared.success, false, JSON.stringify(prepared));
      assert.equal(prepared.reasonCode, "PIPELINE_RETRY_MAX_ATTEMPTS_EXCEEDED");
      assert.equal(fixture.handlerCalls(), beforeCalls);
    });

    await test("non-failed exact attempt returns durable conflict", async () => {
      await getOrphanFixture();
      const stage: ProductionStepKey = "video";
      const createdAt = new Date(Date.parse(anchor) + fixtureOrdinal++ * 20_000).toISOString();
      const queued: PipelineJob = {
        id: `${projectSlug}-${stage}`,
        projectSlug,
        stage,
        title: stage,
        status: "queued",
        attempts: 1,
        createdAt,
        updatedAt: createdAt,
      };
      await writeJob(queued);
      await prepareProductionPipelineExecution({ projectSlug, stage, runType: "retry" });
      const failed = failedJob(stage, 1, Date.parse(createdAt) - Date.parse(anchor) + 5_000);
      const result = await reconcileFailedPipelineExecution(failed,
        () => new Date(Date.parse(failed.updatedAt) + 1_000).toISOString());
      assert.equal(result.ok, false, JSON.stringify(result));
      assert.equal(result.reasonCode, "PIPELINE_RETRY_DURABLE_CONFLICT");
      assert.ok(result.evidence.some((entry) => entry.startsWith("durable:attempt:")));
    });
  });
  assert.equal(run.finalization.cleanupCompleted, true);
  assert.equal(run.finalization.runtimeRemainder, 0);
  assert.equal(run.finalization.authorityRemainder, 0);
  await test("isolated runtime and authority roots are fully cleaned", async () => undefined);
  emitSmokeResult("sprint-129-32-retry-durable-attempt-ordinal", passed);
}

void main().catch((error) => {
  process.stderr.write(`Sprint 129.32 retry durable attempt ordinal smoke FAILED: ${
    error instanceof Error ? error.stack ?? error.message : "unknown"}\n`);
  process.exitCode = 1;
});
