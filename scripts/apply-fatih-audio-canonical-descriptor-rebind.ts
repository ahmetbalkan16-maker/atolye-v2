/**
 * One-time, narrowly-scoped audio-CANONICAL-descriptor rebind for exactly one
 * real project: fatih-sultan-mehmet-in-i-stanbul-un-fethine-hazirlanisi-cfe77fd8-...
 *
 * Sibling of scripts/rebind-fatih-audio-publication-descriptors.ts, but for the
 * *compensation-record* descriptor ledger (audio-compensation-cleanup/
 * audio-canonical-rebinds/), which is the one AudioStorage.readStoredWav /
 * inspectStoredWav -> assertProtectedAudioCanonicalResolutionAllowed ->
 * resolveEffectiveCanonicalReadIdentity consult -- and the one the export
 * stage (ExportBundleMaterializer.resolveChapterDurations) needs.
 *
 * Root cause (see this incident's read-only investigation report): all 7 of
 * this project's audio compensation records (audio-comp-*, created 2026-08-08,
 * all terminal state "completed"/"registry-owned") carry a device/inode pair in
 * record/publication.json from an earlier filesystem materialization. The live
 * canonical WAV files were re-materialized (git checkout / copy, 2026-08-20) onto
 * a fresh inode -- byte-for-byte identical (sha256 + byteLength match every
 * publication record, re-verified below AND inside createAudioCanonicalDescriptor
 * Rebind's own TOCTOU-safe check), device unchanged, inode drifted. The prior
 * session rebound the *publication-intent* ledger (audio-publication-rebinds/)
 * but NOT this one, so resolveEffectiveCanonicalReadIdentity returns the stale
 * publication descriptor and the export descriptor-bound read fails
 * ("chapter 1 narration audio file could not be verified on disk").
 *
 * Uses ONLY the existing, smoke-tested createAudioCanonicalDescriptorRebind()
 * (src/lib/audio/AudioCompensationStore.ts) -- no new persistence format, no new
 * authority mechanism. Purely additive: record/publication.json, receipt.json,
 * state-*.json, publication-reservation.json, workspace.json and the WAV files
 * are NEVER opened for writing; each call appends one new immutable
 * audio-compensation-cleanup/audio-canonical-rebinds/<compensationRef>.1.json
 * ledger entry, gated by assertProjectWriteAuthorityLease and independently
 * re-verifying sha256 + byteLength before ever writing.
 *
 * DRY-RUN by default. `--commit` is required to write anything.
 */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  initializeProductionProcessRuntime,
  shutdownProductionProcessRuntime,
} from "../src/lib/runtime/ProductionRuntimeCompositionRoot";
import {
  acquireProjectWriteAuthority,
  resolveRuntimeStorageContext,
} from "../src/lib/runtime/RuntimeStoragePaths";
import {
  createProductionRuntimeOperationContext,
  initialRuntimeAuthorityGeneration,
  runWithProductionRuntimeOperationContext,
} from "../src/lib/runtime/ProductionRuntimeOperationContext";
import {
  assertProtectedAudioCanonicalResolutionAllowed,
  createAudioCanonicalDescriptorRebind,
  listDetachedPendingAudioCompensationRecords,
} from "../src/lib/audio/AudioCompensationStore";
import { AudioStorage } from "../src/lib/assets/storage/AudioStorage";

const SLUG = "fatih-sultan-mehmet-in-i-stanbul-un-fethine-hazirlanisi-cfe77fd8-8350-4415-bc87-211e3d36c4d5";
const COMMIT = process.argv.includes("--commit");
/** Re-verify an already-applied rebind (idempotent-replay + post-repair checks); never a fresh write. */
const VERIFY = process.argv.includes("--verify");
/** Sub-directory the durable no-clobber writer uses for temp-then-link staging; never a rebind entry. */
const JOURNAL_STAGING_DIRECTORY = ".audio-journal-staging";
const REASON_CODE = "FILESYSTEM_MATERIALIZATION_DRIFT" as const;
const STABLE_DEVICE = 3195748655;

