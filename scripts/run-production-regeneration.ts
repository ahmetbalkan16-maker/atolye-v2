import { createRuntimeStorageContext } from "../src/lib/runtime/RuntimeStoragePaths";
import { bootstrapRuntimeBackupStorageAuthority } from
  "../src/lib/runtime/backup/RuntimeBackupAuthority";
import type { PipelineRecoveryStageKey } from "../src/types/pipelineRecovery";
import { createCompletedStageRegenerationPlan } from
  "../src/lib/production/ProductionCompletedStageRegenerationPlanner";
import { prepareCompletedStageRegeneration } from
  "../src/lib/production/ProductionCompletedStageRegenerationService";

function parseExactArguments(command: string) {
  const allowed = command === "plan"
    ? new Set(["project-slug", "from-stage"])
    : new Set(["project-slug", "from-stage", "plan-fingerprint", "backup-id",
      "reason-code", "confirm-production-regeneration"]);
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
  if (!/^[a-zA-Z0-9-_]+$/.test(projectSlug) || fromStage !== "video") {
    throw new Error("INVALID_ARGUMENTS");
  }
  const context = createRuntimeStorageContext();
  const backupAuthority = bootstrapRuntimeBackupStorageAuthority(context);
  const plan = await createCompletedStageRegenerationPlan({
    projectSlug,
    fromStage: fromStage as PipelineRecoveryStageKey,
    context,
    runtimeAuthorityId: backupAuthority.runtimeAuthorityId,
  });
  if (command === "plan") {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    return;
  }
  if (args.get("plan-fingerprint") !== plan.planFingerprint) {
    throw new Error("PRODUCTION_REGENERATION_PLAN_STALE");
  }
  const result = await prepareCompletedStageRegeneration({
    plan,
    backupId: args.get("backup-id")!,
    reasonCode: args.get("reason-code")!,
    confirmation: args.get("confirm-production-regeneration")!,
    context,
    backupAuthority,
  });
  process.stdout.write(`${JSON.stringify({
    status: result.status,
    regenerationId: result.intent.regenerationId,
    generationOrdinal: result.intent.generationOrdinal,
    planFingerprint: result.intent.planFingerprint,
    preparedReceiptFingerprint: result.receipt.fingerprint,
    providerExecution: "not-started",
  }, null, 2)}\n`);
}

void main().catch((error: unknown) => {
  const code = error && typeof error === "object" && "code" in error
    ? String((error as { code: unknown }).code)
    : error instanceof Error ? error.message : "PRODUCTION_REGENERATION_FAILED";
  process.stderr.write(`${code}\n`);
  process.exitCode = 1;
});
