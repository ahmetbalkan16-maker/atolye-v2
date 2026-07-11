import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  ProductionSnapshotBuilder,
  buildProductionSnapshot,
} from "../src/lib/production/ProductionSnapshotBuilder";
import { selectLatestJob } from "../src/lib/production/ProductionSnapshotParts";
import type { ProductionSnapshotSourceBundle } from "../src/lib/production/ProductionSnapshotSourceReader";
import { pipelineRecoveryStageOrder } from "../src/lib/pipeline/PipelineRecoveryPlanner";
import type { AIUsageLog, AIUsageRecord } from "../src/types/aiUsage";
import type {
  PipelineJob,
  PipelineJobHistory,
  PipelineJobHistoryEvent,
  PipelineJobList,
} from "../src/types/pipelineJob";
import type {
  ProductionStepKey,
  Project,
  ProjectManifest,
} from "../src/types/project";

const generatedAt = "2026-07-11T12:00:00.000Z";
const now = "2026-07-11T10:00:00.000Z";
const slug = `sprint-95-3-snapshot-${process.pid}`;
const projectFolder = path.join(process.cwd(), "data", "projects", slug);

function project(status: Project["status"] = "completed"): Project {
  return {
    id: "project-95-3",
    slug,
    title: "Sprint 95.3 Snapshot",
    status,
    createdAt: now,
    updatedAt: now,
  };
}

function manifest(projectValue = project()): ProjectManifest {
  return {
    project: projectValue,
    projectId: projectValue.id,
    slug,
    version: 1,
    packages: Object.fromEntries(
      pipelineRecoveryStageOrder.map((stage) => [
        stage,
        {
          key: stage,
          status: "completed",
          fileName: `${stage}.json`,
          updatedAt: now,
          startedAt: "2026-07-11T09:59:59.000Z",
          completedAt: now,
          durationMs: 1000,
          attempts: {
            total: 1,
            retry: 0,
            lastAttemptAt: "2026-07-11T09:59:59.000Z",
            lastRunType: "initial",
          },
        },
      ]),
    ) as ProjectManifest["packages"],
    createdAt: now,
    updatedAt: now,
  };
}

function job(
  stage: ProductionStepKey,
  status: PipelineJob["status"] = "completed",
  id = `${slug}-${stage}`,
  updatedAt = now,
): PipelineJob {
  return {
    id,
    projectSlug: slug,
    stage,
    title: stage,
    status,
    attempts: 0,
    createdAt: "2026-07-11T09:00:00.000Z",
    updatedAt,
    startedAt: "2026-07-11T09:59:59.000Z",
    completedAt: status === "running" || status === "queued" ? undefined : now,
    cancelRequestedAt: status === "cancelled" ? now : undefined,
    error: status === "failed" ? "failure" : undefined,
  };
}

function jobs(items = pipelineRecoveryStageOrder.map((stage) => job(stage))): PipelineJobList {
  return { projectSlug: slug, jobs: items, createdAt: now, updatedAt: now };
}

function historyEvent(
  id: string,
  stage: ProductionStepKey,
  status: PipelineJobHistoryEvent["status"],
  startedAt?: string,
  completedAt?: string,
): PipelineJobHistoryEvent {
  return {
    id,
    jobId: `${slug}-${stage}`,
    stage,
    status,
    startedAt,
    completedAt,
    jobCreatedAt: now,
    jobUpdatedAt: completedAt ?? now,
    recordedAt: completedAt ?? now,
  };
}

function history(): PipelineJobHistory {
  return {
    projectSlug: slug,
    events: [
      historyEvent("h1", "research", "completed", "2026-07-11T09:00:00.000Z", "2026-07-11T09:00:01.000Z"),
      historyEvent("h2", "script", "completed", "2026-07-11T09:00:00.000Z", "2026-07-11T09:00:03.000Z"),
      historyEvent("h3", "scenes", "failed", "2026-07-11T09:00:00.000Z", "2026-07-11T09:00:04.000Z"),
    ],
    createdAt: now,
    updatedAt: now,
  };
}

function usageRecord(
  id: string,
  provider: AIUsageRecord["provider"],
  model: string | undefined,
  tokens?: number,
  cost?: number,
): AIUsageRecord {
  return {
    id,
    projectSlug: slug,
    stage: "research",
    operation: "research",
    provider,
    model,
    status: "success",
    fallbackUsed: false,
    durationMs: 100,
    promptLength: 10,
    responseLength: 20,
    promptTokens: tokens,
    completionTokens: tokens,
    totalTokens: tokens,
    estimatedCost: cost,
    createdAt: `${now.slice(0, -5)}${id === "u1" ? "1" : "2"}.000Z`,
  };
}

