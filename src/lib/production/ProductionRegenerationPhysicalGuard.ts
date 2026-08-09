import fs from "node:fs";
import path from "node:path";
import type { RuntimeStorageContext } from "@/lib/runtime/RuntimeStoragePaths";

export interface ProductionRegenerationPhysicalIdentity {
  readonly root: string;
  readonly project: string;
  readonly rootDevice: bigint;
  readonly rootInode: bigint;
  readonly projectDevice: bigint;
  readonly projectInode: bigint;
}

/**
 * Resolves a regeneration target through physical filesystem identity, never just its
 * lexical spelling.  The returned identity is intentionally re-checkable immediately
 * before every write boundary.
 */
export function assertProductionRegenerationPhysicalProject(
  projectSlug: string,
  context: RuntimeStorageContext,
  targetPath?: string,
): ProductionRegenerationPhysicalIdentity {
  const root = exactDirectory(context.projectsRoot);
  const project = exactDirectory(path.join(root.path, projectSlug));
  if (!isContained(root.path, project.path) || samePath(root.path, project.path)) {
    throw new Error("PRODUCTION_REGENERATION_PHYSICAL_PATH_INVALID");
  }
  if (targetPath) assertPhysicalTarget(project.path, targetPath);
  return Object.freeze({
    root: root.path,
    project: project.path,
    rootDevice: root.device,
    rootInode: root.inode,
    projectDevice: project.device,
    projectInode: project.inode,
  });
}

export function reassertProductionRegenerationPhysicalProject(
  expected: ProductionRegenerationPhysicalIdentity,
  targetPath?: string,
): void {
  const root = exactDirectory(expected.root);
  const project = exactDirectory(expected.project);
  if (root.device !== expected.rootDevice || root.inode !== expected.rootInode ||
    project.device !== expected.projectDevice || project.inode !== expected.projectInode ||
    !isContained(root.path, project.path) || samePath(root.path, project.path)) {
    throw new Error("PRODUCTION_REGENERATION_PHYSICAL_IDENTITY_CHANGED");
  }
  if (targetPath) assertPhysicalTarget(project.path, targetPath);
}

function assertPhysicalTarget(project: string, candidate: string) {
  const resolved = path.resolve(candidate);
  if (!isContained(project, resolved)) {
    throw new Error("PRODUCTION_REGENERATION_PHYSICAL_PATH_INVALID");
  }
  const existing = nearestExisting(resolved);
  const entry = fs.lstatSync(existing.directory, { bigint: true });
  if (entry.isSymbolicLink()) throw new Error("PRODUCTION_REGENERATION_PHYSICAL_PATH_INVALID");
  const ancestor = entry.isDirectory()
    ? exactDirectory(existing.directory)
    : exactDirectory(path.dirname(existing.directory));
  if (!isContained(project, ancestor.path) && !samePath(project, ancestor.path)) {
    throw new Error("PRODUCTION_REGENERATION_PHYSICAL_PATH_INVALID");
  }
  // A symlink/reparse point anywhere in the resolved ancestor chain is rejected by
  // exactDirectory; the remaining components are validated lexical-safe.
  for (const part of existing.remainder) {
    if (!part || part === "." || part === "..") {
      throw new Error("PRODUCTION_REGENERATION_PHYSICAL_PATH_INVALID");
    }
  }
}

function nearestExisting(candidate: string) {
  const remainder: string[] = [];
  let directory = candidate;
  while (!fs.existsSync(directory)) {
    const parent = path.dirname(directory);
    if (parent === directory) throw new Error("PRODUCTION_REGENERATION_PHYSICAL_PATH_INVALID");
    remainder.unshift(path.basename(directory));
    directory = parent;
  }
  return { directory, remainder };
}

function exactDirectory(candidate: string) {
  const stat = fs.lstatSync(candidate, { bigint: true });
  const real = fs.realpathSync.native(candidate);
  const resolved = path.resolve(candidate);
  if (!stat.isDirectory() || stat.isSymbolicLink() || !samePath(real, resolved)) {
    throw new Error("PRODUCTION_REGENERATION_PHYSICAL_PATH_INVALID");
  }
  return { path: resolved, device: stat.dev, inode: stat.ino };
}

function isContained(root: string, candidate: string) {
  const relative = path.relative(comparable(root), comparable(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function samePath(left: string, right: string) {
  return comparable(left) === comparable(right);
}

function comparable(value: string) {
  const normalized = path.normalize(value);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}
