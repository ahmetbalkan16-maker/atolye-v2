import { PipelineJobManager } from "../src/lib/pipeline/PipelineJobManager";

/**
 * APPROVED, ONE-TIME production apply: reconciles
 * data/projects/i-stanbul-un-fethi-1453/manifest.json's packages.assembly.status
 * from the corrupted "pending" (with completedAt/attempts.total/history all
 * proving the last real execution failed) to the evidence-backed canonical
 * "failed", via reconcileManifestPackageStatusFromHistory's CAS-protected
 * write path. See ATOLYE_CHECKPOINT.md / this session's preflight reports for
 * the full root-cause analysis and evidence chain.
 *
 * The `expected` snapshot below is exactly what the immediately-preceding
 * read-only preflight (scripts/production-manifest-reconciliation-final-
 * preflight-readonly.ts) captured and re-verified byte-identical moments
 * before this script runs. If the real manifest has changed since, the
 * function's own CAS will refuse (write-free) rather than silently proceed.
 */

const projectSlug = "i-stanbul-un-fethi-1453";
const stage = "assembly" as const;

const expected = {
  manifestUpdatedAt: "2026-08-21T22:57:59.443Z",
  packageSnapshot: {
    status: "pending" as const,
    completedAt: "2026-08-21T22:49:31.965Z",
    startedAt: "2026-08-21T22:49:22.973Z",
    attemptsTotal: 6,
    generationOrdinal: 2,
    regenerationId: "pipeline-regen-9474575560c5cd3bb373d77feafc2a08c4abd52be2bc304c",
  },
  packageFingerprint: "manifest-package-pre-mutation-b7cb4755",
};

async function main() {
  const result = await PipelineJobManager.reconcileManifestPackageStatusFromHistory(
    projectSlug, stage, expected,
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
