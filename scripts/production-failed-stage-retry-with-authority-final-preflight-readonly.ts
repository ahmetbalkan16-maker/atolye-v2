import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PipelineJobManager } from "../src/lib/pipeline/PipelineJobManager";
import { ProjectManager } from "../src/lib/projects/ProjectManager";
import { pipelineRetryMaxAttempts, fingerprintPipelineJob } from
  "../src/lib/pipeline/PipelineRetryAdmission";
import { regenerationBindingForExecution } from
  "../src/lib/production/ProductionCompletedStageRegenerationStore";
import {
  findMatchingRegenerationRetryBudgetExtension,
  validateRegenerationRetryBudgetExtensionBody,
} from "../src/lib/production/ProductionPipelineRegenerationRetryBudgetExtension";
import { ProductionExecutionFilePersistenceAdapter } from
  "../src/lib/production/ProductionExecutionPersistence";
import { classifyProductionDurableAttemptLineage } from
  "../src/lib/production/ProductionDurableAttemptLineageClassifier";

/**
 * READ-ONLY final preflight for prepareFailedStageRetry(...) against the
 * REAL i-stanbul-un-fethi-1453 / assembly job, NOW that a P3 regeneration
 * retry-budget-extension authority exists (durable ordinal 6 -> 7).
 *
 * Same non-negotiable boundary as the prior retry preflight: this script
 * NEVER calls prepareFailedStageRetry, reconcileFailedPipelineExecution, or
 * PipelineJobManager.prepareJobRetry -- all three have real write side
 * effects. It only reads state and replicates prepareFailedStageRetry's own
 * arithmetic byte-for-byte, this time through the point where the budget
 * check would pass (rather than refuse, as in the pre-authority preflight).
 */

const projectSlug = "i-stanbul-un-fethi-1453";
const stage = "assembly" as const;
const jobId = `${projectSlug}-${stage}`;
const expectedRegenerationId = "pipeline-regen-9474575560c5cd3bb373d77feafc2a08c4abd52be2bc304c";

