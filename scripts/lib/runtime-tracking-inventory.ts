import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

export interface RuntimeTrackingInventory {
  readonly trackedPaths: readonly string[];
  readonly physicalPaths: readonly string[];
  readonly untrackedPaths: readonly string[];
  readonly ignoredPaths: readonly string[];
  readonly unexpectedUntrackedPaths: readonly string[];
  readonly trackedMissingPaths: readonly string[];
}

export interface RuntimeTrackingAdmissionReport {
  readonly tracked: number;
  readonly ignoredDurable: number;
  readonly unexpectedUntracked: 0;
  readonly trackedMissing: 0;
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
  const untrackedPaths = physicalPaths.filter((file) => !tracked.has(file));
  const ignoredPaths = untrackedPaths.filter((file) =>
    isGitIgnored(canonicalRepositoryRoot, file));
  const ignored = new Set(ignoredPaths);
  return Object.freeze({
    trackedPaths: Object.freeze(trackedPaths),
    physicalPaths: Object.freeze(physicalPaths),
    untrackedPaths: Object.freeze(untrackedPaths),
    ignoredPaths: Object.freeze(ignoredPaths),
    unexpectedUntrackedPaths: Object.freeze(
      untrackedPaths.filter((file) => !ignored.has(file)),
    ),
    trackedMissingPaths: Object.freeze(trackedPaths.filter((file) => !physical.has(file))),
  });
}

export function assertRuntimeTrackingAdmission(
  inventory: RuntimeTrackingInventory,
  repositoryRoot = process.cwd(),
): RuntimeTrackingAdmissionReport {
  if (
    inventory.trackedMissingPaths.length !== 0 ||
    inventory.unexpectedUntrackedPaths.length !== 0
  ) throw new Error("Runtime tracking admission failed.");
  for (const relativePath of inventory.ignoredPaths) {
    if (!isAllowedIgnoredDurablePath(relativePath)) {
      throw new Error("Runtime tracking admission failed.");
    }
    const absolutePath = path.resolve(repositoryRoot, ...relativePath.split("/"));
    const link = fs.lstatSync(absolutePath);
    const real = fs.realpathSync(absolutePath);
    if (link.isSymbolicLink() || !link.isFile() || !samePath(real, absolutePath)) {
      throw new Error("Runtime tracking admission failed.");
    }
  }
  return Object.freeze({
    tracked: inventory.trackedPaths.length,
    ignoredDurable: inventory.ignoredPaths.length,
    unexpectedUntracked: 0,
    trackedMissing: 0,
  });
}

export function isAllowedIgnoredDurablePath(value: string) {
  const prefix = "data/projects/";
  if (!value.startsWith(prefix)) return false;
  const segments = value.slice(prefix.length).split("/");
  if (segments.length !== 4 ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(segments[0]) ||
    segments[1] !== "production-execution") return false;
  const [kind, fileName] = segments.slice(2);
  const patterns: Readonly<Record<string, RegExp>> = Object.freeze({
    attempts: /^pipeline-attempt-[a-z0-9-]{1,128}-v[1-9][0-9]*\.json$/,
    claims: /^pipeline-claim-[a-z0-9-]{1,128}-v[1-9][0-9]*\.json$/,
    idempotency: /^pipeline-record-[a-z0-9-]{1,128}-v[1-9][0-9]*\.json$/,
    reservations: /^idempotency-identity-[a-z0-9-]{1,128}\.json$/,
  });
  return patterns[kind]?.test(fileName) ?? false;
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

function isGitIgnored(repositoryRoot: string, relativePath: string) {
  const result = spawnSync("git", ["check-ignore", "--quiet", "--", relativePath], {
    cwd: repositoryRoot,
    stdio: "ignore",
  });
  if (result.status === 0) return true;
  if (result.status === 1) return false;
  throw new Error("Runtime tracking ignore classification failed.");
}
