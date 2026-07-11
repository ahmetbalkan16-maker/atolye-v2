import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { PipelineJobManager } from "../src/lib/pipeline/PipelineJobManager";
import type {
  PipelineJob,
  PipelineJobHistory,
  PipelineJobHistoryEvent,
} from "../src/types/pipelineJob";

const slug = `sprint-90-history-smoke-${process.pid}`;
const projectFolder = path.join(process.cwd(), "data", "projects", slug);
const historyFile = path.join(projectFolder, "pipeline-history.json");
const createdAt = "2026-07-11T00:00:00.000Z";

function historyEvent(
  suffix: string,
  status: PipelineJobHistoryEvent["status"],
  recordedAt: string,
): PipelineJobHistoryEvent {
  return {
    id: `${slug}-research-${status}-${suffix}`,
    jobId: `${slug}-research`,
    stage: "research",
    status,
    jobCreatedAt: createdAt,
    jobUpdatedAt: recordedAt,
    recordedAt,
  };
}

function history(events: PipelineJobHistoryEvent[]): PipelineJobHistory {
  return {
    projectSlug: slug,
    events,
    createdAt,
    updatedAt: events.at(-1)?.recordedAt ?? createdAt,
  };
}

function terminalJob(
  status: "completed" | "failed" | "cancelled",
  now: string,
): PipelineJob {
  return {
    id: `${slug}-research`,
    projectSlug: slug,
    stage: "research",
    title: "Research",
    status,
    attempts: 1,
    createdAt,
    updatedAt: now,
    startedAt: createdAt,
    completedAt: now,
    error: status === "failed" ? "failed" : undefined,
    cancelRequestedAt: status === "cancelled" ? now : undefined,
  };
}

async function writeHistory(value: PipelineJobHistory) {
  await fs.mkdir(projectFolder, { recursive: true });
  await fs.writeFile(historyFile, JSON.stringify(value, null, 2), "utf-8");
}

async function readHistoryFile() {
  return JSON.parse(
    await fs.readFile(historyFile, "utf-8"),
  ) as PipelineJobHistory;
}

async function record(job: PipelineJob, now: string) {
  await PipelineJobManager["recordHistoryEvent"](slug, job, now);
}

async function testSuccessfulWrite() {
  await fs.rm(projectFolder, { recursive: true, force: true });
  const now = "2026-07-11T00:01:00.000Z";

  await record(terminalJob("completed", now), now);

  const stored = await readHistoryFile();
  assert.equal(stored.projectSlug, slug);
  assert.equal(stored.events.length, 1);
  assert.equal(stored.events[0].status, "completed");
  assert.equal(stored.events[0].recordedAt, now);
  assert.equal(stored.updatedAt, now);
}

async function testReplacementOrderingAndRetention() {
  const first = historyEvent(
    "first",
    "completed",
    "2026-07-11T00:01:00.000Z",
  );
  const second = historyEvent(
    "second",
    "failed",
    "2026-07-11T00:02:00.000Z",
  );
  await writeHistory(history([first, second]));
  const previousBytes = await fs.readFile(historyFile, "utf-8");
  const now = "2026-07-11T00:03:00.000Z";

  await record(terminalJob("cancelled", now), now);

  const replacementBytes = await fs.readFile(historyFile, "utf-8");
  const stored = JSON.parse(replacementBytes) as PipelineJobHistory;
  assert.notEqual(replacementBytes, previousBytes);
  assert.equal(stored.events.length, 3);
  assert.deepEqual(
    stored.events.map((event) => event.id),
    [first.id, second.id, `${slug}-research-cancelled-${now}`],
  );
  assert.equal(stored.events[2].status, "cancelled");
  assert.equal(stored.updatedAt, now);
}

async function testRenameFailurePreservesDestination() {
  const previous = history([
    historyEvent("stable", "completed", "2026-07-11T00:04:00.000Z"),
  ]);
  await writeHistory(previous);
  const previousBytes = await fs.readFile(historyFile, "utf-8");
  const originalRename = fs.rename;
  const originalRm = fs.rm;
  const persistenceError = new Error("injected history rename failure");
  const cleanupPaths: string[] = [];

  fs.rename = (async () => {
    throw persistenceError;
  }) as typeof fs.rename;
  fs.rm = (async (target, options) => {
    cleanupPaths.push(target.toString());
    return originalRm(target, options);
  }) as typeof fs.rm;

  try {
    await assert.rejects(
      record(
        terminalJob("failed", "2026-07-11T00:05:00.000Z"),
        "2026-07-11T00:05:00.000Z",
      ),
      (error) => error === persistenceError,
    );
  } finally {
    fs.rename = originalRename;
    fs.rm = originalRm;
  }

  const currentBytes = await fs.readFile(historyFile, "utf-8");
  assert.equal(currentBytes, previousBytes);
  assert.deepEqual(JSON.parse(currentBytes), previous);
  assert.equal(cleanupPaths.length, 1);
  assert.match(cleanupPaths[0], /\.pipeline-history\.json\..+\.tmp$/);
  assert.equal(
    (await fs.readdir(projectFolder)).some((file) => file.endsWith(".tmp")),
    false,
  );
}

async function testTempWriteFailurePreservesDestination() {
  const previous = history([
    historyEvent("stable-write", "failed", "2026-07-11T00:06:00.000Z"),
  ]);
  await writeHistory(previous);
  const previousBytes = await fs.readFile(historyFile, "utf-8");
  const originalWriteFile = fs.writeFile;
  const originalRm = fs.rm;
  const persistenceError = new Error("injected history temp write failure");
  let cleanupAttempts = 0;

  fs.writeFile = (async (target, data, options) => {
    if (target.toString().endsWith(".tmp")) {
      throw persistenceError;
    }

    return originalWriteFile(target, data, options);
  }) as typeof fs.writeFile;
  fs.rm = (async (target, options) => {
    cleanupAttempts += 1;
    return originalRm(target, options);
  }) as typeof fs.rm;

  try {
    await assert.rejects(
      record(
        terminalJob("completed", "2026-07-11T00:07:00.000Z"),
        "2026-07-11T00:07:00.000Z",
      ),
      (error) => error === persistenceError,
    );
  } finally {
    fs.writeFile = originalWriteFile;
    fs.rm = originalRm;
  }

  const currentBytes = await fs.readFile(historyFile, "utf-8");
  assert.equal(currentBytes, previousBytes);
  assert.deepEqual(JSON.parse(currentBytes), previous);
  assert.equal(cleanupAttempts, 1);
  assert.equal(
    (await fs.readdir(projectFolder)).some((file) => file.endsWith(".tmp")),
    false,
  );
}

async function main() {
  try {
    await testSuccessfulWrite();
    await testReplacementOrderingAndRetention();
    await testRenameFailurePreservesDestination();
    await testTempWriteFailurePreservesDestination();
    console.log("Sprint 90 pipeline history persistence smoke: PASS (6 cases)");
  } finally {
    await fs.rm(projectFolder, { recursive: true, force: true });
  }
}

void main();
