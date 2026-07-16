import { createRuntimeStorageContext } from "../src/lib/runtime/RuntimeStoragePaths";
import { collectRuntimeBackupInventory } from "../src/lib/runtime/backup/RuntimeBackupInventory";
import {
  createVerifiedRuntimeBackup,
  restoreAndVerifyRuntimeBackup,
  RuntimeBackupError,
} from "../src/lib/runtime/backup/RuntimeBackupService";
import { verifyRuntimeBackup } from "../src/lib/runtime/backup/RuntimeBackupVerifier";

const repositoryRoot = process.cwd();

function argument(name: string) {
  const prefix = `--${name}=`;
  return process.argv.slice(3).find((item) => item.startsWith(prefix))?.slice(prefix.length);
}

function report(value: unknown) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function main() {
  const command = process.argv[2] ?? "inventory";
  const context = createRuntimeStorageContext();
  if (command === "inventory") {
    const manifest = collectRuntimeBackupInventory({
      context,
      repositoryRoot,
      projectSlug: argument("project-slug"),
    });
    report({
      status: "verified",
      operation: "read-only-inventory",
      sourceLogicalIdentity: manifest.sourceLogicalIdentity,
      aggregateFingerprint: manifest.aggregateFingerprint,
      inventory: manifest.inventory,
      markerFiles: manifest.files
        .filter((file) => file.classification === "acceptance-marker")
        .map((file) => ({ relativePath: file.relativePath, sha256: file.sha256 })),
    });
    return;
  }
  if (command === "create") {
    if (!process.argv.includes("--confirm-runtime-backup-create")) {
      throw new RuntimeBackupError("RUNTIME_BACKUP_PATH_INVALID");
    }
    const backupRoot = argument("backup-root");
    if (!backupRoot) throw new RuntimeBackupError("RUNTIME_BACKUP_PATH_INVALID");
    const result = createVerifiedRuntimeBackup({
      context,
      repositoryRoot,
      backupRoot,
      projectSlug: argument("project-slug"),
    });
    report({
      status: "created-and-verified",
      backupId: result.backupId,
      aggregateFingerprint: result.manifest.aggregateFingerprint,
      inventory: result.manifest.inventory,
      manifestSha256: result.verification.manifestSha256,
    });
    return;
  }
  if (command === "verify") {
    const backupDirectory = argument("backup-dir");
    if (!backupDirectory) throw new RuntimeBackupError("RUNTIME_BACKUP_PATH_INVALID");
    const result = verifyRuntimeBackup(backupDirectory);
    report({
      status: "verified",
      aggregateFingerprint: result.aggregateFingerprint,
      files: result.files,
      bytes: result.bytes,
      manifestSha256: result.manifestSha256,
      markerFiles: result.markerFiles,
    });
    return;
  }
  if (command === "restore-verify") {
    const backupDirectory = argument("backup-dir");
    if (!backupDirectory) throw new RuntimeBackupError("RUNTIME_BACKUP_PATH_INVALID");
    const result = restoreAndVerifyRuntimeBackup({
      backupDirectory,
      repositoryRoot,
      liveProjectsRoot: context.projectsRoot,
    });
    report({
      status: "restored-and-verified-in-service-temp-root",
      aggregateFingerprint: result.aggregateFingerprint,
      files: result.files,
      bytes: result.bytes,
      markerFiles: result.markerFiles,
    });
    return;
  }
  throw new RuntimeBackupError("RUNTIME_BACKUP_PATH_INVALID");
}

void main().catch((error: unknown) => {
  const message = error instanceof RuntimeBackupError
    ? error.message
    : "Runtime backup operation failed.";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
