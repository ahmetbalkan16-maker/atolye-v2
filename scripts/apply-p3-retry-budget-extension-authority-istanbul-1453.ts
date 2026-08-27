import { PipelineJobManager } from "../src/lib/pipeline/PipelineJobManager";
import { fingerprintPipelineJob } from "../src/lib/pipeline/PipelineRetryAdmission";
import { regenerationBindingForExecution } from
  "../src/lib/production/ProductionCompletedStageRegenerationStore";
import { findMatchingRegenerationRetryBudgetExtension } from
  "../src/lib/production/ProductionPipelineRegenerationRetryBudgetExtension";
import { stableProductionId } from "../src/lib/production/ProductionDeterminism";
import {
  buildProductionPipelineRegenerationRetryBudgetExtensionBody,
  writeRegenerationRetryBudgetExtensionAuthority,
  readRegenerationRetryBudgetExtensionAuthority,
  validateRegenerationRetryBudgetExtensionBody,
} from "../src/lib/production/ProductionPipelineRegenerationRetryBudgetExtension";

/**
 * APPROVED, ONE-TIME production apply: creates a P3 regeneration
 * retry-budget-extension authority for
 * data/projects/i-stanbul-un-fethi-1453's i-stanbul-un-fethi-1453-assembly
 * job, authorizing exactly durable ordinal 6 -> 7 (currentDurableOrdinal=6,
 * authorizedDurableOrdinal=7). This does NOT run a retry and does NOT touch
 * manifest.json / pipeline-jobs.json / pipeline-history.json / any intent
 * file -- it only publishes one new, narrowly-scoped authority file under
 * production-execution/retry-budget-extensions/. See this session's
 * P3-retry-budget-extension read-only preflight report for the full
 * evidence chain and the exact WOULD-CREATE body this mirrors.
 */

const projectSlug = "i-stanbul-un-fethi-1453";
const stage = "assembly" as const;
const jobId = `${projectSlug}-${stage}`;

async function main() {
  const job = await PipelineJobManager.getJob(projectSlug, jobId);
  if (!job) { console.error("ABORT: job not found."); process.exitCode = 1; return; }

  const canonicalOk = job.status === "failed" && job.attempts === 5 && job.attemptWithinGeneration === 2;
  if (!canonicalOk) {
    console.error("ABORT: job state is not the expected canonical state.", JSON.stringify(job));
    process.exitCode = 1;
    return;
  }
  if (!job.regenerationId || job.generationOrdinal === undefined) {
    console.error("ABORT: job has no regeneration binding.");
    process.exitCode = 1;
    return;
  }

  const regeneration = regenerationBindingForExecution(projectSlug, stage, job.attempts);
  if (!regeneration || regeneration.regenerationId !== job.regenerationId ||
    regeneration.generationOrdinal !== 2 ||
    regeneration.regenerationId !== "pipeline-regen-9474575560c5cd3bb373d77feafc2a08c4abd52be2bc304c") {
    console.error("ABORT: active regeneration binding does not match the expected tuple.",
      JSON.stringify(regeneration));
    process.exitCode = 1;
    return;
  }

  const currentDurableOrdinal = job.attempts + 1;
  const authorizedDurableOrdinal = currentDurableOrdinal + 1;
  if (currentDurableOrdinal !== 6 || authorizedDurableOrdinal !== 7) {
    console.error(`ABORT: computed ordinals (${currentDurableOrdinal} -> ${authorizedDurableOrdinal}) ` +
      `do not match the expected 6 -> 7 tuple.`);
    process.exitCode = 1;
    return;
  }

  const existingMatch = findMatchingRegenerationRetryBudgetExtension(
    projectSlug, stage, job, authorizedDurableOrdinal);
  if (existingMatch) {
    console.log("Matching unconsumed authority already exists -- nothing to create:",
      JSON.stringify(existingMatch));
    return;
  }

  const priorJobFingerprint = fingerprintPipelineJob(job);
  const authorityId = stableProductionId("regeneration-retry-budget-extension-authority-id", {
    projectSlug, jobId, regenerationId: job.regenerationId,
    generationOrdinal: job.generationOrdinal, authorizedDurableOrdinal,
    priorJobUpdatedAt: job.updatedAt,
  });
  const issuedAt = new Date().toISOString();
  const body = buildProductionPipelineRegenerationRetryBudgetExtensionBody({
    schemaVersion: "1",
    policyVersion: "regeneration-retry-budget-extension-v1",
    authorityId,
    issuedAt,
    projectSlug,
    stage,
    jobId,
    regenerationId: job.regenerationId,
    generationOrdinal: job.generationOrdinal,
    currentDurableOrdinal,
    authorizedDurableOrdinal,
    reason: "P3 regeneration retry-budget-extension: generation-2's ordinary 3-attempt budget " +
      "(attemptWithinGeneration 0,1,2) is exhausted; assembly's last real execution (durable ordinal 6) " +
      "is a genuine, terminal VIDEO_ASSEMBLY_FAILED failure with fully consistent job/manifest/history/" +
      "durable-lineage evidence (see this session's job-level and manifest-level reconciliation preflight " +
      "and apply reports). This authority narrowly authorizes exactly one further attempt (durable ordinal 7) " +
      "for this exact (project, stage, job, regeneration, ordinal) tuple.",
    priorJob: {
      id: job.id,
      status: "failed",
      attempts: job.attempts,
      attemptWithinGeneration: job.attemptWithinGeneration ?? 0,
      updatedAt: job.updatedAt,
      fingerprint: priorJobFingerprint,
    },
  });

  if (!validateRegenerationRetryBudgetExtensionBody(body)) {
    console.error("ABORT: locally-built authority body failed its own schema validation before write.");
    process.exitCode = 1;
    return;
  }

  const writeResult = writeRegenerationRetryBudgetExtensionAuthority(projectSlug, body);
  console.log("WRITE RESULT:", JSON.stringify(writeResult, null, 2));
  if (!writeResult.ok) {
    console.error(`ABORT: write refused (${writeResult.reasonCode}).`);
    process.exitCode = 1;
    return;
  }

  const readback = readRegenerationRetryBudgetExtensionAuthority(projectSlug, authorityId);
  console.log("\nREADBACK RESULT:", JSON.stringify(readback, null, 2));
  const readbackValid = readback.ok && readback.value &&
    validateRegenerationRetryBudgetExtensionBody(readback.value) &&
    readback.value.projectSlug === projectSlug &&
    readback.value.stage === stage &&
    readback.value.jobId === jobId &&
    readback.value.regenerationId === "pipeline-regen-9474575560c5cd3bb373d77feafc2a08c4abd52be2bc304c" &&
    readback.value.generationOrdinal === 2 &&
    readback.value.currentDurableOrdinal === 6 &&
    readback.value.authorizedDurableOrdinal === 7;
  console.log(`\nReadback fully re-validated (schema + project/job/stage/regeneration/ordinal bindings): ${readbackValid}`);
  if (!readbackValid) {
    console.error("ABORT: readback did not re-validate cleanly.");
    process.exitCode = 1;
  }
}

void main().catch((error) => {
  console.error("APPLY ERROR:", error);
  process.exitCode = 1;
});
