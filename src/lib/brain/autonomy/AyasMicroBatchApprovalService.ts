import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { createAyasMicroBatchStore, type AyasMicroBatchStoreHandle, type AyasMicroBatch } from "./AyasMicroBatch";
import { createAyasMicroItemStore, type AyasMicroItemStore } from "./AyasMicroItem";
import { createAyasPatchArtifactStore, type AyasPatchArtifactStore } from "./AyasPatchArtifact";
import { executeAyasApprovedMicroBatchWith, AyasMicroBatchExecutionError } from "./AyasMicroBatchExecutionService";
import { checkAyasBatchItemWithGraphify, AyasBatchGraphifyCheckError } from "./AyasBatchGraphifyCheck";

/**
 * M18.1 — "BATCH ONAYLA VE UYGULA": the single human authorization the user
 * asked to replace the three-step ONAYLA → YÜRÜT → Git-publish flow with, for
 * the governed micro-batch lane specifically. This module is the ONLY new
 * authority surface this policy change introduces — it is a thin
 * orchestrator around modules that already existed and were already
 * independently tested:
 *
 *   decide (AyasMicroBatch.decide)
 *   → execute (AyasMicroBatchExecutionService.executeAyasApprovedMicroBatchWith,
 *     itself unmodified Package C — reservation/journal/gate/authority-lock/
 *     revalidation/mutation/finalization — with one new optional hook)
 *   → per-item Graphify structural check (AyasBatchGraphifyCheck), inside
 *     that same execution's atomic write, so a failure rolls back the WHOLE
 *     batch via the existing AyasBoundedFileWrite guarantee — no new
 *     rollback mechanism
 *   → post-execution batch-wide validation (final Graphify refresh, project
 *     TypeScript, batch validators again)
 *   → exact-scope Git staging → ONE commit → push → local==remote
 *
 * Nothing here bypasses Package C. Nothing here accepts proposal text,
 * shell commands, or arbitrary file content — every mutation still flows
 * through the frozen `AyasPatchArtifact`s the batch already references.
 *
 * FAIL-CLOSED BINDING: the caller must supply the exact `batchHash` shown to
 * the human. If the batch has changed in ANY way since (HEAD drift, an item
 * added/removed, a patchHash drift) the batch's OWN store already refuses
 * `decide()` — see `AyasMicroBatch.ts`'s existing hash-mismatch guard, reused
 * unchanged. This module adds no separate binding check because one already
 * exists and duplicating it would be a second, potentially-divergent
 * definition of "the batch changed."
 */
export class AyasMicroBatchApprovalError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "AyasMicroBatchApprovalError";
    this.stack = undefined;
  }
}

export function defaultAyasMicroBatchApprovalDeps(): AyasMicroBatchApprovalDeps {
  const repoRoot = process.cwd();
  return { repoRoot, gateRoot: path.join(repoRoot, "data", "brain", "self-improvement") };
}

export interface AyasMicroBatchApprovalDeps {
  readonly repoRoot: string;
  readonly gateRoot: string;
  readonly remoteName?: string;
  readonly batchStore?: AyasMicroBatchStoreHandle;
  readonly itemStore?: AyasMicroItemStore;
  readonly artifactStore?: AyasPatchArtifactStore;
  /** Test seam only — real callers never set this; defaults to the actual generator-shape contract every eligible micro generator currently produces (`node:assert/strict` + one target-class import). */
  readonly expectedImportCountByGenerator?: Readonly<Record<string, number>>;
}

export type AyasMicroBatchApprovalOutcome =
  | { readonly ok: true; readonly commitSha: string; readonly pushed: true; readonly changedFiles: readonly string[] }
  | { readonly ok: false; readonly code: string; readonly stage: "EXECUTION" | "POST_VALIDATION" | "STAGING" | "COMMIT" | "PUSH"; readonly message: string };

function git(repoRoot: string, args: readonly string[]): string {
  return execFileSync("git", [...args], { cwd: repoRoot, encoding: "utf8", windowsHide: true }).trim();
}

const DEFAULT_EXPECTED_IMPORT_COUNT: Readonly<Record<string, number>> = {
  "ayas-detector:error-code-contract-gap-v1": 2, // node:assert/strict + the one target-class import — this generator's own fixed, declared shape
};