function usage(records: AIUsageRecord[] = []): AIUsageLog {
  return { projectSlug: slug, records, createdAt: now, updatedAt: now };
}

function bundle(): ProductionSnapshotSourceBundle {
  return {
    projectSlug: slug,
    project: { data: project(), state: { status: "available" } },
    manifest: { data: manifest(), state: { status: "available" } },
    jobs: { data: jobs(), state: { status: "available" } },
    history: { data: history(), state: { status: "available" } },
    aiUsage: { data: usage(), state: { status: "available" } },
    stageOutputs: Object.fromEntries(
      pipelineRecoveryStageOrder.map((stage) => [
        stage,
        { data: { stage }, state: { status: "available" as const } },
      ]),
    ) as ProductionSnapshotSourceBundle["stageOutputs"],
  };
}

function cloneBundle(value: ProductionSnapshotSourceBundle) {
  return structuredClone(value);
}

async function main() {
  const complete = buildProductionSnapshot(bundle(), generatedAt);
  assert.equal(complete.pipeline.effectiveStatus, "completed");
  assert.equal(complete.pipeline.isTerminal, true);
  assert.deepEqual(complete.stages.map((stage) => stage.stage), pipelineRecoveryStageOrder);

  const projectAuthority = bundle();
  projectAuthority.project.data = project("export");
  projectAuthority.manifest.data = manifest(project("completed"));
  const projectAuthoritySnapshot = buildProductionSnapshot(projectAuthority, generatedAt);
  assert.deepEqual(projectAuthoritySnapshot.project.isCompleted, { state: "known", value: false });
  assert.ok(projectAuthoritySnapshot.findings.some((item) => item.code === "project_manifest_status_mismatch"));

  const missingOutput = bundle();
  missingOutput.stageOutputs.research = { state: { status: "missing" } };
  const missingOutputSnapshot = buildProductionSnapshot(missingOutput, generatedAt);
  assert.equal(missingOutputSnapshot.stages[0].effectiveStatus, "inconsistent");
  assert.ok(missingOutputSnapshot.findings.some((item) => item.code === "completed_stage_missing_output"));

  const latestJobs = [
    job("research", "completed", "z-job", "2026-07-11T10:00:01.000Z"),
    job("research", "failed", "a-job", "2026-07-11T10:00:01.000Z"),
  ];
  assert.equal(selectLatestJob(latestJobs, "research")?.id, "a-job");

  const cancelledBundle = bundle();
  cancelledBundle.jobs.data = jobs([job("research", "cancelled")]);
  assert.equal(buildProductionSnapshot(cancelledBundle, generatedAt).stages[0].effectiveStatus, "cancelled");

  const runningMismatch = bundle();
  runningMismatch.jobs.data = jobs([job("research", "running")]);
  const runningMismatchSnapshot = buildProductionSnapshot(runningMismatch, generatedAt);
  assert.equal(runningMismatchSnapshot.stages[0].effectiveStatus, "inconsistent");
  assert.ok(runningMismatchSnapshot.findings.some((item) => item.code === "manifest_job_status_mismatch"));

  const multipleRunning = bundle();
  multipleRunning.jobs.data = jobs([job("research", "running"), job("script", "running")]);
  assert.ok(buildProductionSnapshot(multipleRunning, generatedAt).findings.some((item) => item.code === "multiple_running_jobs"));

  const blockedQueue = bundle();
  blockedQueue.jobs.data = jobs([job("research", "failed"), job("script", "queued")]);
  const blockedQueueSnapshot = buildProductionSnapshot(blockedQueue, generatedAt);
  assert.deepEqual(blockedQueueSnapshot.queue.blockedReason, { state: "known", value: 'Stage "research" is failed.' });
  assert.equal(blockedQueueSnapshot.queue.nextCandidate.state, "not_recorded");

  const missingJobs = bundle();
  missingJobs.jobs = { state: { status: "missing" } };
  const missingJobsSnapshot = buildProductionSnapshot(missingJobs, generatedAt);
  assert.equal(missingJobsSnapshot.sourceState.jobs.status, "missing");
  assert.equal(missingJobsSnapshot.queue.nextCandidate.state, "source_missing");

  const malformedHistory = bundle();
  malformedHistory.history = { state: { status: "malformed" } };
  const malformedHistorySnapshot = buildProductionSnapshot(malformedHistory, generatedAt);
  assert.equal(malformedHistorySnapshot.sourceState.history.status, "malformed");
  assert.equal(malformedHistorySnapshot.history.successRate.state, "source_malformed");

  const unreadableUsage = bundle();
  unreadableUsage.aiUsage = { state: { status: "unreadable" } };
  assert.equal(buildProductionSnapshot(unreadableUsage, generatedAt).sourceState.aiUsage.status, "unreadable");

  const emptyUsageSnapshot = buildProductionSnapshot(bundle(), generatedAt);
  assert.equal(emptyUsageSnapshot.usage.totalRequests, 0);
  assert.equal(emptyUsageSnapshot.usage.availableTotalTokens.value.state, "not_recorded");

  const partialUsage = bundle();
  partialUsage.aiUsage.data = usage([
    usageRecord("u1", "openai", "gpt-model", 10, 0.1),
    usageRecord("u2", "mock", undefined),
  ]);
  const partialUsageSnapshot = buildProductionSnapshot(partialUsage, generatedAt);
  assert.equal(partialUsageSnapshot.usage.availableTotalTokens.coverage, 0.5);
  assert.equal(partialUsageSnapshot.usage.availableEstimatedCost.coverage, 0.5);
  assert.deepEqual(partialUsageSnapshot.usage.providerDistribution, [
    { name: "mock", count: 1 },
    { name: "openai", count: 1 },
  ]);
  assert.deepEqual(partialUsageSnapshot.usage.modelDistribution, [
    { name: "gpt-model", count: 1 },
  ]);

  assert.deepEqual(complete.history.successRate, { state: "known", value: 2 / 3 });
  assert.deepEqual(complete.history.averageCompletedDurationMs, { state: "known", value: 2000 });

  const completedWithoutExport = bundle();
  completedWithoutExport.stageOutputs.export = { state: { status: "missing" } };
  assert.ok(buildProductionSnapshot(completedWithoutExport, generatedAt).findings.some((item) => item.code === "project_completed_export_not_completed"));

  const exportWithoutProject = bundle();
  exportWithoutProject.project.data = project("export");
  exportWithoutProject.manifest.data = manifest(project("export"));
  assert.ok(buildProductionSnapshot(exportWithoutProject, generatedAt).findings.some((item) => item.code === "export_completed_project_not_completed"));

  const deterministicBundle = bundle();
  assert.deepEqual(
    buildProductionSnapshot(deterministicBundle, generatedAt),
    buildProductionSnapshot(deterministicBundle, generatedAt),
  );

  const mutationBundle = bundle();
  const mutationBefore = cloneBundle(mutationBundle);
  buildProductionSnapshot(mutationBundle, generatedAt);
  assert.deepEqual(mutationBundle, mutationBefore);

  await verifyFilesystemReadOnly();

  console.log("Sprint 95.3 production snapshot builder smoke: PASS (24 scenarios)");
}

