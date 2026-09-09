import { isAudioCompensationJournalStagingPartialAtProjectPath } from "@/lib/audio/AudioCompensationStore";

/**
 * F5 / F12 / F16-A — the single EXCLUDE-SAFE predicate for inert, non-durable
 * transient artifacts under a `projects/` tree.
 *
 * A file whose project-relative POSIX path matches is either abandoned
 * atomic-write staging or a process-local coordination lock — never authority,
 * never a durable `production-execution` record, never a project manifest or
 * asset. It is excluded identically by:
 *
 *   - `collectRuntimeBackupInventory` — the backup / candidate / consume material
 *   - `runtimeAuthorityProjectsContentDigest` — the F3 byte-exact digest that
 *     `authority:prepare`, `authority:validate`, rollback / former-target
 *     validation, old-root quarantine, and the consume post-copy check all use.
 *
 * Keeping one predicate for both sides is what makes the byte-exact digest
 * contract consistent: a `.partial` staging file that exists in the repo source
 * but is (correctly) absent from the materialized target no longer produces a
 * spurious `TRANSITION_TARGET_CONTENT_MISMATCH` (F16).
 *
 * Matches, on a project-relative POSIX path:
 *   - `.audio-journal-staging/<name>.partial` atomic-write staging (F12 layout,
 *     via `isAudioCompensationJournalStagingPartialAtProjectPath`)
 *   - any path segment beginning `.pipeline-jobs.` and everything nested under
 *     it — `PipelineJobMutationLock`'s process-local mutex directory, its
 *     `-gate`, `identity-`, `stale-` and `quarantine-` siblings — the same rule
 *     `collectRuntimeBackupInventory` already applies.
 *
 * The caller owns path-traversal / symlink / special-file safety; this operates
 * on an already-canonical, already-safety-checked project-relative POSIX path.
 */
export function isRuntimeTransientExcludedRelativePath(
  projectsRelativePosixPath: string,
): boolean {
  return (
    isAudioCompensationJournalStagingPartialAtProjectPath(projectsRelativePosixPath) ||
    projectsRelativePosixPath.includes("/.pipeline-jobs.") ||
    projectsRelativePosixPath.startsWith(".pipeline-jobs.")
  );
}
