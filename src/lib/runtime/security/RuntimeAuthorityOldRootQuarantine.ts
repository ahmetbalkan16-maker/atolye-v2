import fs from "node:fs";
import path from "node:path";
import { validateSafeAncestorChain } from "@/lib/runtime/RuntimeStoragePaths";
import { runtimeAuthorityProjectsContentDigest } from "./RuntimeAuthorityTransition";

/**
 * C.2B.11 — the OS read-only barrier for a retired (quarantined) runtime root.
 *
 * On Windows / NTFS the mechanism is `FILE_ATTRIBUTE_READONLY` on every regular
 * file under the retired `projects/` tree (Node maps `chmod 0o444` to it). It is
 * **advisory** — a process with the file open for write, or one that clears the
 * attribute first, can still write; that is the documented threat-model boundary
 * (same as C.2B.9b's "raw fs.write is not prevented" note). It is enough to keep
 * the retired tree out of *accidental* serving/mutation and to anchor an audit +
 * rollback-token contract.
 *
 * There is **no silent fallback**. If the barrier cannot be applied and then
 * *verified* on every file, `enforceOldRootReadOnly` throws
 * `QUARANTINE_NOT_ENFORCED` and the caller must stop.
 */

export type RuntimeAuthorityOldRootQuarantineErrorCode =
  | "QUARANTINE_INPUT_INVALID"
  | "QUARANTINE_UNSAFE_TREE"
  | "QUARANTINE_NOT_ENFORCED"
  | "QUARANTINE_LIFT_FAILED";

const messages: Readonly<Record<RuntimeAuthorityOldRootQuarantineErrorCode, string>> = Object.freeze({
  QUARANTINE_INPUT_INVALID: "Old-root quarantine input is invalid.",
  QUARANTINE_UNSAFE_TREE: "Old-root tree contains a symlink / junction / non-regular file.",
  QUARANTINE_NOT_ENFORCED: "Old-root read-only quarantine could not be applied and verified.",
  QUARANTINE_LIFT_FAILED: "Old-root read-only quarantine could not be lifted for the rollback.",
});

export class RuntimeAuthorityOldRootQuarantineError extends Error {
  constructor(readonly code: RuntimeAuthorityOldRootQuarantineErrorCode, detail?: string) {
    super(detail ? `${messages[code]} — ${detail}` : messages[code]);
    this.name = "RuntimeAuthorityOldRootQuarantineError";
    this.stack = undefined;
  }
}

export interface RuntimeAuthorityOldRootQuarantineResult {
  readonly mode: "windows-readonly-attribute";
  readonly readOnlyFileCount: number;
  readonly contentDigest: string;
}

const OWNER_WRITE = 0o200;

/**
 * Apply + verify the read-only barrier over `<oldRoot>/projects`. Returns the
 * per-file count and the (unchanged) content digest so the caller can bind it
 * into the durable quarantine-enforcement record.
 */
export function enforceOldRootReadOnly(
  oldRootProjectsRoot: string,
): RuntimeAuthorityOldRootQuarantineResult {
  const root = requireSafeProjectsRoot(oldRootProjectsRoot);
  const files = collectRegularFiles(root);

  for (const file of files) {
    try {
      fs.chmodSync(file, 0o444);
    } catch (error) {
      throw new RuntimeAuthorityOldRootQuarantineError(
        "QUARANTINE_NOT_ENFORCED",
        `${path.relative(root, file)}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  // Verify: every file must now be non-writable by the owner.
  for (const file of files) {
    const mode = fs.statSync(file).mode;
    if ((mode & OWNER_WRITE) !== 0) {
      throw new RuntimeAuthorityOldRootQuarantineError(
        "QUARANTINE_NOT_ENFORCED",
        `${path.relative(root, file)} is still writable`,
      );
    }
  }

  const content = runtimeAuthorityProjectsContentDigest(root);
  return Object.freeze({
    mode: "windows-readonly-attribute",
    readOnlyFileCount: files.length,
    contentDigest: content.contentDigest,
  });
}

/** Read-only check — never mutates. Throws `QUARANTINE_NOT_ENFORCED` on any gap. */
export function verifyOldRootReadOnly(
  oldRootProjectsRoot: string,
): RuntimeAuthorityOldRootQuarantineResult {
  const root = requireSafeProjectsRoot(oldRootProjectsRoot);
  const files = collectRegularFiles(root);
  for (const file of files) {
    if ((fs.statSync(file).mode & OWNER_WRITE) !== 0) {
      throw new RuntimeAuthorityOldRootQuarantineError(
        "QUARANTINE_NOT_ENFORCED",
        `${path.relative(root, file)} is writable`,
      );
    }
  }
  return Object.freeze({
    mode: "windows-readonly-attribute",
    readOnlyFileCount: files.length,
    contentDigest: runtimeAuthorityProjectsContentDigest(root).contentDigest,
  });
}

/**
 * Lift the barrier so a token-authorized rollback can re-activate the old root.
 * Restores `0o644` and verifies every file is writable again.
 */
export function liftOldRootReadOnly(oldRootProjectsRoot: string): { readonly restoredFileCount: number } {
  const root = requireSafeProjectsRoot(oldRootProjectsRoot);
  const files = collectRegularFiles(root);
  for (const file of files) {
    try {
      fs.chmodSync(file, 0o644);
    } catch (error) {
      throw new RuntimeAuthorityOldRootQuarantineError(
        "QUARANTINE_LIFT_FAILED",
        `${path.relative(root, file)}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  for (const file of files) {
    if ((fs.statSync(file).mode & OWNER_WRITE) === 0) {
      throw new RuntimeAuthorityOldRootQuarantineError(
        "QUARANTINE_LIFT_FAILED",
        `${path.relative(root, file)} is still read-only`,
      );
    }
  }
  return { restoredFileCount: files.length };
}

/* --------------------------------------------------------------- helpers --- */

function requireSafeProjectsRoot(value: string): string {
  if (typeof value !== "string" || !value || !path.isAbsolute(value)) {
    throw new RuntimeAuthorityOldRootQuarantineError("QUARANTINE_INPUT_INVALID");
  }
  if (value.split(/[\\/]/).includes("..")) {
    throw new RuntimeAuthorityOldRootQuarantineError("QUARANTINE_INPUT_INVALID", "..");
  }
  const resolved = path.resolve(value);
  try {
    validateSafeAncestorChain(resolved);
    const link = fs.lstatSync(resolved);
    if (link.isSymbolicLink() || !link.isDirectory()) {
      throw new RuntimeAuthorityOldRootQuarantineError("QUARANTINE_UNSAFE_TREE", "root");
    }
  } catch (error) {
    if (error instanceof RuntimeAuthorityOldRootQuarantineError) throw error;
    throw new RuntimeAuthorityOldRootQuarantineError("QUARANTINE_INPUT_INVALID", "ancestor chain");
  }
  return resolved;
}

function collectRegularFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const link = fs.lstatSync(full);
      if (link.isSymbolicLink()) {
        throw new RuntimeAuthorityOldRootQuarantineError("QUARANTINE_UNSAFE_TREE", path.relative(root, full));
      }
      if (link.isDirectory()) {
        walk(full);
        continue;
      }
      if (!link.isFile()) {
        throw new RuntimeAuthorityOldRootQuarantineError("QUARANTINE_UNSAFE_TREE", path.relative(root, full));
      }
      out.push(full);
    }
  };
  walk(root);
  out.sort();
  return out;
}
