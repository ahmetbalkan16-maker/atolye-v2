import fs from "node:fs";
import path from "node:path";
import {
  createRuntimeStorageContext,
  validateSafeAncestorChain,
} from "@/lib/runtime/RuntimeStoragePaths";
import {
  migrationCandidateError,
  RuntimeMigrationCandidateError,
} from "./RuntimeMigrationCandidateError";
import { RuntimeMigrationCandidateService } from "./RuntimeMigrationCandidateService";
import { verifyMigrationCandidate, verifyMigrationCandidateBinding } from "./RuntimeMigrationCandidateVerifier";

/**
 * C.2B.13 operator CLI (`scripts/run-migration-candidate-create.ts`).
 *
 * Builds a verified migration candidate from a verified runtime backup, then
 * re-verifies the produced artifact + its backup binding. Strict argument
 * validation. It NEVER writes into `data/projects`, publishes authority, or
 * edits `.env.local`; `cutoverAuthorized` is always `false`.
 */

export interface RuntimeMigrationCandidateCreateCommandResult {
  readonly report: Record<string, unknown>;
  readonly exitCode: number;
}

class CommandInputError extends Error {}

export function runRuntimeMigrationCandidateCreateCommand(
  argv: readonly string[],
): RuntimeMigrationCandidateCreateCommandResult {
  try {
    const args = parseArgs(argv);
    const repositoryRoot = args["repository-root"]
      ? requireDirArg(args, "repository-root")
      : process.cwd();
    const backupRoot = requireDirArg(args, "backup-root");
    const backupDirectory = requireDirArg(args, "backup-directory");
    const candidateRoot = requireDirArg(args, "candidate-root");
    const restoreVerificationRoot = requireDirArg(args, "restore-verification-root");

    const context = createRuntimeStorageContext();

    const readiness = RuntimeMigrationCandidateService.createVerifiedMigrationCandidate({
      context,
      repositoryRoot,
      backupRoot,
      backupDirectory,
      candidateRoot,
      restoreVerificationRoot,
      confirmCandidateCreation: true,
    });

    const candidateDirectory = path.join(candidateRoot, "candidates", readiness.candidateId);
    const verification = verifyMigrationCandidate(candidateDirectory);
    const binding = verifyMigrationCandidateBinding(candidateDirectory, backupDirectory);

    return {
      report: {
        ok: true,
        candidateId: readiness.candidateId,
        candidateDirectory,
        candidateLocator: readiness.candidateLocator,
        candidateCreated: readiness.candidateCreated,
        candidateReused: readiness.candidateReused,
        manifestSha256: verification.manifestSha256,
        aggregateFingerprint: verification.aggregateFingerprint,
        files: verification.files,
        bytes: verification.bytes,
        sourceBackupManifestSha256: binding.sourceBackupManifestSha256,
        cutoverAuthorized: false,
      },
      exitCode: 0,
    };
  } catch (error) {
    if (error instanceof CommandInputError) {
      return fail("MIGRATION_CANDIDATE_CREATE_INPUT_INVALID", error.message);
    }
    const wrapped = error instanceof RuntimeMigrationCandidateError
      ? error
      : migrationCandidateError(error, "CANDIDATE_CREATE_FAILED");
    return fail(wrapped.code, wrapped.message);
  }
}

/* --------------------------------------------------------------- helpers --- */

function parseArgs(argv: readonly string[]): Record<string, string | true> {
  const out: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) throw new CommandInputError(`unexpected argument ${JSON.stringify(token)}`);
    const key = token.slice(2);
    if (!/^[a-z][a-z-]{1,40}$/.test(key)) throw new CommandInputError(`malformed flag ${JSON.stringify(token)}`);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) out[key] = true;
    else { out[key] = next; i += 1; }
  }
  return out;
}

function requireArg(args: Record<string, string | true>, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new CommandInputError(`--${key} is required`);
  }
  return value;
}

function requireDirArg(args: Record<string, string | true>, key: string): string {
  const raw = requireArg(args, key);
  if (raw.split(/[\\/]/).includes("..")) throw new CommandInputError(`--${key} must not contain ".."`);
  const resolved = path.resolve(raw);
  if (!path.isAbsolute(resolved)) throw new CommandInputError(`--${key} must resolve to an absolute path`);
  try {
    const link = fs.lstatSync(resolved);
    if (link.isSymbolicLink() || !link.isDirectory()) {
      throw new CommandInputError(`--${key} is not a real directory`);
    }
  } catch (error) {
    if (error instanceof CommandInputError) throw error;
    throw new CommandInputError(`--${key} directory does not exist: ${resolved}`);
  }
  validateSafeAncestorChain(resolved);
  return resolved;
}

function fail(code: string, detail: string): RuntimeMigrationCandidateCreateCommandResult {
  return { report: { ok: false, code, detail }, exitCode: 1 };
}
