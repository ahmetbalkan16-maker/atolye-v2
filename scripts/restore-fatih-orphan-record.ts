/**
 * Restores (un-quarantines) an orphan record chain moved by
 * scripts/quarantine-fatih-orphan-record.ts back to its original location,
 * byte-for-byte verified against the checksums in that label's
 * quarantine-manifest.json. Parameterized sibling of
 * scripts/restore-fatih-thumbnail-orphan-record.ts.
 *
 * Usage: tsx scripts/restore-fatih-orphan-record.ts --stage=<seo|youtube|export> --record-id=<8-hex>
 *
 * Restoring the stale ordinal-1 "succeeded" record is safe once a genuine
 * ordinal-2 record exists for the stage:
 * classifyProductionDurableAttemptLineage requires a contiguous 1..maximum
 * ordinal range with no gaps, so ordinal 1 must be present alongside ordinal 2.
 * It becomes durably inert history again -- no longer the only record.
 */
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const SLUG = "fatih-sultan-mehmet-in-i-stanbul-un-fethine-hazirlanisi-cfe77fd8-8350-4415-bc87-211e3d36c4d5";
const KNOWN_ORPHAN_RECORDS: Record<string, string> = {
  seo: "pipeline-record-4a167f7a",
  youtube: "pipeline-record-820de5fa",
  export: "pipeline-record-e9053dd4",
};

function parseArgs() {
  const values = new Map<string, string>();
  for (const raw of process.argv.slice(2)) {
    const m = /^--([a-z-]+)=(.+)$/.exec(raw);
    if (!m || !["stage", "record-id"].includes(m[1]) || values.has(m[1])) throw new Error(`INVALID_ARGUMENTS: ${raw}`);
    values.set(m[1], m[2]);
  }
  const stage = values.get("stage");
  const recordId = values.get("record-id");
  if (!stage || !recordId || values.size !== 2) throw new Error("INVALID_ARGUMENTS");
  return { stage, recordId };
}

async function sha256(filePath: string): Promise<string> {
  return createHash("sha256").update(await fs.readFile(filePath)).digest("hex");
}

async function main() {
  const { stage, recordId } = parseArgs();
  if (KNOWN_ORPHAN_RECORDS[stage] !== recordId) {
    throw new Error(`Scope assertion failed: (${stage}, ${recordId}) not a known incident orphan. Aborting.`);
  }
  const shortId = recordId.replace(/^pipeline-record-/, "");
  const projectRoot = path.resolve("data", "projects", SLUG);
  const quarantineParent = path.join(projectRoot, "production-execution", "quarantine");

  const labels = (await fs.readdir(quarantineParent)).filter((n) => n.startsWith(`${stage}-orphan-${shortId}-`));
  if (labels.length !== 1) {
    throw new Error(`Expected exactly one ${stage}-orphan-${shortId}-* label, found: ${JSON.stringify(labels)}. Aborting.`);
  }
  const quarantineDir = path.join(quarantineParent, labels[0]);
  const manifest = JSON.parse(await fs.readFile(path.join(quarantineDir, "quarantine-manifest.json"), "utf8")) as {
    projectSlug: string; stage: string; recordId: string;
    moves: Array<{ originalPath: string; newPath: string; sha256Before: string }>;
  };
  if (manifest.projectSlug !== SLUG || manifest.stage !== stage || manifest.recordId !== recordId) {
    throw new Error(`Manifest scope mismatch: ${JSON.stringify(manifest)}. Aborting.`);
  }

  const restored: Array<{ originalPath: string; sha256: string }> = [];
  for (const move of manifest.moves) {
    const currentSha = await sha256(move.newPath);
    if (currentSha !== move.sha256Before) {
      throw new Error(`CHECKSUM MISMATCH before restore ${move.newPath}: expected=${move.sha256Before} actual=${currentSha}.`);
    }
    await fs.rename(move.newPath, move.originalPath);
    const afterSha = await sha256(move.originalPath);
    if (afterSha !== move.sha256Before) {
      throw new Error(`CHECKSUM MISMATCH after restore ${move.originalPath}: expected=${move.sha256Before} actual=${afterSha}.`);
    }
    restored.push({ originalPath: move.originalPath, sha256: afterSha });
  }

  await fs.unlink(path.join(quarantineDir, "quarantine-manifest.json"));
  await fs.rmdir(quarantineDir);
  if ((await fs.readdir(quarantineParent)).length === 0) await fs.rmdir(quarantineParent);

  console.log(`=== RESTORE COMPLETE (${stage} / ${recordId}) ===`);
  console.log(`files restored: ${restored.length}`);
  for (const r of restored) console.log(`  ${r.originalPath} (sha256=${r.sha256})`);
}

main().catch((error) => {
  console.error("=== RESTORE FAILED (nothing further attempted) ===");
  console.error(error);
  process.exitCode = 1;
});
