import { PipelineRunner } from "../src/lib/pipeline/PipelineRunner";
import { initializeProductionProcessRuntime } from
  "../src/lib/runtime/ProductionRuntimeCompositionRoot";
import { PipelineJobManager } from "../src/lib/pipeline/PipelineJobManager";

/**
 * APPROVED, ONE-TIME real production execution: resumes
 * i-stanbul-un-fethi-1453's assembly stage through the real, established
 * PipelineRunner.resume() API, bounded with stopAfterStage: "assembly" so
 * downstream stages (thumbnail/seo/youtube/export) are never touched.
 * Sibling of apply-execute-animation-istanbul-1453.ts and
 * apply-execute-video-istanbul-1453.ts (neither modified by this file) --
 * this is the generation-3 (ANIMATION_QUALITY_REMEDIATION regeneration)
 * assembly attempt, distinct from apply-execute-assembly-istanbul-1453-v2.ts
 * (the earlier, generation-2, P3-budget-extension-gated assembly attempt --
 * also not modified).
 *
 * Unlike animation/video (whose job.attempts incremented 0->1 at prepare
 * time because their prior status was "completed"), assembly's job.attempts
 * stays at 6 here: its prior status was "queued" (never completed -- all 7
 * prior durable attempts are "cancelled"), so buildMutations() left
 * `attempts` unchanged. attemptNumber=6 -> ordinal=7 is well within the
 * natural per-generation budget (naturalRegenerationMaxAttempts =
 * attemptNumber - attemptWithinGeneration + 3 = 6-0+3 = 9), so no P3
 * retry-budget-extension authority is required for this attempt.
 *
 * Every fail-closed precondition is re-verified fresh, immediately before
 * the call, against the real (non-copy) store. Any single failure aborts
 * with zero writes.
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

  if (job!.status !== "queued") fail(`job.status=${job!.status}, expected "queued".`);
  if (job!.attempts !== 6) fail(`job.attempts=${job!.attempts}, expected 6.`);
  if (job!.attemptWithinGeneration !== 0) {
    fail(`job.attemptWithinGeneration=${job!.attemptWithinGeneration}, expected 0.`);
  }
  if (job!.regenerationId !== expectedRegenerationId) {
    fail(`regenerationId=${job!.regenerationId}, expected ${expectedRegenerationId}.`);
  }
  if (job!.generationOrdinal !== expectedGenerationOrdinal) {
    fail(`generationOrdinal=${job!.generationOrdinal}, expected ${expectedGenerationOrdinal}.`);
  }
  console.log("job preflight: status=queued, attempts=6, attemptWithinGeneration=0, " +
    `regenerationId/generationOrdinal match expected -> OK`);

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
}

void main().catch((error) => {
  console.error("EXECUTION ERROR:", error);
  process.exitCode = 1;
});
