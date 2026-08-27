import fs from "node:fs";
import path from "node:path";
import { PipelineJobManager } from "../src/lib/pipeline/PipelineJobManager";
import { ProductionExecutionFilePersistenceAdapter } from
  "../src/lib/production/ProductionExecutionPersistence";
import { readProductionExecutionRecoverySemanticAuthority,
  type ProductionOrphanReservationToleranceLookupContext } from
  "../src/lib/production/ProductionExecutionRecoveryBootstrap";
import { findConsumedRegenerationRetryBudgetExtension } from
  "../src/lib/production/ProductionPipelineRegenerationRetryBudgetExtension";
import { findMatchingOrphanReservationToleranceAuthority } from
  "../src/lib/production/ProductionOrphanReservationToleranceAuthority";

/**
 * READ-ONLY production preflight for the new generation-2/P3-aware
 * PipelineRunner.ts guard branch. Verifies, against REAL
 * i-stanbul-un-fethi-1453 data, that the guard's new
 * findConsumedRegenerationRetryBudgetExtension(...) call WOULD match the
 * real, already-admitted job -- without calling PipelineRunner.resume(),
 * without starting a retry, without creating/consuming any authority or
 * receipt, and without writing anything.
 */

const projectSlug = "i-stanbul-un-fethi-1453";
const stage = "assembly" as const;
const jobId = `${projectSlug}-${stage}`;
const root = path.join(process.cwd(), "data", "projects", projectSlug);

async function main() {
  console.log("========== 1) job state (fresh read) ==========");
  const job = await PipelineJobManager.getJob(projectSlug, jobId);
  console.log(JSON.stringify(job, null, 2));
  const jobOk = job?.status === "queued" && job.attempts === 6 && job.attemptWithinGeneration === 3;
  console.log(`Matches expected post-admission shape (queued/6/3): ${jobOk}`);

  console.log("\n========== 2) orphan tolerance authority still present, unconsumed-style standing exemption ==========");
  const toleranceMatch = job
    ? findMatchingOrphanReservationToleranceAuthority(
        projectSlug, stage, jobId, "idempotency-identity-c1ca1524", "pipeline.stage.resume", 4)
    : undefined;
  console.log(`orphan-tol-c1ca1524 present: ${toleranceMatch ? toleranceMatch.authorityId : "NONE"}`);

  console.log("\n========== 3) P3 findConsumedRegenerationRetryBudgetExtension (new helper, read-only) ==========");
  const regenMatch = job
    ? findConsumedRegenerationRetryBudgetExtension(projectSlug, stage, job)
    : undefined;
  console.log(regenMatch ? JSON.stringify({
    authorityId: regenMatch.authorityId,
    priorJobAttempts: regenMatch.body.priorJob.attempts,
    authorizedDurableOrdinal: regenMatch.body.authorizedDurableOrdinal,
    receiptState: regenMatch.receipt.state,
    receiptJobVersion: regenMatch.receipt.jobVersion,
  }, null, 2) : "NO MATCH");

  console.log("\n========== 4) durable lineage check the new guard branch would perform (regenMatch.body.priorJob.attempts, \"exact\") ==========");
  let lineageValid = false;
  if (regenMatch) {
    const { classifyProductionDurableAttemptLineage } = await import(
      "../src/lib/production/ProductionDurableAttemptLineageClassifier");
    const adapter = new ProductionExecutionFilePersistenceAdapter({
      trustedRootDirectory: path.join(root, "production-execution"),
      createRootDirectory: false,
    });
    const lineage = await classifyProductionDurableAttemptLineage(
      adapter, projectSlug, stage, regenMatch.body.priorJob.attempts, "exact",
    );
    console.log(JSON.stringify(lineage, null, 2));
    lineageValid = lineage.status === "valid";
  }
  console.log(`lineage valid: ${lineageValid}`);

  console.log("\n========== 5) semantic authority (unchanged mechanism, sanity) ==========");
  const realAdapter = new ProductionExecutionFilePersistenceAdapter({
    trustedRootDirectory: path.join(root, "production-execution"), createRootDirectory: false,
  });
  const toleranceContext: ProductionOrphanReservationToleranceLookupContext = { projectSlug, stage, jobId };
  const semantic = await readProductionExecutionRecoverySemanticAuthority(
    realAdapter, new Date().toISOString(), undefined, toleranceContext,
  );
  console.log(`decision=${semantic.decision}, activeReservationCount=${semantic.activeReservationCount}`);

  console.log("\n========== 6) durable store counts (sanity -- must be unchanged by this script) ==========");
  for (const d of ["idempotency", "claims", "attempts", "reservations",
    "retry-budget-extensions", "orphan-reservation-tolerances"]) {
    const dir = path.join(root, "production-execution", d);
    const count = fs.existsSync(dir) ? fs.readdirSync(dir).length : 0;
    console.log(`${d}: ${count}`);
  }

  const wouldPassNewGuard = jobOk && !!toleranceMatch && !!regenMatch && lineageValid && semantic.decision === "ready";
  console.log(`\n========== SUMMARY: new guard branch would resolve isConsumedExtensionResume=${wouldPassNewGuard} ==========`);
  console.log("(No PipelineRunner.resume() call. No retry admission. No authority/receipt created or consumed. Read-only.)");
}

void main().catch((error) => {
  console.error("PREFLIGHT ERROR:", error);
  process.exitCode = 1;
});
