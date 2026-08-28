import fs from "node:fs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  acquireProjectWriteAuthority,
  resolveRuntimeStorageContext,
  type RuntimeStorageAuthorityLease,
} from "../src/lib/runtime/RuntimeStoragePaths";
import {
  createProductionRuntimeOperationContext,
  initialRuntimeAuthorityGeneration,
} from "../src/lib/runtime/ProductionRuntimeOperationContext";
import { runWithProductionRuntimeOperationContext } from "../src/lib/runtime/RuntimeOperationScope";
import {
  assertProtectedAudioCanonicalResolutionAllowed,
  listDetachedPendingAudioCompensationRecords,
  recoverDetachedPendingAudioCompensationRecord,
  type DetachedPendingAudioCompensationClassification,
  type DetachedPendingAudioCompensationRecordSummary,
} from "../src/lib/audio/AudioCompensationStore";
import { AudioStorage } from "../src/lib/assets/storage/AudioStorage";

/**
 * ONE-TIME, EXPLICITLY OPERATOR-APPROVED production apply for the real
 * i-stanbul-un-fethi-1453 project.
 *
 * Root cause (Faz 2, proven by runtime probe): Sprint 148's controlled audio
 * reconcile was run ~10 times plus two `test-audio-save-*` fixtures, each
 * `prepareAudioCompensationWorkspace` -> `createProtectedAudioCompensationReceipt`
 * that crashed / was killed before its terminal
 * `transitionAudioCompensationState(-> registry-owned)`. That left a set of
 * `pending` / `awaiting-registry` / sequence-1 compensation workspaces for
 * `mix.wav` -- one authoritative (`bea459fd`, whose bound publication's
 * device/inode/sha256/byteLength are byte-for-byte identical to the live
 * `mix.wav`) and the rest superseded. Every one is DETACHED: its creating
 * operation is gone, so `readProtectedAudioCompensationReceipt` (which
 * `transitionAudioCompensationState`, the remove/prune functions and the old
 * `apply-mix-wav-stale-workspace-retirement-*` script all funnel through)
 * rejects it. `assertProtectedAudioCanonicalResolutionAllowed("mix.wav")`
 * therefore fails closed on every evaluation, permanently blocking
 * `VideoAssemblyManager.requireMixAsset()` and the assembly stage.
 *
 * This applies the narrow, fail-closed
 * `recoverDetachedPendingAudioCompensationRecord` authority (the audio-store
 * counterpart to `ProductionOrphanReservationToleranceAuthority`):
 *   - every superseded workspace -> `completed` / `compensated` + logical
 *     retirement (physical bytes are never deleted, foreign content preserved);
 *   - the one authoritative record -> `completed` / `registry-owned`, verified
 *     against a fresh, descriptor-bound read of the live `mix.wav`.
 * No new receipt is fabricated, no JSON is hand-edited, the receipt-root
 * `section-1..5.wav` records are never touched.
 *
 * Every candidate is (re-)discovered from the live on-disk state via
 * `listDetachedPendingAudioCompensationRecords` -- the previous script's
 * hand-maintained ref list is deliberately not trusted.
 *
 * The whole flow (read-only preflight, apply, read-only post-audit) runs inside
 * one production runtime operation context; `--commit` is required for the
 * mutating stage, otherwise the preflight + plan print run and nothing writes.
 */

const projectSlug = "i-stanbul-un-fethi-1453";
const canonicalFileName = "mix.wav";
const sectionFiles = ["section-1.wav", "section-2.wav", "section-3.wav", "section-4.wav", "section-5.wav"];
const commit = process.argv.includes("--commit");

function fail(reason: string): never {
  console.error(`BLOCKED: ${reason}`);
  process.exitCode = 1;
  throw new Error(reason);
}

function sha256File(p: string): string {
  return createHash("sha256").update(fs.readFileSync(p)).digest("hex");
}

interface LiveIdentity {
  readonly device: number;
  readonly inode: number;
  readonly byteLength: number;
  readonly sha256: string;
}

function readLive(): LiveIdentity {
  const p = AudioStorage.getAudioPath(projectSlug, canonicalFileName);
  const stat = fs.statSync(p);
  if (!stat.isFile()) fail(`${canonicalFileName} is not a regular file`);
  return { device: stat.dev, inode: stat.ino, byteLength: stat.size, sha256: sha256File(p) };
}

