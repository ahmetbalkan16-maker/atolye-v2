import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import {
  acquireProjectWriteAuthority,
  ensureSafeContainedDirectory,
  getProjectRoot,
  resolveRuntimeStorageContext,
  type RuntimeStorageContext,
  type RuntimeStorageInput,
} from "@/lib/runtime/RuntimeStoragePaths";

export class ProjectWriter {
  static async ensureProjectFolder(slug: string, input: RuntimeStorageInput = {}) {
    const context = resolveRuntimeStorageContext(input);
    const lease = acquireProjectWriteAuthority(slug, context);
    try {
      return this.ensureSafeProjectFolder(slug, context);
    } finally {
      lease.release();
    }
  }

  static async writeJSON(
    slug: string,
    fileName: string,
    data: unknown,
    input: RuntimeStorageInput = {},
  ) {
    await this.writeJSONAtomically(slug, fileName, data, input);
  }

  static async writeJSONOnce(
    slug: string,
    fileName: string,
    data: unknown,
    input: RuntimeStorageInput = {},
  ) {
    const context = resolveRuntimeStorageContext(input);
    const lease = acquireProjectWriteAuthority(slug, context);
    try {
      const folder = await this.ensureSafeProjectFolder(slug, context);
      requireSafeJsonFileName(fileName);
      const file = path.join(folder, fileName);
      const handle = await fs.open(file, "wx");
      try {
        await handle.writeFile(JSON.stringify(data, null, 2), "utf-8");
        await handle.sync();
      } finally {
        await handle.close();
      }
    } finally {
      lease.release();
    }
  }

  static async writeJSONAtomically(
    slug: string,
    fileName: string,
    data: unknown,
    input: RuntimeStorageInput = {},
  ) {
    const context = resolveRuntimeStorageContext(input);
    const lease = acquireProjectWriteAuthority(slug, context);
    let temporaryFile: string | undefined;

    try {
      const folder = await this.ensureSafeProjectFolder(slug, context);
      requireSafeJsonFileName(fileName);
      const file = path.join(folder, fileName);
      temporaryFile = path.join(
        folder,
        `.${fileName}.${process.pid}.${randomUUID()}.tmp`,
      );
      const handle = await fs.open(temporaryFile, "wx");
      try {
        await handle.writeFile(JSON.stringify(data, null, 2), "utf-8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      await renameWithTransientRetry(temporaryFile, file);
    } catch (error) {
      if (temporaryFile) {
        try {
          await fs.rm(temporaryFile, { force: true });
        } catch {
          // Preserve the original persistence error.
        }
      }
      throw error;
    } finally {
      lease.release();
    }
  }

  static async removeJSON(
    slug: string,
    fileName: string,
    input: RuntimeStorageInput = {},
  ) {
    const context = resolveRuntimeStorageContext(input);
    const lease = acquireProjectWriteAuthority(slug, context);
    try {
      const folder = await this.ensureSafeProjectFolder(slug, context);
      requireSafeJsonFileName(fileName);
      await fs.rm(path.join(folder, fileName), { force: true });
    } finally {
      lease.release();
    }
  }

  private static async ensureSafeProjectFolder(
    slug: string,
    context: RuntimeStorageContext,
  ) {
    if (!/^[a-zA-Z0-9-_]+$/.test(slug)) {
      throw new Error("Invalid project storage path.");
    }
    const projectsRoot = context.projectsRoot;
    const folder = getProjectRoot(slug, context);
    ensureSafeContainedDirectory(context.runtimeRoot, projectsRoot);
    ensureSafeContainedDirectory(projectsRoot, folder);
    return folder;
  }
}

function requireSafeJsonFileName(fileName: string) {
  if (!/^[a-zA-Z0-9_-]+\.json$/.test(fileName)) {
    throw new Error("Invalid project storage path.");
  }
}

const RENAME_RETRY_ATTEMPTS = 5;
const RENAME_RETRY_BASE_DELAY_MS = 25;

/**
 * `fs.rename` onto an existing destination is atomic on every platform this
 * app runs on, but on Windows it can transiently fail with EPERM/EBUSY when
 * another process (most commonly antivirus/Windows Search real-time
 * scanning of a just-written file) briefly holds the destination or source
 * path open -- a well-known OS-level race, not a data-integrity issue: the
 * temp file's content is already fsynced before this ever runs, so a retry
 * either succeeds with the exact same bytes or the loop exhausts and the
 * original error propagates exactly as before. Only EPERM/EBUSY are
 * retried; every other error (including ENOENT, EACCES, EXDEV) still fails
 * immediately on the first attempt, unchanged from prior behavior.
 */
async function renameWithTransientRetry(from: string, to: string): Promise<void> {
  for (let attempt = 1; attempt <= RENAME_RETRY_ATTEMPTS; attempt += 1) {
    try {
      await fs.rename(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if ((code !== "EPERM" && code !== "EBUSY") || attempt === RENAME_RETRY_ATTEMPTS) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, RENAME_RETRY_BASE_DELAY_MS * attempt));
    }
  }
}
