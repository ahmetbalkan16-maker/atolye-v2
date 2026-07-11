import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { PipelineJobManager } from "../src/lib/pipeline/PipelineJobManager";
import { PipelineStateError, type PipelineStateFailure } from "../src/lib/pipeline/PipelineStateError";
import type {
  PipelineJob,
  PipelineJobHistory,
  PipelineJobList,
} from "../src/types/pipelineJob";

const slug = `sprint-91-corruption-smoke-${process.pid}`;
const projectFolder = path.join(process.cwd(), "data", "projects", slug);
const jobsFile = path.join(projectFolder, "pipeline-jobs.json");
const historyFile = path.join(projectFolder, "pipeline-history.json");
const now = "2026-07-11T00:00:00.000Z";

const validJob: PipelineJob = {
  id: `${slug}-research`,
  projectSlug: slug,
  stage: "research",
  title: "Research",
  status: "completed",
  attempts: 1,
  createdAt: now,
  updatedAt: now,
  startedAt: now,
  completedAt: now,
};

const validJobs: PipelineJobList = {
  projectSlug: slug,
  jobs: [validJob],
  createdAt: now,
  updatedAt: now,
};

const validHistory: PipelineJobHistory = {
  projectSlug: slug,
  events: [
    {
      id: `${validJob.id}-completed-${now}`,
      jobId: validJob.id,
      stage: validJob.stage,
      status: "completed",
      startedAt: now,
      completedAt: now,
      jobCreatedAt: now,
      jobUpdatedAt: now,
      recordedAt: now,
    },
  ],
  createdAt: now,
  updatedAt: now,
};

async function writeRaw(file: string, content: string) {
  await fs.mkdir(projectFolder, { recursive: true });
  await fs.writeFile(file, content, "utf-8");
}

async function readJobs() {
  return PipelineJobManager["readJobList"](slug);
}

async function captureError(operation: () => Promise<unknown>) {
  try {
    await operation();
  } catch (error) {
    assert.ok(error instanceof Error);
    return error;
  }

  assert.fail("Expected pipeline state read to fail.");
}

function assertIdentifiedError(
  error: Error,
  fileName: string,
  failure: PipelineStateFailure,
  rawMarker: string,
) {
  assert.ok(error instanceof PipelineStateError);
  assert.match(error.message, new RegExp(fileName.replace(".", "\\.")));
  assert.equal(error.failure, failure);
  assert.equal(error.message.includes(rawMarker), false);
}

async function testMissingFiles() {
  await fs.rm(projectFolder, { recursive: true, force: true });

  const jobs = await readJobs();
  assert.equal(jobs.projectSlug, slug);
  assert.deepEqual(jobs.jobs, []);

  const history = await PipelineJobManager.listHistory(slug);
  assert.equal(history.projectSlug, slug);
  assert.deepEqual(history.events, []);
  await assert.rejects(fs.access(jobsFile));
  await assert.rejects(fs.access(historyFile));
}

async function testMalformedJobs() {
  const raw = '{"private-jobs-marker": [}';
  await writeRaw(jobsFile, raw);

  const error = await captureError(readJobs);
  assertIdentifiedError(
    error,
    "pipeline-jobs.json",
    "malformed",
    "private-jobs-marker",
  );
  assert.equal(await fs.readFile(jobsFile, "utf-8"), raw);
}

async function testMalformedHistory() {
  const raw = '{"private-history-marker": }';
  await writeRaw(historyFile, raw);

  const error = await captureError(() => PipelineJobManager.listHistory(slug));
  assertIdentifiedError(
    error,
    "pipeline-history.json",
    "malformed",
    "private-history-marker",
  );
  assert.equal(await fs.readFile(historyFile, "utf-8"), raw);
}

async function testStructurallyInvalidJobs() {
  const rawMarker = "private-invalid-jobs-marker";
  const raw = JSON.stringify({
    projectSlug: slug,
    jobs: [{ marker: rawMarker }],
    createdAt: now,
    updatedAt: now,
  });
  await writeRaw(jobsFile, raw);

  const error = await captureError(readJobs);
  assertIdentifiedError(
    error,
    "pipeline-jobs.json",
    "invalid",
    rawMarker,
  );
  assert.equal(await fs.readFile(jobsFile, "utf-8"), raw);
}

async function testStructurallyInvalidHistory() {
  const rawMarker = "private-invalid-history-marker";
  const raw = JSON.stringify({
    projectSlug: slug,
    events: [{ marker: rawMarker }],
    createdAt: now,
    updatedAt: now,
  });
  await writeRaw(historyFile, raw);

  const error = await captureError(() => PipelineJobManager.listHistory(slug));
  assertIdentifiedError(
    error,
    "pipeline-history.json",
    "invalid",
    rawMarker,
  );
  assert.equal(await fs.readFile(historyFile, "utf-8"), raw);
}

async function testValidPayloads() {
  await writeRaw(jobsFile, JSON.stringify(validJobs, null, 2));
  await writeRaw(historyFile, JSON.stringify(validHistory, null, 2));

  assert.deepEqual(await readJobs(), validJobs);
  assert.deepEqual(await PipelineJobManager.listHistory(slug), validHistory);
}

async function main() {
  try {
    await testMissingFiles();
    await testMalformedJobs();
    await testMalformedHistory();
    await testStructurallyInvalidJobs();
    await testStructurallyInvalidHistory();
    await testValidPayloads();
    console.log("Sprint 91 pipeline state corruption smoke: PASS (8 cases)");
  } finally {
    await fs.rm(projectFolder, { recursive: true, force: true });
  }
}

void main();
