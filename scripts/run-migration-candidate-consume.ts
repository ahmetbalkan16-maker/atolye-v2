import { runRuntimeMigrationCandidateConsumeCommand } from
  "../src/lib/runtime/migration/RuntimeMigrationCandidateConsumeCommand";

/**
 * C.2B.10a — operator CLI for the verified candidate consume / offline
 * materialization service.
 *
 *   npm run runtime:migration:candidate:consume -- \
 *     --consume-id <id> \
 *     --candidate-id candidate-<64hex> \
 *     --candidate-directory <…/candidates/candidate-<64hex>> \
 *     --relocation-target <empty external root> \
 *     --live-projects <current live projects root> \
 *     [--backup-directory <verified backup dir>] \
 *     [--quarantine-root <path>] \
 *     [--expected-file-count N --expected-byte-count N --expected-content-digest <sha256>]
 *
 * This tool materialises a verified candidate into an empty exclusive target and
 * proves it byte-exact. It does NOT publish authority, write
 * `active-authority.json`, or modify `.env.local`.
 */
async function main(): Promise<void> {
  const result = await runRuntimeMigrationCandidateConsumeCommand(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(result.report, null, 2)}\n`);
  process.exitCode = result.exitCode;
}

void main().catch((error) => {
  process.stderr.write(
    `${JSON.stringify({
      ok: false,
      code: "MIGRATION_CONSUME_CLI_FAILED",
      detail: String(error instanceof Error ? error.message : error),
    })}\n`,
  );
  process.exitCode = 1;
});
