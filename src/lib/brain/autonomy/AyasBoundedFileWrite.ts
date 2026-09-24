import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

/**
 * Schema-agnostic bounded file write, modeled on the same hash-precondition
 * + atomic-write + rollback-on-failure pattern `AyasGuidedRepair.ts` already
 * proves safe in production. This module knows nothing about proposals,
 * authorizations, or approval schemas — only file identity — so both a
 * Package C mutation registry entry and any future caller can share it
 * without coupling their authorization models together. (Guided Repair
 * itself keeps its own existing, already safety-patched implementation
 * unchanged for this sprint — extracting it would risk losing its
 * failure-path provenance behavior without a materially simpler result;
 * not worth the risk to a live file for a refactor alone.)
 */

export const AYAS_BOUNDED_WRITE_DENIED_SEGMENTS = /(?:^|\/)(?:\.git|node_modules|data|secrets|\.env)(?:\/|$)/i;

export class AyasBoundedFileWriteError extends Error {
  constructor(readonly code:
    | "AYAS_BOUNDED_WRITE_PATH_DENIED"
    | "AYAS_BOUNDED_WRITE_PATH_OUTSIDE_ALLOWLIST"
    | "AYAS_BOUNDED_WRITE_CREATE_NOT_ALLOWED"
    | "AYAS_BOUNDED_WRITE_PRECONDITION_MISMATCH"
    | "AYAS_BOUNDED_WRITE_NEW_FILE_MUST_USE_NULL_PRECONDITION", message: string) {
    super(message);
    this.name = "AyasBoundedFileWriteError";
    this.stack = undefined;
  }
}

export interface AyasBoundedFileReplacement {
  readonly filePath: string;
  readonly expectedHash: string | null;
  readonly content: string;
  readonly allowCreate?: boolean;
}

export interface AyasBoundedWriteOutcome {
  readonly filePath: string;
  readonly beforeHash: string | null;
  readonly afterHash: string;
}

const textHash = (value: string): string => crypto.createHash("sha256").update(value, "utf8").digest("hex");

function replaceFileAtomically(abs: string, content: string): void {
  const temporary = path.join(path.dirname(abs), `.${path.basename(abs)}.ayas-${crypto.randomUUID()}.tmp`);
  try {
    const mode = fs.existsSync(abs) ? fs.statSync(abs).mode : 0o600;
    fs.writeFileSync(temporary, content, { encoding: "utf8", flag: "wx", mode });
    // Replacing the directory entry does not follow a leaf symlink introduced
    // between the path check and commit; direct writeFileSync would follow it.
    fs.renameSync(temporary, abs);
  } finally {
    try { fs.rmSync(temporary, { force: true }); } catch { /* preserve the original failure */ }
  }
}

/**
 * Resolves `filePath` (relative to `repoRoot`) and rejects traversal,
 * absolute paths, null bytes, and any denied segment — the caller supplies
 * its own allowlist of permitted root prefixes (e.g. `["src/", "scripts/"]`),
 * since different callers legitimately allow different areas of the repo.
 */
