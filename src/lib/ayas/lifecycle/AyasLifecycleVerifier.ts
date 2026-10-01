import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type { AyasLifecycleEntry } from "./AyasLifecycle";

/**
 * Stage 15E — checks a registry's recorded identities against what is on this
 * machine. Read-only: it hashes files and compares. It never downloads,
 * installs, runs or selects anything, and it contacts no network endpoint
 * (a served model's digest is passed in by the caller that already has it).
 */
export type AyasLifecycleIdentityStatus =
  | "MATCH"          // the artifact is here and is the recorded one
  | "MISMATCH"       // the artifact is here and is something else
  | "SIZE_MATCH"     // a large file whose size matches; its bytes were not hashed in this run
  | "ABSENT"         // the artifact is not on this machine
  | "NOT_CHECKABLE"  // nothing local to compare against (an unpinned entry, or a remote identity with no local copy named)
  | "NOT_OBSERVED";  // a served-model digest that the caller did not supply

export interface AyasLifecycleIdentityCheck { readonly id: string; readonly status: AyasLifecycleIdentityStatus; readonly detail: string; }

export interface AyasLifecycleVerifyOptions {
  readonly repoRoot: string;
  /** An operator supplies exact historical bytes; the shared verifier starts no process. */
  readonly readHistoricalSource?: (revision: string, file: string) => string;
  /** Hash every file, however large. Without it, a file above `hashLimitBytes` is compared by size only. */
  readonly deep?: boolean;
  readonly hashLimitBytes?: number;
  /** Where a `sha256-file` or `hf-revision` entry's bytes are on this machine, by entry id. Defaults to the entry's own locator when that is a repository path. */
  readonly localFiles?: Readonly<Record<string, string>>;
  /** Digests the local model runtime reports right now, by tag. */
  readonly servedDigests?: Readonly<Record<string, string>>;
}

const DEFAULT_HASH_LIMIT = 128 * 1024 * 1024;

/** The digest recorded for `source-digest` identities: each file's repository path and LF-normalized text, in order. */
export function computeAyasLifecycleSourceDigest(repoRoot: string, files: readonly string[], revision?: string, readHistoricalSource?: (revision: string, file: string) => string): string {
  if (revision !== undefined && !/^[a-f0-9]{40}$/.test(revision)) throw new Error("AYAS_LIFECYCLE_REVISION_INVALID");
  if (revision !== undefined && !readHistoricalSource) throw new Error("AYAS_LIFECYCLE_HISTORY_UNAVAILABLE");
  const hash = crypto.createHash("sha256");
  for (const file of files) {
    const text = (revision === undefined ? fs.readFileSync(path.join(repoRoot, file), "utf8") : readHistoricalSource!(revision, file)).replace(/\r\n/g, "\n");
    hash.update(file, "utf8").update("\0").update(text, "utf8").update("\0");
  }
  return hash.digest("hex");
}

function hashFile(file: string): string {
  const hash = crypto.createHash("sha256");
  const handle = fs.openSync(file, "r");
  try {
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    for (;;) { const read = fs.readSync(handle, buffer, 0, buffer.length, null); if (read === 0) break; hash.update(buffer.subarray(0, read)); }
  } finally { fs.closeSync(handle); }
  return hash.digest("hex");
}

function checkFile(entryId: string, file: string | undefined, sha256: string, sizeBytes: number | undefined, options: AyasLifecycleVerifyOptions): AyasLifecycleIdentityCheck {
  if (!file) return { id: entryId, status: "NOT_CHECKABLE", detail: "no local file is named for this entry" };
  const absolute = path.isAbsolute(file) ? file : path.join(options.repoRoot, file);
  let stat: fs.Stats;
  try { stat = fs.statSync(absolute); } catch { return { id: entryId, status: "ABSENT", detail: "the file is not on this machine" }; }
  if (!stat.isFile()) return { id: entryId, status: "ABSENT", detail: "the path is not a file" };
  if (sizeBytes !== undefined && stat.size !== sizeBytes) return { id: entryId, status: "MISMATCH", detail: `size ${stat.size}, recorded ${sizeBytes}` };
  if (!options.deep && stat.size > (options.hashLimitBytes ?? DEFAULT_HASH_LIMIT)) return { id: entryId, status: "SIZE_MATCH", detail: "size matches; bytes not hashed in this run" };
  return hashFile(absolute) === sha256 ? { id: entryId, status: "MATCH", detail: "sha256 matches" } : { id: entryId, status: "MISMATCH", detail: "sha256 differs from the record" };
}

export function verifyAyasLifecycleIdentities(registry: readonly AyasLifecycleEntry[], options: AyasLifecycleVerifyOptions): readonly AyasLifecycleIdentityCheck[] {
  return registry.map((entry): AyasLifecycleIdentityCheck => {
    const identity = entry.identity;
    const named = options.localFiles?.[entry.id];
    switch (identity.type) {
      case "UNPINNED": return { id: entry.id, status: "NOT_CHECKABLE", detail: "unpinned" };
      case "source-digest": {
        if (identity.revision !== undefined && (entry.admission !== "NONE" || !["PINNED", "RETIRED"].includes(entry.state)))
          return { id: entry.id, status: "MISMATCH", detail: "a historical pin cannot attest admitted or qualified source" };
        try { return computeAyasLifecycleSourceDigest(options.repoRoot, identity.files, identity.revision, options.readHistoricalSource) === identity.sha256
          ? { id: entry.id, status: "MATCH", detail: identity.revision ? `historical source at ${identity.revision} matches; no serving admission` : "source digest matches" }
          : { id: entry.id, status: "MISMATCH", detail: "the source differs from the recorded identity" }; }
        catch { return { id: entry.id, status: "ABSENT", detail: identity.revision ? "a historical source object is unavailable; no fallback to current files" : "a listed source file is missing" }; }
      }
      case "sha256-file": {
        // A locator that is a plain repository path is where the file lives; anything else needs the caller to name it.
        const repositoryPath = !identity.locator.includes(":") && !path.isAbsolute(identity.locator) ? identity.locator : undefined;
        return checkFile(entry.id, named ?? repositoryPath, identity.sha256, identity.sizeBytes, options);
      }
      case "hf-revision": return checkFile(entry.id, named, identity.sha256, undefined, options);
      case "ollama-digest": {
        const served = options.servedDigests?.[identity.tag];
        if (served === undefined) return { id: entry.id, status: options.servedDigests ? "ABSENT" : "NOT_OBSERVED", detail: options.servedDigests ? "the local runtime does not serve this tag" : "no served digest was supplied" };
        return served === identity.digest ? { id: entry.id, status: "MATCH", detail: "the served digest matches" } : { id: entry.id, status: "MISMATCH", detail: "the tag now serves a different model" };
      }
    }
  });
}
