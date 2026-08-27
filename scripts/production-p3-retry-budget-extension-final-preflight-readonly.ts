import fs from "node:fs";
import path from "node:path";
import { PipelineJobManager } from "../src/lib/pipeline/PipelineJobManager";
import { fingerprintPipelineJob, pipelineRetryMaxAttempts } from
  "../src/lib/pipeline/PipelineRetryAdmission";
import { regenerationBindingForExecution } from
  "../src/lib/production/ProductionCompletedStageRegenerationStore";
import { findMatchingRegenerationRetryBudgetExtension } from
  "../src/lib/production/ProductionPipelineRegenerationRetryBudgetExtension";
import { getRetryBudgetExtensionDirectory } from
  "../src/lib/production/ProductionPipelineRetryBudgetExtensionStore";
import { stableProductionId } from "../src/lib/production/ProductionDeterminism";
import type { ProductionPipelineRegenerationRetryBudgetExtensionBody } from
  "../src/lib/production/ProductionPipelineRegenerationRetryBudgetExtension";

/**
 * READ-ONLY preflight for creating a P3 regeneration retry-budget-extension
 * authority for the REAL i-stanbul-un-fethi-1453 / assembly job at
 * admittedDurableOrdinal=7. NEVER calls
 * writeRegenerationRetryBudgetExtensionAuthority, NEVER calls
 * prepareFailedStageRetry, NEVER creates any file. Only reads job/manifest/
 * regeneration-binding state and computes what the authority body WOULD be.
 */

const projectSlug = "i-stanbul-un-fethi-1453";
const stage = "assembly" as const;
const jobId = `${projectSlug}-${stage}`;

function buildBodyWithoutIntegrity(input: Omit<ProductionPipelineRegenerationRetryBudgetExtensionBody, "integrity">) {
  return input;
}

