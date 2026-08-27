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
import { readRegenerationRetryBudgetExtensionReceipt } from
  "../src/lib/production/ProductionPipelineRegenerationRetryBudgetExtension";
import path from "node:path";

/**
 * APPROVED, ONE-TIME production apply: resumes
 * i-stanbul-un-fethi-1453's pipeline through the real, established
 * PipelineRunner.resume() API (the exact same call the app's own
 * /api/projects/[slug]/pipeline/resume route makes), bounded to stop right
 * after the "assembly" stage so downstream stages (thumbnail/seo/youtube/
 * export) are never touched by this specific approval.
 */

const projectSlug = "i-stanbul-un-fethi-1453";
const stage = "assembly" as const;
const jobId = `${projectSlug}-${stage}`;

async function main() {
  console.log("========== fresh pre-flight ==========");
  const job = await PipelineJobManager.getJob(projectSlug, jobId);
  if (!job) { console.error("BLOCKED: job not found."); process.exitCode = 1; return; }
  const jobOk = job.status === "queued" && job.attempts === 6 && job.attemptWithinGeneration === 3;
  console.log(`job: status=${job.status} attempts=${job.attempts} attemptWithinGeneration=${job.attemptWithinGeneration} -> ${jobOk ? "MATCH" : "MISMATCH"}`);
  if (!jobOk) { console.error("BLOCKED: job state does not match expected post-admission state."); process.exitCode = 1; return; }

  const toleranceMatch = findMatchingOrphanReservationToleranceAuthority(
    projectSlug, stage, jobId, "idempotency-identity-c1ca1524", "pipeline.stage.resume", 4);
  console.log(`Orphan tolerance authority present: ${toleranceMatch ? toleranceMatch.authorityId : "NONE"}`);
  if (!toleranceMatch) { console.error("BLOCKED: orphan tolerance authority missing."); process.exitCode = 1; return; }

  const p3AuthorityId = "regeneration-retry-budget-extension-authority-id-6cf50c4f";
  const receipt = readRegenerationRetryBudgetExtensionReceipt(projectSlug, p3AuthorityId, "consumed");
  console.log(`P3 consumption receipt: ${receipt.ok ? "FOUND" : "MISSING"} (${receipt.reasonCode})`);
  if (!receipt.ok) { console.error("BLOCKED: P3 consumption receipt not found."); process.exitCode = 1; return; }

  const root = path.join(process.cwd(), "data", "projects", projectSlug, "production-execution");
  const realAdapter = new ProductionExecutionFilePersistenceAdapter({
    trustedRootDirectory: root, createRootDirectory: false,
  });
  const toleranceContext: ProductionOrphanReservationToleranceLookupContext = { projectSlug, stage, jobId };
  const semantic = await readProductionExecutionRecoverySemanticAuthority(
    realAdapter, new Date().toISOString(), undefined, toleranceContext);
  console.log(`semantic authority: decision=${semantic.decision}, activeReservationCount=${semantic.activeReservationCount}`);
  if (semantic.decision !== "ready") {
    console.error("BLOCKED: semantic authority is not ready.");
    process.exitCode = 1;
    return;
  }

  console.log("\nAll pre-flight checks passed. Proceeding with PipelineRunner.resume (bounded to stopAfterStage='assembly').");

  console.log("\n========== bootstrap: initializeProductionProcessRuntime() ==========");
  // This is the exact same canonical production runtime composition root the real Next.js
  // server calls at boot (see src/lib/runtime/ProductionRuntimeCompositionRoot.ts) -- it
  // establishes the ambient ProductionRuntimeOperationContext that PipelineRunner's
  // production-layer continuation admission requires, via configureProductionPipelineExecution.
  // Its own recovery-bootstrap scan across all projects is write-free (writeFree: true).
  const initResult = await initializeProductionProcessRuntime();
  console.log(`runtime init: ok=${initResult.ok} decision=${initResult.decision} reasonCode=${initResult.reasonCode} writeFree=${initResult.writeFree}`);
  if (!initResult.ok || !initResult.writeFree) {
    console.error("BLOCKED: production runtime failed to initialize write-free. No execution attempted.");
    process.exitCode = 1;
    return;
  }

  console.log("\n========== EXECUTE: PipelineRunner.resume(...) ==========");
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