/** Deletes every file in `files` that currently exists — used ONLY to revert a Step-4 (post-execution) failure. Safe precisely because every current micro-item file is brand-new (`allowCreate: true`, `expectedHash: null`); there is no "previous content" to restore, only a clean absence to return to. */
function revertNewFiles(repoRoot: string, files: readonly string[]): void {
  for (const f of files) {
    const abs = path.join(repoRoot, f);
    if (fs.existsSync(abs)) fs.rmSync(abs, { force: true });
  }
}

function commitMessageFor(batch: AyasMicroBatch): string {
  const isPureTests = batch.exactFilesUnion.every((f) => f.startsWith("scripts/smoke-") || f.startsWith("scripts/") && f.includes("smoke"));
  const kind = isPureTests ? "test" : "chore";
  const lines = [
    `${kind}(ayas): apply safe micro-improvement batch`,
    "",
    `AYAS-governed batch of ${batch.items.length} micro item(s), human-approved as one unit`,
    `(BATCH ONAYLA VE UYGULA), executed through Package C, Graphify-verified per`,
    "item and after the full batch, and validated before publication.",
    "",
    `batchId: ${batch.batchId}`,
    `batchHash: ${batch.batchHash}`,
    "",
    "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>",
  ];
  return lines.join("\n");
}

/**
 * The one entrypoint for "BATCH ONAYLA VE UYGULA". Accepts only a batchId
 * and the exact batchHash the human reviewed. Every other input is
 * re-derived from durable state, exactly like every other M17/M18
 * execution entrypoint.
 */