async function main() {
  console.log("========== 1-2) P3 mechanism inspection summary ==========");
  console.log("Source: src/lib/production/ProductionPipelineRegenerationRetryBudgetExtension.ts");
  console.log("Storage: <projectRoot>/production-execution/retry-budget-extensions/regen-authority-<id>.json");
  console.log("Format (ProductionPipelineRegenerationRetryBudgetExtensionBody): schemaVersion, policyVersion,");
  console.log("  authorityId, issuedAt, projectSlug, stage, jobId, regenerationId, generationOrdinal,");
  console.log("  currentDurableOrdinal, authorizedDurableOrdinal, reason, priorJob{id,status:'failed',");
  console.log("  attempts,attemptWithinGeneration,updatedAt,fingerprint}, integrity{algorithm,fingerprint}");
  console.log("Fail-closed validation (validateRegenerationRetryBudgetExtensionBody): schemaVersion/policyVersion");
  console.log("  exact match; all id fields non-empty; generationOrdinal>=1; currentDurableOrdinal>=0;");
  console.log("  authorizedDurableOrdinal === currentDurableOrdinal + 1 STRICTLY (no skip allowed);");
  console.log("  priorJob.status === 'failed'; priorJob.attempts/attemptWithinGeneration >= 0; integrity");
  console.log("  fingerprint recomputed and matched. Write path (writeRegenerationRetryBudgetExtensionAuthority)");
  console.log("  is itself write-once (wx flag) + replay-safe (same authorityId + valid body -> no-op replay,");
  console.log("  reasonCode PIPELINE_REGENERATION_RETRY_BUDGET_EXTENSION_REPLAYED) and conflict-safe (existing");
  console.log("  file with a DIFFERENT/corrupt body -> refused, never overwritten).");

  const dir = getRetryBudgetExtensionDirectory(projectSlug);
  console.log(`\nReal directory: ${dir}`);
  console.log(`Directory currently exists: ${fs.existsSync(dir)}`);
  if (fs.existsSync(dir)) {
    console.log(`Existing files: ${JSON.stringify(fs.readdirSync(dir))}`);
  } else {
    console.log("No retry-budget-extensions directory exists yet for this project -- zero prior authorities.");
  }

  console.log("\n========== fresh job/regeneration read ==========");
  const job = await PipelineJobManager.getJob(projectSlug, jobId);
  if (!job) { console.log("NO-GO: job not found."); return; }
  console.log(JSON.stringify(job, null, 2));

  const canonicalOk = job.status === "failed" && job.attempts === 5 && job.attemptWithinGeneration === 2;
  console.log(`\nCanonical job state confirmed (failed/5/2): ${canonicalOk}`);
  if (!canonicalOk) { console.log("NO-GO: job state is not the expected canonical state."); return; }

  if (!job.regenerationId || job.generationOrdinal === undefined) {
    console.log("NO-GO: job has no regeneration binding -- P3 mechanism is regeneration-only.");
    return;
  }

  const regeneration = regenerationBindingForExecution(projectSlug, stage, job.attempts);
  if (!regeneration || regeneration.regenerationId !== job.regenerationId) {
    console.log("NO-GO: active regeneration binding does not match job.regenerationId.");
    return;
  }
  console.log(`\nActive regeneration binding matches job.regenerationId: true (${regeneration.regenerationId}, generationOrdinal=${regeneration.generationOrdinal})`);

  console.log("\n========== 3) technical/safety conditions for admittedDurableOrdinal=7 ==========");
  const currentDurableOrdinal = job.attempts + 1;
  const admittedJobAttemptIndex = job.attempts + 1;
  const admittedDurableOrdinal = admittedJobAttemptIndex + 1;
  console.log(`currentDurableOrdinal = job.attempts + 1 = ${currentDurableOrdinal}`);
  console.log(`admittedDurableOrdinal (what a retry would need) = ${admittedDurableOrdinal}`);
  console.log(`Body validation requires authorizedDurableOrdinal === currentDurableOrdinal + 1: ${admittedDurableOrdinal === currentDurableOrdinal + 1}`);

  const existingMatch = findMatchingRegenerationRetryBudgetExtension(
    projectSlug, stage, job, admittedDurableOrdinal);
  console.log(`\nExisting unconsumed/unaborted authority already matching this exact tuple: ${existingMatch ? JSON.stringify(existingMatch) : "none"}`);
  if (existingMatch) {
    console.log("NO-GO: a matching authority already exists -- creating a new one is unnecessary/would only replay.");
    return;
  }

  console.log("\n========== 9) WOULD-CREATE authority body (not written) ==========");
  const priorJobFingerprint = fingerprintPipelineJob(job);
  const authorityId = stableProductionId("regeneration-retry-budget-extension-authority-id", {
    projectSlug, jobId, regenerationId: job.regenerationId,
    generationOrdinal: job.generationOrdinal, authorizedDurableOrdinal: admittedDurableOrdinal,
    priorJobUpdatedAt: job.updatedAt,
  });
  const bodyWithoutIntegrity = buildBodyWithoutIntegrity({
    schemaVersion: "1",
    policyVersion: "regeneration-retry-budget-extension-v1",
    authorityId,
    issuedAt: "<ISSUED_AT: set to the real creation-time ISO timestamp when this is actually created>",
    projectSlug,
    stage,
    jobId,
    regenerationId: job.regenerationId,
    generationOrdinal: job.generationOrdinal,
    currentDurableOrdinal,
    authorizedDurableOrdinal: admittedDurableOrdinal,
    reason: "P3 regeneration retry-budget-extension: generation-2's ordinary 3-attempt budget " +
      "(attemptWithinGeneration 0,1,2) is exhausted; assembly's last real execution (durable ordinal 6) " +
      "is a genuine, terminal VIDEO_ASSEMBLY_FAILED failure with fully consistent job/manifest/history/" +
      "durable-lineage evidence (see this session's job-level and manifest-level reconciliation preflight " +
      "and apply reports). This authority narrowly authorizes exactly one further attempt (durable ordinal 7) " +
      "for this exact (project, stage, job, regeneration, ordinal) tuple.",
    priorJob: {
      id: job.id,
      status: "failed" as const,
      attempts: job.attempts,
      attemptWithinGeneration: job.attemptWithinGeneration ?? 0,
      updatedAt: job.updatedAt,
      fingerprint: priorJobFingerprint,
    },
  });
  const integrityFingerprint = stableProductionId(
    "regeneration-retry-budget-extension-authority", bodyWithoutIntegrity);
  console.log(JSON.stringify({
    ...bodyWithoutIntegrity,
    integrity: { algorithm: "stable-production-id-v1", fingerprint: integrityFingerprint },
  }, null, 2));
  console.log(`\nTarget path (not written): ${path.join(dir, `regen-authority-${authorityId}.json`)}`);
  console.log("(This authority was NOT created.)");

  console.log("\n========== 10) expected values after extension + retry admission ==========");
  const budgetCeilingWithExtension = admittedDurableOrdinal; // regenerationExtension ? admittedDurableOrdinal : maxAttempts
  const generationStartAttempt = job.attempts - (job.attemptWithinGeneration ?? 0);
  const ordinaryMaxAttempts = generationStartAttempt + pipelineRetryMaxAttempts;
  console.log(`ordinary (unextended) budget ceiling = ${ordinaryMaxAttempts} (currently exceeded by admittedDurableOrdinal=${admittedDurableOrdinal})`);
  console.log(`budget ceiling WITH this extension = admittedDurableOrdinal = ${budgetCeilingWithExtension}`);
  console.log(`admittedDurableOrdinal(${admittedDurableOrdinal}) > budgetCeiling(${budgetCeilingWithExtension}): ${admittedDurableOrdinal > budgetCeilingWithExtension} -> retry would be ADMITTED`);
  console.log(JSON.stringify({
    admittedJobAttempt: admittedJobAttemptIndex,
    durableOrdinal: admittedDurableOrdinal,
    attemptWithinGeneration: (job.attemptWithinGeneration ?? 0) + 1,
    generationOrdinal: job.generationOrdinal,
  }, null, 2));

  console.log("\n========== ALL READ-ONLY CHECKS COMPLETE ==========");
}

void main().catch((error) => {
  console.error("PREFLIGHT ERROR:", error);
  process.exitCode = 1;
});
