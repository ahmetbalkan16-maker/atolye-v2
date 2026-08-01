import fs from "node:fs/promises";
import { PipelineJobManager } from
  "../../src/lib/pipeline/PipelineJobManager";
import { installCanonicalStaleObservationTestHook,
  readCanonicalProcessStartEpochMs } from
  "../../src/lib/pipeline/PipelineJobMutationLock";
import path from "node:path";
import { ProjectReader } from "../../src/lib/projects/ProjectReader";

async function waitFor(file: string) {
  for (let attempt = 0; attempt < 2_000; attempt += 1) {
    try { await fs.access(file); return; } catch { /* retry */ }
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`timed out waiting for ${path.basename(file)}`);
}

async function main() {
  const [projectSlug, jobId, attemptedFile, mode, signalFile, releaseFile] = process.argv.slice(2);
  if (!projectSlug || !jobId || !attemptedFile) throw new Error("child arguments missing");
  if (mode !== "stale-remover" && mode !== "live-replacement") {
    await fs.writeFile(attemptedFile, "attempted\n", { encoding: "utf8", flag: "wx" });
  }
  if (mode === "seed") {
    const jobs = await PipelineJobManager.listJobs(projectSlug);
    process.stdout.write(`${JSON.stringify({ decision: "seed-observed", jobs: jobs.jobs.length })}\n`);
    return;
  }
  if (mode === "stale-remover") {
    if (!signalFile) throw new Error("stale remover signal missing");
    const restore = installCanonicalStaleObservationTestHook(async () => {
      await fs.writeFile(attemptedFile, "observed\n");
      await waitFor(signalFile);
    });
    try {
      await assertOwnershipLoss(projectSlug, jobId);
      process.stdout.write(`${JSON.stringify({ decision: "ownership-loss-preserved" })}\n`);
    } finally { restore(); }
    return;
  }
  if (mode === "live-replacement") {
    if (!signalFile || !releaseFile) throw new Error("replacement signals missing");
    const projectFolder = path.resolve(ProjectReader.getProjectFolder(projectSlug));
    const canonical = path.join(projectFolder, ".pipeline-jobs.lock");
    const preserved = path.join(projectFolder, ".pipeline-jobs.stale-a-preserved");
    await fs.rename(canonical, preserved);
    await fs.mkdir(canonical);
    const processStartEpochMs = await readCanonicalProcessStartEpochMs(process.pid);
    if (processStartEpochMs === null) throw new Error("replacement process identity unavailable");
    const owner = { schemaVersion: "2", projectSlug, projectFolder, jobId,
      ownerNonce: `live-owner-b-${process.pid}`, pid: process.pid, processStartEpochMs,
      acquiredAt: new Date().toISOString() };
    await fs.writeFile(path.join(canonical, "owner.json"), `${JSON.stringify(owner)}\n`, "utf8");
    await fs.writeFile(signalFile, "replaced\n");
    await waitFor(releaseFile);
    process.stdout.write(`${JSON.stringify({ decision: "live-owner-b-preserved" })}\n`);
    return;
  }
  let decision = "unknown";
  await PipelineJobManager.withProjectLock(projectSlug, async () => {
    const current = await PipelineJobManager.listJobsReadOnly(projectSlug);
    const job = current.jobs.find((item) => item.id === jobId);
    if (job?.status !== "queued" || job.attempts !== 3) {
      decision = "conflict";
      return;
    }
    const updatedAt = "2026-07-04T00:00:00.000Z";
    await PipelineJobManager.writeJobListUnderLock(projectSlug, {
      ...current,
      jobs: current.jobs.map((item) => item.id === jobId
        ? { ...item, updatedAt }
        : item),
      updatedAt,
    });
    decision = "competing-write-committed";
  }, jobId);
  process.stdout.write(`${JSON.stringify({ decision })}\n`);
}

async function assertOwnershipLoss(projectSlug: string, jobId: string) {
  try {
    await PipelineJobManager.withProjectLock(projectSlug, async () => undefined, jobId);
    throw new Error("stale remover unexpectedly acquired replacement");
  } catch (error) {
    if (!(error instanceof Error) ||
      !/STALE_OBSERVATION_CHANGED|OWNERSHIP_CHANGED/.test(error.message)) throw error;
  }
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : "child failed"}\n`);
  process.exitCode = 1;
});
