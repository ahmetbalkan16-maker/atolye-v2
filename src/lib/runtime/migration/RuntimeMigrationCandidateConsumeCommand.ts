import fs from "node:fs";
import path from "node:path";
import { validateSafeAncestorChain } from "@/lib/runtime/RuntimeStoragePaths";
import {
  RuntimeMigrationCandidateConsumeError,
} from "./RuntimeMigrationCandidateConsumeError";
import {
  RuntimeMigrationCandidateConsumeService,
} from "./RuntimeMigrationCandidateConsumeService";

/**
 * C.2B.10a operator CLI (`scripts/run-migration-candidate-consume.ts`).
 *
 * Strict, argument-validated wrapper around
 * `RuntimeMigrationCandidateConsumeService`. It NEVER publishes authority,
 * writes `active-authority.json`, or edits `.env.local`. A verified candidate is
 * materialised into an empty exclusive relocation target and proven byte-exact;
 * `cutoverAuthorized` is always `false`.
 */

export interface RuntimeMigrationCandidateConsumeCommandResult {
  readonly report: Record<string, unknown>;
  readonly exitCode: number;
}

class CommandInputError extends Error {}

export async function runRuntimeMigrationCandidateConsumeCommand(
  argv: readonly string[],
): Promise<RuntimeMigrationCandidateConsumeCommandResult> {
  try {
    const args = parseArgs(argv);
    const result = await RuntimeMigrationCandidateConsumeService.consumeVerifiedMigrationCandidate({
      consumeId: requireArg(args, "consume-id"),
      candidateId: requireArg(args, "candidate-id"),
      candidateDirectory: requireDirArg(args, "candidate-directory"),
      relocationTargetRoot: requireAbsoluteArg(args, "relocation-target"),
      liveProjectsRoot: requireDirArg(args, "live-projects"),
      ...(args["backup-directory"] ? { backupDirectory: requireDirArg(args, "backup-directory") } : {}),
      ...(args["quarantine-root"] ? { quarantineRoot: requireAbsoluteArg(args, "quarantine-root") } : {}),
      ...(args["expected-file-count"] ? { expectedFileCount: requireIntArg(args, "expected-file-count") } : {}),
      ...(args["expected-byte-count"] ? { expectedByteCount: requireIntArg(args, "expected-byte-count") } : {}),
      ...(args["expected-content-digest"] ? { expectedContentDigest: requireHexArg(args, "expected-content-digest") } : {}),
      ...("allow-test-temp-root" in args ? { allowTestTempRoot: true } : {}),
    });
    return { report: { ok: true, ...result }, exitCode: 0 };
  } catch (error) {
    if (error instanceof CommandInputError) {
      return fail("MIGRATION_CONSUME_INPUT_INVALID", error.message);
    }
    if (error instanceof RuntimeMigrationCandidateConsumeError) {
      return fail(error.code, error.message);
    }
    return fail(
      "MIGRATION_CONSUME_FAILED",
      error instanceof Error ? error.message : String(error),
    );
  }
}

/* --------------------------------------------------------------- helpers --- */

function parseArgs(argv: readonly string[]): Record<string, string | true> {
  const out: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      throw new CommandInputError(`unexpected argument ${JSON.stringify(token)}`);
    }
    const key = token.slice(2);
    if (!/^[a-z][a-z-]{1,40}$/.test(key)) {
      throw new CommandInputError(`malformed flag ${JSON.stringify(token)}`);
    }
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      out[key] = true;
    } else {
      out[key] = next;
      i += 1;
    }
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

function requireAbsoluteArg(args: Record<string, string | true>, key: string): string {
  const raw = requireArg(args, key);
  if (raw.split(/[\\/]/).includes("..")) {
    throw new CommandInputError(`--${key} must not contain ".."`);
  }
  const resolved = path.resolve(raw);
  if (!path.isAbsolute(resolved)) {
    throw new CommandInputError(`--${key} must resolve to an absolute path`);
  }
  return resolved;
}

function requireDirArg(args: Record<string, string | true>, key: string): string {
  const resolved = requireAbsoluteArg(args, key);
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

function requireIntArg(args: Record<string, string | true>, key: string): number {
  const raw = requireArg(args, key);
  if (!/^[0-9]{1,15}$/.test(raw)) throw new CommandInputError(`--${key} must be a non-negative integer`);
  return Number(raw);
}

function requireHexArg(args: Record<string, string | true>, key: string): string {
  const raw = requireArg(args, key);
  if (!/^[a-f0-9]{64}$/.test(raw)) throw new CommandInputError(`--${key} must be a sha-256 hex digest`);
  return raw;
}

function fail(code: string, detail: string): RuntimeMigrationCandidateConsumeCommandResult {
  return { report: { ok: false, code, detail }, exitCode: 1 };
}
