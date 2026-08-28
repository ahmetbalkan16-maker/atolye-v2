import {
  initializeProductionProcessRuntime,
  shutdownProductionProcessRuntime,
} from "../src/lib/runtime/ProductionRuntimeCompositionRoot";
import { PipelineJobManager } from "../src/lib/pipeline/PipelineJobManager";
import { ProjectManager } from "../src/lib/projects/ProjectManager";

/**
 * Slug-locked sibling of
 * scripts/apply-finalize-project-completion-istanbul-1453.ts for the
 * fatih-...-cfe77fd8 project.
 *
 * The bounded `run-pipeline-bounded-resume --stop-after-stage=export` path
 * deliberately does NOT run `PipelineRunner.resumeOnce`'s trailing completion
 * block (gated on `!stoppedAfterStage`). So after export completed via a bounded
 * resume, `project.json.status` is still `"export"` even though every pipeline
 * job is `completed`. This invokes the pipeline's own, already-guarded
 * completion primitive -- `PipelineJobManager.persistProjectCompletion`, which
 * sets the project status to `"completed"` ONLY when EVERY pipeline job is
 * `completed`, and does nothing otherwise. Idempotent. Touches only
 * `project.json` / `manifest.json` project status -- no durable/canonical
 * record, no audio ledger, no other project.
 */

const projectSlug =
  "fatih-sultan-mehmet-in-i-stanbul-un-fethine-hazirlanisi-cfe77fd8-8350-4415-bc87-211e3d36c4d5";

async function main() {
  await initializeProductionProcessRuntime();
  try {
    const jobs = await PipelineJobManager.listJobs(projectSlug);
    const blocking = jobs.jobs.filter((job) => job.status !== "completed");
    console.log(`pipeline jobs: ${jobs.jobs.length}, not-completed: ${blocking.length}`);
    if (blocking.length > 0) {
      console.log("blocking:", blocking.map((j) => `${j.stage}=${j.status}`).join(", "));
    }
    const before = await ProjectManager.getProject(projectSlug);
    console.log(`project.status before: ${before?.status}`);

    const finalized = await PipelineJobManager.persistProjectCompletion(projectSlug, async () => {
      await ProjectManager.updateStatus(projectSlug, "completed");
    });

    const after = await ProjectManager.getProject(projectSlug);
    console.log(`persistProjectCompletion -> ${finalized}`);
    console.log(`project.status after: ${after?.status}`);
    if (!finalized || after?.status !== "completed") {
      process.exitCode = 1;
    }
  } finally {
    await shutdownProductionProcessRuntime();
  }
}

void main().catch((error) => {
  console.error("FINALIZE ERROR:", error);
  process.exitCode = 1;
});
