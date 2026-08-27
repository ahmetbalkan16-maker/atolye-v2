import {
  initializeProductionProcessRuntime,
  shutdownProductionProcessRuntime,
} from "../src/lib/runtime/ProductionRuntimeCompositionRoot";
import { PipelineRunner } from "../src/lib/pipeline/PipelineRunner";
import type { PipelineRecoveryStageKey } from "../src/types/pipelineRecovery";
import { pipelineRecoveryStageOrder } from "../src/lib/pipeline/PipelineRecoveryPlanner";

/**
 * Operator CLI for a *bounded* `PipelineRunner.resume()` call against the REAL runtime
 * storage root (repo `data/projects`, or `ATOLYE_RUNTIME_ROOT` if set) — using the exact
 * same process-runtime boot path Next.js takes at server start
 * (`instrumentation.ts` -> `initializeProductionProcessRuntime`).
 *
 * Why this exists: `POST /api/projects/[slug]/pipeline/resume` calls
 * `PipelineRunner.resume(slug)` with no options, so it runs every remaining queued stage
 * through `export` in one call. This CLI exposes the existing, already-tested
 * `PipelineResumeOptions.stopAfterStage` boundary (see
 * `scripts/smoke-sprint-129-39-stage-bounded-resume.ts`) so an operator can resume only up
 * to and including one named stage via the same official `PipelineRunner.resume()`
 * mechanism, without touching downstream stages. If the bounded stage (or any stage before
 * it) fails, `resume()` throws and nothing further runs — there is no separate "continue on
 * failure" path to accidentally trigger.
 */
function parseArguments() {
  const allowed = new Set(["project-slug", "stop-after-stage", "confirm-execute"]);
  const values = new Map<string, string>();
  for (const raw of process.argv.slice(2)) {
    const match = /^--([a-z-]+)=(.+)$/.exec(raw);
    if (!match || !allowed.has(match[1]) || values.has(match[1])) {
      throw new Error("INVALID_ARGUMENTS");
    }
    values.set(match[1], match[2]);
  }
  if (values.size !== allowed.size) throw new Error("INVALID_ARGUMENTS");
  return values;
}

async function main() {
  const args = parseArguments();
  const projectSlug = args.get("project-slug")!;
  const stopAfterStage = args.get("stop-after-stage")! as PipelineRecoveryStageKey;

  if (!/^[a-zA-Z0-9-_]+$/.test(projectSlug)) throw new Error("INVALID_ARGUMENTS");
  if (!pipelineRecoveryStageOrder.includes(stopAfterStage)) throw new Error("INVALID_ARGUMENTS");
  if (args.get("confirm-execute") !== "EXECUTE") throw new Error("CONFIRMATION_REQUIRED");

  await initializeProductionProcessRuntime();
  try {
    const result = await PipelineRunner.resume(projectSlug, { stopAfterStage });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.success) process.exitCode = 1;
  } finally {
    await shutdownProductionProcessRuntime();
  }
}

void main().catch((error: unknown) => {
  const code = error && typeof error === "object" && "code" in error
    ? String((error as { code: unknown }).code)
    : error instanceof Error ? error.message : "PIPELINE_BOUNDED_RESUME_FAILED";
  process.stderr.write(`${code}\n`);
  if (error && typeof error === "object") {
    const known = ["reasonCode", "originalReasonCode", "settlementReasonCode", "causeReasonCode",
      "completedSettlementSteps", "writePerformed", "writeFree", "quiescenceProven",
      "failedBoundary", "attemptEvidence"] as const;
    const detail: Record<string, unknown> = {};
    for (const key of known) {
      if (key in error) detail[key] = (error as Record<string, unknown>)[key];
    }
    process.stderr.write(`DETAIL ${JSON.stringify(detail, null, 2)}\n`);
  }
  if (error instanceof Error && error.stack) process.stderr.write(`${error.stack}\n`);
  process.exitCode = 1;
});
