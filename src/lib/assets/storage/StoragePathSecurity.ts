import fs from "node:fs";
import {
  assertPathContained,
  requireContainedRealDirectory,
  resolveRuntimeStorageContext,
  type RuntimeStorageInput,
} from "@/lib/runtime/RuntimeStoragePaths";

export interface ContainedFile {
  realPath: string;
  stat: fs.Stats;
}

export function requireContainedStorageFile(
  storageRoot: string,
  targetPath: string,
  input: RuntimeStorageInput = {},
): ContainedFile {
  const context = resolveRuntimeStorageContext(input);
  const projectsRoot = requireContainedRealDirectory(
    context.runtimeRoot,
    context.projectsRoot,
  );
  const resolvedStorageRoot = requireContainedRealDirectory(projectsRoot, storageRoot);
  assertPathContained(projectsRoot, targetPath);
  const targetLink = fs.lstatSync(targetPath);

  if (
    targetLink.isSymbolicLink() ||
    !targetLink.isFile()
  ) {
    throw new Error("Invalid storage path.");
  }

  const resolvedTarget = fs.realpathSync(targetPath);
  assertPathContained(resolvedStorageRoot, resolvedTarget);

  const stat = fs.statSync(resolvedTarget);

  if (!stat.isFile()) {
    throw new Error("Invalid storage file.");
  }

  return { realPath: resolvedTarget, stat };
}

export function requireContainedStorageDirectory(
  storageRoot: string,
  input: RuntimeStorageInput = {},
): string {
  const context = resolveRuntimeStorageContext(input);
  const projectsRoot = requireContainedRealDirectory(
    context.runtimeRoot,
    context.projectsRoot,
  );
  return requireContainedRealDirectory(projectsRoot, storageRoot);
}
