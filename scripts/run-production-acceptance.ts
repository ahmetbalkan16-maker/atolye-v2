import { runProductionAcceptanceCommand } from "../src/lib/production/ProductionAcceptanceCommand";

async function main() {
  const result = await runProductionAcceptanceCommand(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(result.report, null, 2)}\n`);
  process.exitCode = result.exitCode;
}

void main().catch(() => {
  process.stderr.write('{"success":false,"errorCode":"PRODUCTION_ACCEPTANCE_COMMAND_FAILED"}\n');
  process.exitCode = 1;
});
