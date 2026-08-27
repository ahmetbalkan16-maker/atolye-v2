import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { isAudioCompensationJournalStagingPartialAtProjectPath } from "@/lib/audio/AudioCompensationStore";
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
  runtimeBackupFormatVersionV1,
  runtimeBackupFormatVersionV2,
  runtimeBackupFormatVersionV3,
  runtimeBackupManifestSchemaVersion,
  runtimeBackupManifestSchemaVersionV1,
  runtimeBackupManifestSchemaVersionV2,
  runtimeBackupManifestSchemaVersionV3,
  getRuntimeBackupManifestPathPolicyVersion,
  validateRuntimeBackupManifest,
  type RuntimeBackupFileClassification,
  type RuntimeBackupFileRecord,
  type RuntimeBackupGitMetadata,
  type RuntimeBackupManifest,
  type RuntimeBackupProjectIdentity,
} from "./RuntimeBackupManifest";
import {
  runtimeBackupPathPolicyVersion,
  runtimeBackupPathPolicyVersionV1,
  runtimeBackupPathPolicyVersionV2,
  runtimeBackupPathPolicyVersionV3,
  runtimeBackupPortableCollisionKey,
  validateRuntimeBackupRelativePath,
  type RuntimeBackupPathPolicyVersion,
} from "./RuntimeBackupPathPolicy";

export interface RuntimeBackupInventoryOptions {
  readonly context?: RuntimeStorageInput;
  readonly projectSlug?: string;
  readonly repositoryRoot?: string;
  readonly knownProjectIdentities?: ReadonlyMap<string, string>;
  readonly now?: () => string;
  readonly hooks?: {
    readonly beforeHashFile?: (absolutePath: string, relativePath: string) => void;
    readonly afterHashFile?: (absolutePath: string, relativePath: string) => void;
  };
}

export function collectRuntimeBackupInventory(
  options: RuntimeBackupInventoryOptions = {},
): RuntimeBackupManifest {
  return collectRuntimeBackupInventoryWithPolicy(
    options,
    runtimeBackupPathPolicyVersion,
  );
}

export function assertRuntimeBackupTreeMatchesManifest(options: {
  readonly context: RuntimeStorageInput;
  readonly manifest: RuntimeBackupManifest;
  readonly now?: () => string;
}) {
  validateRuntimeBackupManifest(options.manifest);
  const knownProjectIdentities = options.manifest.sourceProjectIdentities
    ? new Map(options.manifest.sourceProjectIdentities.map((id) => [id.projectId, id.projectSlug]))
    : undefined;
  const inventory = collectRuntimeBackupInventoryWithPolicy(
    { context: options.context, now: options.now, knownProjectIdentities },
    getRuntimeBackupManifestPathPolicyVersion(options.manifest),
  );
  const expected = options.manifest.files.map(runtimeBackupTreeIdentity);
  const actual = inventory.files.map(runtimeBackupTreeIdentity);
  if (
    JSON.stringify(actual) !== JSON.stringify(expected) ||
    inventory.aggregateFingerprint !== options.manifest.aggregateFingerprint ||
    inventory.inventory.files !== options.manifest.inventory.files ||
    inventory.inventory.bytes !== options.manifest.inventory.bytes
  ) {
    throw new Error("Runtime backup payload verification failed.");
  }
}

function runtimeBackupTreeIdentity(file: RuntimeBackupFileRecord) {
  return {
    relativePath: file.relativePath,
    sizeBytes: file.sizeBytes,
    sha256: file.sha256,
    permissionClass: file.permissionClass,
    projectSlug: file.projectSlug,
    classification: file.classification,
  };
}

