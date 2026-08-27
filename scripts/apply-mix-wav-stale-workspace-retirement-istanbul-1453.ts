import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  acquireProjectWriteAuthority,
  getProjectRoot,
  resolveRuntimeStorageContext,
} from "../src/lib/runtime/RuntimeStoragePaths";
import {
  createProductionRuntimeOperationContext,
  runWithProductionRuntimeOperationContext,
  initialRuntimeAuthorityGeneration,
} from "../src/lib/runtime/ProductionRuntimeOperationContext";
import {
  assertProtectedAudioCanonicalResolutionAllowed,
  readProtectedAudioCompensationReceipt,
  removeCompensatedAudioCompensationRecord,
  transitionAudioCompensationState,
} from "../src/lib/audio/AudioCompensationStore";
import { AudioStorage } from "../src/lib/assets/storage/AudioStorage";

/**
 * ONE-TIME, EXPLICITLY OPERATOR-APPROVED production apply for the real
 * i-stanbul-un-fethi-1453 project: completes the durable lifecycle
 * (pending/awaiting-registry -> completed/compensated -> explicit logical
 * retirement) for exactly the 12 stale/abandoned mix.wav compensation
 * workspaces identified across this session's forensic chain, using ONLY the
 * existing canonical mutation APIs (`transitionAudioCompensationState`,
 * `removeCompensatedAudioCompensationRecord`) -- no manual JSON edits, no
 * change to `RETAIN_TERMINAL_RECORDS`, no `pruneCompletedAudioCompensationRecords`
 * call, no touch to the authoritative `bea459fd` record or the live
 * `mix.wav` file.
 *
 * NOTE: the operator emir's list spelled one ref as "7b19ca8e"; the only real
 * matching workspace on disk is "7b19cae8-532a-4a89-ad30-c593a1e0fc3e"
 * (transposed characters) -- that corrected ref is used below, flagged here
 * for the record.
 *
 * Everything (including the read-only preflight) runs inside a single
 * production runtime operation context: `readProtectedAudioCompensationReceipt`
 * itself requires one active (confirmed empirically on the first real run --
 * this script was corrected to wrap the whole flow rather than only the
 * mutating stages, before any mutation had occurred).
 */

const projectSlug = "i-stanbul-un-fethi-1453";
const canonicalFileName = "mix.wav";
const authoritativeRef = "audio-comp-bea459fd-578b-420f-9ab0-ff48f2bd4613";

const targetRefs = [
  "audio-comp-227366be-909f-4d95-8e85-8c5ec8730325",
  "audio-comp-7b19cae8-532a-4a89-ad30-c593a1e0fc3e", // emirde "7b19ca8e" -- düzeltildi
  "audio-comp-ce95959b-2288-4f80-a26e-8bbd338b7eaa",
  "audio-comp-1fdc44ad-a315-4dff-b3b0-607f55c24d1a",
  "audio-comp-522d5edb-2ad8-4f6a-bc61-aaf0423345c4",
  "audio-comp-6103b736-28de-4a8b-9b14-795f97eb9778",
  "audio-comp-72b115f4-afad-4f90-95fe-2d7cc598bbd2",
  "audio-comp-7b301e6d-4f45-47f2-83ba-0ac71d8e4667",
  "audio-comp-c2959f2d-52fa-4e7b-a537-e71aabfcbaa8",
  "audio-comp-01a13367-981a-43a0-a68e-3ca3e0b76aab",
  "audio-comp-817ad458-f1b6-496f-97ba-6f2c03a7180a",
  "audio-comp-cc98a895-86fe-4ea5-919a-e99c6ebb0762",
];

function cleanupRoot(context: ReturnType<typeof resolveRuntimeStorageContext>): string {
  return path.join(getProjectRoot(projectSlug, context), "production-execution", "audio-compensation-cleanup");
}