async function verifyFilesystemReadOnly() {
  await fs.rm(projectFolder, { recursive: true, force: true });
  await fs.mkdir(projectFolder, { recursive: true });

  try {
    const sourceBundle = bundle();
    await writeJson("project.json", sourceBundle.project.data);
    await writeJson("manifest.json", sourceBundle.manifest.data);
    await writeJson("pipeline-jobs.json", sourceBundle.jobs.data);
    await writeJson("pipeline-history.json", sourceBundle.history.data);
    await writeJson("ai-usage.json", sourceBundle.aiUsage.data);
    for (const stage of pipelineRecoveryStageOrder) {
      await writeJson(`${stage}.json`, { stage });
    }

    const before = await captureFiles();
    const snapshot = await ProductionSnapshotBuilder.build(slug, generatedAt);
    const after = await captureFiles();
    assert.equal(snapshot.pipeline.effectiveStatus, "completed");
    assert.deepEqual(after, before);

    await fs.rm(path.join(projectFolder, "pipeline-jobs.json"));
    const missingJobsBefore = await captureFiles();
    const partial = await ProductionSnapshotBuilder.build(slug, generatedAt);
    const missingJobsAfter = await captureFiles();
    assert.equal(partial.sourceState.jobs.status, "missing");
    assert.deepEqual(missingJobsAfter, missingJobsBefore);
    await assert.rejects(fs.access(path.join(projectFolder, "pipeline-jobs.json")));
  } finally {
    await fs.rm(projectFolder, { recursive: true, force: true });
  }
}

async function writeJson(fileName: string, value: unknown) {
  await fs.writeFile(
    path.join(projectFolder, fileName),
    JSON.stringify(value, null, 2),
    "utf-8",
  );
}

async function captureFiles() {
  const names = (await fs.readdir(projectFolder)).sort(compareText);
  return Promise.all(
    names.map(async (name) => {
      const filePath = path.join(projectFolder, name);
      const [content, stat] = await Promise.all([
        fs.readFile(filePath, "utf-8"),
        fs.stat(filePath),
      ]);
      return { name, content, mtimeMs: stat.mtimeMs, size: stat.size };
    }),
  );
}

function compareText(left: string, right: string) {
  return left === right ? 0 : left < right ? -1 : 1;
}

void main();
