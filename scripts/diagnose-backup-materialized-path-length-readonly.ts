import path from "node:path";
import { createRuntimeStorageContext } from "../src/lib/runtime/RuntimeStoragePaths";
import { bootstrapRuntimeBackupStorageAuthority } from "../src/lib/runtime/backup/RuntimeBackupAuthority";
import { collectRuntimeBackupInventory } from "../src/lib/runtime/backup/RuntimeBackupInventory";
import {
  assertRuntimeBackupMaterializedPath,
  runtimeBackupPathLimits,
} from "../src/lib/runtime/backup/RuntimeBackupPathPolicy";

/**
 * READ-ONLY: computes (never writes) the exact real materialized-path length
 * every file in i-stanbul-un-fethi-1453's real backup inventory would
 * produce under the CURRENT (unset ATOLYE_RUNTIME_BACKUP_ROOT -> default)
 * canonicalBackupRoot, using the real, unmodified exported
 * assertRuntimeBackupMaterializedPath()/runtimeBackupPathLimits from
 * RuntimeBackupPathPolicy.ts. No backup is created, no temp directory is
 * created, no file is written.
 */

const projectSlug = "i-stanbul-un-fethi-1453";
const repositoryRoot = process.cwd();

async function main() {
  const context = createRuntimeStorageContext();
  const authority = bootstrapRuntimeBackupStorageAuthority(context);
  const backupRoot = authority.canonicalBackupRoot;
  console.log("canonicalBackupRoot:", backupRoot, `(length=${backupRoot.length})`);
  console.log("materializedPathUtf16 limit:", runtimeBackupPathLimits.materializedPathUtf16);
  console.log("mutationRelativeUtf16 limit:", runtimeBackupPathLimits.mutationRelativeUtf16);
  console.log("relativePathUtf16 limit:", runtimeBackupPathLimits.relativePathUtf16);

  // Same shape preflightAtomicCreateMaterialization() uses: a short, real-format
  // partial-dir segment (the actual random suffix will differ at real-apply time,
  // but its length -- ".p-" + 8 hex chars = 11 chars -- is fixed by the real code).
  const partialRelative = ".p-00000000";
  const root = path.resolve(backupRoot, ...partialRelative.split("/"));
  console.log("\nsample partialRoot:", root, `(length=${root.length})`);

  const manifestInventory = collectRuntimeBackupInventory({
    context, repositoryRoot, projectSlug,
  });
  console.log(`\nInventory files: ${manifestInventory.files.length}`);

  let longest: { relativePath: string; length: number } | undefined;
  let overLimitCount = 0;
  const overLimitSamples: { relativePath: string; length: number }[] = [];

  for (const file of manifestInventory.files) {
    const candidateRelative = `payload/projects/${file.relativePath}`;
    let materializedLength: number;
    let ok: boolean;
    try {
      const target = assertRuntimeBackupMaterializedPath(root, candidateRelative);
      materializedLength = target.length;
      ok = true;
    } catch {
      // assertRuntimeBackupMaterializedPath throws exactly when the real
      // 259-char (or the 237-char mutationRelative pre-check) limit is
      // exceeded -- record the raw computed length ourselves for reporting,
      // reproducing its own target-length computation.
      const segments = candidateRelative.split("/");
      materializedLength = path.resolve(root, ...segments).length;
      ok = false;
      overLimitCount += 1;
      if (overLimitSamples.length < 5) {
        overLimitSamples.push({ relativePath: file.relativePath, length: materializedLength });
      }
    }
    if (!longest || materializedLength > longest.length) {
      longest = { relativePath: file.relativePath, length: materializedLength };
    }
    if (!ok) continue;
  }

  console.log(`\nLongest real materialized path (relativePath -> length):`);
  console.log(`  ${longest?.relativePath} -> ${longest?.length}`);
  console.log(`\nFiles that FAIL assertRuntimeBackupMaterializedPath under this backupRoot: ${overLimitCount} / ${manifestInventory.files.length}`);
  for (const sample of overLimitSamples) {
    console.log(`  FAIL: length=${sample.length} relativePath=${sample.relativePath}`);
  }

  // For comparison: what the length WOULD be under the documented Sprint 136
  // workaround root (C:\tmp\ar-backups), computed purely as a string -- no
  // directory of that name is created or touched.
  const alternateRoot = path.resolve("C:\\tmp\\ar-backups", partialRelative);
  console.log(`\nFor comparison only (not created, not touched) -- same computation under ` +
    `"C:\\tmp\\ar-backups" (length=${"C:\\tmp\\ar-backups".length}):`);
  let alternateOverLimit = 0;
  for (const file of manifestInventory.files) {
    try {
      assertRuntimeBackupMaterializedPath(alternateRoot, `payload/projects/${file.relativePath}`);
    } catch {
      alternateOverLimit += 1;
    }
  }
  console.log(`  Files that would FAIL under that shorter root: ${alternateOverLimit} / ${manifestInventory.files.length}`);
}

void main();
