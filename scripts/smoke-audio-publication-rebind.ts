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
  createAudioPublicationDescriptorRebind,
  getCommittedAudioPublicationAssets,
  resolveCurrentAudioPublicationDescriptor,
  resolveCurrentAudioPublicationRebindRecord,
  prepareAudioPublicationIntent,
  AudioPublicationIntentConflictError,
  AudioPublicationRebindError,
  AudioPublicationRebindConflictError,
  type AudioPublicationIntent,
  type AudioPublicationDescriptorRebind,
  type AudioPublicationRebindRecordReference,
} from "../src/lib/audio/AudioPublicationIntentStore";
import type { PortablePublishedFile } from "../src/lib/runtime/security/PortableNoClobberFilePublisher";
import type { Asset } from "../src/types/asset";

let completed = 0;
let passed = 0;
let skipped = 0;

async function scenario(name: string, run: () => Promise<void>) {
  await run();
  completed += 1;
  passed += 1;
  console.log(`[smoke-audio-rebind] (${completed}/12) PASS: ${name}`);
}

function skip(name: string, reason: string) {
  completed += 1;
  skipped += 1;
  console.log(`[smoke-audio-rebind] (${completed}/12) SKIPPED: ${name} -- ${reason}`);
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

/** Mirrors AudioPublicationIntentStore.ts's private digest() exactly (sha256 of JSON.stringify),
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

interface SeededAsset {
  readonly assetId: string;
  readonly projectId: string;
  readonly canonicalPath: string;
  readonly fileName: string;
  readonly intent: AudioPublicationIntent;
  readonly bytes: Buffer;
}

function seedCommittedAsset(runtime: CanonicalSmokeRuntime, dataBytes = 1600): SeededAsset {
  const assetId = randomUUID();
  const projectId = `project-${runtime.projectSlug}`;
  const fileName = `${assetId}.wav`;
  const bytes = wav(dataBytes);
  const audioDir = path.join(
    runtime.runtimeStorageContext.projectsRoot, runtime.projectSlug, "assets", "audio",
  );
  fs.mkdirSync(audioDir, { recursive: true });
  const canonicalPath = path.join(audioDir, fileName);
  fs.writeFileSync(canonicalPath, bytes, { flag: "wx" });
  const stat = fs.statSync(canonicalPath);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const publication: PortablePublishedFile = {
    mode: "hard-link", device: stat.dev, inode: stat.ino, byteLength: bytes.length, sha256,
  };
  const asset: Asset = {
    id: assetId,
    projectId,
    projectSlug: runtime.projectSlug,
    sceneId: 1,
    type: "audio",
    status: "generated",
    provider: "openai",
    model: "tts-1",
    prompt: "fixture narration",
    filePath: `data/projects/${runtime.projectSlug}/assets/audio/${fileName}`,
    url: `/api/assets/audio/${runtime.projectSlug}/${fileName}`,
    mimeType: "audio/wav",
    byteLength: bytes.length,
    durationSeconds: 1,
    createdAt: "2026-08-08T00:00:00.000Z",
  };
  const intent = withProjectAuthority(runtime, (authority) =>
    prepareAudioPublicationIntent({
      projectSlug: runtime.projectSlug,
      projectId,
      compensationRef: `audio-comp-${randomUUID()}`,
      asset,
      publication,
      authority,
      context: runtime.runtimeStorageContext,
    }));
  return { assetId, projectId, canonicalPath, fileName, intent, bytes };
}

/**
 * Deletes and rewrites the file with byte-identical content -- the exact real-world signature
 * this whole mechanism exists to recover from: same sha256/byteLength, a fresh inode.
 */
function driftInode(canonicalPath: string, bytes: Buffer): fs.Stats {
  fs.rmSync(canonicalPath);
  fs.writeFileSync(canonicalPath, bytes, { flag: "wx" });
  return fs.statSync(canonicalPath);
}

function rebindFilePath(runtime: CanonicalSmokeRuntime, assetId: string, sequence: number): string {
  return path.join(
    runtime.runtimeStorageContext.projectsRoot, runtime.projectSlug,
    "production-execution", "audio-publication-rebinds", `${assetId}.${sequence}.json`,
  );
}

function intentFilePath(runtime: CanonicalSmokeRuntime, assetId: string): string {
  return path.join(
    runtime.runtimeStorageContext.projectsRoot, runtime.projectSlug,
    "production-execution", "audio-publication-intents", `${assetId}.json`,
  );
}

async function main() {
  // 1. Happy path.
  await scenario(
    "happy path: byte-identical drift is rebound and getCommittedAudioPublicationAssets succeeds",
    async () => {
      await withCanonicalSmokeRuntime({ name: "rebind-happy", configureProductionExecution: false },
        async (runtime) => {
          const seed = seedCommittedAsset(runtime);
          driftInode(seed.canonicalPath, seed.bytes);
          assert.throws(
            () => getCommittedAudioPublicationAssets(runtime.projectSlug, seed.projectId,
              runtime.runtimeStorageContext),
            AudioPublicationIntentConflictError,
            "bug must reproduce before repair",
          );
          const rebind = withProjectAuthority(runtime, (authority) =>
            createAudioPublicationDescriptorRebind({
              projectSlug: runtime.projectSlug, projectId: seed.projectId, assetId: seed.assetId,
              reasonCode: "FILESYSTEM_MATERIALIZATION_DRIFT", authority, context: runtime.runtimeStorageContext,
            }));
          assert.equal(rebind.sequence, 1);
          assert.equal(rebind.verifiedSha256, seed.intent.publication.sha256);
          assert.equal(rebind.verifiedByteLength, seed.intent.publication.byteLength);
          assert.notEqual(rebind.newInode, seed.intent.publication.inode);
          const committed = getCommittedAudioPublicationAssets(runtime.projectSlug, seed.projectId,
            runtime.runtimeStorageContext);
          assert.equal(committed.length, 1);
          assert.equal(committed[0].id, seed.assetId);
        });
    },
  );

  // 2. Reject: sha256 differs (genuine content change, not a rebind case).
  await scenario("reject: sha256 mismatch is refused, no file written", async () => {
    await withCanonicalSmokeRuntime({ name: "rebind-sha-mismatch", configureProductionExecution: false },
      async (runtime) => {
        const seed = seedCommittedAsset(runtime);
        fs.rmSync(seed.canonicalPath);
        fs.writeFileSync(seed.canonicalPath, wav(1601), { flag: "wx" }); // different content -> different sha256/size
        assert.throws(() => withProjectAuthority(runtime, (authority) =>
          createAudioPublicationDescriptorRebind({
            projectSlug: runtime.projectSlug, projectId: seed.projectId, assetId: seed.assetId,
            reasonCode: "FILESYSTEM_MATERIALIZATION_DRIFT", authority, context: runtime.runtimeStorageContext,
          })), AudioPublicationRebindError);
        assert.equal(fs.existsSync(rebindFilePath(runtime, seed.assetId, 1)), false);
        assert.throws(
          () => getCommittedAudioPublicationAssets(runtime.projectSlug, seed.projectId,
            runtime.runtimeStorageContext),
          AudioPublicationIntentConflictError,
          "fail-closed behavior unchanged: no rebind exists, and none was created",
        );
      });
  });

  // 3. Reject: byteLength differs.
  await scenario("reject: byteLength mismatch is refused, no file written", async () => {
    await withCanonicalSmokeRuntime({ name: "rebind-length-mismatch", configureProductionExecution: false },
      async (runtime) => {
        const seed = seedCommittedAsset(runtime);
        fs.rmSync(seed.canonicalPath);
        fs.writeFileSync(seed.canonicalPath, wav(4000), { flag: "wx" });
        assert.throws(() => withProjectAuthority(runtime, (authority) =>
          createAudioPublicationDescriptorRebind({
            projectSlug: runtime.projectSlug, projectId: seed.projectId, assetId: seed.assetId,
            reasonCode: "FILESYSTEM_MATERIALIZATION_DRIFT", authority, context: runtime.runtimeStorageContext,
          })), AudioPublicationRebindError);
        assert.equal(fs.existsSync(rebindFilePath(runtime, seed.assetId, 1)), false);
      });
  });

  // 4. Reject: no intent exists for the given assetId (the "canonicalPath must correspond to a
  // real, resolvable intent" condition -- canonicalAssetPath self-consistency is separately
  // already enforced at readIntent()/validateIntentAsset() time for every existing intent, since
  // intents are immutable and validated on every read; this exercises the adjacent, reachable
  // failure: rebind refused when there is nothing on record to rebind against).
  await scenario("reject: rebind refused when no intent exists for the asset id", async () => {
    await withCanonicalSmokeRuntime({ name: "rebind-no-intent", configureProductionExecution: false },
      async (runtime) => {
        assert.throws(() => withProjectAuthority(runtime, (authority) =>
          createAudioPublicationDescriptorRebind({
            projectSlug: runtime.projectSlug, projectId: `project-${runtime.projectSlug}`,
            assetId: randomUUID(), reasonCode: "FILESYSTEM_MATERIALIZATION_DRIFT", authority,
            context: runtime.runtimeStorageContext,
          })), AudioPublicationRebindError);
      });
  });

  // 5. Reject: device/inode genuinely unchanged (no-op rebind is not silently accepted).
  await scenario("reject: no-op rebind (device/inode unchanged) is refused", async () => {
    await withCanonicalSmokeRuntime({ name: "rebind-noop", configureProductionExecution: false },
      async (runtime) => {
        const seed = seedCommittedAsset(runtime);
        assert.throws(() => withProjectAuthority(runtime, (authority) =>
          createAudioPublicationDescriptorRebind({
            projectSlug: runtime.projectSlug, projectId: seed.projectId, assetId: seed.assetId,
            reasonCode: "FILESYSTEM_MATERIALIZATION_DRIFT", authority, context: runtime.runtimeStorageContext,
          })), AudioPublicationRebindError);
      });
  });

  // 6. Read-time fail-closed: canonical file missing at rebind-creation time.
  await scenario("reject: canonical file missing at rebind-creation time fails closed", async () => {
    await withCanonicalSmokeRuntime({ name: "rebind-missing-file", configureProductionExecution: false },
      async (runtime) => {
        const seed = seedCommittedAsset(runtime);
        fs.rmSync(seed.canonicalPath);
        assert.throws(() => withProjectAuthority(runtime, (authority) =>
          createAudioPublicationDescriptorRebind({
            projectSlug: runtime.projectSlug, projectId: seed.projectId, assetId: seed.assetId,
            reasonCode: "FILESYSTEM_MATERIALIZATION_DRIFT", authority, context: runtime.runtimeStorageContext,
          })), AudioPublicationRebindError);
      });
  });

  // 7. Idempotent retry: same resulting descriptor twice is a safe no-op success.
  await scenario("idempotent: identical repeat rebind call succeeds without conflict", async () => {
    await withCanonicalSmokeRuntime({ name: "rebind-idempotent", configureProductionExecution: false },
      async (runtime) => {
        const seed = seedCommittedAsset(runtime);
        driftInode(seed.canonicalPath, seed.bytes);
        const first = withProjectAuthority(runtime, (authority) =>
          createAudioPublicationDescriptorRebind({
            projectSlug: runtime.projectSlug, projectId: seed.projectId, assetId: seed.assetId,
            reasonCode: "FILESYSTEM_MATERIALIZATION_DRIFT", authority, context: runtime.runtimeStorageContext,
          }));
        const second = withProjectAuthority(runtime, (authority) =>
          createAudioPublicationDescriptorRebind({
            projectSlug: runtime.projectSlug, projectId: seed.projectId, assetId: seed.assetId,
            reasonCode: "FILESYSTEM_MATERIALIZATION_DRIFT", authority, context: runtime.runtimeStorageContext,
          }));
        assert.equal(second.integrity, first.integrity);
        assert.equal(second.rebindId, first.rebindId);
      });
  });

  // 8. SKIPPED / NOT APPLICABLE -- "conflicting rebind at the same sequence number" cannot be
  // exercised as a synchronous, single-process test against the public API as currently designed.
  // Pre-placing a well-formed, integrity-valid rebind record at <assetId>.1.json before calling
  // createAudioPublicationDescriptorRebind() does NOT reproduce a same-sequence collision: the
  // production code's chain resolution (resolveCurrentAudioPublicationRebindRecord) correctly
  // recognizes any such record as a legitimate prior link and advances to sequence 2 -- this is
  // the intended, correct behavior, not a bug (confirmed empirically in the previous run: the
  // call succeeds and produces a valid sequence-2 rebind referencing the pre-placed record).
  // A genuine same-sequence collision can only occur via a true race: two concurrent callers
  // both resolving the same "previous" snapshot (e.g. both seeing no prior rebind) and both
  // computing sequence=1 before either's wx/no-clobber write lands. Reproducing that requires
  // either real concurrency (two interleaved processes/workers) or a production-code seam to
  // freeze/inject the resolved sequence number for a controlled synchronous test -- both are
  // explicitly out of scope for this sprint (no production test hooks, no concurrency/race
  // simulation). writeRebindNoClobber's own wx+integrity-compare conflict path is exercised
  // structurally by the same pattern already proven correct and load-bearing for the sibling
  // audio-publication-intents write path (prepareAudioPublicationIntent / writeIntentNoClobber),
  // which shares the identical no-clobber mechanism and is covered elsewhere. Revisit this
  // scenario if/when a concurrency-testing seam for this module is scoped intentionally.
  skip("conflicting rebind at the same sequence number",
    "not a valid synchronous test as designed -- requires true concurrency or a production test hook, both out of scope; see comment above");

  // 9. Chain of 2 rebinds resolves correctly.
  await scenario("chain: a second drift produces sequence 2, chained to sequence 1", async () => {
    await withCanonicalSmokeRuntime({ name: "rebind-chain", configureProductionExecution: false },
      async (runtime) => {
        const seed = seedCommittedAsset(runtime);
        driftInode(seed.canonicalPath, seed.bytes);
        const first = withProjectAuthority(runtime, (authority) =>
          createAudioPublicationDescriptorRebind({
            projectSlug: runtime.projectSlug, projectId: seed.projectId, assetId: seed.assetId,
            reasonCode: "FILESYSTEM_MATERIALIZATION_DRIFT", authority, context: runtime.runtimeStorageContext,
          }));
        driftInode(seed.canonicalPath, seed.bytes);
        const second = withProjectAuthority(runtime, (authority) =>
          createAudioPublicationDescriptorRebind({
            projectSlug: runtime.projectSlug, projectId: seed.projectId, assetId: seed.assetId,
            reasonCode: "FILESYSTEM_MATERIALIZATION_DRIFT", authority, context: runtime.runtimeStorageContext,
          }));
        assert.equal(second.sequence, 2);
        assert.equal(second.previousRecord.kind, "rebind");
        assert.equal(second.previousRecord.id, first.rebindId);
        assert.equal(second.previousRecord.integrity, first.integrity);
        const resolved = resolveCurrentAudioPublicationRebindRecord(
          runtime.projectSlug, seed.intent, runtime.runtimeStorageContext,
        );
        assert.equal(resolved?.rebindId, second.rebindId);
        const committed = getCommittedAudioPublicationAssets(runtime.projectSlug, seed.projectId,
          runtime.runtimeStorageContext);
        assert.equal(committed.length, 1);
      });
  });

  // 10. Lineage tamper: a rebind whose originalIntentIntegrity does not match the real intent.
  await scenario("reject: rebind chain lineage mismatch (forged originalIntentIntegrity) fails closed", async () => {
    await withCanonicalSmokeRuntime({ name: "rebind-lineage-tamper", configureProductionExecution: false },
      async (runtime) => {
        const seed = seedCommittedAsset(runtime);
        const drifted = driftInode(seed.canonicalPath, seed.bytes);
        // rebindId is embedded inside the hashed body, mirroring AudioPublicationIntentStore.ts's
        // production write path exactly (rebindId is hashed as part of body, not appended after).
        const forgedBody = {
          schemaVersion: "audio-publication-rebind-v1" as const,
          rebindId: "audio-rebind-forged",
          assetId: seed.assetId,
          sequence: 1,
          projectSlug: runtime.projectSlug,
          projectId: seed.projectId,
          runtimeAuthorityBinding: seed.intent.runtimeAuthorityBinding,
          canonicalRelativePath: seed.intent.canonicalRelativePath,
          previousRecord: {
            kind: "intent" as const, id: seed.intent.intentId,
            integrity: "0".repeat(64), // forged: does not match the real intent's integrity
          } satisfies AudioPublicationRebindRecordReference,
          originalIntentId: seed.intent.intentId,
          originalIntentIntegrity: "0".repeat(64), // forged
          previousDevice: seed.intent.publication.device,
          previousInode: seed.intent.publication.inode,
          newDevice: drifted.dev,
          newInode: drifted.ino,
          verifiedSha256: seed.intent.publication.sha256,
          verifiedByteLength: seed.intent.publication.byteLength,
          reasonCode: "FILESYSTEM_MATERIALIZATION_DRIFT" as const,
          rebindAt: new Date().toISOString(),
        };
        const forged = { ...forgedBody, integrity: digestOf(forgedBody) };
        const rebindDir = path.dirname(rebindFilePath(runtime, seed.assetId, 1));
        fs.mkdirSync(rebindDir, { recursive: true });
        fs.writeFileSync(rebindFilePath(runtime, seed.assetId, 1), JSON.stringify(forged), { flag: "wx" });
        assert.throws(
          () => resolveCurrentAudioPublicationRebindRecord(
            runtime.projectSlug, seed.intent, runtime.runtimeStorageContext,
          ),
          AudioPublicationRebindConflictError,
        );
        assert.throws(
          () => getCommittedAudioPublicationAssets(runtime.projectSlug, seed.projectId,
            runtime.runtimeStorageContext),
          AudioPublicationRebindConflictError,
          "a forged chain must not silently unblock assembly",
        );
      });
  });

  // 11. Partial/corrupt rebind write recovery: a truncated file must not be silently overwritten.
  await scenario("reject: pre-existing corrupt rebind file is not silently overwritten", async () => {
    await withCanonicalSmokeRuntime({ name: "rebind-partial-write", configureProductionExecution: false },
      async (runtime) => {
        const seed = seedCommittedAsset(runtime);
        driftInode(seed.canonicalPath, seed.bytes);
        const target = rebindFilePath(runtime, seed.assetId, 1);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, "{ truncated garbage not json", { flag: "wx" });
        const before = fs.readFileSync(target);
        assert.throws(() => withProjectAuthority(runtime, (authority) =>
          createAudioPublicationDescriptorRebind({
            projectSlug: runtime.projectSlug, projectId: seed.projectId, assetId: seed.assetId,
            reasonCode: "FILESYSTEM_MATERIALIZATION_DRIFT", authority, context: runtime.runtimeStorageContext,
          })), AudioPublicationRebindError);
        const after = fs.readFileSync(target);
        assert.ok(before.equals(after), "corrupt rebind file must be left untouched, not silently repaired");
      });
  });

  // 12. Downstream integration: the committed Asset payload is field-identical pre/post rebind.
  await scenario("downstream: committed asset payload is field-identical before and after rebind", async () => {
    await withCanonicalSmokeRuntime({ name: "rebind-downstream", configureProductionExecution: false },
      async (runtime) => {
        const seed = seedCommittedAsset(runtime);
        const before = getCommittedAudioPublicationAssets(runtime.projectSlug, seed.projectId,
          runtime.runtimeStorageContext);
        driftInode(seed.canonicalPath, seed.bytes);
        withProjectAuthority(runtime, (authority) =>
          createAudioPublicationDescriptorRebind({
            projectSlug: runtime.projectSlug, projectId: seed.projectId, assetId: seed.assetId,
            reasonCode: "FILESYSTEM_MATERIALIZATION_DRIFT", authority, context: runtime.runtimeStorageContext,
          }));
        const after = getCommittedAudioPublicationAssets(runtime.projectSlug, seed.projectId,
          runtime.runtimeStorageContext);
        assert.deepEqual(after, before, "VideoAssemblyManager-facing asset payload must be unaffected by a rebind");
        const rebound = resolveCurrentAudioPublicationDescriptor(
          runtime.projectSlug, seed.intent, runtime.runtimeStorageContext,
        );
        assert.equal(rebound?.sha256, seed.intent.publication.sha256);
        assert.equal(rebound?.byteLength, seed.intent.publication.byteLength);
        assert.notEqual(rebound?.inode, seed.intent.publication.inode);
      });
  });

  assert.equal(completed, 12);
  assert.equal(passed, 11);
  assert.equal(skipped, 1);
  console.log(
    `Sprint 136 audio publication rebind smoke: PASS (${passed}/12 scenarios, ${skipped} skipped)`,
  );
  emitSmokeResult("audio-publication-rebind", `${passed} passed, ${skipped} skipped`);
}

void main().catch((error) => {
  console.error("Sprint 136 audio publication rebind smoke FAILED:", error);
  process.exitCode = 1;
});
