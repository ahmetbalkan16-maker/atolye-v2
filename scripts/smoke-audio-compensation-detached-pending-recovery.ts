import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import {
  acquireProjectWriteAuthority,
  createRuntimeStorageContext,
  type RuntimeStorageAuthorityLease,
  type RuntimeStorageContext,
} from "../src/lib/runtime/RuntimeStoragePaths";
import {
  createProductionRuntimeOperationContext,
  initialRuntimeAuthorityGeneration,
  runWithProductionRuntimeOperationContext,
} from "../src/lib/runtime/ProductionRuntimeOperationContext";
import {
  assertProtectedAudioCanonicalResolutionAllowed,
  bindProtectedAudioCompensationPublication,
  createProtectedAudioCompensationReceipt,
  listDetachedPendingAudioCompensationRecords,
  prepareAudioCompensationWorkspace,
  recoverDetachedPendingAudioCompensationRecord,
  reserveProtectedAudioCompensationPublication,
  transitionAudioCompensationState,
  AudioCompensationStoreError,
} from "../src/lib/audio/AudioCompensationStore";

/**
 * Covers `recoverDetachedPendingAudioCompensationRecord` -- the narrow,
 * fail-closed recovery path for a `pending` / `awaiting-registry` compensation
 * record whose creating operation is no longer active (the one class of record
 * neither `transitionAudioCompensationState` nor the remove/prune functions can
 * reach, because they all funnel through `readProtectedAudioCompensationReceipt`
 * which pins the receipt to the *active* operation).
 */

let passCount = 0;
function pass(label: string) { passCount += 1; console.log(`PASS ${passCount}: ${label}`); }

const PUBLICATION_STAGING_FILE = "publication-staging.wav";

function wav(dataBytes: number): Buffer {
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

function setUpGitBackedRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "atolye-smoke-detached-recovery-"));
  const workspaceRoot = path.join(root, "workspace");
  const runtimeRoot = path.join(workspaceRoot, "runtime");
  const authorityRoot = path.join(root, "authority");
  fs.mkdirSync(runtimeRoot, { recursive: true });
  fs.mkdirSync(authorityRoot, { recursive: true });
  execFileSync("git", ["init", "--quiet"], { cwd: workspaceRoot });
  execFileSync("git", ["config", "user.email", "smoke@example.invalid"], { cwd: workspaceRoot });
  execFileSync("git", ["config", "user.name", "smoke"], { cwd: workspaceRoot });
  fs.writeFileSync(path.join(workspaceRoot, ".gitkeep"), "");
  execFileSync("git", ["add", "-A"], { cwd: workspaceRoot });
  execFileSync("git", ["commit", "--quiet", "-m", "init"], { cwd: workspaceRoot });
  const storageContext = createRuntimeStorageContext({
    workspaceRoot, authorityRoot,
    environment: { ...process.env, ATOLYE_RUNTIME_ROOT: runtimeRoot },
  });
  return { root, storageContext };
}

function withOperation<T>(
  storageContext: RuntimeStorageContext,
  operationId: string,
  action: () => T,
): T {
  const operation = createProductionRuntimeOperationContext({
    operationId, operationType: "detached-recovery-smoke",
    authorityGeneration: initialRuntimeAuthorityGeneration, storageContext,
  });
  return runWithProductionRuntimeOperationContext(operation, action) as T;
}

function withAuthority<T>(
  storageContext: RuntimeStorageContext,
  slug: string,
  action: (authority: RuntimeStorageAuthorityLease) => T,
): T {
  const authority = acquireProjectWriteAuthority(slug, storageContext);
  try {
    return action(authority);
  } finally {
    authority.release();
  }
}

interface SeedOptions {
  readonly canonicalFileName: string;
  readonly dataBytes: number;
  readonly bindPublication: boolean;
  /** When true, hard-link the staging file into assets/audio/<canonicalFileName>
   *  so the bound publication's device/inode match the live canonical file. */
  readonly linkCanonical: boolean;
}

interface Seeded {
  readonly compensationRef: string;
  readonly canonicalFileName: string;
  readonly canonicalPath: string | undefined;
  readonly stagingPath: string | undefined;
  readonly bytes: Buffer;
  readonly sha256: string;
}

