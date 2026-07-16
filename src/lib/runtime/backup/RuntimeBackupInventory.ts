import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  assertPathContained,
  getLogicalProjectIdentity,
  requireContainedRealDirectory,
  resolveRuntimeStorageContext,
  runtimeStoragePolicyVersion,
  validateSafeAncestorChain,
  type RuntimeStorageContext,
  type RuntimeStorageInput,
} from "@/lib/runtime/RuntimeStoragePaths";
import {
  aggregateRuntimeFileRecords,
  emptyClassificationTotals,
  runtimeBackupAggregateVersion,
  runtimeBackupFormatVersion,
  runtimeBackupManifestSchemaVersion,
  validateRuntimeBackupManifest,
  type RuntimeBackupFileClassification,
  type RuntimeBackupFileRecord,
  type RuntimeBackupGitMetadata,
  type RuntimeBackupManifest,
} from "./RuntimeBackupManifest";

export interface RuntimeBackupInventoryOptions {
  readonly context?: RuntimeStorageInput;
  readonly projectSlug?: string;
  readonly repositoryRoot?: string;
  readonly now?: () => string;
  readonly hooks?: {
    readonly beforeHashFile?: (absolutePath: string, relativePath: string) => void;
    readonly afterHashFile?: (absolutePath: string, relativePath: string) => void;
  };
}

export function collectRuntimeBackupInventory(
  options: RuntimeBackupInventoryOptions = {},
): RuntimeBackupManifest {
  const context = resolveRuntimeStorageContext(options.context ?? {});
  const projectsRoot = requireContainedRealDirectory(
    context.runtimeRoot,
    context.projectsRoot,
  );
  const scanRoot = options.projectSlug
    ? projectScanRoot(context, projectsRoot, options.projectSlug)
    : projectsRoot;
  const git = options.repositoryRoot
    ? collectGitMetadata(options.repositoryRoot, projectsRoot)
    : undefined;
  const files: RuntimeBackupFileRecord[] = [];
  walkRuntimeTree(projectsRoot, scanRoot, files, git?.entries, options.hooks);
  files.sort(compareRecords);
  assertUniquePortablePaths(files);
  const classifications = emptyClassificationTotals();
  files.forEach((file) => { classifications[file.classification] += 1; });
  const tracked = files.filter((file) => file.git?.tracked).length;
  const projects = new Set(files.map((file) => file.projectSlug).filter(Boolean));
  const manifest: RuntimeBackupManifest = Object.freeze({
    schemaVersion: runtimeBackupManifestSchemaVersion,
    backupFormatVersion: runtimeBackupFormatVersion,
    aggregateAlgorithm: runtimeBackupAggregateVersion,
    storagePolicyVersion: runtimeStoragePolicyVersion,
    createdAt: (options.now ?? (() => new Date().toISOString()))(),
    sourceLogicalIdentity: options.projectSlug
      ? getLogicalProjectIdentity(options.projectSlug)
      : "projects",
    sourceClassification: context.classification,
    sourceProjectsRootLogicalName: "projects",
    ...(git?.headCommit ? { sourceHeadCommit: git.headCommit } : {}),
    aggregateFingerprint: aggregateRuntimeFileRecords(files),
    inventory: Object.freeze({
      files: files.length,
      bytes: files.reduce((sum, file) => sum + file.sizeBytes, 0),
      projects: projects.size,
      tracked,
      untracked: files.length - tracked,
      classifications: Object.freeze(classifications),
    }),
    files: Object.freeze(files.map((file) => Object.freeze(file))),
  });
  validateRuntimeBackupManifest(manifest);
  return manifest;
}

export function hashStableRuntimeFile(
  absolutePath: string,
  relativePath: string,
  hooks?: RuntimeBackupInventoryOptions["hooks"],
) {
  const linkBefore = fs.lstatSync(absolutePath, { bigint: true });
  const realBefore = fs.realpathSync(absolutePath);
  if (
    !linkBefore.isFile() ||
    linkBefore.isSymbolicLink() ||
    !samePath(realBefore, absolutePath)
  ) {
    throw new Error("Runtime backup source contains an unsupported path.");
  }
  hooks?.beforeHashFile?.(absolutePath, relativePath);
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(absolutePath, "r");
    const before = fs.fstatSync(descriptor, { bigint: true });
    if (!before.isFile() || !sameIdentity(linkBefore, before)) {
      throw new Error("Runtime backup source changed during inventory.");
    }
    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let offset = 0;
    while (offset < Number(before.size)) {
      const length = fs.readSync(
        descriptor,
        buffer,
        0,
        Math.min(buffer.length, Number(before.size) - offset),
        offset,
      );
      if (length <= 0) throw new Error("Runtime backup source is unreadable.");
      hash.update(buffer.subarray(0, length));
      offset += length;
    }
    hooks?.afterHashFile?.(absolutePath, relativePath);
    const after = fs.fstatSync(descriptor, { bigint: true });
    const linkAfter = fs.lstatSync(absolutePath, { bigint: true });
    if (!sameIdentity(before, after) || !sameIdentity(before, linkAfter)) {
      throw new Error("Runtime backup source changed during inventory.");
    }
    return {
      sizeBytes: Number(before.size),
      sha256: hash.digest("hex"),
      permissionClass: Number(before.mode & BigInt(0o111)) === 0
        ? "regular" as const
        : "executable" as const,
    };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Runtime backup")) throw error;
    throw new Error("Runtime backup source is unreadable.");
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function walkRuntimeTree(
  projectsRoot: string,
  directory: string,
  files: RuntimeBackupFileRecord[],
  gitEntries: ReadonlyMap<string, RuntimeBackupGitMetadata> | undefined,
  hooks: RuntimeBackupInventoryOptions["hooks"],
) {
  requireContainedOrEqual(projectsRoot, directory);
  const entries = fs.readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => compareText(left.name, right.name));
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    assertPathContained(projectsRoot, absolutePath);
    const link = fs.lstatSync(absolutePath);
    if (link.isSymbolicLink()) {
      throw new Error("Runtime backup source contains a link or reparse point.");
    }
    if (link.isDirectory()) {
      requireContainedRealDirectory(projectsRoot, absolutePath);
      walkRuntimeTree(projectsRoot, absolutePath, files, gitEntries, hooks);
      continue;
    }
    if (!link.isFile()) {
      throw new Error("Runtime backup source contains an unsupported path.");
    }
    const relativePath = relativePosix(projectsRoot, absolutePath);
    const hash = hashStableRuntimeFile(absolutePath, relativePath, hooks);
    const projectSlug = inferProjectSlug(relativePath);
    files.push({
      relativePath,
      type: "file",
      ...hash,
      ...(projectSlug ? { projectSlug } : {}),
      classification: classifyRuntimeFile(relativePath),
      ...(gitEntries ? { git: gitEntries.get(relativePath) ?? { tracked: false } } : {}),
    });
  }
}

