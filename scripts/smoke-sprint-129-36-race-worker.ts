/**
 * Cross-process retry-budget consuming-intent race worker for Sprint 129.36.
 *
 * This script is spawned as a child process by the smoke test to attempt
 * consuming a retry budget extension authority concurrently.
 * It writes its result to stdout as JSON and exits.
 *
 * Usage: npx tsx scripts/smoke-sprint-129-36-race-worker.ts \
 *   --runtime-root=<path> \
 *   --project-slug=<slug> \
 *   --stage=<stage> \
 *   --job-id=<jobId> \
 *   --authority-id=<authId>
 */
import { randomUUID } from "node:crypto";
import path from "node:path";

// Parse CLI args
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const eq = a.indexOf("=");
    return eq > 0 ? [a.slice(2, eq), a.slice(eq + 1)] : [a.slice(2), "true"];
  }),
);

const runtimeRoot = args["runtime-root"] as string;
const projectSlug = args["project-slug"] as string;
const stage = args["stage"] as string;
const jobId = args["job-id"] as string;
const authorityId = args["authority-id"] as string;
const workerId = randomUUID();

async function run() {
  // Set the runtime root so the store reads from the correct temp directory
  process.env.ATOLYE_RUNTIME_ROOT = runtimeRoot;
  (process.env as Record<string, string>).NODE_ENV = "test";
  (process.env as Record<string, string>).AI_PROVIDER = "mock";

  try {
    const {
      writeRetryBudgetExtensionReceipt,
      readRetryBudgetExtensionReceipt,
      readRetryBudgetExtensionAuthority,
    } =
      await import("../src/lib/production/ProductionPipelineRetryBudgetExtensionStore.js");
    const { buildProductionPipelineRetryBudgetExtensionReceipt } =
      await import("../src/lib/production/ProductionPipelineRetryBudgetExtensionSchema.js");
    const { createRuntimeStorageContext } = await import("../src/lib/runtime/RuntimeStoragePaths.js");
    const input = createRuntimeStorageContext({
      workspaceRoot: runtimeRoot,
      environment: {
        ATOLYE_RUNTIME_ROOT: runtimeRoot,
        ATOLYE_RUNTIME_AUTHORITY_ROOT: process.env.ATOLYE_RUNTIME_AUTHORITY_ROOT || path.join(runtimeRoot, "authority-root"),
      },
    });

    const authorityRead = readRetryBudgetExtensionAuthority(projectSlug, authorityId, input);
    if (
      !authorityRead.ok ||
      !authorityRead.value ||
      authorityRead.value.authorityId !== authorityId ||
      authorityRead.value.projectSlug !== projectSlug ||
      authorityRead.value.stage !== stage ||
      authorityRead.value.jobId !== jobId ||
      authorityRead.value.authorizedRunType !== "resume" ||
      authorityRead.value.authorizedOperation !== "pipeline.stage.resume"
    ) {
      throw new Error("RACE_WORKER_AUTHORITY_VALIDATION_FAILED");
    }

    process.send?.({ type: "ready", workerId, authorityValidated: true });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("RACE_WORKER_START_TIMEOUT")), 30_000);
      process.once("message", (message) => {
        clearTimeout(timer);
        if (!message || typeof message !== "object" ||
          (message as { type?: string }).type !== "start") {
          reject(new Error("RACE_WORKER_START_INVALID"));
          return;
        }
        resolve();
      });
    });

    const now = new Date().toISOString();

    // Attempt to write consuming intent (wx flag = exclusive create = atomic race)
    const consumingReceipt = buildProductionPipelineRetryBudgetExtensionReceipt(
      authorityId,
      "consuming",
      now,
      `race-worker-${workerId}`,
      [`race:worker-${workerId}-consuming-intent`],
    );

    const writeConsuming = writeRetryBudgetExtensionReceipt(projectSlug, consumingReceipt, input);

    if (!writeConsuming.ok && writeConsuming.status !== "replayed") {
      emitResult({
          workerId,
          outcome: "conflict",
          reasonCode: "CONSUMING_INTENT_CONFLICT",
          authorityValidated: true,
          consumedOk: false,
          evidence: [...writeConsuming.evidence],
        });
      return;
    }

    // Consuming intent published — now verify we won the race by checking ownership
    const readBack = readRetryBudgetExtensionReceipt(projectSlug, authorityId, "consuming", input);
    if (!readBack.ok || !readBack.value ||
      readBack.value.integrity.fingerprint !== consumingReceipt.integrity.fingerprint) {
      emitResult({
          workerId,
          outcome: "conflict",
          reasonCode: "CONSUMING_INTENT_LOST_AFTER_WRITE",
          authorityValidated: true,
          consumedOk: false,
          evidence: ["readback:failed"],
        });
      return;
    }

    // We won — write consumed receipt
    const consumedReceipt = buildProductionPipelineRetryBudgetExtensionReceipt(
      authorityId,
      "consumed",
      new Date().toISOString(),
      `race-consumed-${workerId}`,
      [`race:worker-${workerId}-consumed`],
    );
    const writeConsumed = writeRetryBudgetExtensionReceipt(projectSlug, consumedReceipt, input);
    if (!writeConsumed.ok && writeConsumed.status !== "replayed") {
      throw new Error(`RACE_WORKER_CONSUMED_WRITE_FAILED:${writeConsumed.reasonCode}`);
    }

    emitResult({
        workerId,
        outcome: "consumed",
        reasonCode: "CONSUMED_SUCCESSFULLY",
        authorityValidated: true,
        consumingStatus: writeConsuming.status,
        consumedStatus: writeConsumed.status,
        consumedOk: true,
        jobId,
        stage,
        projectSlug,
        evidence: [
          `race:worker-${workerId}-consumed`,
          `consuming-status:${writeConsuming.status}`,
        ],
      });
  } catch (err) {
    emitResult({
        workerId,
        outcome: "error",
        reasonCode: "WORKER_EXCEPTION",
        authorityValidated: false,
        consumedOk: false,
        error: String(err),
        stack: err instanceof Error ? err.stack : undefined,
        evidence: ["exception"],
      });
    process.exitCode = 1;
  }
}

function emitResult(result: Record<string, unknown>) {
  process.send?.({ type: "result", result });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.disconnect?.();
}

void run();
