import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { applyAyasBoundedFileReplacements, type AyasBoundedFileReplacement } from "./AyasBoundedFileWrite";
import { runAyasValidators, createAyasSmokeTestValidator, type AyasValidator, type AyasValidatorResult } from "./AyasMutationValidators";

const execFileAsync = promisify(execFile);

/**
 * M17 — isolated, disposable drafting surface for AI-generated patch
 * content. A sandbox is a real `git worktree` checked out at a specific
 * `baseHead`, created under `os.tmpdir()` — never inside this repository,
 * never the real working tree. Every write, validator run, and diff below
 * operates against `handle.sandboxRoot` only. Nothing here ever stages,
 * commits, or pushes; the worktree is destroyed after use regardless of
 * outcome (see `destroyAyasPatchSandbox`), and the real working tree is
 * never read from or written to except to create/destroy the worktree
 * itself via `git -C repoRoot worktree ...`.
 */
export class AyasPatchSandboxError extends Error {
  constructor(readonly code: "AYAS_SANDBOX_CREATE_FAILED" | "AYAS_SANDBOX_LINK_FAILED" | "AYAS_SANDBOX_DESTROY_FAILED", message: string) {
    super(message);
    this.name = "AyasPatchSandboxError";
    this.stack = undefined;
  }
}

export interface AyasPatchSandboxHandle {
  readonly repoRoot: string;
  readonly sandboxRoot: string;
  readonly baseHead: string;
}

async function git(cwd: string, args: readonly string[], timeout = 30_000): Promise<string> {
  const { stdout } = await execFileAsync("git", [...args], { cwd, encoding: "utf8", windowsHide: true, timeout, maxBuffer: 4_000_000 });
  return stdout;
}

/**
 * Creates the worktree and links a read-only view of `node_modules` into it
 * (a Windows junction / POSIX symlink — never a copy, never a fresh
 * `npm install`) so validators (`tsc`, the smoke test itself) can run there
 * exactly as they would in the real repo. Fails closed: any step failing
 * tears down whatever was already created before rethrowing.
 */
export async function createAyasPatchSandbox(repoRoot: string, baseHead: string): Promise<AyasPatchSandboxHandle> {
  const sandboxRoot = path.join(os.tmpdir(), `ayas-patch-sandbox-${crypto.randomUUID()}`);
  try {
    await git(repoRoot, ["worktree", "add", "--detach", "--force", sandboxRoot, baseHead]);
  } catch (error) {
    throw new AyasPatchSandboxError("AYAS_SANDBOX_CREATE_FAILED", error instanceof Error ? error.message : String(error));
  }
  try {
    const nodeModulesReal = path.join(repoRoot, "node_modules");
    const nodeModulesLink = path.join(sandboxRoot, "node_modules");
    if (fs.existsSync(nodeModulesReal) && !fs.existsSync(nodeModulesLink)) {
      fs.symlinkSync(nodeModulesReal, nodeModulesLink, process.platform === "win32" ? "junction" : "dir");
    }
  } catch (error) {
    await destroyAyasPatchSandbox({ repoRoot, sandboxRoot, baseHead }).catch(() => {});
    throw new AyasPatchSandboxError("AYAS_SANDBOX_LINK_FAILED", error instanceof Error ? error.message : String(error));
  }
  return { repoRoot, sandboxRoot, baseHead };
}

/** Thin, sandbox-scoped wrapper over the same bounded-write primitive Package C's own registry entries use — identical precondition-hash + atomic-write + rollback-on-failure guarantees, just rooted at `handle.sandboxRoot` instead of the real repo. */
export async function applyAyasPatchReplacementsInSandbox(
  handle: AyasPatchSandboxHandle,
  allowedRoots: readonly string[],
  replacements: readonly AyasBoundedFileReplacement[],
): Promise<void> {
  await applyAyasBoundedFileReplacements(handle.sandboxRoot, allowedRoots, replacements, async () => undefined);
}

const TSC_LOCAL_ENTRY = path.join("node_modules", "typescript", "bin", "tsc");

/** Project-wide `tsc --noEmit` inside the sandbox (or any other worktree rooted at `sandboxRoot`) — the only step exercising the full type system; targeted smoke-test validators (below) only transpile. Exported so M18's persistent batch worktree can reuse it unchanged. */
export function createAyasSandboxTypecheckValidator(): AyasValidator {
  return async (sandboxRoot: string): Promise<AyasValidatorResult> => {
    const entry = path.join(sandboxRoot, TSC_LOCAL_ENTRY);
    if (!fs.existsSync(entry)) return { validator: "typecheck-project", pass: false, summary: "local tsc binary is unavailable in sandbox" };
    try {
      await execFileAsync(process.execPath, [entry, "--noEmit"], { cwd: sandboxRoot, encoding: "utf8", windowsHide: true, timeout: 150_000, maxBuffer: 4_000_000 });
      return { validator: "typecheck-project", pass: true, summary: "tsc --noEmit passed" };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return { validator: "typecheck-project", pass: false, summary: detail.replace(/\s+/g, " ").trim().slice(0, 500) };
    }
  };
}

/** Runs a project-wide typecheck plus one `createAyasSmokeTestValidator` per declared script, in the sandbox. Stops at the first failure (same fail-fast contract as `runAyasValidators`). */
export async function runAyasPatchSandboxValidators(handle: AyasPatchSandboxHandle, validatorScripts: readonly string[]): Promise<readonly AyasValidatorResult[]> {
  const validators: readonly AyasValidator[] = [createAyasSandboxTypecheckValidator(), ...validatorScripts.map((script) => createAyasSmokeTestValidator(script))];
  return runAyasValidators(handle.sandboxRoot, validators);
}

/** `git diff` of the sandbox against its own `baseHead` — the exact human-reviewable diff, since the sandbox was checked out at that commit and never advanced. `git add -N` (intent-to-add) is required first: plain `git diff` never shows a brand-new, untracked file, and every current candidate is exactly that. */
export async function captureAyasPatchSandboxDiff(handle: AyasPatchSandboxHandle): Promise<string> {
  try {
    await git(handle.sandboxRoot, ["add", "-N", "-A"], 15_000);
    return await git(handle.sandboxRoot, ["diff", "--no-color", handle.baseHead, "--"], 15_000);
  } catch {
    return "";
  }
}

/** Always safe to call, including after a failed/partial create — removes the worktree registration and the directory, then prunes stale worktree metadata. Never throws for a sandbox that is already gone. */
export async function destroyAyasPatchSandbox(handle: AyasPatchSandboxHandle): Promise<void> {
  try {
    await git(handle.repoRoot, ["worktree", "remove", "--force", handle.sandboxRoot]);
  } catch {
    // Fall through to filesystem cleanup — the worktree entry may already be
    // gone, or removal may fail if the link/dir was partially constructed.
  }
  try {
    fs.rmSync(handle.sandboxRoot, { recursive: true, force: true });
  } catch { /* best-effort */ }
  try {
    await git(handle.repoRoot, ["worktree", "prune"]);
  } catch { /* best-effort */ }
}
