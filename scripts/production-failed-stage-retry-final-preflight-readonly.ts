import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PipelineJobManager } from "../src/lib/pipeline/PipelineJobManager";
import { ProjectManager } from "../src/lib/projects/ProjectManager";
import { pipelineRetryMaxAttempts } from "../src/lib/pipeline/PipelineRetryAdmission";
import { regenerationBindingForExecution } from
  "../src/lib/production/ProductionCompletedStageRegenerationStore";
import { findMatchingRegenerationRetryBudgetExtension } from
  "../src/lib/production/ProductionPipelineRegenerationRetryBudgetExtension";
import { ProductionExecutionFilePersistenceAdapter } from
  "../src/lib/production/ProductionExecutionPersistence";
import { classifyProductionDurableAttemptLineage } from
  "../src/lib/production/ProductionDurableAttemptLineageClassifier";

/**
 * READ-ONLY preflight for prepareFailedStageRetry(...) against the REAL
 * i-stanbul-un-fethi-1453 / assembly job. Every call this script makes is
 * either a plain read (PipelineJobManager.getJob / ProjectManager.ensureManifest
 * -- both confirmed read-only here since pipeline-jobs.json/manifest.json
 * already exist and are non-empty) or a byte-accurate, hand-verified
 * replica of prepareFailedStageRetry's own arithmetic. It deliberately
 * NEVER calls prepareFailedStageRetry itself (which, past the budget gate,
 * calls reconcileFailedPipelineExecution -- a function with genuine
 * durable-store write behavior of its own) and NEVER calls
 * PipelineJobManager.prepareJobRetry. Durable lineage cross-check runs
 * against a temp fs.cp() COPY of production-execution/ only.
 */

const projectSlug = "i-stanbul-un-fethi-1453";
const stage = "assembly" as const;
const jobId = `${projectSlug}-${stage}`;

