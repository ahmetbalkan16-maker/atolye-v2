import { ProjectReader } from "@/lib/projects/ProjectReader";
import { bootstrapRuntimeBackupStorageAuthority } from "@/lib/runtime/backup/RuntimeBackupAuthority";
import type { RuntimeStorageContext } from "@/lib/runtime/RuntimeStoragePaths";
import type { ProjectManifest } from "@/types/project";
import { createPipelineCompletedStageRegenerationPlan } from
  "@/lib/pipeline/PipelineCompletedStageRegenerationPlanner";
import { preparePipelineCompletedStageRegeneration } from
  "@/lib/pipeline/PipelineCompletedStageRegenerationService";

/**
 * The systemic half of the audio-compensation fix: once a chapter's narration has been
 * re-published as real audio (see `AudioCanonicalSectionBinding.ts` /
 * `AudioCanonicalMixRebuilder.ts` for updating the binding itself), an already-completed
 * `assembly` stage built from the *old* audio is now stale. Nothing in
 * `AudioCompensationStore.ts` / `AudioPublicationIntentStore.ts` currently marks that —
 * this closes the gap, reusing the plain-pipeline regeneration module (Part B) rather
 * than inventing a second way to flip `manifest.json`/`pipeline-jobs.json`.
 *
 * Deliberately never calls `PipelineRunner.resume()` or renders anything — it only
 * plans, and (when a verified backup id is supplied) prepares a regeneration, i.e. the
 * same "queue it, don't run it" boundary Part B's CLI has. Re-running the actual
 * `assembly` stage remains a separate, explicit, operator-triggered step.
 *
 * There is currently no production code path that calls this (no live orchestrator
 * invokes `AudioCompensationStore`'s publish primitives yet — see the audit trail in
 * `ATOLYE_CHECKPOINT.md` / the investigation that preceded this change); it is a
 * ready-to-wire primitive, exercised today only by its own smoke test, matching the
 * rest of that subsystem's current state.
 */
export interface AssemblyInvalidationResult {
  readonly invalidated: boolean;
  readonly reason: string;
  readonly planFingerprint?: string;
  readonly regenerationId?: string;
}

export async function invalidateAssemblyForAudioChange(input: {
  readonly projectSlug: string;
  readonly context: RuntimeStorageContext;
  readonly backupId?: string;
  readonly reasonCode?: string;
}): Promise<AssemblyInvalidationResult> {
  const manifest = await ProjectReader.readJSON<ProjectManifest>(
    input.projectSlug, "manifest.json", input.context);
  if (!manifest || manifest.packages.assembly.status !== "completed") {
    return Object.freeze({
      invalidated: false,
      reason: "assembly is not in a completed state; there is nothing to invalidate",
    });
  }

  const plan = await createPipelineCompletedStageRegenerationPlan({
    projectSlug: input.projectSlug,
    fromStage: "assembly",
    context: input.context,
  });

  if (!input.backupId || !input.reasonCode) {
    return Object.freeze({
      invalidated: false,
      reason: "assembly is stale but a verified backup id and reason code are required " +
        "before it can be requeued; plan computed for review",
      planFingerprint: plan.planFingerprint,
    });
  }

  const backupAuthority = bootstrapRuntimeBackupStorageAuthority(input.context);
  const result = await preparePipelineCompletedStageRegeneration({
    plan,
    backupId: input.backupId,
    reasonCode: input.reasonCode,
    confirmation: plan.planFingerprint,
    context: input.context,
    backupAuthority,
  });
  return Object.freeze({
    invalidated: true,
    reason: `assembly (and its downstream: ${plan.invalidatedStages.join(", ")}) requeued`,
    planFingerprint: plan.planFingerprint,
    regenerationId: result.intent.regenerationId,
  });
}
