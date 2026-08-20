import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { emitSmokeResult } from "./lib/SmokeResult";
import {
  withCanonicalSmokeRuntime,
  type CanonicalSmokeRuntime,
} from "./lib/CanonicalSmokeRuntime";
import {
  acquireProjectWriteAuthority,
  type RuntimeStorageAuthorityLease,
} from "../src/lib/runtime/RuntimeStoragePaths";
import {
  assertProtectedAudioCanonicalResolutionAllowed,
  bindProtectedAudioCompensationPublication,
  createAudioCanonicalDescriptorRebind,
  createProtectedAudioCompensationReceipt,
  prepareAudioCompensationWorkspace,
  pruneCompletedAudioCompensationRecords,
  removeRegistryOwnedAudioCompensationRecord,
  reserveProtectedAudioCompensationPublication,
  resolveCurrentAudioCanonicalDescriptorRebindRecord,
  transitionAudioCompensationState,
  AudioCompensationStoreError,
  AudioCanonicalDescriptorRebindConflictError,
  type AudioCanonicalDescriptorRebind,
  type AudioCanonicalDescriptorRebindRecordReference,
  type ProtectedAudioCompensationPublication,
} from "../src/lib/audio/AudioCompensationStore";
import {
  createAudioPublicationDescriptorRebind,
  getCommittedAudioPublicationAssets,
  prepareAudioPublicationIntent,
  AudioPublicationIntentConflictError,
} from "../src/lib/audio/AudioPublicationIntentStore";
import {
  readContainedAudioFileDescriptorBound,
  AudioDescriptorVerificationError,
} from "../src/lib/audio/AudioDescriptorBoundVerification";
import type { PortablePublishedFile } from "../src/lib/runtime/security/PortableNoClobberFilePublisher";
import type { Asset } from "../src/types/asset";

const PUBLICATION_STAGING_FILE = "publication-staging.wav";

let completed = 0;
let passed = 0;
let skipped = 0;

async function scenario(name: string, run: () => Promise<void>) {
  await run();
  completed += 1;
  passed += 1;
  console.log(`[smoke-audio-compensation-rebind] (${completed}/12) PASS: ${name}`);
}

function skip(name: string, reason: string) {
  completed += 1;
  skipped += 1;
  console.log(`[smoke-audio-compensation-rebind] (${completed}/12) SKIPPED: ${name} -- ${reason}`);
}

function wav(dataBytes = 1600): Buffer {
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(8000, 24);
  buffer.writeUInt32LE(16000, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataBytes, 40);
  return buffer;
}

/** Mirrors AudioCompensationStore.ts's private digest() exactly (sha256 of JSON.stringify),
 * needed here only to hand-craft deliberately-tampered/conflicting fixtures for negative tests. */