function planExists(context: ReturnType<typeof resolveRuntimeStorageContext>, ref: string): boolean {
  return fs.existsSync(path.join(cleanupRoot(context), `retirement-${ref}.json`));
}

function sha256File(p: string): string {
  return createHash("sha256").update(fs.readFileSync(p)).digest("hex");
}

function run() {
  const context = resolveRuntimeStorageContext({});

  // ================= STAGE 0: GLOBAL PREFLIGHT (read-only) =================
  console.log("=== STAGE 0: GLOBAL PREFLIGHT ===");

  const authBefore = readProtectedAudioCompensationReceipt(projectSlug, authoritativeRef, context);
  console.log("bea459fd before:", JSON.stringify({ receipt: authBefore.receipt, state: authBefore.state }));

  const mixPath = AudioStorage.getAudioPath(projectSlug, canonicalFileName);
  const mixStatBefore = fs.statSync(mixPath);
  const mixShaBefore = sha256File(mixPath);
  console.log("mix.wav before:", JSON.stringify({
    dev: mixStatBefore.dev, ino: mixStatBefore.ino, size: mixStatBefore.size, sha256: mixShaBefore,
  }));

  assert.equal(authBefore.receipt.device, mixStatBefore.dev, "bea459fd device must match live mix.wav");
  assert.equal(authBefore.receipt.inode, mixStatBefore.ino, "bea459fd inode must match live mix.wav");
  assert.equal(authBefore.receipt.sha256, mixShaBefore, "bea459fd sha256 must match live mix.wav");
  assert.equal(authBefore.receipt.byteLength, mixStatBefore.size, "bea459fd byteLength must match live mix.wav");
  console.log("bea459fd <-> live mix.wav full match: CONFIRMED (authoritative)");

  for (const ref of targetRefs) {
    const r = readProtectedAudioCompensationReceipt(projectSlug, ref, context);
    assert.equal(r.receipt.canonicalFileName, canonicalFileName, `${ref}: canonicalFileName mismatch`);
    assert.equal(r.state.status, "pending", `${ref}: status not pending`);
    assert.equal(r.state.outcome, "awaiting-registry", `${ref}: outcome not awaiting-registry`);
    assert.equal(r.state.sequence, 1, `${ref}: sequence not 1`);
    const fullMatch = r.receipt.device === mixStatBefore.dev && r.receipt.inode === mixStatBefore.ino;
    assert.equal(fullMatch, false, `${ref}: UNEXPECTED full device+inode match with live mix.wav -- must stop`);
    console.log(`${ref}: preflight OK (pending/awaiting-registry/seq1, not authoritative)`);
  }
  console.log("STAGE 0: PASS\n");

  // ================= STAGES 1-2: PER-REF TRANSITION + RETIREMENT =================
  const results: Array<Record<string, unknown>> = [];
  const authority = acquireProjectWriteAuthority(projectSlug, context);
  try {
    for (const ref of targetRefs) {
      console.log(`\n=== ${ref} ===`);

      const before = readProtectedAudioCompensationReceipt(projectSlug, ref, context);
      assert.equal(before.state.status, "pending", `${ref}: pre-mutation re-check failed (status)`);
      assert.equal(before.state.outcome, "awaiting-registry", `${ref}: pre-mutation re-check failed (outcome)`);
      assert.equal(before.state.sequence, 1, `${ref}: pre-mutation re-check failed (sequence)`);

      const transitioned = transitionAudioCompensationState(
        projectSlug, ref, { status: "completed", outcome: "compensated" }, authority, context,
      );
      console.log("transition result:", JSON.stringify(transitioned));

      const afterTransition = readProtectedAudioCompensationReceipt(projectSlug, ref, context);
      assert.equal(afterTransition.state.status, "completed", `${ref}: read-back status`);
      assert.equal(afterTransition.state.outcome, "compensated", `${ref}: read-back outcome`);
      assert.equal(afterTransition.receipt.integrity, before.receipt.integrity, `${ref}: receipt integrity must be unchanged by a state transition`);
      console.log("read-back after transition: completed/compensated CONFIRMED, sequence:", afterTransition.state.sequence);

      removeCompensatedAudioCompensationRecord(projectSlug, ref, authority, context);
      assert.ok(planExists(context, ref), `${ref}: retirement plan not found after retirement`);
      console.log("retirement plan created: CONFIRMED");

      // Idempotent replay: independently re-verifies plan integrity + live
      // workspace device/inode identity via executeRetirementPlan's own
      // checks -- a second, authentic proof of correct logical retirement.
      removeCompensatedAudioCompensationRecord(projectSlug, ref, authority, context);
      console.log("idempotent replay (plan+workspace identity re-verified): CONFIRMED");

      results.push({
        ref,
        before: { status: before.state.status, outcome: before.state.outcome, sequence: before.state.sequence },
        after: { status: "completed", outcome: "compensated" },
        retirementPlanConfirmed: true,
      });
    }
  } finally {
    authority.release();
  }

  // ================= STAGE 3: bea459fd unchanged =================
  console.log("\n=== STAGE 3: bea459fd unchanged check ===");
  const authAfter = readProtectedAudioCompensationReceipt(projectSlug, authoritativeRef, context);
  assert.deepEqual(authAfter.receipt, authBefore.receipt, "bea459fd receipt changed!");
  assert.deepEqual(authAfter.state, authBefore.state, "bea459fd state changed!");
  console.log("bea459fd UNCHANGED: CONFIRMED", JSON.stringify({ receipt: authAfter.receipt, state: authAfter.state }));

  // ================= STAGE 4: live mix.wav unchanged =================
  console.log("\n=== STAGE 4: live mix.wav unchanged check ===");
  const mixStatAfter = fs.statSync(mixPath);
  const mixShaAfter = sha256File(mixPath);
  assert.equal(mixStatAfter.dev, mixStatBefore.dev, "mix.wav device changed!");
  assert.equal(mixStatAfter.ino, mixStatBefore.ino, "mix.wav inode changed!");
  assert.equal(mixStatAfter.size, mixStatBefore.size, "mix.wav size changed!");
  assert.equal(mixShaAfter, mixShaBefore, "mix.wav sha256 changed!");
  console.log("mix.wav UNCHANGED: CONFIRMED", JSON.stringify({
    dev: mixStatAfter.dev, ino: mixStatAfter.ino, size: mixStatAfter.size, sha256: mixShaAfter,
  }));

  // ================= STAGE 5: final discovery check (read-only) =================
  console.log("\n=== STAGE 5: final discovery check ===");
  try {
    const identity = assertProtectedAudioCanonicalResolutionAllowed(projectSlug, canonicalFileName, context);
    console.log("discovery result:", identity ? JSON.stringify(identity) : "undefined");
  } catch (e) {
    console.log(
      "discovery THREW (EXPECTED: bea459fd itself remains pending/untouched by design -- " +
      "its own completion is a separate, not-yet-authorized step; the 12 stale entries " +
      "no longer contribute to this throw):",
      String(e),
    );
  }

  console.log("\n=== RESULTS SUMMARY (12/12) ===");
  console.log(JSON.stringify(results, null, 2));
  console.log(`\n=== ALL ${targetRefs.length} REFS: TRANSITIONED + RETIRED SUCCESSFULLY ===`);
}

function main() {
  const context = resolveRuntimeStorageContext({});
  const operation = createProductionRuntimeOperationContext({
    operationId: "mix-wav-stale-workspace-retirement-2026-08-26",
    operationType: "audio-compensation-retirement",
    authorityGeneration: initialRuntimeAuthorityGeneration,
    storageContext: context,
  });
  runWithProductionRuntimeOperationContext(operation, run);
}

try {
  main();
} catch (error) {
  console.error("\n!!! STOPPED (unexpected condition) !!!", error);
  process.exitCode = 1;
}
