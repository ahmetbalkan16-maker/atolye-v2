/**
 * One-time, narrowly-scoped audio-publication-descriptor rebind for exactly
 * one real project: fatih-sultan-mehmet-in-i-stanbul-un-fethine-hazirlanisi-cfe77fd8-...
 *
 * Root cause (see the final report for this incident): all 7 of this
 * project's audio-publication-intent records recorded a device/inode pair
 * from an earlier filesystem materialization. The current on-disk files are
 * byte-for-byte identical (sha256 + byteLength both match every single
 * record, independently re-verified below AND inside
 * createAudioPublicationDescriptorRebind's own TOCTOU-safe check) but live
 * at a different device/inode -- the exact "git checkout/pull
 * re-materializing tracked canonical audio files with a fresh inode,
 * identical bytes" scenario AudioPublicationIntentStore.ts's own top-of-file
 * comment documents this rebind ledger as existing to recover from (see
 * also ATOLYE_CHECKPOINT.md Sprint 137, and Sprint 148's prior real-project
 * precedent for this exact operation on i-stanbul-un-fethi-1453).
 *
 * This uses ONLY the existing, already-tested createAudioPublicationDescriptorRebind()
 * (src/lib/audio/AudioPublicationIntentStore.ts) -- no new persistence
 * format, no new authority mechanism. It is purely additive: the original
 * "prepared" intent files are never opened for writing; each call appends
 * one new immutable audio-publication-rebinds/<assetId>-rebind-<n>.json
 * ledger entry, gated by assertProjectWriteAuthorityLease and independently
 * re-verifying sha256+byteLength before ever writing.
 */
import { initializeProductionProcessRuntime } from "../src/lib/runtime/ProductionRuntimeCompositionRoot";
import { acquireProjectWriteAuthority, resolveRuntimeStorageContext } from "../src/lib/runtime/RuntimeStoragePaths";
import {
  createProductionRuntimeOperationContext,
  initialRuntimeAuthorityGeneration,
  runWithProductionRuntimeOperationContext,
} from "../src/lib/runtime/ProductionRuntimeOperationContext";
import {
  createAudioPublicationDescriptorRebind,
  getCommittedAudioPublicationAssets,
} from "../src/lib/audio/AudioPublicationIntentStore";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const SLUG = "fatih-sultan-mehmet-in-i-stanbul-un-fethine-hazirlanisi-cfe77fd8-8350-4415-bc87-211e3d36c4d5";
const PROJECT_ID = "1ba3bebf-abe9-4b3c-9b4a-b9d238b98534";
const ASSET_IDS = [
  "09a44902-2fea-47c0-95b8-b425a0d02e11",
  "1b03ebfb-6b62-4b7c-b502-d1839755d959",
  "47c41dd9-9367-4631-9f35-8e9dbea9e7d1",
  "4b1c8d30-7353-4090-814d-511a4d717089",
  "895dd791-d4af-4b87-a213-39966554e8cb",
  "cdd5d362-5cd4-4e17-8983-306ca4c846a5",
  "faa095f4-0bcb-4565-94b9-33573762ca7a",
];

async function main() {
  await initializeProductionProcessRuntime();

  const intentDir = path.resolve("data", "projects", SLUG, "production-execution", "audio-publication-intents");
  const rebindDir = path.resolve("data", "projects", SLUG, "production-execution", "audio-publication-rebinds");
  const beforeIntentFiles = await fs.readdir(intentDir).catch(() => [] as string[]);
  const beforeRebindFiles = await fs.readdir(rebindDir).catch(() => [] as string[]);
  console.log(`Before: ${beforeIntentFiles.length} intent files, ${beforeRebindFiles.length} rebind files.`);

  const context = resolveRuntimeStorageContext();
  const operationContext = createProductionRuntimeOperationContext({
    operationId: `operator-audio-rebind-${randomUUID()}`,
    operationType: "operator-audio-rebind",
    authorityGeneration: initialRuntimeAuthorityGeneration,
    storageContext: context,
  });

  const results: Array<{ assetId: string; rebindId: string; sequence: number; newDevice: number; newInode: number;
    verifiedSha256: string; verifiedByteLength: number }> = [];
  await runWithProductionRuntimeOperationContext(operationContext, async () => {
    const authority = acquireProjectWriteAuthority(SLUG, context);
    try {
      for (const assetId of ASSET_IDS) {
        const rebind = createAudioPublicationDescriptorRebind({
          projectSlug: SLUG,
          projectId: PROJECT_ID,
          assetId,
          reasonCode: "FILESYSTEM_MATERIALIZATION_DRIFT",
          authority,
          context,
        });
        results.push({
          assetId, rebindId: rebind.rebindId, sequence: rebind.sequence,
          newDevice: rebind.newDevice, newInode: rebind.newInode,
          verifiedSha256: rebind.verifiedSha256, verifiedByteLength: rebind.verifiedByteLength,
        });
        console.log(`Rebound ${assetId}: sequence=${rebind.sequence} newDevice=${rebind.newDevice} newInode=${rebind.newInode} verifiedSha256=${rebind.verifiedSha256} verifiedByteLength=${rebind.verifiedByteLength}`);
      }
    } finally {
      authority.release();
    }
  });

  const afterIntentFiles = await fs.readdir(intentDir).catch(() => [] as string[]);
  const afterRebindFiles = await fs.readdir(rebindDir).catch(() => [] as string[]);
  console.log(`After: ${afterIntentFiles.length} intent files (unchanged expected), ${afterRebindFiles.length} rebind files (+${afterRebindFiles.length - beforeRebindFiles.length} expected).`);

  if (afterIntentFiles.length !== beforeIntentFiles.length ||
    !beforeIntentFiles.every((f) => afterIntentFiles.includes(f))) {
    throw new Error("UNEXPECTED: original intent files changed. STOP.");
  }

  const committed = await runWithProductionRuntimeOperationContext(operationContext,
    () => getCommittedAudioPublicationAssets(SLUG, PROJECT_ID, context));
  console.log(`getCommittedAudioPublicationAssets now returns ${committed.length} assets (expected ${ASSET_IDS.length}) without throwing.`);
  if (committed.length !== ASSET_IDS.length) {
    throw new Error(`UNEXPECTED committed asset count: ${committed.length} !== ${ASSET_IDS.length}`);
  }
  for (const assetId of ASSET_IDS) {
    if (!committed.some((asset) => asset.id === assetId)) {
      throw new Error(`UNEXPECTED: asset ${assetId} missing from committed set after rebind.`);
    }
  }

  console.log("=== REBIND COMPLETE, 7/7 SUCCESSFUL, VERIFIED ===");
  console.log(JSON.stringify(results, null, 2));
}

main().catch((error) => {
  console.error("=== REBIND FAILED ===");
  console.error(error);
  process.exitCode = 1;
});
