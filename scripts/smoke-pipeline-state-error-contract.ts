import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { GET as getJobs } from "../app/api/projects/[slug]/pipeline/jobs/route";
import { GET as getHistory } from "../app/api/projects/[slug]/pipeline/history/route";
import { POST as retryPipeline } from "../app/api/projects/[slug]/pipeline/retry/route";
import { POST as runPipeline } from "../app/api/pipeline/route";
import { PipelineRunner } from "../src/lib/pipeline/PipelineRunner";
import { PipelineJobManager } from "../src/lib/pipeline/PipelineJobManager";
import { PipelineQueueScheduler } from "../src/lib/pipeline/PipelineQueueScheduler";
import { PipelineRecoveryPlanner } from "../src/lib/pipeline/PipelineRecoveryPlanner";
import { PipelineStageExecutor } from "../src/lib/pipeline/PipelineStageExecutor";
import {
  PipelineStateError,
  getPipelineStatePublicError,
  isPipelineStateError,
} from "../src/lib/pipeline/PipelineStateError";
import { ProjectManager } from "../src/lib/projects/ProjectManager";
import { ProjectReader } from "../src/lib/projects/ProjectReader";
import type {
  PipelineJob,
  PipelineJobHistory,
  PipelineJobList,
} from "../src/types/pipelineJob";

const slug = `sprint-92-error-contract-${process.pid}`;
const projectFolder = path.join(process.cwd(), "data", "projects", slug);
const jobsFile = path.join(projectFolder, "pipeline-jobs.json");
const historyFile = path.join(projectFolder, "pipeline-history.json");
const now = "2026-07-11T00:00:00.000Z";
const context = { params: Promise.resolve({ slug }) };

