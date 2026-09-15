import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
export class AyasMutationScopeError extends Error {
  constructor(readonly code: "INVALID_PATH" | "OUTSIDE_REPOSITORY" | "REPARSE_POINT" | "REPOSITORY_DIRTY" | "HEAD_CHANGED" | "UNAUTHORIZED_MUTATION" | "GIT_UNAVAILABLE", message: string, readonly changedFiles: readonly string[] = []) { super(message); this.name = "AyasMutationScopeError"; this.stack = undefined; }
}

function identity(value: string): string { return process.platform === "win32" ? value.toLowerCase() : value; }
export function canonicalizeAyasExactFiles(repoRoot: string, files: readonly string[]): readonly string[] {
  const root = path.resolve(repoRoot);
  const realRoot = fs.realpathSync.native(root);
  const result = files.map((raw) => {
    if (typeof raw !== "string" || !raw || raw.includes("\0") || path.isAbsolute(raw) || /^[A-Za-z]:/u.test(raw)) throw new AyasMutationScopeError("INVALID_PATH", "exactFiles contains an invalid absolute or empty path");
    const normalized = path.posix.normalize(raw.replace(/\\/gu, "/")).replace(/^\.\//u, "");
    if (normalized === ".." || normalized.startsWith("../") || normalized.includes("/../")) throw new AyasMutationScopeError("OUTSIDE_REPOSITORY", "exactFiles path escapes repository root");
    const absolute = path.resolve(root, ...normalized.split("/"));
    const relative = path.relative(root, absolute);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new AyasMutationScopeError("OUTSIDE_REPOSITORY", "exactFiles path escapes repository root");
    let cursor = root;
    for (const segment of relative.split(path.sep)) {
      cursor = path.join(cursor, segment);
      if (!fs.existsSync(cursor)) break;
      if (fs.lstatSync(cursor).isSymbolicLink()) throw new AyasMutationScopeError("REPARSE_POINT", "exactFiles cannot traverse a symlink or junction");
      const real = fs.realpathSync.native(cursor);
      const fromRoot = path.relative(realRoot, real);
      if (fromRoot.startsWith("..") || path.isAbsolute(fromRoot)) throw new AyasMutationScopeError("OUTSIDE_REPOSITORY", "exactFiles resolves outside repository root");
    }
    return normalized;
  });
  return [...new Map(result.map((file) => [identity(file), file])).values()].sort((a, b) => identity(a).localeCompare(identity(b)));
}

async function git(repoRoot: string, args: readonly string[]): Promise<string> {
  try { return (await execFileAsync("git", ["-C", repoRoot, ...args], { encoding: "utf8", timeout: 10_000, windowsHide: true, maxBuffer: 2_000_000 })).stdout; }
  catch { throw new AyasMutationScopeError("GIT_UNAVAILABLE", "authoritative Git mutation state is unavailable"); }
}
async function changed(repoRoot: string): Promise<readonly string[]> {
  const [tracked, untracked] = await Promise.all([git(repoRoot, ["diff", "--name-only", "-z", "--find-renames", "HEAD"]), git(repoRoot, ["ls-files", "--others", "--exclude-standard", "-z"])]);
  return canonicalizeAyasExactFiles(repoRoot, [...tracked.split("\0"), ...untracked.split("\0")].filter(Boolean));
}
export interface AyasMutationBoundary { readonly baseHead: string; readonly allowedFiles: readonly string[]; verify(): Promise<{ readonly changedFiles: readonly string[]; readonly diffFingerprint: string }>; }
export async function createAyasMutationBoundary(repoRoot: string, exactFiles: readonly string[]): Promise<AyasMutationBoundary> {
  const allowedFiles = canonicalizeAyasExactFiles(repoRoot, exactFiles);
  const baseHead = (await git(repoRoot, ["rev-parse", "HEAD"])).trim();
  if ((await changed(repoRoot)).length) throw new AyasMutationScopeError("REPOSITORY_DIRTY", "mutation boundary requires a clean repository");
  return { baseHead, allowedFiles, async verify() {
    const currentHead = (await git(repoRoot, ["rev-parse", "HEAD"])).trim();
    if (currentHead !== baseHead) throw new AyasMutationScopeError("HEAD_CHANGED", "mutation callback changed repository HEAD");
    const changedFiles = await changed(repoRoot);
    const allowed = new Set(allowedFiles.map(identity));
    const unexpected = changedFiles.filter((file) => !allowed.has(identity(file)));
    if (unexpected.length) throw new AyasMutationScopeError("UNAUTHORIZED_MUTATION", "actual Git mutation exceeded exactFiles authorization", changedFiles);
    return { changedFiles, diffFingerprint: crypto.createHash("sha256").update(JSON.stringify(changedFiles)).digest("hex") };
  } };
}
