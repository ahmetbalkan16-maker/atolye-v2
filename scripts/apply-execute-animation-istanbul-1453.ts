import { PipelineRunner } from "../src/lib/pipeline/PipelineRunner";
import { initializeProductionProcessRuntime } from
  "../src/lib/runtime/ProductionRuntimeCompositionRoot";
import { PipelineJobManager } from "../src/lib/pipeline/PipelineJobManager";

/**
 * APPROVED, ONE-TIME real production execution: resumes
 * i-stanbul-un-fethi-1453's animation stage through the real, established
 * PipelineRunner.resume() API, bounded with stopAfterStage: "animation" so
 * downstream stages (video/assembly/thumbnail/seo/youtube/export) are never
 * touched. Sibling of apply-execute-assembly-istanbul-1453-v2.ts (that
 * script is not modified by this file), adapted for animation's simpler
 * regeneration state (first attempt within generation 3 -- no P3/retry-
 * budget-extension involved, unlike the assembly case).
 *
 * Every fail-closed precondition is re-verified fresh, immediately before
 * the call, against the real (non-copy) store. Any single failure aborts
 * with zero writes.
 */

const projectSlug = "i-stanbul-un-fethi-1453";
const stage = "animation" as const;
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

  const job = await PipelineJobManager.getJob(projectSlug, jobId);
  if (!job) fail("job not found.");
  console.log(JSON.stringify(job, null, 2));

  if (job!.status !== "queued") fail(`job.status=${job!.status}, expected "queued".`);
  if (job!.attempts !== 1) fail(`job.attempts=${job!.attempts}, expected 1.`);
  if (job!.attemptWithinGeneration !== 0) {
    fail(`job.attemptWithinGeneration=${job!.attemptWithinGeneration}, expected 0.`);
  }
  if (job!.regenerationId !== expectedRegenerationId) {
    fail(`regenerationId=${job!.regenerationId}, expected ${expectedRegenerationId}.`);
  }
  if (job!.generationOrdinal !== expectedGenerationOrdinal) {
    fail(`generationOrdinal=${job!.generationOrdinal}, expected ${expectedGenerationOrdinal}.`);
  }
  console.log("job preflight: status=queued, attempts=1, attemptWithinGeneration=0, " +
    `regenerationId/generationOrdinal match expected -> OK`);

  console.log("\n========== 2) bootstrap: initializeProductionProcessRuntime() ==========");
  const initResult = await initializeProductionProcessRuntime();
  console.log(`runtime init: ok=${initResult.ok} decision=${initResult.decision} ` +
    `reasonCode=${initResult.reasonCode} writeFree=${initResult.writeFree}`);
  if (!initResult.ok || !initResult.writeFree) fail("production runtime failed to initialize write-free.");

  console.log("\nAll pre-flight checks passed.");

  console.log("\n========== 3) EXECUTE: PipelineRunner.resume(projectSlug, { stopAfterStage: 'animation' }) ==========");
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
