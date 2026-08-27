import { PipelineRunner } from "../src/lib/pipeline/PipelineRunner";
import { initializeProductionProcessRuntime } from
  "../src/lib/runtime/ProductionRuntimeCompositionRoot";
import { PipelineJobManager } from "../src/lib/pipeline/PipelineJobManager";

/**
 * AUTHORIZED, SINGLE-USE real production execution ("EMİR — PRODUCTION
 * ASSEMBLY RETRY / GENERATION 3"): resumes i-stanbul-un-fethi-1453's
 * assembly stage through the real, established PipelineRunner.resume() API,
 * bounded with stopAfterStage: "assembly" so downstream stages
 * (thumbnail/seo/youtube/export) are never dispatched even on success.
 *
 * This is the retry attempt AFTER the generation-3 assembly job's first
 * (durable-ordinal 7 / job.attempts=6) failure recorded as
 * VIDEO_ASSEMBLY_FAILED. Unlike the earlier
 * apply-execute-assembly-istanbul-1453-gen3.ts (which required
 * job.status==="queued"), the job is now job.status==="failed" -- so this
 * call relies on PipelineRunner.resumeOnce()'s own internal handling
 * (src/lib/pipeline/PipelineRunner.ts, the `startJob?.status === "failed"`
 * branch), which calls prepareFailedStageRetry(projectSlug, jobId, "resume")
 * itself before dispatching the stage. No separate prepare step, retry
 * budget extension, or orphan-reservation tolerance authority is required:
 * this is job.attempts=6, attemptWithinGeneration=0 (the FIRST attempt
 * within generation 3), so prepareFailedStageRetry's ordinary
 * regeneration-aware budget (generationStartAttempt=6,
 * maxAttempts=6+pipelineRetryMaxAttempts(3)=9, admittedDurableOrdinal=8)
 * covers this attempt with no extension authority needed.
 *
 * Uses only the existing production execution / reservation / claim
 * mechanism (PipelineRunner.resume -> prepareFailedStageRetry ->
 * runScheduledStages), the real FFmpeg assembly provider, and real
 * generation-3 assets/animation/video/audio -- combined with the
 * just-approved AssemblyManager.mapScenes() identity-hardening fix.
 *
 * Every fail-closed precondition is re-verified fresh, immediately before
 * the call, against the real (non-copy) store. Any single failure aborts
 * with zero writes. Per the governing EMİR: on failure, this script and its
 * caller must STOP -- no automatic second attempt, repair, or code change.
 */

const projectSlug = "i-stanbul-un-fethi-1453";
const stage = "assembly" as const;
const jobId = `${projectSlug}-${stage}`;
const expectedRegenerationId = "pipeline-regen-fa313d09e9154ba3ef54928e9ba23dabd71259b7e6508d89";
const expectedGenerationOrdinal = 3;

function fail(reason: string): never {
  console.error(`BLOCKED: ${reason}`);
  process.exitCode = 1;
  throw new Error(reason);
}

async function main() {
  console.log("========== 1) fresh pre-flight ==========");

  for (const dependencyStage of ["animation", "video"] as const) {
    const dependencyJob = await PipelineJobManager.getJob(projectSlug, `${projectSlug}-${dependencyStage}`);
    if (!dependencyJob) fail(`${dependencyStage} job not found.`);
    if (dependencyJob!.status !== "completed") {
      fail(`${dependencyStage} job.status=${dependencyJob!.status}, expected "completed".`);
    }
    if (dependencyJob!.regenerationId !== expectedRegenerationId ||
      dependencyJob!.generationOrdinal !== expectedGenerationOrdinal) {
      fail(`${dependencyStage} job regeneration binding mismatch.`);
    }
  }
  console.log("dependencies (animation, video): both completed, correct regeneration binding -> OK");

  const job = await PipelineJobManager.getJob(projectSlug, jobId);
  if (!job) fail("job not found.");
  console.log(JSON.stringify(job, null, 2));

  if (job!.status !== "failed") fail(`job.status=${job!.status}, expected "failed".`);
  if (job!.attempts !== 7) fail(`job.attempts=${job!.attempts}, expected 7.`);
  if (job!.attemptWithinGeneration !== 1) {
    fail(`job.attemptWithinGeneration=${job!.attemptWithinGeneration}, expected 1.`);
  }
  if (job!.regenerationId !== expectedRegenerationId) {
    fail(`regenerationId=${job!.regenerationId}, expected ${expectedRegenerationId}.`);
  }
  if (job!.generationOrdinal !== expectedGenerationOrdinal) {
    fail(`generationOrdinal=${job!.generationOrdinal}, expected ${expectedGenerationOrdinal}.`);
  }
  if (job!.error !== "VIDEO_ASSEMBLY_FAILED") {
    fail(`job.error=${job!.error}, expected "VIDEO_ASSEMBLY_FAILED".`);
  }
  console.log("job preflight: status=failed, attempts=7, attemptWithinGeneration=1, " +
    "error=VIDEO_ASSEMBLY_FAILED, regenerationId/generationOrdinal match expected -> OK");

  console.log("\n========== 2) bootstrap: initializeProductionProcessRuntime() ==========");
  const initResult = await initializeProductionProcessRuntime();
  console.log(`runtime init: ok=${initResult.ok} decision=${initResult.decision} ` +
    `reasonCode=${initResult.reasonCode} writeFree=${initResult.writeFree}`);
  if (!initResult.ok || !initResult.writeFree) fail("production runtime failed to initialize write-free.");

  console.log("\nAll pre-flight checks passed.");

  console.log("\n========== 3) EXECUTE: PipelineRunner.resume(projectSlug, { stopAfterStage: 'assembly' }) ==========");
  const started = Date.now();
  const result = await PipelineRunner.resume(projectSlug, { stopAfterStage: stage });
  const elapsedMs = Date.now() - started;
  console.log(`(elapsed: ${elapsedMs}ms)`);
  console.log(JSON.stringify(result, (_key, value) => typeof value === "bigint" ? value.toString() : value, 2));

  console.log(`\nRESULT: ${result.success ? "SUCCEEDED" : result.blocked ? "BLOCKED" : "FAILED"}`);

  console.log("\n========== 4) post-execution job state ==========");
  const postJob = await PipelineJobManager.getJob(projectSlug, jobId);
  console.log(JSON.stringify(postJob, null, 2));
}

void main().catch((error) => {
  console.error("EXECUTION ERROR:", error);
  if (error instanceof Error) {
    console.error("EXECUTION ERROR STACK:", error.stack);
  }
  process.exitCode = 1;
});