/** Seed a `pending` / `awaiting-registry` compensation record under `operationId`
 *  and never transition it -- exactly the strand a crashed operation leaves. */
function seedPending(
  storageContext: RuntimeStorageContext,
  slug: string,
  operationId: string,
  options: SeedOptions,
): Seeded {
  return withOperation(storageContext, operationId, () => {
    const bytes = wav(options.dataBytes);
    const sha256 = createHash("sha256").update(bytes).digest("hex");

    const workspace = withAuthority(storageContext, slug, (authority) =>
      prepareAudioCompensationWorkspace({
        authority, context: storageContext, projectSlug: slug, byteLength: bytes.length,
      }));
    fs.writeFileSync(workspace.temporaryFilePath, bytes, { flag: "wx" });
    const tempStat = fs.statSync(workspace.temporaryFilePath);

    const receipt = withAuthority(storageContext, slug, (authority) =>
      createProtectedAudioCompensationReceipt({
        authority, context: storageContext, projectSlug: slug, workspace,
        canonicalFileName: options.canonicalFileName, byteLength: bytes.length,
        sha256, device: tempStat.dev, inode: tempStat.ino,
      }));

    let canonicalPath: string | undefined;
    let stagingPath: string | undefined;
    if (options.bindPublication) {
      stagingPath = path.join(workspace.directory, PUBLICATION_STAGING_FILE);
      fs.linkSync(workspace.temporaryFilePath, stagingPath);
      const stagingStat = fs.statSync(stagingPath);
      withAuthority(storageContext, slug, (authority) =>
        reserveProtectedAudioCompensationPublication({
          authority, context: storageContext, projectSlug: slug,
          compensationRef: receipt.compensationRef, mode: "hard-link",
          byteLength: bytes.length, sha256, device: stagingStat.dev, inode: stagingStat.ino,
        }));
      const publication = withAuthority(storageContext, slug, (authority) =>
        bindProtectedAudioCompensationPublication({
          authority, context: storageContext, projectSlug: slug,
          compensationRef: receipt.compensationRef, mode: "hard-link",
          byteLength: bytes.length, sha256, device: stagingStat.dev, inode: stagingStat.ino,
        }));
      if (options.linkCanonical) {
        const audioDir = path.join(storageContext.projectsRoot, slug, "assets", "audio");
        fs.mkdirSync(audioDir, { recursive: true });
        canonicalPath = path.join(audioDir, options.canonicalFileName);
        fs.linkSync(stagingPath, canonicalPath);
        const canonicalStat = fs.statSync(canonicalPath);
        assert.equal(canonicalStat.dev, publication.device);
        assert.equal(canonicalStat.ino, publication.inode);
      }
    }
    return {
      compensationRef: receipt.compensationRef,
      canonicalFileName: options.canonicalFileName,
      canonicalPath, stagingPath, bytes, sha256,
    };
  });
}

/** Place a standalone canonical audio file (a fresh inode, unrelated to any record). */
function placeCanonical(
  storageContext: RuntimeStorageContext, slug: string, canonicalFileName: string, bytes: Buffer,
): string {
  const audioDir = path.join(storageContext.projectsRoot, slug, "assets", "audio");
  fs.mkdirSync(audioDir, { recursive: true });
  const canonicalPath = path.join(audioDir, canonicalFileName);
  fs.writeFileSync(canonicalPath, bytes, { flag: "wx" });
  return canonicalPath;
}

function recoveryAuditPath(storageContext: RuntimeStorageContext, slug: string, ref: string): string {
  return path.join(
    storageContext.projectsRoot, slug, "production-execution",
    "audio-compensation-recovery", `${ref}.json`,
  );
}