/** The exact 7 compensation records this incident produced (read-only report). */
const EXPECTED: ReadonlyArray<{
  readonly compRef: string;
  readonly canonicalFileName: string;
  readonly role: string;
}> = [
  { compRef: "audio-comp-936840f2-8482-418f-83a9-d68bb9917401", canonicalFileName: "9b935d3b-65d2-4f12-bb6b-c08fe1db6870.wav", role: "chapter 1" },
  { compRef: "audio-comp-bf89a8b8-e47b-47f2-8bc0-8529d3179b25", canonicalFileName: "438f9cbf-fc9d-47c6-8893-b2a3446f7fad.wav", role: "chapter 2" },
  { compRef: "audio-comp-4fd82647-b525-4f81-9175-55b61cd07392", canonicalFileName: "214ff993-9f05-484c-bc3e-0bafec892fdf.wav", role: "chapter 3" },
  { compRef: "audio-comp-95701e55-ff6b-4656-8f5d-e3626c0c7595", canonicalFileName: "25bc15cd-324d-4ecf-a94b-0b9fab10b449.wav", role: "chapter 4" },
  { compRef: "audio-comp-4b863a51-0542-4154-ad88-3338becfc2a5", canonicalFileName: "618db963-b754-49b9-860f-7cae537975d3.wav", role: "chapter 5" },
  { compRef: "audio-comp-69e75e66-c185-4fbd-99a4-8ea11884d75b", canonicalFileName: "b64c1ece-c695-4cd9-b4fb-07b888ae812c.wav", role: "chapter 6" },
  { compRef: "audio-comp-90c64cd5-3754-480b-8e8e-8eee3d41c88c", canonicalFileName: "5bf6ecd2-73e5-494a-ba4f-fc85d850cd47.wav", role: "full mix" },
];
const CHAPTER_FILES = EXPECTED.filter((e) => e.role.startsWith("chapter")).map((e) => e.canonicalFileName);

const projectRoot = path.resolve("data", "projects", SLUG);
const cleanupRoot = path.join(projectRoot, "production-execution", "audio-compensation-cleanup");
const audioDir = path.join(projectRoot, "assets", "audio");
const rebindDir = path.join(cleanupRoot, "audio-canonical-rebinds");

function sha256(file: string): string {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}
function readJson(file: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
}
/** sha256 of every immutable record file we must NOT touch, for a before/after diff. */
function recordFileDigests(compRef: string): Record<string, string> {
  const recordDir = path.join(cleanupRoot, compRef, "record");
  const out: Record<string, string> = {};
  for (const name of ["publication.json", "receipt.json", "publication-reservation.json",
    "state-000001.json", "state-000002.json"]) {
    out[name] = sha256(path.join(recordDir, name));
  }
  out["workspace.json"] = sha256(path.join(cleanupRoot, compRef, "workspace.json"));
  return out;
}

function fail(message: string): never {
  console.error(`\n!!! STOPPED — ${message}\n`);
  process.exitCode = 1;
  throw new Error(message);
}

