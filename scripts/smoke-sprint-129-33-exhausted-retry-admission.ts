import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import http from "node:http";
import https from "node:https";
import { ProjectWriter } from "../src/lib/projects/ProjectWriter";
import { PipelineJobManager } from "../src/lib/pipeline/PipelineJobManager";
import { readCanonicalProcessStartEpochMs,
  installCanonicalMutationInvocationTestHook,
  installCanonicalReleaseFailureTestHook,
  verifyCanonicalOwnerPublicationFailureCleanup } from
  "../src/lib/pipeline/PipelineJobMutationLock";
import { PipelineStageExecutor } from "../src/lib/pipeline/PipelineStageExecutor";
import { AudioProviderRouter } from "../src/lib/audio/providers/AudioProviderRouter";
import { prepareFailedStageRetry } from "../src/lib/pipeline/PipelineFailedStageRetry";
import { prepareProductionPipelineExecution,
  productionDurableAttemptLineageBindingInvalidCode } from
  "../src/lib/production/ProductionPipelineExecutionFactory";
import { buildProductionPipelineExecutionIdentity } from
  "../src/lib/production/ProductionPipelineExecutionIdentity";
import { reconcileFailedPipelineExecution } from
  "../src/lib/production/ProductionPipelineRetryReconciliation";
import { ProductionExecutionWorkerExecutionService } from
  "../src/lib/production/ProductionExecutionWorker";
import { runProductionAcceptanceCommand } from
  "../src/lib/production/ProductionAcceptanceCommand";
import { ProductionAcceptanceBlockedError,
  ProductionAcceptanceConfigurationChangedError,
  ProductionAcceptanceExecutionError } from
  "../src/lib/production/ProductionAcceptanceOrchestrator";
import { ProductionAcceptancePolicyError } from
  "../src/lib/production/ProductionAcceptancePolicy";
import { ProductionAcceptanceReprepareError } from
  "../src/lib/production/ProductionAcceptanceReprepareService";
import { ProductionAcceptanceLegacyReauthorizationError } from
  "../src/lib/production/ProductionAcceptanceLegacyReauthorization";
import { ProductionPipelineDurableExecutionError } from
  "../src/lib/production/ProductionPipelineExecutionAdapter";
import { recoverQueuedExhaustedPipelineJobDrift } from
  "../src/lib/production/ProductionQueuedExhaustedDriftRecovery";
import { withProductionAcceptanceRetryAdmission } from
  "../src/lib/production/ProductionAcceptanceLegacyAdmissionContext";
import { ProductionExecutionFilePersistenceAdapter } from
  "../src/lib/production/ProductionExecutionPersistence";
import { AdapterBackedProductionExecutionDurableStorage,
  installDurableStorageConstructionTestHook } from
  "../src/lib/production/ProductionExecutionDurableStorage";
import { stableProductionId } from "../src/lib/production/ProductionDeterminism";
import { buildProductionExecutionDurableAttemptIntegrity } from
  "../src/lib/production/ProductionExecutionDurableAttemptIntegrity";
import type { PipelineJob, PipelineJobHistory, PipelineJobList } from
  "../src/types/pipelineJob";
import type { ProductionExecutionPersistenceAdapter } from
  "../src/types/productionExecutionPersistence";
import type { ProductionExecutionDurableAttemptRecord } from
  "../src/types/productionExecutionDurableAttempt";
import type { ProductionStepKey } from "../src/types/project";
import { withCanonicalSmokeRuntime } from "./lib/CanonicalSmokeRuntime";
import { emitSmokeResult } from "./lib/SmokeResult";

const anchor = "2026-07-01T23:00:00.000Z";
const stage: ProductionStepKey = "audio";
let passed = 0;
let totalRuntimeRemainder = 0;
let totalAuthorityRemainder = 0;
let totalLockGateQuarantineRemainder = 0;
let preExistingGlobalInventoryCount = 0;
let newlyCreatedGlobalInventoryCount = 0;
let networkCallCount = 0;
let admissionStorageConstructionCount = 0;
const capturedBoundaryTotals: InvocationCounters = {
  storage: 0, provider: 0, worker: 0, stageDispatch: 0, fetch: 0, http: 0, https: 0,
  network: 0, lock: 0, gate: 0, quarantine: 0,
};

async function test(name: string, action: () => Promise<void>) {
  await action();
  passed += 1;
  process.stdout.write(`PASS ${passed}: ${name}\n`);
}

function childEnvironment(runtimeRoot: string): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    NODE_ENV: "test",
    ATOLYE_RUNTIME_ROOT: runtimeRoot,
    ATOLYE_RUNTIME_AUTHORITY_ROOT: path.join(path.dirname(runtimeRoot), "authority"),
    AI_PROVIDER: "mock",
    IMAGE_PROVIDER: "mock",
    AUDIO_PROVIDER: "mock",
  };
  for (const key of ["SystemRoot", "WINDIR", "ComSpec", "PATHEXT", "TEMP", "TMP",
    "USERPROFILE", "HOME"] as const) {
    if (process.env[key]) environment[key] = process.env[key];
  }
  return environment;
}

function spawnLockChild(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  attemptedFile: string,
  mode?: "seed" | "stale-remover" | "live-replacement",
  extraArguments: readonly string[] = [],
) {
  const cli = path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
  const helper = path.join(process.cwd(), "scripts", "fixtures",
    "sprint-129-33-pipeline-job-lock-child.ts");
  const child = spawn(process.execPath, [cli, helper, fixture.projectSlug,
    `${fixture.projectSlug}-${stage}`, attemptedFile, ...(mode ? [mode] : []), ...extraArguments], {
    cwd: process.cwd(), env: childEnvironment(fixture.runtimeRoot), stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = ""; let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += String(chunk); });
  child.stderr.on("data", (chunk) => { stderr += String(chunk); });
  const completed = new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) =>
    child.on("close", (code) => resolve({ code, stdout, stderr })));
  return { child, completed };
}

function spawnPathRaceChild(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  role: "a" | "b",
  target: "lock-release" | "gate-release" | "stale-lock" | "stale-gate" |
    "quarantine-cleanup" | "publication-cleanup" | "foreign-quarantine-preserved",
  signal: string,
  resume: string,
  preserved: string,
  ownerKind: "same" | "different",
) {
  const cli = path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
  const helper = path.join(process.cwd(), "scripts", "fixtures",
    "sprint-129-33-path-race-child.ts");
  const child = spawn(process.execPath, [cli, helper, fixture.projectSlug,
    `${fixture.projectSlug}-${stage}`, role, target, signal, resume, preserved, ownerKind], {
    cwd: process.cwd(), env: childEnvironment(fixture.runtimeRoot), stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = ""; let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += String(chunk); });
  child.stderr.on("data", (chunk) => { stderr += String(chunk); });
  const completed = new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) =>
    child.on("close", (code) => resolve({ code, stdout, stderr })));
  return { child, completed };
}

interface ReplacementEvidence {
  readonly decision: "replacement-published";
  readonly replacementBytes: string;
  readonly replacementHash: string;
  readonly replacementInventoryHash: string;
  readonly replacementType: "directory" | "file";
}

interface RaceMutationCounters {
  readonly foreignLeafMutationAttempts: number;
  readonly foreignLeafDeleteAttempts: number;
  readonly foreignLeafOverwriteAttempts: number;
  readonly canonicalOverwriteAttempts: number;
  readonly quarantineToCanonicalRestoreAttempts: number;
  readonly unexpectedCanonicalMutationAttempts: number;
}

async function readReplacementEvidence(
  leaf: string,
  type: "directory" | "file",
): Promise<{ bytes: string; hash: string; inventoryHash: string }> {
  const stat = await fs.lstat(leaf);
  assert.equal(stat.isSymbolicLink(), false);
  assert.equal(type === "directory" ? stat.isDirectory() : stat.isFile(), true);
  const payload = type === "directory" ? path.join(leaf, "owner.json") : leaf;
  if (type === "directory") assert.deepEqual(await fs.readdir(leaf), ["owner.json"]);
  const bytes = await fs.readFile(payload, "utf8");
  const hash = createHash("sha256").update(bytes, "utf8").digest("hex");
  const row = `${type === "directory" ? "owner.json" : "."}\tfile\t${
    Buffer.byteLength(bytes)}\t${hash}`;
  return { bytes, hash,
    inventoryHash: createHash("sha256").update(row, "utf8").digest("hex") };
}

async function findQuarantineLeaves(projectFolder: string): Promise<string[]> {
  const leaves: string[] = [];
  for (const entry of await fs.readdir(projectFolder)) {
    if (!entry.startsWith(".pipeline-jobs.quarantine-")) continue;
    const container = path.join(projectFolder, entry);
    for (const child of await fs.readdir(container)) {
      if (child.startsWith("owned-lock-") || child.startsWith("owned-gate-")) {
        leaves.push(path.join(container, child));
      }
    }
  }
  return leaves;
}

async function runActualCliProcess(
  fixture: "exhausted" | "drift" | "generic",
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const cli = path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
  const entrypoint = path.join(process.cwd(), "scripts", "run-production-acceptance.ts");
  const environment = childEnvironment(process.env.ATOLYE_RUNTIME_ROOT ?? process.cwd());
  environment.ATOLYE_TEST_PRODUCTION_ACCEPTANCE_COMMAND_ERROR = fixture;
  const child = spawn(process.execPath, [cli, entrypoint, "resume-finalize",
    "--project-slug=sprint-129-33-cli-process", "--confirm-production-acceptance"], {
    cwd: process.cwd(), env: environment, stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = ""; let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += String(chunk); });
  child.stderr.on("data", (chunk) => { stderr += String(chunk); });
  return new Promise((resolve) => child.on("close", (code) =>
    resolve({ code, stdout, stderr })));
}

