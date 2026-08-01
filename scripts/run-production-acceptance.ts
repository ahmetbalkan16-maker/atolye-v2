import { runProductionAcceptanceCommand } from "../src/lib/production/ProductionAcceptanceCommand";
import { shutdownProductionProcessRuntime } from "../src/lib/runtime/ProductionRuntimeCompositionRoot";
import { ProductionAcceptanceExecutionError } from
  "../src/lib/production/ProductionAcceptanceOrchestrator";
import type { ProductionAcceptanceCommandDependencies } from
  "../src/lib/production/ProductionAcceptanceCommand";

function isolatedCliEvidenceDependencies(): ProductionAcceptanceCommandDependencies | undefined {
  if (process.env.NODE_ENV !== "test") return undefined;
  const fixture = process.env.ATOLYE_TEST_PRODUCTION_ACCEPTANCE_COMMAND_ERROR;
  if (!fixture) return undefined;
  const error = fixture === "exhausted"
    ? new ProductionAcceptanceExecutionError(undefined, "PIPELINE_RETRY_MAX_ATTEMPTS_EXCEEDED")
    : fixture === "drift"
      ? new ProductionAcceptanceExecutionError(undefined,
        "PIPELINE_RETRY_QUEUED_EXHAUSTED_DRIFT_DETECTED")
      : new Error("unsafe-provider-body C:\\private\\secret sk-test-secret stack");
  return {
    readiness: async () => { throw error; },
    execute: async () => { throw error; },
    resume: async () => { throw error; },
  };
}

async function main() {
  try {
    const dependencies = isolatedCliEvidenceDependencies();
    const result = await runProductionAcceptanceCommand(
      process.argv.slice(2), dependencies,
    );
    process.stdout.write(`${JSON.stringify(result.report, null, 2)}\n`);
    process.exitCode = result.exitCode;
  } finally {
    await shutdownProductionProcessRuntime();
  }
}

void main().catch(() => {
  process.stderr.write('{"success":false,"errorCode":"PRODUCTION_ACCEPTANCE_COMMAND_FAILED"}\n');
  process.exitCode = 1;
});