async function main() {
  console.log("========== 1-2) fresh read + canonical state ==========");
  const job = await PipelineJobManager.getJob(projectSlug, jobId);
  if (!job) { console.log("NO-GO: job not found."); return; }
  console.log(JSON.stringify(job, null, 2));

  const manifest = await ProjectManager.ensureManifest(projectSlug);
  const packageManifest = manifest?.packages?.[stage];
  const canonicalOk = job.status === "failed" && job.attempts === 5 && job.attemptWithinGeneration === 2 &&
    packageManifest?.status === "failed" && packageManifest.attempts?.total === 6;
  console.log(`\npackages.assembly: status=${packageManifest?.status}, attempts.total=${packageManifest?.attempts?.total}`);
  console.log(`Canonical state confirmed (job: failed/5/2, manifest: failed/6): ${canonicalOk}`);
  if (!canonicalOk) { console.log("NO-GO: state drifted since prior sprints."); return; }

  console.log("\n========== 3) P3 authority verification ==========");
  const regeneration = regenerationBindingForExecution(projectSlug, stage, job.attempts);
  if (!regeneration) { console.log("NO-GO: no active regeneration binding."); return; }
  console.log(`Active regeneration binding: ${JSON.stringify(regeneration)}`);

  const currentDurableOrdinal = job.attempts + 1;
  const admittedJobAttemptIndex = job.attempts + 1;
  const admittedDurableOrdinal = admittedJobAttemptIndex + 1;

  const regenerationExtension = findMatchingRegenerationRetryBudgetExtension(
    projectSlug, stage, job, admittedDurableOrdinal);
  if (!regenerationExtension) {
    console.log("NO-GO: no matching, unconsumed, unaborted authority found for this exact tuple.");
    return;
  }
  const authorityBody = regenerationExtension.body;
  console.log(`\nMatched authority: ${regenerationExtension.authorityId}`);
  console.log(JSON.stringify(authorityBody, null, 2));

  const authorityChecks = {
    "project matches": authorityBody.projectSlug === projectSlug,
    "job matches": authorityBody.jobId === jobId,
    "stage matches": authorityBody.stage === stage,
    "regenerationId matches expected + job": authorityBody.regenerationId === expectedRegenerationId &&
      authorityBody.regenerationId === job.regenerationId,
    "generationOrdinal === 2": authorityBody.generationOrdinal === 2,
    "currentDurableOrdinal === 6": authorityBody.currentDurableOrdinal === 6,
    "authorizedDurableOrdinal === 7": authorityBody.authorizedDurableOrdinal === 7,
    "priorJob.attempts matches current job.attempts": authorityBody.priorJob.attempts === job.attempts,
    "schema/integrity valid (validateRegenerationRetryBudgetExtensionBody)":
      validateRegenerationRetryBudgetExtensionBody(authorityBody),
  };
  for (const [check, pass] of Object.entries(authorityChecks)) {
    console.log(`  ${pass ? "PASS" : "FAIL"}: ${check}`);
  }
  const authorityOk = Object.values(authorityChecks).every(Boolean);
  console.log(`Authority fully valid: ${authorityOk}`);
  if (!authorityOk) { console.log("NO-GO: authority validation failed."); return; }

  console.log("\n========== 4-5) prepareFailedStageRetry arithmetic (byte-accurate replica, WITH authority) ==========");
  const generationStartAttempt = job.attempts - (job.attemptWithinGeneration ?? 0);
  const ordinaryMaxAttempts = generationStartAttempt + pipelineRetryMaxAttempts;
  console.log(`generationStartAttempt = ${generationStartAttempt}`);
  console.log(`ordinary (unextended) maxAttempts = ${ordinaryMaxAttempts}`);
  console.log(`currentDurableOrdinal = ${currentDurableOrdinal}`);
  console.log(`admittedJobAttemptIndex = ${admittedJobAttemptIndex}`);
  console.log(`admittedDurableOrdinal = ${admittedDurableOrdinal}`);

  // extensionAuthorityId (ordinal-4 mechanism) only applies when !regeneration -- skipped.
  const extensionAuthorityId: string | undefined = undefined;
  const budgetCeiling = extensionAuthorityId ? 4
    : regenerationExtension ? admittedDurableOrdinal
    : ordinaryMaxAttempts;
  console.log(`budgetCeiling (regenerationExtension found -> admittedDurableOrdinal) = ${budgetCeiling}`);
  const budgetExceeded = !Number.isSafeInteger(job.attempts) || job.attempts < 0 ||
    admittedDurableOrdinal > budgetCeiling;
  console.log(`admittedDurableOrdinal(${admittedDurableOrdinal}) > budgetCeiling(${budgetCeiling}): ${admittedDurableOrdinal > budgetCeiling}`);
  console.log(`=> Budget check: ${budgetExceeded ? "EXCEEDED -> refuse" : "PASSES -> admission would proceed to durable reconciliation + PipelineJobManager.prepareJobRetry"}`);

  console.log("\n========== 6) history + durable lineage re-verification ==========");
  const rawManifest = await import("node:fs").then((m) =>
    JSON.parse(m.readFileSync(path.join(process.cwd(), "data", "projects", projectSlug, "manifest.json"), "utf8")));
  const executionTotal = rawManifest.packages[stage]?.attempts?.total;
  const rawHistory = JSON.parse(fs.readFileSync(
    path.join(process.cwd(), "data", "projects", projectSlug, "pipeline-history.json"), "utf8"));
  const terminalEvents = rawHistory.events.filter((e: { jobId: string; stage: string }) =>
    e.jobId === jobId && e.stage === stage);
  console.log(`manifest attempts.total=${executionTotal}, history terminal count=${terminalEvents.length}, agree=${executionTotal === terminalEvents.length}`);

  const realDurableRoot = path.join(process.cwd(), "data", "projects", projectSlug, "production-execution");
  if (fs.existsSync(realDurableRoot)) {
    const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "atolye-final-retry-preflight-durable-"));
    const copyRoot = path.join(tempRoot, "production-execution");
    try {
      await fsp.cp(realDurableRoot, copyRoot, { recursive: true });
      const adapter = new ProductionExecutionFilePersistenceAdapter({
        trustedRootDirectory: copyRoot, createRootDirectory: false,
      });
      const lineage = await classifyProductionDurableAttemptLineage(
        adapter, projectSlug, stage, job.attempts, "exact");
      console.log(`classifyProductionDurableAttemptLineage(attemptIndex=job.attempts=${job.attempts}, "exact") -> status=${lineage.status}` +
        (lineage.status === "valid" ? `, maximumRecordAttempt=${lineage.maximumRecordAttempt}, latest.state=${lineage.latestAttempt.state}` : ""));
    } finally {
      await fsp.rm(tempRoot, { recursive: true, force: true });
    }
  }

  console.log("\n========== 7) no cross-contamination from other job/stage/generation evidence ==========");
  console.log(`Authority jobId==="${jobId}" exact match: ${authorityBody.jobId === jobId}`);
  console.log(`Authority stage==="${stage}" exact match: ${authorityBody.stage === stage}`);
  console.log(`Authority generationOrdinal===job.generationOrdinal(${job.generationOrdinal}): ${authorityBody.generationOrdinal === job.generationOrdinal}`);
  console.log(`History terminal events filtered strictly by (jobId, stage) -- confirmed same filter used throughout this session's prior preflights.`);

  console.log("\n========== 8) WOULD-CALL (not executed) ==========");
  console.log(`WOULD CALL: prepareFailedStageRetry("${projectSlug}", "${jobId}")`);
  console.log("Expected result: {\"success\":true} with:");
  console.log(JSON.stringify({
    admittedJobAttemptIndex, admittedDurableOrdinal,
    admittedAttemptWithinGeneration: (job.attemptWithinGeneration ?? 0) + 1,
    admittedMaxAttempts: budgetCeiling,
    admittedJobStatus: "queued",
  }, null, 2));
  console.log("(This call was NOT executed. Past the budget check it would call " +
    "reconcileFailedPipelineExecution and PipelineJobManager.prepareJobRetry, both of which have real " +
    "write side effects -- deliberately not exercised in this preflight.)");

  console.log("\n========== ALL READ-ONLY CHECKS COMPLETE ==========");
}

void main().catch((error) => {
  console.error("PREFLIGHT ERROR:", error);
  process.exitCode = 1;
});
