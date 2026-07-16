import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { RuntimeStorageContext } from "@/lib/runtime/RuntimeStoragePaths";
import { validateMutationRelativePath } from "@/lib/runtime/security/RuntimePathPolicy";
import {
  canonicalRuntimePath,
  runtimeCandidateProtectedRootsFromContext,
  runtimePathInside,
  sameRuntimePath,
} from "@/lib/runtime/security/RuntimeProtectedRoots";
import { RuntimeMigrationCandidateError } from "./RuntimeMigrationCandidateError";

const candidateIdPattern = /^candidate-[a-f0-9]{64}$/;

export interface RuntimeMigrationCandidatePathPlan {
  readonly candidateRoot: string;
  readonly candidateDirectory: string;
  readonly manifestPath: string;
  readonly digestPath: string;
  readonly payloadRoot: string;
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
  const relative = `candidates/${candidateId}`;
  try {
    validateMutationRelativePath(relative, candidateRoot);
  } catch {
    throw new RuntimeMigrationCandidateError("PATH_POLICY_VIOLATION");
  }
  const candidateDirectory = path.resolve(candidateRoot, "candidates", candidateId);
  return Object.freeze({
    candidateRoot,
    candidateDirectory,
    manifestPath: path.join(candidateDirectory, "candidate.json"),
    digestPath: path.join(candidateDirectory, "candidate.sha256"),
    payloadRoot: path.join(candidateDirectory, "payload"),
    projectsRoot: path.join(candidateDirectory, "payload", "projects"),
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
