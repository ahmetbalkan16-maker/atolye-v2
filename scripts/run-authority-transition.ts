import { runRuntimeAuthorityTransitionCommand } from
  "../src/lib/runtime/security/RuntimeAuthorityTransitionCommand";

/**
 * C.2B.9b — operator CLI for the runtime authority transition state machine.
 *
 *   npm run authority:status            -- --authority-root <p>
 *   npm run authority:begin-genesis     -- --authority-root <p> --target <p> --transition-id <id>
 *   npm run authority:begin-relocation  -- --authority-root <p> --source <p> --target <p> --transition-id <id>
 *   npm run authority:begin-recovery    -- --authority-root <p> --target <p> --transition-id <id> --reason "<why>"
 *   npm run authority:quiesce           -- --authority-root <p> --transition-id <id> --assert-worker-stopped [--source-projects <p>]
 *   npm run authority:prepare           -- --authority-root <p> --transition-id <id> --source-projects <p>
 *   npm run authority:validate          -- --authority-root <p> --transition-id <id> --target <p>
 *   npm run authority:publish           -- --authority-root <p> --transition-id <id> --target <p>
 *   npm run authority:quarantine        -- --authority-root <p> --transition-id <id>
 *   npm run authority:fail              -- --authority-root <p> --transition-id <id> --reason "<why>"
 *
 * This tool drives the control plane only. It never copies project data — the
 * byte-exact materialization is a separate `runtime:backup` + verified
 * migration-candidate step (see docs/PROJECT_STORAGE.md §6).
 */
async function main(): Promise<void> {
  const result = await runRuntimeAuthorityTransitionCommand(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(result.report, null, 2)}\n`);
  process.exitCode = result.exitCode;
}

void main().catch((error) => {
  process.stderr.write(
    `${JSON.stringify({ ok: false, code: "AUTHORITY_TRANSITION_CLI_FAILED", detail: String(error instanceof Error ? error.message : error) })}\n`,
  );
  process.exitCode = 1;
});