export function resolveAyasBoundedPath(repoRoot: string, filePath: string, allowedRoots: readonly string[]): string {
  const n = filePath.replace(/\\/g, "/").replace(/^\.\//, "");
  if (!n || n.includes("..") || n.includes("\0") || path.isAbsolute(n) || /^[A-Za-z]:/.test(n) || AYAS_BOUNDED_WRITE_DENIED_SEGMENTS.test(n)) {
    throw new AyasBoundedFileWriteError("AYAS_BOUNDED_WRITE_PATH_DENIED", `path denied: ${filePath}`);
  }
  if (!allowedRoots.some((root) => n.startsWith(root))) {
    throw new AyasBoundedFileWriteError("AYAS_BOUNDED_WRITE_PATH_OUTSIDE_ALLOWLIST", `path outside allowlist: ${filePath}`);
  }
  const root = path.resolve(repoRoot);
  const resolved = path.resolve(root, n);
  // A lexical allowlist is insufficient: an existing source directory may
  // be a symlink/junction to another tree. Reject every existing component,
  // including the leaf, before either reading a precondition or writing.
  const realRoot = fs.realpathSync(root);
  let cursor = root;
  for (const segment of n.split("/")) {
    cursor = path.join(cursor, segment);
    let stat: fs.Stats;
    try { stat = fs.lstatSync(cursor); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") break;
      throw error;
    }
    const real = fs.realpathSync(cursor);
    const relative = path.relative(realRoot, real);
    if (stat.isSymbolicLink() || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new AyasBoundedFileWriteError("AYAS_BOUNDED_WRITE_PATH_DENIED", `linked or escaped path denied: ${filePath}`);
    }
  }
  return resolved;
}

/**
 * Checks every replacement's hash precondition against the real current
 * file (or requires `allowCreate` + a `null` precondition for a genuinely
 * new file), then writes all of them, then calls `after(outcomes)`. If
 * `after` throws — or a precondition fails before any write happens — every
 * file actually written by this call is rolled back to its captured
 * original content (or deleted, if it was newly created), and the error is
 * re-thrown. A partial mutation is never left on disk.
 */
export async function applyAyasBoundedFileReplacements<T>(
  repoRoot: string,
  allowedRoots: readonly string[],
  replacements: readonly AyasBoundedFileReplacement[],
  after: (outcomes: readonly AyasBoundedWriteOutcome[]) => Promise<T>,
): Promise<T> {
  const before: Array<{ abs: string; old: string | null; replacement: AyasBoundedFileReplacement }> = [];
  for (const replacement of replacements) {
    const abs = resolveAyasBoundedPath(repoRoot, replacement.filePath, allowedRoots);
    const exists = fs.existsSync(abs);
    const old = exists ? fs.readFileSync(abs, "utf8") : null;
    if (!exists && !replacement.allowCreate) throw new AyasBoundedFileWriteError("AYAS_BOUNDED_WRITE_CREATE_NOT_ALLOWED", `file creation not approved: ${replacement.filePath}`);
    if (exists && replacement.expectedHash !== textHash(old as string)) throw new AyasBoundedFileWriteError("AYAS_BOUNDED_WRITE_PRECONDITION_MISMATCH", `precondition hash mismatch: ${replacement.filePath}`);
    if (!exists && replacement.expectedHash !== null) throw new AyasBoundedFileWriteError("AYAS_BOUNDED_WRITE_NEW_FILE_MUST_USE_NULL_PRECONDITION", `new file must use null precondition: ${replacement.filePath}`);
    before.push({ abs, old, replacement });
  }
  const written: typeof before = [];
  try {
    for (const item of before) {
      // Recheck after preflight; a linked component introduced while the other
      // replacement hashes were read must not become a write target.
      resolveAyasBoundedPath(repoRoot, item.replacement.filePath, allowedRoots);
      fs.mkdirSync(path.dirname(item.abs), { recursive: true });
      resolveAyasBoundedPath(repoRoot, item.replacement.filePath, allowedRoots);
      replaceFileAtomically(item.abs, item.replacement.content);
      written.push(item);
    }
    const outcomes: readonly AyasBoundedWriteOutcome[] = before.map((item) => ({
      filePath: item.replacement.filePath,
      beforeHash: item.old === null ? null : textHash(item.old),
      afterHash: textHash(item.replacement.content),
    }));
    return await after(outcomes);
  } catch (error) {
    for (let i = written.length - 1; i >= 0; i--) {
      const item = written[i]!;
      try {
        resolveAyasBoundedPath(repoRoot, item.replacement.filePath, allowedRoots);
        const current = fs.existsSync(item.abs) ? fs.readFileSync(item.abs, "utf8") : null;
        if (current !== item.replacement.content) continue; // someone else already changed it further — do not clobber
        if (item.old === null) fs.rmSync(item.abs, { force: true }); else replaceFileAtomically(item.abs, item.old);
      } catch { /* fail closed; caller's own journal records the failure */ }
    }
    throw error;
  }
}