async function waitForFile(file: string) {
  for (let attempt = 0; attempt < 1_000; attempt += 1) {
    try { await fs.access(file); return; } catch { /* retry */ }
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("child attempt signal timed out");
}

function controlledFailure() {
  return Object.assign(new Error("controlled fixture failure"), {
    code: "CONTROLLED_STAGE_FAILURE",
  });
}

interface InvocationCounters {
  storage: number;
  provider: number;
  worker: number;
  stageDispatch: number;
  fetch: number;
  http: number;
  https: number;
  network: number;
  lock: number;
  gate: number;
  quarantine: number;
}

interface StateSnapshot {
  jobs: string;
  manifest: string;
  history: string;
  durable: readonly string[];
}

async function withFixture(
  name: string,
  action: (fixture: Awaited<ReturnType<typeof createFixture>>) => Promise<void>,
) {
  const run = await withCanonicalSmokeRuntime(
    { name: `sprint-129-33-${name}`, now: anchor, operationType: "pipeline-stage-execution" },
    async (runtime) => action(await createFixture(runtime.runtimeRoot, runtime.projectSlug)),
  );
  assert.equal(run.finalization.cleanupCompleted, true);
  assert.equal(run.finalization.runtimeRemainder, 0);
  assert.equal(run.finalization.authorityRemainder, 0);
  assert.equal(run.finalization.lockGateQuarantineRemainder, 0);
  assert.equal(run.finalization.newlyCreatedGlobalInventory.length, 0);
  totalRuntimeRemainder += run.finalization.runtimeRemainder;
  totalAuthorityRemainder += run.finalization.authorityRemainder;
  totalLockGateQuarantineRemainder += run.finalization.lockGateQuarantineRemainder;
  preExistingGlobalInventoryCount = Math.max(preExistingGlobalInventoryCount,
    run.finalization.preExistingGlobalInventory.length);
  newlyCreatedGlobalInventoryCount += run.finalization.newlyCreatedGlobalInventory.length;
}

async function createFixture(runtimeRoot: string, projectSlug: string) {
  const projectFolder = path.join(runtimeRoot, "projects", projectSlug);
  const executionRoot = path.join(projectFolder, "production-execution");
  let ordinal = 0;

  async function writeJob(job: PipelineJob) {
    const list: PipelineJobList = {
      projectSlug,
      jobs: [job],
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    };
    await ProjectWriter.writeJSON(projectSlug, "pipeline-jobs.json", list);
    return list;
  }

  async function replaceJobBytesWithoutLockForRace(job: PipelineJob) {
    const list: PipelineJobList = {
      projectSlug,
      jobs: [job],
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    };
    const target = path.join(projectFolder, "pipeline-jobs.json");
    await fs.writeFile(target, `${JSON.stringify(list, null, 2)}\n`, "utf8");
    return fs.readFile(target, "utf8");
  }

  async function writeHistory(events: PipelineJobHistory["events"]) {
    const history: PipelineJobHistory = {
      projectSlug,
      events: [...events],
      createdAt: anchor,
      updatedAt: events.at(-1)?.recordedAt ?? anchor,
    };
    await ProjectWriter.writeJSON(projectSlug, "pipeline-history.json", history);
    return history;
  }

  async function appendFailure(job: PipelineJob) {
    const history = await PipelineJobManager.listHistory(projectSlug);
    await writeHistory([...history.events, {
      id: `${job.id}-failed-${job.updatedAt}-${ordinal}`,
      jobId: job.id,
      stage: job.stage,
      status: "failed",
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      jobCreatedAt: job.createdAt,
      jobUpdatedAt: job.updatedAt,
      recordedAt: job.updatedAt,
      errorCode: "CONTROLLED_STAGE_FAILURE",
    }]);
  }

  async function writeFailedManifest(targetStage = stage) {
    const project = {
      id: `proj-${projectSlug}`,
      slug: projectSlug,
      name: projectSlug,
      createdAt: anchor,
      updatedAt: anchor,
    };
    await ProjectWriter.writeJSON(projectSlug, "project.json", project);
    await ProjectWriter.writeJSON(projectSlug, "manifest.json", {
      schemaVersion: "3",
      id: project.id,
      projectSlug,
      slug: projectSlug,
      name: projectSlug,
      topic: "smoke-topic",
      runId: "smoke-run",
      createdAt: anchor,
      updatedAt: anchor,
      packages: {
        [targetStage]: {
          status: "failed",
          error: "CONTROLLED_STAGE_FAILURE",
          updatedAt: anchor,
        },
      },
    });
  }

  async function executionFixture(
    attempts: number,
    terminal = true,
    targetStage: ProductionStepKey = stage,
  ) {
    const createdAt = new Date(Date.parse(anchor) + ordinal++ * 20_000).toISOString();
    const queued: PipelineJob = {
      id: `${projectSlug}-${targetStage}`,
      projectSlug,
      stage: targetStage,
      title: targetStage,
      status: "queued",
      attempts,
      createdAt,
      updatedAt: createdAt,
    };
    await writeJob(queued);
    const prepared = await prepareProductionPipelineExecution({
      projectSlug,
      stage: targetStage,
      runType: attempts === 0 ? "initial" : "retry",
    });
    let setupWorkerCalls = 0;
    const execution = await new ProductionExecutionWorkerExecutionService(
      prepared.executionAdapter,
    ).execute(prepared.request, async () => {
      setupWorkerCalls += 1;
      throw controlledFailure();
    }, { isCancellationRequested: () => false });
    assert.equal(execution.status, "failed");
    assert.equal(setupWorkerCalls, 1);
    const failedAt = new Date(Date.parse(createdAt) + 5_000).toISOString();
    const failedJob: PipelineJob = {
      ...queued,
      status: "failed",
      updatedAt: failedAt,
      completedAt: failedAt,
      error: "CONTROLLED_STAGE_FAILURE",
    };
    await writeJob(failedJob);
    await writeFailedManifest(targetStage);
    await appendFailure(failedJob);
    if (terminal) {
      const reconciled = await reconcileFailedPipelineExecution(
        failedJob,
        () => new Date(Date.parse(failedAt) + 1_000).toISOString(),
      );
      assert.equal(reconciled.ok, true, JSON.stringify(reconciled));
    }
    return {
      failedJob,
      identity: buildProductionPipelineExecutionIdentity(
        { projectSlug, stage: targetStage,
          runType: attempts === 0 ? "initial" : "retry" },
        { id: failedJob.id, attempts },
      ),
    };
  }

  async function createChain(count: number) {
    const attempts = [];
    for (let value = 0; value < count; value += 1) {
      attempts.push(await executionFixture(value));
    }
    return attempts;
  }

  async function writeQueuedDrift(source: PipelineJob, attempts = 3) {
    const drift: PipelineJob = {
      ...source,
      status: "queued",
      attempts,
      updatedAt: new Date(Date.parse(source.updatedAt) + 2_000).toISOString(),
      startedAt: undefined,
      completedAt: undefined,
      error: undefined,
      errorEvidence: undefined,
    };
    await writeJob(drift);
    return drift;
  }

  async function raw(fileName: string) {
    try {
      return await fs.readFile(path.join(projectFolder, fileName), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return "<missing>";
      throw error;
    }
  }

  async function durableTree() {
    const output: string[] = [];
    async function visit(directory: string) {
      try {
        for (const entry of (await fs.readdir(directory, { withFileTypes: true }))
          .sort((left, right) => left.name.localeCompare(right.name))) {
          const target = path.join(directory, entry.name);
          if (entry.isDirectory()) await visit(target);
          else output.push(`${path.relative(executionRoot, target).replaceAll("\\", "/")}:` +
            createHash("sha256").update(await fs.readFile(target)).digest("hex"));
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    await visit(executionRoot);
    return output;
  }

  async function snapshot(): Promise<StateSnapshot> {
    return {
      jobs: await raw("pipeline-jobs.json"),
      manifest: await raw("manifest.json"),
      history: await raw("pipeline-history.json"),
      durable: await durableTree(),
    };
  }

  async function assertUnchanged(before: StateSnapshot, options: { jobs?: string } = {}) {
    const after = await snapshot();
    assert.equal(after.jobs, options.jobs ?? before.jobs, "PipelineJob bytes changed");
    assert.equal(after.manifest, before.manifest, "manifest bytes changed");
    assert.equal(after.history, before.history, "history bytes changed");
    assert.deepEqual(after.durable, before.durable, "durable execution tree changed");
  }

  return {
    runtimeRoot,
    projectSlug,
    projectFolder,
    executionRoot,
    writeJob,
    replaceJobBytesWithoutLockForRace,
    writeHistory,
    writeFailedManifest,
    executionFixture,
    createChain,
    writeQueuedDrift,
    snapshot,
    assertUnchanged,
    durableTree,
  };
}

function assertZero(counters: InvocationCounters) {
  const { storage: _storage, lock: _lock, gate: _gate,
    quarantine: _quarantine, ...external } = counters;
  void _storage;
  void _lock;
  void _gate;
  void _quarantine;
  assert.deepEqual(external, { provider: 0, worker: 0, stageDispatch: 0,
    fetch: 0, http: 0, https: 0, network: 0 });
}

async function captureBoundaries<T>(action: () => Promise<T>) {
  const counters: InvocationCounters = { storage: 0, provider: 0, worker: 0, stageDispatch: 0,
    fetch: 0, http: 0, https: 0, network: 0, lock: 0, gate: 0, quarantine: 0 };
  const worker = ProductionExecutionWorkerExecutionService.prototype as unknown as {
    execute: (...args: never[]) => Promise<unknown> };
  const workerExecute = worker.execute;
  const stageExecute = PipelineStageExecutor.execute;
  const providerFactory = AudioProviderRouter.getProvider;
  const fetchImplementation = globalThis.fetch;
  const httpModule = http as unknown as { request: (...args: never[]) => unknown;
    get: (...args: never[]) => unknown };
  const httpsModule = https as unknown as { request: (...args: never[]) => unknown;
    get: (...args: never[]) => unknown };
  const httpRequest = httpModule.request;
  const httpGet = httpModule.get;
  const httpsRequest = httpsModule.request;
  const httpsGet = httpsModule.get;
  const restoreStorageConstruction = installDurableStorageConstructionTestHook(() => {
    counters.storage += 1;
  });
  const restoreMutationInvocation = installCanonicalMutationInvocationTestHook((kind) => {
    counters[kind] += 1;
  });
  worker.execute = async function (...args: never[]) {
    counters.worker += 1;
    return workerExecute.apply(this, args);
  };
  PipelineStageExecutor.execute = (async (...args: Parameters<typeof stageExecute>) => {
    counters.stageDispatch += 1;
    return stageExecute(...args);
  }) as typeof stageExecute;
  AudioProviderRouter.getProvider = ((...args: Parameters<typeof providerFactory>) => {
    counters.provider += 1;
    return providerFactory(...args);
  }) as typeof providerFactory;
  globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
    counters.fetch += 1;
    counters.network += 1;
    return fetchImplementation(...args);
  }) as typeof fetch;
  httpModule.request = (...args: never[]) => { counters.http += 1; counters.network += 1;
    return httpRequest(...args); };
  httpModule.get = (...args: never[]) => { counters.http += 1; counters.network += 1;
    return httpGet(...args); };
  httpsModule.request = (...args: never[]) => { counters.https += 1; counters.network += 1;
    return httpsRequest(...args); };
  httpsModule.get = (...args: never[]) => { counters.https += 1; counters.network += 1;
    return httpsGet(...args); };
  try { return { result: await action(), counters }; }
  finally {
    for (const key of Object.keys(counters) as Array<keyof InvocationCounters>) {
      capturedBoundaryTotals[key] += counters[key];
    }
    worker.execute = workerExecute;
    PipelineStageExecutor.execute = stageExecute;
    AudioProviderRouter.getProvider = providerFactory;
    globalThis.fetch = fetchImplementation;
    httpModule.request = httpRequest;
    httpModule.get = httpGet;
    httpsModule.request = httpsRequest;
    httpsModule.get = httpsGet;
    restoreStorageConstruction();
    restoreMutationInvocation();
  }
}

function withLeaseIntegrity(lease: Record<string, unknown>) {
  const { integrity: unused, ...body } = lease;
  void unused;
  return {
    ...body,
    integrity: {
      algorithm: "stable-production-id-v1",
      fingerprint: stableProductionId("durable-lease-integrity", body),
    },
  };
}

function withClaimIntegrity(claim: Record<string, unknown>) {
  const { integrity: unused, ...body } = claim;
  void unused;
  return { ...body, integrity: { algorithm: "stable-production-id-v1",
    fingerprint: stableProductionId("durable-claim-integrity", body) } };
}

async function assertRejected(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  action: () => Promise<unknown>,
  options: { expectedJobs?: () => string | undefined } = {},
) {
  const before = await fixture.snapshot();
  const captured = await captureBoundaries(action);
  const result = captured.result as Awaited<ReturnType<typeof recoverQueuedExhaustedPipelineJobDrift>>;
  assert.equal(result.success, false, JSON.stringify(result));
  if (!result.success) {
    assert.equal(result.reasonCode, "PIPELINE_DRIFT_RECOVERY_REJECTED");
    assert.equal(result.writeFree, true);
    assert.equal(result.globallyQuiescent, false);
    assert.equal(result.writePerformed, false);
    assert.equal(result.recoveryAttempted, false);
  }
  await fixture.assertUnchanged(before, { jobs: options.expectedJobs?.() });
  assertZero(captured.counters);
  return captured;
}

async function prepareValidDrift(fixture: Awaited<ReturnType<typeof createFixture>>) {
  const chain = await fixture.createChain(3);
  const drift = await fixture.writeQueuedDrift(chain[2].failedJob);
  return { chain, drift };
}

async function writeSeedEvidence(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  status: "pending" | "running" | "completed" | "failed",
  total: number,
  historyCount = status === "running" ? Math.max(0, total - 1) : total,
) {
  const project = { id: `project-${fixture.projectSlug}`, slug: fixture.projectSlug,
    title: fixture.projectSlug, status: "audio", createdAt: anchor, updatedAt: anchor };
  await ProjectWriter.writeJSON(fixture.projectSlug, "project.json", project);
  const stages: ProductionStepKey[] = ["research", "script", "scenes", "visuals",
    "animation", "video", "audio", "assembly", "thumbnail", "seo", "youtube", "export"];
  const packages = Object.fromEntries(stages.map((key) => [key, {
    key, status: key === stage ? status : "pending", fileName: `${key}.json`,
    ...(key === stage ? { attempts: { total, retry: Math.max(0, total - 1) },
      updatedAt: anchor, ...(status === "failed" ? { error: "CONTROLLED_STAGE_FAILURE" } : {}) } : {}),
  }]));
  await ProjectWriter.writeJSON(fixture.projectSlug, "manifest.json", {
    project, projectId: project.id, slug: fixture.projectSlug, version: 1,
    packages, createdAt: anchor, updatedAt: anchor,
  });
  const events = Array.from({ length: historyCount }, (_, index) => ({
    id: `${fixture.projectSlug}-audio-seed-${index}`,
    jobId: `${fixture.projectSlug}-audio`, stage, status:
      (index === historyCount - 1 && status === "completed" ? "completed" : "failed") as
        "completed" | "failed",
    jobCreatedAt: anchor, jobUpdatedAt: anchor, recordedAt: anchor,
    errorCode: "CONTROLLED_STAGE_FAILURE",
  }));
  await fixture.writeHistory(events);
  await fs.rm(path.join(fixture.projectFolder, "pipeline-jobs.json"), { force: true });
}

async function manifestSeedEvidence() {
  for (const [name, status, total, expected] of [
    ["pending", "pending", 0, 0],
    ["first", "completed", 1, 0],
    ["second", "completed", 2, 1],
    ["third", "failed", 3, 2],
  ] as const) {
    await test(`Manifest seed ${name}: total ${total} maps to index ${expected}`, async () => {
      await withFixture(`manifest-seed-${name}`, async (fixture) => {
        await writeSeedEvidence(fixture, status, total);
        const jobs = await PipelineJobManager.listJobs(fixture.projectSlug);
        assert.equal(jobs.jobs.find((job) => job.stage === stage)?.attempts, expected);
      });
    });
  }
  await test("Manifest seed rejects malformed total and history mismatch", async () => {
    await withFixture("manifest-seed-invalid", async (fixture) => {
      await writeSeedEvidence(fixture, "failed", 2, 1);
      await assert.rejects(() => PipelineJobManager.listJobs(fixture.projectSlug),
        /PIPELINE_MANIFEST_ATTEMPT_EVIDENCE_MISMATCH/);
      await writeSeedEvidence(fixture, "failed", Number.NaN, 0);
      await assert.rejects(() => PipelineJobManager.listJobs(fixture.projectSlug),
        /PIPELINE_MANIFEST_ATTEMPT_TOTAL_INVALID/);
    });
  });
  await test("Manifest seed rejects total/durable-lineage mismatch", async () => {
    await withFixture("manifest-seed-durable-mismatch", async (fixture) => {
      await fixture.createChain(3);
      await writeSeedEvidence(fixture, "failed", 2, 2);
      await assert.rejects(() => PipelineJobManager.listJobs(fixture.projectSlug),
        /PIPELINE_MANIFEST_DURABLE_ATTEMPT_EVIDENCE_MISMATCH/);
    });
  });
  await test("Manifest seed concurrent child processes commit one current seed", async () => {
    await withFixture("manifest-seed-child-race", async (fixture) => {
      await writeSeedEvidence(fixture, "pending", 0);
      const left = spawnLockChild(fixture,
        path.join(fixture.runtimeRoot, "seed-left-attempted"), "seed");
      const right = spawnLockChild(fixture,
        path.join(fixture.runtimeRoot, "seed-right-attempted"), "seed");
      const [leftResult, rightResult] = await Promise.all([left.completed, right.completed]);
      for (const result of [leftResult, rightResult]) {
        assert.equal(result.code, 0, result.stderr);
        assert.deepEqual(JSON.parse(result.stdout), { decision: "seed-observed", jobs: 12 });
      }
      const jobs = await PipelineJobManager.listJobsReadOnly(fixture.projectSlug);
      assert.equal(jobs.jobs.length, 12);
      assert.equal(new Set(jobs.jobs.map((job) => job.id)).size, 12);
      for (const remainder of [".pipeline-jobs.lock", ".pipeline-jobs.lock-gate"]) {
        await assert.rejects(fs.access(path.join(fixture.projectFolder, remainder)));
      }
    });
  });
  await test("Persisted prior-lineage material-field poisoning rejects before construction", async () => {
    type Mutable = Record<string, unknown>;
    const nested = (value: Mutable, key: string) => value[key] as Mutable;
    const poisoners: Array<{ name: string; kind: "reservation" | "record" | "claim" | "attempt";
      poison(value: Mutable): void }> = [
      { name: "reservation.schemaVersion", kind: "reservation",
        poison: (value) => { value.schemaVersion = "99"; } },
      { name: "reservation.identityFingerprint", kind: "reservation",
        poison: (value) => { nested(value, "identity").identityFingerprint = "poison"; } },
      { name: "reservation.projectSlug", kind: "reservation",
        poison: (value) => { nested(value, "identity").projectSlug = "poison"; } },
      { name: "reservation.stage", kind: "reservation",
        poison: (value) => { nested(value, "identity").stage = "video"; } },
      { name: "reservation.operation", kind: "reservation",
        poison: (value) => { nested(value, "identity").operation = "pipeline.stage.resume"; } },
      { name: "reservation.requestId", kind: "reservation",
        poison: (value) => { nested(value, "identity").requestId = "poison"; } },
      { name: "reservation.idempotencyKey", kind: "reservation",
        poison: (value) => { nested(value, "identity").idempotencyKey = "poison"; } },
      { name: "reservation.executionFingerprint", kind: "reservation",
        poison: (value) => { nested(value, "identity").executionFingerprint = "poison"; } },
      { name: "reservation.attempt", kind: "reservation",
        poison: (value) => { value.attempt = 2; } },
      { name: "reservation.maxAttempts", kind: "reservation",
        poison: (value) => { value.maxAttempts = 4; } },
      { name: "record.schemaVersion", kind: "record",
        poison: (value) => { value.schemaVersion = "99"; } },
      { name: "record.storageVersion", kind: "record",
        poison: (value) => { value.storageVersion = "99"; } },
      { name: "record.projectSlug", kind: "record",
        poison: (value) => { value.projectSlug = "poison"; } },
      { name: "record.stage", kind: "record", poison: (value) => { value.stage = "video"; } },
      { name: "record.recordId", kind: "record", poison: (value) => { value.recordId = "poison"; } },
      { name: "record.identityFingerprint", kind: "record",
        poison: (value) => { value.identityFingerprint = "poison"; } },
      { name: "record.requestId", kind: "record", poison: (value) => { value.requestId = "poison"; } },
      { name: "record.idempotencyKey", kind: "record",
        poison: (value) => { value.idempotencyKey = "poison"; } },
      { name: "record.executionFingerprint", kind: "record",
        poison: (value) => { value.executionFingerprint = "poison"; } },
      { name: "record.operation", kind: "record",
        poison: (value) => { value.operation = "pipeline.stage.resume"; } },
      { name: "record.attempt", kind: "record", poison: (value) => { value.attempt = 2; } },
      { name: "record.recordVersion", kind: "record",
        poison: (value) => { value.recordVersion = 99; } },
      { name: "record.integrityFingerprint", kind: "record",
        poison: (value) => { nested(value, "integrity").fingerprint = "poison"; } },
      { name: "record.leaseId", kind: "record", poison: (value) => {
        const lease = nested(value, "durableLease");
        nested(lease, "identity").leaseId = "poison";
        value.durableLease = withLeaseIntegrity(lease);
      } },
      { name: "record.leaseRecordId", kind: "record", poison: (value) => {
        const lease = nested(value, "durableLease");
        nested(lease, "identity").recordId = "poison";
        value.durableLease = withLeaseIntegrity(lease);
      } },
      { name: "record.leaseWorkerId", kind: "record", poison: (value) => {
        const lease = nested(value, "durableLease");
        nested(lease, "identity").workerId = "poison";
        value.durableLease = withLeaseIntegrity(lease);
      } },
      ...(["claimId", "recordId", "reservationId", "requestId", "idempotencyKey",
        "operation", "executionFingerprint", "workerId", "workerSessionId", "leaseId"] as const)
        .map((field) => ({ name: `claim.${field}`, kind: "claim" as const,
          poison: (value: Mutable) => {
            nested(value, "identity")[field] = "poison";
            Object.assign(value, withClaimIntegrity(value));
          } })),
      { name: "claim.schemaVersion", kind: "claim", poison: (value) => {
        value.schemaVersion = "99"; Object.assign(value, withClaimIntegrity(value));
      } },
      { name: "claim.claimVersion", kind: "claim", poison: (value) => {
        value.claimVersion = 99; Object.assign(value, withClaimIntegrity(value));
      } },
      { name: "claim.state", kind: "claim", poison: (value) => {
        value.state = "active"; delete value.abandonedAt;
        Object.assign(value, withClaimIntegrity(value));
      } },
      { name: "claim.integrity-fingerprint-only", kind: "claim", poison: (value) => {
        nested(value, "integrity").fingerprint = "poison";
      } },
      { name: "claim.payload-stale-fingerprint", kind: "claim", poison: (value) => {
        value.evidence = [...value.evidence as string[], "poison"];
      } },
      { name: "claim.payload-and-fingerprint-recomputed", kind: "claim", poison: (value) => {
        value.evidence = [...value.evidence as string[], "poison"];
        Object.assign(value, withClaimIntegrity(value));
      } },
      ...(["attemptId", "claimId", "recordId", "reservationId", "requestId",
        "idempotencyKey", "operation", "executionFingerprint", "workerId",
        "workerSessionId", "leaseId"] as const).map((field) => ({
          name: `attempt.${field}`, kind: "attempt" as const,
          poison: (value: Mutable) => {
            nested(value, "identity")[field] = "poison";
            Object.assign(value, buildProductionExecutionDurableAttemptIntegrity(
              value as unknown as ProductionExecutionDurableAttemptRecord));
          },
        })),
      { name: "attempt.schemaVersion", kind: "attempt", poison: (value) => {
        value.schemaVersion = "99";
        Object.assign(value, buildProductionExecutionDurableAttemptIntegrity(
          value as unknown as ProductionExecutionDurableAttemptRecord));
      } },
      { name: "attempt.attemptVersion", kind: "attempt", poison: (value) => {
        value.attemptVersion = 99;
        Object.assign(value, buildProductionExecutionDurableAttemptIntegrity(
          value as unknown as ProductionExecutionDurableAttemptRecord));
      } },
      { name: "attempt.state", kind: "attempt", poison: (value) => {
        value.state = "active";
        Object.assign(value, buildProductionExecutionDurableAttemptIntegrity(
          value as unknown as ProductionExecutionDurableAttemptRecord));
      } },
      { name: "attempt.integrity-fingerprint-only", kind: "attempt", poison: (value) => {
        nested(value, "integrity").fingerprint = "poison";
      } },
      { name: "attempt.payload-stale-fingerprint", kind: "attempt", poison: (value) => {
        value.evidence = [...value.evidence as string[], "poison"];
      } },
      { name: "attempt.payload-and-fingerprint-recomputed", kind: "attempt", poison: (value) => {
        value.evidence = [...value.evidence as string[], "poison"];
        Object.assign(value, buildProductionExecutionDurableAttemptIntegrity(
          value as unknown as ProductionExecutionDurableAttemptRecord));
      } },
    ];
    for (const [caseIndex, item] of poisoners.entries()) {
      await withFixture(`persisted-${caseIndex}`, async (fixture) => {
        const chain = await fixture.createChain(1);
        const prepared = await prepareFailedStageRetry(fixture.projectSlug, chain[0].failedJob.id);
        assert.equal(prepared.success, true, JSON.stringify(prepared));
        if (!prepared.success) return;
        const binding = prepared.admission.exactReconciledLineageBinding;
        const identity = prepared.admission.exactReconciledDurableLineageIdentity;
        const file = item.kind === "reservation"
          ? path.join(fixture.executionRoot, "reservations", `${binding.reservationId}.json`)
          : item.kind === "record"
            ? path.join(fixture.executionRoot, "idempotency",
              `${identity.recordId}-v${binding.recordVersion}.json`)
            : item.kind === "claim"
              ? path.join(fixture.executionRoot, "claims",
                `${identity.claimId}-v${binding.claimVersion}.json`)
              : path.join(fixture.executionRoot, "attempts",
                `${identity.attemptId}-v${binding.attemptVersion}.json`);
        const value = JSON.parse(await fs.readFile(file, "utf8")) as Mutable;
        item.poison(value);
        await fs.writeFile(file, JSON.stringify(value, null, 2), "utf8");
        const poisoned = await fixture.snapshot();
        const captured = await captureBoundaries(async () => {
          // A tampered on-disk durable record surfaces either as an admission
          // binding mismatch (a poisoned value the store contradicts) or as the
          // canonical corrupt-durable-lineage code (Sprint 129.30's established
          // public code for an unreadable/inconsistent terminal lineage) --
          // both are fail-closed rejections before any durable construction.
          await assert.rejects(() => withProductionAcceptanceRetryAdmission(
            prepared.admission, prepared.previousJob,
            () => prepareProductionPipelineExecution({
              projectSlug: fixture.projectSlug, stage, runType: "retry",
            })), (error: unknown) => {
              const code = (error as { reasonCode?: unknown }).reasonCode;
              return code === "PIPELINE_RETRY_EXECUTION_ADMISSION_FAILED" ||
                code === productionDurableAttemptLineageBindingInvalidCode;
            }, item.name);
        });
        admissionStorageConstructionCount += captured.counters.storage;
        assert.equal(captured.counters.storage, 0, item.name);
        assertZero(captured.counters);
        await fixture.assertUnchanged(poisoned);
      });
    }
    process.stdout.write(`PERSISTED_LINEAGE_MUTATION_CASES ${poisoners.length}\n`);
  });
}

async function hostileMatrix() {
  await test("Seven-stage store: six safe terminal stages permit exact audio recovery", async () => {
    await withFixture("seven-stage-store", async (fixture) => {
      for (const otherStage of ["research", "script", "scenes", "visuals", "animation",
        "video"] as const) {
        await fixture.executionFixture(0, true, otherStage);
      }
      await prepareValidDrift(fixture);
      const durableBefore = await fixture.durableTree();
      const result = await recoverQueuedExhaustedPipelineJobDrift(
        fixture.projectSlug,
        stage,
        { confirm: true },
      );
      assert.equal(result.success, true, JSON.stringify(result));
      if (result.success) {
        assert.equal(result.decision, "recovered");
        assert.equal(result.writeFree, false);
        assert.equal(result.mutationState, "committed-verified");
      }
      assert.deepEqual(await fixture.durableTree(), durableBefore);
    });
  });

  for (const name of ["active lease", "active claim", "non-terminal attempt"] as const) {
    await test(`Hostile matrix: ${name} -> PIPELINE_DRIFT_RECOVERY_REJECTED`, async () => {
      await withFixture(name.replaceAll(" ", "-"), async (fixture) => {
        const { chain } = await prepareValidDrift(fixture);
        const identity = chain[2].identity;
        const real = new ProductionExecutionFilePersistenceAdapter({
          trustedRootDirectory: fixture.executionRoot, createRootDirectory: false,
        });
        const adapter: ProductionExecutionPersistenceAdapter = {
          write: real.write.bind(real), listKeys: real.listKeys.bind(real),
          read: async (kind, key) => {
            const read = await real.read(kind, key);
            if (read.status !== "found") return read;
            if (name === "active lease" && kind === "idempotency" &&
              key.startsWith(`${identity.recordId}-v`)) {
              const value = structuredClone(read.value) as unknown as Record<string, unknown>;
              const lease = structuredClone(value.durableLease) as Record<string, unknown>;
              lease.status = "active"; delete lease.releasedAt;
              value.durableLease = withLeaseIntegrity(lease);
              return { ...read, value } as unknown as typeof read;
            }
            if (name === "active claim" && kind === "claim" &&
              key.startsWith(`${identity.claimId}-v`)) {
              const value = structuredClone(read.value) as unknown as Record<string, unknown>;
              value.state = "active"; delete value.abandonedAt;
              const { integrity: unused, ...body } = value; void unused;
              value.integrity = { algorithm: "stable-production-id-v1",
                fingerprint: stableProductionId("durable-claim-integrity", body) };
              return { ...read, value } as unknown as typeof read;
            }
            if (name === "non-terminal attempt" && kind === "attempt" &&
              key.startsWith(`${identity.attemptId}-v`)) {
              const value = structuredClone(read.value) as unknown as
                ProductionExecutionDurableAttemptRecord;
              value.state = "active"; delete value.finalizedAt;
              return { ...read,
                value: buildProductionExecutionDurableAttemptIntegrity(value) } as unknown as typeof read;
            }
            return read;
          },
        };
        await assertRejected(fixture, () => recoverQueuedExhaustedPipelineJobDrift(
          fixture.projectSlug, stage, { confirm: true }, { createAdapter: () => adapter },
        ));
      });
    });
  }

  await test("Non-target terminal authority hostile matrix rejects every isolated mutation", async () => {
    const mutations = [
      "orphan terminal claim", "orphan terminal attempt", "corrupt terminal record",
      "corrupt terminal claim", "corrupt terminal attempt", "wrong record-bound claim",
      "wrong lease-bound claim", "wrong claim-bound attempt", "duplicate reservation",
      "conflicting record", "duplicate claim", "conflicting attempt", "active authority",
      "non-terminal authority",
    ] as const;
    for (const [caseIndex, mutation] of mutations.entries()) {
      await withFixture(`non-target-${caseIndex}`, async (fixture) => {
        const nonAudio = [];
        for (const otherStage of ["research", "script", "scenes", "visuals", "animation",
          "video"] as const) nonAudio.push(await fixture.executionFixture(0, true, otherStage));
        await prepareValidDrift(fixture);
        const target = nonAudio[0].identity;
        const recordDirectory = path.join(fixture.executionRoot, "idempotency");
        const claimDirectory = path.join(fixture.executionRoot, "claims");
        const attemptDirectory = path.join(fixture.executionRoot, "attempts");
        const latest = async (directory: string, prefix: string) => {
          const files = (await fs.readdir(directory)).filter((file) =>
            file.startsWith(`${prefix}-v`) && file.endsWith(".json"))
            .sort((left, right) => Number(left.match(/-v(\d+)\.json$/)?.[1]) -
              Number(right.match(/-v(\d+)\.json$/)?.[1]));
          assert.ok(files.length > 0, `${mutation} fixture lineage missing`);
          return path.join(directory, files.at(-1)!);
        };
        const recordFile = await latest(recordDirectory, target.recordId);
        const claimFile = await latest(claimDirectory, target.claimId);
        const attemptFile = await latest(attemptDirectory, target.attemptId);
        const record = JSON.parse(await fs.readFile(recordFile, "utf8")) as Record<string, unknown>;
        const claim = JSON.parse(await fs.readFile(claimFile, "utf8")) as Record<string, unknown>;
        const attempt = JSON.parse(await fs.readFile(attemptFile, "utf8")) as Record<string, unknown>;
        const reservationFile = path.join(fixture.executionRoot, "reservations",
          `${String(record.identityFingerprint)}.json`);
        if (mutation === "orphan terminal claim") {
          const orphan = structuredClone(claim);
          (orphan.identity as Record<string, unknown>).claimId = "orphan-terminal-claim";
          const valid = withClaimIntegrity(orphan);
          await fs.writeFile(path.join(claimDirectory, "orphan-terminal-claim-v1.json"),
            JSON.stringify(valid, null, 2), "utf8");
        } else if (mutation === "orphan terminal attempt") {
          const orphan = structuredClone(attempt) as unknown as ProductionExecutionDurableAttemptRecord;
          orphan.identity.attemptId = "orphan-terminal-attempt";
          const valid = buildProductionExecutionDurableAttemptIntegrity(orphan);
          await fs.writeFile(path.join(attemptDirectory, "orphan-terminal-attempt-v1.json"),
            JSON.stringify(valid, null, 2), "utf8");
        } else if (mutation === "duplicate reservation") {
          await fs.copyFile(reservationFile, path.join(fixture.executionRoot, "reservations",
            "duplicate-reservation.json"));
        } else if (mutation === "corrupt terminal record") {
          (record.integrity as Record<string, unknown>).fingerprint = "corrupt";
          await fs.writeFile(recordFile, JSON.stringify(record, null, 2), "utf8");
        } else if (mutation === "corrupt terminal claim") {
          (claim.integrity as Record<string, unknown>).fingerprint = "corrupt";
          await fs.writeFile(claimFile, JSON.stringify(claim, null, 2), "utf8");
        } else if (mutation === "corrupt terminal attempt") {
          (attempt.integrity as Record<string, unknown>).fingerprint = "corrupt";
          await fs.writeFile(attemptFile, JSON.stringify(attempt, null, 2), "utf8");
        } else if (mutation === "conflicting record") {
          await fs.writeFile(path.join(recordDirectory, `${target.recordId}-v99.json`),
            JSON.stringify(record, null, 2), "utf8");
        } else if (mutation === "duplicate claim") {
          await fs.writeFile(path.join(claimDirectory, `${target.claimId}-v99.json`),
            JSON.stringify(claim, null, 2), "utf8");
        } else if (mutation === "active authority") {
          claim.state = "active"; delete claim.abandonedAt;
          await fs.writeFile(claimFile, JSON.stringify(withClaimIntegrity(claim), null, 2), "utf8");
        } else if (mutation === "non-terminal authority") {
          attempt.state = "active"; delete attempt.finalizedAt;
          const valid = buildProductionExecutionDurableAttemptIntegrity(
            attempt as unknown as ProductionExecutionDurableAttemptRecord);
          await fs.writeFile(attemptFile, JSON.stringify(valid, null, 2), "utf8");
        } else if (mutation === "wrong record-bound claim" ||
          mutation === "wrong lease-bound claim") {
          const identity = claim.identity as Record<string, unknown>;
          const field = mutation === "wrong record-bound claim" ? "recordId" : "leaseId";
          identity[field] = "foreign-binding";
          await fs.writeFile(claimFile, JSON.stringify(withClaimIntegrity(claim), null, 2), "utf8");
        } else {
          const identity = attempt.identity as Record<string, unknown>;
          identity[mutation === "wrong claim-bound attempt" ? "claimId" : "recordId"] =
            "foreign-binding";
          const valid = buildProductionExecutionDurableAttemptIntegrity(
            attempt as unknown as ProductionExecutionDurableAttemptRecord);
          await fs.writeFile(attemptFile, JSON.stringify(valid, null, 2), "utf8");
        }
        let writerInvocations = 0;
        const networkBefore = capturedBoundaryTotals.network;
        const captured = await assertRejected(fixture, () => recoverQueuedExhaustedPipelineJobDrift(
          fixture.projectSlug, stage, { confirm: true }, {
            beforeWriterInvocation: () => { writerInvocations += 1; },
          },
        ));
        assert.equal(writerInvocations, 0, mutation);
        assert.equal(captured.counters.lock, 0, mutation);
        assert.equal(captured.counters.gate, 0, mutation);
        assert.equal(captured.counters.quarantine, 0, mutation);
        assert.equal(captured.counters.network, 0, mutation);
        const networkDelta = capturedBoundaryTotals.network - networkBefore;
        assert.equal(networkDelta, 0, mutation);
        process.stdout.write(`GLOBAL_QUIESCENCE_CASE ${mutation} globallyQuiescent=false ` +
          `writePerformed=false writeFree=true recoveryAttempted=false writer=${writerInvocations} ` +
          `lock=${captured.counters.lock} gate=${captured.counters.gate} ` +
          `quarantine=${captured.counters.quarantine} ` +
          `provider=${captured.counters.provider} worker=${captured.counters.worker} ` +
          `stageDispatch=${captured.counters.stageDispatch} fetch=${captured.counters.fetch} ` +
          `http=${captured.counters.http} https=${captured.counters.https} ` +
          `network=${captured.counters.network} networkDelta=${networkDelta} ` +
          `durableBytes=identical\n`);
      });
    }
    process.stdout.write(`NON_TARGET_AUTHORITY_MUTATION_CASES ${mutations.length}\n`);
  });

  await test("Hostile matrix: newer competing record -> PIPELINE_DRIFT_RECOVERY_REJECTED", async () => {
    await withFixture("newer-record", async (fixture) => {
      const chain = await fixture.createChain(3);
      await fixture.writeQueuedDrift(chain[2].failedJob, 3);
      const directory = path.join(fixture.executionRoot, "idempotency");
      const files = (await fs.readdir(directory)).filter((file) => file.endsWith(".json")).sort();
      assert.ok(files.length > 0);
      const canonical = JSON.parse(await fs.readFile(
        path.join(directory, files.at(-1)!), "utf8",
      ));
      const competingRecordId = `newer-${canonical.recordId}`;
      const competing = structuredClone(canonical);
      competing.recordId = competingRecordId;
      competing.recordVersion = 1;
      competing.integrity.version = 1;
      competing.durableLease.identity.recordId = competingRecordId;
      competing.durableLease = withLeaseIntegrity(competing.durableLease);
      const adapter = new ProductionExecutionFilePersistenceAdapter({
        trustedRootDirectory: fixture.executionRoot,
        createRootDirectory: false,
      });
      assert.equal(new AdapterBackedProductionExecutionDurableStorage(adapter)
        .validateRecord(competing).ok, true);
      const write = await adapter.write(
        "idempotency", `${competingRecordId}-v1`, competing,
      );
      assert.equal(write.ok && write.status, "created");
      await assertRejected(fixture, () => recoverQueuedExhaustedPipelineJobDrift(
        fixture.projectSlug, stage, { confirm: true },
      ));
    });
  });

  await test("Hostile matrix: wrong project slug -> PIPELINE_DRIFT_RECOVERY_REJECTED", async () => {
    await withFixture("wrong-project", async (fixture) => {
      await prepareValidDrift(fixture);
      await assertRejected(fixture, () => recoverQueuedExhaustedPipelineJobDrift(
        "wrong-project-slug", stage, { confirm: true },
      ));
    });
  });

  await test("Hostile matrix: wrong stage -> PIPELINE_DRIFT_RECOVERY_REJECTED", async () => {
    await withFixture("wrong-stage", async (fixture) => {
      await prepareValidDrift(fixture);
      await assertRejected(fixture, () => recoverQueuedExhaustedPipelineJobDrift(
        fixture.projectSlug, "export", { confirm: true },
      ));
    });
  });

  await test("Hostile matrix: job attempts mismatch -> PIPELINE_DRIFT_RECOVERY_REJECTED", async () => {
    await withFixture("attempts-mismatch", async (fixture) => {
      const { chain } = await prepareValidDrift(fixture);
      await fixture.writeQueuedDrift(chain[2].failedJob, 4);
      await assertRejected(fixture, () => recoverQueuedExhaustedPipelineJobDrift(
        fixture.projectSlug, stage, { confirm: true },
      ));
    });
  });

  await test("Hostile matrix: missing matching history failure -> PIPELINE_DRIFT_RECOVERY_REJECTED", async () => {
    await withFixture("missing-history", async (fixture) => {
      await prepareValidDrift(fixture);
      await fixture.writeHistory([]);
      await assertRejected(fixture, () => recoverQueuedExhaustedPipelineJobDrift(
        fixture.projectSlug, stage, { confirm: true },
      ));
    });
  });

  await test("Hostile matrix: compare-and-write race -> PIPELINE_DRIFT_RECOVERY_REJECTED", async () => {
    await withFixture("cas-race", async (fixture) => {
      const { drift } = await prepareValidDrift(fixture);
      let competingRaw: string | undefined;
      await assertRejected(fixture, () => recoverQueuedExhaustedPipelineJobDrift(
        fixture.projectSlug, stage, { confirm: true }, {
          beforeCompareAndWrite: async () => {
            competingRaw = await fixture.replaceJobBytesWithoutLockForRace({
              ...drift, updatedAt: "2026-07-02T01:00:00.000Z",
            });
          },
        },
      ), { expectedJobs: () => competingRaw });
    });
  });

  await test("Hostile matrix: persistence read failure -> PIPELINE_DRIFT_RECOVERY_REJECTED", async () => {
    await withFixture("read-failure", async (fixture) => {
      await prepareValidDrift(fixture);
      await assertRejected(fixture, () => recoverQueuedExhaustedPipelineJobDrift(
        fixture.projectSlug, stage, { confirm: true }, {
          createAdapter: (root) => {
            const real = new ProductionExecutionFilePersistenceAdapter({
              trustedRootDirectory: root,
              createRootDirectory: false,
            });
            return {
              write: real.write.bind(real),
              read: real.read.bind(real),
              listKeys: async (kind) => kind === "idempotency"
                ? { ok: false, status: "failed", kind, errorCode: "PERSISTENCE_READ_FAILED" }
                : real.listKeys(kind),
            } as ProductionExecutionPersistenceAdapter;
          },
        },
      ));
    });
  });

  await test("Recovery mutation state: writer throw has unknown commit state", async () => {
    await withFixture("write-failure", async (fixture) => {
      await prepareValidDrift(fixture);
      const before = await fixture.snapshot();
      const captured = await captureBoundaries(() => recoverQueuedExhaustedPipelineJobDrift(
        fixture.projectSlug, stage, { confirm: true }, {
          writeJobList: async () => { throw new Error("injected persistence write failure"); },
        },
      ));
      assert.equal(captured.result.success, false);
      if (!captured.result.success) {
        assert.equal(captured.result.reasonCode,
          "PIPELINE_DRIFT_RECOVERY_COMMIT_VERIFICATION_FAILED");
        assert.equal(captured.result.writeFree, false);
        assert.equal(captured.result.mutationState, "committed-unverified");
      }
      await fixture.assertUnchanged(before);
      assertZero(captured.counters);
    });
  });
  await test("Recovery mutation state: writer throw plus readback throw stays uncertain", async () => {
    await withFixture("writer-and-readback-failure", async (fixture) => {
      await prepareValidDrift(fixture);
      const before = await fixture.snapshot();
      const captured = await captureBoundaries(() => recoverQueuedExhaustedPipelineJobDrift(
        fixture.projectSlug, stage, { confirm: true }, {
          writeJobList: async () => { throw new Error("writer interruption"); },
          readJobListAfterWriteFailure: async () => { throw new Error("readback interruption"); },
        },
      ));
      assert.equal(captured.result.success, false);
      if (!captured.result.success) {
        assert.equal(captured.result.reasonCode,
          "PIPELINE_DRIFT_RECOVERY_COMMIT_VERIFICATION_FAILED");
        assert.equal(captured.result.writeFree, false);
        assert.equal(captured.result.mutationState, "committed-unverified");
      }
      await fixture.assertUnchanged(before);
      assertZero(captured.counters);
    });
  });

  await test("Recovery mutation state: committed replacement plus throw is non-write-free", async () => {
    await withFixture("post-commit-throw", async (fixture) => {
      await prepareValidDrift(fixture);
      const result = await recoverQueuedExhaustedPipelineJobDrift(
        fixture.projectSlug, stage, { confirm: true }, {
          writeJobList: async (projectSlug, jobs) => {
            await PipelineJobManager.writeJobListUnderLock(projectSlug, jobs);
            throw new Error("injected error after atomic replacement");
          },
        },
      );
      assert.equal(result.success, false, JSON.stringify(result));
      if (!result.success) {
        assert.equal(result.reasonCode,
          "PIPELINE_DRIFT_RECOVERY_COMMIT_VERIFICATION_FAILED");
        assert.equal(result.writeFree, false);
        assert.equal(result.mutationState, "committed-unverified");
      }
    });
  });

  await test("Recovery mutation state: committed mismatched readback is non-write-free", async () => {
    await withFixture("post-commit-mismatch", async (fixture) => {
      await prepareValidDrift(fixture);
      const result = await recoverQueuedExhaustedPipelineJobDrift(
        fixture.projectSlug, stage, { confirm: true }, {
          writeJobList: async (projectSlug, jobs) => {
            const mismatched = { ...jobs, jobs: jobs.jobs.map((job) =>
              job.stage === stage ? { ...job, updatedAt: "2026-07-03T00:00:00.000Z" } : job) };
            await PipelineJobManager.writeJobListUnderLock(projectSlug, mismatched);
          },
        },
      );
      assert.equal(result.success, false, JSON.stringify(result));
      if (!result.success) {
        assert.equal(result.reasonCode,
          "PIPELINE_DRIFT_RECOVERY_COMMIT_VERIFICATION_FAILED");
        assert.equal(result.writeFree, false);
        assert.equal(result.mutationState, "committed-unverified");
      }
    });
  });

  await test("Recovery mutation state: committed replacement plus readback throw is non-write-free", async () => {
    await withFixture("post-commit-readback-throw", async (fixture) => {
      await prepareValidDrift(fixture);
      const result = await recoverQueuedExhaustedPipelineJobDrift(
        fixture.projectSlug, stage, { confirm: true }, {
          afterReplacementCommitted: async () => {
            throw new Error("injected readback failure");
          },
        },
      );
      assert.equal(result.success, false, JSON.stringify(result));
      if (!result.success) {
        assert.equal(result.reasonCode,
          "PIPELINE_DRIFT_RECOVERY_COMMIT_VERIFICATION_FAILED");
        assert.equal(result.writeFree, false);
        assert.equal(result.mutationState, "committed-unverified");
      }
    });
  });

  for (const target of ["lock", "gate"] as const) {
    await test(`Recovery mutation state: verified write plus ${target} release failure`, async () => {
      await withFixture(`post-commit-${target}-release`, async (fixture) => {
        await prepareValidDrift(fixture);
        const restore = installCanonicalReleaseFailureTestHook(target, target === "gate" ? 2 : 1);
        let result: Awaited<ReturnType<typeof recoverQueuedExhaustedPipelineJobDrift>>;
        try {
          result = await recoverQueuedExhaustedPipelineJobDrift(
            fixture.projectSlug, stage, { confirm: true },
          );
        } finally { restore(); }
        assert.equal(result.success, false, JSON.stringify(result));
        if (!result.success) {
          assert.equal(result.reasonCode, "PIPELINE_DRIFT_RECOVERY_COMMIT_VERIFICATION_FAILED");
          assert.equal(result.writeFree, false);
          assert.equal(result.mutationState, "committed-unverified");
          assert.match(result.evidence[0], /verified-but-lock-or-gate-release-failed/);
        }
        const recovered = await PipelineJobManager.getJobForStageReadOnly(
          fixture.projectSlug, stage,
        );
        assert.equal(recovered?.status, "failed");
        assert.equal(recovered?.attempts, 2);
        await PipelineJobManager.withProjectLock(fixture.projectSlug, async () => {
          const jobs = await PipelineJobManager.listJobsReadOnly(fixture.projectSlug);
          await PipelineJobManager.writeJobListUnderLock(fixture.projectSlug, {
            ...jobs, updatedAt: "2026-07-05T00:00:00.000Z",
          });
        }, `${fixture.projectSlug}-${stage}`);
        for (const remainder of [".pipeline-jobs.lock", ".pipeline-jobs.lock-gate"]) {
          await assert.rejects(fs.access(path.join(fixture.projectFolder, remainder)));
        }
      });
    });
  }

  await test("Hostile matrix: ambiguous durable chain -> PIPELINE_DRIFT_RECOVERY_REJECTED", async () => {
    await withFixture("ambiguous-chain", async (fixture) => {
      await prepareValidDrift(fixture);
      const directory = path.join(fixture.executionRoot, "idempotency");
      const files = (await fs.readdir(directory)).filter((file) => file.endsWith(".json")).sort();
      assert.ok(files.length > 0);
      const raw = await fs.readFile(path.join(directory, files.at(-1)!), "utf8");
      await fs.writeFile(path.join(directory, "ambiguous-durable-chain-v99.json"), raw, "utf8");
      await assertRejected(fixture, () => recoverQueuedExhaustedPipelineJobDrift(
        fixture.projectSlug, stage, { confirm: true },
      ));
    });
  });

  await test("Hostile matrix: missing exact durable chain -> PIPELINE_DRIFT_RECOVERY_REJECTED", async () => {
    await withFixture("missing-chain", async (fixture) => {
      const { chain } = await prepareValidDrift(fixture);
      const directory = path.join(fixture.executionRoot, "idempotency");
      for (const file of await fs.readdir(directory)) {
        if (file.startsWith(`${chain[2].identity.recordId}-v`) && file.endsWith(".json")) {
          await fs.rm(path.join(directory, file));
        }
      }
      await assertRejected(fixture, () => recoverQueuedExhaustedPipelineJobDrift(
        fixture.projectSlug, stage, { confirm: true },
      ));
    });
  });

  await test("Hostile matrix: non-exhausted attempts -> PIPELINE_DRIFT_RECOVERY_REJECTED", async () => {
    await withFixture("non-exhausted", async (fixture) => {
      const chain = await fixture.createChain(2);
      await fixture.writeQueuedDrift(chain[1].failedJob, 2);
      await assertRejected(fixture, () => recoverQueuedExhaustedPipelineJobDrift(
        fixture.projectSlug, stage, { confirm: true },
      ));
    });
  });

  await test("Hostile matrix: idempotent replay is write-free", async () => {
    await withFixture("idempotent-replay", async (fixture) => {
      const chain = await fixture.createChain(3);
      await fixture.writeJob({ ...chain[2].failedJob, attempts: 2 });
      const before = await fixture.snapshot();
      const captured = await captureBoundaries(() => recoverQueuedExhaustedPipelineJobDrift(
        fixture.projectSlug, stage, { confirm: true },
      ));
      const result = captured.result;
      assert.equal(result.success, true, JSON.stringify(result));
      if (result.success) {
        assert.equal(result.decision, "replayed");
        assert.equal(result.writeFree, true);
      }
      await fixture.assertUnchanged(before);
      assertZero(captured.counters);
    });
  });
}

async function retryAndRecoveryEvidence() {
  await test("Scenario A: failed attempts=2 rejects byte-identically before mutation", async () => {
    await withFixture("scenario-a", async (fixture) => {
      const chain = await fixture.createChain(3);
      await fixture.writeJob(chain[2].failedJob);
      const before = await fixture.snapshot();
      const result = await prepareFailedStageRetry(fixture.projectSlug, chain[2].failedJob.id);
      assert.equal(result.success, false, JSON.stringify(result));
      assert.equal(result.reasonCode, "PIPELINE_RETRY_MAX_ATTEMPTS_EXCEEDED");
      await fixture.assertUnchanged(before);
    });
  });

  await test("Scenario B: attempts=0 reconciles ordinal 1 and admits ordinal 2", async () => {
    await withFixture("scenario-b", async (fixture) => {
      const chain = await fixture.createChain(1);
      const prepared = await prepareFailedStageRetry(fixture.projectSlug, chain[0].failedJob.id);
      assert.equal(prepared.success, true, JSON.stringify(prepared));
      if (!prepared.success) return;
      assert.equal(prepared.previousJob.attempts, 0);
      assert.equal(prepared.job.attempts, 1);
      assert.equal(prepared.admission.currentDurableOrdinal, 1);
      assert.equal(prepared.admission.admittedDurableOrdinal, 2);
      assert.equal(prepared.admission.admittedJobAttemptIndex, 1);
      let workerHandlerCalls = 0;
      const execution = await withProductionAcceptanceRetryAdmission(
        prepared.admission, prepared.previousJob, async () => {
          const admitted = await prepareProductionPipelineExecution({
            projectSlug: fixture.projectSlug, stage, runType: "retry",
          });
          assert.equal(admitted.request.coordinator.attempt.attemptId,
            prepared.admission.admittedDurableLineageIdentity.attemptId);
          return new ProductionExecutionWorkerExecutionService(admitted.executionAdapter)
            .execute(admitted.request, async () => {
              workerHandlerCalls += 1;
              throw controlledFailure();
            }, { isCancellationRequested: () => false });
        },
      );
      assert.equal(execution.status, "failed");
      assert.equal(workerHandlerCalls, 1);
      const admittedRecord = await new AdapterBackedProductionExecutionDurableStorage(
        new ProductionExecutionFilePersistenceAdapter({
          trustedRootDirectory: fixture.executionRoot, createRootDirectory: false,
        }),
      ).read(prepared.admission.admittedDurableLineageIdentity.recordId);
      assert.equal(admittedRecord.record?.attempt, 2);
    });
  });

  await test("Scenario C: attempts=1 reconciles ordinal 2 and admits final ordinal 3", async () => {
    await withFixture("scenario-c", async (fixture) => {
      const chain = await fixture.createChain(2);
      const before = await fixture.durableTree();
      const prepared = await prepareFailedStageRetry(fixture.projectSlug, chain[1].failedJob.id);
      assert.equal(prepared.success, true, JSON.stringify(prepared));
      if (!prepared.success) return;
      assert.equal(prepared.previousJob.attempts, 1);
      assert.equal(prepared.job.attempts, 2);
      assert.equal(prepared.admission.currentDurableOrdinal, 2);
      assert.equal(prepared.admission.admittedDurableOrdinal, 3);
      assert.equal(prepared.admission.admittedDurableLineageIdentity.core.attemptNumber, 2);
      assert.deepEqual(await fixture.durableTree(), before);
      let workerHandlerCalls = 0;
      const execution = await withProductionAcceptanceRetryAdmission(
        prepared.admission, prepared.previousJob, async () => {
          const admitted = await prepareProductionPipelineExecution({
            projectSlug: fixture.projectSlug, stage, runType: "retry",
          });
          assert.equal(admitted.request.coordinator.attempt.attemptId,
            prepared.admission.admittedDurableLineageIdentity.attemptId);
          return new ProductionExecutionWorkerExecutionService(admitted.executionAdapter)
            .execute(admitted.request, async () => {
              workerHandlerCalls += 1;
              throw controlledFailure();
            }, { isCancellationRequested: () => false });
        },
      );
      assert.equal(execution.status, "failed");
      assert.equal(workerHandlerCalls, 1);
      const admittedRecord = await new AdapterBackedProductionExecutionDurableStorage(
        new ProductionExecutionFilePersistenceAdapter({
          trustedRootDirectory: fixture.executionRoot, createRootDirectory: false,
        }),
      ).read(prepared.admission.admittedDurableLineageIdentity.recordId);
      assert.equal(admittedRecord.record?.attempt, 3);
      const ordinal4 = buildProductionPipelineExecutionIdentity(
        { projectSlug: fixture.projectSlug, stage, runType: "retry" },
        { id: chain[1].failedJob.id, attempts: 3 },
      );
      assert.ok(!(await fixture.durableTree()).some((entry) =>
        entry.includes(ordinal4.recordId) || entry.includes(ordinal4.attemptId)));
    });
  });

  await test("Scenario D: attempts=3 and attempts>3 fail closed before mutation", async () => {
    for (const attempts of [3, 4, 9]) {
      await withFixture(`scenario-d-${attempts}`, async (fixture) => {
        const chain = await fixture.createChain(3);
        await fixture.writeJob({ ...chain[2].failedJob, attempts });
        const before = await fixture.snapshot();
        const result = await prepareFailedStageRetry(fixture.projectSlug, chain[2].failedJob.id);
        assert.equal(result.success, false);
        assert.equal(result.reasonCode, "PIPELINE_RETRY_MAX_ATTEMPTS_EXCEEDED");
        await fixture.assertUnchanged(before);
      });
    }
  });

  await test("Authorized recovery changes only PipelineJob and replay is write-free", async () => {
    await withFixture("authorized-recovery", async (fixture) => {
      await prepareValidDrift(fixture);
      const before = await fixture.snapshot();
      const captured = await captureBoundaries(() => recoverQueuedExhaustedPipelineJobDrift(
        fixture.projectSlug, stage, { confirm: true, now: () => "2026-07-02T02:00:00.000Z" },
      ));
      const recovered = captured.result;
      assert.equal(recovered.success, true, JSON.stringify(recovered));
      if (recovered.success) {
        assert.equal(recovered.decision, "recovered");
        assert.equal(recovered.job.status, "failed");
        assert.equal(recovered.job.attempts, 2);
        assert.equal(recovered.job.error, "CONTROLLED_STAGE_FAILURE");
      }
      const after = await fixture.snapshot();
      assert.notEqual(after.jobs, before.jobs);
      assert.equal(after.manifest, before.manifest);
      assert.equal(after.history, before.history);
      assert.deepEqual(after.durable, before.durable);
      const replayBefore = await fixture.snapshot();
      const replayCaptured = await captureBoundaries(() => recoverQueuedExhaustedPipelineJobDrift(
        fixture.projectSlug, stage, { confirm: true },
      ));
      const replay = replayCaptured.result;
      assert.equal(replay.success, true);
      if (replay.success) assert.equal(replay.decision, "replayed");
      await fixture.assertUnchanged(replayBefore);
      assertZero(captured.counters);
      assertZero(replayCaptured.counters);
    });
  });

  await test("Cross-process child CAS cannot enter the post-comparison window while recovery owns lock", async () => {
    await withFixture("cross-process-lock", async (fixture) => {
      await prepareValidDrift(fixture);
      const attemptedFile = path.join(fixture.runtimeRoot, "child-lock-attempted");
      let childRun: ReturnType<typeof spawnLockChild> | undefined;
      const recovered = await recoverQueuedExhaustedPipelineJobDrift(
        fixture.projectSlug, stage, { confirm: true }, {
          beforeCompareAndWrite: async () => {
            childRun = spawnLockChild(fixture, attemptedFile);
            await waitForFile(attemptedFile);
            await fs.access(path.join(fixture.projectFolder, ".pipeline-jobs.lock", "owner.json"));
          },
        },
      );
      if (!recovered.success && childRun) {
        const diagnostic = await childRun.completed;
        assert.fail(JSON.stringify({ recovered, diagnostic }));
      }
      assert.equal(recovered.success, true, JSON.stringify(recovered));
      assert.ok(childRun);
      const child = await childRun.completed;
      assert.equal(child.code, 0, child.stderr);
      assert.equal(child.stderr, "");
      assert.deepEqual(JSON.parse(child.stdout), { decision: "conflict" });
      await assert.rejects(fs.access(path.join(fixture.projectFolder, ".pipeline-jobs.lock")));
    });
  });
  await test("Cross-process competing canonical writer wins and recovery preserves its bytes", async () => {
    await withFixture("cross-process-writer-first", async (fixture) => {
      await prepareValidDrift(fixture);
      const attemptedFile = path.join(fixture.runtimeRoot, "child-writer-first-attempted");
      let competingBytes = "";
      let childResult: Awaited<ReturnType<typeof spawnLockChild>["completed"]> | undefined;
      const recovered = await recoverQueuedExhaustedPipelineJobDrift(
        fixture.projectSlug,
        stage,
        { confirm: true },
        { afterInitialClassification: async () => {
          const childRun = spawnLockChild(fixture, attemptedFile);
          childResult = await childRun.completed;
          competingBytes = await fs.readFile(
            path.join(fixture.projectFolder, "pipeline-jobs.json"),
            "utf8",
          );
        } },
      );
      assert.equal(childResult?.code, 0, childResult?.stderr);
      assert.deepEqual(JSON.parse(childResult?.stdout ?? "null"),
        { decision: "competing-write-committed" });
      assert.equal(recovered.success, false, JSON.stringify(recovered));
      assert.equal(await fs.readFile(path.join(fixture.projectFolder, "pipeline-jobs.json"), "utf8"),
        competingBytes);
      await assert.rejects(fs.access(path.join(fixture.projectFolder, ".pipeline-jobs.lock")));
    });
  });
  await test("Lock PID reuse evidence treats same PID with different start as stale", async () => {
    await withFixture("lock-pid-reuse", async (fixture) => {
      const actualStart = await readCanonicalProcessStartEpochMs(process.pid);
      assert.ok(actualStart !== null && Number.isSafeInteger(actualStart));
      const lockDirectory = path.join(fixture.projectFolder, ".pipeline-jobs.lock");
      await fs.mkdir(lockDirectory);
      await fs.writeFile(path.join(lockDirectory, "owner.json"), `${JSON.stringify({
        schemaVersion: "2", projectSlug: fixture.projectSlug,
        projectFolder: fixture.projectFolder,
        jobId: `${fixture.projectSlug}-${stage}`, ownerNonce: "pid-reuse-fixture",
        pid: process.pid, processStartEpochMs: 1, acquiredAt: "2000-01-01T00:00:00.000Z",
      })}\n`, "utf8");
      const old = new Date(Date.now() - 60_000);
      await fs.utimes(lockDirectory, old, old);
      let entered = false;
      await PipelineJobManager.withProjectLock(fixture.projectSlug, async () => {
        entered = true;
      }, `${fixture.projectSlug}-${stage}`);
      assert.equal(entered, true);
      await assert.rejects(fs.access(lockDirectory));
    });
  });
  await test("Lock owner publication failure cleans exact ownerless directory", async () => {
    await withFixture("lock-owner-publication-failure", async (fixture) => {
      await verifyCanonicalOwnerPublicationFailureCleanup(
        fixture.projectSlug,
        `${fixture.projectSlug}-${stage}`,
      );
      for (const remainder of [".pipeline-jobs.lock", ".pipeline-jobs.lock-gate"]) {
        await assert.rejects(fs.access(path.join(fixture.projectFolder, remainder)));
      }
    });
  });
  await test("Replacement lock with copied owner bytes survives acquired-lock release", async () => {
    await withFixture("replacement-lock-release", async (fixture) => {
      const canonical = path.join(fixture.projectFolder, ".pipeline-jobs.lock");
      const preserved = path.join(fixture.projectFolder, ".pipeline-jobs.acquired-preserved");
      let copiedOwner = "";
      await assert.rejects(
        () => PipelineJobManager.withProjectLock(fixture.projectSlug, async () => {
          copiedOwner = await fs.readFile(path.join(canonical, "owner.json"), "utf8");
          await fs.rename(canonical, preserved);
          await fs.mkdir(canonical);
          await fs.writeFile(path.join(canonical, "owner.json"), copiedOwner, "utf8");
        }, `${fixture.projectSlug}-${stage}`),
        /PIPELINE_JOB_MUTATION_LOCK_OWNERSHIP_CHANGED/,
      );
      assert.equal(await fs.readFile(path.join(canonical, "owner.json"), "utf8"), copiedOwner);
      assert.equal(await fs.readFile(path.join(preserved, "owner.json"), "utf8"), copiedOwner);
      await fs.rm(canonical, { recursive: true });
      await fs.rm(preserved, { recursive: true });
      await assert.rejects(fs.access(path.join(fixture.projectFolder, ".pipeline-jobs.lock-gate")));
    });
  });
  await test("Real child stale-remover re-reads and preserves live owner B", async () => {
    await withFixture("stale-remover-live-owner", async (fixture) => {
      const lockDirectory = path.join(fixture.projectFolder, ".pipeline-jobs.lock");
      await fs.mkdir(lockDirectory);
      await fs.writeFile(path.join(lockDirectory, "owner.json"), `${JSON.stringify({
        schemaVersion: "2", projectSlug: fixture.projectSlug,
        projectFolder: fixture.projectFolder, jobId: `${fixture.projectSlug}-${stage}`,
        ownerNonce: "stale-owner-a", pid: 2_147_483_000,
        processStartEpochMs: 1, acquiredAt: "2000-01-01T00:00:00.000Z",
      })}\n`, "utf8");
      const old = new Date(Date.now() - 60_000);
      await fs.utimes(lockDirectory, old, old);
      const observed = path.join(fixture.runtimeRoot, "stale-a-observed");
      const resume = path.join(fixture.runtimeRoot, "stale-remover-resume");
      const replaced = path.join(fixture.runtimeRoot, "live-b-published");
      const release = path.join(fixture.runtimeRoot, "live-b-release");
      const remover = spawnLockChild(fixture, observed, "stale-remover", [resume]);
      await waitForFile(observed);
      const contender = spawnLockChild(fixture,
        path.join(fixture.runtimeRoot, "live-b-started"), "live-replacement", [replaced, release]);
      await waitForFile(replaced);
      await fs.writeFile(resume, "resume\n", "utf8");
      const removed = await remover.completed;
      assert.equal(removed.code, 0, removed.stderr);
      assert.deepEqual(JSON.parse(removed.stdout), { decision: "ownership-loss-preserved" });
      const ownerB = await fs.readFile(path.join(lockDirectory, "owner.json"), "utf8");
      assert.match(ownerB, /live-owner-b-/);
      const entries = await fs.readdir(fixture.projectFolder);
      assert.equal(entries.some((entry) => entry.startsWith(".pipeline-jobs.stale-") &&
        entry !== ".pipeline-jobs.stale-a-preserved"), false);
      await fs.writeFile(release, "release\n", "utf8");
      const contenderResult = await contender.completed;
      assert.equal(contenderResult.code, 0, contenderResult.stderr);
      assert.deepEqual(JSON.parse(contenderResult.stdout), { decision: "live-owner-b-preserved" });
      await fs.rm(lockDirectory, { recursive: true });
      await fs.rm(path.join(fixture.projectFolder, ".pipeline-jobs.stale-a-preserved"),
        { recursive: true });
      await assert.rejects(fs.access(path.join(fixture.projectFolder, ".pipeline-jobs.lock-gate")));
    });
  });
  await test("Two-child post-check pathname replacement races preserve foreign leaves", async () => {
    const cases = [
      ["lock-release", "different"], ["lock-release", "same"],
      ["gate-release", "different"], ["stale-lock", "different"],
      ["stale-gate", "different"], ["quarantine-cleanup", "different"],
      ["publication-cleanup", "different"],
      ["foreign-quarantine-preserved", "different"],
    ] as const;
    for (const [target, ownerKind] of cases) {
      await withFixture(`race-${target.slice(0, 5)}-${ownerKind === "same" ? "s" : "d"}`,
        async (fixture) => {
        if (target === "stale-lock" || target === "stale-gate") {
          const owner = { schemaVersion: "2", projectSlug: fixture.projectSlug,
            projectFolder: fixture.projectFolder, jobId: `${fixture.projectSlug}-${stage}`,
            ownerNonce: `stale-${target}`, pid: 999_999, processStartEpochMs: 1,
            acquiredAt: "2020-01-01T00:00:00.000Z" };
          const artifact = target === "stale-lock"
            ? path.join(fixture.projectFolder, ".pipeline-jobs.lock")
            : path.join(fixture.projectFolder, ".pipeline-jobs.lock-gate");
          if (target === "stale-lock") {
            await fs.mkdir(artifact);
            await fs.writeFile(path.join(artifact, "owner.json"), `${JSON.stringify(owner)}\n`);
          } else {
            await fs.writeFile(artifact, `${JSON.stringify(owner)}\n`);
          }
          const old = new Date("2020-01-01T00:00:00.000Z");
          await fs.utimes(artifact, old, old);
        }
        const signal = path.join(fixture.runtimeRoot, `${target}-${ownerKind}-checked`);
        const resume = path.join(fixture.runtimeRoot, `${target}-${ownerKind}-resume`);
        const preserved = path.join(fixture.projectFolder,
          `.pipeline-jobs.preserved-${target}-${ownerKind}`);
        const childA = spawnPathRaceChild(fixture, "a", target, signal, resume,
          preserved, ownerKind);
        const childB = spawnPathRaceChild(fixture, "b", target, signal, resume,
          preserved, ownerKind);
        const [a, b] = await Promise.all([childA.completed, childB.completed]);
        assert.equal(a.code, 0, a.stderr);
        assert.equal(b.code, 0, b.stderr);
        const aResult = JSON.parse(a.stdout) as { decision: string; residuePath?: string;
          counters: RaceMutationCounters };
        const bResult = JSON.parse(b.stdout) as ReplacementEvidence;
        const expectedReason = target === "quarantine-cleanup"
          ? "PIPELINE_JOB_MUTATION_LOCK_QUARANTINE_CLEANUP_IDENTITY_UNVERIFIED"
          : "PIPELINE_JOB_MUTATION_LOCK_FOREIGN_QUARANTINE_PRESERVED";
        assert.equal(aResult.decision, expectedReason, target);
        assert.equal(bResult.decision, "replacement-published", target);
        assert.equal(createHash("sha256").update(bResult.replacementBytes, "utf8").digest("hex"),
          bResult.replacementHash, target);
        if (target !== "foreign-quarantine-preserved") await fs.lstat(preserved);
        const canonical = target.includes("gate")
          ? path.join(fixture.projectFolder, ".pipeline-jobs.lock-gate")
          : path.join(fixture.projectFolder, ".pipeline-jobs.lock");
        const canonicalPreserved = target === "foreign-quarantine-preserved";
        if (canonicalPreserved) {
          const canonicalEvidence = await readReplacementEvidence(canonical,
            bResult.replacementType);
          assert.deepEqual(canonicalEvidence, { bytes: bResult.replacementBytes,
            hash: bResult.replacementHash, inventoryHash: bResult.replacementInventoryHash });
        } else {
          await assert.rejects(fs.lstat(canonical), (error: unknown) =>
            (error as NodeJS.ErrnoException).code === "ENOENT");
        }
        const quarantineLeaves = await findQuarantineLeaves(fixture.projectFolder);
        assert.equal(quarantineLeaves.length, 1, target);
        assert.equal(path.resolve(aResult.residuePath ?? ""), path.resolve(quarantineLeaves[0]),
          target);
        const quarantineEvidence = await readReplacementEvidence(quarantineLeaves[0],
          bResult.replacementType);
        assert.deepEqual(quarantineEvidence, { bytes: bResult.replacementBytes,
          hash: bResult.replacementHash, inventoryHash: bResult.replacementInventoryHash });
        assert.equal(aResult.counters.foreignLeafMutationAttempts, 0, target);
        assert.equal(aResult.counters.foreignLeafDeleteAttempts, 0, target);
        assert.equal(aResult.counters.foreignLeafOverwriteAttempts, 0, target);
        assert.equal(aResult.counters.canonicalOverwriteAttempts, 0, target);
        assert.equal(aResult.counters.quarantineToCanonicalRestoreAttempts, 0, target);
        assert.equal(aResult.counters.unexpectedCanonicalMutationAttempts, 0, target);
        if (target === "foreign-quarantine-preserved") {
          assert.equal(aResult.counters.quarantineToCanonicalRestoreAttempts, 0, target);
          assert.equal(aResult.counters.canonicalOverwriteAttempts, 0, target);
        }
        process.stdout.write(`PATH_RACE_CASE target=${target} owner=${ownerKind} ` +
          `barrier=${target} expected=${expectedReason} actual=${aResult.decision} ` +
          `type=${bResult.replacementType} canonicalPreserved=${canonicalPreserved} ` +
          `quarantinePreserved=true byteEqual=true hashEqual=true inventoryEqual=true ` +
          `foreignMutation=${aResult.counters.foreignLeafMutationAttempts} ` +
          `foreignDelete=${aResult.counters.foreignLeafDeleteAttempts} ` +
          `foreignOverwrite=${aResult.counters.foreignLeafOverwriteAttempts} ` +
          `canonicalOverwrite=${aResult.counters.canonicalOverwriteAttempts} ` +
          `quarantineRestore=${aResult.counters.quarantineToCanonicalRestoreAttempts} ` +
          `unexpectedCanonicalMutation=${aResult.counters.unexpectedCanonicalMutationAttempts} ` +
          `PASS\n`);
        });
    }
    process.stdout.write(`POST_CHECK_REPLACEMENT_RACE_CASES ${cases.length}\n`);
    process.stdout.write(`FOREIGN_BYTE_HASH_EQUALITY_CASES ${cases.length}\n`);
    process.stdout.write(`EXACT_FAIL_CLOSED_REASON_CASES ${cases.length}\n`);
  });
  await test("Immutable admission field-by-field poisoning rejects before durable construction", async () => {
    await withFixture("admission-poisoning", async (fixture) => {
      const chain = await fixture.createChain(1);
      const prepared = await prepareFailedStageRetry(
        fixture.projectSlug,
        chain[0].failedJob.id,
      );
      assert.equal(prepared.success, true, JSON.stringify(prepared));
      if (!prepared.success) return;
      type Mutable = Record<string, unknown>;
      const nested = (value: Mutable, key: string) => value[key] as Mutable;
      const poisoners: Array<[string, (value: Mutable) => void]> = [
        ["projectSlug", (value) => { value.projectSlug = "poison-project"; }],
        ["stage", (value) => { value.stage = "video"; }],
        ["jobId", (value) => { value.jobId = "poison-job"; }],
        ["runType", (value) => { value.runType = "resume"; }],
        ["priorJobAttemptIndex", (value) => { value.priorJobAttemptIndex = 1; }],
        ["currentDurableOrdinal", (value) => { value.currentDurableOrdinal = 2; }],
        ["admittedJobAttemptIndex", (value) => { value.admittedJobAttemptIndex = 2; }],
        ["admittedDurableOrdinal", (value) => { value.admittedDurableOrdinal = 4; }],
        ["maxAttempts", (value) => { value.maxAttempts = 4; }],
        ["priorJobStatus", (value) => { value.priorJobStatus = "queued"; }],
        ["preMutationJobFingerprint", (value) => {
          value.preMutationJobFingerprint = "poison";
        }],
        ["preMutationJobVersion", (value) => { value.preMutationJobVersion = "poison"; }],
        ["admittedJobStatus", (value) => { value.admittedJobStatus = "failed"; }],
        ["admittedJobFingerprint", (value) => { value.admittedJobFingerprint = "poison"; }],
        ["admittedJobVersion", (value) => { value.admittedJobVersion = "poison"; }],
      ];
      for (const identityName of ["exactReconciledDurableLineageIdentity",
        "admittedDurableLineageIdentity"] as const) {
        for (const field of ["requestId", "idempotencyKey", "executionFingerprint", "claimId",
          "leaseId", "attemptId", "recordId", "runningEventId", "terminalEventId"] as const) {
          poisoners.push([`${identityName}.${field}`, (value) => {
            nested(value, identityName)[field] = "poison";
          }]);
        }
        for (const field of ["projectSlug", "stage", "jobId", "attemptNumber"] as const) {
          poisoners.push([`${identityName}.core.${field}`, (value) => {
            nested(nested(value, identityName), "core")[field] =
              field === "attemptNumber" ? 99 : "poison";
          }]);
        }
      }
      for (const field of ["operation", "durableOrdinal", "maxAttempts", "reservationId",
        "workerId", "workerSessionId", "recordVersion", "reservationVersion",
        "claimVersion", "attemptVersion", "leaseVersion", "reservationIdentityFingerprint",
        "recordIntegrityFingerprint", "recordIntegrityVersion"] as const) {
        poisoners.push([`admittedExecutionBinding.${field}`, (value) => {
          nested(value, "admittedExecutionBinding")[field] =
            field.endsWith("Version") || field === "durableOrdinal" || field === "maxAttempts"
              ? 99 : "poison";
        }]);
      }
      for (const field of ["operation", "durableOrdinal", "maxAttempts", "reservationId",
        "workerId", "workerSessionId", "recordVersion", "reservationVersion",
        "claimVersion", "attemptVersion", "leaseVersion", "reservationIdentityFingerprint",
        "recordIntegrityFingerprint", "recordIntegrityVersion", "leaseIntegrityFingerprint",
        "claimIntegrityFingerprint", "attemptIntegrityFingerprint"] as const) {
        poisoners.push([`exactReconciledLineageBinding.${field}`, (value) => {
          nested(value, "exactReconciledLineageBinding")[field] = "poison";
        }]);
      }
      for (const field of ["claimIntegrityFingerprint", "attemptIntegrityFingerprint"] as const) {
        poisoners.push([`exactReconciledLineageBinding.missing-${field}`, (value) => {
          delete nested(value, "exactReconciledLineageBinding")[field];
        }]);
      }
      const before = await fixture.snapshot();
      for (const [field, poison] of poisoners) {
        const poisoned = structuredClone(prepared.admission) as unknown as Mutable;
        poison(poisoned);
        const captured = await captureBoundaries(async () => {
          await assert.rejects(
            () => withProductionAcceptanceRetryAdmission(
              poisoned as unknown as typeof prepared.admission,
              prepared.previousJob,
              () => prepareProductionPipelineExecution({
                projectSlug: fixture.projectSlug,
                stage,
                runType: "retry",
              }),
            ),
            (error: unknown) => (error as { reasonCode?: unknown }).reasonCode ===
              "PIPELINE_RETRY_EXECUTION_ADMISSION_FAILED",
            field,
          );
        });
        admissionStorageConstructionCount += captured.counters.storage;
        assert.equal(captured.counters.storage, 0, field);
        assertZero(captured.counters);
        await fixture.assertUnchanged(before);
      }
      for (const [field, value] of [["id", "poison"], ["projectSlug", "poison"],
        ["stage", "video"], ["status", "queued"], ["attempts", 9],
        ["updatedAt", "2026-01-01T00:00:00.000Z"]] as const) {
        const previousJob = { ...prepared.previousJob, [field]: value } as PipelineJob;
        const captured = await captureBoundaries(async () => {
          await assert.rejects(() => withProductionAcceptanceRetryAdmission(
            prepared.admission,
            previousJob,
            () => prepareProductionPipelineExecution({
              projectSlug: fixture.projectSlug, stage, runType: "retry",
            }),
          ));
        });
        admissionStorageConstructionCount += captured.counters.storage;
        assert.equal(captured.counters.storage, 0, String(field));
        assertZero(captured.counters);
        await fixture.assertUnchanged(before);
      }
    });
  });
}

function cliDependencies(error: unknown) {
  return {
    readiness: async () => ({ schemaVersion: "1.0", ready: true, generatedAt: anchor, checks: [] } as never),
    execute: async () => ({ readiness: {}, completion: {} } as never),
    resume: async () => { throw error; },
  };
}

async function assertSafeCli(
  expected: Record<string, unknown>,
  injected: unknown,
  forbidden: readonly string[],
) {
  const slug = "sprint-129-33-cli-fixture";
  const result = await runProductionAcceptanceCommand(
    ["resume-finalize", `--project-slug=${slug}`, "--confirm-production-acceptance"],
    cliDependencies(injected),
  );
  assert.equal(result.exitCode, 1);
  assert.deepEqual(result.report, expected);
  const stdout = `${JSON.stringify(result.report, null, 2)}\n`;
  const stderr = "";
  for (const value of forbidden) {
    assert.ok(!stdout.includes(value), `stdout leaked ${value}`);
    assert.ok(!stderr.includes(value), `stderr leaked ${value}`);
  }
  assert.ok(!/\bat .+\(.+:\d+:\d+\)/.test(stdout + stderr), "stack trace leaked");
  assert.ok(!/[A-Z]:\\Users\\|\/usr\/|\/home\//.test(stdout + stderr), "local path leaked");
}

async function cliEvidence() {
  const slug = "sprint-129-33-cli-fixture";
  const commonForbidden = [
    "raw-exception-message",
    "C:\\Users\\secret\\runtime",
    "/usr/secret/path",
    "sk-proj-secret-api-key",
    "raw-provider-response-body",
    "environment-secret-value",
    "Error:",
    "stack",
  ];
  await test("CLI A: exhausted retry exact safe stdout/stderr contract", async () => {
    await assertSafeCli({
      mode: "resume-finalize",
      success: false,
      errorCode: "PIPELINE_RETRY_MAX_ATTEMPTS_EXCEEDED",
      projectSlug: slug,
    }, new ProductionAcceptanceExecutionError(slug, "PIPELINE_RETRY_MAX_ATTEMPTS_EXCEEDED"), commonForbidden);
  });
  await test("CLI B: queued/exhausted drift exact safe stdout/stderr contract", async () => {
    await assertSafeCli({
      mode: "resume-finalize",
      success: false,
      errorCode: "PIPELINE_RETRY_QUEUED_EXHAUSTED_DRIFT_DETECTED",
      projectSlug: slug,
    }, new ProductionAcceptanceExecutionError(
      slug, "PIPELINE_RETRY_QUEUED_EXHAUSTED_DRIFT_DETECTED",
    ), commonForbidden);
  });
  await test("CLI C: unexpected injected exception is generic and sanitized", async () => {
    const hostile = Object.assign(new Error(
      "raw-exception-message C:\\Users\\secret\\runtime /usr/secret/path " +
      "sk-proj-secret-api-key raw-provider-response-body environment-secret-value",
    ), {
      code: "sk-proj-secret-api-key",
      reasonCode: "raw-provider-response-body",
      category: "storage",
      projectSlug: "environment-secret-value",
    });
    await assertSafeCli({
      mode: "resume-finalize",
      success: false,
      errorCode: "PRODUCTION_ACCEPTANCE_COMMAND_FAILED",
      projectSlug: slug,
    }, hostile, commonForbidden);
  });
  await test("CLI D: subclass and prototype-shaped errors cannot inject public codes", async () => {
    class HostileSubclass extends ProductionAcceptanceExecutionError {}
    for (const hostile of [
      new HostileSubclass(slug, "PIPELINE_RETRY_MAX_ATTEMPTS_EXCEEDED"),
      Object.setPrototypeOf(new ProductionAcceptanceExecutionError(
        slug, "PIPELINE_RETRY_MAX_ATTEMPTS_EXCEEDED"), Error.prototype),
      new ProductionAcceptanceExecutionError(slug, "ATTACKER_UNKNOWN_CODE"),
      Object.assign(Object.create(ProductionAcceptanceExecutionError.prototype), {
        reasonCode: "PIPELINE_RETRY_MAX_ATTEMPTS_EXCEEDED", projectSlug: slug,
      }),
    ]) {
      await assertSafeCli({ mode: "resume-finalize", success: false,
        errorCode: "PRODUCTION_ACCEPTANCE_COMMAND_FAILED", projectSlug: slug },
      hostile, commonForbidden);
    }
  });
  await test("CLI E: every typed branch rejects forged prototypes and subclasses", async () => {
    class BlockedSubclass extends ProductionAcceptanceBlockedError {}
    class ConfigurationSubclass extends ProductionAcceptanceConfigurationChangedError {}
    class PolicySubclass extends ProductionAcceptancePolicyError {}
    class ReprepareSubclass extends ProductionAcceptanceReprepareError {}
    class LegacySubclass extends ProductionAcceptanceLegacyReauthorizationError {}
    class DurableSubclass extends ProductionPipelineDurableExecutionError {}
    const readiness = { schemaVersion: "1.0", ready: false,
      generatedAt: anchor, checks: [] } as never;
    const sha = "a".repeat(64);
    const withBasePrototype = <T extends object>(value: T, prototype: object): T =>
      Object.setPrototypeOf(value, prototype);
    const cases: Array<{ args: string[]; errors: unknown[];
      dependencies: ReturnType<typeof cliDependencies> & Record<string, unknown> }> = [
      {
        args: ["resume-finalize", `--project-slug=${slug}`,
          "--confirm-production-acceptance"],
        errors: [Object.create(ProductionAcceptanceBlockedError.prototype),
          new BlockedSubclass(readiness),
          withBasePrototype(new BlockedSubclass(readiness),
            ProductionAcceptanceBlockedError.prototype)],
        dependencies: cliDependencies(undefined),
      },
      {
        args: ["resume-finalize", `--project-slug=${slug}`,
          "--confirm-production-acceptance"],
        errors: [Object.create(ProductionPipelineDurableExecutionError.prototype),
          new DurableSubclass("hostile", "PIPELINE_RETRY_MAX_ATTEMPTS_EXCEEDED"),
          withBasePrototype(new DurableSubclass(
            "hostile", "PIPELINE_RETRY_MAX_ATTEMPTS_EXCEEDED"),
          ProductionPipelineDurableExecutionError.prototype)],
        dependencies: cliDependencies(undefined),
      },
      {
        args: ["resume-finalize", `--project-slug=${slug}`,
          "--confirm-production-acceptance"],
        errors: [Object.create(ProductionAcceptanceConfigurationChangedError.prototype),
          new ConfigurationSubclass(),
          withBasePrototype(new ConfigurationSubclass(),
            ProductionAcceptanceConfigurationChangedError.prototype)],
        dependencies: cliDependencies(undefined),
      },
      {
        args: ["resume-finalize", `--project-slug=${slug}`,
          "--confirm-production-acceptance"],
        errors: [Object.create(ProductionAcceptancePolicyError.prototype),
          new PolicySubclass(),
          withBasePrototype(new PolicySubclass(), ProductionAcceptancePolicyError.prototype)],
        dependencies: cliDependencies(undefined),
      },
      {
        args: ["reprepare", `--project-slug=${slug}`,
          "--confirm-production-acceptance-reprepare"],
        errors: [Object.create(ProductionAcceptanceReprepareError.prototype),
          new ReprepareSubclass(),
          withBasePrototype(new ReprepareSubclass(),
            ProductionAcceptanceReprepareError.prototype)],
        dependencies: cliDependencies(undefined),
      },
      {
        args: ["legacy-reauthorization-plan", `--project-slug=${slug}`,
          `--source-marker-sha256=${sha}`],
        errors: [Object.create(ProductionAcceptanceLegacyReauthorizationError.prototype),
          new LegacySubclass("PRODUCTION_ACCEPTANCE_REAUTHORIZATION_SOURCE_MARKER_INVALID"),
          withBasePrototype(new LegacySubclass(
            "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_SOURCE_MARKER_INVALID"),
          ProductionAcceptanceLegacyReauthorizationError.prototype)],
        dependencies: cliDependencies(undefined),
      },
    ];
    for (const item of cases) {
      for (const error of item.errors) {
        const dependencies = { ...item.dependencies,
          resume: async () => { throw error; },
          reprepare: async () => { throw error; },
          legacyReauthorizationPlan: async () => { throw error; } } as never;
        const result = await runProductionAcceptanceCommand(item.args, dependencies);
        assert.equal(result.exitCode, 1);
        assert.equal(result.report.errorCode, "PRODUCTION_ACCEPTANCE_COMMAND_FAILED");
        assert.equal(result.report.projectSlug, slug);
      }
    }
  });
  await test("CLI F: authentic fixed typed errors map only to fixed public codes", async () => {
    const fixed: Array<[unknown, string]> = [
      [new ProductionAcceptanceBlockedError({ schemaVersion: "1.0", ready: false,
        generatedAt: anchor, checks: [] } as never),
      "PRODUCTION_ACCEPTANCE_READINESS_BLOCKED"],
      [new ProductionAcceptanceConfigurationChangedError(),
      "PRODUCTION_ACCEPTANCE_CONFIGURATION_CHANGED"],
      [new ProductionAcceptancePolicyError(), "PRODUCTION_ACCEPTANCE_POLICY_INVALID"],
    ];
    for (const [error, code] of fixed) {
      const result = await runProductionAcceptanceCommand(
        ["resume-finalize", `--project-slug=${slug}`,
          "--confirm-production-acceptance"],
        cliDependencies(error),
      );
      assert.equal(result.report.errorCode, code);
    }
  });
  for (const [fixture, expectedCode] of [
    ["exhausted", "PIPELINE_RETRY_MAX_ATTEMPTS_EXCEEDED"],
    ["drift", "PIPELINE_RETRY_QUEUED_EXHAUSTED_DRIFT_DETECTED"],
    ["generic", "PRODUCTION_ACCEPTANCE_COMMAND_FAILED"],
  ] as const) {
    await test(`Actual CLI child process: ${fixture}`, async () => {
      const result = await runActualCliProcess(fixture);
      assert.equal(result.code, 1, result.stderr);
      assert.equal(result.stderr, "");
      assert.deepEqual(JSON.parse(result.stdout), {
        mode: "resume-finalize", success: false, errorCode: expectedCode,
        projectSlug: "sprint-129-33-cli-process",
      });
      assert.doesNotMatch(result.stdout + result.stderr,
        /unsafe-provider-body|private|sk-test-secret|stack|[A-Z]:\\Users\\/i);
    });
  }
}

async function main() {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    networkCallCount += 1;
    throw new Error("Network access is forbidden in Sprint 129.33 evidence tests.");
  }) as typeof globalThis.fetch;
  try {
    await retryAndRecoveryEvidence();
    await manifestSeedEvidence();
    await hostileMatrix();
    await cliEvidence();
    assert.equal(totalRuntimeRemainder, 0);
    assert.equal(totalAuthorityRemainder, 0);
    assert.equal(totalLockGateQuarantineRemainder, 0);
    assert.equal(newlyCreatedGlobalInventoryCount, 0);
    assertZero(capturedBoundaryTotals);
    assert.equal(admissionStorageConstructionCount, 0);
    assert.equal(networkCallCount, 0);
    await test("all isolated runtime and authority roots are fully cleaned", async () => undefined);
    process.stdout.write(`SAFETY admissionStorageConstructions=${admissionStorageConstructionCount} ` +
      `providerCalls=${capturedBoundaryTotals.provider} ` +
      `workerCalls=${capturedBoundaryTotals.worker} ` +
      `stageDispatchCalls=${capturedBoundaryTotals.stageDispatch} ` +
      `lockMutations=${capturedBoundaryTotals.lock} ` +
      `gateMutations=${capturedBoundaryTotals.gate} ` +
      `quarantineMutations=${capturedBoundaryTotals.quarantine} ` +
      `fetchCalls=${capturedBoundaryTotals.fetch} httpCalls=${capturedBoundaryTotals.http} ` +
      `httpsCalls=${capturedBoundaryTotals.https} ` +
      `networkCalls=${capturedBoundaryTotals.network} ` +
      `globalFetchNetworkCalls=${networkCallCount} ` +
      `runtimeRemainder=${totalRuntimeRemainder} authorityRemainder=${totalAuthorityRemainder} ` +
      `lockGateQuarantineRemainder=${totalLockGateQuarantineRemainder} ` +
      `preExistingGlobalInventory=${preExistingGlobalInventoryCount} ` +
      `newlyCreatedGlobalInventory=${newlyCreatedGlobalInventoryCount}\n`);
    emitSmokeResult("sprint-129-33-exhausted-retry-admission", passed);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

void main().catch((error) => {
  process.stderr.write(`Sprint 129.33 exhausted retry admission smoke FAILED: ${
    error instanceof Error ? error.stack ?? error.message : "unknown"}\n`);
  process.exitCode = 1;
});