const job: PipelineJob = {
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

function jobs(jobsValue: PipelineJob[]): PipelineJobList {
  return {
    projectSlug: slug,
    jobs: jobsValue,
    createdAt: now,
    updatedAt: now,
  };
}

function history(withEvent: boolean): PipelineJobHistory {
  return {
    projectSlug: slug,
    events: withEvent
      ? [
          {
            id: `${job.id}-completed-${now}`,
            jobId: job.id,
            stage: job.stage,
            status: "completed",
            startedAt: now,
            completedAt: now,
            jobCreatedAt: now,
            jobUpdatedAt: now,
            recordedAt: now,
          },
        ]
      : [],
    createdAt: now,
    updatedAt: now,
  };
}

async function writeRaw(file: string, value: string) {
  await fs.mkdir(projectFolder, { recursive: true });
  await fs.writeFile(file, value, "utf-8");
}

async function readResponse(response: Response) {
  return {
    status: response.status,
    body: (await response.json()) as Record<string, unknown>,
  };
}

function assertSafeStateError(
  response: Awaited<ReturnType<typeof readResponse>>,
  code: string,
  message: string,
  rawMarker: string,
) {
  assert.equal(response.status, 500);
  assert.equal(response.body.success, false);
  assert.equal(response.body.code, code);
  assert.equal(response.body.error, message);
  assert.deepEqual(Object.keys(response.body).sort(), [
    "code",
    "error",
    "success",
  ]);

  const serialized = JSON.stringify(response.body);
  for (const forbidden of [
    rawMarker,
    projectFolder,
    "C:\\private\\pipeline-state.json",
    "/var/lib/atolye/private/pipeline-state.json",
    "EACCES",
    "permission denied",
    "InjectedFilesystemError",
    " at ",
  ]) {
    assert.equal(serialized.includes(forbidden), false);
  }
}

async function testMalformedJobs() {
  const marker = "RAW_MALFORMED_JOBS_MARKER";
  await writeRaw(jobsFile, `{"${marker}": [}`);
  const response = await readResponse(await getJobs(new Request("http://local"), context));

  assertSafeStateError(
    response,
    "PIPELINE_JOBS_STATE_MALFORMED",
    "Pipeline jobs state could not be read.",
    marker,
  );
}

async function testInvalidJobs() {
  const marker = "RAW_INVALID_JOBS_MARKER";
  await writeRaw(
    jobsFile,
    JSON.stringify({
      projectSlug: slug,
      jobs: [{ marker }],
      createdAt: now,
      updatedAt: now,
    }),
  );
  const response = await readResponse(await getJobs(new Request("http://local"), context));

  assertSafeStateError(
    response,
    "PIPELINE_JOBS_STATE_INVALID",
    "Pipeline jobs state could not be read.",
    marker,
  );
}

async function testMalformedHistory() {
  const marker = "RAW_MALFORMED_HISTORY_MARKER";
  await writeRaw(historyFile, `{"${marker}": }`);
  const response = await readResponse(
    await getHistory(new Request("http://local"), context),
  );

  assertSafeStateError(
    response,
    "PIPELINE_HISTORY_STATE_MALFORMED",
    "Pipeline history state could not be read.",
    marker,
  );
}

async function testInvalidHistory() {
  const marker = "RAW_INVALID_HISTORY_MARKER";
  await writeRaw(
    historyFile,
    JSON.stringify({
      projectSlug: slug,
      events: [{ marker }],
      createdAt: now,
      updatedAt: now,
    }),
  );
  const response = await readResponse(
    await getHistory(new Request("http://local"), context),
  );

  assertSafeStateError(
    response,
    "PIPELINE_HISTORY_STATE_INVALID",
    "Pipeline history state could not be read.",
    marker,
  );
}

async function testReadFailure() {
  const originalReadJSONState = ProjectReader.readJSONState;
  const marker = "RAW_READ_FAILURE_MARKER";
  const injectedError = new Error(
    `InjectedFilesystemError: EACCES permission denied C:\\private\\pipeline-state.json /var/lib/atolye/private/pipeline-state.json ${marker}\n at readFile (/var/lib/atolye/private/reader.js:1:1)`,
  );

  ProjectReader.readJSONState = async () => {
    throw injectedError;
  };

  try {
    let internalError: unknown;

    try {
      await PipelineJobManager["readJobList"](slug);
    } catch (error) {
      internalError = error;
    }

    assert.equal(isPipelineStateError(internalError), true);
    assert.equal((internalError as PipelineStateError).cause, injectedError);

    const logged: unknown[][] = [];
    const currentConsoleError = console.error;
    console.error = (...args: unknown[]) => {
      logged.push(args);
    };
    let response: Awaited<ReturnType<typeof readResponse>>;

    try {
      response = await readResponse(
        await getJobs(new Request("http://local"), context),
      );
    } finally {
      console.error = currentConsoleError;
    }
    assertSafeStateError(
      response,
      "PIPELINE_JOBS_STATE_READ_FAILED",
      "Pipeline jobs state could not be read.",
      marker,
    );
    assert.equal(logged.length, 1);
    assert.equal(
      (logged[0][1] as { cause?: unknown }).cause,
      injectedError,
    );
  } finally {
    ProjectReader.readJSONState = originalReadJSONState;
  }
}

async function testHistoryReadFailure() {
  const originalReadJSONState = ProjectReader.readJSONState;
  const marker = "RAW_HISTORY_READ_FAILURE_MARKER";
  const injectedError = new Error(
    `InjectedFilesystemError: EACCES permission denied C:\\private\\pipeline-state.json /var/lib/atolye/private/pipeline-state.json ${marker}\n at readFile (/var/lib/atolye/private/reader.js:1:1)`,
  );

  ProjectReader.readJSONState = async () => {
    throw injectedError;
  };

  try {
    let internalError: unknown;

    try {
      await PipelineJobManager.listHistory(slug);
    } catch (error) {
      internalError = error;
    }

    assert.equal(isPipelineStateError(internalError), true);
    assert.equal((internalError as PipelineStateError).cause, injectedError);

    const response = await readResponse(
      await getHistory(new Request("http://local"), context),
    );
    assertSafeStateError(
      response,
      "PIPELINE_HISTORY_STATE_READ_FAILED",
      "Pipeline history state could not be read.",
      marker,
    );
  } finally {
    ProjectReader.readJSONState = originalReadJSONState;
  }
}

function testRobustDiscrimination() {
  const brandedError = new PipelineStateError(
    "jobs",
    "malformed",
    "pipeline-jobs.json",
  );
  Object.setPrototypeOf(brandedError, Error.prototype);

  assert.equal(brandedError instanceof PipelineStateError, false);
  assert.equal(isPipelineStateError(brandedError), true);
  assert.deepEqual(getPipelineStatePublicError(brandedError), {
    code: "PIPELINE_JOBS_STATE_MALFORMED",
    message: "Pipeline jobs state could not be read.",
  });

  const forged = {
    name: "PipelineStateError",
    state: "jobs",
    failure: "malformed",
    fileName: "pipeline-jobs.json",
    code: "PIPELINE_JOBS_STATE_MALFORMED",
  };
  assert.equal(isPipelineStateError(forged), false);
  assert.equal(getPipelineStatePublicError(forged), null);
}

async function testValidResponses() {
  const emptyJobs = jobs([]);
  const emptyHistory = history(false);
  await writeRaw(jobsFile, JSON.stringify(emptyJobs, null, 2));
  await writeRaw(historyFile, JSON.stringify(emptyHistory, null, 2));

  const emptyJobsResponse = await readResponse(
    await getJobs(new Request("http://local"), context),
  );
  const emptyHistoryResponse = await readResponse(
    await getHistory(new Request("http://local"), context),
  );
  assert.deepEqual(emptyJobsResponse, {
    status: 200,
    body: { success: true, jobs: emptyJobs },
  });
  assert.deepEqual(emptyHistoryResponse, {
    status: 200,
    body: { success: true, history: emptyHistory },
  });

  const populatedJobs = jobs([job]);
  const populatedHistory = history(true);
  await writeRaw(jobsFile, JSON.stringify(populatedJobs, null, 2));
  await writeRaw(historyFile, JSON.stringify(populatedHistory, null, 2));

  const populatedJobsResponse = await readResponse(
    await getJobs(new Request("http://local"), context),
  );
  const populatedHistoryResponse = await readResponse(
    await getHistory(new Request("http://local"), context),
  );
  assert.deepEqual(populatedJobsResponse, {
    status: 200,
    body: { success: true, jobs: populatedJobs },
  });
  assert.deepEqual(populatedHistoryResponse, {
    status: 200,
    body: { success: true, history: populatedHistory },
  });
}

async function testRetryConflict() {
  const originalRetryStage = PipelineRunner.retryStage;
  PipelineRunner.retryStage = async () => ({
    success: false,
    status: 409,
    projectSlug: slug,
    retriedStage: "research",
    completedStages: [],
    blocked: true,
    reason: "Dependency is not ready.",
    plan: {
      projectSlug: slug,
      type: "retry",
      startStage: "research",
      stagesToRun: ["research"],
      blocked: true,
      reason: "Dependency is not ready.",
      dependencies: [],
      createdAt: now,
    },
  });

  try {
    const response = await readResponse(
      await retryPipeline(
        new Request("http://local", {
          method: "POST",
          body: JSON.stringify({ stage: "research" }),
          headers: { "content-type": "application/json" },
        }),
        context,
      ),
    );
    assert.equal(response.status, 409);
    assert.equal(response.body.success, false);
    assert.equal(response.body.blocked, true);
    assert.equal(response.body.error, "Dependency is not ready.");
  } finally {
    PipelineRunner.retryStage = originalRetryStage;
  }
}

async function testNotFoundAndUnexpectedError() {
  const currentGetProject = ProjectManager.getProject;
  ProjectManager.getProject = async () => null;

  try {
    const notFound = await readResponse(
      await getJobs(new Request("http://local"), context),
    );
    assert.deepEqual(notFound, {
      status: 404,
      body: { success: false, error: "Project not found." },
    });
  } finally {
    ProjectManager.getProject = currentGetProject;
  }

  const originalListJobs = PipelineJobManager.listJobs;
  PipelineJobManager.listJobs = async () => {
    throw new Error("Unexpected non-state error.");
  };

  try {
    const response = await readResponse(
      await getJobs(new Request("http://local"), context),
    );
    assert.deepEqual(response, {
      status: 500,
      body: {
        success: false,
        error: "Pipeline jobs could not be read.",
      },
    });
  } finally {
    PipelineJobManager.listJobs = originalListJobs;
  }
}

async function testRetryStatePropagationAndGenericFailures() {
  const manager = PipelineJobManager as any;
  const planner = PipelineRecoveryPlanner as any;
  const scheduler = PipelineQueueScheduler as any;
  const executor = PipelineStageExecutor as any;
  const runner = PipelineRunner as any;
  const originals = {
    getJobForStageReadOnly: manager.getJobForStageReadOnly,
    getJobReadOnly: manager.getJobReadOnly,
    prepareJobRetry: manager.prepareJobRetry,
    compensatePreparedRetry: manager.compensatePreparedRetry,
    startStage: manager.startStage,
    persistStageFailure: manager.persistStageFailure,
    createJobRetryPlan: planner.createJobRetryPlan,
    getNextRunnableStage: scheduler.getNextRunnableStage,
    loadState: executor.loadState,
    runPipelineStage: runner.runPipelineStage,
  };
  const failedJob: PipelineJob = {
    ...job,
    status: "failed",
    error: "failed",
  };
  const preparedJob: PipelineJob = {
    ...failedJob,
    status: "queued",
    attempts: failedJob.attempts + 1,
    error: undefined,
  };
  const plan = {
    projectSlug: slug,
    type: "retry" as const,
    startStage: "research" as const,
    stagesToRun: ["research" as const],
    blocked: false,
    dependencies: [],
    createdAt: now,
  };

  manager.getJobForStageReadOnly = async () => failedJob;
  manager.getJobReadOnly = async () => failedJob;
  manager.prepareJobRetry = async () => ({
    success: true,
    job: preparedJob,
    previousJob: failedJob,
    jobs: jobs([preparedJob]),
  });
  planner.createJobRetryPlan = async () => plan;
  executor.loadState = async () => ({});
  manager.startStage = async () => true;

  try {
    const historyError = new PipelineStateError(
      "history",
      "invalid",
      "pipeline-history.json",
    );
    scheduler.getNextRunnableStage = async () => ({ stage: "research" });
    let failurePersistenceCalls = 0;
    manager.persistStageFailure = async () => {
      failurePersistenceCalls += 1;
      return true;
    };
    runner.runPipelineStage = async () =>
      runner.runStage(
        slug,
        "research",
        async () => {
          throw historyError;
        },
        "retry",
      );

    const logs: unknown[][] = [];
    const currentConsoleError = console.error;
    console.error = (...args: unknown[]) => {
      logs.push(args);
    };
    let typedResponse: Awaited<ReturnType<typeof readResponse>>;

    try {
      typedResponse = await readResponse(
        await retryPipeline(
          new Request("http://local", {
            method: "POST",
            body: JSON.stringify({ stage: "research" }),
            headers: { "content-type": "application/json" },
          }),
          context,
        ),
      );
    } finally {
      console.error = currentConsoleError;
    }

    assertSafeStateError(
      typedResponse,
      "PIPELINE_HISTORY_STATE_INVALID",
      "Pipeline history state could not be read.",
      "unused-marker",
    );
    assert.equal(logs.length, 1);
    assert.equal(failurePersistenceCalls, 0);

    const compensationStateError = new PipelineStateError(
      "jobs",
      "malformed",
      "pipeline-jobs.json",
    );
    scheduler.getNextRunnableStage = async () => ({
      stage: null,
      reason: "scheduler blocked",
    });
    manager.compensatePreparedRetry = async () => {
      throw compensationStateError;
    };
    await assert.rejects(
      PipelineRunner.executeJobRetry(slug, failedJob.id),
      (error) => error === compensationStateError,
    );

    const compensationFailure = new Error("non-state compensation failure");
    manager.compensatePreparedRetry = async () => {
      throw compensationFailure;
    };
    const genericCompensation = await PipelineRunner.executeJobRetry(
      slug,
      failedJob.id,
    );
    assert.equal(genericCompensation.status, 500);
    assert.equal(genericCompensation.blocked, false);
    assert.equal(
      genericCompensation.reason,
      "Pipeline retry compensation failed.",
    );

    scheduler.getNextRunnableStage = async () => ({ stage: "research" });
    runner.runPipelineStage = async () => {
      throw new Error("non-state execution failure");
    };
    const genericExecution = await PipelineRunner.executeJobRetry(
      slug,
      failedJob.id,
    );
    assert.equal(genericExecution.status, 500);
    assert.equal(genericExecution.blocked, false);
    assert.equal(genericExecution.reason, "Pipeline retry execution failed.");
  } finally {
    Object.assign(manager, {
      getJobForStageReadOnly: originals.getJobForStageReadOnly,
      getJobReadOnly: originals.getJobReadOnly,
      prepareJobRetry: originals.prepareJobRetry,
      compensatePreparedRetry: originals.compensatePreparedRetry,
      startStage: originals.startStage,
      persistStageFailure: originals.persistStageFailure,
    });
    planner.createJobRetryPlan = originals.createJobRetryPlan;
    scheduler.getNextRunnableStage = originals.getNextRunnableStage;
    executor.loadState = originals.loadState;
    runner.runPipelineStage = originals.runPipelineStage;
  }
}

async function testMainPipelineSingleTypedLog() {
  const projectManager = ProjectManager as any;
  const executor = PipelineStageExecutor as any;
  const runner = PipelineRunner as any;
  const originals = {
    createSlug: projectManager.createSlug,
    createProject: projectManager.createProject,
    createInitialState: executor.createInitialState,
    runScheduledStages: runner.runScheduledStages,
  };
  const stateError = new PipelineStateError(
    "jobs",
    "invalid",
    "pipeline-jobs.json",
  );
  projectManager.createSlug = () => slug;
  projectManager.createProject = async () => ({
    id: slug,
    slug,
    title: "Sprint 92 Smoke",
    status: "draft",
    createdAt: now,
    updatedAt: now,
  });
  executor.createInitialState = () => ({});
  runner.runScheduledStages = async () => {
    throw stateError;
  };

  const logs: unknown[][] = [];
  const currentConsoleError = console.error;
  console.error = (...args: unknown[]) => {
    logs.push(args);
  };

  try {
    const response = await readResponse(
      await runPipeline(
        new Request("http://local", {
          method: "POST",
          body: JSON.stringify({ topic: "Sprint 92 Smoke" }),
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    assertSafeStateError(
      response,
      "PIPELINE_JOBS_STATE_INVALID",
      "Pipeline jobs state could not be read.",
      "unused-marker",
    );
    assert.equal(logs.length, 1);
  } finally {
    console.error = currentConsoleError;
    projectManager.createSlug = originals.createSlug;
    projectManager.createProject = originals.createProject;
    executor.createInitialState = originals.createInitialState;
    runner.runScheduledStages = originals.runScheduledStages;
  }
}

async function main() {
  const originalGetProject = ProjectManager.getProject;
  const originalEnsureManifest = ProjectManager.ensureManifest;
  const originalConsoleError = console.error;
  ProjectManager.getProject = async () => ({
    id: slug,
    slug,
    title: "Sprint 92 Smoke",
    status: "draft",
    createdAt: now,
    updatedAt: now,
  });
  ProjectManager.ensureManifest = async () => null;
  console.error = () => {};

  try {
    await testMalformedJobs();
    await testInvalidJobs();
    await testMalformedHistory();
    await testInvalidHistory();
    await testReadFailure();
    await testHistoryReadFailure();
    testRobustDiscrimination();
    await testValidResponses();
    await testRetryConflict();
    await testNotFoundAndUnexpectedError();
    await testRetryStatePropagationAndGenericFailures();
    await testMainPipelineSingleTypedLog();
    console.log("Sprint 92 pipeline state error contract smoke: PASS (18 cases)");
  } finally {
    ProjectManager.getProject = originalGetProject;
    ProjectManager.ensureManifest = originalEnsureManifest;
    console.error = originalConsoleError;
    await fs.rm(projectFolder, { recursive: true, force: true });
  }
}

void main();
