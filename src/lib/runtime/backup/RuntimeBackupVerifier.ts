import fs from "node:fs";
import path from "node:path";
import {
  createRuntimeStorageContext,
  validateSafeAncestorChain,
} from "@/lib/runtime/RuntimeStoragePaths";
import {
  runtimeBackupManifestSha256,
  serializeRuntimeBackupManifest,
  validateRuntimeBackupManifest,
  type RuntimeBackupFileRecord,
  type RuntimeBackupManifest,
} from "./RuntimeBackupManifest";
import { collectRuntimeBackupInventory } from "./RuntimeBackupInventory";

export interface RuntimeBackupVerificationReport {
  readonly valid: true;
  readonly manifest: RuntimeBackupManifest;
  readonly manifestSha256: string;
  readonly aggregateFingerprint: string;
  readonly files: number;
  readonly bytes: number;
  readonly markerFiles: readonly {
    readonly relativePath: string;
    readonly sha256: string;
  }[];
}

export function verifyRuntimeBackup(
  backupDirectory: string,
  options: { readonly allowPartial?: boolean } = {},
): RuntimeBackupVerificationReport {
  const backupRoot = requireAbsoluteDirectory(backupDirectory);
  if (!options.allowPartial && path.basename(backupRoot).includes(".partial")) {
    throw new Error("Partial runtime backup is not valid.");
  }
  const manifestPath = path.join(backupRoot, "manifest.json");
  const digestPath = path.join(backupRoot, "manifest.sha256");
  const payloadRoot = path.join(backupRoot, "payload");
  const projectsRoot = path.join(payloadRoot, "projects");
  requireExactDirectoryEntries(backupRoot, ["manifest.json", "manifest.sha256", "payload"]);
  for (const target of [manifestPath, digestPath]) requireRegularFile(target);
  requireAbsoluteDirectory(payloadRoot);
  requireExactDirectoryEntries(payloadRoot, ["projects"]);
  requireAbsoluteDirectory(projectsRoot);

  const serialized = fs.readFileSync(manifestPath, "utf8");
  const expectedDigest = fs.readFileSync(digestPath, "utf8");
  if (!/^[a-f0-9]{64}\n$/.test(expectedDigest)) {
    throw new Error("Runtime backup manifest digest is invalid.");
  }
  const actualDigest = runtimeBackupManifestSha256(serialized);
  if (actualDigest !== expectedDigest.trim()) {
    throw new Error("Runtime backup manifest digest mismatch.");
  }
  let manifest: unknown;
  try {
    manifest = JSON.parse(serialized);
  } catch {
    throw new Error("Runtime backup manifest is invalid.");
  }
  validateRuntimeBackupManifest(manifest);
  if (serializeRuntimeBackupManifest(manifest) !== serialized) {
    throw new Error("Runtime backup manifest serialization is not canonical.");
  }
  verifyRuntimeTreeAgainstManifest(projectsRoot, manifest);
  return Object.freeze({
    valid: true,
    manifest,
    manifestSha256: actualDigest,
    aggregateFingerprint: manifest.aggregateFingerprint,
    files: manifest.inventory.files,
    bytes: manifest.inventory.bytes,
    markerFiles: Object.freeze(manifest.files
      .filter((file) => file.classification === "acceptance-marker")
      .map((file) => Object.freeze({ relativePath: file.relativePath, sha256: file.sha256 }))),
  });
}

export function verifyRuntimeTreeAgainstManifest(
  projectsRoot: string,
  manifest: RuntimeBackupManifest,
) {
  const canonicalProjects = requireAbsoluteDirectory(projectsRoot);
  const runtimeRoot = path.dirname(canonicalProjects);
  if (path.basename(canonicalProjects) !== "projects") {
    throw new Error("Runtime backup payload layout is invalid.");
  }
  const context = createRuntimeStorageContext({
    workspaceRoot: runtimeRoot,
    environment: { ATOLYE_RUNTIME_ROOT: runtimeRoot },
  });
  const inventory = collectRuntimeBackupInventory({
    context,
    now: () => manifest.createdAt,
  });
  const expected = manifest.files.map(treeIdentity);
  const actual = inventory.files.map(treeIdentity);
  if (
    JSON.stringify(actual) !== JSON.stringify(expected) ||
    inventory.aggregateFingerprint !== manifest.aggregateFingerprint ||
    inventory.inventory.files !== manifest.inventory.files ||
    inventory.inventory.bytes !== manifest.inventory.bytes
  ) {
    throw new Error("Runtime backup payload verification failed.");
  }
}

function treeIdentity(file: RuntimeBackupFileRecord) {
  return {
    relativePath: file.relativePath,
    sizeBytes: file.sizeBytes,
    sha256: file.sha256,
    permissionClass: file.permissionClass,
    projectSlug: file.projectSlug,
    classification: file.classification,
  };
}

function requireAbsoluteDirectory(target: string) {
  if (typeof target !== "string" || !path.isAbsolute(target)) {
    throw new Error("Runtime backup path is invalid.");
  }
  const canonical = path.resolve(target);
  validateSafeAncestorChain(canonical);
  const link = fs.lstatSync(canonical);
  if (link.isSymbolicLink() || !link.isDirectory()) {
    throw new Error("Runtime backup path is unsafe.");
  }
  const real = fs.realpathSync(canonical);
  if (!samePath(real, canonical)) throw new Error("Runtime backup path is unsafe.");
  return real;
}

function requireRegularFile(target: string) {
  const link = fs.lstatSync(target);
  const real = fs.realpathSync(target);
  if (link.isSymbolicLink() || !link.isFile() || !samePath(real, target)) {
    throw new Error("Runtime backup file is unsafe.");
  }
}

function requireExactDirectoryEntries(directory: string, expected: readonly string[]) {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const actual = entries.map((entry) => entry.name).sort(compareText);
  const wanted = [...expected].sort(compareText);
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    throw new Error("Runtime backup layout is invalid.");
  }
}

function compareText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function samePath(left: string, right: string) {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}
