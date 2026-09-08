import { execFileSync } from "node:child_process";
import path from "node:path";
import type { RuntimeStorageContext } from "@/lib/runtime/RuntimeStoragePaths";
import { collectRuntimeBackupInventory } from "@/lib/runtime/backup/RuntimeBackupInventory";
import {
  aggregateRuntimeFileRecords,
  type RuntimeBackupFileRecord,
} from "@/lib/runtime/backup/RuntimeBackupManifest";
import { verifyRuntimeBackup } from "@/lib/runtime/backup/RuntimeBackupVerifier";
import { canonicalRuntimePath, runtimePathInside } from "@/lib/runtime/security/RuntimeProtectedRoots";
import { RuntimeMigrationCandidateError } from "./RuntimeMigrationCandidateError";

/**
 * C1 (C.2B.10a) — external-source preflight adapter.
 *
 * `preflightRuntimeMigrationCandidate` hard-codes the repo-local `data/projects`
 * pathspec for its Git-cleanliness check, so it cannot evaluate a source whose
 * `ATOLYE_RUNTIME_ROOT` points outside the repository. This adapter separates:
 *
 *   - **filesystem source cleanliness** — the live projects tree at
 *     `context.projectsRoot` must match the verified backup byte-for-byte
 *     (inventory identity + aggregate + marker + durable aggregate). Always run.
 *
 *   - **repository cleanliness** — a Git worktree check. Only meaningful when the
 *     source IS repo-local; opt in with `repositoryGitEvidence`. For a genuinely
 *     external source it is skipped and reported as `not-applicable`, never
 *     silently treated as "clean".
 *
 * It performs no mutation and never touches the real source data.
 */

export interface RuntimeMigrationExternalSourcePreflightInput {
  readonly sourceContext: RuntimeStorageContext;
  readonly backupDirectory: string;
  /**
   * Provide only when the source projects tree lives inside a Git repository and
   * its worktree cleanliness is part of the readiness contract.
   */
  readonly repositoryGitEvidence?: {
    readonly repositoryRoot: string;
    /** Repo-relative pathspec for the source projects, e.g. `data/projects`. */
    readonly projectsPathspec: string;
  };
  readonly now?: () => string;
}

export interface RuntimeMigrationExternalSourcePreflightReport {
  readonly status: "external-source-preflight-ready";
  readonly sourceClassification: RuntimeStorageContext["classification"];
  readonly sourceProjectsRoot: string;
  readonly filesystemSourceClean: true;
  readonly repositoryCleanliness: "clean" | "not-applicable";
  readonly backupVerified: true;
  readonly aggregateFingerprint: string;
  readonly durableExecutionAggregate: string;
  readonly markerBindingVerified: true;
  readonly files: number;
  readonly bytes: number;
  readonly mutationPerformed: false;
  readonly cutoverAuthorized: false;
}

