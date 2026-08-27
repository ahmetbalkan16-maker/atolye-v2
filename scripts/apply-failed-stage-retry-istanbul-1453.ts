import { prepareFailedStageRetry } from "../src/lib/pipeline/PipelineFailedStageRetry";
import { PipelineJobManager } from "../src/lib/pipeline/PipelineJobManager";
import { ProjectManager } from "../src/lib/projects/ProjectManager";
import { findMatchingRegenerationRetryBudgetExtension,
  validateRegenerationRetryBudgetExtensionBody } from
  "../src/lib/production/ProductionPipelineRegenerationRetryBudgetExtension";

/**
 * APPROVED, ONE-TIME production apply: admits exactly one retry for
 * i-stanbul-un-fethi-1453-assembly via prepareFailedStageRetry(...), using
 * the P3 regeneration retry-budget-extension authority created and
 * preflighted earlier this session. Pre-checks the exact expected input
 * state before calling; if anything has drifted, aborts with zero writes.
 */

const projectSlug = "i-stanbul-un-fethi-1453";
const stage = "assembly" as const;
const jobId = `${projectSlug}-${stage}`;

async function main() {
  console.log("========== pre-check: fresh state re-verification ==========");
  const job = await PipelineJobManager.getJob(projectSlug, jobId);
  if (!job) { console.error("ABORT: job not found."); process.exitCode = 1; return; }
  const jobOk = job.status === "failed" && job.attempts === 5 && job.attemptWithinGeneration === 2;
  console.log(`job: status=${job.status} attempts=${job.attempts} attemptWithinGeneration=${job.attemptWithinGeneration} -> ${jobOk ? "MATCH" : "MISMATCH"}`);
  if (!jobOk) { console.error("ABORT: job state does not match preflight expectation. No write performed."); process.exitCode = 1; return; }

  const manifest = await ProjectManager.ensureManifest(projectSlug);
  const packageManifest = manifest?.packages?.[stage];
  const manifestOk = packageManifest?.status === "failed" && packageManifest.attempts?.total === 6;
  console.log(`manifest.packages.assembly: status=${packageManifest?.status} attempts.total=${packageManifest?.attempts?.total} -> ${manifestOk ? "MATCH" : "MISMATCH"}`);
  if (!manifestOk) { console.error("ABORT: manifest state does not match preflight expectation. No write performed."); process.exitCode = 1; return; }

  const admittedDurableOrdinal = job.attempts + 1 + 1;
  const extension = findMatchingRegenerationRetryBudgetExtension(projectSlug, stage, job, admittedDurableOrdinal);
  const authorityOk = !!extension &&
    extension.body.currentDurableOrdinal === 6 &&
    extension.body.authorizedDurableOrdinal === 7 &&
    validateRegenerationRetryBudgetExtensionBody(extension.body);
  console.log(`P3 authority: found=${!!extension}, currentDurableOrdinal=${extension?.body.currentDurableOrdinal}, ` +
    `authorizedDurableOrdinal=${extension?.body.authorizedDurableOrdinal}, valid=${extension ? validateRegenerationRetryBudgetExtensionBody(extension.body) : false} -> ${authorityOk ? "MATCH" : "MISMATCH"}`);
  if (!authorityOk) { console.error("ABORT: P3 authority does not match preflight expectation. No write performed."); process.exitCode = 1; return; }

  console.log("\nAll pre-checks passed. Proceeding with the single approved call.");

  console.log("\n========== APPLY: prepareFailedStageRetry(...) ==========");
  const result = await prepareFailedStageRetry(projectSlug, jobId);
  console.log(JSON.stringify(result, (_key, value) => typeof value === "bigint" ? value.toString() : value, 2));

  if (!result.success) {
    console.error(`\nRESULT: FAIL-CLOSED REFUSAL (${result.reasonCode}). No further action taken.`);
    process.exitCode = 1;
    return;
  }
  console.log("\nRESULT: SUCCESS.");
}

void main().catch((error) => {
  console.error("APPLY ERROR:", error);
  process.exitCode = 1;
});
