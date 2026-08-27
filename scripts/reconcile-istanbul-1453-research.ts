import { PipelineJobManager } from "../src/lib/pipeline/PipelineJobManager";
import { ProjectManager } from "../src/lib/projects/ProjectManager";
import type { ProjectStatus } from "../src/types/project";

/**
 * Reconcile research stage bookkeeping for i-stanbul-un-fethi-1453.
 *
 * research.json on disk already contains rich, internally-consistent research output.
 * The legacy bookkeeping (manifest.json package status, pipeline-jobs.json, pipeline-history.json)
 * was incomplete because research.json was generated via an ad-hoc path that bypassed PipelineJobManager.
 *
 * This script does NOT call any AI/FFmpeg provider and does NOT change research.json content.
 * It uses standard public APIs to transition the research stage bookkeeping into a fully reconciled state.
 */

const PROJECT_SLUG = "i-stanbul-un-fethi-1453";

async function reconcileResearchStage(slug: string): Promise<void> {
  const initialManifest = await ProjectManager.getManifest(slug);
  if (!initialManifest) throw new Error(`Manifest missing for project "${slug}".`);

  console.log(`[research] initial package status: ${initialManifest.packages.research.status}`);

  // Step 1: Set project status & initialize attempt metadata via updatePackageStatus ("running")
  await ProjectManager.updateStatus(slug, "research" as ProjectStatus);
  await ProjectManager.updatePackageStatus(slug, "research", "running", undefined, {
    runType: "resume",
  });
  console.log("[research] attempt metadata initialized in manifest (status: running).");

  // Step 2: Register running job transition in PipelineJobManager (empty callback to prevent duplicate attempt increment)
  const started = await PipelineJobManager.startStage(slug, "research", async () => {});
  if (!started) {
    throw new Error("[research] PipelineJobManager.startStage returned false.");
  }
  console.log("[research] transition -> running registered in pipeline job/history.");

  // Step 3: Persist stage success via public API to seal completed status & write job/history bookkeeping
  const persisted = await PipelineJobManager.persistStageSuccess(slug, "research", async () => {
    const data = await ProjectManager.getResearch(slug);
    if (!data) throw new Error("research.json missing.");
    await ProjectManager.saveResearch(slug, data);
  });

  if (!persisted) {
    throw new Error("[research] could not transition running -> completed.");
  }
  console.log("[research] transition -> completed.");
}

async function main() {
  await reconcileResearchStage(PROJECT_SLUG);

  const manifest = await ProjectManager.getManifest(PROJECT_SLUG);
  if (!manifest) throw new Error("manifest.json missing.");

  const project = await ProjectManager.getProject(PROJECT_SLUG);
  const job = await PipelineJobManager.getJobForStageReadOnly(PROJECT_SLUG, "research");

  console.log("\nReconciliation Summary:");
  console.log(`  manifest.packages.research.status: ${manifest.packages.research.status}`);
  console.log(
    `  manifest.packages.research.attempts: ${JSON.stringify(manifest.packages.research.attempts)}`,
  );
  console.log(`  research job status: ${job?.status}`);
  console.log(`  project.json status: ${project?.status}`);
}

main().catch((error) => {
  console.error("RECONCILE_FAILED", error);
  process.exitCode = 1;
});
