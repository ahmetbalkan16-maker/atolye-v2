/**
 * Restores (un-quarantines) the exact 13-file SEO orphan record chain moved by
 * scripts/quarantine-fatih-seo-orphan-record.ts back to its original location,
 * byte-for-byte verified against the checksums recorded in that script's
 * quarantine-manifest.json. SEO counterpart of
 * scripts/restore-fatih-thumbnail-orphan-record.ts.
 *
 * Why: quarantining ordinal 1 (pipeline-record-4a167f7a) let a genuinely fresh
 * SEO attempt (ordinal 2) reach the real provider and settle for a real reason.
 * classifyProductionDurableAttemptLineage's cardinality/topology proof
 * (ProductionDurableAttemptLineageClassifier.ts) requires a *contiguous*
 * 1..maximum ordinal range for the stage with no gaps -- with ordinal 1
 * physically absent, ordinal 2 alone fails that proof, so ordinal 1 must be
 * restored once ordinal 2 exists. Ordinal 1's stale "succeeded" record becomes
 * durably inert history again, exactly as it was before -- just no longer the
 * *only* record for the stage.
 */
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const SLUG = "fatih-sultan-mehmet-in-i-stanbul-un-fethine-hazirlanisi-cfe77fd8-8350-4415-bc87-211e3d36c4d5";
const RECORD_ID = "pipeline-record-4a167f7a";
const projectRoot = path.resolve("data", "projects", SLUG);
const durableRoot = path.join(projectRoot, "production-execution");
const quarantineParent = path.join(durableRoot, "quarantine");

async function sha256(filePath: string): Promise<string> {
  return createHash("sha256").update(await fs.readFile(filePath)).digest("hex");
}

async function main() {
  const labels = await fs.readdir(quarantineParent);
  const seoLabels = labels.filter((name) => name.startsWith("seo-orphan-4a167f7a-"));
  if (seoLabels.length !== 1) {
    throw new Error(`Expected exactly one seo-orphan-4a167f7a-* quarantine label, found: ${JSON.stringify(seoLabels)}. Aborting.`);
  }
  const quarantineDir = path.join(quarantineParent, seoLabels[0]);
  const manifest = JSON.parse(await fs.readFile(path.join(quarantineDir, "quarantine-manifest.json"), "utf8")) as {
    projectSlug: string; recordId: string;
    moves: Array<{ recordFile: string; kindDir: string; originalPath: string; newPath: string; sha256Before: string }>;
  };
  if (manifest.projectSlug !== SLUG || manifest.recordId !== RECORD_ID) {
    throw new Error(`Manifest does not match expected scope: ${JSON.stringify(manifest)}. Aborting.`);
  }

  const restored: Array<{ originalPath: string; newPath: string; sha256: string }> = [];
  for (const move of manifest.moves) {
    const currentSha = await sha256(move.newPath);
    if (currentSha !== move.sha256Before) {
      throw new Error(`CHECKSUM MISMATCH before restore for ${move.newPath}: ` +
        `expected=${move.sha256Before} actual=${currentSha}. STOP -- manual inspection required.`);
    }
    await fs.rename(move.newPath, move.originalPath);
    const afterSha = await sha256(move.originalPath);
    if (afterSha !== move.sha256Before) {
      throw new Error(`CHECKSUM MISMATCH after restore for ${move.originalPath}: ` +
        `expected=${move.sha256Before} actual=${afterSha}. STOP -- manual inspection required.`);
    }
    restored.push({ originalPath: move.originalPath, newPath: move.newPath, sha256: afterSha });
  }

  await fs.unlink(path.join(quarantineDir, "quarantine-manifest.json"));
  await fs.rmdir(quarantineDir);
  const remainingLabels = await fs.readdir(quarantineParent);
  if (remainingLabels.length === 0) await fs.rmdir(quarantineParent);

  console.log("=== RESTORE COMPLETE ===");
  console.log(`recordId: ${manifest.recordId}`);
  console.log(`files restored: ${restored.length}`);
  for (const r of restored) console.log(`  ${r.newPath} -> ${r.originalPath} (sha256=${r.sha256})`);
}

main().catch((error) => {
  console.error("=== RESTORE FAILED (nothing further attempted) ===");
  console.error(error);
  process.exitCode = 1;
});
