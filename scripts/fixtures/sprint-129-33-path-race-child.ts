import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { PipelineJobManager } from "../../src/lib/pipeline/PipelineJobManager";
import { installCanonicalFilesystemMutationTestHook,
  installCanonicalMutationBarrierTestHook,
  verifyCanonicalForeignQuarantinePreservation,
  verifyCanonicalOwnerPublicationFailureCleanup } from
  "../../src/lib/pipeline/PipelineJobMutationLock";
import type { CanonicalFilesystemMutationTestEvent } from
  "../../src/lib/pipeline/PipelineJobMutationLock";
import { ProjectReader } from "../../src/lib/projects/ProjectReader";

type Target = "lock-release" | "gate-release" | "stale-lock" | "stale-gate" |
  "quarantine-cleanup" | "publication-cleanup" | "foreign-quarantine-preserved";

interface RaceMutationCounters {
  readonly foreignLeafMutationAttempts: number;
  readonly foreignLeafDeleteAttempts: number;
  readonly foreignLeafOverwriteAttempts: number;
  readonly canonicalOverwriteAttempts: number;
  readonly quarantineToCanonicalRestoreAttempts: number;
  readonly unexpectedCanonicalMutationAttempts: number;
}

async function waitFor(file: string) {
  for (let attempt = 0; attempt < 2_000; attempt += 1) {
    try { await fs.access(file); return; } catch { /* retry */ }
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`timed out waiting for ${path.basename(file)}`);
}

async function main() {
  const [projectSlug, jobId, role, targetValue, signal, resume, preserved,
    ownerKind = "different"] = process.argv.slice(2);
  if (!projectSlug || !jobId || !role || !targetValue || !signal || !resume || !preserved) {
    throw new Error("path race child arguments missing");
  }
  const target = targetValue as Target;
  const projectFolder = path.resolve(ProjectReader.getProjectFolder(projectSlug));
  if (role === "a") {
    const mutationEvents: CanonicalFilesystemMutationTestEvent[] = [];
    const restoreMutationObserver = installCanonicalFilesystemMutationTestHook((event) => {
      mutationEvents.push(event);
    });
    const restore = installCanonicalMutationBarrierTestHook(target, async () => {
      await fs.writeFile(signal, "checked\n", { encoding: "utf8", flag: "wx" });
      await waitFor(resume);
    }, target === "quarantine-cleanup" ? 2 : 1);
    let decision = "unexpected-success";
    let residuePath: string | undefined;
    try {
      if (target === "publication-cleanup") {
        await verifyCanonicalOwnerPublicationFailureCleanup(projectSlug, jobId);
      } else if (target === "foreign-quarantine-preserved") {
        await verifyCanonicalForeignQuarantinePreservation(projectSlug, jobId);
      } else {
        await PipelineJobManager.withProjectLock(projectSlug, async () => undefined, jobId);
      }
    } catch (error) {
      decision = error instanceof Error ? error.message : "unknown-failure";
      residuePath = typeof (error as { residuePath?: unknown })?.residuePath === "string"
        ? (error as { residuePath: string }).residuePath : undefined;
    } finally { restore(); restoreMutationObserver(); }
    const canonicalPath = path.join(projectFolder,
      target.includes("gate") ? ".pipeline-jobs.lock-gate" : ".pipeline-jobs.lock");
    const counters = countRaceMutationAttempts(mutationEvents, canonicalPath, residuePath);
    process.stdout.write(`${JSON.stringify({ decision, residuePath, counters })}\n`);
    return;
  }
  if (role !== "b") throw new Error("invalid path race child role");
  await waitFor(signal);
  if (target === "foreign-quarantine-preserved") {
    const source = path.join(projectFolder, ".pipeline-jobs.lock");
    const replacementBytes = foreignPreservationBytes(jobId);
    await fs.mkdir(source);
    await fs.writeFile(path.join(source, "owner.json"), replacementBytes,
      { encoding: "utf8", flag: "wx" });
    await fs.writeFile(resume, "replaced\n", { encoding: "utf8", flag: "wx" });
    process.stdout.write(`${JSON.stringify({ decision: "replacement-published",
      replacementBytes, replacementHash: sha256(replacementBytes),
      replacementInventoryHash: replacementInventoryHash("directory", replacementBytes),
      replacementType: "directory" })}\n`);
    return;
  }
  const source = await sourcePath(projectFolder, target);
  const sourceStat = await fs.lstat(source);
  const sameBytes = ownerKind === "same";
  const bytes = sourceStat.isDirectory()
    ? await fs.readFile(path.join(source, "owner.json"), "utf8").catch(() => "")
    : await fs.readFile(source, "utf8");
  await fs.rename(source, preserved);
  const replacementBytes = sameBytes ? bytes : `${JSON.stringify({ foreign: true,
    pid: process.pid, target })}\n`;
  if (sourceStat.isDirectory()) {
    await fs.mkdir(source);
    await fs.writeFile(path.join(source, "owner.json"), replacementBytes, "utf8");
  } else {
    await fs.writeFile(source, replacementBytes, { encoding: "utf8", flag: "wx" });
  }
  await fs.writeFile(resume, "replaced\n", { encoding: "utf8", flag: "wx" });
  process.stdout.write(`${JSON.stringify({ decision: "replacement-published",
    replacementBytes, replacementHash: sha256(replacementBytes),
    replacementInventoryHash: replacementInventoryHash(
      sourceStat.isDirectory() ? "directory" : "file", replacementBytes),
    replacementType: sourceStat.isDirectory() ? "directory" : "file" })}\n`);
}