function digestOf(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function withProjectAuthority<T>(
  runtime: CanonicalSmokeRuntime,
  action: (authority: RuntimeStorageAuthorityLease) => T,
): T {
  const authority = acquireProjectWriteAuthority(runtime.projectSlug, runtime.runtimeStorageContext);
  try {
    return action(authority);
  } finally {
    authority.release();
  }
}

interface SeededCompensation {
  readonly compensationRef: string;
  readonly canonicalFileName: string;
  readonly canonicalPath: string;
  readonly bytes: Buffer;
  readonly publication: ProtectedAudioCompensationPublication;
}

/**
 * Drives the exact production lifecycle (prepareAudioCompensationWorkspace ->
 * createProtectedAudioCompensationReceipt -> reserve/bind publication -> transition to
 * completed/registry-owned) used by AudioStorage.prepareAudio/commitPreparedAudio/
 * handoffPublishedAudio, but at the store level directly (no AssetManager/ProjectManager
 * dependency), to reach a real "registry-owned" terminal record.
 */
function seedRegistryOwnedCompensation(
  runtime: CanonicalSmokeRuntime,
  dataBytes = 1600,
): SeededCompensation {
  const bytes = wav(dataBytes);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const canonicalFileName = `${randomUUID()}.wav`;

  const workspace = withProjectAuthority(runtime, (authority) =>
    prepareAudioCompensationWorkspace({
      authority, context: runtime.runtimeStorageContext,
      projectSlug: runtime.projectSlug, byteLength: bytes.length,
    }));
  fs.writeFileSync(workspace.temporaryFilePath, bytes, { flag: "wx" });
  const tempStat = fs.statSync(workspace.temporaryFilePath);

  const receipt = withProjectAuthority(runtime, (authority) =>
    createProtectedAudioCompensationReceipt({
      authority, context: runtime.runtimeStorageContext,
      projectSlug: runtime.projectSlug, workspace, canonicalFileName,
      byteLength: bytes.length, sha256, device: tempStat.dev, inode: tempStat.ino,
    }));

  const stagingPath = path.join(workspace.directory, PUBLICATION_STAGING_FILE);
  fs.linkSync(workspace.temporaryFilePath, stagingPath);
  const stagingStat = fs.statSync(stagingPath);

  withProjectAuthority(runtime, (authority) =>
    reserveProtectedAudioCompensationPublication({
      authority, context: runtime.runtimeStorageContext,
      projectSlug: runtime.projectSlug, compensationRef: receipt.compensationRef,
      mode: "hard-link", byteLength: bytes.length, sha256,
      device: stagingStat.dev, inode: stagingStat.ino,
    }));
  const publication = withProjectAuthority(runtime, (authority) =>
    bindProtectedAudioCompensationPublication({
      authority, context: runtime.runtimeStorageContext,
      projectSlug: runtime.projectSlug, compensationRef: receipt.compensationRef,
      mode: "hard-link", byteLength: bytes.length, sha256,
      device: stagingStat.dev, inode: stagingStat.ino,
    }));

  const audioDir = path.join(
    runtime.runtimeStorageContext.projectsRoot, runtime.projectSlug, "assets", "audio",
  );
  fs.mkdirSync(audioDir, { recursive: true });
  const canonicalPath = path.join(audioDir, canonicalFileName);
  fs.linkSync(stagingPath, canonicalPath);
  const canonicalStat = fs.statSync(canonicalPath);
  assert.equal(canonicalStat.dev, publication.device);
  assert.equal(canonicalStat.ino, publication.inode);

  withProjectAuthority(runtime, (authority) =>
    transitionAudioCompensationState(
      runtime.projectSlug, receipt.compensationRef,
      { status: "completed", outcome: "registry-owned" },
      authority, runtime.runtimeStorageContext,
    ));

  return { compensationRef: receipt.compensationRef, canonicalFileName, canonicalPath, bytes, publication };
}

/**
 * Deletes and rewrites the file with byte-identical content -- the exact real-world signature
 * this whole mechanism exists to recover from: same sha256/byteLength, a fresh inode.
 */
function driftCanonical(canonicalPath: string, bytes: Buffer): fs.Stats {
  fs.rmSync(canonicalPath);
  fs.writeFileSync(canonicalPath, bytes, { flag: "wx" });
  return fs.statSync(canonicalPath);
}

/**
 * Mirrors AudioStorage.ts's private readCanonicalFileDescriptorBound() exactly:
 * assertProtectedAudioCanonicalResolutionAllowed() alone never touches the physical file -- it
 * only resolves the *expected* identity from the receipt/publication/rebind records. The actual
 * device/inode/content mismatch is only ever detected by the second step, a TOCTOU-safe read of
 * the real canonical file against that expected identity. This is the real two-step check
 * VideoAssemblyManager's assembly path depends on (via AudioStorage.inspectStoredWav/readStoredWav).
 */
function readCanonicalBound(
  runtime: CanonicalSmokeRuntime,
  canonicalFileName: string,
  canonicalPath: string,
): Buffer {
  const expectedIdentity = assertProtectedAudioCanonicalResolutionAllowed(
    runtime.projectSlug, canonicalFileName, runtime.runtimeStorageContext,
  );
  if (!expectedIdentity) throw new AudioCompensationStoreError();
  const storageRoot = path.dirname(canonicalPath);
  try {
    return readContainedAudioFileDescriptorBound(
      storageRoot, canonicalPath, runtime.runtimeStorageContext, expectedIdentity,
    );
  } catch (error) {
    if (error instanceof AudioDescriptorVerificationError) {
      throw new AudioCompensationStoreError();
    }
    throw error;
  }
}

function rebindFilePath(runtime: CanonicalSmokeRuntime, compensationRef: string, sequence: number): string {
  return path.join(
    runtime.runtimeStorageContext.projectsRoot, runtime.projectSlug,
    "production-execution", "audio-compensation-cleanup", "audio-canonical-rebinds",
    `${compensationRef}.${sequence}.json`,
  );
}

async function main() {
  // 1. Happy path.
  await scenario(
    "happy path: byte-identical drift is rebound and assertProtectedAudioCanonicalResolutionAllowed succeeds",
    async () => {
      await withCanonicalSmokeRuntime({ name: "comp-rebind-happy", configureProductionExecution: false },
        async (runtime) => {
          const seed = seedRegistryOwnedCompensation(runtime);
          driftCanonical(seed.canonicalPath, seed.bytes);
          assert.throws(
            () => readCanonicalBound(runtime, seed.canonicalFileName, seed.canonicalPath),
            AudioCompensationStoreError,
            "bug must reproduce before repair -- the two-step check " +
              "(assertProtectedAudioCanonicalResolutionAllowed + TOCTOU-safe physical read) fails",
          );
          const rebind = withProjectAuthority(runtime, (authority) =>
            createAudioCanonicalDescriptorRebind({
              projectSlug: runtime.projectSlug, compensationRef: seed.compensationRef,
              reasonCode: "FILESYSTEM_MATERIALIZATION_DRIFT", authority, context: runtime.runtimeStorageContext,
            }));
          assert.equal(rebind.sequence, 1);
          assert.equal(rebind.verifiedSha256, seed.publication.sha256);
          assert.equal(rebind.verifiedByteLength, seed.publication.byteLength);
          assert.notEqual(rebind.newInode, seed.publication.inode);
          const identity = assertProtectedAudioCanonicalResolutionAllowed(
            runtime.projectSlug, seed.canonicalFileName, runtime.runtimeStorageContext,
          );
          assert.equal(identity?.sha256, seed.publication.sha256);
          assert.equal(identity?.inode, rebind.newInode);
          const bytes = readCanonicalBound(runtime, seed.canonicalFileName, seed.canonicalPath);
          assert.ok(bytes.equals(seed.bytes), "post-repair physical read must succeed and match content");
        });
    },
  );

  // 2. Reject: sha256 differs (genuine content change, not a rebind case).
  await scenario("reject: sha256 mismatch is refused, no file written", async () => {
    await withCanonicalSmokeRuntime({ name: "comp-rebind-sha-mismatch", configureProductionExecution: false },
      async (runtime) => {
        const seed = seedRegistryOwnedCompensation(runtime);
        fs.rmSync(seed.canonicalPath);
        fs.writeFileSync(seed.canonicalPath, wav(1601), { flag: "wx" });
        assert.throws(() => withProjectAuthority(runtime, (authority) =>
          createAudioCanonicalDescriptorRebind({
            projectSlug: runtime.projectSlug, compensationRef: seed.compensationRef,
            reasonCode: "FILESYSTEM_MATERIALIZATION_DRIFT", authority, context: runtime.runtimeStorageContext,
          })), AudioCompensationStoreError);
        assert.equal(fs.existsSync(rebindFilePath(runtime, seed.compensationRef, 1)), false);
      });
  });

  // 3. Reject: byteLength differs.
  await scenario("reject: byteLength mismatch is refused, no file written", async () => {
    await withCanonicalSmokeRuntime({ name: "comp-rebind-length-mismatch", configureProductionExecution: false },
      async (runtime) => {
        const seed = seedRegistryOwnedCompensation(runtime);
        fs.rmSync(seed.canonicalPath);
        fs.writeFileSync(seed.canonicalPath, wav(4000), { flag: "wx" });
        assert.throws(() => withProjectAuthority(runtime, (authority) =>
          createAudioCanonicalDescriptorRebind({
            projectSlug: runtime.projectSlug, compensationRef: seed.compensationRef,
            reasonCode: "FILESYSTEM_MATERIALIZATION_DRIFT", authority, context: runtime.runtimeStorageContext,
          })), AudioCompensationStoreError);
        assert.equal(fs.existsSync(rebindFilePath(runtime, seed.compensationRef, 1)), false);
      });
  });

  // 4. Reject: device/inode genuinely unchanged (no-op rebind is not silently accepted).
  await scenario("reject: no-op rebind (device/inode unchanged) is refused", async () => {
    await withCanonicalSmokeRuntime({ name: "comp-rebind-noop", configureProductionExecution: false },
      async (runtime) => {
        const seed = seedRegistryOwnedCompensation(runtime);
        assert.throws(() => withProjectAuthority(runtime, (authority) =>
          createAudioCanonicalDescriptorRebind({
            projectSlug: runtime.projectSlug, compensationRef: seed.compensationRef,
            reasonCode: "FILESYSTEM_MATERIALIZATION_DRIFT", authority, context: runtime.runtimeStorageContext,
          })), AudioCompensationStoreError);
      });
  });

  // 5. Idempotent retry: same resulting descriptor twice is a safe no-op success.
  await scenario("idempotent: identical repeat rebind call succeeds without conflict", async () => {
    await withCanonicalSmokeRuntime({ name: "comp-rebind-idempotent", configureProductionExecution: false },
      async (runtime) => {
        const seed = seedRegistryOwnedCompensation(runtime);
        driftCanonical(seed.canonicalPath, seed.bytes);
        const first = withProjectAuthority(runtime, (authority) =>
          createAudioCanonicalDescriptorRebind({
            projectSlug: runtime.projectSlug, compensationRef: seed.compensationRef,
            reasonCode: "FILESYSTEM_MATERIALIZATION_DRIFT", authority, context: runtime.runtimeStorageContext,
          }));
        const second = withProjectAuthority(runtime, (authority) =>
          createAudioCanonicalDescriptorRebind({
            projectSlug: runtime.projectSlug, compensationRef: seed.compensationRef,
            reasonCode: "FILESYSTEM_MATERIALIZATION_DRIFT", authority, context: runtime.runtimeStorageContext,
          }));
        assert.equal(second.integrity, first.integrity);
        assert.equal(second.rebindId, first.rebindId);
      });
  });

  // 6. Chain of 2 rebinds resolves correctly.
  await scenario("chain: a second drift produces sequence 2, chained to sequence 1", async () => {
    await withCanonicalSmokeRuntime({ name: "comp-rebind-chain", configureProductionExecution: false },
      async (runtime) => {
        const seed = seedRegistryOwnedCompensation(runtime);
        driftCanonical(seed.canonicalPath, seed.bytes);
        const first = withProjectAuthority(runtime, (authority) =>
          createAudioCanonicalDescriptorRebind({
            projectSlug: runtime.projectSlug, compensationRef: seed.compensationRef,
            reasonCode: "FILESYSTEM_MATERIALIZATION_DRIFT", authority, context: runtime.runtimeStorageContext,
          }));
        driftCanonical(seed.canonicalPath, seed.bytes);
        const second = withProjectAuthority(runtime, (authority) =>
          createAudioCanonicalDescriptorRebind({
            projectSlug: runtime.projectSlug, compensationRef: seed.compensationRef,
            reasonCode: "FILESYSTEM_MATERIALIZATION_DRIFT", authority, context: runtime.runtimeStorageContext,
          }));
        assert.equal(second.sequence, 2);
        assert.equal(second.previousRecord.kind, "rebind");
        assert.equal(second.previousRecord.id, first.rebindId);
        assert.equal(second.previousRecord.integrity, first.integrity);
        const resolved = resolveCurrentAudioCanonicalDescriptorRebindRecord(
          runtime.runtimeStorageContext, runtime.projectSlug, seed.compensationRef, seed.publication,
        );
        assert.equal(resolved?.rebindId, second.rebindId);
        const identity = assertProtectedAudioCanonicalResolutionAllowed(
          runtime.projectSlug, seed.canonicalFileName, runtime.runtimeStorageContext,
        );
        assert.equal(identity?.inode, second.newInode);
      });
  });

  // 7. Lineage tamper: a rebind whose originalPublicationIntegrity does not match the real publication.
  await scenario("reject: rebind chain lineage mismatch (forged originalPublicationIntegrity) fails closed", async () => {
    await withCanonicalSmokeRuntime({ name: "comp-rebind-lineage-tamper", configureProductionExecution: false },
      async (runtime) => {
        const seed = seedRegistryOwnedCompensation(runtime);
        const drifted = driftCanonical(seed.canonicalPath, seed.bytes);
        // rebindId is embedded inside the hashed body, mirroring the production write path
        // exactly (rebindId is hashed as part of body, not appended after).
        const forgedBody = {
          schemaVersion: "audio-canonical-descriptor-rebind-v1" as const,
          rebindId: "audio-canonical-rebind-forged",
          compensationRef: seed.compensationRef,
          canonicalFileName: seed.canonicalFileName,
          projectSlug: runtime.projectSlug,
          sequence: 1,
          previousRecord: {
            kind: "publication" as const, id: seed.compensationRef,
            integrity: "0".repeat(64), // forged: does not match the real publication's integrity
          } satisfies AudioCanonicalDescriptorRebindRecordReference,
          originalPublicationIntegrity: "0".repeat(64), // forged
          rebindOperationId: runtime.operationId,
          rebindOperationBindingFingerprint: runtime.operationContext.bindingFingerprint,
          previousDevice: seed.publication.device,
          previousInode: seed.publication.inode,
          newDevice: drifted.dev,
          newInode: drifted.ino,
          verifiedSha256: seed.publication.sha256,
          verifiedByteLength: seed.publication.byteLength,
          reasonCode: "FILESYSTEM_MATERIALIZATION_DRIFT" as const,
          rebindAt: new Date().toISOString(),
        };
        const forged = { ...forgedBody, integrity: digestOf(forgedBody) };
        const target = rebindFilePath(runtime, seed.compensationRef, 1);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, JSON.stringify(forged), { flag: "wx" });
        assert.throws(
          () => resolveCurrentAudioCanonicalDescriptorRebindRecord(
            runtime.runtimeStorageContext, runtime.projectSlug, seed.compensationRef, seed.publication,
          ),
          AudioCanonicalDescriptorRebindConflictError,
        );
        assert.throws(
          () => assertProtectedAudioCanonicalResolutionAllowed(
            runtime.projectSlug, seed.canonicalFileName, runtime.runtimeStorageContext,
          ),
          "a forged chain must not silently unblock assembly",
        );
      });
  });

  // 8. Partial/corrupt rebind write recovery: a truncated file must not be silently overwritten.
  await scenario("reject: pre-existing corrupt rebind file is not silently overwritten", async () => {
    await withCanonicalSmokeRuntime({ name: "comp-rebind-partial-write", configureProductionExecution: false },
      async (runtime) => {
        const seed = seedRegistryOwnedCompensation(runtime);
        driftCanonical(seed.canonicalPath, seed.bytes);
        const target = rebindFilePath(runtime, seed.compensationRef, 1);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, "{ truncated garbage not json", { flag: "wx" });
        const before = fs.readFileSync(target);
        assert.throws(() => withProjectAuthority(runtime, (authority) =>
          createAudioCanonicalDescriptorRebind({
            projectSlug: runtime.projectSlug, compensationRef: seed.compensationRef,
            reasonCode: "FILESYSTEM_MATERIALIZATION_DRIFT", authority, context: runtime.runtimeStorageContext,
          })));
        const after = fs.readFileSync(target);
        assert.ok(before.equals(after), "corrupt rebind file must be left untouched, not silently repaired");
      });
  });

  // 9. SKIPPED / NOT APPLICABLE -- "conflicting rebind at the same sequence number" cannot be
  // exercised as a synchronous, single-process test against the public API as currently designed.
  // Pre-placing a well-formed, integrity-valid rebind record at <compensationRef>.1.json before
  // calling createAudioCanonicalDescriptorRebind() does NOT reproduce a same-sequence collision:
  // the production code's chain resolution (resolveCurrentAudioCanonicalDescriptorRebindRecord)
  // correctly recognizes any such record as a legitimate prior link and advances to sequence 2 --
  // this is the intended, correct behavior, not a bug (already proven for the sibling
  // AudioPublicationIntentStore.ts mechanism in scripts/smoke-audio-publication-rebind.ts,
  // scenario 8, which shares the identical chain-resolution design). A genuine same-sequence
  // collision can only occur via a true race: two concurrent callers both resolving the same
  // "previous" snapshot and both computing sequence=1 before either's writeDurableJsonNoClobber
  // write lands. Reproducing that requires either real concurrency (two interleaved
  // processes/workers) or a production-code seam to freeze/inject the resolved sequence number
  // for a controlled synchronous test -- both are explicitly out of scope for this sprint (no
  // production test hooks, no concurrency/race simulation). The conflict-vs-idempotent write path
  // (writeDurableJsonNoClobber followed by an existsSync + integrity comparison) is exercised
  // structurally by the same pattern already proven correct for the sibling
  // audio-publication-rebinds write path, which shares the identical no-clobber mechanism.
  skip("conflicting rebind at the same sequence number",
    "not a valid synchronous test as designed -- requires true concurrency or a production test hook, both out of scope; see comment above");

  // 10. "No record" and "retention-retired record" both fail closed -- auto-rebind is never
  // fabricated for either case; both require a separate, human-authorized reauthorization flow.
  await scenario("reject: no record and retention-retired record both fail closed, no auto-rebind", async () => {
    await withCanonicalSmokeRuntime({ name: "comp-rebind-no-record", configureProductionExecution: false },
      async (runtime) => {
        // 10a. No record ever existed for this compensationRef.
        const fabricatedRef = `audio-comp-${randomUUID()}`;
        assert.throws(() => withProjectAuthority(runtime, (authority) =>
          createAudioCanonicalDescriptorRebind({
            projectSlug: runtime.projectSlug, compensationRef: fabricatedRef,
            reasonCode: "FILESYSTEM_MATERIALIZATION_DRIFT", authority, context: runtime.runtimeStorageContext,
          })), AudioCompensationStoreError);

        // 10b. A record existed, reached registry-owned, but has since been retired by retention.
        const seed = seedRegistryOwnedCompensation(runtime);
        withProjectAuthority(runtime, (authority) =>
          removeRegistryOwnedAudioCompensationRecord(
            runtime.projectSlug, seed.compensationRef, authority, runtime.runtimeStorageContext,
          ));
        driftCanonical(seed.canonicalPath, seed.bytes);
        assert.throws(() => withProjectAuthority(runtime, (authority) =>
          createAudioCanonicalDescriptorRebind({
            projectSlug: runtime.projectSlug, compensationRef: seed.compensationRef,
            reasonCode: "FILESYSTEM_MATERIALIZATION_DRIFT", authority, context: runtime.runtimeStorageContext,
          })), AudioCompensationStoreError);
      });
  });

  // 11. Retention interaction: the rebind directory must not break the existing
  // audio-compensation-cleanup/ scan logic, and RETAIN_TERMINAL_RECORDS retention must not be
  // bypassed by the presence of a rebind chain.
  await scenario("retention: rebind directory does not interfere with pruneCompletedAudioCompensationRecords", async () => {
    await withCanonicalSmokeRuntime({ name: "comp-rebind-retention", configureProductionExecution: false },
      async (runtime) => {
        const seed = seedRegistryOwnedCompensation(runtime);
        driftCanonical(seed.canonicalPath, seed.bytes);
        const rebind = withProjectAuthority(runtime, (authority) =>
          createAudioCanonicalDescriptorRebind({
            projectSlug: runtime.projectSlug, compensationRef: seed.compensationRef,
            reasonCode: "FILESYSTEM_MATERIALIZATION_DRIFT", authority, context: runtime.runtimeStorageContext,
          }));
        const retention = withProjectAuthority(runtime, (authority) =>
          pruneCompletedAudioCompensationRecords(
            runtime.projectSlug, authority, runtime.runtimeStorageContext,
          ));
        assert.equal(retention.failed, 0);
        assert.equal(retention.removed, 0, "a single completed record is well under RETAIN_TERMINAL_RECORDS");
        assert.equal(fs.existsSync(rebindFilePath(runtime, seed.compensationRef, 1)), true,
          "the rebind ledger entry must survive an unrelated retention pass");
        const resolved = resolveCurrentAudioCanonicalDescriptorRebindRecord(
          runtime.runtimeStorageContext, runtime.projectSlug, seed.compensationRef, seed.publication,
        );
        assert.equal(resolved?.rebindId, rebind.rebindId);
      });
  });

  // 12. Combined downstream: AudioPublicationIntentStore and the new AudioCompensationStore
  // rebind mechanism protect the SAME physical canonical file (as in real production) and both
  // recover correctly from a single drift event.
  await scenario(
    "downstream: AudioPublicationIntentStore + AudioCompensationStore rebinds agree after a shared drift",
    async () => {
      await withCanonicalSmokeRuntime({ name: "comp-rebind-downstream", configureProductionExecution: false },
        async (runtime) => {
          const seed = seedRegistryOwnedCompensation(runtime);
          const projectId = `project-${runtime.projectSlug}`;
          const assetId = randomUUID();
          const publication: PortablePublishedFile = {
            mode: seed.publication.mode, device: seed.publication.device,
            inode: seed.publication.inode, byteLength: seed.publication.byteLength,
            sha256: seed.publication.sha256,
          };
          const asset: Asset = {
            id: assetId, projectId, projectSlug: runtime.projectSlug, sceneId: 1,
            type: "audio", status: "generated", provider: "openai", model: "tts-1",
            prompt: "fixture narration",
            filePath: `data/projects/${runtime.projectSlug}/assets/audio/${seed.canonicalFileName}`,
            url: `/api/assets/audio/${runtime.projectSlug}/${seed.canonicalFileName}`,
            mimeType: "audio/wav", byteLength: seed.publication.byteLength, durationSeconds: 1,
            createdAt: "2026-08-08T00:00:00.000Z",
          };
          withProjectAuthority(runtime, (authority) =>
            prepareAudioPublicationIntent({
              projectSlug: runtime.projectSlug, projectId, compensationRef: seed.compensationRef,
              asset, publication, authority, context: runtime.runtimeStorageContext,
            }));

          driftCanonical(seed.canonicalPath, seed.bytes);
          assert.throws(
            () => getCommittedAudioPublicationAssets(runtime.projectSlug, projectId, runtime.runtimeStorageContext),
            AudioPublicationIntentConflictError,
          );
          assert.throws(
            () => readCanonicalBound(runtime, seed.canonicalFileName, seed.canonicalPath),
            AudioCompensationStoreError,
          );

          const intentRebind = withProjectAuthority(runtime, (authority) =>
            createAudioPublicationDescriptorRebind({
              projectSlug: runtime.projectSlug, projectId, assetId,
              reasonCode: "FILESYSTEM_MATERIALIZATION_DRIFT", authority, context: runtime.runtimeStorageContext,
            }));
          const compensationRebind = withProjectAuthority(runtime, (authority) =>
            createAudioCanonicalDescriptorRebind({
              projectSlug: runtime.projectSlug, compensationRef: seed.compensationRef,
              reasonCode: "FILESYSTEM_MATERIALIZATION_DRIFT", authority, context: runtime.runtimeStorageContext,
            }));
          assert.equal(intentRebind.newInode, compensationRebind.newInode);
          assert.equal(intentRebind.verifiedSha256, compensationRebind.verifiedSha256);

          const committed = getCommittedAudioPublicationAssets(
            runtime.projectSlug, projectId, runtime.runtimeStorageContext,
          );
          assert.equal(committed.length, 1);
          assert.equal(committed[0].id, assetId);
          const identity = assertProtectedAudioCanonicalResolutionAllowed(
            runtime.projectSlug, seed.canonicalFileName, runtime.runtimeStorageContext,
          );
          assert.equal(identity?.inode, intentRebind.newInode);
          const bytes = readCanonicalBound(runtime, seed.canonicalFileName, seed.canonicalPath);
          assert.ok(bytes.equals(seed.bytes), "post-repair physical read must succeed for both layers together");
        });
    },
  );

  assert.equal(completed, 12);
  assert.equal(passed, 11);
  assert.equal(skipped, 1);
  console.log(
    `Audio compensation descriptor rebind smoke: PASS (${passed}/12 scenarios, ${skipped} skipped)`,
  );
  emitSmokeResult("audio-compensation-descriptor-rebind", `${passed} passed, ${skipped} skipped`);
}

void main().catch((error) => {
  console.error("Audio compensation descriptor rebind smoke FAILED:", error);
  process.exitCode = 1;
});
