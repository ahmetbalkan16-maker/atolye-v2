import fs from "node:fs";
import path from "node:path";
import { prepareFailedStageRetry } from "../src/lib/pipeline/PipelineFailedStageRetry";
import { PipelineJobManager } from "../src/lib/pipeline/PipelineJobManager";
import { ProductionExecutionFilePersistenceAdapter } from
  "../src/lib/production/ProductionExecutionPersistence";
import { readProductionExecutionRecoverySemanticAuthority,
  type ProductionOrphanReservationToleranceLookupContext } from
  "../src/lib/production/ProductionExecutionRecoveryBootstrap";
import { findMatchingOrphanReservationToleranceAuthority } from
  "../src/lib/production/ProductionOrphanReservationToleranceAuthority";
import { findMatchingRegenerationRetryBudgetExtension } from
  "../src/lib/production/ProductionPipelineRegenerationRetryBudgetExtension";
import { regenerationBindingForExecution } from
  "../src/lib/production/ProductionCompletedStageRegenerationStore";

/**
 * APPROVED, ONE-TIME production apply: admits exactly one retry for
 * i-stanbul-un-fethi-1453-assembly via prepareFailedStageRetry(...), now
 * that both the P3 regeneration retry-budget-extension authority AND the
 * orphan reservation tolerance authority are in place. This does NOT
 * create any new authority, does NOT start actual stage execution/render --
 * prepareFailedStageRetry only admits the retry (durable settlement +
 * pipeline-jobs.json transition to "queued").
 */

const projectSlug = "i-stanbul-un-fethi-1453";
const stage = "assembly" as const;
const jobId = `${projectSlug}-${stage}`;
const root = path.join(process.cwd(), "data", "projects", projectSlug);

async function main() {
  console.log("========== fresh pre-flight ==========");
  const job = await PipelineJobManager.getJob(projectSlug, jobId);
  if (!job) { console.error("BLOCKED: job not found."); process.exitCode = 1; return; }
  const jobOk = job.status === "failed" && job.attempts === 5 && job.attemptWithinGeneration === 2;
  console.log(`job: status=${job.status} attempts=${job.attempts} attemptWithinGeneration=${job.attemptWithinGeneration} -> ${jobOk ? "MATCH" : "MISMATCH"}`);
  if (!jobOk) { console.error("BLOCKED: job state drifted since preflight. No write performed."); process.exitCode = 1; return; }

  const regeneration = regenerationBindingForExecution(projectSlug, stage, job.attempts);
  if (!regeneration || regeneration.regenerationId !== job.regenerationId) {
    console.error("BLOCKED: regeneration binding mismatch.");
    process.exitCode = 1;
    return;
  }
  const admittedDurableOrdinal = job.attempts + 1 + 1;

  const p3Match = findMatchingRegenerationRetryBudgetExtension(projectSlug, stage, job, admittedDurableOrdinal);
  console.log(`P3 retry-budget-extension authority match: ${p3Match ? p3Match.authorityId : "NONE"}`);
  if (!p3Match) { console.error("BLOCKED: no matching P3 authority."); process.exitCode = 1; return; }

  const toleranceMatch = findMatchingOrphanReservationToleranceAuthority(
    projectSlug, stage, jobId, "idempotency-identity-c1ca1524", "pipeline.stage.resume", 4);
  console.log(`Orphan reservation tolerance authority match: ${toleranceMatch ? toleranceMatch.authorityId : "NONE"}`);
  if (!toleranceMatch || toleranceMatch.authorityId !== "orphan-tol-c1ca1524-i-stanbul-un-fethi-1453") {
    console.error("BLOCKED: expected tolerance authority not found or id mismatch.");
    process.exitCode = 1;
    return;
  }

  const durableRoot = path.join(root, "production-execution");
  const realAdapter = new ProductionExecutionFilePersistenceAdapter({
    trustedRootDirectory: durableRoot, createRootDirectory: false,
  });
  const toleranceContext: ProductionOrphanReservationToleranceLookupContext = {
    projectSlug, stage, jobId,
  };
  const semantic = await readProductionExecutionRecoverySemanticAuthority(
    realAdapter, new Date().toISOString(), undefined, toleranceContext);
  console.log(`semantic authority: decision=${semantic.decision}, activeReservationCount=${semantic.activeReservationCount}`);
  if (semantic.decision !== "ready") {
    console.error("BLOCKED: semantic authority is not ready. No retry attempted.");
    process.exitCode = 1;
    return;
  }

  console.log("\nAll pre-flight checks passed. Proceeding with the single approved prepareFailedStageRetry call.");

  console.log("\n========== APPLY: prepareFailedStageRetry(...) ==========");
  const result = await prepareFailedStageRetry(projectSlug, jobId);
  console.log(JSON.stringify(result, (_key, value) => typeof value === "bigint" ? value.toString() : value, 2));

  if (!result.success) {
    console.error(`\nRESULT: BLOCKED/FAILED (${result.reasonCode}). No further action taken.`);
    process.exitCode = 1;
    return;
  }
  console.log("\nRESULT: ADMITTED.");
}

void main().catch((error) => {
  console.error("APPLY ERROR:", error);
  process.exitCode = 1;
});
