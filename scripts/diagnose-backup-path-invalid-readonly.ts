import fs from "node:fs";
import { createRuntimeStorageContext } from "../src/lib/runtime/RuntimeStoragePaths";
import { bootstrapRuntimeBackupStorageAuthority } from "../src/lib/runtime/backup/RuntimeBackupAuthority";
import { createVerifiedRuntimeBackup, RuntimeBackupError } from
  "../src/lib/runtime/backup/RuntimeBackupService";

async function main() {
  const context = createRuntimeStorageContext();
  console.log("workspaceRoot:", context.workspaceRoot);
  const authority = bootstrapRuntimeBackupStorageAuthority(context);
  console.log("AUTHORITY OK. canonicalBackupRoot:", authority.canonicalBackupRoot);

  console.log("workspaceRoot lstat:", JSON.stringify({
    exists: fs.existsSync(context.workspaceRoot),
    isSymlink: fs.existsSync(context.workspaceRoot) && fs.lstatSync(context.workspaceRoot).isSymbolicLink(),
    isDir: fs.existsSync(context.workspaceRoot) && fs.lstatSync(context.workspaceRoot).isDirectory(),
    realpath: fs.existsSync(context.workspaceRoot) ? fs.realpathSync(context.workspaceRoot) : "N/A",
  }));

  try {
    const result = createVerifiedRuntimeBackup({ authority, projectSlug: "i-stanbul-un-fethi-1453" });
    console.log("CREATE OK:", JSON.stringify(result, null, 2));
  } catch (error) {
    if (error instanceof RuntimeBackupError) {
      console.log("CREATE FAILED (RuntimeBackupError):", error.message);
    } else {
      console.log("CREATE FAILED (other):", error instanceof Error ? error.message : String(error));
    }
    console.log("STACK:", error instanceof Error ? error.stack : "n/a");
  }
}

void main();
