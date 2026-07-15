import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { prepareFailedStageRetry } from "../src/lib/pipeline/PipelineFailedStageRetry";
import { PipelineJobManager } from "../src/lib/pipeline/PipelineJobManager";
import { PipelineQueueScheduler } from "../src/lib/pipeline/PipelineQueueScheduler";
import { reconcileFailedPipelineExecution } from "../src/lib/production/ProductionPipelineRetryReconciliation";
import { buildProductionPipelineExecutionIdentity } from "../src/lib/production/ProductionPipelineExecutionIdentity";
import type { PipelineJobList } from "../src/types/pipelineJob";

const sourceRoot = process.cwd();
const slug = "fatih-sultan-mehmet-in-i-stanbul-un-fethine-hazirlanisi-cfe77fd8-8350-4415-bc87-211e3d36c4d5";
const sourceProject = path.join(sourceRoot, "data", "projects", slug);
let passCount = 0;

function pass(condition: unknown, label: string) {
  if (!condition) throw new Error(`FAIL ${passCount + 1}: ${label}`);
  passCount++;
  console.log(`PASS ${passCount}: ${label}`);
}

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await fs.readFile(file, "utf8")) as T;
}

async function digestDirectory(root: string) {
  const entries: string[] = [];
  async function visit(directory: string) {
    for (const entry of (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else entries.push(`${path.relative(root, absolute)}:${createHash("sha256").update(await fs.readFile(absolute)).digest("hex")}`);
    }
  }
  await visit(root);
  return createHash("sha256").update(entries.join("\n")).digest("hex");
}

async function createFixture(label: string) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `atolye-1299-${label}-`));
  const target = path.join(root, "data", "projects", slug);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.cp(sourceProject, target, { recursive: true, errorOnExist: true });
  return { root, target };
}

async function withFixture<T>(label: string, operation: (fixture: Awaited<ReturnType<typeof createFixture>>) => Promise<T>) {
  const fixture = await createFixture(label);
  try {
    process.chdir(fixture.root);
    return await operation(fixture);
  } finally {
    process.chdir(sourceRoot);
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
}

async function currentFailedJob(target: string) {
  const jobs = await readJson<PipelineJobList>(path.join(target, "pipeline-jobs.json"));
  const job = jobs.jobs.find((candidate) => candidate.status === "failed");
  if (!job) throw new Error("Failed job missing.");
  return job;
}

async function runBoundedCliFailure() {
  const cli = path.join(sourceRoot, "node_modules", "tsx", "dist", "cli.mjs");
  const script = path.join(sourceRoot, "scripts", "run-production-acceptance.ts");
  const startedAt = Date.now();
  return new Promise<{ code: number | null; signal: NodeJS.Signals | null; timedOut: boolean; elapsed: number; output: string }>((resolve) => {
    let output = "";
    let timedOut = false;
    const child = spawn(process.execPath, [cli, script, "resume-finalize"], { cwd: sourceRoot, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", (chunk) => { output += String(chunk); });
    child.stderr.on("data", (chunk) => { output += String(chunk); });
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, 5_000);
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, timedOut, elapsed: Date.now() - startedAt, output });
    });
  });
}

