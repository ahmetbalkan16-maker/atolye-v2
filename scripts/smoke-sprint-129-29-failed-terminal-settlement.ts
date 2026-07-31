import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { PipelineJobManager } from "../src/lib/pipeline/PipelineJobManager";
import { prepareFailedStageRetry } from "../src/lib/pipeline/PipelineFailedStageRetry";
import { ProjectWriter } from "../src/lib/projects/ProjectWriter";
import {
  ProductionPipelineDurableExecutionError,
  ProductionPipelineExecutionAdapter,
} from "../src/lib/production/ProductionPipelineExecutionAdapter";
import {
  executeConfiguredProductionPipelineStage,
  prepareProductionPipelineExecution,
} from "../src/lib/production/ProductionPipelineExecutionFactory";
import { ProductionExecutionWorkerExecutionService } from
  "../src/lib/production/ProductionExecutionWorker";
import { reconcileFailedPipelineExecution } from
  "../src/lib/production/ProductionPipelineRetryReconciliation";
import {
  settleFailedProductionPipelineExecution,
  type ProductionPipelineFailedSettlementBoundary,
} from "../src/lib/production/ProductionPipelineTerminalSettlement";
import { readProductionExecutionRecoverySemanticAuthority } from
  "../src/lib/production/ProductionExecutionRecoveryBootstrap";
import { ProductionExecutionFilePersistenceAdapter } from
  "../src/lib/production/ProductionExecutionPersistence";
import { AdapterBackedProductionExecutionDurableStorage } from
  "../src/lib/production/ProductionExecutionDurableStorage";
import { validateProductionExecutionDurableAttempt } from
  "../src/lib/production/ProductionExecutionDurableAttempt";
import { validateProductionExecutionIdempotencyReservation } from
  "../src/lib/production/ProductionExecutionIdempotency";
import { buildProductionExecutionIdempotencyIdentity } from
  "../src/lib/production/ProductionExecutionIdempotency";
import { stableProductionId } from "../src/lib/production/ProductionDeterminism";
import type { PipelineJob, PipelineJobList } from "../src/types/pipelineJob";
import type { ProductionStepKey, ProjectPackageRunType } from "../src/types/project";
import { withCanonicalSmokeRuntime } from "./lib/CanonicalSmokeRuntime";
import { emitSmokeResult } from "./lib/SmokeResult";

const anchor = "2026-07-01T21:00:00.000Z";
let passed = 0;

async function test(name: string, action: () => void | Promise<void>) {
  await action();
  passed += 1;
  process.stdout.write(`PASS ${passed}: ${name}\n`);
}

function failure(code: string) {
  return Object.assign(new Error(code), { code });
}

type ChildAction = "settle" | "reconcile";
interface ChildPayload {
  readonly action: ChildAction;
  readonly executionRoot: string;
  readonly runtimeRoot: string;
  readonly readyFile: string;
  readonly releaseFile: string;
  readonly barrierBeforeCall?: boolean;
  readonly settlement?: Omit<Parameters<typeof settleFailedProductionPipelineExecution>[0], "adapter" | "onBoundary">;
  readonly execution?: Parameters<typeof settleFailedProductionPipelineExecution>[1];
  readonly job?: PipelineJob;
  readonly sentinelEnvironmentKey: string;
}

const childEnvironmentAllowlist = [
  "PATH", "PATHEXT", "SystemRoot", "WINDIR", "COMSPEC",
  "TEMP", "TMP", "TMPDIR", "HOMEDRIVE", "HOMEPATH", "LOGONSERVER",
  "SYSTEMDRIVE", "USERDOMAIN", "USERNAME", "USERPROFILE",
] as const;
const childSentinelEnvironmentKey = "ATOLYE_SPRINT_129_30_SENTINEL_SECRET";
const childEnvironmentKeys = [
  ...childEnvironmentAllowlist, "ATOLYE_RUNTIME_ROOT", "NODE_ENV",
] as const;

function normalizedEnvironmentKey(key: string) {
  return key.toUpperCase();
}

function sensitiveEnvironmentKey(key: string) {
  const normalized = normalizedEnvironmentKey(key);
  return normalized.startsWith("OPENAI_") ||
    normalized.startsWith("ATOLYE_") && normalized !== "ATOLYE_RUNTIME_ROOT" ||
    normalized.includes("TOKEN") || normalized.includes("CREDENTIAL") ||
    normalized.includes("SECRET");
}

function childResult(payload: ChildPayload, result: unknown) {
  const visibleKeys = Object.keys(process.env);
  const allowlistedKeys = new Set(childEnvironmentKeys.map(normalizedEnvironmentKey));
  process.stdout.write(`CHILD_RESULT ${JSON.stringify({
    result,
    environment: {
      runtimeRootBound: process.env.ATOLYE_RUNTIME_ROOT === payload.runtimeRoot,
      nodeEnvironmentIsTest: process.env.NODE_ENV === "test",
      onlyAllowlistedKeys: visibleKeys.every((key) =>
        allowlistedKeys.has(normalizedEnvironmentKey(key))),
      sensitiveEnvironmentVisible: visibleKeys.some(sensitiveEnvironmentKey),
      sentinelVisible: process.env[payload.sentinelEnvironmentKey] !== undefined,
    },
  })}\n`);
}

function withClaimIntegrity<T extends { integrity: unknown }>(value: T): T {
  const { integrity: unused, ...body } = value;
  void unused;
  return { ...body, integrity: { algorithm: "stable-production-id-v1",
    fingerprint: stableProductionId("durable-claim-integrity", body) } } as T;
}

function withAttemptIntegrity<T extends { integrity: unknown }>(value: T): T {
  const { integrity: unused, ...body } = value;
  void unused;
  return { ...body, integrity: { algorithm: "stable-production-id-v1",
    fingerprint: stableProductionId("durable-attempt-integrity", body) } } as T;
}

function withLeaseIntegrity<T extends { integrity: unknown }>(value: T): T {
  const { integrity: unused, ...body } = value;
  void unused;
  return { ...body, integrity: { algorithm: "stable-production-id-v1",
    fingerprint: stableProductionId("durable-lease-integrity", body) } } as T;
}

async function waitForFile(filePath: string, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { await fs.access(filePath); return; } catch { /* explicit bounded barrier polling */ }
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("child-process barrier timed out");
}