function countRaceMutationAttempts(
  events: readonly CanonicalFilesystemMutationTestEvent[],
  canonicalPath: string,
  residuePath: string | undefined,
): RaceMutationCounters {
  const canonical = path.resolve(canonicalPath);
  const residue = residuePath ? path.resolve(residuePath) : undefined;
  const within = (candidate: string | undefined, root: string | undefined) =>
    candidate !== undefined && root !== undefined &&
    (path.resolve(candidate) === root || path.resolve(candidate).startsWith(`${root}${path.sep}`));
  const foreignDeletes = events.filter((event) =>
    (event.operation === "unlink" || event.operation === "rmdir") &&
    within(event.targetPath, residue));
  const foreignOverwrites = events.filter((event) =>
    (event.operation === "write" && within(event.targetPath, residue)) ||
    (event.operation === "rename" && event.purpose !== "canonical-to-quarantine" &&
      within(event.destinationPath, residue)));
  const foreignMoves = events.filter((event) => event.operation === "rename" &&
    event.purpose !== "canonical-to-quarantine" && within(event.sourcePath, residue));
  const canonicalOverwrites = events.filter((event) =>
    (event.operation === "rename" && path.resolve(event.destinationPath ?? "") === canonical) ||
    (event.operation === "write" && event.exclusive !== true &&
      within(event.targetPath, canonical)));
  const restoreAttempts = events.filter((event) => event.operation === "rename" &&
    path.resolve(event.destinationPath ?? "") === canonical &&
    event.sourcePath?.includes(".pipeline-jobs.quarantine-") === true);
  const unexpectedCanonicalMutations = events.filter((event) =>
    ((event.operation === "unlink" || event.operation === "rmdir") &&
      within(event.targetPath, canonical)) ||
    (event.operation === "rename" && event.purpose !== "canonical-to-quarantine" &&
      event.purpose !== "owner-publication" &&
      within(event.sourcePath, canonical)) || canonicalOverwrites.includes(event));
  return Object.freeze({
    foreignLeafMutationAttempts:
      foreignDeletes.length + foreignOverwrites.length + foreignMoves.length,
    foreignLeafDeleteAttempts: foreignDeletes.length,
    foreignLeafOverwriteAttempts: foreignOverwrites.length,
    canonicalOverwriteAttempts: canonicalOverwrites.length,
    quarantineToCanonicalRestoreAttempts: restoreAttempts.length,
    unexpectedCanonicalMutationAttempts: unexpectedCanonicalMutations.length,
  });
}

function foreignPreservationBytes(jobId: string): string {
  return `${JSON.stringify({ foreign: true, jobId, source: "quarantine" })}\n`;
}

function sha256(bytes: string): string {
  return createHash("sha256").update(bytes, "utf8").digest("hex");
}

function replacementInventoryHash(type: "directory" | "file", bytes: string): string {
  const row = `${type === "directory" ? "owner.json" : "."}\tfile\t${
    Buffer.byteLength(bytes)}\t${sha256(bytes)}`;
  return sha256(row);
}

async function sourcePath(projectFolder: string, target: Target) {
  if (target === "lock-release" || target === "stale-lock" ||
    target === "publication-cleanup") {
    return path.join(projectFolder, ".pipeline-jobs.lock");
  }
  if (target === "gate-release" || target === "stale-gate") {
    return path.join(projectFolder, ".pipeline-jobs.lock-gate");
  }
  for (let attempt = 0; attempt < 2_000; attempt += 1) {
    const names = await fs.readdir(projectFolder);
    const container = names.find((name) => name.startsWith(".pipeline-jobs.quarantine-"));
    if (container) {
      const root = path.join(projectFolder, container);
      for (const leaf of await fs.readdir(root)) {
        if (leaf.startsWith("owned-lock-") || leaf.startsWith("owned-gate-")) {
          try { await fs.lstat(path.join(root, leaf)); return path.join(root, leaf); }
          catch { /* retry */ }
        }
      }
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("quarantine leaf unavailable");
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : "child failed"}\n`);
  process.exitCode = 1;
});
