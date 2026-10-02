/** Read-only destination artifact verification. Byte identity cannot confer model/hardware qualification. */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { requireContainedRealDirectory, assertPathContained } from "../../runtime/RuntimeStoragePaths";
import { assertAyasPortableBrain } from "./AyasPortableBrain";

export function verifyAyasPortableArtifacts(payload: unknown, artifactRoot: string, options: { readonly maxReadMs?: number } = {}) {
  assertAyasPortableBrain(payload);
  const budget = options.maxReadMs ?? 30_000;
  if (!Number.isSafeInteger(budget) || budget < 1 || budget > 120_000) throw new Error("AYAS_PORTABLE_ARTIFACT_BUDGET_INVALID");
  const root = fs.realpathSync.native(artifactRoot), deadline = Date.now() + budget;
  const results = payload.runtime.artifacts.map(a => {
    if (a.transfer === "REBUILD_PINNED_IMAGE") return { id: a.id, state: "BLOCKED" as const, reason: "PINNED_IMAGE_REBUILD_NOT_EXECUTED", qualification: a.qualification };
    let fd: number | undefined;
    try {
      const file = path.join(root, a.relativeLocator), parts = a.relativeLocator.split("/");
      let dir = root;
      for (const part of parts.slice(0, -1)) { dir = path.join(dir, part); requireContainedRealDirectory(root, dir); }
      assertPathContained(root, fs.realpathSync.native(file));
      const before = fs.lstatSync(file);
      if (!before.isFile() || before.isSymbolicLink() || before.size !== a.sizeBytes) throw new Error("UNVERIFIED");
      fd = fs.openSync(file, "r"); const opened = fs.fstatSync(fd);
      if (opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size) throw new Error("UNVERIFIED");
      const hash = createHash("sha256"), buffer = Buffer.alloc(1024 * 1024); let bytes = 0;
      while (bytes < a.sizeBytes) {
        if (Date.now() >= deadline) throw new Error("BUDGET");
        const read = fs.readSync(fd, buffer, 0, Math.min(buffer.length, a.sizeBytes - bytes), null);
        if (!read) throw new Error("UNVERIFIED"); hash.update(buffer.subarray(0, read)); bytes += read;
      }
      const after = fs.fstatSync(fd), current = fs.lstatSync(file);
      if (hash.digest("hex") !== a.sha256 || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs
        || current.isSymbolicLink() || current.dev !== opened.dev || current.ino !== opened.ino) throw new Error("UNVERIFIED");
      return { id: a.id, state: "PASS" as const, reason: "EXACT_BYTES_VERIFIED_QUALIFICATION_UNCHANGED", qualification: a.qualification };
    } catch {
      return { id: a.id, state: "BLOCKED" as const, reason: "ARTIFACT_BYTES_UNVERIFIED_OR_READ_BUDGET_EXHAUSTED", qualification: a.qualification };
    } finally { if (fd !== undefined) fs.closeSync(fd); }
  });
  return { outcome: results.every(r => r.state === "PASS") ? "ARTIFACT_BYTES_VERIFIED_NOT_HARDWARE_QUALIFIED" : "ARTIFACT_TRANSFER_BLOCKED",
    results, grantsAuthority: false as const, hardwareBenchmark: "NOT_RUN" as const, liveActivationOccurred: false as const };
}
