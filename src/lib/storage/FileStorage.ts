import fs from "fs";
import path from "path";
import {
  acquireProjectWriteAuthority,
  ensureSafeContainedDirectory,
  resolveRuntimeLogicalPath,
  resolveRuntimeLogicalPathForWrite,
  resolveRuntimeStorageContext,
  type RuntimeStorageContext,
  type RuntimeStorageInput,
} from "@/lib/runtime/RuntimeStoragePaths";

function resolvePath(
  relativePath: string,
  context: RuntimeStorageContext,
  write = false,
) {
  if (relativePath.startsWith("data/projects/")) {
    return write
      ? resolveRuntimeLogicalPathForWrite(relativePath, context)
      : resolveRuntimeLogicalPath(relativePath, context);
  }
  return path.join(context.workspaceRoot, relativePath);
}

function ensureStorageDirectory(
  relativePath: string,
  filePath: string,
  context: RuntimeStorageContext,
) {
  if (relativePath.startsWith("data/projects/")) {
    ensureSafeContainedDirectory(context.runtimeRoot, context.projectsRoot);
    ensureSafeContainedDirectory(context.projectsRoot, path.dirname(filePath));
  } else {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  }
}

export class FileStorage {
  static exists(relativePath: string, input: RuntimeStorageInput = {}) {
    const context = resolveRuntimeStorageContext(input);
    return fs.existsSync(resolvePath(relativePath, context));
  }

  static saveJson(
    relativePath: string,
    data: unknown,
    input: RuntimeStorageInput = {},
  ) {
    const context = resolveRuntimeStorageContext(input);
    return withWriteAuthority(relativePath, context, () => {
      const filePath = resolvePath(relativePath, context, true);
      ensureStorageDirectory(relativePath, filePath, context);
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
      return data;
    });
  }

  static saveJsonAtomically(
    relativePath: string,
    data: unknown,
    input: RuntimeStorageInput = {},
  ) {
    const context = resolveRuntimeStorageContext(input);
    return withWriteAuthority(relativePath, context, () => {
      const filePath = resolvePath(relativePath, context, true);
      ensureStorageDirectory(relativePath, filePath, context);
      const temporaryPath = path.join(
        path.dirname(filePath),
        `.${path.basename(filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`,
      );

      try {
        fs.writeFileSync(temporaryPath, JSON.stringify(data, null, 2), "utf-8");
        fs.renameSync(temporaryPath, filePath);
        return data;
      } catch (error) {
        try { fs.rmSync(temporaryPath, { force: true }); } catch { /* best effort */ }
        throw error;
      }
    });
  }

  static loadJson<T>(relativePath: string, input: RuntimeStorageInput = {}): T | null {
    const context = resolveRuntimeStorageContext(input);
    const filePath = resolvePath(relativePath, context);

    if (!fs.existsSync(filePath)) {
      return null;
    }

    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
  }

  static listDirs(relativePath: string, input: RuntimeStorageInput = {}) {
    const context = resolveRuntimeStorageContext(input);
    const dirPath = resolvePath(relativePath, context);

    if (!fs.existsSync(dirPath)) {
      return [];
    }

    return fs
      .readdirSync(dirPath)
      .filter((item) => fs.statSync(path.join(dirPath, item)).isDirectory());
  }

  static remove(relativePath: string, input: RuntimeStorageInput = {}) {
    const context = resolveRuntimeStorageContext(input);
    return withWriteAuthority(relativePath, context, () => {
      const filePath = resolvePath(relativePath, context);
      if (fs.existsSync(filePath)) {
        fs.rmSync(filePath, { recursive: true, force: true });
      }
    });
  }
}

function withWriteAuthority<T>(
  relativePath: string,
  context: RuntimeStorageContext,
  run: () => T,
) {
  if (!relativePath.startsWith("data/projects/")) return run();
  const slug = relativePath.split("/")[2];
  const lease = acquireProjectWriteAuthority(slug, context);
  try {
    return run();
  } finally {
    lease.release();
  }
}
