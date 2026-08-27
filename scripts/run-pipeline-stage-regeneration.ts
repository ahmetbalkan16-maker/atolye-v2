import { createRuntimeStorageContext } from "../src/lib/runtime/RuntimeStoragePaths";
import { bootstrapRuntimeBackupStorageAuthority } from
  "../src/lib/runtime/backup/RuntimeBackupAuthority";
import type { PipelineRecoveryStageKey } from "../src/types/pipelineRecovery";
import { supportedPipelineRegenerationFromStages } from "../src/types/pipelineRegeneration";
import { createPipelineCompletedStageRegenerationPlan } from
  "../src/lib/pipeline/PipelineCompletedStageRegenerationPlanner";
import { preparePipelineCompletedStageRegeneration } from
  "../src/lib/pipeline/PipelineCompletedStageRegenerationService";

/**
 * Operator CLI for the plain-pipeline (marker-less) completed-stage regeneration path
 * — the sibling of `scripts/run-production-regeneration.ts` for projects created
 * through the ordinary pipeline that can never obtain a `production-acceptance.json`
 * marker. See `src/types/pipelineRegeneration.ts` for why this is a separate lineage.
 *
 * `plan` is read-only. `prepare` mutates `manifest.json`/`pipeline-jobs.json` (and
 * writes an audit snapshot of the prior `assembly.json`) but never renders anything —
 * after a successful `prepare`, the *existing* `PipelineRunner.resume()` surface
 * (already wired at `app/api/projects/[slug]/pipeline/resume/route.ts`) is what
 * actually re-runs the stage.
 */
function parseExactArguments(command: string) {
  const allowed = command === "plan"
    ? new Set(["project-slug", "from-stage"])
    : new Set(["project-slug", "from-stage", "plan-fingerprint", "backup-id", "reason-code",
      "confirm-pipeline-regeneration"]);
  const values = new Map<string, string>();
  for (const raw of process.argv.slice(3)) {
    const match = /^--([a-z-]+)=(.+)$/.exec(raw);
    if (!match || !allowed.has(match[1]) || values.has(match[1])) throw new Error("INVALID_ARGUMENTS");
    values.set(match[1], match[2]);
  }
  if (values.size !== allowed.size || [...allowed].some((key) => !values.has(key))) {
    throw new Error("INVALID_ARGUMENTS");
  }
  return values;
}

async function main() {
  const command = process.argv[2];
  if (command !== "plan" && command !== "prepare") throw new Error("INVALID_COMMAND");
  const args = parseExactArguments(command);
  const projectSlug = args.get("project-slug")!;
  const fromStage = args.get("from-stage")!;
  if (!/^[a-zA-Z0-9-_]+$/.test(projectSlug) ||
    !supportedPipelineRegenerationFromStages.includes(
      fromStage as typeof supportedPipelineRegenerationFromStages[number])) {
    throw new Error("INVALID_ARGUMENTS");
  }
  const context = createRuntimeStorageContext();
  const backupAuthority = bootstrapRuntimeBackupStorageAuthority(context);
  const plan = await createPipelineCompletedStageRegenerationPlan({
    projectSlug,
    fromStage: fromStage as PipelineRecoveryStageKey,
    context,
  });
  if (command === "plan") {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    return;
  }
  if (args.get("plan-fingerprint") !== plan.planFingerprint) {
    throw new Error("PIPELINE_REGENERATION_PLAN_STALE");
  }
  const result = await preparePipelineCompletedStageRegeneration({
    plan,
    backupId: args.get("backup-id")!,
    reasonCode: args.get("reason-code")!,
    confirmation: args.get("confirm-pipeline-regeneration")!,
    context,
    backupAuthority,
  });
  process.stdout.write(`${JSON.stringify({
    status: result.status,
    regenerationId: result.intent.regenerationId,
    generationOrdinal: result.intent.generationOrdinal,
    planFingerprint: result.intent.planFingerprint,
    preparedReceiptFingerprint: result.receipt.fingerprint,
    affectedStages: result.intent.affectedStages,
    nextStep: "Call the existing PipelineRunner.resume() surface " +
      `(POST /api/projects/${projectSlug}/pipeline/resume) to actually re-run the stage.`,
  }, null, 2)}\n`);
}

void main().catch((error: unknown) => {
  const code = error && typeof error === "object" && "code" in error
    ? String((error as { code: unknown }).code)
    : error instanceof Error ? error.message : "PIPELINE_REGENERATION_FAILED";
  process.stderr.write(`${code}\n`);
  process.exitCode = 1;
});