export function preflightRuntimeMigrationExternalSource(
  input: RuntimeMigrationExternalSourcePreflightInput,
): RuntimeMigrationExternalSourcePreflightReport {
  if (!input.backupDirectory || !path.isAbsolute(input.backupDirectory)) {
    throw new RuntimeMigrationCandidateError("BACKUP_REQUIRED");
  }
  let backupDirectory: string;
  try {
    backupDirectory = canonicalRuntimePath(input.backupDirectory);
  } catch {
    throw new RuntimeMigrationCandidateError("BACKUP_INVALID");
  }

  let backup;
  try {
    backup = verifyRuntimeBackup(backupDirectory);
  } catch {
    throw new RuntimeMigrationCandidateError("BACKUP_INVALID");
  }
  if (backup.manifest.sourceLogicalIdentity !== "projects") {
    throw new RuntimeMigrationCandidateError("BACKUP_INVALID");
  }

  // filesystem source cleanliness — the live tree must equal the backup.
  const live = collectRuntimeBackupInventory({
    context: {
      environment: { ATOLYE_RUNTIME_ROOT: input.sourceContext.runtimeRoot },
      workspaceRoot: input.sourceContext.workspaceRoot,
    },
    now: input.now,
  });
  if (
    JSON.stringify(treeIdentity(live.files)) !== JSON.stringify(treeIdentity(backup.manifest.files)) ||
    live.aggregateFingerprint !== backup.aggregateFingerprint ||
    live.inventory.files !== backup.manifest.inventory.files ||
    live.inventory.bytes !== backup.manifest.inventory.bytes
  ) {
    throw new RuntimeMigrationCandidateError("SOURCE_STALE");
  }

  const liveMarkers = bindings(live.files, "acceptance-marker");
  const backupMarkers = bindings(backup.manifest.files, "acceptance-marker");
  const liveDurable = durableAggregate(live.files);
  const backupDurable = durableAggregate(backup.manifest.files);
  if (JSON.stringify(liveMarkers) !== JSON.stringify(backupMarkers) || liveDurable !== backupDurable) {
    throw new RuntimeMigrationCandidateError("CRITICAL_STATE_MISMATCH");
  }

  // repository cleanliness — only when explicitly in scope.
  let repositoryCleanliness: "clean" | "not-applicable" = "not-applicable";
  if (input.repositoryGitEvidence) {
    const { repositoryRoot, projectsPathspec } = input.repositoryGitEvidence;
    let repoRoot: string;
    try {
      repoRoot = canonicalRuntimePath(repositoryRoot);
    } catch {
      throw new RuntimeMigrationCandidateError("INVALID_ARGUMENT");
    }
    if (
      typeof projectsPathspec !== "string" ||
      !projectsPathspec ||
      path.isAbsolute(projectsPathspec) ||
      projectsPathspec.includes("\\") ||
      projectsPathspec.split("/").includes("..")
    ) {
      throw new RuntimeMigrationCandidateError("INVALID_ARGUMENT");
    }
    // The pathspec must actually resolve to the source projects root.
    if (!runtimePathInside(repoRoot, input.sourceContext.projectsRoot) &&
        canonicalRuntimePath(path.join(repoRoot, projectsPathspec)) !== input.sourceContext.projectsRoot) {
      throw new RuntimeMigrationCandidateError("CRITICAL_STATE_MISMATCH");
    }
    if (!cleanWorktree(repoRoot, projectsPathspec)) {
      throw new RuntimeMigrationCandidateError("SOURCE_STALE");
    }
    repositoryCleanliness = "clean";
  }

  return Object.freeze({
    status: "external-source-preflight-ready",
    sourceClassification: input.sourceContext.classification,
    sourceProjectsRoot: input.sourceContext.projectsRoot,
    filesystemSourceClean: true,
    repositoryCleanliness,
    backupVerified: true,
    aggregateFingerprint: backup.aggregateFingerprint,
    durableExecutionAggregate: liveDurable,
    markerBindingVerified: true,
    files: backup.manifest.inventory.files,
    bytes: backup.manifest.inventory.bytes,
    mutationPerformed: false,
    cutoverAuthorized: false,
  });
}

function cleanWorktree(repositoryRoot: string, pathspec: string): boolean {
  try {
    const output = execFileSync(
      "git",
      ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", pathspec],
      { cwd: repositoryRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    return output.length === 0;
  } catch {
    throw new RuntimeMigrationCandidateError("INVALID_ARGUMENT");
  }
}

function treeIdentity(files: readonly RuntimeBackupFileRecord[]) {
  return files.map((file) => ({
    relativePath: file.relativePath,
    sizeBytes: file.sizeBytes,
    sha256: file.sha256,
    permissionClass: file.permissionClass,
    projectSlug: file.projectSlug,
    classification: file.classification,
  }));
}

function bindings(files: readonly RuntimeBackupFileRecord[], classification: string) {
  return files
    .filter((file) => file.classification === classification)
    .map((file) => ({ relativePath: file.relativePath, sha256: file.sha256 }));
}

function durableAggregate(files: readonly RuntimeBackupFileRecord[]) {
  return aggregateRuntimeFileRecords(files.filter((file) => file.classification === "durable-execution"));
}