function collectGitMetadata(repositoryRoot: string, projectsRoot: string) {
  const canonicalRepository = path.resolve(repositoryRoot);
  const discovered = path.resolve(execFileSync(
    "git",
    ["rev-parse", "--show-toplevel"],
    { cwd: canonicalRepository, encoding: "utf8" },
  ).trim());
  if (!samePath(canonicalRepository, discovered)) {
    throw new Error("Runtime backup repository root is invalid.");
  }
  assertPathContained(canonicalRepository, projectsRoot);
  const sourceRelative = relativePosix(canonicalRepository, projectsRoot);
  const output = execFileSync(
    "git",
    ["-c", "core.quotepath=false", "ls-files", "-s", "-z", "--", sourceRelative],
    { cwd: canonicalRepository },
  ).toString("utf8");
  const entries = new Map<string, RuntimeBackupGitMetadata>();
  for (const record of output.split("\0").filter(Boolean)) {
    const match = /^(\d{6}) ([a-f0-9]{40,64}) 0\t(.+)$/.exec(record);
    if (!match) throw new Error("Runtime backup Git metadata is invalid.");
    const relative = relativePosix(sourceRelative, match[3]);
    entries.set(relative, { tracked: true, blobOid: match[2], gitMode: match[1] });
  }
  let headCommit: string | undefined;
  try {
    const value = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: canonicalRepository,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (/^[a-f0-9]{40,64}$/.test(value)) headCommit = value;
  } catch {
    // A Git fixture may have an index without a commit.
  }
  return { entries, headCommit };
}

function projectScanRoot(
  context: RuntimeStorageContext,
  projectsRoot: string,
  slug: string,
) {
  if (!/^[a-zA-Z0-9-_]+$/.test(slug)) {
    throw new Error("Runtime backup project identity is invalid.");
  }
  const target = path.join(projectsRoot, slug);
  assertPathContained(projectsRoot, target);
  requireContainedRealDirectory(context.projectsRoot, target);
  return target;
}

function inferProjectSlug(relativePath: string) {
  const first = relativePath.split("/")[0];
  return /^[a-zA-Z0-9-_]+$/.test(first) && relativePath.includes("/") ? first : undefined;
}

function classifyRuntimeFile(relativePath: string): RuntimeBackupFileClassification {
  const segments = relativePath.split("/");
  const withinProject = segments.slice(1).join("/");
  const fileName = segments.at(-1) ?? "";
  if (withinProject === "production-acceptance.json") return "acceptance-marker";
  if (withinProject.startsWith("production-execution/")) return "durable-execution";
  if (withinProject === "assets/assets.json") return "asset-metadata";
  if (withinProject.startsWith("assets/")) return "generated-asset";
  if (fileName === "pipeline-jobs.json" || fileName === "pipeline-history.json") return "pipeline-state";
  if (fileName === "ai-usage.json") return "ai-usage";
  if (fileName === "project.json" || fileName === "manifest.json") return "project-metadata";
  if (segments.length === 2) return "legacy-project-file";
  return "other-runtime";
}

function assertUniquePortablePaths(files: RuntimeBackupFileRecord[]) {
  const exact = new Set<string>();
  const folded = new Set<string>();
  for (const file of files) {
    const lower = file.relativePath.toLowerCase();
    if (exact.has(file.relativePath) || folded.has(lower)) {
      throw new Error("Runtime backup path collision detected.");
    }
    exact.add(file.relativePath);
    folded.add(lower);
  }
}

function requireContainedOrEqual(root: string, target: string) {
  if (samePath(root, target)) {
    validateSafeAncestorChain(target);
    return;
  }
  requireContainedRealDirectory(root, target);
}

function relativePosix(root: string, target: string) {
  const relative = path.relative(root, target).split(path.sep).join("/");
  if (!relative || relative === ".." || relative.startsWith("../") || path.posix.isAbsolute(relative)) {
    throw new Error("Runtime backup path escapes its root.");
  }
  return relative;
}

function sameIdentity(left: fs.BigIntStats, right: fs.BigIntStats) {
  return left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs &&
    left.mode === right.mode;
}

function compareRecords(left: RuntimeBackupFileRecord, right: RuntimeBackupFileRecord) {
  return compareText(left.relativePath, right.relativePath);
}

function compareText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function samePath(left: string, right: string) {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}
