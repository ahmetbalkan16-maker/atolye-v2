import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";

export class ProjectWriter {
  static async ensureProjectFolder(slug: string) {
    const folder = path.join(process.cwd(), "data", "projects", slug);
    await fs.mkdir(folder, { recursive: true });
    return folder;
  }

  static async writeJSON(slug: string, fileName: string, data: unknown) {
    const folder = await this.ensureProjectFolder(slug);
    const file = path.join(folder, fileName);

    await fs.writeFile(file, JSON.stringify(data, null, 2), "utf-8");
  }

  static async writeJSONAtomically(
    slug: string,
    fileName: string,
    data: unknown,
  ) {
    const folder = await this.ensureSafeProjectFolder(slug);
    requireSafeJsonFileName(fileName);
    const file = path.join(folder, fileName);
    const temporaryFile = path.join(
      folder,
      `.${fileName}.${process.pid}.${randomUUID()}.tmp`,
    );

    try {
      const handle = await fs.open(temporaryFile, "wx");
      try {
        await handle.writeFile(JSON.stringify(data, null, 2), "utf-8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      await fs.rename(temporaryFile, file);
    } catch (error) {
      try {
        await fs.rm(temporaryFile, { force: true });
      } catch {
        // Preserve the original persistence error.
      }

      throw error;
    }
  }

  static async removeJSON(slug: string, fileName: string) {
    const folder = await this.ensureSafeProjectFolder(slug);
    requireSafeJsonFileName(fileName);
    await fs.rm(path.join(folder, fileName), { force: true });
  }

  private static async ensureSafeProjectFolder(slug: string) {
    if (!/^[a-zA-Z0-9-_]+$/.test(slug)) {
      throw new Error("Invalid project storage path.");
    }
    const workspace = await fs.realpath(process.cwd());
    const dataRoot = path.resolve(process.cwd(), "data");
    const projectsRoot = path.resolve(dataRoot, "projects");
    await requireSafeDirectory(workspace, dataRoot);
    await requireSafeDirectory(dataRoot, projectsRoot);
    const folder = path.resolve(projectsRoot, slug);
    if (!isInside(projectsRoot, folder)) {
      throw new Error("Invalid project storage path.");
    }
    try {
      await fs.mkdir(folder);
    } catch (error) {
      if (!isNodeError(error) || error.code !== "EEXIST") throw error;
    }
    await requireSafeDirectory(projectsRoot, folder);
    return folder;
  }
}

async function requireSafeDirectory(parent: string, target: string) {
  const link = await fs.lstat(target);
  if (link.isSymbolicLink() || !link.isDirectory()) {
    throw new Error("Invalid project storage path.");
  }
  const realParent = await fs.realpath(parent);
  const realTarget = await fs.realpath(target);
  if (!isInside(realParent, realTarget)) {
    throw new Error("Invalid project storage path.");
  }
}

function requireSafeJsonFileName(fileName: string) {
  if (!/^[a-zA-Z0-9_-]+\.json$/.test(fileName)) {
    throw new Error("Invalid project storage path.");
  }
}

function isInside(directory: string, target: string) {
  const relative = path.relative(directory, target);
  return relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error;
}
