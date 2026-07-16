import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

export interface RuntimeTrackingInventory {
  readonly trackedPaths: readonly string[];
  readonly physicalPaths: readonly string[];
  readonly untrackedPaths: readonly string[];
  readonly trackedMissingPaths: readonly string[];
}

export function collectRuntimeTrackingInventory(
  repositoryRoot = process.cwd(),
): RuntimeTrackingInventory {
  const canonicalRepositoryRoot = path.resolve(repositoryRoot);
  const discoveredRepositoryRoot = path.resolve(execFileSync(
    "git",
    ["rev-parse", "--show-toplevel"],
    { cwd: canonicalRepositoryRoot, encoding: "utf8" },
  ).trim());
  if (!samePath(canonicalRepositoryRoot, discoveredRepositoryRoot)) {
    throw new Error("Runtime inventory root must be the Git repository top-level.");
  }
  const runtimeRoot = path.join(canonicalRepositoryRoot, "data", "projects");
  const trackedOutput = execFileSync(
    "git",
    ["-c", "core.quotepath=false", "ls-files", "-z", "--", "data/projects"],
    { cwd: canonicalRepositoryRoot },
  );
  const trackedPaths = trackedOutput.toString("utf8").split("\0").filter(Boolean).sort();
  const physicalPaths = fs.existsSync(runtimeRoot)
    ? collectFiles(canonicalRepositoryRoot, runtimeRoot).sort()
    : [];
  const tracked = new Set(trackedPaths);
  const physical = new Set(physicalPaths);
  return Object.freeze({
    trackedPaths: Object.freeze(trackedPaths),
    physicalPaths: Object.freeze(physicalPaths),
    untrackedPaths: Object.freeze(physicalPaths.filter((file) => !tracked.has(file))),
    trackedMissingPaths: Object.freeze(trackedPaths.filter((file) => !physical.has(file))),
  });
}

function collectFiles(repositoryRoot: string, directory: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      files.push(relativeGitPath(repositoryRoot, absolutePath));
    } else if (entry.isDirectory()) {
      files.push(...collectFiles(repositoryRoot, absolutePath));
    } else if (entry.isFile()) {
      files.push(relativeGitPath(repositoryRoot, absolutePath));
    }
  }
  return files;
}

function relativeGitPath(repositoryRoot: string, filePath: string) {
  return path.relative(repositoryRoot, filePath).split(path.sep).join("/");
}

function samePath(left: string, right: string) {
  return process.platform === "win32"
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}
