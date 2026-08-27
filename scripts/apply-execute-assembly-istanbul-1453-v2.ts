import { PipelineRunner } from "../src/lib/pipeline/PipelineRunner";
import { initializeProductionProcessRuntime } from
  "../src/lib/runtime/ProductionRuntimeCompositionRoot";
import { PipelineJobManager } from "../src/lib/pipeline/PipelineJobManager";
import { ProductionExecutionFilePersistenceAdapter } from
  "../src/lib/production/ProductionExecutionPersistence";
import { readProductionExecutionRecoverySemanticAuthority,
  type ProductionOrphanReservationToleranceLookupContext } from
  "../src/lib/production/ProductionExecutionRecoveryBootstrap";
import { findMatchingOrphanReservationToleranceAuthority } from
  "../src/lib/production/ProductionOrphanReservationToleranceAuthority";
import { findConsumedRegenerationRetryBudgetExtension } from
  "../src/lib/production/ProductionPipelineRegenerationRetryBudgetExtension";
import { classifyProductionDurableAttemptLineage } from
  "../src/lib/production/ProductionDurableAttemptLineageClassifier";
import path from "node:path";

/**
 * APPROVED, ONE-TIME real production execution: resumes
 * i-stanbul-un-fethi-1453's assembly stage through the real, established
 * PipelineRunner.resume() API, bounded with stopAfterStage: "assembly" so
 * downstream stages (thumbnail/seo/youtube/export) are never touched.
 *
 * Every fail-closed precondition from this order's preflight checklist is
 * re-verified fresh, immediately before the call, against the real (non-copy)
 * store. Any single failure aborts with zero writes.
 */

const projectSlug = "i-stanbul-un-fethi-1453";
const stage = "assembly" as const;
const jobId = `${projectSlug}-${stage}`;

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
  if (job!.attempts !== 6) fail(`job.attempts=${job!.attempts}, expected 6.`);
  if (job!.attemptWithinGeneration !== 3) {
    fail(`job.attemptWithinGeneration=${job!.attemptWithinGeneration}, expected 3.`);
  }
  if (!job!.regenerationId || !Number.isSafeInteger(job!.generationOrdinal)) {
    fail("regenerationId / generationOrdinal missing or invalid.");
  }
  console.log(`regenerationId=${job!.regenerationId}, generationOrdinal=${job!.generationOrdinal} -> OK`);

  const regenMatch = findConsumedRegenerationRetryBudgetExtension(projectSlug, stage, job!);
  if (!regenMatch) fail("P3 authority / consumed receipt not found or not matching.");
  console.log(`P3 authority matched: ${regenMatch!.authorityId}`);
  if (regenMatch!.body.priorJob.attempts !== 5) {
    fail(`priorJob.attempts=${regenMatch!.body.priorJob.attempts}, expected 5.`);
  }
  if (regenMatch!.body.authorizedDurableOrdinal !== 7) {
    fail(`authorizedDurableOrdinal=${regenMatch!.body.authorizedDurableOrdinal}, expected 7.`);
  }
  if (regenMatch!.receipt.state !== "consumed") fail("P3 receipt is not 'consumed'.");
  if (regenMatch!.receipt.jobVersion !== job!.updatedAt) {
    fail(`receipt.jobVersion=${regenMatch!.receipt.jobVersion} !== job.updatedAt=${job!.updatedAt}.`);
  }
  console.log("P3 authority: priorJob.attempts=5, authorizedDurableOrdinal=7, receipt consumed, jobVersion matches -> OK");

  const root = path.join(process.cwd(), "data", "projects", projectSlug, "production-execution");
  const realAdapter = new ProductionExecutionFilePersistenceAdapter({
    trustedRootDirectory: root, createRootDirectory: false,
  });
  const lineage = await classifyProductionDurableAttemptLineage(
    realAdapter, projectSlug, stage, regenMatch!.body.priorJob.attempts, "exact",
  );
  console.log(`classifyProductionDurableAttemptLineage(..., 5, "exact") -> status=${lineage.status}` +
    (lineage.status === "valid" ? `, maximumRecordAttempt=${lineage.maximumRecordAttempt}` : ""));
  if (lineage.status !== "valid") fail("durable lineage at priorJob.attempts=5 is not 'valid'.");

  const toleranceMatch = findMatchingOrphanReservationToleranceAuthority(
    projectSlug, stage, jobId, "idempotency-identity-c1ca1524", "pipeline.stage.resume", 4);
  if (!toleranceMatch) fail("orphan reservation tolerance authority not found.");
  console.log(`Orphan tolerance authority present: ${toleranceMatch!.authorityId}`);

  const toleranceContext: ProductionOrphanReservationToleranceLookupContext = { projectSlug, stage, jobId };
  const semantic = await readProductionExecutionRecoverySemanticAuthority(
    realAdapter, new Date().toISOString(), undefined, toleranceContext);
  console.log(`semantic authority: decision=${semantic.decision}, activeReservationCount=${semantic.activeReservationCount}`);
  if (semantic.decision !== "ready") fail("semantic authority is not 'ready'.");

  console.log("\nAll pre-flight checks passed.");

  console.log("\n========== 2) bootstrap: initializeProductionProcessRuntime() ==========");
  const initResult = await initializeProductionProcessRuntime();
  console.log(`runtime init: ok=${initResult.ok} decision=${initResult.decision} reasonCode=${initResult.reasonCode} writeFree=${initResult.writeFree}`);
  if (!initResult.ok || !initResult.writeFree) fail("production runtime failed to initialize write-free.");

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