function withRoot<T>(action: (storageContext: RuntimeStorageContext) => T): T {
  const { root, storageContext } = setUpGitBackedRoot();
  try {
    return action(storageContext);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function main() {
  // 1. Positive: superseded stale workspace -> completed/compensated + logical retirement + audit.
  withRoot((storageContext) => {
    const slug = "detached-superseded";
    const canonical = `${randomUUID()}.wav`;
    placeCanonical(storageContext, slug, canonical, wav(2048));
    const seed = seedPending(storageContext, slug, "op-dead-supersede", {
      canonicalFileName: canonical, dataBytes: 900, bindPublication: true, linkCanonical: false,
    });
    const result = withOperation(storageContext, "op-recovery-1", () =>
      withAuthority(storageContext, slug, (authority) =>
        recoverDetachedPendingAudioCompensationRecord({
          projectSlug: slug, compensationRef: seed.compensationRef, canonicalFileName: canonical,
          classification: "superseded", authority, context: storageContext,
        })));
    assert.equal(result.status, "recovered");
    assert.equal(result.finalOutcome, "compensated");
    assert.equal(result.logicallyRetired, true);
    assert.equal(result.detachedOperationId, "op-dead-supersede");
    assert.equal(result.recoveryOperationId, "op-recovery-1");
    assert.ok(fs.existsSync(recoveryAuditPath(storageContext, slug, seed.compensationRef)));
    pass("superseded stale workspace recovered to compensated + logically retired + audited");
  });

  // 2. Positive: authoritative pending record (publication == live canonical) -> registry-owned,
  //    and assertProtectedAudioCanonicalResolutionAllowed then resolves to it.
  withRoot((storageContext) => {
    const slug = "detached-authoritative";
    const canonical = `${randomUUID()}.wav`;
    const seed = seedPending(storageContext, slug, "op-dead-authoritative", {
      canonicalFileName: canonical, dataBytes: 1600, bindPublication: true, linkCanonical: true,
    });
    assert.throws(
      () => withOperation(storageContext, "op-probe-before", () =>
        assertProtectedAudioCanonicalResolutionAllowed(slug, canonical, storageContext)),
      AudioCompensationStoreError,
      "a detached pending record must block canonical resolution before recovery",
    );
    const result = withOperation(storageContext, "op-recovery-2", () =>
      withAuthority(storageContext, slug, (authority) =>
        recoverDetachedPendingAudioCompensationRecord({
          projectSlug: slug, compensationRef: seed.compensationRef, canonicalFileName: canonical,
          classification: "authoritative", authority, context: storageContext,
        })));
    assert.equal(result.status, "recovered");
    assert.equal(result.finalOutcome, "registry-owned");
    assert.equal(result.logicallyRetired, false);
    assert.ok(result.verifiedCanonicalIdentity);
    assert.equal(result.verifiedCanonicalIdentity?.sha256, seed.sha256);
    const identity = withOperation(storageContext, "op-probe-after", () =>
      assertProtectedAudioCanonicalResolutionAllowed(slug, canonical, storageContext));
    assert.ok(identity);
    assert.equal(identity?.sha256, seed.sha256);
    pass("authoritative pending record promoted to registry-owned; canonical resolution restored");
  });

  // 3. Negative: cannot recover a record owned by the active (recovery) operation.
  withRoot((storageContext) => {
    const slug = "detached-active-op";
    const canonical = `${randomUUID()}.wav`;
    placeCanonical(storageContext, slug, canonical, wav(1200));
    const seed = seedPending(storageContext, slug, "op-shared", {
      canonicalFileName: canonical, dataBytes: 700, bindPublication: false, linkCanonical: false,
    });
    assert.throws(
      () => withOperation(storageContext, "op-shared", () =>
        withAuthority(storageContext, slug, (authority) =>
          recoverDetachedPendingAudioCompensationRecord({
            projectSlug: slug, compensationRef: seed.compensationRef, canonicalFileName: canonical,
            classification: "superseded", authority, context: storageContext,
          }))),
      AudioCompensationStoreError,
    );
    pass("recovery refuses a record whose creating operation is the active operation");
  });

  // 4. Negative: a record whose identity DOES match the live canonical file cannot be
  //    abandoned as "superseded".
  withRoot((storageContext) => {
    const slug = "detached-collision";
    const canonical = `${randomUUID()}.wav`;
    const seed = seedPending(storageContext, slug, "op-dead-collision", {
      canonicalFileName: canonical, dataBytes: 1600, bindPublication: true, linkCanonical: true,
    });
    assert.throws(
      () => withOperation(storageContext, "op-recovery-4", () =>
        withAuthority(storageContext, slug, (authority) =>
          recoverDetachedPendingAudioCompensationRecord({
            projectSlug: slug, compensationRef: seed.compensationRef, canonicalFileName: canonical,
            classification: "superseded", authority, context: storageContext,
          }))),
      AudioCompensationStoreError,
    );
    pass("recovery refuses to abandon a record whose bound publication owns the live canonical file");
  });

  // 5. Negative: an "authoritative" claim whose publication does NOT match the live canonical file.
  withRoot((storageContext) => {
    const slug = "detached-authoritative-mismatch";
    const canonical = `${randomUUID()}.wav`;
    placeCanonical(storageContext, slug, canonical, wav(4096)); // unrelated live file
    const seed = seedPending(storageContext, slug, "op-dead-mismatch", {
      canonicalFileName: canonical, dataBytes: 1600, bindPublication: true, linkCanonical: false,
    });
    assert.throws(
      () => withOperation(storageContext, "op-recovery-5", () =>
        withAuthority(storageContext, slug, (authority) =>
          recoverDetachedPendingAudioCompensationRecord({
            projectSlug: slug, compensationRef: seed.compensationRef, canonicalFileName: canonical,
            classification: "authoritative", authority, context: storageContext,
          }))),
      AudioCompensationStoreError,
    );
    pass("recovery refuses an 'authoritative' claim whose publication identity does not match the live file");
  });

  // 6. Negative: "authoritative" with no bound publication; wrong canonicalFileName.
  withRoot((storageContext) => {
    const slug = "detached-missing-evidence";
    const canonical = `${randomUUID()}.wav`;
    placeCanonical(storageContext, slug, canonical, wav(1600));
    const noPub = seedPending(storageContext, slug, "op-dead-nopub", {
      canonicalFileName: canonical, dataBytes: 1600, bindPublication: false, linkCanonical: false,
    });
    assert.throws(
      () => withOperation(storageContext, "op-recovery-6a", () =>
        withAuthority(storageContext, slug, (authority) =>
          recoverDetachedPendingAudioCompensationRecord({
            projectSlug: slug, compensationRef: noPub.compensationRef, canonicalFileName: canonical,
            classification: "authoritative", authority, context: storageContext,
          }))),
      AudioCompensationStoreError,
    );
    assert.throws(
      () => withOperation(storageContext, "op-recovery-6b", () =>
        withAuthority(storageContext, slug, (authority) =>
          recoverDetachedPendingAudioCompensationRecord({
            projectSlug: slug, compensationRef: noPub.compensationRef,
            canonicalFileName: `${randomUUID()}.wav`,
            classification: "superseded", authority, context: storageContext,
          }))),
      AudioCompensationStoreError,
    );
    pass("recovery fails closed on missing publication ('authoritative') and on canonicalFileName mismatch");
  });

  // 7. Contract preserved: transitionAudioCompensationState still cannot touch a detached record.
  withRoot((storageContext) => {
    const slug = "detached-contract";
    const canonical = `${randomUUID()}.wav`;
    placeCanonical(storageContext, slug, canonical, wav(1200));
    const seed = seedPending(storageContext, slug, "op-dead-contract", {
      canonicalFileName: canonical, dataBytes: 700, bindPublication: false, linkCanonical: false,
    });
    assert.throws(
      () => withOperation(storageContext, "op-other", () =>
        withAuthority(storageContext, slug, (authority) =>
          transitionAudioCompensationState(
            slug, seed.compensationRef, { status: "completed", outcome: "compensated" },
            authority, storageContext,
          ))),
      AudioCompensationStoreError,
      "the operation-ownership gate on transitionAudioCompensationState must remain intact",
    );
    pass("transitionAudioCompensationState still rejects a cross-operation detached record (contract intact)");
  });

  // 8. Negative: a second "authoritative" promotion for a canonical file that already has a
  //    registry-owned record with a different identity is rejected.
  withRoot((storageContext) => {
    const slug = "detached-second-authoritative";
    const mix = "mix.wav";
    const audioDir = path.join(storageContext.projectsRoot, slug, "assets", "audio");
    // A owns the live mix.wav and is promoted to registry-owned.
    const a = seedPending(storageContext, slug, "op-dead-auth-a", {
      canonicalFileName: mix, dataBytes: 1600, bindPublication: true, linkCanonical: true,
    });
    withOperation(storageContext, "op-recovery-8a", () =>
      withAuthority(storageContext, slug, (authority) =>
        recoverDetachedPendingAudioCompensationRecord({
          projectSlug: slug, compensationRef: a.compensationRef, canonicalFileName: mix,
          classification: "authoritative", authority, context: storageContext,
        })));
    // B is a second detached pending record also naming mix.wav, byte-identical content but its
    // own staging inode. Now swap the live file to B's staging so B's publication matches it --
    // A's registry-owned record (different inode) must still block B's promotion.
    const b = seedPending(storageContext, slug, "op-dead-auth-b", {
      canonicalFileName: mix, dataBytes: 1600, bindPublication: true, linkCanonical: false,
    });
    fs.rmSync(path.join(audioDir, mix));
    fs.linkSync(b.stagingPath as string, path.join(audioDir, mix));
    assert.throws(
      () => withOperation(storageContext, "op-recovery-8b", () =>
        withAuthority(storageContext, slug, (authority) =>
          recoverDetachedPendingAudioCompensationRecord({
            projectSlug: slug, compensationRef: b.compensationRef, canonicalFileName: mix,
            classification: "authoritative", authority, context: storageContext,
          }))),
      AudioCompensationStoreError,
    );
    pass("recovery refuses a second conflicting 'authoritative' promotion for the same canonical file");
  });

  // 9. Idempotent replay: recover twice -> second call is write-free and returns "replayed".
  withRoot((storageContext) => {
    const slug = "detached-replay";
    const supersededCanonical = `${randomUUID()}.wav`;
    placeCanonical(storageContext, slug, supersededCanonical, wav(2048));
    const s = seedPending(storageContext, slug, "op-dead-replay-s", {
      canonicalFileName: supersededCanonical, dataBytes: 900, bindPublication: true, linkCanonical: false,
    });
    const authCanonical = `${randomUUID()}.wav`;
    const a = seedPending(storageContext, slug, "op-dead-replay-a", {
      canonicalFileName: authCanonical, dataBytes: 1600, bindPublication: true, linkCanonical: true,
    });
    for (const [ref, canonical, classification] of [
      [s.compensationRef, supersededCanonical, "superseded"] as const,
      [a.compensationRef, authCanonical, "authoritative"] as const,
    ]) {
      withOperation(storageContext, `op-recovery-9-${classification}-1`, () =>
        withAuthority(storageContext, slug, (authority) =>
          recoverDetachedPendingAudioCompensationRecord({
            projectSlug: slug, compensationRef: ref, canonicalFileName: canonical,
            classification, authority, context: storageContext,
          })));
      const replay = withOperation(storageContext, `op-recovery-9-${classification}-2`, () =>
        withAuthority(storageContext, slug, (authority) =>
          recoverDetachedPendingAudioCompensationRecord({
            projectSlug: slug, compensationRef: ref, canonicalFileName: canonical,
            classification, authority, context: storageContext,
          })));
      assert.equal(replay.status, "replayed");
      assert.equal(replay.writeFree, true);
    }
    pass("recovery is idempotent: a second call for either classification is write-free and returns 'replayed'");
  });

  // 10. End-to-end: 1 authoritative + several superseded pending records strand one canonical
  //     file; recovery of all restores resolution; an unrelated file's record is untouched.
  withRoot((storageContext) => {
    const slug = "detached-e2e";
    const mix = "mix.wav";
    // authoritative record (its bound publication owns the live mix.wav)
    const auth = seedPending(storageContext, slug, "op-dead-e2e-auth", {
      canonicalFileName: mix, dataBytes: 4000, bindPublication: true, linkCanonical: true,
    });
    // three superseded stale workspaces, all naming mix.wav, none matching the live file
    const stale = [0, 1, 2].map((i) => seedPending(storageContext, slug, `op-dead-e2e-stale-${i}`, {
      canonicalFileName: mix, dataBytes: 100 + i, bindPublication: i % 2 === 0, linkCanonical: false,
    }));
    // an unrelated canonical file with its own detached authoritative record
    const other = "section-1.wav";
    const otherSeed = seedPending(storageContext, slug, "op-dead-e2e-other", {
      canonicalFileName: other, dataBytes: 2200, bindPublication: true, linkCanonical: true,
    });
    withOperation(storageContext, "op-recovery-e2e-other", () =>
      withAuthority(storageContext, slug, (authority) =>
        recoverDetachedPendingAudioCompensationRecord({
          projectSlug: slug, compensationRef: otherSeed.compensationRef, canonicalFileName: other,
          classification: "authoritative", authority, context: storageContext,
        })));

    assert.throws(
      () => withOperation(storageContext, "op-e2e-before", () =>
        assertProtectedAudioCanonicalResolutionAllowed(slug, mix, storageContext)),
      AudioCompensationStoreError,
    );
    for (const s of stale) {
      withOperation(storageContext, `op-recovery-e2e-stale-${s.compensationRef}`, () =>
        withAuthority(storageContext, slug, (authority) =>
          recoverDetachedPendingAudioCompensationRecord({
            projectSlug: slug, compensationRef: s.compensationRef, canonicalFileName: mix,
            classification: "superseded", authority, context: storageContext,
          })));
    }
    withOperation(storageContext, "op-recovery-e2e-auth", () =>
      withAuthority(storageContext, slug, (authority) =>
        recoverDetachedPendingAudioCompensationRecord({
          projectSlug: slug, compensationRef: auth.compensationRef, canonicalFileName: mix,
          classification: "authoritative", authority, context: storageContext,
        })));

    const mixIdentity = withOperation(storageContext, "op-e2e-after-mix", () =>
      assertProtectedAudioCanonicalResolutionAllowed(slug, mix, storageContext));
    assert.ok(mixIdentity);
    assert.equal(mixIdentity?.sha256, auth.sha256);
    const otherIdentity = withOperation(storageContext, "op-e2e-after-other", () =>
      assertProtectedAudioCanonicalResolutionAllowed(slug, other, storageContext));
    assert.ok(otherIdentity);
    assert.equal(otherIdentity?.sha256, otherSeed.sha256);
    pass("end-to-end: 1 authoritative + 3 superseded strands recovered; mix.wav resolves; section-1.wav untouched");
  });

  // 11. Read-only enumeration reflects classification data and recovery progress.
  withRoot((storageContext) => {
    const slug = "detached-list";
    const mix = "mix.wav";
    const auth = seedPending(storageContext, slug, "op-dead-list-auth", {
      canonicalFileName: mix, dataBytes: 3000, bindPublication: true, linkCanonical: true,
    });
    const stale = seedPending(storageContext, slug, "op-dead-list-stale", {
      canonicalFileName: mix, dataBytes: 128, bindPublication: false, linkCanonical: false,
    });
    seedPending(storageContext, slug, "op-dead-list-other", {
      canonicalFileName: "section-2.wav", dataBytes: 900, bindPublication: true, linkCanonical: true,
    });
    const before = withOperation(storageContext, "op-list-before", () =>
      listDetachedPendingAudioCompensationRecords(slug, mix, storageContext));
    assert.equal(before.length, 2, "only the two mix.wav records are listed, not section-2.wav");
    const authRow = before.find((row) => row.compensationRef === auth.compensationRef);
    const staleRow = before.find((row) => row.compensationRef === stale.compensationRef);
    assert.ok(authRow && staleRow);
    assert.equal(authRow?.state.status, "pending");
    assert.equal(authRow?.hasBoundPublication, true);
    assert.equal(authRow?.recovered, false);
    assert.equal(staleRow?.hasBoundPublication, false);
    withOperation(storageContext, "op-list-recover", () =>
      withAuthority(storageContext, slug, (authority) =>
        recoverDetachedPendingAudioCompensationRecord({
          projectSlug: slug, compensationRef: stale.compensationRef, canonicalFileName: mix,
          classification: "superseded", authority, context: storageContext,
        })));
    const after = withOperation(storageContext, "op-list-after", () =>
      listDetachedPendingAudioCompensationRecords(slug, mix, storageContext));
    const staleAfter = after.find((row) => row.compensationRef === stale.compensationRef);
    assert.equal(staleAfter?.state.status, "completed");
    assert.equal(staleAfter?.state.outcome, "compensated");
    assert.equal(staleAfter?.logicallyRetired, true);
    assert.equal(staleAfter?.recovered, true);
    pass("listDetachedPendingAudioCompensationRecords is read-only and reflects state, publication and recovery progress");
  });

  console.log(`\nsmoke-audio-compensation-detached-pending-recovery: PASS (${passCount} scenarios)`);
}

try {
  main();
} catch (error) {
  console.error("smoke-audio-compensation-detached-pending-recovery FAILED:", error);
  process.exitCode = 1;
}
