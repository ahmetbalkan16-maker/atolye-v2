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
  const ignoredSet = filterGitIgnored(canonicalRepositoryRoot, untrackedPaths);
  const ignoredPaths = untrackedPaths.filter((file) => ignoredSet.has(file));
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

  // A file is a permitted ignored path when EITHER it matches the durable
  // record topology OR its ignore rule is a deliberate `data/projects/<...>/`
  // directory exclusion committed to `.gitignore` (local project working data
  // — see docs/PROJECT_STORAGE.md §5). A rule from `.git/info/exclude` or a
  // non-directory pattern never qualifies, so fixture negative cases still fail.
  const deliberatelyExcluded = collectDeliberateProjectExclusions(
    repositoryRoot,
    inventory.ignoredPaths,
  );

  for (const relativePath of inventory.ignoredPaths) {
    if (
      !isAllowedIgnoredDurablePath(relativePath) &&
      !deliberatelyExcluded.has(relativePath)
    ) {
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

function collectDeliberateProjectExclusions(
  repositoryRoot: string,
  ignoredPaths: readonly string[],
): ReadonlySet<string> {
  const excluded = new Set<string>();
  if (ignoredPaths.length === 0) return excluded;

  const result = spawnSync(
    "git",
    ["check-ignore", "--verbose", "--stdin", "-z"],
    {
      cwd: repositoryRoot,
      input: `${ignoredPaths.join("\0")}\0`,
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  // status 0: at least one match; 1: no matches; anything else is a real error.
  if (result.status !== 0 && result.status !== 1) {
    throw new Error("Runtime tracking ignore classification failed.");
  }
  const fields = result.stdout.toString("utf8").split("\0");
  // repeating groups of 4: <source> <linenum> <pattern> <pathname>
  for (let i = 0; i + 3 < fields.length; i += 4) {
    const source = fields[i];
    const pattern = fields[i + 2];
    const pathname = fields[i + 3];
    if (
      source === ".gitignore" &&
      /^\/data\/projects\/.+\/$/.test(pattern) &&
      pathname.startsWith("data/projects/")
    ) {
      excluded.add(pathname);
    }
  }
  return excluded;
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

/**
 * Classify every candidate path in a single `git check-ignore` call. One
 * process spawn instead of one per file — the ignored set under
 * `data/projects/` can be thousands of files after the local-working-data
 * `.gitignore` rules (docs/PROJECT_STORAGE.md §5).
 */
function filterGitIgnored(
  repositoryRoot: string,
  candidatePaths: readonly string[],
): ReadonlySet<string> {
  if (candidatePaths.length === 0) return new Set<string>();
  const result = spawnSync("git", ["check-ignore", "--stdin", "-z"], {
    cwd: repositoryRoot,
    input: `${candidatePaths.join("\0")}\0`,
    maxBuffer: 128 * 1024 * 1024,
  });
  if (result.status !== 0 && result.status !== 1) {
    throw new Error("Runtime tracking ignore classification failed.");
  }
  return new Set(
    result.stdout.toString("utf8").split("\0").filter(Boolean),
  );
}