async function childMain(payloadPath: string) {
  const payload = JSON.parse(await fs.readFile(payloadPath, "utf8")) as ChildPayload;
  process.env.ATOLYE_RUNTIME_ROOT = payload.runtimeRoot;
  const adapter = new ProductionExecutionFilePersistenceAdapter({
    trustedRootDirectory: payload.executionRoot,
    createRootDirectory: false,
  });
  if (payload.action === "reconcile") {
    await fs.writeFile(payload.readyFile, "ready", { encoding: "utf8", flag: "wx" });
    await waitForFile(payload.releaseFile);
    const result = await reconcileFailedPipelineExecution(payload.job!, () => new Date().toISOString());
    childResult(payload, result);
    return;
  }
  if (payload.barrierBeforeCall) {
    await fs.writeFile(payload.readyFile, "ready", { encoding: "utf8", flag: "wx" });
    await waitForFile(payload.releaseFile);
  }
  let entered = false;
  const result = await settleFailedProductionPipelineExecution({
    ...payload.settlement!, adapter,
    async onBoundary(boundary) {
      if (!payload.barrierBeforeCall && !entered && boundary === "before-lease-release") {
        entered = true;
        await fs.writeFile(payload.readyFile, "ready", { encoding: "utf8", flag: "wx" });
        await waitForFile(payload.releaseFile);
      }
    },
  }, payload.execution!);
  childResult(payload, result);
}

function buildChildEnvironment(runtimeRoot: string): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    ATOLYE_RUNTIME_ROOT: runtimeRoot,
    NODE_ENV: "test",
  };
  for (const key of childEnvironmentAllowlist) {
    const value = process.env[key];
    if (value !== undefined) environment[key] = value;
  }
  return environment;
}

async function spawnChild(payloadPath: string, runtimeRoot: string) {
  const cli = path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
  const script = path.resolve(process.argv[1]);
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, [cli, script, "--settlement-child", payloadPath], {
      cwd: process.cwd(), env: buildChildEnvironment(runtimeRoot), stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let completed = false;
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.once("error", (error) => {
      if (completed) return;
      completed = true;
      reject(error);
    });
    child.once("close", (code) => {
      if (completed) return;
      completed = true;
      resolve({ code, stdout, stderr });
    });
  });
}

