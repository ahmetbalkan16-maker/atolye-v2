import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { RuntimeStorageContext } from "@/lib/runtime/RuntimeStoragePaths";
import { validateRuntimeBackupMutationRelativePath } from "@/lib/runtime/backup/RuntimeBackupPathPolicy";
import {
  canonicalRuntimePath,
  runtimeCandidateProtectedRootsFromContext,
  runtimePathInside,
  sameRuntimePath,
} from "@/lib/runtime/security/RuntimeProtectedRoots";
import {
  runtimeMigrationCandidateDirName,
} from "./RuntimeMigrationCandidateManifest";
import { RuntimeMigrationCandidateError } from "./RuntimeMigrationCandidateError";

const candidateIdPattern = /^candidate-[a-f0-9]{64}$/;

export interface RuntimeMigrationCandidatePathPlan {
  readonly candidateRoot: string;
  /** `<candidateRoot>/candidates/c-<24hex>` — see `runtimeMigrationCandidateDirName`. */
  readonly candidateDirectory: string;
  readonly candidateDirName: string;
  readonly manifestPath: string;
  readonly digestPath: string;
  /** The payload tree lives directly under the candidate directory (F13: no `payload/` level). */
  readonly projectsRoot: string;
  readonly persistent: boolean;
}

export function validateMigrationCandidateId(value: string): string {
  if (!candidateIdPattern.test(value)) {
    throw new RuntimeMigrationCandidateError("CANDIDATE_ID_MISMATCH");
  }
  return value;
}

export function planMigrationCandidatePaths(input: {
  readonly candidateId: string;
  readonly candidateRoot: string;
  readonly context: RuntimeStorageContext;
  readonly repositoryRoot: string;
  readonly backupRoot: string;
  readonly backupDirectory: string;
  readonly restoreVerificationRoot: string;
  readonly allowTestTempRoot?: boolean;
}): RuntimeMigrationCandidatePathPlan {
  const candidateId = validateMigrationCandidateId(input.candidateId);
  let candidateRoot: string;
  try {
    candidateRoot = canonicalRuntimePath(input.candidateRoot);
    const link = fs.lstatSync(candidateRoot);
    if (link.isSymbolicLink() || !link.isDirectory()) throw new Error("invalid");
  } catch {
    throw new RuntimeMigrationCandidateError("DESTINATION_INVALID");
  }
  const protectedRoots = runtimeCandidateProtectedRootsFromContext({
    context: input.context,
    repositoryRoot: input.repositoryRoot,
    backupRoot: input.backupRoot,
    restoreVerificationRoot: input.restoreVerificationRoot,
    candidateRoot,
  });
  try {
    protectedRoots.assertWritableRoot(candidateRoot, "candidate");
  } catch {
    throw new RuntimeMigrationCandidateError("DESTINATION_INVALID");
  }
  let backupDirectory: string;
  try {
    backupDirectory = canonicalRuntimePath(input.backupDirectory);
  } catch {
    throw new RuntimeMigrationCandidateError("BACKUP_INVALID");
  }
  if (pathsOverlap(candidateRoot, backupDirectory)) {
    throw new RuntimeMigrationCandidateError("DESTINATION_INVALID");
  }
  const persistent = !insideOrEqual(os.tmpdir(), candidateRoot);
  if (!persistent && !input.allowTestTempRoot) {
    throw new RuntimeMigrationCandidateError("CAPABILITY_UNSUPPORTED");
  }
  const candidateDirName = runtimeMigrationCandidateDirName(candidateId);
  const relative = `candidates/${candidateDirName}`;
  try {
    validateRuntimeBackupMutationRelativePath(relative, candidateRoot);
  } catch {
    throw new RuntimeMigrationCandidateError("PATH_POLICY_VIOLATION");
  }
  const candidateDirectory = path.resolve(candidateRoot, "candidates", candidateDirName);
  return Object.freeze({
    candidateRoot,
    candidateDirectory,
    candidateDirName,
    manifestPath: path.join(candidateDirectory, "candidate.json"),
    digestPath: path.join(candidateDirectory, "candidate.sha256"),
    projectsRoot: path.join(candidateDirectory, "projects"),
    persistent,
  });
}

export function isUnsupportedNetworkCandidateRoot(value: string): boolean {
  const normalized = value.replaceAll("/", "\\");
  return normalized.startsWith("\\\\") || normalized.startsWith("\\?\\UNC\\");
}

function insideOrEqual(root: string, candidate: string) {
  return sameRuntimePath(root, candidate) || runtimePathInside(root, candidate);
}

function pathsOverlap(left: string, right: string) {
  return sameRuntimePath(left, right) ||
    runtimePathInside(left, right) ||
    runtimePathInside(right, left);
}
