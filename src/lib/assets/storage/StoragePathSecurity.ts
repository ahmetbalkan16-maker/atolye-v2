import fs from "node:fs";
import path from "node:path";

export interface ContainedFile {
  realPath: string;
  stat: fs.Stats;
}

export function requireContainedStorageFile(
  storageRoot: string,
  targetPath: string,
): ContainedFile {
  const workspaceRoot = fs.realpathSync(process.cwd());
  const projectsPath = path.resolve(process.cwd(), "data", "projects");
  const projectsRootLink = fs.lstatSync(projectsPath);

  if (
    projectsRootLink.isSymbolicLink() ||
    !projectsRootLink.isDirectory()
  ) {
    throw new Error("Invalid storage root.");
  }

  const projectsRoot = fs.realpathSync(projectsPath);

  if (!isInside(workspaceRoot, projectsRoot)) {
    throw new Error("Invalid storage root.");
  }

  const storageRootLink = fs.lstatSync(storageRoot);
  const targetLink = fs.lstatSync(targetPath);

  if (
    storageRootLink.isSymbolicLink() ||
    !storageRootLink.isDirectory() ||
    targetLink.isSymbolicLink()
  ) {
    throw new Error("Invalid storage path.");
  }

  const resolvedStorageRoot = fs.realpathSync(storageRoot);
  const resolvedTarget = fs.realpathSync(targetPath);

  if (
    !isInside(projectsRoot, resolvedStorageRoot) ||
    !isInside(resolvedStorageRoot, resolvedTarget)
  ) {
    throw new Error("Invalid storage path.");
  }

  const stat = fs.statSync(resolvedTarget);

  if (!stat.isFile()) {
    throw new Error("Invalid storage file.");
  }

  return { realPath: resolvedTarget, stat };
}

function isInside(directory: string, target: string) {
  const relative = path.relative(directory, target);
  return (
    relative.length > 0 &&
    !relative.startsWith("..") &&
    !path.isAbsolute(relative)
  );
}
