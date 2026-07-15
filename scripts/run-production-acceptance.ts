import { runProductionAcceptanceCommand } from "../src/lib/production/ProductionAcceptanceCommand";
import { shutdownProductionProcessRuntime } from "../src/lib/runtime/ProductionRuntimeCompositionRoot";

async function main() {
  try {
    const result = await runProductionAcceptanceCommand(process.argv.slice(2));
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
