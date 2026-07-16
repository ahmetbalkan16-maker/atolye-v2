import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { ProjectReader } from "@/lib/projects/ProjectReader";
import {
  prepareProductionAcceptanceMarkerReprepare,
  validateProductionAcceptanceReprepareReadback,
} from "./ProductionAcceptancePolicy";

const MARKER_FILE = "production-acceptance.json";

interface WritableFileHandle {
  writeFile(data: Uint8Array): Promise<void>;
  sync(): Promise<void>;
  close(): Promise<void>;
}

export interface ProductionAcceptanceReprepareFileOperations {
  readFile(filePath: string): Promise<Buffer>;
  open(filePath: string, flags: "wx"): Promise<WritableFileHandle>;
  rename(source: string, destination: string): Promise<void>;
  rm(filePath: string, options: { force: true }): Promise<void>;
  lstat(filePath: string): Promise<{ isDirectory(): boolean; isFile(): boolean; isSymbolicLink(): boolean }>;
  realpath(filePath: string): Promise<string>;
}

export interface ProductionAcceptanceReprepareDependencies {
  readonly environment?: NodeJS.ProcessEnv;
  readonly fileOperations?: ProductionAcceptanceReprepareFileOperations;
}

export interface ProductionAcceptanceReprepareResult {
  readonly projectSlug: string;
  readonly schemaVersion: "3";
  readonly decision: "reprepared" | "replayed";
  readonly writePerformed: boolean;
}

export class ProductionAcceptanceReprepareError extends Error {
  readonly code = "PRODUCTION_ACCEPTANCE_REPREPARE_FAILED";

  constructor() {
    super("Production acceptance marker re-prepare failed.");
    this.name = "ProductionAcceptanceReprepareError";
    this.stack = undefined;
  }
}

export async function reprepareProductionAcceptanceMarker(
  projectSlug: string,
  dependencies: ProductionAcceptanceReprepareDependencies = {},
): Promise<ProductionAcceptanceReprepareResult> {
  const environment = dependencies.environment ?? process.env;
  const operations = dependencies.fileOperations ?? defaultFileOperations;
  let paths: Awaited<ReturnType<typeof resolveSafeMarkerPaths>>;
  let originalBytes: Buffer;
  try {
    paths = await resolveSafeMarkerPaths(projectSlug, operations);
    originalBytes = await operations.readFile(paths.markerPath);
  } catch {
    throw new ProductionAcceptanceReprepareError();
  }

  let preparation: Awaited<ReturnType<typeof prepareProductionAcceptanceMarkerReprepare>>;
  try {
    preparation = await prepareProductionAcceptanceMarkerReprepare(
      projectSlug,
      parseJSON(originalBytes),
      environment,
    );
  } catch {
    throw new ProductionAcceptanceReprepareError();
  }
  if (preparation.decision === "replayed") {
    return Object.freeze({
      projectSlug,
      schemaVersion: "3",
      decision: "replayed",
      writePerformed: false,
    });
  }

  const desiredBytes = Buffer.from(JSON.stringify(preparation.marker, null, 2), "utf8");
  const temporaryPath = path.join(
    paths.projectFolder,
    `.${MARKER_FILE}.${process.pid}.${randomUUID()}.reprepare.tmp`,
  );
  let replaced = false;
  try {
    await writeSyncedTemporary(temporaryPath, desiredBytes, operations);
    await validateProductionAcceptanceReprepareReadback(
      projectSlug,
      parseJSON(await operations.readFile(temporaryPath)),
      preparation.marker,
      environment,
    );
    const currentBytes = await operations.readFile(paths.markerPath);
    if (!currentBytes.equals(originalBytes)) throw new Error("conflict");
    await operations.rename(temporaryPath, paths.markerPath);
    replaced = true;
    const readbackBytes = await operations.readFile(paths.markerPath);
    if (!readbackBytes.equals(desiredBytes)) throw new Error("readback");
    await validateProductionAcceptanceReprepareReadback(
      projectSlug,
      parseJSON(readbackBytes),
      preparation.marker,
      environment,
    );
    return Object.freeze({
      projectSlug,
      schemaVersion: "3",
      decision: "reprepared",
      writePerformed: true,
    });
  } catch {
    if (replaced) {
      try {
        await restoreOriginalMarker(paths, originalBytes, operations);
      } catch {
        throw new ProductionAcceptanceReprepareError();
      }
    }
    throw new ProductionAcceptanceReprepareError();
  } finally {
    try { await operations.rm(temporaryPath, { force: true }); } catch { /* Preserve result. */ }
  }
}

async function restoreOriginalMarker(
  paths: Awaited<ReturnType<typeof resolveSafeMarkerPaths>>,
  originalBytes: Buffer,
  operations: ProductionAcceptanceReprepareFileOperations,
) {
  const rollbackPath = path.join(
    paths.projectFolder,
    `.${MARKER_FILE}.${process.pid}.${randomUUID()}.rollback.tmp`,
  );
  try {
    await writeSyncedTemporary(rollbackPath, originalBytes, operations);
    await operations.rename(rollbackPath, paths.markerPath);
    const restored = await operations.readFile(paths.markerPath);
    if (!restored.equals(originalBytes)) throw new Error("rollback");
  } finally {
    try { await operations.rm(rollbackPath, { force: true }); } catch { /* Preserve failure. */ }
  }
}

async function writeSyncedTemporary(
  temporaryPath: string,
  bytes: Buffer,
  operations: ProductionAcceptanceReprepareFileOperations,
) {
  const handle = await operations.open(temporaryPath, "wx");
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function resolveSafeMarkerPaths(
  projectSlug: string,
  operations: ProductionAcceptanceReprepareFileOperations,
) {
  if (!/^[a-z0-9](?:[a-z0-9-]{0,198}[a-z0-9])?$/.test(projectSlug)) {
    throw new Error("invalid");
  }
  const workspace = await operations.realpath(process.cwd());
  const projectsRoot = await operations.realpath(ProjectReader.getProjectsRoot());
  const projectFolder = await operations.realpath(ProjectReader.getProjectFolder(projectSlug));
  const markerPath = path.join(projectFolder, MARKER_FILE);
  const [projectsLink, projectLink, markerLink] = await Promise.all([
    operations.lstat(projectsRoot),
    operations.lstat(projectFolder),
    operations.lstat(markerPath),
  ]);
  if (
    projectsLink.isSymbolicLink() || !projectsLink.isDirectory() ||
    projectLink.isSymbolicLink() || !projectLink.isDirectory() ||
    markerLink.isSymbolicLink() || !markerLink.isFile() ||
    !isInside(workspace, projectsRoot) ||
    !isInside(projectsRoot, projectFolder)
  ) throw new Error("invalid");
  return { projectFolder, markerPath };
}

function parseJSON(bytes: Buffer): unknown {
  return JSON.parse(bytes.toString("utf8")) as unknown;
}

function isInside(directory: string, target: string) {
  const relative = path.relative(directory, target);
  return relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative);
}

const defaultFileOperations: ProductionAcceptanceReprepareFileOperations = {
  readFile: (filePath) => fs.readFile(filePath),
  open: (filePath, flags) => fs.open(filePath, flags),
  rename: (source, destination) => fs.rename(source, destination),
  rm: (filePath, options) => fs.rm(filePath, options),
  lstat: (filePath) => fs.lstat(filePath),
  realpath: (filePath) => fs.realpath(filePath),
};
