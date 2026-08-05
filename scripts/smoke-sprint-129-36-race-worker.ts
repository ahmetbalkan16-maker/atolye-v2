/**
 * Cross-process race worker for Sprint 129.36 Scenario 36.
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
    // Dynamically import after env is set
    const { writeRetryBudgetExtensionReceipt, readRetryBudgetExtensionReceipt } =
      await import("../src/lib/production/ProductionPipelineRetryBudgetExtensionStore.js");
    const { buildProductionPipelineRetryBudgetExtensionReceipt } =
      await import("../src/lib/production/ProductionPipelineRetryBudgetExtensionSchema.js");

    // Check pre-conditions
    const alreadyConsumed = readRetryBudgetExtensionReceipt(projectSlug, authorityId, "consumed");
    if (alreadyConsumed.ok) {
      process.stdout.write(
        JSON.stringify({
          workerId,
          outcome: "already-consumed",
          reasonCode: "ALREADY_CONSUMED_BEFORE_ATTEMPT",
          evidence: ["pre-check:already-consumed"],
        }) + "\n",
      );
      return;
    }

    const now = new Date().toISOString();

    // Attempt to write consuming intent (wx flag = exclusive create = atomic race)
    const consumingReceipt = buildProductionPipelineRetryBudgetExtensionReceipt(
      authorityId,
      "consuming",
      now,
      `race-worker-${workerId}`,
      [`race:worker-${workerId}-consuming-intent`],
    );

    const writeConsuming = writeRetryBudgetExtensionReceipt(projectSlug, consumingReceipt);

    if (!writeConsuming.ok && writeConsuming.status !== "replayed") {
      process.stdout.write(
        JSON.stringify({
          workerId,
          outcome: "conflict",
          reasonCode: "CONSUMING_INTENT_CONFLICT",
          evidence: [...writeConsuming.evidence],
        }) + "\n",
      );
      return;
    }

    // Consuming intent published — now verify we won the race by checking ownership
    const readBack = readRetryBudgetExtensionReceipt(projectSlug, authorityId, "consuming");
    if (!readBack.ok || !readBack.value) {
      process.stdout.write(
        JSON.stringify({
          workerId,
          outcome: "conflict",
          reasonCode: "CONSUMING_INTENT_LOST_AFTER_WRITE",
          evidence: ["readback:failed"],
        }) + "\n",
      );
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
    const writeConsumed = writeRetryBudgetExtensionReceipt(projectSlug, consumedReceipt);

    process.stdout.write(
      JSON.stringify({
        workerId,
        outcome: "consumed",
        reasonCode: "CONSUMED_SUCCESSFULLY",
        consumingStatus: writeConsuming.status,
        consumedStatus: writeConsumed.status,
        consumedOk: writeConsumed.ok || writeConsumed.status === "replayed",
        jobId,
        stage,
        projectSlug,
        evidence: [
          `race:worker-${workerId}-consumed`,
          `consuming-status:${writeConsuming.status}`,
        ],
      }) + "\n",
    );
  } catch (err) {
    process.stdout.write(
      JSON.stringify({
        workerId,
        outcome: "error",
        reasonCode: "WORKER_EXCEPTION",
        error: String(err),
        evidence: ["exception"],
      }) + "\n",
    );
  }
}

void run();
