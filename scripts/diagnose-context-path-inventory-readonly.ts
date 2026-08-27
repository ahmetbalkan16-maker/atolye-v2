import fs from "node:fs";
import os from "node:os";
import { createRuntimeStorageContext } from "../src/lib/runtime/RuntimeStoragePaths";
import { bootstrapRuntimeBackupStorageAuthority } from "../src/lib/runtime/backup/RuntimeBackupAuthority";

function inspect(label: string, p: string) {
  const exists = fs.existsSync(p);
  let isSymlink = false;
  let isDir = false;
  let realpath = "N/A";
  if (exists) {
    const stat = fs.lstatSync(p);
    isSymlink = stat.isSymbolicLink();
    isDir = fs.statSync(p).isDirectory();
    try { realpath = fs.realpathSync(p); } catch { realpath = "ERROR"; }
  }
  console.log(`${label}: raw="${p}" (len=${p.length}) exists=${exists} isDir=${isDir} isSymlink=${isSymlink} realpath="${realpath}"`);
}

const context = createRuntimeStorageContext();
const authority = bootstrapRuntimeBackupStorageAuthority(context);

console.log("process.cwd():", process.cwd());
console.log("os.tmpdir():", os.tmpdir());
console.log();
inspect("context.workspaceRoot", context.workspaceRoot);
inspect("context.runtimeRoot", context.runtimeRoot);
inspect("context.projectsRoot", context.projectsRoot);
inspect("context.authorityRoot", context.authorityRoot);
inspect("context.machineRoot", context.machineRoot);
inspect("authority.canonicalBackupRoot", authority.canonicalBackupRoot);
console.log();
console.log("ATOLYE_RUNTIME_BACKUP_ROOT env:", process.env.ATOLYE_RUNTIME_BACKUP_ROOT ?? "(unset)");
console.log("ATOLYE_RUNTIME_ROOT env:", process.env.ATOLYE_RUNTIME_ROOT ?? "(unset)");