function collectRuntimeBackupInventoryWithPolicy(
  options: RuntimeBackupInventoryOptions,
  pathPolicyVersion: RuntimeBackupPathPolicyVersion,
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
  const projectIdentitiesMap = new Map<string, string>();
  walkRuntimeTree(
    projectsRoot,
    scanRoot,
    files,
    projectIdentitiesMap,
    options.knownProjectIdentities,
    git?.entries,
    options.hooks,
    pathPolicyVersion,
  );
  files.sort(compareRecords);
  assertUniquePortablePaths(files, pathPolicyVersion);
  const classifications = emptyClassificationTotals();
  files.forEach((file) => { classifications[file.classification] += 1; });
  const tracked = files.filter((file) => file.git?.tracked).length;
  const projects = new Set(files.map((file) => file.projectSlug).filter(Boolean));

  const sourceProjectIdentities: RuntimeBackupProjectIdentity[] = [...projectIdentitiesMap.entries()]
    .map(([projectId, projectSlug]) => Object.freeze({ projectId, projectSlug }))
    .sort((a, b) => compareText(a.projectId, b.projectId));

  const manifest: RuntimeBackupManifest = Object.freeze({
    schemaVersion: pathPolicyVersion === runtimeBackupPathPolicyVersionV1
      ? runtimeBackupManifestSchemaVersionV1
      : pathPolicyVersion === runtimeBackupPathPolicyVersionV2
        ? runtimeBackupManifestSchemaVersionV2
        : runtimeBackupManifestSchemaVersionV3,
    backupFormatVersion: pathPolicyVersion === runtimeBackupPathPolicyVersionV1
      ? runtimeBackupFormatVersionV1
      : pathPolicyVersion === runtimeBackupPathPolicyVersionV2
        ? runtimeBackupFormatVersionV2
        : runtimeBackupFormatVersionV3,
    ...(pathPolicyVersion === runtimeBackupPathPolicyVersionV2
      ? { pathPolicyVersion: runtimeBackupPathPolicyVersionV2 }
      : pathPolicyVersion === runtimeBackupPathPolicyVersionV3
        ? { pathPolicyVersion: runtimeBackupPathPolicyVersionV3 }
        : {}),
    ...(pathPolicyVersion === runtimeBackupPathPolicyVersionV3
      ? { sourceProjectIdentities: Object.freeze(sourceProjectIdentities) }
      : {}),
    aggregateAlgorithm: runtimeBackupAggregateVersion,
    storagePolicyVersion: runtimeStoragePolicyVersion,
    createdAt: (options.now ?? (() => new Date().toISOString()))(),
    sourceLogicalIdentity: options.projectSlug
      ? `projects/${options.projectSlug}`
      : "projects",
    sourceClassification: options.projectSlug ? "single-project" : "multi-project",
    sourceProjectsRootLogicalName: "projects",
    ...(git?.headCommit ? { sourceHeadCommit: git.headCommit } : {}),
    aggregateFingerprint: aggregateRuntimeFileRecords(files),
    inventory: Object.freeze({
      files: files.length,
      bytes: files.reduce((accumulator, file) => accumulator + file.sizeBytes, 0),
      projects: projects.size,
      tracked,
      untracked: files.length - tracked,
      classifications: Object.freeze(classifications),
    }),
    files: Object.freeze(files),
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

const projectIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function deterministicProjectId(slug: string): string {
  const hex = createHash("sha256").update(`atolye-v2-project:${slug}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export function resolveProjectIdentity(
  projectsRoot: string,
  firstSegment: string,
  knownIdentities?: ReadonlyMap<string, string>,
): { projectId: string; projectSlug: string } {
  if (projectIdPattern.test(firstSegment)) {
    const projectId = firstSegment.toLowerCase();
    let projectSlug = knownIdentities?.get(projectId) ?? projectId;
    if (projectSlug === projectId) {
      const projectJsonPath = path.join(projectsRoot, firstSegment, "project.json");
      try {
        if (fs.existsSync(projectJsonPath)) {
          const parsed = JSON.parse(fs.readFileSync(projectJsonPath, "utf8"));
          if (typeof parsed.slug === "string" && /^[a-zA-Z0-9-_]+$/.test(parsed.slug)) {
            projectSlug = parsed.slug;
          }
        }
      } catch {
        // fallback to folder name if unparseable
      }
    }
    return { projectId, projectSlug };
  } else {
    const projectSlug = firstSegment;
    let projectId = deterministicProjectId(projectSlug);
    const projectJsonPath = path.join(projectsRoot, projectSlug, "project.json");
    try {
      if (fs.existsSync(projectJsonPath)) {
        const parsed = JSON.parse(fs.readFileSync(projectJsonPath, "utf8"));
        if (typeof parsed.id === "string" && projectIdPattern.test(parsed.id)) {
          projectId = parsed.id.toLowerCase();
        }
      }
    } catch {
      // fallback to deterministic id if unparseable
    }
    return { projectId, projectSlug };
  }
}

function walkRuntimeTree(
  projectsRoot: string,
  directory: string,
  files: RuntimeBackupFileRecord[],
  projectIdentitiesMap: Map<string, string>,
  knownIdentities: ReadonlyMap<string, string> | undefined,
  gitEntries: ReadonlyMap<string, RuntimeBackupGitMetadata> | undefined,
  hooks: RuntimeBackupInventoryOptions["hooks"],
  pathPolicyVersion: RuntimeBackupPathPolicyVersion,
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
      walkRuntimeTree(
        projectsRoot,
        absolutePath,
        files,
        projectIdentitiesMap,
        knownIdentities,
        gitEntries,
        hooks,
        pathPolicyVersion,
      );
      continue;
    }
    if (!link.isFile()) {
      throw new Error("Runtime backup source contains an unsupported path.");
    }
    const diskRelativePath = relativePosix(projectsRoot, absolutePath);
    if (
      isAudioCompensationJournalStagingPartialAtProjectPath(diskRelativePath) ||
      diskRelativePath.includes("/.pipeline-jobs.") ||
      diskRelativePath.startsWith(".pipeline-jobs.")
    ) {
      continue;
    }
    const firstSegment = diskRelativePath.split("/")[0];
    const hasSubdirectory = diskRelativePath.includes("/");
    let backupRelativePath = diskRelativePath;
    let projectSlug: string | undefined;

    if (hasSubdirectory && firstSegment) {
      const identity = resolveProjectIdentity(projectsRoot, firstSegment, knownIdentities);
      projectSlug = identity.projectSlug;
      projectIdentitiesMap.set(identity.projectId, identity.projectSlug);
      if (pathPolicyVersion === runtimeBackupPathPolicyVersionV3) {
        backupRelativePath = `${identity.projectId}/${diskRelativePath.substring(firstSegment.length + 1)}`;
      }
    }

    validateRuntimeBackupRelativePath(backupRelativePath, pathPolicyVersion);
    const hash = hashStableRuntimeFile(absolutePath, diskRelativePath, hooks);
    files.push({
      relativePath: backupRelativePath,
      type: "file",
      ...hash,
      ...(projectSlug ? { projectSlug } : {}),
      classification: classifyRuntimeFile(diskRelativePath),
      ...(gitEntries ? { git: gitEntries.get(diskRelativePath) ?? { tracked: false } } : {}),
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

function assertUniquePortablePaths(
  files: RuntimeBackupFileRecord[],
  pathPolicyVersion: RuntimeBackupPathPolicyVersion,
) {
  const exact = new Set<string>();
  const folded = new Set<string>();
  for (const file of files) {
    const portableKey = runtimeBackupPortableCollisionKey(
      file.relativePath,
      pathPolicyVersion,
    );
    if (exact.has(file.relativePath) || folded.has(portableKey)) {
      throw new Error("Runtime backup path collision detected.");
    }
    exact.add(file.relativePath);
    folded.add(portableKey);
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