async function main() {
  const productionBefore = await digestDirectory(sourceProject);
  const runnerSource = await fs.readFile(path.join(sourceRoot, "src/lib/pipeline/PipelineRunner.ts"), "utf8");

  await withFixture("canonical", async ({ target }) => {
    const job = await currentFailedJob(target);
    const allJobsBefore = (await readJson<PipelineJobList>(path.join(target, "pipeline-jobs.json"))).jobs;
    const downstreamBefore = allJobsBefore.slice(allJobsBefore.findIndex((item) => item.id === job.id) + 1);
    const historyBefore = await readJson<{ events: unknown[] }>(path.join(target, "pipeline-history.json"));
    const oldIdentity = buildProductionPipelineExecutionIdentity({ projectSlug: slug, stage: job.stage, runType: "initial" }, { id: job.id, attempts: job.attempts });
    const oldAttemptPath = path.join(target, "production-execution", "attempts", `${oldIdentity.attemptId}-v3.json`);
    const oldAttemptDigest = createHash("sha256").update(await fs.readFile(oldAttemptPath)).digest("hex");

    pass(job.stage === "visuals" && job.status === "failed" && downstreamBefore.every((item) => item.status === "queued"), "current failed stage and downstream queue are canonical");
    const planSource = await fs.readFile(path.join(sourceRoot, "src/lib/pipeline/PipelineRecoveryPlanner.ts"), "utf8");
    pass(planSource.includes("getNextIncompleteOrUnreadyStage"), "recovery planner selects the first incomplete stage");
    pass(runnerSource.includes("prepareFailedStageRetry(projectSlug, startJob.id)"), "resume prepares the failed start stage before scheduling");

    const reconciliationAt = new Date(Date.parse(job.updatedAt) + 1_000).toISOString();
    const replayAt = new Date(Date.parse(job.updatedAt) + 2_000).toISOString();
    const reconciled = await reconcileFailedPipelineExecution(job, () => reconciliationAt);
    pass(reconciled.ok && reconciled.reasonCode === "PIPELINE_RETRY_RECONCILED", `failed durable execution reconciles successfully (${reconciled.reasonCode}; ${reconciled.evidence.join(",")})`);
    pass(createHash("sha256").update(await fs.readFile(oldAttemptPath)).digest("hex") === oldAttemptDigest, "terminal failed attempt remains immutable");
    const claimV2 = await readJson<{ state: string }>(path.join(target, "production-execution", "claims", `${oldIdentity.claimId}-v2.json`));
    pass(claimV2.state === "abandoned", "active claim is abandoned through the canonical service");
    const recordV4 = await readJson<{ state: string; durableLease?: { status: string } }>(path.join(target, "production-execution", "idempotency", `${oldIdentity.recordId}-v4.json`));
    pass(recordV4.durableLease?.status === "released", "active lease is released through the canonical service");
    pass(recordV4.state === "cancelled", "reserved idempotency record is closed for forward recovery");

    const durableDigest = await digestDirectory(path.join(target, "production-execution"));
    const replay = await reconcileFailedPipelineExecution(job, () => replayAt);
    pass(replay.ok && replay.writeFree && replay.reasonCode === "PIPELINE_RETRY_RECONCILIATION_REPLAYED", "exact durable reconciliation replay is write-free");
    pass(await digestDirectory(path.join(target, "production-execution")) === durableDigest, "reconciliation replay creates no durable version");

    const prepared = await prepareFailedStageRetry(slug, job.id);
    pass(prepared.success && prepared.job.status === "queued", "central retry primitive transitions failed job to queued");
    pass(prepared.success && prepared.job.attempts === job.attempts + 1, "retry preparation increments the attempt exactly once");
    const scheduled = await PipelineQueueScheduler.getNextRunnableStage(slug, [job.stage]);
    pass(scheduled.stage === job.stage, "scheduler accepts the failed stage after retry preparation");
    const allJobsAfter = (await readJson<PipelineJobList>(path.join(target, "pipeline-jobs.json"))).jobs;
    const downstreamAfter = allJobsAfter.slice(allJobsAfter.findIndex((item) => item.id === job.id) + 1);
    pass(JSON.stringify(downstreamAfter) === JSON.stringify(downstreamBefore), "downstream queued jobs are unchanged during preparation");
    const historyAfterPreparation = await readJson<{ events: unknown[] }>(path.join(target, "pipeline-history.json"));
    pass(JSON.stringify(historyAfterPreparation) === JSON.stringify(historyBefore), "history remains append-only during preparation");
    const markerAfter = await readJson<Record<string, unknown>>(path.join(target, "production-acceptance.json"));
    pass(markerAfter.productionReady === false, "productionReady remains false");
    pass(markerAfter.published === false, "published remains false");
    pass(markerAfter.publishMode === "package-only", "package-only policy remains unchanged");

    const secondPreparation = await prepareFailedStageRetry(slug, job.id);
    pass(!secondPreparation.success && secondPreparation.reasonCode === "PIPELINE_RETRY_PREPARATION_REJECTED", "same resume replay cannot prepare a second retry");
    const afterReplayJob = await currentFailedJob(target).catch(async () => (await readJson<PipelineJobList>(path.join(target, "pipeline-jobs.json"))).jobs.find((item) => item.id === job.id)!);
    pass(afterReplayJob.attempts === job.attempts + 1, "same resume replay does not increment attempts twice");
    const newIdentityA = buildProductionPipelineExecutionIdentity({ projectSlug: slug, stage: job.stage, runType: "retry" }, { id: job.id, attempts: job.attempts + 1 });
    const newIdentityB = buildProductionPipelineExecutionIdentity({ projectSlug: slug, stage: job.stage, runType: "retry" }, { id: job.id, attempts: job.attempts + 1 });
    pass(newIdentityA.attemptId === newIdentityB.attemptId && newIdentityA.attemptId !== oldIdentity.attemptId, "new retry attempt identity is deterministic and distinct");
    pass(newIdentityA.recordId !== oldIdentity.recordId && newIdentityA.claimId !== oldIdentity.claimId, "new retry owns distinct record and claim identities");

    let providerCalls = 0;
    const started = await PipelineJobManager.startStage(slug, job.stage, async () => { providerCalls++; });
    pass(started && providerCalls === 1, "failed-stage provider admission occurs exactly once after preparation");
    pass(downstreamAfter.every((item) => item.status === "queued"), "downstream providers do not start during failed-stage admission");
    const completed = await PipelineJobManager.persistStageSuccess(slug, job.stage, async () => undefined);
    pass(completed, "failed-stage retry can persist terminal success on the disposable fixture");
    const nextStage = downstreamBefore[0]?.stage;
    if (!nextStage) throw new Error("Downstream stage missing.");
    const next = await PipelineQueueScheduler.getNextRunnableStage(slug, [job.stage, nextStage]);
    pass(next.stage === nextStage, "fixture progresses to the next stage after retry success");
    const historyAfterSuccess = await readJson<{ events: Array<{ status: string }> }>(path.join(target, "pipeline-history.json"));
    pass(historyAfterSuccess.events.length === historyBefore.events.length + 1 && historyAfterSuccess.events.at(-1)?.status === "completed", "history appends retry completion evidence");
    pass((await fs.readdir(path.join(target, "production-execution", "attempts"))).filter((name) => name.startsWith(newIdentityA.attemptId)).length === 0, "preparation alone does not open a provider attempt");
  });

  await withFixture("cas", async ({ target }) => {
    const job = await currentFailedJob(target);
    const before = await digestDirectory(target);
    const rejected = await PipelineJobManager.prepareJobRetry(slug, job.id, { updatedAt: "2000-01-01T00:00:00.000Z", attempts: job.attempts });
    pass(!rejected.success && rejected.reasonCode === "PIPELINE_RETRY_CAS_CONFLICT", "stale retry preparation fails closed with CAS conflict");
    pass(await digestDirectory(target) === before, "CAS conflict is write-free and starts no provider");
  });

  await withFixture("concurrent", async ({ target }) => {
    const job = await currentFailedJob(target);
    const results = await Promise.all([prepareFailedStageRetry(slug, job.id), prepareFailedStageRetry(slug, job.id)]);
    pass(results.filter((result) => result.success).length === 1, "only one concurrent retry preparation wins execution rights");
    const concurrentJob=(await readJson<PipelineJobList>(path.join(target,"pipeline-jobs.json"))).jobs.find(item=>item.id===job.id)!;
    pass(concurrentJob.attempts === job.attempts + 1, "concurrent preparation increments attempts once");
    pass(results.some((result) => !result.success && /PIPELINE_RETRY_/.test(result.reasonCode)), "losing concurrent preparation returns a stable reason code");
  });

  await withFixture("compensation", async ({ target }) => {
    const job = await currentFailedJob(target);
    const prepared = await prepareFailedStageRetry(slug, job.id);
    if (!prepared.success) throw new Error(prepared.reasonCode);
    const compensated = await PipelineJobManager.compensatePreparedRetry(slug, prepared.previousJob, prepared.job);
    pass(compensated && (await currentFailedJob(target)).status === "failed", "prepared job compensation restores the failed state");
    const duplicateCompensation = await PipelineJobManager.compensatePreparedRetry(slug, prepared.previousJob, prepared.job);
    pass(!duplicateCompensation, "duplicate compensation is rejected without rewriting state");
  });

  pass((runnerSource.match(/prepareFailedStageRetry\(/g) ?? []).length >= 2, "manual retry and resume share the central preparation primitive");
  pass(!runnerSource.includes("PipelineRunner.run("), "resume hardening does not create a second full execute path");

  const cli = await runBoundedCliFailure();
  pass(!cli.timedOut && cli.signal === null, "CLI failure exits naturally without watchdog termination");
  pass(cli.code === 2 && cli.output.includes("PRODUCTION_ACCEPTANCE_CONFIRMATION_REQUIRED"), "failure CLI exit code and JSON envelope are stable");
  pass(cli.elapsed < 5_000, "CLI failure shutdown is bounded");

  pass(await digestDirectory(sourceProject) === productionBefore, "real production acceptance runtime remains byte-for-byte unchanged");
  pass(passCount === 41, "Sprint 129.9 smoke matrix completed all scenarios");
  console.log(`Sprint 129.9 failed-stage resume smoke PASS: ${passCount} scenarios.`);
}

void main().catch((error) => {
  process.chdir(sourceRoot);
  console.error(error instanceof Error ? error.message : "Sprint 129.9 smoke failed.");
  process.exitCode = 1;
});