export async function approveAndExecuteAyasMicroBatch(batchId: string, approvedBatchHash: string, deps: AyasMicroBatchApprovalDeps): Promise<AyasMicroBatchApprovalOutcome> {
  if (typeof batchId !== "string" || !batchId.trim()) throw new AyasMicroBatchApprovalError("INVALID_INPUT", "batchId is required");
  if (typeof approvedBatchHash !== "string" || !approvedBatchHash.trim()) throw new AyasMicroBatchApprovalError("INVALID_INPUT", "approvedBatchHash is required");

  const batchStore = deps.batchStore ?? createAyasMicroBatchStore();
  const itemStore = deps.itemStore ?? createAyasMicroItemStore();
  const artifactStore = deps.artifactStore ?? createAyasPatchArtifactStore();
  const remoteName = deps.remoteName ?? "origin";
  const expectedImportCounts = deps.expectedImportCountByGenerator ?? DEFAULT_EXPECTED_IMPORT_COUNT;

  const batchBefore = batchStore.load().batches.find((b) => b.batchId === batchId);
  if (!batchBefore) throw new AyasMicroBatchApprovalError("NOT_FOUND", "batch not found");
  if (batchBefore.status !== "READY_FOR_REVIEW") throw new AyasMicroBatchApprovalError("NOT_READY", `batch status is ${batchBefore.status}, not READY_FOR_REVIEW`);
  if (batchBefore.batchHash !== approvedBatchHash) throw new AyasMicroBatchApprovalError("BATCH_HASH_MISMATCH", "the batch changed since it was shown for review — authorization refused");

  // --- decide: one durable APPROVE decision, binding this exact batchHash + baseHead (AyasMicroBatch.decide's own existing guard) ---
  const now = () => new Date().toISOString();
  batchStore.decide(batchId, "APPROVE", approvedBatchHash, now());

  // --- Package C execution, with the per-item Graphify structural check inside the same atomic write ---
  try {
    await executeAyasApprovedMicroBatchWith(batchId, {
      repoRoot: deps.repoRoot,
      gateRoot: deps.gateRoot,
      batchStore,
      itemStore,
      artifactStore,
      onItemApplied: async (item) => {
        const artifact = artifactStore.loadVerified(
          batchStore.load().batches.find((b) => b.batchId === batchId)!.items.find((r) => r.microItemId === item.microItemId)!.patchArtifactId,
        );
        const expected = expectedImportCounts[artifact.generatorIdentity];
        if (expected === undefined) throw new AyasBatchGraphifyCheckError("AYAS_GRAPHIFY_UNEXPECTED_DEPENDENCY", `no declared Graphify import-count contract for generator "${artifact.generatorIdentity}" — refusing to guess`);
        for (const file of item.exactFiles) checkAyasBatchItemWithGraphify(deps.repoRoot, file, expected);
      },
    });
  } catch (error) {
    const code = error instanceof AyasMicroBatchExecutionError || error instanceof AyasBatchGraphifyCheckError ? error.code : error instanceof Error ? error.message : "EXECUTION_FAILED";
    return { ok: false, code, stage: "EXECUTION", message: error instanceof Error ? error.message : String(error) };
  }

  const batchAfterExec = batchStore.load().batches.find((b) => b.batchId === batchId)!;
  const files = batchAfterExec.exactFilesUnion;

  // --- Step 4: batch-wide post-execution validation (final Graphify refresh + project TypeScript + git diff --check) ---
  try {
    for (const file of files) {
      const artifact = artifactStore.loadVerified(batchAfterExec.items.find((r) => r.exactFiles.includes(file))!.patchArtifactId);
      const expected = expectedImportCounts[artifact.generatorIdentity] ?? 0;
      checkAyasBatchItemWithGraphify(deps.repoRoot, file, expected); // final refresh, re-derived from the now-committed working tree, not reused from the pre-commit check
    }
    const tscEntry = path.join(deps.repoRoot, "node_modules", "typescript", "bin", "tsc");
    execFileSync(process.execPath, [tscEntry, "--noEmit"], { cwd: deps.repoRoot, encoding: "utf8", windowsHide: true, timeout: 180_000 });
    git(deps.repoRoot, ["add", "-N", "--", ...files]);
    git(deps.repoRoot, ["diff", "--check", "--", ...files]);
  } catch (error) {
    git(deps.repoRoot, ["reset", "--", ...files]); // undo the intent-to-add above before reverting the files themselves
    revertNewFiles(deps.repoRoot, files);
    const message = error instanceof Error ? error.message : String(error);
    const code = error instanceof AyasBatchGraphifyCheckError ? error.code : "POST_EXECUTION_VALIDATION_FAILED";
    return { ok: false, code, stage: "POST_VALIDATION", message };
  }

  // --- Step 6: exact-scope Git staging only — never `git add .` / `-A` / `commit -a` ---
  git(deps.repoRoot, ["add", "--", ...files]);
  const stagedFiles = git(deps.repoRoot, ["diff", "--cached", "--name-only"]).split("\n").filter(Boolean).sort();
  const expectedFiles = [...files].sort();
  if (JSON.stringify(stagedFiles) !== JSON.stringify(expectedFiles)) {
    git(deps.repoRoot, ["reset"]);
    revertNewFiles(deps.repoRoot, files);
    return { ok: false, code: "AYAS_MICRO_BATCH_STAGE_SCOPE_MISMATCH", stage: "STAGING", message: `staged scope ${JSON.stringify(stagedFiles)} did not exactly match the approved batch's files ${JSON.stringify(expectedFiles)}` };
  }
  try {
    git(deps.repoRoot, ["diff", "--cached", "--check"]);
  } catch (error) {
    git(deps.repoRoot, ["reset"]);
    revertNewFiles(deps.repoRoot, files);
    return { ok: false, code: "AYAS_MICRO_BATCH_WHITESPACE_ERROR", stage: "STAGING", message: error instanceof Error ? error.message : String(error) };
  }

  // --- Step 7: ONE batch commit ---
  let commitSha: string;
  try {
    git(deps.repoRoot, ["commit", "-m", commitMessageFor(batchAfterExec)]);
    commitSha = git(deps.repoRoot, ["rev-parse", "HEAD"]);
  } catch (error) {
    // A commit failure with content already staged is left exactly as-is for
    // human inspection — RECOVERY_REQUIRED-equivalent, never auto-reset,
    // never auto-retried.
    return { ok: false, code: "AYAS_MICRO_BATCH_COMMIT_FAILED", stage: "COMMIT", message: error instanceof Error ? error.message : String(error) };
  }

  // --- Step 8: push, never force ---
  const branch = git(deps.repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"]);
  try {
    git(deps.repoRoot, ["push", remoteName, branch]);
  } catch (error) {
    // The commit already exists locally and is never rewritten/reset here —
    // a push failure is reported as-is; a human decides whether to retry.
    return { ok: false, code: "AYAS_MICRO_BATCH_PUSH_FAILED", stage: "PUSH", message: error instanceof Error ? error.message : String(error) };
  }

  const localHead = git(deps.repoRoot, ["rev-parse", "HEAD"]);
  const remoteHead = git(deps.repoRoot, ["rev-parse", `${remoteName}/${branch}`]);
  if (localHead !== remoteHead) {
    return { ok: false, code: "AYAS_MICRO_BATCH_PUBLISH_UNVERIFIED", stage: "PUSH", message: `local HEAD ${localHead} does not match ${remoteName}/${branch} ${remoteHead} after push` };
  }

  return { ok: true, commitSha, pushed: true, changedFiles: files };
}