async function main() {
  console.log(`=== apply-fatih-audio-canonical-descriptor-rebind (${VERIFY ? "VERIFY" : COMMIT ? "COMMIT" : "DRY-RUN"}) ===`);
  await initializeProductionProcessRuntime();

  // --- Scope assertion: the cleanup root must contain EXACTLY our 7 records ---
  if (!fs.existsSync(cleanupRoot)) fail(`cleanup root missing: ${cleanupRoot}`);
  const onDiskRefs = fs.readdirSync(cleanupRoot)
    .filter((n) => n.startsWith("audio-comp-"))
    .sort();
  const expectedRefs = EXPECTED.map((e) => e.compRef).sort();
  if (onDiskRefs.length !== expectedRefs.length ||
    !expectedRefs.every((r) => onDiskRefs.includes(r))) {
    fail(`unexpected compensation-record set on disk.\n  on-disk:  ${JSON.stringify(onDiskRefs)}\n  expected: ${JSON.stringify(expectedRefs)}`);
  }
  const existingRebindEntries = fs.existsSync(rebindDir)
    ? fs.readdirSync(rebindDir).filter((n) => n !== JOURNAL_STAGING_DIRECTORY)
    : [];
  if (!VERIFY && existingRebindEntries.length > 0) {
    fail(`audio-canonical-rebinds/ already contains entries: ${JSON.stringify(existingRebindEntries)}. Re-run with --verify to re-check an applied rebind, or clean the directory for a fresh start.`);
  }
  if (VERIFY && existingRebindEntries.length !== EXPECTED.length) {
    fail(`--verify expects ${EXPECTED.length} rebind entries already present, found ${existingRebindEntries.length}: ${JSON.stringify(existingRebindEntries)}`);
  }
  console.log(`Scope OK: exactly ${onDiskRefs.length} audio-comp-* records, matching the approved set. ` +
    (VERIFY ? `${existingRebindEntries.length} rebind entries present (verify mode).` : `No audio-canonical-rebinds/ yet.`));

  const context = resolveRuntimeStorageContext();
  const operationContext = createProductionRuntimeOperationContext({
    operationId: `operator-audio-canonical-rebind-${randomUUID()}`,
    operationType: "operator-audio-canonical-rebind",
    authorityGeneration: initialRuntimeAuthorityGeneration,
    storageContext: context,
  });

  // Snapshot the immutable-file digests + WAV digests BEFORE anything.
  const before = new Map<string, { records: Record<string, string>; wavSha: string; wavBytes: number;
    liveDevice: number; liveInode: number; pubDevice: number; pubInode: number; pubSha: string; pubBytes: number }>();
  for (const { compRef, canonicalFileName } of EXPECTED) {
    const wavPath = path.join(audioDir, canonicalFileName);
    if (!fs.existsSync(wavPath)) fail(`canonical WAV missing: ${wavPath}`);
    const st = fs.statSync(wavPath); // non-bigint — matches the runtime's own stat calls
    const pub = readJson(path.join(cleanupRoot, compRef, "record", "publication.json"));
    const state2 = readJson(path.join(cleanupRoot, compRef, "record", "state-000002.json"));
    // Preflight eligibility (mirrors createAudioCanonicalDescriptorRebind's own gates).
    if (pub.canonicalFileName !== canonicalFileName) fail(`${compRef}: publication.canonicalFileName ${JSON.stringify(pub.canonicalFileName)} != ${canonicalFileName}`);
    if (pub.compensationRef !== compRef || pub.projectSlug !== SLUG) fail(`${compRef}: publication binding mismatch`);
    if (state2.status !== "completed" || state2.outcome !== "registry-owned" || state2.sequence !== 2) {
      fail(`${compRef}: latest state is not completed/registry-owned/seq-2 — got ${JSON.stringify(state2)}`);
    }
    const wavSha = sha256(wavPath);
    const wavBytes = st.size;
    if (pub.sha256 !== wavSha) fail(`${compRef}: publication.sha256 ${JSON.stringify(pub.sha256)} != live WAV sha256 ${wavSha}`);
    if (pub.byteLength !== wavBytes) fail(`${compRef}: publication.byteLength ${JSON.stringify(pub.byteLength)} != live WAV byteLength ${wavBytes}`);
    if (pub.device !== STABLE_DEVICE) fail(`${compRef}: publication.device ${JSON.stringify(pub.device)} != expected stable device ${STABLE_DEVICE}`);
    if (st.dev !== STABLE_DEVICE) fail(`${compRef}: live WAV device ${st.dev} != expected stable device ${STABLE_DEVICE}`);
    if (pub.inode === st.ino) fail(`${compRef}: no device/inode drift (publication.inode === live inode ${st.ino}) — nothing to rebind, unexpected`);
    before.set(compRef, {
      records: recordFileDigests(compRef), wavSha, wavBytes,
      liveDevice: st.dev, liveInode: st.ino,
      pubDevice: pub.device as number, pubInode: pub.inode as number,
      pubSha: pub.sha256 as string, pubBytes: pub.byteLength as number,
    });
    console.log(`  preflight ${compRef} (${canonicalFileName.slice(0, 12)}): sha256 MATCH, byteLength ${wavBytes} MATCH, device ${STABLE_DEVICE} MATCH, inode drift ${pub.inode} -> ${st.ino}`);
  }

  // Everything below runs inside one production runtime operation context.
  await runWithProductionRuntimeOperationContext(operationContext, async () => {
    // Read-only enumeration via the real reader (per-canonical-file). Assert
    // exactly one record per file, ours, terminal, not recovered, not retired.
    for (const { compRef, canonicalFileName } of EXPECTED) {
      const rows = listDetachedPendingAudioCompensationRecords(SLUG, canonicalFileName, context);
      if (rows.length !== 1) fail(`${canonicalFileName}: expected exactly 1 compensation record, got ${rows.length}: ${JSON.stringify(rows.map((r) => r.compensationRef))}`);
      const row = rows[0];
      if (row.compensationRef !== compRef) fail(`${canonicalFileName}: record is ${row.compensationRef}, expected ${compRef}`);
      if (row.state.status !== "completed" || row.state.outcome !== "registry-owned") fail(`${compRef}: enumerated state ${JSON.stringify(row.state)}`);
      if (!row.hasBoundPublication) fail(`${compRef}: no bound publication`);
      if (row.logicallyRetired) fail(`${compRef}: logically retired`);
      if (!VERIFY && row.recovered) fail(`${compRef}: already has a recovery audit entry`);
      console.log(`  enumerate ${compRef}: 1 record, completed/registry-owned, bound publication, not retired`);
    }

    // Two-step resolution (gate + TOCTOU-safe descriptor read) that
    // inspectStoredWav performs: MUST fail for every chapter BEFORE the rebind,
    // MUST succeed AFTER (--verify).
    for (const canonicalFileName of CHAPTER_FILES) {
      let threw = false;
      try {
        AudioStorage.inspectStoredWav(SLUG, AudioStorage.getAudioPath(SLUG, canonicalFileName), context);
      } catch { threw = true; }
      if (!VERIFY && !threw) fail(`${canonicalFileName}: inspectStoredWav unexpectedly SUCCEEDED before the rebind — the assumed bug is not reproducing`);
      if (VERIFY && threw) fail(`${canonicalFileName}: inspectStoredWav still FAILS after an applied rebind`);
    }
    console.log(VERIFY
      ? `Pre-check (verify): all ${CHAPTER_FILES.length} chapter files already pass inspectStoredWav.`
      : `Pre-repair: all ${CHAPTER_FILES.length} chapter files fail inspectStoredWav (bug reproduced).`);

    if (!COMMIT && !VERIFY) {
      console.log(`\nDRY RUN — pass --commit to write ${EXPECTED.length} audio-canonical-rebinds/*.json entries. Nothing written.`);
      return;
    }

    // --- COMMIT / VERIFY: one createAudioCanonicalDescriptorRebind() per record.
    // In --verify this is a guaranteed idempotent replay (the function returns
    // the existing chain-tip rebind when the observed identity already matches).
    const authority = acquireProjectWriteAuthority(SLUG, context);
    const results: Array<Record<string, unknown>> = [];
    try {
      for (const { compRef, canonicalFileName, role } of EXPECTED) {
        const rebind = createAudioCanonicalDescriptorRebind({
          projectSlug: SLUG,
          compensationRef: compRef,
          reasonCode: REASON_CODE,
          authority,
          context,
        });
        const snap = before.get(compRef)!;
        assert.equal(rebind.compensationRef, compRef, `${compRef}: rebind.compensationRef`);
        assert.equal(rebind.canonicalFileName, canonicalFileName, `${compRef}: rebind.canonicalFileName`);
        assert.equal(rebind.sequence, 1, `${compRef}: rebind.sequence`);
        assert.equal(rebind.reasonCode, REASON_CODE, `${compRef}: rebind.reasonCode`);
        assert.equal(rebind.previousRecord.kind, "publication", `${compRef}: rebind.previousRecord.kind`);
        assert.equal(rebind.verifiedSha256, snap.pubSha, `${compRef}: rebind.verifiedSha256 must equal publication.sha256`);
        assert.equal(rebind.verifiedByteLength, snap.pubBytes, `${compRef}: rebind.verifiedByteLength must equal publication.byteLength`);
        assert.equal(rebind.previousDevice, snap.pubDevice, `${compRef}: rebind.previousDevice`);
        assert.equal(rebind.previousInode, snap.pubInode, `${compRef}: rebind.previousInode`);
        assert.equal(rebind.newDevice, snap.liveDevice, `${compRef}: rebind.newDevice must equal live device`);
        assert.equal(rebind.newInode, snap.liveInode, `${compRef}: rebind.newInode must equal live inode`);
        assert.notEqual(rebind.newInode, rebind.previousInode, `${compRef}: rebind must be a real change`);
        results.push({ compRef, role, rebindId: rebind.rebindId, sequence: rebind.sequence,
          previousInode: rebind.previousInode, newInode: rebind.newInode,
          verifiedSha256: rebind.verifiedSha256, verifiedByteLength: rebind.verifiedByteLength });
        console.log(`  rebound ${compRef} (${role}): ${rebind.previousInode} -> ${rebind.newInode}, sha256 ${rebind.verifiedSha256.slice(0, 16)}`);
      }
    } finally {
      authority.release();
    }

    // --- Post-repair verification ------------------------------------------
    // 1. The two-step resolution now SUCCEEDS for every chapter, and returns the
    //    live inode.
    for (const { compRef, canonicalFileName } of EXPECTED) {
      const identity = assertProtectedAudioCanonicalResolutionAllowed(SLUG, canonicalFileName, context);
      if (!identity) fail(`${compRef}: assertProtectedAudioCanonicalResolutionAllowed returned undefined post-rebind`);
      const snap = before.get(compRef)!;
      if (identity.sha256 !== snap.pubSha) fail(`${compRef}: post-rebind identity.sha256 changed`);
      if (identity.byteLength !== snap.pubBytes) fail(`${compRef}: post-rebind identity.byteLength changed`);
      if (identity.device !== snap.liveDevice) fail(`${compRef}: post-rebind identity.device ${identity.device} != live ${snap.liveDevice}`);
      if (identity.inode !== snap.liveInode) fail(`${compRef}: post-rebind identity.inode ${identity.inode} != live ${snap.liveInode}`);
    }
    for (const canonicalFileName of CHAPTER_FILES) {
      const inspection = AudioStorage.inspectStoredWav(SLUG, AudioStorage.getAudioPath(SLUG, canonicalFileName), context);
      if (!(inspection.durationSeconds > 0)) fail(`${canonicalFileName}: inspectStoredWav returned non-positive duration post-rebind`);
      console.log(`  post-repair ${canonicalFileName.slice(0, 12)}: inspectStoredWav OK, duration ${inspection.durationSeconds}s`);
    }

    // 2. Immutable record files + WAV files are byte-for-byte unchanged.
    for (const { compRef, canonicalFileName } of EXPECTED) {
      const snap = before.get(compRef)!;
      const nowRecords = recordFileDigests(compRef);
      for (const [name, digest] of Object.entries(snap.records)) {
        if (nowRecords[name] !== digest) fail(`${compRef}: record file ${name} CHANGED (${digest} -> ${nowRecords[name]})`);
      }
      const wavPath = path.join(audioDir, canonicalFileName);
      const nowSha = sha256(wavPath);
      const nowBytes = fs.statSync(wavPath).size;
      if (nowSha !== snap.wavSha) fail(`${canonicalFileName}: WAV sha256 CHANGED (${snap.wavSha} -> ${nowSha})`);
      if (nowBytes !== snap.wavBytes) fail(`${canonicalFileName}: WAV byteLength CHANGED (${snap.wavBytes} -> ${nowBytes})`);
    }
    console.log(`Post-repair: all 7 record dirs (publication/receipt/state/reservation/workspace) byte-unchanged; all 7 WAV files byte-unchanged.`);

    // 3. Ledger holds exactly 7 entries, one per record, sequence 1
    //    (ignoring the durable writer's .audio-journal-staging temp subdir).
    const written = (fs.existsSync(rebindDir) ? fs.readdirSync(rebindDir) : [])
      .filter((n) => n !== JOURNAL_STAGING_DIRECTORY).sort();
    const expectedFiles = EXPECTED.map((e) => `${e.compRef}.1.json`).sort();
    if (written.length !== expectedFiles.length || !expectedFiles.every((f) => written.includes(f))) {
      fail(`audio-canonical-rebinds/ has ${JSON.stringify(written)}, expected ${JSON.stringify(expectedFiles)}`);
    }

    console.log(`\n=== REBIND ${VERIFY ? "VERIFIED" : "COMPLETE"} — 7/7, ALL CHECKS PASS ===`);
    console.log(JSON.stringify(results, null, 2));
  });
}

main()
  .catch((error) => {
    console.error("=== apply-fatih-audio-canonical-descriptor-rebind FAILED ===");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => { void shutdownProductionProcessRuntime(); });
