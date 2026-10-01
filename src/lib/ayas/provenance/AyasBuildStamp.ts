import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

/**
 * Stage 15G — what a build writes beside its output so a later manifest can say which source it was built from.
 *
 * It reads Git with fixed arguments and one file. It imports nothing else of AYAS, so the build hook that uses it
 * reaches no tool, lease or store.
 */
export const AYAS_BUILD_DIR = ".next";
export const AYAS_BUILD_STAMP_FILE = "ayas-build-stamp.json";
const HEAD = /^[a-f0-9]{40}$/;

/** The one place the provenance code starts a process: Git, read-only, with arguments fixed by its callers. */
export function readAyasGit(repoRoot: string, args: readonly ("rev-parse" | "status" | "show" | string)[]): string {
  return execFileSync("git", ["--no-optional-locks", "-c", `safe.directory=${path.resolve(repoRoot)}`, ...args],
    { cwd: repoRoot, encoding: "utf8", windowsHide: true, timeout: 20_000, maxBuffer: 16_000_000, stdio: ["ignore", "pipe", "pipe"] });
}

/** SHA-256 of a text file with line endings normalized to LF, so a CRLF checkout gives the same digest. */
export function digestAyasTextFile(file: string): { readonly text: string; readonly sha256: string } {
  const text = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  return { text, sha256: crypto.createHash("sha256").update(text, "utf8").digest("hex") };
}

export interface AyasBuildStamp { readonly schemaVersion: "1"; readonly gitHead: string; readonly treeState: "CLEAN" | "DIRTY"; readonly lockfileSha256: string; readonly stampedAt: string }

/** Null when Git cannot be read: an unbound build is reported as unbound, never guessed. */
export function buildAyasBuildStamp(repoRoot: string, now: Date): AyasBuildStamp | null {
  try {
    const gitHead = readAyasGit(repoRoot, ["rev-parse", "HEAD"]).trim();
    if (!HEAD.test(gitHead)) return null;
    const dirty = readAyasGit(repoRoot, ["status", "--porcelain=v1", "-z"]).split("\0").filter(Boolean).length > 0;
    return { schemaVersion: "1", gitHead, treeState: dirty ? "DIRTY" : "CLEAN", lockfileSha256: digestAyasTextFile(path.join(repoRoot, "package-lock.json")).sha256, stampedAt: now.toISOString() };
  } catch { return null; }
}