function classify(
  row: DetachedPendingAudioCompensationRecordSummary,
  live: LiveIdentity,
): DetachedPendingAudioCompensationClassification {
  const receiptMatches = row.receiptDevice === live.device && row.receiptInode === live.inode;
  const publicationMatches =
    row.hasBoundPublication &&
    row.publicationDevice === live.device &&
    row.publicationInode === live.inode;
  return receiptMatches || publicationMatches ? "authoritative" : "superseded";
}

function preflightRow(row: DetachedPendingAudioCompensationRecordSummary): void {
  if (row.canonicalFileName !== canonicalFileName) fail(`${row.compensationRef}: canonicalFileName ${row.canonicalFileName}`);
  if (row.state.status !== "pending") fail(`${row.compensationRef}: status ${row.state.status}`);
  if (row.state.outcome !== "awaiting-registry") fail(`${row.compensationRef}: outcome ${row.state.outcome}`);
  if (row.state.sequence !== 1) fail(`${row.compensationRef}: sequence ${row.state.sequence}`);
  if (row.logicallyRetired) fail(`${row.compensationRef}: already logically retired`);
  if (row.recovered) fail(`${row.compensationRef}: a recovery audit entry already exists (re-run with a fresh sweep)`);
}

function run(authority: RuntimeStorageAuthorityLease): void {
  const context = resolveRuntimeStorageContext({});

  console.log("========== STAGE 0: READ-ONLY PREFLIGHT ==========");
  const live = readLive();
  console.log("live mix.wav:", JSON.stringify(live));

  for (const section of sectionFiles) {
    const identity = assertProtectedAudioCanonicalResolutionAllowed(projectSlug, section, context);
    if (!identity) fail(`${section}: canonical resolution returned no identity (unexpected baseline)`);
    console.log(`baseline ${section}: resolves -> inode ${identity.inode}`);
  }

  let mixResolvedBefore = false;
  try {
    assertProtectedAudioCanonicalResolutionAllowed(projectSlug, canonicalFileName, context);
    mixResolvedBefore = true;
  } catch {
    console.log(`baseline ${canonicalFileName}: resolution THROWS (the blocker being repaired) -> OK`);
  }
  if (mixResolvedBefore) {
    console.log(`baseline ${canonicalFileName}: already resolves -- nothing to do. Verifying idempotently.`);
  }

  const rows = listDetachedPendingAudioCompensationRecords(projectSlug, canonicalFileName, context);
  console.log(`\ndetached-pending ${canonicalFileName} workspaces on disk: ${rows.length}`);
  if (rows.length === 0) fail("no detached-pending mix.wav workspaces found -- nothing to recover");

  const plan = rows.map((row) => ({ row, classification: classify(row, live) }));
  for (const { row, classification } of plan) {
    preflightRow(row);
    console.log(
      `  ${row.compensationRef}  op=${row.detachedOperationId}  ` +
      `receipt(dev=${row.receiptDevice},ino=${row.receiptInode},len=${row.receiptByteLength})  ` +
      `${row.hasBoundPublication ? `pub(dev=${row.publicationDevice},ino=${row.publicationInode})` : "pub=none"}  ` +
      `-> ${classification.toUpperCase()}`,
    );
  }

  const authoritative = plan.filter((entry) => entry.classification === "authoritative");
  const superseded = plan.filter((entry) => entry.classification === "superseded");
  if (authoritative.length !== 1) {
    fail(`expected exactly 1 authoritative record, found ${authoritative.length}`);
  }
  const authRow = authoritative[0].row;
  if (
    !authRow.hasBoundPublication ||
    authRow.publicationDevice !== live.device ||
    authRow.publicationInode !== live.inode ||
    authRow.receiptByteLength !== live.byteLength ||
    authRow.receiptSha256 !== live.sha256
  ) {
    fail(`authoritative candidate ${authRow.compensationRef} does not fully match live mix.wav`);
  }
  for (const { row } of superseded) {
    if (
      (row.receiptDevice === live.device && row.receiptInode === live.inode) ||
      (row.hasBoundPublication &&
        row.publicationDevice === live.device &&
        row.publicationInode === live.inode)
    ) {
      fail(`superseded candidate ${row.compensationRef} unexpectedly matches live mix.wav`);
    }
  }
  console.log(`\nplan: ${superseded.length} superseded -> compensated+retired, 1 authoritative (${authRow.compensationRef}) -> registry-owned`);
  console.log("STAGE 0: PASS\n");

  if (!commit) {
    console.log("DRY RUN (pass --commit to apply). No writes performed.");
    return;
  }

  console.log("========== STAGE 1: APPLY (superseded first, then authoritative) ==========");
  for (const { row } of superseded) {
    const result = recoverDetachedPendingAudioCompensationRecord({
      projectSlug, compensationRef: row.compensationRef, canonicalFileName,
      classification: "superseded", authority, context,
    });
    assert.equal(result.finalOutcome, "compensated");
    assert.equal(result.logicallyRetired, true);
    console.log(`  ${row.compensationRef}: ${result.status} -> compensated + retired (detached op ${result.detachedOperationId})`);
  }
  const authResult = recoverDetachedPendingAudioCompensationRecord({
    projectSlug, compensationRef: authRow.compensationRef, canonicalFileName,
    classification: "authoritative", authority, context,
  });
  assert.equal(authResult.finalOutcome, "registry-owned");
  assert.equal(authResult.logicallyRetired, false);
  assert.ok(authResult.verifiedCanonicalIdentity);
  assert.equal(authResult.verifiedCanonicalIdentity?.sha256, live.sha256);
  console.log(`  ${authRow.compensationRef}: ${authResult.status} -> registry-owned (verified against live mix.wav)`);
  console.log("STAGE 1: PASS\n");

  console.log("========== STAGE 2: READ-ONLY POST-AUDIT ==========");
  const mixIdentity = assertProtectedAudioCanonicalResolutionAllowed(projectSlug, canonicalFileName, context);
  if (!mixIdentity) fail("post-apply: mix.wav canonical resolution returned no identity");
  if (
    mixIdentity.device !== live.device ||
    mixIdentity.inode !== live.inode ||
    mixIdentity.byteLength !== live.byteLength ||
    mixIdentity.sha256 !== live.sha256
  ) {
    fail("post-apply: resolved mix.wav identity does not match the live file");
  }
  console.log(`mix.wav: now resolves -> ${JSON.stringify(mixIdentity)}`);

  const liveAfter = readLive();
  assert.deepEqual(liveAfter, live, "the live mix.wav file must be byte-for-byte unchanged");
  console.log("live mix.wav: byte-for-byte unchanged");

  for (const section of sectionFiles) {
    const identity = assertProtectedAudioCanonicalResolutionAllowed(projectSlug, section, context);
    if (!identity) fail(`post-apply: ${section} no longer resolves`);
  }
  console.log("section-1..5.wav: all still resolve");

  const after = listDetachedPendingAudioCompensationRecords(projectSlug, canonicalFileName, context);
  for (const row of after) {
    if (row.state.status !== "completed") fail(`post-apply: ${row.compensationRef} still ${row.state.status}`);
    if (!row.recovered) fail(`post-apply: ${row.compensationRef} has no recovery audit entry`);
    const classification = classify(row, live);
    if (classification === "superseded" && (!row.logicallyRetired || row.state.outcome !== "compensated")) {
      fail(`post-apply: superseded ${row.compensationRef} not compensated+retired`);
    }
    if (classification === "authoritative" && (row.logicallyRetired || row.state.outcome !== "registry-owned")) {
      fail(`post-apply: authoritative ${row.compensationRef} not registry-owned`);
    }
  }
  console.log(`all ${after.length} records terminal + audited (${superseded.length} compensated/retired, 1 registry-owned)`);
  console.log("STAGE 2: PASS\n");
  console.log("=== DETACHED-PENDING mix.wav RECOVERY COMPLETE ===");
}

function main(): void {
  const context = resolveRuntimeStorageContext({});
  const operation = createProductionRuntimeOperationContext({
    operationId: "mix-wav-detached-pending-recovery-2026-08-28",
    operationType: "audio-compensation-detached-pending-recovery",
    authorityGeneration: initialRuntimeAuthorityGeneration,
    storageContext: context,
  });
  runWithProductionRuntimeOperationContext(operation, () => {
    const authority = acquireProjectWriteAuthority(projectSlug, context);
    try {
      run(authority);
    } finally {
      authority.release();
    }
  });
}

try {
  main();
} catch (error) {
  console.error("\n!!! STOPPED !!!", error);
  process.exitCode = 1;
}