async function main() {
  const run = await withCanonicalSmokeRuntime({
    name: "failed-terminal-settlement",
    now: anchor,
    operationType: "pipeline-stage-execution",
  }, async (runtime) => {
    const projectSlug = runtime.projectSlug;
    const projectFolder = path.join(runtime.runtimeRoot, "projects", projectSlug);
    const executionRoot = path.join(projectFolder, "production-execution");

    async function job(stage: ProductionStepKey, attempts: number,
      status: PipelineJob["status"] = "queued"): Promise<PipelineJob> {
      const timestamp = new Date(Date.parse(anchor) + attempts * 1_000).toISOString();
      const value: PipelineJob = {
        id: `${projectSlug}-${stage}`,
        projectSlug,
        stage,
        title: stage,
        status,
        attempts,
        createdAt: anchor,
        updatedAt: timestamp,
        ...(status === "failed" ? { completedAt: timestamp, error: "WORKER_HANDLER_FAILED" } : {}),
      };
      const list: PipelineJobList = {
        projectSlug,
        jobs: [value],
        createdAt: anchor,
        updatedAt: timestamp,
      };
      await ProjectWriter.writeJSON(projectSlug, "pipeline-jobs.json", list);
      return value;
    }

    async function prepare(stage: ProductionStepKey, attempts: number,
      runType: ProjectPackageRunType = attempts === 0 ? "initial" : "retry") {
      await job(stage, attempts);
      const context = { projectSlug, stage, runType };
      return { context, prepared: await prepareProductionPipelineExecution(context) };
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

    type FixtureArtifactKind = "reservation" | "idempotency" | "attempt";
    interface OwnedFixtureArtifact {
      readonly kind: FixtureArtifactKind;
      readonly key: string;
      readonly target: string;
      readonly device: number;
      readonly inode: number;
      readonly birthtimeMs: number;
      readonly size: number;
      readonly hash: string;
    }

    function fixtureDirectory(kind: FixtureArtifactKind) {
      return kind === "reservation" ? "reservations" :
        kind === "idempotency" ? "idempotency" : "attempts";
    }

    function exactFixturePath(kind: FixtureArtifactKind, key: string) {
      assert.match(key, /^[a-z0-9][a-z0-9_-]{0,127}$/);
      const operationRoot = path.resolve(executionRoot);
      const runtimeRoot = path.resolve(runtime.runtimeRoot);
      const operationRelative = path.relative(runtimeRoot, operationRoot);
      assert.ok(operationRelative && !operationRelative.startsWith("..") &&
        !path.isAbsolute(operationRelative), "fixture root must remain operation-owned");
      const target = path.resolve(operationRoot, fixtureDirectory(kind), `${key}.json`);
      const relative = path.relative(operationRoot, target);
      assert.ok(relative && !relative.startsWith("..") && !path.isAbsolute(relative),
        "fixture path must remain inside operation-owned execution root");
      assert.equal(target, path.join(operationRoot, fixtureDirectory(kind), `${key}.json`));
      return target;
    }

    async function captureOwnedFixture(kind: FixtureArtifactKind, key: string) {
      const target = exactFixturePath(kind, key);
      const identity = await fs.lstat(target);
      assert.equal(identity.isFile(), true);
      assert.equal(identity.isSymbolicLink(), false);
      return {
        kind, key, target, device: identity.dev, inode: identity.ino,
        birthtimeMs: identity.birthtimeMs, size: identity.size,
        hash: createHash("sha256").update(await fs.readFile(target)).digest("hex"),
      } satisfies OwnedFixtureArtifact;
    }

    async function removeOwnedFixture(owned: OwnedFixtureArtifact,
      expectedKind: FixtureArtifactKind, expectedKey: string) {
      assert.equal(owned.kind, expectedKind);
      assert.equal(owned.key, expectedKey);
      assert.equal(owned.target, exactFixturePath(expectedKind, expectedKey));
      const current = await fs.lstat(owned.target);
      assert.equal(current.isFile(), true);
      assert.equal(current.isSymbolicLink(), false);
      assert.equal(current.dev, owned.device, "fixture file device identity changed");
      assert.equal(current.ino, owned.inode, "fixture file inode identity changed");
      assert.equal(current.birthtimeMs, owned.birthtimeMs,
        "fixture file birth identity changed");
      assert.equal(current.size, owned.size, "fixture file size changed");
      const currentHash = createHash("sha256")
        .update(await fs.readFile(owned.target)).digest("hex");
      assert.equal(currentHash, owned.hash, "fixture file hash changed");
      await fs.unlink(owned.target);
    }

    async function latest(kind: "attempt" | "claim" | "idempotency", id: string) {
      const directory = path.join(executionRoot,
        kind === "attempt" ? "attempts" : kind === "claim" ? "claims" : "idempotency");
      const expression = new RegExp(`^${id}-v([1-9][0-9]*)\\.json$`);
      const selected = (await fs.readdir(directory))
        .map((name) => ({ name, match: expression.exec(name) }))
        .filter((entry): entry is { name: string; match: RegExpExecArray } => Boolean(entry.match))
        .sort((left, right) => Number(right.match[1]) - Number(left.match[1]))[0];
      return selected ? JSON.parse(await fs.readFile(path.join(directory, selected.name), "utf8")) : undefined;
    }

    async function latestFile(kind: "attempt" | "claim" | "idempotency", id: string) {
      const directory = path.join(executionRoot,
        kind === "attempt" ? "attempts" : kind === "claim" ? "claims" : "idempotency");
      const expression = new RegExp(`^${id}-v([1-9][0-9]*)\\.json$`);
      const selected = (await fs.readdir(directory))
        .map((name) => ({ name, match: expression.exec(name) }))
        .filter((entry): entry is { name: string; match: RegExpExecArray } => Boolean(entry.match))
        .sort((left, right) => Number(right.match[1]) - Number(left.match[1]))[0];
      if (!selected) throw new Error(`latest ${kind} artifact missing`);
      return path.join(directory, selected.name);
    }

    async function assertQuiescent(prepared: Awaited<ReturnType<typeof prepare>>["prepared"],
      failureCode: string) {
      const identity = prepared.request.coordinator.attempt;
      const attempt = await latest("attempt", identity.attemptId);
      const claim = await latest("claim", identity.claimId);
      const record = await latest("idempotency", identity.recordId);
      assert.equal(attempt.state, "failed");
      assert.equal(attempt.journal.at(-1).payload.code, failureCode);
      assert.ok(["abandoned", "released"].includes(claim.state));
      assert.equal(record.durableLease.status, "released");
      assert.ok(["cancelled", "failed"].includes(record.state));
    }

    let audioCalls = 0;
    await job("audio", 0);
    await test("canonical audio/provider failure preserves the original public code", async () => {
      await assert.rejects(
        executeConfiguredProductionPipelineStage(
          { projectSlug, stage: "audio", runType: "initial" },
          async () => { audioCalls += 1; throw failure("AUDIO_ASSET_GENERATION_FAILED"); },
        ),
        (error) => {
          if (error instanceof ProductionPipelineDurableExecutionError &&
            error.reasonCode === "AUDIO_ASSET_GENERATION_FAILED") return true;
          if (error instanceof ProductionPipelineDurableExecutionError) {
            process.stderr.write(`audio failure diagnostic ${JSON.stringify({
              reasonCode: error.reasonCode,
              originalReasonCode: error.originalReasonCode,
              causeReasonCode: error.causeReasonCode,
              completedSettlementSteps: error.completedSettlementSteps,
            })}\n`);
          }
          return false;
        },
      );
      assert.equal(audioCalls, 1);
    });
    const audioIdentity = (await PipelineJobManager.getJobForStageReadOnly(projectSlug, "audio"))!;
    const audioPreparedIdentity = (await import("../src/lib/production/ProductionPipelineExecutionIdentity"))
      .buildProductionPipelineExecutionIdentity(
        { projectSlug, stage: "audio", runType: "initial" }, audioIdentity,
      );
    await test("canonical audio failure immediately closes attempt, claim, lease and record", async () => {
      const attempt = await latest("attempt", audioPreparedIdentity.attemptId);
      const claim = await latest("claim", audioPreparedIdentity.claimId);
      const record = await latest("idempotency", audioPreparedIdentity.recordId);
      assert.equal(attempt.state, "failed");
      assert.equal(attempt.journal.at(-1).payload.code, "AUDIO_ASSET_GENERATION_FAILED");
      assert.equal(claim.state, "abandoned");
      assert.equal(record.durableLease.status, "released");
      assert.equal(record.state, "cancelled");
    });
    await test("immediately settled failure reconciles as a write-free replay", async () => {
      const before = await tree();
      const failedJob = { ...audioIdentity, status: "failed" as const,
        completedAt: anchor, error: "AUDIO_ASSET_GENERATION_FAILED" };
      const replay = await reconcileFailedPipelineExecution(failedJob, () => new Date().toISOString());
      assert.equal(replay.reasonCode, "PIPELINE_RETRY_RECONCILIATION_REPLAYED");
      assert.equal(replay.writeFree, true);
      assert.deepEqual(await tree(), before);
    });

    await job("script", 0);
    let genericCalls = 0;
    await test("generic canonical stage failure is settled without continuation", async () => {
      await assert.rejects(executeConfiguredProductionPipelineStage(
        { projectSlug, stage: "script", runType: "initial" },
        async () => { genericCalls += 1; throw failure("WORKER_HANDLER_FAILED"); },
      ), (error) => error instanceof ProductionPipelineDurableExecutionError &&
        error.reasonCode === "WORKER_HANDLER_FAILED");
      assert.equal(genericCalls, 1);
    });

    await job("research", 0);
    await test("successful canonical settlement remains succeeded and released", async () => {
      assert.equal(await executeConfiguredProductionPipelineStage(
        { projectSlug, stage: "research", runType: "initial" }, async () => true), true);
      const source = (await PipelineJobManager.getJobForStageReadOnly(projectSlug, "research"))!;
      const identity = (await import("../src/lib/production/ProductionPipelineExecutionIdentity"))
        .buildProductionPipelineExecutionIdentity(
          { projectSlug, stage: "research", runType: "initial" }, source,
        );
      const attempt = await latest("attempt", identity.attemptId);
      const claim = await latest("claim", identity.claimId);
      const record = await latest("idempotency", identity.recordId);
      assert.equal(attempt.state, "succeeded");
      assert.equal(attempt.attemptVersion, 3);
      assert.equal(claim.state, "released");
      assert.equal(claim.claimVersion, 2);
      assert.equal(record.state, "succeeded");
      assert.equal(record.recordVersion, 7);
      assert.equal(record.durableLease.status, "released");
      assert.equal((await fs.readdir(path.join(executionRoot, "idempotency")))
        .filter((name) => name.startsWith(`${identity.recordId}-v`)).length, 7);
      assert.equal((await fs.readdir(path.join(executionRoot, "claims")))
        .filter((name) => name.startsWith(`${identity.claimId}-v`)).length, 2);
      assert.equal((await fs.readdir(path.join(executionRoot, "attempts")))
        .filter((name) => name.startsWith(`${identity.attemptId}-v`)).length, 3);
    });

    const stageAttempts = new Map<ProductionStepKey, number>();
    function nextAttempts(stage: ProductionStepKey) {
      const attempts = stageAttempts.get(stage) ?? 0;
      stageAttempts.set(stage, attempts + 1);
      return attempts;
    }
    async function failedExecution(stage: ProductionStepKey = "visuals") {
      const pipelineAttempts = nextAttempts(stage);
      const fixture = await prepare(stage, pipelineAttempts);
      let handlerCalls = 0;
      const result = await new ProductionExecutionWorkerExecutionService(
        fixture.prepared.executionAdapter,
      ).execute(fixture.prepared.request, async () => {
        handlerCalls += 1;
        throw failure("CONTROLLED_STAGE_FAILURE");
      }, { isCancellationRequested: () => false });
      assert.equal(result.status, "failed");
      return { ...fixture, result, pipelineAttempts, handlerCalls };
    }

    const boundaries: ProductionPipelineFailedSettlementBoundary[] = [
      "before-lease-release",
      "after-lease-release",
      "before-claim-close",
      "after-claim-close",
      "before-record-terminalization",
      "after-record-terminalization",
      "before-final-validation",
    ];
    const boundaryStages: ProductionStepKey[] = [
      "visuals", "animation", "video", "scenes", "thumbnail", "seo", "youtube",
    ];
    const expectedBoundaryState = [
      { record: 2, claim: 1, steps: ["attempt-failed"], wrote: false },
      { record: 3, claim: 1, steps: ["attempt-failed", "lease-released"], wrote: true },
      { record: 3, claim: 1, steps: ["attempt-failed", "lease-released"], wrote: true },
      { record: 3, claim: 2, steps: ["attempt-failed", "lease-released", "claim-closed"], wrote: true },
      { record: 3, claim: 2, steps: ["attempt-failed", "lease-released", "claim-closed"], wrote: true },
      { record: 4, claim: 2, steps: ["attempt-failed", "lease-released", "claim-closed", "record-terminal"], wrote: true },
      { record: 4, claim: 2, steps: ["attempt-failed", "lease-released", "claim-closed", "record-terminal"], wrote: true },
    ] as const;
    for (const [index, boundary] of boundaries.entries()) {
      await test(`partial settlement forward-completes after ${boundary}`, async () => {
        const fixture = await failedExecution(boundaryStages[index]);
        const interrupted = await settleFailedProductionPipelineExecution({
          ...fixture.prepared.settlement,
          expectedProjectSlug: projectSlug,
          expectedStage: fixture.context.stage,
          onBoundary(current) { if (current === boundary) throw new Error("controlled"); },
        }, fixture.result);
        assert.equal(interrupted.ok, false);
        assert.equal(interrupted.writePerformed, expectedBoundaryState[index].wrote);
        assert.equal(interrupted.writeFree, !expectedBoundaryState[index].wrote);
        assert.equal(interrupted.quiescenceProven, false);
        assert.equal(interrupted.failedBoundary, boundary);
        assert.deepEqual(interrupted.completedSteps, expectedBoundaryState[index].steps);
        assert.equal(interrupted.originalFailureCode, "CONTROLLED_STAGE_FAILURE");
        assert.equal(interrupted.settlementReasonCode, "PIPELINE_FAILED_SETTLEMENT_INTERRUPTED");
        assert.equal(interrupted.attemptEvidence?.attemptVersion, 3);
        assert.equal(interrupted.attemptEvidence?.terminalState, "failed");
        assert.equal(fixture.handlerCalls, 1);
        assert.equal((await latest("idempotency",
          fixture.prepared.request.coordinator.attempt.recordId)).recordVersion,
        expectedBoundaryState[index].record);
        assert.equal((await latest("claim",
          fixture.prepared.request.coordinator.attempt.claimId)).claimVersion,
        expectedBoundaryState[index].claim);
        assert.equal((await latest("attempt",
          fixture.prepared.request.coordinator.attempt.attemptId)).attemptVersion, 3);
        const replay = await settleFailedProductionPipelineExecution({
          ...fixture.prepared.settlement,
          expectedProjectSlug: projectSlug,
          expectedStage: fixture.context.stage,
        }, fixture.result);
        assert.equal(replay.ok, true);
        await assertQuiescent(fixture.prepared, "CONTROLLED_STAGE_FAILURE");
      });
    }

    await test("historical stale failed shape remains forward-recoverable", async () => {
      const fixture = await failedExecution("assembly");
      const stale = await latest("idempotency", fixture.prepared.request.coordinator.attempt.recordId);
      assert.equal(stale.state, "reserved");
      assert.equal(stale.durableLease.status, "active");
      const failedJob = await job("assembly", fixture.pipelineAttempts + 1, "failed");
      const result = await reconcileFailedPipelineExecution(failedJob, () => new Date().toISOString());
      assert.equal(result.reasonCode, "PIPELINE_RETRY_RECONCILED", JSON.stringify(result));
      await assertQuiescent(fixture.prepared, "CONTROLLED_STAGE_FAILURE");
    });

    await test("binding poisoning fails closed without durable mutation", async () => {
      const fixture = await failedExecution("seo");
      const base = structuredClone(fixture.prepared.request);
      const poisoners: Array<(value: typeof base) => void> = [
        (value) => { value.coordinator.attempt.recordId = "foreign-record"; },
        (value) => { value.coordinator.attempt.reservationId = "foreign-reservation"; },
        (value) => { value.coordinator.attempt.claimId = "foreign-claim"; },
        (value) => { value.coordinator.attempt.attemptId = "foreign-attempt"; },
        (value) => { value.coordinator.attempt.leaseId = "foreign-lease"; },
        (value) => { value.coordinator.attempt.workerId = "foreign-worker"; },
        (value) => { value.coordinator.attempt.workerSessionId = "foreign-session"; },
        (value) => { value.coordinator.attempt.operation = "pipeline.stage.foreign"; },
      ];
      for (const poison of poisoners) {
        const request = structuredClone(base);
        poison(request);
        const before = await tree();
        const result = await settleFailedProductionPipelineExecution({
          ...fixture.prepared.settlement,
          request,
          expectedProjectSlug: projectSlug,
          expectedStage: fixture.context.stage,
        }, fixture.result);
        assert.equal(result.reasonCode, "PIPELINE_FAILED_SETTLEMENT_BINDING_CONFLICT");
        assert.deepEqual(await tree(), before);
      }
      const cleanup = await settleFailedProductionPipelineExecution({
        ...fixture.prepared.settlement,
        expectedProjectSlug: projectSlug,
        expectedStage: fixture.context.stage,
      }, fixture.result);
      assert.equal(cleanup.ok, true);
    });

    const persistedPoisonCases = [
      "reservation-project", "reservation-stage", "reservation-operation",
      "reservation-binding", "reservation-request", "reservation-idempotency",
      "reservation-execution", "record-reservation", "claim-record", "attempt-claim",
      "attempt-worker", "attempt-session", "competing-claim", "competing-lease",
    ] as const;
    const persistedPoisonFixture = await failedExecution("thumbnail");
    for (const [index, poisonCase] of persistedPoisonCases.entries()) {
      await test(`persisted authority poisoning fails closed: ${poisonCase}`, async () => {
        void index;
        const fixture = persistedPoisonFixture;
        const identity = fixture.prepared.request.coordinator.attempt;
        const reservationPath = path.join(executionRoot, "reservations",
          `${identity.reservationId}.json`);
        const recordPath = await latestFile("idempotency", identity.recordId);
        const claimPath = await latestFile("claim", identity.claimId);
        const attemptPath = await latestFile("attempt", identity.attemptId);
        let target = reservationPath;
        let added = false;
        let value = JSON.parse(await fs.readFile(target, "utf8"));
        if (poisonCase === "reservation-project") value.identity.projectSlug = "foreign-project";
        if (poisonCase === "reservation-stage") value.identity.stage = "foreign-stage";
        if (poisonCase === "reservation-operation") value.identity.operation = "pipeline.stage.foreign";
        if (poisonCase === "reservation-binding") value.identity.bindingFingerprint = "foreign-binding";
        if (poisonCase === "reservation-request") value.identity.requestId = "foreign-request";
        if (poisonCase === "reservation-idempotency") value.identity.idempotencyKey = "foreign-idempotency";
        if (poisonCase === "reservation-execution") value.identity.executionFingerprint = "foreign-execution";
        if (poisonCase === "record-reservation") {
          target = recordPath; value = JSON.parse(await fs.readFile(target, "utf8"));
          value.identityFingerprint = "foreign-reservation";
          value.integrity.fingerprint = "foreign-reservation";
        }
        if (poisonCase === "claim-record") {
          target = claimPath; value = JSON.parse(await fs.readFile(target, "utf8"));
          value.identity.recordId = "foreign-record"; value = withClaimIntegrity(value);
        }
        if (poisonCase === "attempt-claim" || poisonCase === "attempt-worker" ||
          poisonCase === "attempt-session") {
          target = attemptPath; value = JSON.parse(await fs.readFile(target, "utf8"));
          if (poisonCase === "attempt-claim") value.identity.claimId = "foreign-claim";
          if (poisonCase === "attempt-worker") value.identity.workerId = "foreign-worker";
          if (poisonCase === "attempt-session") value.identity.workerSessionId = "foreign-session";
          value = withAttemptIntegrity(value);
        }
        if (poisonCase === "competing-claim") {
          const base = JSON.parse(await fs.readFile(claimPath, "utf8"));
          base.identity.claimId = `foreign-${identity.claimId}`;
          value = withClaimIntegrity(base);
          target = path.join(executionRoot, "claims", `${base.identity.claimId}-v1.json`);
          added = true;
        }
        if (poisonCase === "competing-lease") {
          target = recordPath; value = JSON.parse(await fs.readFile(target, "utf8"));
          value.durableLease.identity.leaseId = "foreign-lease";
          value.durableLease = withLeaseIntegrity(value.durableLease);
        }
        const original = added ? undefined : await fs.readFile(target, "utf8");
        await fs.writeFile(target, `${JSON.stringify(value)}\n`, "utf8");
        const poisonedTree = await tree();
        const denied = await settleFailedProductionPipelineExecution({
          ...fixture.prepared.settlement,
          expectedProjectSlug: projectSlug,
          expectedStage: fixture.context.stage,
        }, fixture.result);
        assert.equal(denied.ok, false);
        assert.equal(denied.writePerformed, false);
        assert.equal(denied.writeFree, true);
        assert.equal(denied.quiescenceProven, false);
        assert.equal(denied.failedBoundary, "initial-chain-verification");
        assert.equal(denied.completedSteps?.length ?? 0, 0);
        assert.equal(denied.attemptEvidence?.terminalReasonCode, "CONTROLLED_STAGE_FAILURE");
        assert.equal(fixture.result.handlerCalled, true);
        assert.deepEqual(await tree(), poisonedTree);
        if (added) await fs.unlink(target); else await fs.writeFile(target, original!);
      });
    }
    const persistedPoisonCleanup = await settleFailedProductionPipelineExecution({
      ...persistedPoisonFixture.prepared.settlement,
      expectedProjectSlug: projectSlug,
      expectedStage: persistedPoisonFixture.context.stage,
    }, persistedPoisonFixture.result);
    assert.equal(persistedPoisonCleanup.ok, true, JSON.stringify(persistedPoisonCleanup));

    await test("integrity-valid second competing record fails closed", async () => {
      const fixture = await failedExecution("visuals");
      const identity = fixture.prepared.request.coordinator.attempt;
      const canonical = await latest("idempotency", identity.recordId);
      const competingRecordId = `foreign-${identity.recordId}`;
      const competing = structuredClone(canonical);
      competing.recordId = competingRecordId;
      competing.recordVersion = 1;
      competing.integrity.version = 1;
      competing.durableLease.identity.recordId = competingRecordId;
      competing.durableLease = withLeaseIntegrity(competing.durableLease);
      const storage = new AdapterBackedProductionExecutionDurableStorage(
        fixture.prepared.settlement.adapter);
      assert.equal(storage.validateRecord(competing).ok, true);
      const key = `${competingRecordId}-v1`;
      const written = await fixture.prepared.settlement.adapter.write("idempotency", key, competing);
      assert.equal(written.ok && written.status, "created");
      const owned = await captureOwnedFixture("idempotency", key);
      const before = await tree();
      const denied = await settleFailedProductionPipelineExecution({
        ...fixture.prepared.settlement, expectedProjectSlug: projectSlug,
        expectedStage: fixture.context.stage,
      }, fixture.result);
      assert.equal(denied.reasonCode, "PIPELINE_FAILED_SETTLEMENT_BINDING_CONFLICT");
      assert.equal(denied.causeReasonCode, "PIPELINE_FAILED_SETTLEMENT_COMPETING_AUTHORITY");
      assert.equal(denied.failedBoundary, "initial-chain-verification");
      assert.equal(denied.writePerformed, false);
      assert.equal(denied.writeFree, true);
      assert.equal(denied.quiescenceProven, false);
      assert.equal(fixture.handlerCalls, 1);
      assert.deepEqual(await tree(), before);
      await removeOwnedFixture(owned, "idempotency", key);
      const cleanup = await settleFailedProductionPipelineExecution({
        ...fixture.prepared.settlement, expectedProjectSlug: projectSlug,
        expectedStage: fixture.context.stage,
      }, fixture.result);
      assert.equal(cleanup.ok, true);
      await assertQuiescent(fixture.prepared, "CONTROLLED_STAGE_FAILURE");
    });

    await test("integrity-valid different non-terminal competing attempt fails closed", async () => {
      const fixture = await failedExecution("animation");
      const identity = fixture.prepared.request.coordinator.attempt;
      const openedPath = path.join(executionRoot, "attempts", `${identity.attemptId}-v1.json`);
      const competing = JSON.parse(await fs.readFile(openedPath, "utf8"));
      competing.identity.attemptId = `foreign-${identity.attemptId}`;
      competing.journal = competing.journal.map((entry: { integrity: unknown }) => {
        const { integrity: unused, ...body } = entry as { integrity: unknown;
          attemptId: string };
        void unused;
        body.attemptId = competing.identity.attemptId;
        return { ...body, integrity: { algorithm: "stable-production-id-v1",
          fingerprint: stableProductionId("attempt-journal-entry-integrity", body) } };
      });
      const integrityValid = withAttemptIntegrity(competing);
      assert.equal(validateProductionExecutionDurableAttempt(integrityValid), true);
      const key = `${integrityValid.identity.attemptId}-v1`;
      const written = await fixture.prepared.settlement.adapter.write("attempt", key, integrityValid);
      assert.equal(written.ok && written.status, "created");
      const owned = await captureOwnedFixture("attempt", key);
      const before = await tree();
      const denied = await settleFailedProductionPipelineExecution({
        ...fixture.prepared.settlement, expectedProjectSlug: projectSlug,
        expectedStage: fixture.context.stage,
      }, fixture.result);
      assert.equal(denied.causeReasonCode, "PIPELINE_FAILED_SETTLEMENT_COMPETING_AUTHORITY");
      assert.equal(denied.failedBoundary, "initial-chain-verification");
      assert.equal(denied.writePerformed, false);
      assert.equal(denied.writeFree, true);
      assert.equal(denied.quiescenceProven, false);
      assert.equal(fixture.handlerCalls, 1);
      assert.deepEqual(await tree(), before);
      await removeOwnedFixture(owned, "attempt", key);
      const cleanup = await settleFailedProductionPipelineExecution({
        ...fixture.prepared.settlement, expectedProjectSlug: projectSlug,
        expectedStage: fixture.context.stage,
      }, fixture.result);
      assert.equal(cleanup.ok, true);
      await assertQuiescent(fixture.prepared, "CONTROLLED_STAGE_FAILURE");
    });

    await test("integrity-valid duplicate reservation authority fails closed", async () => {
      const fixture = await failedExecution("video");
      const identity = fixture.prepared.request.coordinator.attempt;
      const reservationPath = path.join(executionRoot, "reservations",
        `${identity.reservationId}.json`);
      const canonical = JSON.parse(await fs.readFile(reservationPath, "utf8"));
      const competing = structuredClone(canonical);
      const competingCreatedAt = new Date(Date.parse(competing.identity.createdAt) + 1).toISOString();
      const competingIdentity = buildProductionExecutionIdempotencyIdentity({
        authorization: competing.authorization,
        confirmation: competing.confirmation,
      }, {
        evaluatedAt: competingCreatedAt,
        policy: fixture.prepared.settlement.idempotencyPolicy,
      });
      assert.equal(competingIdentity.ok, true);
      if (!competingIdentity.ok) throw new Error("duplicate reservation identity build failed");
      competing.identity = competingIdentity.identity;
      for (const field of ["projectSlug", "stage", "operation", "requestId",
        "idempotencyKey", "executionFingerprint"] as const) {
        assert.equal(competing.identity[field], canonical.identity[field]);
      }
      assert.equal(validateProductionExecutionIdempotencyReservation(
        competing, fixture.prepared.settlement.idempotencyPolicy).valid, true);
      const key = competing.identity.identityFingerprint;
      assert.notEqual(key, identity.reservationId);
      const written = await fixture.prepared.settlement.adapter.write("reservation", key, competing);
      assert.equal(written.ok && written.status, "created");
      const owned = await captureOwnedFixture("reservation", key);
      const persisted = await fixture.prepared.settlement.adapter.read("reservation", key);
      assert.equal(persisted.status, "found");
      assert.equal(persisted.status === "found" &&
        persisted.value.identity.identityFingerprint, key);
      const before = await tree();
      const denied = await settleFailedProductionPipelineExecution({
        ...fixture.prepared.settlement, expectedProjectSlug: projectSlug,
        expectedStage: fixture.context.stage,
      }, fixture.result);
      assert.equal(denied.reasonCode, "PIPELINE_FAILED_SETTLEMENT_BINDING_CONFLICT");
      assert.equal(denied.causeReasonCode, "PIPELINE_FAILED_SETTLEMENT_COMPETING_AUTHORITY");
      assert.equal(denied.failedBoundary, "initial-chain-verification");
      assert.equal(denied.writePerformed, false);
      assert.equal(denied.writeFree, true);
      assert.equal(denied.quiescenceProven, false);
      assert.equal(fixture.handlerCalls, 1);
      assert.deepEqual(await tree(), before);
      await removeOwnedFixture(owned, "reservation", key);
      const cleanup = await settleFailedProductionPipelineExecution({
        ...fixture.prepared.settlement, expectedProjectSlug: projectSlug,
        expectedStage: fixture.context.stage,
      }, fixture.result);
      assert.equal(cleanup.ok, true);
      await assertQuiescent(fixture.prepared, "CONTROLLED_STAGE_FAILURE");
    });

    await test("duplicate concurrent settlement converges to one quiescent authority", async () => {
      const fixture = await failedExecution("youtube");
      const context = { ...fixture.prepared.settlement,
        expectedProjectSlug: projectSlug, expectedStage: fixture.context.stage };
      const results = await Promise.all([
        settleFailedProductionPipelineExecution(context, fixture.result),
        settleFailedProductionPipelineExecution(context, fixture.result),
      ]);
      assert.ok(results.every((result) => result.ok), JSON.stringify(results));
      await assertQuiescent(fixture.prepared, "CONTROLLED_STAGE_FAILURE");
    });

    await test("settlement failure error preserves original causal evidence", async () => {
      const fixture = await prepare("export", nextAttempts("export"));
      let calls = 0;
      const adapter = new ProductionPipelineExecutionAdapter(
        fixture.prepared.executionAdapter,
        () => fixture.prepared.request,
        undefined,
        async () => ({ ok: false,
          reasonCode: "PIPELINE_FAILED_SETTLEMENT_LEASE_RELEASE_FAILED",
          settlementReasonCode: "PIPELINE_FAILED_SETTLEMENT_LEASE_RELEASE_FAILED",
          originalFailureCode: "EXPORT_STAGE_FAILED",
          causeReasonCode: "LEASE_NEXT_VERSION_CONFLICT",
          completedSteps: ["attempt-failed"],
          writePerformed: true, writeFree: false, quiescenceProven: false,
          failedBoundary: "lease-release",
          attemptEvidence: {
            attemptId: "pipeline-attempt-bounded", attemptVersion: 3,
            terminalState: "failed", terminalReasonCode: "EXPORT_STAGE_FAILED",
            recordId: "pipeline-record-bounded", claimId: "pipeline-claim-bounded",
            leaseId: "pipeline-lease-bounded", reservationId: "pipeline-reservation-bounded",
            workerId: "pipeline-worker", workerSessionId: "pipeline-session-v1",
          } }),
      );
      await assert.rejects(adapter.execute(fixture.context, async () => {
        calls += 1;
        throw failure("EXPORT_STAGE_FAILED");
      }), (error) => error instanceof ProductionPipelineDurableExecutionError &&
        error.reasonCode === "PIPELINE_FAILED_SETTLEMENT_LEASE_RELEASE_FAILED" &&
        error.originalReasonCode === "EXPORT_STAGE_FAILED" &&
        error.settlementReasonCode === "PIPELINE_FAILED_SETTLEMENT_LEASE_RELEASE_FAILED" &&
        error.causeReasonCode === "LEASE_NEXT_VERSION_CONFLICT" &&
        error.completedSettlementSteps?.includes("attempt-failed") === true &&
        error.writePerformed === true && error.writeFree === false &&
        error.quiescenceProven === false && error.failedBoundary === "lease-release" &&
        error.attemptEvidence?.terminalReasonCode === "EXPORT_STAGE_FAILED");
      assert.equal(calls, 1);
      const replay = await new ProductionExecutionWorkerExecutionService(
        fixture.prepared.executionAdapter,
      ).execute(fixture.prepared.request, async () => ({ summary: "must not run" }),
        { isCancellationRequested: () => false });
      const cleanup = await settleFailedProductionPipelineExecution({
        ...fixture.prepared.settlement,
        expectedProjectSlug: projectSlug,
        expectedStage: fixture.context.stage,
      }, replay);
      assert.equal(cleanup.ok, true);
    });

    await test("settlement, retry reconciliation and admission observation remain ordered", async () => {
      const fixture = await failedExecution("export");
      let reached!: () => void;
      let resume!: () => void;
      const atBoundary = new Promise<void>((resolve) => { reached = resolve; });
      const continueSettlement = new Promise<void>((resolve) => { resume = resolve; });
      const settlement = settleFailedProductionPipelineExecution({
        ...fixture.prepared.settlement,
        expectedProjectSlug: projectSlug,
        expectedStage: fixture.context.stage,
        async onBoundary(boundary) {
          if (boundary === "after-lease-release") {
            reached();
            await continueSettlement;
          }
        },
      }, fixture.result);
      await atBoundary;
      const observed = await readProductionExecutionRecoverySemanticAuthority(
        fixture.prepared.adapter, new Date().toISOString());
      assert.notEqual(observed.decision, "ready");
      const failedJob = await job("export", fixture.pipelineAttempts + 1, "failed");
      let preparationResolved = false;
      const preparation = prepareFailedStageRetry(projectSlug, failedJob.id)
        .finally(() => { preparationResolved = true; });
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.equal(preparationResolved, false);
      resume();
      assert.equal((await settlement).ok, true);
      const prepared = await preparation;
      assert.equal(prepared.success, true);
      assert.equal(prepared.success && prepared.job.status, "queued");
    });

    async function runChildRace(
      fixture: Awaited<ReturnType<typeof failedExecution>>,
      actions: readonly ChildAction[],
      failedJob?: PipelineJob,
      barrierBeforeCall = false,
    ) {
      const raceRoot = path.join(runtime.tempRoot,
        `race-${fixture.prepared.request.coordinator.attempt.attemptId}-${Date.now()}`);
      await fs.mkdir(raceRoot, { recursive: true });
      const releaseFile = path.join(raceRoot, "release");
      const { adapter: unused, ...settlement } = fixture.prepared.settlement;
      void unused;
      const children = actions.map(async (action, index) => {
        const readyFile = path.join(raceRoot, `ready-${index}`);
        const payloadPath = path.join(raceRoot, `payload-${index}.json`);
        const payload: ChildPayload = {
          action, executionRoot, runtimeRoot: runtime.runtimeRoot, readyFile, releaseFile,
          barrierBeforeCall, sentinelEnvironmentKey: childSentinelEnvironmentKey,
          ...(action === "settle" ? { settlement: {
            ...settlement, expectedProjectSlug: projectSlug, expectedStage: fixture.context.stage,
          }, execution: fixture.result } : { job: failedJob }),
        };
        await fs.writeFile(payloadPath, JSON.stringify(payload), { encoding: "utf8", flag: "wx" });
        return { readyFile, running: spawnChild(payloadPath, runtime.runtimeRoot) };
      });
      const started = await Promise.all(children);
      await Promise.all(started.map((child) => waitForFile(child.readyFile)));
      await fs.writeFile(releaseFile, "release", { encoding: "utf8", flag: "wx" });
      const results = await Promise.all(started.map((child) => child.running));
      assert.ok(results.every((result) => result.code === 0), JSON.stringify(results));
      return results.map((result) => {
        assert.equal(result.stderr, "");
        const match = /^CHILD_RESULT (\{.*\})\r?\n?$/.exec(result.stdout);
        assert.ok(match, result.stdout);
        const parsed = JSON.parse(match[1]);
        assert.equal(parsed.environment.runtimeRootBound, true);
        assert.equal(parsed.environment.nodeEnvironmentIsTest, true);
        assert.equal(parsed.environment.onlyAllowlistedKeys, true);
        assert.equal(parsed.environment.sensitiveEnvironmentVisible, false);
        assert.equal(parsed.environment.sentinelVisible, false);
        return parsed.result;
      });
    }

    await test("child process receives only allowlisted environment and isolated runtime root", async () => {
      const controlledParentEnvironment = {
        NODE_ENV: "production-parent-must-not-flow",
        OPENAI_API_KEY: "controlled-openai-secret",
        ATOLYE_UNRELATED_SPRINT_VALUE: "controlled-atolye-secret",
        SPRINT_129_30_GENERIC_TOKEN: "controlled-token",
        SPRINT_129_30_GENERIC_CREDENTIAL: "controlled-credential",
        [childSentinelEnvironmentKey]: "controlled-parent-secret-not-for-child",
      } as const;
      const previous = Object.keys(controlledParentEnvironment).map((key) => ({
        key,
        present: Object.prototype.hasOwnProperty.call(process.env, key),
        value: process.env[key],
      }));
      try {
        for (const [key, value] of Object.entries(controlledParentEnvironment)) {
          process.env[key] = value;
        }
        assert.equal(process.env[childSentinelEnvironmentKey] !== undefined, true);
        const fixture = await failedExecution("scenes");
        const results = await runChildRace(fixture, ["settle"]);
        assert.equal(results[0].ok, true);
        assert.equal(fixture.handlerCalls, 1);
        await assertQuiescent(fixture.prepared, "CONTROLLED_STAGE_FAILURE");
      } finally {
        for (const item of previous) {
          if (item.present) process.env[item.key] = item.value;
          else delete process.env[item.key];
        }
      }
      for (const item of previous) {
        assert.equal(Object.prototype.hasOwnProperty.call(process.env, item.key), item.present);
        assert.equal(process.env[item.key], item.value);
      }
    });

    await test("child-process settlement versus settlement converges on one canonical chain", async () => {
      const fixture = await failedExecution("assembly");
      const results = await runChildRace(fixture, ["settle", "settle"]);
      assert.ok(results.every((result) => result.ok));
      assert.ok(results.some((result) => result.writePerformed));
      assert.equal(fixture.handlerCalls, 1);
      await assertQuiescent(fixture.prepared, "CONTROLLED_STAGE_FAILURE");
      const identity = fixture.prepared.request.coordinator.attempt;
      assert.equal((await fs.readdir(path.join(executionRoot, "idempotency")))
        .filter((name) => name === `${identity.recordId}-v4.json`).length, 1);
      assert.equal((await fs.readdir(path.join(executionRoot, "claims")))
        .filter((name) => name === `${identity.claimId}-v2.json`).length, 1);
    });

    await test("child-process settlement versus retry reconciliation converges", async () => {
      const fixture = await failedExecution("thumbnail");
      const failedJob = await job("thumbnail", fixture.pipelineAttempts + 1, "failed");
      const results = await runChildRace(fixture, ["settle", "reconcile"], failedJob);
      assert.ok(results.every((result) => result.ok), JSON.stringify(results));
      assert.equal(fixture.handlerCalls, 1);
      await assertQuiescent(fixture.prepared, "CONTROLLED_STAGE_FAILURE");
    });

    await test("child processes fail closed on a distinct active claim", async () => {
      const fixture = await failedExecution("export");
      const identity = fixture.prepared.request.coordinator.attempt;
      const claimPath = await latestFile("claim", identity.claimId);
      const foreign = JSON.parse(await fs.readFile(claimPath, "utf8"));
      foreign.identity.claimId = `foreign-${identity.claimId}`;
      const foreignPath = path.join(executionRoot, "claims", `${foreign.identity.claimId}-v1.json`);
      await fs.writeFile(foreignPath, `${JSON.stringify(withClaimIntegrity(foreign))}\n`,
        { encoding: "utf8", flag: "wx" });
      const before = await tree();
      const results = await runChildRace(fixture, ["settle", "settle"], undefined, true);
      assert.ok(results.every((result) => !result.ok && result.writeFree &&
        !result.quiescenceProven));
      assert.deepEqual(await tree(), before);
      await fs.unlink(foreignPath);
      const cleanup = await settleFailedProductionPipelineExecution({
        ...fixture.prepared.settlement,
        expectedProjectSlug: projectSlug,
        expectedStage: fixture.context.stage,
      }, fixture.result);
      assert.equal(cleanup.ok, true);
    });

    await test("global recovery semantic authority is immediately ready", async () => {
      const semantic = await readProductionExecutionRecoverySemanticAuthority(
        new ProductionExecutionFilePersistenceAdapter({ trustedRootDirectory: executionRoot,
          createRootDirectory: false }),
        new Date(Date.parse(anchor) + 60_000).toISOString(),
      );
      assert.equal(semantic.decision, "ready");
      assert.equal(semantic.counts.active, 0);
      assert.equal(semantic.counts.running, 0);
    });
  });
  assert.equal(run.finalization.cleanupCompleted, true);
  assert.equal(run.finalization.runtimeRemainder, 0);
  assert.equal(run.finalization.authorityRemainder, 0);
  await test("isolated runtime and authority roots are fully cleaned", () => undefined);
  emitSmokeResult("sprint-129-29-failed-terminal-settlement", passed);
}

const childIndex = process.argv.indexOf("--settlement-child");
const execution = childIndex >= 0
  ? childMain(process.argv[childIndex + 1] ?? "")
  : main();

void execution.catch((error) => {
  process.stderr.write(`Sprint 129.29 failed settlement smoke FAILED: ${
    error instanceof Error ? error.stack ?? error.message : "unknown"}\n`);
  process.exitCode = 1;
});