async function main() {
  console.log("========== 1-2) FRESH READ + canonical re-verification ==========");
  const job = await PipelineJobManager.getJob(projectSlug, jobId);
  if (!job) { console.log("NO-GO: job not found."); return; }
  console.log(JSON.stringify(job, null, 2));

  const manifest = await ProjectManager.ensureManifest(projectSlug);
  const packageManifest = manifest?.packages?.[stage];
  const canonicalOk = job.status === "failed" && job.attempts === 5 &&
    job.attemptWithinGeneration === 2 &&
    packageManifest?.status === "failed" && packageManifest.attempts?.total === 6;
  console.log(`\npackages.assembly.status=${packageManifest?.status}, attempts.total=${packageManifest?.attempts?.total}`);
  console.log(`Canonical state confirmed (job: failed/5/2, manifest: failed/6): ${canonicalOk}`);
  if (!canonicalOk) { console.log("NO-GO: state is not canonical -- stop."); return; }

  console.log("\n========== 3-4) prepareFailedStageRetry arithmetic (byte-accurate, read-only replica) ==========");
  console.log(`job.status === "failed": ${job.status === "failed"} (entry guard)`);

  const regeneration = regenerationBindingForExecution(projectSlug, stage, job.attempts);
  console.log(`regenerationBindingForExecution(projectSlug, stage, job.attempts=${job.attempts}) ->`,
    regeneration ? JSON.stringify(regeneration) : "undefined");

  const generationStartAttempt = regeneration
    ? job.attempts - (job.attemptWithinGeneration ?? 0)
    : 0;
  const maxAttempts = regeneration
    ? generationStartAttempt + pipelineRetryMaxAttempts
    : pipelineRetryMaxAttempts;
  const currentDurableOrdinal = job.attempts + 1;
  const admittedJobAttemptIndex = job.attempts + 1;
  const admittedDurableOrdinal = admittedJobAttemptIndex + 1;

  console.log(`generationStartAttempt = ${job.attempts} - ${job.attemptWithinGeneration ?? 0} = ${generationStartAttempt}`);
  console.log(`pipelineRetryMaxAttempts = ${pipelineRetryMaxAttempts}`);
  console.log(`maxAttempts (per-generation ceiling) = ${generationStartAttempt} + ${pipelineRetryMaxAttempts} = ${maxAttempts}`);
  console.log(`currentDurableOrdinal = job.attempts + 1 = ${currentDurableOrdinal}`);
  console.log(`admittedJobAttemptIndex = job.attempts + 1 = ${admittedJobAttemptIndex}`);
  console.log(`admittedDurableOrdinal = admittedJobAttemptIndex + 1 = ${admittedDurableOrdinal}`);

  // ordinal-4 extension lookup only applies when !regeneration -- skipped
  // here since regeneration is set (matches the real code's own guard).
  const extensionAuthorityId: string | undefined = undefined;
  console.log(`ordinal-4 extension lookup: skipped (regeneration is set, so !regeneration is false)`);

  const regenerationExtension = findMatchingRegenerationRetryBudgetExtension(
    projectSlug, stage, job, admittedDurableOrdinal);
  console.log(`findMatchingRegenerationRetryBudgetExtension(..., admittedDurableOrdinal=${admittedDurableOrdinal}) ->`,
    regenerationExtension ? JSON.stringify(regenerationExtension) : "undefined (no matching, unconsumed, unaborted authority file found)");

  const budgetCeiling = extensionAuthorityId ? 4
    : regenerationExtension ? admittedDurableOrdinal
    : maxAttempts;
  console.log(`budgetCeiling = ${budgetCeiling}`);

  const budgetExceeded = !Number.isSafeInteger(job.attempts) || job.attempts < 0 ||
    admittedDurableOrdinal > budgetCeiling;
  console.log(`admittedDurableOrdinal(${admittedDurableOrdinal}) > budgetCeiling(${budgetCeiling}): ${admittedDurableOrdinal > budgetCeiling}`);
  console.log(`\n=> Retry budget check: ${budgetExceeded ? "EXCEEDED -> prepareFailedStageRetry would REFUSE with PIPELINE_RETRY_MAX_ATTEMPTS_EXCEEDED (409), BEFORE ever reaching durable reconciliation or PipelineJobManager.prepareJobRetry" : "within budget"}`);

  console.log("\n========== durable lineage cross-check (temp COPY only, for corroboration) ==========");
  const realDurableRoot = path.join(process.cwd(), "data", "projects", projectSlug, "production-execution");
  if (fs.existsSync(realDurableRoot)) {
    const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "atolye-retry-preflight-durable-"));
    const copyRoot = path.join(tempRoot, "production-execution");
    try {
      await fsp.cp(realDurableRoot, copyRoot, { recursive: true });
      const adapter = new ProductionExecutionFilePersistenceAdapter({
        trustedRootDirectory: copyRoot, createRootDirectory: false,
      });
      const lineage = await classifyProductionDurableAttemptLineage(
        adapter, projectSlug, stage, job.attempts, "exact");
      console.log(`classifyProductionDurableAttemptLineage(..., attemptIndex=job.attempts=${job.attempts}, "exact") -> status=${lineage.status}` +
        (lineage.status === "valid" ? `, maximumRecordAttempt=${lineage.maximumRecordAttempt}, latest.state=${lineage.latestAttempt.state}` : ""));
      if (lineage.status === "valid") {
        console.log(`The latest durable attempt (ordinal ${lineage.maximumRecordAttempt}) is already terminal ("${lineage.latestAttempt.state}") -- consistent with currentDurableOrdinal=${currentDurableOrdinal} needing no further settlement before a NEW attempt could be opened at ordinal ${admittedDurableOrdinal}, IF budget allowed it.`);
      }
    } finally {
      await fsp.rm(tempRoot, { recursive: true, force: true });
    }
  } else {
    console.log("No production-execution/ directory present -- skipped.");
  }

  console.log("\n========== 5) Eligibility determination (fail-closed) ==========");
  console.log(`ELIGIBLE for a new retry: ${!budgetExceeded}`);
  if (budgetExceeded) {
    console.log("NO-GO: generation-2's retry budget (3 attempts: attemptWithinGeneration 0,1,2) is exhausted.");
    console.log("A plain prepareFailedStageRetry(...) call right now would be REFUSED, not admitted.");
    console.log("The only paths that could legitimately open ordinal 7 are: (a) a NEW regeneration " +
      "(a fresh generation resets generationStartAttempt), or (b) a regeneration retry-budget-extension " +
      "authority (the P3 mechanism from this session's earlier sprints) explicitly created and approved " +
      "for admittedDurableOrdinal=7 -- neither exists for this project right now (confirmed: no " +
      "retry-budget-extension directory/authority files found on disk).");
  }

  console.log("\n========== 6) computed values for a hypothetical admitted retry (for reference only) ==========");
  console.log(JSON.stringify({
    admittedJobAttemptIndex, admittedDurableOrdinal, generationOrdinal: job.generationOrdinal,
    regenerationId: job.regenerationId, generationStartAttempt,
    wouldBeAttemptWithinGeneration: (job.attemptWithinGeneration ?? 0) + 1,
  }, null, 2));

  console.log("\n========== 7) WOULD-CALL (not executed) ==========");
  console.log(`WOULD CALL: prepareFailedStageRetry("${projectSlug}", "${jobId}")`);
  console.log(`Expected result: {"success":false,"status":409,"reasonCode":"PIPELINE_RETRY_MAX_ATTEMPTS_EXCEEDED"}`);
  console.log("(This call was NOT executed.)");

  console.log("\n========== ALL READ-ONLY CHECKS COMPLETE ==========");
}

void main().catch((error) => {
  console.error("PREFLIGHT ERROR:", error);
  process.exitCode = 1;
});
