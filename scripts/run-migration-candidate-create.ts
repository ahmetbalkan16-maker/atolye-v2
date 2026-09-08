import { runRuntimeMigrationCandidateCreateCommand } from
  "../src/lib/runtime/migration/RuntimeMigrationCandidateCreateCommand";

/**
 * C.2B.13 — operator CLI to build a verified migration candidate from a
 * verified runtime backup.
 *
 *   npm run runtime:migration:candidate:create -- \
 *     --backup-root <ATOLYE_RUNTIME_BACKUP_ROOT> \
 *     --backup-directory <…/backups/<backupId>> \
 *     --candidate-root <empty external dir> \
 *     --restore-verification-root <empty external dir> \
 *     [--repository-root <repo>]
 *
 * Never writes into data/projects, publishes authority, or edits .env.local.
 */
const result = runRuntimeMigrationCandidateCreateCommand(process.argv.slice(2));
process.stdout.write(`${JSON.stringify(result.report, null, 2)}\n`);
process.exitCode = result.exitCode;
