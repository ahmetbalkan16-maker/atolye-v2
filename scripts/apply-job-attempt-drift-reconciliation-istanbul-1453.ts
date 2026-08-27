import { PipelineJobManager } from "../src/lib/pipeline/PipelineJobManager";

/**
 * APPROVED, ONE-TIME production apply: reconciles
 * data/projects/i-stanbul-un-fethi-1453/pipeline-jobs.json's
 * i-stanbul-un-fethi-1453-assembly job from the drifted attempts=3/
 * attemptWithinGeneration=0/status="queued" to the evidence-backed canonical
 * attempts=5/attemptWithinGeneration=2/status="failed", via
 * reconcilePipelineJobAttemptDriftFromHistory's CAS-protected write path.
 * See ATOLYE_CHECKPOINT.md / this session's preflight reports for the full
 * root-cause analysis and evidence chain.
 *
 * The `expected` snapshot below is exactly what the immediately-preceding
 * read-only preflight (scripts/production-reconciliation-final-preflight-
 * readonly.ts) captured and re-verified byte-identical moments before this
 * script runs. If the real job has changed since, the function's own CAS
 * will refuse (write-free) rather than silently proceed.
 */

const projectSlug = "i-stanbul-un-fethi-1453";
const jobId = "i-stanbul-un-fethi-1453-assembly";

const expected = {
  updatedAt: "2026-08-21T22:49:32.026Z",
  attempts: 3,
  fingerprint: "pipeline-job-pre-mutation-68193efc",
};

async function main() {
  const result = await PipelineJobManager.reconcilePipelineJobAttemptDriftFromHistory(
    projectSlug, jobId, expected,
  );
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) {
    console.error(`APPLY REFUSED: ${result.reasonCode}`);
    process.exitCode = 1;
  }
}

void main().catch((error) => {
  console.error("APPLY ERROR:", error);
  process.exitCode = 1;
});
