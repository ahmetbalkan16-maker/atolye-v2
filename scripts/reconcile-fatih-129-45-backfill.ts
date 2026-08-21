import { PipelineJobManager } from "../src/lib/pipeline/PipelineJobManager";
import { ProjectManager } from "../src/lib/projects/ProjectManager";
import type { ProductionStepKey, ProjectStatus } from "../src/types/project";

/**
 * Sprint 129.45 — one-off backfill for a single, known real production project.
 *
 * animation.json / video.json / audio.json / assembly.json on disk already contain real,
 * internally-consistent 6-scene production output (confirmed with the project owner). The
 * legacy bookkeeping (manifest.json package status, pipeline-jobs.json, pipeline-history.json,
 * project.json status) never advanced past the animation stage's earlier failed attempt because
 * that output was produced through a path that bypassed PipelineJobManager.
 *
 * This script does NOT call any AI/FFmpeg provider and does NOT change any stage's JSON content.
 * It only replays the exact same public transition sequence PipelineRunner.runStageLegacy uses on
 * a real success (queued/failed -> running -> completed), using the already-existing on-disk
 * result as the "persisted result" for each stage, so manifest/job/history/project bookkeeping
 * ends up in the same state a real successful run would have produced.
 */

const PROJECT_SLUG =
  "fatih-sultan-mehmet-in-i-stanbul-un-fethine-hazirlanisi-cfe77fd8-8350-4415-bc87-211e3d36c4d5";
const STAGES: readonly ProductionStepKey[] = ["animation", "video", "audio", "assembly"];

async function backfillStage(slug: string, stage: ProductionStepKey): Promise<void> {
  const job = await PipelineJobManager.getJobForStage(slug, stage);
  if (!job) throw new Error(`No job record found for stage "${stage}".`);

  console.log(`[${stage}] current job status: ${job.status}`);

  if (job.status === "completed") {
    console.log(`[${stage}] already completed, skipping.`);
    return;
  }

  if (job.status === "failed") {
    const retry = await PipelineJobManager.prepareJobRetry(slug, job.id);
    if (!retry.success) {
      throw new Error(`[${stage}] retry preparation failed: ${retry.error}`);
    }
    console.log(`[${stage}] failed -> queued (retry prepared).`);
  }

  const started = await PipelineJobManager.startStage(slug, stage, async () => {
    await ProjectManager.updateStatus(slug, stage as ProjectStatus);
    await ProjectManager.updatePackageStatus(slug, stage, "running", undefined, {
      runType: "resume",
    });
  });
  if (!started) throw new Error(`[${stage}] could not transition queued -> running.`);
  console.log(`[${stage}] queued -> running.`);

  const persisted = await PipelineJobManager.persistStageSuccess(slug, stage, async () => {
    switch (stage) {
      case "animation": {
        const data = await ProjectManager.getAnimation(slug);
        if (!data) throw new Error("animation.json missing.");
        await ProjectManager.saveAnimation(slug, data);
        break;
      }
      case "video": {
        const data = await ProjectManager.getVideo(slug);
        if (!data) throw new Error("video.json missing.");
        await ProjectManager.saveVideo(slug, data);
        break;
      }
      case "audio": {
        const data = await ProjectManager.getAudio(slug);
        if (!data) throw new Error("audio.json missing.");
        await ProjectManager.saveAudio(slug, data);
        break;
      }
      case "assembly": {
        const data = await ProjectManager.getAssembly(slug);
        if (!data) throw new Error("assembly.json missing.");
        await ProjectManager.saveAssembly(slug, data);
        break;
      }
      default:
        throw new Error(`Unsupported stage "${stage}".`);
    }
  });
  if (!persisted) throw new Error(`[${stage}] could not transition running -> completed.`);
  console.log(`[${stage}] running -> completed.`);
}

async function main() {
  for (const stage of STAGES) {
    await backfillStage(PROJECT_SLUG, stage);
  }

  const manifest = await ProjectManager.getManifest(PROJECT_SLUG);
  const project = await ProjectManager.getProject(PROJECT_SLUG);
  console.log("\nFinal package statuses:");
  if (!manifest) throw new Error("manifest.json missing.");

  for (const [stage, pkg] of Object.entries(manifest.packages)) {
    console.log(`  ${stage}: ${pkg.status}`);
  }
  console.log(`project.json status: ${project?.status}`);
}

main().catch((error) => {
  console.error("BACKFILL_FAILED", error);
  process.exitCode = 1;
});
